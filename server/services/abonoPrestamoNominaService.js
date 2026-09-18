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
  refinanciarCuotasDesdeAtras,
  textoRefinanciacion,
  extraerPendientesDeTabla,
  filaAmortizacionPlain,
} = require("../utils/refinanciarCuotasPrestamo");
const cobroPrestamoNominaService = require("./cobroPrestamoNominaService");

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

function resumenPrestamo(regla, bitacora, cuotasPendientes = []) {
  const total = totalPrestamo(regla);
  const saldo = saldoActualPrestamo(regla);
  const abonado = montoAbonado(regla);
  const cuotas = cuotasPendientes || [];
  return {
    _id: regla._id,
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
  const resultado = [];
  for (const regla of reglas) {
    const bitacora = await bitacoraDeRegla(regla);
    const cuotasPendientes = await listarCuotasPendientesPrestamo(regla);
    resultado.push(resumenPrestamo(regla, bitacora, cuotasPendientes));
  }
  return resultado;
}

async function listarCuotasPendientesPrestamo(regla) {
  const cobros = await EventoCobroPrestamo.find({
    reglaPagoId: regla._id,
    estado: { $in: ["Pendiente", "Parcial"] },
  })
    .sort({ numeroCuota: 1 })
    .lean();
  if (cobros.length) {
    const totalVigentes = await EventoCobroPrestamo.countDocuments({
      reglaPagoId: regla._id,
      estado: { $ne: "Anulado" },
    });
    return cobros.map((c) => ({
      numeroCuota: c.numeroCuota,
      totalCuotas: totalVigentes,
      fecha: c.fechaProgramada || c.fechaMin,
      monto: redondear2(c.monto),
      montoPagado: redondear2(c.montoPagado || 0),
      montoPendiente: redondear2(
        Math.max(0, (Number(c.monto) || 0) - (Number(c.montoPagado) || 0))
      ),
      estado: c.estado,
    }));
  }

  const tabla = regla.tablaAmortizacion || [];
  const saldo = saldoActualPrestamo(regla);
  if (!tabla.length) {
    const reconstruida = await reconstruirTablaInternaPorSaldo(regla, saldo);
    return reconstruida.map((fila) => ({
      numeroCuota: fila.numeroCuota,
      totalCuotas: reconstruida.length,
      fecha: fila.fechaMin || fila.fechaMax,
      monto: redondear2(fila.monto),
      montoPagado: 0,
      montoPendiente: redondear2(fila.monto),
      estado: "Pendiente",
    }));
  }
  const sumaTabla = redondear2(
    tabla.reduce((s, f) => s + (Number(f.monto) || 0), 0)
  );
  const filasPendientes =
    Math.abs(sumaTabla - saldo) <= 0.05
      ? tabla.map((fila) => ({
          ...filaAmortizacionPlain(fila),
          montoPagado: 0,
        }))
      : extraerPendientesDeTabla(
          tabla,
          redondear2(Math.max(0, totalPrestamo(regla) - saldo))
        ).pendientes;
  const total = filasPendientes.length;
  return filasPendientes.map((fila) => ({
    numeroCuota: fila.numeroCuota,
    totalCuotas: total,
    fecha: fila.fechaMin || fila.fechaMax,
    monto: redondear2(fila.monto),
    montoPagado: redondear2(fila.montoPagado || 0),
    montoPendiente: redondear2(
      Math.max(0, (Number(fila.monto) || 0) - (Number(fila.montoPagado) || 0))
    ),
    estado: (fila.montoPagado || 0) > 0.009 ? "Parcial" : "Pendiente",
  }));
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
  }).sort({ numeroCuota: 1 });
  if (!cobros.length) return null;

  const resultado = refinanciarCuotasDesdeAtras(cobros, montoAbono);
  for (const row of resultado.eliminados) {
    await EventoCobroPrestamo.deleteOne({ _id: row.item._id });
  }
  for (const row of resultado.ajustados) {
    const cobro = row.item;
    cobro.monto = row.montoNuevo;
    if (row.accion === "cerrar") {
      cobro.estado = "Ejecutado";
      cobro.notas = [cobro.notas, "Saldo de cuota refinanciado por abono"]
        .filter(Boolean)
        .join(" | ");
    } else {
      cobro.notas = [
        cobro.notas,
        `Cuota refinanciada a $${row.montoNuevo.toFixed(2)} por abono`,
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

async function refinanciarPlanCuotasPrestamo(regla, montoAbono, saldoAntes, saldoDespues) {
  const porCobros = await refinanciarCobrosPrestamo(regla, montoAbono);
  if (porCobros) {
    return {
      texto: textoRefinanciacion(porCobros),
      cuotasEliminadas: porCobros.cuotasEliminadas,
      cuotasAjustadas: porCobros.cuotasAjustadas,
    };
  }

  const tablaInterna = await reconstruirTablaInternaPorSaldo(regla, saldoDespues);
  if (tablaInterna.length) {
    const cuotaRef =
      redondear2((fuentesSeleccionadas(regla)[0] || {}).monto) ||
      redondear2(regla.cuotaEvento);
    const cuotasAntes =
      cuotaRef > 0.009
        ? Math.ceil((redondear2(saldoAntes) - 0.009) / cuotaRef)
        : (regla.tablaAmortizacion || []).length;
    regla.tablaAmortizacion = tablaInterna;
    regla.cuotas = tablaInterna.length;
    const eliminadas = Math.max(0, cuotasAntes - tablaInterna.length);
    const ultima = tablaInterna[tablaInterna.length - 1];
    const cuotaTipica = redondear2(
      (tablaInterna[0] && tablaInterna[0].monto) || cuotaRef
    );
    const ajustoFinal =
      ultima &&
      cuotaTipica > 0 &&
      Math.abs(ultima.monto - cuotaTipica) > 0.01;
    const partes = [];
    if (eliminadas === 1) partes.push("se eliminó 1 cuota final");
    else if (eliminadas > 1) partes.push(`se eliminaron ${eliminadas} cuotas finales`);
    if (ajustoFinal) {
      partes.push(`la última cuota quedó en $${ultima.monto.toFixed(2)}`);
    }
    return {
      texto: partes.length ? `Refinanciación: ${partes.join("; ")}` : "",
      cuotasEliminadas: eliminadas,
      cuotasAjustadas: ajustoFinal ? 1 : 0,
    };
  }

  const tabla = regla.tablaAmortizacion || [];
  if (!tabla.length) {
    return { texto: "", cuotasEliminadas: 0, cuotasAjustadas: 0 };
  }

  const yaPagado = redondear2(Math.max(0, totalPrestamo(regla) - saldoAntes));
  const { pendientes } = extraerPendientesDeTabla(tabla, yaPagado);
  const resultado = refinanciarCuotasDesdeAtras(pendientes, montoAbono);
  regla.tablaAmortizacion = (resultado.vigentes || []).map((row) =>
    filaAmortizacionPlain({
      numeroCuota: row.item.numeroCuota,
      fechaMin: row.item.fechaMin,
      fechaMax: row.item.fechaMax || row.item.fechaMin,
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
    saldoAntes,
    regla.saldoPendientePrestamo
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

  if ((regla.tipoBeneficiario || "") === "Interno") {
    await recalcularPrestamosBeneficiario(regla.cedulaBeneficiario);
  }

  const bitacora = await bitacoraDeRegla(regla);
  const cuotasPendientes = await listarCuotasPendientesPrestamo(regla);
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
