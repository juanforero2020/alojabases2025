import { Component, OnInit } from '@angular/core';
import { user } from './user';
import { SucursalesService } from 'src/app/servicios/sucursales.service';
import { Sucursal } from '../compras/compra';
import Swal from 'sweetalert2';
import { UserService } from 'src/app/servicios/user.service';
import { AuthenService } from 'src/app/servicios/authen.service';

@Component({
  selector: 'app-user',
  templateUrl: './user.component.html',
  styleUrls: ['./user.component.scss']
})
export class UserComponent implements OnInit {
  menuTipoDatos: string[] = [
    'Activo',
    'Inactivo',
  ];

  usuario = this.nuevoUsuario();
  popupVisible = false;
  esEdicion = false;
  usuarios: user[] = [];
  usuarioLogueado: user;
  localAsignado = '';
  locales: Sucursal[] = [];
  mostrarLoading = false;
  mensajeLoading = '';
  mostrarBloqueo = true;
  puedeAccederPagos = false;

  menu1: string[] = [
    'Usuario',
    'Administrador',
    'Usuario Web',
    'Supervisor',
    'Inspector',
    'Distribuidor',
    'Bodeguero',
    'Asesor Comercial'
  ];

  constructor(
    public sucursalesService:SucursalesService, 
    public _authenService : AuthenService,
    public userService:UserService) { }

  ngOnInit() {
    this.cargarUsuarioLogueado();
    this.traerSucursales()
    this.traerUsuarios()
    
  }

