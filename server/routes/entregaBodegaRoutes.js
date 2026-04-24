const { Router } = require("express");
const router = Router();
const EntregaBodega = require("../models/entregaBodega");
const ProductosPendientes = require("../models/productosPendientes");
const {
  recalcularEstadoYItems,
  normalizarNumero,
  pendienteVisualItem,
  itemUsaMetrosCajaPieza,
  m2PorCajaDeLinea,
  piezasPorCajaDeLinea,
  m2DesdeCajasPiezas,
  cajasPiezasDesdeM2,
  reconstruirItemDesdeHistorial,
  ordenEsMismoDiaCalendarioQueHoy,
  ordenTieneMovimientoEntrega,
  aplicarDevolucionTotalResetOrden,
} = require("../services/entregaBodegaService");

async function revertirPendientesPorDevolucionTotalOrden(orden, usuario) {
  const documento = normalizarNumero(orden && orden.documentoNumero);
  if (documento <= 0) return;
  try {
    await ProductosPendientes.updateMany(
      {
        documento,
        estado: "ENTREGADO",
        mensaje: {
          $regex: "Gestión Entregas de bodega",
          $options: "i",
        },
      },
      {
        $set: {
          estado: "PENDIENTE",
          mensaje: "Reabierto por devolución total (gestión entregas bodega)",
          usuario: usuario || "",
        },
      }
    );
  } catch (e) {
    console.log(
      "revertirPendientesPorDevolucionTotalOrden:",
      e && e.message ? e.message : e
    );
  }
}

/**
 * Alinea el registro legacy en `productosPendientes` con el ítem de la orden de bodega:
 * - Entrega parcial: actualiza cajas/piezas/m² pendientes y acumulados, y opcionalmente añade traza en `notas`.
 * - Sin pendiente (entrega total, devolución que deja el ítem cuadrado, etc.): estado ENTREGADO y sale del listado PENDIENTE.
 */
async function sincronizarProductoPendienteLegacyDesdeItem(
  orden,
  item,
  usuario,
  operacionMeta
) {
  const documento = normalizarNumero(orden && orden.documentoNumero);
  if (documento <= 0 || !item) return;

  const nombreProducto = String(
    (item.producto && item.producto.PRODUCTO) ||
      item.productoNombre ||
      (item.producto && item.producto.REFERENCIA) ||
      ""
  ).trim();
  if (!nombreProducto) return;

  const filtro = {
    documento,
    estado: "PENDIENTE",
    $or: [
      { "producto.PRODUCTO": nombreProducto },
      { "producto.REFERENCIA": nombreProducto },
    ],
  };

  const docs = await ProductosPendientes.find(filtro);
  if (!docs.length) return;

  const pendBase = pendienteVisualItem(item);
  const usarMetro = itemUsaMetrosCajaPieza(item);
  const mc = m2PorCajaDeLinea(item);
  const pp = piezasPorCajaDeLinea(item);
  const ent = normalizarNumero(item.cantidadEntregada);
  const dev = normalizarNumero(item.cantidadDevuelta);

  const meta = operacionMeta || {};
  const m2Op = normalizarNumero(meta.m2EnEstaOperacion);
  const m2FisicaOp = normalizarNumero(meta.devolucionFisicaEnEstaOperacion);
  const estMeta = String(meta.estadoSeleccionado || "").toUpperCase();
  const debeRegistrarTraza =
    meta.origen === "edicion_historial" ||
    meta.origen === "devoluciones" ||
    m2Op > 1e-6 ||
    estMeta === "ENTREGA_TOTAL" ||
    estMeta === "DEVOLUCION" ||
    estMeta === "DEVUELTO";

  /**
   * En el listado legacy "productosPendientesEntrega", la devolución física también
   * debe reducir pendiente operativo aunque no incremente `cantidadDevuelta` del ítem.
   */
  let pend = pendBase;
  if (meta.origen === "devoluciones" && m2FisicaOp > 0) {
    pend = Math.max(0, pendBase - m2FisicaOp);
  }
  const pendOperativo = Math.max(0, pend);

  let lineaTraza = "";
  if (debeRegistrarTraza) {
    const fechaStr = new Date().toLocaleString("es-EC", {
      timeZone: "America/Guayaquil",
    });
    let detalleOp = "";
    if (meta.origen === "edicion_historial") {
      detalleOp = "Corrección de historial en ítem.";
    } else if (meta.origen === "devoluciones") {
      detalleOp = usarMetro
        ? `Devolución aprobada (módulo devoluciones): ${m2Op.toFixed(
            2
          )} m² registrados en trazabilidad.`
        : `Devolución aprobada (módulo devoluciones): ${m2Op.toFixed(
            0
          )} u. registradas en trazabilidad.`;
    } else if (usarMetro && mc > 0 && pp > 0) {
      const { cajas: dc, piezas: dp } = cajasPiezasDesdeM2(
        Math.max(0, m2Op),
        mc,
        pp
      );
      detalleOp = `${estMeta || "MOVIMIENTO"}: +${m2Op.toFixed(
        2
      )} m² (${dc} cj + ${dp} pz).`;
    } else {
      detalleOp = `${estMeta || "MOVIMIENTO"}: +${m2Op.toFixed(3)} u.`;
    }
    lineaTraza = `\n[${fechaStr}] Gestión entregas bodega. ${detalleOp} Pendiente según orden: ${pendOperativo.toFixed(
      3
    )}. Entregado acum.: ${ent.toFixed(3)}. Devuelto acum.: ${dev.toFixed(
      3
    )}. Usuario: ${usuario || "—"}.`;
  }

  for (const doc of docs) {
    const notasBase = (doc.notas != null ? String(doc.notas) : "").trim();
    const notasNuevas = notasBase + (lineaTraza || "");
    let pendLegacyActual = 0;
    if (usarMetro && mc > 0 && pp > 0) {
      const cantM2Legacy = normalizarNumero(doc?.cantM2);
      pendLegacyActual =
        cantM2Legacy > 0
          ? cantM2Legacy
          : m2DesdeCajasPiezas(doc?.cajas, doc?.piezas, mc, pp);
    } else {
      pendLegacyActual = normalizarNumero(
        doc?.cajas != null ? doc.cajas : doc?.cantM2
      );
    }
    /**
     * Regla de sincronización legacy:
     * - No cerrar/restar directo por `m2Op`.
     * - Usar facturado real del ítem y entregado acumulado para detectar sobreentrega
     *   frente al pendiente legacy actual.
     *   restanteEsperadoLegacy = facturado - pendienteLegacyActual
     *   si entregado > restanteEsperadoLegacy => el exceso reduce pendiente legacy.
     */
    const facturadaItem = Math.max(0, normalizarNumero(item?.cantidadFacturada));
    let pendLegacyTrasOperacion = pendLegacyActual;
    if (facturadaItem > 0 && pendLegacyActual > 0) {
      const restanteEsperadoLegacy = Math.max(0, facturadaItem - pendLegacyActual);
      const excesoEntrega =
        ent > restanteEsperadoLegacy ? ent - restanteEsperadoLegacy : 0;
      if (excesoEntrega > 0) {
        pendLegacyTrasOperacion = Math.max(0, pendLegacyActual - excesoEntrega);
      }
    }
    const pendFinal = Math.max(
      0,
      Math.min(pendOperativo, pendLegacyTrasOperacion)
    );
    const cierre = pendFinal <= 1e-6;

    if (cierre) {
      const cpEnt =
        usarMetro && mc > 0 && pp > 0
          ? cajasPiezasDesdeM2(ent, mc, pp)
          : { cajas: ent, piezas: 0 };
      await ProductosPendientes.findByIdAndUpdate(doc._id, {
        $set: {
          estado: "ENTREGADO",
          cajas: 0,
          piezas: 0,
          cantM2: 0,
          m2Entregados: ent,
          cajasEntregadas: cpEnt.cajas,
          piezasEntregadas: cpEnt.piezas,
          mensaje:
            "Ítem sin pendiente (entrega/devolución según orden). Sincronizado desde Gestión Entregas de bodega.",
          usuario: usuario || "",
          notas: notasNuevas,
        },
      });
    } else {
      let nuevasCajas = 0;
      let nuevasPiezas = 0;
      let nuevoCantM2 = pendFinal;
      if (usarMetro && mc > 0 && pp > 0) {
        const cp = cajasPiezasDesdeM2(pendFinal, mc, pp);
        nuevasCajas = cp.cajas;
        nuevasPiezas = cp.piezas;
        nuevoCantM2 = pendFinal;
      } else {
        nuevasCajas = pendFinal;
        nuevasPiezas = 0;
        nuevoCantM2 = 0;
      }
      const cpEnt =
        usarMetro && mc > 0 && pp > 0
          ? cajasPiezasDesdeM2(ent, mc, pp)
          : { cajas: ent, piezas: 0 };
      await ProductosPendientes.findByIdAndUpdate(doc._id, {
        $set: {
          cajas: nuevasCajas,
          piezas: nuevasPiezas,
          cantM2: nuevoCantM2,
          m2Entregados: ent,
          cajasEntregadas: cpEnt.cajas,
          piezasEntregadas: cpEnt.piezas,
          mensaje:
            "Actualizado desde Gestión Entregas de bodega (entrega o movimiento parcial).",
          usuario: usuario || "",
          notas: notasNuevas,
        },
      });
    }
  }
}

