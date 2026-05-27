const { Router } = require("express");
const router = Router();
const TablaMaestraSalarial = require("../models/tablaMaestraSalarial");
const NominaConfigGlobal = require("../models/nominaConfigGlobal");
const ReglaPagoNomina = require("../models/reglaPagoNomina");
const Proveedor = require("../models/proveedor");
const { construirProyeccion } = require("../utils/proyeccionPagosNomina");
const { construirProyeccionTipoB } = require("../utils/proyeccionPagosTipoB");
const dominicalNominaService = require("../services/dominicalNominaService");
const tipoBNominaService = require("../services/tipoBNominaService");
const EventoPagoDominical = require("../models/eventoPagoDominical");
const EventoPagoProgramado = require("../models/eventoPagoProgramado");
const AjusteNominaPendiente = require("../models/ajusteNominaPendiente");

const CONFIG_CLAVE = "principal";

function formatearLimiteFacturacion(limite) {
  const valor = Number(limite) || 0;
  return valor.toLocaleString("es-EC", { maximumFractionDigits: 0 });
}

function etiquetasCalculoDominical(limiteFacturacion) {
  const texto = formatearLimiteFacturacion(limiteFacturacion);
  return {
    etiquetaRangoInferior: `Rango inferior ($${texto} > Facturación)`,
    etiquetaRangoSuperior: `Rango superior ($${texto} < Facturación)`,
  };
}

function aplicarEtiquetasCalculoDominical(calculoDominical) {
  if (!calculoDominical) return calculoDominical;
  const etiquetas = etiquetasCalculoDominical(calculoDominical.limiteFacturacion);
  return {
    ...calculoDominical,
    ...etiquetas,
  };
}

function normalizarOtroCargo(cargo) {
  const doc =
    cargo && typeof cargo.toObject === "function" ? cargo.toObject() : { ...cargo };
  if (!doc.fechaLimite && (doc.fechaLimiteDia || doc.fechaLimiteMes)) {
    const anio = new Date().getFullYear();
    doc.fechaLimite = new Date(
      anio,
      (doc.fechaLimiteMes || 1) - 1,
      doc.fechaLimiteDia || 1
    );
  }
  delete doc.fechaLimiteTexto;
  delete doc.fechaLimiteDia;
  delete doc.fechaLimiteMes;
  return doc;
}

function normalizarOtrosCargos(otrosCargos) {
  return (otrosCargos || []).map(normalizarOtroCargo);
}

function validarCargosDominicalUnicos(calculoDominical) {
  const filas = calculoDominical?.filas || [];
  const vistos = new Set();
  const duplicados = [];
  for (const fila of filas) {
    const cargo = (fila.cargo || "").trim();
    if (!cargo) continue;
    if (vistos.has(cargo)) duplicados.push(cargo);
    vistos.add(cargo);
  }
  if (duplicados.length) {
    const unicos = [...new Set(duplicados)];
    return {
      ok: false,
      mensaje: `No puede repetir el mismo cargo en cálculo dominical. Duplicados: ${unicos.join(", ")}`,
    };
  }
  return { ok: true };
}

