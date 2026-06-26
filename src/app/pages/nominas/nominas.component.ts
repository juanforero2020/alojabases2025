import { Component, OnInit } from "@angular/core";
import { AuthenService } from "src/app/servicios/authen.service";
import { NominasService } from "src/app/servicios/nominas.service";
import { UserService } from "src/app/servicios/user.service";
import Swal from "sweetalert2";
import { user } from "../user/user";
import {
  AporteIess,
  FilaCalculoDominical,
  NominaConfigGlobal,
  OtroCargoNomina,
  TablaMaestraSalarial,
} from "./nominas";

@Component({
  selector: "app-nominas",
  templateUrl: "./nominas.component.html",
  styleUrls: ["./nominas.component.scss"],
})
export class NominasComponent implements OnInit {
  seccionesMenu = [
    "Tabla Maestra Salarial",
    "Configuración Global",
    "Eventos de Pagos",
    "Pagos Programados",
    "Consulta de Pagos",
  ];
  seccionActiva = "Tabla Maestra Salarial";
  esAdministrador = false;

  usuarioLogueado: user;
  nombreUsuario = "";
  mostrarBloqueo = true;
  mostrarLoading = false;
  mensajeLoading = "Cargando...";

  tablasSalariales: TablaMaestraSalarial[] = [];
  registroSeleccionado: TablaMaestraSalarial | null = null;
  popupTablaSalarial = false;
  modoEdicion = false;

  periodosPago = ["Semanal", "Quincenal", "Mensual"];

  /** Roles/cargos del sistema (misma lista que Creación de usuarios) */
  cargosDisponibles: string[] = [
    "Usuario",
    "Administrador",
    "Usuario Web",
    "Supervisor",
    "Inspector",
    "Distribuidor",
    "Bodeguero",
  ];

  formularioSalarial: TablaMaestraSalarial = this.nuevoRegistroSalarial();

  usuariosSistema: Array<user & { etiquetaUsuario?: string }> = [];

  configGlobal: NominaConfigGlobal = {
    aportesIess: [],
    calculoDominical: {
      limiteFacturacion: 1000,
      filas: [],
    },
    otrosCargos: [],
  };

  constructor(
    public _authenService: AuthenService,
    public _nominasService: NominasService,
    public _userService: UserService
  ) {}

  ngOnInit() {
    this.cargarUsuarioLogueado();
  }

  nuevoRegistroSalarial(): TablaMaestraSalarial {
    return {
      cedula: "",
      nombre: "",
      cargo: "",
      telefono: "",
      fechaInicioLabores: new Date(),
      asignacionSalarial: 0,
      periodoPago: "Semanal",
      salarioCalculoVariablesPrestacionales: 0,
      activo: true,
      usuarioSistemaId: undefined,
      usuarioSistemaNombre: "",
      usuarioSistemaUsername: "",
      notas: "",
    };
  }

  cargarUsuariosSistema() {
    this._userService.getUsers().subscribe(
      (res) => {
        const lista = res as user[];
        this.usuariosSistema = lista.map((u) => ({
          ...u,
          etiquetaUsuario: this.etiquetaUsuarioSistema(u),
        }));
      },
      () => {}
    );
  }

  etiquetaUsuarioSistema(u: user): string {
    const rol =
      typeof u.rol === "string" ? u.rol : (u.rol as { name?: string })?.name || "";
    const login = u.username || u.email || "";
    return `${u.name || "Sin nombre"}${login ? " — " + login : ""}${
      rol ? " (" + rol + ")" : ""
    }`;
  }

  onUsuarioSistemaChanged(event: { value?: string; event?: Event }) {
    if (!event?.event) {
      return;
    }
    const id = event.value;
    if (!id) {
      this.formularioSalarial.usuarioSistemaId = undefined;
      this.formularioSalarial.usuarioSistemaNombre = "";
      this.formularioSalarial.usuarioSistemaUsername = "";
      return;
    }
    const u = this.usuariosSistema.find((x) => x._id === id);
    if (u) {
      this.formularioSalarial.usuarioSistemaId = u._id;
      this.formularioSalarial.usuarioSistemaNombre = u.name || "";
      this.formularioSalarial.usuarioSistemaUsername = u.username || "";
    }
  }

