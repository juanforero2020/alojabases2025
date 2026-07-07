import { Component, Input, OnInit } from "@angular/core";
import { NominasService } from "src/app/servicios/nominas.service";
import Swal from "sweetalert2";
import {
  AjusteNominaPendiente,
  SimulacionDominical,
} from "./nominas";
import { mostrarErrorNominaApi } from "./nominas-alert.util";
import { formatoFechaCalendarioNomina } from "./nominas-fecha.util";

@Component({
  selector: "app-nominas-liquidacion-dominical",
  templateUrl: "./nominas-liquidacion-dominical.component.html",
  styleUrls: ["./nominas-liquidacion-dominical.component.scss"],
})
export class NominasLiquidacionDominicalComponent implements OnInit {
  @Input() usuarioNombre = "";

  fechaDominical: Date = this.ultimoDomingo();
  simulacion: SimulacionDominical | null = null;
  ajustesPendientes: AjusteNominaPendiente[] = [];
  cargandoSimulacion = false;
  liquidando = false;

  constructor(private _nominasService: NominasService) {}

  ngOnInit() {
    this.cargarAjustesPendientes();
  }

  ultimoDomingo(): Date {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  }

  textoFechaDomingo(): string {
    const fecha =
      this.simulacion?.fechaDomingoUsada || this.fechaDominical;
    return formatoFechaCalendarioNomina(fecha);
  }

  cargarAjustesPendientes() {
    this._nominasService.getAjustesPendientesNomina().subscribe(
      (res) => (this.ajustesPendientes = res || []),
      () => (this.ajustesPendientes = [])
    );
  }

  simularLiquidacion() {
    this.cargandoSimulacion = true;
    this._nominasService
      .simularDominical({ fecha: this.fechaDominical })
      .subscribe(
        (res) => {
          this.simulacion = res;
          this.cargandoSimulacion = false;
          if (!res.esDomingo) {
            Swal.fire(
              "Aviso",
              `La fecha seleccionada no es domingo; se usará el domingo ${this.textoFechaDomingo()} para el cálculo.`,
              "info"
            );
          }
        },
        (err) => {
          this.cargandoSimulacion = false;
          mostrarErrorNominaApi("Error", err, "No se pudo calcular la liquidación");
        }
      );
  }

  liquidarTodos() {
    if (!this.simulacion?.liquidaciones?.length) {
      Swal.fire(
        "Validación",
        "Calcule primero la liquidación del domingo.",
        "warning"
      );
      return;
    }

    const pendientes = this.simulacion.pendientesLiquidar ?? 0;
    if (pendientes <= 0) {
      Swal.fire(
        "Sin pendientes",
        "No hay trabajadores pendientes de liquidar para este domingo.",
        "info"
      );
      return;
    }

    Swal.fire({
      title: "¿Liquidar pagos dominicales?",
      html: `Se procesarán <strong>${pendientes}</strong> trabajador(es) con regla dominical activa para el domingo <strong>${this.textoFechaDomingo()}</strong>.<br/><span class="text-muted small">Se registrarán transacciones financieras, se aplicarán ajustes pendientes y se marcarán los eventos programados como ejecutados.</span>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Liquidar todos",
      cancelButtonText: "Cancelar",
    }).then((result) => {
      if (!result.value) return;
      this.liquidando = true;
      this._nominasService
        .liquidarDominical({
          fecha: this.fechaDominical,
          usuario: this.usuarioNombre,
          aplicarAjustes: true,
        })
        .subscribe(
          (res: any) => {
            this.liquidando = false;
            const n = res?.data?.liquidados ?? res?.liquidados ?? 0;
            const omitidos = res?.data?.omitidos ?? res?.omitidos ?? 0;
            Swal.fire(
              "Liquidación completada",
              n
                ? `${n} pago(s) dominical(es) registrado(s) en finanzas.${omitidos ? ` ${omitidos} omitido(s) (ya liquidados o con error).` : ""}`
                : "No se registraron pagos nuevos.",
              "success"
            );
            this.simularLiquidacion();
            this.cargarAjustesPendientes();
          },
          (err) => {
            this.liquidando = false;
            mostrarErrorNominaApi("Error", err, "No se pudo liquidar");
          }
        );
    });
  }
}
