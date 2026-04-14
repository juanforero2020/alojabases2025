import { Component, OnDestroy, OnInit } from "@angular/core";
import { Subscription } from "rxjs";
import Swal from "sweetalert2";
import { productoMultiple } from "src/app/pages/consolidado/consolidado";
import { EntregasBodegaService } from "src/app/servicios/entregas-bodega.service";
import { TransaccionesService } from "src/app/servicios/transacciones.service";
import { ScreenService } from "src/app/shared/services";

/** Valores de entrada del usuario por línea (despacho / compromiso / notas). */
interface BorradorLineaEntrega {
  cantidadEntregadaInput: number;
  entregaCajasInput: number;
  entregaPiezasInput: number;
  fechaCompromisoInput: any;
  notasInput: string;
}

@Component({
  selector: "app-gestion-entregas-bodega",
  templateUrl: "./gestion-entregas-bodega.component.html",
  styleUrls: ["./gestion-entregas-bodega.component.scss"],
})
export class GestionEntregasBodegaComponent implements OnInit, OnDestroy {
  menuPrincipal: string[] = [
    "Gestión Entregas",
    "Listado Entregas",
    "Productos Facturados",
    "Productos Pendientes",
  ];
  valorMenu = "Gestión Entregas";
  mostrarGestion = true;
  mostrarListado = false;
  /**
   * ninguno: gestión o listado de órdenes.
   * facturados: detalle por factura/cliente (productos facturados sin entregar).
   * pendientes: unificación por producto + transacciones (balance vs bodega matriz).
   */
  vistaProductosEspecial: "ninguno" | "facturados" | "pendientes" = "ninguno";

  /** Resumen detallado (vista facturados). */
  productosPendientes: any[] = [];
  /** Agregado por producto con stock y balance (vista pendientes). */
  productosPendientesBalance: any[] = [];

  ordenes: any[] = [];
  ordenSeleccionada: any = null;
  loading = false;

  popupTrazabilidadVisible = false;
  ordenTrazabilidad: any = null;

  /** Corrección de un movimiento del historial (popup secundario). */
  popupEditarHistorialVisible = false;
  guardandoEdicionHistorial = false;
  edicionHistorialContext: {
    itemIndex: number;
    historialIndex: number;
    productoNombre: string;
    esMetro: boolean;
  } | null = null;
  formEdicionHistorial = {
    estadoSeleccionado: "ENTREGA_PARCIAL",
    entregaCajas: 0,
    entregaPiezas: 0,
    m2EntregadoEnEstaOperacion: 0,
    notas: "",
    motivoCorreccion: "",
  };
  readonly estadosHistorialEdicion = [
    "ENTREGA_PARCIAL",
    "ENTREGA_TOTAL",
    "DEVOLUCION",
  ];

