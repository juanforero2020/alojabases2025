import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { factura } from "../pages/ventas/venta";
import { environment } from "src/environments/environment";

@Injectable({
  providedIn: "root",
})
export class DetallePagoService {
  facturas: factura[];
  //private URL = 'http://localhost:3000/detallePago'; //localhost
  //private URL = "http://159.223.107.115:3000/detallePago";
  private URL = `${environment.services.urlServices}/detallePago`;
  constructor(public http: HttpClient, public router: Router) {}

  newDetallePago(detallePago) {
    return this.http.post<any>(this.URL + "/newDetallePago", detallePago);
  }

  getDetallePagos() {
    return this.http.get(this.URL + "/getDetallePago");
  }

  updateDetallePagos(detallePago) {
    return this.http.put(this.URL + `/update/${detallePago._id}`, detallePago);
  }

  updateEstado(detallePago, estado: string) {
    return this.http.put(
      this.URL + `/updateEstado/${detallePago._id}/${estado}`,
      detallePago
    );
  }

  updateEstadoPago(detallePago) {
    console.log(detallePago)
    return this.http.put(
      this.URL + `/updateEstadoPago/${detallePago._id}`,detallePago);
  }

  deleteDetallePago(detallePago) {
    return this.http.delete(
      this.URL + `/delete/${detallePago._id}`,
      detallePago
    );
  }
}
