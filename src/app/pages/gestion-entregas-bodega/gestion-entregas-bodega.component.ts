import { Component, OnDestroy, OnInit } from "@angular/core";
import { forkJoin, Subscription } from "rxjs";
import Swal from "sweetalert2";
import pdfMake from "pdfmake/build/pdfmake";
import { productoMultiple } from "src/app/pages/consolidado/consolidado";
import { EntregasBodegaService } from "src/app/servicios/entregas-bodega.service";
import { ProductosPendientesService } from "src/app/servicios/productos-pendientes.service";
import { TransaccionesService } from "src/app/servicios/transacciones.service";
import { ScreenService } from "src/app/shared/services";
import { objDate } from "../transacciones/transacciones";

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
    //"Productos Pendientes Entrega",
  ];
  valorMenu = "Gestión Entregas";
  mostrarGestion = true;
  mostrarListado = false;
  obj: objDate;
  /**
   * ninguno: gestión o listado de órdenes.
   * facturados: detalle por factura/cliente (productos facturados sin entregar).
   * pendientes: unificación por producto + transacciones (balance vs bodega matriz).
   * pendientesEntrega: listado de productos en estado PENDIENTE del módulo legacy.
   */
  vistaProductosEspecial:
    | "ninguno"
    | "facturados"
    | "pendientes"
    | "pendientesEntrega" = "ninguno";

  /** Resumen detallado (vista facturados). */
  productosPendientes: any[] = [];
  /** Agregado por producto con stock y balance (vista pendientes). */
  productosPendientesBalance: any[] = [];
  /** Listado legacy de productos pendientes por entrega (sin filtros). */
  productosPendientesEntrega: any[] = [];

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
    "DEVUELTO",
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

  /** Índices de línea con guardado confirmado en esta sesión (hasta cambiar orden o vista). */
  lineasGuardadoFlash: Record<number, boolean> = {};

  private screenSub: Subscription;

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
        "<p>Se eliminará la trazabilidad de entregas y se conservará la trazabilidad de devoluciones. La orden volverá a estado <strong>ABIERTA</strong>, como al inicio.</p>",
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
          this.refrescarProductosPendientesEntregaSiAplica();
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
          this.refrescarProductosPendientesEntregaSiAplica();
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
    private productosPendientesService: ProductosPendientesService,
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
    return this.ingresoExcedePendiente(this.m2OperacionIngresada(item), pendiente);
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
      /* case "Productos Pendientes":
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
        break; */
      case "Productos Pendientes":
        this.mostrarGestion = false;
        this.mostrarListado = false;
        this.vistaProductosEspecial = "pendientesEntrega";
        this.incluirCerradas = false;
        this.ordenSeleccionada = null;
        this.expandedOrderId = null;
        this.expandedItemIndex = null;
        this.limpiarIndicadoresGuardadoLinea();
        this.popupTrazabilidadVisible = false;
        this.cargarProductosPendientesEntrega();
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

  /**
   * Misma vista que el popup de trazabilidad (bitácora e historial por ítem ordenados por fecha desc.).
   */
  private prepararVistaTrazabilidad(fila: any): any {
    if (!fila) {
      return null;
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
    return o;
  }

  abrirPopupTrazabilidad(fila: any) {
    const o = this.prepararVistaTrazabilidad(fila);
    if (!o) {
      return;
    }
    this.ordenTrazabilidad = o;
    this.popupTrazabilidadVisible = true;
  }

  /** Columna tipo botones (listado): descarga PDF con la misma trazabilidad que el popup. */
  descargarPdfTrazabilidadListado = (e: any) => {
    const fila = e?.row?.data;
    if (!fila) {
      return;
    }
    const vista = this.prepararVistaTrazabilidad(fila);
    if (!vista) {
      return;
    }
    try {
      const doc = this.buildDocumentDefinitionTrazabilidadPdf(vista);
      const n = vista.consecutivoEntrega != null ? String(vista.consecutivoEntrega) : "orden";
      pdfMake.createPdf(doc).download(`Trazabilidad_entrega_bodega_${n}.pdf`);
    } catch (err) {
      console.error(err);
      Swal.fire("Error", "No se pudo generar el PDF de trazabilidad.", "error");
    }
  };

  descargarPdfTrazabilidadDesdeOrden(orden: any, ev?: Event): void {
    if (ev) {
      ev.stopPropagation();
      ev.preventDefault();
    }
    this.descargarPdfTrazabilidadListado({ row: { data: orden } });
  }

  descargarPdfSimpleListado = (e: any) => {
    const fila = e?.row?.data;
    if (!fila) {
      return;
    }
    const vista = this.prepararVistaTrazabilidad(fila);
    if (!vista) {
      return;
    }
    try {
      const doc = this.buildDocumentDefinitionSimplePdf(vista);
      const n = vista.consecutivoEntrega != null ? String(vista.consecutivoEntrega) : "orden";
      pdfMake.createPdf(doc).download(`Orden_entrega_simple_${n}.pdf`);
    } catch (err) {
      console.error(err);
      Swal.fire("Error", "No se pudo generar el PDF simple.", "error");
    }
  };

  descargarPdfSimpleDesdeOrden(orden: any, ev?: Event): void {
    if (ev) {
      ev.stopPropagation();
      ev.preventDefault();
    }
    this.descargarPdfSimpleListado({ row: { data: orden } });
  }

  private txtPdf(v: any): string {
    if (v == null || v === "") {
      return "";
    }
    return String(v);
  }

  private buildDocumentDefinitionSimplePdf(o: any): any {
    const items = Array.isArray(o?.items) ? o.items : [];
    const bodyItems: any[] = [
      [
        { text: "Producto", style: "th" },
        { text: "Fact", style: "th", alignment: "center" },
        { text: "Ent", style: "th", alignment: "center" },
        { text: "Dev", style: "th", alignment: "center" },
        { text: "Pend", style: "th", alignment: "center" },
        { text: "Est", style: "th", alignment: "center" },
      ],
    ];

    if (!items.length) {
      bodyItems.push([
        { text: "Sin ítems registrados.", style: "td", colSpan: 6 },
        {},
        {},
        {},
        {},
        {},
      ]);
    } else {
      items.forEach((it: any) => {
        bodyItems.push([
          { text: this.txtPdf(it.productoNombre), style: "td" },
          { text: this.formatoCantidadLinea(it.cantidadFacturada, it), style: "td", alignment: "center" },
          { text: this.formatoCantidadLinea(it.cantidadEntregada, it), style: "td", alignment: "center" },
          { text: this.formatoCantidadLinea(it.cantidadDevuelta, it), style: "td", alignment: "center" },
          { text: this.formatoCantidadLinea(this.pendienteEfectivo(it), it), style: "td", alignment: "center" },
          { text: this.txtPdf(it.estadoItem || ""), style: "td", alignment: "center" },
        ]);
      });
    }

    return {
      pageSize: "A4",
      pageOrientation: "portrait",
      pageMargins: [32, 36, 32, 36],
      content: [
        { text: "DOCUMENTO VENTA / ORDEN DE ENTREGA", style: "header" },
        {
          text:
            `${this.txtPdf(o.tipoDocumento)} #${this.txtPdf(o.documentoNumero)} - ${this.txtPdf(o.clienteNombre)}`,
          style: "subheader",
          margin: [0, 2, 0, 10],
        },
        {
          style: "tableMain",
          table: {
            widths: [110, "*", 110, "*"],
            body: [
              [
                { text: "Orden #", style: "th" },
                { text: this.txtPdf(o.consecutivoEntrega), style: "td" },
                { text: "Estado", style: "th" },
                { text: this.txtPdf(o.estadoProceso), style: "td" },
              ],
              [
                { text: "Fecha doc.", style: "th" },
                { text: this.txtPdf(this.formatearFechaDocumentoListado(o)), style: "td" },
                { text: "Cliente", style: "th" },
                { text: this.txtPdf(o.clienteNombre), style: "td" },
              ],
            ],
          },
          layout: "lightHorizontalLines",
          margin: [0, 0, 0, 10],
        },
        {
          style: "tableMain",
          table: {
            widths: ["34%", "11%", "11%", "11%", "11%", "22%"],
            body: bodyItems,
          },
          layout: "lightHorizontalLines",
        },
      ],
      styles: {
        header: { fontSize: 13, bold: true, alignment: "center" },
        subheader: { fontSize: 11, bold: true, alignment: "center" },
        th: { bold: true, fontSize: 8, fillColor: "#efefef" },
        td: { fontSize: 8 },
        tableMain: { fontSize: 8 },
      },
      defaultStyle: { fontSize: 9 },
    };
  }

  private buildDocumentDefinitionTrazabilidadPdf(o: any): any {
    const fechaDoc = this.txtPdf(o.fechaDocumento);
    const resumenRows: any[] = [
      [
        { text: "Consecutivo", style: "th" },
        { text: this.txtPdf(o.consecutivoEntrega), style: "td" },
        { text: "Estado proceso", style: "th" },
        { text: this.txtPdf(o.estadoProceso), style: "td" },
      ],
      [
        { text: "Tipo documento", style: "th" },
        { text: this.txtPdf(o.tipoDocumento), style: "td" },
        { text: "Fecha documento", style: "th" },
        { text: fechaDoc, style: "td" },
      ],
      [
        { text: "N.º documento venta", style: "th" },
        { text: this.txtPdf(o.documentoNumero), style: "td" },
        { text: "Cliente", style: "th" },
        { text: this.txtPdf(o.clienteNombre), style: "td" },
      ],
    ];
    if (o.createdAt) {
      resumenRows.push([
        { text: "Creada en sistema", style: "th" },
        { text: this.formatearFechaIso(o.createdAt), style: "td", colSpan: 3 },
        {},
        {},
      ]);
    }
    if (o.updatedAt) {
      resumenRows.push([
        { text: "Última actualización", style: "th" },
        { text: this.formatearFechaIso(o.updatedAt), style: "td", colSpan: 3 },
        {},
        {},
      ]);
    }

    const bitacora = Array.isArray(o.trazabilidad) ? o.trazabilidad : [];
    const bitacoraBody: any[] = [
      [
        { text: "Fecha / hora", style: "th" },
        { text: "Usuario", style: "th" },
        { text: "Acción", style: "th" },
        { text: "Detalle", style: "th" },
      ],
    ];
    if (bitacora.length === 0) {
      bitacoraBody.push([
        { text: "Sin registros en la bitácora de la orden.", style: "tdSmall", colSpan: 4 },
        {},
        {},
        {},
      ]);
    } else {
      bitacora.forEach((t: any) => {
        bitacoraBody.push([
          { text: this.txtPdf(t.fechaFmt || t.fecha), style: "tdSmall" },
          { text: this.txtPdf(t.usuario), style: "tdSmall" },
          { text: this.txtPdf(t.accion), style: "tdSmall" },
          { text: this.txtPdf(t.detalle), style: "tdSmall" },
        ]);
      });
    }

    const content: any[] = [
      {
        text: "Trazabilidad · Entrega de bodega",
        style: "header",
        margin: [0, 0, 0, 4],
      },
      {
        text: `Generado: ${new Date().toLocaleString()}`,
        fontSize: 8,
        color: "#555",
        margin: [0, 0, 0, 12],
      },
      { text: "Resumen de la orden", style: "subheader", margin: [0, 0, 0, 6] },
      {
        style: "tableMain",
        table: {
          widths: ["22%", "28%", "22%", "28%"],
          body: resumenRows,
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 14],
      },
      { text: "Bitácora del proceso (orden)", style: "subheader", margin: [0, 0, 0, 6] },
      {
        style: "tableMain",
        table: {
          widths: [80, 70, 70, "*"],
          body: bitacoraBody,
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 14],
      },
      { text: "Ítems y movimientos por línea", style: "subheader", margin: [0, 0, 0, 6] },
    ];

    const items = Array.isArray(o.items) ? o.items : [];
    if (!items.length) {
      content.push({
        text: "Sin ítems en esta orden.",
        italics: true,
        fontSize: 9,
        margin: [0, 0, 0, 8],
      });
    } else {
      items.forEach((it: any, idx: number) => {
        const hist = Array.isArray(it.historialOrdenado) ? it.historialOrdenado : [];
        const vHist = this.devolucionVirtualAcumuladaDesdeHistorial(it);
        const fHist = this.devolucionFisicaAcumuladaDesdeHistorial(it);
        const sub =
          `Facturado: ${this.formatoCantidadLinea(it.cantidadFacturada, it)} · ` +
          `Entregado: ${this.formatoCantidadLinea(it.cantidadEntregada, it)} · ` +
          `Devuelto: ${this.formatoCantidadLinea(it.cantidadDevuelta, it)} ` +
          `(virtual: ${this.formatoCantidadLinea(vHist, it)} · física: ${this.formatoCantidadLinea(
            fHist,
            it
          )}) · ` +
          `Pendiente: ${this.formatoCantidadLinea(this.pendienteEfectivo(it), it)} · ` +
          `Estado ítem: ${this.txtPdf(it.estadoItem)}`;
        content.push({
          text: `${idx + 1}. ${this.txtPdf(it.productoNombre)}`,
          style: "itemTitle",
          margin: [0, 10, 0, 2],
        });
        content.push({
          text: sub,
          fontSize: 8,
          color: "#333",
          margin: [0, 0, 0, 6],
        });
        if (!hist.length) {
          content.push({
            text: "Sin movimientos registrados en este ítem.",
            italics: true,
            fontSize: 8,
            margin: [0, 0, 0, 8],
          });
          return;
        }
        const histBody: any[] = [
          [
            { text: "Fecha / hora", style: "th" },
            { text: "Usuario", style: "th" },
            { text: "Acción", style: "th" },
            { text: "Estado sel.", style: "th" },
            { text: "Entr. acum.", style: "th" },
            { text: "Dev. acum.", style: "th" },
            { text: "m² op.", style: "th" },
            { text: "Cajas", style: "th" },
            { text: "Piezas", style: "th" },
            { text: "Notas", style: "th" },
          ],
        ];
        hist.forEach((h: any) => {
          histBody.push([
            { text: this.txtPdf(h.fechaFmt || h.fecha), style: "tdMini" },
            { text: this.txtPdf(h.usuario), style: "tdMini" },
            { text: this.txtPdf(h.accion), style: "tdMini" },
            { text: this.txtPdf(h.estadoSeleccionado), style: "tdMini" },
            {
              text: this.num(h.cantidadEntregada).toFixed(2),
              style: "tdMini",
              alignment: "right",
            },
            {
              text: this.num(h.cantidadDevuelta).toFixed(2),
              style: "tdMini",
              alignment: "right",
            },
            {
              text: this.num(h.m2EntregadoEnEstaOperacion).toFixed(2),
              style: "tdMini",
              alignment: "right",
            },
            {
              text: this.txtPdf(h.entregaCajas),
              style: "tdMini",
              alignment: "right",
            },
            {
              text: this.txtPdf(h.entregaPiezas),
              style: "tdMini",
              alignment: "right",
            },
            { text: this.txtPdf(h.notas), style: "tdMini" },
          ]);
        });
        content.push({
          style: "tableMain",
          table: {
            widths: [52, 40, 40, 40, 30, 30, 30, 25, 25, "*"],
            body: histBody,
          },
          layout: "lightHorizontalLines",
          margin: [0, 0, 0, 4],
        });
      });
    }

    return {
      pageSize: "A4",
      pageOrientation: "portrait",
      pageMargins: [40, 40, 40, 48],
      styles: {
        header: { fontSize: 14, bold: true },
        subheader: { fontSize: 11, bold: true },
        itemTitle: { fontSize: 10, bold: true },
        th: { bold: true, fontSize: 8, fillColor: "#eeeeee" },
        td: { fontSize: 9 },
        tdSmall: { fontSize: 7 },
        tdMini: { fontSize: 6 },
        tableMain: { fontSize: 8 },
      },
      defaultStyle: { fontSize: 9 },
      content,
    };
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
        this.productosPendientesEntrega = [];

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
    console.log("ingreso", ingreso, "pendiente", pendiente);
    if (this.ingresoExcedePendiente(ingreso, pendiente)) {
      Swal.fire(
        "Cantidad inválida",
        "La cantidad ingresada supera el pendiente del ítem. Ajuste el valor antes de guardar.",
        "warning"
      );
      return;
    }
    const estadoUi = this.estadoGestionAutomatico(item);
    /** El API usa ENTREGA_PARCIAL | ENTREGA_TOTAL | DEVOLUCION | DEVUELTO; ABIERTO es solo etiqueta de UI. */
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
          this.refrescarProductosPendientesEntregaSiAplica();
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
    const fact = this.num(
      item?.cantidadFacturadaOriginal != null
        ? item?.cantidadFacturadaOriginal
        : item?.cantidadFacturada
    );
    const ent = this.num(item?.cantidadEntregada);
    // Regla de negocio: solo la devolución virtual reduce el pendiente.
    const devVirtual = this.num(item?.cantidadDevuelta);
    const base = fact - ent - devVirtual;
    if (!this.esItemMetrosCajaPieza(item)) return base;
    const mc = this.m2PorCajaDeItem(item);
    const pp = this.piezasPorCajaDeItem(item);
    if (mc <= 0 || pp <= 0) return base;
    const pFact = this.piezasTotalesDesdeM2(fact, item);
    const pEnt = this.piezasTotalesDesdeM2(ent, item);
    const pDevVirtual = this.piezasTotalesDesdeM2(devVirtual, item);
    const umbral = this.umbralM2MediaPieza(item);
    if (pEnt + pDevVirtual >= pFact && ent + devVirtual <= fact + umbral) {
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

  mostrarResumenAjusteFisico(item: any): boolean {
    return this.num(item?.cantidadDevueltaFisica) > 0.0001;
  }

  resumenFacturadoProceso(item: any): string {
    const original = this.num(item?.cantidadEntregada);
    const fisica = this.num(item?.cantidadDevueltaFisica);
    const proceso = Math.max(0, original - fisica);
    return `Original: ${this.formatoCantidadLinea(original, item)} | Actualizado: ${this.formatoCantidadLinea(proceso, item)}`;
  }

  resumenFacturadoProcesoDev(item: any): string {
    const original = this.num(item?.cantidadFacturadaOriginal);
    const fisica = this.num(item?.cantidadDevueltaFisica);
    const proceso = this.num(item?.cantidadFacturadaProceso);
    return `Física: ${this.formatoCantidadLinea(
      fisica,
      item
    )} `;
  }

  /**
   * Suma devoluciones registradas en historial con tipo explícito o legado (sin tipo = virtual).
   */
  devolucionVirtualAcumuladaDesdeHistorial(item: any): number {
    let v = 0;
    const hist = Array.isArray(item?.historial) ? item.historial : [];
    for (const h of hist) {
      if (!this.esMovimientoDevolucion(h)) continue;
      const op = this.num(h?.m2EntregadoEnEstaOperacion);
      if (op <= 0) continue;
      const tipo = this.normalizarTipoDevolucionHistorial(h);

      if (tipo === "FISICA") continue;
      v += op;
    }
    return v;
  }

  devolucionFisicaAcumuladaDesdeHistorial(item: any): number {
    const fisicaDirecta = this.num(item?.cantidadDevueltaFisica);
    if (fisicaDirecta > 0) {
      return fisicaDirecta;
    }
    let f = 0;
    const hist = Array.isArray(item?.historial) ? item.historial : [];
    for (const h of hist) {
      if (!this.esMovimientoDevolucion(h)) continue;
      if (this.normalizarTipoDevolucionHistorial(h) !== "FISICA") continue;
      f += this.num(h?.m2EntregadoEnEstaOperacion);
    }
    return f;
  }

  private normalizarTipoDevolucionHistorial(h: any): "VIRTUAL" | "FISICA" {
    const crudo = String(
      h?.tipoDevolucion ??
        h?.tipo_devolucion ??
        h?.tipo ??
        ""
    )
      .trim()
      .toUpperCase();
    if (
      crudo === "FISICA" ||
      crudo === "FÍSICA" ||
      crudo === "DEV. FISICA" ||
      crudo === "DEVOLUCION FISICA"
    ) {
      return "FISICA";
    }
    return "VIRTUAL";
  }

  private esMovimientoDevolucion(h: any): boolean {
    const estado = String(h?.estadoSeleccionado || "").trim().toUpperCase();
    const accion = String(h?.accion || "").trim().toUpperCase();
    return (
      estado === "DEVUELTO" ||
      estado === "DEVOLUCION" ||
      accion.includes("DEVOLUC")
    );
  }

  private cantidadFacturadaAjustadaProceso(item: any): number {
    const facturada = this.num(
      item?.cantidadFacturadaOriginal != null
        ? item?.cantidadFacturadaOriginal
        : item?.cantidadFacturada
    );
    const fisica = this.devolucionFisicaAcumuladaDesdeHistorial(item);
    const ajustada = facturada - fisica;
    return ajustada > 0 ? ajustada : 0;
  }

  private prepararOrdenParaVista(orden: any) {
    const copia = JSON.parse(JSON.stringify(orden || {}));
    copia.items = (copia.items || []).map((item: any) => {
      const facturadaOriginal = this.num(item?.cantidadFacturada);
      const devueltaFisica = this.devolucionFisicaAcumuladaDesdeHistorial(item);
      const facturadaProceso = this.cantidadFacturadaAjustadaProceso(item);
      const pend = this.pendienteEfectivo(item);
      return {
        ...item,
        cantidadFacturadaOriginal: facturadaOriginal,
        cantidadFacturadaProceso: facturadaProceso,
        cantidadDevueltaFisica: devueltaFisica,
        pendiente: pend,
        estadoGestion:
          pend <= 0
            ? "ENTREGA_TOTAL"
            : devueltaFisica > 0
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
    const devueltaAcum = this.devolucionFisicaAcumuladaDesdeHistorial(item);
    const sinMovimientoEnServidor =
      entregadoAcum <= 0.0001 && devueltaAcum <= 0.0001;

    if (sinMovimientoEnServidor && ingreso === 0) {
      return "ABIERTO";
    }
    if (pendiente <= 0 || this.ingresoAlcanzaPendiente(ingreso, pendiente)) {
      return "ENTREGA_TOTAL";
    }
    return "ENTREGA_PARCIAL";
  }

  /**
   * Evita falsos positivos por precisión flotante.
   * Se aplica tolerancia equivalente a trabajar con 2 decimales.
   */
  private ingresoExcedePendiente(ingreso: number, pendiente: number): boolean {
    // Se compara con precisión de 3 decimales para tolerar casos como:
    // ingreso 3.9285714285714284 pendiente 3.928571428571429
    // con redondeo, ambos serían iguales.
    const decimales = 4;
    const ingresoRedondeado = Number(ingreso.toFixed(decimales));
    const pendienteRedondeado = Number(pendiente.toFixed(decimales));
    console.log("ingresoRedondeado", ingresoRedondeado);
    console.log("pendienteRedondeado", pendienteRedondeado);
    console.log("ingresoRedondeado - pendienteRedondeado", ingresoRedondeado - pendienteRedondeado);
    return ingresoRedondeado - pendienteRedondeado > 0.010;
  }

  private ingresoAlcanzaPendiente(ingreso: number, pendiente: number): boolean {
    const tolerancia = 0.005;
    return pendiente - ingreso <= tolerancia;
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
    this.lineasGuardadoFlash = { ...this.lineasGuardadoFlash, [index]: true };
  }

  private limpiarIndicadoresGuardadoLinea(): void {
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
          // Usar el mismo pendiente ya preparado para vista, igual que "Facturados sin entregar".
          // Esto evita diferencias entre listados cuando hay devolución física/virtual.
          const pendiente =
            item?.pendiente != null ? this.num(item.pendiente) : this.pendienteEfectivo(item);
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
                let balanceM2 = stockM2Efectivo - pendM2Total;
                if (balanceM2 > 0) {
                  balanceM2 = 0;
                }
                balanceTexto = this.formatoCantidadLinea(balanceM2, item);
                balanceValor = balanceM2;
              } else {
                const pend = this.num(row.pendienteUnidadesSum);
                totalPendienteTexto = String(Math.trunc(pend));
                let bal = stockPiezasEfectivo - pend;
                if (bal > 0) {
                  bal = 0;
                }
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

  /** Tras guardar en bodega, alinear el listado legacy si el usuario está en esa vista. */
  private refrescarProductosPendientesEntregaSiAplica(): void {
    if (this.vistaProductosEspecial === "pendientesEntrega") {
      this.cargarProductosPendientesEntrega();
    }
  }

  /**
   * Ajuste visual de pendiente:
   * - restanteEsperado = facturado - pendienteBase
   * - en "entregado" se suma además la devolución virtual (orden: cantidadDevuelta)
   * - si (entregado + dev. virtual) > restanteEsperado, se descuenta el exceso del pendiente mostrado
   * No persiste cambios en base de datos.
   */
  /** Unifica espacios raros (NBSP, etc.) y mayúsculas para claves de Map estables. */
  private normalizarTextoClave(value: any): string {
    let s = String(value ?? "")
      .replace(/\u00A0/g, " ")
      .replace(/[\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ");
    try {
      s = s.normalize("NFC");
    } catch {
      /* sin Intl en runtime muy antiguo */
    }
    return s.replace(/\s+/g, " ").trim().toUpperCase();
  }

  private clavePendienteEntrega(
    documento: any,
    producto: any,
    tipoDocumento?: any
  ): string {
    const doc = this.normalizarTextoClave(documento);
    const prod = this.normalizarTextoClave(producto);
    console.log("tipoDocumento", tipoDocumento);
    if(tipoDocumento == "NOTA_VENTA") {
      tipoDocumento = "NOTA DE VENTA";
    }
    const tipo = this.normalizarTextoClave(tipoDocumento);
    return `${doc}__${tipo}__${prod}`;
  }

  /** Misma semántica de documento / tipo / nombre que en filas de pendientes. */
  private clavePendienteEntregaDesdeOrdenYItem(orden: any, item: any): string {
    const doc = orden?.documentoNumero ?? orden?.documento;
    const tipo = orden?.tipoDocumento ?? orden?.tipo_documento;
    const prod = item?.productoNombre ?? item?.producto?.PRODUCTO;
    return this.clavePendienteEntrega(doc, prod, tipo);
  }

  private clavePendienteEntregaDesdeFilaPendiente(row: any): string {
    const doc = row?.documentoNumero ?? row?.documento;
    const tipo = row?.tipoDocumento ?? row?.tipo_documento;
    const prod = row?.productoNombre ?? row?.producto?.PRODUCTO;
    return this.clavePendienteEntrega(doc, prod, tipo);
  }

  private construirMapaFacturadoRealDesdeOrdenes(ordenes: any[]): Map<string, number> {
    const mapa = new Map<string, number>();
    (ordenes || []).forEach((orden: any) => {
      (orden?.items || []).forEach((it: any) => {
        const factM2 = this.num(
          it?.cantidadFacturadaOriginal != null
            ? it?.cantidadFacturadaOriginal
            : it?.cantidadFacturada
        );
        const factUnidades = this.esItemMetrosCajaPieza(it)
          ? this.piezasTotalesDesdeM2(factM2, it)
          : factM2;
        const fact = Math.max(0, Math.trunc(factUnidades));
        if (fact <= 0) {
          return;
        }
        const key = this.clavePendienteEntregaDesdeOrdenYItem(orden, it);
        mapa.set(key, (mapa.get(key) || 0) + fact);
      });
    });
    return mapa;
  }

  private construirMapaDevolucionVirtualDesdeOrdenes(ordenes: any[]): Map<string, number> {
    const mapa = new Map<string, number>();
    (ordenes || []).forEach((orden: any) => {
      (orden?.items || []).forEach((it: any) => {
        const virtualHistorial = this.devolucionVirtualAcumuladaDesdeHistorial(it);
        const v = virtualHistorial > 0 ? virtualHistorial : this.num(it?.cantidadDevuelta);
        if (v <= 0) {
          return;
        }
        const key = this.clavePendienteEntregaDesdeOrdenYItem(orden, it);
        const vUn = this.esItemMetrosCajaPieza(it)
          ? this.piezasTotalesDesdeM2(v, it)
          : v;
        mapa.set(key, (mapa.get(key) || 0) + Math.max(0, this.num(vUn)));
      });
    });
    return mapa;
  }

  private pendienteDesdeTexto(
    cantidadPendienteTexto: any
  ): { cajas: number; piezas: number; total: number } {
    const txt = String(cantidadPendienteTexto ?? "")
      .trim()
      .toUpperCase();
    if (!txt) {
      return { cajas: 0, piezas: 0, total: 0 };
    }
    const mCajas = txt.match(/(-?\d+)\s*C\b/);
    const mPiezas = txt.match(/(-?\d+)\s*P\b/);
    if (mCajas || mPiezas) {
      const cajas = mCajas ? Number(mCajas[1]) : 0;
      const piezas = mPiezas ? Number(mPiezas[1]) : 0;
      const c = Math.max(0, Math.trunc(this.num(cajas)));
      const p = Math.max(0, Math.trunc(this.num(piezas)));
      return { cajas: c, piezas: p, total: c + p };
    }
    const total = Math.max(0, Math.trunc(this.num(txt)));
    return { cajas: 0, piezas: total, total };
  }

  private construirMapaPendienteDesdeTextoOrdenes(
    ordenes: any[]
  ): Map<string, { cajas: number; piezas: number; total: number }> {
    const mapa = new Map<string, { cajas: number; piezas: number; total: number }>();
    (ordenes || [])
      .filter((o: any) => ["ABIERTA", "NOVEDAD"].includes(String(o?.estadoProceso || "")))
      .forEach((orden: any) => {
        (orden?.items || []).forEach((item: any) => {
          const pendienteNum =
            item?.pendiente != null ? this.num(item.pendiente) : this.pendienteEfectivo(item);
          if (pendienteNum <= 0) {
            return;
          }
          const pendienteTxt = this.formatoPendienteReporte(item, pendienteNum);
          const pendiente = this.pendienteDesdeTexto(pendienteTxt);
          if (pendiente.total <= 0) {
            return;
          }
          const key = this.clavePendienteEntregaDesdeOrdenYItem(orden, item);
          const prev = mapa.get(key) ?? { cajas: 0, piezas: 0, total: 0 };
          const next = {
            cajas: prev.cajas + pendiente.cajas,
            piezas: prev.piezas + pendiente.piezas,
            total: prev.total + pendiente.total,
          };
          mapa.set(key, next);
        });
    });
    return mapa;
  }

  private repartirUnidadesEnCajasPiezas(
    totalUnidades: number,
    row: any
  ): { cajas: number; piezas: number } {
    const total = Math.max(0, Math.trunc(this.num(totalUnidades)));
    const pPorCaja = Math.max(0, Math.trunc(this.num(row?.producto?.P_CAJA)));
    if (pPorCaja > 0) {
      const cajas = Math.trunc(total / pPorCaja);
      const piezas = total - cajas * pPorCaja;
      return { cajas, piezas };
    }
    return { cajas: 0, piezas: total };
  }

  private ajustarPendienteVisualPendientesEntrega(
    row: any,
    facturadoReal?: number,
    devolucionVirtualUnidades?: number,
    pendienteProceso?: { cajas: number; piezas: number; total: number }
  ): any {
    console.log("producto", row.producto.PRODUCTO);
    console.log("row", row);
    console.log("pendienteProceso", pendienteProceso);
    if (pendienteProceso == null) {
      return row;
    }
    if (pendienteProceso) {
      // Fuente de verdad: mismo pendiente consolidado que usa "Facturados sin entregar".
      if (
        row?.cajasPen != null &&
        row?.piezasPen != null &&
        pendienteProceso != null
      ) {
        const m2PorCaja = this.m2PorCajaDeItem(row);
        const piezasPorCaja = this.piezasPorCajaDeItem(row);
        const factorM2PorPieza =
          m2PorCaja > 0 && piezasPorCaja > 0 ? m2PorCaja / piezasPorCaja : 0;

          console.log("m2PorCaja", m2PorCaja);
          console.log("piezasPorCaja", piezasPorCaja);
          console.log("factorM2PorPieza", factorM2PorPieza);
          console.log("pendienteProceso", pendienteProceso);
          console.log("row.cajasPen", row.cajasPen);
          console.log("row.piezasPen", row.piezasPen);
          console.log("row.cantM2Pen", row.cantM2Pen);
          console.log("row.cajasEntregadas", row.cajasEntregadas);
          console.log("row.piezasEntregadas", row.piezasEntregadas);
          console.log("devolucionVirtualUnidades", devolucionVirtualUnidades);

        const m2PendienteProceso =
          this.num(pendienteProceso.cajas) * m2PorCaja +
          this.num(pendienteProceso.piezas) * factorM2PorPieza;
        const m2PendienteBase =
          this.num(row.cajasPen) * m2PorCaja +
          this.num(row.piezasPen) * factorM2PorPieza;

        if (m2PendienteProceso > m2PendienteBase) {
          return {
            ...row,
            cajas: Math.max(0, Math.trunc(this.num(row?.cajasPen))),
            piezas: Math.max(0, Math.trunc(this.num(row?.piezasPen))),
          };
        }
      }

      return {
        ...row,
        cajas: Math.max(0, Math.trunc(this.num(pendienteProceso.cajas))),
        piezas: Math.max(0, Math.trunc(this.num(pendienteProceso.piezas))),
      };
    }

    const baseCajas = Math.max(0, Math.trunc(this.num(row?.cajasPen)));
    const basePiezas = Math.max(0, Math.trunc(this.num(row?.piezasPen)));
    const baseCantM2 = Math.max(0, this.num(row?.cantM2Pen));
    const pendienteBase = baseCajas + basePiezas;
    const inventarioInicial =
      baseCajas + basePiezas > 0 ? baseCajas + basePiezas : baseCantM2;
    const facturadoFallback =
      Math.max(0, Math.trunc(this.num(row?.cajasPen))) +
      Math.max(0, Math.trunc(this.num(row?.piezasPen)));
    const facturado = Math.max(0, Math.trunc(this.num(facturadoReal)));
    const facturadoBase = facturado > 0 ? facturado : facturadoFallback;
    const entregado =
      Math.max(0, Math.trunc(this.num(row?.cajasEntregadas))) +
      Math.max(0, Math.trunc(this.num(row?.piezasEntregadas)));
    const entregadoConAjuste =
      entregado + Math.max(0, this.num(devolucionVirtualUnidades));


    if (pendienteBase <= 0 || facturadoBase <= 0) {
      return row;
    }

    const prodFacNoEntr = Math.max(0, facturadoBase - entregadoConAjuste);
    const diferencia = prodFacNoEntr - pendienteBase;
    const pendienteAjustado =
      diferencia >= 0
        ? Math.max(0, facturadoBase - inventarioInicial)
        : prodFacNoEntr;
    const objetivo = Math.max(0, Math.trunc(this.num(pendienteAjustado)));
    const { cajas: cajasAjustadas, piezas: piezasAjustadas } =
      this.repartirUnidadesEnCajasPiezas(objetivo, row);

      
      console.log("cajasAjustadas", cajasAjustadas);
      console.log("piezasAjustadas", piezasAjustadas);
    return {
      ...row,
      cajas: cajasAjustadas,
      piezas: piezasAjustadas,
    };
  }

  private cargarProductosPendientesEntrega(): void {
    this.loading = true;
    this.productosPendientesEntrega = [];
    this.obj = new objDate();
    this.obj.fechaActual = new Date();
    this.obj.fechaAnterior = new Date(2026, 4, 2); // 2 de mayo del 2026 (meses base 0);
    forkJoin({
      pendientes: this.productosPendientesService.getProductosPendientesPorRango(this.obj),
      ordenes: this.entregasBodegaService.getPendientes({ modoConsulta: "listado" }),
    }).subscribe({
      next: ({ pendientes, ordenes }: any) => {
        const listado = Array.isArray(pendientes) ? pendientes : [];
        const ordenesList = Array.isArray(ordenes) ? ordenes : [];
        const mapaFacturadoReal = this.construirMapaFacturadoRealDesdeOrdenes(
          ordenesList
        );
        const mapaDevolucionVirtual = this.construirMapaDevolucionVirtualDesdeOrdenes(
          ordenesList
        );
        const mapaPendienteProceso = this.construirMapaPendienteDesdeTextoOrdenes(
          ordenesList
        );
        const rol = (sessionStorage.getItem("rol") || "").trim();
        const sucursalSesion = (sessionStorage.getItem("sucursal") || "")
          .trim()
          .toLowerCase();
        const filtradosPorSucursal =
          rol === "Usuario" && sucursalSesion
            ? listado.filter(
                (x: any) =>
                  String(x?.sucursal || "").trim().toLowerCase() ===
                  sucursalSesion
              )
            : listado;

            console.log("mapaPendienteProceso", mapaPendienteProceso);
        this.productosPendientesEntrega = filtradosPorSucursal
          .filter((x: any) => String(x?.estado || "").trim().toUpperCase() === "PENDIENTE")
          .map((x: any) => {
            const key = this.clavePendienteEntregaDesdeFilaPendiente(x);
            console.log("key", key, "x", x.producto.PRODUCTO);
            console.log("key", key,"mapaPendienteProceso.get(key)", mapaPendienteProceso.get(key));
            return this.ajustarPendienteVisualPendientesEntrega(
              x,
              mapaFacturadoReal.get(key),
              mapaDevolucionVirtual.get(key),
              mapaPendienteProceso.get(key)
            );
          });
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        Swal.fire(
          "Error",
          "No se pudo cargar el listado de productos pendientes por entrega.",
          "error"
        );
      },
    });
  }
}
