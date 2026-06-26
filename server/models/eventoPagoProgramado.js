const mongoose = require("mongoose");
const { Schema } = mongoose;

const PagoParcialSchema = new Schema(
  {
    monto: { type: Number, required: true },
    fecha: { type: Date, default: Date.now },
    transaccionFinancieraId: {
      type: Schema.Types.ObjectId,
      ref: "TransaccionesFinancieras",
    },
    ejecutadoPor: { type: String, required: false },
    notas: { type: String, required: false },
  },
  { _id: true }
);

const EventoPagoProgramadoSchema = new Schema(
  {
    reglaPagoId: {
      type: Schema.Types.ObjectId,
      ref: "ReglaPagoNomina",
      required: true,
    },
    tipoRegla: { type: String, default: "B" },
    numeroCuota: { type: Number, required: true },
    totalCuotas: { type: Number, required: true },
    fechaProgramada: { type: Date, required: true },
    fechaMin: { type: Date, required: false },
    fechaMax: { type: Date, required: false },
    monto: { type: Number, required: true, default: 0 },
    montoBruto: { type: Number, required: false },
    montoDescuento: { type: Number, default: 0 },
    reglaDescuentoId: {
      type: Schema.Types.ObjectId,
      ref: "ReglaPagoNomina",
      required: false,
    },
    montoPagado: { type: Number, default: 0 },
    centroCosto: { type: String, required: false },
    transaccionNomina: { type: String, required: false },
    cedulaBeneficiario: { type: String, required: false },
    nombreBeneficiario: { type: String, required: false },
    modalidadMonto: { type: String, default: "Periodico" },
    estado: {
      type: String,
      enum: ["Pendiente", "Parcial", "Ejecutado", "Cancelado"],
      default: "Pendiente",
    },
    pagosParciales: { type: [PagoParcialSchema], default: [] },
    transaccionFinancieraId: {
      type: Schema.Types.ObjectId,
      ref: "TransaccionesFinancieras",
      required: false,
    },
    ejecutadoPor: { type: String, required: false },
    fechaEjecucion: { type: Date, required: false },
    pagoFueraPlazoAutorizado: { type: Boolean, default: false },
    autorizadoFueraPlazoPor: { type: String, required: false },
    fechaAutorizacionFueraPlazo: { type: Date, required: false },
    notas: { type: String, required: false },
  },
  { timestamps: true }
);

EventoPagoProgramadoSchema.index(
  { reglaPagoId: 1, numeroCuota: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "EventoPagoProgramado",
  EventoPagoProgramadoSchema
);
