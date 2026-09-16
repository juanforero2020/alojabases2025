const mongoose = require("mongoose");
const { Schema } = mongoose;

const EventoCobroPrestamoSchema = new Schema(
  {
    reglaPagoId: {
      type: Schema.Types.ObjectId,
      ref: "ReglaPagoNomina",
      required: true,
    },
    numeroCuota: { type: Number, required: true },
    totalCuotas: { type: Number, required: true },
    fechaProgramada: { type: Date, required: true },
    fechaMin: { type: Date, required: false },
    fechaMax: { type: Date, required: false },
    monto: { type: Number, required: true, default: 0 },
    montoPagado: { type: Number, default: 0 },
    centroCosto: { type: String, required: false },
    transaccionNomina: { type: String, default: "Prestamos" },
    tipoBeneficiario: { type: String, required: false },
    cedulaBeneficiario: { type: String, required: false },
    nombreBeneficiario: { type: String, required: false },
    estado: {
      type: String,
      enum: ["Pendiente", "Parcial", "Ejecutado", "Anulado"],
      default: "Pendiente",
    },
    transaccionFinancieraId: {
      type: Schema.Types.ObjectId,
      ref: "TransaccionesFinancieras",
      required: false,
    },
    ejecutadoPor: { type: String, required: false },
    fechaEjecucion: { type: Date, required: false },
    notas: { type: String, required: false },
  },
  { timestamps: true }
);

EventoCobroPrestamoSchema.index(
  { reglaPagoId: 1, numeroCuota: 1 },
  { unique: true }
);
EventoCobroPrestamoSchema.index({ cedulaBeneficiario: 1, estado: 1 });

module.exports = mongoose.model(
  "EventoCobroPrestamo",
  EventoCobroPrestamoSchema
);
