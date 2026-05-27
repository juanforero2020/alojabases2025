const ReglaPagoNomina = require("../models/reglaPagoNomina");
const EventoPagoProgramado = require("../models/eventoPagoProgramado");
const TransaccionFinanciera = require("../models/transaccionFinanciera");
const {
  construirProyeccionTipoB,
  calcularMontoCuota,
  generarTablaAmortizacion,
  validarTablaAmortizacion,
  esReglaAmortizacion,
  montoTotalRegla,
} = require("../utils/proyeccionPagosTipoB");

const SUB_CUENTA_PAGO = "1.5.4 Pagos extras";
const TIPO_TRANSACCION = "PAGO_NOMINA_TIPO_B";

function normalizarReglaTipoB(regla) {
  const doc =
    regla && typeof regla.toObject === "function" ? regla.toObject() : { ...regla };
  doc.tipoRegla = "B";
  doc.fuente = "Manual";

  if (esReglaAmortizacion(doc)) {
    doc.modalidadMonto = "Finito";
    if (!doc.montoTotalDeuda && doc.monto) {
      doc.montoTotalDeuda = doc.monto;
    }
    doc.tablaAmortizacion = generarTablaAmortizacion(doc);
    doc.cuotaEvento = doc.tablaAmortizacion.length
      ? doc.tablaAmortizacion[0].monto
      : calcularMontoCuota(doc);
    doc.monto = doc.cuotaEvento;
  } else {
    doc.monto = calcularMontoCuota(doc);
    if (!doc.cuotaEvento) doc.cuotaEvento = doc.monto;
  }
  return doc;
}

function validarReglaTipoB(regla) {
  if (!(regla.centroCosto || "").trim()) {
    return "El centro de costo es obligatorio para reglas tipo B";
  }

  if (regla.frecuencia === "Anual" && !regla.fechaReferenciaAnual) {
    return "Indique la fecha de referencia anual (inicio del periodo de pago)";
  }

  if (esReglaAmortizacion(regla)) {
    const total = montoTotalRegla(regla);
    if (!total || total <= 0) {
      return "Indique el monto total a pagar";
    }
    if (!regla.cuotas || regla.cuotas < 1) {
      return "Indique el número de cuotas";
    }
    const tabla = generarTablaAmortizacion(regla);
    const val = validarTablaAmortizacion(tabla, total);
    if (!val.ok) return val.mensaje;
    return null;
  }

  const cuota = calcularMontoCuota(regla);
  if (!cuota || cuota <= 0) {
    return "La cuota por evento debe ser mayor a cero";
  }
  if (regla.modalidadMonto === "Finito") {
    if (!regla.cuotas || regla.cuotas < 1) {
      return "Indique el número de cuotas de la deuda";
    }
    if (!regla.montoTotalDeuda || regla.montoTotalDeuda <= 0) {
      return "Indique el monto total de la deuda";
    }
  }
  return null;
}

async function generarEventosProgramados(regla, opciones = {}) {
  const reglaObj = normalizarReglaTipoB(regla);
  const msg = validarReglaTipoB(reglaObj);
  if (msg) throw new Error(msg);

  await EventoPagoProgramado.deleteMany({
    reglaPagoId: regla._id,
    estado: { $in: ["Pendiente", "Parcial"] },
  });

  const proyeccion = construirProyeccionTipoB(reglaObj, opciones);
  const creados = [];

  for (const ev of proyeccion.eventos) {
    const doc = new EventoPagoProgramado({
      reglaPagoId: regla._id,
      tipoRegla: "B",
      numeroCuota: ev.numeroCuota,
      totalCuotas: ev.totalCuotas,
      fechaProgramada: ev.fechaProgramada,
      fechaMin: ev.fechaMin || ev.fechaProgramada,
      fechaMax: ev.fechaMax || ev.fechaProgramada,
      monto: ev.monto,
      montoPagado: 0,
      centroCosto: reglaObj.centroCosto,
      transaccionNomina: reglaObj.transaccionNomina,
      cedulaBeneficiario: reglaObj.cedulaBeneficiario,
      nombreBeneficiario: reglaObj.nombreBeneficiario,
      modalidadMonto: reglaObj.modalidadMonto,
      estado: "Pendiente",
    });
    await doc.save();
    creados.push(doc);
  }

  if (reglaObj.tablaAmortizacion?.length) {
    regla.tablaAmortizacion = reglaObj.tablaAmortizacion;
  }

  return { proyeccion, eventos: creados };
}

