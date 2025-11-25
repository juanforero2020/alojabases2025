import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { environment } from "src/environments/environment";

@Injectable({
  providedIn: "root",
})
export class ParametrizacionesService {
  //private URL = 'http://localhost:3000/parametrizaciones'; //localhost
  // private URLGenerales = 'http://localhost:3000/parametrizaciones/generales'; //localhost
  private URLGenerales = 'http://104.131.82.174:3000/parametrizaciones/generales'
  //private URL = "http://159.223.107.115:3000/parametrizaciones";
  private URL = `${environment.services.urlServices}/parametrizaciones`;
  
  constructor(public http: HttpClient, public router: Router) {}

  newParametrizacion(parametrizacion) {
    return this.http.post<any>(
      this.URL + "/newParametrizacion",
      parametrizacion
    );
  }

  getParametrizacion() {
    return this.http.get(this.URL + "/getParametrizaciones");
  }

  getParametrizacionPorNombre(nombre: string) {
    return this.http.get(this.URLGenerales + "/" + nombre);
  }

  updateParametrizacionPorNombre(nombre: string, value: any) {
    return this.http.patch(this.URLGenerales + "/" + nombre, { value });
  }

  updateParametrizacion(parametrizacion) {
    return this.http.put(
      this.URL + `/update/${parametrizacion._id}`,
      parametrizacion
    );
  }

  deleteParametrizacion(parametrizacion) {
    return this.http.delete(
      this.URL + `/delete/${parametrizacion._id}`,
      parametrizacion
    );
  }
}
