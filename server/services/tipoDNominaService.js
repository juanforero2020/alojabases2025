const ReglaPagoNomina = require("../models/reglaPagoNomina");
const EventoPagoProgramado = require("../models/eventoPagoProgramado");
const EventoCobroPrestamo = require("../models/eventoCobroPrestamo");
const { fechaCuotaAmortizacion } = require("../utils/proyeccionPagosTipoB");
const {
  TRANSACCION_PRESTAMO,
  calcularMontosPrestamo,
  fuentesSeleccionadas,
  listarReglasPagoAsociablesPrestamo,
  recalcularPrestamosBeneficiario,
  quitarDescuentosPrestamo,
  construirProyeccionTipoD,
  generarTablaPrestamoPrevia,
  omitirDescuentoPrestamoEvento,
} = require("../utils/proyeccionPagosTipoD");

function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function idStr(valor) {
  if (!valor) return "";
  if (typeof valor === "object" && valor._id) return String(valor._id);
  return String(valor);
}

function normalizarFuentes(fuentes = []) {
  return (fuentes || [])
    .filter((f) => f && f.reglaPagoId)
    .map((f) => ({
      reglaPagoId: f.reglaPagoId,
      transaccionNomina: (f.transaccionNomina || "").toString().trim(),
      frecuencia: f.frecuencia || "",
      parametro: f.parametro || "",
      tipoRegla: f.tipoRegla || "A",
      montoVariable: !!f.montoVariable,
      montoPago: redondear2(f.montoPago || 0),
      monto: redondear2(f.monto || 0),
      seleccionado: f.seleccionado === true || redondear2(f.monto) > 0,
    }));
}

