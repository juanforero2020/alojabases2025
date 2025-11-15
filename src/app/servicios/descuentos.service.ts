import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { environment } from "src/environments/environment";

@Injectable({
  providedIn: "root",
})
export class DescuentosService {
  //private URL = "http://localhost:3000/descuentos"; //localhost
  private URL = `${environment.services.urlServices}/descuentos`;
  //private URL = "http://159.223.107.115:3000/descuentos";
  constructor(public http: HttpClient, public router: Router) {}

  guardarCodigo(descuento) {
    return this.http.post<any>(this.URL + "/newCodigo", descuento);
  }

  
}
