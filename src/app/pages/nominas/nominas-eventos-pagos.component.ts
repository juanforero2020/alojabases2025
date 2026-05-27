import { Component, Input, OnInit } from "@angular/core";
import { NominasService } from "src/app/servicios/nominas.service";
import { CentroCostoService } from "src/app/servicios/centro-costo.service";
import { CentroCosto } from "../administracion-cuentas/administracion-cuenta";
import Swal from "sweetalert2";
import {
  AjusteNominaPendiente,
  BeneficiarioNomina,
  EventoPagoDominical,
  EventoPagoProgramado,
  FilaAmortizacion,
  LiquidacionDominicalItem,
  ProyeccionPagoNomina,
  ReglaPagoNomina,
  ReporteEstadoEmpleado,
  SimulacionDominical,
} from "./nominas";

@Component({
  selector: "app-nominas-eventos-pagos",
  templateUrl: "./nominas-eventos-pagos.component.html",
  styleUrls: ["./nominas-eventos-pagos.component.scss"],
})
export class NominasEventosPagosComponent implements OnInit {
  @Input() usuarioNombre = "";

  tiposRegla = ["A", "B"];
  tiposBeneficiario = ["Interno", "Externo"];
  transaccionesNominaA = [
    "Asignacion nomina",
    "Anticipo nomina",
    "Pago extra",
    "Comision",
  ];
  transaccionesNominaB = [
    "Arriendos",
    "Prestamos recibidos",
    "Tarjetas de credito",
    "Pagos puntuales",
    "Otros compromisos",
    "Bono de navidad",
    "Decimo tercer sueldo",
    "Decimo cuarto sueldo",
    "Decimo escolar",
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
  reglaSeleccionada: ReglaPagoNomina | null = null;
  proyeccionVista: ProyeccionPagoNomina | null = null;
  beneficiario: BeneficiarioNomina | null = null;
  modoEdicion = false;

  formulario: ReglaPagoNomina = this.nuevaRegla();

  fechaDominicalLiquidacion: Date = this.ultimoDomingo();
  simulacionDominical: SimulacionDominical | null = null;
  ajustesPendientes: AjusteNominaPendiente[] = [];
  eventosDominical: EventoPagoDominical[] = [];
  eventosProgramados: EventoPagoProgramado[] = [];
  filtroEventosEstado = "Pendiente";
  estadosEventoFiltro = ["Pendiente", "Parcial", "Ejecutado", "Cancelado", "Todos"];
  tablaAmortizacion: FilaAmortizacion[] = [];
  amortizacionEditadaManual = false;
  validacionAmortizacion: { ok: boolean; mensaje?: string; suma?: number; pendiente?: number } | null = null;

  reporteCedula = "";
  reporteCentroCosto = "";
  reporteDesde: Date = new Date(new Date().getFullYear(), 0, 1);
  reporteHasta: Date = new Date();
  reporteEstado: ReporteEstadoEmpleado | null = null;

  constructor(
    private _nominasService: NominasService,
    private _centroCostoService: CentroCostoService
  ) {}

  get esTipoB(): boolean {
    return this.formulario.tipoRegla === "B";
  }

  get esTipoA(): boolean {
    return !this.esTipoB;
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
    this.cargarEventosProgramados();
    this.actualizarParametrosPorFrecuencia();
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

  cargarEventosProgramados() {
    const estado =
      this.filtroEventosEstado === "Todos"
        ? undefined
        : this.filtroEventosEstado;
    this._nominasService
      .getEventosProgramados({
        estado,
        reglaId: this.reglaSeleccionada?._id,
      })
      .subscribe(
        (res) => (this.eventosProgramados = res),
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
    if (this.formulario.tipoRegla === "B") {
      const cedula = this.formulario.cedulaBeneficiario;
      const nombre = this.formulario.nombreBeneficiario;
      this.formulario = this.nuevaReglaTipoB();
      this.formulario.cedulaBeneficiario = cedula;
      this.formulario.nombreBeneficiario = nombre;
    } else {
      const cedula = this.formulario.cedulaBeneficiario;
      const nombre = this.formulario.nombreBeneficiario;
      this.formulario = this.nuevaRegla();
      this.formulario.cedulaBeneficiario = cedula;
      this.formulario.nombreBeneficiario = nombre;
    }
    this.beneficiario = null;
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

        if (this.esDominical) {
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
    if (this.esTipoB) {
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

    const textoAutorizar = this.esTipoB
      ? this.usaAmortizacion
        ? `Se programarán ${this.formulario.cuotas} cuotas por un total de $${this.formulario.montoTotalDeuda} (ejecución manual, parcial o total).`
        : `Se programarán pagos ${this.formulario.frecuencia.toLowerCase()} de $${this.formulario.cuotaEvento} (ejecución manual por el encargado).`
      : `Se generará la proyección ${this.formulario.frecuencia.toLowerCase()} por $${this.formulario.monto}`;

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
          const msg = this.esTipoB
            ? `Regla autorizada. ${res.eventosGenerados || 0} pagos programados (pendientes de ejecución).`
            : "Evento de pago activo";
          Swal.fire("Autorizado", msg, "success");
          this.reglaSeleccionada = res.data;
          this.formulario = { ...res.data };
          this.proyeccionVista = res.data.proyeccion || null;
          this.cargarReglas();
          if (this.esTipoB) {
            this.cargarEventosProgramados();
          }
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
      this.verProyeccion(regla);
      if (regla.tipoRegla === "B") {
        this.cargarEventosProgramados();
      }
      return;
    }
    this.modoEdicion = true;
    this.reglaSeleccionada = regla;
    this.formulario = { ...regla };
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

  saldoPendienteEvento(ev: EventoPagoProgramado): number {
    return Math.max(
      0,
      Math.round(((Number(ev.monto) || 0) - (Number(ev.montoPagado) || 0)) * 100) /
        100
    );
  }

  ejecutarEventoProgramado(ev: EventoPagoProgramado) {
    const saldo = this.saldoPendienteEvento(ev);
    const ventana =
      ev.fechaMin && ev.fechaMax
        ? `${new Date(ev.fechaMin).toLocaleDateString("es-EC")} — ${new Date(ev.fechaMax).toLocaleDateString("es-EC")}`
        : new Date(ev.fechaProgramada).toLocaleDateString("es-EC");

    Swal.fire({
      title: "Registrar pago",
      html: `<strong>${ev.nombreBeneficiario}</strong><br/>
        Cuota ${ev.numeroCuota}/${ev.totalCuotas}<br/>
        Ventana: ${ventana}<br/>
        Programado: $${ev.monto} · Pagado: $${ev.montoPagado || 0}<br/>
        <strong>Saldo: $${saldo}</strong>`,
      input: "number",
      inputValue: String(saldo),
      inputAttributes: { min: "0.01", step: "0.01" },
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Registrar",
      cancelButtonText: "Cancelar",
    }).then((result) => {
      if (!result.value || !ev._id) return;
      const monto = parseFloat(result.value);
      if (!monto || monto <= 0) {
        Swal.fire("Validación", "Indique un monto válido", "warning");
        return;
      }
      if (monto > saldo + 0.01) {
        Swal.fire(
          "Validación",
          `El monto supera el saldo pendiente ($${saldo})`,
          "warning"
        );
        return;
      }
      this._nominasService
        .ejecutarEventoProgramado(ev._id, {
          usuario: this.usuarioNombre,
          monto,
        })
        .subscribe(
          (res: any) => {
            const parcial = res?.data?.saldoPendiente > 0;
            Swal.fire(
              parcial ? "Pago parcial registrado" : "Pago completo registrado",
              parcial
                ? `Saldo pendiente: $${res.data.saldoPendiente}`
                : "Cuota saldada en finanzas",
              "success"
            );
            this.cargarEventosProgramados();
            this.cargarReglas();
          },
          (err) =>
            Swal.fire(
              "Error",
              err?.error?.mensaje || "No se pudo ejecutar",
              "error"
            )
        );
    });
  }

  puedeEjecutarEvento(ev: EventoPagoProgramado): boolean {
    if (ev.estado !== "Pendiente" && ev.estado !== "Parcial") return false;
    if (this.saldoPendienteEvento(ev) <= 0) return false;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    if (ev.fechaMin) {
      const min = new Date(ev.fechaMin);
      min.setHours(0, 0, 0, 0);
      if (hoy < min) return false;
    } else {
      const fecha = new Date(ev.fechaProgramada);
      fecha.setHours(0, 0, 0, 0);
      if (hoy < fecha) return false;
    }
    return true;
  }

  consultarReporteEstado() {
    if (!this.reporteCedula?.trim() && !this.reporteCentroCosto?.trim()) {
      Swal.fire(
        "Validación",
        "Indique la cédula del empleado o el centro de costo",
        "warning"
      );
      return;
    }
    this._nominasService
      .getReporteEstadoEmpleado({
        cedula: this.reporteCedula?.trim() || undefined,
        centroCosto: this.reporteCentroCosto?.trim() || undefined,
        desde: this.reporteDesde.toISOString().slice(0, 10),
        hasta: this.reporteHasta.toISOString().slice(0, 10),
      })
      .subscribe(
        (res) => (this.reporteEstado = res),
        (err) =>
          Swal.fire(
            "Error",
            err?.error?.mensaje || "No se pudo consultar",
            "error"
          )
      );
  }

  usarBeneficiarioEnReporte() {
    if (this.formulario.cedulaBeneficiario) {
      this.reporteCedula = this.formulario.cedulaBeneficiario;
    }
    if (this.formulario.centroCosto) {
      this.reporteCentroCosto = this.formulario.centroCosto;
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
    this._nominasService.finalizarReglaPago(regla._id).subscribe(
      () => {
        Swal.fire("Finalizada", "La regla dejó de generar pagos", "success");
        this.cargarReglas();
      },
      () => Swal.fire("Error", "No se pudo finalizar", "error")
    );
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
