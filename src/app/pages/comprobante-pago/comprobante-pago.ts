import { OperacionComercial } from "../reciboCaja/recibo-caja"

export class ComprobantePago{
    idDocumento: number
    fecha: Date
    fechaContable: Date
    documento: string
    centroCosto: string
    usuario: string
    sucursal: string
    beneficiario: string
    proveedor: string
    ruc: string
    telefono: string
    total:number
    observaciones:string
    estadoComprobante: string
    operacionesComercialesList: Array<OperacionComercial>
    constructor(){
        this.total = 0;
        this.documento = "";
        this.centroCosto = "";
        this.proveedor = "";
        this.ruc = "";
        this.telefono = "";
        this.observaciones = "";
        this.fecha = new Date();
        this.fechaContable = new Date();
        this.estadoComprobante = "Activo";
    }
}




