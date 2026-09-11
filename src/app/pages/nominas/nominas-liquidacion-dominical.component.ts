import { Component, Input, OnInit } from "@angular/core";
import { NominasService } from "src/app/servicios/nominas.service";
import Swal from "sweetalert2";
import {
  AjusteNominaPendiente,
  LiquidacionDominicalItem,
  SimulacionDominical,
} from "./nominas";
import { mostrarErrorNominaApi } from "./nominas-alert.util";
import {
  fechaCalendarioLocal,
  formatoFechaCalendarioNomina,
  hoyCalendarioNomina,
  mismoDiaCalendarioNomina,
  NOMINA_PRUEBA_PAGO_CUALQUIER_DIA,
  NOMINA_CALCULAR_DOMINICAL_POR_TRABAJADOR,
} from "./nominas-fecha.util";

@Component({
  selector: "app-nominas-liquidacion-dominical",
  templateUrl: "./nominas-liquidacion-dominical.component.html",
  styleUrls: ["./nominas-liquidacion-dominical.component.scss"],
})
export class NominasLiquidacionDominicalComponent implements OnInit {
  @Input() usuarioNombre = "";
  @Input() esAdministrador = false;
  @Input() esUsuario = false;
  @Input() rolUsuario = "";

  fechaDominical: Date = this.ultimoDomingo();
  simulacion: SimulacionDominical | null = null;
  ajustesPendientes: AjusteNominaPendiente[] = [];
  cargandoSimulacion = false;
  liquidando = false;
  liquidandoCedula: string | null = null;
  autorizandoId: string | null = null;
  calcularPorTrabajador = NOMINA_CALCULAR_DOMINICAL_POR_TRABAJADOR;

  constructor(private _nominasService: NominasService) {}

  ngOnInit() {
    if (this.esUsuario) {
      this.fechaDominical = NOMINA_PRUEBA_PAGO_CUALQUIER_DIA
        ? hoyCalendarioNomina()
        : this.proximoDomingo();
    }
    this.cargarAjustesPendientes();
  }

  ultimoDomingo(): Date {
    const d = hoyCalendarioNomina();
    d.setDate(d.getDate() - d.getDay());
    return d;
  }

  /** Domingo de hoy si hoy es domingo; si no, el próximo domingo que se aproxima. */
  proximoDomingo(): Date {
    const d = hoyCalendarioNomina();
    const dia = d.getDay();
    if (dia !== 0) {
      d.setDate(d.getDate() + (7 - dia));
    }
    return d;
  }

  textoFechaDomingo(): string {
    const fecha =
      this.simulacion?.fechaDomingoUsada || this.fechaDominical;
    return formatoFechaCalendarioNomina(fecha);
  }

  fechaDomingoConsulta(): Date | null {
    return (
      fechaCalendarioLocal(
        this.simulacion?.fechaDomingoUsada || this.fechaDominical
      ) || null
    );
  }

  esMismoDomingoHoy(): boolean {
    if (NOMINA_PRUEBA_PAGO_CUALQUIER_DIA) return true;
    const hoy = hoyCalendarioNomina();
    if (hoy.getDay() !== 0) return false;
    return mismoDiaCalendarioNomina(hoy, this.fechaDomingoConsulta());
  }

  esFechaAntigua(): boolean {
    const domingo = this.fechaDomingoConsulta();
    if (!domingo) return false;
    return domingo.getTime() < hoyCalendarioNomina().getTime();
  }

  esFechaPosterior(): boolean {
    const hoy = hoyCalendarioNomina();
    const domingo = this.fechaDomingoConsulta();
    if (!domingo) return false;
    return domingo.getTime() > hoy.getTime();
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
    if (!liq?.cedula || liq.error || liq.yaLiquidado) return false;
    if (this.esAdministrador) return true;
    if (!this.esUsuario) return true;
    if (!this.esMismoDomingoHoy()) return false;
    if (this.estaAutorizadoAdicional(liq)) return true;
    if (!liq.cargoPermitidoUsuario) return false;
    if (liq.requiereAutorizacionAdmin) return false;
    return true;
  }

  estaAutorizadoAdicional(liq: LiquidacionDominicalItem): boolean {
    return liq?.pagoAdicionalAutorizado === true;
  }

  puedeAutorizarAdicional(liq: LiquidacionDominicalItem): boolean {
    if (!this.esAdministrador) return false;
    if (!liq?.cedula || liq.error || liq.yaLiquidado) return false;
    if (!liq.eventoProgramadoId) return false;
    if (liq.pagoAdicionalAutorizado) return false;
    if (!liq.cargoPermitidoUsuario) return false;
    return !!liq.requiereAutorizacionAdmin;
  }

  mensajeAccion(liq: LiquidacionDominicalItem): string | null {
    if (liq.yaLiquidado || liq.error) return null;
    if (this.esAdministrador) return null;
    if (!this.esUsuario) return null;
    if (!this.esMismoDomingoHoy()) {
      if (this.esFechaAntigua()) return "No disponible para fechas antiguas";
      if (this.esFechaPosterior()) {
        return "No disponible para fechas posteriores";
      }
      return "Solo se habilita el domingo de hoy";
    }
    if (this.estaAutorizadoAdicional(liq)) return null;
    if (liq.requiereAutorizacionAdmin) {
      return "En espera de autorización del administrador";
    }
    return null;
  }

  autorizarPagoAdicional(liq: LiquidacionDominicalItem) {
    if (!this.puedeAutorizarAdicional(liq) || this.liquidando) return;

    Swal.fire({
      title: "Autorizar pago adicional",
      html: `¿Habilitar el pago dominical de <strong>${liq.nombre}</strong> (${liq.cargo}) para el rol Usuario?<br/>
        Domingo: <strong>${this.textoFechaDomingo()}</strong><br/>
        <span class="text-muted">Ya se liquidó a otro trabajador de este cargo. Tras autorizar, el usuario podrá usar Liquidar.</span>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Autorizar",
      cancelButtonText: "Cancelar",
    }).then((result) => {
      if (!result.value || !liq.eventoProgramadoId) return;
      this.autorizandoId = liq.eventoProgramadoId;
      this._nominasService
        .autorizarPagoAdicional(liq.eventoProgramadoId, {
          usuario: this.usuarioNombre,
        })
        .subscribe(
          () => {
            this.autorizandoId = null;
            Swal.fire(
              "Autorizado",
              "El usuario podrá liquidar a este trabajador el domingo correspondiente.",
              "success"
            );
            this.simularLiquidacion();
          },
          (err) => {
            this.autorizandoId = null;
            mostrarErrorNominaApi("Error", err, "No se pudo autorizar");
          }
        );
    });
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
          rol: this.rolUsuario,
          esAdministrador: this.esAdministrador,
          esUsuario: this.esUsuario,
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
