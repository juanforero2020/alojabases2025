import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { environment } from "src/environments/environment";

@Injectable({
  providedIn: "root",
})
export class EntregasBodegaService {
  private URL = `${environment.services.urlServices}/entregasBodega`;

  constructor(private http: HttpClient) {}

  /**
   * Listado filtrado en servidor.
   * Body: documentoNumero, cliente, fechaDesde, fechaHasta, modoConsulta: "gestion" | "listado".
   */
  getPendientes(filtros: any) {
    return this.http.post(`${this.URL}/getPendientes`, filtros);
  }

  buscar(filtros: any) {
    return this.http.post(`${this.URL}/buscar`, filtros);
  }

  actualizarItem(ordenId: string, itemIndex: number, payload: any) {
    return this.http.put(
      `${this.URL}/actualizarItem/${ordenId}/${itemIndex}`,
      payload
    );
  }

  cerrar(ordenId: string, payload: any) {
    return this.http.put(`${this.URL}/cerrar/${ordenId}`, payload);
  }

  getIndicadores() {
    return this.http.get(`${this.URL}/indicadores`);
  }

  /**
   * Detalle informativo para home: abiertas | novedad | compromisos-vencidos
   */
  getIndicadoresDetalle(
    tipo: "abiertas" | "novedad" | "compromisos-vencidos"
  ) {
    return this.http.get(`${this.URL}/indicadores/detalle/${tipo}`);
  }
}
