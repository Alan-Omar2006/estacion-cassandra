const {
  crearCliente,
  leerSensores,
  guardarLectura,
} = require("./bd");

const cliente = crearCliente();

// Genera temperatura y humedad con variaciones durante el dia.
function simular(sensor, fecha) {
  const hora =
    (fecha.getUTCHours() - 6 + 24) % 24 +
    fecha.getUTCMinutes() / 60;

  const exterior = sensor.tipo === "exterior";
  const base = exterior ? 28 : 25;
  const amplitud = exterior ? 7 : 3;

  let temperatura =
    base +
    amplitud * Math.cos(2 * Math.PI * (hora - 15) / 24) +
    (Math.random() - 0.5);

  if (Math.random() < 0.01) temperatura += 5;

  const humedad = Math.max(
    30,
    Math.min(
      95,
      75 - (temperatura - base) * 2.5 + (Math.random() - 0.5) * 4
    )
  );

  return {
    hora: fecha,
    temperatura: Math.round(temperatura * 10) / 10,
    humedad: Math.round(humedad),
  };
}

// Genera y guarda lecturas continuamente.
async function enVivo(sensores) {
  console.log(
    "Simulando " + sensores.length +
    " sensores. Ctrl + C para detener."
  );

  while (true) {
    const inicio = Date.now();
    const ahora = new Date();
    const partes = [];

    for (const sensor of sensores) {
      const lectura = simular(sensor, ahora);
      const resultado = await guardarLectura(
        cliente, sensor, lectura
      );

      partes.push(
        sensor.id + " " +
        lectura.temperatura + "°C " +
        lectura.humedad + "%" +
        (resultado.alerta ? " ALERTA" : "")
      );
    }

    console.log(
      ahora.toLocaleTimeString("es-MX", {
        timeZone: "America/Mexico_City",
      }) + " | " + partes.join(" | ")
    );

    await new Promise(resolve =>
      setTimeout(resolve, Math.max(0, 1000 - (Date.now() - inicio)))
    );
  }
}

// Crea lecturas historicas cada dos minutos para cada sensor.
async function historico(sensores, dias) {
  const paso = 2 * 60 * 1000;
  const fin = Date.now() - 60000;
  const inicio = fin - dias * 86400000;
  const tareas = [];

  for (const sensor of sensores) {
    for (let t = inicio; t <= fin; t += paso) {
      tareas.push([sensor, simular(sensor, new Date(t))]);
    }
  }

  console.log(
    "Escribiendo " + tareas.length +
    " lecturas de " + dias + " dias..."
  );

  const t0 = Date.now();
  let siguiente = 0;
  let completadas = 0;

  async function trabajador() {
    while (siguiente < tareas.length) {
      const [sensor, lectura] = tareas[siguiente++];

      await guardarLectura(
        cliente, sensor, lectura, null, true
      );

      completadas++;
      if (completadas % 2000 === 0) {
        console.log("  " + completadas + " lecturas guardadas...");
      }
    }
  }

  await Promise.all(
    Array.from({ length: 50 }, () => trabajador())
  );

  const segundos = (Date.now() - t0) / 1000;

  console.log(
    "Listo: " + completadas +
    " lecturas en " + segundos.toFixed(1) +
    " s (" + Math.round(completadas / segundos) +
    " lecturas por segundo)."
  );
}

async function main() {
  try {
    const mapa = await leerSensores(cliente);
    const sensores = Object.values(mapa);

    if (!sensores.length) {
      throw new Error("Primero registra los sensores en Cassandra.");
    }

    if (process.argv[2] === "historico") {
      const dias = Number(process.argv[3] || 7);

      if (!Number.isInteger(dias) || dias < 1 || dias > 30) {
        throw new Error("Indica un numero entero de dias entre 1 y 30.");
      }

      await historico(sensores, dias);
    } else {
      await enVivo(sensores);
    }
  } finally {
    await cliente.shutdown();
  }
}

main().catch(error => {
  console.error("Error:", error.message);
  process.exitCode = 1;
});