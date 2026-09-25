const ReglaPagoNomina = require("../models/reglaPagoNomina");
const {
  CUOTAS_SEG_SOCIAL,
  esTransaccionSeguridadSocial,
  esDescuentosGenerales,
  esDescuentoExternoTipoC,
  construirProyeccionTipoC,
  aplicarDescuentosEnEventos,
  quitarDescuentosRegla,
  cargarReglaAsociada,
  generarTablaCuotasSegSocial,
  generarTablaDescuentoGeneral,
  cuotaSegSocial,
  distribuirEnCuotas,
  evaluarDescuentoTipoCVsEventos,
} = require("../utils/proyeccionPagosTipoC");
const {
  calcularMontoSegSocialParaRegla,
  calcularMontoSegSocialDesdeBase,
} = require("../utils/aporteIessNomina");
const {
  validarFacturaParaPago,
  aplicarDescuentoFacturaProveedor,
} = require("../utils/facturaProveedorNomina");
const TransaccionFinanciera = require("../models/transaccionFinanciera");
const {
  SUBCUENTAS_NOMINA,
  subCuentaDescuentoNomina,
} = require("../utils/cuentasContablesNomina");
const tipoBNominaService = require("./tipoBNominaService");

function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function normalizarReglaTipoC(regla) {
  const doc =
    regla && typeof regla.toObject === "function" ? regla.toObject() : { ...regla };
  doc.tipoRegla = "C";
  doc.esDescuento = true;
  if (esTransaccionSeguridadSocial(doc.transaccionNomina)) {
    doc.tipoBeneficiario = "Interno";
  } else if (esDescuentoExternoTipoC(doc)) {
    doc.tipoBeneficiario = "Externo";
  } else {
    doc.tipoBeneficiario = doc.tipoBeneficiario || "Interno";
  }
  doc.fuente = doc.fuente || "TMS";
  doc.campoMontoTms = doc.campoMontoTms || "salarioCalculoVariablesPrestacionales";

  if (esDescuentosGenerales(doc.transaccionNomina)) {
    doc.transaccionNomina = "Descuentos";
    doc.fuente = "Manual";
    doc.modalidadDescuento = doc.modalidadDescuento || "Valor unico";
    doc.semanaAplicacion = doc.semanaAplicacion || "Esta semana";
    const total = redondear2(doc.montoTotalDeuda || doc.monto || 0);
    const nCuotas =
      doc.modalidadDescuento === "Por cuota"
        ? Math.max(1, Number(doc.cuotas) || 1)
        : 1;
    doc.cuotas = nCuotas;
    doc.montoTotalDeuda = total;
    doc.monto = total;
    const partes = distribuirEnCuotas(total, nCuotas);
    doc.cuotaEvento = partes[0] || 0;
    if (esDescuentoExternoTipoC(doc)) {
      doc.asociarFacturaPendiente = true;
      doc.reglaPagoAsociadaId = null;
      doc.modalidadDescuento = "Valor unico";
      doc.cuotas = 1;
      doc.cuotaEvento = total;
      doc.semanaAplicacion = "Esta semana";
    }
    if (doc.tablaAmortizacion && doc.tablaAmortizacion.length) {
      doc.tablaAmortizacion = doc.tablaAmortizacion;
    }
    return doc;
  }

  doc.cuotas = CUOTAS_SEG_SOCIAL;
  if (esTransaccionSeguridadSocial(doc.transaccionNomina)) {
    doc.transaccionNomina = "Pago Seguridad Social";
    if (doc.fuente === "TMS") {
      const calc = await calcularMontoSegSocialParaRegla(doc);
      if (calc.error) {
        throw new Error(calc.error);
      }
      doc.montoBaseTms = calc.montoBase;
      doc.porcentajeAportePersonal = calc.porcentaje;
      doc.montoTotalDeuda = calc.monto;
      doc.monto = calc.monto;
    }
  }
  const total = redondear2(doc.montoTotalDeuda || doc.monto || 0);
  doc.montoTotalDeuda = total;
  doc.monto = total;
  doc.cuotaEvento = cuotaSegSocial(total);
  return doc;
}

