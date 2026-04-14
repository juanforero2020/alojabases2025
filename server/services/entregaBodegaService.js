const EntregaBodega = require("../models/entregaBodega");

function normalizarNumero(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

function obtenerCantidadFacturada(item) {
  if (!item) return 0;
  const cantidad = normalizarNumero(item.cantidad);
  if (cantidad > 0) return cantidad;
  const m2 = normalizarNumero(item.cantM2);
  if (m2 > 0) return m2;
  const cajas = normalizarNumero(item.cajas);
  if (cajas > 0) return cajas;
  const piezas = normalizarNumero(item.piezas);
  return piezas > 0 ? piezas : 0;
}

/** Ítem vendido en m² con empaque caja+pieza (misma regla que ventas). */
function itemUsaMetrosCajaPieza(line) {
  if (line && line.esMetrosCajaPieza) return true;
  const p = line && line.producto;
  return (
    p &&
    String(p.UNIDAD) === "Metros" &&
    normalizarNumero(p.M2) > 0 &&
    normalizarNumero(p.P_CAJA) > 0
  );
}

function m2PorCajaDeLinea(line) {
  return (
    normalizarNumero(line.m2PorCaja) ||
    normalizarNumero(line.producto && line.producto.M2)
  );
}

function piezasPorCajaDeLinea(line) {
  return (
    normalizarNumero(line.piezasPorCaja) ||
    normalizarNumero(line.producto && line.producto.P_CAJA)
  );
}

/** m² totales desde cajas + piezas sueltas (pieza = M2/P_CAJA). */
function m2DesdeCajasPiezas(cajas, piezas, m2Caja, piezasCaja) {
  const mc = normalizarNumero(m2Caja);
  const pp = normalizarNumero(piezasCaja);
  if (mc <= 0 || pp <= 0) return 0;
  return (
    normalizarNumero(cajas) * mc + normalizarNumero(piezas) * (mc / pp)
  );
}

/** Descomposición m² → cajas + piezas (misma fórmula que ventas.component). */
function cajasPiezasDesdeM2(m2, m2Caja, piezasCaja) {
  const mc = normalizarNumero(m2Caja);
  const pp = normalizarNumero(piezasCaja);
  const m = normalizarNumero(m2);
  if (mc <= 0 || pp <= 0) return { cajas: 0, piezas: 0 };
  const cajas = Math.trunc((m + 0.01) / mc);
  const piezas = Math.trunc((m + 0.01) * pp / mc) - cajas * pp;
  return { cajas, piezas };
}

/** Total de piezas (enteras) desde descomposición m² → cajas + piezas. */
function piezasTotalesDesdeM2(m2, m2Caja, piezasCaja) {
  const pp = normalizarNumero(piezasCaja);
  if (pp <= 0) return 0;
  const { cajas, piezas } = cajasPiezasDesdeM2(m2, m2Caja, piezasCaja);
  return cajas * pp + piezas;
}

/**
 * Piezas facturadas: snapshot cajasFacturadas/piezasFacturadas o derivado del m² facturado.
 */
function piezasTotalesFacturadoSnapshot(item, m2Caja, piezasCaja) {
  const pp = normalizarNumero(piezasCaja);
  const mc = normalizarNumero(m2Caja);
  if (pp <= 0 || mc <= 0) return 0;
  const cf = normalizarNumero(item.cajasFacturadas);
  const pfl = normalizarNumero(item.piezasFacturadas);
  if (cf > 0 || pfl > 0) {
    return cf * pp + pfl;
  }
  return piezasTotalesDesdeM2(
    normalizarNumero(item.cantidadFacturada),
    mc,
    pp
  );
}

/** Tolerancia en m²: menos de media pieza (evita residuo imposible al cerrar). */
function umbralM2MediaPieza(m2Caja, piezasCaja) {
  const mc = normalizarNumero(m2Caja);
  const pp = normalizarNumero(piezasCaja);
  if (mc <= 0 || pp <= 0) return 0.05;
  return (mc / pp) * 0.501;
}

/**
 * Si entregado+devuelto ya cubren las mismas piezas que lo facturado pero el m² acumulado
 * queda por debajo del m² facturado (error de coma flotante), iguala entregado a facturado−devuelto.
 */
function normalizarEntregaMetroPorPiezas(item) {
  if (!item || !itemUsaMetrosCajaPieza(item)) return;
  const facturada = normalizarNumero(item.cantidadFacturada);
  const entregada = normalizarNumero(item.cantidadEntregada);
  const devuelta = normalizarNumero(item.cantidadDevuelta);
  const mc = m2PorCajaDeLinea(item);
  const pp = piezasPorCajaDeLinea(item);
  if (mc <= 0 || pp <= 0 || facturada <= 0) return;

  const pFact = piezasTotalesFacturadoSnapshot(item, mc, pp);
  const pEnt = piezasTotalesDesdeM2(entregada, mc, pp);
  const pDev = piezasTotalesDesdeM2(devuelta, mc, pp);
  const umbral = umbralM2MediaPieza(mc, pp);

  if (pEnt + pDev < pFact) return;
  if (entregada + devuelta > facturada + umbral) return;

  item.cantidadEntregada = facturada - devuelta;
}

/** Pendiente “lógico” para UI e indicadores (cerámica: 0 si piezas ya cubiertas). */
function pendienteVisualItem(item) {
  const facturada = normalizarNumero(item.cantidadFacturada);
  const entregada = normalizarNumero(item.cantidadEntregada);
  const devuelta = normalizarNumero(item.cantidadDevuelta);
  const base = facturada - entregada - devuelta;
  if (!itemUsaMetrosCajaPieza(item)) return base;
  const mc = m2PorCajaDeLinea(item);
  const pp = piezasPorCajaDeLinea(item);
  if (mc <= 0 || pp <= 0) return base;
  const pFact = piezasTotalesFacturadoSnapshot(item, mc, pp);
  const pEnt = piezasTotalesDesdeM2(entregada, mc, pp);
  const pDev = piezasTotalesDesdeM2(devuelta, mc, pp);
  const umbral = umbralM2MediaPieza(mc, pp);
  if (pEnt + pDev >= pFact && entregada + devuelta <= facturada + umbral) {
    return 0;
  }
  return base;
}

function construirItems(productosVendidos = []) {
  return (productosVendidos || [])
    .map((item) => {
      const cantidadFacturada = obtenerCantidadFacturada(item);
      const base = {
        producto: (item && item.producto) || item || {},
        productoNombre:
          (item && item.producto && item.producto.PRODUCTO) ||
          (item && item.producto && item.producto.REFERENCIA) ||
          (item && item.PRODUCTO) ||
          "Producto",
        cantidadFacturada,
        cantidadEntregada: 0,
        cantidadDevuelta: 0,
        estadoItem: "ABIERTA",
        fechaCompromiso: "",
        notas: "",
        historial: [],
        esMetrosCajaPieza: false,
        m2PorCaja: 0,
        piezasPorCaja: 0,
        cajasFacturadas: 0,
        piezasFacturadas: 0,
      };
      if (itemUsaMetrosCajaPieza(item) && cantidadFacturada > 0) {
        const mc = m2PorCajaDeLinea(item);
        const pp = piezasPorCajaDeLinea(item);
        const { cajas, piezas } = cajasPiezasDesdeM2(cantidadFacturada, mc, pp);
        base.esMetrosCajaPieza = true;
        base.m2PorCaja = mc;
        base.piezasPorCaja = pp;
        base.cajasFacturadas = cajas;
        base.piezasFacturadas = piezas;
      }
      return base;
    })
    .filter((x) => x.cantidadFacturada > 0);
}

function estadoProcesoDesdeItems(items = []) {
  const lista = items || [];
  if (!lista.length) return "ABIERTA";

  const sinMovimiento = lista.every(
    (item) =>
      normalizarNumero(item.cantidadEntregada) <= 0 &&
      normalizarNumero(item.cantidadDevuelta) <= 0
  );
  if (sinMovimiento) return "ABIERTA";

  const todoCuadrado = lista.every((item) => {
    const facturada = normalizarNumero(item.cantidadFacturada);
    const entregada = normalizarNumero(item.cantidadEntregada);
    const devuelta = normalizarNumero(item.cantidadDevuelta);
    if (facturada === entregada + devuelta) return true;
    return pendienteVisualItem(item) === 0;
  });
  return todoCuadrado ? "COMPLETO" : "NOVEDAD";
}

async function siguienteConsecutivo() {
  const ultimo = await EntregaBodega.findOne({}, { consecutivoEntrega: 1 })
    .sort({ consecutivoEntrega: -1 })
    .lean();
  return ((ultimo && ultimo.consecutivoEntrega) || 0) + 1;
}

async function crearOrdenDesdeDocumento({ tipoDocumento, documento }) {
  if (!documento || !documento._id) return null;

  const existente = await EntregaBodega.findOne({
    tipoDocumento,
    documentoMongoId: String(documento._id),
  });
  if (existente) return existente;

  const items = construirItems(documento.productosVendidos || []);
  if (!items.length) return null;

  const orden = new EntregaBodega({
    consecutivoEntrega: await siguienteConsecutivo(),
    tipoDocumento,
    documentoMongoId: String(documento._id),
    documentoNumero: normalizarNumero(documento.documento_n),
    sucursal: documento.sucursal || "",
    fechaDocumento: documento.fecha || documento.fecha2 || "",
    cliente: documento.cliente || {},
    clienteNombre:
      (documento.cliente && documento.cliente.cliente_nombre) ||
      (documento.cliente && documento.cliente.nombre) ||
      "",
    clienteRuc: (documento.cliente && documento.cliente.ruc) || "",
    estadoProceso: "ABIERTA",
    items,
    notas: "",
    trazabilidad: [
      {
        fecha: new Date().toISOString(),
        accion: "CREACION_AUTOMATICA",
        usuario: documento.username || "",
        detalle:
          "Orden creada automáticamente desde documento de venta/factura",
      },
    ],
  });

  try {
    await orden.save();
    return orden;
  } catch (error) {
    // Si fue creada por otra solicitud concurrente, retornamos la existente.
    if (error && error.code === 11000) {
      return EntregaBodega.findOne({
        tipoDocumento,
        documentoMongoId: String(documento._id),
      });
    }
    throw error;
  }
}

async function intentarAnularPorDocumento({ tipoDocumento, documentoMongoId, usuario }) {
  const orden = await EntregaBodega.findOne({
    tipoDocumento,
    documentoMongoId: String(documentoMongoId),
  });
  if (!orden) return { ok: true };

  if (orden.estadoProceso !== "ABIERTA") {
    return {
      ok: false,
      mensaje:
        "No se puede anular el documento porque la orden de bodega ya tiene gestión en curso.",
    };
  }

  orden.estadoProceso = "ANULADO";
  orden.trazabilidad = orden.trazabilidad || [];
  orden.trazabilidad.push({
    fecha: new Date().toISOString(),
    accion: "ANULACION_AUTOMATICA",
    usuario: usuario || "",
    detalle:
      "Documento anulado en módulo contable; se anuló automáticamente la orden de bodega.",
  });
  await orden.save();
  return { ok: true };
}

function recalcularEstadoYItems(orden) {
  orden.items = (orden.items || []).map((item) => {
    const itemObj = item.toObject ? item.toObject() : { ...item };
    normalizarEntregaMetroPorPiezas(itemObj);
    const facturada = normalizarNumero(itemObj.cantidadFacturada);
    const entregada = normalizarNumero(itemObj.cantidadEntregada);
    const devuelta = normalizarNumero(itemObj.cantidadDevuelta);
    if (facturada === entregada + devuelta || pendienteVisualItem(itemObj) === 0) {
      return { ...itemObj, estadoItem: "COMPLETO" };
    }
    if (entregada > 0 || devuelta > 0) {
      return { ...itemObj, estadoItem: "NOVEDAD" };
    }
    return { ...itemObj, estadoItem: "ABIERTA" };
  });

  if (orden.estadoProceso !== "CERRADO" && orden.estadoProceso !== "ANULADO") {
    orden.estadoProceso = estadoProcesoDesdeItems(orden.items);
  }
}

/**
 * Reproduce la secuencia de movimientos del historial (orden cronológico) para
 * recalcular cantidades del ítem y los acumulados guardados en cada fila.
 * Usado al corregir una entrada del historial ya persistida.
 */
function reconstruirItemDesdeHistorial(item) {
  const cantidadFacturada = normalizarNumero(item.cantidadFacturada);
  const usarMetro = itemUsaMetrosCajaPieza(item);
  const m2Caja = m2PorCajaDeLinea(item);
  const piezasCaja = piezasPorCajaDeLinea(item);

  const historial = (item.historial || []).map((h) => {
    const copy =
      h && typeof h.toObject === "function" ? h.toObject() : { ...h };
    delete copy.__historialIdx;
    delete copy.fechaFmt;
    return copy;
  });

  historial.sort((a, b) => {
    const ta = new Date(a.fecha || 0).getTime();
    const tb = new Date(b.fecha || 0).getTime();
    return ta - tb;
  });

  let entAntes = 0;
  let devAntes = 0;

  for (let i = 0; i < historial.length; i++) {
    const h = historial[i];
    const estado = String(h.estadoSeleccionado || "").toUpperCase();

    let m2Op = 0;
    let ent = entAntes;
    let dev = devAntes;

    if (estado === "ENTREGA_TOTAL") {
      ent = cantidadFacturada - devAntes;
      m2Op = Math.max(0, ent - entAntes);
      dev = devAntes;
      if (usarMetro) {
        const { cajas, piezas } = cajasPiezasDesdeM2(m2Op, m2Caja, piezasCaja);
        h.entregaCajas = cajas;
        h.entregaPiezas = piezas;
      }
    } else {
      if (usarMetro) {
        const cajas = normalizarNumero(h.entregaCajas);
        const piezas = normalizarNumero(h.entregaPiezas);
        m2Op = m2DesdeCajasPiezas(cajas, piezas, m2Caja, piezasCaja);
        const m2Directo = normalizarNumero(h.m2EntregadoEnEstaOperacion);
        if (m2Op <= 0 && m2Directo > 0) {
          m2Op = m2Directo;
        }
      } else {
        m2Op = normalizarNumero(h.m2EntregadoEnEstaOperacion);
      }
      ent = entAntes + m2Op;
      dev = devAntes;
      if (estado === "DEVOLUCION") {
        if (ent > cantidadFacturada + 1e-9) {
          throw new Error(
            "La corrección deja una entrega mayor a lo facturado en el historial."
          );
        }
        dev = Math.max(0, cantidadFacturada - ent);
      }
    }

    if (ent + dev > cantidadFacturada + 1e-6) {
      throw new Error(
        "La corrección produce entrega más devolución mayor a lo facturado."
      );
    }

    h.cantidadEntregada = ent;
    h.cantidadDevuelta = dev;
    h.m2EntregadoEnEstaOperacion = m2Op;

    entAntes = ent;
    devAntes = dev;
  }

  item.historial = historial;
  item.cantidadEntregada = entAntes;
  item.cantidadDevuelta = devAntes;
  normalizarEntregaMetroPorPiezas(item);
}

/** Misma fecha calendario (hora local del servidor) que la de hoy. */
function ordenEsMismoDiaCalendarioQueHoy(orden) {
  const raw = orden && (orden.fechaDocumento != null && orden.fechaDocumento !== ""
    ? orden.fechaDocumento
    : orden.createdAt);
  if (raw == null || raw === "") {
    return false;
  }
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return false;
  }
  const hoy = new Date();
  return (
    d.getFullYear() === hoy.getFullYear() &&
    d.getMonth() === hoy.getMonth() &&
    d.getDate() === hoy.getDate()
  );
}

