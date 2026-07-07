const Factura = require("../models/factura");
const NotasVenta = require("../models/notasVenta");
const Devoluciones = require("../models/devoluciones");
const TablaMaestraSalarial = require("../models/tablaMaestraSalarial");
const NominaConfigGlobal = require("../models/nominaConfigGlobal");
const ReglaPagoNomina = require("../models/reglaPagoNomina");
const EventoPagoProgramado = require("../models/eventoPagoProgramado");
const EventoPagoDominical = require("../models/eventoPagoDominical");
const AjusteNominaPendiente = require("../models/ajusteNominaPendiente");
const TransaccionFinanciera = require("../models/transaccionFinanciera");

const CONFIG_CLAVE = "principal";
const SUB_CUENTA_PAGO = "1.5.4 Pagos extras";
const SUB_CUENTA_DESCUENTO = "1.5.7 Descuentos";
const TIPO_PAGO = "PAGO_DOMINICAL";
const TIPO_AJUSTE = "AJUSTE_DOMINICAL_ANULACION";

function normalizarTexto(valor) {
  return (valor || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizarCargoDominical(cargo) {
  const c = normalizarTexto(cargo);
  if (c.includes("bodeguero")) return "BODEGUERO";
  if (
    c.includes("vendedor") ||
    c.includes("distribuidor") ||
    c === "usuario"
  ) {
    return "VENDEDOR";
  }
  return (cargo || "").toString().trim().toUpperCase();
}

/** Bodeguero: umbral según ventas de la tienda. Demás cargos: ventas del trabajador. */
function usaFacturacionTiendaPorCargo(cargo) {
  return normalizarCargoDominical(cargo) === "BODEGUERO";
}

function resolverFacturacionNetaCalculoDominical(
  cargo,
  facturacionNetaTienda,
  facturacionTrab = {}
) {
  if (usaFacturacionTiendaPorCargo(cargo)) {
    return Number(facturacionNetaTienda) || 0;
  }
  return Number(facturacionTrab.facturacionNetaTrabajador) || 0;
}

function rangoDiaCalendario(fecha) {
  const inicio = new Date(fecha);
  inicio.setHours(0, 0, 0, 0);
  const fin = new Date(fecha);
  fin.setHours(23, 59, 59, 999);
  return { inicio, fin };
}

function esTransaccionDominical(transaccion) {
  const t = normalizarTexto(transaccion);
  return t === "dominical" || t.includes("pago dominical");
}

function filtroReglasDominicalAutorizadas(extra = {}) {
  return {
    estadoRegla: "Autorizada",
    tipoRegla: "A",
    tipoBeneficiario: "Interno",
    empleadoActivo: { $ne: false },
    $or: [
      { frecuencia: "Dominical" },
      { transaccionNomina: /^dominical$/i },
      { transaccionNomina: /pago dominical/i },
    ],
    ...extra,
  };
}

function rangoFechaProgramada(fecha) {
  const inicio = new Date(fecha);
  inicio.setHours(0, 0, 0, 0);
  const fin = new Date(fecha);
  fin.setHours(23, 59, 59, 999);
  return { inicio, fin };
}

async function buscarEventoProgramadoPendiente(reglaId, fechaDom) {
  if (!reglaId) return null;
  const { inicio, fin } = rangoFechaProgramada(fechaDom);
  return EventoPagoProgramado.findOne({
    reglaPagoId: reglaId,
    estado: { $in: ["Pendiente", "Parcial"] },
    fechaProgramada: { $gte: inicio, $lte: fin },
  });
}

async function marcarEventoProgramadoDominicalLiquidado(
  item,
  fechaDom,
  opciones,
  itemResult
) {
  const evento = await buscarEventoProgramadoPendiente(item.reglaId, fechaDom);
  if (!evento) return null;

  const montoBruto = Number(item.montoBruto) || 0;
  const montoNeto = Number(itemResult.montoNeto) || 0;
  const txId = itemResult.transaccion?._id;

  evento.monto = montoBruto;
  evento.montoPagado = montoNeto;
  evento.estado = "Ejecutado";
  evento.transaccionFinancieraId = txId || evento.transaccionFinancieraId;
  evento.ejecutadoPor = opciones.usuario || "";
  evento.fechaEjecucion = new Date();

  if (txId) {
    evento.pagosParciales = evento.pagosParciales || [];
    evento.pagosParciales.push({
      monto: montoNeto,
      fecha: new Date(),
      transaccionFinancieraId: txId,
      ejecutadoPor: opciones.usuario || "",
      notas: "Liquidación dominical masiva",
    });
  }

  await evento.save();
  return evento;
}

function inicioSemanaDomingo(fecha) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  const dia = d.getDay();
  d.setDate(d.getDate() - dia);
  return d;
}

function esDomingo(fecha) {
  return new Date(fecha).getDay() === 0;
}

async function obtenerConfigGlobal() {
  let config = await NominaConfigGlobal.findOne({ clave: CONFIG_CLAVE });
  if (!config) {
    config = await NominaConfigGlobal.create({ clave: CONFIG_CLAVE });
  }
  return config.toObject ? config.toObject() : config;
}

function calcularMontoPorCargo(cargo, facturacionNeta, calculoDominical) {
  const limite = Number(calculoDominical?.limiteFacturacion) || 1000;
  const cargoNorm = normalizarCargoDominical(cargo);
  const fila = (calculoDominical?.filas || []).find(
    (f) =>
      f.activo !== false &&
      normalizarCargoDominical(f.cargo) === cargoNorm
  );
  if (!fila) {
    throw new Error(
      `No hay tarifa de cálculo dominical para el cargo: ${cargo}`
    );
  }
  const superior = facturacionNeta >= limite;
  return {
    monto: superior ? fila.valorRangoSuperior : fila.valorRangoInferior,
    rangoAplicado: superior ? "superior" : "inferior",
    limiteFacturacion: limite,
    valorRangoInferior: fila.valorRangoInferior,
    valorRangoSuperior: fila.valorRangoSuperior,
    cargoNorm,
  };
}

function parseFechaDocumento(valor) {
  if (valor == null || valor === "") return null;
  if (valor instanceof Date && !isNaN(valor.getTime())) return new Date(valor);
  if (typeof valor === "number") {
    const d = new Date(valor);
    return isNaN(d.getTime()) ? null : d;
  }
  const texto = String(valor).trim();
  const iso = new Date(texto);
  if (!isNaN(iso.getTime())) return iso;
  const match = texto.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (match) {
    let anio = parseInt(match[3], 10);
    if (anio < 100) anio += 2000;
    const d = new Date(anio, parseInt(match[2], 10) - 1, parseInt(match[1], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function esFechaEnDia(valorFecha, fechaReferencia) {
  const doc = parseFechaDocumento(valorFecha);
  const ref = new Date(fechaReferencia);
  if (!doc || isNaN(ref.getTime())) return false;
  doc.setHours(0, 0, 0, 0);
  ref.setHours(0, 0, 0, 0);
  return doc.getTime() === ref.getTime();
}

function documentoVigente(doc) {
  const estado = (doc?.estado || "").toString().trim().toUpperCase();
  return estado !== "ANULADA";
}

/** Match estricto: username del documento = usuarioSistemaUsername del TMS */
function coincideUsernameTrabajador(documento, tms) {
  if (!tms?.usuarioSistemaUsername || !documento?.username) {
    return false;
  }
  return (
    normalizarTexto(documento.username) ===
    normalizarTexto(tms.usuarioSistemaUsername)
  );
}

function coincideDevolucionConTrabajador(devolucion, tms) {
  if (!tms?.usuarioSistemaUsername) return false;
  const usuarioDev = devolucion?.usuario || "";
  return (
    normalizarTexto(usuarioDev) ===
    normalizarTexto(tms.usuarioSistemaUsername)
  );
}

async function cargarDocumentosVentasDia(fecha, sucursal) {
  const { inicio, fin } = rangoDiaCalendario(fecha);
  const margenInicio = new Date(inicio);
  margenInicio.setDate(margenInicio.getDate() - 3);
  const margenFin = new Date(fin);
  margenFin.setDate(margenFin.getDate() + 3);
  const filtroMargen = { createdAt: { $gte: margenInicio, $lte: margenFin } };

  const filtroFactura = { ...filtroMargen };
  const filtroNota = { ...filtroMargen };
  if (sucursal) {
    filtroFactura.sucursal = sucursal;
    filtroNota.sucursal = sucursal;
  }

  const [facturasRaw, notasRaw, devolucionesRaw] = await Promise.all([
    Factura.find(filtroFactura).lean(),
    NotasVenta.find(filtroNota).lean(),
    Devoluciones.find(filtroMargen).lean(),
  ]);

  const facturas = facturasRaw.filter(
    (f) => documentoVigente(f) && esFechaEnDia(f.fecha, inicio)
  );
  const notas = notasRaw.filter(
    (n) => documentoVigente(n) && esFechaEnDia(n.fecha, inicio)
  );
  let devoluciones = devolucionesRaw.filter((d) =>
    esFechaEnDia(d.fecha || d.fecha_transaccion, inicio)
  );
  if (sucursal) {
    devoluciones = devoluciones.filter(
      (d) => !d.sucursal?.nombre || d.sucursal.nombre === sucursal
    );
  }

  return { inicio, facturas, notas, devoluciones };
}

function sumarTotalesVentas(facturas, notas) {
  const totalFacturas = facturas.reduce(
    (s, f) => s + (Number(f.total) || 0),
    0
  );
  const totalNotas = notas.reduce((s, n) => s + (Number(n.total) || 0), 0);
  return totalFacturas + totalNotas;
}

async function calcularFacturacionNetaDia(fecha, sucursal) {
  const { inicio, facturas, notas, devoluciones } =
    await cargarDocumentosVentasDia(fecha, sucursal);

  const facturacionBruta = sumarTotalesVentas(facturas, notas);
  const totalDevoluciones = devoluciones.reduce(
    (s, d) => s + (Number(d.totalDevolucion) || 0),
    0
  );

  return {
    fecha: inicio,
    facturacionBruta,
    devoluciones: totalDevoluciones,
    facturacionNeta: facturacionBruta - totalDevoluciones,
    cantidadFacturas: facturas.length,
    cantidadNotas: notas.length,
    cantidadDevoluciones: devoluciones.length,
    facturas,
    notas,
    devolucionesLista: devoluciones,
  };
}

async function calcularFacturacionTrabajadorDia(fecha, tms, sucursal) {
  const { inicio, facturas, notas, devoluciones } =
    await cargarDocumentosVentasDia(fecha, sucursal);

  if (!tms?.usuarioSistemaUsername) {
    return {
      fecha: inicio,
      facturacionBrutaTrabajador: 0,
      devolucionesTrabajador: 0,
      facturacionNetaTrabajador: 0,
      cantidadFacturasTrabajador: 0,
      cantidadNotasTrabajador: 0,
      vinculadoUsuario: false,
    };
  }

  const facturasTrab = facturas.filter((f) =>
    coincideUsernameTrabajador(f, tms)
  );
  const notasTrab = notas.filter((n) => coincideUsernameTrabajador(n, tms));
  const devsTrab = devoluciones.filter((d) =>
    coincideDevolucionConTrabajador(d, tms)
  );

  const facturacionBrutaTrabajador =
    sumarTotalesVentas(facturasTrab, notasTrab);
  const devolucionesTrabajador = devsTrab.reduce(
    (s, d) => s + (Number(d.totalDevolucion) || 0),
    0
  );

  return {
    fecha: inicio,
    facturacionBrutaTrabajador,
    devolucionesTrabajador,
    facturacionNetaTrabajador:
      facturacionBrutaTrabajador - devolucionesTrabajador,
    cantidadFacturasTrabajador: facturasTrab.length,
    cantidadNotasTrabajador: notasTrab.length,
    vinculadoUsuario: true,
    usuarioSistemaUsername: tms.usuarioSistemaUsername,
  };
}

async function simularLiquidacionDominical(fecha, opciones = {}) {
  const fechaDom = inicioSemanaDomingo(fecha);
  const config = await obtenerConfigGlobal();
  const facturacion = await calcularFacturacionNetaDia(
    fechaDom,
    opciones.sucursal
  );
  const reglas = await ReglaPagoNomina.find(
    filtroReglasDominicalAutorizadas()
  ).lean();

  const liquidaciones = [];
  for (const regla of reglas) {
    if (opciones.cedula && regla.cedulaBeneficiario !== opciones.cedula) {
      continue;
    }
    const tms = await TablaMaestraSalarial.findOne({
      cedula: regla.cedulaBeneficiario,
    }).lean();
    const cargo = tms?.cargo || regla.cargoNomina || "VENDEDOR";
    try {
      const facturacionTrab = await calcularFacturacionTrabajadorDia(
        fechaDom,
        tms,
        opciones.sucursal
      );
      const facturacionParaCalculo = resolverFacturacionNetaCalculoDominical(
        cargo,
        facturacion.facturacionNeta,
        facturacionTrab
      );
      const tarifa = calcularMontoPorCargo(
        cargo,
        facturacionParaCalculo,
        config.calculoDominical
      );
      const ajustesPendientes = await sumarAjustesPendientes(
        regla.cedulaBeneficiario
      );
      const eventoProgramado = await buscarEventoProgramadoPendiente(
        regla._id,
        fechaDom
      );
      const yaLiquidado = !!(await EventoPagoDominical.findOne({
        fechaDominical: facturacion.fecha,
        cedulaBeneficiario: regla.cedulaBeneficiario,
        estado: "Pagado",
      }));
      liquidaciones.push({
        reglaId: regla._id,
        cedula: regla.cedulaBeneficiario,
        nombre: regla.nombreBeneficiario,
        cargo,
        usuarioSistemaNombre: tms?.usuarioSistemaNombre || "",
        usuarioSistemaUsername: tms?.usuarioSistemaUsername || "",
        facturacionNetaTienda: facturacion.facturacionNeta,
        facturacionNetaTrabajador: facturacionTrab.facturacionNetaTrabajador,
        facturacionNetaCalculo: facturacionParaCalculo,
        baseCalculo: usaFacturacionTiendaPorCargo(cargo) ? "tienda" : "trabajador",
        vinculadoUsuario: facturacionTrab.vinculadoUsuario,
        ...tarifa,
        montoBruto: tarifa.monto,
        ajustesPendientes,
        montoNeto: Math.max(0, tarifa.monto - ajustesPendientes),
        yaLiquidado,
        eventoProgramadoPendiente: !!eventoProgramado,
        eventoProgramadoId: eventoProgramado?._id,
        sinEventoProgramado: !eventoProgramado && !yaLiquidado,
      });
    } catch (err) {
      liquidaciones.push({
        reglaId: regla._id,
        cedula: regla.cedulaBeneficiario,
        nombre: regla.nombreBeneficiario,
        cargo,
        error: err.message,
      });
    }
  }

  const facturacionResumen = { ...facturacion };
  delete facturacionResumen.facturas;
  delete facturacionResumen.notas;
  delete facturacionResumen.devolucionesLista;

  const pendientesLiquidar = liquidaciones.filter(
    (l) => !l.error && !l.yaLiquidado
  ).length;
  const conEventoProgramado = liquidaciones.filter(
    (l) => l.eventoProgramadoPendiente
  ).length;

  return {
    facturacion: facturacionResumen,
    limiteFacturacion: config.calculoDominical?.limiteFacturacion,
    liquidaciones,
    reglasActivas: reglas.length,
    pendientesLiquidar,
    conEventoProgramado,
    esDomingo: esDomingo(fecha),
    fechaDomingoUsada: fechaDom,
  };
}

async function sumarAjustesPendientes(cedula) {
  const ajustes = await AjusteNominaPendiente.find({
    cedulaBeneficiario: cedula,
    estado: "Pendiente",
  });
  return ajustes.reduce((s, a) => s + (Number(a.montoAjuste) || 0), 0);
}

async function crearTransaccionFinanciera(datos) {
  const tx = new TransaccionFinanciera(datos);
  await tx.save();
  return tx;
}

async function liquidarDominical(fecha, opciones = {}) {
  const fechaNormalizada = inicioSemanaDomingo(fecha);
  const simulacion = await simularLiquidacionDominical(
    fechaNormalizada,
    opciones
  );
  const resultados = [];
  const fechaDom = simulacion.facturacion.fecha;

  for (const item of simulacion.liquidaciones) {
    if (item.error || item.yaLiquidado) {
      resultados.push(item);
      continue;
    }
    const montoBruto = item.montoBruto;
    let ajustesAplicados = 0;
    if (opciones.aplicarAjustes !== false) {
      ajustesAplicados = await aplicarAjustesPendientes(
        item.cedula,
        fechaDom,
        opciones.usuario || ""
      );
    }
    const montoNeto = Math.max(0, montoBruto - ajustesAplicados);

    let txPago = null;
    if (montoNeto > 0) {
      txPago = await crearTransaccionFinanciera({
        fecha: new Date(),
        fechaContable: fechaDom,
        sucursal: opciones.sucursal || "",
        cliente: item.nombre,
        beneficiario: item.nombre,
        cedula: item.cedula,
        valor: montoNeto,
        tipoPago: "Egreso",
        subCuenta: SUB_CUENTA_PAGO,
        tipoTransaccion: TIPO_PAGO,
        notas: `Pago dominical ${fechaDom.toISOString().slice(0, 10)}. Facturación base cálculo $${item.facturacionNetaCalculo ?? simulacion.facturacion.facturacionNeta}. Rango ${item.rangoAplicado}.`,
        isContabilizada: false,
      });
    }

    const evento = new EventoPagoDominical({
      fechaDominical: fechaDom,
      cedulaBeneficiario: item.cedula,
      nombreBeneficiario: item.nombre,
      cargo: item.cargo,
      reglaPagoId: item.reglaId,
      facturacionBruta: simulacion.facturacion.facturacionBruta,
      devolucionesDia: simulacion.facturacion.devoluciones,
      facturacionNeta:
        item.facturacionNetaCalculo ?? simulacion.facturacion.facturacionNeta,
      limiteFacturacion: item.limiteFacturacion,
      valorRangoAplicado:
        item.rangoAplicado === "superior"
          ? item.valorRangoSuperior
          : item.valorRangoInferior,
      rangoAplicado: item.rangoAplicado,
      montoPagado: montoBruto,
      montoAjustesAplicados: ajustesAplicados,
      montoNetoPagado: montoNeto,
      transaccionPagoId: txPago?._id,
      estado: "Pagado",
      sucursal: opciones.sucursal || "",
      liquidadoPor: opciones.usuario || "",
    });
    await evento.save();
    const eventoProgramado = await marcarEventoProgramadoDominicalLiquidado(
      item,
      fechaDom,
      opciones,
      { ...item, evento, transaccion: txPago, montoNeto }
    );
    resultados.push({
      ...item,
      evento,
      transaccion: txPago,
      montoNeto,
      eventoProgramado,
    });
  }

  const liquidados = resultados.filter((r) => r.evento && !r.error).length;
  const omitidos = resultados.filter(
    (r) => r.error || r.yaLiquidado
  ).length;

  return { simulacion, resultados, liquidados, omitidos };
}

async function aplicarAjustesPendientes(cedula, fechaAplicacion, usuario) {
  const ajustes = await AjusteNominaPendiente.find({
    cedulaBeneficiario: cedula,
    estado: "Pendiente",
  });
  let total = 0;
  for (const aj of ajustes) {
    total += Number(aj.montoAjuste) || 0;
    const tx = await crearTransaccionFinanciera({
      fecha: new Date(),
      fechaContable: fechaAplicacion,
      cliente: aj.nombreBeneficiario,
      beneficiario: aj.nombreBeneficiario,
      cedula: aj.cedulaBeneficiario,
      valor: aj.montoAjuste,
      tipoPago: "Egreso",
      subCuenta: SUB_CUENTA_DESCUENTO,
      tipoTransaccion: TIPO_AJUSTE,
      notas:
        aj.motivo ||
        `Ajuste dominical por anulación. Domingo ${aj.fechaDominical?.toISOString?.().slice(0, 10) || ""}`,
      isContabilizada: false,
    });
    aj.estado = "Aplicado";
    aj.transaccionAjusteId = tx._id;
    aj.aplicadoPor = usuario;
    await aj.save();
  }
  return total;
}

async function procesarAjustesPorAnulacionFactura(factura, usuario) {
  if (!factura) return { procesado: false };
  const fechaVenta =
    parseFechaDocumento(factura.fecha) ||
    (factura.createdAt ? new Date(factura.createdAt) : new Date());
  const fechaDom = inicioSemanaDomingo(fechaVenta);

  const eventos = await EventoPagoDominical.find({
    fechaDominical: fechaDom,
    estado: "Pagado",
  });

  if (!eventos.length) {
    return { procesado: false, motivo: "Sin pagos dominicales ese domingo" };
  }

  const config = await obtenerConfigGlobal();
  const facturacion = await calcularFacturacionNetaDia(fechaDom);
  const ajustesGenerados = [];

  for (const evento of eventos) {
    const tms = await TablaMaestraSalarial.findOne({
      cedula: evento.cedulaBeneficiario,
    }).lean();
    const facturacionTrab = await calcularFacturacionTrabajadorDia(
      fechaDom,
      tms
    );
    const facturacionParaCalculo = resolverFacturacionNetaCalculoDominical(
      evento.cargo,
      facturacion.facturacionNeta,
      facturacionTrab
    );
    const tarifa = calcularMontoPorCargo(
      evento.cargo,
      facturacionParaCalculo,
      config.calculoDominical
    );
    const montoCorrecto = tarifa.monto;
    const montoPagado = Number(evento.montoPagado) || 0;
    const diferencia = montoPagado - montoCorrecto;

    if (diferencia > 0.009) {
      const existe = await AjusteNominaPendiente.findOne({
        eventoPagoDominicalId: evento._id,
        facturaAnuladaId: factura._id,
        estado: { $ne: "Cancelado" },
      });
      if (existe) continue;

      const ajuste = new AjusteNominaPendiente({
        cedulaBeneficiario: evento.cedulaBeneficiario,
        nombreBeneficiario: evento.nombreBeneficiario,
        fechaDominical: fechaDom,
        eventoPagoDominicalId: evento._id,
        facturaAnuladaId: factura._id,
        facturacionAnterior: evento.facturacionNeta,
        facturacionNueva: facturacionParaCalculo,
        montoPagadoAnterior: montoPagado,
        montoCorrecto,
        montoAjuste: diferencia,
        motivo: `Anulación factura ${factura.documento_n || factura._id}. Facturación para cálculo bajó de $${evento.facturacionNeta} a $${facturacionParaCalculo}. Se debitará $${diferencia} en el próximo pago.`,
      });
      await ajuste.save();
      ajustesGenerados.push(ajuste);
    }
  }

  return {
    procesado: true,
    fechaDominical: fechaDom,
    facturacionNueva: facturacion.facturacionNeta,
    ajustesGenerados,
  };
}

module.exports = {
  calcularFacturacionNetaDia,
  calcularFacturacionTrabajadorDia,
  coincideUsernameTrabajador,
  parseFechaDocumento,
  esFechaEnDia,
  calcularMontoPorCargo,
  resolverFacturacionNetaCalculoDominical,
  usaFacturacionTiendaPorCargo,
  simularLiquidacionDominical,
  liquidarDominical,
  procesarAjustesPorAnulacionFactura,
  sumarAjustesPendientes,
  esDomingo,
  normalizarCargoDominical,
};
