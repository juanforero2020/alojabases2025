import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { environment } from "src/environments/environment";

@Injectable({
  providedIn: "root",
})
export class ProductosCompradosService {
  //private URL = 'http://localhost:3000/productosComprados'; //localhost
  //private URL = "http://159.223.107.115:3000/productosComprados";
  private URL = `${environment.services.urlServices}/productosComprados`;

  constructor(public http: HttpClient, public router: Router) {}

  newProductoComprado(productoComp) {
    return this.http.post<any>(this.URL + "/newProductoComprado", productoComp);
  }

  getProductoComprados() {
    return this.http.get(this.URL + "/getProductosComprados");
  }

  getProductoCompradosDocumento(documento: string) {
    return this.http.get(this.URL + `/getProductosCom/${documento}`);
  }

  updateProductoComprado(productoComp) {
    return this.http.put(
      this.URL + `/update/${productoComp._id}`,
      productoComp
    );
  }

  deleteProductoComprado(productoComp) {
    return this.http.delete(
      this.URL + `/delete/${productoComp._id}`,
      productoComp
    );
  }
}
