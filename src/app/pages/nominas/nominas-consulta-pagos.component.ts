import { Component, OnInit } from "@angular/core";
import { forkJoin, of } from "rxjs";
import { catchError, map } from "rxjs/operators";
import { NominasService } from "src/app/servicios/nominas.service";
import { CentroCostoService } from "src/app/servicios/centro-costo.service";
import { CentroCosto } from "../administracion-cuentas/administracion-cuenta";
import Swal from "sweetalert2";
import {
  BeneficiarioFiltroPagos,
  EventoPagoProgramado,
  EventoPagoProgramadoFila,
  ReporteEstadoEmpleado,
  TablaMaestraSalarial,
} from "./nominas";
import { mostrarErrorNominaApi } from "./nominas-alert.util";
import {
  fechaCalendarioParam,
  formatoFechaCalendarioNomina,
  textoFechaPagoNomina,
} from "./nominas-fecha.util";

/** Fila del grid de consulta con clave estable para DevExtreme. */
interface EventoConsultaFila extends EventoPagoProgramadoFila {
  gridKey: string;
}

interface DescuentoEmpleadoFila {
  gridKey: string;
  empleado: string;
  cedula: string;
  transaccionNomina: string;
  cuotaDisplay: string;
  fechaProgramada?: Date | string;
  fechaEjecucion?: Date | string;
  concepto: string;
  montoBruto: number;
  montoConcepto: number;
  totalDescuentoEvento: number;
  montoNeto: number;
  estado: string;
}

@Component({
  selector: "app-nominas-consulta-pagos",
  templateUrl: "./nominas-consulta-pagos.component.html",
  styleUrls: ["./nominas-consulta-pagos.component.scss"],
})
export class NominasConsultaPagosComponent implements OnInit {
  nombresCentrosCosto: string[] = [];
  beneficiariosFiltro: BeneficiarioFiltroPagos[] = [];
  cargandoBeneficiarios = false;

  reporteCedulaSeleccionada: string | null = null;
  reporteCedula = "";
  reporteCentroCosto = "";
  reporteDesde: Date = new Date(new Date().getFullYear(), 0, 1);
  reporteHasta: Date = new Date();
  reporteEstado: ReporteEstadoEmpleado | null = null;
  /** Filas enriquecidas para dx-data-grid (filtros y exportación Excel). */
  eventosGrid: EventoConsultaFila[] = [];
  descuentosEmpleadoGrid: DescuentoEmpleadoFila[] = [];
  cargandoDescuentosEmpleado = false;
  mostrarDescuentosEmpleado = false;
  cedulaReporteConsultado = "";

  textoFechaPago = textoFechaPagoNomina;

  get nombreArchivoExportEventos(): string {
    const etiqueta =
      this.reporteCedula?.trim() ||
      this.reporteCentroCosto?.trim() ||
      "consulta";
    return `consulta-pagos-${etiqueta}`;
  }

  get nombreArchivoExportDescuentos(): string {
    return `descuentos-empleado-${this.reporteCedula?.trim() || "consulta"}`;
  }

  get puedeConsultarDescuentos(): boolean {
    return (
      !!this.reporteCedula?.trim() &&
      this.reporteCedula.trim() === this.cedulaReporteConsultado
    );
  }

  /** Calendario compacto para evitar solapamiento en pantallas anchas */
  opcionesCalendarioCompacto = {
    width: 240,
    elementAttr: { class: "consulta-pagos-calendario-compacto" },
  };

  constructor(
    private _nominasService: NominasService,
    private _centroCostoService: CentroCostoService
  ) {}

