const MESES = [
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

function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function extraerDiaDelMes(parametro, diaDelMes) {
  if (diaDelMes && diaDelMes >= 1 && diaDelMes <= 31) return diaDelMes;
  const texto = (parametro || "").toString();
  const match = texto.match(/dia\s*(\d{1,2})/i);
  if (match) return Math.min(31, Math.max(1, parseInt(match[1], 10)));
  return 1;
}

function fechaConDiaMes(anio, mes, dia) {
  const ultimo = new Date(anio, mes + 1, 0).getDate();
  return new Date(anio, mes, Math.min(dia, ultimo));
}

function agregarMeses(fecha, n) {
  const d = new Date(fecha);
  d.setMonth(d.getMonth() + n);
  return d;
}

function esReglaAmortizacion(regla) {
  return (
    regla.frecuencia === "Anual" ||
    regla.vigenciaRegla === "Unica vez" ||
    regla.modalidadMonto === "Finito" ||
    (regla.tablaAmortizacion && regla.tablaAmortizacion.length > 0)
  );
}

function diaSemanaDesdeParametro(parametro) {
  const texto = (parametro || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^los\s+/, "");
  const mapa = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
  };
  if (mapa[texto] !== undefined) return mapa[texto];
  for (const [clave, valor] of Object.entries(mapa)) {
    if (texto.includes(clave)) return valor;
  }
  return null;
}

function siguienteDiaSemana(fecha, diaSemana) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  const diff = (diaSemana - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
}

/** Genera la fecha de cada cuota según frecuencia, partiendo de la fecha de inicio. */
function fechaCuotaAmortizacion(inicio, indice, frecuencia) {
  const base = new Date(inicio);
  base.setHours(0, 0, 0, 0);
  const f = (frecuencia || "Mensual").toLowerCase();

  if (f === "diario") {
    const d = new Date(base);
    d.setDate(base.getDate() + indice);
    return d;
  }
  if (f === "semanal") {
    const d = new Date(base);
    d.setDate(base.getDate() + indice * 7);
    return d;
  }
  if (f === "quincenal") {
    const d = new Date(base);
    d.setDate(base.getDate() + indice * 15);
    return d;
  }
  if (f === "anual") {
    return fechaConDiaMes(
      base.getFullYear() + indice,
      base.getMonth(),
      base.getDate()
    );
  }
  // Mensual, Unica u otras: mismo día del mes, mes a mes
  return fechaConDiaMes(
    base.getFullYear(),
    base.getMonth() + indice,
    base.getDate()
  );
}

function montoTotalRegla(regla) {
  if (regla.montoTotalDeuda && regla.montoTotalDeuda > 0) {
    return Number(regla.montoTotalDeuda);
  }
  if (regla.modalidadMonto === "Finito" && regla.monto > 0) {
    return Number(regla.monto);
  }
  return 0;
}

function generarTablaAmortizacion(regla, opciones = {}) {
  const cuotas = Math.max(1, Number(regla.cuotas) || 1);
  const montoTotal = montoTotalRegla(regla);
  const existente = regla.tablaAmortizacion || [];

  if (
    existente.length === cuotas &&
    existente.every((f) => (f.fechaMin || f.fechaMax) && f.monto >= 0) &&
    !opciones.forzarRegenerar
  ) {
    return existente.map((f, i) => {
      const fecha = new Date(f.fechaMin || f.fechaMax);
      fecha.setHours(0, 0, 0, 0);
      return {
        numeroCuota: f.numeroCuota || i + 1,
        fechaMin: new Date(fecha),
        fechaMax: new Date(fecha),
        monto: redondear2(f.monto),
      };
    });
  }

  const base = regla.fechaReferenciaAnual
    ? new Date(regla.fechaReferenciaAnual)
    : new Date();
  base.setHours(0, 0, 0, 0);

  const montoBase = cuotas > 0 ? redondear2(montoTotal / cuotas) : 0;
  const filas = [];

  for (let i = 0; i < cuotas; i++) {
    const fechaPago = fechaCuotaAmortizacion(base, i, regla.frecuencia);
    let monto = montoBase;
    if (i === cuotas - 1) {
      monto = redondear2(montoTotal - montoBase * (cuotas - 1));
    }
    filas.push({
      numeroCuota: i + 1,
      fechaMin: fechaPago,
      fechaMax: fechaPago,
      monto,
    });
  }
  return filas;
}