  mostrarPopupCodigo(){
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
      if(this.usuarioLogueado.codigo == result.value)
          this.mostrarBloqueo = false;
        else  {
          Swal.fire({
            title: 'Error',
            text: 'El código ingresado no es el correcto',
            icon: 'error',
            confirmButtonText: 'Ok'
          }).then((result) => {
            this.mostrarPopupCodigo();
          })
        }
    })
  }


  cargarUsuarioLogueado() {
    var correo = "";
    const promesaUser = new Promise((res, err) => {
      if (localStorage.getItem("maily") != '') 
        correo = localStorage.getItem("maily");

      this._authenService.getUserLogueado(correo).subscribe(
          res => {
            var usuario = res as user;
            this.usuarioLogueado = usuario[0];
            this.mostrarPopupCodigo();
          }
        )
    });
  }

  traerSucursales(){
    this.sucursalesService.getSucursales().subscribe(res => {
      this.locales = res as Sucursal[];
   })
  }

  traerUsuarios() {
    this.mensajeLoading = 'Cargando usuarios...';
    this.mostrarLoading = true;
    this.userService.getUsers().subscribe(res => {
      this.usuarios = res as user[];
      this.mostrarLoading = false;
    }, () => {
      this.mostrarLoading = false;
      Swal.fire('Error', 'No se pudieron cargar los usuarios', 'error');
    });
  }

  nuevoUsuario() {
    return {
      _id: '',
      name: '',
      password: '',
      email: '',
      rol: 'Usuario',
      sucursal: 'matriz',
      username: '',
      status: 'Activo',
      codigoFacturacion: '',
      codigoAccesoPago: '',
    };
  }

  get esRolUsuario(): boolean {
    return this.usuario?.rol === 'Usuario';
  }

  abrirNuevo() {
    this.esEdicion = false;
    this.usuario = this.nuevoUsuario();
    this.localAsignado = '';
    this.puedeAccederPagos = false;
    this.popupVisible = true;
  }

  abrirEdicion(registro: user) {
    this.esEdicion = true;
    this.usuario = {
      ...this.nuevoUsuario(),
      _id: registro._id || '',
      name: registro.name || '',
      password: registro.password || '',
      email: registro.email || '',
      rol: (registro.rol as string) || 'Usuario',
      sucursal: (registro.sucursal as string) || '',
      username: registro.username || '',
      status: registro.status || 'Activo',
      codigoFacturacion: registro.codigoFacturacion || '',
      codigoAccesoPago: registro.codigoAccesoPago || '',
    };
    this.localAsignado = (registro.sucursal as string) || '';
    this.puedeAccederPagos = this.usuario.rol === 'Usuario' && !!this.usuario.codigoAccesoPago;
    this.popupVisible = true;
  }

  cerrarPopup() {
    this.popupVisible = false;
    this.esEdicion = false;
    this.puedeAccederPagos = false;
    this.usuario = this.nuevoUsuario();
    this.localAsignado = '';
  }

  onRolChanged() {
    if (!this.esRolUsuario) {
      this.puedeAccederPagos = false;
      this.usuario.codigoAccesoPago = '';
    }
  }

  onCodigoAccesoPagoChanged(e: any) {
    const valor = String(e?.value || '').replace(/\D/g, '').slice(0, 10);
    if (valor !== this.usuario.codigoAccesoPago) {
      this.usuario.codigoAccesoPago = valor;
    }
  }

  guardarUsuario() {
    if (!this.usuario.name?.trim() || !this.usuario.email?.trim() || !this.usuario.codigoFacturacion?.trim()) {
      Swal.fire('Validación', 'Hay campos vacíos. Revise e intente nuevamente', 'warning');
      return;
    }

    if (!this.esEdicion && (!this.usuario.username?.trim() || !this.usuario.password)) {
      Swal.fire('Validación', 'El usuario y la contraseña son obligatorios', 'warning');
      return;
    }

    if (this.esRolUsuario && this.puedeAccederPagos) {
      const codigoPago = String(this.usuario.codigoAccesoPago || '').trim();
      if (!/^\d{5,10}$/.test(codigoPago)) {
        Swal.fire('Validación', 'El código de acceso a Pagos debe tener entre 5 y 10 dígitos', 'warning');
        return;
      }
      this.usuario.codigoAccesoPago = codigoPago;
    } else {
      this.usuario.codigoAccesoPago = '';
    }

    this.usuario.name = this.usuario.name.trim();
    this.usuario.email = this.usuario.email.trim();
    this.usuario.username = this.usuario.username?.trim() || this.usuario.username;
    this.usuario.codigoFacturacion = this.usuario.codigoFacturacion.trim();
    this.usuario.sucursal = this.localAsignado;

    this.mensajeLoading = 'Guardando...';
    this.mostrarLoading = true;

    const peticion = this.esEdicion
      ? this.userService.updateUsuario(this.usuario)
      : this.userService.newUser(this.usuario);

    peticion.subscribe(
      () => {
        this.mostrarLoading = false;
        Swal.fire('Éxito', this.esEdicion ? 'Usuario actualizado' : 'Usuario creado', 'success');
        this.cerrarPopup();
        this.traerUsuarios();
      },
      (err) => {
        this.mostrarLoading = false;
        Swal.fire('Error', err?.error || 'No se pudo guardar el usuario. Revise e intente nuevamente', 'error');
      }
    );
  }

  eliminarUsuario(registro: user) {
    Swal.fire({
      title: '¿Eliminar usuario?',
      text: registro.username,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.value) {
        this.mensajeLoading = 'Eliminando...';
        this.mostrarLoading = true;
        this.userService.deleteUsuario(registro).subscribe(
          () => {
            this.mostrarLoading = false;
            Swal.fire('Eliminado', 'Usuario eliminado', 'success');
            this.traerUsuarios();
          },
          () => {
            this.mostrarLoading = false;
            Swal.fire('Error', 'No se pudo eliminar el usuario', 'error');
          }
        );
      }
    });
  }

  onExporting(e: any) {
    e.component.beginUpdate();
    e.component.columnOption('_id', 'visible', true);
  }

  onExported(e: any) {
    e.component.columnOption('_id', 'visible', false);
    e.component.endUpdate();
  }

}