function fechaCalendario(valor) {
  if (!valor) return null;
  if (typeof valor === "string") {
    const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
  }
  const d = new Date(valor);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function normalizarReglaTipoD(regla) {
  const doc =
    regla && typeof regla.toObject === "function" ? regla.toObject() : { ...regla };
  const montos = calcularMontosPrestamo(
    doc.montoPrestado || doc.montoTotalDeuda || doc.monto,
    doc.porcentajeInteres
  );
  doc.tipoRegla = "D";
  doc.esDescuento = true;
  doc.transaccionNomina = TRANSACCION_PRESTAMO;
  doc.fuente = "Manual";
  doc.frecuencia = "Unica";
  doc.parametro = doc.parametro || "Prestamo";
  doc.vigenciaRegla = "Numero de cuotas";
  doc.modalidadMonto = "Finito";
  doc.montoPrestado = montos.montoPrestado;
  doc.porcentajeInteres = montos.porcentajeInteres;
  doc.montoInteres = montos.montoInteres;
  doc.montoTotalDeuda = montos.montoTotal;
  doc.monto = montos.montoTotal;
  const fechaDesembolso = fechaCalendario(
    doc.fechaDesembolso || doc.fechaInicioPagos
  );
  doc.fechaDesembolso = fechaDesembolso;
  doc.fechaInicioPagos = fechaDesembolso;
  const fechaInicioCobros = fechaCalendario(
    doc.fechaInicioCobros || doc.fechaDesembolso
  );
  doc.fechaInicioCobros = fechaInicioCobros;
  doc.frecuenciaCobro = doc.frecuenciaCobro || "Mensual";
  doc.fuentesDescuentoPrestamo = normalizarFuentes(
    doc.fuentesDescuentoPrestamo
  );
  const fuentes = fuentesSeleccionadas(doc);
  const tablaCobros = Array.isArray(doc.tablaAmortizacion)
    ? doc.tablaAmortizacion
    : [];
  if (esPrestamoExterno(doc)) {
    doc.cuotas = Math.max(1, Number(doc.cuotas) || tablaCobros.length || 1);
    doc.cuotaEvento = redondear2(
      tablaCobros.reduce((s, f) => s + (Number(f.monto) || 0), 0) ||
        montos.montoTotal / doc.cuotas
    );
  } else {
    doc.cuotaEvento = redondear2(
      fuentes.reduce((s, f) => s + (Number(f.monto) || 0), 0)
    );
    doc.cuotas = Math.max(1, fuentes.length);
  }
  if (doc.saldoPendientePrestamo == null) {
    doc.saldoPendientePrestamo = montos.montoTotal;
  }
  return doc;
}

function esPrestamoExterno(regla) {
  return (regla.tipoBeneficiario || "").toString().trim().toLowerCase() === "externo";
}

function generarTablaCobrosExternos(regla) {
  const montos = calcularMontosPrestamo(
    regla.montoPrestado,
    regla.porcentajeInteres
  );
  const total = montos.montoTotal;
  const cuotas = Math.max(1, Number(regla.cuotas) || 1);
  const inicio =
    fechaCalendario(regla.fechaInicioCobros || regla.fechaDesembolso) ||
    new Date();
  const frecuencia = regla.frecuenciaCobro || "Mensual";
  const cuotaBase = redondear2(total / cuotas);
  const tabla = [];
  let acumulado = 0;
  for (let i = 0; i < cuotas; i++) {
    const fecha = fechaCuotaAmortizacion(inicio, i, frecuencia);
    const monto =
      i === cuotas - 1 ? redondear2(total - acumulado) : cuotaBase;
    acumulado = redondear2(acumulado + monto);
    tabla.push({
      numeroCuota: i + 1,
      fechaMin: fecha,
      fechaMax: fecha,
      monto,
      transaccionNomina: TRANSACCION_PRESTAMO,
      saldoDespues: redondear2(Math.max(0, total - acumulado)),
    });
  }
  return {
    tabla,
    total,
    cuotaEvento: cuotaBase,
    montoPrestado: montos.montoPrestado,
    montoInteres: montos.montoInteres,
    porcentajeInteres: montos.porcentajeInteres,
    saldoPendiente: 0,
    validacionDescuento: { ok: true },
  };
}

function validarTablaCobrosExternos(regla) {
  const montos = calcularMontosPrestamo(
    regla.montoPrestado,
    regla.porcentajeInteres
  );
  const tabla = regla.tablaAmortizacion || [];
  if (!tabla.length) {
    return "Genere las fechas de cobro que cubran el valor del préstamo";
  }
  if (!fechaCalendario(regla.fechaInicioCobros || tabla[0].fechaMin)) {
    return "Indique la fecha del primer cobro";
  }
  let suma = 0;
  for (const fila of tabla) {
    const monto = redondear2(fila.monto);
    if (!(monto > 0.009)) {
      return "Cada cuota de cobro debe ser mayor a cero";
    }
    if (!fechaCalendario(fila.fechaMin || fila.fechaMax)) {
      return "Cada cuota de cobro debe tener fecha";
    }
    suma = redondear2(suma + monto);
  }
  if (Math.abs(suma - montos.montoTotal) > 0.05) {
    return `La suma de cobros ($${suma.toFixed(
      2
    )}) debe cubrir el préstamo ($${montos.montoTotal.toFixed(2)})`;
  }
  return null;
}

function validarReglaTipoD(regla) {
  if (!(regla.centroCosto || "").trim()) {
    return "Seleccione el centro de costo";
  }
  if (!(regla.cedulaBeneficiario || "").trim()) {
    return "Indique el beneficiario del préstamo";
  }
  const montos = calcularMontosPrestamo(
    regla.montoPrestado,
    regla.porcentajeInteres
  );
  if (!(montos.montoPrestado > 0)) {
    return "El valor prestado debe ser mayor a cero";
  }
  if (montos.porcentajeInteres < 0) {
    return "El interés no puede ser negativo";
  }
  if (!fechaCalendario(regla.fechaDesembolso || regla.fechaInicioPagos)) {
    return "Indique la fecha de desembolso del préstamo";
  }
  if (esPrestamoExterno(regla)) {
    return validarTablaCobrosExternos(regla);
  }
  const fuentes = fuentesSeleccionadas(regla);
  if (!fuentes.length) {
    return "Seleccione al menos un tipo de pago programado y coloque la cuota referencial a descontar";
  }
  for (const fuente of fuentes) {
    if (!(redondear2(fuente.monto) > 0)) {
      return `Indique la cuota referencial para ${fuente.transaccionNomina || "el pago seleccionado"}`;
    }
    const bruto = redondear2(fuente.montoPago || 0);
    if (!fuente.montoVariable && bruto > 0 && fuente.monto > bruto + 0.009) {
      return `La cuota de ${fuente.transaccionNomina || "pago"} ($${fuente.monto.toFixed(
        2
      )}) no puede superar el pago ($${bruto.toFixed(2)})`;
    }
  }
  return null;
}

async function validarFuentesPrestamo(regla) {
  const fuentes = fuentesSeleccionadas(regla);
  for (const fuente of fuentes) {
    const asociada = await ReglaPagoNomina.findById(fuente.reglaPagoId);
    if (!asociada) {
      return `La regla de pago ${fuente.transaccionNomina || fuente.reglaPagoId} ya no existe`;
    }
    if (asociada.estadoRegla !== "Autorizada") {
      return `La regla ${asociada.transaccionNomina} debe estar autorizada para descontar el préstamo`;
    }
    if (asociada.cedulaBeneficiario !== regla.cedulaBeneficiario) {
      return "Las reglas de pago deben pertenecer al mismo beneficiario";
    }
    if (!["A", "B"].includes(asociada.tipoRegla)) {
      return "Solo se puede descontar el préstamo de pagos tipo A o B";
    }
    fuente.transaccionNomina =
      fuente.transaccionNomina || asociada.transaccionNomina;
    fuente.frecuencia = fuente.frecuencia || asociada.frecuencia;
    fuente.parametro = fuente.parametro || asociada.parametro;
    fuente.tipoRegla = asociada.tipoRegla;
    fuente.montoVariable = !!asociada.montoVariable;
    fuente.montoPago = redondear2(asociada.monto || fuente.montoPago || 0);
    if (
      !fuente.montoVariable &&
      fuente.montoPago > 0 &&
      fuente.monto > fuente.montoPago + 0.009
    ) {
      return `La cuota de ${fuente.transaccionNomina} ($${fuente.monto.toFixed(
        2
      )}) no puede superar el pago ($${fuente.montoPago.toFixed(2)})`;
    }
  }
  return null;
}

async function validarReglaTipoDCompleta(regla) {
  const msgBase = validarReglaTipoD(regla);
  if (msgBase) return msgBase;
  if (esPrestamoExterno(regla)) return null;
  return validarFuentesPrestamo(regla);
}

async function crearEventosCobroPrestamo(regla, tabla) {
  await EventoCobroPrestamo.deleteMany({
    reglaPagoId: regla._id,
    estado: { $in: ["Pendiente", "Parcial"] },
  });
  const filas = (tabla || []).filter((f) => redondear2(f.monto) > 0.009);
  const creados = [];
  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i];
    const fecha = fechaCalendario(
      fila.fechaMin || fila.fechaMax || fila.fechaProgramada
    );
    const cobro = new EventoCobroPrestamo({
      reglaPagoId: regla._id,
      numeroCuota: fila.numeroCuota || i + 1,
      totalCuotas: filas.length,
      fechaProgramada: fecha,
      fechaMin: fecha,
      fechaMax: fecha,
      monto: redondear2(fila.monto),
      montoPagado: 0,
      centroCosto: regla.centroCosto,
      transaccionNomina: TRANSACCION_PRESTAMO,
      tipoBeneficiario: regla.tipoBeneficiario,
      cedulaBeneficiario: regla.cedulaBeneficiario,
      nombreBeneficiario: regla.nombreBeneficiario,
      estado: "Pendiente",
    });
    await cobro.save();
    creados.push(cobro);
  }
  return creados;
}