  cargarUsuarioLogueado() {
    let correo = "";
    if (localStorage.getItem("maily") != "") {
      correo = localStorage.getItem("maily");
    }
    this._authenService.getUserLogueado(correo).subscribe(
      (res) => {
        this.usuarioLogueado = res as user;
        if (this.usuarioLogueado?.[0]?.name) {
          this.nombreUsuario = this.usuarioLogueado[0].name;
        }
        this.esAdministrador =
          this.usuarioLogueado[0].rol?.toString() === "Administrador";
        if (!this.esAdministrador) {
          this.seccionActiva = "Pagos Programados";
          this.seccionesMenu = ["Pagos Programados"];
        }
        this.mostrarPopupCodigo();
      },
      () => {}
    );
  }

  mostrarPopupCodigo() {
    Swal.fire({
      title: "Código de Seguridad",
      allowOutsideClick: false,
      showCancelButton: false,
      inputAttributes: { autocapitalize: "off" },
      confirmButtonText: "Ingresar",
      input: "password",
    }).then((result) => {
      if (this.usuarioLogueado[0].codigo == result.value) {
        this.mostrarBloqueo = false;
        this.inicializarDatos();
      } else {
        Swal.fire({
          title: "Error",
          text: "El código ingresado no es el correcto",
          icon: "error",
          confirmButtonText: "Ok",
        }).then(() => this.mostrarPopupCodigo());
      }
    });
  }

  inicializarDatos() {
    this.cargarUsuariosSistema();
    this.cargarTablasSalariales();
    this.cargarConfigGlobal();
  }

  cambiarSeccion(event: { value: string }) {
    this.seccionActiva = event.value;
  }

  cargarTablasSalariales() {
    this.mostrarLoading = true;
    this._nominasService.getTablasMaestrasSalariales().subscribe(
      (res) => {
        this.tablasSalariales = res;
        this.mostrarLoading = false;
      },
      () => {
        this.mostrarLoading = false;
        Swal.fire("Error", "No se pudieron cargar las tablas salariales", "error");
      }
    );
  }

  cargarConfigGlobal() {
    this._nominasService.getConfigGlobal().subscribe(
      (res) => {
        this.configGlobal = res;
        this.normalizarFechasOtrosCargos();
        this.sincronizarEtiquetasCalculoDominical();
      },
      () => {
        Swal.fire("Error", "No se pudo cargar la configuración global", "error");
      }
    );
  }

  /** Formato del monto en encabezados (ej. 1000 → "1.000" o "1000") */
  formatearLimiteFacturacion(limite: number): string {
    const valor = Number(limite) || 0;
    return valor.toLocaleString("es-EC", { maximumFractionDigits: 0 });
  }

  /** Etiqueta columna: facturación menor al límite */
  get etiquetaRangoInferior(): string {
    const limite =
      this.configGlobal?.calculoDominical?.limiteFacturacion ?? 0;
    return `Rango inferior ($${this.formatearLimiteFacturacion(
      limite
    )} > Facturación)`;
  }

  /** Etiqueta columna: facturación mayor o igual al límite */
  get etiquetaRangoSuperior(): string {
    const limite =
      this.configGlobal?.calculoDominical?.limiteFacturacion ?? 0;
    return `Rango superior ($${this.formatearLimiteFacturacion(
      limite
    )} < Facturación)`;
  }

  onLimiteFacturacionChanged() {
    this.sincronizarEtiquetasCalculoDominical();
  }

  sincronizarEtiquetasCalculoDominical() {
    if (!this.configGlobal?.calculoDominical) {
      return;
    }
    this.configGlobal.calculoDominical.etiquetaRangoInferior =
      this.etiquetaRangoInferior;
    this.configGlobal.calculoDominical.etiquetaRangoSuperior =
      this.etiquetaRangoSuperior;
  }

