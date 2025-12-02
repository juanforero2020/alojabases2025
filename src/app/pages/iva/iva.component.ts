import { Component, OnInit } from '@angular/core';
import Swal from 'sweetalert2';
import { user } from '../user/user';
import { AuthenService } from 'src/app/servicios/authen.service';
import { ParametrizacionesService } from 'src/app/servicios/parametrizaciones.service';
import ArrayStore from 'devextreme/data/array_store';
import { producto } from '../ventas/venta';
import { ProductoService } from 'src/app/servicios/producto.service';
import DataSource from 'devextreme/data/data_source';


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
  valorExcepcion:string=""
  productos: producto[] = [];
  productosAModificar: producto[] = [];
  productosConExcepciones: producto[] = [];
  mostrarLoading: boolean = false;
  simpleProducts: string[];
  selectedValues: any[] = [];
  mensajeLoading = "Cargando..."

  constructor(
    public _authenService : AuthenService,
    public parametrizacionService: ParametrizacionesService,
    public productoService: ProductoService
  ) { 
  }

  ngOnInit() {
    this.cargarUsuarioLogueado();
    this.obtenerParametrizaciones("iva");
    this.obtenerExcepcionesIva();
    this.traerProductosUnitarios();
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

  traerProductosUnitarios() {
    this.mostrarLoading = true;
    this.productos = [];
    this.productoService.getProductosActivos().subscribe((res) => {
      this.productos = res as producto[];
      this.mostrarLoading = false;
      this.simpleProducts = this.productos
        .map(p => p.PRODUCTO)
        .sort((a, b) => a.localeCompare(b)); // Ordenar alfabéticamente de menor a mayor
        console.log(this.simpleProducts);
      this.productosConExcepciones = this.productos.filter(x=> x.ivaExcepcion != null);
    });
  }

  registrarExcepciones(){
    // Imprime en consola los valores seleccionados del dx-tag-box simpleProducts
    console.log("Valores seleccionados en excepcion:", this.selectedValues);
    this.productosAModificar = this.productos.filter(p => this.selectedValues.includes(p.PRODUCTO));
    console.log(this.productosAModificar[0].ivaExcepcion)

    // Llamadas concurrentes a updateValorIVA, muestra mensaje solo cuando todas terminan
    const updates = this.productosAModificar.map(producto => {
      producto.ivaExcepcion = parseInt(this.valorExcepcion);
      return this.productoService.updateValorIVA(producto).toPromise();
    });

    Promise.all(updates)
      .then(() => {
        Swal.fire({
          title: "Correcto",
          text: 'Se actualizó el IVA de los productos seleccionados correctamente',
          icon: 'success',
          confirmButtonText: 'Ok'
        }).then((result) => {
          this.traerProductosUnitarios();
        });
      })
      .catch(() => {
        Swal.fire({
          title: "Error",
          text: 'Revise e intente nuevamente',
          icon: 'error'
        });
      });
  }

  eliminarValorExcepcion(producto: producto){
    console.log("el producto a eliminar es", producto);
    producto.ivaExcepcion = null;
    this.productoService.updateValorIVA(producto).subscribe(res => {
      Swal.fire({
        title: "Correcto",
        text: 'Se eliminó el IVA excepción del producto correctamente',
        icon: 'success',
        confirmButtonText: 'Ok'
      }).then(() => {
        this.traerProductosUnitarios();
      });
    });
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
