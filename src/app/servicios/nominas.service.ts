import { Injectable } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { map } from "rxjs/operators";
import { environment } from "src/environments/environment";
import {
  normalizarAjusteNomina,
  normalizarEventoDominical,
  normalizarEventoPagoProgramado,
  normalizarNominaConfigGlobal,
  normalizarProyeccionPago,
  normalizarReglaPagoNomina,
  normalizarReporteEstadoEmpleado,
  normalizarTablaAmortizacion,
  normalizarTablaMaestraSalarial,
} from "../pages/nominas/nominas-fecha.util";
import {
  AjusteNominaPendiente,
  BeneficiarioNomina,
  EventoPagoDominical,
  DesgloseDescuentosEvento,
  EventoPagoProgramado,
  FilaAmortizacion,
  NominaConfigGlobal,
  ProyeccionPagoNomina,
  ReglaPagoNomina,
  ReporteEstadoEmpleado,
  SimulacionDominical,
  TablaMaestraSalarial,
} from "../pages/nominas/nominas";

@Injectable({
  providedIn: "root",
})
export class NominasService {
  private URL = `${environment.services.urlServices}/nominas`;

  constructor(public http: HttpClient) {}

  getTablasMaestrasSalariales() {
    return this.http
      .get<TablaMaestraSalarial[]>(`${this.URL}/tabla-maestra-salarial`)
      .pipe(map((lista) => (lista || []).map(normalizarTablaMaestraSalarial)));
  }

  getTablaMaestraSalarialPorCedula(cedula: string) {
    return this.http
      .get<TablaMaestraSalarial>(`${this.URL}/tabla-maestra-salarial/${cedula}`)
      .pipe(map((registro) => normalizarTablaMaestraSalarial(registro)));
  }

  crearTablaMaestraSalarial(registro: TablaMaestraSalarial) {
    return this.http.post(`${this.URL}/tabla-maestra-salarial`, registro);
  }

  actualizarTablaMaestraSalarial(
    id: string,
    registro: Partial<TablaMaestraSalarial>
  ) {
    return this.http.put(`${this.URL}/tabla-maestra-salarial/${id}`, registro);
  }

  eliminarTablaMaestraSalarial(id: string) {
    return this.http.delete(`${this.URL}/tabla-maestra-salarial/${id}`);
  }

  getConfigGlobal() {
    return this.http
      .get<NominaConfigGlobal>(`${this.URL}/config-global`)
      .pipe(map((config) => normalizarNominaConfigGlobal(config)));
  }

  guardarConfigGlobal(config: NominaConfigGlobal) {
    return this.http.put(`${this.URL}/config-global`, config);
  }

  restablecerConfigGlobal() {
    return this.http.post(`${this.URL}/config-global/restablecer`, {});
  }

  getBeneficiarioInterno(cedula: string) {
    return this.http.get<BeneficiarioNomina>(
      `${this.URL}/beneficiario-interno/${cedula}`
    );
  }

  getBeneficiarioExterno(documento: string) {
    return this.http.get<BeneficiarioNomina>(
      `${this.URL}/beneficiario-externo/${documento}`
    );
  }

  getReglasPago() {
    return this.http
      .get<ReglaPagoNomina[]>(`${this.URL}/reglas-pago`)
      .pipe(map((lista) => (lista || []).map(normalizarReglaPagoNomina)));
  }

  getConceptosDescuento() {
    return this.http.get<string[]>(`${this.URL}/conceptos-descuento`);
  }

  getReglaPago(id: string) {
    return this.http
      .get<ReglaPagoNomina>(`${this.URL}/reglas-pago/${id}`)
      .pipe(map((regla) => normalizarReglaPagoNomina(regla)));
  }

  getProyeccionRegla(id: string, meses?: number) {
    const q = meses ? `?meses=${meses}` : "";
    return this.http
      .get<ProyeccionPagoNomina>(
        `${this.URL}/reglas-pago/${id}/proyeccion${q}`
      )
      .pipe(map((proyeccion) => normalizarProyeccionPago(proyeccion)));
  }

  vistaPreviaProyeccion(regla: ReglaPagoNomina) {
    return this.http
      .post<ProyeccionPagoNomina>(`${this.URL}/reglas-pago/vista-previa`, regla)
      .pipe(map((proyeccion) => normalizarProyeccionPago(proyeccion)));
  }

  crearReglaPago(regla: ReglaPagoNomina) {
    return this.http.post(`${this.URL}/reglas-pago`, regla);
  }

  actualizarReglaPago(id: string, regla: Partial<ReglaPagoNomina>) {
    return this.http.put(`${this.URL}/reglas-pago/${id}`, regla);
  }

  autorizarReglaPago(id: string) {
    return this.http.put(`${this.URL}/reglas-pago/${id}/autorizar`, {});
  }

  extenderEventosReglaPago(
    id: string,
    payload?: { cantidadCuotas?: number }
  ) {
    return this.http.put<{
      status: string;
      data: {
        eventosGenerados: number;
        totalCuotas: number;
        cuotaDesde: number;
        cuotaHasta: number;
      };
    }>(`${this.URL}/reglas-pago/${id}/extender-eventos`, payload || {});
  }

  finalizarReglaPago(id: string) {
    return this.http.put(`${this.URL}/reglas-pago/${id}/finalizar`, {});
  }

  eliminarReglaPago(id: string) {
    return this.http.delete(`${this.URL}/reglas-pago/${id}`);
  }

