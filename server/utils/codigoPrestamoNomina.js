const ContadorNomina = require("../models/contadorNomina");
const { esAnticipoNomina } = require("./cuentasContablesNomina");

function esAnticipoRegla(regla) {
  return esAnticipoNomina(regla && regla.transaccionNomina);
}

function formatearCodigoPrestamo(numero, esAnticipo) {
  const prefijo = esAnticipo ? "ANT" : "PRE";
  const n = Math.max(1, Number(numero) || 1);
  return `${prefijo}-${String(n).padStart(4, "0")}`;
}

async function siguienteCodigoPrestamo(esAnticipo) {
  const clave = esAnticipo ? "anticipoNomina" : "prestamoNomina";
  const doc = await ContadorNomina.findOneAndUpdate(
    { _id: clave },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return formatearCodigoPrestamo(doc.seq, esAnticipo);
}

async function asignarCodigoPrestamoSiFalta(regla) {
  if (!regla || regla.tipoRegla !== "D") return regla;
  if ((regla.codigoPrestamo || "").toString().trim()) return regla;
  regla.codigoPrestamo = await siguienteCodigoPrestamo(esAnticipoRegla(regla));
  return regla;
}

function etiquetaPrestamo(reglaD, evento) {
  const codigo = ((reglaD && reglaD.codigoPrestamo) || "").toString().trim();
  const id = codigo ? ` ${codigo}` : "";
  const pago =
    (evento && (evento.transaccionNomina || evento.transaccion)) || "pago";
  if (esAnticipoRegla(reglaD)) {
    return `Anticipo${id} (${pago})`;
  }
  return `Préstamo${id} (cuota ${pago})`;
}

module.exports = {
  formatearCodigoPrestamo,
  siguienteCodigoPrestamo,
  asignarCodigoPrestamoSiFalta,
  etiquetaPrestamo,
  esAnticipoRegla,
};
