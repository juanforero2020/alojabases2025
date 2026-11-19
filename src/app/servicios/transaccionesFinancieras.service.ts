import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Router } from "@angular/router";
import { environment } from "src/environments/environment";

@Injectable({
  providedIn: "root",
})
export class TransaccionesFinancierasService {
  //private URL = "http://localhost:3000/transaccionFinanciera"; //localhost
  private URL = `${environment.services.urlServices}/transaccionFinanciera`;
  //private URL = "http://159.223.107.115:3000/transaccionFinanciera";
  constructor(public http: HttpClient, public router: Router) {}

  newTransaccionFinanciera(transaccion) {
    return this.http.post<any>(this.URL + "/newTransaccion", transaccion);
  }

  getTransaccionesFinancieras() {
    return this.http.get(this.URL + "/getTransacciones");
  }

  getTransaccionesFinancierasNominas() {
    return this.http.get(this.URL + "/getTransaccionesNominas");
  }

  getTransaccionesFinancierasPorRango(objFecha) {
    return this.http.post(this.URL + "/getTransaccionesPorRango", objFecha);
  }

  getTransaccionesFinancierasNominasPorRango(objFecha) {
    return this.http.post(this.URL + "/getTransaccionesNominasPorRango", objFecha);
  }

  getTransaccionesFinancierasNominasPorRangoYBeneficiario(objFecha) {
    return this.http.post(this.URL + "/getTransaccionesNominasPorRangoYBeneficiario", objFecha);
  }

  getTransaccionesPorTipoDocumento(tipobusqueda) {
    return this.http.post(this.URL + "/getTransaccionesPorTipoDocumento", tipobusqueda);
  }

  getTransaccionesPorOrdenCompra(tipobusqueda) {
    return this.http.post(this.URL + "/getTransaccionesPorOrdenCompra", tipobusqueda);
  }

  /** Caja menor: facturas / notas de venta del día sin recibo de caja o sin transacción financiera. */
  validarVentasCajaMenor(filtro: { fechaAnterior: Date; fechaActual: Date; sucursal: string }) {
    return this.http.post<{ revisados: number; pendientes: any[] }>(this.URL + "/validarVentasCajaMenor", filtro);
  }

  /** Transacciones de varios recibos de caja (rCajaIds: ["RC123", ...]). */
  obtenerTransaccionesPorRecibosCaja(rCajaIds: string[]) {
    return this.http.post(this.URL + "/getTransaccionesPorRecibosCaja", { rCajaIds });
  }

  obtenerTransaccionesPorDocumentoYRecibo(tipobusqueda) {
    return this.http.post(this.URL + "/getTransaccionesPorTipoDocumentoYRecibo", tipobusqueda);
  }

  obtenerTransaccionesPrestamos(tipobusqueda) {
    return this.http.post(this.URL + "/getTransaccionesPrestamos", tipobusqueda);
  }

  obtenerTransaccionesPrestamosPorComprobante(tipobusqueda) {
    return this.http.post(this.URL + "/getTransaccionesPrestamosPorComprobante", tipobusqueda);
  }

  obtenerTransaccionesPorDocumentoYRecibo2(tipobusqueda) {
    return this.http.post(this.URL + "/getTransaccionesPorTipoDocumentoYRecibo2", tipobusqueda);
  }

  updateEstado(transaccion, estado: boolean) {
    return this.http.put(this.URL + `/updateEstado/${transaccion._id}/${estado}`, transaccion);
  }

  updateIsContabilizada(transaccion, estado: boolean) {
    return this.http.put(this.URL + `/updateContabilizada/${transaccion._id}/${estado}`, transaccion);
  }

  deleteTransaccionFinanciera(transaccion) {
    return this.http.delete(this.URL + `/delete/${transaccion._id}`,transaccion);
  }
}