  filtroDocumento: number = null;
  filtroCliente = "";
  fechaDesde: Date = (() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date;
  })();
  fechaHasta: Date = new Date();
  incluirCerradas = false;

  /**
   * Vista acordeón (móvil / tablet pequeña): factura → ítems → formulario por línea.
   */
  vistaMovil = false;
  expandedOrderId: string | null = null;
  expandedItemIndex: number | null = null;

  /** Índices de línea con confirmación visual reciente de guardado OK. */
  lineasGuardadoFlash: Record<number, boolean> = {};

  private screenSub: Subscription;
  private timeoutsGuardadoFlash: { [k: number]: any } = {};

  /** Texto para cabecera estilo Caja Menor (orden seleccionada o guión). */
  get consecutivoVista(): string | number {
    if (this.ordenSeleccionada && this.ordenSeleccionada.consecutivoEntrega != null) {
      return this.ordenSeleccionada.consecutivoEntrega;
    }
    return "—";
  }

  get estadoOrdenVista(): string {
    return (this.ordenSeleccionada && this.ordenSeleccionada.estadoProceso) || "—";
  }

  get usuarioVista(): string {
    return sessionStorage.getItem("user") || "";
  }

  get mostrarVistaEspecialProductos(): boolean {
    return this.vistaProductosEspecial !== "ninguno";
  }

  /** Rol desde login (layout guarda en localStorage). */
  get rolUsuarioSesion(): string {
    try {
      return (sessionStorage.getItem("rol") || "").trim();
    } catch {
      return "";
    }
  }

  /** Orden en estado final que no admite corrección de movimientos. */
  esOrdenCerradaParaEdicionHistorial(orden: any): boolean {
    const e = String(orden?.estadoProceso || "").toUpperCase();
    return e === "CERRADO" || e === "CERRADA";
  }

  /** Columna / acciones de devolución: bodeguero o administrador en gestión o listado. */
  get mostrarAccionesDevolucion(): boolean {
    const r = this.rolUsuarioSesion;
    return (
      (r === "Bodeguero" || r === "Administrador") &&
      (this.mostrarGestion || this.mostrarListado)
    );
  }

  /** Hay entregas o devoluciones registradas en ítems (mismo criterio que el servidor). */
  ordenTieneMovimientoEntregaUi(orden: any): boolean {
    if (!orden?.items?.length) {
      return false;
    }
    return orden.items.some(
      (it: any) =>
        this.num(it?.cantidadEntregada) > 0 || this.num(it?.cantidadDevuelta) > 0
    );
  }

  /**
   * Qué puede hacer el usuario con el ícono de devolución para esta orden.
   * - ejecutar: devolución inmediata (admin o bodeguero mismo día).
   * - solicitar: bodeguero en día distinto.
   * - solicitud_pendiente_bodeguero: ya envió solicitud; espera admin.
   * - ejecutar_aprobacion_admin: admin ejecuta tras solicitud.
   */
  tipoAccionDevolucionParaOrden(
    orden: any
  ): "ejecutar" | "solicitar" | "solicitud_pendiente_bodeguero" | "ejecutar_aprobacion_admin" | "nada" {
    if (!orden || !this.mostrarAccionesDevolucion) {
      return "nada";
    }
    const ep = String(orden.estadoProceso || "").toUpperCase();
    if (ep === "CERRADO" || ep === "ANULADO") {
      return "nada";
    }
    if (!this.ordenTieneMovimientoEntregaUi(orden)) {
      return "nada";
    }
    const rol = this.rolUsuarioSesion;
    const pend = !!orden.solicitudDevolucionPendiente;
    const mismoDia = this.ordenEntregaEsDelDiaActual(orden);

    if (rol === "Administrador") {
      if (pend) {
        return "ejecutar_aprobacion_admin";
      }
      return "ejecutar";
    }
    if (rol === "Bodeguero") {
      if (pend) {
        return "solicitud_pendiente_bodeguero";
      }
      if (mismoDia) {
        return "ejecutar";
      }
      return "solicitar";
    }
    return "nada";
  }

  tituloAccionDevolucion(orden: any): string {
    const t = this.tipoAccionDevolucionParaOrden(orden);
    switch (t) {
      case "solicitar":
        return "Solicitar devolución total (requiere aprobación del administrador)";
      case "ejecutar":
        return "Devolución total: restablecer orden a ABIERTA";
      case "ejecutar_aprobacion_admin":
        return "Aprobar y ejecutar devolución total";
      case "solicitud_pendiente_bodeguero":
        return "Solicitud de devolución pendiente de aprobación";
      default:
        return "Devolución no disponible";
    }
  }

  claseIconoDevolucion(orden: any): string {
    const t = this.tipoAccionDevolucionParaOrden(orden);
    if (t === "solicitud_pendiente_bodeguero") {
      return "fa fa-clock-o text-warning";
    }
    if (t === "nada") {
      return "fa fa-undo text-muted";
    }
    if (t === "solicitar") {
      return "fa fa-paper-plane text-primary";
    }
    return "fa fa-undo text-secondary";
  }

  /** Texto corto para botón en vista móvil de gestión. */
  textoCortoDevolucion(orden: any): string {
    const t = this.tipoAccionDevolucionParaOrden(orden);
    if (t === "solicitar") {
      return "Solicitar devolución";
    }
    if (t === "ejecutar" || t === "ejecutar_aprobacion_admin") {
      return "Devolución total";
    }
    if (t === "solicitud_pendiente_bodeguero") {
      return "Solicitud pendiente";
    }
    return "";
  }

  accionDevolucionGrid = (e: any) => {
    const ord = e?.row?.data;
    this.accionDevolucionOrden(ord);
  };

  accionDevolucionOrden(orden: any): void {
    const t = this.tipoAccionDevolucionParaOrden(orden);
    if (t === "nada") {
      return;
    }
    if (t === "solicitud_pendiente_bodeguero") {
      Swal.fire(
        "Solicitud pendiente",
        "Un administrador debe aprobar y ejecutar la devolución total de esta orden.",
        "info"
      );
      return;
    }
    if (t === "solicitar") {
      Swal.fire({
        title: "¿Solicitar devolución total?",
        html:
          "Quedará registrada una <strong>solicitud</strong>. Un administrador deberá ejecutar la devolución para eliminar la trazabilidad de entregas y dejar la orden en <strong>ABIERTA</strong>.",
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Sí, solicitar",
        cancelButtonText: "Cancelar",
      }).then((r) => {
        if (!r || !(r as any).value || !orden?._id) {
          return;
        }
        this.enviarSolicitudDevolucion(orden);
      });
      return;
    }
    const esAprobacion = t === "ejecutar_aprobacion_admin";
    Swal.fire({
      title: esAprobacion ? "¿Aprobar devolución total?" : "¿Devolución total?",
      html:
        (esAprobacion
          ? "<p class='mb-2'>Se aprueba la solicitud del bodeguero.</p>"
          : "") +
        "<p>Se eliminará la trazabilidad de entregas en los ítems y la orden volverá a estado <strong>ABIERTA</strong>, como al inicio.</p>",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, ejecutar",
      cancelButtonText: "Cancelar",
    }).then((r) => {
      if (!r || !(r as any).value || !orden?._id) {
        return;
      }
      this.ejecutarDevolucionTotalOrden(orden);
    });
  }

  private enviarSolicitudDevolucion(orden: any): void {
    this.entregasBodegaService
      .solicitarDevolucion(orden._id, {
        usuario: this.usuarioVista,
        rolUsuario: this.rolUsuarioSesion,
      })
      .subscribe({
        next: (actualizada: any) => {
          const vista = this.prepararOrdenParaVista(actualizada);
          this.sincronizarOrdenEnListado(vista);
          if (this.ordenSeleccionada?._id === vista._id) {
            this.ordenSeleccionada = vista;
          }
          if (this.popupTrazabilidadVisible && this.ordenTrazabilidad?._id === vista._id) {
            this.abrirPopupTrazabilidad(vista);
          }
          Swal.fire("Solicitud registrada", "Un administrador podrá ejecutar la devolución cuando corresponda.", "success");
        },
        error: (err) => {
          const msg =
            err?.error?.mensaje || "No se pudo registrar la solicitud de devolución.";
          Swal.fire("Error", msg, "error");
        },
      });
  }

  private ejecutarDevolucionTotalOrden(orden: any): void {
    this.entregasBodegaService
      .ejecutarDevolucionTotal(orden._id, {
        usuario: this.usuarioVista,
        rolUsuario: this.rolUsuarioSesion,
      })
      .subscribe({
        next: (actualizada: any) => {
          const vista = this.prepararOrdenParaVista(actualizada);
          this.sincronizarOrdenEnListado(vista);
          if (this.ordenSeleccionada?._id === vista._id) {
            this.ordenSeleccionada = vista;
          }
          if (this.popupTrazabilidadVisible && this.ordenTrazabilidad?._id === vista._id) {
            this.abrirPopupTrazabilidad(vista);
          }
          Swal.fire("Listo", "La orden se restableció a estado ABIERTA.", "success");
        },
        error: (err) => {
          const msg = err?.error?.mensaje || "No se pudo ejecutar la devolución total.";
          Swal.fire("Error", msg, "error");
        },
      });
  }

  /** Misma fecha calendario que hoy (cliente), usando fecha documento o creación. */
  ordenEntregaEsDelDiaActual(orden: any): boolean {
    const raw =
      orden?.fechaDocumento != null && orden.fechaDocumento !== ""
        ? orden.fechaDocumento
        : orden?.createdAt;
    if (raw == null || raw === "") {
      return false;
    }
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) {
      return false;
    }
    const hoy = new Date();
    return (
      d.getFullYear() === hoy.getFullYear() &&
      d.getMonth() === hoy.getMonth() &&
      d.getDate() === hoy.getDate()
    );
  }

  /**
   * Administrador: siempre (orden no cerrada).
   * Bodeguero: solo órdenes del día actual.
   */
  puedeEditarHistorialTrazabilidad(orden: any): boolean {
    if (!orden || this.esOrdenCerradaParaEdicionHistorial(orden)) {
      return false;
    }
    const rol = this.rolUsuarioSesion;
    if (rol === "Administrador") {
      return true;
    }
    if (rol === "Bodeguero") {
      return this.ordenEntregaEsDelDiaActual(orden);
    }
    return false;
  }

  abrirPopupEditarHistorial(
    it: any,
    filaHistorial: any,
    itemIndex: number
  ): void {
    if (!this.ordenTrazabilidad || !this.puedeEditarHistorialTrazabilidad(this.ordenTrazabilidad)) {
      return;
    }
    const idx = filaHistorial?.__historialIdx;
    if (idx == null || idx < 0) {
      Swal.fire(
        "No disponible",
        "No se pudo identificar el registro a editar.",
        "warning"
      );
      return;
    }
    const metro = this.esItemMetrosCajaPieza(it);
    this.edicionHistorialContext = {
      itemIndex,
      historialIndex: idx,
      productoNombre: it?.productoNombre || "Ítem",
      esMetro: metro,
    };
    const est = String(filaHistorial.estadoSeleccionado || "ENTREGA_PARCIAL").toUpperCase();
    this.formEdicionHistorial = {
      estadoSeleccionado: this.estadosHistorialEdicion.includes(est)
        ? est
        : "ENTREGA_PARCIAL",
      entregaCajas: this.num(filaHistorial.entregaCajas),
      entregaPiezas: this.num(filaHistorial.entregaPiezas),
      m2EntregadoEnEstaOperacion: this.num(filaHistorial.m2EntregadoEnEstaOperacion),
      notas: filaHistorial.notas != null ? String(filaHistorial.notas) : "",
      motivoCorreccion: "",
    };
    this.popupEditarHistorialVisible = true;
  }

  cerrarPopupEditarHistorial(): void {
    this.popupEditarHistorialVisible = false;
    this.edicionHistorialContext = null;
    this.guardandoEdicionHistorial = false;
  }

  confirmarEdicionHistorial(): void {
    if (
      !this.ordenTrazabilidad?._id ||
      !this.edicionHistorialContext ||
      this.guardandoEdicionHistorial
    ) {
      return;
    }
    const ctx = this.edicionHistorialContext;
    const f = this.formEdicionHistorial;
    this.guardandoEdicionHistorial = true;
    this.entregasBodegaService
      .editarHistorialItem(this.ordenTrazabilidad._id, ctx.itemIndex, ctx.historialIndex, {
        estadoSeleccionado: f.estadoSeleccionado,
        entregaCajas: f.entregaCajas,
        entregaPiezas: f.entregaPiezas,
        m2EntregadoEnEstaOperacion: f.m2EntregadoEnEstaOperacion,
        notas: f.notas,
        motivoCorreccion: (f.motivoCorreccion || "").trim(),
        usuario: sessionStorage.getItem("user") || "",
        rolUsuario: this.rolUsuarioSesion,
      })
      .subscribe({
        next: (orden: any) => {
          this.guardandoEdicionHistorial = false;
          const vista = this.prepararOrdenParaVista(orden);
          this.sincronizarOrdenEnListado(vista);
          this.cerrarPopupEditarHistorial();
          this.abrirPopupTrazabilidad(orden);
          Swal.fire({
            toast: true,
            position: "top-end",
            icon: "success",
            title: "Movimiento actualizado",
            showConfirmButton: false,
            timer: 2500,
          });
        },
        error: (errors: any) => {
          this.guardandoEdicionHistorial = false;
          const mensaje =
            errors?.error?.mensaje ||
            "No se pudo guardar la corrección del historial.";
          Swal.fire("Error", mensaje, "error");
        },
      });
  }

  textoAyudaEdicionHistorial(): string {
    if (!this.ordenTrazabilidad) {
      return "";
    }
    if (this.esOrdenCerradaParaEdicionHistorial(this.ordenTrazabilidad)) {
      return "La orden está cerrada: no se pueden corregir movimientos.";
    }
    const rol = this.rolUsuarioSesion;
    if (rol === "Administrador") {
      return "Puede corregir movimientos en cualquier momento (orden abierta).";
    }
    if (rol === "Bodeguero") {
      if (this.ordenEntregaEsDelDiaActual(this.ordenTrazabilidad)) {
        return "Como bodeguero puede corregir movimientos en órdenes del día actual.";
      }
      return "Como bodeguero solo puede corregir cuando la orden corresponde al día de hoy (fecha documento o creación).";
    }
    return "No tiene permisos para corregir el historial.";
  }

  /**
   * Título del popup de corrección: en móvil se acorta el nombre del producto
   * para que la barra del popup no desborde el viewport.
   */
  get tituloPopupEditarHistorial(): string {
    if (!this.edicionHistorialContext) {
      return "Corregir movimiento";
    }
    const nombre = String(
      this.edicionHistorialContext.productoNombre || ""
    ).trim();
    const base = "Corregir movimiento";
    if (!nombre) {
      return base;
    }
    if (this.vistaMovil && nombre.length > 26) {
      return `${base} · ${nombre.slice(0, 24)}…`;
    }
    return `${base} · ${nombre}`;
  }

  constructor(
    private entregasBodegaService: EntregasBodegaService,
    private transaccionesService: TransaccionesService,
    private screen: ScreenService
  ) {}

  ngOnInit(): void {
    this.actualizarVistaMovil();
    this.screenSub = this.screen.changed.subscribe(() =>
      this.actualizarVistaMovil()
    );
    this.cargarPendientes();
  }

  ngOnDestroy(): void {
    if (this.screenSub) {
      this.screenSub.unsubscribe();
    }
    this.limpiarIndicadoresGuardadoLinea();
  }

  private actualizarVistaMovil(): void {
    const s = this.screen.sizes;
    const antes = this.vistaMovil;
    this.vistaMovil = !!(s["screen-x-small"] || s["screen-small"]);
    if (this.vistaMovil && !antes && this.ordenSeleccionada?._id) {
      this.expandedOrderId = this.ordenSeleccionada._id;
    }
    if (!this.vistaMovil && antes) {
      this.expandedOrderId = null;
      this.expandedItemIndex = null;
    }
  }

  ordenExpandidaEs(ord: any): boolean {
    return !!ord && this.expandedOrderId === ord._id;
  }

  toggleOrdenMovil(ord: any): void {
    if (!ord) {
      return;
    }
    if (this.expandedOrderId === ord._id) {
      this.expandedOrderId = null;
      this.ordenSeleccionada = null;
      this.expandedItemIndex = null;
      this.limpiarIndicadoresGuardadoLinea();
    } else {
      this.limpiarIndicadoresGuardadoLinea();
      this.expandedOrderId = ord._id;
      this.ordenSeleccionada = ord;
      this.expandedItemIndex = null;
    }
  }

  toggleItemMovil(index: number): void {
    this.expandedItemIndex =
      this.expandedItemIndex === index ? null : index;
  }

  itemExpandidoEs(index: number): boolean {
    return this.expandedItemIndex === index;
  }

  lineaGuardadaExitosa(index: number): boolean {
    return !!this.lineasGuardadoFlash[index];
  }

  /** Color de tarjeta de factura (Smart-Dispatch). */
  claseColorOrden(orden: any): string {
    const e = String(orden?.estadoProceso || "").toUpperCase();
    if (e === "CERRADO") {
      return "sd-est-verde";
    }
    if (e === "COMPLETO") {
      return "sd-est-azul";
    }
    if (e === "NOVEDAD") {
      return "sd-est-rojo";
    }
    return "sd-est-amarillo";
  }

  /** Color del nombre del material según estado del ítem. */
  claseColorItem(item: any): string {
    const st = String(item?.estadoItem || "").toUpperCase();
    const pend = this.num(item?.pendiente);
    if (pend <= 0 || st === "COMPLETO") {
      return "sd-est-azul";
    }
    if (st === "NOVEDAD") {
      return "sd-est-rojo";
    }
    return "sd-est-amarillo";
  }

  /** Cantidad a registrar supera el pendiente (alerta en móvil). */
  itemIngresoExcedePendiente(item: any): boolean {
    const pendiente = this.num(item?.pendiente);
    if (pendiente <= 0) {
      return false;
    }
    return this.m2OperacionIngresada(item) > pendiente + 0.0001;
  }

  opcionMenu(e: any) {
    switch (e.value) {
      case "Gestión Entregas":
        this.mostrarGestion = true;
        this.mostrarListado = false;
        this.vistaProductosEspecial = "ninguno";
        this.incluirCerradas = false;
        this.popupTrazabilidadVisible = false;
        this.expandedOrderId = null;
        this.expandedItemIndex = null;
        this.limpiarIndicadoresGuardadoLinea();
        this.cargarPendientes();
        break;
      case "Listado Entregas":
        this.mostrarGestion = false;
        this.mostrarListado = true;
        this.vistaProductosEspecial = "ninguno";
        this.incluirCerradas = true;
        this.ordenSeleccionada = null;
        this.expandedOrderId = null;
        this.expandedItemIndex = null;
        this.limpiarIndicadoresGuardadoLinea();
        this.popupTrazabilidadVisible = false;
        this.cargarPendientes();
        break;
      case "Productos Facturados":
        this.mostrarGestion = false;
        this.mostrarListado = false;
        this.vistaProductosEspecial = "facturados";
        this.incluirCerradas = false;
        this.ordenSeleccionada = null;
        this.expandedOrderId = null;
        this.expandedItemIndex = null;
        this.limpiarIndicadoresGuardadoLinea();
        this.popupTrazabilidadVisible = false;
        this.cargarPendientes();
        break;
      case "Productos Pendientes":
        this.mostrarGestion = false;
        this.mostrarListado = false;
        this.vistaProductosEspecial = "pendientes";
        this.incluirCerradas = false;
        this.ordenSeleccionada = null;
        this.expandedOrderId = null;
        this.expandedItemIndex = null;
        this.limpiarIndicadoresGuardadoLinea();
        this.popupTrazabilidadVisible = false;
        this.cargarPendientes();
        break;
      default:
        break;
    }
  }

  onRowClickGrid(e: any) {
    if (e.rowType !== "data") {
      return;
    }
    if (this.mostrarVistaEspecialProductos) {
      return;
    }
    if (this.mostrarListado) {
      this.abrirPopupTrazabilidad(e.data);
    } else {
      this.limpiarIndicadoresGuardadoLinea();
      this.ordenSeleccionada = this.prepararOrdenParaVista(e.data);
    }
  }

  abrirPopupTrazabilidad(fila: any) {
    if (!fila) {
      return;
    }
    const o = JSON.parse(JSON.stringify(fila));
    if (Array.isArray(o.trazabilidad)) {
      o.trazabilidad = o.trazabilidad
        .slice()
        .sort(
          (a: any, b: any) =>
            new Date(b.fecha || 0).getTime() - new Date(a.fecha || 0).getTime()
        )
        .map((t: any) => ({
          ...t,
          fechaFmt: this.formatearFechaIso(t.fecha),
        }));
    }
    if (Array.isArray(o.items)) {
      o.items = o.items.map((it: any) => ({
        ...it,
        historialOrdenado: (it.historial || [])
          .map((h: any, origIdx: number) => ({ ...h, __historialIdx: origIdx }))
          .sort(
            (a: any, b: any) =>
              new Date(b.fecha || 0).getTime() -
              new Date(a.fecha || 0).getTime()
          )
          .map((h: any) => ({
            ...h,
            fechaFmt: this.formatearFechaIso(h.fecha),
          })),
      }));
    }
    this.ordenTrazabilidad = o;
    this.popupTrazabilidadVisible = true;
  }

  get tituloPopupTrazabilidad(): string {
    if (
      !this.ordenTrazabilidad ||
      this.ordenTrazabilidad.consecutivoEntrega == null
    ) {
      return "Trazabilidad de la orden";
    }
    return "Trazabilidad · Orden " + this.ordenTrazabilidad.consecutivoEntrega;
  }

  formatearFechaIso(val: string | Date): string {
    if (val == null || val === "") {
      return "";
    }
    const d = val instanceof Date ? val : new Date(val);
    if (Number.isNaN(d.getTime())) {
      return String(val);
    }
    return d.toLocaleString();
  }

  /** Fecha de documento para tarjetas del listado en móvil (solo fecha, más legible). */
  formatearFechaDocumentoListado(orden: any): string {
    const v = orden?.fechaDocumento;
    if (v == null || v === "") {
      return "—";
    }
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) {
      return String(v);
    }
    return d.toLocaleDateString();
  }

  /** Payload que se envía al API para filtrar en base de datos. */
  private filtrosConsultaApi(): object {
    if (
      this.vistaProductosEspecial === "facturados" ||
      this.vistaProductosEspecial === "pendientes"
    ) {
      return { modoConsulta: "listado" };
    }
    return {
      documentoNumero: this.filtroDocumento,
      cliente: (this.filtroCliente || "").trim(),
      fechaDesde: this.fechaDesde,
      fechaHasta: this.fechaHasta,
      modoConsulta:
        this.mostrarListado || this.mostrarVistaEspecialProductos
          ? "listado"
          : "gestion",
    };
  }

  cargarPendientes() {
    this.loading = true;
    this.entregasBodegaService.getPendientes(this.filtrosConsultaApi()).subscribe({
      next: (resp: any[]) => {
        const ordenesVista = (resp || []).map((orden) =>
          this.prepararOrdenParaVista(orden)
        );
        this.ordenes = ordenesVista;
        this.productosPendientes = [];
        this.productosPendientesBalance = [];

        const sincronizarExpandida = () => {
          if (this.expandedOrderId) {
            const o = (this.ordenes || []).find(
              (x) => x._id === this.expandedOrderId
            );
            if (o) {
              this.ordenSeleccionada = o;
            } else {
              this.expandedOrderId = null;
              this.ordenSeleccionada = null;
              this.expandedItemIndex = null;
            }
          }
        };

        if (this.vistaProductosEspecial === "facturados") {
          this.productosPendientes =
            this.construirResumenProductosPendientes(ordenesVista);
          sincronizarExpandida();
          this.loading = false;
        } else if (this.vistaProductosEspecial === "pendientes") {
          this.enriquecerBalanceProductosPendientes(ordenesVista, sincronizarExpandida);
        } else {
          sincronizarExpandida();
          this.loading = false;
        }
      },
      error: () => {
        this.loading = false;
        Swal.fire("Error", "No se pudo cargar el listado de entregas.", "error");
      },
    });
  }

  /** Igual que cargarPendientes: todo el filtrado ocurre en el servidor. */
  buscar() {
    this.cargarPendientes();
  }

  limpiarFiltros() {
    this.filtroDocumento = null;
    this.filtroCliente = "";
    this.incluirCerradas = this.mostrarListado;
    this.ordenSeleccionada = null;
    this.expandedOrderId = null;
    this.expandedItemIndex = null;
    this.limpiarIndicadoresGuardadoLinea();
    this.cargarPendientes();
  }

  seleccionarOrden = (e) => {
    if (!this.mostrarGestion) {
      return;
    }
    this.limpiarIndicadoresGuardadoLinea();
    this.ordenSeleccionada = this.prepararOrdenParaVista(e.row.data);
  };

  guardarItem(index: number) {
    if (!this.ordenSeleccionada?._id) {
      return;
    }
    if (this.vistaMovil && this.expandedOrderId) {
      const o = this.ordenes.find((x) => x._id === this.expandedOrderId);
      if (o) {
        this.ordenSeleccionada = o;
      }
    }
    const borradorOtrasLineas = this.capturarEntradasItems(this.ordenSeleccionada);
    const item = this.ordenSeleccionada.items[index];
    const metro = this.esItemMetrosCajaPieza(item);
    const ingreso = this.m2OperacionIngresada(item);
    const pendiente = this.num(item?.pendiente);
    if (ingreso > pendiente + 0.0001) {
      Swal.fire(
        "Cantidad inválida",
        "La cantidad ingresada supera el pendiente del ítem. Ajuste el valor antes de guardar.",
        "warning"
      );
      return;
    }
    const estadoUi = this.estadoGestionAutomatico(item);
    /** El API solo usa ENTREGA_PARCIAL | ENTREGA_TOTAL | DEVOLUCION; ABIERTO es solo etiqueta de UI. */
    const estadoCalculado =
      estadoUi === "ABIERTO" ? "ENTREGA_PARCIAL" : estadoUi;
    const bloquearCompromiso = estadoCalculado === "ENTREGA_TOTAL";
    const payload: any = {
      estadoItem: estadoCalculado,
      cantidadEntregada: metro
        ? 0
        : Number(this.num(item.cantidadEntregadaInput).toFixed(3)),
      entregaCajas: metro ? this.num(item.entregaCajasInput) : 0,
      entregaPiezas: metro ? this.num(item.entregaPiezasInput) : 0,
      fechaCompromiso: bloquearCompromiso ? "" : item.fechaCompromisoInput || "",
      notas: bloquearCompromiso ? "" : item.notasInput || "",
      usuario: sessionStorage.getItem("user") || "",
    };

    this.entregasBodegaService
      .actualizarItem(this.ordenSeleccionada._id, index, payload)
      .subscribe({
        next: (ordenActualizada: any) => {
          const nueva = this.prepararOrdenParaVista(ordenActualizada);
          this.aplicarBorradorOtrasLineas(nueva, borradorOtrasLineas, index);
          this.ordenSeleccionada = nueva;
          this.refrescarCamposEventoItem(index);
          this.sincronizarOrdenEnListado(this.ordenSeleccionada);
          this.mostrarFeedbackGuardadoLinea(index);
          if (this.vistaMovil) {
            this.expandedItemIndex = null;
          }
          Swal.fire({
            toast: true,
            position: "top-end",
            icon: "success",
            title: "Línea guardada correctamente",
            showConfirmButton: false,
            timer: 2200,
          });
        },
        error: (errors) => {
          console.log(errors);
          const mensaje =
            errors?.error?.mensaje || "No se pudo guardar el ítem de entrega.La cantidad ingresada excede la cantidad pendiente por entregar";
          Swal.fire("Error", mensaje, "error");
        },
      });
  }

  /** Asegura la orden activa antes de cerrar desde la tarjeta móvil. */
  cerrarOrdenDesdeMovil(ord: any): void {
    if (ord) {
      this.ordenSeleccionada = ord;
    }
    this.cerrarOrden();
  }

  cerrarOrden() {
    if (!this.ordenSeleccionada?._id) return;
    this.entregasBodegaService
      .cerrar(this.ordenSeleccionada._id, {
        usuario: sessionStorage.getItem("user") || "",
      })
      .subscribe({
        next: () => {
          this.ordenSeleccionada = null;
          this.expandedOrderId = null;
          this.expandedItemIndex = null;
          this.limpiarIndicadoresGuardadoLinea();
          this.cargarPendientes();
          Swal.fire("OK", "Orden cerrada correctamente.", "success");
        },
        error: (error) => {
          const mensaje =
            error?.error?.mensaje || "No se pudo cerrar la orden de entrega.";
          Swal.fire("Error", mensaje, "error");
        },
      });
  }

  private num(val: any): number {
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
  }

  /** Cerámica/porcelanato: UNIDAD Metros + M2 + P_CAJA (igual que ventas). */
  esItemMetrosCajaPieza(item: any): boolean {
    if (item && item.esMetrosCajaPieza) return true;
    const p = item && item.producto;
    return (
      !!p &&
      String(p.UNIDAD) === "Metros" &&
      this.num(p.M2) > 0 &&
      this.num(p.P_CAJA) > 0
    );
  }

  m2PorCajaDeItem(item: any): number {
    const m = this.num(item?.m2PorCaja);
    if (m > 0) return m;
    return this.num(item?.producto?.M2);
  }

  piezasPorCajaDeItem(item: any): number {
    const p = this.num(item?.piezasPorCaja);
    if (p > 0) return p;
    return this.num(item?.producto?.P_CAJA);
  }

  cajasPiezasDesdeM2(m2: number, item: any): { cajas: number; piezas: number } {
    const mc = this.m2PorCajaDeItem(item);
    const pp = this.piezasPorCajaDeItem(item);
    const m = this.num(m2);
    if (mc <= 0 || pp <= 0) return { cajas: 0, piezas: 0 };
    const cajas = Math.trunc((m + 0.01) / mc);
    const piezas = Math.trunc(((m + 0.01) * pp) / mc) - cajas * pp;
    return { cajas, piezas };
  }

  /** Total piezas equivalentes a un m² acumulado (misma regla que servidor). */
  piezasTotalesDesdeM2(m2: number, item: any): number {
    const pp = this.piezasPorCajaDeItem(item);
    if (pp <= 0) return 0;
    const { cajas, piezas } = this.cajasPiezasDesdeM2(m2, item);
    return cajas * pp + piezas;
  }

  /** Piezas facturadas: snapshot o derivado del m² facturado. */
  piezasTotalesFacturado(item: any): number {
    const pp = this.piezasPorCajaDeItem(item);
    const cf = this.num(item?.cajasFacturadas);
    const pfl = this.num(item?.piezasFacturadas);
    if (cf > 0 || pfl > 0) {
      return cf * pp + pfl;
    }
    return this.piezasTotalesDesdeM2(this.num(item?.cantidadFacturada), item);
  }

  private umbralM2MediaPieza(item: any): number {
    const mc = this.m2PorCajaDeItem(item);
    const pp = this.piezasPorCajaDeItem(item);
    if (mc <= 0 || pp <= 0) return 0.05;
    return (mc / pp) * 0.501;
  }

  /**
   * Pendiente coherente con cajas/piezas: si ya cubrió las piezas facturadas,
   * no deja residuo “fantasma” de m² por coma flotante.
   */
  pendienteEfectivo(item: any): number {
    const fact = this.num(item?.cantidadFacturada);
    const ent = this.num(item?.cantidadEntregada);
    const dev = this.num(item?.cantidadDevuelta);
    const base = fact - ent - dev;
    if (!this.esItemMetrosCajaPieza(item)) return base;
    const mc = this.m2PorCajaDeItem(item);
    const pp = this.piezasPorCajaDeItem(item);
    if (mc <= 0 || pp <= 0) return base;
    const pFact = this.piezasTotalesFacturado(item);
    const pEnt = this.piezasTotalesDesdeM2(ent, item);
    const pDev = this.piezasTotalesDesdeM2(dev, item);
    const umbral = this.umbralM2MediaPieza(item);
    if (pEnt + pDev >= pFact && ent + dev <= fact + umbral) {
      return 0;
    }
    return base;
  }

  formatoCantidadLinea(m2: number, item: any): string {
    if (!this.esItemMetrosCajaPieza(item)) {
      return String(this.num(m2));
    }
    const { cajas, piezas } = this.cajasPiezasDesdeM2(m2, item);
    return `${this.num(m2).toFixed(2)} m² (${cajas} C + ${piezas} P)`;
  }

  private prepararOrdenParaVista(orden: any) {
    const copia = JSON.parse(JSON.stringify(orden || {}));
    copia.items = (copia.items || []).map((item: any) => {
      const pend = this.pendienteEfectivo(item);
      return {
        ...item,
        pendiente: pend,
        estadoGestion:
          pend <= 0
            ? "ENTREGA_TOTAL"
            : Number(item.cantidadDevuelta || 0) > 0
            ? "DEVOLUCION"
            : "ENTREGA_PARCIAL",
        cantidadEntregadaInput: 0,
        entregaCajasInput: 0,
        entregaPiezasInput: 0,
        fechaCompromisoInput: item.fechaCompromiso || "",
        notasInput: "",
      };
    });
    return copia;
  }

  private m2OperacionIngresada(item: any): number {
    if (this.esItemMetrosCajaPieza(item)) {
      const m2c = this.m2PorCajaDeItem(item);
      const ppc = this.piezasPorCajaDeItem(item);
      const cajas = this.num(item?.entregaCajasInput);
      const piezas = this.num(item?.entregaPiezasInput);
      if (m2c <= 0 || ppc <= 0) return 0;
      return cajas * m2c + (piezas / ppc) * m2c;
    }
    return this.num(item?.cantidadEntregadaInput);
  }

  /**
   * ABIERTO: aún no hay entregas registradas en el ítem (servidor) ni borrador de esta operación.
   * No basta con `ingreso === 0`: tras guardar, los inputs se resetean a 0 pero `cantidadEntregada` ya es > 0.
   */
  estadoGestionAutomatico(item: any): "ENTREGA_TOTAL" | "ENTREGA_PARCIAL" | "ABIERTO" {
    const pendiente = this.num(item?.pendiente);
    const ingreso = this.m2OperacionIngresada(item);
    const entregadoAcum = this.num(item?.cantidadEntregada);
    const devueltaAcum = this.num(item?.cantidadDevuelta);
    const sinMovimientoEnServidor =
      entregadoAcum <= 0.0001 && devueltaAcum <= 0.0001;

    if (sinMovimientoEnServidor && ingreso === 0) {
      return "ABIERTO";
    }
    if (pendiente <= 0 || ingreso >= pendiente + 0.0001) {
      return "ENTREGA_TOTAL";
    }
    return "ENTREGA_PARCIAL";
  }

  esCompromisoBloqueado(item: any): boolean {
    return this.estadoGestionAutomatico(item) === "ENTREGA_TOTAL";
  }

  private refrescarCamposEventoItem(index: number) {
    const item = this.ordenSeleccionada?.items?.[index];
    if (!item || this.num(item?.pendiente) <= 0) return;
    item.fechaCompromisoInput = "";
    item.notasInput = "";
    item.cantidadEntregadaInput = 0;
    item.entregaCajasInput = 0;
    item.entregaPiezasInput = 0;
  }

  /** Copia lo que el usuario escribió en cada línea (antes del POST). */
  private capturarEntradasItems(orden: any): BorradorLineaEntrega[] {
    if (!orden?.items?.length) {
      return [];
    }
    return orden.items.map((it: any) => ({
      cantidadEntregadaInput: this.num(it?.cantidadEntregadaInput),
      entregaCajasInput: this.num(it?.entregaCajasInput),
      entregaPiezasInput: this.num(it?.entregaPiezasInput),
      fechaCompromisoInput: it?.fechaCompromisoInput,
      notasInput: it?.notasInput != null ? String(it.notasInput) : "",
    }));
  }

  /**
   * Tras traer datos del servidor, restaura solo las líneas que no se acaban de guardar,
   * para no perder cajas/piezas/notas pendientes de confirmar.
   */
  private aplicarBorradorOtrasLineas(
    orden: any,
    borrador: BorradorLineaEntrega[],
    indiceGuardado: number
  ): void {
    if (!orden?.items?.length || !borrador?.length) {
      return;
    }
    orden.items.forEach((it: any, j: number) => {
      if (j === indiceGuardado) {
        return;
      }
      const b = borrador[j];
      if (!b) {
        return;
      }
      it.cantidadEntregadaInput = b.cantidadEntregadaInput;
      it.entregaCajasInput = b.entregaCajasInput;
      it.entregaPiezasInput = b.entregaPiezasInput;
      it.fechaCompromisoInput = b.fechaCompromisoInput;
      it.notasInput = b.notasInput;
    });
  }

  private sincronizarOrdenEnListado(ordenVista: any): void {
    const idx = this.ordenes.findIndex((x) => x._id === ordenVista._id);
    if (idx >= 0) {
      this.ordenes[idx] = ordenVista;
    } else {
      this.ordenes.unshift(ordenVista);
    }
  }

  private mostrarFeedbackGuardadoLinea(index: number): void {
    if (this.timeoutsGuardadoFlash[index]) {
      clearTimeout(this.timeoutsGuardadoFlash[index]);
    }
    this.lineasGuardadoFlash = { ...this.lineasGuardadoFlash, [index]: true };
    this.timeoutsGuardadoFlash[index] = setTimeout(() => {
      const next = { ...this.lineasGuardadoFlash };
      delete next[index];
      this.lineasGuardadoFlash = next;
      delete this.timeoutsGuardadoFlash[index];
    }, 3500);
  }

  private limpiarIndicadoresGuardadoLinea(): void {
    Object.keys(this.timeoutsGuardadoFlash).forEach((k) =>
      clearTimeout(this.timeoutsGuardadoFlash[+k])
    );
    this.timeoutsGuardadoFlash = {};
    this.lineasGuardadoFlash = {};
  }

  private formatoPendienteReporte(item: any, pendiente: number): string {
    if (this.esItemMetrosCajaPieza(item)) {
      const { cajas, piezas } = this.cajasPiezasDesdeM2(pendiente, item);
      return `${cajas}C ${piezas}P`;
    }
    return String(Math.trunc(this.num(pendiente)));
  }

  private construirResumenProductosPendientes(ordenes: any[]): any[] {
    const filas: any[] = [];
    (ordenes || [])
      .filter((o: any) => ["ABIERTA", "NOVEDAD"].includes(String(o?.estadoProceso || "")))
      .forEach((orden: any) => {
        (orden.items || []).forEach((item: any) => {
          const pendiente = this.num(item?.pendiente);
          if (pendiente <= 0) return;
          const rawFechaDoc = orden?.fechaDocumento;
          let fechaDoc: Date | null = null;
          if (rawFechaDoc != null && rawFechaDoc !== "") {
            const d =
              rawFechaDoc instanceof Date
                ? rawFechaDoc
                : new Date(rawFechaDoc);
            if (!Number.isNaN(d.getTime())) {
              fechaDoc = d;
            }
          }
          const tsFechaDoc = fechaDoc ? fechaDoc.getTime() : 0;
          filas.push({
            fecha: fechaDoc,
            fechaDocumentoOrden: tsFechaDoc,
            documentoNumero: orden?.documentoNumero ?? "",
            tipoDocumento: orden?.tipoDocumento ?? "",
            clienteNombre: orden?.clienteNombre || "Cliente sin nombre",
            productoNombre: item?.productoNombre || "Producto sin nombre",
            notas: item?.notas ?? "",
            cantidadPendienteTexto: this.formatoPendienteReporte(item, pendiente),
            fechaCompromisoTexto: item?.fechaCompromiso
              ? this.formatearFechaIso(item.fechaCompromiso)
              : "Sin fecha",
          });
        });
      });

    filas.sort(
      (a, b) => (b.fechaDocumentoOrden || 0) - (a.fechaDocumentoOrden || 0)
    );
    return filas.map(({ fechaDocumentoOrden: _ts, ...rest }) => rest);
  }

  /**
   * Existencias en bodega matriz a partir de transacciones (misma lógica que
   * `cargarDatosProductoUnitario` en consolidado para sucursal "matriz").
   */
  private stockMatrizDesdeTransacciones(
    nombreProducto: string,
    transacciones: any[]
  ): { cajas: number; piezas: number } {
    let contCajas = 0;
    let contPiezas = 0;
    (transacciones || []).forEach((element) => {
      if (
        nombreProducto !== element.producto ||
        element.sucursal !== "matriz"
      ) {
        return;
      }
      switch (element.tipo_transaccion) {
        case "devolucion":
          contCajas = Number(element.cajas) + contCajas;
          contPiezas = Number(element.piezas) + contPiezas;
          break;
        case "compra-dir":
        case "compra":
        case "compra_obs":
          contCajas = Number(contCajas) + Number(element.cajas);
          contPiezas = Number(contPiezas) + Number(element.piezas);
          break;
        case "ajuste-faltante":
        case "baja":
        case "venta-fact":
        case "venta-not":
        case "traslado1":
          contCajas = Number(contCajas) - Number(element.cajas);
          contPiezas = Number(contPiezas) - Number(element.piezas);
          break;
        case "traslado2":
        case "ajuste-sobrante":
          contCajas = Number(contCajas) + Number(element.cajas);
          contPiezas = Number(contPiezas) + Number(element.piezas);
          break;
        default:
          break;
      }
    });
    return { cajas: contCajas, piezas: contPiezas };
  }

  private formatoStockBodegaMatriz(
    cajas: number,
    piezas: number,
    item: any
  ): string {
    const c = this.num(cajas);
    const p = this.num(piezas);
    if (this.esItemMetrosCajaPieza(item)) {
      const pp = this.piezasPorCajaDeItem(item);
      const mc = this.m2PorCajaDeItem(item);
      if (pp > 0 && mc > 0) {
        const m2 = (c * pp + p) * (mc / pp);
        return this.formatoCantidadLinea(m2, item);
      }
    }
    const pp = this.piezasPorCajaDeItem(item);
    if (pp > 0) {
      return `${Math.trunc(c)} C + ${Math.trunc(p)} P`;
    }
    return `${Math.trunc(c + p)} u`;
  }

  private agregarPendientesPorProducto(ordenes: any[]): Array<{
    productoNombre: string;
    itemMuestra: any;
    pendienteM2Sum: number;
    pendienteUnidadesSum: number;
    esMetro: boolean;
  }> {
    const map = new Map<
      string,
      {
        productoNombre: string;
        itemMuestra: any;
        pendienteM2Sum: number;
        pendienteUnidadesSum: number;
        esMetro: boolean;
      }
    >();

    (ordenes || [])
      .filter((o: any) =>
        ["ABIERTA", "NOVEDAD"].includes(String(o?.estadoProceso || ""))
      )
      .forEach((orden: any) => {
        (orden.items || []).forEach((item: any) => {
          const pendiente = this.pendienteEfectivo(item);
          if (pendiente <= 0) {
            return;
          }
          const nombre = String(
            item?.productoNombre || "Producto sin nombre"
          ).trim();
          const metro = this.esItemMetrosCajaPieza(item);
          let fila = map.get(nombre);
          if (!fila) {
            fila = {
              productoNombre: nombre,
              itemMuestra: item,
              pendienteM2Sum: 0,
              pendienteUnidadesSum: 0,
              esMetro: metro,
            };
            map.set(nombre, fila);
          }
          if (metro) {
            fila.pendienteM2Sum += pendiente;
            fila.esMetro = true;
          } else {
            fila.pendienteUnidadesSum += pendiente;
          }
        });
      });

    return Array.from(map.values()).sort((a, b) =>
      a.productoNombre.localeCompare(b.productoNombre, "es")
    );
  }

  private enriquecerBalanceProductosPendientes(
    ordenes: any[],
    sincronizarExpandida: () => void
  ): void {
    const agregados = this.agregarPendientesPorProducto(ordenes);
    if (!agregados.length) {
      this.productosPendientesBalance = [];
      sincronizarExpandida();
      this.loading = false;
      return;
    }
    const unicos = [...new Set(agregados.map((a) => a.productoNombre))];
    const productoM = new productoMultiple();
    productoM.array = unicos;

    this.transaccionesService
      .getTransaccionesPorProductoMultiple(productoM)
      .subscribe({
        next: (res: any[]) => {
          const trans = (res || []) as any[];
          this.productosPendientesBalance = agregados
            .map((row) => {
              const item = row.itemMuestra;
              const { cajas, piezas } = this.stockMatrizDesdeTransacciones(
                row.productoNombre,
                trans
              );
              const pp = this.piezasPorCajaDeItem(item);
              const mc = this.m2PorCajaDeItem(item);
              const stockPiezas =
                pp > 0
                  ? this.num(cajas) * pp + this.num(piezas)
                  : this.num(cajas) + this.num(piezas);

              /** Inventario negativo se trata como 0 en pantalla y en el balance. */
              const stockPiezasEfectivo = Math.max(0, stockPiezas);
              const stockBodegaTexto =
                stockPiezas < 0
                  ? this.formatoStockBodegaMatriz(0, 0, item)
                  : this.formatoStockBodegaMatriz(cajas, piezas, item);

              let totalPendienteTexto: string;
              let balanceTexto: string;
              let balanceValor: number;

              if (row.esMetro && pp > 0 && mc > 0) {
                const pendUnidM2 =
                  row.pendienteUnidadesSum > 0
                    ? (this.num(row.pendienteUnidadesSum) / pp) * mc
                    : 0;
                const pendM2Total =
                  this.num(row.pendienteM2Sum) + pendUnidM2;
                totalPendienteTexto = this.formatoCantidadLinea(
                  pendM2Total,
                  item
                );
                const stockM2Efectivo =
                  (stockPiezasEfectivo / pp) * mc;
                const balanceM2 = stockM2Efectivo - pendM2Total;
                balanceTexto = this.formatoCantidadLinea(balanceM2, item);
                balanceValor = balanceM2;
              } else {
                const pend = this.num(row.pendienteUnidadesSum);
                totalPendienteTexto = String(Math.trunc(pend));
                const bal = stockPiezasEfectivo - pend;
                balanceTexto = String(Math.trunc(bal));
                balanceValor = bal;
              }

              return {
                productoNombre: row.productoNombre,
                totalPendienteTexto,
                stockBodegaTexto,
                balanceTexto,
                balanceValor,
              };
            })
            .sort((a, b) => a.balanceValor - b.balanceValor);

          sincronizarExpandida();
          this.loading = false;
        },
        error: () => {
          sincronizarExpandida();
          this.loading = false;
          Swal.fire(
            "Error",
            "No se pudieron cargar las transacciones de inventario para calcular el balance.",
            "error"
          );
        },
      });
  }
}
