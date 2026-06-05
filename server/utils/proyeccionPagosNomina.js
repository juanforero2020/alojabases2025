const MESES_NOMBRE = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const MESES_CORTO = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

const MAP_DIA_SEMANA = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
};

function normalizarTexto(valor) {
  return (valor || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function etiquetaFechaCorta(fecha) {
  return `${fecha.getDate()}-${MESES_CORTO[fecha.getMonth()]}`;
}

function diaSemanaDesdeParametro(parametro) {
  const texto = normalizarTexto(parametro).replace(/^los\s+/, "");
  if (MAP_DIA_SEMANA[texto] !== undefined) {
    return MAP_DIA_SEMANA[texto];
  }
  for (const [clave, valor] of Object.entries(MAP_DIA_SEMANA)) {
    if (texto.includes(clave)) return valor;
  }
  return 6;
}

function siguienteDiaSemana(fecha, diaSemana) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  const diff = (diaSemana - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + (diff === 0 ? 0 : diff));
  if (d < fecha) {
    d.setDate(d.getDate() + 7);
  }
  return d;
}

function agregarMeses(fecha, meses) {
  const d = new Date(fecha);
  d.setMonth(d.getMonth() + meses);
  return d;
}

function generarFechasSemanal(desde, hasta, parametro) {
  const dia = diaSemanaDesdeParametro(parametro);
  const fechas = [];
  let actual = siguienteDiaSemana(desde, dia);
  while (actual <= hasta) {
    fechas.push(new Date(actual));
    actual.setDate(actual.getDate() + 7);
    actual = new Date(actual);
  }
  return fechas;
}

function generarFechasDominical(desde, hasta) {
  return generarFechasSemanal(desde, hasta, "Domingo");
}

function generarFechasQuincenal(desde, hasta) {
  const fechas = [];
  const cursor = new Date(desde.getFullYear(), desde.getMonth(), 1);
  while (cursor <= hasta) {
    [1, 15].forEach((dia) => {
      const f = new Date(cursor.getFullYear(), cursor.getMonth(), dia);
      if (f >= desde && f <= hasta) fechas.push(f);
    });
    const ultimo = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    if (ultimo >= desde && ultimo <= hasta) fechas.push(ultimo);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return fechas.sort((a, b) => a - b);
}

function generarFechasMensual(desde, hasta, diaReferencia) {
  const fechas = [];
  const dia = diaReferencia || desde.getDate() || 1;
  const cursor = new Date(desde.getFullYear(), desde.getMonth(), 1);
  while (cursor <= hasta) {
    const ultimoDia = new Date(
      cursor.getFullYear(),
      cursor.getMonth() + 1,
      0
    ).getDate();
    const f = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      Math.min(dia, ultimoDia)
    );
    if (f >= desde && f <= hasta) fechas.push(f);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return fechas;
}

function generarFechasPorRegla(regla, opciones = {}) {
  const meses = opciones.mesesProyeccion || 3;
  const desde = opciones.fechaDesde
    ? new Date(opciones.fechaDesde)
    : new Date();
  desde.setHours(0, 0, 0, 0);
  const hasta = opciones.fechaHasta
    ? new Date(opciones.fechaHasta)
    : agregarMeses(desde, meses);
  hasta.setHours(23, 59, 59, 999);

  const frecuencia = normalizarTexto(regla.frecuencia);
  let fechas = [];

  if (frecuencia === "semanal") {
    fechas = generarFechasSemanal(desde, hasta, regla.parametro);
  } else if (frecuencia === "dominical") {
    fechas = generarFechasDominical(desde, hasta);
  } else if (frecuencia === "quincenal") {
    fechas = generarFechasQuincenal(desde, hasta);
  } else if (frecuencia === "mensual") {
    fechas = generarFechasMensual(desde, hasta, opciones.diaMensual);
  }

  return fechas;
}

function agruparProyeccionPorMes(fechas, monto, etiquetaFila) {
  const mapa = new Map();
  fechas.forEach((fecha) => {
    const clave = `${fecha.getFullYear()}-${fecha.getMonth()}`;
    if (!mapa.has(clave)) {
      mapa.set(clave, {
        mes: MESES_NOMBRE[fecha.getMonth()],
        anio: fecha.getFullYear(),
        ocurrencias: [],
      });
    }
    mapa.get(clave).ocurrencias.push({
      fecha,
      etiqueta: etiquetaFechaCorta(fecha),
      monto,
    });
  });
  return {
    etiquetaFila: etiquetaFila || "Nómina",
    meses: Array.from(mapa.values()).sort(
      (a, b) =>
        a.anio - b.anio || MESES_NOMBRE.indexOf(a.mes) - MESES_NOMBRE.indexOf(b.mes)
    ),
  };
}

function construirProyeccion(regla, opciones = {}) {
  const monto = Number(regla.monto) || 0;
  const fechas = generarFechasPorRegla(regla, opciones);
  const etiqueta =
    regla.transaccionNomina ||
    `Nómina ${regla.frecuencia || ""}`.trim();
  return agruparProyeccionPorMes(fechas, monto, etiqueta);
}

function construirProyeccionConEventos(regla, opciones = {}) {
  const monto = Number(regla.monto) || 0;
  const esVariable =
    !!regla.montoVariable ||
    normalizarTexto(regla.frecuencia) === "dominical";
  const fechas = generarFechasPorRegla(regla, opciones);
  const totalCuotas = fechas.length;
  const centroCosto =
    (regla.centroCosto || "").trim() ||
    (regla.nombreBeneficiario || "").trim() ||
    "";
  const eventos = fechas.map((fecha, index) => ({
    fechaProgramada: fecha,
    fechaMin: fecha,
    fechaMax: fecha,
    monto: esVariable ? 0 : monto,
    numeroCuota: index + 1,
    totalCuotas,
    centroCosto,
    transaccionNomina: regla.transaccionNomina,
    estado: "Pendiente",
  }));
  const etiqueta =
    regla.transaccionNomina ||
    `Nómina ${regla.frecuencia || ""}`.trim();
  const proyeccionBase = agruparProyeccionPorMes(
    fechas,
    esVariable ? 0 : monto,
    etiqueta
  );
  return {
    ...proyeccionBase,
    tipoRegla: "A",
    eventos,
  };
}

module.exports = {
  construirProyeccion,
  construirProyeccionConEventos,
  generarFechasPorRegla,
  etiquetaFechaCorta,
};
