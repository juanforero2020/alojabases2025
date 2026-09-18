const mongoose = require("mongoose");
const { Schema } = mongoose;

const BitacoraPrestamoNominaSchema = new Schema(
  {
    reglaPagoId: {
      type: Schema.Types.ObjectId,
      ref: "ReglaPagoNomina",
      required: true,
    },
    tipoMovimiento: {
      type: String,
      enum: ["Descuento nomina", "Cobro cuota", "Abono extraordinario"],
      required: true,
    },
    fecha: { type: Date, default: Date.now },
    monto: { type: Number, required: true, default: 0 },
    saldoAntes: { type: Number, required: true, default: 0 },
    saldoDespues: { type: Number, required: true, default: 0 },
    cedulaBeneficiario: { type: String, required: false },
    nombreBeneficiario: { type: String, required: false },
    tipoBeneficiario: { type: String, required: false },
    transaccionFinancieraId: {
      type: Schema.Types.ObjectId,
      ref: "TransaccionesFinancieras",
      required: false,
    },
    eventoPagoId: {
      type: Schema.Types.ObjectId,
      ref: "EventoPagoProgramado",
      required: false,
    },
    eventoCobroId: {
      type: Schema.Types.ObjectId,
      ref: "EventoCobroPrestamo",
      required: false,
    },
    ejecutadoPor: { type: String, required: false },
    notas: { type: String, required: false },
  },
  { timestamps: true }
);

BitacoraPrestamoNominaSchema.index({ reglaPagoId: 1, fecha: -1 });
BitacoraPrestamoNominaSchema.index({ cedulaBeneficiario: 1, fecha: -1 });

module.exports = mongoose.model(
  "BitacoraPrestamoNomina",
  BitacoraPrestamoNominaSchema
);
