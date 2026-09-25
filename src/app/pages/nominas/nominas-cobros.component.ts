import { Component, Input, OnInit } from "@angular/core";
import { NominasService } from "src/app/servicios/nominas.service";
import Swal from "sweetalert2";
import {
  EventoCobroPrestamo,
  OpcionBeneficiarioBusqueda,
} from "./nominas";
import { mostrarErrorNominaApi } from "./nominas-alert.util";
import {
  formatoFechaCalendarioNomina,
  hoyCalendarioNomina,
  inicioDiaCalendarioNomina,
} from "./nominas-fecha.util";

@Component({
  selector: "app-nominas-cobros",
  templateUrl: "./nominas-cobros.component.html",
  styleUrls: ["./nominas-cobros.component.scss"],
})
export class NominasCobrosComponent implements OnInit {
  @Input() usuarioNombre: string = "";
  @Input() esAdministrador: boolean = false;
  @Input() esUsuario: boolean = false;
  @Input() rolUsuario: string = "";

  modoBusqueda: "cedula" | "nombre" = "cedula";
  modosBusqueda = [
    { valor: "cedula", etiqueta: "Cédula / RUC" },
    { valor: "nombre", etiqueta: "Nombre" },
  ];
  camposBusquedaNombre = ["nombre", "cedula", "etiquetaDisplay"];
  textoBusqueda = "";
  cedulaSeleccionada: string | null = null;
  personasPendientes: OpcionBeneficiarioBusqueda[] = [];
  cobros: EventoCobroPrestamo[] = [];
  filtroEstado = "Pendiente";
  estadosFiltro = ["Pendiente", "Ejecutado", "Anulado", "Todos"];
  cargando = false;
  ejecutandoId: string | null = null;

  constructor(private _nominasService: NominasService) {}

  ngOnInit() {
    this.cargarPersonasPendientes();
    this.buscarCobros();
  }

  cargarPersonasPendientes() {
    this._nominasService.getPersonasCobrosPendientes().subscribe(
      (lista) => {
        this.personasPendientes = lista || [];
      },
      () => {
        this.personasPendientes = [];
      }
    );
  }

  onModoBusquedaChanged(event?: { event?: Event }) {
    if (event && !event.event) return;
    this.textoBusqueda = "";
    this.cedulaSeleccionada = null;
  }

  onPersonaNombreChanged(event?: { value?: string; event?: Event }) {
    if (event && !event.event) return;
    this.textoBusqueda = this.cedulaSeleccionada || "";
    this.buscarCobros();
  }

  onEstadoChanged(event?: { value?: string; event?: Event }) {
    if (event && !event.event) return;
    if (event && event.value != null) {
      this.filtroEstado = event.value;
    }
    this.buscarCobros();
  }

  buscarCobros() {
    this.cargando = true;
    const filtros: {
      q?: string;
      cedula?: string;
      estado?: string;
    } = {
      estado: this.filtroEstado,
    };
    const texto = (this.textoBusqueda || this.cedulaSeleccionada || "").trim();
    if (texto) {
      if (this.modoBusqueda === "cedula" || /^\d/.test(texto)) {
        filtros.cedula = texto;
      } else {
        filtros.q = texto;
      }
    }
    this._nominasService.getCobrosPrestamo(filtros).subscribe(
      (lista) => {
        this.cobros = lista || [];
        this.cargando = false;
      },
      (err) => {
        this.cargando = false;
        mostrarErrorNominaApi("Error", err, "No se pudieron cargar los cobros");
      }
    );
  }

  saldoCuota(cobro: EventoCobroPrestamo): number {
    if (cobro.montoPendiente != null) {
      return Math.round(Number(cobro.montoPendiente) * 100) / 100;
    }
    return (
      Math.round(
        Math.max(0, (Number(cobro.monto) || 0) - (Number(cobro.montoPagado) || 0)) *
          100
      ) / 100
    );
  }

  puedeCobrar(cobro: EventoCobroPrestamo): boolean {
    const estado = cobro.estado || "";
    return (
      (estado === "Pendiente" || estado === "Parcial") &&
      this.saldoCuota(cobro) > 0.009 &&
      !this.estaAntesDeFechaCobro(cobro)
    );
  }

  estaAntesDeFechaCobro(cobro: EventoCobroPrestamo): boolean {
    const fechaCobro = cobro.fechaMin || cobro.fechaProgramada;
    if (!fechaCobro) return false;
    return hoyCalendarioNomina().getTime() < inicioDiaCalendarioNomina(fechaCobro).getTime();
  }

  mensajeEstadoCobro(cobro: EventoCobroPrestamo): string {
    if (this.puedeCobrar(cobro)) return "";
    const estado = cobro.estado || "";
    if (
      (estado === "Pendiente" || estado === "Parcial") &&
      this.saldoCuota(cobro) > 0.009 &&
      this.estaAntesDeFechaCobro(cobro)
    ) {
      return "Fuera de fecha";
    }
    return estado;
  }

  confirmarCobro(cobro: EventoCobroPrestamo) {
    const saldo = this.saldoCuota(cobro);
    const fecha = formatoFechaCalendarioNomina(cobro.fechaProgramada);
    Swal.fire({
      title: "Registrar recibo de cobro",
      html: `<strong>${cobro.codigoPrestamo ? cobro.codigoPrestamo + " · " : ""}${cobro.nombreBeneficiario || ""}</strong><br/>
        ${cobro.cedulaBeneficiario || ""} · ${cobro.tipoBeneficiario || "Externo"}<br/>
        Cuota ${cobro.numeroCuota}/${cobro.totalCuotas} · Fecha ${fecha}<br/>
        Programado: $${Number(cobro.monto || 0).toFixed(2)} · Pagado: $${Number(
        cobro.montoPagado || 0
      ).toFixed(2)}<br/>
        <strong>Ingreso en 1.3 INGRESOS / 1.3.3 Pago o Abono Préstamo: $${saldo.toFixed(2)}</strong>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Registrar cobro",
      cancelButtonText: "Cancelar",
    }).then((result) => {
      if (!result.value || !cobro._id) return;
      this.ejecutarCobro(cobro._id, saldo);
    });
  }

  ejecutarCobro(id: string, monto: number) {
    this.ejecutandoId = id;
    this._nominasService
      .ejecutarCobroPrestamo(id, {
        usuario: this.usuarioNombre,
        monto,
      })
      .subscribe(
        (res: any) => {
          this.ejecutandoId = null;
          Swal.fire(
            "Cobro registrado",
            `Ingreso de $${Number(res.montoCobrado || monto).toFixed(
              2
            )}. Saldo del préstamo: $${Number(res.saldoPrestamo || 0).toFixed(
              2
            )}.`,
            "success"
          );
          this.cargarPersonasPendientes();
          this.buscarCobros();
        },
        (err) => {
          this.ejecutandoId = null;
          mostrarErrorNominaApi("Error", err, "No se pudo registrar el cobro");
        }
      );
  }
}
