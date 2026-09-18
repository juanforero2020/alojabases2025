const BitacoraPrestamoNomina = require("../models/bitacoraPrestamoNomina");

function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function registrarBitacoraPrestamo({
  regla,
  tipoMovimiento,
  monto,
  saldoAntes,
  saldoDespues,
  transaccionFinancieraId,
  eventoPagoId,
  eventoCobroId,
  ejecutadoPor,
  notas,
  fecha,
} = {}) {
  if (!regla || !regla._id) return null;
  const valor = redondear2(monto);
  if (!(valor > 0.009)) return null;
  const doc = new BitacoraPrestamoNomina({
    reglaPagoId: regla._id,
    tipoMovimiento,
    fecha: fecha || new Date(),
    monto: valor,
    saldoAntes: redondear2(saldoAntes),
    saldoDespues: redondear2(saldoDespues),
    cedulaBeneficiario: regla.cedulaBeneficiario,
    nombreBeneficiario: regla.nombreBeneficiario,
    tipoBeneficiario: regla.tipoBeneficiario,
    transaccionFinancieraId: transaccionFinancieraId || undefined,
    eventoPagoId: eventoPagoId || undefined,
    eventoCobroId: eventoCobroId || undefined,
    ejecutadoPor: ejecutadoPor || "",
    notas: notas || "",
  });
  await doc.save();
  return doc;
}

async function listarBitacoraPrestamo(reglaPagoId) {
  if (!reglaPagoId) return [];
  return BitacoraPrestamoNomina.find({ reglaPagoId })
    .sort({ fecha: -1, createdAt: -1 })
    .lean();
}

module.exports = {
  registrarBitacoraPrestamo,
  listarBitacoraPrestamo,
};
