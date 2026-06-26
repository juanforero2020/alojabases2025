import { Component, HostListener, OnInit } from '@angular/core';
import { StockMinimoDataService, ProductosBajoMinimoPorCategoria } from 'src/app/servicios/stock-minimo-data.service';
import { EntregasBodegaService } from "src/app/servicios/entregas-bodega.service";
import { CajaMenorService } from 'src/app/servicios/cajaMenor.service';
import { CajaMenor } from '../cajaMenor/caja-menor';
import { OrdenesCompraService } from 'src/app/servicios/ordenes-compra.service';
import { OrdenDeCompra } from '../compras/compra';
import { objDate } from '../transacciones/transacciones';
import { AuthenService } from 'src/app/servicios/authen.service';
import { user } from '../user/user';

export type TipoDetalleIndicadorEntrega =
  | "abiertas"
  | "novedad"
  | "compromisos-vencidos";

export type TipoDetalleIndicadorCajaMenor =
  | "todas"
  | "cerradas"
  | "abiertas"
  | "faltantes"
  | "sobrante-mas-uno";

export type TipoDetalleIndicadorOrdenCompra =
  | "todas"
  | "solicitudes"
  | "abierto"
  | "parcial"
  | "completo";

@Component({
  templateUrl: 'home.component.html',
  styleUrls: [ './home.component.scss' ]
})

export class HomeComponent implements OnInit {
  productosBajoMinimoPorCategoria: ProductosBajoMinimoPorCategoria[] = [];
  loading = false;
  errorCarga = false;
  indicadoresEntregas = {
    abiertas: 0,
    novedad: 0,
    completo: 0,
    cerradas: 0,
    compromisosVencidos: 0,
  };
  errorIndicadoresEntregas = false;
  indicadoresCajaMenor = {
    total: 0,
    cerradas: 0,
    abiertas: 0,
    cuadradas: 0,
    faltantes: 0,
    sobranteMasUno: 0,
  };
  errorIndicadoresCajaMenor = false;
  cargandoIndicadoresCajaMenor = false;
  listadoCajaMenorReciente: CajaMenor[] = [];
  diasIndicadorCajaMenor = 30;
  popupCajaMenorVisible = false;
  tituloPopupCajaMenor = "";
  tipoDetalleCajaMenorActivo: TipoDetalleIndicadorCajaMenor | null = null;
  detalleCajaMenorFiltrado: CajaMenor[] = [];
  indicadoresOrdenCompra = {
    total: 0,
    solicitudes: 0,
    abierto: 0,
    parcial: 0,
    completo: 0,
  };
  errorIndicadoresOrdenCompra = false;
  cargandoIndicadoresOrdenCompra = false;
  listadoOrdenCompraReciente: OrdenDeCompra[] = [];
  diasIndicadorOrdenCompra = 30;
  popupOrdenCompraVisible = false;
  tituloPopupOrdenCompra = "";
  tipoDetalleOrdenCompraActivo: TipoDetalleIndicadorOrdenCompra | null = null;
  detalleOrdenCompraFiltrado: OrdenDeCompra[] = [];
  versionSistema = "1.1.3";
  ultimaFechaActualizacion = "15/06/2026 16:00";
  esAsesorComercial = false;

  popupIndicadoresVisible = false;
  tituloPopupIndicadores = "";
  tipoDetalleActivo: TipoDetalleIndicadorEntrega | null = null;
  detalleIndicadores: any[] = [];
  cargandoDetalleIndicadores = false;
  errorDetalleIndicadores = false;

  /** Dimensiones del popup de indicadores (se ajustan en vista móvil). */
  anchoPopupIndicadores = 720;
  altoPopupIndicadores = 520;
  private static readonly umbralVistaMovilPx = 768;
  /** Umbral para faltantes: resultado menor a este valor (ej. -1.07 < -1). */
  private static readonly umbralFaltantePrioritario = -1;
  /** Umbral mínimo (exclusivo) para sobrantes destacados en el indicador. */
  private static readonly umbralSobrantePrioritario = 1;

  constructor(
    private stockMinimoData: StockMinimoDataService,
    private entregasBodegaService: EntregasBodegaService,
    private cajaMenorService: CajaMenorService,
    private ordenesCompraService: OrdenesCompraService,
    private _authenService: AuthenService
  ) {}

  ngOnInit(): void {
    this.actualizarTamanoPopupIndicadores();
    this.cargarUsuarioLogueado();
  }

