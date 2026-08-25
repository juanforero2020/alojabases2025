import { Component, Input, OnInit } from "@angular/core";
import { NominasService } from "src/app/servicios/nominas.service";
import Swal from "sweetalert2";
import {
  AjusteNominaPendiente,
  LiquidacionDominicalItem,
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
  liquidandoCedula: string | null = null;

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

  puedeLiquidar(liq: LiquidacionDominicalItem): boolean {
    return !!liq?.cedula && !liq.error && !liq.yaLiquidado;
  }

  liquidarUno(liq: LiquidacionDominicalItem) {
    if (!this.puedeLiquidar(liq) || this.liquidando) return;

    const neto = Number(liq.montoNeto) || 0;
    Swal.fire({
      title: "¿Liquidar pago dominical?",
      html: `Se liquidará a <strong>${liq.nombre}</strong> (${liq.cedula}) para el domingo <strong>${this.textoFechaDomingo()}</strong>.<br/>
        Neto: <strong>$${neto.toFixed(2)}</strong><br/>
        <span class="text-muted small">Se registrará la transacción financiera, se aplicarán ajustes pendientes y se marcará el evento programado como ejecutado.</span>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Liquidar",
      cancelButtonText: "Cancelar",
    }).then((result) => {
      if (!result.value) return;
      this.liquidando = true;
      this.liquidandoCedula = liq.cedula;
      this._nominasService
        .liquidarDominical({
          fecha: this.fechaDominical,
          cedula: liq.cedula,
          usuario: this.usuarioNombre,
          aplicarAjustes: true,
        })
        .subscribe(
          (res: any) => {
            this.liquidando = false;
            this.liquidandoCedula = null;
            const n = res?.data?.liquidados ?? res?.liquidados ?? 0;
            Swal.fire(
              n ? "Liquidación completada" : "Sin cambios",
              n
                ? `Se registró el pago dominical de ${liq.nombre} en finanzas.`
                : "No se registró un pago nuevo. Puede que ya estuviera liquidado.",
              n ? "success" : "info"
            );
            this.simularLiquidacion();
            this.cargarAjustesPendientes();
          },
          (err) => {
            this.liquidando = false;
            this.liquidandoCedula = null;
            mostrarErrorNominaApi("Error", err, "No se pudo liquidar");
          }
        );
    });
  }
}