/**
 * Cantidad devuelta en la misma unidad que `cantidadFacturada` del ítem de la orden (m² si es cerámica; unidades si no).
 * En el módulo de devoluciones, productos por unidad suelen dejar `cantDevueltam2` en 0 y capturar todo en cajas/piezas.
 */
function cantidadDevolucionDesdePayload(pd, item) {
  const usarMetro = itemUsaMetrosCajaPieza(item);
  let cant = 0;
  if (usarMetro) {
    const cc = normalizarNumero(pd.cantDevueltaCajas);
    const pp = normalizarNumero(pd.cantDevueltaPiezas);
    const m2Caja = m2PorCajaDeLinea(item);
    const piezasCaja = piezasPorCajaDeLinea(item);
    cant = m2DesdeCajasPiezas(cc, pp, m2Caja, piezasCaja);
    const m2Body = normalizarNumero(
      pd.cantDevueltam2Flo != null ? pd.cantDevueltam2Flo : pd.cantDevueltam2
    );
    if (cant <= 0 && m2Body > 0) {
      cant = m2Body;
    }
  } else {
    cant = normalizarNumero(
      pd.cantDevueltam2Flo != null ? pd.cantDevueltam2Flo : pd.cantDevueltam2
    );
    if (cant <= 0) {
      const pLine = pd && pd.producto;
      const piezasPorCajaProd = normalizarNumero(pLine && pLine.P_CAJA);
      const cc = normalizarNumero(pd.cantDevueltaCajas);
      const pc = normalizarNumero(pd.cantDevueltaPiezas);
      if (piezasPorCajaProd > 0) {
        cant = cc * piezasPorCajaProd + pc;
      } else if (cc > 0 || pc > 0) {
        cant = cc + pc;
      }
    }
  }
  return cant;
}

/**
 * Separa una devolución aprobada en dos componentes:
 * - virtual: cubre solo lo pendiente por entregar (facturado - entregado - devuelto acumulado).
 * - fisica: exceso sobre lo pendiente, limitado por lo entregado.
 *
 * Reglas:
 * 1) virtual <= (facturado - entregado - devueltoActual)
 * 2) fisica <= entregado
 * 3) virtual + fisica <= facturado
 */
function separarDevolucionVirtualFisica({
  cantidadSolicitada,
  facturada,
  entregada,
  devueltaActual,
  tipoSolicitado = "",
}) {
  const solicitada = Math.max(0, normalizarNumero(cantidadSolicitada));
  const f = Math.max(0, normalizarNumero(facturada));
  const e = Math.max(0, normalizarNumero(entregada));
  const d = Math.max(0, normalizarNumero(devueltaActual));
  const tipo = String(tipoSolicitado || "").trim().toUpperCase();

  // Tope global por ítem/documento en esta operación.
  const totalPermitido = Math.max(0, f - d);
  const aplicable = Math.min(solicitada, totalPermitido);
  const pendienteVirtual = Math.max(0, f - e - d);

  // Si el módulo de devoluciones envía tipo explícito, se respeta.
  if (tipo === "FISICA") {
    const fisica = Math.min(aplicable, e);
    return {
      virtual: 0,
      fisica,
      aplicadoTotal: fisica,
      solicitado: solicitada,
      truncadoPorTope: solicitada - fisica > 1e-6,
    };
  }
  if (tipo === "VIRTUAL") {
    const virtual = Math.min(aplicable, pendienteVirtual);
    return {
      virtual,
      fisica: 0,
      aplicadoTotal: virtual,
      solicitado: solicitada,
      truncadoPorTope: solicitada - virtual > 1e-6,
    };
  }

  // Fallback legacy (sin tipo): separar automáticamente.
  const virtual = Math.min(aplicable, pendienteVirtual);

  // Parte física: excedente sobre pendiente, limitado por lo entregado.
  const excedente = Math.max(0, aplicable - virtual);
  const fisica = Math.min(excedente, e);

  return {
    virtual,
    fisica,
    aplicadoTotal: virtual + fisica,
    solicitado: solicitada,
    truncadoPorTope: solicitada - aplicable > 1e-6,
  };
}

function normalizarTipoSolicitado(pd = {}) {
  const tipo = String(
    pd.tipoDevolucion != null ? pd.tipoDevolucion : pd.tipo_devolucion != null ? pd.tipo_devolucion : ""
  )
    .trim()
    .toUpperCase();
  if (tipo === "FISICA" || tipo === "FÍSICA") {
    return "FISICA";
  }
  if (tipo === "VIRTUAL") {
    return "VIRTUAL";
  }
  return "";
}

