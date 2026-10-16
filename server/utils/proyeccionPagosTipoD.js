const ReglaPagoNomina = require("../models/reglaPagoNomina");
const EventoPagoProgramado = require("../models/eventoPagoProgramado");
const {
  montoDescuentoReglaCEnEvento,
} = require("./proyeccionPagosTipoC");
const {
  generarFechasPorRegla,
  etiquetaFechaCorta,
  proximasFechasPago,
  claveFechaLocal,
} = require("./proyeccionPagosNomina");
const { subCuentaAbonoPrestamoNomina, subCuentaDescuentoNomina, esAnticipoNomina } = require("./cuentasContablesNomina");
const { registrarBitacoraPrestamo } = require("./bitacoraPrestamoNomina");
const { etiquetaPrestamo } = require("./codigoPrestamoNomina");

const TRANSACCION_PRESTAMO = "Prestamos";
const TRANSACCION_ANTICIPO = "Anticipos";
const MAX_EVENTOS_EXTRA_PRESTAMO = 156;

function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function idStr(valor) {
  if (!valor) return "";
  if (typeof valor === "object" && valor._id) return String(valor._id);
  return String(valor);
}

function calcularMontosPrestamo(montoPrestado, porcentajeInteres) {
  const capital = redondear2(montoPrestado);
  const porcentaje = Math.max(0, Number(porcentajeInteres) || 0);
  const interes = redondear2((capital * porcentaje) / 100);
  const total = redondear2(capital + interes);
  return { montoPrestado: capital, porcentajeInteres: porcentaje, montoInteres: interes, montoTotal: total };
}

function fuentesSeleccionadas(reglaD) {
  return (reglaD.fuentesDescuentoPrestamo || []).filter((f) => {
    if (!f || !f.reglaPagoId) return false;
    if (f.seleccionado === false) return false;
    return redondear2(f.monto) > 0;
  });
}

function esReglaAnticipo(reglaD) {
  return esAnticipoNomina(reglaD && reglaD.transaccionNomina);
}

/** Externo cobrado por cuotas fijas (no descuenta de pagos programados). */
function esPrestamoExternoRegla(regla) {
  if (esReglaAnticipo(regla)) return false;
  if (regla.modalidadCobroExterno === "Descuento de eventos") return false;
  return (
    (regla.tipoBeneficiario || "").toString().trim().toLowerCase() === "externo"
  );
}

