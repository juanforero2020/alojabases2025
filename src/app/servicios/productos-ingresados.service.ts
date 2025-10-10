import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";

@Injectable({
  providedIn: "root",
})
export class ProductosIngresadosService {
  // [ACTIVO] Usamos la URL de Desarrollo (Localhost)
  private URL = 'http://localhost:3000/productosIngresados'; //localhost
  
  // [COMENTADAS] Desactivamos las IPs de Producción
  //private URL = "http://159.223.107.115:3000/productosIngresados";
  // private URL = 'http://104.131.82.174:3000/productosIngresados';
  
  constructor(public http: HttpClient, public router: Router) {}

  newProductoIngresado(productoIng) {
    return this.http.post<any>(this.URL + "/newProductoIngresado", productoIng);
  }

  getProductosIngresados() {
    return this.http.get(this.URL + "/getProductosIngresados");
  }

  getProductosIngresadosPorOrden(ordenNueva) {
    return this.http.post(this.URL + `/getProductosIngresadosOrden/${ordenNueva.n_orden}`,ordenNueva);
  }

  updateProductoIngresado(productoIng) {
    return this.http.put(this.URL + `/update/${productoIng._id}`, productoIng);
  }

  updateEstadoIngreso(productoIng, estado: string) {
    return this.http.put(
      this.URL + `/updateEstadoIngreso/${productoIng._id}/${estado}`,
      productoIng
    );
  }

  deleteProductoIngresado(productoIng) {
    return this.http.delete(
      this.URL + `/delete/${productoIng._id}`,
      productoIng
    );
  }
}