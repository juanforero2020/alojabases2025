import { Component, OnInit, OnDestroy } from "@angular/core";
import { Subject, of } from "rxjs";
import { forkJoin } from "rxjs";
import { catchError, switchMap, retry, take, takeUntil } from "rxjs/operators";

import {
  devolucion,
  productosDevueltos,
  tipoDocEliminacion,
} from "./devoluciones";
import pdfMake from "pdfmake/build/pdfmake";
import {
  factura,
  producto,
  contadoresDocumentos,
  productosPendientesEntrega,
  venta
} from "../ventas/venta";
import Swal from "sweetalert2";
import { objDate, tipoBusquedaTransaccion, transaccion } from "../transacciones/transacciones";
import { OrdenDeCompra, Sucursal } from "../compras/compra";
import { parametrizacionsuc } from "../parametrizacion/parametrizacion";
import { ParametrizacionesService } from "src/app/servicios/parametrizaciones.service";
import { SucursalesService } from "src/app/servicios/sucursales.service";
import { ProductoService } from "src/app/servicios/producto.service";
import { OrdenesCompraService } from "src/app/servicios/ordenes-compra.service";
import { FacturasService } from "src/app/servicios/facturas.service";
import { NotasVentasService } from "src/app/servicios/notas-ventas.service";
import { ContadoresDocumentosService } from "src/app/servicios/contadores-documentos.service";
import { DevolucionesService } from "src/app/servicios/devoluciones.service";
import { TransaccionesService } from "src/app/servicios/transacciones.service";
import { user } from "../user/user";
import { AuthenService } from "src/app/servicios/authen.service";
import DataSource from "devextreme/data/data_source";
import { ProductosPendientesService } from "src/app/servicios/productos-pendientes.service";
import { TransaccionesFinancieras } from "../transaccionesFinancieras/transaccionesFinancieras";
import { TransaccionesFinancierasService } from "src/app/servicios/transaccionesFinancieras.service";
import { DatosConfiguracionService } from "src/app/servicios/datosConfiguracion.service";
import { dataDocumento } from "../reciboCaja/recibo-caja";
import { CajaMenor } from "../cajaMenor/caja-menor";
import { CajaMenorService } from "src/app/servicios/cajaMenor.service";
import { AuthService } from "src/app/shared/services";
import { ProductoCombo, productosCombo } from "../catalogo/catalogo";
import { CombosService } from "src/app/servicios/combos.service";
import { EntregasBodegaService } from "src/app/servicios/entregas-bodega.service";

