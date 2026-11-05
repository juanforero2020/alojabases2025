const Prestamos = require("../models/prestamos");
const { esAnticipoNomina } = require("./cuentasContablesNomina");

function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Préstamo de nómina (tipo D, no anticipo) que se refleja en el módulo Préstamos. */
function esPrestamoNomina(regla) {
  return (
    !!regla &&
    regla.tipoRegla === "D" &&
    !esAnticipoNomina(regla.transaccionNomina)
  );
}

function estadoModulo(regla, saldo) {
  if (saldo <= 0.009) return "Cancelado";
  return regla.estadoRegla === "Autorizada" ? "Activa" : "Anulado";
}

/**
 * Crea o actualiza el registro del módulo Préstamos a partir de la regla de
 * nómina: valor pendiente = saldo del préstamo; Cancelado al llegar a 0.
 * Un préstamo en borrador no se refleja (si existía, se elimina).
 */
async function sincronizarPrestamoModulo(regla) {
  if (!esPrestamoNomina(regla) || !regla._id) return null;
  const reglaPagoId = String(regla._id);
  const existente = await Prestamos.findOne({ reglaPagoId });

  if (regla.estadoRegla !== "Autorizada" && regla.estadoRegla !== "Finalizada") {
    if (existente) await Prestamos.deleteOne({ _id: existente._id });
    return null;
  }

  const total = redondear2(regla.montoTotalDeuda || regla.monto || 0);
  const saldo = redondear2(
    regla.saldoPendientePrestamo != null ? regla.saldoPendientePrestamo : total
  );
  const codigo = (regla.codigoPrestamo || "").trim();
  const datos = {
    fecha: regla.fechaDesembolso || regla.fechaInicioPagos || regla.fechaAutorizacion,
    sucursal: "matriz",
    beneficiario: regla.nombreBeneficiario || "",
    ruc: regla.cedulaBeneficiario || "",
    comprobanteId: codigo,
    numDocumento: codigo,
    valor: saldo,
    valorDeuda: total,
    estado: estadoModulo(regla, saldo),
    notas: [
      "Préstamo de nómina",
      codigo,
      String(regla.notas || "").trim(),
    ]
      .filter(Boolean)
      .join(" — "),
    reglaPagoId,
    origen: "Nómina",
  };

  if (existente) {
    existente.set(datos);
    if (existente.isModified()) await existente.save();
    return existente;
  }
  // createdAt = fecha de desembolso: el módulo filtra por rango de createdAt.
  const nuevo = new Prestamos({ ...datos, createdAt: datos.fecha || new Date() });
  await nuevo.save();
  return nuevo;
}

/** Carga inicial: refleja los préstamos de nómina ya autorizados. */
async function sincronizarTodosLosPrestamos() {
  const ReglaPagoNomina = require("../models/reglaPagoNomina");
  const reglas = await ReglaPagoNomina.find({
    tipoRegla: "D",
    estadoRegla: { $in: ["Autorizada", "Finalizada"] },
  });
  let n = 0;
  for (const regla of reglas) {
    if (await sincronizarPrestamoModulo(regla)) n += 1;
  }
  return n;
}

module.exports = {
  esPrestamoNomina,
  sincronizarPrestamoModulo,
  sincronizarTodosLosPrestamos,
};