  abrirNuevoRegistro() {
    this.modoEdicion = false;
    this.formularioSalarial = this.nuevoRegistroSalarial();
    this.popupTablaSalarial = true;
  }

  abrirEdicion(registro: TablaMaestraSalarial) {
    this.modoEdicion = true;
    this.registroSeleccionado = registro;
    this.formularioSalarial = { ...registro };
    if (registro.fechaInicioLabores) {
      this.formularioSalarial.fechaInicioLabores = new Date(
        registro.fechaInicioLabores
      );
    }
    this.popupTablaSalarial = true;
  }

  cerrarPopupSalarial() {
    this.popupTablaSalarial = false;
    this.registroSeleccionado = null;
  }

  guardarTablaSalarial() {
    if (!this.formularioSalarial.cedula?.trim()) {
      Swal.fire("Validación", "La cédula es obligatoria", "warning");
      return;
    }
    if (!this.formularioSalarial.nombre?.trim()) {
      Swal.fire("Validación", "El nombre es obligatorio", "warning");
      return;
    }

    this.formularioSalarial.cedula = this.formularioSalarial.cedula.trim();

    this.mostrarLoading = true;
    const peticion = this.modoEdicion
      ? this._nominasService.actualizarTablaMaestraSalarial(
          this.registroSeleccionado._id,
          this.formularioSalarial
        )
      : this._nominasService.crearTablaMaestraSalarial(this.formularioSalarial);

    peticion.subscribe(
      () => {
        this.mostrarLoading = false;
        Swal.fire("Éxito", "Tabla maestra salarial guardada", "success");
        this.cerrarPopupSalarial();
        this.cargarTablasSalariales();
      },
      (err) => {
        this.mostrarLoading = false;
        const msg =
          err?.error?.mensaje || "No se pudo guardar el registro";
        Swal.fire("Error", msg, "error");
      }
    );
  }

  eliminarTablaSalarial(registro: TablaMaestraSalarial) {
    Swal.fire({
      title: "¿Eliminar tabla maestra?",
      text: `${registro.nombre} (${registro.cedula})`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Eliminar",
      cancelButtonText: "Cancelar",
    }).then((result) => {
      if (result.value) {
        this._nominasService
          .eliminarTablaMaestraSalarial(registro._id)
          .subscribe(
            () => {
              Swal.fire("Eliminado", "Registro eliminado", "success");
              this.cargarTablasSalariales();
            },
            () =>
              Swal.fire("Error", "No se pudo eliminar el registro", "error")
          );
      }
    });
  }

  calcularAporteIess(aporte: AporteIess): number {
    const base =
      this.formularioSalarial.salarioCalculoVariablesPrestacionales || 0;
    return (base * (aporte.porcentaje || 0)) / 100;
  }

  normalizarFechasOtrosCargos() {
    if (!this.configGlobal?.otrosCargos) {
      return;
    }
    this.configGlobal.otrosCargos.forEach((cargo) => {
      const legacy = cargo as OtroCargoNomina & {
        fechaLimiteTexto?: string;
        fechaLimiteDia?: number;
        fechaLimiteMes?: number;
      };
      if (
        !cargo.fechaLimite &&
        (legacy.fechaLimiteDia || legacy.fechaLimiteMes)
      ) {
        const anio = new Date().getFullYear();
        cargo.fechaLimite = new Date(
          anio,
          (legacy.fechaLimiteMes || 1) - 1,
          legacy.fechaLimiteDia || 1
        );
      } else if (cargo.fechaLimite) {
        cargo.fechaLimite = new Date(cargo.fechaLimite);
      }
    });
  }

  validarCalculoDominical(): string | null {
    const filas = this.configGlobal?.calculoDominical?.filas || [];
    const cargos = filas
      .map((f) => (f.cargo || "").trim())
      .filter((c) => !!c);
    const duplicados = cargos.filter((c, i) => cargos.indexOf(c) !== i);
    if (duplicados.length) {
      const unicos = Array.from(new Set(duplicados));
      return `No puede repetir el mismo cargo en cálculo dominical. Duplicados: ${unicos.join(
        ", "
      )}`;
    }
    return null;
  }

