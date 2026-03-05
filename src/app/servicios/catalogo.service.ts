import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { shareReplay } from "rxjs/operators";
import { catalogo } from "../pages/catalogo/catalogo";
import { environment } from "src/environments/environment";

@Injectable({
  providedIn: "root",
})
export class CatalogoService {
  empresa: catalogo[];
  //private URL = "http://159.223.107.115:3000/catalogo";
  private URL = `${environment.services.urlServices}/catalogo`;
  //private URL = 'http://localhost:3000/catalogo'; //localhost

  constructor(public http: HttpClient, public router: Router) {}

  newCatalogo(catalogo) {
    return this.http.post<any>(this.URL + "/newCatalogo", catalogo);
  }

  getCatalogo() {
    return this.http.get(this.URL + "/getCatalogos");
  }

  /** Catálogo activos completo; resultado cacheado para evitar llamadas repetidas. */
  getCatalogoActivos() {
    return this.http
      .get<catalogo[]>(this.URL + "/getCatalogosActivos")
      .pipe(shareReplay(1));
  }

  /** Solo PRODUCTO y CANT_MINIMA; más rápido y menos payload (para stock mínimo). */
  getCatalogoActivosLigero() {
    return this.http.get<Pick<catalogo, "PRODUCTO" | "CANT_MINIMA">[]>(
      this.URL + "/getCatalogosActivosLigero"
    );
  }

  updateCatalogo(catalogo) {
    return this.http.put(this.URL + `/update/${catalogo._id}`, catalogo);
  }

  updateCatalogoEliminacion(catalogo, estado: string) {
    return this.http.put(
      this.URL + `/updateEliminacion/${catalogo._id}/${estado}`,
      catalogo
    );
  }

  updateCatalogoEstado(productoId: string, estado: string) {
    return this.http.put(this.URL + `/updateEstado/${productoId}/${estado}`, productoId);
  }

  updateCatalogoAplicacion(nombre: string, aplicacion: string) {
    return this.http.put(
      this.URL + `/updateAplicacion/${nombre}/${aplicacion}`,
      catalogo
    );
  }

  deleteCatalogo(catalogo) {
    return this.http.delete(this.URL + `/delete/${catalogo._id}`, catalogo);
  }
}
