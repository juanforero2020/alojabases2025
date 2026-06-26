import { Component, Input, OnInit } from "@angular/core";
import { NominasService } from "src/app/servicios/nominas.service";
import { CentroCostoService } from "src/app/servicios/centro-costo.service";
import { CentroCosto } from "../administracion-cuentas/administracion-cuenta";
import Swal from "sweetalert2";
import {
  AjusteNominaPendiente,
  AporteIess,
  BeneficiarioNomina,
  EventoPagoDominical,
  FilaAmortizacion,
  LiquidacionDominicalItem,
  NominaConfigGlobal,
  ProyeccionPagoNomina,
  ReglaPagoAsociable,
  ReglaPagoNomina,
  SimulacionDominical,
} from "./nominas";

@Component({
  selector: "app-nominas-eventos-pagos",
  templateUrl: "./nominas-eventos-pagos.component.html",
  styleUrls: ["./nominas-eventos-pagos.component.scss"],
})
export class NominasEventosPagosComponent implements OnInit {
  @Input() usuarioNombre = "";

  tiposRegla = ["A", "B", "C"];
  transaccionesNominaC = ["Pago Seguridad Social", "Descuentos"];
  modalidadesDescuento = ["Por cuota", "Valor unico"];
  conceptosDescuento = [
    "Por roturas",
    "Inasistencias a laborar",
    "Pérdidas o daños",
    "Multas",
    "Otros",
  ];
  opcionesSemanaAplicacion = ["Esta semana", "Semana especifica"];
  readonly cuotasSegSocial = 4;
  tiposBeneficiario = ["Interno", "Externo"];
  transaccionesNominaA = [
    "Asignacion nomina",
    /* "Anticipo nomina",
    "Pago extra",
    "Comision", */
  ];
  transaccionesNominaB = [
    "Arriendos",  
    "Pagos puntuales", 
    /* "Préstamos recibidos",
    "Tarjetas de crédito"*/
    "Comisiones por ventas",
    "Bono de navidad",
    "Décimo tercer sueldo",
    "Décimo cuarto sueldo",
    "Vacaciones",
  ];
  fuentesMontoA = ["TMS"];
  frecuenciasA = ["Semanal", "Dominical", "Quincenal", "Mensual"];
  frecuenciasB = ["Unica", "Semanal", "Quincenal", "Mensual", "Anual"];
  vigenciasReglaA = ["Finalizacion Contrato"];
  vigenciasReglaB = ["Indefinido", "Numero de cuotas", "Unica vez"];
  modalidadesMontoB = ["Periodico", "Finito"];
  parametrosAnualB = ["Limite Fecha"];
  centrosCosto: CentroCosto[] = [];
  nombresCentrosCosto: string[] = [];

  parametrosSemanal = [
    "Los lunes",
    "Los martes",
    "Los miercoles",
    "Los jueves",
    "Los viernes",
    "Los sabados",
    "Los domingos",
  ];
  parametrosDominical = ["Los domingos"];
  parametrosQuincenal = ["Dia 1 y 15", "Dia 15 y ultimo dia"];
  parametrosMensual = ["Dia 1 del mes", "Dia 15 del mes", "Ultimo dia del mes"];
  parametrosMensualB = ["El dia x del mes"];

  parametrosActuales: string[] = this.parametrosSemanal;

  reglas: ReglaPagoNomina[] = [];
  reglasPagoAsociables: ReglaPagoAsociable[] = [];
  reglaSeleccionada: ReglaPagoNomina | null = null;
  proyeccionVista: ProyeccionPagoNomina | null = null;
  beneficiario: BeneficiarioNomina | null = null;
  modoEdicion = false;

  formulario: ReglaPagoNomina = this.nuevaRegla();

  fechaDominicalLiquidacion: Date = this.ultimoDomingo();
  simulacionDominical: SimulacionDominical | null = null;
  ajustesPendientes: AjusteNominaPendiente[] = [];
  eventosDominical: EventoPagoDominical[] = [];
  tablaAmortizacion: FilaAmortizacion[] = [];
  amortizacionEditadaManual = false;
  validacionAmortizacion: { ok: boolean; mensaje?: string; suma?: number; pendiente?: number } | null = null;
  validacionDescuentoTipoC: {
    ok: boolean;
    mensaje?: string;
    cuotaMaxima?: number;
    montoBruto?: number;
  } | null = null;
  configGlobal: NominaConfigGlobal | null = null;

  constructor(
    private _nominasService: NominasService,
    private _centroCostoService: CentroCostoService
  ) {}

  get esTipoB(): boolean {
    return this.formulario.tipoRegla === "B";
  }

  get esTipoC(): boolean {
    return this.formulario.tipoRegla === "C";
  }

  get esTipoA(): boolean {
    return this.formulario.tipoRegla === "A" || !this.formulario.tipoRegla;
  }

  get esSeguridadSocial(): boolean {
    return (
      this.esTipoC &&
      (this.formulario.transaccionNomina || "")
        .toLowerCase()
        .includes("seguridad social")
    );
  }

  get esDescuentosGenerales(): boolean {
    return (
      this.esTipoC &&
      (this.formulario.transaccionNomina || "")
        .toLowerCase()
        .includes("descuentos")
    );
  }

  get esDescuentoPorCuota(): boolean {
    return (
      this.esDescuentosGenerales &&
      this.formulario.modalidadDescuento === "Por cuota"
    );
  }

  get esSemanaEspecifica(): boolean {
    return this.formulario.semanaAplicacion === "Semana especifica";
  }

  get cuotaDescuentoCalculada(): number {
    const total = Number(this.formulario.montoTotalDeuda) || 0;
    if (!total) return 0;
    if (this.esSeguridadSocial) {
      return this.cuotaDescuentoSegSocial;
    }
    const n =
      this.formulario.modalidadDescuento === "Por cuota"
        ? Math.max(1, Number(this.formulario.cuotas) || 1)
        : 1;
    return Math.round((total / n) * 100) / 100;
  }

  get tituloTablaDescuento(): string {
    return this.esDescuentosGenerales
      ? "Cuotas del descuento"
      : "Cuotas de descuento (seguridad social)";
  }

  get reglaPagoAsociadaSeleccionada(): ReglaPagoAsociable | null {
    if (!this.formulario.reglaPagoAsociadaId) return null;
    const id = String(this.formulario.reglaPagoAsociadaId);
    return (
      this.reglasPagoAsociables.find((r) => String(r._id) === id) || null
    );
  }

  get montoBrutoReglaAsociada(): number {
    return this.reglaPagoAsociadaSeleccionada?.monto || 0;
  }

  get descuentoTipoCInvalido(): boolean {
    return !!(
      this.esTipoC &&
      this.validacionDescuentoTipoC &&
      !this.validacionDescuentoTipoC.ok
    );
  }