  ngOnInit() {
    this.cargarCentrosCosto();
    this.cargarBeneficiariosTms();
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

  onEmpleadoChanged(event: { value?: string | null; event?: Event }) {
    if (event?.event === undefined) return;
    this.reporteCedulaSeleccionada = event.value || null;
    this.reporteCedula = this.reporteCedulaSeleccionada || "";
    if (this.reporteCedula) {
      this.reporteCentroCosto = "";
    }
    this.limpiarDescuentosEmpleado();
  }

  onCentroCostoChanged(event: { value?: string; event?: Event }) {
    if (event?.event === undefined) return;
    if (event.value) {
      this.reporteCedulaSeleccionada = null;
      this.reporteCedula = "";
    }
    this.limpiarDescuentosEmpleado();
  }

  cargarCentrosCosto() {
    this._centroCostoService.getCentrosCostos().subscribe(
      (res) => {
        const centros = res as CentroCosto[];
        this.nombresCentrosCosto = centros.map((c) => c.nombre);
      },
      () => {}
    );
  }

  private fechaLocalParam(fecha: Date): string {
    return fechaCalendarioParam(fecha) || "";
  }

  consultarReporteEstado() {
    const cedula = this.reporteCedula?.trim() || "";
    const centroCosto = this.reporteCentroCosto?.trim() || "";
    if (!cedula && !centroCosto) {
      Swal.fire(
        "Validación",
        "Seleccione un empleado o indique el centro de costo",
        "warning"
      );
      return;
    }
    this.limpiarDescuentosEmpleado();
    this._nominasService
      .getReporteEstadoEmpleado({
        cedula: cedula || undefined,
        centroCosto: cedula ? undefined : centroCosto || undefined,
        desde: this.fechaLocalParam(this.reporteDesde),
        hasta: this.fechaLocalParam(this.reporteHasta),
      })
      .subscribe(
        (res) => {
          const normalizado = { ...res };
          const porTx = normalizado.porTransaccion as unknown;
          if (porTx && !Array.isArray(porTx)) {
            normalizado.porTransaccion = Object.values(
              porTx as Record<string, ReporteEstadoEmpleado["porTransaccion"][0]>
            );
          }
          this.reporteEstado = normalizado;
          this.cedulaReporteConsultado = cedula;
          this.eventosGrid = (normalizado.eventos || []).map((ev, i) =>
            this.mapearEventoGrid(ev, i)
          );
        },
        (err) =>
          mostrarErrorNominaApi("Error", err, "No se pudo consultar")
      );
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
        const nombre =
          (ev.nombreBeneficiario || "").trim() ||
          (ev.cedulaBeneficiario || "").trim() ||
          "Beneficiario";
        Swal.fire({
          title: "Desglose de descuentos",
          html: `
            <p class="text-left mb-2 small text-muted">
              <strong>${nombre}</strong><br/>
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

  consultarDescuentosEmpleado() {
    if (!this.puedeConsultarDescuentos) {
      Swal.fire(
        "Validación",
        "Seleccione y consulte un empleado para ver todos sus descuentos",
        "warning"
      );
      return;
    }

    const eventos = this.eventosGrid.filter(
      (ev) => ev._id && this.tieneDescuento(ev)
    );
    if (!eventos.length) {
      this.descuentosEmpleadoGrid = [];
      this.mostrarDescuentosEmpleado = false;
      Swal.fire(
        "Sin descuentos",
        "El empleado no tiene descuentos en el rango consultado",
        "info"
      );
      return;
    }

    this.cargandoDescuentosEmpleado = true;
    this.mostrarDescuentosEmpleado = false;
    const peticiones = eventos.map((ev) =>
      this._nominasService.getDesgloseDescuentosEvento(ev._id as string).pipe(
        map((desglose) => ({ ev, desglose })),
        catchError(() => of(null))
      )
    );

    forkJoin(peticiones).subscribe(
      (resultados) => {
        const filas: DescuentoEmpleadoFila[] = [];
        resultados.forEach((resultado) => {
          if (!resultado) return;
          const { ev, desglose } = resultado;
          const nombre =
            (ev.nombreBeneficiario || "").trim() ||
            this.nombreEmpleadoSeleccionado();
          const lineas = desglose.lineas?.length
            ? desglose.lineas
            : [
                {
                  etiqueta: "Descuento sin detalle",
                  monto:
                    Number(desglose.montoDescuento) ||
                    Number(ev.montoDescuento) ||
                    0,
                },
              ];

          lineas.forEach((linea, index) => {
            filas.push({
              gridKey: `${ev._id}-${index}`,
              empleado: nombre,
              cedula:
                (ev.cedulaBeneficiario || "").trim() ||
                this.reporteCedula.trim(),
              transaccionNomina: ev.transaccionNomina || "",
              cuotaDisplay: `${ev.numeroCuota}/${ev.totalCuotas}`,
              fechaProgramada: ev.fechaProgramada,
              fechaEjecucion: ev.fechaEjecucion,
              concepto: linea.etiqueta,
              montoBruto:
                Number(desglose.montoBruto) ||
                Number(ev.montoBruto) ||
                Number(ev.monto) + Number(desglose.total),
              montoConcepto: Number(linea.monto) || 0,
              totalDescuentoEvento:
                Number(desglose.montoDescuento) ||
                Number(desglose.total) ||
                Number(ev.montoDescuento) ||
                0,
              montoNeto: Number(desglose.montoNeto) || Number(ev.monto) || 0,
              estado: ev.estado || "",
            });
          });
        });
        this.descuentosEmpleadoGrid = filas;
        this.mostrarDescuentosEmpleado = true;
        this.cargandoDescuentosEmpleado = false;
      },
      (err) => {
        this.cargandoDescuentosEmpleado = false;
        mostrarErrorNominaApi(
          "Error",
          err,
          "No se pudieron cargar los descuentos del empleado"
        );
      }
    );
  }

  ocultarDescuentosEmpleado() {
    this.mostrarDescuentosEmpleado = false;
  }

  private limpiarDescuentosEmpleado() {
    this.descuentosEmpleadoGrid = [];
    this.mostrarDescuentosEmpleado = false;
    this.cargandoDescuentosEmpleado = false;
    this.cedulaReporteConsultado = "";
  }

  private nombreEmpleadoSeleccionado(): string {
    const cedula = this.reporteCedula?.trim();
    const empleado = this.beneficiariosFiltro.find((b) => b.cedula === cedula);
    return empleado?.nombre || "Empleado";
  }

  private mapearEventoGrid(
    ev: EventoPagoProgramado,
    index: number
  ): EventoConsultaFila {
    return {
      ...ev,
      gridKey:
        ev._id ||
        `consulta-${index}-${ev.numeroCuota}-${ev.transaccionNomina || ""}`,
      cuotaDisplay: `${ev.numeroCuota}/${ev.totalCuotas}`,
      rangoFechas: this.textoFechaPago(ev),
      descuentoExport: Number(ev.montoDescuento) || 0,
      montoPagado: Number(ev.montoPagado) || 0,
    };
  }
}