function construirPrevisualizacionDevolucion(orden, productosDevueltos = []) {
  const detalleAdvertencias = [];
  const detallePreview = [];

  for (const pd of productosDevueltos) {
    const pLine = pd && pd.producto;
    const codigo = pLine && String(pLine.PRODUCTO || "").trim();
    if (!codigo) continue;

    const idx = (orden.items || []).findIndex((it) => {
      const nom = String(
        (it.producto && it.producto.PRODUCTO) || it.productoNombre || ""
      ).trim();
      return nom === codigo;
    });

    if (idx < 0) {
      detalleAdvertencias.push(`${codigo}: no figura en la orden de entrega.`);
      continue;
    }

    const item = orden.items[idx];
    const cantidadFacturada = normalizarNumero(item.cantidadFacturada);
    const entregadaActual = normalizarNumero(item.cantidadEntregada);
    const devueltaActual = normalizarNumero(item.cantidadDevuelta);
    const solicitada = cantidadDevolucionDesdePayload(pd, item);
    if (solicitada <= 0) continue;

    const split = separarDevolucionVirtualFisica({
      cantidadSolicitada: solicitada,
      facturada: cantidadFacturada,
      entregada: entregadaActual,
      devueltaActual,
      tipoSolicitado: normalizarTipoSolicitado(pd),
    });

    if (split.aplicadoTotal <= 0) {
      detalleAdvertencias.push(
        `${codigo}: sin cupo en la orden (fact. ${cantidadFacturada}, ent. ${entregadaActual}, dev. ${devueltaActual}).`
      );
      continue;
    }

    if (split.truncadoPorTope) {
      detalleAdvertencias.push(
        `${codigo}: se registrará ${split.aplicadoTotal.toFixed(2)} de ${solicitada.toFixed(
          2
        )} (tope total según facturado).`
      );
    }

    detallePreview.push({
      producto: codigo,
      solicitada,
      virtual: split.virtual,
      fisica: split.fisica,
      aplicadoTotal: split.aplicadoTotal,
      facturada: cantidadFacturada,
      entregada: entregadaActual,
      devueltaActual,
      devueltaResultante: devueltaActual + split.virtual,
    });
  }

  const totales = detallePreview.reduce(
    (acc, it) => {
      acc.solicitada += normalizarNumero(it.solicitada);
      acc.virtual += normalizarNumero(it.virtual);
      acc.fisica += normalizarNumero(it.fisica);
      acc.aplicadoTotal += normalizarNumero(it.aplicadoTotal);
      return acc;
    },
    { solicitada: 0, virtual: 0, fisica: 0, aplicadoTotal: 0 }
  );

  return { detallePreview, detalleAdvertencias, totales };
}

/**
 * Mismo criterio para getPendientes (POST) y buscar: filtra en MongoDB.
 */
function construirFiltroConsulta(body) {
  const {
    documentoNumero,
    cliente,
    fechaDesde,
    fechaHasta,
    /** "gestion" = órdenes activas y listas para cierre (ABIERTA, NOVEDAD, COMPLETO). "listado" = todos los estados. */
    modoConsulta = "gestion",
  } = body || {};

  const filtro = {};
  if (modoConsulta === "gestion") {
    filtro.estadoProceso = { $in: ["ABIERTA", "NOVEDAD", "COMPLETO"] };
  }
  /* listado: sin filtro por estado → COMPLETO, CERRADO, ANULADO, etc. */

  if (
    documentoNumero !== undefined &&
    documentoNumero !== null &&
    documentoNumero !== ""
  ) {
    const docNum = normalizarNumero(documentoNumero);
    if (docNum > 0) {
      filtro.documentoNumero = docNum;
    }
  }

  const clienteStr = cliente != null ? String(cliente).trim() : "";
  if (clienteStr.length > 0) {
    filtro.clienteNombre = { $regex: clienteStr, $options: "i" };
  }

  if (fechaDesde || fechaHasta) {
    filtro.createdAt = {};
    if (fechaDesde) {
      const inicio = new Date(fechaDesde);
      inicio.setHours(0, 0, 0, 0);
      filtro.createdAt.$gte = inicio;
    }
    if (fechaHasta) {
      const fin = new Date(fechaHasta);
      fin.setHours(23, 59, 59, 999);
      filtro.createdAt.$lte = fin;
    }
  }

  return filtro;
}

async function ejecutarConsultaOrdenes(req, res) {
  try {
    const filtro = construirFiltroConsulta(req.body);
    const ordenes = await EntregaBodega.find(filtro).sort({ createdAt: -1 });
    /**
     * Autocorrección m² en cerámica/porcelanato: si las piezas ya cubren lo facturado
     * pero quedó residuo por coma flotante, recalcula y persiste (solo órdenes no finales).
     */
    for (let i = 0; i < ordenes.length; i++) {
      const orden = ordenes[i];
      if (orden.estadoProceso === "CERRADO" || orden.estadoProceso === "ANULADO") {
        continue;
      }
      const antesEnt = (orden.items || []).map((it) =>
        normalizarNumero(it.cantidadEntregada)
      );
      const antesEstIt = (orden.items || []).map((it) => it.estadoItem);
      const antesProc = orden.estadoProceso;
      recalcularEstadoYItems(orden);
      const despuesEnt = (orden.items || []).map((it) =>
        normalizarNumero(it.cantidadEntregada)
      );
      const despuesEstIt = (orden.items || []).map((it) => it.estadoItem);
      const cambio =
        JSON.stringify(antesEnt) !== JSON.stringify(despuesEnt) ||
        JSON.stringify(antesEstIt) !== JSON.stringify(despuesEstIt) ||
        antesProc !== orden.estadoProceso;
      if (cambio) {
        await orden.save();
      }
    }
    res.json(ordenes);
  } catch (err) {
    res.status(500).json({ mensaje: "Error al consultar órdenes de bodega" });
  }
}

/** Filtros en BD (documento, cliente, fechas, incluirCerradas). Body igual que /buscar. */
router.post("/getPendientes", ejecutarConsultaOrdenes);

router.post("/buscar", ejecutarConsultaOrdenes);

/**
 * Listado informativo para el home (solo lectura).
 * tipo: abiertas | novedad | compromisos-vencidos
 */