  get hayDescuentosExistentesEnTabla(): boolean {
    return this.tablaAmortizacion.some(
      (f) => (Number(f.descuentoExistente) || 0) > 0
    );
  }

  get cuotaDescuentoSegSocial(): number {
    const total = Number(this.formulario.montoTotalDeuda) || 0;
    return total > 0 ? Math.round((total / this.cuotasSegSocial) * 100) / 100 : 0;
  }

  get ejemploNetoSemanal(): number {
    return Math.max(
      0,
      Math.round(
        (this.montoBrutoReglaAsociada - this.cuotaDescuentoSegSocial) * 100
      ) / 100
    );
  }

  get montoBaseCalculoIess(): number {
    return (
      this.formulario.montoBaseTms ??
      this.beneficiario?.salarioCalculoVariablesPrestacionales ??
      0
    );
  }

  get porcentajeAportePersonal(): number {
    return (
      this.formulario.porcentajeAportePersonal ??
      this.beneficiario?.porcentajeAportePersonal ??
      this.obtenerAportePersonalConfig()?.porcentaje ??
      0
    );
  }

  get conceptoAportePersonal(): string {
    return (
      this.beneficiario?.conceptoAportePersonal ||
      this.obtenerAportePersonalConfig()?.concepto ||
      "Aporte Personal (Trabajador)"
    );
  }

  get esDominical(): boolean {
    return this.esTipoA && this.formulario.frecuencia === "Dominical";
  }

  get esAnual(): boolean {
    return this.esTipoB && this.formulario.frecuencia === "Anual";
  }

  get usaAmortizacion(): boolean {
    return (
      this.esTipoB &&
      (this.formulario.frecuencia === "Anual" ||
        this.formulario.vigenciaRegla === "Unica vez" ||
        (this.formulario.modalidadMonto === "Finito" &&
          this.formulario.parametro === "Limite Fecha"))
    );
  }

  get sumaAmortizacion(): number {
    return this.tablaAmortizacion.reduce(
      (s, f) => s + (Number(f.monto) || 0),
      0
    );
  }

  ngOnInit() {
    this.cargarReglas();
    this.cargarAjustesPendientes();
    this.cargarCentrosCosto();
    this.cargarConfigGlobal();
    this.actualizarParametrosPorFrecuencia();
  }

  cargarConfigGlobal() {
    this._nominasService.getConfigGlobal().subscribe(
      (res) => (this.configGlobal = res),
      () => {}
    );
  }

  obtenerAportePersonalConfig(): AporteIess | null {
    const lista = (this.configGlobal?.aportesIess || []).filter(
      (a) => a.activo !== false
    );
    let aporte = lista.find((a) => a.tipo === "personal");
    if (!aporte) {
      aporte = lista.find((a) => {
        const t = (a.concepto || "").toLowerCase();
        return t.includes("personal") && t.includes("trabajador");
      });
    }
    if (!aporte) {
      aporte = lista.find((a) =>
        (a.concepto || "").toLowerCase().includes("personal")
      );
    }
    return aporte || null;
  }

  calcularMontoSegSocialDesdeBase(base: number): number {
    const aporte = this.obtenerAportePersonalConfig();
    if (!aporte?.porcentaje) return 0;
    return Math.round(((base * aporte.porcentaje) / 100) * 100) / 100;
  }

  cargarCentrosCosto() {
    this._centroCostoService.getCentrosCostos().subscribe(
      (res) => {
        this.centrosCosto = res as CentroCosto[];
        this.nombresCentrosCosto = this.centrosCosto.map((c) => c.nombre);
      },
      () => {}
    );
  }

  ultimoDomingo(): Date {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  }

  nuevaRegla(): ReglaPagoNomina {
    return {
      tipoRegla: "A",
      tipoBeneficiario: "Interno",
      cedulaBeneficiario: "",
      nombreBeneficiario: "",
      transaccionNomina: "Asignacion nomina",
      fuente: "TMS",
      frecuencia: "Semanal",
      parametro: "Los sabados",
      vigenciaRegla: "Finalizacion Contrato",
      monto: 0,
      campoMontoTms: "asignacionSalarial",
      empleadoActivo: true,
      mesesProyeccion: 3,
    };
  }

  nuevaReglaTipoC(): ReglaPagoNomina {
    return {
      tipoRegla: "C",
      tipoBeneficiario: "Interno",
      cedulaBeneficiario: "",
      nombreBeneficiario: "",
      transaccionNomina: "Pago Seguridad Social",
      fuente: "TMS",
      frecuencia: "Semanal",
      parametro: "Los sabados",
      vigenciaRegla: "Finalizacion Contrato",
      cuotas: this.cuotasSegSocial,
      cuotaEvento: 0,
      montoTotalDeuda: 0,
      monto: 0,
      campoMontoTms: "salarioCalculoVariablesPrestacionales",
      esDescuento: true,
      empleadoActivo: true,
      mesesProyeccion: 3,
      modalidadDescuento: "Valor unico",
      conceptoDescuento: this.conceptosDescuento[0],
      semanaAplicacion: "Esta semana",
    };
  }

  nuevaReglaTipoB(): ReglaPagoNomina {
    const hoy = new Date();
    return {
      tipoRegla: "B",
      tipoBeneficiario: "Externo",
      cedulaBeneficiario: "",
      nombreBeneficiario: "",
      transaccionNomina: "Arriendos",
      centroCosto: "",
      fuente: "Manual",
      frecuencia: "Mensual",
      parametro: "El dia x del mes",
      diaDelMes: 1,
      fechaReferenciaAnual: hoy,
      diaInicioVentana: 2,
      diaLimiteVentana: 5,
      vigenciaRegla: "Indefinido",
      cuotas: 1,
      cuotaEvento: 0,
      modalidadMonto: "Periodico",
      montoTotalDeuda: 0,
      tablaAmortizacion: [],
      monto: 0,
      empleadoActivo: true,
      mesesProyeccion: 12,
    };
  }

  onTipoReglaChanged() {
    const cedula = this.formulario.cedulaBeneficiario;
    const nombre = this.formulario.nombreBeneficiario;
    if (this.formulario.tipoRegla === "B") {
      this.formulario = this.nuevaReglaTipoB();
    } else if (this.formulario.tipoRegla === "C") {
      this.formulario = this.nuevaReglaTipoC();
    } else {
      this.formulario = this.nuevaRegla();
    }
    this.formulario.cedulaBeneficiario = cedula;
    this.formulario.nombreBeneficiario = nombre;
    this.beneficiario = null;
    this.reglasPagoAsociables = [];
    this.tablaAmortizacion = [];
    this.amortizacionEditadaManual = false;
    this.actualizarParametrosPorFrecuencia();
    if (this.formulario.cedulaBeneficiario) {
      this.buscarBeneficiario();
    }
  }

