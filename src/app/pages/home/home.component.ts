import { Component, OnInit } from '@angular/core';
import { StockMinimoDataService, ProductosBajoMinimoPorCategoria } from 'src/app/servicios/stock-minimo-data.service';

@Component({
  templateUrl: 'home.component.html',
  styleUrls: [ './home.component.scss' ]
})

export class HomeComponent implements OnInit {
  productosBajoMinimoPorCategoria: ProductosBajoMinimoPorCategoria[] = [];
  loading = false;
  errorCarga = false;
  versionSistema = "1.1.1";
  ultimaFechaActualizacion = "13/03/2026 14:00";

  constructor(private stockMinimoData: StockMinimoDataService) {}

  ngOnInit(): void {
    this.cargarProductosBajoMinimo();
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
}