async function generarTablaPrestamoPreviaUnificada(regla) {
  const reglaObj = normalizarReglaTipoD(regla);
  if (esPrestamoExterno(reglaObj)) {
    return generarTablaCobrosExternos(reglaObj);
  }
  return generarTablaPrestamoPrevia(reglaObj);
}

async function quitarDescuentosPrestamoCompleto(reglaD) {
  if (reglaD?._id) {
    await EventoCobroPrestamo.deleteMany({
      reglaPagoId: reglaD._id,
      estado: { $in: ["Pendiente", "Parcial"] },
    });
  }
  return quitarDescuentosPrestamo(reglaD);
}

async function generarEventosProgramados(regla, opciones = {}) {
  const reglaObj = normalizarReglaTipoD(regla);
  const msg = await validarReglaTipoDCompleta(reglaObj);
  if (msg) throw new Error(msg);

  reglaObj.saldoPendientePrestamo = reglaObj.montoTotalDeuda;
  const ids = fuentesSeleccionadas(reglaObj).map((f) => f.reglaPagoId);
  const reglasAsociadas = ids.length
    ? await ReglaPagoNomina.find({ _id: { $in: ids } }).lean()
    : [];

  await EventoPagoProgramado.deleteMany({
    reglaPagoId: regla._id,
    estado: { $in: ["Pendiente", "Parcial"] },
  });

  const fecha = fechaCalendario(
    reglaObj.fechaDesembolso || reglaObj.fechaInicioPagos
  );
  const notas = [
    String(reglaObj.notas || "").trim(),
    `Desembolso préstamo capital $${reglaObj.montoPrestado.toFixed(2)}`,
    esPrestamoExterno(reglaObj)
      ? "Subcuenta 2.2.1 Externos"
      : "Subcuenta 2.1.0 Internos",
  ]
    .filter(Boolean)
    .join(" | ");

  const eventoDesembolso = new EventoPagoProgramado({
    reglaPagoId: regla._id,
    tipoRegla: "D",
    numeroCuota: 1,
    totalCuotas: 1,
    fechaProgramada: fecha,
    fechaMin: fecha,
    fechaMax: fecha,
    monto: reglaObj.montoPrestado,
    montoPagado: 0,
    centroCosto: reglaObj.centroCosto,
    transaccionNomina: TRANSACCION_PRESTAMO,
    cedulaBeneficiario: reglaObj.cedulaBeneficiario,
    nombreBeneficiario: reglaObj.nombreBeneficiario,
    modalidadMonto: "Finito",
    estado: "Pendiente",
    notas,
  });
  await eventoDesembolso.save();

  let eventosCobro = [];
  if (esPrestamoExterno(reglaObj)) {
    let tablaCobros = reglaObj.tablaAmortizacion || [];
    if (!tablaCobros.length) {
      tablaCobros = generarTablaCobrosExternos(reglaObj).tabla;
    }
    reglaObj.tablaAmortizacion = tablaCobros;
    regla.tablaAmortizacion = tablaCobros;
    regla.fechaInicioCobros = reglaObj.fechaInicioCobros;
    regla.frecuenciaCobro = reglaObj.frecuenciaCobro;
    regla.cuotas = reglaObj.cuotas;
    eventosCobro = await crearEventosCobroPrestamo(regla, tablaCobros);
  }

  const actualizados = esPrestamoExterno(reglaObj)
    ? 0
    : await recalcularPrestamosBeneficiario(reglaObj.cedulaBeneficiario);
  const previa = await generarTablaPrestamoPreviaUnificada(reglaObj);
  const proyeccion = construirProyeccionTipoD(reglaObj, {
    ...opciones,
    reglasAsociadas,
  });

  return {
    proyeccion,
    eventos: [eventoDesembolso],
    eventosCobro,
    eventosActualizados: actualizados,
    cuotaDescuento: reglaObj.cuotaEvento,
    tabla: previa.tabla,
  };
}

module.exports = {
  TRANSACCION_PRESTAMO,
  normalizarReglaTipoD,
  validarReglaTipoD,
  validarReglaTipoDCompleta,
  listarReglasPagoAsociablesPrestamo,
  generarEventosProgramados,
  quitarDescuentosPrestamo: quitarDescuentosPrestamoCompleto,
  construirProyeccionTipoD,
  generarTablaPrestamoPrevia: generarTablaPrestamoPreviaUnificada,
  omitirDescuentoPrestamoEvento,
};