  onModalidadMontoChanged() {
    if (this.formulario.modalidadMonto === "Periodico") {
      if (this.formulario.frecuencia !== "Anual") {
        this.formulario.vigenciaRegla = "Indefinido";
      }
      this.formulario.montoTotalDeuda = 0;
      this.tablaAmortizacion = [];
    } else {
      this.generarAmortizacion(true);
    }
  }

  onVigenciaTipoBChanged() {
    if (this.formulario.vigenciaRegla === "Indefinido") {
      if (this.formulario.frecuencia !== "Anual") {
        this.formulario.modalidadMonto = "Periodico";
      }
    } else if (this.formulario.vigenciaRegla === "Numero de cuotas") {
      this.formulario.modalidadMonto = "Finito";
      this.generarAmortizacion(true);
    } else if (this.formulario.vigenciaRegla === "Unica vez") {
      this.formulario.modalidadMonto = "Finito";
      this.generarAmortizacion(true);
    }
  }

  onDatosAmortizacionChanged() {
    if (this.usaAmortizacion && !this.amortizacionEditadaManual) {
      this.generarAmortizacion(true);
    }
  }

  onAmortizacionChanged() {
    this.amortizacionEditadaManual = true;
    this.validarAmortizacionLocal();
  }

  normalizarFechasAmortizacion(
    tabla: FilaAmortizacion[] = []
  ): FilaAmortizacion[] {
    return tabla.map((f) => ({
      ...f,
      fechaMin: f.fechaMin ? new Date(f.fechaMin) : f.fechaMin,
      fechaMax: f.fechaMax ? new Date(f.fechaMax) : f.fechaMax,
    }));
  }