async function validarReglaPagoAsociada(reglaC) {
  if (!reglaC.reglaPagoAsociadaId) {
    return "Debe seleccionar la regla de pago (tipo A) a la que se aplicará el descuento";
  }
  const reglaA = await ReglaPagoNomina.findById(reglaC.reglaPagoAsociadaId);
  if (!reglaA) {
    return "La regla de pago asociada no existe";
  }
  if (reglaA.tipoRegla !== "A") {
    return "Solo puede asociar reglas de pago tipo A";
  }
  if (reglaA.estadoRegla !== "Autorizada") {
    return "La regla de pago asociada debe estar autorizada antes de configurar el descuento";
  }
  if (reglaA.cedulaBeneficiario !== reglaC.cedulaBeneficiario) {
    return "La regla asociada debe pertenecer al mismo beneficiario";
  }
  const transaccionA = (reglaA.transaccionNomina || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (
    reglaA.frecuencia === "Dominical" ||
    transaccionA === "dominical" ||
    transaccionA.includes("pago dominical")
  ) {
    return "No se puede aplicar descuento de seguridad social a reglas de pago dominical";
  }
  if (!reglaA.monto || reglaA.monto <= 0) {
    if (!reglaA.montoVariable) {
      return "La regla de pago asociada debe tener un monto definido";
    }
  }
  if (esTransaccionSeguridadSocial(reglaC.transaccionNomina)) {
    const existente = await ReglaPagoNomina.findOne({
      _id: { $ne: reglaC._id },
      tipoRegla: "C",
      reglaPagoAsociadaId: reglaC.reglaPagoAsociadaId,
      transaccionNomina: /seguridad social/i,
      estadoRegla: { $in: ["Borrador", "Autorizada"] },
    });
    if (existente) {
      return `Ya existe una regla de descuento activa (${existente.transaccionNomina}) para esa regla de pago`;
    }
  }
  return null;
}

function validarCuotaDescuentoVsBruto(reglaC, montoBrutoPago) {
  const bruto = redondear2(montoBrutoPago || 0);
  if (!bruto) return null;

  const total = redondear2(reglaC.montoTotalDeuda || reglaC.monto || 0);
  let cuotaMax = 0;

  if (esDescuentosGenerales(reglaC.transaccionNomina)) {
    const n =
      reglaC.modalidadDescuento === "Por cuota"
        ? Math.max(1, Number(reglaC.cuotas) || 1)
        : 1;
    const partes = distribuirEnCuotas(total, n);
    cuotaMax = Math.max(...partes, 0);
  } else {
    cuotaMax = cuotaSegSocial(total);
  }

  if (cuotaMax > bruto + 0.009) {
    return `El descuento por pago ($${cuotaMax.toFixed(
      2
    )}) no puede superar el pago bruto de la regla asociada ($${bruto.toFixed(
      2
    )}). Reduzca el monto o distribúyalo en más cuotas.`;
  }

  return null;
}

function validarReglaTipoC(regla) {
  if (esTransaccionSeguridadSocial(regla.transaccionNomina)) {
    if (regla.tipoBeneficiario !== "Interno") {
      return "El descuento de seguridad social solo aplica a beneficiarios internos";
    }
  } else if (
    regla.tipoBeneficiario !== "Interno" &&
    regla.tipoBeneficiario !== "Externo"
  ) {
    return "Seleccione si el beneficiario es interno o externo";
  }
  if (!(regla.centroCosto || "").trim()) {
    return "Seleccione el centro de costo";
  }
  const total = redondear2(regla.montoTotalDeuda || regla.monto || 0);
  if (!total || total <= 0) {
    return "El monto del descuento debe ser mayor a cero";
  }
  if (!esTransaccionSeguridadSocial(regla.transaccionNomina) && !esDescuentosGenerales(regla.transaccionNomina)) {
    return "Transacción no válida para regla tipo C";
  }
  if (
    esTransaccionSeguridadSocial(regla.transaccionNomina) &&
    !regla.fechaInicioPagos
  ) {
    return "Indique la fecha desde la que iniciará el pago de seguridad social";
  }
  if (esDescuentosGenerales(regla.transaccionNomina)) {
    if (!regla.conceptoDescuento) {
      return "Seleccione el concepto del descuento";
    }
    if (esDescuentoExternoTipoC(regla)) {
      if (!regla.facturaProveedorId) {
        return "Seleccione la factura pendiente a la que se aplicará el descuento";
      }
    } else {
      if (!regla.modalidadDescuento) {
        return "Indique si el descuento es por cuota o valor único";
      }
      if (!regla.semanaAplicacion) {
        return "Indique en qué semana se aplicará el descuento";
      }
      if (
        regla.semanaAplicacion === "Semana especifica" &&
        !regla.fechaAplicacionDescuento
      ) {
        return "Indique la fecha de la semana en que se aplicará el descuento";
      }
      if (regla.modalidadDescuento === "Por cuota") {
        const n = Number(regla.cuotas) || 0;
        if (n < 2) {
          return "Para descuento por cuota indique al menos 2 cuotas";
        }
      }
    }
  }
  return null;
}

async function validarReglaTipoCCompleta(regla) {
  const msgBase = validarReglaTipoC(regla);
  if (msgBase) return msgBase;

  if (esDescuentoExternoTipoC(regla)) {
    try {
      const { saldo, factura } = await validarFacturaParaPago(
        regla.facturaProveedorId
      );
      const total = redondear2(regla.montoTotalDeuda || regla.monto || 0);
      if (total > saldo.valorAdeudado + 0.01) {
        return `El descuento ($${total.toFixed(
          2
        )}) no puede superar el saldo de la factura ${factura.nFactura || ""} ($${saldo.valorAdeudado.toFixed(
          2
        )})`;
      }
    } catch (err) {
      return err.message || "No se pudo validar la factura pendiente";
    }
    return null;
  }

  const msgAsoc = await validarReglaPagoAsociada(regla);
  if (msgAsoc) return msgAsoc;

  const reglaA = await ReglaPagoNomina.findById(regla.reglaPagoAsociadaId);
  if (reglaA) {
    const normalizado = await normalizarReglaTipoC(regla);
    const msgCuota = validarCuotaDescuentoVsBruto(normalizado, reglaA.monto);
    if (msgCuota) return msgCuota;

    const evaluacion = await evaluarDescuentoTipoCVsEventos(normalizado, {
      reglaA: reglaA.toObject ? reglaA.toObject() : reglaA,
      reglaNormalizada: normalizado,
      excluirReglaCId: regla._id,
    });
    if (!evaluacion.ok) return evaluacion.mensaje;
  }

  return null;
}

async function listarReglasPagoAsociables(cedula) {
  const doc = (cedula || "").trim();
  if (!doc) return [];
  return ReglaPagoNomina.find({
    cedulaBeneficiario: doc,
    tipoRegla: "A",
    estadoRegla: "Autorizada",
    frecuencia: { $ne: "Dominical" },
    montoVariable: { $ne: true },
  })
    .select(
      "_id transaccionNomina frecuencia parametro monto nombreBeneficiario cedulaBeneficiario centroCosto"
    )
    .sort({ createdAt: -1 })
    .lean();
}

async function aplicarDescuentoEnFacturaExterna(regla, opciones = {}) {
  const total = redondear2(regla.montoTotalDeuda || regla.monto || 0);
  const subCuenta = subCuentaDescuentoNomina(
    regla.transaccionNomina,
    regla.tipoBeneficiario
  );
  const cuentaDesc = await tipoBNominaService.resolverCuentaDesdeSubCuenta(
    subCuenta || SUBCUENTAS_NOMINA.DESCUENTOS
  );
  const fechaContable = new Date();
  const concepto = (regla.conceptoDescuento || "Descuento").toString().trim();
  const facturaTxt = (regla.nFacturaProveedor || "").toString().trim();
  const notas = [
    `Descuento tipo C — ${concepto}`,
    facturaTxt ? `Factura ${facturaTxt}` : "",
    "1.3 INGRESOS / 1.3.4 Nominas_Descuentos",
    opciones.notas || regla.notas || "",
  ]
    .filter(Boolean)
    .join(". ");

  const tx = new TransaccionFinanciera({
    fecha: fechaContable,
    fechaContable,
    sucursal: opciones.sucursal || "matriz",
    cliente: regla.nombreBeneficiario,
    beneficiario: regla.nombreBeneficiario,
    proveedor: regla.nombreBeneficiario,
    cedula: regla.cedulaBeneficiario,
    centroCosto: regla.centroCosto,
    isContabilizada: true,
    usuario: opciones.usuario || regla.creadoPor || "",
    valor: total,
    tipoPago: "Ingreso",
    cuenta: cuentaDesc.cuenta,
    tipoCuenta: cuentaDesc.tipoCuenta || "Ingresos",
    subCuenta: subCuenta || SUBCUENTAS_NOMINA.DESCUENTOS,
    tipoTransaccion: "DESCUENTO_NOMINA",
    numFactura: facturaTxt,
    ordenCompra: regla.nSolicitudFactura,
    documentoVenta: facturaTxt,
    notas,
  });
  await tx.save();

  const descuentoFactura = await aplicarDescuentoFacturaProveedor({
    facturaId: regla.facturaProveedorId,
    monto: total,
    concepto,
    usuario: opciones.usuario || regla.creadoPor || "",
    transaccion: tx,
    regla,
  });

  return { transaccion: tx, descuentoFactura, monto: total };
}

async function generarEventosProgramados(regla, opciones = {}) {
  const reglaObj = await normalizarReglaTipoC(regla);
  const msg = await validarReglaTipoCCompleta(reglaObj);
  if (msg) throw new Error(msg);

  if (esDescuentoExternoTipoC(reglaObj)) {
    const aplicado = await aplicarDescuentoEnFacturaExterna(reglaObj, opciones);
    const proyeccion = construirProyeccionTipoC(reglaObj, opciones);
    return {
      proyeccion,
      eventos: [],
      eventosActualizados: 0,
      cuotaDescuento: aplicado.monto,
      descuentoFactura: aplicado.descuentoFactura,
    };
  }

  const reglaA = await cargarReglaAsociada(reglaObj);
  if (!reglaA) {
    throw new Error("La regla de pago asociada no está disponible");
  }

  reglaObj.frecuencia = reglaA.frecuencia;
  reglaObj.parametro = reglaA.parametro;

  const { actualizados, cuotaDesc } = await aplicarDescuentosEnEventos(
    reglaObj,
    reglaA
  );

  const proyeccion = construirProyeccionTipoC(reglaObj, {
    ...opciones,
    reglaAsociada: reglaA.toObject ? reglaA.toObject() : reglaA,
  });

  return {
    proyeccion,
    eventos: [],
    eventosActualizados: actualizados,
    cuotaDescuento: cuotaDesc,
  };
}

module.exports = {
  normalizarReglaTipoC,
  validarReglaTipoC,
  validarCuotaDescuentoVsBruto,
  validarReglaTipoCCompleta,
  listarReglasPagoAsociables,
  generarEventosProgramados,
  quitarDescuentosRegla,
  generarTablaCuotasSegSocial,
  generarTablaDescuentoGeneral,
  construirProyeccionTipoC,
  esDescuentoExternoTipoC,
};