const configuracionPorDefecto = () => ({
  clave: CONFIG_CLAVE,
  aportesIess: [
    {
      concepto: "Aporte Personal (Trabajador)",
      codigo: "iess_personal",
      porcentaje: 9.45,
      tipo: "personal",
      orden: 1,
      activo: true,
    },
    {
      concepto: "Aporte Patronal (Empleador)",
      codigo: "iess_patronal",
      porcentaje: 11.15,
      tipo: "patronal",
      orden: 2,
      activo: true,
    },
    {
      concepto: "Total Aportación",
      codigo: "iess_total",
      porcentaje: 20.6,
      tipo: "total",
      orden: 3,
      activo: true,
    },
  ],
  calculoDominical: aplicarEtiquetasCalculoDominical({
    limiteFacturacion: 1000,
    filas: [
      {
        cargo: "VENDEDOR",
        valorRangoInferior: 20,
        valorRangoSuperior: 25,
        activo: true,
      },
      {
        cargo: "BODEGUERO",
        valorRangoInferior: 10,
        valorRangoSuperior: 15,
        activo: true,
      },
    ],
  }),
  otrosCargos: (() => {
    const anio = new Date().getFullYear();
    return [
      {
        concepto: "Décimo Tercer Sueldo",
        codigo: "decimo_tercero",
        fechaLimite: new Date(anio, 11, 24),
        valor: 500,
        activo: true,
        orden: 1,
      },
      {
        concepto: "Décimo Cuarto Sueldo",
        codigo: "decimo_cuarto",
        fechaLimite: new Date(anio, 2, 15),
        valor: 500,
        activo: true,
        orden: 2,
      },
      {
        concepto: "Vacaciones",
        codigo: "vacaciones",
        fechaLimite: null,
        valor: 0,
        activo: false,
        orden: 3,
      },
    ];
  })(),
});

async function obtenerOInicializarConfig() {
  let config = await NominaConfigGlobal.findOne({ clave: CONFIG_CLAVE });
  if (!config) {
    config = new NominaConfigGlobal(configuracionPorDefecto());
    await config.save();
  }
  return config;
}

async function validarUsuarioSistemaUnico(usuarioSistemaId, excludeId) {
  if (!usuarioSistemaId) return null;
  const filtro = { usuarioSistemaId };
  if (excludeId) filtro._id = { $ne: excludeId };
  const duplicado = await TablaMaestraSalarial.findOne(filtro);
  if (duplicado) {
    return `El usuario del sistema ya está vinculado a ${duplicado.nombre}`;
  }
  return null;
}

// --- Tabla maestra salarial (por trabajador) ---

router.get("/tabla-maestra-salarial", async (req, res) => {
  const registros = await TablaMaestraSalarial.find().sort({ nombre: 1 });
  res.send(registros);
});

router.get("/tabla-maestra-salarial/:cedula", async (req, res) => {
  const registro = await TablaMaestraSalarial.findOne({
    cedula: req.params.cedula.trim(),
  });
  if (!registro) {
    return res.status(404).json({ mensaje: "Trabajador no encontrado" });
  }
  res.send(registro);
});

router.post("/tabla-maestra-salarial", async (req, res) => {
  try {
    const existe = await TablaMaestraSalarial.findOne({
      cedula: (req.body.cedula || "").trim(),
    });
    if (existe) {
      return res
        .status(409)
        .json({ mensaje: "Ya existe una tabla maestra para esta cédula" });
    }
    const msgUsuario = await validarUsuarioSistemaUnico(req.body.usuarioSistemaId);
    if (msgUsuario) {
      return res.status(409).json({ mensaje: msgUsuario });
    }
    const nuevo = new TablaMaestraSalarial(req.body);
    await nuevo.save();
    res.json({ status: "Tabla maestra salarial creada", data: nuevo });
  } catch (err) {
    res.status(400).json({ mensaje: err.message });
  }
});

router.put("/tabla-maestra-salarial/:id", async (req, res) => {
  try {
    if (req.body.cedula) {
      const duplicado = await TablaMaestraSalarial.findOne({
        cedula: req.body.cedula.trim(),
        _id: { $ne: req.params.id },
      });
      if (duplicado) {
        return res
          .status(409)
          .json({ mensaje: "La cédula ya está asignada a otro trabajador" });
      }
    }
    const msgUsuario = await validarUsuarioSistemaUnico(
      req.body.usuarioSistemaId,
      req.params.id
    );
    if (msgUsuario) {
      return res.status(409).json({ mensaje: msgUsuario });
    }
    const actualizado = await TablaMaestraSalarial.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!actualizado) {
      return res.status(404).json({ mensaje: "Registro no encontrado" });
    }
    res.json({ status: "Tabla maestra salarial actualizada", data: actualizado });
  } catch (err) {
    res.status(400).json({ mensaje: err.message });
  }
});