router.get("/indicadores/detalle/:tipo", async (req, res) => {
  try {
    const tipo = String(req.params.tipo || "")
      .toLowerCase()
      .replace(/_/g, "-");
    const camposOrden = {
      consecutivoEntrega: 1,
      documentoNumero: 1,
      tipoDocumento: 1,
      clienteNombre: 1,
      clienteRuc: 1,
      estadoProceso: 1,
      fechaDocumento: 1,
    };

    if (tipo === "abiertas") {
      const ordenes = await EntregaBodega.find({ estadoProceso: "ABIERTA" })
        .sort({ createdAt: -1 })
        .select(camposOrden)
        .lean();
      return res.json(ordenes);
    }

    if (tipo === "novedad") {
      const ordenes = await EntregaBodega.find({ estadoProceso: "NOVEDAD" })
        .sort({ createdAt: -1 })
        .select(camposOrden)
        .lean();
      return res.json(ordenes);
    }

    if (tipo === "compromisos-vencidos") {
      const hoy = new Date();
      const ordenes = await EntregaBodega.find({
        estadoProceso: { $in: ["ABIERTA", "NOVEDAD", "COMPLETO"] },
      })
        .sort({ createdAt: -1 })
        .select({ ...camposOrden, items: 1 })
        .lean();

      const resultado = [];
      for (const orden of ordenes) {
        const lineas = [];
        (orden.items || []).forEach((item) => {
          const pendiente = pendienteVisualItem(item);
          if (!item.fechaCompromiso || pendiente <= 0) return;
          const fechaCompromiso = new Date(item.fechaCompromiso);
          if (
            !Number.isNaN(fechaCompromiso.getTime()) &&
            fechaCompromiso < hoy
          ) {
            lineas.push({
              productoNombre: item.productoNombre || "—",
              fechaCompromiso: item.fechaCompromiso,
            });
          }
        });
        if (lineas.length) {
          resultado.push({
            consecutivoEntrega: orden.consecutivoEntrega,
            documentoNumero: orden.documentoNumero,
            tipoDocumento: orden.tipoDocumento,
            clienteNombre: orden.clienteNombre,
            clienteRuc: orden.clienteRuc,
            estadoProceso: orden.estadoProceso,
            fechaDocumento: orden.fechaDocumento,
            lineasCompromisoVencido: lineas,
          });
        }
      }
      return res.json(resultado);
    }

    return res.status(400).json({ mensaje: "Tipo de indicador no válido" });
  } catch (err) {
    res
      .status(500)
      .json({ mensaje: "Error al obtener el detalle de indicadores" });
  }
});

router.get("/indicadores", async (req, res) => {
  const [abiertas, novedad, completo, cerradas, ordenesActivas] = await Promise.all([
    EntregaBodega.countDocuments({ estadoProceso: "ABIERTA" }),
    EntregaBodega.countDocuments({ estadoProceso: "NOVEDAD" }),
    EntregaBodega.countDocuments({ estadoProceso: "COMPLETO" }),
    EntregaBodega.countDocuments({ estadoProceso: "CERRADO" }),
    EntregaBodega.find({
      estadoProceso: { $in: ["ABIERTA", "NOVEDAD", "COMPLETO"] },
    }).select({ items: 1 }),
  ]);

  const hoy = new Date();
  let compromisosVencidos = 0;
  (ordenesActivas || []).forEach((orden) => {
    (orden.items || []).forEach((item) => {
      const pendiente = pendienteVisualItem(item);
      if (!item.fechaCompromiso || pendiente <= 0) return;
      const fechaCompromiso = new Date(item.fechaCompromiso);
      if (!Number.isNaN(fechaCompromiso.getTime()) && fechaCompromiso < hoy) {
        compromisosVencidos += 1;
      }
    });
  });

  res.json({
    abiertas,
    novedad,
    completo,
    cerradas,
    compromisosVencidos,
  });
});

router.put("/actualizarItem/:id/:itemIndex", async (req, res) => {
  const { id, itemIndex } = req.params;
  const index = Number(itemIndex);
  const orden = await EntregaBodega.findById(id);
  if (!orden) {
    return res.status(404).json({ mensaje: "Orden no encontrada" });
  }
  if (orden.estadoProceso === "CERRADO" || orden.estadoProceso === "ANULADO") {
    return res
      .status(409)
      .json({ mensaje: "La orden está cerrada o anulada y no permite edición" });
  }
  if (!orden.items[index]) {
    return res.status(400).json({ mensaje: "Ítem inválido" });
  }

  const item = orden.items[index];
  const cantidadFacturada = normalizarNumero(item.cantidadFacturada);
  const estadoSeleccionado = String(req.body.estadoItem || "").toUpperCase();
  const notas = req.body.notas || "";
  const fechaCompromiso = req.body.fechaCompromiso || "";
  const usuario = req.body.usuario || "";
  const entregadaActual = normalizarNumero(item.cantidadEntregada);
  const devueltaActual = normalizarNumero(item.cantidadDevuelta);
  const usarMetro = itemUsaMetrosCajaPieza(item);

  let m2Incremental = 0;
  let entregaCajasRegistro = 0;
  let entregaPiezasRegistro = 0;
  if (estadoSeleccionado !== "ENTREGA_TOTAL") {
    if (usarMetro) {
      entregaCajasRegistro = normalizarNumero(req.body.entregaCajas);
      entregaPiezasRegistro = normalizarNumero(req.body.entregaPiezas);
      if (entregaCajasRegistro < 0 || entregaPiezasRegistro < 0) {
        return res.status(400).json({
          mensaje: "Las cajas y piezas a entregar no pueden ser negativas.",
        });
      }
      const m2Caja = m2PorCajaDeLinea(item);
      const piezasCaja = piezasPorCajaDeLinea(item);
      m2Incremental = m2DesdeCajasPiezas(
        entregaCajasRegistro,
        entregaPiezasRegistro,
        m2Caja,
        piezasCaja
      );
      const m2Directo = normalizarNumero(req.body.cantidadEntregada);
      if (m2Incremental <= 0 && m2Directo > 0) {
        m2Incremental = m2Directo;
      }
    } else {
      m2Incremental = normalizarNumero(req.body.cantidadEntregada);
    }
  }

  if (m2Incremental < 0) {
    return res
      .status(400)
      .json({ mensaje: "La cantidad a entregar no puede ser negativa." });
  }

  let nuevaCantidadEntregada = entregadaActual + m2Incremental;
  let nuevaCantidadDevuelta = devueltaActual;

  if (estadoSeleccionado === "ENTREGA_TOTAL") {
    nuevaCantidadEntregada = cantidadFacturada - devueltaActual;
  }

  if (estadoSeleccionado === "DEVOLUCION") {
    if (nuevaCantidadEntregada > cantidadFacturada) {
      return res.status(400).json({
        mensaje:
          "La cantidad ingresada excede la cantidad pendiente por entregar.",
      });
    }
    nuevaCantidadDevuelta = Math.max(0, cantidadFacturada - nuevaCantidadEntregada);
  }

  const maximoEntregable = cantidadFacturada - nuevaCantidadDevuelta;
  if (nuevaCantidadEntregada > maximoEntregable) {
    const exceso = nuevaCantidadEntregada - maximoEntregable;
    let excesoPermitido = 0.005;
    if (usarMetro) {
      const m2Caja = m2PorCajaDeLinea(item);
      const piezasCaja = piezasPorCajaDeLinea(item);
      if (m2Caja > 0 && piezasCaja > 0) {
        // Permite un exceso de hasta 1 pieza por redondeo/conversión.
        excesoPermitido = m2Caja / piezasCaja + 0.005;
      }
    }
    if (exceso <= excesoPermitido) {
      nuevaCantidadEntregada = maximoEntregable;
    } else {
      return res.status(400).json({
        mensaje:
          "La cantidad ingresada excede la cantidad pendiente por entregar.",
      });
    }
  }

  item.cantidadEntregada = nuevaCantidadEntregada;
  item.cantidadDevuelta = nuevaCantidadDevuelta;

  const pendiente = cantidadFacturada - item.cantidadEntregada - item.cantidadDevuelta;
  if (pendiente < 0) {
    return res
      .status(400)
      .json({ mensaje: "La suma de entregadas y devueltas supera lo facturado" });
  }

  item.notas = notas;
  item.fechaCompromiso = fechaCompromiso;
  item.historial = item.historial || [];
  const m2EnEstaOperacion =
    estadoSeleccionado === "ENTREGA_TOTAL"
      ? Math.max(0, cantidadFacturada - devueltaActual - entregadaActual)
      : Math.max(0, nuevaCantidadEntregada - entregadaActual);
  if (usarMetro && estadoSeleccionado !== "ENTREGA_TOTAL") {
    const m2Caja = m2PorCajaDeLinea(item);
    const piezasCaja = piezasPorCajaDeLinea(item);
    if (m2Caja > 0 && piezasCaja > 0) {
      const cpReg = cajasPiezasDesdeM2(m2EnEstaOperacion, m2Caja, piezasCaja);
      entregaCajasRegistro = cpReg.cajas;
      entregaPiezasRegistro = cpReg.piezas;
    }
  }
  item.historial.push({
    fecha: new Date().toISOString(),
    usuario,
    accion: "ACTUALIZACION_ITEM",
    estadoSeleccionado,
    cantidadEntregada: item.cantidadEntregada,
    cantidadDevuelta: item.cantidadDevuelta,
    m2EntregadoEnEstaOperacion: m2EnEstaOperacion,
    entregaCajas: usarMetro ? entregaCajasRegistro : undefined,
    entregaPiezas: usarMetro ? entregaPiezasRegistro : undefined,
    notas,
  });

  orden.trazabilidad = orden.trazabilidad || [];
  orden.trazabilidad.push({
    fecha: new Date().toISOString(),
    usuario,
    accion: "ACTUALIZACION_ITEM",
    detalle: `Actualización del ítem #${index + 1}`,
  });

  recalcularEstadoYItems(orden);
  const itemActualizado = orden.items[index];
  try {
    await sincronizarProductoPendienteLegacyDesdeItem(
      orden,
      itemActualizado,
      usuario,
      {
        m2EnEstaOperacion: m2EnEstaOperacion,
        estadoSeleccionado,
        entregaCajas: entregaCajasRegistro,
        entregaPiezas: entregaPiezasRegistro,
      }
    );
  } catch (errorPendiente) {
    console.log(
      "No se pudo sincronizar productos pendientes (legacy):",
      errorPendiente?.message || errorPendiente
    );
  }
  await orden.save();
  res.json(orden);
});

