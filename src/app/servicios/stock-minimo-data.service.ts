import { Injectable } from "@angular/core";
import { Observable, forkJoin, of } from "rxjs";
import { map, catchError, switchMap } from "rxjs/operators";
import { ProductoService } from "./producto.service";
import { TransaccionesService } from "./transacciones.service";
import { CatalogoService } from "./catalogo.service";
import { inventario, productoMultiple } from "../pages/consolidado/consolidado";
import { producto } from "../pages/ventas/venta";
import { transaccion } from "../pages/transacciones/transacciones";
import { catalogo } from "../pages/catalogo/catalogo";

export interface ProductosBajoMinimoPorCategoria {
  categoria: string;
  productos: inventario[];
}

@Injectable({
  providedIn: "root",
})
export class StockMinimoDataService {
  constructor(
    private productoService: ProductoService,
    private transaccionesService: TransaccionesService,
    private catalogoService: CatalogoService
  ) {}

  /**
   * Obtiene productos con stock por debajo del mínimo (misma lógica que stock-minimo),
   * agrupados por categoría (CLASIFICA). Usa Stock General / Matriz.
   * Optimizado: solo trae transacciones de productos que tienen stock mínimo definido (CANT_MINIMA != 0).
   */
  getProductosBajoMinimoAgrupadosPorCategoria(): Observable<
    ProductosBajoMinimoPorCategoria[]
  > {
    return forkJoin({
      productos: this.productoService.getProductosActivos(),
      catalogos: this.catalogoService.getCatalogoActivos(),
    }).pipe(
      switchMap(({ productos, catalogos }) => {
        const productosList = (productos || []) as producto[];
        const catalogosList = (catalogos || []) as catalogo[];
        const productosConStockMinimo = this.filtrarProductosConStockMinimoDefinido(
          productosList,
          catalogosList
        );
        if (productosConStockMinimo.length === 0) {
          return of([]);
        }
        const productoM = new productoMultiple();
        productoM.array = productosConStockMinimo.map((p) => p.PRODUCTO);
        return this.transaccionesService
          .getTransaccionesPorProductoMultiple(productoM)
          .pipe(
            map((transacciones) => ({
              productos: productosConStockMinimo,
              transacciones: (transacciones || []) as transaccion[],
              catalogos: catalogosList,
            }))
          );
      }),
      map((payload) => {
        if (Array.isArray(payload) || !payload?.productos) {
          return [];
        }
        const { productos, transacciones, catalogos } = payload;
        const inventarioCompleto = this.cargarDatosMatriz(
          productos,
          transacciones
        );
        this.transformarM2(inventarioCompleto);
        this.ajustarSaldosCero(inventarioCompleto);
        const bajoMinimo = this.filtrarBajoMinimo(
          inventarioCompleto,
          catalogos
        );
        return this.agruparPorCategoria(bajoMinimo);
      }),
      catchError(() => of([]))
    );
  }

  /**
   * Filtra solo los productos que tienen en catálogo CANT_MINIMA definida y distinta de 0.
   */
  private filtrarProductosConStockMinimoDefinido(
    productos: producto[],
    catalogos: catalogo[]
  ): producto[] {
    const nombresConMinimo = new Set(
      catalogos
        .filter(
          (c) =>
            c.CANT_MINIMA != null &&
            c.CANT_MINIMA !== 0
        )
        .map((c) => c.PRODUCTO)
    );
    return productos.filter((p) => nombresConMinimo.has(p.PRODUCTO));
  }

  private cargarDatosMatriz(
    productos: producto[],
    transacciones: transaccion[]
  ): inventario[] {
    const invetarioP: inventario[] = [];
    for (let index = 0; index < productos.length; index++) {
      const element2 = productos[index];
      let contCajas = 0;
      let contPiezas = 0;

      transacciones.forEach((element) => {
        if (
          element2.PRODUCTO === element.producto &&
          element.sucursal === "matriz"
        ) {
          switch (element.tipo_transaccion) {
            case "devolucion":
              contCajas = Number(element.cajas) + contCajas;
              contPiezas = Number(element.piezas) + contPiezas;
              break;
            case "compra-dir":
            case "compra":
            case "compra_obs":
            case "ajuste-sobrante":
            case "traslado2":
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
            default:
              break;
          }
        }
      });

      const inv = new inventario();
      inv.producto = element2;
      inv.producto.CASA = element2.CASA;
      inv.cantidadCajas = contCajas;
      inv.cantidadCajas2 = 0;
      inv.cantidadCajas3 = 0;
      inv.cantidadPiezas = contPiezas;
      inv.cantidadPiezas2 = 0;
      inv.cantidadPiezas3 = 0;
      inv.bodega =
        "S1 (" +
        (element2.ubicacionSuc1 || []) +
        " ) S2 (" +
        (element2.ubicacionSuc2 || []) +
        ") S3(" +
        (element2.ubicacionSuc3 || []) +
        ")";
      inv.ultimoPrecioCompra = element2.ultimoPrecioCompra;
      inv.porUtilidad = element2.porcentaje_ganancia;
      inv.valorProducto =
        (element2.porcentaje_ganancia * element2.precio) / 100 + element2.precio;
      inv.ultimaFechaCompra = element2.ultimaFechaCompra;
      inv.notas = element2.notas || [];
      invetarioP.push(inv);
    }
    return invetarioP;
  }

  private transformarM2(invetarioP: inventario[]): void {
    invetarioP.forEach((element) => {
      const p = element.producto;
      const m2Caja = p.M2 || 0;
      const pCaja = p.P_CAJA || 1;
      element.cantidadM2 = parseFloat(
        (
          m2Caja * element.cantidadCajas +
          (element.cantidadPiezas * m2Caja) / pCaja
        ).toFixed(2)
      );
      element.cantidadM2b2 = element.cantidadM2b2 ?? 0;
      element.cantidadM2b3 = element.cantidadM2b3 ?? 0;
      element.totalb1 = parseFloat(
        (element.cantidadM2 * (p.precio || 0)).toFixed(2)
      );
      element.totalb2 = element.totalb2 ?? 0;
      element.totalb3 = element.totalb3 ?? 0;
    });
  }

  private ajustarSaldosCero(invetarioP: inventario[]): void {
    invetarioP.forEach((element) => {
      if (element.cantidadM2 <= 0) {
        element.cantidadCajas = 0;
        element.cantidadPiezas = 0;
        element.cantidadM2 = 0;
        element.totalb1 = 0;
      }
    });
  }

  private filtrarBajoMinimo(
    invetarioP: inventario[],
    catalogos: catalogo[]
  ): inventario[] {
    const resultado: inventario[] = [];
    invetarioP.forEach((element) => {
      const catal = catalogos.find(
        (p) => p.PRODUCTO === element.producto.PRODUCTO
      );
      if (catal != null && catal.CANT_MINIMA != null && catal.CANT_MINIMA !== 0) {
        element.producto.cantidad = catal.CANT_MINIMA;
        if (element.cantidadM2 <= catal.CANT_MINIMA) {
          resultado.push(element);
        }
      }
    });
    return resultado;
  }

  private agruparPorCategoria(
    items: inventario[]
  ): ProductosBajoMinimoPorCategoria[] {
    const mapCat = new Map<string, inventario[]>();
    items.forEach((inv) => {
      const cat = inv.producto.CLASIFICA || "Sin categoría";
      if (!mapCat.has(cat)) {
        mapCat.set(cat, []);
      }
      mapCat.get(cat).push(inv);
    });
    return Array.from(mapCat.entries()).map(([categoria, productos]) => ({
      categoria,
      productos,
    }));
  }
}
