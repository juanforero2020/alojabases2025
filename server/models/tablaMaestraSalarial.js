const mongoose = require("mongoose");
const { Schema } = mongoose;

const TablaMaestraSalarialSchema = new Schema(
  {
    cedula: { type: String, required: true, trim: true, unique: true },
    nombre: { type: String, required: true, trim: true },
    cargo: { type: String, required: false, trim: true },
    telefono: { type: String, required: false, trim: true },
    fechaInicioLabores: { type: Date, required: false },
    asignacionSalarial: { type: Number, required: false, default: 0 },
    periodoPago: {
      type: String,
      enum: ["Semanal", "Quincenal", "Mensual"],
      default: "Semanal",
    },
    salarioCalculoVariablesPrestacionales: {
      type: Number,
      required: false,
      default: 0,
    },
    activo: { type: Boolean, default: true },
    usuarioSistemaId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    usuarioSistemaNombre: { type: String, required: false, trim: true },
    usuarioSistemaUsername: { type: String, required: false, trim: true },
    notas: { type: String, required: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "TablaMaestraSalarial",
  TablaMaestraSalarialSchema
);
