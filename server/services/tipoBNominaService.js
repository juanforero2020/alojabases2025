const ReglaPagoNomina = require("../models/reglaPagoNomina");
const EventoPagoProgramado = require("../models/eventoPagoProgramado");
const TransaccionFinanciera = require("../models/transaccionFinanciera");
const SubCuenta = require("../models/subCuentas");
const Cuenta = require("../models/cuentas");
const dominicalNominaService = require("./dominicalNominaService");
const tipoANominaService = require("./tipoANominaService");
const {
  construirProyeccionTipoB,
  calcularMontoCuota,
  generarTablaAmortizacion,
  validarTablaAmortizacion,
  esReglaAmortizacion,
  montoTotalRegla,
} = require("../utils/proyeccionPagosTipoB");
const {
  montoDescuentoReglaCEnEvento,
  esDescuentosGenerales,
} = require("../utils/proyeccionPagosTipoC");

const {
  MAPA_CUENTA_POR_SUBCUENTA,
  SUBCUENTAS_NOMINA,
  subCuentaPagoNomina,
  subCuentaDescuentoNomina,
} = require("../utils/cuentasContablesNomina");

const SUB_CUENTA_PAGO = SUBCUENTAS_NOMINA.COMPLEMENTARIOS;
const SUB_CUENTA_DESCUENTO = SUBCUENTAS_NOMINA.DESCUENTOS;
const TIPO_TRANSACCION = "PAGO_NOMINA_TIPO_B";
const TIPO_TRANSACCION_A = "PAGO_NOMINA_TIPO_A";
const TIPO_TRANSACCION_DESCUENTO = "DESCUENTO_NOMINA";

function esEventoMontoVariable(evento, regla) {
  return (
    evento.tipoRegla === "A" &&
    (regla?.frecuencia === "Dominical" ||
      regla?.montoVariable ||
      evento.modalidadMonto === "Variable")
  );
}

