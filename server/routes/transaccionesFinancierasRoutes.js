const { Router } = require("express");
const router = Router();
const TransaccionFinanciera = require("../models/transaccionFinanciera");
const Factura = require("../models/factura");
const NotasVenta = require("../models/notasVenta");
const ReciboCaja = require("../models/reciboCaja");
const {
  SUBCUENTAS_CONSULTA_NOMINAS,
} = require("../utils/cuentasContablesNomina");

router.get("/getTransacciones", async (req, res) => {
  const transacciones = await TransaccionFinanciera.find();
  res.send(transacciones);
});

router.get("/getTransaccionesNominas", async (req, res) => {
  const transacciones = await TransaccionFinanciera.find({
    subCuenta: { $in: SUBCUENTAS_CONSULTA_NOMINAS }
  });
  res.send(transacciones);
});


router.post("/getTransaccionesPorRango", async (req, res, next) => {
  var start = req.body.fechaAnterior;
  var end = req.body.fechaActual;
  var sucursal = req.body.sucursal;
  var transacciones = [];
  if(sucursal == ""){
     transacciones = await TransaccionFinanciera.find({
      fecha: {
        $gte: start,
        $lt: end,
      },
    });
  }else{
     transacciones = await TransaccionFinanciera.find({
      fecha: {
        $gte: start,
        $lt: end,
      },
      sucursal:sucursal
    });
  }
  
  res.json(transacciones);
});


router.post("/getTransaccionesNominasPorRango", async (req, res, next) => {
  var start = req.body.fechaAnterior;
  var end = req.body.fechaActual;
  var sucursal = req.body.sucursal;
  var transacciones = [];

  transacciones = await TransaccionFinanciera.find({
    fecha: {
      $gte: start,
      $lt: end,
    },
   subCuenta: { $in: SUBCUENTAS_CONSULTA_NOMINAS }
  });
  res.json(transacciones);
});


router.post("/getTransaccionesNominasPorRangoYBeneficiario", async (req, res, next) => {
  var start = req.body.fechaAnterior;
  var end = req.body.fechaActual;
  var sucursal = req.body.sucursal;
  var transacciones = [];

  transacciones = await TransaccionFinanciera.find({
    fecha: {
      $gte: start,
      $lt: end,
    },
    cliente : sucursal,
    subCuenta: { $in: SUBCUENTAS_CONSULTA_NOMINAS }
  });
  res.json(transacciones);
});


router.post("/getTransaccionesPorTipoDocumento", async (req, res, next) => {
  const transacciones = await TransaccionFinanciera.find({ id_documento: req.body.NumDocumento , tipoTransaccion : req.body.tipoTransaccion});
  res.json(transacciones);
});

router.post("/getTransaccionesPorOrdenCompra", async (req, res, next) => {
  const transacciones = await TransaccionFinanciera.find({ ordenCompra: req.body.ordenCompra});
  res.json(transacciones);
});

/**
 * Caja menor: valida que cada factura / nota de venta del día (no anulada) tenga
 * su recibo de caja y la transacción financiera de ese recibo (rCajaId = "RC" + número).
 * Body: { fechaAnterior, fechaActual, sucursal }.
 */
