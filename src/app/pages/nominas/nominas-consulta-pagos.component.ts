import { Component, OnInit } from "@angular/core";
import { NominasService } from "src/app/servicios/nominas.service";
import { CentroCostoService } from "src/app/servicios/centro-costo.service";
import { CentroCosto } from "../administracion-cuentas/administracion-cuenta";
import Swal from "sweetalert2";
import {
  BeneficiarioFiltroPagos,
  ReporteEstadoEmpleado,
  TablaMaestraSalarial,
} from "./nominas";
import { mostrarErrorNominaApi } from "./nominas-alert.util";
import { fechaCalendarioParam, textoFechaPagoNomina } from "./nominas-fecha.util";

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

  textoFechaPago = textoFechaPagoNomina;

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
  }

  onCentroCostoChanged(event: { value?: string; event?: Event }) {
    if (event?.event === undefined) return;
    if (event.value) {
      this.reporteCedulaSeleccionada = null;
      this.reporteCedula = "";
    }
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
        },
        (err) =>
          mostrarErrorNominaApi("Error", err, "No se pudo consultar")
      );
  }
}