router.delete("/tabla-maestra-salarial/:id", async (req, res) => {
  await TablaMaestraSalarial.findByIdAndRemove(req.params.id);
  res.json({ status: "Tabla maestra salarial eliminada" });
});

// --- Configuración global (tablas maestras del motor de reglas) ---

router.get("/config-global", async (req, res) => {
  const config = await obtenerOInicializarConfig();
  const doc = config.toObject ? config.toObject() : config;
  doc.calculoDominical = aplicarEtiquetasCalculoDominical(doc.calculoDominical);
  doc.otrosCargos = normalizarOtrosCargos(doc.otrosCargos);
  res.send(doc);
});

router.put("/config-global", async (req, res) => {
  try {
    const validacion = validarCargosDominicalUnicos(req.body.calculoDominical);
    if (!validacion.ok) {
      return res.status(400).json({ mensaje: validacion.mensaje });
    }
    const calculoDominical = aplicarEtiquetasCalculoDominical(
      req.body.calculoDominical
    );
    const actualizado = await NominaConfigGlobal.findOneAndUpdate(
      { clave: CONFIG_CLAVE },
      {
        $set: {
          aportesIess: req.body.aportesIess,
          calculoDominical,
          otrosCargos: normalizarOtrosCargos(req.body.otrosCargos),
        },
      },
      { new: true, upsert: true, runValidators: true }
    );
    res.json({
      status: "Configuración global actualizada",
      data: actualizado,
    });
  } catch (err) {
    res.status(400).json({ mensaje: err.message });
  }
});

router.post("/config-global/restablecer", async (req, res) => {
  await NominaConfigGlobal.findOneAndDelete({ clave: CONFIG_CLAVE });
  const config = await obtenerOInicializarConfig();
  res.json({ status: "Configuración restablecida", data: config });
});

// --- Beneficiarios (lookup TMS / Proveedores) ---

router.get("/beneficiario-interno/:cedula", async (req, res) => {
  const cedula = (req.params.cedula || "").trim();
  const registro = await TablaMaestraSalarial.findOne({ cedula });
  if (!registro) {
    return res.status(404).json({
      mensaje: "No existe en Tabla Maestra Salarial",
    });
  }
  res.json({
    tipoBeneficiario: "Interno",
    cedula: registro.cedula,
    nombre: registro.nombre,
    cargo: registro.cargo,
    activo: registro.activo !== false,
    estadoEmpleado: registro.activo === false ? "INACTIVO" : "ACTIVO",
    asignacionSalarial: registro.asignacionSalarial || 0,
    salarioCalculoVariablesPrestacionales:
      registro.salarioCalculoVariablesPrestacionales || 0,
    periodoPago: registro.periodoPago,
    tablaMaestraSalarialId: registro._id,
    cargoNomina: registro.cargo,
    usuarioSistemaId: registro.usuarioSistemaId,
    usuarioSistemaNombre: registro.usuarioSistemaNombre,
    usuarioSistemaUsername: registro.usuarioSistemaUsername,
  });
});

router.get("/beneficiario-externo/:documento", async (req, res) => {
  const documento = (req.params.documento || "").trim();
  const proveedor = await Proveedor.findOne({ ruc: documento });
  if (!proveedor) {
    return res.status(404).json({
      mensaje: "No existe en terceros / proveedores",
    });
  }
  res.json({
    tipoBeneficiario: "Externo",
    cedula: proveedor.ruc,
    nombre: proveedor.nombre_proveedor,
    activo: true,
    estadoEmpleado: "ACTIVO",
    proveedorId: proveedor._id,
  });
});

// --- Reglas de pago tipo A (eventos periódicos) ---