router.post("/validarVentasCajaMenor", async (req, res, next) => {
  try {
    const { fechaAnterior, fechaActual, sucursal } = req.body || {};
    if (!fechaAnterior || !fechaActual) {
      return res.status(400).json({ mensaje: "Debe enviar el rango de fechas." });
    }
    const filtro = {
      createdAt: { $gte: new Date(fechaAnterior), $lt: new Date(fechaActual) },
      estado: { $ne: "ANULADA" },
    };
    if (sucursal) filtro.sucursal = sucursal;
    const campos = "documento_n sucursal fecha2 total estado cliente.nombreContacto cliente.ruc createdAt";

    const [facturas, notas] = await Promise.all([
      Factura.find(filtro).select(campos).lean(),
      NotasVenta.find(filtro).select(campos).lean(),
    ]);
    const documentos = [
      ...facturas.map((d) => ({ ...d, tipo: "Factura" })),
      ...notas.map((d) => ({ ...d, tipo: "Nota de Venta" })),
    ];
    if (!documentos.length) return res.json({ revisados: 0, pendientes: [] });

    // Recibos activos de esos documentos (pueden haberse creado otro día).
    const recibos = await ReciboCaja.find({
      estadoRecibo: { $ne: "Anulado" },
      $or: ["Factura", "Nota de Venta"].map((tipo) => ({
        docVenta: tipo,
        numDocumento: {
          $in: documentos.filter((d) => d.tipo === tipo).map((d) => String(d.documento_n)),
        },
      })),
    })
      .select("idDocumento docVenta numDocumento")
      .lean();

    const recibosPorDoc = new Map();
    recibos.forEach((r) => {
      const clave = r.docVenta + "|" + String(r.numDocumento);
      if (!recibosPorDoc.has(clave)) recibosPorDoc.set(clave, []);
      recibosPorDoc.get(clave).push(r);
    });

    const rCajaIds = recibos.map((r) => "RC" + r.idDocumento);
    const transacciones = rCajaIds.length
      ? await TransaccionFinanciera.find({ rCajaId: { $in: rCajaIds } })
          .select("rCajaId fecha valor subCuenta isContabilizada")
          .lean()
      : [];
    const conTransaccion = new Set(transacciones.map((t) => String(t.rCajaId)));
    const transaccionesPorRecibo = new Map();
    transacciones.forEach((t) => {
      const id = String(t.rCajaId);
      if (!transaccionesPorRecibo.has(id)) transaccionesPorRecibo.set(id, []);
      transaccionesPorRecibo.get(id).push(t);
    });
    // dd/MM/yyyy en hora de Ecuador (UTC-5).
    const fechaEc = (f) => {
      if (!f) return "";
      const d = new Date(new Date(f).getTime() - 5 * 3600 * 1000);
      const p = (n) => String(n).padStart(2, "0");
      return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
    };

    const pendientes = [];
    documentos.forEach((d) => {
      const lista = recibosPorDoc.get(d.tipo + "|" + String(d.documento_n)) || [];
      const base = {
        tipo: d.tipo,
        documento: d.documento_n,
        sucursal: d.sucursal,
        fecha: d.fecha2 || d.createdAt,
        cliente: (d.cliente && d.cliente.nombreContacto) || "",
        ruc: (d.cliente && d.cliente.ruc) || "",
        total: Number(d.total) || 0,
      };
      if (!lista.length) {
        pendientes.push({
          ...base,
          problema: "SIN_RECIBO",
          recibo: "",
          detalle: `${d.tipo} #${d.documento_n} no tiene recibo de caja ni transacción financiera.`,
        });
        return;
      }
      const sinTx = lista.filter((r) => !conTransaccion.has("RC" + r.idDocumento));
      // Basta con que uno de sus recibos tenga transacción.
      if (sinTx.length === lista.length) {
        const rcs = sinTx.map((r) => "RC" + r.idDocumento).join(", ");
        pendientes.push({
          ...base,
          problema: "SIN_TRANSACCION",
          recibo: rcs,
          detalle: `${d.tipo} #${d.documento_n} tiene el recibo ${rcs} pero falta su transacción financiera.`,
        });
        return;
      }
      // Tiene recibo y transacción, pero ninguna contabilizada: no suma en la caja menor.
      const txs = lista.reduce(
        (acc, r) => acc.concat(transaccionesPorRecibo.get("RC" + r.idDocumento) || []),
        []
      );
      if (!txs.some((t) => t.isContabilizada === true)) {
        const rcs = [...new Set(txs.map((t) => t.rCajaId))].join(", ");
        const descripcion = txs
          .map((t) => `${t.subCuenta || "sin subcuenta"} $${(Number(t.valor) || 0).toFixed(2)} del ${fechaEc(t.fecha)}`)
          .join("; ");
        pendientes.push({
          ...base,
          problema: "NO_CONTABILIZADA",
          recibo: rcs,
          detalle:
            `${d.tipo} #${d.documento_n} tiene el recibo ${rcs} y su transacción financiera ` +
            `(${descripcion}), pero no está contabilizada (isContabilizada = false), ` +
            `por eso no aparece en la caja menor.`,
        });
      }
    });

    pendientes.sort((a, b) => a.tipo.localeCompare(b.tipo) || a.documento - b.documento);
    res.json({ revisados: documentos.length, pendientes });
  } catch (err) {
    res.status(400).json({ mensaje: err.message });
  }
});

