import { Component, Input, OnInit } from "@angular/core";
import { NominasService } from "src/app/servicios/nominas.service";
import Swal from "sweetalert2";
import {
  BeneficiarioFiltroPagos,
  EventoPagoProgramado,
  TablaMaestraSalarial,
} from "./nominas";

@Component({
  selector: "app-nominas-pagos-programados",
  templateUrl: "./nominas-pagos-programados.component.html",
  styleUrls: ["./nominas-pagos-programados.component.scss"],
})
export class NominasPagosProgramadosComponent implements OnInit {
  @Input() usuarioNombre = "";

  eventosProgramados: EventoPagoProgramado[] = [];
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
    "Cancelado",
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

  constructor(private _nominasService: NominasService) {}

  ngOnInit() {
    this.cargarBeneficiariosTms();
    this.cargarEventosProgramados();
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
    if (!fecha) return undefined;
    const d = new Date(fecha);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
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
          this.eventosProgramados = res;
          this.actualizarOpcionesTransaccion(res);
        },
        () => {}
      );
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
              ${new Date(ev.fechaProgramada).toLocaleDateString("es-EC")}
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
        Swal.fire(
          "Error",
          err?.error?.mensaje || "No se pudo cargar el desglose",
          "error"
        )
    );
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
    const ventana =
      ev.fechaMin && ev.fechaMax
        ? `${new Date(ev.fechaMin).toLocaleDateString("es-EC")} — ${new Date(ev.fechaMax).toLocaleDateString("es-EC")}`
        : new Date(ev.fechaProgramada).toLocaleDateString("es-EC");
    const lineaDesc = this.tieneDescuento(ev)
      ? `Bruto: $${Number(ev.montoBruto || ev.monto).toFixed(2)} − Desc.: $${Number(ev.montoDescuento || 0).toFixed(2)}<br/>`
      : "";

    if (variable) {
      Swal.fire({
        title: "Registrar pago",
        html: `<strong>${ev.nombreBeneficiario}</strong><br/>
          Tipo ${this.etiquetaTipo(ev)} · ${ev.transaccionNomina}<br/>
          Cuota ${ev.numeroCuota}/${ev.totalCuotas}<br/>
          Ventana: ${ventana}<br/>
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
        Ventana: ${ventana}<br/>
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
          Swal.fire(
            "Error",
            err?.error?.mensaje || "No se pudo ejecutar",
            "error"
          )
      );
  }

  puedeEjecutarEvento(ev: EventoPagoProgramado): boolean {
    if (ev.estado !== "Pendiente" && ev.estado !== "Parcial") return false;
    if (!this.esMontoVariable(ev) && this.saldoPendienteEvento(ev) <= 0) {
      return false;
    }
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    if (ev.fechaMin) {
      const min = new Date(ev.fechaMin);
      min.setHours(0, 0, 0, 0);
      if (hoy < min) return false;
    } else {
      const fecha = new Date(ev.fechaProgramada);
      fecha.setHours(0, 0, 0, 0);
      if (hoy < fecha) return false;
    }
    return true;
  }
}