router.get("/reglas-pago", async (req, res) => {
  const reglas = await ReglaPagoNomina.find().sort({ createdAt: -1 });
  res.send(reglas);
});

router.get("/reglas-pago/:id", async (req, res) => {
  const regla = await ReglaPagoNomina.findById(req.params.id);
  if (!regla) {
    return res.status(404).json({ mensaje: "Regla no encontrada" });
  }
  res.send(regla);
});

router.get("/reglas-pago/:id/proyeccion", async (req, res) => {
  const regla = await ReglaPagoNomina.findById(req.params.id);
  if (!regla) {
    return res.status(404).json({ mensaje: "Regla no encontrada" });
  }
  const meses = Number(req.query.meses) || regla.mesesProyeccion || 3;
  const proyeccion =
    regla.tipoRegla === "B"
      ? construirProyeccionTipoB(regla.toObject(), { mesesProyeccion: meses })
      : construirProyeccion(regla.toObject(), { mesesProyeccion: meses });
  res.json(proyeccion);
});

router.post("/reglas-pago/vista-previa", async (req, res) => {
  try {
    const proyeccion =
      req.body.tipoRegla === "B"
        ? construirProyeccionTipoB(req.body, {
            mesesProyeccion: req.body.mesesProyeccion || 12,
          })
        : construirProyeccion(req.body, {
            mesesProyeccion: req.body.mesesProyeccion || 3,
          });
    res.json(proyeccion);
  } catch (err) {
    res.status(400).json({ mensaje: err.message });
  }
});

router.post("/reglas-pago/amortizacion-previa", async (req, res) => {
  try {
    const { generarTablaAmortizacion, validarTablaAmortizacion, montoTotalRegla } =
      require("../utils/proyeccionPagosTipoB");
    const regla = tipoBNominaService.normalizarReglaTipoB(req.body);
    const tabla = generarTablaAmortizacion(regla, { forzarRegenerar: req.body.forzarRegenerar });
    const total = montoTotalRegla(regla);
    const validacion = validarTablaAmortizacion(tabla, total);
    res.json({ tabla, total, validacion, cuotaEvento: tabla[0]?.monto || 0 });
  } catch (err) {
    res.status(400).json({ mensaje: err.message });
  }
});

function prepararBodyReglaPago(body, validar = false) {
  const doc = { ...body };
  if (doc.tipoRegla === "B") {
    const normalizado = tipoBNominaService.normalizarReglaTipoB(doc);
    if (validar) {
      const msg = tipoBNominaService.validarReglaTipoB(normalizado);
      if (msg) throw new Error(msg);
    }
    return normalizado;
  }
  if (doc.frecuencia === "Dominical") {
    doc.montoVariable = true;
    doc.fuente = "FACTURACION_DOMINICAL";
    doc.transaccionNomina = doc.transaccionNomina || "Pago dominical";
    doc.monto = 0;
  }
  return doc;
}

router.post("/reglas-pago", async (req, res) => {
  try {
    const body = prepararBodyReglaPago({ ...req.body, estadoRegla: "Borrador" });
    const regla = new ReglaPagoNomina(body);
    await regla.save();
    res.json({ status: "Regla creada", data: regla });
  } catch (err) {
    res.status(400).json({ mensaje: err.message });
  }
});

router.put("/reglas-pago/:id", async (req, res) => {
  try {
    const actual = await ReglaPagoNomina.findById(req.params.id);
    if (!actual) {
      return res.status(404).json({ mensaje: "Regla no encontrada" });
    }
    if (actual.estadoRegla === "Autorizada") {
      return res.status(400).json({
        mensaje: "No se puede editar una regla ya autorizada",
      });
    }
    const body = prepararBodyReglaPago({ ...req.body });
    const actualizado = await ReglaPagoNomina.findByIdAndUpdate(
      req.params.id,
      { $set: body },
      { new: true, runValidators: true }
    );
    res.json({ status: "Regla actualizada", data: actualizado });
  } catch (err) {
    res.status(400).json({ mensaje: err.message });
  }
});

