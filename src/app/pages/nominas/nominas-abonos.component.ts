import { Component, Input, OnInit } from "@angular/core";
import { NominasService } from "src/app/servicios/nominas.service";
import Swal from "sweetalert2";
import {
  OpcionBeneficiarioBusqueda,
  PrestamoAbonoResumen,
} from "./nominas";
import { mostrarErrorNominaApi } from "./nominas-alert.util";

@Component({
  selector: "app-nominas-abonos",
  templateUrl: "./nominas-abonos.component.html",
  styleUrls: ["./nominas-abonos.component.scss"],
})
export class NominasAbonosComponent implements OnInit {
  @Input() usuarioNombre = "";
  @Input() esAdministrador = false;
  @Input() esUsuario = false;
  @Input() rolUsuario = "";

  tiposBeneficiario: Array<"Interno" | "Externo"> = ["Interno", "Externo"];
  tipoBeneficiario: "Interno" | "Externo" = "Interno";
  modoBusqueda: "cedula" | "nombre" = "cedula";
  modosBusqueda = [
    { valor: "cedula", etiqueta: "Cédula / RUC" },
    { valor: "nombre", etiqueta: "Nombre" },
  ];
  camposBusquedaNombre = ["nombre", "cedula", "etiquetaDisplay"];
  textoBusqueda = "";
  cedulaSeleccionada: string | null = null;
  personas: OpcionBeneficiarioBusqueda[] = [];
  prestamos: PrestamoAbonoResumen[] = [];
  cargando = false;
  ejecutandoId: string | null = null;

  constructor(private _nominasService: NominasService) {}

  ngOnInit() {
    this.cargarPersonas();
  }

  etiquetaDocumento(): string {
    return this.tipoBeneficiario === "Externo" ? "RUC / cédula" : "Cédula";
  }

  cargarPersonas() {
    this._nominasService
      .getPersonasAbonosPrestamo(this.tipoBeneficiario)
      .subscribe(
        (lista) => {
          this.personas = lista || [];
        },
        () => {
          this.personas = [];
        }
      );
  }

  onTipoBeneficiarioChanged(event?: { event?: Event }) {
    if (event && !event.event) return;
    this.textoBusqueda = "";
    this.cedulaSeleccionada = null;
    this.prestamos = [];
    this.cargarPersonas();
  }

  onModoBusquedaChanged(event?: { event?: Event }) {
    if (event && !event.event) return;
    this.textoBusqueda = "";
    this.cedulaSeleccionada = null;
  }

  onPersonaNombreChanged(event?: { value?: string; event?: Event }) {
    if (event && !event.event) return;
    this.textoBusqueda = this.cedulaSeleccionada || "";
    this.buscarPrestamos();
  }

  buscarPrestamos(mostrarVacio = true) {
    const texto = (this.textoBusqueda || this.cedulaSeleccionada || "").trim();
    if (!texto) {
      if (!mostrarVacio) return;
      Swal.fire(
        "Validación",
        `Indique ${this.etiquetaDocumento().toLowerCase()} o el nombre`,
        "warning"
      );
      return;
    }
    this.cargando = true;
    const filtros: {
      tipoBeneficiario: "Interno" | "Externo";
      cedula?: string;
      q?: string;
    } = {
      tipoBeneficiario: this.tipoBeneficiario,
    };
    if (this.modoBusqueda === "cedula" || /^\d/.test(texto)) {
      filtros.cedula = texto;
    } else {
      filtros.q = texto;
    }
    this._nominasService.getPrestamosParaAbono(filtros).subscribe(
      (lista) => {
        this.prestamos = (lista || []).map((p) => ({
          ...p,
          montoAbonoCaptura: undefined,
        }));
        this.cargando = false;
        if (!this.prestamos.length && mostrarVacio) {
          Swal.fire(
            "Sin préstamos",
            "No hay préstamos activos para esa persona",
            "info"
          );
        }
      },
      (err) => {
        this.cargando = false;
        mostrarErrorNominaApi(
          "Error",
          err,
          "No se pudieron cargar los préstamos"
        );
      }
    );
  }

  confirmarAbono(prestamo: PrestamoAbonoResumen) {
    const saldo = Number(prestamo.saldoPendientePrestamo) || 0;
    const monto = Math.round((Number(prestamo.montoAbonoCaptura) || 0) * 100) / 100;
    if (!(monto > 0.009)) {
      Swal.fire("Validación", "Indique el valor a abonar", "warning");
      return;
    }
    if (monto > saldo + 0.01) {
      Swal.fire(
        "Validación",
        `El abono ($${monto.toFixed(2)}) no puede superar el saldo ($${saldo.toFixed(
          2
        )})`,
        "warning"
      );
      return;
    }
    Swal.fire({
      title: "Registrar abono",
      html: `<strong>${prestamo.codigoPrestamo ? prestamo.codigoPrestamo + " · " : ""}${prestamo.nombreBeneficiario || ""}</strong><br/>
        ${prestamo.cedulaBeneficiario || ""} · ${prestamo.tipoBeneficiario}<br/>
        Total préstamo: $${Number(prestamo.montoTotalDeuda || 0).toFixed(2)}<br/>
        Ya abonado: $${Number(prestamo.montoAbonado || 0).toFixed(2)}<br/>
        Pendiente: $${saldo.toFixed(2)}<br/>
        <strong>Abono: $${monto.toFixed(2)}</strong><br/>
        <span class="text-muted">Se descontará de las cuotas más próximas a pagar (las cubiertas se eliminan y la siguiente se reduce). Ingreso en 1.3 / 1.3.3</span>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Registrar abono",
      cancelButtonText: "Cancelar",
    }).then((result) => {
      if (!result.value || !prestamo._id) return;
      this.ejecutarAbono(prestamo, monto);
    });
  }

  ejecutarAbono(prestamo: PrestamoAbonoResumen, monto: number) {
    this.ejecutandoId = prestamo._id || null;
    this._nominasService
      .ejecutarAbonoPrestamo(prestamo._id, {
        usuario: this.usuarioNombre,
        monto,
      })
      .subscribe(
        (res: any) => {
          this.ejecutandoId = null;
          const detalleRefin =
            res && res.refinanciacion && res.refinanciacion.texto
              ? ` ${res.refinanciacion.texto}.`
              : "";
          Swal.fire(
            "Abono registrado",
            `Se abonó $${Number(res.montoAbonado || monto).toFixed(
              2
            )}. Saldo pendiente: $${Number(res.saldoPrestamo || 0).toFixed(
              2
            )}.${detalleRefin}`,
            "success"
          );
          this.cargarPersonas();
          if (res && res.data && res.data._id) {
            this.prestamos = this.prestamos.map((p) =>
              String(p._id) === String(res.data._id)
                ? { ...res.data, montoAbonoCaptura: undefined }
                : p
            );
          } else {
            this.buscarPrestamos(false);
          }
        },
        (err) => {
          this.ejecutandoId = null;
          mostrarErrorNominaApi("Error", err, "No se pudo registrar el abono");
        }
      );
  }
}