/**
 * Corrige un movimiento ya guardado en el historial de un ítem (trazabilidad).
 * Administrador: en cualquier momento (orden no cerrada/anulada).
 * Bodeguero: solo si la orden es del mismo día calendario que hoy.
 */
router.put(
  "/editarHistorialItem/:id/:itemIndex/:historialIndex",
  async (req, res) => {
    try {
      const { id, itemIndex, historialIndex } = req.params;
      const idxItem = Number(itemIndex);
      const idxHist = Number(historialIndex);
      const orden = await EntregaBodega.findById(id);
      if (!orden) {
        return res.status(404).json({ mensaje: "Orden no encontrada" });
      }
      const ep = String(orden.estadoProceso || "").toUpperCase();
      if (ep === "CERRADO" || ep === "ANULADO") {
        return res.status(409).json({
          mensaje: "La orden está cerrada o anulada y no permite edición.",
        });
      }

      const rol = String((req.body && req.body.rolUsuario) || "").trim();
      if (rol === "Bodeguero") {
        if (!ordenEsMismoDiaCalendarioQueHoy(orden)) {
          return res.status(403).json({
            mensaje:
              "Como bodeguero solo puede corregir movimientos de órdenes del día actual.",
          });
        }
      } else if (rol !== "Administrador") {
        return res.status(403).json({
          mensaje: "No tiene permisos para corregir el historial de entregas.",
        });
      }

      if (!orden.items[idxItem]) {
        return res.status(400).json({ mensaje: "Ítem inválido" });
      }
      const item = orden.items[idxItem];
      item.historial = item.historial || [];
      if (!item.historial[idxHist]) {
        return res.status(400).json({ mensaje: "Registro de historial inválido" });
      }

      const usuario = (req.body && req.body.usuario) || "";
      const motivo = (req.body && req.body.motivoCorreccion) || "";
      const estadoSel = String(
        (req.body && req.body.estadoSeleccionado) || ""
      ).toUpperCase();
      if (
        !["ENTREGA_TOTAL", "ENTREGA_PARCIAL", "DEVOLUCION", "DEVUELTO"].includes(
          estadoSel
        )
      ) {
        return res.status(400).json({ mensaje: "Estado seleccionado no válido" });
      }

      const h = item.historial[idxHist];
      h.estadoSeleccionado = estadoSel;
      h.notas = req.body.notas != null ? String(req.body.notas) : h.notas || "";

      const usarMetro = itemUsaMetrosCajaPieza(item);
      if (usarMetro) {
        h.entregaCajas = normalizarNumero(req.body.entregaCajas);
        h.entregaPiezas = normalizarNumero(req.body.entregaPiezas);
        const m2Caja = m2PorCajaDeLinea(item);
        const piezasCaja = piezasPorCajaDeLinea(item);
        let m2Inc = m2DesdeCajasPiezas(
          h.entregaCajas,
          h.entregaPiezas,
          m2Caja,
          piezasCaja
        );
        const m2Body = normalizarNumero(req.body.m2EntregadoEnEstaOperacion);
        if (m2Inc <= 0 && m2Body > 0) {
          m2Inc = m2Body;
        }
        h.m2EntregadoEnEstaOperacion = m2Inc;
      } else {
        h.m2EntregadoEnEstaOperacion = normalizarNumero(
          req.body.m2EntregadoEnEstaOperacion
        );
      }

      const ahora = new Date().toISOString();
      const notaControl = `[Ítem editado y ajustado ${new Date().toLocaleString()} por ${usuario || "—"}${
        motivo ? ". Motivo: " + motivo : ""
      }]`;
      h.notas = (h.notas || "").trim();
      h.notas = h.notas ? `${h.notas} ${notaControl}` : notaControl;
      h.accion = "ACTUALIZACION_ITEM_EDITADA";
      h.fechaUltimaEdicion = ahora;
      h.usuarioUltimaEdicion = usuario;

      reconstruirItemDesdeHistorial(item);

      orden.trazabilidad = orden.trazabilidad || [];
      orden.trazabilidad.push({
        fecha: ahora,
        usuario,
        accion: "EDICION_HISTORIAL_ITEM",
        detalle: `Corrección historial ítem #${idxItem + 1}, movimiento #${
          idxHist + 1
        }`,
      });

      recalcularEstadoYItems(orden);
      const itemActualizado = orden.items[idxItem];
      try {
        await sincronizarProductoPendienteLegacyDesdeItem(
          orden,
          itemActualizado,
          usuario,
          {
            origen: "edicion_historial",
            estadoSeleccionado: estadoSel,
          }
        );
      } catch (errorPendiente) {
        console.log(
          "No se pudo sincronizar productos pendientes (legacy):",
          errorPendiente?.message || errorPendiente
        );
      }

      await orden.save();
      return res.json(orden);
    } catch (err) {
      const msg =
        err && err.message
          ? err.message
          : "No se pudo aplicar la corrección al historial";
      return res.status(400).json({ mensaje: msg });
    }
  }
);

