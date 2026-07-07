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
  return "1.5.4 Pagos extras";
}

async function generarEventosProgramados(regla, opciones = {}) {
  const reglaObj =
    regla && typeof regla.toObject === "function" ? regla.toObject() : { ...regla };

  if (reglaObj.frecuencia === "Dominical") {
    reglaObj.montoVariable = true;
    reglaObj.monto = 0;
  } else if (!reglaObj.monto || reglaObj.monto <= 0) {
    throw new Error("El monto debe ser mayor a cero para autorizar la regla");
  }

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

module.exports = {
  generarEventosProgramados,
  validarAsignacionNominaSinSolapamiento,
  subCuentaTipoA,
};