  onCargoDominicalChanged(
    indice: number,
    event: { value?: string; previousValue?: string; event?: Event }
  ) {
    // Ignorar cambios programáticos (evita bloquear el select al abrir/guardar)
    if (!event?.event) {
      return;
    }
    const cargo = (event.value || "").trim();
    if (!cargo) {
      return;
    }
    const indiceDuplicado = this.configGlobal.calculoDominical.filas.findIndex(
      (f, i) => i !== indice && (f.cargo || "").trim() === cargo
    );
    if (indiceDuplicado >= 0) {
      setTimeout(() => {
        this.configGlobal.calculoDominical.filas[indice].cargo =
          event.previousValue || "";
      });
      Swal.fire(
        "Validación",
        `El cargo "${cargo}" ya está asignado en otra fila.`,
        "warning"
      );
    }
  }

  guardarConfigGlobal() {
    this.sincronizarEtiquetasCalculoDominical();
    const errorDominical = this.validarCalculoDominical();
    if (errorDominical) {
      Swal.fire("Validación", errorDominical, "warning");
      return;
    }
    this.mostrarLoading = true;
    this._nominasService.guardarConfigGlobal(this.configGlobal).subscribe(
      () => {
        this.mostrarLoading = false;
        Swal.fire("Éxito", "Configuración global guardada", "success");
      },
      (err) => {
        this.mostrarLoading = false;
        Swal.fire(
          "Error",
          err?.error?.mensaje || "No se pudo guardar la configuración",
          "error"
        );
      }
    );
  }

  restablecerConfigGlobal() {
    Swal.fire({
      title: "¿Restablecer valores por defecto?",
      text: "Se perderán los cambios en tablas maestras globales",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Restablecer",
      cancelButtonText: "Cancelar",
    }).then((result) => {
      if (result.value) {
        this._nominasService.restablecerConfigGlobal().subscribe(
          (res: any) => {
            this.configGlobal = res.data;
            this.normalizarFechasOtrosCargos();
            this.sincronizarEtiquetasCalculoDominical();
            Swal.fire("Listo", "Configuración restablecida", "success");
          },
          () =>
            Swal.fire("Error", "No se pudo restablecer la configuración", "error")
        );
      }
    });
  }

  agregarFilaDominical() {
    const filas = this.configGlobal.calculoDominical.filas;
    const cargosUsados = filas
      .map((f) => (f.cargo || "").trim())
      .filter((c) => !!c);
    const cargosLibres = this.cargosDisponibles.filter(
      (c) => !cargosUsados.includes(c)
    );
    if (cargosLibres.length === 0) {
      Swal.fire(
        "Validación",
        "Ya no hay cargos disponibles para agregar otra fila.",
        "warning"
      );
      return;
    }
    const fila: FilaCalculoDominical = {
      cargo: "",
      valorRangoInferior: 0,
      valorRangoSuperior: 0,
      activo: true,
    };
    filas.push(fila);
  }

  eliminarFilaDominical(index: number) {
    this.configGlobal.calculoDominical.filas.splice(index, 1);
  }

  agregarAporteIess() {
    this.configGlobal.aportesIess.push({
      concepto: "",
      porcentaje: 0,
      tipo: "otro",
      activo: true,
      orden: this.configGlobal.aportesIess.length + 1,
    });
  }

  eliminarAporteIess(index: number) {
    this.configGlobal.aportesIess.splice(index, 1);
  }

  agregarOtroCargo() {
    this.configGlobal.otrosCargos.push({
      concepto: "",
      fechaLimite: null,
      valor: 0,
      activo: true,
      orden: this.configGlobal.otrosCargos.length + 1,
    });
  }

  eliminarOtroCargo(index: number) {
    this.configGlobal.otrosCargos.splice(index, 1);
  }
}
