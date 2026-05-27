const mongoose = require("mongoose");
const { Schema } = mongoose;

const AporteIessSchema = new Schema(
  {
    concepto: { type: String, required: true },
    codigo: { type: String, required: false },
    porcentaje: { type: Number, required: true, default: 0 },
    tipo: {
      type: String,
      enum: ["personal", "patronal", "total", "otro"],
      default: "otro",
    },
    orden: { type: Number, default: 0 },
    activo: { type: Boolean, default: true },
  },
  { _id: true }
);

const FilaCalculoDominicalSchema = new Schema(
  {
    cargo: { type: String, required: true },
    valorRangoInferior: { type: Number, required: true, default: 0 },
    valorRangoSuperior: { type: Number, required: true, default: 0 },
    activo: { type: Boolean, default: true },
  },
  { _id: true }
);

const OtroCargoSchema = new Schema(
  {
    concepto: { type: String, required: true },
    codigo: { type: String, required: false },
    fechaLimite: { type: Date, required: false },
    valor: { type: Number, required: false, default: 0 },
    activo: { type: Boolean, default: true },
    orden: { type: Number, default: 0 },
  },
  { _id: true }
);

const NominaConfigGlobalSchema = new Schema(
  {
    clave: { type: String, required: true, unique: true, default: "principal" },
    aportesIess: { type: [AporteIessSchema], default: [] },
    calculoDominical: {
      limiteFacturacion: { type: Number, default: 1000 },
      etiquetaRangoInferior: {
        type: String,
        default: "Rango inferior (facturación menor al límite)",
      },
      etiquetaRangoSuperior: {
        type: String,
        default: "Rango superior (facturación mayor o igual al límite)",
      },
      filas: { type: [FilaCalculoDominicalSchema], default: [] },
    },
    otrosCargos: { type: [OtroCargoSchema], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("NominaConfigGlobal", NominaConfigGlobalSchema);
