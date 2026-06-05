const EventoPagoProgramado = require("../models/eventoPagoProgramado");
const ReglaPagoNomina = require("../models/reglaPagoNomina");
const {
  construirProyeccionConEventos,
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
  subCuentaTipoA,
};
