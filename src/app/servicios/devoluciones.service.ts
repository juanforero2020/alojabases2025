import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { factura } from "../pages/ventas/venta";
import { environment } from "src/environments/environment";

@Injectable({
  providedIn: "root",
})
export class DevolucionesService {
  facturas: factura[];
  //private URL = 'http://localhost:3000/devoluciones'; //localhost
  //private URL = "http://159.223.107.115:3000/devoluciones";
  private URL = `${environment.services.urlServices}/devoluciones`;
  constructor(public http: HttpClient, public router: Router) {}

  newDevolucion(devolucion) {
    return this.http.post<any>(this.URL + "/newDevolucion", devolucion);
  }

  getDevoluciones() {
    return this.http.get(this.URL + "/getDevoluciones");
  }

  getDevolucionesPorRango(objFecha) {
    return this.http.post(this.URL + "/getDevolucionesPorRango", objFecha);
  }

  updateDevolucion(devolucion) {
    return this.http.put(this.URL + `/update/${devolucion._id}`, devolucion);
  }

  updateEstado(devolucion, estado: string) {
    return this.http.put(this.URL + `/updateEstado/${devolucion._id}/${estado}`, devolucion);
  }

  deleteDevolucion(devolucion) {
    return this.http.delete(this.URL + `/delete/${devolucion._id}`, devolucion);
  }
}
