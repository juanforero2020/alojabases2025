const { Router } = require('express');
const router = Router();
const DatosConfiguracion = require('../models/datosConfiguracion');

router.get('/getConfiguracion', async (req, res) => {
  try {
    const datos = await DatosConfiguracion.find();
    res.send(datos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const nuevaConfig = new DatosConfiguracion({
      id: req.body.id,
      urlImage: req.body.urlImage,
      minutosInactividad: req.body.minutosInactividad
    });
    const guardado = await nuevaConfig.save();
    res.status(201).send(guardado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const actualizado = await DatosConfiguracion.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          id: req.body.id,
          //urlImage: req.body.urlImage,
          minutosInactividad: req.body.minutosInactividad
        }
      },
      { new: true }
    );
    if (!actualizado) return res.status(404).json({ error: 'Registro no encontrado' });
    res.send(actualizado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const eliminado = await DatosConfiguracion.findByIdAndRemove(req.params.id);
    if (!eliminado) return res.status(404).json({ error: 'Registro no encontrado' });
    res.json({ status: 'Registro eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;