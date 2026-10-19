// Solicita datos al servidor.
async function api(ruta, metodo = "GET", datos) {
  const opciones = {
    method: metodo,
    headers: { "Content-Type": "application/json" },
  };

  if (datos !== undefined) {
    opciones.body = JSON.stringify(datos);
  }

  let respuesta;
  try {
    respuesta = await fetch("/api" + ruta, opciones);
  } catch {
    throw new Error(
      "Sin conexion con el servidor. Revisa que servidor.js siga funcionando."
    );
  }

  const json = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(json.error || "Error HTTP " + respuesta.status);
  }
  return json;
}

// Crea un elemento HTML.
function el(etiqueta, clase, texto) {
  const elemento = document.createElement(etiqueta);
  if (clase) elemento.className = clase;
  if (texto !== undefined) elemento.textContent = texto;
  return elemento;
}

// Fechas y numeros.
const ZONA = "America/Mexico_City";

function horaLocal(fecha) {
  return new Date(fecha).toLocaleTimeString("es-MX", {
    timeZone: ZONA,
  });
}

function hoyLocal() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA,
  }).format(new Date());
}

function num(valor) {
  return valor === null || valor === undefined
    ? "—" : Number(valor).toFixed(1);
}

function hace(fecha) {
  const segundos = Math.max(
    0, Math.round((Date.now() - new Date(fecha).getTime()) / 1000)
  );

  if (segundos < 60) return "hace " + segundos + " s";
  if (segundos < 3600) {
    return "hace " + Math.round(segundos / 60) + " min";
  }

  return new Date(fecha).toLocaleString("es-MX", {
    timeZone: ZONA,
  });
}

// Muestra mensajes.
function aviso(contenedor, texto, tipo = "") {
  contenedor.textContent = "";
  if (texto) {
    contenedor.append(el("div", "aviso " + tipo, texto));
  }
}

// Muestra las consultas ejecutadas por el servidor.
function verCql(contenedor, lineas) {
  contenedor.textContent = "";
  const detalles = el("details");

  detalles.append(
    el("summary", null, "CQL que ejecuto la API"),
    el("pre", null, lineas.join("\n"))
  );

  contenedor.append(detalles);
}

// Menu y estado de Cassandra.
function menu(actual) {
  const nav = el("nav");
  nav.append(el("b", null, "Estacion UTHH"));

  const paginas = [
    ["index.html", "Tablero"],
    ["sensor.html", "Sensor"],
    ["registrar.html", "Registrar"],
  ];

  for (const [pagina, texto] of paginas) {
    const enlace = el("a", null, texto);
    enlace.href = pagina;

    if (pagina === actual) {
      enlace.setAttribute("aria-current", "page");
    }
    nav.append(enlace);
  }

  const estado = el("span", null, "Conectando...");
  estado.id = "estado";
  nav.append(estado);

  const cabecera = el("header");
  cabecera.append(nav);
  document.body.prepend(cabecera);

  api("/estado")
    .then(resultado => {
      estado.textContent =
        "● Cassandra " + resultado.version +
        (resultado.faltan.length ? " · Faltan tablas" : "");
    })
    .catch(error => {
      estado.textContent = "● Sin conexion";
      estado.title = error.message;
    });
}

// Grafica de temperatura y humedad.
function grafica(contenedor, lecturas) {
  contenedor.textContent = "";

  if (!lecturas.length) {
    contenedor.append(
      el("p", "nota", "Sin lecturas para ese sensor y dia.")
    );
    return;
  }

  const datos = lecturas.slice().sort(
    (a, b) => new Date(a.hora) - new Date(b.hora)
  );

  const W = 800, H = 300, margen = 55;
  const arriba = 25, abajo = H - 45;
  const inicio = new Date(datos[0].hora).getTime();
  const fin = Math.max(
    new Date(datos[datos.length - 1].hora).getTime(),
    inicio + 1
  );

  const temperaturas = datos.map(d => d.temperatura);
  const minimo = Math.floor(Math.min(...temperaturas) - 1);
  const maximo = Math.ceil(Math.max(...temperaturas) + 1);

  const x = tiempo =>
    margen + (tiempo - inicio) / (fin - inicio) * (W - 2 * margen);

  const yT = valor =>
    abajo - (valor - minimo) / (maximo - minimo) * (abajo - arriba);

  const yH = valor =>
    abajo - valor / 100 * (abajo - arriba);

  const NS = "http://www.w3.org/2000/svg";

  function svgElemento(nombre, atributos, texto) {
    const elemento = document.createElementNS(NS, nombre);
    for (const [clave, valor] of Object.entries(atributos)) {
      elemento.setAttribute(clave, valor);
    }
    if (texto !== undefined) elemento.textContent = texto;
    return elemento;
  }

  const svg = svgElemento("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": "Temperatura en naranja y humedad en azul",
  });

  for (let k = 0; k <= 4; k++) {
    const temperatura = minimo + (maximo - minimo) * k / 4;
    const tiempo = inicio + (fin - inicio) * k / 4;

    svg.append(
      svgElemento("line", {
        x1: margen, x2: W - margen,
        y1: yT(temperatura), y2: yT(temperatura),
        stroke: "#d6e0e8",
      }),
      svgElemento("text", {
        x: margen - 8, y: yT(temperatura) + 4,
        "text-anchor": "end", "font-size": 12,
      }, temperatura.toFixed(1) + "°"),
      svgElemento("text", {
        x: W - margen + 8, y: yH(k * 25) + 4,
        "font-size": 12,
      }, k * 25 + "%"),
      svgElemento("text", {
        x: x(tiempo), y: H - 15,
        "text-anchor": "middle", "font-size": 12,
      }, new Date(tiempo).toLocaleTimeString("es-MX", {
        timeZone: ZONA,
        hour: "2-digit",
        minute: "2-digit",
      }))
    );
  }

  for (const [campo, escala, color] of [
    ["humedad", yH, "#3a9bd9"],
    ["temperatura", yT, "#d9822b"],
  ]) {
    const puntos = datos.map(d =>
      x(new Date(d.hora).getTime()).toFixed(1) +
      "," + escala(d[campo]).toFixed(1)
    ).join(" ");

    svg.append(svgElemento("polyline", {
      points: puntos,
      fill: "none",
      stroke: color,
      "stroke-width": 2,
    }));

    if (datos.length === 1) {
      svg.append(svgElemento("circle", {
        cx: x(inicio),
        cy: escala(datos[0][campo]),
        r: 4,
        fill: color,
      }));
    }
  }

  contenedor.append(svg);
}