const FacturaProveedor = require("../models/facturaProveedor");
const TransaccionesFacturas = require("../models/transaccionFactura");

function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function escapeRegex(texto) {
  return String(texto || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function totalFactura(factura) {
  return redondear2(
    (Number(factura.total) || 0) - (Number(factura.valorDescuento) || 0)
  );
}

async function abonadoFactura(factura) {
  const filtros = [{ idFactura: String(factura._id) }];
  if (factura.nFactura) {
    filtros.push({ numFactura: factura.nFactura });
  }
  const txs = await TransaccionesFacturas.find({ $or: filtros }).lean();
  const desdeTx = txs.reduce(
    (suma, tx) => suma + (Number(tx.valorCancelado) || 0),
    0
  );
  return redondear2(
    Math.max(
      Number(factura.valorAbonado) || 0,
      Number(factura.valorPagado) || 0,
      desdeTx
    )
  );
}

async function resumenSaldoFactura(factura) {
  const total = totalFactura(factura);
  const abonado = await abonadoFactura(factura);
  const valorAdeudado = redondear2(Math.max(0, total - abonado));
  return { total, abonado, valorAdeudado };
}

function etiquetaFacturaPendiente(factura, valorAdeudado) {
  const numero = factura.nFactura || "S/N";
  const estado = factura.estado || "PENDIENTE";
  return `${numero} — Adeudado $${Number(valorAdeudado || 0).toFixed(2)} (${estado})`;
}

async function listarFacturasPendientesProveedor(nombreProveedor) {
  const nombre = String(nombreProveedor || "").trim();
  if (!nombre) return [];

  const facturas = await FacturaProveedor.find({
    proveedor: { $regex: new RegExp(`^${escapeRegex(nombre)}$`, "i") },
    estado: {
      $regex: /^(pendiente|parcial|cubierta parcial)$/i,
    },
  }).sort({ fecha: -1, createdAt: -1 });

  const listado = [];
  for (const factura of facturas) {
    const saldo = await resumenSaldoFactura(factura);
    if (saldo.valorAdeudado <= 0.01) continue;
    listado.push({
      _id: factura._id,
      nFactura: factura.nFactura || "",
      nSolicitud: factura.nSolicitud,
      fecha: factura.fecha,
      total: saldo.total,
      valorAbonado: saldo.abonado,
      valorAdeudado: saldo.valorAdeudado,
      estado: factura.estado,
      proveedor: factura.proveedor,
      etiquetaDisplay: etiquetaFacturaPendiente(factura, saldo.valorAdeudado),
    });
  }
  return listado;
}

async function validarFacturaParaPago(facturaId) {
  if (!facturaId) {
    throw new Error("Seleccione la factura pendiente del proveedor");
  }
  const factura = await FacturaProveedor.findById(facturaId);
  if (!factura) {
    throw new Error("La factura de proveedor asociada ya no existe");
  }
  const saldo = await resumenSaldoFactura(factura);
  if (saldo.valorAdeudado <= 0.01) {
    throw new Error(
      `La factura ${factura.nFactura || ""} ya está cubierta. No se puede aplicar el pago.`
    );
  }
  return { factura, saldo };
}

async function aplicarPagoFacturaProveedor({
  facturaId,
  monto,
  evento,
  transaccion,
  usuario,
}) {
  if (!facturaId) return null;
  const montoPagar = redondear2(monto);
  if (!(montoPagar > 0)) return null;

  const factura = await FacturaProveedor.findById(facturaId);
  if (!factura) {
    throw new Error("La factura de proveedor asociada ya no existe");
  }

  const saldo = await resumenSaldoFactura(factura);
  if (saldo.valorAdeudado <= 0.01) {
    throw new Error(
      `La factura ${factura.nFactura || ""} ya está cubierta. No se puede aplicar el pago.`
    );
  }

  const aplicado = redondear2(Math.min(montoPagar, saldo.valorAdeudado));
  const abonadoNuevo = redondear2(saldo.abonado + aplicado);
  const saldoNuevo = redondear2(Math.max(0, saldo.total - abonadoNuevo));
  const estado = saldoNuevo <= 0.01 ? "CUBIERTA" : "CUBIERTA PARCIAL";

  factura.valorAbonado = abonadoNuevo;
  factura.valorPagado = abonadoNuevo;
  factura.estado = estado;
  await factura.save();

  const observacionCuota = evento
    ? `Pago nómina tipo B — cuota ${evento.numeroCuota}/${evento.totalCuotas}`
    : "Pago nómina tipo B";
  const observacionSaldo =
    aplicado < montoPagar - 0.01
      ? ` Se aplicaron $${aplicado.toFixed(2)} de $${montoPagar.toFixed(2)} (saldo factura).`
      : "";

  const txFactura = new TransaccionesFacturas({
    fecha: new Date(),
    idFactura: String(factura._id),
    idComprobante: evento?._id
      ? `NOM-${String(evento._id).slice(-8).toUpperCase()}`
      : "NOM",
    numFactura: factura.nFactura,
    fechaFactura: factura.fecha,
    valorFactura: saldo.total,
    valorCancelado: aplicado,
    valorAbonado: saldo.abonado,
    valorSaldos: saldoNuevo,
    fechaPago: new Date().toISOString(),
    proveedor: factura.proveedor,
    usuario: usuario || "",
    estado,
    numeroOrden: factura.nSolicitud,
    observaciones: `${observacionCuota}.${observacionSaldo}`,
  });
  await txFactura.save();

  if (transaccion) {
    transaccion.numFactura = factura.nFactura;
    transaccion.proveedor = factura.proveedor;
    transaccion.ordenCompra = factura.nSolicitud;
    transaccion.documentoVenta = factura.nFactura;
    await transaccion.save();
  }

  return { factura, transaccionFactura: txFactura, aplicado, saldoNuevo, estado };
}

async function aplicarDescuentoFacturaProveedor({
  facturaId,
  monto,
  concepto,
  usuario,
  transaccion,
  regla,
}) {
  if (!facturaId) {
    throw new Error("Seleccione la factura pendiente del proveedor");
  }
  const montoDesc = redondear2(monto);
  if (!(montoDesc > 0.009)) {
    throw new Error("El monto del descuento debe ser mayor a cero");
  }

  const { factura, saldo } = await validarFacturaParaPago(facturaId);
  if (montoDesc > saldo.valorAdeudado + 0.01) {
    throw new Error(
      `El descuento ($${montoDesc.toFixed(
        2
      )}) no puede superar el saldo de la factura ${factura.nFactura || ""} ($${saldo.valorAdeudado.toFixed(
        2
      )})`
    );
  }

  const aplicado = redondear2(Math.min(montoDesc, saldo.valorAdeudado));
  const descuentoNuevo = redondear2(
    (Number(factura.valorDescuento) || 0) + aplicado
  );
  const saldoNuevo = redondear2(Math.max(0, saldo.valorAdeudado - aplicado));
  const estado = saldoNuevo <= 0.01 ? "CUBIERTA" : factura.estado || "PENDIENTE";
  const conceptoTxt = (concepto || "Descuento").toString().trim();
  const notaDescuento = `Descuento nómina tipo C — ${conceptoTxt}: $${aplicado.toFixed(
    2
  )}`;

  factura.valorDescuento = descuentoNuevo;
  factura.estado = estado;
  factura.observaciones = [factura.observaciones, notaDescuento]
    .filter(Boolean)
    .join(" | ");
  await factura.save();

  const txFactura = new TransaccionesFacturas({
    fecha: new Date(),
    idFactura: String(factura._id),
    idComprobante: regla?._id
      ? `NOM-DESC-${String(regla._id).slice(-8).toUpperCase()}`
      : "NOM-DESC",
    numFactura: factura.nFactura,
    fechaFactura: factura.fecha,
    valorFactura: saldo.total,
    valorCancelado: 0,
    valorAbonado: saldo.abonado,
    valorSaldos: saldoNuevo,
    fechaPago: new Date().toISOString(),
    proveedor: factura.proveedor,
    usuario: usuario || "",
    estado,
    numeroOrden: factura.nSolicitud,
    observaciones: notaDescuento,
  });
  await txFactura.save();

  if (transaccion) {
    transaccion.numFactura = factura.nFactura;
    transaccion.proveedor = factura.proveedor;
    transaccion.ordenCompra = factura.nSolicitud;
    transaccion.documentoVenta = factura.nFactura;
    await transaccion.save();
  }

  return {
    factura,
    transaccionFactura: txFactura,
    aplicado,
    saldoNuevo,
    estado,
  };
}

module.exports = {
  listarFacturasPendientesProveedor,
  aplicarPagoFacturaProveedor,
  aplicarDescuentoFacturaProveedor,
  validarFacturaParaPago,
  resumenSaldoFactura,
};
