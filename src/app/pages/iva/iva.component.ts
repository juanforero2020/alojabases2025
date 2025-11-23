import { Component, OnInit } from '@angular/core';
import Swal from 'sweetalert2';
import { user } from '../user/user';
import { AuthenService } from 'src/app/servicios/authen.service';
import { ParametrizacionesService } from 'src/app/servicios/parametrizaciones.service';
import ArrayStore from 'devextreme/data/array_store';


@Component({
  selector: 'app-iva',
  templateUrl: './iva.component.html',
  styleUrls: ['./iva.component.scss']
})
export class IvaComponent implements OnInit {

  excepciones = [];
  excepcionesParseadas = new ArrayStore;
  products = ["test1", "test2"];
  usuarioLogueado : user
  mostrarBloqueo = true;
  varDis:boolean=true;
  iva = 0;

  constructor(
    public _authenService : AuthenService,
    public parametrizacionService: ParametrizacionesService
  ) { 
  }

  ngOnInit() {
    this.cargarUsuarioLogueado();
    this.obtenerParametrizaciones("iva");
    this.obtenerExcepcionesIva();
  }

  obtenerExcepcionesIva() {
    this.excepciones.push({
      groupId: 1,
      productId: 1,
      productName: "test1",
      iva: 12,
      veronicaCode: 5,
    })
  }

  obtenerParametrizaciones(nombre: string){
    this.parametrizacionService.getParametrizacionPorNombre(nombre).subscribe(res => {
      this.iva = res["value"] as number;
   })
  }

  guardarIva(){
    this.parametrizacionService.updateParametrizacionPorNombre("iva", this.iva).subscribe(res => {
      this.varDis = true;
      Swal.fire('Actualizacion exitosa');
   })
  }


  cargarUsuarioLogueado() {
    var correo = "";
    new Promise((res, err) => {
      if (localStorage.getItem("maily") != '') 
        correo =  localStorage.getItem("maily");
      this._authenService.getUserLogueado(correo)
        .subscribe(
          res => {
            var usuario = res as user;
            this.usuarioLogueado = usuario[0]
            this.mostrarPopupCodigo();
          }
        )
    });
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
      if(this.usuarioLogueado.codigo == result.value){
        this.mostrarBloqueo = false;       
      }else{
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

  desbloquear(){
    if(this.varDis){
      this.varDis=false
    }else{
      this.varDis=true
    }
  }

}