@Component({
  selector: "app-devoluciones",
  templateUrl: "./devoluciones.component.html",
  styleUrls: ["./devoluciones.component.scss"],
})
export class DevolucionesComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  /** Tras aprobar: mensaje secundario (trazabilidad bodega) mostrado después del Swal de éxito. */
  private avisoTrazabilidadBodega: {
    icon: "warning" | "info";
    title: string;
    html: string;
  } | null = null;
  idDocumento: number;
  cliente: string;
  usuario: string = "";
  observaciones: string = "";
  sucursal: string;
  locales: Sucursal[] = [];
  fecha: Date = new Date();
  fecha_transaccion: string;
  contap2: number = 0;
  id_devolucion: number;
  facturas: factura[] = [];
  productosFactura: producto[] = [];
  devoluciones: devolucion[] = [];
  listadoDevoluciones: devolucion[] = [];
  devolucionesGlobales: devolucion[] = [];
  devolucionesPendientes: devolucion[] = [];
  devolucionesAprobadas: devolucion[] = [];
  devolucionesRechazadas: devolucion[] = [];
  devolucionesAnuladas: devolucion[] = [];
  transaccionesFinancieras: TransaccionesFinancieras [] = []
  devolucioLeida: devolucion;
  productos: producto[] = [];
  facturaTraida: factura;
  usuarioLogueado: user;
  mostrarLoading: boolean = false;
  mostrarLoadingFactura: boolean = false;
  notas_venta: factura[] = [];
  datosDocumento: dataDocumento[] = []
  menuDocumento: string[] = ["Factura", "Nota de Venta"];
  textoDatosFactura=""
  arrayFacturas: factura[] = [];
  busquedaTransaccion: tipoBusquedaTransaccion; 

  menuMotivo: string[] = [
    "Caducidad",
    "Cambio",
    "Daño",
    "Defectos fábrica",
    "Otros",
  ];
  menuTipoDevolucion = [
    { id: "FISICA", label: "Dev. Física" },
    { id: "VIRTUAL", label: "Dev. Virtual" },
  ];
  menu1: string[] = ["Devoluciones", "Listado Devoluciones"];


  sucursalesDefault: string[] = ["matriz", "sucursal1", "sucursal2"];

  menuPrincipalRoles: string[];
  valorMenu = ""

  imagenLogotipo ="";

  variablesucursal: string = "Milagro";
  total: number = 0;
  devolucion: devolucion;
  varProducto: string;
  numeroFactura: string;
  number_transaccion: number = 0;
  transaccion: transaccion;
  botonGuardarDeshabilitado: boolean = false;
  productosDevueltos: productosDevueltos[] = [];
  productosDevueltosBase: productosDevueltos[] = [];
  productosDevueltosCarga: productosDevueltos[] = [];
  ordenesCompra: OrdenDeCompra[] = [];
  productosVendidos: venta[] = [];
  productosVendidos2: venta[] = [];
  parametrizaciones: parametrizacionsuc[] = [];
  parametrizacionSucu: parametrizacionsuc;
  contadores: contadoresDocumentos[] = [];
  contadorFirebase: contadoresDocumentos[] = [];
  productosPendientes: productosPendientesEntrega[] = [];
  correo: string = "";
  productos22: DataSource;
  isUsuario = false;
  mensajeLoading = "Cargando.."

  obj: objDate;
  mostrarNewDevolucion = true;
  mostrarListado = false;
  nowdesde: Date = new Date();
  nowhasta: Date = new Date();
  estados: string[] = [
      'Pendientes',
      'Aprobadas',
      'Anuladas',
      'Rechazadas',
  ];
  mostrarAprobacion = false;
  mostrarAnulacion = false;
  listadoProductosCombo : productosCombo[];
  ordenEntregaDocumento: any = null;


  constructor(
    public parametrizacionService: ParametrizacionesService,
    public authenService: AuthenService,
    public transaccionesService: TransaccionesService,
    public devolucionesService: DevolucionesService,
    public contadoresService: ContadoresDocumentosService,
    public notasVentaService: NotasVentasService,
    public facturasService: FacturasService,
    public productosPendientesService: ProductosPendientesService,
    public ordenesService: OrdenesCompraService,
    public sucursalesService: SucursalesService,
    public _transaccionFinancieraService : TransaccionesFinancierasService,
    public productoService: ProductoService,
    public authService: AuthService,
    public _comboService : CombosService,
    public _cajaMenorService : CajaMenorService,
    public _configuracionService : DatosConfiguracionService,
    private entregasBodegaService: EntregasBodegaService
  ) {
    this.devolucion = new devolucion();
    this.productosDevueltos.push(new productosDevueltos());
    this.menuPrincipalRoles = this.menu1;
  }

  ngOnInit() {
    var obj2 = new objDate();
    obj2.fechaActual = new Date();
    obj2.fechaAnterior = new Date(this.nowdesde.getFullYear(), this.nowdesde.getMonth(), this.nowdesde.getDate() - 30);
    this.nowdesde.setDate(this.nowdesde.getDate() - 15);
    forkJoin({
      contadores: this.contadoresService.getContadores(),
      productos: this.productoService.getProducto(),
      //ordenes: this.ordenesService.getOrden(),
      parametrizaciones: this.parametrizacionService.getParametrizacion(),
      pendientes: this.productosPendientesService.getProductosPendientesPorRango(obj2),
      sucursales: this.sucursalesService.getSucursales(),
      config: this._configuracionService.getDatosConfiguracion(),
    }).pipe(
      take(1),
      takeUntil(this.destroy$)
    ).subscribe({
      next: (res) => {
        this.contadores = res.contadores as contadoresDocumentos[];
        this.productos = res.productos as producto[];
        //this.ordenesCompra = res.ordenes as OrdenDeCompra[];
        this.parametrizaciones = res.parametrizaciones as parametrizacionsuc[];
        this.productosPendientes = res.pendientes as productosPendientesEntrega[];
        this.locales = res.sucursales as Sucursal[];
        this.imagenLogotipo = (res.config as any)[0]?.urlImage ?? "";
        this.asignarIDdocumentos();
        this.cargarUsuarioLogueado();
      },
      error: () => {
        Swal.fire("Error", "Error al cargar datos iniciales", "error");
      },
    });
    this.getIDDocumentos();
    this.refrescarListado();
  }

  cargarUsuarioLogueado() {
    const mail = localStorage.getItem("maily");
    if (mail) this.correo = mail;
    this.authenService
      .getUserLogueado(this.correo)
      .pipe(take(1), takeUntil(this.destroy$))
      .subscribe(
        (res) => {
          this.usuarioLogueado = res as user;
          if (!this.usuarioLogueado?.[0]) return;
          const u = this.usuarioLogueado[0];
          this.devolucion.usuario = u.username;
          this.usuario = u.username;
          this.buscarSucursal(u.sucursal);
          this.separarRegistrosDevoluciones();
          this.isUsuario = u.rol === "Usuario";
          this.mostrarAprobacion = !this.isUsuario;
            
          

          if (u.status === "Inactivo") this.authService.logOut();

        },
        (err) => {}
      );
  }

  traerComprobantesPagoPorRango() {
    this.limpiarArrays();
    this.mostrarLoading = true;
    this.obj = new objDate();
    this.obj.fechaActual = this.nowhasta;
    this.obj.fechaAnterior = this.nowdesde;
    this.obj.fechaAnterior.setHours(0, 0, 0, 0);
    this.devolucionesService
      .getDevolucionesPorRango(this.obj)
      .pipe(take(1), takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.devoluciones = res as devolucion[];
          this.cargarDevoluciones();
        },
        error: () => {
          this.mostrarLoading = false;
        },
      });
  }

  limpiarArrays(){
    this.devoluciones = []
    this.listadoDevoluciones = []
    this.devolucionesPendientes = []
    this.devolucionesAprobadas = []
    this.devolucionesAnuladas = []
    this.devolucionesRechazadas = []
  }


  opcionRadio(e){
    this.listadoDevoluciones = [];
      switch (e.value) {
        case "Pendientes":
          this.listadoDevoluciones = this.devolucionesPendientes
          if(!this.isUsuario){
            this.mostrarAnulacion = false
            this.mostrarAprobacion = true
          }
          
          break;
        case "Aprobadas":
          this.listadoDevoluciones = this.devolucionesAprobadas
          if(!this.isUsuario){
            this.mostrarAnulacion = true
            this.mostrarAprobacion = false
          }
          break;
        case "Anuladas":
          this.listadoDevoluciones = this.devolucionesAnuladas
          if(!this.isUsuario){
            this.mostrarAnulacion = false
            this.mostrarAprobacion = false
          }
            
          break;
        case "Rechazadas":
          this.listadoDevoluciones = this.devolucionesRechazadas
          if(!this.isUsuario){
            this.mostrarAnulacion = false
            this.mostrarAprobacion = false
          }
          break;
        default:    
    }   
  }



  private asignarDatosCliente() {
    if (!this.facturaTraida) return;
    this.cliente = this.facturaTraida.cliente.cliente_nombre;
    this.fecha_transaccion = this.facturaTraida.fecha2;
    this.sucursal = this.facturaTraida.sucursal;
    this.devolucion.ruc = this.facturaTraida.cliente.ruc;
  }

  buscarSucursal(sucursal: string) {
    this.locales.forEach((element) => {
      if (element.nombre == sucursal) {
        this.devolucion.sucursal = element;
        this.sucursal = element.nombre;
      }
    });
  }

  traerSucursales() {
    this.sucursalesService.getSucursales().subscribe((res) => {
      this.locales = res as Sucursal[];
      this.cargarUsuarioLogueado();
    });
  }

  traerProductos() {
    this.productoService.getProducto().subscribe((res) => {
      this.productos = res as producto[];
    });
  }

  traerOrdenesCompra() {
    this.ordenesService.getOrden().subscribe((res) => {
      this.ordenesCompra = res as OrdenDeCompra[];
    });
  }

  traerFacturas() {
    this.facturasService.getFacturas().subscribe((res) => {
      this.facturas = res as factura[];
      this.mostrarLoadingFactura = false;
      console.log("traje facturas");
    });
  }

  traerNotasVenta() {
    this.notasVentaService.getNotasVentas().subscribe((res) => {
      this.notas_venta = res as factura[];
      this.mostrarLoading = false;
      console.log("traje notas ventas");
    });
  }

  traerDevoluciones() {
    this.limpiarArrays();
    this.mostrarLoading = true;
    this.devolucionesService
      .getDevoluciones()
      .pipe(take(1), takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.devoluciones = res as devolucion[];
          this.cargarDevoluciones();
        },
        error: () => {
          this.mostrarLoading = false;
        },
      });
  }


  separarRegistrosDevoluciones() {
    if (this.usuarioLogueado[0].rol != "Administrador") {
      switch (this.usuarioLogueado[0].sucursal) {
        case "matriz":
          this.devolucionesGlobales.forEach((element) => {
            if (element.sucursal.nombre == "matriz") {
              this.devoluciones.push(element);
            }
          });
          break;
        case "sucursal1":
          this.devolucionesGlobales.forEach((element) => {
            if (element.sucursal.nombre == "sucursal1") {
              this.devoluciones.push(element);
            }
          });
          break;
        case "sucursal2":
          this.devolucionesGlobales.forEach((element) => {
            if (element.sucursal.nombre == "sucursal2") {
              this.devoluciones.push(element);
            }
          });
          break;
        default:
          break;
      }
    } else {
      this.devoluciones = this.devolucionesGlobales;
    }
  }

  asignarIDdocumentos() {
    //this.number_transaccion=this.contadores[0].transacciones_Ndocumento+1
    this.id_devolucion = this.contadores[0].contDevoluciones_Ndocumento + 1;
  }

  getIDDocumentos() {
    this.contadoresService.getContadores().subscribe(res => {
      this.contadores = res as contadoresDocumentos[];
    });
  }

  asignarIDdocumentos2() {
    this.number_transaccion = this.contadores[0].transacciones_Ndocumento + 1;
    //this.id_devolucion=this.contadores[0].contDevoluciones_Ndocumento+1
  }

  validarProductosPendientes(e) {
    var bandera = true;
    this.productosPendientes.forEach((element) => {
      if ( element.documento == this.idDocumento &&  element.tipo_documento == e.value ) 
        bandera = false;
    });

    this.obtenerDocumento(e);

  }

  obtenerDocumento(e) {
    this.mostrarLoading = true;
    this.devolucion.tipo_documento = e.value;
    this.arrayFacturas = [];
    this.cliente = "";
    this.fecha_transaccion = "";
    this.sucursal = "";

    // Verificar que idDocumento no sea null ni undefined
    if (this.idDocumento !== null && this.idDocumento !== undefined) {
      const obs =
        e.value === "Factura"
          ? this.facturasService.getFacturasDocumento(this.idDocumento)
          : this.notasVentaService.getNotasVemtaDocumento(this.idDocumento);
      this.limpiarArreglo();
      obs.pipe(takeUntil(this.destroy$), retry(2)).subscribe({
        next: (res) => {
          this.arrayFacturas = res as factura[];
          this.llenarDatosCombo(this.arrayFacturas);
          this.mostrarLoading = false;
          this.cargarDevolucionesPorDocumento();
        },
        error: () => {
          this.mostrarLoading = false;
          Swal.fire("Error", "No se pudo cargar el documento", "error");
        },
      });
    } else {
      this.mostrarLoading = false;
      Swal.fire(
        "Advertencia",
        "Debe seleccionar un documento válido antes de continuar.",
        "warning"
      );
    }
  }

  private cargarDevolucionesPorDocumento() {
    if (this.idDocumento === null || this.idDocumento === undefined) {
      return;
    }

    const objDev = new objDate();
    objDev.fechaActual = new Date();
    objDev.fechaAnterior = new Date(2000, 0, 1);
    objDev.fechaAnterior.setHours(0, 0, 0, 0);

    console.log("this.idDocumento", this.idDocumento);
    console.log("this.devolucion.tipo_documento", this.devolucion.tipo_documento);

    this.devolucionesService
      .getDevolucionesPorRango(objDev)
      .pipe(take(1), takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const lista = res as devolucion[];
          // Usamos conversion explicita a string para evitar problemas de tipo
          this.devoluciones = lista.filter(
            (dev) =>
              String(dev.num_documento) === String(this.idDocumento) &&
              String(dev.tipo_documento) === String(this.devolucion.tipo_documento)
          );
        },
        error: () => {
          this.devoluciones = [];
        },
      });
  }

  
  llenarDatosCombo(array: factura[]) {
    this.datosDocumento = array.map((element) => {
      const object = new dataDocumento();
      object._id = element._id;
      object.nombreCliente = element.cliente.cliente_nombre;
      object.rucCliente = element.cliente.ruc;
      object.totalFactura = element.total.toString();
      object.valorInicialFactura = element.total.toString();
      object.tipo_documento = element.tipoDocumento;
      object.textoCombo = object.nombreCliente + " - " + object.rucCliente + " - " + object.totalFactura;
      object.fecha = element.fecha;
      object.fecha_deuda = element.fecha;
      object.sucursal = element.sucursal;
      return object;
    });
  }

  asignarDatos(e) {
    this.textoDatosFactura = e.value.textoCombo;
    this.facturaTraida = this.arrayFacturas.find((el) => el._id === e.value._id);
    this.productosVendidos2 = [...(this.facturaTraida?.productosVendidos ?? [])];
    const combos = this.productosVendidos2.filter((el) => el.producto?.CLASIFICA === "COMBO");
    if (combos.length === 0) {
      this.listadoProductosCombo = [];
      this.asignarDatosCliente();
      this.cargarOrdenEntregaDocumento();
      return;
    }
    this.mensajeLoading = "Cargando Productos..";
    this.mostrarLoading = true;
    const comboRequests = combos.map((element) => {
      const combo = new ProductoCombo();
      combo.PRODUCTO = element.producto.PRODUCTO;
      return this._comboService.getComboPorNombre(combo).pipe(take(1));
    });
    forkJoin(comboRequests)
      .pipe(takeUntil(this.destroy$), retry(2))
      .subscribe({
        next: (listados) => {
          const noCombo: venta[] = this.productosVendidos2.filter((el) => el.producto?.CLASIFICA !== "COMBO");
          const expandidos: venta[] = [];
          (listados as ProductoCombo[][]).forEach((listado, i) => {
            const element = combos[i];
            const listadoProductosCombo = listado[0]?.productosCombo ?? [];
            listadoProductosCombo.forEach((element2) => {
              const venta2 = new venta();
              venta2.cantidad = element.cantidad * element2.cantidad;
              venta2.producto = element2.producto;
              venta2.total = element2.precioVenta * element.cantidad;
              expandidos.push(venta2);
            });
          });
          const hash: Record<string, boolean> = {};
          this.productosVendidos2 = [...noCombo, ...expandidos].filter((o) =>
            hash[o.producto.PRODUCTO] ? false : (hash[o.producto.PRODUCTO] = true)
          );
          this.listadoProductosCombo = (listados as ProductoCombo[][]).reduce(
            (acc, l) => acc.concat((l[0] as ProductoCombo)?.productosCombo ?? []),
            [] as productosCombo[]
          );
          this.mostrarLoading = false;
          this.asignarDatosCliente();
          this.cargarOrdenEntregaDocumento();
        },
        error: () => {
          this.mostrarLoading = false;
          Swal.fire("Error", "Error al cargar combos", "error");
        },
      });
  }

  private cargarOrdenEntregaDocumento() {
    const tipoDocMap = {
      Factura: "FACTURA",
      "Nota de Venta": "NOTA_VENTA",
    };
    const tipoDoc = tipoDocMap[this.devolucion?.tipo_documento] || "";
    if (!this.idDocumento || !tipoDoc) {
      this.ordenEntregaDocumento = null;
      return;
    }
    const filtros = {
      documentoNumero: this.idDocumento,
      modoConsulta: "listado",
    };
    this.entregasBodegaService
      .getPendientes(filtros)
      .pipe(take(1), takeUntil(this.destroy$))
      .subscribe({
        next: (res: any) => {
          const lista = Array.isArray(res) ? res : [];
          this.ordenEntregaDocumento =
            lista.find(
              (o: any) =>
                String(o?.documentoNumero) === String(this.idDocumento) &&
                String(o?.tipoDocumento || "").toUpperCase() === tipoDoc
            ) || null;
        },
        error: () => {
          this.ordenEntregaDocumento = null;
        },
      });
  }

  verTrazabilidadProducto(index: number) {
    const linea = this.productosDevueltos[index];
    const codigo = String(linea?.producto?.PRODUCTO || linea?.REFERENCIA || "").trim();
    if (!codigo) {
      Swal.fire("Advertencia", "Seleccione primero el producto para ver trazabilidad.", "warning");
      return;
    }

    const itemOrden = (this.ordenEntregaDocumento?.items || []).find((it: any) => {
      const nombre = String(
        (it?.producto && it.producto.PRODUCTO) || it?.productoNombre || ""
      ).trim();
      return nombre === codigo;
    });

    let devVirtual = 0;
    let devFisica = 0;
    let entregada = 0;
    let pendiente = 0;

    if (itemOrden) {
      const historial = Array.isArray(itemOrden.historial) ? itemOrden.historial : [];
      historial.forEach((h: any) => {
        const estado = String(h?.estadoSeleccionado || "").toUpperCase();
        if (estado !== "DEVUELTO") return;
        const op = Number(h?.m2EntregadoEnEstaOperacion) || 0;
        if (op <= 0) return;
        const tipo = this.normalizarTipoDevolucion(h?.tipoDevolucion);
        if (tipo === "FISICA") devFisica += op;
        else devVirtual += op;
      });
      entregada = Number(itemOrden?.cantidadEntregada) || 0;
      const facturada = Number(itemOrden?.cantidadFacturada) || 0;
      const virtualAcumulada = Number(itemOrden?.cantidadDevuelta) || devVirtual;
      pendiente = Math.max(facturada - entregada - virtualAcumulada, 0);
    } else {
      const devolucionesValidas = (this.devoluciones || []).filter(
        (d) => String(d.estado) !== "Anulada" && String(d.estado) !== "Rechazado"
      );
      devolucionesValidas.forEach((dev) => {
        (dev.productosDevueltos || []).forEach((p: any) => {
          if (String(p?.producto?.PRODUCTO || "").trim() !== codigo) return;
          const unidades =
            (Number(p?.cantDevueltaCajas) || 0) * (Number(p?.producto?.P_CAJA) || 0) +
            (Number(p?.cantDevueltaPiezas) || 0);
          const tipo = this.normalizarTipoDevolucion(p?.tipoDevolucion);
          if (tipo === "FISICA") devFisica += unidades;
          else devVirtual += unidades;
        });
      });
      const facturadaFallback =
        (Number(linea?.cantFactCajas) || 0) * (Number(linea?.producto?.P_CAJA) || 0) +
        (Number(linea?.cantFactPiezas) || 0);
      pendiente = Math.max(facturadaFallback - devVirtual, 0);
    }

    Swal.fire({
      title: `Trazabilidad ${codigo}`,
      html: `
        <div style="text-align:left">
          <p><b>Devuelta física:</b> ${devFisica.toFixed(2)}</p>
          <p><b>Devuelta virtual:</b> ${devVirtual.toFixed(2)}</p>
          <p><b>Entregada:</b> ${entregada.toFixed(2)}</p>
          <p><b>Pendiente:</b> ${pendiente.toFixed(2)}</p>
        </div>
      `,
      icon: "info",
      confirmButtonText: "Cerrar",
    });
  }


  obtenerDetalleProductosFact() {
    this.limpiarArreglo();
    this.productosVendidos.forEach((element) => {
      if (element.factura_id == this.idDocumento && element.tipoDocumentoVenta == "Factura") 
        this.productosVendidos2.push(element);

    });
  }

  cargarDevoluciones() {
    this.devolucionesPendientes = this.devoluciones.filter((el) => el.estado === "Pendiente");
    this.devolucionesAprobadas = this.devoluciones.filter((el) => el.estado === "Aprobado");
    this.devolucionesRechazadas = this.devoluciones.filter((el) => el.estado === "Rechazado");
    this.devolucionesAnuladas = this.devoluciones.filter((el) => el.estado === "Anulada");
    this.listadoDevoluciones = this.devolucionesPendientes;
    this.mostrarLoading = false;
  }

  obtenerDetalleProductosNot() {
    this.limpiarArreglo();
    this.productosVendidos.forEach((element) => {
      if (element.factura_id == this.idDocumento &&element.tipoDocumentoVenta == "Nota de Venta" ) {
        this.productosVendidos2.push(element);
      }
    });
  }

  limpiarArreglo() {
    this.productosVendidos2.length = 0;
  }

  obtenerDetallesDoc(e, i: number) {
    const existeP = this.productosDevueltos.filter(
      (element) => element.REFERENCIA == this.productosDevueltos[i].REFERENCIA
    );
    if (existeP.length > 1) {
      Swal.fire("Error", "El producto ya existe en esta devolución", "error");
      this.deleteProducto(e, i);
      return;
    }

    this.productosVendidos2.forEach((element) => {
      if (element.producto.PRODUCTO == e.value) {
        this.productosDevueltos[i].producto = element.producto;
        this.productosDevueltos[i].cantFactCajas = Math.trunc(
          element.cantidad / element.producto.M2
        );
        this.productosDevueltos[i].cantFactPiezas =
          Math.trunc((element.cantidad * element.producto.P_CAJA) / element.producto.M2) -
          this.productosDevueltos[i].cantFactCajas * element.producto.P_CAJA;

        this.productosDevueltos[i].valorunitariopiezas =
          element.total /
            (element.producto.P_CAJA *
              this.productosDevueltos[i].cantFactCajas +
              this.productosDevueltos[i].cantFactPiezas) -
          (element.total /
            (element.producto.P_CAJA *
              this.productosDevueltos[i].cantFactCajas +
              this.productosDevueltos[i].cantFactPiezas)) *
            (element.descuento / 100);
        this.productosDevueltos[i].valorunitario =
          ((element.producto.P_CAJA * this.productosDevueltos[i].cantFactCajas +
            this.productosDevueltos[i].cantFactPiezas) /
            element.cantidad) *
          this.productosDevueltos[i].valorunitariopiezas;
      }
    });
  }

  private getUnidadesDevueltasHistoricas(codigoProducto: string): number {
    if (!this.idDocumento || !codigoProducto || !this.devoluciones?.length) {
      return 0;
    }

    let total = 0;
    this.devoluciones.forEach((dev) => {
      if (
        String(dev.num_documento) === String(this.idDocumento) &&
        String(dev.tipo_documento) === String(this.devolucion.tipo_documento) &&
        String(dev.estado) !== "Anulada" && String(dev.estado) !== "Rechazado" &&
        dev.productosDevueltos?.length
      ) {
        dev.productosDevueltos.forEach((p) => {
          if (p.producto && p.producto.PRODUCTO === codigoProducto && p.producto.P_CAJA) {
            const unidades =
              (p.cantDevueltaCajas || 0) * p.producto.P_CAJA + (p.cantDevueltaPiezas || 0);
            total += unidades;
          }
        });
      }
    });
    return total;
  }

  private getUnidadesDevueltasHistoricasPorTipo(codigoProducto: string): {
    virtual: number;
    fisica: number;
    total: number;
  } {
    const out = { virtual: 0, fisica: 0, total: 0 };
    if (!this.idDocumento || !codigoProducto || !this.devoluciones?.length) {
      return out;
    }
    this.devoluciones.forEach((dev) => {
      if (
        String(dev.num_documento) === String(this.idDocumento) &&
        String(dev.tipo_documento) === String(this.devolucion.tipo_documento) &&
        String(dev.estado) !== "Anulada" &&
        String(dev.estado) !== "Rechazado" &&
        dev.productosDevueltos?.length
      ) {
        dev.productosDevueltos.forEach((p) => {
          if (p.producto && p.producto.PRODUCTO === codigoProducto && p.producto.P_CAJA) {
            const unidades =
              (p.cantDevueltaCajas || 0) * p.producto.P_CAJA + (p.cantDevueltaPiezas || 0);
            const tipo = this.normalizarTipoDevolucion((p as any)?.tipoDevolucion);
            if (tipo === "FISICA") out.fisica += unidades;
            else out.virtual += unidades;
            out.total += unidades;
          }
        });
      }
    });
    return out;
  }

  private getUnidadesEntregadasOrden(codigoProducto: string): number {
    const itemOrden = (this.ordenEntregaDocumento?.items || []).find((it: any) => {
      const nombre = String((it?.producto && it.producto.PRODUCTO) || it?.productoNombre || "").trim();
      return nombre === codigoProducto;
    });
    if (itemOrden) {
      const entregada = Number(itemOrden?.cantidadEntregada) || 0;
      const pCaja = Number(itemOrden?.piezasPorCaja ?? itemOrden?.producto?.P_CAJA) || 0;
      const m2Caja = Number(itemOrden?.m2PorCaja ?? itemOrden?.producto?.M2) || 0;
      const unidad = String(itemOrden?.producto?.UNIDAD || "");

      // Solo convertir m2 -> piezas cuando el item realmente maneja Metros + M2 + P_CAJA.
      if (unidad === "Metros" && pCaja > 0 && m2Caja > 0) {
        const cajas = Math.trunc((entregada + 0.01) / m2Caja);
        const piezas = Math.trunc(((entregada + 0.01) * pCaja) / m2Caja) - cajas * pCaja;
        return cajas * pCaja + piezas;
      }
      return entregada;
    }
    return 0;
  }

  deleteProducto(e, i: number) {
    if (this.productosDevueltos.length > 1) {
      this.productosDevueltos.splice(i, 1);
    } else {
      Swal.fire("Alerta", "Debe tener al menos un producto", "warning");
    }
    this.calcularTotal();
  }

  transformarM2(e, i: number) {
    this.productosVendidos2.forEach((element) => {
      if (this.productosDevueltos[i].producto.PRODUCTO == element.producto.PRODUCTO) {
        this.productosDevueltos[i].cantDevueltam2 = parseInt(
          (
            element.producto.M2 * this.productosDevueltos[i].cantDevueltaCajas +
            (this.productosDevueltos[i].cantDevueltaPiezas *
              element.producto.M2) /
              element.producto.P_CAJA
          ).toFixed(0)
        );
        this.productosDevueltos[i].cantDevueltam2Flo = parseFloat(
          (
            element.producto.M2 * this.productosDevueltos[i].cantDevueltaCajas +
            (this.productosDevueltos[i].cantDevueltaPiezas *
              element.producto.M2) /
              element.producto.P_CAJA
          ).toFixed(2)
        );

        let cal1 = 0;
        let cal2 = 0;
        const prodEncontrado = this.listadoProductosCombo?.find(
          (element2) => element2.nombreProducto == element.producto.PRODUCTO
        );

        // Cantidad que se está intentando devolver en esta línea (en unidades)
        cal1 =
          this.productosDevueltos[i].cantDevueltaCajas * element.producto.P_CAJA +
          this.productosDevueltos[i].cantDevueltaPiezas;

        // Cantidad total comprada (en unidades) según factura / combo
        if (prodEncontrado != null)
          cal2 =
            this.productosDevueltos[i].cantFactCajas * element.producto.P_CAJA * prodEncontrado.cantidad +
            this.productosDevueltos[i].cantFactPiezas;
        else
          cal2 =
            this.productosDevueltos[i].cantFactCajas * element.producto.P_CAJA +
            this.productosDevueltos[i].cantFactPiezas;

        // Restar lo que ya se devolvió en otras devoluciones del mismo documento (tope global)
        const hist = this.getUnidadesDevueltasHistoricasPorTipo(element.producto.PRODUCTO);
        const disponibleGlobal = Math.max(cal2 - hist.total, 0);
        const tipoActual = this.normalizarTipoDevolucion(
          this.productosDevueltos[i]?.tipoDevolucion
        );
        let mensajeRegla = "";
        let invalido = false;

        if (cal1 > disponibleGlobal) {
          mensajeRegla =
            "La cantidad supera lo disponible para devolver considerando devoluciones anteriores.";
          invalido = true;
        } else if (tipoActual === "FISICA") {
          // Regla 1: devolución física acumulada no puede superar la entregada.
          const entregadaUnidades = this.getUnidadesEntregadasOrden(element.producto.PRODUCTO);
          const fisicaAcumulada = hist.fisica + cal1;
          console.log("fisicaAcumulada", fisicaAcumulada, "entregadaUnidades", entregadaUnidades);
          if (fisicaAcumulada > entregadaUnidades) {
            mensajeRegla =
              "La devolución física no puede superar la cantidad entregada del producto.";
            invalido = true;
          }
        } else {
          // Regla 2: entregada + virtual acumulada no debe superar facturada.
          const entregadaUnidades = this.getUnidadesEntregadasOrden(element.producto.PRODUCTO);
          const virtualAcumulada = hist.virtual + cal1;
          console.log("entregadaUnidades", entregadaUnidades, "virtualAcumulada", virtualAcumulada, "cal2", cal2);
          console.log("entregadaUnidades + virtualAcumulada > cal2", entregadaUnidades + virtualAcumulada > cal2);
          if (entregadaUnidades + virtualAcumulada > cal2) {
            mensajeRegla =
              "La devolución virtual sumada con lo entregado no puede superar la cantidad facturada.";
            invalido = true;
          }
        }

        if (invalido) {
          Swal.fire(
            "Advertencia",
            mensajeRegla,
            "warning"
          );
          this.productosDevueltos[i].cantDevueltaCajas = 0;
          this.productosDevueltos[i].cantDevueltaPiezas = 0;
          this.botonGuardarDeshabilitado = true;
        } else {
          this.botonGuardarDeshabilitado = false;
        }
      }
    });
    this.calcularValores2(e, i);
  }

  calcularValores(e, i: number) {
    this.productosVendidos2.forEach((element) => {
      if(this.productosDevueltos[i].producto.PRODUCTO == element.producto.PRODUCTO) {
        var cal1 = 0;
        cal1 = element.precio_venta * this.productosDevueltos[i].cantDevueltam2Flo;
        this.productosDevueltos[i].total = cal1 - cal1 * (element.descuento / 100);
      }
    });
    this.calcularTotal();
  }

  calcularValores2(e, i: number) {
    this.productosVendidos2.forEach((element) => {
      if ( this.productosDevueltos[i].producto.PRODUCTO == element.producto.PRODUCTO) {
        var cal1 = 0;
        cal1 =  this.productosDevueltos[i].cantDevueltaCajas * element.producto.P_CAJA + this.productosDevueltos[i].cantDevueltaPiezas;
        this.productosDevueltos[i].total = cal1 * this.productosDevueltos[i].valorunitariopiezas;
      }
    });
    this.calcularTotal();
  }

  calcularTotal() {
    this.total = 0;
    this.productosDevueltos.forEach((element) => {this.total = parseFloat((element.total + this.total).toFixed(2));
    });
  }


  validarEstadoCaja() {
    this.devolucion.fecha = this.fecha;
    this.devolucion.fecha.setHours(0, 0, 0, 0);
    this._cajaMenorService
      .getCajaMenorPorFecha(this.devolucion)
      .pipe(take(1), takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const listaCaja = (res as CajaMenor[]) || [];
          const caja = listaCaja.find((el) => el.sucursal === this.devolucion.sucursal?.nombre);
          if (caja?.estado === "Cerrada") {
            Swal.fire(
              "Atención",
              "No puede generar registros para la fecha establecida, la caja menor se encuentra cerrada",
              "error"
            );
          } else {
            this.guardarDevolucion();
          }
        },
        error: () => this.guardarDevolucion(),
      });
  }


  guardarDevolucion() {
    this.devolucion.cliente = this.cliente;
    this.devolucion.fecha = this.fecha;
    this.devolucion.fecha_transaccion = this.fecha_transaccion;
    this.devolucion.observaciones = this.observaciones;
    this.devolucion.usuario = this.usuario;
    this.devolucion.id_devolucion = this.id_devolucion;
    this.devolucion.totalDevolucion = this.total;
    this.devolucion.num_documento = this.idDocumento;
    this.devolucion.productosDevueltos = this.productosDevueltos.map((p) => ({
      ...p,
      tipoDevolucion: this.normalizarTipoDevolucion(p?.tipoDevolucion),
    }));

    if (
      this.devolucion.cliente == null ||
      this.devolucion.cliente === "" ||
      this.devolucion.fecha == null ||
      this.devolucion.sucursal == null ||
      this.devolucion.fecha_transaccion == null
    ) {
      Swal.fire({ title: "Error", text: "Hay campos vacíos", icon: "error" });
      return;
    }

    const text = (this.facturaTraida.observaciones || "") + "/ Documento Devolucion " + this.id_devolucion;
    this.facturaTraida.observaciones = text;
    const updateDoc$ =
      this.devolucion.tipo_documento === "Factura"
        ? this.facturasService.updateFacturas(this.facturaTraida)
        : this.notasVentaService.updateNotasVenta(this.facturaTraida);

    this.mostrarMensaje();
    this.devolucionesService
      .newDevolucion(this.devolucion)
      .pipe(
        retry(2),
        takeUntil(this.destroy$),
        switchMap(() => {
          this.contadores[0].contDevoluciones_Ndocumento = this.id_devolucion;
          return this.contadoresService.updateContadoresDevoluciones(this.contadores[0]).pipe(retry(2));
        }),
        switchMap(() => updateDoc$.pipe(retry(2)))
      )
      .subscribe({
        next: () => this.confirmarDevolucion(),
        error: () => {
          Swal.fire("Error", "No se pudo guardar la devolución. Revise la conexión e intente de nuevo.", "error");
        },
      });
  }

  asignarsucursalD(e) {
    this.variablesucursal = e.value;
    this.locales.forEach((element) => {
      if (element.nombre == this.variablesucursal) {
        this.devolucion.sucursal = element;
      }
    });
  }

  getCourseFile = (e) => {
    this.cargarDatosDevolucion(e.row.data);
  };

  getCourseFile2 = (e) => {
    this.aceptarDevolucion(e.row.data);
  };
  getCourseFile3 = (e) => {
    this.rechazarDevolucion(e.row.data);
  };

  aprobarAnulacion = (e) => {
    this.anularDevolucion(e.row.data);
  };

  rechazarDevolucion(e: any) {
    Swal.fire({
      title: "Rechazar Devolución",
      text: "Desea rechazar la devolución #" + e.id_devolucion,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Si",
      cancelButtonText: "No",
    }).then((result) => {
      if (result.value) {
        this.devolucionesService
          .updateEstado(e, "Rechazado")
          .pipe(take(1), retry(2), takeUntil(this.destroy$))
          .subscribe({
            next: () => {
              Swal.fire({
                title: "Correcto",
                text: "Se guardó con éxito",
                icon: "success",
                confirmButtonText: "Ok",
              }).then(() => this.refrescarListado());
            },
            error: () => Swal.fire("Error", "No se pudo rechazar la devolución", "error"),
          });
      } else if (result.dismiss === Swal.DismissReason.cancel) {
        Swal.fire("Cancelado!", "Se ha cancelado su proceso.", "error");
      }
    });
  }

  anularDevolucion(e: any) {
    Swal.fire({
      title: "Anular Devolución",
      text: "Desea anular la devolución #" + e.id_devolucion,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Si",
      cancelButtonText: "No",
    }).then((result) => {
      if (result.value) {
        this.mostrarMensaje();
        this.devolucionesService
          .updateEstado(e, "Anulada")
          .pipe(
            take(1),
            retry(2),
            switchMap(() =>
              this.entregasBodegaService.revertirDevolucionAprobada({
                documentoNumero: Number(e?.num_documento || 0),
                tipo_documento: String(e?.tipo_documento || ""),
                usuario: this.usuario || "",
                id_devolucion: Number(e?.id_devolucion || 0),
              }).pipe(
                take(1),
                catchError(() => of({ errorReversaTrazabilidad: true }))
              )
            ),
            takeUntil(this.destroy$)
          )
          .subscribe({
            next: (resp: any) => {
              if (resp?.errorReversaTrazabilidad) {
                Swal.fire(
                  "Advertencia",
                  "La devolución se anuló, pero no se pudo revertir la trazabilidad en entregas de bodega.",
                  "warning"
                ).then(() => this.buscarProductos(e));
                return;
              }
              this.buscarProductos(e);
            },
            error: () => Swal.fire("Error", "No se pudo anular la devolución", "error"),
          });
      } else if (result.dismiss === Swal.DismissReason.cancel) {
        Swal.fire("Cancelado!", "Se ha cancelado su proceso.", "error");
      }
    });
  }

  buscarProductos(e: any) {
    var contVal = 0;
    this.devoluciones.forEach((element) => {
      if (element.id_devolucion == e.id_devolucion) {
        this.devolucioLeida = element;
        this.productosDevueltosCarga = element.productosDevueltos;
      }
    });
    this.actualizarProductosAnulacion(e.id_devolucion);
  }

  private calcularTotalesPorTipo(items: any[]): { virtual: number; fisica: number } {
    let virtual = 0;
    let fisica = 0;
    (items || []).forEach((p: any) => {
      const tipo = this.normalizarTipoDevolucion(p?.tipoDevolucion);
      console.log("tipo devolucion");
      console.log(tipo);
      const m2 = Number(p?.cantDevueltam2Flo ?? p?.cantDevueltam2 ?? 0) || 0;
      if (tipo === "FISICA") {
        fisica += m2;
      } else {
        virtual += m2;
      }
    });
    return { virtual, fisica };
  }

  aceptarDevolucion(e: any) {
    const dev = this.listadoDevoluciones.find(
      (el) => String(el.id_devolucion) === String(e.id_devolucion)
    );
    const items = (dev?.productosDevueltos || e?.productosDevueltos || []).map((p: any) => ({
      ...p,
      tipoDevolucion: this.normalizarTipoDevolucion(p?.tipoDevolucion),
    }));
    const totales = this.calcularTotalesPorTipo(items);
    const html = `
      <div>
        <p class="text-left mb-2"><b>Se aprobará la devolución #${e?.id_devolucion}.</b></p>
        <p class="text-left mb-1">Dev. virtual: ${totales.virtual.toFixed(2)} m²</p>
        <p class="text-left mb-1">Dev. física: ${totales.fisica.toFixed(2)} m²</p>
        <p class="text-left mb-0">La regla de proceso usará el tipo por ítem (física/virtual).</p>
      </div>
    `;

    Swal.fire({
      title: "Aceptar Devolución",
      html,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Aprobar",
      cancelButtonText: "Cancelar",
      width: "720px",
    }).then((result) => {
      if (result.value) {
        this.mostrarMensaje();
        this.devolucionesService
          .updateEstado(e, "Aprobado")
          .pipe(retry(2), takeUntil(this.destroy$))
          .subscribe({
            next: (res) => {
              console.log("Update OK", res);
              console.log("e", e);
              this.realizarTransacciones(e);
            },
            error: (err) => {
              console.error("Error updateEstado", err);
              Swal.fire("Error", "No se pudo aprobar la devolución", "error");
            },
            complete: () => {
              console.log("Observable completado");
            },
          });
      } else if (result.dismiss === Swal.DismissReason.cancel) {
        Swal.fire("Cancelado!", "Se ha cancelado su proceso.", "error");
      }
    });
  }

  mostrarMensaje() {
    let timerInterval;
    Swal.fire({
      title: "Guardando !",
      html: "Procesando",
      timerProgressBar: true,
      onBeforeOpen: () => {
        Swal.showLoading();
        timerInterval = setInterval(() => {
          const content = Swal.getContent();
          if (content) {
            const b = content.querySelector("b");
          }
        }, 100);
      },
      onClose: () => {
        clearInterval(timerInterval);
      },
    });
  }

  buscarProductosPendientes() {
    var bandera = true;
    if(this.total == 0 || this.total == null) {
      Swal.fire("Advertencia", "Debe tener al menos un producto o el total debe ser mayor a 0", "warning");
      return;
    }

    this.productosDevueltos.forEach((element) => {
      this.productosPendientes.forEach((element1) => {
        if (
          element1.documento == this.idDocumento &&
          element1.tipo_documento == this.devolucion.tipo_documento &&
          element.producto.PRODUCTO == element1.producto.PRODUCTO
        ) {
          bandera = false;
        }
      });
    });

    if (bandera) {
      this.validarEstadoCaja();
    } else {
      Swal.fire({
        title: "Advertencia",
        text:
          "Los productos devueltos tienen solicitudes de entrega asociadas , desea continuar?",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Si",
        cancelButtonText: "No",
      }).then((result) => {
        if (result.value) {
          //this.mostrarMensaje()
          this.validarEstadoCaja();
        } else if (result.dismiss === Swal.DismissReason.cancel) {
          Swal.fire("Cancelado!", "Se ha cancelado su proceso.", "error");
        }
      });
    }
  }

  realizarTransacciones(e: any) {
    console.log("realizarTransacciones",e);
    const dev = this.listadoDevoluciones.find((el) => String(el.id_devolucion) === String(e.id_devolucion));
    console.log("dev", dev);
    if (!dev) return;
    this.devolucioLeida = dev;
    this.productosDevueltosCarga = dev.productosDevueltos;

    const transacciones$ = this.productosDevueltosCarga.map((element) => {
      const t = new transaccion();
      t.fecha_mov = new Date().toLocaleString();
      t.fecha_transaccion = this.devolucioLeida.fecha;
      t.sucursal = this.devolucioLeida.sucursal.nombre;
      t.bodega = "bodega2";
      t.documento = this.devolucioLeida.id_devolucion + "";
      t.producto = element.producto.PRODUCTO;
      t.costo_unitario = element.producto.precio;
      t.cajas = element.cantDevueltaCajas;
      t.piezas = element.cantDevueltaPiezas;
      t.observaciones = element.justificacion;
      t.tipo_transaccion = "devolucion";
      t.movimiento = 1;
      t.valor = element.valorunitario;
      t.cantM2 = element.cantDevueltam2;
      t.totalsuma = element.total;
      t.usu_autorizado = this.devolucioLeida.usuario;
      t.usuario = this.devolucioLeida.usuario;
      t.factPro = this.devolucioLeida.num_documento + "";
      t.idTransaccion = this.number_transaccion++;
      t.cliente = this.devolucioLeida?.cliente;
      return this.transaccionesService.newTransaccion(t).pipe(take(1), retry(2));
    });
    const financieras$ = this.productosDevueltosCarga.map((element) =>
      this.crearTransaccionFinancieraObs(element).pipe(take(1), retry(2))
    );

    forkJoin([...transacciones$, ...financieras$])
      .pipe(
        switchMap(() =>
          this.entregasBodegaService
            .registrarDevolucionAprobada({
              documentoNumero: this.devolucioLeida.num_documento,
              tipo_documento: this.devolucioLeida.tipo_documento,
              usuario: this.devolucioLeida.usuario,
              id_devolucion: this.devolucioLeida.id_devolucion,
              observaciones: this.devolucioLeida.observaciones,
              productosDevueltos: this.productosDevueltosCarga.map((p) => ({
                producto: p.producto,
                cantDevueltam2: p.cantDevueltam2,
                cantDevueltam2Flo: p.cantDevueltam2Flo,
                cantDevueltaCajas: p.cantDevueltaCajas,
                cantDevueltaPiezas: p.cantDevueltaPiezas,
                tipoDevolucion: this.normalizarTipoDevolucion((p as any)?.tipoDevolucion),
              })),
            })
            .pipe(
              take(1),
              catchError(() => of({ errorTrazabilidad: true }))
            )
        ),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res: any) => {
          this.avisoTrazabilidadBodega = null;
          if (res && res.errorTrazabilidad) {
            this.avisoTrazabilidadBodega = {
              icon: "warning",
              title: "Trazabilidad de bodega",
              html:
                "<p class=\"text-left mb-0\">La devolución se registró pero no se pudo sincronizar la trazabilidad de entregas de bodega. Compruebe la conexión o actualice la orden manualmente.</p>",
            };
          } else {
            const avisos: string[] = [];
            if (res?.sinOrdenEntrega && res.mensaje) {
              avisos.push(res.mensaje);
            }
            if (res?.sinActualizacionTrazabilidad && res.mensaje) {
              avisos.push(res.mensaje);
            }
            const det = res?.detalleAdvertencias;
            if (Array.isArray(det) && det.length) {
              avisos.push(...det);
            }
            if (avisos.length) {
              this.avisoTrazabilidadBodega = {
                icon: "info",
                title: "Trazabilidad de bodega",
                html: avisos.map((t) => `<p class="text-left mb-1">${t}</p>`).join(""),
              };
            }
          }
          this.actualizarProductos();
        },
        error: () => {
          Swal.fire("Error", "Error al guardar transacciones. Revise la conexión.", "error");
        },
      });
  }


  private crearTransaccionFinancieraObs(producto: productosDevueltos) {
    const nombreSubCuenta =
      this.devolucioLeida.tipo_documento === "Factura"
        ? "1.4.0 Factura"
        : this.devolucioLeida.tipo_documento === "Nota de Venta"
        ? "1.4.1 Nota_Venta"
        : "";
    const transaccion = new TransaccionesFinancieras();
    transaccion.fecha = this.devolucioLeida?.fecha;
    transaccion.sucursal = this.devolucioLeida?.sucursal?.nombre;
    transaccion.cliente = this.devolucioLeida?.cliente;
    transaccion.rCajaId = "DV" + this.devolucioLeida?.id_devolucion;
    transaccion.tipoTransaccion = "devolucion";
    transaccion.id_documento = this.devolucioLeida?.id_devolucion;
    transaccion.documentoVenta = this.devolucioLeida?.num_documento?.toString();
    transaccion.cedula = this.devolucioLeida?.ruc;
    transaccion.numDocumento = this.devolucioLeida?.num_documento?.toString();
    transaccion.valor = producto.total;
    transaccion.isContabilizada = true;
    transaccion.cuenta = "1.4 DEVOLUCIONES";
    transaccion.subCuenta = nombreSubCuenta;
    transaccion.notas = this.devolucioLeida?.observaciones;
    transaccion.tipoCuenta = "Salidas";
    return this._transaccionFinancieraService.newTransaccionFinanciera(transaccion);
  }

  contadorValidaciones(_i: number) {
    // Usado solo por flujo legacy; realizarTransacciones ahora usa forkJoin
  }

  eliminarTransacciones(num: number) {
    const newTipoDocEliminacion = new tipoDocEliminacion();
    newTipoDocEliminacion.nroDocumento = num.toString();
    newTipoDocEliminacion.tipoDocumento = "devolucion";
    this.transaccionesService
      .deleteTransaccionPorDevoluciones(newTipoDocEliminacion)
      .pipe(take(1), retry(2), takeUntil(this.destroy$))
      .subscribe({
        error: () => Swal.fire("Error", "Error al eliminar transacciones", "error"),
      });
  }

  contadorValidaciones2(i: number) {
    if (this.productosDevueltosCarga.length === i) {
      Swal.close();
      Swal.fire({
        title: "Devolución Aprobada",
        text: "Se ha guardado con éxito",
        icon: "success",
        confirmButtonText: "Ok",
      }).then(() => {
        const aviso = this.avisoTrazabilidadBodega;
        this.avisoTrazabilidadBodega = null;
        if (aviso) {
          return Swal.fire({
            icon: aviso.icon,
            title: aviso.title,
            html: aviso.html,
          }).then(() => this.refrescarListado());
        }
        return this.refrescarListado();
      });
    }
  }

  contadorValidacionesAnulacion(i: number) {
    if (this.productosDevueltosCarga.length === i) {
      Swal.close();
      Swal.fire({
        title: "Devolución Anulada",
        text: "Se ha realizado con éxito",
        icon: "success",
        confirmButtonText: "Ok",
      }).then(() => this.refrescarListado());
    }
  }

  confirmarDevolucion() {
    Swal.fire({
      title: "Devolución Registrada",
      text: "Se ha guardado con éxito",
      icon: "success",
      confirmButtonText: "Ok",
    }).then(() => 
      window.location.reload()
      //this.refrescarListado()
    );
  }

  refrescarListado() {
    const obj = new objDate();
    obj.fechaActual = this.nowhasta;
    obj.fechaAnterior = this.nowdesde;
    obj.fechaAnterior.setHours(0, 0, 0, 0);
    this.devolucionesService
      .getDevolucionesPorRango(obj)
      .pipe(take(1), takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.devoluciones = res as devolucion[];
          this.cargarDevoluciones();
        },
        error: () => {
          this.devoluciones = [];
          this.cargarDevoluciones();
        },
      });
  }

  contadorValidaciones3(_i: number) {
    // Legado
  }

  cargarDatosDevolucion(e: any) {
    // alert("voy a buscar la remision "+e.id_remision)
    var cont = 0;
    this.productosDevueltosCarga.forEach((element) => {
      cont++;
    });
    if (cont >= 0) {
      this.productosDevueltosCarga.forEach((element) => {
        this.productosDevueltosCarga.splice(0);
      });
    }

    this.devoluciones.forEach((element) => {
      if (element.id_devolucion == e.id_devolucion) {
        this.devolucioLeida = element;
        this.productosDevueltosCarga = element.productosDevueltos;
        //alert("ssd "+this.productosDevueltosCarga.length)
      }
    });

    this.parametrizaciones.forEach((element) => {
      if (element.sucursal == this.devolucioLeida.sucursal.nombre) {
        this.parametrizacionSucu = element;
        //alert("sdsd "+JSON.stringify(this.parametrizacionSucu))
      }
    });

    this.crearPDF();
  }

  opcionMenu(e) {
    switch (e.value) {
      case "Devoluciones":
        this.mostrarNewDevolucion = true;
        this.mostrarListado = false;
        break;

      case "Listado Devoluciones":
        this.mostrarNewDevolucion = false;
        this.mostrarListado = true;
        if(this.devoluciones.length == 0)
          this.traerComprobantesPagoPorRango();
        break;

      default:
    }
  }

  crearPDF() {
    const documentDefinition = this.getDocumentDefinition();
    pdfMake
      .createPdf(documentDefinition)
      .download(
        "Devolucion " + this.devolucioLeida.id_devolucion,
        function () {}
      );
  }

  setearNFactura() {
    const nf = this.devolucioLeida.id_devolucion;
    const num = ("" + nf).length;
    switch (num) {
      case 1:
        this.numeroFactura = "00000" + nf;
        break;
      case 2:
        this.numeroFactura = "0000" + nf;
        break;
      case 3:
        this.numeroFactura = "000" + nf;
        break;
      case 4:
        this.numeroFactura = "00" + nf;
        break;
      case 5:
        this.numeroFactura = "0" + nf;
        break;
      case 6:
        //this.numeroFactura= nf
        break;
      default:
    }
  }

  getDocumentDefinition() {
    this.setearNFactura();
    sessionStorage.setItem("Devolucion", JSON.stringify("jj"));
    //let tipoDocumento="Factura";
    return {
      pageSize: "A4",
      pageOrientation: "portrait",
      content: [
        {
          columns: [
            {
              image: this.imagenLogotipo,
              width: 100,
              margin: [0, 20, 0, 10],
            },
            {
              width: 410,
              margin: [0, 20, 0, 10],
              text: " ",
              alignment: "right",
            },
          ],

          //alignment: 'center'
        },

        {
          columns: [
            [
              {
                text: this.parametrizacionSucu.razon_social,
              },
              {
                text: "RUC: " + this.parametrizacionSucu.ruc,
              },

              {
                text:
                  "Venta de materiales para acabados de construcción, porcelanatos, cerámicas ",
                fontSize: 9,
              },
              {
                text: "Dirección: " + this.parametrizacionSucu.direccion,
              },
              {
                text: "Teléfonos: " + this.parametrizacionSucu.telefonos,
              },
              {
                text: "Auto SRI " + this.parametrizacionSucu.sri,
              },
              {
                columns: [
                  {
                    width: 260,
                    text: "DEVOLUCIÓN  001 - 000",
                    bold: true,
                    fontSize: 20,
                  },
                  {
                    width: 260,
                    text: "NO " + this.numeroFactura,
                    color: "red",
                    bold: true,
                    fontSize: 20,
                    alignment: "right",
                  },
                ],
              },
              {
                //Desde aqui comienza los datos del cliente
                style: "tableExample",
                table: {
                  widths: [100, 140, 100, 140],
                  body: [
                    [
                      {
                        stack: [
                          {
                            type: "none",
                            bold: true,
                            fontSize: 9,
                            ul: ["Numero Doc.", "Tipo", "Cliente", "Sucursal"],
                          },
                        ],
                      },
                      {
                        stack: [
                          {
                            type: "none",
                            fontSize: 9,
                            ul: [
                              "" + this.devolucioLeida.num_documento,
                              "" + this.devolucioLeida.tipo_documento,
                              "" + this.devolucioLeida.cliente,
                              "" + this.devolucioLeida.sucursal.nombreComercial,
                            ],
                          },
                        ],
                      },
                      {
                        stack: [
                          {
                            type: "none",
                            bold: true,
                            fontSize: 9,
                            ul: ["Fecha", "Fecha/transaccion", "Usuario"],
                          },
                        ],
                      },
                      [
                        {
                          stack: [
                            {
                              type: "none",
                              fontSize: 9,
                              ul: [
                                "" + this.devolucioLeida.fecha.toLocaleString(),
                                "" + this.devolucioLeida.fecha_transaccion,
                                "" + this.devolucioLeida.usuario,
                              ],
                            },
                          ],
                        },
                      ],
                    ],
                  ],
                },
              },
            ],
            [],
          ],
        },

        this.getProductosIngresados2(this.productosDevueltosCarga),
        { text: " " },
        { text: " " },
        {
          text: "Observaciones:   " + this.devolucioLeida.observaciones,
          fontSize: 9,
        },

        { text: " " },
        {
          columns: [
            {
              width: 450,
              text: "Total:",
              bold: true,
              fontSize: 15,
              alignment: "right",
            },
            {
              width: 60,
              text: +this.devolucioLeida.totalDevolucion,
              bold: true,
              fontSize: 15,
              alignment: "right",
            },
          ],
        },
        { text: " " },
        { text: " " },
        { text: " " },
        {
          columns: [
            {
              text: "Firma conformidad entrega",
              width: 250,
              fontSize: 10,
              alignment: "right",
              margin: [55, 20, 40, 10],
            },
            {
              width: 250,
              margin: [40, 20, 20, 10],
              fontSize: 10,
              text: "Firma conformidad recibo ",
              alignment: "left",
            },
          ],

          //alignment: 'center'
        },
      ],
      footer: function (currentPage, pageCount) {
        return {
          table: {
            body: [
              [
                {
                  text:
                    "  ORIGINAL   ORIGINAL   ORIGINAL   ORIGINAL   ORIGINAL   ORIGINAL   ORIGINAL   ORIGINAL   ORIGINAL   ORIGINAL ",
                  alignment: "center",
                  style: "textFot",
                },
              ],
            ],
          },
          layout: "noBorders",
        };
      },
      pageBreakBefore: function (
        currentNode,
        followingNodesOnPage,
        nodesOnNextPage,
        previousNodesOnPage
      ) {
        return (
          currentNode.headlineLevel === 1 && followingNodesOnPage.length === 0
        );
      },

      images: {
        mySuperImage: "data:image/jpeg;base64,...content...",
      },
      info: {
        title: "Factura" + "_RESUME",
        author: "this.resume.name",
        subject: "RESUME",
        keywords: "RESUME, ONLINE RESUME",
      },
      styles: {
        header: {
          fontSize: 18,
          bold: true,
          margin: [0, 20, 0, 10],
          decoration: "underline",
        },
        textoPro: {
          bold: true,
          margin: [0, -12, 0, -5],
        },
        tableExample: {
          margin: [0, 5, 0, 15],
        },
        tableExample2: {
          margin: [-13, 5, 10, 15],
        },
        tableExample3: {
          margin: [-13, -10, 10, 15],
        },
        tableExample4: {
          margin: [10, -5, 0, 15],
        },
        texto6: {
          fontSize: 14,
          bold: true,
          alignment: "center",
        },
        name: {
          fontSize: 16,
          bold: true,
        },
        jobTitle: {
          fontSize: 14,
          bold: true,
          italics: true,
        },
        textFot: {
          alignment: "center",
          italics: true,
          color: "#bebebe",
          fontSize: 18,
        },
        tableHeader: {
          bold: true,
        },
        tableHeader2: {
          bold: true,
          fontSize: 10,
        },

        fondoFooter: {
          fontSize: 8,
          alignment: "center",
        },
        totales: {
          margin: [0, 0, 15, 0],
          alignment: "right",
        },
        totales2: {
          margin: [0, 0, 5, 0],
          alignment: "right",
        },
        detalleTotales: {
          margin: [15, 0, 0, 0],
        },
      },
    };
  }

  getProductosIngresados2(productos: productosDevueltos[]) {
    return {
      /*  [{text: 'Header with Colspan = 2', style: 'tableHeader', colSpan: 2, alignment: 'center'}, {}, {text: 'Header 3', style: 'tableHeader', alignment: 'center'}], */
      table: {
        widths: ["40%", "9%", "9%", "7%", "15%", "20%"],
        alignment: "center",
        fontSize: 9,
        headerRows: 2,
        body: [
          [
            {
              text: "Producto",
              style: "tableHeader2",
              rowSpan: 2,
              fontSize: 8,
              alignment: "center",
            },
            {
              text: "Cantidad Devuelta",
              style: "tableHeader2",
              colSpan: 2,
              fontSize: 8,
              alignment: "center",
            },
            {},
            {
              text: "Total",
              style: "tableHeader2",
              rowSpan: 2,
              fontSize: 8,
              alignment: "center",
            },
            {
              text: "Motivo",
              style: "tableHeader2",
              rowSpan: 2,
              fontSize: 8,
              alignment: "center",
            },
            {
              text: "Justificación",
              rowSpan: 2,
              style: "tableHeader2",
              fontSize: 8,
              alignment: "center",
            },
          ],
          [
            {},
            {
              text: "Cajas",
              style: "tableHeader2",
              fontSize: 8,
              alignment: "center",
            },
            {
              text: "Piezas",
              style: "tableHeader2",
              fontSize: 8,
              alignment: "center",
            },
            {},
            {},
            {},
          ],

          ...productos.map((ed) => {
            return [
              { text: ed.producto.PRODUCTO, fontSize: 9 },
              { text: ed.cantDevueltaCajas, alignment: "center", fontSize: 9 },
              { text: ed.cantDevueltaPiezas, alignment: "center", fontSize: 9 },
              { text: ed.total.toFixed(2), alignment: "center", fontSize: 9 },
              { text: ed.motivo, alignment: "center", fontSize: 9 },
              { text: ed.justificacion, alignment: "center", fontSize: 9 },
            ];
          }),
        ],
      },
    };
  }

  actualizarProductos() {
    const suc = this.devolucioLeida?.sucursal?.nombre;
    const updates: any[] = [];
    for (const element of this.productosDevueltosCarga) {
      const prod = this.productos.find((p) => p.PRODUCTO === element.producto.PRODUCTO);
      if (!prod) continue;
      let sumaProductos: number;
      const num1 = parseInt(element.cantDevueltam2.toFixed(0), 10);
      switch (suc) {
        case "matriz":
          sumaProductos = Number(prod.sucursal1) + num1;
          element.producto.sucursal1 = sumaProductos;
          updates.push(this.productoService.updateProductoSucursal1(element.producto).pipe(take(1), retry(2)));
          break;
        case "sucursal1":
          sumaProductos = Number(prod.sucursal2) + num1;
          element.producto.sucursal2 = sumaProductos;
          updates.push(this.productoService.updateProductoSucursal2(element.producto).pipe(take(1), retry(2)));
          break;
        case "sucursal2":
          sumaProductos = Number(prod.sucursal3) + num1;
          element.producto.sucursal3 = sumaProductos;
          updates.push(this.productoService.updateProductoSucursal3(element.producto).pipe(take(1), retry(2)));
          break;
        default:
          break;
      }
    }
    if (updates.length === 0) {
      this.contadorValidaciones2(0);
      return;
    }
    forkJoin(updates)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => this.contadorValidaciones2(this.productosDevueltosCarga.length),
        error: () => Swal.fire("Error", "Error al actualizar productos", "error"),
      });
  }

  eliminarTransaccionesFinancieras(num: number) {
    this.busquedaTransaccion = new tipoBusquedaTransaccion();
    this.busquedaTransaccion.NumDocumento = num.toString();
    this.busquedaTransaccion.tipoTransaccion = "devolucion";
    this._transaccionFinancieraService
      .getTransaccionesPorTipoDocumento(this.busquedaTransaccion)
      .pipe(take(1), takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const list = (res as TransaccionesFinancieras[]) || [];
          if (list.length === 0) return;
          forkJoin(list.map((el) => this._transaccionFinancieraService.deleteTransaccionFinanciera(el).pipe(take(1), retry(2))))
            .pipe(takeUntil(this.destroy$))
            .subscribe({ error: () => Swal.fire("Error", "Error al eliminar transacciones financieras", "error") });
        },
        error: () => {},
      });
  }

  actualizarProductosAnulacion(num: number) {
    this.eliminarTransacciones(num);
    this.eliminarTransaccionesFinancieras(num);
    const suc = this.devolucioLeida?.sucursal?.nombre;
    const updates: any[] = [];
    for (const element of this.productosDevueltosCarga) {
      const prod = this.productos.find((p) => p.PRODUCTO === element.producto.PRODUCTO);
      if (!prod) continue;
      const num1 = parseInt(element.cantDevueltam2.toFixed(0), 10);
      let sumaProductos: number;
      switch (suc) {
        case "matriz":
          sumaProductos = Number(prod.sucursal1) - num1;
          element.producto.sucursal1 = sumaProductos;
          updates.push(this.productoService.updateProductoSucursal1(element.producto).pipe(take(1), retry(2)));
          break;
        case "sucursal1":
          sumaProductos = Number(prod.sucursal2) - num1;
          element.producto.sucursal2 = sumaProductos;
          updates.push(this.productoService.updateProductoSucursal2(element.producto).pipe(take(1), retry(2)));
          break;
        case "sucursal2":
          sumaProductos = Number(prod.sucursal3) - num1;
          element.producto.sucursal3 = sumaProductos;
          updates.push(this.productoService.updateProductoSucursal3(element.producto).pipe(take(1), retry(2)));
          break;
        default:
          break;
      }
    }
    if (updates.length === 0) {
      this.contadorValidacionesAnulacion(0);
      return;
    }
    forkJoin(updates)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => this.contadorValidacionesAnulacion(this.productosDevueltosCarga.length),
        error: () => Swal.fire("Error", "Error al actualizar productos", "error"),
      });
  }

  anadirProducto(e) {
    const nuevo = new productosDevueltos();
    nuevo.tipoDevolucion = "FISICA";
    this.productosDevueltos.push(nuevo);
  }

  cambiarTipoDevolucion(i: number) {
    this.transformarM2(null, i);
  }

  private normalizarTipoDevolucion(tipo: any): string {
    const valor = String(tipo || "").trim().toUpperCase();
    return valor === "FISICA" ? "FISICA" : "VIRTUAL";
  }

  obtenerMensajeTipoDevolucion(tipo: any): string {
    const tipoNormalizado = this.normalizarTipoDevolucion(tipo);
    if (tipoNormalizado === "FISICA") {
      return "Este tipo de devolución afecta a la cantidad facturada del producto.";
    }
    return "Esta devolución afecta al producto aún no retirado de bodega.";
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
