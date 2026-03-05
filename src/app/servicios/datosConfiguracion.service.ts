import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { environment } from "src/environments/environment";

export interface DatosConfiguracion {
  _id?: string;
  id?: number;
  urlImage?: string;
  minutosInactividad?: number;
}

@Injectable({
  providedIn: "root",
})
export class DatosConfiguracionService {
  private URL = `${environment.services.urlServices}/datosConfiguracion`;

  constructor(public http: HttpClient, public router: Router) {}

  getDatosConfiguracion() {
    return this.http.get<DatosConfiguracion[]>(this.URL + "/getConfiguracion");
  }

  create(datos: DatosConfiguracion) {
    return this.http.post<DatosConfiguracion>(this.URL, datos);
  }

  update(id: string, datos: DatosConfiguracion) {
    return this.http.put<DatosConfiguracion>(this.URL + "/" + id, datos);
  }

  delete(id: string) {
    return this.http.delete(this.URL + "/" + id);
  }
}
