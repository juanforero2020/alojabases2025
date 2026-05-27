const mongoose = require("mongoose");
const { Schema } = mongoose;

const AjusteNominaPendienteSchema = new Schema(
  {
    cedulaBeneficiario: { type: String, required: true, trim: true },
    nombreBeneficiario: { type: String, required: false },
    fechaDominical: { type: Date, required: true },
    eventoPagoDominicalId: {
      type: Schema.Types.ObjectId,
      ref: "EventoPagoDominical",
      required: false,
    },
    facturaAnuladaId: {
      type: Schema.Types.ObjectId,
      ref: "Factura",
      required: false,
    },
    facturacionAnterior: { type: Number, default: 0 },
    facturacionNueva: { type: Number, default: 0 },
    montoPagadoAnterior: { type: Number, default: 0 },
    montoCorrecto: { type: Number, default: 0 },
    montoAjuste: { type: Number, required: true },
    motivo: { type: String, required: false },
    estado: {
      type: String,
      enum: ["Pendiente", "Aplicado", "Cancelado"],
      default: "Pendiente",
    },
    transaccionAjusteId: {
      type: Schema.Types.ObjectId,
      ref: "TransaccionesFinancieras",
      required: false,
    },
    eventoAplicacionId: {
      type: Schema.Types.ObjectId,
      ref: "EventoPagoDominical",
      required: false,
    },
    aplicadoPor: { type: String, required: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "AjusteNominaPendiente",
  AjusteNominaPendienteSchema
);
