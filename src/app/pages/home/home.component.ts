import { Component, HostListener, OnInit } from '@angular/core';
import { StockMinimoDataService, ProductosBajoMinimoPorCategoria } from 'src/app/servicios/stock-minimo-data.service';
import { EntregasBodegaService } from "src/app/servicios/entregas-bodega.service";

export type TipoDetalleIndicadorEntrega =
  | "abiertas"
  | "novedad"
  | "compromisos-vencidos";

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
  versionSistema = "1.1.3";
  ultimaFechaActualizacion = "01/01/2026 21:00";

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

  constructor(
    private stockMinimoData: StockMinimoDataService,
    private entregasBodegaService: EntregasBodegaService
  ) {}

  ngOnInit(): void {
    this.actualizarTamanoPopupIndicadores();
    this.cargarProductosBajoMinimo();
    this.cargarIndicadoresEntregas();
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
}