function validarTablaAmortizacion(tabla, montoTotal) {
  if (!tabla || !tabla.length) {
    return { ok: false, mensaje: "La tabla de amortización está vacía" };
  }
  for (const fila of tabla) {
    if (!fila.fechaMin && !fila.fechaMax) {
      return {
        ok: false,
        mensaje: `Cuota ${fila.numeroCuota}: indique la fecha de pago`,
      };
    }
  }
  const suma = redondear2(
    tabla.reduce((s, f) => s + (Number(f.monto) || 0), 0)
  );
  const total = redondear2(montoTotal);
  if (suma > total + 0.01) {
    return {
      ok: false,
      mensaje: `La suma de cuotas ($${suma}) supera el monto total ($${total})`,
    };
  }
  return { ok: true, suma, pendiente: redondear2(total - suma) };
}

function calcularMontoCuota(regla) {
  if (esReglaAmortizacion(regla)) {
    const tabla = generarTablaAmortizacion(regla);
    if (tabla.length) return tabla[0].monto;
  }
  const cuota = Number(regla.cuotaEvento) || 0;
  if (regla.modalidadMonto === "Finito" && regla.montoTotalDeuda && regla.cuotas) {
    const porCuota = regla.montoTotalDeuda / regla.cuotas;
    return cuota > 0 ? cuota : redondear2(porCuota);
  }
  return cuota;
}

function cantidadCuotasAGenerar(regla, opciones = {}) {
  const maxGen = opciones.mesesProyeccion || 12;
  if (esReglaAmortizacion(regla)) {
    return Math.max(1, Number(regla.cuotas) || 1);
  }
  if (regla.modalidadMonto === "Finito") {
    return Math.max(1, Number(regla.cuotas) || 1);
  }
  if (regla.vigenciaRegla === "Indefinido") {
    return maxGen;
  }
  return Math.max(1, Number(regla.cuotas) || 1);
}

function generarFechasTipoB(regla, opciones = {}) {
  if (esReglaAmortizacion(regla)) {
    const tabla = generarTablaAmortizacion(regla, opciones);
    return tabla.map((f) => f.fechaMax);
  }

  const fechas = [];
  const dia = extraerDiaDelMes(regla.parametro, regla.diaDelMes);
  const inicio = opciones.fechaInicio
    ? new Date(opciones.fechaInicio)
    : regla.fechaReferenciaAnual
    ? new Date(regla.fechaReferenciaAnual)
    : new Date();
  inicio.setHours(0, 0, 0, 0);
  const total = cantidadCuotasAGenerar(regla, opciones);
  const frecuencia = (regla.frecuencia || "Mensual").toLowerCase();

  if (frecuencia === "unica") {
    fechas.push(new Date(inicio));
    return fechas;
  }

  if (frecuencia === "anual") {
    fechas.push(new Date(inicio));
    return fechas;
  }

  if (frecuencia === "semanal") {
    const diaSemana = diaSemanaDesdeParametro(regla.parametro);
    let primera = new Date(inicio);
    if (diaSemana != null) {
      primera = siguienteDiaSemana(inicio, diaSemana);
    }
    for (let i = 0; i < total; i++) {
      const f = new Date(primera);
      f.setDate(primera.getDate() + i * 7);
      fechas.push(f);
    }
    return fechas;
  }

  if (frecuencia === "diario") {
    for (let i = 0; i < total; i++) {
      const f = new Date(inicio);
      f.setDate(inicio.getDate() + i);
      fechas.push(f);
    }
    return fechas;
  }

  let cursor = new Date(inicio.getFullYear(), inicio.getMonth(), dia);
  if (cursor < inicio) {
    cursor = agregarMeses(cursor, 1);
  }

  for (let i = 0; i < total; i++) {
    if (frecuencia === "mensual") {
      const f = new Date(cursor.getFullYear(), cursor.getMonth() + i, 1);
      fechas.push(fechaConDiaMes(f.getFullYear(), f.getMonth(), dia));
    } else if (frecuencia === "quincenal") {
      const base = agregarMeses(cursor, Math.floor(i / 2));
      const quincena = i % 2 === 0 ? 1 : 15;
      fechas.push(
        fechaConDiaMes(base.getFullYear(), base.getMonth(), quincena)
      );
    } else {
      const f = new Date(cursor.getFullYear(), cursor.getMonth() + i, 1);
      fechas.push(fechaConDiaMes(f.getFullYear(), f.getMonth(), dia));
    }
  }
  return fechas;
}