/**
 * Bodeguero: solicita devolución total cuando la orden no es del día actual.
 * El reset lo ejecuta solo un administrador (endpoint ejecutarDevolucionTotal).
 */
router.put("/solicitarDevolucion/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const rol = String((req.body && req.body.rolUsuario) || "").trim();
    const usuario = (req.body && req.body.usuario) || "";
    if (rol !== "Bodeguero") {
      return res.status(403).json({
        mensaje: "Solo el rol Bodeguero puede solicitar devolución en este flujo.",
      });
    }
    const orden = await EntregaBodega.findById(id);
    if (!orden) {
      return res.status(404).json({ mensaje: "Orden no encontrada" });
    }
    const ep = String(orden.estadoProceso || "").toUpperCase();
    if (ep === "CERRADO" || ep === "ANULADO") {
      return res.status(409).json({
        mensaje: "La orden está cerrada o anulada; no aplica devolución total.",
      });
    }
    if (!ordenTieneMovimientoEntrega(orden)) {
      return res.status(400).json({
        mensaje: "No hay entregas registradas para solicitar devolución.",
      });
    }
    if (ordenEsMismoDiaCalendarioQueHoy(orden)) {
      return res.status(400).json({
        mensaje:
          "Esta orden es del día actual: use devolución directa sin solicitud.",
      });
    }
    if (orden.solicitudDevolucionPendiente) {
      return res.status(409).json({
        mensaje: "Ya existe una solicitud de devolución pendiente para esta orden.",
      });
    }
    orden.solicitudDevolucionPendiente = true;
    orden.solicitudDevolucionUsuario = usuario || "";
    orden.solicitudDevolucionFecha = new Date().toISOString();
    orden.trazabilidad = orden.trazabilidad || [];
    orden.trazabilidad.push({
      fecha: new Date().toISOString(),
      usuario,
      accion: "SOLICITUD_DEVOLUCION_TOTAL",
      detalle: "El bodeguero solicitó devolución total (pendiente de aprobación del administrador).",
    });
    await orden.save();
    return res.json(orden);
  } catch (err) {
    return res.status(500).json({
      mensaje: err && err.message ? err.message : "Error al registrar la solicitud",
    });
  }
});

/**
 * Devolución total: borra historial por ítem y deja la orden en ABIERTA.
 * Administrador: siempre (orden con movimiento, no cerrada/anulada).
 * Bodeguero: solo mismo día calendario y sin solicitud pendiente (flujo directo).
 * Con solicitud pendiente: solo administrador.
 */
router.put("/ejecutarDevolucionTotal/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const rol = String((req.body && req.body.rolUsuario) || "").trim();
    const usuario = (req.body && req.body.usuario) || "";
    const orden = await EntregaBodega.findById(id);
    if (!orden) {
      return res.status(404).json({ mensaje: "Orden no encontrada" });
    }
    const ep = String(orden.estadoProceso || "").toUpperCase();
    if (ep === "CERRADO" || ep === "ANULADO") {
      return res.status(409).json({
        mensaje: "La orden está cerrada o anulada; no aplica devolución total.",
      });
    }
    if (!ordenTieneMovimientoEntrega(orden)) {
      return res.status(400).json({
        mensaje: "No hay entregas registradas para devolver.",
      });
    }

    const pendiente = !!orden.solicitudDevolucionPendiente;

    if (rol === "Administrador") {
      // ok
    } else if (rol === "Bodeguero") {
      if (pendiente) {
        return res.status(403).json({
          mensaje:
            "Hay una solicitud pendiente: solo un administrador puede ejecutar la devolución.",
        });
      }
      if (!ordenEsMismoDiaCalendarioQueHoy(orden)) {
        return res.status(403).json({
          mensaje:
            "Como bodeguero solo puede ejecutar devolución el mismo día de la orden; en otro caso debe solicitarla.",
        });
      }
    } else {
      return res.status(403).json({
        mensaje: "No tiene permisos para ejecutar la devolución total.",
      });
    }

    aplicarDevolucionTotalResetOrden(orden, usuario);
    await revertirPendientesPorDevolucionTotalOrden(orden, usuario);
    await orden.save();
    return res.json(orden);
  } catch (err) {
    const msg =
      err && err.message ? err.message : "No se pudo ejecutar la devolución total";
    return res.status(400).json({ mensaje: msg });
  }
});

/**
 * Al aprobar una devolución en el módulo contable: incrementa cantidadDevuelta en la orden
 * de entrega de bodega, registra historial con estado DEVUELTO y recalcula ítem/orden
 * (entregado + devuelto = facturado → ítem COMPLETO y sincroniza productos pendientes).
 */
