import { Component, OnInit } from '@angular/core';
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
  ultimaFechaActualizacion = "16/03/2026 14:00";

  popupIndicadoresVisible = false;
  tituloPopupIndicadores = "";
  tipoDetalleActivo: TipoDetalleIndicadorEntrega | null = null;
  detalleIndicadores: any[] = [];
  cargandoDetalleIndicadores = false;
  errorDetalleIndicadores = false;

  constructor(
    private stockMinimoData: StockMinimoDataService,
    private entregasBodegaService: EntregasBodegaService
  ) {}

  ngOnInit(): void {
    this.cargarProductosBajoMinimo();
    this.cargarIndicadoresEntregas();
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
