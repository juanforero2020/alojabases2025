import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { environment } from "src/environments/environment";

@Injectable({
  providedIn: "root",
})
export class PagoProveedorService {
  //private URL = 'http://localhost:3000/pagoProveedor'; //localhost
  //private URL = "http://159.223.107.115:3000/pagoProveedor";
  private URL = `${environment.services.urlServices}/pagoProveedor`;
  constructor(public http: HttpClient, public router: Router) {}

  newPagoProveedor(pagoP) {
    return this.http.post<any>(this.URL + "/newPagoProveedor", pagoP);
  }

  getPagosProveedor() {
    return this.http.get(this.URL + "/getPagosProveedor");
  }

  updatePagosProveedor(pagoP) {
    return this.http.put(this.URL + `/update/${pagoP._id}`, pagoP);
  }

  updateEstadoPagoProveedor(pagoP) {
    return this.http.put(this.URL + `/updateEstadoPago/${pagoP._id}`, pagoP);
  }

  deletePagosProveedor(pagoP) {
    return this.http.delete(this.URL + `/delete/${pagoP._id}`, pagoP);
  }
}
