const mongoose = require("mongoose");
const { Schema } = mongoose;

const EventoPagoDominicalSchema = new Schema(
  {
    fechaDominical: { type: Date, required: true },
    cedulaBeneficiario: { type: String, required: true, trim: true },
    nombreBeneficiario: { type: String, required: false },
    cargo: { type: String, required: false },
    reglaPagoId: {
      type: Schema.Types.ObjectId,
      ref: "ReglaPagoNomina",
      required: false,
    },
    facturacionBruta: { type: Number, default: 0 },
    devolucionesDia: { type: Number, default: 0 },
    facturacionNeta: { type: Number, default: 0 },
    limiteFacturacion: { type: Number, default: 1000 },
    valorRangoAplicado: { type: Number, default: 0 },
    rangoAplicado: {
      type: String,
      enum: ["inferior", "superior"],
      required: false,
    },
    montoPagado: { type: Number, required: true, default: 0 },
    montoAjustesAplicados: { type: Number, default: 0 },
    montoNetoPagado: { type: Number, default: 0 },
    transaccionPagoId: {
      type: Schema.Types.ObjectId,
      ref: "TransaccionesFinancieras",
      required: false,
    },
    estado: {
      type: String,
      enum: ["Pagado", "Revertido"],
      default: "Pagado",
    },
    sucursal: { type: String, required: false },
    liquidadoPor: { type: String, required: false },
    notas: { type: String, required: false },
  },
  { timestamps: true }
);

EventoPagoDominicalSchema.index(
  { fechaDominical: 1, cedulaBeneficiario: 1 },
  { unique: true }
);

module.exports = mongoose.model("EventoPagoDominical", EventoPagoDominicalSchema);
