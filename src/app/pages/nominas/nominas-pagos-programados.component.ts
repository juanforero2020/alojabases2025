import { Component, Input, OnInit } from "@angular/core";
import pdfMake from "pdfmake/build/pdfmake";
import { DatosConfiguracionService } from "src/app/servicios/datosConfiguracion.service";
import { NominasService } from "src/app/servicios/nominas.service";
import { ParametrizacionesService } from "src/app/servicios/parametrizaciones.service";
import Swal from "sweetalert2";
import { parametrizacionsuc } from "../parametrizacion/parametrizacion";
import {
  BeneficiarioFiltroPagos,
  DesgloseDescuentosEvento,
  EventoPagoProgramado,
  EventoPagoProgramadoFila,
  TablaMaestraSalarial,
} from "./nominas";
import { mostrarErrorNominaApi } from "./nominas-alert.util";
import {
  fechaCalendarioParam,
  formatoFechaCalendarioNomina,
  inicioDiaCalendarioNomina,
  textoFechaPagoNomina,
} from "./nominas-fecha.util";

@Component({
  selector: "app-nominas-pagos-programados",
  templateUrl: "./nominas-pagos-programados.component.html",
  styleUrls: ["./nominas-pagos-programados.component.scss"],
})
export class NominasPagosProgramadosComponent implements OnInit {
  @Input() usuarioNombre = "";
  @Input() esAdministrador = false;

  eventosProgramados: EventoPagoProgramadoFila[] = [];
  nombreArchivoExport = "Pagos_Programados";
  filtroEventosEstado = "Pendiente";
  filtroTransaccion = "Todos";
  filtroTipoRegla = "Todos";
  filtroConDescuento = "Todos";
  filtroCedulaBeneficiario: string | null = null;
  fechaDesde: Date | null = null;
  fechaHasta: Date | null = null;

  transaccionesFiltro: string[] = ["Todos"];
  estadosEventoFiltro = [
    "Pendiente",
    "Parcial",
    "Ejecutado",
    "Anulado",
    "Todos",
  ];
  tiposReglaFiltro = ["Todos", "A", "B"];
  opcionesConDescuento = [
    { valor: "Todos", etiqueta: "Todos" },
    { valor: "si", etiqueta: "Con descuento" },
    { valor: "no", etiqueta: "Sin descuento" },
  ];
  beneficiariosFiltro: BeneficiarioFiltroPagos[] = [];
  cargandoBeneficiarios = false;
  cargandoEventos = true;
  generandoComprobanteId: string | null = null;
  imagenLogotipo = "";
  parametrizaciones: parametrizacionsuc[] = [];
  parametrizacionSucu: parametrizacionsuc;

  constructor(
    private _nominasService: NominasService,
    private _parametrizacionService: ParametrizacionesService,
    private _configuracionService: DatosConfiguracionService
  ) {}

  ngOnInit() {
    this.cargarBeneficiariosTms();
    this.cargarEventosProgramados();
    this.cargarDatosPdf();
  }

  cargarDatosPdf() {
    this._parametrizacionService.getParametrizacion().subscribe((res) => {
      this.parametrizaciones = res as parametrizacionsuc[];
      if (this.parametrizaciones.length) {
        this.parametrizacionSucu = this.parametrizaciones[0];
      }
    });
    this._configuracionService.getDatosConfiguracion().subscribe((res) => {
      if (res?.[0]?.urlImage) {
        this.imagenLogotipo = res[0].urlImage;
      }
    });
  }

  cargarBeneficiariosTms() {
    this.cargandoBeneficiarios = true;
    this._nominasService.getTablasMaestrasSalariales().subscribe(
      (lista) => {
        this.beneficiariosFiltro = this.mapearBeneficiariosFiltro(lista);
        this.cargandoBeneficiarios = false;
      },
      () => {
        this.beneficiariosFiltro = [];
        this.cargandoBeneficiarios = false;
      }
    );
  }

