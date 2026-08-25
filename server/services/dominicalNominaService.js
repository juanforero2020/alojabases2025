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
const Cuenta = require("../models/cuentas");

const CONFIG_CLAVE = "principal";
const {
  CUENTA_GASTOS,
  CUENTA_INGRESOS,
  SUBCUENTAS_NOMINA,
} = require("../utils/cuentasContablesNomina");

const CUENTA_PAGO = CUENTA_GASTOS;
const SUB_CUENTA_PAGO = SUBCUENTAS_NOMINA.DOMINICALES;
const SUB_CUENTA_DESCUENTO = SUBCUENTAS_NOMINA.DESCUENTOS;
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

function claveFechaCalendario(valor) {
  if (valor == null || valor === "") return null;

  if (valor instanceof Date && !isNaN(valor.getTime())) {
    const iso = valor.toISOString().slice(0, 10);
    return iso;
  }

  const texto = String(valor).trim();
  const isoMatch = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const dmyMatch = texto.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmyMatch) {
    let dia = parseInt(dmyMatch[1], 10);
    let mes = parseInt(dmyMatch[2], 10);
    let anio = parseInt(dmyMatch[3], 10);
    if (anio < 100) anio += 2000;
    if (mes > 12 && dia <= 12) {
      const tmp = dia;
      dia = mes;
      mes = tmp;
    }
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  }

  const d = new Date(texto);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function fechaDesdeClave(clave) {
  if (!clave) return null;
  const [anio, mes, dia] = clave.split("-").map(Number);
  return new Date(anio, mes - 1, dia, 0, 0, 0, 0);
}

function parseFechaEntrada(fecha) {
  const clave = claveFechaCalendario(fecha);
  if (clave) return fechaDesdeClave(clave);
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return d;
}

function rangoDiaCalendario(fecha) {
  const inicio = parseFechaEntrada(fecha);
  const fin = new Date(inicio);
  fin.setHours(23, 59, 59, 999);
  return { inicio, fin };
}

function patronesTextoFecha(fecha) {
  const clave = claveFechaCalendario(fecha);
  if (!clave) return [];
  const [anio, mes, dia] = clave.split("-");
  const diaNum = String(Number(dia));
  const mesNum = String(Number(mes));
  return Array.from(
    new Set([
      clave,
      `${dia}/${mes}/${anio}`,
      `${diaNum}/${mesNum}/${anio}`,
      `${mes}/${dia}/${anio}`,
      `${mesNum}/${diaNum}/${anio}`,
    ])
  );
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
  return rangoDiaCalendario(fecha);
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
      notas: construirNotasPagoDominical(
        item,
        fechaDom,
        "Liquidación dominical masiva"
      ),
    });
  }

  await evento.save();
  return evento;
}

function inicioSemanaDomingo(fecha) {
  const d = parseFechaEntrada(fecha);
  const dia = d.getDay();
  d.setDate(d.getDate() - dia);
  d.setHours(0, 0, 0, 0);
  return d;
}

function esDomingo(fecha) {
  return parseFechaEntrada(fecha).getDay() === 0;
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
  const clave = claveFechaCalendario(valor);
  return clave ? fechaDesdeClave(clave) : null;
}

function esFechaEnDia(valorFecha, fechaReferencia) {
  const doc = claveFechaCalendario(valorFecha);
  const ref = claveFechaCalendario(fechaReferencia);
  return !!doc && !!ref && doc === ref;
}

function formatoFechaCorresponde(fecha) {
  const clave = claveFechaCalendario(fecha);
  if (!clave) return "sin fecha";
  const [anio, mes, dia] = clave.split("-");
  return `${dia}/${mes}/${anio}`;
}

