import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { environment } from "src/environments/environment";

@Injectable({
  providedIn: "root",
})
export class ControlPreciosService {
  //private URL = "http://159.223.107.115:3000/precios";
  private URL = `${environment.services.urlServices}/precios`;
  //private URL = 'http://localhost:3000/precios'; //localhost

  constructor(public http: HttpClient, public router: Router) {}

  newPrecio(precio) {
    return this.http.post<any>(this.URL + "/newPrecio", precio);
  }

  getPrecio() {
    return this.http.get(this.URL + "/getPrecios");
  }

  updatePrecio(precio) {
    return this.http.put(this.URL + `/update/${precio._id}`, precio);
  }

  deletePrecio(precio) {
    return this.http.delete(this.URL + `/delete/${precio._id}`, precio);
  }
}