  private redondear2(n: number): number {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  distribuirEnCuotasDescuento(total: number, n: number): number[] {
    const t = this.redondear2(total);
    const cuotas: number[] = [];
    let acum = 0;
    for (let i = 0; i < n; i++) {
      const c = i === n - 1 ? this.redondear2(t - acum) : this.redondear2(t / n);
      cuotas.push(c);
      acum = this.redondear2(acum + c);
    }
    return cuotas;
  }

  obtenerMontosCuotaDescuento(): number[] {
    if (!this.esTipoC) return [];
    const total = Number(this.formulario.montoTotalDeuda) || 0;
    if (!total) return [];

    if (this.tablaAmortizacion.length) {
      return this.tablaAmortizacion.map((f) => Number(f.monto) || 0);
    }

    if (this.esSeguridadSocial) {
      return [this.cuotaDescuentoSegSocial];
    }

    const n =
      this.formulario.modalidadDescuento === "Por cuota"
        ? Math.max(1, Number(this.formulario.cuotas) || 1)
        : 1;
    return this.distribuirEnCuotasDescuento(total, n);
  }

  validarDescuentoVsPagoBruto(): boolean {
    if (!this.esTipoC) {
      this.validacionDescuentoTipoC = null;
      return true;
    }

    const filasInvalidas = this.tablaAmortizacion.filter(
      (f) => f.descuentoValido === false
    );
    if (filasInvalidas.length) {
      const f = filasInvalidas[0];
      const fecha = new Date(f.fechaMin).toLocaleDateString("es-EC");
      const bruto = Number(f.montoBrutoPago) || this.montoBrutoReglaAsociada;
      const existente = Number(f.descuentoExistente) || 0;
      const nuevo = Number(f.descuentoNuevo ?? f.monto) || 0;
      this.validacionDescuentoTipoC = {
        ok: false,
        mensaje:
          filasInvalidas.length === 1
            ? `En ${fecha}: pago $${bruto.toFixed(2)}, ya descontado $${existente.toFixed(2)} + nuevo $${nuevo.toFixed(2)} supera lo disponible. Reduzca el monto, use más cuotas o revise descuentos autorizados.`
            : `En ${filasInvalidas.length} fechas el descuento supera lo disponible (ej. ${fecha}: ya descontado $${existente.toFixed(2)} + nuevo $${nuevo.toFixed(2)} sobre pago $${bruto.toFixed(2)}).`,
        montoBruto: bruto,
      };
      return false;
    }

    const bruto = this.montoBrutoReglaAsociada;
    if (!bruto || bruto <= 0) {
      this.validacionDescuentoTipoC = null;
      return true;
    }

    const montos = this.obtenerMontosCuotaDescuento();
    if (!montos.length) {
      this.validacionDescuentoTipoC = null;
      return true;
    }

    const cuotaMax = Math.max(...montos.map((m) => this.redondear2(m)));
    if (cuotaMax > bruto + 0.009) {
      const total = Number(this.formulario.montoTotalDeuda) || 0;
      const cuotasMinimas = Math.max(2, Math.ceil(total / bruto));
      let sugerencia =
        "Reduzca el monto del descuento o distribúyalo en más cuotas.";
      if (this.esDescuentosGenerales) {
        if (this.formulario.modalidadDescuento !== "Por cuota") {
          sugerencia = `Use modalidad "Por cuota" con al menos ${cuotasMinimas} cuotas, o reduzca el monto total.`;
        } else {
          sugerencia = `Cada cuota debe ser como máximo $${bruto.toFixed(2)}. Aumente las cuotas (mínimo sugerido: ${cuotasMinimas}) o reduzca el monto total.`;
        }
      }

      this.validacionDescuentoTipoC = {
        ok: false,
        mensaje: `El descuento por pago ($${cuotaMax.toFixed(
          2
        )}) no puede superar lo que se recibe ($${bruto.toFixed(
          2
        )}). ${sugerencia}`,
        cuotaMaxima: cuotaMax,
        montoBruto: bruto,
      };
      return false;
    }

    this.validacionDescuentoTipoC = {
      ok: true,
      cuotaMaxima: cuotaMax,
      montoBruto: bruto,
    };
    return true;
  }

  netoLiquidarFila(fila: FilaAmortizacion): number {
    if (fila.netoProyectado != null) {
      return this.redondear2(fila.netoProyectado);
    }
    return this.redondear2(
      this.montoBrutoReglaAsociada - (Number(fila.monto) || 0)
    );
  }

  filaDescuentoExcedeBruto(fila: FilaAmortizacion): boolean {
    if (fila.descuentoValido === false) return true;
    if (fila.descuentoValido === true) return false;
    const bruto = Number(fila.montoBrutoPago) || this.montoBrutoReglaAsociada;
    if (!bruto) return false;
    return (Number(fila.monto) || 0) > bruto + 0.009;
  }

  descuentoNuevoFila(fila: FilaAmortizacion): number {
    return fila.descuentoNuevo != null ? fila.descuentoNuevo : fila.monto;
  }

  brutoFilaDescuento(fila: FilaAmortizacion): number {
    return fila.montoBrutoPago != null
      ? fila.montoBrutoPago
      : this.montoBrutoReglaAsociada;
  }

  validarAmortizacionLocal() {
    const total = Number(this.formulario.montoTotalDeuda) || 0;
    const suma = Math.round(this.sumaAmortizacion * 100) / 100;

    for (const fila of this.tablaAmortizacion) {
      const min = fila.fechaMin ? new Date(fila.fechaMin) : null;
      const max = fila.fechaMax ? new Date(fila.fechaMax) : null;
      if (min && max && min > max) {
        this.validacionAmortizacion = {
          ok: false,
          mensaje: `Cuota ${fila.numeroCuota}: la fecha mínima no puede ser posterior a la fecha máxima`,
          suma,
          pendiente: Math.max(0, total - suma),
        };
        this.formulario.tablaAmortizacion = [...this.tablaAmortizacion];
        return;
      }
    }

    if (suma > total + 0.01) {
      this.validacionAmortizacion = {
        ok: false,
        mensaje: `La suma ($${suma}) supera el monto total ($${total})`,
        suma,
        pendiente: Math.max(0, total - suma),
      };
    } else {
      this.validacionAmortizacion = {
        ok: true,
        suma,
        pendiente: Math.max(0, total - suma),
      };
    }
    this.formulario.tablaAmortizacion = [...this.tablaAmortizacion];
    if (this.tablaAmortizacion.length) {
      this.formulario.cuotaEvento = this.tablaAmortizacion[0].monto;
    }
  }

  generarAmortizacion(forzar = false) {
    if (!this.usaAmortizacion) {
      this.tablaAmortizacion = [];
      return;
    }
    const payload = {
      ...this.formulario,
      tablaAmortizacion: forzar ? [] : this.tablaAmortizacion,
    };
    this._nominasService
      .amortizacionPrevia(payload, forzar || !this.amortizacionEditadaManual)
      .subscribe(
        (res) => {
          if (!this.amortizacionEditadaManual || forzar) {
            this.tablaAmortizacion = this.normalizarFechasAmortizacion(res.tabla);
            this.amortizacionEditadaManual = false;
          }
          this.validacionAmortizacion = res.validacion;
          this.formulario.tablaAmortizacion = [...this.tablaAmortizacion];
          this.formulario.cuotaEvento = res.cuotaEvento;
        },
        () => {}
      );
  }

  sincronizarParametroDiaMes() {
    if (this.esTipoB && this.formulario.parametro === "El dia x del mes") {
      const dia = this.formulario.diaDelMes || 1;
      this.formulario.parametro = `El dia ${dia} del mes`;
    }
  }

  cargarReglas() {
    this._nominasService.getReglasPago().subscribe(
      (res) => {
        this.reglas = res;
      },
      () => {}
    );
  }

  onTipoBeneficiarioChanged(_event?: { event?: Event }) {
    if (_event && !_event.event) return;
    this.formulario.cedulaBeneficiario = "";
    this.formulario.nombreBeneficiario = "";
    this.beneficiario = null;
    this.formulario.monto = 0;
    this.reglasPagoAsociables = [];
    this.formulario.reglaPagoAsociadaId = undefined;
  }

  etiquetaReglaAsociable(regla: ReglaPagoNomina): string {
    return `${regla.transaccionNomina} — ${regla.frecuencia} $${Number(
      regla.monto || 0
    ).toFixed(2)} (${regla.parametro || ""})`;
  }

  mapearReglasAsociables(reglas: ReglaPagoNomina[]): ReglaPagoAsociable[] {
    return reglas.map((r) => ({
      ...r,
      etiquetaDisplay: this.etiquetaReglaAsociable(r),
    }));
  }

  cargarReglasPagoAsociables() {
    const doc = (this.formulario.cedulaBeneficiario || "").trim();
    if (!doc || !this.esTipoC) {
      this.reglasPagoAsociables = [];
      return;
    }
    this._nominasService.getReglasPagoAsociables(doc).subscribe(
      (res) => {
        this.reglasPagoAsociables = this.mapearReglasAsociables(res);
        const idSel = this.formulario.reglaPagoAsociadaId
          ? String(this.formulario.reglaPagoAsociadaId)
          : "";
        if (
          idSel &&
          !res.find((r) => String(r._id) === idSel)
        ) {
          this.formulario.reglaPagoAsociadaId = undefined;
        }
      },
      () => {
        this.reglasPagoAsociables = [];
      }
    );
  }

  onReglaAsociadaSeleccionChanged(event?: { value?: string; event?: Event }) {
    if (event && !event.event) return;
    this.onReglaAsociadaChanged();
  }

  onReglaAsociadaChanged() {
    const regla = this.reglaPagoAsociadaSeleccionada;
    if (regla) {
      this.formulario.frecuencia = regla.frecuencia;
      this.formulario.parametro = regla.parametro;
    }
    this.generarTablaDescuento(true);
  }

  onTransaccionTipoCChanged() {
    if (this.esDescuentosGenerales) {
      this.formulario.fuente = "Manual";
      this.formulario.modalidadDescuento =
        this.formulario.modalidadDescuento || "Valor unico";
      this.formulario.conceptoDescuento =
        this.formulario.conceptoDescuento || this.conceptosDescuento[0];
      this.formulario.semanaAplicacion =
        this.formulario.semanaAplicacion || "Esta semana";
      this.formulario.cuotas = 1;
      this.tablaAmortizacion = [];
    } else if (this.esSeguridadSocial) {
      this.formulario.fuente = "TMS";
      this.formulario.cuotas = this.cuotasSegSocial;
      this.aplicarMontoSegSocialDesdeTms();
    }
    this.generarTablaDescuento(true);
  }

  onModalidadDescuentoChanged() {
    if (this.formulario.modalidadDescuento === "Valor unico") {
      this.formulario.cuotas = 1;
    } else if (!this.formulario.cuotas || this.formulario.cuotas < 2) {
      this.formulario.cuotas = 2;
    }
    this.onMontoDescuentoChanged();
  }

  onSemanaAplicacionChanged() {
    if (this.formulario.semanaAplicacion !== "Semana especifica") {
      this.formulario.fechaAplicacionDescuento = undefined;
    } else if (!this.formulario.fechaAplicacionDescuento) {
      this.formulario.fechaAplicacionDescuento = new Date();
    }
    this.generarTablaDescuento(true);
  }

  onFechaAplicacionDescuentoChanged() {
    this.generarTablaDescuento(true);
  }

  onCuotasDescuentoChanged() {
    this.onMontoDescuentoChanged();
  }

  onMontoDescuentoChanged() {
    this.formulario.monto = this.formulario.montoTotalDeuda || 0;
    this.formulario.cuotaEvento = this.cuotaDescuentoCalculada;
    this.generarTablaDescuento(true);
    if (!this.formulario.reglaPagoAsociadaId) {
      this.validarDescuentoVsPagoBruto();
    }
  }

  aplicarMontoSegSocialDesdeTms() {
    if (!this.beneficiario) return;
    const base = this.beneficiario.salarioCalculoVariablesPrestacionales || 0;
    const total =
      this.beneficiario.montoSeguridadSocial ??
      this.calcularMontoSegSocialDesdeBase(base);
    const porcentaje =
      this.beneficiario.porcentajeAportePersonal ??
      this.obtenerAportePersonalConfig()?.porcentaje ??
      0;
    this.formulario.montoBaseTms = base;
    this.formulario.porcentajeAportePersonal = porcentaje;
    this.formulario.montoTotalDeuda = total;
    this.formulario.monto = total;
    this.formulario.campoMontoTms = "salarioCalculoVariablesPrestacionales";
    this.formulario.cuotaEvento = this.cuotaDescuentoSegSocial;
  }

  generarTablaDescuento(forzar = false) {
    if (!this.esTipoC) {
      this.tablaAmortizacion = [];
      return;
    }
    if (!this.formulario.reglaPagoAsociadaId) {
      this.tablaAmortizacion = [];
      return;
    }
    if (this.esDescuentosGenerales && this.esSemanaEspecifica && !this.formulario.fechaAplicacionDescuento) {
      this.tablaAmortizacion = [];
      return;
    }
    const total = Number(this.formulario.montoTotalDeuda) || 0;
    if (!total) return;

    const payload = { ...this.formulario };
    if (this.esSeguridadSocial) {
      payload.cuotas = this.cuotasSegSocial;
    }

    this._nominasService
      .descuentoPrevia(payload)
      .subscribe(
        (res) => {
          if (forzar || !this.amortizacionEditadaManual) {
            this.tablaAmortizacion = this.normalizarFechasAmortizacion(
              res.tabla
            );
            this.amortizacionEditadaManual = false;
          }
          this.formulario.cuotaEvento = res.cuotaEvento;
          this.validacionAmortizacion = {
            ok: true,
            suma: res.total,
            pendiente: 0,
          };
          this.formulario.tablaAmortizacion = [...this.tablaAmortizacion];
          if (res.validacionDescuento) {
            this.validacionDescuentoTipoC = res.validacionDescuento;
          } else {
            this.validarDescuentoVsPagoBruto();
          }
        },
        () => {
          this.validacionDescuentoTipoC = null;
        }
      );
  }

  onFrecuenciaChanged(_event?: { event?: Event }) {
    if (_event && !_event.event) return;
    this.actualizarParametrosPorFrecuencia();
    this.formulario.parametro = this.parametrosActuales[0] || "";
    if (this.esTipoB) {
      if (this.esAnual) {
        this.formulario.vigenciaRegla = "Unica vez";
        this.formulario.modalidadMonto = "Finito";
        if (!this.formulario.fechaReferenciaAnual) {
          this.formulario.fechaReferenciaAnual = new Date();
        }
        if (!this.formulario.cuotas || this.formulario.cuotas < 1) {
          this.formulario.cuotas = 4;
        }
      }
      this.sincronizarParametroDiaMes();
      this.amortizacionEditadaManual = false;
      this.generarAmortizacion(true);
    }
  }

  actualizarParametrosPorFrecuencia() {
    if (this.esTipoB) {
      switch (this.formulario.frecuencia) {
        case "Anual":
          this.parametrosActuales = this.parametrosAnualB;
          break;
        case "Quincenal":
          this.parametrosActuales = this.parametrosQuincenal;
          break;
        case "Mensual":
          this.parametrosActuales = this.parametrosMensualB;
          if (!this.formulario.diaDelMes) this.formulario.diaDelMes = 1;
          this.sincronizarParametroDiaMes();
          break;
        case "Unica":
          this.parametrosActuales = ["Fecha unica"];
          break;
        default:
          this.parametrosActuales = this.parametrosSemanal;
      }
      return;
    }
    switch (this.formulario.frecuencia) {
      case "Dominical":
        this.parametrosActuales = this.parametrosDominical;
        this.formulario.tipoBeneficiario = "Interno";
        this.formulario.fuente = "FACTURACION_DOMINICAL";
        this.formulario.transaccionNomina = "Pago dominical";
        this.formulario.parametro = "Los domingos";
        this.formulario.montoVariable = true;
        this.formulario.monto = 0;
        break;
      case "Quincenal":
        this.parametrosActuales = this.parametrosQuincenal;
        break;
      case "Mensual":
        this.parametrosActuales = this.parametrosMensual;
        break;
      default:
        this.parametrosActuales = this.parametrosSemanal;
    }
  }

  buscarBeneficiario() {
    const doc = (this.formulario.cedulaBeneficiario || "").trim();
    if (!doc) {
      Swal.fire("Validación", "Ingrese la cédula o RUC del beneficiario", "warning");
      return;
    }
    const peticion =
      this.formulario.tipoBeneficiario === "Interno"
        ? this._nominasService.getBeneficiarioInterno(doc)
        : this._nominasService.getBeneficiarioExterno(doc);

    peticion.subscribe(
      (res) => {
        this.beneficiario = res;
        this.formulario.cedulaBeneficiario = res.cedula;
        this.formulario.nombreBeneficiario = res.nombre;
        this.formulario.empleadoActivo = res.activo !== false;
        this.formulario.tablaMaestraSalarialId = res.tablaMaestraSalarialId;
        this.formulario.proveedorId = res.proveedorId;
        this.formulario.cargoNomina = res.cargo || "";

        if (this.esTipoB && this.formulario.tipoBeneficiario === "Interno") {
          if (!this.formulario.centroCosto?.trim()) {
            this.formulario.centroCosto =
              res.nombre || this.formulario.nombreBeneficiario || "";
          }
        }

        if (this.esTipoC) {
          this.cargarReglasPagoAsociables();
          if (this.esSeguridadSocial) {
            this.aplicarMontoSegSocialDesdeTms();
            this.generarTablaDescuento(true);
          }
        } else if (this.esDominical) {
          this.formulario.fuente = "FACTURACION_DOMINICAL";
          this.formulario.monto = 0;
          this.formulario.montoVariable = true;
        } else if (
          this.formulario.tipoBeneficiario === "Interno" &&
          this.formulario.fuente === "TMS"
        ) {
          this.aplicarMontoDesdeTms();
          if (res.periodoPago && !this.modoEdicion) {
            const mapa: Record<string, ReglaPagoNomina["frecuencia"]> = {
              Semanal: "Semanal",
              Quincenal: "Quincenal",
              Mensual: "Mensual",
            };
            if (mapa[res.periodoPago]) {
              this.formulario.frecuencia = mapa[res.periodoPago];
              this.onFrecuenciaChanged();
            }
          }
        }

        if (res.estadoEmpleado === "INACTIVO") {
          Swal.fire(
            "Empleado inactivo",
            "El contrato laboral está finalizado. Solo podrá guardar borrador; no autorizar pagos.",
            "warning"
          );
        }
      },
      (err) => {
        this.beneficiario = null;
        this.formulario.nombreBeneficiario = "";
        Swal.fire(
          "No encontrado",
          err?.error?.mensaje || "Beneficiario no registrado",
          "error"
        );
      }
    );
  }

  aplicarMontoDesdeTms() {
    if (!this.beneficiario || this.formulario.fuente !== "TMS") {
      return;
    }
    if (this.formulario.tipoBeneficiario !== "Interno") {
      return;
    }
    this.formulario.monto = this.beneficiario.asignacionSalarial || 0;
    this.formulario.campoMontoTms = "asignacionSalarial";
  }

  onFuenteChanged() {
    this.aplicarMontoDesdeTms();
  }

  limpiarFormulario() {
    this.formulario = this.nuevaRegla();
    this.beneficiario = null;
    this.modoEdicion = false;
    this.reglaSeleccionada = null;
    this.proyeccionVista = null;
    this.tablaAmortizacion = [];
    this.amortizacionEditadaManual = false;
    this.validacionAmortizacion = null;
    this.validacionDescuentoTipoC = null;
    this.reglasPagoAsociables = [];
    this.actualizarParametrosPorFrecuencia();
  }

  guardarRegla() {
    if (!this.formulario.cedulaBeneficiario?.trim()) {
      Swal.fire("Validación", "Ingrese la cédula del beneficiario", "warning");
      return;
    }
    if (!this.formulario.nombreBeneficiario?.trim()) {
      Swal.fire(
        "Validación",
        "Busque el beneficiario para cargar el nombre",
        "warning"
      );
      return;
    }
    if (this.esTipoC) {
      if (!this.formulario.reglaPagoAsociadaId) {
        Swal.fire(
          "Validación",
          "Seleccione la regla de pago (tipo A autorizada) a la que se aplicará el descuento",
          "warning"
        );
        return;
      }
      if (!this.reglasPagoAsociables.length) {
        Swal.fire(
          "Validación",
          "No hay reglas de pago tipo A autorizadas para este empleado. Autorice primero la nómina.",
          "warning"
        );
        return;
      }
      const total = Number(this.formulario.montoTotalDeuda) || 0;
      if (!total || total <= 0) {
        Swal.fire(
          "Validación",
          "El monto del descuento debe ser mayor a cero",
          "warning"
        );
        return;
      }
      if (this.esDescuentosGenerales) {
        if (!this.formulario.conceptoDescuento) {
          Swal.fire("Validación", "Seleccione el concepto del descuento", "warning");
          return;
        }
        if (!this.formulario.modalidadDescuento) {
          Swal.fire(
            "Validación",
            "Indique si el descuento es por cuota o valor único",
            "warning"
          );
          return;
        }
        if (!this.formulario.semanaAplicacion) {
          Swal.fire(
            "Validación",
            "Indique en qué semana se aplicará el descuento",
            "warning"
          );
          return;
        }
        if (
          this.esSemanaEspecifica &&
          !this.formulario.fechaAplicacionDescuento
        ) {
          Swal.fire(
            "Validación",
            "Indique la fecha de la semana de aplicación del descuento",
            "warning"
          );
          return;
        }
        if (
          this.formulario.modalidadDescuento === "Por cuota" &&
          (!this.formulario.cuotas || this.formulario.cuotas < 2)
        ) {
          Swal.fire(
            "Validación",
            "Para descuento por cuota indique al menos 2 cuotas",
            "warning"
          );
          return;
        }
        if (!this.tablaAmortizacion.length) {
          Swal.fire(
            "Validación",
            "Genere la vista de cuotas para confirmar las fechas de aplicación",
            "warning"
          );
          return;
        }
        this.formulario.cuotas =
          this.formulario.modalidadDescuento === "Por cuota"
            ? this.formulario.cuotas
            : 1;
      } else {
        this.formulario.cuotas = this.cuotasSegSocial;
      }
      this.formulario.cuotaEvento = this.cuotaDescuentoCalculada;
      this.formulario.monto = total;
      this.formulario.esDescuento = true;
      if (this.esSeguridadSocial && this.beneficiario) {
        this.aplicarMontoSegSocialDesdeTms();
      }
      this.formulario.tablaAmortizacion = [...this.tablaAmortizacion];
      if (!this.validarDescuentoVsPagoBruto()) {
        Swal.fire(
          "Validación",
          this.validacionDescuentoTipoC?.mensaje ||
            "El descuento no puede superar el pago bruto de la regla asociada.",
          "warning"
        );
        return;
      }
    } else if (this.esTipoB) {
      if (!this.formulario.centroCosto?.trim()) {
        Swal.fire(
          "Validación",
          "Seleccione el centro de costo (raíz de la deuda)",
          "warning"
        );
        return;
      }
      this.sincronizarParametroDiaMes();
      if (this.esAnual && !this.formulario.fechaReferenciaAnual) {
        Swal.fire(
          "Validación",
          "Indique la fecha de referencia anual (mes de inicio de pagos)",
          "warning"
        );
        return;
      }
      if (this.usaAmortizacion) {
        this.formulario.tablaAmortizacion = [...this.tablaAmortizacion];
        this.validarAmortizacionLocal();
        if (this.validacionAmortizacion && !this.validacionAmortizacion.ok) {
          Swal.fire(
            "Validación",
            this.validacionAmortizacion.mensaje || "Revise la tabla de amortización",
            "warning"
          );
          return;
        }
        if (
          !this.formulario.montoTotalDeuda ||
          this.formulario.montoTotalDeuda <= 0
        ) {
          Swal.fire("Validación", "Indique el monto total a pagar", "warning");
          return;
        }
        if (!this.formulario.cuotas || this.formulario.cuotas < 1) {
          Swal.fire("Validación", "Indique el número de cuotas", "warning");
          return;
        }
        if (!this.tablaAmortizacion.length) {
          Swal.fire(
            "Validación",
            "Genere la tabla de amortización",
            "warning"
          );
          return;
        }
        this.formulario.cuotaEvento =
          this.tablaAmortizacion[0]?.monto || this.formulario.cuotaEvento;
      } else if (!this.formulario.cuotaEvento || this.formulario.cuotaEvento <= 0) {
        Swal.fire(
          "Validación",
          "La cuota por evento debe ser mayor a cero",
          "warning"
        );
        return;
      }
      if (
        !this.usaAmortizacion &&
        this.formulario.modalidadMonto === "Finito"
      ) {
        if (!this.formulario.cuotas || this.formulario.cuotas < 1) {
          Swal.fire("Validación", "Indique el número de cuotas", "warning");
          return;
        }
        if (
          !this.formulario.montoTotalDeuda ||
          this.formulario.montoTotalDeuda <= 0
        ) {
          Swal.fire(
            "Validación",
            "Indique el monto total de la deuda",
            "warning"
          );
          return;
        }
      }
      this.formulario.fuente = "Manual";
      this.formulario.monto =
        this.formulario.cuotaEvento || this.tablaAmortizacion[0]?.monto || 0;
    } else if (
      !this.esDominical &&
      (!this.formulario.monto || this.formulario.monto <= 0)
    ) {
      Swal.fire("Validación", "El monto debe ser mayor a cero", "warning");
      return;
    }
    if (this.esDominical && this.formulario.tipoBeneficiario !== "Interno") {
      Swal.fire(
        "Validación",
        "El pago dominical solo aplica a beneficiarios internos",
        "warning"
      );
      return;
    }

    const payload: ReglaPagoNomina = {
      ...this.formulario,
      creadoPor: this.usuarioNombre,
    };

    const peticion = this.modoEdicion && this.reglaSeleccionada?._id
      ? this._nominasService.actualizarReglaPago(
          this.reglaSeleccionada._id,
          payload
        )
      : this._nominasService.crearReglaPago(payload);

    peticion.subscribe(
      (res: any) => {
        Swal.fire("Éxito", "Regla guardada en borrador", "success");
        this.cargarReglas();
        if (res?.data?._id) {
          this.reglaSeleccionada = res.data;
          this.formulario = { ...res.data };
          if (res.data.tablaAmortizacion?.length) {
            this.tablaAmortizacion = this.normalizarFechasAmortizacion(
              res.data.tablaAmortizacion
            );
          }
          this.modoEdicion = true;
        }
      },
      (err) => {
        Swal.fire(
          "Error",
          err?.error?.mensaje || "No se pudo guardar la regla",
          "error"
        );
      }
    );
  }

  autorizarRegla() {
    const id = this.reglaSeleccionada?._id;
    if (!id) {
      Swal.fire(
        "Validación",
        "Guarde la regla antes de autorizar",
        "warning"
      );
      return;
    }
    if (this.esTipoC && !this.validarDescuentoVsPagoBruto()) {
      Swal.fire(
        "Validación",
        this.validacionDescuentoTipoC?.mensaje ||
          "El descuento no puede superar el pago bruto de la regla asociada.",
        "warning"
      );
      return;
    }
    if (
      this.formulario.tipoBeneficiario === "Interno" &&
      this.formulario.empleadoActivo === false
    ) {
      Swal.fire(
        "No autorizado",
        "El empleado está INACTIVO. La regla finaliza con el contrato laboral.",
        "error"
      );
      return;
    }

    const textoAutorizar = this.esTipoC
      ? this.esDescuentosGenerales
        ? `Se aplicará descuento (${this.formulario.conceptoDescuento || ""}, ${this.formulario.modalidadDescuento || ""}) en ${this.formulario.semanaAplicacion === "Esta semana" ? "la semana actual" : "la semana indicada"} sobre la regla de pago asociada. Monto total: $${(this.formulario.montoTotalDeuda || 0).toFixed(2)}.`
        : `Se aplicará descuento de seguridad social ($${this.cuotaDescuentoSegSocial.toFixed(2)}/semana en las 4 primeras semanas de cada mes) sobre la regla de pago asociada. Ejemplo: $${this.montoBrutoReglaAsociada.toFixed(2)} − $${this.cuotaDescuentoSegSocial.toFixed(2)} = $${this.ejemploNetoSemanal.toFixed(2)} neto a liquidar.`
      : this.esTipoB
      ? this.usaAmortizacion
        ? `Se programarán ${this.formulario.cuotas} cuotas por un total de $${this.formulario.montoTotalDeuda} (ejecución manual, parcial o total).`
        : `Se programarán pagos ${this.formulario.frecuencia.toLowerCase()} de $${this.formulario.cuotaEvento} (ejecución manual por el encargado).`
      : this.esDominical
      ? `Se programarán pagos dominicales (monto variable). Deberá ejecutarlos manualmente en Pagos Programados.`
      : `Se programarán pagos ${this.formulario.frecuencia.toLowerCase()} de $${this.formulario.monto} (ejecución manual por el encargado).`;

    Swal.fire({
      title: "¿Autorizar evento de pago?",
      text: textoAutorizar,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Autorizar",
      cancelButtonText: "Cancelar",
    }).then((result) => {
      if (!result.value) return;
      this._nominasService.autorizarReglaPago(id).subscribe(
        (res: any) => {
          const msg =
            res.eventosActualizados != null
              ? `Regla autorizada. Descuento aplicado en ${res.eventosActualizados} pago(s) programado(s) pendiente(s).`
              : res.eventosGenerados != null
              ? `Regla autorizada. ${res.eventosGenerados} pagos programados (pendientes de ejecución).`
              : this.esTipoB
              ? "Regla autorizada. Pagos programados pendientes de ejecución."
              : this.esTipoC
              ? "Regla de descuento activa sobre pagos programados."
              : "Evento de pago activo";
          Swal.fire("Autorizado", msg, "success");
          this.limpiarFormulario();
          this.cargarReglas();
        },
        (err) => {
          Swal.fire(
            "Error",
            err?.error?.mensaje || "No se pudo autorizar",
            "error"
          );
        }
      );
    });
  }

  verProyeccion(regla: ReglaPagoNomina) {
    if (regla.estadoRegla === "Autorizada" && regla.proyeccion?.meses?.length) {
      this.proyeccionVista = regla.proyeccion;
      return;
    }
    if (regla._id) {
      this._nominasService
        .getProyeccionRegla(regla._id, regla.mesesProyeccion || 3)
        .subscribe(
          (res) => {
            this.proyeccionVista = res;
          },
          () => Swal.fire("Error", "No se pudo calcular la proyección", "error")
        );
      return;
    }
    this._nominasService.vistaPreviaProyeccion(this.formulario).subscribe(
      (res) => {
        this.proyeccionVista = res;
      },
      () => Swal.fire("Error", "No se pudo calcular la proyección", "error")
    );
  }

  editarRegla(regla: ReglaPagoNomina) {
    if (regla.estadoRegla === "Autorizada") {
      this.reglaSeleccionada = regla;
      this.formulario = { ...regla };
      this.tablaAmortizacion = regla.tablaAmortizacion
        ? this.normalizarFechasAmortizacion([...regla.tablaAmortizacion])
        : [];
      if (regla.tipoRegla === "C" && regla.cedulaBeneficiario) {
        this._nominasService
          .getReglasPagoAsociables(regla.cedulaBeneficiario)
          .subscribe((res) => {
            this.reglasPagoAsociables = this.mapearReglasAsociables(res);
            this.validarDescuentoVsPagoBruto();
          });
        this.buscarBeneficiario();
      }
      this.verProyeccion(regla);
      return;
    }
    this.modoEdicion = true;
    this.reglaSeleccionada = regla;
    this.formulario = { ...regla };
    if (regla.tipoRegla === "C") {
      this.tablaAmortizacion = regla.tablaAmortizacion
        ? this.normalizarFechasAmortizacion([...regla.tablaAmortizacion])
        : [];
      if (regla.fechaAplicacionDescuento) {
        this.formulario.fechaAplicacionDescuento = new Date(
          regla.fechaAplicacionDescuento
        );
      }
      this.actualizarParametrosPorFrecuencia();
      if (regla.cedulaBeneficiario) {
        this.buscarBeneficiario();
      }
      this.validarDescuentoVsPagoBruto();
      return;
    }
    if (regla.tipoRegla === "B" && !regla.cuotaEvento) {
      this.formulario.cuotaEvento = regla.monto;
    }
    this.tablaAmortizacion = regla.tablaAmortizacion
      ? this.normalizarFechasAmortizacion([...regla.tablaAmortizacion])
      : [];
    this.amortizacionEditadaManual = this.tablaAmortizacion.length > 0;
    this.actualizarParametrosPorFrecuencia();
    if (this.usaAmortizacion && !this.tablaAmortizacion.length) {
      this.generarAmortizacion(true);
    } else if (this.tablaAmortizacion.length) {
      this.validarAmortizacionLocal();
    }
    if (regla.cedulaBeneficiario) {
      this.buscarBeneficiario();
    }
  }

  eliminarRegla(regla: ReglaPagoNomina) {
    Swal.fire({
      title: "¿Eliminar regla?",
      text: regla.nombreBeneficiario,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
    }).then((result) => {
      if (!result.value) return;
      this._nominasService.eliminarReglaPago(regla._id).subscribe(
        () => {
          Swal.fire("Eliminada", "", "success");
          if (this.reglaSeleccionada?._id === regla._id) {
            this.limpiarFormulario();
          }
          this.cargarReglas();
        },
        (err) =>
          Swal.fire("Error", err?.error?.mensaje || "No se pudo eliminar", "error")
      );
    });
  }

  finalizarRegla(regla: ReglaPagoNomina) {
    const textoFinalizar =
      regla.tipoRegla === "C"
        ? "Se quitará el descuento de los pagos programados pendientes de la regla asociada. Los pagos ya ejecutados no se modifican."
        : "Se eliminarán los pagos programados pendientes de esta regla. Los ya ejecutados se conservan.";
    Swal.fire({
      title: "¿Finalizar regla?",
      text: textoFinalizar,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Finalizar",
      cancelButtonText: "Cancelar",
    }).then((result) => {
      if (!result.value) return;
      this._nominasService.finalizarReglaPago(regla._id).subscribe(
        (res: any) => {
          const n = res?.eventosEliminados ?? 0;
          Swal.fire(
            "Finalizada",
            n
              ? `Regla finalizada. ${n} pago(s) pendiente(s) eliminado(s).`
              : "La regla dejó de generar pagos",
            "success"
          );
          this.cargarReglas();
        },
        (err) =>
          Swal.fire(
            "Error",
            err?.error?.mensaje || "No se pudo finalizar",
            "error"
          )
      );
    });
  }

  etiquetaEstado(estado: string): string {
    return estado || "Borrador";
  }

  claseMes(indice: number): string {
    return indice % 2 === 0 ? "mes-mayo" : "mes-junio";
  }

  cargarAjustesPendientes() {
    this._nominasService.getAjustesPendientesNomina().subscribe(
      (res) => (this.ajustesPendientes = res),
      () => {}
    );
  }

  simularPagoDominical() {
    this._nominasService
      .simularDominical({
        fecha: this.fechaDominicalLiquidacion,
        cedula: this.formulario.cedulaBeneficiario || undefined,
      })
      .subscribe(
        (res) => {
          this.simulacionDominical = res;
          if (!res.esDomingo) {
            Swal.fire(
              "Aviso",
              "La fecha seleccionada no es domingo; se usará el domingo de esa semana para el cálculo.",
              "info"
            );
          }
        },
        (err) =>
          Swal.fire(
            "Error",
            err?.error?.mensaje || "No se pudo simular",
            "error"
          )
      );
  }

  liquidarPagoDominical() {
    Swal.fire({
      title: "¿Liquidar pago dominical?",
      text: "Se registrarán transacciones financieras y se aplicarán ajustes pendientes.",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Liquidar",
    }).then((result) => {
      if (!result.value) return;
      this._nominasService
        .liquidarDominical({
          fecha: this.fechaDominicalLiquidacion,
          usuario: this.usuarioNombre,
          cedula: this.formulario.cedulaBeneficiario || undefined,
          aplicarAjustes: true,
        })
        .subscribe(
          () => {
            Swal.fire("Listo", "Liquidación dominical registrada", "success");
            this.simularPagoDominical();
            this.cargarAjustesPendientes();
            this.cargarEventosDominical();
          },
          (err) =>
            Swal.fire(
              "Error",
              err?.error?.mensaje || "No se pudo liquidar",
              "error"
            )
        );
    });
  }

  cargarEventosDominical() {
    const f = this.fechaDominicalLiquidacion.toISOString().slice(0, 10);
    this._nominasService.getEventosDominical(f).subscribe(
      (res) => (this.eventosDominical = res),
      () => {}
    );
  }

  montoDominicalPreview(): number | null {
    if (!this.simulacionDominical?.liquidaciones?.length) return null;
    const cedula = this.formulario.cedulaBeneficiario;
    const item = this.simulacionDominical.liquidaciones.find(
      (l) => !cedula || l.cedula === cedula
    );
    return item?.montoBruto ?? item?.monto ?? null;
  }

  liquidacionActual(): LiquidacionDominicalItem | undefined {
    if (!this.simulacionDominical) return undefined;
    const cedula = this.formulario.cedulaBeneficiario;
    return this.simulacionDominical.liquidaciones.find(
      (l) => !cedula || l.cedula === cedula
    );
  }
}