async function ejecutarEventoProgramado(eventoId, opciones = {}) {
  const evento = await EventoPagoProgramado.findById(eventoId);
  if (!evento) throw new Error("Evento programado no encontrado");
  if (evento.estado === "Ejecutado") {
    throw new Error("Esta cuota ya fue pagada en su totalidad");
  }
  if (evento.estado === "Cancelado") {
    throw new Error("Este evento está cancelado");
  }

  const regla = await ReglaPagoNomina.findById(evento.reglaPagoId);
  if (!regla || regla.estadoRegla !== "Autorizada") {
    throw new Error("La regla de pago no está activa");
  }

  const montoPendiente = redondear2(
    (Number(evento.monto) || 0) - (Number(evento.montoPagado) || 0)
  );
  let montoPagar = opciones.monto != null ? Number(opciones.monto) : montoPendiente;
  montoPagar = redondear2(montoPagar);

  if (!montoPagar || montoPagar <= 0) {
    throw new Error("Indique un monto mayor a cero");
  }
  if (montoPagar > montoPendiente + 0.01) {
    throw new Error(
      `El monto ($${montoPagar}) supera el saldo pendiente ($${montoPendiente})`
    );
  }

  const fechaContable = new Date();
  const tx = new TransaccionFinanciera({
    fecha: new Date(),
    fechaContable,
    sucursal: opciones.sucursal || "",
    cliente: evento.nombreBeneficiario,
    beneficiario: evento.nombreBeneficiario,
    cedula: evento.cedulaBeneficiario,
    valor: montoPagar,
    tipoPago: "Egreso",
    subCuenta: SUB_CUENTA_PAGO,
    tipoTransaccion: TIPO_TRANSACCION,
    centroCosto: evento.centroCosto,
    notas:
      opciones.notas ||
      `${evento.transaccionNomina || "Pago programado"} — cuota ${evento.numeroCuota}/${evento.totalCuotas}${montoPagar < montoPendiente ? " (pago parcial)" : ""}. Centro costo: ${evento.centroCosto || ""}.`,
    isContabilizada: false,
  });
  await tx.save();

  evento.pagosParciales = evento.pagosParciales || [];
  evento.pagosParciales.push({
    monto: montoPagar,
    fecha: new Date(),
    transaccionFinancieraId: tx._id,
    ejecutadoPor: opciones.usuario || "",
    notas: opciones.notas,
  });

  evento.montoPagado = redondear2((Number(evento.montoPagado) || 0) + montoPagar);
  evento.transaccionFinancieraId = tx._id;
  evento.ejecutadoPor = opciones.usuario || "";
  evento.fechaEjecucion = new Date();

  if (evento.montoPagado >= (Number(evento.monto) || 0) - 0.01) {
    evento.estado = "Ejecutado";
    evento.montoPagado = Number(evento.monto);
  } else {
    evento.estado = "Parcial";
  }
  await evento.save();

  const pendientesRegla = await EventoPagoProgramado.countDocuments({
    reglaPagoId: regla._id,
    estado: { $in: ["Pendiente", "Parcial"] },
  });
  if (
    pendientesRegla === 0 &&
    (regla.modalidadMonto === "Finito" ||
      regla.vigenciaRegla === "Unica vez" ||
      regla.frecuencia === "Anual")
  ) {
    regla.estadoRegla = "Finalizada";
    await regla.save();
  }

  return {
    evento,
    transaccion: tx,
    montoPagado: montoPagar,
    saldoPendiente: redondear2(Number(evento.monto) - evento.montoPagado),
  };
}

