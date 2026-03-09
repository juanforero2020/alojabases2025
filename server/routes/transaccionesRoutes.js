const { Router } = require("express");
const router = Router();
const Transacciones = require("../models/transacciones");

router.post("/getTransaccionesPorRango", async (req, res, next) => {
  var start = req.body.fechaAnterior;
  var end = req.body.fechaActual;
  const transacciones = await Transacciones.find({
    fecha_transaccion: {
      $gte: start,
      $lt: end,
    },
    //isActive : true
  });
  res.json(transacciones);
});


router.post("/getTransaccionesPorRango2", async (req, res, next) => {
  var start = req.body.fechaAnterior;
  var end = req.body.fechaActual;
  const transacciones = await Transacciones.find({
    createdAt: {
      $gte: start,
      $lt: end,
    },
    isActive : true 
  });
  res.json(transacciones);
});


router.post("/getTransaccionesPorProducto", async (req, res, next) => {
  const transacciones = await Transacciones.find({ producto: req.body.nombre, isActive : true });
  res.json(transacciones);
});


router.post("/getTransaccionesPorProductoGeneral", async (req, res, next) => {
  const transacciones = await Transacciones.find({ producto: req.body.nombre });
  res.json(transacciones);
});


router.post("/getTransaccionesPorProductoMultiple", async (req, res, next) => {
  const transacciones = await Transacciones.find({ producto: { $in:  req.body.array }, isActive: true});
  res.json(transacciones);
});


router.post("/getTransaccionesPorTipoDocumento", async (req, res, next) => {
  const transacciones = await Transacciones.find({ tipo_transaccion: req.body.tipoTransaccion , documento:req.body.NumDocumento, isActive : true  });
  res.json(transacciones);
});


router.post("/getTransaccionesPorNumeroDocumento", async (req, res, next) => {
  const transacciones = await Transacciones.find({ documento:req.body.NumDocumento });
  res.json(transacciones);
});


router.post("/getTransaccionesPorProductoYFecha", async (req, res, next) => {
  var start = req.body.fechaAnterior;
  var end = req.body.fechaActual;
  const transacciones = await Transacciones.find({
    producto: req.body.nombre,
    createdAt: {
      $gte: start,
      $lt: end,
    },
    //isActive : false 
  });
  res.json(transacciones);
});


router.get("/getTransacciones", async (req, res) => {
  const transacciones = await Transacciones.find({ isActive : true });
  res.send(transacciones);
});


router.get("/getTransaccionesGenerales", async (req, res) => {
  const transacciones = await Transacciones.find(/*{ isActive : true }*/);
  res.send(transacciones);
});


router.put("/update/:id", async (req, res, next) => {
  const { id } = req.params;
  const sucursales = {
    idTransaccion: req.body.idTransaccion,
    fecha_transaccion: req.body.fecha_transaccion,
    fecha_mov: req.body.fecha_mov,
    sucursal: req.body.sucursal,
    bodega: req.body.bodega,
    tipo_transaccion: req.body.tipo_transaccion,
    costo_unitario: req.body.costo_unitario,
    totalsuma: req.body.totalsuma,
    documento: req.body.documento,
    rucSucursal: req.body.rucSucursal,
    producto: req.body.producto,
    cajas: req.body.cajas,
    piezas: req.body.piezas,
    usu_autorizado: req.body.usu_autorizado,
    usuario: req.body.usuario,
    observaciones: req.body.observaciones,
    factPro: req.body.factPro,
    valor: req.body.valor,
    cliente: req.body.cliente,
    proveedor: req.body.proveedor,
    maestro: req.body.maestro,
    orden_compra: req.body.orden_compra,
    cantM2: req.body.cantM2,
    movimiento: req.body.movimiento,
    mcaEntregado: req.body.mcaEntregado
  };
  await Transacciones.findByIdAndUpdate(
    id,
    { $set: sucursales },
    { new: true }
  );
  res.json({ status: "Sucursal Actualizada" });
});

router.put("/updateTransaccionEntrega/:id", async (req, res, next) => {
  const { id } = req.params;
  await Transacciones.findByIdAndUpdate( id,{ $set: { mcaEntregado: "SI" } },{ new: true } );
  res.json({ status: "Transaccion Updated" });
});


