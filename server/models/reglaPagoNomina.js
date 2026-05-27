const mongoose = require("mongoose");
const { Schema } = mongoose;

const OcurrenciaPagoSchema = new Schema(
  {
    fecha: { type: Date, required: true },
    etiqueta: { type: String, required: false },
    monto: { type: Number, required: true, default: 0 },
    estado: {
      type: String,
      enum: ["Pendiente", "Pagado", "Cancelado"],
      default: "Pendiente",
    },
  },
  { _id: true }
);

const MesProyeccionSchema = new Schema(
  {
    mes: { type: String, required: true },
    anio: { type: Number, required: true },
    ocurrencias: { type: [OcurrenciaPagoSchema], default: [] },
  },
  { _id: false }
);

const FilaAmortizacionSchema = new Schema(
  {
    numeroCuota: { type: Number, required: true },
    fechaMin: { type: Date, required: true },
    fechaMax: { type: Date, required: true },
    monto: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const ReglaPagoNominaSchema = new Schema(
  {
    tipoRegla: { type: String, enum: ["A", "B"], default: "A" },
    tipoBeneficiario: {
      type: String,
      enum: ["Interno", "Externo"],
      required: true,
    },
    cedulaBeneficiario: { type: String, required: true, trim: true },
    nombreBeneficiario: { type: String, required: false },
    transaccionNomina: { type: String, required: true },
    centroCosto: { type: String, required: false },
    fuente: { type: String, default: "TMS" },
    frecuencia: {
      type: String,
      enum: ["Unica", "Semanal", "Dominical", "Quincenal", "Mensual", "Anual"],
      required: true,
    },
    parametro: { type: String, required: false },
    diaDelMes: { type: Number, required: false },
    fechaReferenciaAnual: { type: Date, required: false },
    diaInicioVentana: { type: Number, default: 2 },
    diaLimiteVentana: { type: Number, default: 5 },
    vigenciaRegla: { type: String, default: "Finalizacion Contrato" },
    cuotas: { type: Number, default: 1 },
    cuotaEvento: { type: Number, default: 0 },
    modalidadMonto: {
      type: String,
      enum: ["Periodico", "Finito"],
      default: "Periodico",
    },
    montoTotalDeuda: { type: Number, required: false },
    tablaAmortizacion: { type: [FilaAmortizacionSchema], default: [] },
    monto: { type: Number, required: true, default: 0 },
    montoVariable: { type: Boolean, default: false },
    cargoNomina: { type: String, required: false },
    campoMontoTms: {
      type: String,
      default: "asignacionSalarial",
    },
    estadoRegla: {
      type: String,
      enum: ["Borrador", "Autorizada", "Finalizada"],
      default: "Borrador",
    },
    empleadoActivo: { type: Boolean, default: true },
    tablaMaestraSalarialId: {
      type: Schema.Types.ObjectId,
      ref: "TablaMaestraSalarial",
      required: false,
    },
    proveedorId: { type: Schema.Types.ObjectId, ref: "Proveedor", required: false },
    fechaAutorizacion: { type: Date, required: false },
    proyeccion: {
      etiquetaFila: { type: String, default: "Nómina" },
      meses: { type: [MesProyeccionSchema], default: [] },
    },
    mesesProyeccion: { type: Number, default: 3 },
    creadoPor: { type: String, required: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ReglaPagoNomina", ReglaPagoNominaSchema);