router.put("/reglas-pago/:id/autorizar", async (req, res) => {
  try {
    const regla = await ReglaPagoNomina.findById(req.params.id);
    if (!regla) {
      return res.status(404).json({ mensaje: "Regla no encontrada" });
    }
    if (regla.tipoBeneficiario === "Interno" && regla.empleadoActivo === false) {
      return res.status(400).json({
        mensaje:
          "El empleado está INACTIVO. La regla no puede autorizarse hasta reactivar el contrato.",
      });
    }
    if (regla.tipoRegla === "B") {
      regla.fuente = "Manual";
      const msg = tipoBNominaService.validarReglaTipoB(regla);
      if (msg) return res.status(400).json({ mensaje: msg });
      const meses = regla.mesesProyeccion || 12;
      const { proyeccion, eventos } =
        await tipoBNominaService.generarEventosProgramados(regla, {
          mesesProyeccion: meses,
        });
      regla.estadoRegla = "Autorizada";
      regla.fechaAutorizacion = new Date();
      regla.proyeccion = proyeccion;
      await regla.save();
      return res.json({
        status: "Regla tipo B autorizada — eventos pendientes de ejecución",
        data: regla,
        eventosGenerados: eventos.length,
      });
    }

    if (regla.frecuencia === "Dominical") {
      regla.montoVariable = true;
      regla.fuente = "FACTURACION_DOMINICAL";
    }
    const meses = regla.mesesProyeccion || 3;
    const proyeccion =
      regla.frecuencia === "Dominical"
        ? {
            etiquetaFila: "Pago dominical (monto variable)",
            meses: [],
          }
        : construirProyeccion(regla.toObject(), {
            mesesProyeccion: meses,
          });
    regla.estadoRegla = "Autorizada";
    regla.fechaAutorizacion = new Date();
    regla.proyeccion = proyeccion;
    await regla.save();
    res.json({ status: "Regla autorizada", data: regla });
  } catch (err) {
    res.status(400).json({ mensaje: err.message });
  }
});

router.put("/reglas-pago/:id/finalizar", async (req, res) => {
  const regla = await ReglaPagoNomina.findByIdAndUpdate(
    req.params.id,
    { $set: { estadoRegla: "Finalizada" } },
    { new: true }
  );
  if (!regla) {
    return res.status(404).json({ mensaje: "Regla no encontrada" });
  }
  res.json({ status: "Regla finalizada", data: regla });
});

router.delete("/reglas-pago/:id", async (req, res) => {
  const regla = await ReglaPagoNomina.findById(req.params.id);
  if (!regla) {
    return res.status(404).json({ mensaje: "Regla no encontrada" });
  }
  if (regla.estadoRegla === "Autorizada") {
    return res.status(400).json({
      mensaje: "No se puede eliminar una regla autorizada. Finalícela primero.",
    });
  }
  await ReglaPagoNomina.findByIdAndRemove(req.params.id);
  res.json({ status: "Regla eliminada" });
});

// --- Pago dominical (facturación del día - devoluciones) ---

router.post("/dominical/simular", async (req, res) => {
  try {
    const fecha = new Date(req.body.fecha);
    const resultado = await dominicalNominaService.simularLiquidacionDominical(
      fecha,
      {
        sucursal: req.body.sucursal,
        cedula: req.body.cedula,
      }
    );
    res.json(resultado);
  } catch (err) {
    res.status(400).json({ mensaje: err.message });
  }
});

router.post("/dominical/liquidar", async (req, res) => {
  try {
    const fecha = new Date(req.body.fecha);
    const resultado = await dominicalNominaService.liquidarDominical(fecha, {
      sucursal: req.body.sucursal,
      cedula: req.body.cedula,
      usuario: req.body.usuario,
      aplicarAjustes: req.body.aplicarAjustes !== false,
    });
    res.json({ status: "Liquidación dominical procesada", data: resultado });
  } catch (err) {
    res.status(400).json({ mensaje: err.message });
  }
});

