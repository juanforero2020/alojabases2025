export interface TablaMaestraSalarial {
  _id?: string;
  cedula: string;
  nombre: string;
  cargo?: string;
  telefono?: string;
  fechaInicioLabores?: Date | string;
  asignacionSalarial?: number;
  periodoPago?: "Diario" | "Semanal" | "Quincenal" | "Mensual";
  salarioCalculoVariablesPrestacionales?: number;
  activo?: boolean;
  usuarioSistemaId?: string;
  usuarioSistemaNombre?: string;
  usuarioSistemaUsername?: string;
  notas?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AporteIess {
  _id?: string;
  concepto: string;
  codigo?: string;
  porcentaje: number;
  tipo?: "personal" | "patronal" | "total" | "otro";
  orden?: number;
  activo?: boolean;
}

export interface FilaCalculoDominical {
  _id?: string;
  cargo: string;
  valorRangoInferior: number;
  valorRangoSuperior: number;
  activo?: boolean;
}

export interface OtroCargoNomina {
  _id?: string;
  concepto: string;
  codigo?: string;
  fechaLimite?: Date | string | null;
  valor?: number;
  activo?: boolean;
  orden?: number;
}

export interface BeneficiarioNomina {
  tipoBeneficiario: "Interno" | "Externo";
  cedula: string;
  nombre: string;
  cargo?: string;
  usuarioSistemaId?: string;
  usuarioSistemaNombre?: string;
  usuarioSistemaUsername?: string;
  activo?: boolean;
  estadoEmpleado?: string;
  asignacionSalarial?: number;
  salarioCalculoVariablesPrestacionales?: number;
  montoSeguridadSocial?: number;
  porcentajeAportePersonal?: number;
  conceptoAportePersonal?: string;
  periodoPago?: string;
  tablaMaestraSalarialId?: string;
  proveedorId?: string;
}

export interface OpcionBeneficiarioBusqueda {
  tipoBeneficiario: "Interno" | "Externo";
  cedula: string;
  nombre: string;
  etiquetaDisplay: string;
  cargo?: string;
  activo?: boolean;
}

export interface OcurrenciaPagoProyectada {
  fecha: Date | string;
  etiqueta: string;
  monto: number;
  montoBruto?: number;
  montoDescuento?: number;
  montoNeto?: number;
  estado?: string;
}

export interface MesProyeccionPago {
  mes: string;
  anio: number;
  ocurrencias: OcurrenciaPagoProyectada[];
}

export interface ProyeccionPagoNomina {
  etiquetaFila: string;
  meses: MesProyeccionPago[];
}

export interface SimulacionDominical {
  facturacion: {
    fecha: string;
    facturacionBruta: number;
    devoluciones: number;
    facturacionNeta: number;
    cantidadFacturas: number;
    cantidadNotas?: number;
    cantidadDevoluciones: number;
  };
  limiteFacturacion: number;
  liquidaciones: LiquidacionDominicalItem[];
  reglasActivas?: number;
  pendientesLiquidar?: number;
  conEventoProgramado?: number;
  esDomingo: boolean;
  fechaDomingoUsada?: Date | string;
}

export interface LiquidacionDominicalItem {
  reglaId?: string;
  cedula: string;
  nombre: string;
  cargo: string;
  usuarioSistemaNombre?: string;
  facturacionNetaTienda?: number;
  facturacionNetaTrabajador?: number;
  facturacionNetaCalculo?: number;
  baseCalculo?: "tienda" | "trabajador";
  vinculadoUsuario?: boolean;
  monto?: number;
  montoBruto?: number;
  montoNeto?: number;
  ajustesPendientes?: number;
  rangoAplicado?: string;
  limiteFacturacion?: number;
  valorRangoInferior?: number;
  valorRangoSuperior?: number;
  yaLiquidado?: boolean;
  eventoProgramadoPendiente?: boolean;
  sinEventoProgramado?: boolean;
  eventoProgramadoId?: string;
  cargoGrupo?: string;
  cargoPermitidoUsuario?: boolean;
  cupoUsuario?: boolean;
  requiereAutorizacionAdmin?: boolean;
  pagoAdicionalAutorizado?: boolean;
  error?: string;
}

export interface EventoPagoDominical {
  _id?: string;
  fechaDominical: Date | string;
  cedulaBeneficiario: string;
  nombreBeneficiario?: string;
  cargo?: string;
  facturacionNeta?: number;
  montoPagado?: number;
  montoAjustesAplicados?: number;
  montoNetoPagado?: number;
  rangoAplicado?: string;
  estado?: string;
}

export interface AjusteNominaPendiente {
  _id?: string;
  cedulaBeneficiario: string;
  nombreBeneficiario?: string;
  fechaDominical?: Date | string;
  montoAjuste: number;
  motivo?: string;
  estado?: string;
  facturacionAnterior?: number;
  facturacionNueva?: number;
}

export interface FilaAmortizacion {
  numeroCuota: number;
  fechaMin: Date | string;
  fechaMax: Date | string;
  monto: number;
  transaccionNomina?: string;
  eventoPagoId?: string;
  montoBrutoPago?: number;
  descuentoExistente?: number;
  descuentoNuevo?: number;
  netoProyectado?: number;
  descuentoValido?: boolean;
  saldoDespues?: number;
}

/** Regla tipo A listada para vincular descuentos tipo C */
export type ReglaPagoAsociable = ReglaPagoNomina & { etiquetaDisplay?: string };

export interface FuenteDescuentoPrestamo {
  reglaPagoId: string;
  transaccionNomina?: string;
  frecuencia?: string;
  parametro?: string;
  tipoRegla?: string;
  montoVariable?: boolean;
  montoPago?: number;
  monto: number;
  seleccionado?: boolean;
  etiquetaDisplay?: string;
  eventoPagoId?: string;
  fechaEvento?: Date | string;
  montoDisponible?: number;
  montoDescuentoExistente?: number;
  numeroCuota?: number;
  totalCuotas?: number;
}

export interface AbonoPrestamoNomina {
  _id?: string;
  fecha?: Date | string;
  monto: number;
  eventoPagoId?: string;
  eventoCobroId?: string;
  transaccionFinancieraId?: string;
  transaccionNominaOrigen?: string;
  tipoMovimiento?: string;
  saldoAntes?: number;
  saldoDespues?: number;
  notas?: string;
  ejecutadoPor?: string;
}

export interface BitacoraPrestamoNomina {
  _id?: string;
  reglaPagoId?: string;
  tipoMovimiento?: string;
  fecha?: Date | string;
  monto: number;
  saldoAntes?: number;
  saldoDespues?: number;
  ejecutadoPor?: string;
  notas?: string;
  transaccionFinancieraId?: string;
}

export interface CuotaPrestamoPendiente {
  numeroCuota?: number;
  totalCuotas?: number;
  fecha?: Date | string;
  monto?: number;
  montoPagado?: number;
  montoPendiente?: number;
  estado?: string;
}

export interface PrestamoAbonoResumen {
  _id?: string;
  codigoPrestamo?: string;
  tipoRegla?: string;
  estadoRegla?: string;
  tipoBeneficiario?: string;
  cedulaBeneficiario?: string;
  nombreBeneficiario?: string;
  centroCosto?: string;
  fechaDesembolso?: Date | string;
  montoPrestado?: number;
  porcentajeInteres?: number;
  montoInteres?: number;
  montoTotalDeuda?: number;
  montoAbonado?: number;
  saldoPendientePrestamo?: number;
  puedeAbonar?: boolean;
  cuotas?: number;
  cuotaEvento?: number;
  cuotasPendientes?: CuotaPrestamoPendiente[];
  bitacora?: BitacoraPrestamoNomina[];
  montoAbonoCaptura?: number;
}

export interface ReglaPagoNomina {
  _id?: string;
  tipoRegla?: "A" | "B" | "C" | "D";
  esDescuento?: boolean;
  reglaPagoAsociadaId?: string;
  montoBaseTms?: number;
  porcentajeAportePersonal?: number;
  /** Tipo C — Descuentos (no seg. social) */
  modalidadDescuento?: "Por cuota" | "Valor unico";
  conceptoDescuento?: string;
  semanaAplicacion?: "Esta semana" | "Semana especifica";
  fechaAplicacionDescuento?: Date | string;
  tipoBeneficiario: "Interno" | "Externo";
  cedulaBeneficiario: string;
  nombreBeneficiario?: string;
  transaccionNomina: string;
  centroCosto?: string;
  fuente: string;
  frecuencia:
    | "Unica"
    | "Diario"
    | "Semanal"
    | "Dominical"
    | "Quincenal"
    | "Mensual"
    | "Anual";
  parametro?: string;
  diaDelMes?: number;
  fechaReferenciaAnual?: Date | string;
  fechaInicioPagos?: Date | string;
  fechaDesembolso?: Date | string;
  fechaInicioCobros?: Date | string;
  frecuenciaCobro?: "Semanal" | "Quincenal" | "Mensual" | string;
  diaInicioVentana?: number;
  diaLimiteVentana?: number;
  vigenciaRegla?: string;
  cuotas?: number;
  cuotaEvento?: number;
  modalidadMonto?: "Periodico" | "Finito";
  montoTotalDeuda?: number;
  tablaAmortizacion?: FilaAmortizacion[];
  monto: number;
  montoVariable?: boolean;
  cargoNomina?: string;
  campoMontoTms?: string;
  estadoRegla?: "Borrador" | "Autorizada" | "Finalizada";
  empleadoActivo?: boolean;
  tablaMaestraSalarialId?: string;
  proveedorId?: string;
  asociarFacturaPendiente?: boolean;
  facturaProveedorId?: string;
  nFacturaProveedor?: string;
  nSolicitudFactura?: number;
  valorAdeudadoFactura?: number;
  fechaAutorizacion?: Date | string;
  proyeccion?: ProyeccionPagoNomina;
  mesesProyeccion?: number;
  codigoPrestamo?: string;
  montoPrestado?: number;
  porcentajeInteres?: number;
  montoInteres?: number;
  saldoPendientePrestamo?: number;
  fuentesDescuentoPrestamo?: FuenteDescuentoPrestamo[];
  abonosPrestamo?: AbonoPrestamoNomina[];
  creadoPor?: string;
  createdAt?: string;
  notas?: string;
}

export interface LineaDesgloseDescuento {
  reglaDescuentoId?: string;
  transaccionNomina?: string;
  conceptoDescuento?: string | null;
  etiqueta: string;
  codigoPrestamo?: string;
  monto: number;
  notas?: string;
}

export interface DesgloseDescuentosEvento {
  montoBruto?: number;
  montoDescuento: number;
  montoNeto: number;
  lineas: LineaDesgloseDescuento[];
  total: number;
  omitirDescuentoPrestamo?: boolean;
  montoPrestamoOmitido?: number;
  montoDescuentoPrestamo?: number;
  puedeOmitirPrestamo?: boolean;
}

export interface BeneficiarioFiltroPagos {
  cedula: string;
  nombre: string;
  etiquetaDisplay: string;
  cargo?: string;
}

export interface FacturaPendienteProveedor {
  _id: string;
  nFactura: string;
  nSolicitud?: number;
  fecha?: Date | string;
  total: number;
  valorAbonado: number;
  valorAdeudado: number;
  estado: string;
  proveedor: string;
  etiquetaDisplay: string;
}


export interface EventoPagoProgramado {
  _id?: string;
  reglaPagoId?:
    | string
    | {
        _id?: string;
        transaccionNomina?: string;
        centroCosto?: string;
        estadoRegla?: string;
        frecuencia?: string;
        montoVariable?: boolean;
        tipoRegla?: string;
      };
  tipoRegla?: string;
  numeroCuota: number;
  totalCuotas: number;
  fechaProgramada: Date | string;
  fechaMin?: Date | string;
  fechaMax?: Date | string;
  monto: number;
  montoBruto?: number;
  montoDescuento?: number;
  reglaDescuentoId?: string;
  montoPagado?: number;
  centroCosto?: string;
  transaccionNomina?: string;
  codigoPrestamo?: string;
  cedulaBeneficiario?: string;
  nombreBeneficiario?: string;
  modalidadMonto?: string;
  estado?: "Pendiente" | "Parcial" | "Ejecutado" | "Anulado";
  pagosParciales?: PagoParcialNomina[];
  transaccionFinancieraId?: string;
  ejecutadoPor?: string;
  fechaEjecucion?: Date | string;
  pagoFueraPlazoAutorizado?: boolean;
  autorizadoFueraPlazoPor?: string;
  fechaAutorizacionFueraPlazo?: Date | string;
  pagoAdicionalAutorizado?: boolean;
  autorizadoAdicionalPor?: string;
  fechaAutorizacionAdicional?: Date | string;
  notas?: string;
  facturaProveedorId?: string;
  nFacturaProveedor?: string;
  nSolicitudFactura?: number;
  omitirDescuentoPrestamo?: boolean;
  omitirDescuentoPrestamoPor?: string;
  fechaOmitirDescuentoPrestamo?: Date | string;
  montoPrestamoOmitido?: number;
  montoDescuentoPrestamo?: number;
}

/** Fila enriquecida para dx-data-grid (filtros y exportación Excel). */
export interface EventoPagoProgramadoFila extends EventoPagoProgramado {
  rangoFechas?: string;
  cuotaDisplay?: string;
  programadoExport?: number | null;
  descuentoExport?: number;
  saldoExport?: number | null;
  mensajePago?: string | null;
}

export interface EventoCobroPrestamo {
  _id?: string;
  reglaPagoId?: string;
  numeroCuota: number;
  totalCuotas: number;
  fechaProgramada?: Date | string;
  fechaMin?: Date | string;
  fechaMax?: Date | string;
  monto: number;
  montoPagado?: number;
  montoPendiente?: number;
  centroCosto?: string;
  transaccionNomina?: string;
  tipoBeneficiario?: string;
  cedulaBeneficiario?: string;
  nombreBeneficiario?: string;
  estado?: "Pendiente" | "Parcial" | "Ejecutado" | "Anulado" | string;
  transaccionFinancieraId?: string;
  ejecutadoPor?: string;
  fechaEjecucion?: Date | string;
  notas?: string;
  codigoPrestamo?: string;
  saldoPrestamo?: number;
  montoTotalDeuda?: number;
  montoPrestado?: number;
}

export interface PagoParcialNomina {
  _id?: string;
  monto: number;
  fecha?: Date | string;
  transaccionFinancieraId?: string;
  ejecutadoPor?: string;
  notas?: string;
}

export interface ReporteEstadoEmpleado {
  cedula?: string | null;
  centroCosto?: string | null;
  desde?: string | null;
  hasta?: string | null;
  totalProgramado: number;
  totalPagado: number;
  totalPendiente: number;
  porTransaccion: {
    transaccionNomina: string;
    centroCosto?: string;
    programado: number;
    pagado: number;
    pendiente: number;
    cuotas: number;
  }[];
  eventos: EventoPagoProgramado[];
}

export interface NominaConfigGlobal {
  _id?: string;
  clave?: string;
  aportesIess: AporteIess[];
  calculoDominical: {
    limiteFacturacion: number;
    etiquetaRangoInferior?: string;
    etiquetaRangoSuperior?: string;
    filas: FilaCalculoDominical[];
  };
  otrosCargos: OtroCargoNomina[];
}