  mapearBeneficiariosFiltro(
    lista: TablaMaestraSalarial[]
  ): BeneficiarioFiltroPagos[] {
    return (lista || [])
      .filter((r) => r.activo !== false && r.cedula?.trim())
      .map((r) => ({
        cedula: r.cedula.trim(),
        nombre: (r.nombre || "").trim(),
        etiquetaDisplay: `${(r.nombre || "").trim()} — ${r.cedula.trim()}`,
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }

  onFiltroSelectChanged(event?: { event?: Event }) {
    if (event && event.event === undefined) return;
    this.cargarEventosProgramados();
  }

  onTransaccionChanged(event: { value?: string; event?: Event }) {
    if (event?.event === undefined) return;
    if (!event.value) {
      this.filtroTransaccion = "Todos";
    }
    this.cargarEventosProgramados();
  }

  onBeneficiarioChanged(event: { value?: string | null; event?: Event }) {
    if (event?.event === undefined) return;
    this.filtroCedulaBeneficiario = event.value || null;
    this.cargarEventosProgramados();
  }

  limpiarFiltros() {
    this.filtroEventosEstado = "Pendiente";
    this.filtroTransaccion = "Todos";
    this.filtroTipoRegla = "Todos";
    this.filtroConDescuento = "Todos";
    this.filtroCedulaBeneficiario = null;
    this.fechaDesde = null;
    this.fechaHasta = null;
    this.cargarEventosProgramados();
  }

  private formatoFechaApi(fecha: Date | null): string | undefined {
    return fechaCalendarioParam(fecha);
  }

  cargarEventosProgramados() {
    const estado =
      this.filtroEventosEstado === "Todos"
        ? undefined
        : this.filtroEventosEstado;
    const transaccionNomina =
      this.filtroTransaccion && this.filtroTransaccion !== "Todos"
        ? this.filtroTransaccion
        : undefined;
    const tipoRegla =
      this.filtroTipoRegla && this.filtroTipoRegla !== "Todos"
        ? this.filtroTipoRegla
        : undefined;
    const conDescuento =
      this.filtroConDescuento === "Todos"
        ? undefined
        : (this.filtroConDescuento as "si" | "no");
    const cedula = this.filtroCedulaBeneficiario || undefined;
    const desde = this.formatoFechaApi(this.fechaDesde);
    const hasta = this.formatoFechaApi(this.fechaHasta);

    this.cargandoEventos = true;
    this._nominasService
      .getEventosProgramados({
        estado,
        transaccionNomina,
        tipoRegla,
        conDescuento,
        cedula,
        desde,
        hasta,
      })
      .subscribe(
        (res) => {
          this.eventosProgramados = (res || []).map((ev) =>
            this.enriquecerEventoParaGrid(ev)
          );
          this.actualizarOpcionesTransaccion(res);
          this.cargandoEventos = false;
        },
        () => {
          this.eventosProgramados = [];
          this.cargandoEventos = false;
        }
      );
  }

  private enriquecerEventoParaGrid(
    ev: EventoPagoProgramado
  ): EventoPagoProgramadoFila {
    const variable = this.esMontoVariable(ev);
    const saldoOculto =
      variable && (ev.estado === "Pendiente" || ev.estado === "Parcial");

    return {
      ...ev,
      rangoFechas: this.textoRangoFechas(ev),
      cuotaDisplay: `${ev.numeroCuota}/${ev.totalCuotas}`,
      programadoExport: variable ? null : Number(ev.monto) || 0,
      descuentoExport: Number(ev.montoDescuento) || 0,
      saldoExport: saldoOculto ? null : this.saldoPendienteEvento(ev),
      mensajePago: this.mensajeEstadoPago(ev),
    };
  }

  textoRangoFechas(ev: EventoPagoProgramado): string {
    return textoFechaPagoNomina(ev, {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
  }

  onExportingPagos(e: {
    component: {
      beginUpdate: () => void;
      columnOption: (field: string, option: string, value?: boolean) => void;
    };
  }) {
    e.component.beginUpdate();
    e.component.columnOption("mensajePago", "visible", true);
  }

  onExportedPagos(e: {
    component: {
      columnOption: (field: string, option: string, value?: boolean) => void;
      endUpdate: () => void;
    };
  }) {
    e.component.columnOption("mensajePago", "visible", false);
    e.component.endUpdate();
  }

  actualizarOpcionesTransaccion(eventos: EventoPagoProgramado[]) {
    const set = new Set(
      this.transaccionesFiltro.filter((t) => t !== "Todos")
    );
    eventos.forEach((ev) => {
      if (ev.transaccionNomina?.trim()) {
        set.add(ev.transaccionNomina.trim());
      }
    });
    this.transaccionesFiltro = [
      "Todos",
      ...Array.from(set).sort((a, b) => a.localeCompare(b, "es")),
    ];
  }

  tieneDescuento(ev: EventoPagoProgramado): boolean {
    return (Number(ev.montoDescuento) || 0) > 0;
  }

  verDesgloseDescuentos(ev: EventoPagoProgramado) {
    if (!ev._id || !this.tieneDescuento(ev)) return;
    this._nominasService.getDesgloseDescuentosEvento(ev._id).subscribe(
      (desglose) => {
        const filas = (desglose.lineas || [])
          .map(
            (l) =>
              `<tr>
                <td class="text-left">${l.etiqueta}</td>
                <td class="text-right text-danger">−$${Number(l.monto).toFixed(2)}</td>
              </tr>`
          )
          .join("");
        const bruto =
          desglose.montoBruto != null
            ? Number(desglose.montoBruto)
            : Number(ev.montoBruto) || Number(ev.monto) + Number(desglose.total);
        Swal.fire({
          title: "Desglose de descuentos",
          html: `
            <p class="text-left mb-2 small text-muted">
              <strong>${ev.nombreBeneficiario}</strong><br/>
              ${formatoFechaCalendarioNomina(ev.fechaProgramada)}
            </p>
            <table class="table table-sm table-bordered mb-2">
              <thead><tr><th>Concepto</th><th>Monto</th></tr></thead>
              <tbody>${filas || '<tr><td colspan="2">Sin detalle</td></tr>'}</tbody>
              <tfoot>
                <tr>
                  <th class="text-left">Total descuentos</th>
                  <th class="text-right text-danger">−$${Number(desglose.total).toFixed(2)}</th>
                </tr>
              </tfoot>
            </table>
            <p class="text-left mb-0 small">
              Pago bruto: <strong>$${bruto.toFixed(2)}</strong><br/>
              Descuentos: <strong class="text-danger">−$${Number(desglose.montoDescuento || desglose.total).toFixed(2)}</strong><br/>
              Neto a pagar: <strong>$${Number(desglose.montoNeto).toFixed(2)}</strong>
            </p>
          `,
          width: 480,
          confirmButtonText: "Cerrar",
        });
      },
      (err) =>
        mostrarErrorNominaApi("Error", err, "No se pudo cargar el desglose")
    );
  }

  esPagoDominical(ev: EventoPagoProgramado): boolean {
    const t = (ev.transaccionNomina || "").trim().toLowerCase();
    if (t === "dominical" || t.includes("pago dominical")) return true;
    const regla = ev.reglaPagoId;
    if (regla && typeof regla === "object" && regla.frecuencia === "Dominical") {
      return true;
    }
    return false;
  }

  esMontoVariable(ev: EventoPagoProgramado): boolean {
    if (ev.modalidadMonto === "Variable") return true;
    const regla = ev.reglaPagoId;
    if (regla && typeof regla === "object") {
      if (regla.frecuencia === "Dominical" || regla.montoVariable) return true;
    }
    return (
      ev.tipoRegla === "A" &&
      (Number(ev.monto) || 0) <= 0 &&
      (ev.transaccionNomina || "").toLowerCase().includes("dominical")
    );
  }

  etiquetaTipo(ev: EventoPagoProgramado): string {
    return ev.tipoRegla || "B";
  }

  saldoPendienteEvento(ev: EventoPagoProgramado): number {
    return Math.max(
      0,
      Math.round(
        ((Number(ev.monto) || 0) - (Number(ev.montoPagado) || 0)) * 100
      ) / 100
    );
  }

  ejecutarEventoProgramado(ev: EventoPagoProgramado) {
    const variable = this.esMontoVariable(ev);
    const saldo = this.saldoPendienteEvento(ev);
    const ventana = textoFechaPagoNomina(ev);
    const lineaDesc = this.tieneDescuento(ev)
      ? `Bruto: $${Number(ev.montoBruto || ev.monto).toFixed(2)} − Desc.: $${Number(ev.montoDescuento || 0).toFixed(2)}<br/>`
      : "";

    if (variable) {
      Swal.fire({
        title: "Registrar pago",
        html: `<strong>${ev.nombreBeneficiario}</strong><br/>
          Tipo ${this.etiquetaTipo(ev)} · ${ev.transaccionNomina}<br/>
          Cuota ${ev.numeroCuota}/${ev.totalCuotas}<br/>
          Fecha de pago: ${ventana}<br/>
          <span class="text-muted">El monto se calculará al confirmar (p. ej. pago dominical).</span>`,
        icon: "question",
        showCancelButton: true,
        confirmButtonText: "Registrar pago",
        cancelButtonText: "Cancelar",
      }).then((result) => {
        if (!result.value || !ev._id) return;
        this.registrarPago(ev._id);
      });
      return;
    }

    Swal.fire({
      title: "Registrar pago",
      html: `<strong>${ev.nombreBeneficiario}</strong><br/>
        Tipo ${this.etiquetaTipo(ev)} · ${ev.transaccionNomina}<br/>
        Cuota ${ev.numeroCuota}/${ev.totalCuotas}<br/>
        Fecha de pago: ${ventana}<br/>
        ${lineaDesc}
        Programado (neto): $${Number(ev.monto).toFixed(2)} · Pagado: $${Number(ev.montoPagado || 0).toFixed(2)}<br/>
        <strong>Monto a registrar: $${saldo.toFixed(2)}</strong>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Registrar pago",
      cancelButtonText: "Cancelar",
    }).then((result) => {
      if (!result.value || !ev._id) return;
      this.registrarPago(ev._id, saldo);
    });
  }

  autorizarPagoFueraPlazo(ev: EventoPagoProgramado) {
    const ventana = textoFechaPagoNomina(ev);

    Swal.fire({
      title: "Autorizar pago fuera de plazo",
      html: `¿Habilitar el pago para <strong>${ev.nombreBeneficiario}</strong>?<br/>
        Ventana vencida: ${ventana}<br/>
        <span class="text-muted">Los usuarios podrán registrar el pago; no se ejecutará automáticamente.</span>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Autorizar",
      cancelButtonText: "Cancelar",
    }).then((result) => {
      if (!result.value || !ev._id) return;
      this._nominasService
        .autorizarEventoFueraPlazo(ev._id, { usuario: this.usuarioNombre })
        .subscribe(
          () => {
            Swal.fire(
              "Autorizado",
              "El pago quedó habilitado para que los usuarios lo registren.",
              "success"
            );
            this.cargarEventosProgramados();
          },
          (err) =>
            mostrarErrorNominaApi("Error", err, "No se pudo autorizar")
        );
    });
  }

  private registrarPago(eventoId: string, monto?: number) {
    this._nominasService
      .ejecutarEventoProgramado(eventoId, {
        usuario: this.usuarioNombre,
        monto,
      })
      .subscribe(
        (res: any) => {
          const parcial = res?.data?.saldoPendiente > 0;
          Swal.fire(
            parcial ? "Pago parcial registrado" : "Pago completo registrado",
            parcial
              ? `Saldo pendiente: $${res.data.saldoPendiente}`
              : "Pago registrado en finanzas",
            "success"
          );
          this.cargarEventosProgramados();
        },
        (err) =>
          mostrarErrorNominaApi("Error", err, "No se pudo ejecutar")
      );
  }

  puedeEjecutarEvento(ev: EventoPagoProgramado): boolean {
    if (this.esPagoDominical(ev)) return false;
    if (ev.estado !== "Pendiente" && ev.estado !== "Parcial") return false;
    if (!this.esMontoVariable(ev) && this.saldoPendienteEvento(ev) <= 0) {
      return false;
    }
    if (this.estaAntesDeVentana(ev)) return false;
    if (this.estaDespuesDeVentana(ev) && !this.estaAutorizadoFueraPlazo(ev)) {
      return false;
    }
    return true;
  }

  puedeAutorizarFueraPlazo(ev: EventoPagoProgramado): boolean {
    if (!this.esAdministrador) return false;
    if (ev.estado !== "Pendiente" && ev.estado !== "Parcial") return false;
    if (!this.estaDespuesDeVentana(ev)) return false;
    return !this.estaAutorizadoFueraPlazo(ev);
  }

  puedeAnularEvento(ev: EventoPagoProgramado): boolean {
    return ev.estado === "Pendiente" || ev.estado === "Parcial";
  }

  anularEventoProgramado(ev: EventoPagoProgramado) {
    const ventana = textoFechaPagoNomina(ev);

    Swal.fire({
      title: "Anular pago programado",
      html: `¿Anular el pago de <strong>${ev.nombreBeneficiario}</strong>?<br/>
        Tipo ${this.etiquetaTipo(ev)} · ${ev.transaccionNomina}<br/>
        Cuota ${ev.numeroCuota}/${ev.totalCuotas} · Fecha de pago: ${ventana}<br/>
        <span class="text-muted">El evento quedará anulado y no podrá ejecutarse.</span>`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Anular",
      cancelButtonText: "Cerrar",
      confirmButtonColor: "#dc3545",
    }).then((result) => {
      if (!result.value || !ev._id) return;
      this._nominasService.anularEventoProgramado(ev._id).subscribe(
        () => {
          Swal.fire(
            "Anulado",
            "El pago programado quedó anulado.",
            "success"
          );
          this.cargarEventosProgramados();
        },
        (err) =>
          mostrarErrorNominaApi("Error", err, "No se pudo anular el pago")
      );
    });
  }

  mensajeEstadoPago(ev: EventoPagoProgramado): string | null {
    if (ev.estado !== "Pendiente" && ev.estado !== "Parcial") return null;
    if (this.esPagoDominical(ev)) {
      return "Liquidar en Liquidación Dominical";
    }
    if (this.puedeEjecutarEvento(ev) || this.puedeAutorizarFueraPlazo(ev)) {
      return null;
    }
    if (this.estaAntesDeVentana(ev)) return "Fuera de fecha";
    if (this.estaDespuesDeVentana(ev) && !this.estaAutorizadoFueraPlazo(ev)) {
      return "En espera de autorización";
    }
    return null;
  }

  estaAutorizadoFueraPlazo(ev: EventoPagoProgramado): boolean {
    return !!ev.pagoFueraPlazoAutorizado;
  }

  private inicioDia(fecha: Date | string): Date {
    return inicioDiaCalendarioNomina(fecha);
  }

  private hoyInicio(): Date {
    return this.inicioDia(new Date());
  }

  estaAntesDeVentana(ev: EventoPagoProgramado): boolean {
    const hoy = this.hoyInicio();
    if (ev.fechaMin) {
      return hoy < this.inicioDia(ev.fechaMin);
    }
    if (ev.fechaProgramada) {
      return hoy < this.inicioDia(ev.fechaProgramada);
    }
    return false;
  }

  puedeDescargarComprobantePago(ev: EventoPagoProgramado): boolean {
    return !!ev?._id && this.puedeEjecutarEvento(ev);
  }

  tituloComprobantePago(ev: EventoPagoProgramado): string {
    if (this.puedeDescargarComprobantePago(ev)) {
      return "Descargar comprobante de pago (PDF)";
    }
    const estadoPago = this.mensajeEstadoPago(ev);
    if (estadoPago === "Fuera de fecha") {
      return "Comprobante no disponible: el pago está fuera de fecha";
    }
    if (estadoPago === "En espera de autorización") {
      return "Comprobante no disponible: en espera de autorización";
    }
    return "Comprobante no disponible";
  }

  estaDespuesDeVentana(ev: EventoPagoProgramado): boolean {
    const hoy = this.hoyInicio();
    if (ev.fechaMax) {
      return hoy > this.inicioDia(ev.fechaMax);
    }
    if (!ev.fechaMin && ev.fechaProgramada) {
      return hoy > this.inicioDia(ev.fechaProgramada);
    }
    return false;
  }

  descargarComprobantePago(ev: EventoPagoProgramado) {
    if (!this.puedeDescargarComprobantePago(ev)) return;
    this.generandoComprobanteId = ev._id;
    this._nominasService.getDesgloseDescuentosEvento(ev._id).subscribe(
      (desglose) => {
        try {
          this.generarPdfComprobante(ev, desglose);
        } catch {
          mostrarErrorNominaApi(
            "Error",
            null,
            "No se pudo generar el comprobante PDF"
          );
        } finally {
          this.generandoComprobanteId = null;
        }
      },
      (err) => {
        this.generandoComprobanteId = null;
        mostrarErrorNominaApi(
          "Error",
          err,
          "No se pudo cargar el detalle del pago"
        );
      }
    );
  }

  private generarPdfComprobante(
    ev: EventoPagoProgramado,
    desglose: DesgloseDescuentosEvento
  ) {
    if (!this.parametrizacionSucu && this.parametrizaciones.length) {
      this.parametrizacionSucu = this.parametrizaciones[0];
    }
    const documentDefinition = this.getDocumentDefinitionComprobante(ev, desglose);
    const cedula = (ev.cedulaBeneficiario || "sin-cedula").replace(/\s/g, "");
    const fecha = inicioDiaCalendarioNomina(ev.fechaProgramada);
    const fechaStr = `${fecha.getFullYear()}${String(fecha.getMonth() + 1).padStart(2, "0")}${String(fecha.getDate()).padStart(2, "0")}`;
    const nombreArchivo = `Comprobante_Pago_Nomina_${cedula}_${fechaStr}`;

    pdfMake.createPdf(documentDefinition).download(nombreArchivo, () => {
      Swal.fire({
        title: "Comprobante generado",
        text: "El PDF se descargó correctamente",
        icon: "success",
        confirmButtonText: "Ok",
      });
    });
  }

  private formatoMonedaPdf(valor: number): string {
    return `$${Number(valor || 0).toFixed(2)}`;
  }

  private formatoFechaPdf(fecha: Date | string | undefined): string {
    return formatoFechaCalendarioNomina(fecha);
  }

  private ventanaPagoTexto(ev: EventoPagoProgramado): string {
    return textoFechaPagoNomina(ev);
  }

  private filasDescuentosPdf(desglose: DesgloseDescuentosEvento) {
    const lineas = desglose.lineas || [];
    if (lineas.length) {
      return lineas.map((l) => [
        { text: `Descuento: ${l.etiqueta}`, style: "detalleConcepto" },
        {
          text: `−${this.formatoMonedaPdf(l.monto)}`,
          style: "detalleMontoDescuento",
          alignment: "right",
        },
      ]);
    }
    const totalDesc = Number(desglose.montoDescuento || desglose.total) || 0;
    if (totalDesc > 0) {
      return [
        [
          { text: "Descuentos aplicados", style: "detalleConcepto" },
          {
            text: `−${this.formatoMonedaPdf(totalDesc)}`,
            style: "detalleMontoDescuento",
            alignment: "right",
          },
        ],
      ];
    }
    return [];
  }

  private getDocumentDefinitionComprobante(
    ev: EventoPagoProgramado,
    desglose: DesgloseDescuentosEvento
  ) {
    const sucu = this.parametrizacionSucu;
    const variable = this.esMontoVariable(ev);
    const bruto =
      desglose.montoBruto != null
        ? Number(desglose.montoBruto)
        : Number(ev.montoBruto) ||
          Number(ev.monto) + (Number(desglose.total) || Number(ev.montoDescuento) || 0);
    const totalDescuentos =
      Number(desglose.montoDescuento || desglose.total || ev.montoDescuento) || 0;
    const neto = variable
      ? Number(ev.monto) || 0
      : Number(desglose.montoNeto ?? ev.monto) || 0;
    const pagado = Number(ev.montoPagado) || 0;
    const saldo = this.saldoPendienteEvento(ev);
    const filasDescuentos = this.filasDescuentosPdf(desglose);
    const filasLiquidacion: unknown[][] = [
      [
        { text: "Pago bruto", style: "detalleConcepto", bold: true },
        {
          text: variable ? "Variable" : this.formatoMonedaPdf(bruto),
          style: "detalleMonto",
          alignment: "right",
        },
      ],
      ...filasDescuentos,
    ];

    if (totalDescuentos > 0) {
      filasLiquidacion.push([
        { text: "Total descuentos", style: "detalleConcepto", bold: true },
        {
          text: `−${this.formatoMonedaPdf(totalDescuentos)}`,
          style: "detalleMontoDescuento",
          alignment: "right",
        },
      ]);
    }

    filasLiquidacion.push([
      { text: "NETO A PAGAR", style: "detalleNeto", bold: true },
      {
        text: variable && neto <= 0 ? "Por calcular" : this.formatoMonedaPdf(neto),
        style: "detalleNetoMonto",
        alignment: "right",
        bold: true,
      },
    ]);

    if (pagado > 0 || ev.estado === "Parcial" || ev.estado === "Ejecutado") {
      filasLiquidacion.push(
        [
          { text: "Pagado", style: "detalleConcepto" },
          {
            text: this.formatoMonedaPdf(pagado),
            style: "detalleMonto",
            alignment: "right",
          },
        ],
        [
          { text: "Saldo pendiente", style: "detalleConcepto", bold: true },
          {
            text: variable && saldo <= 0 ? "—" : this.formatoMonedaPdf(saldo),
            style: "detalleMonto",
            alignment: "right",
            bold: true,
          },
        ]
      );
    }

    const refDoc = (ev._id || "").slice(-8).toUpperCase();
    const fechaEmision = new Date().toLocaleString("es-EC");
    const encabezadoLogo = this.imagenLogotipo
      ? [
          {
            columns: [
              {
                image: this.imagenLogotipo,
                width: 90,
                margin: [0, 0, 0, 0],
              },
              { width: "*", text: " " },
            ],
          },
        ]
      : [];

    return {
      pageSize: "A4",
      pageOrientation: "portrait",
      content: [
        ...encabezadoLogo,
        {
          columns: [
            {
              width: "*",
              text: "COMPROBANTE DE PAGO — NÓMINA",
              bold: true,
              fontSize: 16,
            },
            {
              width: 160,
              text: `REF. ${refDoc}`,
              color: "#c62828",
              bold: true,
              fontSize: 12,
              alignment: "right",
            },
          ],
          margin: [0, 0, 0, 10],
        },
        {
          style: "tableExample",
          table: {
            widths: [110, "*", 110, "*"],
            body: [
              [
                { text: "Beneficiario", style: "labelCampo" },
                { text: ev.nombreBeneficiario || "—", style: "valorCampo" },
                { text: "Cédula", style: "labelCampo" },
                { text: ev.cedulaBeneficiario || "—", style: "valorCampo" },
              ],
              [
                { text: "Transacción", style: "labelCampo" },
                { text: ev.transaccionNomina || "—", style: "valorCampo" },
                { text: "Centro de costo", style: "labelCampo" },
                { text: ev.centroCosto || "—", style: "valorCampo" },
              ],
              [
                { text: "Tipo regla", style: "labelCampo" },
                { text: this.etiquetaTipo(ev), style: "valorCampo" },
                { text: "Cuota", style: "labelCampo" },
                {
                  text: `${ev.numeroCuota}/${ev.totalCuotas}`,
                  style: "valorCampo",
                },
              ],
              [
                { text: "Período / fecha", style: "labelCampo" },
                { text: this.ventanaPagoTexto(ev), style: "valorCampo" },
                { text: "Estado", style: "labelCampo" },
                { text: ev.estado || "—", style: "valorCampo" },
              ],
              [
                { text: "Fecha emisión", style: "labelCampo" },
                { text: fechaEmision, style: "valorCampo" },
                { text: "Usuario", style: "labelCampo" },
                { text: this.usuarioNombre || "—", style: "valorCampo" },
              ],
            ],
          },
          layout: {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => "#cccccc",
            vLineColor: () => "#cccccc",
          },
        },
        {
          text: "Detalle de liquidación",
          style: "subtituloSeccion",
          margin: [0, 8, 0, 6],
        },
        {
          table: {
            headerRows: 1,
            widths: ["*", 120],
            body: [
              [
                { text: "Concepto", style: "tableHeader", fillColor: "#f5f5f5" },
                {
                  text: "Monto (US$)",
                  style: "tableHeader",
                  alignment: "right",
                  fillColor: "#f5f5f5",
                },
              ],
              ...filasLiquidacion,
            ],
          },
          layout: {
            hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
              i === 0 || i === node.table.body.length ? 1 : 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => "#cccccc",
            vLineColor: () => "#cccccc",
          },
        },
        ...(variable
          ? [
              {
                text: "Nota: el monto es variable y se calcula al registrar el pago (p. ej. pago dominical).",
                fontSize: 8,
                italics: true,
                color: "#666666",
                margin: [0, 10, 0, 0],
              },
            ]
          : []),
        {
          text: "Documento informativo de liquidación de pago programado. No sustituye comprobantes tributarios.",
          fontSize: 7,
          color: "#888888",
          alignment: "center",
          margin: [0, 24, 0, 0],
        },
      ],
      styles: {
        tableExample: {
          margin: [0, 0, 0, 8],
        },
        labelCampo: {
          fontSize: 8,
          bold: true,
          fillColor: "#fafafa",
        },
        valorCampo: {
          fontSize: 8,
        },
        subtituloSeccion: {
          fontSize: 11,
          bold: true,
        },
        tableHeader: {
          fontSize: 9,
          bold: true,
        },
        detalleConcepto: {
          fontSize: 9,
          margin: [4, 3, 0, 3],
        },
        detalleMonto: {
          fontSize: 9,
          margin: [0, 3, 4, 3],
        },
        detalleMontoDescuento: {
          fontSize: 9,
          color: "#c62828",
          margin: [0, 3, 4, 3],
        },
        detalleNeto: {
          fontSize: 10,
          fillColor: "#fff8e1",
          margin: [4, 4, 0, 4],
        },
        detalleNetoMonto: {
          fontSize: 10,
          fillColor: "#fff8e1",
          margin: [0, 4, 4, 4],
        },
      },
    };
  }
}