router.get("/dominical/eventos", async (req, res) => {
  const filtro = {};
  if (req.query.fecha) {
    const f = new Date(req.query.fecha);
    f.setHours(0, 0, 0, 0);
    const fin = new Date(f);
    fin.setHours(23, 59, 59, 999);
    filtro.fechaDominical = { $gte: f, $lte: fin };
  }
  if (req.query.cedula) filtro.cedulaBeneficiario = req.query.cedula;
  const eventos = await EventoPagoDominical.find(filtro).sort({
    fechaDominical: -1,
  });
  res.send(eventos);
});

router.get("/dominical/ajustes-pendientes", async (req, res) => {
  const filtro = { estado: "Pendiente" };
  if (req.query.cedula) filtro.cedulaBeneficiario = req.query.cedula;
  const ajustes = await AjusteNominaPendiente.find(filtro).sort({
    createdAt: -1,
  });
  res.send(ajustes);
});

// --- Reglas tipo B: pagos programados (ejecución manual) ---

router.get("/eventos-programados", async (req, res) => {
  const filtro = {};
  if (req.query.estado) filtro.estado = req.query.estado;
  if (req.query.reglaId) filtro.reglaPagoId = req.query.reglaId;
  if (req.query.cedula) filtro.cedulaBeneficiario = req.query.cedula;
  if (req.query.desde || req.query.hasta) {
    filtro.fechaProgramada = {};
    if (req.query.desde) {
      const d = new Date(req.query.desde);
      d.setHours(0, 0, 0, 0);
      filtro.fechaProgramada.$gte = d;
    }
    if (req.query.hasta) {
      const h = new Date(req.query.hasta);
      h.setHours(23, 59, 59, 999);
      filtro.fechaProgramada.$lte = h;
    }
  }
  const eventos = await EventoPagoProgramado.find(filtro)
    .populate("reglaPagoId", "transaccionNomina centroCosto estadoRegla")
    .sort({ fechaProgramada: 1 });
  res.send(eventos);
});

router.put("/eventos-programados/:id/ejecutar", async (req, res) => {
  try {
    const resultado = await tipoBNominaService.ejecutarEventoProgramado(
      req.params.id,
      {
        usuario: req.body.usuario,
        sucursal: req.body.sucursal,
        notas: req.body.notas,
        monto: req.body.monto,
      }
    );
    res.json({
      status: "Pago ejecutado y registrado en finanzas",
      data: resultado,
    });
  } catch (err) {
    res.status(400).json({ mensaje: err.message });
  }
});

router.put("/eventos-programados/:id/cancelar", async (req, res) => {
  try {
    const evento = await EventoPagoProgramado.findById(req.params.id);
    if (!evento) {
      return res.status(404).json({ mensaje: "Evento no encontrado" });
    }
    if (evento.estado === "Ejecutado") {
      return res.status(400).json({
        mensaje: "No se puede cancelar un pago ya ejecutado",
      });
    }
    evento.estado = "Cancelado";
    evento.notas = req.body.notas || evento.notas;
    await evento.save();
    res.json({ status: "Evento cancelado", data: evento });
  } catch (err) {
    res.status(400).json({ mensaje: err.message });
  }
});

router.get("/reporte-estado-empleado", async (req, res) => {
  try {
    const reporte = await tipoBNominaService.reporteEstadoEmpleado({
      cedula: req.query.cedula,
      centroCosto: req.query.centroCosto,
      desde: req.query.desde,
      hasta: req.query.hasta,
    });
    res.json(reporte);
  } catch (err) {
    res.status(400).json({ mensaje: err.message });
  }
});

module.exports = router;