function esAsignacionNominaTexto(transaccion) {
  const t = (transaccion || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return t.includes("asignacion") && t.includes("nomina");
}

function cuotaMinimaFuentes(fuentes) {
  const montos = (fuentes || [])
    .map((f) => redondear2(f.monto))
    .filter((n) => n > 0.009);
  if (!montos.length) return 0;
  return Math.min(...montos);
}

function cuotasNecesariasPrestamo(regla, fuentes) {
  const total = redondear2(
    regla.montoTotalDeuda ||
      calcularMontosPrestamo(regla.montoPrestado, regla.porcentajeInteres)
        .montoTotal
  );
  const cuotaMin = cuotaMinimaFuentes(fuentes);
  const porMonto =
    total > 0.009 && cuotaMin > 0.009 ? Math.ceil(total / cuotaMin) : 0;
  const porTabla = (regla.tablaAmortizacion || []).filter(
    (f) => redondear2(f.monto) > 0.009
  ).length;
  return Math.max(porMonto, porTabla);
}

function elegirReglaNominaParaExtender(reglasPago, fuentes) {
  const idsFuente = new Set((fuentes || []).map((f) => idStr(f.reglaPagoId)));
  const candidatas = (reglasPago || []).filter(
    (r) =>
      r &&
      r.tipoRegla === "A" &&
      r.estadoRegla === "Autorizada" &&
      idsFuente.has(idStr(r._id))
  );
  if (!candidatas.length) return null;
  return (
    candidatas.find((r) => esAsignacionNominaTexto(r.transaccionNomina)) ||
    candidatas[0]
  );
}

function construirEventoVirtualPrestamo(reglaPago, fecha, indice) {
  const variable = !!(
    reglaPago.montoVariable ||
    (reglaPago.frecuencia || "").toString().toLowerCase() === "dominical"
  );
  const monto = variable ? 0 : redondear2(reglaPago.monto || 0);
  const clave = claveFechaLocal(fecha) || String(indice);
  return {
    _id: `virtual-${idStr(reglaPago._id)}-${clave}`,
    reglaPagoId: reglaPago._id,
    tipoRegla: "A",
    fechaProgramada: fecha,
    transaccionNomina: reglaPago.transaccionNomina,
    estado: "Pendiente",
    monto,
    montoBruto: variable ? null : monto,
    montoDescuento: 0,
    omitirDescuentoPrestamo: false,
    modalidadMonto: variable ? "Variable" : "Periodico",
    numeroCuota: indice,
    virtual: true,
  };
}

async function fechasVirtualesParaPrestamo(
  reglaPago,
  cantidad,
  fechaInicioCobros
) {
  if (!(cantidad > 0) || !reglaPago) return [];
  const ultimo = await EventoPagoProgramado.findOne({
    reglaPagoId: reglaPago._id,
    estado: { $ne: "Anulado" },
  }).sort({ fechaProgramada: -1, numeroCuota: -1 });
  const existentes = await EventoPagoProgramado.find({
    reglaPagoId: reglaPago._id,
    estado: { $ne: "Anulado" },
  }).select("fechaProgramada");
  const inicioCobro = fechaCalendarioFiltro(fechaInicioCobros);
  let despuesDe = ultimo ? ultimo.fechaProgramada : new Date();
  if (inicioCobro) {
    const tUltimo = fechaCalendarioFiltro(despuesDe);
    if (!tUltimo || tUltimo.getTime() < inicioCobro.getTime()) {
      const unDiaAntes = new Date(inicioCobro);
      unDiaAntes.setDate(unDiaAntes.getDate() - 1);
      despuesDe = unDiaAntes;
    }
  }
  return proximasFechasPago(reglaPago, {
    cantidad,
    despuesDe,
    fechasExcluir: existentes.map((e) => e.fechaProgramada),
  });
}

async function asegurarEventosNominaParaPrestamo(regla) {
  if (esReglaAnticipo(regla) || esPrestamoExternoRegla(regla)) {
    return { eventosGenerados: 0 };
  }
  const fuentes = fuentesSeleccionadas(regla);
  if (!fuentes.length) {
    return { eventosGenerados: 0 };
  }

  const ids = fuentes.map((f) => f.reglaPagoId);
  const reglasPago = await ReglaPagoNomina.find({ _id: { $in: ids } }).lean();
  const reglaNomina = elegirReglaNominaParaExtender(reglasPago, fuentes);
  if (!reglaNomina) {
    return { eventosGenerados: 0 };
  }

  const tabla = regla.tablaAmortizacion || [];
  const filasSinEvento = tabla.filter(
    (f) => redondear2(f.monto) > 0.009 && !esIdMongo(f.eventoPagoId)
  );
  const eventos = await EventoPagoProgramado.find({
    reglaPagoId: { $in: ids },
    estado: { $in: ["Pendiente", "Parcial"] },
  }).sort({ fechaProgramada: 1, numeroCuota: 1 });
  const usables = eventos.filter(
    (e) =>
      !e.omitirDescuentoPrestamo &&
      eventoDesdeFechaInicioCobro(regla, e.fechaProgramada)
  );
  const needed = Math.max(
    cuotasNecesariasPrestamo(regla, fuentes),
    tabla.filter((f) => redondear2(f.monto) > 0.009).length
  );
  const faltanPorTabla = filasSinEvento.length;
  const faltanPorSaldo = Math.max(0, needed - usables.length);
  const faltan = Math.min(
    MAX_EVENTOS_EXTRA_PRESTAMO,
    Math.max(faltanPorTabla, faltanPorSaldo)
  );
  if (!faltan) return { eventosGenerados: 0 };

  const tipoANominaService = require("../services/tipoANominaService");
  const resultado = await tipoANominaService.extenderEventosAdicionales(
    reglaNomina._id,
    { cantidadCuotas: faltan }
  );
  return {
    eventosGenerados: resultado.eventosGenerados || 0,
    reglaPagoId: reglaNomina._id,
    transaccionNomina: reglaNomina.transaccionNomina,
  };
}

function esIdMongo(valor) {
  const s = idStr(valor);
  return /^[a-fA-F0-9]{24}$/.test(s);
}

function cuotaFuenteParaEvento(reglaD, evento) {
  if (esReglaAnticipo(reglaD)) {
    const fuentes = fuentesSeleccionadas(reglaD);
    const porEvento = fuentes.find(
      (f) => idStr(f.eventoPagoId) === idStr(evento._id)
    );
    if (porEvento) return redondear2(porEvento.monto);
    return 0;
  }
  const tabla = reglaD.tablaAmortizacion || [];
  if (tabla.length) {
    const indice = indiceFilaTablaParaEvento(tabla, evento);
    return indice >= 0 ? redondear2(tabla[indice].monto) : 0;
  }
  return cuotaFuenteParaRegla(reglaD, evento.reglaPagoId);
}

/** Fila de la tabla del préstamo que se cobra en ese evento (por id o por fecha). */
function indiceFilaTablaParaEvento(tabla, evento) {
  const porEvento = tabla.findIndex(
    (f) => f.eventoPagoId && idStr(f.eventoPagoId) === idStr(evento._id)
  );
  if (porEvento >= 0) return porEvento;
  const fechaEv = fechaCalendarioFiltro(evento.fechaProgramada);
  const tx = (evento.transaccionNomina || "").toString().trim().toLowerCase();
  return tabla.findIndex((f) => {
    const fechaFila = fechaCalendarioFiltro(f.fechaMin || f.fechaMax);
    if (!fechaEv || !fechaFila || fechaEv.getTime() !== fechaFila.getTime()) {
      return false;
    }
    const txFila = (f.transaccionNomina || "").toString().trim().toLowerCase();
    return !txFila || !tx || txFila === tx;
  });
}

function filaTablaPlain(fila) {
  const f = fila && typeof fila.toObject === "function" ? fila.toObject() : { ...fila };
  return {
    numeroCuota: f.numeroCuota,
    fechaMin: f.fechaMin,
    fechaMax: f.fechaMax || f.fechaMin,
    monto: redondear2(f.monto),
    transaccionNomina: f.transaccionNomina || undefined,
    eventoPagoId: f.eventoPagoId || undefined,
  };
}

/**
 * Siguiente pago (de la misma regla de pago del evento omitido) posterior a
 * la última cuota de la tabla y sin cuota asignada. Si es nómina tipo A y no
 * hay más pagos, se crea uno adicional.
 */
async function siguienteEventoParaCuotaMovida(tabla, evento) {
  const fechas = tabla
    .map((f) => fechaCalendarioFiltro(f.fechaMin || f.fechaMax))
    .filter(Boolean)
    .map((d) => d.getTime());
  const fechaEvento = fechaCalendarioFiltro(evento.fechaProgramada);
  const desde = Math.max(
    fechaEvento ? fechaEvento.getTime() : 0,
    ...(fechas.length ? fechas : [0])
  );
  const buscar = async () => {
    const candidatos = await EventoPagoProgramado.find({
      reglaPagoId: evento.reglaPagoId,
      estado: { $in: ["Pendiente", "Parcial"] },
      omitirDescuentoPrestamo: { $ne: true },
    }).sort({ fechaProgramada: 1, numeroCuota: 1 });
    return candidatos.find((c) => {
      const f = fechaCalendarioFiltro(c.fechaProgramada);
      return (
        f && f.getTime() > desde && indiceFilaTablaParaEvento(tabla, c) < 0
      );
    });
  };

  let destino = await buscar();
  if (destino) return destino;

  const reglaPago = await ReglaPagoNomina.findById(evento.reglaPagoId).lean();
  if (reglaPago && reglaPago.tipoRegla === "A" && reglaPago.estadoRegla === "Autorizada") {
    const tipoANominaService = require("../services/tipoANominaService");
    await tipoANominaService.extenderEventosAdicionales(reglaPago._id, {
      cantidadCuotas: 1,
    });
    destino = await buscar();
  }
  return destino || null;
}

/**
 * Mueve la cuota del préstamo (no anticipo) que se cobraba en el evento
 * omitido al siguiente pago disponible. Devuelve el registro para revertirlo.
 */
async function moverCuotaPrestamoOmitida(reglaDId, evento) {
  const reglaD = await ReglaPagoNomina.findById(reglaDId);
  if (!reglaD || esReglaAnticipo(reglaD)) return null;
  const tabla = (reglaD.tablaAmortizacion || []).map(filaTablaPlain);
  // Sin tabla, el saldo se cobra solo en los pagos siguientes.
  if (!tabla.length) return null;
  const indice = indiceFilaTablaParaEvento(tabla, evento);
  if (indice < 0) return null;

  const filaOriginal = tabla[indice];
  const destino = await siguienteEventoParaCuotaMovida(tabla, evento);
  if (!destino) {
    throw new Error(
      `No hay un pago posterior de ${
        evento.transaccionNomina || "este tipo"
      } para mover la cuota del préstamo${
        reglaD.codigoPrestamo ? ` ${reglaD.codigoPrestamo}` : ""
      }. Genere más pagos de esa regla antes de omitir el préstamo.`
    );
  }

  const numeroNuevo =
    Math.max(0, ...tabla.map((f) => Number(f.numeroCuota) || 0)) + 1;
  tabla.splice(indice, 1);
  tabla.push({
    ...filaOriginal,
    numeroCuota: numeroNuevo,
    fechaMin: destino.fechaProgramada,
    fechaMax: destino.fechaProgramada,
    transaccionNomina: destino.transaccionNomina || filaOriginal.transaccionNomina,
    eventoPagoId: destino._id,
  });
  reglaD.tablaAmortizacion = tabla;
  reglaD.cuotas = tabla.length;
  reglaD.markModified("tablaAmortizacion");
  moverAbonoCuota(reglaD, filaOriginal.numeroCuota, numeroNuevo);
  await reglaD.save();

  return {
    reglaDescuentoId: reglaD._id,
    filaOriginal,
    numeroCuotaNuevo: numeroNuevo,
    eventoDestinoId: destino._id,
    fechaDestino: destino.fechaProgramada,
  };
}

/** Revierte el movimiento: la cuota vuelve al evento original. */
async function revertirCuotaPrestamoMovida(registro) {
  const reglaD = await ReglaPagoNomina.findById(registro.reglaDescuentoId);
  if (!reglaD) return;
  const destino = await EventoPagoProgramado.findById(registro.eventoDestinoId);
  if (destino && destino.estado !== "Pendiente") {
    throw new Error(
      "La cuota movida ya se cobró en el pago posterior; no se puede reactivar el préstamo en esta semana."
    );
  }
  const tabla = (reglaD.tablaAmortizacion || []).map(filaTablaPlain);
  const indice = tabla.findIndex(
    (f) => idStr(f.eventoPagoId) === idStr(registro.eventoDestinoId)
  );
  if (indice >= 0) tabla.splice(indice, 1);
  tabla.push(filaTablaPlain(registro.filaOriginal));
  tabla.sort(
    (a, b) =>
      new Date(a.fechaMin || 0) - new Date(b.fechaMin || 0) ||
      (Number(a.numeroCuota) || 0) - (Number(b.numeroCuota) || 0)
  );
  reglaD.tablaAmortizacion = tabla;
  reglaD.cuotas = tabla.length;
  reglaD.markModified("tablaAmortizacion");
  moverAbonoCuota(
    reglaD,
    registro.numeroCuotaNuevo,
    registro.filaOriginal && registro.filaOriginal.numeroCuota
  );
  await reglaD.save();
}

/** Mantiene el abono parcial de una cuota cuando cambia su número. */
function moverAbonoCuota(reglaD, numeroAnterior, numeroNuevo) {
  const abonos = reglaD.abonosCuotasPrestamo || [];
  const abono = abonos.find(
    (a) => Number(a.numeroCuota) === Number(numeroAnterior)
  );
  if (!abono || numeroNuevo == null) return;
  abono.numeroCuota = Number(numeroNuevo);
  reglaD.markModified("abonosCuotasPrestamo");
}

function inicioDelDiaLocal(valor) {
  const d = valor ? new Date(valor) : new Date();
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function fechaCalendarioFiltro(valor) {
  if (!valor) return null;
  if (typeof valor === "string") {
    const m = String(valor).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    }
  }
  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function elegirEventoMasCercanoAnticipo(eventos, fechaObjetivo) {
  const pendientes = (eventos || [])
    .filter((e) => ["Pendiente", "Parcial"].includes(e.estado))
    .slice()
    .sort(
      (a, b) =>
        new Date(a.fechaProgramada) - new Date(b.fechaProgramada) ||
        (a.numeroCuota || 0) - (b.numeroCuota || 0)
    );
  if (!pendientes.length) return null;
  const objetivo =
    fechaCalendarioFiltro(fechaObjetivo) || inicioDelDiaLocal(new Date());
  const desdeFecha = pendientes.filter((evento) => {
    const fecha = fechaCalendarioFiltro(evento.fechaProgramada);
    return fecha && fecha.getTime() >= objetivo.getTime();
  });
  if (desdeFecha.length) return desdeFecha[0];
  return pendientes[pendientes.length - 1];
}

function eventoDesdeFechaInicioCobro(reglaD, fechaEvento) {
  if (esReglaAnticipo(reglaD)) return true;
  const inicio = fechaCalendarioFiltro(reglaD.fechaInicioCobros);
  if (!inicio) return true;
  const fecha = fechaCalendarioFiltro(fechaEvento);
  if (!fecha) return true;
  return fecha.getTime() >= inicio.getTime();
}

function cuotaFuenteParaRegla(reglaD, reglaPagoId) {
  const id = idStr(reglaPagoId);
  const fuente = fuentesSeleccionadas(reglaD).find(
    (f) => idStr(f.reglaPagoId) === id
  );
  return fuente ? redondear2(fuente.monto) : 0;
}

function esEventoVariable(evento, reglaPago) {
  return !!(
    evento?.modalidadMonto === "Variable" ||
    reglaPago?.montoVariable ||
    reglaPago?.frecuencia === "Dominical" ||
    (reglaPago?.transaccionNomina || "")
      .toString()
      .toLowerCase()
      .includes("dominical")
  );
}

function saldoActualPrestamo(reglaD) {
  if (reglaD.saldoPendientePrestamo != null) {
    return redondear2(Math.max(0, Number(reglaD.saldoPendientePrestamo) || 0));
  }
  return redondear2(
    reglaD.montoTotalDeuda || reglaD.monto || reglaD.montoPrestado || 0
  );
}

async function listarReglasPagoAsociablesPrestamo(cedula) {
  const doc = (cedula || "").trim();
  if (!doc) return [];
  return ReglaPagoNomina.find({
    cedulaBeneficiario: doc,
    tipoRegla: { $in: ["A", "B"] },
    estadoRegla: "Autorizada",
  })
    .select(
      "_id transaccionNomina frecuencia parametro monto montoVariable tipoRegla nombreBeneficiario cedulaBeneficiario centroCosto"
    )
    .sort({ tipoRegla: 1, transaccionNomina: 1, createdAt: -1 })
    .lean();
}

async function cargarReglasCPorReglaA(idsReglaA) {
  if (!idsReglaA.length) return new Map();
  const reglasC = await ReglaPagoNomina.find({
    reglaPagoAsociadaId: { $in: idsReglaA },
    tipoRegla: "C",
    estadoRegla: "Autorizada",
  }).lean();
  const mapa = new Map();
  for (const reglaC of reglasC) {
    const clave = idStr(reglaC.reglaPagoAsociadaId);
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(reglaC);
  }
  return mapa;
}

async function cargarEventosPorReglaA(idsReglaA) {
  if (!idsReglaA.length) return new Map();
  const eventos = await EventoPagoProgramado.find({
    reglaPagoId: { $in: idsReglaA },
  }).sort({ fechaProgramada: 1 });
  const mapa = new Map();
  for (const ev of eventos) {
    const clave = idStr(ev.reglaPagoId);
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(ev);
  }
  return mapa;
}

function descuentoCDeEvento(
  evento,
  reglasCPorA,
  eventosPorA,
  reglasCPorFuentes = []
) {
  const clave = idStr(evento.reglaPagoId);
  const reglasC = reglasCPorA.get(clave) || [];
  const todos = eventosPorA.get(clave) || [evento];
  let total = 0;
  for (const reglaC of reglasC) {
    total = redondear2(
      total + montoDescuentoReglaCEnEvento(reglaC, evento, todos)
    );
  }
  for (const reglaC of reglasCPorFuentes || []) {
    total = redondear2(
      total + montoDescuentoReglaCEnEvento(reglaC, evento, [evento])
    );
  }
  return total;
}

function brutoDeEvento(evento, reglaPago) {
  if (esEventoVariable(evento, reglaPago)) {
    return 0;
  }
  if (evento.montoBruto != null && Number(evento.montoBruto) > 0) {
    return redondear2(evento.montoBruto);
  }
  const montoRegla = redondear2(reglaPago?.monto || 0);
  if (montoRegla > 0) return montoRegla;
  return redondear2(
    (Number(evento.monto) || 0) + (Number(evento.montoDescuento) || 0)
  );
}

async function contextoDescuentosBeneficiario(cedula) {
  const reglasD = await ReglaPagoNomina.find({
    cedulaBeneficiario: cedula,
    tipoRegla: "D",
    estadoRegla: "Autorizada",
  })
    .sort({ fechaAutorizacion: 1, createdAt: 1 })
    .lean();

  const eventos = await EventoPagoProgramado.find({
    cedulaBeneficiario: cedula,
    estado: { $in: ["Pendiente", "Parcial"] },
  }).sort({ fechaProgramada: 1, numeroCuota: 1 });

  const idsReglaPago = [
    ...new Set(eventos.map((e) => idStr(e.reglaPagoId)).filter(Boolean)),
  ];
  const reglasPago = await ReglaPagoNomina.find({
    _id: { $in: idsReglaPago },
  }).lean();
  const mapaReglasPago = new Map(
    reglasPago.map((r) => [idStr(r._id), r])
  );
  const idsA = reglasPago.filter((r) => r.tipoRegla === "A").map((r) => r._id);
  const reglasCPorA = await cargarReglasCPorReglaA(idsA);
  const eventosPorA = await cargarEventosPorReglaA(idsA);
  const idsEventos = eventos.map((e) => e._id).filter(Boolean);
  const reglasCPorFuentes = idsEventos.length
    ? await ReglaPagoNomina.find({
        tipoRegla: "C",
        estadoRegla: "Autorizada",
        "fuentesDescuentoPrestamo.eventoPagoId": { $in: idsEventos },
      }).lean()
    : [];

  return {
    reglasD,
    eventos,
    mapaReglasPago,
    reglasCPorA,
    eventosPorA,
    reglasCPorFuentes,
  };
}

function asignarDescuentosDEnEventos(ctx) {
  const {
    reglasD,
    eventos,
    mapaReglasPago,
    reglasCPorA,
    eventosPorA,
    reglasCPorFuentes,
  } = ctx;
  const porEvento = new Map();

  for (const evento of eventos) {
    const reglaPago = mapaReglasPago.get(idStr(evento.reglaPagoId));
    if (evento.tipoRegla === "D" || reglaPago?.tipoRegla === "D") continue;
    const descC = descuentoCDeEvento(
      evento,
      reglasCPorA,
      eventosPorA,
      reglasCPorFuentes
    );
    const bruto = brutoDeEvento(evento, reglaPago);
    const variable = esEventoVariable(evento, reglaPago);
    porEvento.set(idStr(evento._id), {
      evento,
      reglaPago,
      descC,
      descD: 0,
      bruto,
      variable,
      notasD: [],
      reglasDIds: [],
      lineasD: [],
    });
  }

  for (const reglaD of reglasD) {
    let saldo = saldoActualPrestamo(reglaD);
    if (saldo <= 0) continue;
    const notaD = String(reglaD.notas || "").trim();

    for (const evento of eventos) {
      if (saldo <= 0.009) break;
      const info = porEvento.get(idStr(evento._id));
      if (!info) continue;
      // "Quitar préstamo de esta semana" no aplica a anticipos.
      if (evento.omitirDescuentoPrestamo && !esReglaAnticipo(reglaD)) continue;
      if (!eventoDesdeFechaInicioCobro(reglaD, evento.fechaProgramada)) continue;
      const cuota = cuotaFuenteParaEvento(reglaD, evento);
      if (!(cuota > 0)) continue;

      let disponible;
      if (info.variable) {
        disponible = cuota;
      } else {
        const bruto = info.bruto;
        if (!(bruto > 0)) continue;
        disponible = redondear2(Math.max(0, bruto - info.descC - info.descD));
      }
      const aplicar = redondear2(Math.min(cuota, saldo, disponible));
      if (!(aplicar > 0.009)) continue;

      const esAnticipo = esReglaAnticipo(reglaD);
      info.descD = redondear2(info.descD + aplicar);
      info.reglasDIds.push(reglaD._id);
      info.lineasD.push({
        reglaDescuentoId: reglaD._id,
        transaccionNomina: reglaD.transaccionNomina || TRANSACCION_PRESTAMO,
        conceptoDescuento: esAnticipo ? "Anticipo" : "Préstamo",
        etiqueta: etiquetaPrestamo(reglaD, evento),
        codigoPrestamo: (reglaD.codigoPrestamo || "").trim() || undefined,
        monto: aplicar,
        centroCosto: (reglaD.centroCosto || "").trim() || undefined,
        notas: notaD || undefined,
        subCuenta: esAnticipo
          ? subCuentaDescuentoNomina(TRANSACCION_ANTICIPO)
          : subCuentaAbonoPrestamoNomina(),
      });
      if (notaD && !info.notasD.includes(notaD)) info.notasD.push(notaD);
      saldo = redondear2(saldo - aplicar);
    }
  }

  return porEvento;
}

async function reactivarPrestamosCerradosPorDesembolso(cedula) {
  const doc = (cedula || "").trim();
  if (!doc) return 0;
  const cerradas = await ReglaPagoNomina.find({
    cedulaBeneficiario: doc,
    tipoRegla: "D",
    estadoRegla: "Finalizada",
    saldoPendientePrestamo: { $gt: 0.009 },
  });
  let reabiertas = 0;
  for (const regla of cerradas) {
    const desembolsoPagado = await EventoPagoProgramado.countDocuments({
      reglaPagoId: regla._id,
      tipoRegla: "D",
      estado: "Ejecutado",
    });
    if (!desembolsoPagado) continue;
    regla.estadoRegla = "Autorizada";
    await regla.save();
    reabiertas += 1;
  }
  return reabiertas;
}

async function recalcularPrestamosBeneficiario(cedula) {
  const doc = (cedula || "").trim();
  if (!doc) return 0;
  await reactivarPrestamosCerradosPorDesembolso(doc);
  const ctx = await contextoDescuentosBeneficiario(doc);
  const asignado = asignarDescuentosDEnEventos(ctx);
  let actualizados = 0;

  for (const info of asignado.values()) {
    const evento = info.evento;
    const descTotal = redondear2(info.descC + info.descD);
    const notasC = [];
    const claveA = idStr(evento.reglaPagoId);
    const reglasC = ctx.reglasCPorA.get(claveA) || [];
    for (const reglaC of reglasC) {
      const todos = ctx.eventosPorA.get(claveA) || [];
      if (montoDescuentoReglaCEnEvento(reglaC, evento, todos) > 0) {
        const n = String(reglaC.notas || "").trim();
        if (n) notasC.push(n);
      }
    }
    for (const reglaC of ctx.reglasCPorFuentes || []) {
      if (montoDescuentoReglaCEnEvento(reglaC, evento, [evento]) > 0) {
        const n = String(reglaC.notas || reglaC.conceptoDescuento || "").trim();
        if (n) notasC.push(n);
      }
    }
    let notas = [...new Set([...notasC, ...info.notasD])].join(" | ");
    if (evento.omitirDescuentoPrestamo) {
      const marca = "Préstamo omitido esta semana — se cobrará en un pago posterior";
      notas = notas ? `${notas} | ${marca}` : marca;
    }
    evento.montoDescuentoPrestamo = info.descD;

    if (info.variable) {
      evento.montoDescuento = descTotal;
      if (info.reglasDIds[0]) {
        evento.reglaDescuentoId = info.reglasDIds[0];
      } else if (!info.descC) {
        evento.reglaDescuentoId = null;
      }
      evento.notas = notas;
    } else if (descTotal > 0.009 && info.bruto > 0) {
      evento.montoBruto = info.bruto;
      evento.montoDescuento = descTotal;
      evento.monto = redondear2(Math.max(0, info.bruto - descTotal));
      evento.reglaDescuentoId =
        (reglasC[0] && info.descC > 0 ? reglasC[0]._id : null) ||
        ((ctx.reglasCPorFuentes || []).find(
          (r) => montoDescuentoReglaCEnEvento(r, evento, [evento]) > 0
        ) || {})._id ||
        info.reglasDIds[0] ||
        evento.reglaDescuentoId ||
        null;
      evento.notas = notas;
    } else if (info.descC <= 0.009) {
      evento.monto = info.bruto || evento.monto;
      evento.montoBruto = null;
      evento.montoDescuento = 0;
      evento.reglaDescuentoId = null;
      evento.notas = notas || "";
    } else {
      evento.montoBruto = info.bruto;
      evento.montoDescuento = info.descC;
      evento.monto = redondear2(Math.max(0, info.bruto - info.descC));
      evento.notas = notas;
    }

    await evento.save();
    actualizados += 1;
  }

  return actualizados;
}

async function aplicarPrestamosSobreReglaPago(reglaPagoId) {
  if (!reglaPagoId) return 0;
  const regla = await ReglaPagoNomina.findById(reglaPagoId).lean();
  if (!regla?.cedulaBeneficiario) return 0;
  return recalcularPrestamosBeneficiario(regla.cedulaBeneficiario);
}

function lineasPrestamoParaEvento(evento, ctx) {
  if (evento.tipoRegla === "D") return [];
  const fromCtx = (ctx.eventos || []).find(
    (e) => idStr(e._id) === idStr(evento._id)
  );
  const omitido =
    evento.omitirDescuentoPrestamo || fromCtx?.omitirDescuentoPrestamo;
  const asignado = asignarDescuentosDEnEventos(ctx);
  const info = asignado.get(idStr(evento._id));
  const lineas = info && info.lineasD ? info.lineasD : [];
  // Con el préstamo omitido esta semana solo se mantiene el anticipo.
  return omitido ? lineas.filter(esLineaAnticipo) : lineas;
}

function esLineaAnticipo(linea) {
  return (linea && linea.conceptoDescuento) === "Anticipo";
}

async function obtenerLineasPrestamoEvento(evento) {
  const cedula = (evento.cedulaBeneficiario || "").trim();
  if (!cedula) return [];
  const ctx = await contextoDescuentosBeneficiario(cedula);
  return lineasPrestamoParaEvento(evento, ctx);
}

async function registrarAbonosPrestamo(evento, lineas, opciones = {}) {
  const creadas = [];
  for (const linea of lineas || []) {
    const monto = redondear2(linea.monto);
    if (!(monto > 0.009) || !linea.reglaDescuentoId) continue;
    const reglaD = await ReglaPagoNomina.findById(linea.reglaDescuentoId);
    if (!reglaD || reglaD.tipoRegla !== "D") continue;

    const saldoAntes = saldoActualPrestamo(reglaD);
    const abono = redondear2(Math.min(monto, saldoAntes));
    if (!(abono > 0.009)) continue;

    reglaD.saldoPendientePrestamo = redondear2(Math.max(0, saldoAntes - abono));
    reglaD.abonosPrestamo = reglaD.abonosPrestamo || [];
    reglaD.abonosPrestamo.push({
      fecha: new Date(),
      monto: abono,
      eventoPagoId: evento._id,
      transaccionFinancieraId: opciones.transaccionId || undefined,
      transaccionNominaOrigen: evento.transaccionNomina || "",
      tipoMovimiento: "Descuento nomina",
      saldoAntes,
      saldoDespues: reglaD.saldoPendientePrestamo,
      notas: `Descuento en ${evento.transaccionNomina || "nómina"}`,
      ejecutadoPor: opciones.usuario || "",
    });
    if (reglaD.saldoPendientePrestamo <= 0.009) {
      reglaD.saldoPendientePrestamo = 0;
      reglaD.estadoRegla = "Finalizada";
    }
    await reglaD.save();
    await registrarBitacoraPrestamo({
      regla: reglaD,
      tipoMovimiento: "Descuento nomina",
      monto: abono,
      saldoAntes,
      saldoDespues: reglaD.saldoPendientePrestamo,
      transaccionFinancieraId: opciones.transaccionId || undefined,
      eventoPagoId: evento._id,
      ejecutadoPor: opciones.usuario || "",
      notas: `Descuento en ${evento.transaccionNomina || "nómina"}`,
    });
    creadas.push({ reglaD, monto: abono, linea });
  }

  if (evento.cedulaBeneficiario) {
    await recalcularPrestamosBeneficiario(evento.cedulaBeneficiario);
  }
  return creadas;
}

async function quitarDescuentosPrestamo(reglaD) {
  if (reglaD?._id) {
    await EventoPagoProgramado.deleteMany({
      reglaPagoId: reglaD._id,
      estado: { $in: ["Pendiente", "Parcial"] },
    });
  }
  const cedula = (reglaD?.cedulaBeneficiario || "").trim();
  if (!cedula) return 0;
  return recalcularPrestamosBeneficiario(cedula);
}

function esPrestamoExterno(regla) {
  return esPrestamoExternoRegla(regla);
}

function construirProyeccionCobrosExternos(regla, total) {
  const MESES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  const tabla = regla.tablaAmortizacion || [];
  const mapa = new Map();
  let saldo = total;
  for (const fila of tabla) {
    const fecha = new Date(fila.fechaMin || fila.fechaMax || fila.fechaProgramada);
    if (isNaN(fecha.getTime())) continue;
    const key = `${fecha.getFullYear()}-${fecha.getMonth()}`;
    if (!mapa.has(key)) {
      mapa.set(key, {
        mes: MESES[fecha.getMonth()],
        anio: fecha.getFullYear(),
        ocurrencias: [],
      });
    }
    const monto = redondear2(fila.monto);
    saldo = redondear2(Math.max(0, saldo - monto));
    mapa.get(key).ocurrencias.push({
      fecha,
      etiqueta: `Cobro préstamo cuota ${fila.numeroCuota || ""}`.trim(),
      monto,
      montoNeto: monto,
      estado: "Pendiente",
    });
  }
  return {
    etiquetaFila: "Cobros préstamo externo",
    meses: Array.from(mapa.values()),
    tipoRegla: "D",
    montoTotalDescuento: total,
  };
}

function construirProyeccionTipoD(regla, opciones = {}) {
  const fuentes = fuentesSeleccionadas(regla);
  const total = redondear2(
    regla.montoTotalDeuda || calcularMontosPrestamo(regla.montoPrestado, regla.porcentajeInteres).montoTotal
  );
  if (esPrestamoExterno(regla)) {
    return construirProyeccionCobrosExternos(regla, total);
  }
  if (!fuentes.length) {
    return {
      etiquetaFila: "Préstamo",
      meses: [],
      tipoRegla: "D",
      advertencia: "Seleccione al menos un tipo de pago para descontar el préstamo",
      montoTotalDescuento: total,
    };
  }

  const MESES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  const mapa = new Map();
  let saldo = total;
  const reglasAsociadas = opciones.reglasAsociadas || [];

  const fechasCombinadas = [];
  for (const fuente of fuentes) {
    const asociada =
      reglasAsociadas.find((r) => idStr(r._id) === idStr(fuente.reglaPagoId)) ||
      fuente;
    const fechas = generarFechasPorRegla(
      {
        ...asociada,
        frecuencia: asociada.frecuencia || fuente.frecuencia,
        parametro: asociada.parametro || fuente.parametro,
        fechaInicioPagos: asociada.fechaInicioPagos,
      },
      { mesesProyeccion: opciones.mesesProyeccion || 6 }
    );
    fechas.forEach((fecha) => {
      fechasCombinadas.push({
        fecha,
        fuente,
        asociada,
      });
    });
  }
  fechasCombinadas.sort((a, b) => a.fecha - b.fecha);

  fechasCombinadas.forEach((item) => {
    const { fecha, fuente, asociada } = item;
    if (!eventoDesdeFechaInicioCobro(regla, fecha)) return;
    const claveMes = `${fecha.getFullYear()}-${fecha.getMonth()}`;
    if (!mapa.has(claveMes)) {
      mapa.set(claveMes, {
        mes: MESES[fecha.getMonth()],
        anio: fecha.getFullYear(),
        ocurrencias: [],
      });
    }
    const bruto = redondear2(asociada.monto || fuente.montoPago || 0);
    const cuota = redondear2(Math.min(fuente.monto, Math.max(0, saldo)));
    const aplica = cuota > 0 && saldo > 0;
    const desc = aplica ? cuota : 0;
    if (aplica) saldo = redondear2(saldo - desc);
    const neto = redondear2(Math.max(0, bruto - desc));
    mapa.get(claveMes).ocurrencias.push({
      fecha,
      etiqueta: `${etiquetaFechaCorta(fecha)} ${fuente.transaccionNomina || ""}`.trim(),
      monto: neto,
      montoBruto: bruto,
      montoDescuento: desc,
      montoNeto: neto,
    });
  });

  return {
    etiquetaFila: `Préstamo $${total.toFixed(2)} (capital + interés)`,
    meses: Array.from(mapa.values()).sort(
      (a, b) =>
        a.anio - b.anio || MESES.indexOf(a.mes) - MESES.indexOf(b.mes)
    ),
    tipoRegla: "D",
    montoTotalDescuento: total,
    saldoPendiente: saldo,
  };
}

async function generarTablaPrestamoPrevia(regla, opciones = {}) {
  const montos = calcularMontosPrestamo(
    regla.montoPrestado,
    regla.porcentajeInteres
  );
  const total = montos.montoTotal;
  const fuentes = fuentesSeleccionadas(regla);
  if (!fuentes.length || !total) {
    return {
      tabla: [],
      total,
      cuotaEvento: 0,
      montoPrestado: montos.montoPrestado,
      montoInteres: montos.montoInteres,
      porcentajeInteres: montos.porcentajeInteres,
      saldoPendiente: total,
      validacionDescuento: {
        ok: false,
        mensaje: "Indique el préstamo y al menos un tipo de pago con cuota",
      },
    };
  }

  const ids = fuentes.map((f) => f.reglaPagoId);
  let eventos = await EventoPagoProgramado.find({
    reglaPagoId: { $in: ids },
    estado: { $in: ["Pendiente", "Parcial"] },
  }).sort({ fechaProgramada: 1, numeroCuota: 1 });

  const reglasPago = await ReglaPagoNomina.find({ _id: { $in: ids } }).lean();
  const mapaReglas = new Map(reglasPago.map((r) => [idStr(r._id), r]));
  const idsA = reglasPago.filter((r) => r.tipoRegla === "A").map((r) => r._id);
  const reglasCPorA = await cargarReglasCPorReglaA(idsA);
  const eventosPorA = await cargarEventosPorReglaA(idsA);

  const reglaNomina = elegirReglaNominaParaExtender(reglasPago, fuentes);
  const usables = eventos.filter(
    (e) =>
      !e.omitirDescuentoPrestamo &&
      eventoDesdeFechaInicioCobro(regla, e.fechaProgramada)
  );
  const needed = cuotasNecesariasPrestamo(regla, fuentes);
  let eventosNominaPorCrear = 0;
  let mensajeEventosNomina = "";
  if (reglaNomina && needed > usables.length) {
    const faltan = Math.min(
      MAX_EVENTOS_EXTRA_PRESTAMO,
      Math.max(0, needed - usables.length) + 3
    );
    const fechas = await fechasVirtualesParaPrestamo(
      reglaNomina,
      faltan,
      regla.fechaInicioCobros
    );
    eventosNominaPorCrear = fechas.length;
    const virtuales = fechas.map((fecha, i) =>
      construirEventoVirtualPrestamo(reglaNomina, fecha, 9000 + i)
    );
    eventos = eventos.concat(virtuales).sort(
      (a, b) =>
        new Date(a.fechaProgramada) - new Date(b.fechaProgramada) ||
        (a.numeroCuota || 0) - (b.numeroCuota || 0)
    );
    if (eventosNominaPorCrear > 0) {
      mensajeEventosNomina = `Hay ${usables.length} pago(s) de nómina vigentes y el préstamo requiere ${needed} cuotas. Al autorizar se crearán los eventos adicionales de ${reglaNomina.transaccionNomina || "nómina"} para destinar las cuotas restantes.`;
    }
  } else if (!reglaNomina && needed > usables.length) {
    mensajeEventosNomina =
      "No hay suficientes pagos programados para cubrir el préstamo. Seleccione Asignación nómina (u otro pago periódico tipo A) para generar automáticamente los eventos que falten.";
  }

  let saldo = total;
  const tabla = [];
  const conflictos = [];
  let n = 0;

  for (const evento of eventos) {
    if (saldo <= 0.009) break;
    if (evento.omitirDescuentoPrestamo) continue;
    if (!eventoDesdeFechaInicioCobro(regla, evento.fechaProgramada)) continue;
    const fuente = fuentes.find(
      (f) => idStr(f.reglaPagoId) === idStr(evento.reglaPagoId)
    );
    if (!fuente) continue;
    const reglaPago = mapaReglas.get(idStr(evento.reglaPagoId));
    const descC = descuentoCDeEvento(evento, reglasCPorA, eventosPorA);
    const variable = esEventoVariable(evento, reglaPago);
    const bruto = brutoDeEvento(evento, reglaPago);
    const disponible = variable
      ? redondear2(fuente.monto)
      : redondear2(Math.max(0, bruto - descC));
    const cuota = redondear2(Math.min(fuente.monto, saldo, disponible));
    if (!(cuota > 0.009)) {
      if (!variable && bruto > 0 && fuente.monto > disponible + 0.009) {
        conflictos.push({
          fecha: evento.fechaProgramada,
          bruto,
          disponible,
          cuota: fuente.monto,
          transaccion: evento.transaccionNomina,
        });
      }
      continue;
    }
    n += 1;
    saldo = redondear2(saldo - cuota);
    tabla.push({
      numeroCuota: n,
      fechaMin: evento.fechaProgramada,
      fechaMax: evento.fechaProgramada,
      monto: cuota,
      transaccionNomina: evento.transaccionNomina || fuente.transaccionNomina,
      eventoPagoId: evento.virtual ? undefined : evento._id,
      eventoVirtual: !!evento.virtual,
      montoBrutoPago: variable ? null : bruto,
      descuentoExistente: descC,
      descuentoNuevo: cuota,
      netoProyectado: variable ? null : redondear2(Math.max(0, bruto - descC - cuota)),
      descuentoValido: variable || bruto - descC - cuota >= -0.009,
      saldoDespues: saldo,
    });
  }

  const cuotaEvento = redondear2(
    fuentes.reduce((s, f) => s + (Number(f.monto) || 0), 0)
  );

  let validacionDescuento = { ok: true };
  if (conflictos.length) {
    const c = conflictos[0];
    validacionDescuento = {
      ok: false,
      mensaje: `La cuota de ${c.transaccion} ($${c.cuota.toFixed(
        2
      )}) supera lo disponible en el pago ($${c.disponible.toFixed(
        2
      )}). Reduzca la cuota referencial.`,
    };
  } else if (saldo > 0.05) {
    validacionDescuento = {
      ok: false,
      mensaje: reglaNomina
        ? `No hay suficientes fechas de ${reglaNomina.transaccionNomina || "nómina"} para cubrir el préstamo (quedan $${saldo.toFixed(
            2
          )}). Verifique la frecuencia de la regla de pago.`
        : `No hay suficientes pagos programados para cubrir el préstamo (quedan $${saldo.toFixed(
            2
          )}). Seleccione Asignación nómina para generar los eventos faltantes.`,
    };
  }

  return {
    tabla,
    total,
    cuotaEvento,
    montoPrestado: montos.montoPrestado,
    montoInteres: montos.montoInteres,
    porcentajeInteres: montos.porcentajeInteres,
    saldoPendiente: saldo,
    validacionDescuento,
    eventosNominaPorCrear,
    mensajeEventosNomina,
  };
}

async function calcularDescuentoPrestamoParaPago(evento, montoDisponible) {
  if (evento.tipoRegla === "D") {
    return { monto: 0, lineas: [] };
  }
  const cedula = (evento.cedulaBeneficiario || "").trim();
  if (!cedula) return { monto: 0, lineas: [] };
  const ctx = await contextoDescuentosBeneficiario(cedula);
  const lineas = lineasPrestamoParaEvento(evento, ctx);
  let disponible = redondear2(montoDisponible);
  const aplicadas = [];
  for (const linea of lineas) {
    if (disponible <= 0.009) break;
    const monto = redondear2(Math.min(linea.monto, disponible));
    if (monto > 0.009) {
      aplicadas.push({ ...linea, monto });
      disponible = redondear2(disponible - monto);
    }
  }
  const monto = redondear2(aplicadas.reduce((s, l) => s + l.monto, 0));
  return { monto, lineas: aplicadas };
}

async function omitirDescuentoPrestamoEvento(eventoId, opciones = {}) {
  const evento = await EventoPagoProgramado.findById(eventoId);
  if (!evento) throw new Error("Evento programado no encontrado");
  if (evento.estado !== "Pendiente" && evento.estado !== "Parcial") {
    throw new Error("Solo se puede omitir el préstamo en pagos pendientes");
  }

  const omitir = opciones.omitir !== false;
  const usuario = (opciones.usuario || "").toString().trim();

  if (omitir) {
    if (!evento.omitirDescuentoPrestamo) {
      // Solo préstamos: el anticipo de este pago se sigue descontando.
      const lineas = (await obtenerLineasPrestamoEvento(evento)).filter(
        (l) => !esLineaAnticipo(l)
      );
      const monto = redondear2(
        lineas.reduce((s, l) => s + (Number(l.monto) || 0), 0)
      );
      if (!(monto > 0.009)) {
        throw new Error(
          "Este pago no tiene descuento de préstamo pendiente (los anticipos no se pueden quitar). Verifique el saldo del préstamo."
        );
      }
      // Refinancia: la cuota pasa al siguiente pago disponible.
      const movidos = [];
      for (const linea of lineas) {
        const registro = await moverCuotaPrestamoOmitida(
          linea.reglaDescuentoId,
          evento
        );
        if (registro) movidos.push(registro);
      }
      evento.montoPrestamoOmitido = monto;
      evento.prestamosMovidosOmision = movidos;
      evento.markModified("prestamosMovidosOmision");
    }
    evento.omitirDescuentoPrestamo = true;
    evento.omitirDescuentoPrestamoPor = usuario;
    evento.fechaOmitirDescuentoPrestamo = new Date();
  } else {
    for (const registro of evento.prestamosMovidosOmision || []) {
      await revertirCuotaPrestamoMovida(registro);
    }
    evento.prestamosMovidosOmision = [];
    evento.markModified("prestamosMovidosOmision");
    evento.omitirDescuentoPrestamo = false;
    evento.omitirDescuentoPrestamoPor = usuario;
    evento.fechaOmitirDescuentoPrestamo = new Date();
    evento.montoPrestamoOmitido = 0;
  }
  await evento.save();
  await recalcularPrestamosBeneficiario(evento.cedulaBeneficiario);
  return EventoPagoProgramado.findById(eventoId);
}

async function listarEventosDisponiblesAnticipo(cedula, fechaCobro, opciones = {}) {
  const doc = (cedula || "").trim();
  if (!doc) return [];
  const ctx = await contextoDescuentosBeneficiario(doc);
  const asignado = asignarDescuentosDEnEventos(ctx);
  const fechaObjetivo =
    fechaCalendarioFiltro(fechaCobro) || inicioDelDiaLocal(new Date());
  const listarTodos = !!(opciones && opciones.todos);
  const porRegla = new Map();
  for (const evento of ctx.eventos || []) {
    if (evento.tipoRegla === "D") continue;
    const clave = idStr(evento.reglaPagoId);
    if (!clave) continue;
    if (!porRegla.has(clave)) porRegla.set(clave, []);
    porRegla.get(clave).push(evento);
  }

  const resultado = [];
  for (const [clave, eventosRegla] of porRegla.entries()) {
    const reglaPago = ctx.mapaReglasPago.get(clave);
    if (!reglaPago || !["A", "B"].includes(reglaPago.tipoRegla)) continue;
    const candidatos = listarTodos
      ? eventosRegla.slice()
      : (() => {
          const proximo = elegirEventoMasCercanoAnticipo(
            eventosRegla,
            fechaObjetivo
          );
          return proximo ? [proximo] : [];
        })();
    for (const proximo of candidatos) {
      const info = asignado.get(idStr(proximo._id));
      const variable = !!(info && info.variable);
      const bruto = info
        ? redondear2(info.bruto)
        : brutoDeEvento(proximo, reglaPago);
      const descC = info ? redondear2(info.descC) : 0;
      const descD = info ? redondear2(info.descD) : 0;
      const descuentos = redondear2(descC + descD);
      const disponible =
        variable && !(bruto > 0.009)
          ? null
          : redondear2(Math.max(0, bruto - descuentos));
      if (!variable && !(disponible > 0.009)) continue;
      resultado.push({
        reglaPagoId: reglaPago._id,
        eventoPagoId: proximo._id,
        transaccionNomina:
          proximo.transaccionNomina || reglaPago.transaccionNomina,
        frecuencia: reglaPago.frecuencia,
        parametro: reglaPago.parametro,
        tipoRegla: reglaPago.tipoRegla,
        fechaEvento: proximo.fechaProgramada,
        montoVariable: variable,
        montoPago: bruto,
        montoDescuentoExistente: descuentos,
        montoDisponible: disponible,
        numeroCuota: proximo.numeroCuota,
        totalCuotas: proximo.totalCuotas,
        etiquetaDisplay: `${
          proximo.transaccionNomina || reglaPago.transaccionNomina
        } — ${reglaPago.frecuencia}`,
      });
    }
  }
  return resultado.sort((a, b) => {
    const fa = new Date(a.fechaEvento) - new Date(b.fechaEvento);
    if (fa) return fa;
    return (a.transaccionNomina || "").localeCompare(
      b.transaccionNomina || "",
      "es"
    );
  });
}

module.exports = {
  TRANSACCION_PRESTAMO,
  TRANSACCION_ANTICIPO,
  esReglaAnticipo,
  calcularMontosPrestamo,
  fuentesSeleccionadas,
  cuotaFuenteParaRegla,
  saldoActualPrestamo,
  listarReglasPagoAsociablesPrestamo,
  listarEventosDisponiblesAnticipo,
  recalcularPrestamosBeneficiario,
  aplicarPrestamosSobreReglaPago,
  obtenerLineasPrestamoEvento,
  registrarAbonosPrestamo,
  quitarDescuentosPrestamo,
  construirProyeccionTipoD,
  generarTablaPrestamoPrevia,
  asegurarEventosNominaParaPrestamo,
  calcularDescuentoPrestamoParaPago,
  omitirDescuentoPrestamoEvento,
};
