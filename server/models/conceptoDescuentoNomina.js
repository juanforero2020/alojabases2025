const mongoose = require("mongoose");
const { Schema } = mongoose;

const ConceptoDescuentoNominaSchema = new Schema(
  {
    nombre: { type: String, required: true, trim: true, unique: true },
    activo: { type: Boolean, default: true },
    creadoPor: { type: String, required: false, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "ConceptoDescuentoNomina",
  ConceptoDescuentoNominaSchema
);