// Transacciones financieras de una lista de recibos de caja (rCajaId = "RC" + número).
router.post("/getTransaccionesPorRecibosCaja", async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.rCajaIds)
      ? req.body.rCajaIds.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    if (!ids.length) return res.json([]);
    const transacciones = await TransaccionFinanciera.find({ rCajaId: { $in: ids } })
      .select("rCajaId valor isContabilizada documentoVenta numDocumento")
      .lean();
    res.json(transacciones);
  } catch (err) {
    res.status(400).json({ mensaje: err.message });
  }
});

router.post("/getTransaccionesPorTipoDocumentoYRecibo", async (req, res, next) => {
  const transacciones = await TransaccionFinanciera.find({ numDocumento: req.body.NumDocumento ,rCajaId:req.body.rCajaId, tipoTransaccion : req.body.tipoTransaccion});
  res.json(transacciones);
});

router.post("/getTransaccionesPrestamos", async (req, res, next) => {
  const transacciones = await TransaccionFinanciera.find({ numDocumento: req.body.NumDocumento ,referenciaPrestamo : req.body.rCajaId});
  res.json(transacciones);
});

router.post("/getTransaccionesPrestamosPorComprobante", async (req, res, next) => {
  const transacciones = await TransaccionFinanciera.find({ referenciaPrestamo : req.body.NumDocumento});
  res.json(transacciones);
});

router.post("/getTransaccionesPorTipoDocumentoYRecibo2", async (req, res, next) => {
  const transacciones = await TransaccionFinanciera.find({ numDocumento: req.body.NumDocumento , tipoTransaccion : req.body.tipoTransaccion});
  res.json(transacciones);
});

router.delete("/delete/:id", async (req, res, next) => {
  await TransaccionFinanciera.findByIdAndRemove(req.params.id);
  res.json({ status: "Transaccion Eliminada" });
});

router.put("/updateEstado/:id/:estado", async (req, res, next) => {
  const { id } = req.params;
  const { estado } = req.params;
  await TransaccionFinanciera.findByIdAndUpdate( id,{ $set: { isContabilizada: estado } },{ new: true } );
  res.json({ status: "Transaccion Updated" });
});

router.put("/updateContabilizada/:id/:estado", async (req, res, next) => {
  const { id } = req.params;
  const { estado } = req.params;
  await TransaccionFinanciera.findByIdAndUpdate( id,{ $set: { isContabilizada: estado } },{ new: true } );
  res.json({ status: "Transaccion Updated" });
});

router.post("/newTransaccion", async (req, res) => {
  const newTransaccion = new TransaccionFinanciera({
    fecha: req.body.fecha,
    fechaContable: req.body.fechaContable,
    sucursal: req.body.sucursal,
    cliente: req.body.cliente,
    rCajaId: req.body.rCajaId,
    documentoVenta: req.body.documentoVenta,
    numDocumento: req.body.numDocumento,
    valor: req.body.valor,
    tipoPago: req.body.tipoPago,
    cuenta: req.body.cuenta,
    subCuenta: req.body.subCuenta,
    soporte: req.body.soporte,
    dias: req.body.dias,
    vencimiento: req.body.vencimiento,
    notas: req.body.notas,
    cedula: req.body.cedula,
    tipoCuenta: req.body.tipoCuenta,
    id_documento : req.body.id_documento,
    tipoTransaccion : req.body.tipoTransaccion,
    isContabilizada : req.body.isContabilizada,
    referenciaPrestamo : req.body.referenciaPrestamo,
    beneficiario : req.body.beneficiario,
    proveedor : req.body.proveedor,
    centroCosto : req.body.centroCosto,
    ordenCompra : req.body.ordenCompra,
    numFactura : req.body.numFactura,
    usuario: req.body.usuario
  });
  await newTransaccion.save();
  res.json({ status: "Sucursal creado" });
});

module.exports = router;