router.put("/registrarDevolucionAprobada", async (req, res) => {
  try {
    const body = req.body || {};
    const documentoNumero = normalizarNumero(body.documentoNumero);
    const tipoOrigen = String(body.tipo_documento || "").trim();
    const mapTipo = {
      Factura: "FACTURA",
      "Nota de Venta": "NOTA_VENTA",
    };
    const tipoDocumento = mapTipo[tipoOrigen] || "";
    const usuario = String(body.usuario || "").trim();
    const idDevolucion = normalizarNumero(body.id_devolucion);
    const observaciones = body.observaciones != null ? String(body.observaciones) : "";
    const productosDevueltos = Array.isArray(body.productosDevueltos)
      ? body.productosDevueltos
      : [];

    if (documentoNumero <= 0 || !tipoDocumento) {
      return res.status(400).json({
        mensaje: "documentoNumero o tipo_documento no válidos para trazabilidad.",
      });
    }

    const orden = await EntregaBodega.findOne({ documentoNumero, tipoDocumento });
    if (!orden) {
      return res.json({
        ok: true,
        sinOrdenEntrega: true,
        itemsActualizados: 0,
        mensaje:
          "No hay orden de entrega de bodega asociada a este documento; no se aplicó trazabilidad.",
      });
    }

    const ep = String(orden.estadoProceso || "").toUpperCase();
    if (ep === "ANULADO") {
      return res.json({
        ok: true,
        sinActualizacionTrazabilidad: true,
        itemsActualizados: 0,
        mensaje: "La orden de entrega está anulada; no se actualizó la trazabilidad.",
      });
    }

    const detalleAdvertencias = [];
    let itemsActualizados = 0;
    /** idx ítem → m²/u aplicados en esta aprobación (para traza en productos pendientes legacy). */
    const syncDevolucionPorIndice = new Map();

    for (const pd of productosDevueltos) {
      const pLine = pd && pd.producto;
      const codigo = pLine && String(pLine.PRODUCTO || "").trim();
      if (!codigo) {
        continue;
      }

      const idx = orden.items.findIndex((it) => {
        const nom = String(
          (it.producto && it.producto.PRODUCTO) || it.productoNombre || ""
        ).trim();
        return nom === codigo;
      });
      if (idx < 0) {
        detalleAdvertencias.push(`${codigo}: no figura en la orden de entrega.`);
        continue;
      }

      const item = orden.items[idx];
      const cantidadFacturada = normalizarNumero(item.cantidadFacturada);
      const entregadaActual = normalizarNumero(item.cantidadEntregada);
      const devueltaActual = normalizarNumero(item.cantidadDevuelta);
      const usarMetro = itemUsaMetrosCajaPieza(item);

      const m2Dev = cantidadDevolucionDesdePayload(pd, item);

      if (m2Dev <= 0) {
        continue;
      }

      const split = separarDevolucionVirtualFisica({
        cantidadSolicitada: m2Dev,
        facturada: cantidadFacturada,
        entregada: entregadaActual,
        devueltaActual,
        tipoSolicitado: normalizarTipoSolicitado(pd),
      });

      if (split.aplicadoTotal <= 0) {
        detalleAdvertencias.push(
          `${codigo}: sin cupo en la orden (fact. ${cantidadFacturada}, ent. ${entregadaActual}, dev. ${devueltaActual}).`
        );
        continue;
      }
      if (split.truncadoPorTope) {
        detalleAdvertencias.push(
          `${codigo}: se registró ${split.aplicadoTotal.toFixed(
            2
          )} de ${m2Dev.toFixed(2)} (tope total según facturado).`
        );
      }

      if (split.fisica - entregadaActual > 1e-6) {
        detalleAdvertencias.push(
          `${codigo}: devolución física ajustada al máximo entregado (${entregadaActual.toFixed(
            2
          )}).`
        );
      }

      // Solo la virtual afecta cantidadDevuelta (pendiente de la orden).
      const nuevaDev = devueltaActual + split.virtual;
      item.cantidadDevuelta = nuevaDev;

      let entregaCajasRegVirtual = usarMetro ? normalizarNumero(pd.cantDevueltaCajas) : undefined;
      let entregaPiezasRegVirtual = usarMetro ? normalizarNumero(pd.cantDevueltaPiezas) : undefined;
      if (usarMetro && split.virtual + 1e-6 < m2Dev) {
        const m2Caja = m2PorCajaDeLinea(item);
        const piezasCaja = piezasPorCajaDeLinea(item);
        const cpVirtual = cajasPiezasDesdeM2(split.virtual, m2Caja, piezasCaja);
        entregaCajasRegVirtual = cpVirtual.cajas;
        entregaPiezasRegVirtual = cpVirtual.piezas;
      }

      item.historial = item.historial || [];
      const notasHist = `Devolución #${
        idDevolucion || "—"
      } aprobada (módulo devoluciones).${
        observaciones ? " " + observaciones.slice(0, 500) : ""
      }`;
      const fechaOperacion = new Date().toISOString();
      if (split.virtual > 0) {
        item.historial.push({
          fecha: fechaOperacion,
          usuario,
          accion: "APROBACION_DEVOLUCION",
          estadoSeleccionado: "DEVUELTO",
          tipoDevolucion: "VIRTUAL",
          cantidadEntregada: item.cantidadEntregada,
          cantidadDevuelta: item.cantidadDevuelta,
          m2EntregadoEnEstaOperacion: split.virtual,
          entregaCajas: usarMetro ? entregaCajasRegVirtual : undefined,
          entregaPiezas: usarMetro ? entregaPiezasRegVirtual : undefined,
          notas: `${notasHist} Tipo: devolución virtual.`,
        });
      }

      if (split.fisica > 0) {
        let entregaCajasRegFisica;
        let entregaPiezasRegFisica;
        if (usarMetro) {
          const m2Caja = m2PorCajaDeLinea(item);
          const piezasCaja = piezasPorCajaDeLinea(item);
          const cpFisica = cajasPiezasDesdeM2(split.fisica, m2Caja, piezasCaja);
          entregaCajasRegFisica = cpFisica.cajas;
          entregaPiezasRegFisica = cpFisica.piezas;
        }
        item.historial.push({
          fecha: fechaOperacion,
          usuario,
          accion: "APROBACION_DEVOLUCION",
          estadoSeleccionado: "DEVUELTO",
          tipoDevolucion: "FISICA",
          cantidadEntregada: item.cantidadEntregada,
          cantidadDevuelta: item.cantidadDevuelta,
          m2EntregadoEnEstaOperacion: split.fisica,
          entregaCajas: usarMetro ? entregaCajasRegFisica : undefined,
          entregaPiezas: usarMetro ? entregaPiezasRegFisica : undefined,
          notas: `${notasHist} Tipo: devolución física (registro trazabilidad).`,
        });
      }

      itemsActualizados += 1;
      if (split.virtual > 0 || split.fisica > 0) {
        const prev = syncDevolucionPorIndice.get(idx) || { virtual: 0, fisica: 0 };
        syncDevolucionPorIndice.set(idx, {
          virtual: normalizarNumero(prev.virtual) + split.virtual,
          fisica: normalizarNumero(prev.fisica) + split.fisica,
        });
      }

      if (split.virtual > 0 && split.fisica > 0) {
        detalleAdvertencias.push(
          `${codigo}: devolución registrada como virtual ${split.virtual.toFixed(
            2
          )} + física ${split.fisica.toFixed(2)}.`
        );
      } else if (split.virtual > 0) {
        detalleAdvertencias.push(
          `${codigo}: devolución registrada como virtual ${split.virtual.toFixed(
            2
          )}.`
        );
      } else if (split.fisica > 0) {
        detalleAdvertencias.push(
          `${codigo}: devolución registrada como física ${split.fisica.toFixed(2)}.`
        );
      }
    }

    if (itemsActualizados > 0) {
      recalcularEstadoYItems(orden);
      for (const [idx, totalesAprobados] of syncDevolucionPorIndice) {
        const itemActualizado = orden.items[idx];
        if (!itemActualizado) continue;
        try {
          const virtualAprobado = normalizarNumero(totalesAprobados?.virtual);
          const fisicaAprobada = normalizarNumero(totalesAprobados?.fisica);
          await sincronizarProductoPendienteLegacyDesdeItem(
            orden,
            itemActualizado,
            usuario,
            {
              origen: "devoluciones",
              m2EnEstaOperacion: virtualAprobado + fisicaAprobada,
              devolucionFisicaEnEstaOperacion: fisicaAprobada,
              estadoSeleccionado: "DEVUELTO",
            }
          );
        } catch (errorPendiente) {
          console.log(
            "No se pudo sincronizar productos pendientes (legacy):",
            errorPendiente && errorPendiente.message
              ? errorPendiente.message
              : errorPendiente
          );
        }
      }
      orden.trazabilidad = orden.trazabilidad || [];
      orden.trazabilidad.push({
        fecha: new Date().toISOString(),
        usuario,
        accion: "APROBACION_DEVOLUCION",
        detalle: `Devolución #${idDevolucion || "—"}: trazabilidad actualizada (${itemsActualizados} línea(s)).`,
      });
      await orden.save();
    }

    return res.json({
      ok: true,
      itemsActualizados,
      detalleAdvertencias,
      ordenId: orden._id,
    });
  } catch (err) {
    const msg =
      err && err.message
        ? err.message
        : "No se pudo registrar la devolución en la orden de entrega.";
    return res.status(500).json({ mensaje: msg });
  }
});