function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function reporteEstadoEmpleado(filtros = {}) {
  const query = {};
  if (filtros.cedula) query.cedulaBeneficiario = filtros.cedula.trim();
  if (filtros.centroCosto) query.centroCosto = filtros.centroCosto.trim();

  if (filtros.desde || filtros.hasta) {
    query.$or = [
      { fechaProgramada: {} },
      { fechaEjecucion: {} },
      { "pagosParciales.fecha": {} },
    ];
    if (filtros.desde) {
      const d = new Date(filtros.desde);
      d.setHours(0, 0, 0, 0);
      query.$or[0].fechaProgramada.$gte = d;
      query.$or[1].fechaEjecucion = query.$or[1].fechaEjecucion || {};
      query.$or[1].fechaEjecucion.$gte = d;
    }
    if (filtros.hasta) {
      const h = new Date(filtros.hasta);
      h.setHours(23, 59, 59, 999);
      query.$or[0].fechaProgramada.$lte = h;
      query.$or[1].fechaEjecucion = query.$or[1].fechaEjecucion || {};
      query.$or[1].fechaEjecucion.$lte = h;
    }
  }

  let eventos;
  if (query.$or && !filtros.desde && !filtros.hasta) {
    delete query.$or;
  }
  if (query.$or) {
    const base = { ...query };
    delete base.$or;
    const desde = filtros.desde ? new Date(filtros.desde) : null;
    if (desde) desde.setHours(0, 0, 0, 0);
    const hasta = filtros.hasta ? new Date(filtros.hasta) : null;
    if (hasta) hasta.setHours(23, 59, 59, 999);

    eventos = await EventoPagoProgramado.find({
      ...base,
      $or: [
        desde && hasta
          ? { fechaProgramada: { $gte: desde, $lte: hasta } }
          : desde
          ? { fechaProgramada: { $gte: desde } }
          : { fechaProgramada: { $lte: hasta } },
        desde && hasta
          ? { fechaEjecucion: { $gte: desde, $lte: hasta } }
          : desde
          ? { fechaEjecucion: { $gte: desde } }
          : { fechaEjecucion: { $lte: hasta } },
      ].filter(Boolean),
    })
      .populate("reglaPagoId", "transaccionNomina frecuencia vigenciaRegla estadoRegla")
      .sort({ fechaProgramada: 1 });
  } else {
    eventos = await EventoPagoProgramado.find(query)
      .populate("reglaPagoId", "transaccionNomina frecuencia vigenciaRegla estadoRegla")
      .sort({ fechaProgramada: 1 });
  }

  const resumen = {
    cedula: filtros.cedula || null,
    centroCosto: filtros.centroCosto || null,
    desde: filtros.desde || null,
    hasta: filtros.hasta || null,
    totalProgramado: 0,
    totalPagado: 0,
    totalPendiente: 0,
    porTransaccion: {},
    eventos: [],
  };

  for (const ev of eventos) {
    const doc = ev.toObject();
    const programado = Number(doc.monto) || 0;
    const pagado = Number(doc.montoPagado) || 0;
    const pendiente = redondear2(Math.max(0, programado - pagado));

    resumen.totalProgramado += programado;
    resumen.totalPagado += pagado;
    resumen.totalPendiente += pendiente;

    const clave = doc.transaccionNomina || "Sin transacción";
    if (!resumen.porTransaccion[clave]) {
      resumen.porTransaccion[clave] = {
        transaccionNomina: clave,
        centroCosto: doc.centroCosto,
        programado: 0,
        pagado: 0,
        pendiente: 0,
        cuotas: 0,
      };
    }
    resumen.porTransaccion[clave].programado += programado;
    resumen.porTransaccion[clave].pagado += pagado;
    resumen.porTransaccion[clave].pendiente += pendiente;
    resumen.porTransaccion[clave].cuotas += 1;

    resumen.eventos.push({
      _id: doc._id,
      cedulaBeneficiario: doc.cedulaBeneficiario,
      nombreBeneficiario: doc.nombreBeneficiario,
      centroCosto: doc.centroCosto,
      transaccionNomina: doc.transaccionNomina,
      numeroCuota: doc.numeroCuota,
      totalCuotas: doc.totalCuotas,
      fechaMin: doc.fechaMin,
      fechaMax: doc.fechaMax,
      fechaProgramada: doc.fechaProgramada,
      monto: programado,
      montoPagado: pagado,
      saldoPendiente: pendiente,
      estado: doc.estado,
      pagosParciales: doc.pagosParciales || [],
      regla: doc.reglaPagoId,
    });
  }

  resumen.totalProgramado = redondear2(resumen.totalProgramado);
  resumen.totalPagado = redondear2(resumen.totalPagado);
  resumen.totalPendiente = redondear2(resumen.totalPendiente);
  resumen.porTransaccion = Object.values(resumen.porTransaccion).map((t) => ({
    ...t,
    programado: redondear2(t.programado),
    pagado: redondear2(t.pagado),
    pendiente: redondear2(t.pendiente),
  }));

  return resumen;
}

module.exports = {
  normalizarReglaTipoB,
  validarReglaTipoB,
  generarEventosProgramados,
  ejecutarEventoProgramado,
  reporteEstadoEmpleado,
  SUB_CUENTA_PAGO,
  TIPO_TRANSACCION,
};
