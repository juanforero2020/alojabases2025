const ReglaPagoNomina = require("../models/reglaPagoNomina");
const {
  CUOTAS_SEG_SOCIAL,
  esTransaccionSeguridadSocial,
  esDescuentosGenerales,
  construirProyeccionTipoC,
  aplicarDescuentosEnEventos,
  quitarDescuentosRegla,
  cargarReglaAsociada,
  generarTablaCuotasSegSocial,
  generarTablaDescuentoGeneral,
  cuotaSegSocial,
  distribuirEnCuotas,
} = require("../utils/proyeccionPagosTipoC");
const {
  calcularMontoSegSocialParaRegla,
  calcularMontoSegSocialDesdeBase,
} = require("../utils/aporteIessNomina");

function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function normalizarReglaTipoC(regla) {
  const doc =
    regla && typeof regla.toObject === "function" ? regla.toObject() : { ...regla };
  doc.tipoRegla = "C";
  doc.esDescuento = true;
  doc.tipoBeneficiario = "Interno";
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
  if (reglaA.frecuencia === "Dominical") {
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

function validarReglaTipoC(regla) {
  if (regla.tipoBeneficiario !== "Interno") {
    return "Los descuentos de nómina solo aplican a beneficiarios internos";
  }
  const total = redondear2(regla.montoTotalDeuda || regla.monto || 0);
  if (!total || total <= 0) {
    return "El monto del descuento debe ser mayor a cero";
  }
  if (!esTransaccionSeguridadSocial(regla.transaccionNomina) && !esDescuentosGenerales(regla.transaccionNomina)) {
    return "Transacción no válida para regla tipo C";
  }
  if (esDescuentosGenerales(regla.transaccionNomina)) {
    if (!regla.conceptoDescuento) {
      return "Seleccione el concepto del descuento";
    }
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
  return null;
}

async function validarReglaTipoCCompleta(regla) {
  const msgBase = validarReglaTipoC(regla);
  if (msgBase) return msgBase;
  return validarReglaPagoAsociada(regla);
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
      "_id transaccionNomina frecuencia parametro monto nombreBeneficiario cedulaBeneficiario"
    )
    .sort({ createdAt: -1 })
    .lean();
}

async function generarEventosProgramados(regla, opciones = {}) {
  const reglaObj = await normalizarReglaTipoC(regla);
  const msg = await validarReglaTipoCCompleta(reglaObj);
  if (msg) throw new Error(msg);

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
  validarReglaTipoCCompleta,
  listarReglasPagoAsociables,
  generarEventosProgramados,
  quitarDescuentosRegla,
  generarTablaCuotasSegSocial,
  generarTablaDescuentoGeneral,
  construirProyeccionTipoC,
};