  cargarUsuarioLogueado(): void {
    let correo = "";
    if (localStorage.getItem("maily") != '') {
      correo = localStorage.getItem("maily");
    }

    this._authenService.getUserLogueado(correo).subscribe(res => {
      const usuario = res as user;
      const usuarioLogueado = usuario[0];
      this.esAsesorComercial = usuarioLogueado.rol?.toString() == "Asesor Comercial";
      if (!this.esAsesorComercial) {
        this.cargarProductosBajoMinimo();
        this.cargarIndicadoresEntregas();
        this.cargarIndicadoresCajaMenor();
        this.cargarIndicadoresOrdenCompra();
      }
    });
  }

  @HostListener('window:resize')
  onVentanaRedimensionada(): void {
    this.actualizarTamanoPopupIndicadores();
  }

  private actualizarTamanoPopupIndicadores(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (vw < HomeComponent.umbralVistaMovilPx) {
      const margen = 16;
      this.anchoPopupIndicadores = Math.max(280, vw - margen);
      this.altoPopupIndicadores = Math.round(Math.min(vh * 0.92, vh - margen));
    } else {
      this.anchoPopupIndicadores = 720;
      this.altoPopupIndicadores = 520;
    }
  }

  cargarProductosBajoMinimo(): void {
    this.loading = true;
    this.errorCarga = false;
    this.stockMinimoData.getProductosBajoMinimoAgrupadosPorCategoria().subscribe({
      next: (grupos) => {
        this.productosBajoMinimoPorCategoria = grupos;
        console.log(this.productosBajoMinimoPorCategoria);
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.errorCarga = true;
      }
    });
  }

  cargarIndicadoresEntregas(): void {
    this.errorIndicadoresEntregas = false;
    this.entregasBodegaService.getIndicadores().subscribe({
      next: (resp: any) => {
        this.indicadoresEntregas = {
          abiertas: Number(resp?.abiertas || 0),
          novedad: Number(resp?.novedad || 0),
          completo: Number(resp?.completo || 0),
          cerradas: Number(resp?.cerradas || 0),
          compromisosVencidos: Number(resp?.compromisosVencidos || 0),
        };
      },
      error: () => {
        this.errorIndicadoresEntregas = true;
      },
    });
  }

  abrirDetalleIndicador(tipo: TipoDetalleIndicadorEntrega): void {
    this.actualizarTamanoPopupIndicadores();
    const titulos: Record<TipoDetalleIndicadorEntrega, string> = {
      abiertas: "Entregas abiertas (solo información)",
      novedad: "Entregas con novedad (solo información)",
      "compromisos-vencidos": "Compromisos de entrega vencidos (solo información)",
    };
    this.tipoDetalleActivo = tipo;
    this.tituloPopupIndicadores = titulos[tipo];
    this.popupIndicadoresVisible = true;
    this.detalleIndicadores = [];
    this.errorDetalleIndicadores = false;
    this.cargandoDetalleIndicadores = true;

    this.entregasBodegaService.getIndicadoresDetalle(tipo).subscribe({
      next: (lista: any) => {
        this.detalleIndicadores = Array.isArray(lista) ? lista : [];
        this.cargandoDetalleIndicadores = false;
      },
      error: () => {
        this.cargandoDetalleIndicadores = false;
        this.errorDetalleIndicadores = true;
      },
    });
  }

  /** Limpia el contenido cuando el popup ya terminó de cerrarse (evita vaciar el contenido durante la animación). */
  onPopupIndicadoresCerrado(): void {
    this.tipoDetalleActivo = null;
    this.detalleIndicadores = [];
    this.errorDetalleIndicadores = false;
    this.cargandoDetalleIndicadores = false;
  }

