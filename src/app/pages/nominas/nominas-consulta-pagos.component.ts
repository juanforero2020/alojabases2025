import { Component, OnInit } from "@angular/core";
import { NominasService } from "src/app/servicios/nominas.service";
import { CentroCostoService } from "src/app/servicios/centro-costo.service";
import { CentroCosto } from "../administracion-cuentas/administracion-cuenta";
import Swal from "sweetalert2";
import { ReporteEstadoEmpleado } from "./nominas";

@Component({
  selector: "app-nominas-consulta-pagos",
  templateUrl: "./nominas-consulta-pagos.component.html",
  styleUrls: ["./nominas-consulta-pagos.component.scss"],
})
export class NominasConsultaPagosComponent implements OnInit {
  nombresCentrosCosto: string[] = [];

  reporteCedula = "";
  reporteCentroCosto = "";
  reporteDesde: Date = new Date(new Date().getFullYear(), 0, 1);
  reporteHasta: Date = new Date();
  reporteEstado: ReporteEstadoEmpleado | null = null;

  constructor(
    private _nominasService: NominasService,
    private _centroCostoService: CentroCostoService
  ) {}

  ngOnInit() {
    this.cargarCentrosCosto();
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
    const y = fecha.getFullYear();
    const m = String(fecha.getMonth() + 1).padStart(2, "0");
    const d = String(fecha.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  consultarReporteEstado() {
    const cedula = this.reporteCedula?.trim() || "";
    const centroCosto = this.reporteCentroCosto?.trim() || "";
    if (!cedula && !centroCosto) {
      Swal.fire(
        "Validación",
        "Indique la cédula del empleado o el centro de costo",
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
          Swal.fire(
            "Error",
            err?.error?.mensaje || "No se pudo consultar",
            "error"
          )
      );
  }
}
