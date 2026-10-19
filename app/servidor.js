const http = require("http");
const fs = require("fs");
const path = require("path");

const {
  KS, LocalDate, crearCliente, diaLocal,
  ejecutar, guardarLectura, leerSensores,
} = require("./bd");

const PUERTO = 3000;
const WEB = path.join(__dirname, "web");
const cliente = crearCliente();

const TABLAS = [
  "sensores",
  "lecturas_por_sensor_dia",
  "ultima_lectura",
  "alertas_por_dia",
  "conteo_por_dia",
];

// Version de Cassandra y tablas existentes.
async function estado() {
  const cql = [];
  const version = await ejecutar(
    cliente, "SELECT release_version FROM system.local", [], cql
  );
  const resultado = await ejecutar(
    cliente,
    "SELECT table_name FROM system_schema.tables WHERE keyspace_name = ?",
    [KS], cql
  );
  const tablas = resultado.rows.map(r => r.table_name);

  return {
    version: version.first().release_version,
    tablas,
    faltan: TABLAS.filter(t => !tablas.includes(t)),
    cql,
  };
}

// Sensores con su ultima lectura y contador de hoy.
async function sensores() {
  const cql = [];
  const hoy = diaLocal();
  const catalogo = await leerSensores(cliente, cql);
  const resultado = await ejecutar(
    cliente,
    `SELECT sensor, hora, temperatura, humedad FROM ${KS}.ultima_lectura`,
    [], cql
  );

  const ultimas = {};
  for (const r of resultado.rows) {
    ultimas[r.sensor] = {
      hora: r.hora,
      temperatura: r.temperatura,
      humedad: r.humedad,
    };
  }

  const lista = [];
  for (const sensor of Object.values(catalogo)) {
    const conteo = await ejecutar(
      cliente,
      `SELECT lecturas FROM ${KS}.conteo_por_dia
       WHERE sensor = ? AND dia = ?`,
      [sensor.id, LocalDate.fromString(hoy)], cql
    );

    lista.push({
      ...sensor,
      ultima: ultimas[sensor.id] || null,
      lecturasHoy: conteo.first()
        ? Number(conteo.first().lecturas) : 0,
    });
  }

  lista.sort((a, b) => a.id.localeCompare(b.id));
  return { hoy, sensores: lista, cql };
}

// Historial de un sensor en un dia.
async function lecturas(id, parametros) {
  const cql = [];
  const dia = parametros.get("dia") || diaLocal();
  const limite = Number(parametros.get("limite") || 1000);

  if (!Number.isInteger(limite) || limite < 1 || limite > 5000) {
    throw new Error("El limite debe ser un entero entre 1 y 5000.");
  }

  const resultado = await ejecutar(
    cliente,
    `SELECT hora, temperatura, humedad
     FROM ${KS}.lecturas_por_sensor_dia
     WHERE sensor = ? AND dia = ? LIMIT ?`,
    [id, LocalDate.fromString(dia), limite], cql
  );

  return { sensor: id, dia, lecturas: resultado.rows, cql };
}

// Alertas de un dia.
async function alertas(parametros) {
  const cql = [];
  const dia = parametros.get("dia") || diaLocal();
  const resultado = await ejecutar(
    cliente,
    `SELECT hora, sensor, temperatura, mensaje
     FROM ${KS}.alertas_por_dia WHERE dia = ? LIMIT 200`,
    [LocalDate.fromString(dia)], cql
  );

  return { dia, alertas: resultado.rows, cql };
}

// Registra una lectura enviada desde la pagina.
async function registrar(datos) {
  if (!datos || typeof datos !== "object") {
    throw new Error("La lectura debe ser un objeto JSON.");
  }

  const cql = [];
  const catalogo = await leerSensores(cliente, cql);
  if (!Object.hasOwn(catalogo, datos.sensor)) {
    throw new Error("El sensor no existe.");
  }
  const sensor = catalogo[datos.sensor];

  const t = datos.temperatura;
  const h = datos.humedad;

  if (!Number.isFinite(t) || t < -20 || t > 60) {
    throw new Error("La temperatura debe estar entre -20 y 60 °C.");
  }
  if (!Number.isInteger(h) || h < 0 || h > 100) {
    throw new Error("La humedad debe ser un entero entre 0 y 100 %.");
  }

  const resultado = await guardarLectura(
    cliente, sensor,
    { hora: new Date(), temperatura: t, humedad: h },
    cql
  );

  return {
    sensor: sensor.id,
    dia: resultado.dia,
    alerta: resultado.alerta,
    cql,
  };
}

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const ruta = url.pathname;

    // Entrega archivos de la carpeta web.
    if (!ruta.startsWith("/api/")) {
      const nombre = ruta === "/" ? "/index.html" : decodeURIComponent(ruta);
      const archivo = path.resolve(WEB, "." + nombre);

      if (!archivo.startsWith(WEB + path.sep)) {
        res.writeHead(403);
        return res.end("Acceso denegado");
      }

      return fs.readFile(archivo, (error, contenido) => {
        if (error) {
          res.writeHead(404);
          return res.end("No encontrado");
        }
        res.writeHead(200, {
          "Content-Type": TIPOS[path.extname(archivo)] || "text/plain",
        });
        res.end(contenido);
      });
    }

    let respuesta;
    const coincidencia = ruta.match(
      /^\/api\/sensores\/([\w-]+)\/lecturas$/
    );

    if (req.method === "GET" && ruta === "/api/estado") {
      respuesta = await estado();
    } else if (req.method === "GET" && ruta === "/api/sensores") {
      respuesta = await sensores();
    } else if (req.method === "GET" && coincidencia) {
      respuesta = await lecturas(coincidencia[1], url.searchParams);
    } else if (req.method === "GET" && ruta === "/api/alertas") {
      respuesta = await alertas(url.searchParams);
    } else if (req.method === "POST" && ruta === "/api/lecturas") {
      let cuerpo = "";
      let bytes = 0;
      for await (const parte of req) {
        bytes += parte.length;
        if (bytes > 10000) throw new Error("Peticion demasiado grande.");
        cuerpo += parte;
      }
      respuesta = await registrar(JSON.parse(cuerpo || "{}"));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Ruta no encontrada" }));
    }

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(respuesta));
  } catch (error) {
    console.error("Error:", error.message);
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error.message }));
  }
}).listen(PUERTO, () => {
  console.log("Estacion UTHH en el puerto " + PUERTO);
});