const ReglaPagoNomina = require("../models/reglaPagoNomina");
const EventoCobroPrestamo = require("../models/eventoCobroPrestamo");
const EventoPagoProgramado = require("../models/eventoPagoProgramado");
const TransaccionFinanciera = require("../models/transaccionFinanciera");
const {
  registrarBitacoraPrestamo,
  listarBitacoraPrestamo,
} = require("../utils/bitacoraPrestamoNomina");
const {
  recalcularPrestamosBeneficiario,
  saldoActualPrestamo,
  fuentesSeleccionadas,
  cuotaFuenteParaRegla,
} = require("../utils/proyeccionPagosTipoD");
const {
  refinanciarCuotasProximas,
  textoRefinanciacion,
  extraerPendientesDeTabla,
  filaAmortizacionPlain,
} = require("../utils/refinanciarCuotasPrestamo");
const cobroPrestamoNominaService = require("./cobroPrestamoNominaService");
const { asignarCodigoPrestamoSiFalta } = require("../utils/codigoPrestamoNomina");

function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function escapeRegex(valor) {
  return String(valor || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function totalPrestamo(regla) {
  return redondear2(
    regla.montoTotalDeuda ||
      (Number(regla.montoPrestado) || 0) + (Number(regla.montoInteres) || 0) ||
      regla.monto ||
      0
  );
}

function montoAbonado(regla) {
  const total = totalPrestamo(regla);
  const saldo = saldoActualPrestamo(regla);
  const porSaldo = redondear2(Math.max(0, total - saldo));
  const porBitacora = redondear2(
    (regla.abonosPrestamo || []).reduce((s, a) => s + (Number(a.monto) || 0), 0)
  );
  return Math.max(porSaldo, porBitacora);
}

function mapearBitacoraDesdeAbonos(regla) {
  const total = totalPrestamo(regla);
  let acumulado = 0;
  return (regla.abonosPrestamo || [])
    .slice()
    .sort((a, b) => new Date(a.fecha || 0) - new Date(b.fecha || 0))
    .map((a) => {
      const monto = redondear2(a.monto);
      const saldoAntes =
        a.saldoAntes != null ? redondear2(a.saldoAntes) : redondear2(total - acumulado);
      acumulado = redondear2(acumulado + monto);
      const saldoDespues =
        a.saldoDespues != null
          ? redondear2(a.saldoDespues)
          : redondear2(Math.max(0, total - acumulado));
      const origen = (a.transaccionNominaOrigen || "").toString();
      let tipoMovimiento = a.tipoMovimiento || "";
      if (!tipoMovimiento) {
        if (origen.toLowerCase().includes("recibo") || a.eventoCobroId) {
          tipoMovimiento = "Cobro cuota";
        } else if (origen.toLowerCase().includes("abono")) {
          tipoMovimiento = "Abono extraordinario";
        } else {
          tipoMovimiento = "Descuento nomina";
        }
      }
      return {
        _id: a._id,
        fecha: a.fecha,
        tipoMovimiento,
        monto,
        saldoAntes,
        saldoDespues,
        ejecutadoPor: a.ejecutadoPor || "",
        notas: a.notas || origen || "",
        transaccionFinancieraId: a.transaccionFinancieraId,
      };
    })
    .reverse();
}

async function bitacoraDeRegla(regla) {
  const registrada = await listarBitacoraPrestamo(regla._id);
  if (registrada.length) return registrada;
  return mapearBitacoraDesdeAbonos(regla);
}

/** Fecha calendario (año-mes-día) comparable, sin depender de la zona del servidor. */
function claveFechaCalendario(valor) {
  const d = valor ? new Date(valor) : null;
  if (!d || isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function claveHoyEcuador() {
  const ecuador = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return Date.UTC(
    ecuador.getUTCFullYear(),
    ecuador.getUTCMonth(),
    ecuador.getUTCDate()
  );
}

/**
 * Estado de pago del préstamo a hoy: cuotas con fecha anterior a hoy que
 * aún tienen saldo se consideran vencidas.
 */
function estadoCuotasPrestamo(cuotas) {
  const lista = cuotas || [];
  if (!lista.length) {
    return { estadoCuotas: "Sin cuotas", cuotasVencidas: 0, montoVencido: 0 };
  }
  const hoy = claveHoyEcuador();
  const vencidas = lista.filter((c) => {
    const clave = claveFechaCalendario(c.fecha);
    return (
      clave != null && clave < hoy && (Number(c.montoPendiente) || 0) > 0.009
    );
  });
  const montoVencido = redondear2(
    vencidas.reduce((s, c) => s + (Number(c.montoPendiente) || 0), 0)
  );
  if (!vencidas.length) {
    return { estadoCuotas: "Al día", cuotasVencidas: 0, montoVencido: 0 };
  }
  const n = vencidas.length;
  return {
    estadoCuotas: `${n} cuota${n === 1 ? "" : "s"} vencida${
      n === 1 ? "" : "s"
    } ($${montoVencido.toFixed(2)})`,
    cuotasVencidas: n,
    montoVencido,
  };
}

function resumenPrestamo(regla, bitacora, cuotasPendientes = []) {
  const total = totalPrestamo(regla);
  const saldo = saldoActualPrestamo(regla);
  const abonado = montoAbonado(regla);
  const cuotas = cuotasPendientes || [];
  return {
    ...estadoCuotasPrestamo(cuotas),
    _id: regla._id,
    codigoPrestamo: regla.codigoPrestamo || "",
    tipoRegla: regla.tipoRegla,
    estadoRegla: regla.estadoRegla,
    tipoBeneficiario: regla.tipoBeneficiario,
    cedulaBeneficiario: regla.cedulaBeneficiario,
    nombreBeneficiario: regla.nombreBeneficiario,
    centroCosto: regla.centroCosto,
    fechaDesembolso: regla.fechaDesembolso || regla.fechaInicioPagos,
    montoPrestado: redondear2(regla.montoPrestado),
    porcentajeInteres: regla.porcentajeInteres || 0,
    montoInteres: redondear2(regla.montoInteres),
    montoTotalDeuda: total,
    montoAbonado: abonado,
    saldoPendientePrestamo: saldo,
    puedeAbonar: saldo > 0.009 && regla.estadoRegla === "Autorizada",
    cuotas: regla.cuotas || cuotas.length,
    cuotaEvento: redondear2(regla.cuotaEvento),
    cuotasPendientes: cuotas,
    bitacora: bitacora || [],
  };
}

async function listarPersonasConPrestamoActivo(tipoBeneficiario) {
  const filtro = {
    tipoRegla: "D",
    estadoRegla: "Autorizada",
    saldoPendientePrestamo: { $gt: 0.009 },
    transaccionNomina: { $not: /anticipo/i },
  };
  if (tipoBeneficiario === "Interno" || tipoBeneficiario === "Externo") {
    filtro.tipoBeneficiario = tipoBeneficiario;
  }
  const reglas = await ReglaPagoNomina.find(filtro)
    .select("cedulaBeneficiario nombreBeneficiario tipoBeneficiario")
    .lean();
  const mapa = new Map();
  for (const regla of reglas) {
    const cedula = (regla.cedulaBeneficiario || "").trim();
    if (!cedula || mapa.has(cedula)) continue;
    const nombre = (regla.nombreBeneficiario || "").trim();
    mapa.set(cedula, {
      cedula,
      nombre,
      tipoBeneficiario: regla.tipoBeneficiario || "Interno",
      etiquetaDisplay: `${nombre || "Sin nombre"} — ${cedula}`,
    });
  }
  return Array.from(mapa.values()).sort((a, b) =>
    (a.nombre || "").localeCompare(b.nombre || "", "es")
  );
}

async function listarPrestamosActivos(filtros = {}) {
  const filtro = {
    tipoRegla: "D",
    estadoRegla: { $in: ["Autorizada", "Finalizada"] },
    transaccionNomina: { $not: /anticipo/i },
  };
  const tipo = (filtros.tipoBeneficiario || "").toString().trim();
  if (tipo === "Interno" || tipo === "Externo") {
    filtro.tipoBeneficiario = tipo;
  }
  const cedula = (filtros.cedula || "").toString().trim();
  const nombre = (filtros.nombre || "").toString().trim();
  const q = (filtros.q || "").toString().trim();
  const or = [];
  if (cedula) {
    or.push({ cedulaBeneficiario: new RegExp(escapeRegex(cedula), "i") });
  }
  if (nombre) {
    or.push({ nombreBeneficiario: new RegExp(escapeRegex(nombre), "i") });
  }
  if (q) {
    or.push(
      { cedulaBeneficiario: new RegExp(escapeRegex(q), "i") },
      { nombreBeneficiario: new RegExp(escapeRegex(q), "i") }
    );
  }
  if (or.length) filtro.$or = or;
  if (filtros.soloPendientes !== false) {
    filtro.estadoRegla = "Autorizada";
    filtro.saldoPendientePrestamo = { $gt: 0.009 };
  }

  const reglas = await ReglaPagoNomina.find(filtro).sort({
    nombreBeneficiario: 1,
    createdAt: -1,
  });
  const incluirDetalle =
    filtros.incluirDetalle !== false &&
    filtros.incluirDetalle !== "false" &&
    filtros.incluirDetalle !== "0";
  const resultado = [];
  for (const regla of reglas) {
    await asignarCodigoPrestamoSiFalta(regla);
    if (regla.isModified && regla.isModified("codigoPrestamo")) {
      await regla.save();
    }
    if (!incluirDetalle) {
      // Sin bitácora ni detalle de cuotas, pero con el estado (al día / vencidas).
      const resumen = resumenPrestamo(regla, [], await listarCuotasPrestamo(regla));
      resumen.cuotasPendientes = [];
      resultado.push(resumen);
      continue;
    }
    const bitacora = await bitacoraDeRegla(regla);
    const cuotasPendientes = await listarCuotasPrestamo(regla);
    resultado.push(resumenPrestamo(regla, bitacora, cuotasPendientes));
  }
  return resultado;
}

function estadoCuotaVisible(pagada, montoPagado) {
  if (pagada) return "Pagada";
  return (Number(montoPagado) || 0) > 0.009 ? "Abonada" : "Pendiente";
}

/** Abonos parciales de préstamos internos, indexados por número de cuota. */
function mapaAbonosCuotas(regla) {
  const mapa = new Map();
  for (const a of regla.abonosCuotasPrestamo || []) {
    mapa.set(Number(a.numeroCuota), redondear2(a.montoAbonado));
  }
  return mapa;
}

/** Todas las cuotas del préstamo (pagadas y pendientes), ordenadas por fecha. */
async function listarCuotasPrestamo(regla) {
  const cobros = await EventoCobroPrestamo.find({
    reglaPagoId: regla._id,
    estado: { $ne: "Anulado" },
  })
    .sort({ fechaProgramada: 1, numeroCuota: 1 })
    .lean();
  if (cobros.length) {
    const totalCuotas = Math.max(
      cobros.length,
      ...cobros.map((c) => Number(c.numeroCuota) || 0)
    );
    return cobros.map((c) => {
      const monto = redondear2(c.monto);
      const pagado =
        c.estado === "Ejecutado"
          ? Math.max(redondear2(c.montoPagado || 0), monto)
          : redondear2(c.montoPagado || 0);
      return {
        numeroCuota: c.numeroCuota,
        totalCuotas,
        fecha: c.fechaProgramada || c.fechaMin,
        monto,
        montoPagado: pagado,
        montoPendiente: redondear2(Math.max(0, monto - pagado)),
        estado: estadoCuotaVisible(c.estado === "Ejecutado", pagado),
      };
    });
  }

  const tabla = regla.tablaAmortizacion || [];
  const saldo = saldoActualPrestamo(regla);
  // Cuotas que ya salieron de la tabla (pagadas por nómina o cubiertas por abono).
  const historialPagadas = (regla.cuotasPagadasPrestamo || []).map((fila) => ({
    numeroCuota: fila.numeroCuota,
    fechaMin: fila.fechaMin,
    fechaMax: fila.fechaMax,
    monto: fila.monto,
    montoPagado: fila.monto,
    pagada: true,
  }));
  let filas;
  if (!tabla.length) {
    const reconstruida = await reconstruirTablaInternaPorSaldo(regla, saldo);
    filas = reconstruida.map((fila) => ({ ...fila, montoPagado: 0 }));
  } else {
    const sumaTabla = redondear2(
      tabla.reduce((s, f) => s + (Number(f.monto) || 0), 0)
    );
    if (Math.abs(sumaTabla - saldo) <= 0.05) {
      filas = tabla.map((fila) => ({
        ...filaAmortizacionPlain(fila),
        montoPagado: 0,
      }));
    } else {
      const { pagadas, pendientes } = extraerPendientesDeTabla(
        tabla,
        redondear2(Math.max(0, totalPrestamo(regla) - saldo))
      );
      filas = [
        ...pagadas.map((fila) => ({ ...fila, montoPagado: fila.monto, pagada: true })),
        ...pendientes,
      ];
    }
  }
  // En la tabla interna el monto ya viene reducido por los abonos parciales
  // (es lo que se descuenta en nómina); para mostrar se suma lo abonado.
  const abonos = mapaAbonosCuotas(regla);
  filas = [
    ...historialPagadas,
    ...filas.map((fila) => {
      const abonado = abonos.get(Number(fila.numeroCuota)) || 0;
      if (!(abonado > 0.009)) return fila;
      return {
        ...fila,
        monto: redondear2((Number(fila.monto) || 0) + abonado),
        montoPagado: redondear2((Number(fila.montoPagado) || 0) + abonado),
      };
    }),
  ];
  const total = Math.max(
    filas.length,
    ...filas.map((f) => Number(f.numeroCuota) || 0)
  );
  return filas.map((fila) => {
    const montoPagado = redondear2(fila.montoPagado || 0);
    return {
      numeroCuota: fila.numeroCuota,
      totalCuotas: total,
      fecha: fila.fechaMin || fila.fechaMax,
      monto: redondear2(fila.monto),
      montoPagado,
      montoPendiente: fila.pagada
        ? 0
        : redondear2(Math.max(0, (Number(fila.monto) || 0) - montoPagado)),
      estado: estadoCuotaVisible(fila.pagada, montoPagado),
    };
  });
}

async function sincronizarTablaDesdeCobros(regla) {
  const vigentes = await EventoCobroPrestamo.find({
    reglaPagoId: regla._id,
    estado: { $ne: "Anulado" },
  }).sort({ numeroCuota: 1 });
  const totalCuotas = vigentes.length;
  for (const cobro of vigentes) {
    if (cobro.totalCuotas !== totalCuotas) {
      cobro.totalCuotas = totalCuotas;
      await cobro.save();
    }
  }
  regla.tablaAmortizacion = vigentes.map((c) => ({
    numeroCuota: c.numeroCuota,
    fechaMin: c.fechaMin || c.fechaProgramada,
    fechaMax: c.fechaMax || c.fechaProgramada,
    monto: redondear2(c.monto),
  }));
  regla.cuotas = totalCuotas;
}

async function refinanciarCobrosPrestamo(regla, montoAbono) {
  const cobros = await EventoCobroPrestamo.find({
    reglaPagoId: regla._id,
    estado: { $in: ["Pendiente", "Parcial"] },
  }).sort({ fechaProgramada: 1, numeroCuota: 1 });
  if (!cobros.length) return null;

  const resultado = refinanciarCuotasProximas(cobros, montoAbono);
  // Las cuotas cubiertas por el abono se marcan como pagadas (no se eliminan)
  // para conservar el historial de cuotas del préstamo.
  for (const row of resultado.eliminados) {
    const cobro = row.item;
    cobro.estado = "Ejecutado";
    cobro.montoPagado = redondear2(cobro.monto);
    cobro.notas = [cobro.notas, "Cuota cubierta por abono extraordinario"]
      .filter(Boolean)
      .join(" | ");
    await cobro.save();
  }
  // El valor de la cuota se conserva; lo abonado se suma a montoPagado
  // y el cobro posterior solo exige el pendiente (monto - montoPagado).
  for (const row of resultado.ajustados) {
    const cobro = row.item;
    if (row.accion === "cerrar") {
      cobro.estado = "Ejecutado";
      cobro.montoPagado = redondear2(cobro.monto);
      cobro.notas = [cobro.notas, "Saldo de cuota cubierto por abono"]
        .filter(Boolean)
        .join(" | ");
    } else {
      const aplicado = redondear2(row.monto - row.montoNuevo);
      cobro.montoPagado = redondear2((Number(cobro.montoPagado) || 0) + aplicado);
      cobro.estado = "Parcial";
      cobro.notas = [
        cobro.notas,
        `Abono de $${aplicado.toFixed(2)} a la cuota`,
      ]
        .filter(Boolean)
        .join(" | ");
    }
    await cobro.save();
  }
  await sincronizarTablaDesdeCobros(regla);
  return resultado;
}

async function reconstruirTablaInternaPorSaldo(regla, saldo) {
  const fuentes = fuentesSeleccionadas(regla);
  if (!fuentes.length) return [];
  const ids = fuentes.map((f) => f.reglaPagoId);
  const eventos = await EventoPagoProgramado.find({
    reglaPagoId: { $in: ids },
    estado: { $in: ["Pendiente", "Parcial"] },
  }).sort({ fechaProgramada: 1, numeroCuota: 1 });

  let rest = redondear2(saldo);
  const tabla = [];
  let n = 0;
  for (const evento of eventos) {
    if (!(rest > 0.009)) break;
    if (evento.omitirDescuentoPrestamo) continue;
    const cuotaRef = cuotaFuenteParaRegla(regla, evento.reglaPagoId);
    if (!(cuotaRef > 0.009)) continue;
    const monto = redondear2(Math.min(cuotaRef, rest));
    if (!(monto > 0.009)) continue;
    n += 1;
    rest = redondear2(rest - monto);
    tabla.push({
      numeroCuota: n,
      fechaMin: evento.fechaProgramada,
      fechaMax: evento.fechaProgramada,
      monto,
    });
  }
  return tabla;
}

async function refinanciarPlanCuotasPrestamo(regla, montoAbono, saldoAntes) {
  const porCobros = await refinanciarCobrosPrestamo(regla, montoAbono);
  if (porCobros) {
    return {
      texto: textoRefinanciacion(porCobros),
      cuotasEliminadas: porCobros.cuotasEliminadas,
      cuotasAjustadas: porCobros.cuotasAjustadas,
    };
  }

  const tabla = regla.tablaAmortizacion || [];
  let pendientes = [];
  let pagadasTabla = [];
  if (tabla.length) {
    const sumaTabla = redondear2(
      tabla.reduce((s, f) => s + (Number(f.monto) || 0), 0)
    );
    if (Math.abs(sumaTabla - redondear2(saldoAntes)) <= 0.05) {
      pendientes = tabla.map((fila) => ({
        ...filaAmortizacionPlain(fila),
        montoPagado: 0,
      }));
    } else {
      const extraidas = extraerPendientesDeTabla(
        tabla,
        redondear2(Math.max(0, totalPrestamo(regla) - saldoAntes))
      );
      pendientes = extraidas.pendientes;
      pagadasTabla = extraidas.pagadas;
    }
  }
  if (!pendientes.length) {
    pendientes = await reconstruirTablaInternaPorSaldo(regla, saldoAntes);
  }
  if (!pendientes.length) {
    return { texto: "", cuotasEliminadas: 0, cuotasAjustadas: 0 };
  }

  const resultado = refinanciarCuotasProximas(pendientes, montoAbono);
  // Abonos parciales previos por cuota: al salir la cuota de la tabla se
  // suman para guardar su valor original en el historial.
  const abonos = mapaAbonosCuotas(regla);
  const montoOriginal = (numeroCuota, monto) => {
    const n = Number(numeroCuota);
    const abonado = abonos.get(n) || 0;
    abonos.delete(n);
    return redondear2((Number(monto) || 0) + abonado);
  };
  // Guarda en el historial las cuotas que salen de la tabla (ya pagadas
  // por nómina o cubiertas por este abono) para seguir mostrándolas.
  const fechaAbono = new Date();
  regla.cuotasPagadasPrestamo = [
    ...(regla.cuotasPagadasPrestamo || []),
    ...pagadasTabla.map((fila) => ({
      numeroCuota: fila.numeroCuota,
      fechaMin: fila.fechaMin,
      fechaMax: fila.fechaMax,
      monto: montoOriginal(fila.numeroCuota, fila.monto),
      origen: "Nómina",
      fechaRegistro: fechaAbono,
    })),
    ...resultado.eliminados.map((row) => ({
      numeroCuota: row.item.numeroCuota,
      fechaMin: row.item.fechaMin,
      fechaMax: row.item.fechaMax || row.item.fechaMin,
      monto: montoOriginal(row.item.numeroCuota, row.monto),
      origen: "Abono extraordinario",
      fechaRegistro: fechaAbono,
    })),
  ];
  regla.markModified("cuotasPagadasPrestamo");
  // Cuota abonada parcialmente: en la tabla queda el pendiente (lo que se
  // descuenta en nómina) y lo abonado se registra para mostrarlo.
  for (const row of resultado.ajustados) {
    if (row.accion !== "ajustar") continue;
    const n = Number(row.item.numeroCuota);
    const aplicado = redondear2(row.monto - row.montoNuevo);
    abonos.set(n, redondear2((abonos.get(n) || 0) + aplicado));
  }
  regla.abonosCuotasPrestamo = Array.from(abonos.entries()).map(
    ([numeroCuota, montoAbonado]) => ({ numeroCuota, montoAbonado })
  );
  regla.markModified("abonosCuotasPrestamo");
  regla.tablaAmortizacion = (resultado.vigentes || []).map((row) =>
    filaAmortizacionPlain({
      ...row.item,
      monto: row.accion === "mantener" ? row.monto : row.montoNuevo,
    })
  );
  regla.cuotas = (regla.tablaAmortizacion || []).length;
  return {
    texto: textoRefinanciacion(resultado),
    cuotasEliminadas: resultado.cuotasEliminadas,
    cuotasAjustadas: resultado.cuotasAjustadas,
  };
}

async function ejecutarAbonoPrestamo(reglaId, opciones = {}) {
  const regla = await ReglaPagoNomina.findById(reglaId);
  if (!regla) {
    throw new Error("Préstamo no encontrado");
  }
  if (regla.tipoRegla !== "D") {
    throw new Error("Solo se pueden abonar préstamos tipo D");
  }
  if (regla.estadoRegla !== "Autorizada") {
    throw new Error("El préstamo no está activo");
  }
  const saldoAntes = saldoActualPrestamo(regla);
  if (!(saldoAntes > 0.009)) {
    throw new Error("El préstamo ya no tiene saldo pendiente");
  }
  const monto = redondear2(opciones.monto);
  if (!(monto > 0.009)) {
    throw new Error("Indique un monto de abono mayor a cero");
  }
  if (monto > saldoAntes + 0.01) {
    throw new Error(
      `El abono ($${monto.toFixed(2)}) supera el saldo pendiente ($${saldoAntes.toFixed(
        2
      )})`
    );
  }

  const cuenta = await cobroPrestamoNominaService.resolverCuentaCobroPrestamo();
  const fechaContable = new Date();
  const saldoDespues = redondear2(Math.max(0, saldoAntes - monto));
  const notas = [
    (regla.codigoPrestamo || "").trim()
      ? `Préstamo ${regla.codigoPrestamo}`
      : "",
    `Abono extraordinario préstamo — ${regla.nombreBeneficiario || ""}`,
    "1.3 INGRESOS / 1.3.3 Pago o Abono Préstamo",
    opciones.notas || "",
  ]
    .filter(Boolean)
    .join(". ");

  const tx = new TransaccionFinanciera({
    fecha: fechaContable,
    fechaContable,
    sucursal: opciones.sucursal || "matriz",
    cliente: regla.nombreBeneficiario,
    beneficiario: regla.nombreBeneficiario,
    cedula: regla.cedulaBeneficiario,
    centroCosto: regla.centroCosto,
    isContabilizada: true,
    usuario: opciones.usuario || "",
    valor: monto,
    tipoPago: "Ingreso",
    cuenta: cuenta.cuenta,
    tipoCuenta: cuenta.tipoCuentaIngreso,
    subCuenta: cuenta.subCuenta,
    tipoTransaccion: "ABONO_PRESTAMO_NOMINA",
    referenciaPrestamo: String(regla._id),
    notas,
  });
  await tx.save();

  regla.saldoPendientePrestamo = saldoDespues;
  regla.abonosPrestamo = regla.abonosPrestamo || [];
  regla.abonosPrestamo.push({
    fecha: fechaContable,
    monto,
    transaccionFinancieraId: tx._id,
    transaccionNominaOrigen: "Abono extraordinario",
    tipoMovimiento: "Abono extraordinario",
    saldoAntes,
    saldoDespues,
    notas: opciones.notas || "Abono extraordinario",
    ejecutadoPor: opciones.usuario || "",
  });
  if (saldoDespues <= 0.009) {
    regla.saldoPendientePrestamo = 0;
    regla.estadoRegla = "Finalizada";
  }

  const refinanciacion = await refinanciarPlanCuotasPrestamo(
    regla,
    monto,
    saldoAntes
  );
  const notasAbono = [
    opciones.notas || "Abono extraordinario",
    refinanciacion && refinanciacion.texto,
  ]
    .filter(Boolean)
    .join(". ");
  const ultimoAbono = regla.abonosPrestamo[regla.abonosPrestamo.length - 1];
  if (ultimoAbono) ultimoAbono.notas = notasAbono;
  regla.markModified("tablaAmortizacion");
  regla.markModified("abonosPrestamo");
  await regla.save();

  await registrarBitacoraPrestamo({
    regla,
    tipoMovimiento: "Abono extraordinario",
    monto,
    saldoAntes,
    saldoDespues: regla.saldoPendientePrestamo,
    transaccionFinancieraId: tx._id,
    ejecutadoPor: opciones.usuario || "",
    notas: notasAbono,
    fecha: fechaContable,
  });

  // Préstamos que descuentan de pagos programados (internos o externos
  // con modalidad "Descuento de eventos"): recalcular los descuentos.
  if (
    (regla.tipoBeneficiario || "") === "Interno" ||
    regla.modalidadCobroExterno === "Descuento de eventos"
  ) {
    await recalcularPrestamosBeneficiario(regla.cedulaBeneficiario);
  }

  const bitacora = await bitacoraDeRegla(regla);
  const cuotasPendientes = await listarCuotasPrestamo(regla);
  return {
    prestamo: resumenPrestamo(regla, bitacora, cuotasPendientes),
    transaccion: tx,
    montoAbonado: monto,
    saldoPrestamo: regla.saldoPendientePrestamo,
    refinanciacion,
  };
}

module.exports = {
  listarPersonasConPrestamoActivo,
  listarPrestamosActivos,
  ejecutarAbonoPrestamo,
};