function construirNotasPagoDominical(item, fechaDom, detalle = "", prefijo = "Pago dominical") {
  const nombre = (item?.nombre || item?.nombreBeneficiario || "").trim() || "Sin nombre";
  const usuario = (item?.usuarioSistemaUsername || "").trim();
  const quien = usuario ? `${nombre} (${usuario})` : nombre;
  const fechaCorresponde = formatoFechaCorresponde(fechaDom);
  let notas = `${prefijo} — ${quien} — fecha corresponde ${fechaCorresponde}`;
  if (detalle) {
    notas += `. ${detalle}`;
  }
  return notas;
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

function filtroDocumentosPorFecha(fecha) {
  const { inicio, fin } = rangoDiaCalendario(fecha);
  const margenInicio = new Date(inicio);
  margenInicio.setDate(margenInicio.getDate() - 15);
  const margenFin = new Date(fin);
  margenFin.setDate(margenFin.getDate() + 15);
  const patrones = patronesTextoFecha(inicio);
  const filtroFecha = patrones.map((p) => ({
    fecha: { $regex: p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") },
  }));
  return {
    $or: [
      ...filtroFecha,
      { createdAt: { $gte: margenInicio, $lte: margenFin } },
    ],
  };
}

async function cargarDocumentosVentasDia(fecha, sucursal) {
  const { inicio } = rangoDiaCalendario(fecha);
  const filtroBase = filtroDocumentosPorFecha(inicio);

  const filtroFactura = sucursal
    ? { $and: [filtroBase, { sucursal }] }
    : filtroBase;
  const filtroNota = sucursal
    ? { $and: [filtroBase, { sucursal }] }
    : filtroBase;

  const [facturasRaw, notasRaw, devolucionesRaw] = await Promise.all([
    Factura.find(filtroFactura).lean(),
    NotasVenta.find(filtroNota).lean(),
    Devoluciones.find(filtroBase).lean(),
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

async function calcularFacturacionNetaDia(fecha, sucursal, docsPrecargados) {
  const { inicio, facturas, notas, devoluciones } =
    docsPrecargados || (await cargarDocumentosVentasDia(fecha, sucursal));

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

async function calcularFacturacionTrabajadorDia(fecha, tms, sucursal, docsPrecargados) {
  const { inicio, facturas, notas, devoluciones } =
    docsPrecargados || (await cargarDocumentosVentasDia(fecha, sucursal));

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
  const documentosDia = await cargarDocumentosVentasDia(
    fechaDom,
    opciones.sucursal
  );
  const facturacion = await calcularFacturacionNetaDia(
    fechaDom,
    opciones.sucursal,
    documentosDia
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
        opciones.sucursal,
        documentosDia
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

async function resolverCuentaPagoDominical() {
  const cuentaDoc = await Cuenta.findOne({
    nombre: { $regex: /^1\.7\s+GASTOS OPERACIONALES/i },
  });
  return {
    cuenta: cuentaDoc?.nombre || CUENTA_PAGO,
    tipoCuenta: cuentaDoc?.tipoCuenta || "Salidas",
    subCuenta: SUB_CUENTA_PAGO,
  };
}

async function resolverCuentaDescuentoDominical() {
  const cuentaDoc = await Cuenta.findOne({
    nombre: { $regex: /^1\.3\s+INGRESOS/i },
  });
  return {
    cuenta: cuentaDoc?.nombre || CUENTA_INGRESOS,
    tipoCuenta: cuentaDoc?.tipoCuenta || "Ingresos",
    subCuenta: SUB_CUENTA_DESCUENTO,
  };
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
      const cuentaPago = await resolverCuentaPagoDominical();
      txPago = await crearTransaccionFinanciera({
        fecha: new Date(),
        fechaContable: fechaDom,
        sucursal: opciones.sucursal || "matriz",
        cliente: item.nombre,
        beneficiario: item.nombre,
        cedula: item.cedula,
        valor: montoNeto,
        tipoPago: "Egreso",
        cuenta: cuentaPago.cuenta,
        tipoCuenta: cuentaPago.tipoCuenta,
        subCuenta: cuentaPago.subCuenta,
        tipoTransaccion: TIPO_PAGO,
        notas: construirNotasPagoDominical(
          item,
          fechaDom,
          `Facturación base cálculo $${item.facturacionNetaCalculo ?? simulacion.facturacion.facturacionNeta}. Rango ${item.rangoAplicado}.`
        ),
        isContabilizada: true,
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
    const cuentaDesc = await resolverCuentaDescuentoDominical();
    const tx = await crearTransaccionFinanciera({
      fecha: new Date(),
      fechaContable: fechaAplicacion,
      cliente: aj.nombreBeneficiario,
      beneficiario: aj.nombreBeneficiario,
      cedula: aj.cedulaBeneficiario,
      valor: aj.montoAjuste,
      tipoPago: "Egreso",
      cuenta: cuentaDesc.cuenta,
      tipoCuenta: cuentaDesc.tipoCuenta,
      subCuenta: cuentaDesc.subCuenta,
      tipoTransaccion: TIPO_AJUSTE,
      notas: construirNotasPagoDominical(
        aj,
        aj.fechaDominical || fechaAplicacion,
        aj.motivo || "Ajuste dominical por anulación",
        "Ajuste dominical"
      ),
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
