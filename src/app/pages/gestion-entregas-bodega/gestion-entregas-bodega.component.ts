import { Component, OnInit } from "@angular/core";
import Swal from "sweetalert2";
import { EntregasBodegaService } from "src/app/servicios/entregas-bodega.service";

@Component({
  selector: "app-gestion-entregas-bodega",
  templateUrl: "./gestion-entregas-bodega.component.html",
  styleUrls: ["./gestion-entregas-bodega.component.scss"],
})
export class GestionEntregasBodegaComponent implements OnInit {
  /** Misma idea que devoluciones: combo superior derecho. */
  menuPrincipal: string[] = ["Gestión Entregas", "Listado Entregas"];
  valorMenu = "Gestión Entregas";
  mostrarGestion = true;
  mostrarListado = false;

  ordenes: any[] = [];
  ordenSeleccionada: any = null;
  loading = false;

  popupTrazabilidadVisible = false;
  ordenTrazabilidad: any = null;

  filtroDocumento: number = null;
  filtroCliente = "";
  fechaDesde: Date = (() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date;
  })();
  fechaHasta: Date = new Date();
  incluirCerradas = false;

  estadosGestion = ["ENTREGA_TOTAL", "ENTREGA_PARCIAL", "DEVOLUCION"];

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

  constructor(private entregasBodegaService: EntregasBodegaService) {}

  ngOnInit(): void {
    this.cargarPendientes();
  }

  opcionMenu(e: any) {
    switch (e.value) {
      case "Gestión Entregas":
        this.mostrarGestion = true;
        this.mostrarListado = false;
        this.incluirCerradas = false;
        this.popupTrazabilidadVisible = false;
        this.cargarPendientes();
        break;
      case "Listado Entregas":
        this.mostrarGestion = false;
        this.mostrarListado = true;
        this.incluirCerradas = true;
        this.ordenSeleccionada = null;
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
    if (this.mostrarListado) {
      this.abrirPopupTrazabilidad(e.data);
    } else {
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
          .slice()
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

  /** Payload que se envía al API para filtrar en base de datos. */
  private filtrosConsultaApi(): object {
    return {
      documentoNumero: this.filtroDocumento,
      cliente: (this.filtroCliente || "").trim(),
      fechaDesde: this.fechaDesde,
      fechaHasta: this.fechaHasta,
      modoConsulta: this.mostrarListado ? "listado" : "gestion",
    };
  }

  cargarPendientes() {
    this.loading = true;
    this.entregasBodegaService.getPendientes(this.filtrosConsultaApi()).subscribe({
      next: (resp: any[]) => {
        this.ordenes = (resp || []).map((orden) => this.prepararOrdenParaVista(orden));
        this.loading = false;
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
    this.cargarPendientes();
  }

  seleccionarOrden = (e) => {
    if (!this.mostrarGestion) {
      return;
    }
    this.ordenSeleccionada = this.prepararOrdenParaVista(e.row.data);
  };

  guardarItem(index: number) {
    if (!this.ordenSeleccionada?._id) return;
    const item = this.ordenSeleccionada.items[index];
    const metro = this.esItemMetrosCajaPieza(item);
    const payload: any = {
      estadoItem: item.estadoGestion,
      cantidadEntregada: metro
        ? 0
        : Number(this.num(item.cantidadEntregadaInput).toFixed(3)),
      entregaCajas: metro ? this.num(item.entregaCajasInput) : 0,
      entregaPiezas: metro ? this.num(item.entregaPiezasInput) : 0,
      fechaCompromiso: item.fechaCompromiso || "",
      notas: item.notas || "",
      usuario: sessionStorage.getItem("user") || "",
    };

    this.entregasBodegaService
      .actualizarItem(this.ordenSeleccionada._id, index, payload)
      .subscribe({
        next: (ordenActualizada: any) => {
          this.ordenSeleccionada = this.prepararOrdenParaVista(ordenActualizada);
          this.actualizarOrdenEnListado(this.ordenSeleccionada);
          Swal.fire("OK", "Ítem actualizado correctamente.", "success");
        },
        error: (errors) => {
          console.log(errors);
          const mensaje =
            errors?.error?.mensaje || "No se pudo guardar el ítem de entrega.La cantidad ingresada excede la cantidad pendiente por entregar";
          Swal.fire("Error", mensaje, "error");
        },
      });
  }

  cerrarOrden() {
    if (!this.ordenSeleccionada?._id) return;
    this.entregasBodegaService
      .cerrar(this.ordenSeleccionada._id, {
        usuario: sessionStorage.getItem("user") || "",
      })
      .subscribe({
        next: (ordenActualizada: any) => {
          this.ordenSeleccionada = this.prepararOrdenParaVista(ordenActualizada);
          this.actualizarOrdenEnListado(this.ordenSeleccionada);
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
      };
    });
    return copia;
  }

  private actualizarOrdenEnListado(ordenActualizada: any) {
    const idx = this.ordenes.findIndex((x) => x._id === ordenActualizada._id);
    if (idx >= 0) {
      this.ordenes[idx] = this.prepararOrdenParaVista(ordenActualizada);
    } else {
      this.ordenes.unshift(this.prepararOrdenParaVista(ordenActualizada));
    }
  }
}