  simularDominical(payload: {
    fecha: Date | string;
    sucursal?: string;
    cedula?: string;
  }) {
    return this.http.post<SimulacionDominical>(
      `${this.URL}/dominical/simular`,
      payload
    );
  }

  liquidarDominical(payload: {
    fecha: Date | string;
    sucursal?: string;
    cedula?: string;
    usuario?: string;
    aplicarAjustes?: boolean;
  }) {
    return this.http.post(`${this.URL}/dominical/liquidar`, payload);
  }

  getEventosDominical(fecha?: string, cedula?: string) {
    let q = "";
    if (fecha) q += `fecha=${fecha}&`;
    if (cedula) q += `cedula=${cedula}&`;
    return this.http
      .get<EventoPagoDominical[]>(`${this.URL}/dominical/eventos?${q}`)
      .pipe(map((lista) => (lista || []).map(normalizarEventoDominical)));
  }

  getAjustesPendientesNomina(cedula?: string) {
    const q = cedula ? `?cedula=${cedula}` : "";
    return this.http
      .get<AjusteNominaPendiente[]>(
        `${this.URL}/dominical/ajustes-pendientes${q}`
      )
      .pipe(map((lista) => (lista || []).map(normalizarAjusteNomina)));
  }

  getEventosProgramados(filtros?: {
    estado?: string;
    reglaId?: string;
    cedula?: string;
    transaccionNomina?: string;
    tipoRegla?: string;
    conDescuento?: "si" | "no";
    desde?: string;
    hasta?: string;
  }) {
    const params = new URLSearchParams();
    if (filtros?.estado) params.set("estado", filtros.estado);
    if (filtros?.reglaId) params.set("reglaId", filtros.reglaId);
    if (filtros?.cedula) params.set("cedula", filtros.cedula);
    if (filtros?.transaccionNomina) {
      params.set("transaccion", filtros.transaccionNomina);
    }
    if (filtros?.tipoRegla) params.set("tipoRegla", filtros.tipoRegla);
    if (filtros?.conDescuento) {
      params.set("conDescuento", filtros.conDescuento);
    }
    if (filtros?.desde) params.set("desde", filtros.desde);
    if (filtros?.hasta) params.set("hasta", filtros.hasta);
    const q = params.toString();
    return this.http
      .get<EventoPagoProgramado[]>(
        `${this.URL}/eventos-programados${q ? `?${q}` : ""}`
      )
      .pipe(map((lista) => (lista || []).map(normalizarEventoPagoProgramado)));
  }

  getDesgloseDescuentosEvento(eventoId: string) {
    return this.http.get<DesgloseDescuentosEvento>(
      `${this.URL}/eventos-programados/${eventoId}/desglose-descuentos`
    );
  }

  ejecutarEventoProgramado(
    id: string,
    payload: { usuario?: string; sucursal?: string; notas?: string; monto?: number }
  ) {
    return this.http.put(`${this.URL}/eventos-programados/${id}/ejecutar`, payload);
  }

  autorizarEventoFueraPlazo(id: string, payload: { usuario?: string }) {
    return this.http.put(
      `${this.URL}/eventos-programados/${id}/autorizar-fuera-plazo`,
      payload
    );
  }

  anularEventoProgramado(id: string, notas?: string) {
    return this.http.put(`${this.URL}/eventos-programados/${id}/anular`, {
      notas,
    });
  }

  getReglasPagoAsociables(cedula: string) {
    return this.http
      .get<ReglaPagoNomina[]>(`${this.URL}/reglas-pago-asociables/${cedula}`)
      .pipe(map((lista) => (lista || []).map(normalizarReglaPagoNomina)));
  }

  descuentoPrevia(regla: ReglaPagoNomina) {
    return this.http
      .post<{
        tabla: FilaAmortizacion[];
        total: number;
        cuotaEvento: number;
        cuotasValores: number[];
        montoBrutoPago: number;
        cuotaNetaEjemplo: number;
        validacionDescuento?: { ok: boolean; mensaje?: string };
      }>(`${this.URL}/reglas-pago/descuento-previa`, regla)
      .pipe(
        map((res) => ({
          ...res,
          tabla: normalizarTablaAmortizacion(res.tabla),
        }))
      );
  }

  amortizacionPrevia(regla: ReglaPagoNomina, forzarRegenerar = false) {
    return this.http
      .post<{
        tabla: FilaAmortizacion[];
        total: number;
        validacion: {
          ok: boolean;
          mensaje?: string;
          suma?: number;
          pendiente?: number;
        };
        cuotaEvento: number;
      }>(`${this.URL}/reglas-pago/amortizacion-previa`, {
        ...regla,
        forzarRegenerar,
      })
      .pipe(
        map((res) => ({
          ...res,
          tabla: normalizarTablaAmortizacion(res.tabla),
        }))
      );
  }

  getReporteEstadoEmpleado(filtros: {
    cedula?: string;
    centroCosto?: string;
    desde?: string;
    hasta?: string;
  }) {
    const params = new URLSearchParams();
    if (filtros.cedula) params.set("cedula", filtros.cedula);
    if (filtros.centroCosto) params.set("centroCosto", filtros.centroCosto);
    if (filtros.desde) params.set("desde", filtros.desde);
    if (filtros.hasta) params.set("hasta", filtros.hasta);
    const q = params.toString();
    return this.http
      .get<ReporteEstadoEmpleado>(
        `${this.URL}/reporte-estado-empleado${q ? `?${q}` : ""}`
      )
      .pipe(map((reporte) => normalizarReporteEstadoEmpleado(reporte)));
  }
}
