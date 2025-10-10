import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";

@Injectable({
  providedIn: "root",
})
export class NotasPagoService {
  // [ACTIVO] Usamos la URL de Desarrollo (Localhost)
  private URL = 'http://localhost:3000/notas'; //localhost
  
  // [COMENTADAS] Desactivamos las IPs de Producción
  //private URL = "http://159.223.107.115:3000/notas"; //localhost
  // private URL = "http://104.131.82.174:3000/notas";

  constructor(public http: HttpClient, public router: Router) {}

  newNota(notas) {
    return this.http.post<any>(this.URL + "/newNota", notas);
  }

  getNotas() {
    return this.http.get(this.URL + "/getNotas");
  }

  getNotasPorTipo(tipo:string) {
    return this.http.post(this.URL + `/getNotasPorTipo/${tipo}`, tipo);
  }

  deleteNotas(notas) {
    return this.http.delete(this.URL + `/delete/${notas._id}`, notas);
  }
}