/** Hay cantidades entregadas o devueltas registradas en la orden. */
function ordenTieneMovimientoEntrega(orden) {
  return (orden.items || []).some(
    (it) =>
      normalizarNumero(it.cantidadEntregada) > 0 ||
      normalizarNumero(it.cantidadDevuelta) > 0
  );
}

/**
 * Elimina historial por ítem, pone cantidades en cero y deja la orden como al inicio (ABIERTA).
 * Conserva al menos el evento CREACION_AUTOMATICA en trazabilidad de orden si existía.
 */
function aplicarDevolucionTotalResetOrden(orden, usuario) {
  (orden.items || []).forEach((item) => {
    item.cantidadEntregada = 0;
    item.cantidadDevuelta = 0;
    item.fechaCompromiso = "";
    item.notas = "";
    item.historial = [];
  });
  const traz = orden.trazabilidad || [];
  const creacion = traz.filter((t) => String(t.accion) === "CREACION_AUTOMATICA");
  orden.trazabilidad = [
    ...creacion.slice(0, 1),
    {
      fecha: new Date().toISOString(),
      usuario: usuario || "",
      accion: "DEVOLUCION_TOTAL_RESET",
      detalle:
        "Devolución total: se eliminó la trazabilidad de entregas y la orden volvió a estado ABIERTA.",
    },
  ];
  orden.solicitudDevolucionPendiente = false;
  orden.solicitudDevolucionUsuario = "";
  orden.solicitudDevolucionFecha = "";
  recalcularEstadoYItems(orden);
}

module.exports = {
  crearOrdenDesdeDocumento,
  intentarAnularPorDocumento,
  recalcularEstadoYItems,
  normalizarNumero,
  itemUsaMetrosCajaPieza,
  m2PorCajaDeLinea,
  piezasPorCajaDeLinea,
  m2DesdeCajasPiezas,
  cajasPiezasDesdeM2,
  normalizarEntregaMetroPorPiezas,
  pendienteVisualItem,
  reconstruirItemDesdeHistorial,
  ordenEsMismoDiaCalendarioQueHoy,
  ordenTieneMovimientoEntrega,
  aplicarDevolucionTotalResetOrden,
};
