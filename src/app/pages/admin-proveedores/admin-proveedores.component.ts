import { Component, OnInit } from '@angular/core';
import Swal from 'sweetalert2';
import { ProveedoresService } from 'src/app/servicios/proveedores.service';
import { Proveedor } from '../compras/compra';
import { AuthenService } from 'src/app/servicios/authen.service';
import { user } from '../user/user';

@Component({
  selector: 'app-admin-proveedores',
  templateUrl: './admin-proveedores.component.html',
  styleUrls: ['./admin-proveedores.component.scss']
})
export class AdminProveedoresComponent implements OnInit {
  proveedor: Proveedor = this.nuevoProveedor();
  proveedores: Proveedor[] = [];
  popupVisible = false;
  mostrarBloqueo = true;
  mostrarLoading = false;
  mensajeLoading = 'Cargando...';
  usuarioLogueado: user;
  esEdicion = false;

  constructor(
    public proveedoresService: ProveedoresService,
    public _authenService: AuthenService
  ) { }

  ngOnInit() {
    this.cargarUsuarioLogueado();
    this.traerProveedores();
  }

  get totalConRuc(): number {
    return this.proveedores.filter(p => !!p.ruc).length;
  }

  get totalConContacto(): number {
    return this.proveedores.filter(p => !!p.contacto).length;
  }

  cargarUsuarioLogueado() {
    let correo = '';
    if (localStorage.getItem('maily') != '') {
      correo = localStorage.getItem('maily');
    }

    this._authenService.getUserLogueado(correo).subscribe(res => {
      const usuario = res as user;
      this.usuarioLogueado = usuario[0];
      this.mostrarPopupCodigo();
    });
  }

  mostrarPopupCodigo() {
    Swal.fire({
      title: 'Código de Seguridad',
      allowOutsideClick: false,
      showCancelButton: false,
      inputAttributes: {
        autocapitalize: 'off'
      },
      confirmButtonText: 'Ingresar',
      input: 'password',
    }).then((result) => {
      if (this.usuarioLogueado.codigo == result.value) {
        this.mostrarBloqueo = false;
      } else {
        Swal.fire({
          title: 'Error',
          text: 'El código ingresado no es el correcto',
          icon: 'error',
          confirmButtonText: 'Ok'
        }).then(() => {
          this.mostrarPopupCodigo();
        });
      }
    });
  }

  traerProveedores() {
    this.mensajeLoading = 'Cargando proveedores...';
    this.mostrarLoading = true;
    this.proveedoresService.getProveedor().subscribe(res => {
      this.proveedores = res as Proveedor[];
      this.mostrarLoading = false;
    }, err => {
      this.mostrarLoading = false;
      Swal.fire('Error', 'No se pudieron cargar los proveedores', 'error');
    });
  }

  nuevoProveedor(): Proveedor {
    const proveedor = new Proveedor();
    proveedor._id = '';
    proveedor.nombre_proveedor = '';
    proveedor.ruc = '';
    proveedor.direccion = '';
    proveedor.celular = '';
    proveedor.contacto = '';
    return proveedor;
  }

  abrirNuevo() {
    this.esEdicion = false;
    this.proveedor = this.nuevoProveedor();
    this.popupVisible = true;
  }

  abrirEdicion(registro: Proveedor) {
    this.esEdicion = true;
    this.proveedor = { ...registro };
    this.popupVisible = true;
  }

  cerrarPopup() {
    this.popupVisible = false;
    this.esEdicion = false;
    this.proveedor = this.nuevoProveedor();
  }

  guardarProveedor() {
    if (!this.proveedor.nombre_proveedor?.trim()) {
      Swal.fire('Validación', 'El nombre del proveedor es obligatorio', 'warning');
      return;
    }

    this.proveedor.nombre_proveedor = this.proveedor.nombre_proveedor.trim();
    this.mensajeLoading = 'Guardando...';
    this.mostrarLoading = true;

    const peticion = this.proveedor._id
      ? this.proveedoresService.updateProveedor(this.proveedor)
      : this.proveedoresService.newProveedor(this.proveedor);

    peticion.subscribe(
      () => {
        this.mostrarLoading = false;
        Swal.fire('Éxito', this.esEdicion ? 'Proveedor actualizado' : 'Proveedor creado', 'success');
        this.cerrarPopup();
        this.traerProveedores();
      },
      () => {
        this.mostrarLoading = false;
        Swal.fire('Error', 'No se pudo guardar el proveedor. Revise e intente nuevamente', 'error');
      }
    );
  }

  eliminarProveedor(registro: Proveedor) {
    Swal.fire({
      title: '¿Eliminar proveedor?',
      text: registro.nombre_proveedor,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.value) {
        this.mensajeLoading = 'Eliminando...';
        this.mostrarLoading = true;
        this.proveedoresService.deleteProveedor(registro).subscribe(
          () => {
            this.mostrarLoading = false;
            Swal.fire('Eliminado', 'Proveedor eliminado', 'success');
            this.traerProveedores();
          },
          () => {
            this.mostrarLoading = false;
            Swal.fire('Error', 'No se pudo eliminar el proveedor', 'error');
          }
        );
      }
    });
  }

  onExporting(e) {
    e.component.beginUpdate();
    e.component.columnOption('_id', 'visible', true);
  }

  onExported(e) {
    e.component.columnOption('_id', 'visible', false);
    e.component.endUpdate();
  }
}
