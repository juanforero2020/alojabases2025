const EventoPagoProgramado = require("../models/eventoPagoProgramado");
const ReglaPagoNomina = require("../models/reglaPagoNomina");
const {
  construirProyeccionConEventos,
  generarFechasPorRegla,
} = require("../utils/proyeccionPagosNomina");
const { aplicarDescuentosEnEventos } = require("../utils/proyeccionPagosTipoC");

function normalizarTexto(valor) {
  return (valor || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function esAsignacionNomina(transaccion) {
  const t = normalizarTexto(transaccion);
  return t.includes("asignacion") && t.includes("nomina");
}

function esDominical(regla) {
  return (
    normalizarTexto(regla?.frecuencia) === "dominical" ||
    normalizarTexto(regla?.transaccionNomina) === "dominical" ||
    normalizarTexto(regla?.transaccionNomina).includes("pago dominical")
  );
}

async function validarDominicalUnicoPorBeneficiario(regla) {
  const reglaObj =
    regla && typeof regla.toObject === "function" ? regla.toObject() : { ...regla };
  if (!esDominical(reglaObj) || !reglaObj.cedulaBeneficiario?.trim()) return;

  const existente = await ReglaPagoNomina.findOne({
    _id: { $ne: regla._id },
    cedulaBeneficiario: reglaObj.cedulaBeneficiario.trim(),
    tipoRegla: "A",
    frecuencia: "Dominical",
    estadoRegla: "Autorizada",
  }).lean();

  if (existente) {
    throw new Error(
      `Ya existe una regla Dominical activa para ${
        reglaObj.nombreBeneficiario || reglaObj.cedulaBeneficiario
      }. Finalice la regla anterior antes de autorizar una nueva.`
    );
  }
}

function claveSemanaCalendario(fecha) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  const dia = d.getDay();
  const ajuste = dia === 0 ? -6 : 1 - dia;
  d.setDate(d.getDate() + ajuste);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function textoSemanaCalendario(claveSemana) {
  const [y, m, d] = claveSemana.split("-").map(Number);
  const fecha = new Date(y, m - 1, d);
  return fecha.toLocaleDateString("es-EC", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

async function validarAsignacionNominaSinSolapamiento(regla, opciones = {}) {
  const reglaObj =
    regla && typeof regla.toObject === "function" ? regla.toObject() : { ...regla };

  if (reglaObj.tipoRegla && reglaObj.tipoRegla !== "A") return;
  if (!esAsignacionNomina(reglaObj.transaccionNomina)) return;
  if (!reglaObj.cedulaBeneficiario?.trim()) return;

  const fechasNuevas = generarFechasPorRegla(reglaObj, opciones);
  if (!fechasNuevas.length) return;

  const existentes = await EventoPagoProgramado.find({
    cedulaBeneficiario: reglaObj.cedulaBeneficiario.trim(),
    tipoRegla: "A",
    estado: { $in: ["Pendiente", "Parcial", "Ejecutado"] },
    reglaPagoId: { $ne: regla._id },
  })
    .populate("reglaPagoId", "transaccionNomina frecuencia parametro estadoRegla")
    .lean();

  const activosAsignacion = existentes.filter((ev) =>
    esAsignacionNomina(
      ev.transaccionNomina || ev.reglaPagoId?.transaccionNomina
    )
  );

  if (!activosAsignacion.length) return;

  const semanasNuevas = new Map(
    fechasNuevas.map((fecha) => [claveSemanaCalendario(fecha), fecha])
  );

  for (const ev of activosAsignacion) {
    if (!ev.fechaProgramada) continue;
    const semanaExistente = claveSemanaCalendario(ev.fechaProgramada);
    if (!semanasNuevas.has(semanaExistente)) continue;

    const nombre =
      reglaObj.nombreBeneficiario || ev.nombreBeneficiario || "el beneficiario";
    const reglaExistente = ev.reglaPagoId;
    const detalleRegla = reglaExistente
      ? [reglaExistente.frecuencia, reglaExistente.parametro]
          .filter(Boolean)
          .join(" ")
          .trim()
      : ev.transaccionNomina || "Asignación nómina";
    const semanaFmt = textoSemanaCalendario(semanaExistente);
    const fechaNuevaFmt = semanasNuevas
      .get(semanaExistente)
      .toLocaleDateString("es-EC");

    throw new Error(
      `Ya existe una asignación de nómina activa para ${nombre} en la semana del ${semanaFmt} ` +
        `(regla actual: ${detalleRegla || "sin detalle"}). ` +
        `La nueva regla también programa un pago para el ${fechaNuevaFmt}. ` +
        `Anule los eventos pendientes de la regla existente antes de autorizar otra asignación de nómina.`
    );
  }
}

function subCuentaTipoA(transaccionNomina) {
  const t = normalizarTexto(transaccionNomina);
  if (t.includes("anticipo")) return "1.5.3 Anticipos nomina";
  if (t.includes("asignacion")) return "1.5.2 Nominas";
  if (t.includes("dominical")) return "1.7.1 Nominas";
  return "1.5.4 Pagos extras";
}

async function generarEventosProgramados(regla, opciones = {}) {
  const reglaObj =
    regla && typeof regla.toObject === "function" ? regla.toObject() : { ...regla };

  if (reglaObj.frecuencia === "Dominical") {
    if (!reglaObj.fechaInicioPagos) {
      throw new Error("Indique el domingo desde el que iniciarán los pagos");
    }
    const fechaInicio = new Date(reglaObj.fechaInicioPagos);
    if (Number.isNaN(fechaInicio.getTime()) || fechaInicio.getDay() !== 0) {
      throw new Error("La fecha de inicio de pagos debe ser un domingo");
    }
    reglaObj.montoVariable = true;
    reglaObj.monto = 0;
  } else if (!reglaObj.monto || reglaObj.monto <= 0) {
    throw new Error("El monto debe ser mayor a cero para autorizar la regla");
  }

  await validarDominicalUnicoPorBeneficiario(regla);
  await validarAsignacionNominaSinSolapamiento(regla, opciones);

  await EventoPagoProgramado.deleteMany({
    reglaPagoId: regla._id,
    estado: { $in: ["Pendiente", "Parcial"] },
  });

  const proyeccion = construirProyeccionConEventos(reglaObj, opciones);
  const creados = [];

  for (const ev of proyeccion.eventos) {
    const doc = new EventoPagoProgramado({
      reglaPagoId: regla._id,
      tipoRegla: "A",
      numeroCuota: ev.numeroCuota,
      totalCuotas: ev.totalCuotas,
      fechaProgramada: ev.fechaProgramada,
      fechaMin: ev.fechaMin || ev.fechaProgramada,
      fechaMax: ev.fechaMax || ev.fechaProgramada,
      monto: ev.monto,
      montoPagado: 0,
      centroCosto: ev.centroCosto,
      transaccionNomina: ev.transaccionNomina,
      cedulaBeneficiario: reglaObj.cedulaBeneficiario,
      nombreBeneficiario: reglaObj.nombreBeneficiario,
      modalidadMonto: reglaObj.frecuencia === "Dominical" ? "Variable" : "Periodico",
      estado: "Pendiente",
    });
    await doc.save();
    creados.push(doc);
  }

  if (reglaObj.frecuencia === "Dominical") {
    proyeccion.etiquetaFila = "Pago dominical (monto variable)";
  }

  const reglasDescuento = await ReglaPagoNomina.find({
    reglaPagoAsociadaId: regla._id,
    tipoRegla: "C",
    estadoRegla: "Autorizada",
  });
  for (const reglaC of reglasDescuento) {
    await aplicarDescuentosEnEventos(reglaC, reglaObj);
  }

  return { proyeccion, eventos: creados };
}

const CUOTAS_EXTENSION_ASIGNACION = 14;

/**
 * Genera N pagos programados adicionales a partir del último evento de la regla
 * (p. ej. al completar la última cuota de Asignación nómina).
 */
async function extenderEventosProgramados(reglaId, opciones = {}) {
  const cantidad = Math.max(
    1,
    Number(opciones.cantidadCuotas) || CUOTAS_EXTENSION_ASIGNACION
  );
  const regla = await ReglaPagoNomina.findById(reglaId);
  if (!regla) throw new Error("Regla de pago no encontrada");
  if (regla.tipoRegla !== "A") {
    throw new Error("Solo se pueden extender reglas de pago tipo A");
  }
  if (regla.estadoRegla !== "Autorizada") {
    throw new Error("La regla debe estar autorizada para extender pagos");
  }
  if (!esAsignacionNomina(regla.transaccionNomina)) {
    throw new Error(
      "La extensión automática solo aplica a Asignación nómina"
    );
  }

  const pendientes = await EventoPagoProgramado.countDocuments({
    reglaPagoId: regla._id,
    estado: { $in: ["Pendiente", "Parcial"] },
  });
  if (pendientes > 0) {
    throw new Error(
      "Aún hay pagos pendientes de esta regla. Complete o anule los pendientes antes de extender."
    );
  }

  const ultimo = await EventoPagoProgramado.findOne({
    reglaPagoId: regla._id,
    estado: { $ne: "Anulado" },
  }).sort({ numeroCuota: -1 });

  if (!ultimo) {
    throw new Error("No hay eventos previos para extender");
  }

  const fechaDesde = new Date(ultimo.fechaProgramada);
  fechaDesde.setDate(fechaDesde.getDate() + 1);
  fechaDesde.setHours(0, 0, 0, 0);

  const reglaObj =
    typeof regla.toObject === "function" ? regla.toObject() : { ...regla };

  const fechasCandidatas = generarFechasPorRegla(reglaObj, {
    fechaDesde,
    fechaHasta: (() => {
      const h = new Date(fechaDesde);
      h.setFullYear(h.getFullYear() + 3);
      h.setHours(23, 59, 59, 999);
      return h;
    })(),
  });

  const fechas = fechasCandidatas.slice(0, cantidad);
  if (!fechas.length) {
    throw new Error(
      "No se pudieron calcular nuevas fechas de pago con la frecuencia de la regla"
    );
  }

  await validarAsignacionNominaSinSolapamiento(regla, {
    fechaDesde,
    fechaHasta: fechas[fechas.length - 1],
  });

  const cuotaInicial = Number(ultimo.numeroCuota) || 0;
  const totalCuotas = cuotaInicial + fechas.length;
  const monto =
    reglaObj.frecuencia === "Dominical" || reglaObj.montoVariable
      ? 0
      : Number(reglaObj.monto) || 0;
  const centroCosto =
    (reglaObj.centroCosto || "").trim() ||
    (reglaObj.nombreBeneficiario || "").trim() ||
    "";
  const modalidadMonto =
    reglaObj.frecuencia === "Dominical" ? "Variable" : "Periodico";

  const creados = [];
  for (let i = 0; i < fechas.length; i++) {
    const fecha = fechas[i];
    const doc = new EventoPagoProgramado({
      reglaPagoId: regla._id,
      tipoRegla: "A",
      numeroCuota: cuotaInicial + i + 1,
      totalCuotas,
      fechaProgramada: fecha,
      fechaMin: fecha,
      fechaMax: fecha,
      monto,
      montoPagado: 0,
      centroCosto,
      transaccionNomina: reglaObj.transaccionNomina,
      cedulaBeneficiario: reglaObj.cedulaBeneficiario,
      nombreBeneficiario: reglaObj.nombreBeneficiario,
      modalidadMonto,
      estado: "Pendiente",
    });
    await doc.save();
    creados.push(doc);
  }

  await EventoPagoProgramado.updateMany(
    { reglaPagoId: regla._id },
    { $set: { totalCuotas } }
  );

  const reglasDescuento = await ReglaPagoNomina.find({
    reglaPagoAsociadaId: regla._id,
    tipoRegla: "C",
    estadoRegla: "Autorizada",
  });
  for (const reglaC of reglasDescuento) {
    await aplicarDescuentosEnEventos(reglaC, reglaObj);
  }

  return {
    eventos: creados,
    eventosGenerados: creados.length,
    totalCuotas,
    cuotaDesde: cuotaInicial + 1,
    cuotaHasta: totalCuotas,
  };
}

function puedeOfrecerExtension(evento, regla, pendientesRegla) {
  if (!evento || evento.estado !== "Ejecutado") return false;
  if (Number(evento.numeroCuota) !== Number(evento.totalCuotas)) return false;
  if (pendientesRegla > 0) return false;
  if (!regla || regla.estadoRegla !== "Autorizada") return false;
  if (evento.tipoRegla !== "A" && regla.tipoRegla !== "A") return false;
  return esAsignacionNomina(
    evento.transaccionNomina || regla.transaccionNomina
  );
}

module.exports = {
  generarEventosProgramados,
  extenderEventosProgramados,
  validarAsignacionNominaSinSolapamiento,
  validarDominicalUnicoPorBeneficiario,
  puedeOfrecerExtension,
  esAsignacionNomina,
  esDominical,
  subCuentaTipoA,
  CUOTAS_EXTENSION_ASIGNACION,
};