async function ejecutarEventoDominicalProgramado(evento, regla, opciones = {}) {
  const resultado = await dominicalNominaService.liquidarDominical(
    evento.fechaProgramada,
    {
      cedula: evento.cedulaBeneficiario,
      usuario: opciones.usuario,
      sucursal: opciones.sucursal,
      aplicarAjustes: true,
    }
  );

  const item = (resultado.resultados || []).find(
    (r) => r.cedula === evento.cedulaBeneficiario
  );
  if (!item) {
    throw new Error("No se encontró liquidación dominical para este empleado");
  }
  if (item.error) {
    throw new Error(item.error);
  }
  if (item.yaLiquidado) {
    throw new Error("Este domingo ya fue liquidado para este empleado");
  }

  const montoBruto = Number(item.montoBruto) || 0;
  const montoNeto = Number(item.montoNeto) || 0;

  evento.monto = montoBruto;
  evento.montoPagado = montoNeto;
  evento.estado = "Ejecutado";
  evento.transaccionFinancieraId = item.transaccion?._id;
  evento.ejecutadoPor = opciones.usuario || "";
  evento.fechaEjecucion = new Date();
  if (item.transaccion?._id) {
    evento.pagosParciales = evento.pagosParciales || [];
    evento.pagosParciales.push({
      monto: montoNeto,
      fecha: new Date(),
      transaccionFinancieraId: item.transaccion._id,
      ejecutadoPor: opciones.usuario || "",
      notas: opciones.notas,
    });
  }
  await evento.save();

  return {
    evento,
    transaccion: item.transaccion || null,
    montoPagado: montoNeto,
    saldoPendiente: 0,
  };
}

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
  const transaccion = (regla.transaccionNomina || "").toString().trim();
  if (!transaccion || transaccion.toLowerCase() === "otro") {
    return "Indique la transacción de nómina";
  }

  if (!(regla.centroCosto || "").trim()) {
    return "El centro de costo es obligatorio para reglas tipo B";
  }

  if (regla.frecuencia === "Anual" && !regla.fechaReferenciaAnual && !regla.fechaInicioPagos) {
    return "Indique la fecha de referencia anual (inicio del periodo de pago)";
  }

  if (esReglaAmortizacion(regla) && !regla.fechaReferenciaAnual && !regla.fechaInicioPagos) {
    return "Indique la fecha de inicio de la primera cuota";
  }

  if (
    !esReglaAmortizacion(regla) &&
    !regla.fechaInicioPagos &&
    !regla.fechaReferenciaAnual
  ) {
    return "Indique la fecha desde la que se calcularán los pagos";
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

async function eliminarEventosNoPagadosRegla(reglaId) {
  const resultado = await EventoPagoProgramado.deleteMany({
    reglaPagoId: reglaId,
    estado: { $in: ["Pendiente", "Parcial"] },
  });
  return resultado.deletedCount || 0;
}

async function generarEventosProgramados(regla, opciones = {}) {
  const reglaObj = normalizarReglaTipoB(regla);
  const msg = validarReglaTipoB(reglaObj);
  if (msg) throw new Error(msg);

  await eliminarEventosNoPagadosRegla(regla._id);

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

function claveCalendarioUtc(fecha) {
  const d = new Date(fecha);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function claveHoyCalendarioEcuador() {
  const ecuador = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return Date.UTC(
    ecuador.getUTCFullYear(),
    ecuador.getUTCMonth(),
    ecuador.getUTCDate()
  );
}

function eventoVentanaVencida(evento) {
  const hoy = claveHoyCalendarioEcuador();
  if (evento.fechaMax) {
    return hoy > claveCalendarioUtc(evento.fechaMax);
  }
  if (!evento.fechaMin && evento.fechaProgramada) {
    return hoy > claveCalendarioUtc(evento.fechaProgramada);
  }
  return false;
}

function formatoFechaCalendario(fecha) {
  if (!fecha) return "";
  const d = new Date(fecha);
  if (isNaN(d.getTime())) return "";
  const iso = d.toISOString().slice(0, 10);
  const [anio, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${anio}`;
}

function textoFechaCorrespondePago(evento) {
  if (evento.fechaMin && evento.fechaMax) {
    const fMin = formatoFechaCalendario(evento.fechaMin);
    const fMax = formatoFechaCalendario(evento.fechaMax);
    if (fMin && fMax && fMin === fMax) return fMin;
    if (fMin && fMax) return `${fMin} — ${fMax}`;
  }
  if (evento.fechaMin) return formatoFechaCalendario(evento.fechaMin);
  return formatoFechaCalendario(evento.fechaProgramada) || "sin fecha";
}

function construirNotasTransaccionNomina(evento, opciones = {}) {
  const nombre = (evento.nombreBeneficiario || "").trim() || "Sin nombre";
  const transaccion =
    opciones.prefijo || evento.transaccionNomina || "Pago programado";
  const cuota = `cuota ${evento.numeroCuota}/${evento.totalCuotas}`;
  const fechaCorresponde = textoFechaCorrespondePago(evento);
  let notas = `${transaccion} — ${nombre} — ${cuota} — fecha corresponde ${fechaCorresponde}`;
  if (opciones.detalle) {
    notas += `. ${opciones.detalle}`;
  }
  return notas;
}

async function autorizarEventoFueraPlazo(eventoId, opciones = {}) {
  const evento = await EventoPagoProgramado.findById(eventoId);
  if (!evento) throw new Error("Evento programado no encontrado");
  if (evento.estado !== "Pendiente" && evento.estado !== "Parcial") {
    throw new Error("Solo se pueden autorizar eventos pendientes o parciales");
  }
  if (!eventoVentanaVencida(evento)) {
    throw new Error(
      "La ventana de pago aún no ha vencido; no requiere autorización"
    );
  }
  if (evento.pagoFueraPlazoAutorizado) {
    throw new Error("Este pago ya fue autorizado fuera de plazo");
  }

  evento.pagoFueraPlazoAutorizado = true;
  evento.autorizadoFueraPlazoPor = opciones.usuario || "";
  evento.fechaAutorizacionFueraPlazo = new Date();
  await evento.save();
  return evento;
}

async function ejecutarEventoProgramado(eventoId, opciones = {}) {
  const evento = await EventoPagoProgramado.findById(eventoId);
  if (!evento) throw new Error("Evento programado no encontrado");
  if (evento.estado === "Ejecutado") {
    throw new Error("Esta cuota ya fue pagada en su totalidad");
  }
  if (evento.estado === "Anulado" || evento.estado === "Cancelado") {
    throw new Error("Este evento está anulado");
  }

  const regla = await ReglaPagoNomina.findById(evento.reglaPagoId);
  if (!regla || regla.estadoRegla !== "Autorizada") {
    throw new Error("La regla de pago no está activa");
  }

  if (esEventoMontoVariable(evento, regla)) {
    return ejecutarEventoDominicalProgramado(evento, regla, opciones);
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

  const subCuenta = subCuentaPagoNomina({
    tipoRegla: evento.tipoRegla || regla.tipoRegla,
    transaccionNomina: evento.transaccionNomina || regla.transaccionNomina,
    tipoBeneficiario: regla.tipoBeneficiario,
    frecuencia: regla.frecuencia,
  });
  const tipoTransaccion =
    evento.tipoRegla === "A" ? TIPO_TRANSACCION_A : TIPO_TRANSACCION;

  const { cuenta, tipoCuenta } = await resolverCuentaDesdeSubCuenta(subCuenta);

  const montoYaPagado = Number(evento.montoPagado) || 0;
  const pagoCompletaCuota = montoPagar >= montoPendiente - 0.01;
  const lineasDescuento = pagoCompletaCuota
    ? await obtenerLineasDescuentoEvento(evento, regla)
    : [];
  const montoDescuento = redondear2(
    lineasDescuento.reduce((s, l) => s + (Number(l.monto) || 0), 0)
  );
  const separarDescuentos = pagoCompletaCuota && montoDescuento > 0.009;

  const montoBruto = redondear2(
    evento.montoBruto != null && Number(evento.montoBruto) > 0
      ? Number(evento.montoBruto)
      : (Number(evento.monto) || 0) + montoDescuento || montoPagar
  );

  const valorSalida = separarDescuentos
    ? redondear2(montoBruto - montoYaPagado)
    : montoPagar;

  const fechaContable = new Date();
  const baseTx = {
    fecha: new Date(),
    fechaContable,
    sucursal: opciones.sucursal || "matriz",
    cliente: evento.nombreBeneficiario,
    beneficiario: evento.nombreBeneficiario,
    cedula: evento.cedulaBeneficiario,
    centroCosto: evento.centroCosto,
    isContabilizada: true,
    usuario: opciones.usuario || "",
  };

  const detallePago = separarDescuentos
    ? `Bruto: $${montoBruto.toFixed(2)}. Neto al empleado: $${montoPagar.toFixed(2)}. Descuentos: $${montoDescuento.toFixed(2)}.`
    : `${montoPagar < montoPendiente ? "(pago parcial). " : ""}Centro costo: ${
        evento.centroCosto || ""
      }.`;
  const notasPago = construirNotasTransaccionNomina(evento, {
    detalle: [detallePago, opciones.notas].filter(Boolean).join(" "),
  });

  const tx = new TransaccionFinanciera({
    ...baseTx,
    valor: valorSalida,
    tipoPago: "Egreso",
    cuenta,
    tipoCuenta,
    subCuenta,
    tipoTransaccion,
    notas: notasPago,
  });
  await tx.save();

  const transaccionesDescuento = separarDescuentos
    ? await registrarTransaccionesDescuento(baseTx, lineasDescuento, cuenta, evento)
    : [];

  evento.pagosParciales = evento.pagosParciales || [];
  evento.pagosParciales.push({
    monto: montoPagar,
    fecha: new Date(),
    transaccionFinancieraId: tx._id,
    ejecutadoPor: opciones.usuario || "",
    notas: opciones.notas,
  });

  evento.montoPagado = redondear2(montoYaPagado + montoPagar);
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

  const puedeExtender = tipoANominaService.puedeOfrecerExtension(
    evento,
    regla,
    pendientesRegla
  );

  return {
    evento,
    transaccion: tx,
    transaccionesDescuento,
    montoPagado: montoPagar,
    saldoPendiente: redondear2(Number(evento.monto) - evento.montoPagado),
    puedeExtender,
    reglaPagoId: String(regla._id),
    cuotasExtension: puedeExtender
      ? tipoANominaService.CUOTAS_EXTENSION_ASIGNACION
      : 0,
  };
}

function etiquetaReglaDescuento(reglaC) {
  if (esDescuentosGenerales(reglaC.transaccionNomina)) {
    return reglaC.conceptoDescuento || reglaC.transaccionNomina || "Descuento";
  }
  return "Seguridad social (aporte personal)";
}

function montoDescuentoEvento(evento) {
  const descGuardado = redondear2(Number(evento.montoDescuento) || 0);
  const bruto =
    evento.montoBruto != null ? redondear2(Number(evento.montoBruto)) : 0;
  const neto = redondear2(Number(evento.monto) || 0);
  const descPorDiferencia = bruto > neto + 0.009 ? redondear2(bruto - neto) : 0;
  return Math.max(descGuardado, descPorDiferencia);
}

async function registrarTransaccionesDescuento(baseTx, lineas, cuentaPago, evento) {
  const creadas = [];
  for (const linea of lineas || []) {
    const monto = redondear2(linea.monto);
    if (!(monto > 0.009)) continue;
    const subCuentaDesc =
      linea.subCuenta ||
      subCuentaDescuentoNomina(linea.transaccionNomina) ||
      SUB_CUENTA_DESCUENTO;
    const cuentaDesc = await resolverCuentaDesdeSubCuenta(subCuentaDesc);
    const txDesc = new TransaccionFinanciera({
      ...baseTx,
      valor: monto,
      tipoPago: "Ingreso",
      cuenta: cuentaDesc.cuenta || cuentaPago,
      tipoCuenta: cuentaDesc.tipoCuenta || "Ingresos",
      subCuenta: subCuentaDesc,
      tipoTransaccion: TIPO_TRANSACCION_DESCUENTO,
      notas: construirNotasTransaccionNomina(evento, {
        prefijo: "Descuento nómina",
        detalle: linea.etiqueta || "Descuento",
      }),
    });
    await txDesc.save();
    creadas.push(txDesc);
  }
  return creadas;
}

async function obtenerLineasDescuentoEvento(evento, reglaA) {
  const montoDescuento = montoDescuentoEvento(evento);

  if (!reglaA || reglaA.tipoRegla !== "A") {
    return montoDescuento > 0
      ? [
          {
            etiqueta: "Descuento",
            subCuenta: SUBCUENTAS_NOMINA.DESCUENTOS,
            monto: montoDescuento,
          },
        ]
      : [];
  }

  const reglasC = await ReglaPagoNomina.find({
    reglaPagoAsociadaId: reglaA._id,
    tipoRegla: "C",
    estadoRegla: "Autorizada",
  }).lean();

  const todosEventos = await EventoPagoProgramado.find({
    reglaPagoId: reglaA._id,
  }).sort({ fechaProgramada: 1 });

  const lineas = [];
  for (const reglaC of reglasC) {
    const monto = montoDescuentoReglaCEnEvento(reglaC, evento, todosEventos);
    if (monto > 0) {
      lineas.push({
        etiqueta: etiquetaReglaDescuento(reglaC),
        transaccionNomina: reglaC.transaccionNomina,
        subCuenta: subCuentaDescuentoNomina(reglaC.transaccionNomina),
        monto: redondear2(monto),
      });
    }
  }

  const sumaLineas = redondear2(
    lineas.reduce((s, l) => s + (Number(l.monto) || 0), 0)
  );
  if (!lineas.length && montoDescuento > 0) {
    lineas.push({
      etiqueta: "Descuento",
      subCuenta: SUBCUENTAS_NOMINA.DESCUENTOS,
      monto: montoDescuento,
    });
  } else if (montoDescuento > sumaLineas + 0.009) {
    lineas.push({
      etiqueta: "Descuento",
      subCuenta: SUBCUENTAS_NOMINA.DESCUENTOS,
      monto: redondear2(montoDescuento - sumaLineas),
    });
  }

  return lineas;
}

function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function resolverCuentaDesdeSubCuenta(subCuentaNombre) {
  const fallback = { cuenta: "", tipoCuenta: "Salidas" };
  const nombre = (subCuentaNombre || "").trim();
  if (!nombre) return fallback;

  const cuentaFijaPorSubcuenta = MAPA_CUENTA_POR_SUBCUENTA;

  if (cuentaFijaPorSubcuenta[nombre]) {
    const fija = cuentaFijaPorSubcuenta[nombre];
    const cuentaDoc = await Cuenta.findOne({
      nombre: { $regex: new RegExp(`^${fija.cuenta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") },
    });
    return {
      cuenta: cuentaDoc?.nombre || fija.cuenta,
      tipoCuenta: cuentaDoc?.tipoCuenta || fija.tipoCuenta,
    };
  }

  const sub = await SubCuenta.findOne({ nombre });
  if (sub?.id_cuenta) {
    const cuentaDoc = await Cuenta.findById(sub.id_cuenta);
    if (cuentaDoc?.nombre) {
      return {
        cuenta: cuentaDoc.nombre,
        tipoCuenta: cuentaDoc.tipoCuenta || "Salidas",
      };
    }
  }

  const prefijoMatch = nombre.match(/^(\d+\.\d+)/);
  if (prefijoMatch) {
    const prefijo = prefijoMatch[1].replace(".", "\\.");
    const cuentaDoc = await Cuenta.findOne({
      nombre: { $regex: new RegExp(`^${prefijo}\\b`, "i") },
    });
    if (cuentaDoc?.nombre) {
      return {
        cuenta: cuentaDoc.nombre,
        tipoCuenta: cuentaDoc.tipoCuenta || "Salidas",
      };
    }
  }

  return fallback;
}

function parseFechaFiltro(valor, finDeDia = false) {
  if (!valor) return null;
  const texto = String(valor).trim().slice(0, 10);
  const partes = texto.split("-").map(Number);
  if (partes.length >= 3 && partes.every((n) => !Number.isNaN(n))) {
    const d = new Date(partes[0], partes[1] - 1, partes[2]);
    if (finDeDia) d.setHours(23, 59, 59, 999);
    else d.setHours(0, 0, 0, 0);
    return d;
  }
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  if (finDeDia) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

function construirRangoFechas(desde, hasta) {
  const rango = {};
  if (desde) rango.$gte = desde;
  if (hasta) rango.$lte = hasta;
  return Object.keys(rango).length ? rango : null;
}

async function reporteEstadoEmpleado(filtros = {}) {
  const query = {};
  const cedula = (filtros.cedula || "").trim();
  const centroCosto = (filtros.centroCosto || "").trim();

  if (cedula) {
    query.cedulaBeneficiario = cedula;
  } else if (centroCosto) {
    query.centroCosto = new RegExp(
      centroCosto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i"
    );
  }

  const desde = parseFechaFiltro(filtros.desde, false);
  const hasta = parseFechaFiltro(filtros.hasta, true);
  const rangoFechas = construirRangoFechas(desde, hasta);

  let eventos;
  if (rangoFechas) {
    eventos = await EventoPagoProgramado.find({
      ...query,
      $or: [
        { fechaProgramada: rangoFechas },
        { fechaEjecucion: rangoFechas },
        { "pagosParciales.fecha": rangoFechas },
      ],
    })
      .populate(
        "reglaPagoId",
        "transaccionNomina frecuencia vigenciaRegla estadoRegla tipoRegla"
      )
      .sort({ fechaProgramada: 1, fechaEjecucion: 1 });
  } else {
    eventos = await EventoPagoProgramado.find(query)
      .populate(
        "reglaPagoId",
        "transaccionNomina frecuencia vigenciaRegla estadoRegla tipoRegla"
      )
      .sort({ fechaProgramada: 1, fechaEjecucion: 1 });
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
    const montoBruto =
      doc.montoBruto != null ? redondear2(doc.montoBruto) : programado;
    const montoDescuento = redondear2(doc.montoDescuento || 0);

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
      tipoRegla: doc.tipoRegla,
      numeroCuota: doc.numeroCuota,
      totalCuotas: doc.totalCuotas,
      fechaMin: doc.fechaMin,
      fechaMax: doc.fechaMax,
      fechaProgramada: doc.fechaProgramada,
      fechaEjecucion: doc.fechaEjecucion,
      monto: programado,
      montoBruto,
      montoDescuento,
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
  eliminarEventosNoPagadosRegla,
  ejecutarEventoProgramado,
  autorizarEventoFueraPlazo,
  reporteEstadoEmpleado,
  resolverCuentaDesdeSubCuenta,
  SUB_CUENTA_PAGO,
  TIPO_TRANSACCION,
};