/**
 * Reversa de trazabilidad al anular una devolución aprobada en módulo contable.
 * - Elimina movimientos de historial ligados a `id_devolucion`.
 * - Recalcula cantidades del ítem desde historial restante.
 * - Sincroniza listado legacy de productos pendientes.
 */
router.put("/revertirDevolucionAprobada", async (req, res) => {
  try {
    const body = req.body || {};
    const documentoNumero = normalizarNumero(body.documentoNumero);
    const tipoOrigen = String(body.tipo_documento || "").trim();
    const mapTipo = {
      Factura: "FACTURA",
      "Nota de Venta": "NOTA_VENTA",
    };
    const tipoDocumento = mapTipo[tipoOrigen] || "";
    const usuario = String(body.usuario || "").trim();
    const idDevolucion = normalizarNumero(body.id_devolucion);

    if (documentoNumero <= 0 || !tipoDocumento || idDevolucion <= 0) {
      return res.status(400).json({
        mensaje:
          "documentoNumero, tipo_documento o id_devolucion no válidos para reversa.",
      });
    }

    const orden = await EntregaBodega.findOne({ documentoNumero, tipoDocumento });
    if (!orden) {
      return res.json({
        ok: true,
        sinOrdenEntrega: true,
        itemsActualizados: 0,
        mensaje:
          "No hay orden de entrega de bodega asociada a este documento; no se aplicó reversa de trazabilidad.",
      });
    }

    const ep = String(orden.estadoProceso || "").toUpperCase();
    if (ep === "ANULADO") {
      return res.json({
        ok: true,
        sinActualizacionTrazabilidad: true,
        itemsActualizados: 0,
        mensaje: "La orden de entrega está anulada; no se actualizó la trazabilidad.",
      });
    }

    let itemsActualizados = 0;
    const detalleAdvertencias = [];
    const marcador = `Devolución #${idDevolucion}`;

    for (let idx = 0; idx < (orden.items || []).length; idx++) {
      const item = orden.items[idx];
      const historial = Array.isArray(item?.historial) ? item.historial : [];
      if (!historial.length) continue;

      const originalLen = historial.length;
      item.historial = historial.filter((h) => {
        const accion = String(h?.accion || "").toUpperCase();
        const notas = String(h?.notas || "");
        if (accion !== "APROBACION_DEVOLUCION") return true;
        return !notas.includes(marcador);
      });
      const removidos = originalLen - item.historial.length;
      if (removidos <= 0) continue;

      try {
        reconstruirItemDesdeHistorial(item);
      } catch (errRebuild) {
        detalleAdvertencias.push(
          `No se pudo reconstruir historial del ítem #${idx + 1}: ${
            errRebuild && errRebuild.message ? errRebuild.message : "error de reconstrucción"
          }`
        );
      }

      try {
        await sincronizarProductoPendienteLegacyDesdeItem(orden, item, usuario, {
          origen: "devoluciones_anulacion",
          estadoSeleccionado: "DEVUELTO",
          m2EnEstaOperacion: 0,
        });
      } catch (errorPendiente) {
        detalleAdvertencias.push(
          `No se pudo sincronizar productos pendientes del ítem #${idx + 1}.`
        );
      }

      itemsActualizados += 1;
    }

    if (itemsActualizados > 0) {
      recalcularEstadoYItems(orden);
      orden.trazabilidad = orden.trazabilidad || [];
      orden.trazabilidad.push({
        fecha: new Date().toISOString(),
        usuario,
        accion: "ANULACION_DEVOLUCION",
        detalle: `Devolución #${idDevolucion}: reversa de trazabilidad aplicada en ${itemsActualizados} línea(s).`,
      });
      await orden.save();
    }

    return res.json({
      ok: true,
      itemsActualizados,
      detalleAdvertencias,
      ordenId: orden._id,
    });
  } catch (err) {
    const msg =
      err && err.message
        ? err.message
        : "No se pudo revertir la devolución en la orden de entrega.";
    return res.status(500).json({ mensaje: msg });
  }
});

router.post("/previsualizarDevolucionAprobada", async (req, res) => {
  try {
    const body = req.body || {};
    const documentoNumero = normalizarNumero(body.documentoNumero);
    const tipoOrigen = String(body.tipo_documento || "").trim();
    const mapTipo = {
      Factura: "FACTURA",
      "Nota de Venta": "NOTA_VENTA",
    };
    const tipoDocumento = mapTipo[tipoOrigen] || "";
    const productosDevueltos = Array.isArray(body.productosDevueltos)
      ? body.productosDevueltos
      : [];

    if (documentoNumero <= 0 || !tipoDocumento) {
      return res.status(400).json({
        mensaje: "documentoNumero o tipo_documento no válidos para previsualización.",
      });
    }

    const orden = await EntregaBodega.findOne({ documentoNumero, tipoDocumento });
    if (!orden) {
      return res.json({
        ok: true,
        sinOrdenEntrega: true,
        detallePreview: [],
        detalleAdvertencias: [
          "No hay orden de entrega de bodega asociada a este documento.",
        ],
        totales: { solicitada: 0, virtual: 0, fisica: 0, aplicadoTotal: 0 },
      });
    }

    const ep = String(orden.estadoProceso || "").toUpperCase();
    if (ep === "ANULADO") {
      return res.json({
        ok: true,
        ordenAnulada: true,
        detallePreview: [],
        detalleAdvertencias: [
          "La orden de entrega está anulada; no se puede sincronizar trazabilidad.",
        ],
        totales: { solicitada: 0, virtual: 0, fisica: 0, aplicadoTotal: 0 },
      });
    }

    const resultado = construirPrevisualizacionDevolucion(orden, productosDevueltos);
    return res.json({
      ok: true,
      ordenId: orden._id,
      ...resultado,
    });
  } catch (err) {
    const msg =
      err && err.message
        ? err.message
        : "No se pudo previsualizar la devolución para trazabilidad.";
    return res.status(500).json({ mensaje: msg });
  }
});

router.put("/cerrar/:id", async (req, res) => {
  const { id } = req.params;
  const usuario = (req.body && req.body.usuario) || "";
  const orden = await EntregaBodega.findById(id);
  if (!orden) {
    return res.status(404).json({ mensaje: "Orden no encontrada" });
  }
  recalcularEstadoYItems(orden);
  if (orden.estadoProceso !== "COMPLETO") {
    return res
      .status(409)
      .json({ mensaje: "Solo se puede cerrar una orden en estado COMPLETO" });
  }

  orden.estadoProceso = "CERRADO";
  orden.trazabilidad = orden.trazabilidad || [];
  orden.trazabilidad.push({
    fecha: new Date().toISOString(),
    usuario,
    accion: "CIERRE_MANUAL",
    detalle: "Cierre manual ejecutado por bodeguero/administrador",
  });
  await orden.save();
  res.json(orden);
});

module.exports = router;
