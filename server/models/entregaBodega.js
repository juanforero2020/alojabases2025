const mongoose = require("mongoose");
const { Schema } = mongoose;

const EntregaBodegaItemSchema = new Schema(
  {
    producto: { type: Object, required: false },
    productoNombre: { type: String, required: false },
    cantidadFacturada: { type: Number, required: false, default: 0 },
    cantidadEntregada: { type: Number, required: false, default: 0 },
    cantidadDevuelta: { type: Number, required: false, default: 0 },
    estadoItem: { type: String, required: false, default: "ABIERTA" },
    fechaCompromiso: { type: String, required: false, default: "" },
    notas: { type: String, required: false, default: "" },
    historial: { type: Array, required: false, default: [] },
    /** Cerámica / porcelanato: control en cajas + piezas (m² canónico en cantidad*). */
    esMetrosCajaPieza: { type: Boolean, required: false, default: false },
    m2PorCaja: { type: Number, required: false, default: 0 },
    piezasPorCaja: { type: Number, required: false, default: 0 },
    cajasFacturadas: { type: Number, required: false, default: 0 },
    piezasFacturadas: { type: Number, required: false, default: 0 },
  },
  { _id: false }
);

const EntregaBodegaSchema = new Schema(
  {
    consecutivoEntrega: { type: Number, required: true },
    tipoDocumento: { type: String, required: true }, // FACTURA | NOTA_VENTA
    documentoMongoId: { type: String, required: true },
    documentoNumero: { type: Number, required: true },
    sucursal: { type: String, required: false },
    fechaDocumento: { type: String, required: false },
    cliente: { type: Object, required: false },
    clienteNombre: { type: String, required: false, default: "" },
    clienteRuc: { type: String, required: false, default: "" },
    estadoProceso: { type: String, required: false, default: "ABIERTA" },
    items: { type: [EntregaBodegaItemSchema], required: false, default: [] },
    notas: { type: String, required: false, default: "" },
    trazabilidad: { type: Array, required: false, default: [] },
    /** Solicitud de devolución total (bodeguero, día distinto); solo admin ejecuta el reset. */
    solicitudDevolucionPendiente: {
      type: Boolean,
      required: false,
      default: false,
    },
    solicitudDevolucionUsuario: { type: String, required: false, default: "" },
    solicitudDevolucionFecha: { type: String, required: false, default: "" },
  },
  {
    timestamps: true,
  }
);

EntregaBodegaSchema.index(
  { tipoDocumento: 1, documentoMongoId: 1 },
  { unique: true, name: "uniq_documento_entrega_bodega" }
);

/** Consultas filtradas (pendientes + rango de fechas). */
EntregaBodegaSchema.index({ estadoProceso: 1, createdAt: -1 });
EntregaBodegaSchema.index({ documentoNumero: 1, createdAt: -1 });

module.exports = mongoose.model("EntregaBodega", EntregaBodegaSchema);
