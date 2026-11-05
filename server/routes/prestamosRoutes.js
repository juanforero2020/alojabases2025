const { Router } = require("express");
const router = Router();
const Prestamos = require("../models/prestamos");

// Los préstamos de Nóminas se cobran por nómina o en Abonos de préstamos;
// no se ofrecen para cobro en recibo de caja ni se modifican desde aquí.
const NO_NOMINA = { reglaPagoId: { $exists: false } };

async function rechazarSiEsDeNomina(id, res) {
  const prestamo = await Prestamos.findById(id).lean();
  if (prestamo && prestamo.reglaPagoId) {
    res.status(400).json({
      mensaje:
        "Este préstamo se generó en Nóminas. Gestiónelo desde Nóminas (abonos o finalizar la regla).",
    });
    return true;
  }
  return false;
}

router.get("/getPrestamos", async (req, res) => {
  const cuentas = await Prestamos.find();
  res.send(cuentas);
});

router.post("/getPrestamosPorRUC/:documento", async (req, res, next) => {
  const { documento } = req.params;
  const documentos = await Prestamos.find({ruc: documento, estado:"Activa", ...NO_NOMINA});
  res.json(documentos);
});

router.post("/getPrestamosPorReferencias/:documento", async (req, res, next) => {
  const { documento } = req.params;
  const documentos = await Prestamos.find({comprobanteId: documento, estado:"Activa", ...NO_NOMINA});
  res.json(documentos);
});

router.post("/getPrestamosPorNombre/:nombre", async (req, res, next) => {
  const { nombre } = req.params;
  const documentos = await Prestamos.find({beneficiario: nombre, estado:"Activa", ...NO_NOMINA});
  res.json(documentos);
});

router.get("/getCuentasPorPagarActivas", async (req, res) => {
  const cuentas = await Prestamos.find({estado:"Activa"});
  res.send(cuentas);
});

router.get("/getCuentasPorPagarPendientes", async (req, res) => {
  const cuentas = await Prestamos.find({estado:"Cancelada"});
  res.send(cuentas);
});

router.post("/getPrestamosPorRango", async (req, res, next) => {
  var start = req.body.fechaAnterior;
  var end = req.body.fechaActual;
  const cuentas = await Prestamos.find({
    createdAt: {
      $gte: start,
      $lt: end,
    }
  });
  res.json(cuentas);
});

router.post("/getCuentasPorRUC/:documento", async (req, res, next) => {
  const { documento } = req.params;
  const documentos = await Prestamos.find({rucBeneficiario: documento, estado:"Activa"});
  res.json(documentos);
});

router.post("/getCuentasPorNombre/:nombre", async (req, res, next) => {
  const { nombre } = req.params;
  const documentos = await Prestamos.find({beneficiario: nombre, estado:"Activa"});
  res.json(documentos);
});

router.put("/updateEstado/:id/:estado", async (req, res, next) => {
  const { id } = req.params;
  const { estado } = req.params;
  if (await rechazarSiEsDeNomina(id, res)) return;
  await Prestamos.findByIdAndUpdate(id,{ $set: { estado: estado } },{ new: true });
  res.json({ status: "Cuenta Updated" });
});

router.put("/updateValor/:id/:valor", async (req, res, next) => {
  const { id } = req.params;
  const { valor } = req.params;
  if (await rechazarSiEsDeNomina(id, res)) return;
  await Prestamos.findByIdAndUpdate(id,{ $set: { valor: valor } },{ new: true });
  res.json({ status: "Cuenta Updated" });
});

router.delete("/delete/:id", async (req, res, next) => {
  if (await rechazarSiEsDeNomina(req.params.id, res)) return;
  await Prestamos.findByIdAndRemove(req.params.id);
  res.json({ status: "Cuenta Eliminada" });
});

router.delete("/deleteDoc/:id", async (req, res, next) => {
  await Prestamos.findOneAndDelete( { rCajaId: req.params.id } );
  res.json({ status: "Cuenta Eliminada" });
});

router.post("/newPrestamo", async (req, res) => {
  const newCuenta = new Prestamos({
    fecha: req.body.fecha,
    sucursal: req.body.sucursal,
    beneficiario: req.body.beneficiario,
    ruc: req.body.ruc,
    comprobanteId: req.body.comprobanteId,
    numDocumento: req.body.numDocumento,
    valor: req.body.valor,
    valorDeuda: req.body.valorDeuda,
    estado: req.body.estado,
    notas: req.body.notas
  });
  await newCuenta.save();
  res.json({ status: "Cuenta creada" });
});

module.exports = router;




