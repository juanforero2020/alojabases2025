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

const FuenteDescuentoPrestamoSchema = new Schema(
  {
    reglaPagoId: {
      type: Schema.Types.ObjectId,
      ref: "ReglaPagoNomina",
      required: true,
    },
    transaccionNomina: { type: String, required: false },
    frecuencia: { type: String, required: false },
    parametro: { type: String, required: false },
    tipoRegla: { type: String, required: false },
    montoVariable: { type: Boolean, default: false },
    montoPago: { type: Number, default: 0 },
    monto: { type: Number, required: true, default: 0 },
    seleccionado: { type: Boolean, default: false },
    eventoPagoId: {
      type: Schema.Types.ObjectId,
      ref: "EventoPagoProgramado",
      required: false,
    },
    fechaEvento: { type: Date, required: false },
    montoDisponible: { type: Number, required: false },
    montoDescuentoExistente: { type: Number, required: false },
  },
  { _id: false }
);

const AbonoPrestamoSchema = new Schema(
  {
    fecha: { type: Date, default: Date.now },
    monto: { type: Number, required: true, default: 0 },
    eventoPagoId: {
      type: Schema.Types.ObjectId,
      ref: "EventoPagoProgramado",
      required: false,
    },
    transaccionFinancieraId: {
      type: Schema.Types.ObjectId,
      ref: "TransaccionesFinancieras",
      required: false,
    },
    eventoCobroId: {
      type: Schema.Types.ObjectId,
      ref: "EventoCobroPrestamo",
      required: false,
    },
    transaccionNominaOrigen: { type: String, required: false },
    tipoMovimiento: { type: String, required: false },
    saldoAntes: { type: Number, required: false },
    saldoDespues: { type: Number, required: false },
    notas: { type: String, required: false },
    ejecutadoPor: { type: String, required: false },
  },
  { _id: true }
);

const ReglaPagoNominaSchema = new Schema(
  {
    tipoRegla: { type: String, enum: ["A", "B", "C", "D"], default: "A" },
    esDescuento: { type: Boolean, default: false },
    reglaPagoAsociadaId: {
      type: Schema.Types.ObjectId,
      ref: "ReglaPagoNomina",
      required: false,
    },
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
      enum: ["Unica", "Diario", "Semanal", "Dominical", "Quincenal", "Mensual", "Anual"],
      required: true,
    },
    parametro: { type: String, required: false },
    diaDelMes: { type: Number, required: false },
    fechaReferenciaAnual: { type: Date, required: false },
    fechaInicioPagos: { type: Date, required: false },
    fechaDesembolso: { type: Date, required: false },
    fechaInicioCobros: { type: Date, required: false },
    frecuenciaCobro: { type: String, required: false },
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
    montoBaseTms: { type: Number, required: false },
    porcentajeAportePersonal: { type: Number, required: false },
    modalidadDescuento: {
      type: String,
      enum: ["Por cuota", "Valor unico"],
      required: false,
    },
    conceptoDescuento: { type: String, required: false },
    semanaAplicacion: {
      type: String,
      enum: ["Esta semana", "Semana especifica"],
      required: false,
    },
    fechaAplicacionDescuento: { type: Date, required: false },
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
    asociarFacturaPendiente: { type: Boolean, default: false },
    facturaProveedorId: {
      type: Schema.Types.ObjectId,
      ref: "FacturaProveedor",
      required: false,
    },
    nFacturaProveedor: { type: String, required: false },
    nSolicitudFactura: { type: Number, required: false },
    valorAdeudadoFactura: { type: Number, required: false },
    fechaAutorizacion: { type: Date, required: false },
    proyeccion: {
      etiquetaFila: { type: String, default: "Nómina" },
      meses: { type: [MesProyeccionSchema], default: [] },
    },
    mesesProyeccion: { type: Number, default: 3 },
    montoPrestado: { type: Number, required: false, default: 0 },
    porcentajeInteres: { type: Number, required: false, default: 0 },
    montoInteres: { type: Number, required: false, default: 0 },
    saldoPendientePrestamo: { type: Number, required: false },
    fuentesDescuentoPrestamo: {
      type: [FuenteDescuentoPrestamoSchema],
      default: [],
    },
    abonosPrestamo: { type: [AbonoPrestamoSchema], default: [] },
    creadoPor: { type: String, required: false },
    notas: { type: String, required: false, trim: true, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ReglaPagoNomina", ReglaPagoNominaSchema);