router.put("/updateEstadoTransaccion/:id", async (req, res, next) => {
  const { id } = req.params;
  await Transacciones.findByIdAndUpdate( id,{ $set: { isActive: false } },{ new: true } );
  res.json({ status: "Transaccion Updated" });
});


router.delete("/delete/:id", async (req, res, next) => {
  await Transacciones.findByIdAndRemove(req.params.id);
  res.json({ status: "Transaccion Eliminada" });
});


router.post("/deletePorDocumento", async (req, res, next) => {
  var tipoDoc = req.body.tipoDocumento;
  var nroDocumento = req.body.nroDocumento;
  await Transacciones.deleteMany({
    documento: nroDocumento,
    tipo_transaccion: tipoDoc,
  });
  res.json({ status: "Transaccion Eliminada" });
});

router.post("/newTransaccion", async (req, res) => {
  const newTransaccion = new Transacciones({
    idTransaccion: req.body.idTransaccion,
    fecha_transaccion: req.body.fecha_transaccion,
    fecha_mov: req.body.fecha_mov,
    sucursal: req.body.sucursal,
    bodega: req.body.bodega,
    tipo_transaccion: req.body.tipo_transaccion,
    totalsuma: req.body.totalsuma,
    documento: req.body.documento,
    rucSucursal: req.body.rucSucursal,
    producto: req.body.producto,
    cajas: req.body.cajas,
    piezas: req.body.piezas,
    costo_unitario: req.body.costo_unitario,
    usu_autorizado: req.body.usu_autorizado,
    usuario: req.body.usuario,
    observaciones: req.body.observaciones,
    factPro: req.body.factPro,
    valor: req.body.valor,
    cliente: req.body.cliente,
    proveedor: req.body.proveedor,
    maestro: req.body.maestro,
    orden_compra: req.body.orden_compra,
    cantM2: req.body.cantM2,
    movimiento: req.body.movimiento,
    mcaEntregado: req.body.mcaEntregado,
    nombreUsuario: req.body.nombreUsuario,
    nombreVendedor: req.body.nombreVendedor,
    isActive: req.body.isActive
  });
  await newTransaccion.save();
  res.json({ status: "Transaccion creada" });
});

// Bulk: insertar muchas transacciones en una sola operación (evita timeouts con +300)
router.post("/newTransaccionesBulk", async (req, res) => {
  const transacciones = req.body.transacciones || [];
  if (!transacciones.length) {
    return res.status(400).json({ status: "No hay transacciones para insertar" });
  }
  const docs = transacciones.map((t) => ({
    idTransaccion: t.idTransaccion,
    fecha_transaccion: t.fecha_transaccion,
    fecha_mov: t.fecha_mov,
    sucursal: t.sucursal,
    bodega: t.bodega,
    tipo_transaccion: t.tipo_transaccion,
    totalsuma: t.totalsuma,
    documento: t.documento,
    rucSucursal: t.rucSucursal,
    producto: t.producto,
    cajas: t.cajas,
    piezas: t.piezas,
    costo_unitario: t.costo_unitario,
    usu_autorizado: t.usu_autorizado,
    usuario: t.usuario,
    observaciones: t.observaciones,
    factPro: t.factPro,
    valor: t.valor,
    cliente: t.cliente,
    proveedor: t.proveedor,
    maestro: t.maestro,
    orden_compra: t.orden_compra,
    cantM2: t.cantM2,
    movimiento: t.movimiento,
    mcaEntregado: t.mcaEntregado,
    nombreUsuario: t.nombreUsuario,
    nombreVendedor: t.nombreVendedor,
    isActive: t.isActive
  }));
  await Transacciones.insertMany(docs);
  res.json({ status: "Transacciones creadas", count: docs.length });
});

// Bulk: marcar muchas transacciones como inactivas en una sola operación
router.put("/updateEstadoTransaccionesBulk", async (req, res) => {
  const ids = req.body.ids || [];
  if (!ids.length) {
    return res.status(400).json({ status: "No hay IDs para actualizar" });
  }
  const result = await Transacciones.updateMany(
    { _id: { $in: ids } },
    { $set: { isActive: false } }
  );
  res.json({ status: "Transacciones actualizadas", modifiedCount: result.modifiedCount });
});

module.exports = router;