function construirProyeccionTipoB(regla, opciones = {}) {
  const totalCuotas = cantidadCuotasAGenerar(regla, opciones);
  let eventos = [];

  if (esReglaAmortizacion(regla)) {
    const tabla = generarTablaAmortizacion(regla, opciones);
    eventos = tabla.map((fila) => ({
      fechaProgramada: fila.fechaMax,
      fechaMin: fila.fechaMin,
      fechaMax: fila.fechaMax,
      monto: fila.monto,
      numeroCuota: fila.numeroCuota,
      totalCuotas,
      centroCosto: regla.centroCosto,
      transaccionNomina: regla.transaccionNomina,
      estado: "Pendiente",
    }));
  } else {
    const fechas = generarFechasTipoB(regla, opciones);
    const montoCuota = calcularMontoCuota(regla);
    eventos = fechas.map((fecha, index) => ({
      fechaProgramada: fecha,
      monto: montoCuota,
      numeroCuota: index + 1,
      totalCuotas,
      centroCosto: regla.centroCosto,
      transaccionNomina: regla.transaccionNomina,
      estado: "Pendiente",
    }));
  }

  const mapa = new Map();
  eventos.forEach((ev) => {
    const fecha = new Date(ev.fechaProgramada);
    const clave = `${fecha.getFullYear()}-${fecha.getMonth()}`;
    if (!mapa.has(clave)) {
      mapa.set(clave, {
        mes: MESES[fecha.getMonth()],
        anio: fecha.getFullYear(),
        ocurrencias: [],
      });
    }
    const dia = fecha.getDate();
    const mesCorto = MESES[fecha.getMonth()].substring(0, 3).toLowerCase();
    mapa.get(clave).ocurrencias.push({
      fecha,
      etiqueta: `${dia}-${mesCorto}`,
      monto: ev.monto,
      estado: "Pendiente",
      numeroCuota: ev.numeroCuota,
      totalCuotas,
    });
  });

  const montoCuota = eventos.length ? eventos[0].monto : calcularMontoCuota(regla);

  return {
    etiquetaFila: regla.transaccionNomina || "Pago programado",
    tipoRegla: "B",
    centroCosto: regla.centroCosto,
    modalidadMonto: regla.modalidadMonto,
    cuotaEvento: montoCuota,
    montoTotalDeuda: montoTotalRegla(regla),
    tablaAmortizacion: esReglaAmortizacion(regla)
      ? generarTablaAmortizacion(regla, opciones)
      : [],
    meses: Array.from(mapa.values()),
    eventos,
  };
}

module.exports = {
  construirProyeccionTipoB,
  generarFechasTipoB,
  generarTablaAmortizacion,
  validarTablaAmortizacion,
  esReglaAmortizacion,
  calcularMontoCuota,
  cantidadCuotasAGenerar,
  montoTotalRegla,
};