  formatearFechaCompromiso(val: string): string {
    if (val == null || val === "") {
      return "—";
    }
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) {
      return String(val);
    }
    return d.toLocaleDateString();
  }

  cargarIndicadoresCajaMenor(): void {
    this.errorIndicadoresCajaMenor = false;
    this.cargandoIndicadoresCajaMenor = true;
    const rango = new objDate();
    const hasta = new Date();
    const desde = new Date();
    desde.setDate(desde.getDate() - this.diasIndicadorCajaMenor);
    desde.setHours(0, 0, 0, 0);
    rango.fechaAnterior = desde;
    rango.fechaActual = hasta;

    this.cajaMenorService.getCajaMenorPorRango(rango).subscribe({
      next: (resp) => {
        const lista = (Array.isArray(resp) ? resp : []) as CajaMenor[];
        this.listadoCajaMenorReciente = lista
          .map((c) => this.normalizarRegistroCajaMenor(c))
          .sort((a, b) => this.obtenerTimestampFechaCaja(b) - this.obtenerTimestampFechaCaja(a));
        this.recalcularIndicadoresCajaMenor();
        this.cargandoIndicadoresCajaMenor = false;
      },
      error: () => {
        this.listadoCajaMenorReciente = [];
        this.recalcularIndicadoresCajaMenor();
        this.cargandoIndicadoresCajaMenor = false;
        this.errorIndicadoresCajaMenor = true;
      },
    });
  }

  abrirDetalleIndicadorCajaMenor(tipo: TipoDetalleIndicadorCajaMenor): void {
    this.actualizarTamanoPopupIndicadores();
    const titulos: Record<TipoDetalleIndicadorCajaMenor, string> = {
      todas: `Caja menor — detalle día a día (últimos ${this.diasIndicadorCajaMenor} días)`,
      cerradas: "Cajas menores cerradas",
      abiertas: "Cajas menores abiertas",
      faltantes: "Cajas menores con faltante mayor a $1.00",
      "sobrante-mas-uno": "Cajas menores con sobrante mayor a $1.00",
    };
    this.tipoDetalleCajaMenorActivo = tipo;
    this.tituloPopupCajaMenor = titulos[tipo];
    this.detalleCajaMenorFiltrado = this.filtrarDetalleCajaMenor(tipo);
    this.popupCajaMenorVisible = true;
  }

  onPopupCajaMenorCerrado(): void {
    this.tipoDetalleCajaMenorActivo = null;
    this.detalleCajaMenorFiltrado = [];
  }

  formatearFechaCajaMenor(val: Date | string): string {
    if (val == null || val === "") {
      return "—";
    }
    const d = val instanceof Date ? val : new Date(val);
    if (Number.isNaN(d.getTime())) {
      return String(val);
    }
    return d.toLocaleDateString("es-EC", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  formatearResultadoCajaMenor(val: number | null | undefined): string {
    const n = Number(val ?? 0);
    return n.toLocaleString("es-EC", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  claseResultadoCajaMenor(registro: CajaMenor): string {
    const resultado = Number(registro?.resultado ?? 0);
    if (this.esCajaConFaltante(registro)) {
      return "caja-resultado-faltante-destacado";
    }
    if (this.esCajaConSobranteMasUno(registro)) {
      return "caja-resultado-sobrante-mas-uno";
    }
    if (resultado === 0) {
      return "caja-resultado-ok";
    }
    if (resultado > 0) {
      return "caja-resultado-sobrante";
    }
    return "caja-resultado-faltante";
  }

  esCajaConFaltante(registro: CajaMenor): boolean {
    const resultado = Number(registro?.resultado ?? 0);
    return Number(resultado.toFixed(2)) < HomeComponent.umbralFaltantePrioritario;
  }

  esCajaConSobranteMasUno(registro: CajaMenor): boolean {
    const resultado = Number(registro?.resultado ?? 0);
    return Number(resultado.toFixed(2)) > HomeComponent.umbralSobrantePrioritario;
  }

  etiquetaEstadoCajaMenor(registro: CajaMenor): string {
    const estado = (registro?.estado ?? "").trim();
    if (estado) {
      return estado;
    }
    return "Sin estado";
  }

  private recalcularIndicadoresCajaMenor(): void {
    const lista = this.listadoCajaMenorReciente;
    this.indicadoresCajaMenor = {
      total: lista.length,
      cerradas: lista.filter((c) => this.esCajaCerrada(c)).length,
      abiertas: lista.filter((c) => !this.esCajaCerrada(c)).length,
      cuadradas: lista.filter((c) => Number(c.resultado ?? 0) === 0).length,
      faltantes: lista.filter((c) => this.esCajaConFaltante(c)).length,
      sobranteMasUno: lista.filter((c) => this.esCajaConSobranteMasUno(c)).length,
    };
  }

  private filtrarDetalleCajaMenor(tipo: TipoDetalleIndicadorCajaMenor): CajaMenor[] {
    switch (tipo) {
      case "cerradas":
        return this.listadoCajaMenorReciente.filter((c) => this.esCajaCerrada(c));
      case "abiertas":
        return this.listadoCajaMenorReciente.filter((c) => !this.esCajaCerrada(c));
      case "faltantes":
        return this.listadoCajaMenorReciente.filter((c) => this.esCajaConFaltante(c));
      case "sobrante-mas-uno":
        return this.listadoCajaMenorReciente.filter((c) => this.esCajaConSobranteMasUno(c));
      default:
        return [...this.listadoCajaMenorReciente];
    }
  }

  private normalizarRegistroCajaMenor(registro: CajaMenor): CajaMenor {
    const copia = { ...registro } as CajaMenor;
    if (copia.fecha != null && !(copia.fecha instanceof Date)) {
      copia.fecha = new Date(copia.fecha);
    }
    copia.resultado = Number(copia.resultado ?? 0);
    return copia;
  }

  esCajaCerrada(registro: CajaMenor): boolean {
    return (registro?.estado ?? "").toLowerCase() === "cerrada";
  }

  private obtenerTimestampFechaCaja(registro: CajaMenor): number {
    if (registro?.fecha == null) {
      return 0;
    }
    const d = registro.fecha instanceof Date ? registro.fecha : new Date(registro.fecha);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }

  cargarIndicadoresOrdenCompra(): void {
    this.errorIndicadoresOrdenCompra = false;
    this.cargandoIndicadoresOrdenCompra = true;
    const rango = new objDate();
    const hasta = new Date();
    const desde = new Date();
    hasta.setDate(hasta.getDate() + 1);
    desde.setDate(hasta.getDate() - this.diasIndicadorOrdenCompra);
    desde.setHours(0, 0, 0, 0);
    rango.fechaAnterior = desde;
    rango.fechaActual = hasta;

    this.ordenesCompraService.getOrdenesMensuales(rango).subscribe({
      next: (resp) => {
        const lista = (Array.isArray(resp) ? resp : []) as OrdenDeCompra[];
        this.listadoOrdenCompraReciente = lista
          .map((o) => this.normalizarRegistroOrdenCompra(o))
          .filter((o) => this.esRegistroVisibleIndicadorOrdenCompra(o))
          .sort((a, b) => this.obtenerTimestampFechaOrdenCompra(b) - this.obtenerTimestampFechaOrdenCompra(a));
        this.recalcularIndicadoresOrdenCompra();
        this.cargandoIndicadoresOrdenCompra = false;
      },
      error: () => {
        this.listadoOrdenCompraReciente = [];
        this.recalcularIndicadoresOrdenCompra();
        this.cargandoIndicadoresOrdenCompra = false;
        this.errorIndicadoresOrdenCompra = true;
      },
    });
  }

  abrirDetalleIndicadorOrdenCompra(tipo: TipoDetalleIndicadorOrdenCompra): void {
    this.actualizarTamanoPopupIndicadores();
    const titulos: Record<TipoDetalleIndicadorOrdenCompra, string> = {
      todas: `Órdenes de compra — últimos ${this.diasIndicadorOrdenCompra} días`,
      solicitudes: "Solicitudes de orden de compra",
      abierto: "Órdenes abiertas (pendientes de ingreso)",
      parcial: "Órdenes con ingreso parcial",
      completo: "Órdenes completas",
    };
    this.tipoDetalleOrdenCompraActivo = tipo;
    this.tituloPopupOrdenCompra = titulos[tipo];
    this.detalleOrdenCompraFiltrado = this.filtrarDetalleOrdenCompra(tipo);
    this.popupOrdenCompraVisible = true;
  }

  onPopupOrdenCompraCerrado(): void {
    this.tipoDetalleOrdenCompraActivo = null;
    this.detalleOrdenCompraFiltrado = [];
  }

  formatearFechaOrdenCompra(val: string | Date | null | undefined): string {
    if (val == null || val === "") {
      return "—";
    }
    const d = val instanceof Date ? val : new Date(val);
    if (Number.isNaN(d.getTime())) {
      return String(val);
    }
    return d.toLocaleDateString("es-EC", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  formatearTotalOrdenCompra(val: number | null | undefined): string {
    const n = Number(val ?? 0);
    return n.toLocaleString("es-EC", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  etiquetaEstadoOrdenCompra(registro: OrdenDeCompra): string {
    if (this.esOrdenSolicitud(registro)) {
      return "Solicitud";
    }
    const estadoOrden = this.normalizarEstadoOrden(registro?.estadoOrden);
    if (estadoOrden === "PENDIENTE") {
      return "Abierto";
    }
    if (estadoOrden === "PARCIAL") {
      return "Parcial";
    }
    if (estadoOrden === "COMPLETO") {
      return "Completo";
    }
    return registro?.estadoOrden?.trim() || "Sin estado";
  }

  claseEstadoOrdenCompra(registro: OrdenDeCompra): string {
    if (this.esOrdenSolicitud(registro)) {
      return "orden-estado-solicitud";
    }
    if (this.esOrdenAbierta(registro)) {
      return "orden-estado-abierto";
    }
    if (this.esOrdenParcial(registro)) {
      return "orden-estado-parcial";
    }
    if (this.esOrdenCompleta(registro)) {
      return "orden-estado-completo";
    }
    return "orden-estado-otro";
  }

  nombreProveedorOrdenCompra(registro: OrdenDeCompra): string {
    return registro?.proveedor?.nombre_proveedor?.trim() || "—";
  }

  nombreSucursalOrdenCompra(registro: OrdenDeCompra): string {
    return registro?.sucursal?.nombre?.trim() || "—";
  }

  esOrdenSolicitud(registro: OrdenDeCompra): boolean {
    return (registro?.estado ?? "") === "Pendiente";
  }

  esOrdenAprobada(registro: OrdenDeCompra): boolean {
    return (registro?.estado ?? "") === "Aprobado" && Number(registro?.n_orden ?? -1) >= 0;
  }

  esOrdenAbierta(registro: OrdenDeCompra): boolean {
    return this.esOrdenAprobada(registro) && this.normalizarEstadoOrden(registro?.estadoOrden) === "PENDIENTE";
  }

  esOrdenParcial(registro: OrdenDeCompra): boolean {
    return this.esOrdenAprobada(registro) && this.normalizarEstadoOrden(registro?.estadoOrden) === "PARCIAL";
  }

  esOrdenCompleta(registro: OrdenDeCompra): boolean {
    return this.esOrdenAprobada(registro) && this.normalizarEstadoOrden(registro?.estadoOrden) === "COMPLETO";
  }

  private esRegistroVisibleIndicadorOrdenCompra(registro: OrdenDeCompra): boolean {
    if ((registro?.estado ?? "") === "Rechazado") {
      return false;
    }
    if (this.esOrdenSolicitud(registro)) {
      return true;
    }
    return this.esOrdenAbierta(registro) || this.esOrdenParcial(registro) || this.esOrdenCompleta(registro);
  }

  private normalizarEstadoOrden(val: string | null | undefined): string {
    return (val ?? "").trim().toUpperCase();
  }

  private recalcularIndicadoresOrdenCompra(): void {
    const lista = this.listadoOrdenCompraReciente;
    this.indicadoresOrdenCompra = {
      total: lista.length,
      solicitudes: lista.filter((o) => this.esOrdenSolicitud(o)).length,
      abierto: lista.filter((o) => this.esOrdenAbierta(o)).length,
      parcial: lista.filter((o) => this.esOrdenParcial(o)).length,
      completo: lista.filter((o) => this.esOrdenCompleta(o)).length,
    };
  }

  private filtrarDetalleOrdenCompra(tipo: TipoDetalleIndicadorOrdenCompra): OrdenDeCompra[] {
    switch (tipo) {
      case "solicitudes":
        return this.listadoOrdenCompraReciente.filter((o) => this.esOrdenSolicitud(o));
      case "abierto":
        return this.listadoOrdenCompraReciente.filter((o) => this.esOrdenAbierta(o));
      case "parcial":
        return this.listadoOrdenCompraReciente.filter((o) => this.esOrdenParcial(o));
      case "completo":
        return this.listadoOrdenCompraReciente.filter((o) => this.esOrdenCompleta(o));
      default:
        return [...this.listadoOrdenCompraReciente];
    }
  }

  private normalizarRegistroOrdenCompra(registro: OrdenDeCompra): OrdenDeCompra {
    return { ...registro } as OrdenDeCompra;
  }

  private obtenerTimestampFechaOrdenCompra(registro: OrdenDeCompra): number {
    if (registro?.fecha == null || registro.fecha === "") {
      return 0;
    }
    const d = new Date(registro.fecha);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }
}
