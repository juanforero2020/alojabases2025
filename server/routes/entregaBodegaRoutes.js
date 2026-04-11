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
  reconstruirItemDesdeHistorial,
  ordenEsMismoDiaCalendarioQueHoy,
} = require("../services/entregaBodegaService");

async function marcarPendienteComoEntregadoDesdeBodega(orden, item, usuario) {
  const documento = normalizarNumero(orden && orden.documentoNumero);
  if (documento <= 0 || !item) return;

  const nombreProducto = String(
    (item.producto && item.producto.PRODUCTO) ||
      item.productoNombre ||
      (item.producto && item.producto.REFERENCIA) ||
      ""
  ).trim();
  if (!nombreProducto) return;

  await ProductosPendientes.updateMany(
    {
      documento,
      estado: "PENDIENTE",
      $or: [
        { "producto.PRODUCTO": nombreProducto },
        { "producto.REFERENCIA": nombreProducto },
      ],
    },
    {
      $set: {
        estado: "ENTREGADO",
        mensaje: "Entregado automáticamente desde Gestión Entregas de bodega",
        usuario: usuario || "",
      },
    }
  );
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
    return res.status(400).json({
      mensaje:
        "La cantidad ingresada excede la cantidad pendiente por entregar.",
    });
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
      : m2Incremental;
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
  const entregaTotalItem =
    !!itemActualizado &&
    (normalizarNumero(itemActualizado.cantidadFacturada) ===
      normalizarNumero(itemActualizado.cantidadEntregada) +
        normalizarNumero(itemActualizado.cantidadDevuelta) ||
      pendienteVisualItem(itemActualizado) === 0);
  if (entregaTotalItem) {
    try {
      await marcarPendienteComoEntregadoDesdeBodega(orden, itemActualizado, usuario);
    } catch (errorPendiente) {
      console.log(
        "No se pudo sincronizar estado en productos pendientes:",
        errorPendiente?.message || errorPendiente
      );
    }
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
        !["ENTREGA_TOTAL", "ENTREGA_PARCIAL", "DEVOLUCION"].includes(estadoSel)
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
      const entregaTotalItem =
        !!itemActualizado &&
        (normalizarNumero(itemActualizado.cantidadFacturada) ===
          normalizarNumero(itemActualizado.cantidadEntregada) +
            normalizarNumero(itemActualizado.cantidadDevuelta) ||
          pendienteVisualItem(itemActualizado) === 0);
      if (entregaTotalItem) {
        try {
          await marcarPendienteComoEntregadoDesdeBodega(
            orden,
            itemActualizado,
            usuario
          );
        } catch (errorPendiente) {
          console.log(
            "No se pudo sincronizar estado en productos pendientes:",
            errorPendiente?.message || errorPendiente
          );
        }
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
