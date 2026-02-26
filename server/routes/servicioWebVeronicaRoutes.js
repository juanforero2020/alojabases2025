const { Router } = require('express');
const router = Router();
const ServicioWebVeronica = require('../models/servicioWebVeronica')


router.post('/newLog', async (req, res) => {
    const newLog = new ServicioWebVeronica({
        objetoRequest: req.body.objetoRequest,
        objetoResponse: req.body.objetoResponse,
        nroDocumento: req.body.nroDocumento,
        claveAcceso: req.body.claveAcceso,
        sucursal: req.body.sucursal,
        resultado: req.body.resultado,
        fecha: req.body.fecha});
    await newLog.save();
    res.json({status: 'Factura CREADA'});
});

router.post("/getLogsVeronica", async (req, res, next) => {
    var start = req.body.fechaAnterior;
    var end = req.body.fechaActual;
    const logs = await ServicioWebVeronica.find({
      createdAt: {
        $gte: start,
        $lt: end,
      },
    });
    res.json(logs);
  });

router.post("/getLogsVeronicaPorFactura/:documento", async (req, res, next) => {
    const { documento } = req.params;
    const logs = await ServicioWebVeronica.find({
      nroDocumento: documento
    });
    res.json(logs);
  });

router.put("/updateEstadoLog/:id/:estado", async (req, res, next) => {
  const { id } = req.params;
  const { estado } = req.params;
  await ServicioWebVeronica.findByIdAndUpdate(
    id,
    { $set: { resultado: estado } },
    { new: true }
  );
  res.json({ status: "servicioWeb Updated" });
});

module.exports = router;