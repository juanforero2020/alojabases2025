const ReglaPagoNomina = require("../models/reglaPagoNomina");
const EventoPagoProgramado = require("../models/eventoPagoProgramado");
const {
  montoDescuentoReglaCEnEvento,
} = require("./proyeccionPagosTipoC");
const {
  generarFechasPorRegla,
  etiquetaFechaCorta,
} = require("./proyeccionPagosNomina");
const { subCuentaAbonoPrestamoNomina, subCuentaDescuentoNomina, esAnticipoNomina } = require("./cuentasContablesNomina");
const { registrarBitacoraPrestamo } = require("./bitacoraPrestamoNomina");

const TRANSACCION_PRESTAMO = "Prestamos";
const TRANSACCION_ANTICIPO = "Anticipos";

function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function idStr(valor) {
  if (!valor) return "";
  if (typeof valor === "object" && valor._id) return String(valor._id);
  return String(valor);
}

function calcularMontosPrestamo(montoPrestado, porcentajeInteres) {
  const capital = redondear2(montoPrestado);
  const porcentaje = Math.max(0, Number(porcentajeInteres) || 0);
  const interes = redondear2((capital * porcentaje) / 100);
  const total = redondear2(capital + interes);
  return { montoPrestado: capital, porcentajeInteres: porcentaje, montoInteres: interes, montoTotal: total };
}

function fuentesSeleccionadas(reglaD) {
  return (reglaD.fuentesDescuentoPrestamo || []).filter((f) => {
    if (!f || !f.reglaPagoId) return false;
    if (f.seleccionado === false) return false;
    return redondear2(f.monto) > 0;
  });
}

function esReglaAnticipo(reglaD) {
  return esAnticipoNomina(reglaD && reglaD.transaccionNomina);
}

function cuotaFuenteParaEvento(reglaD, evento) {
  if (esReglaAnticipo(reglaD)) {
    const fuentes = fuentesSeleccionadas(reglaD);
    const porEvento = fuentes.find(
      (f) => idStr(f.eventoPagoId) === idStr(evento._id)
    );
    if (porEvento) return redondear2(porEvento.monto);
    return 0;
  }
  return cuotaFuenteParaRegla(reglaD, evento.reglaPagoId);
}

function inicioDelDiaLocal(valor) {
  const d = valor ? new Date(valor) : new Date();
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function domingoDeEstaSemana(hoy) {
  const d = inicioDelDiaLocal(hoy) || new Date();
  d.setHours(0, 0, 0, 0);
  const add = (7 - d.getDay()) % 7;
  const domingo = new Date(d);
  domingo.setDate(d.getDate() + add);
  return domingo;
}

function inicioSemanaLunes(hoy) {
  const d = inicioDelDiaLocal(hoy) || new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const lunes = new Date(d);
  lunes.setDate(d.getDate() + diff);
  return lunes;
}

function mismaFechaCalendario(a, b) {
  const x = inicioDelDiaLocal(a);
  const y = inicioDelDiaLocal(b);
  if (!x || !y) return false;
  return x.getTime() === y.getTime();
}

function esPagoDominical(regla, transaccion) {
  const t = (transaccion || regla.transaccionNomina || "").toString().toLowerCase();
  const f = (regla.frecuencia || "").toString().toLowerCase();
  return t.includes("dominical") || f === "dominical";
}

function elegirProximoEventoAnticipo(regla, eventos, hoy) {
  const pendientes = (eventos || [])
    .filter((e) => ["Pendiente", "Parcial"].includes(e.estado))
    .slice()
    .sort(
      (a, b) =>
        new Date(a.fechaProgramada) - new Date(b.fechaProgramada) ||
        (a.numeroCuota || 0) - (b.numeroCuota || 0)
    );
  if (!pendientes.length) return null;
  if (esPagoDominical(regla, pendientes[0].transaccionNomina)) {
    const domingo = domingoDeEstaSemana(hoy);
    return (
      pendientes.find((e) =>
        mismaFechaCalendario(e.fechaProgramada, domingo)
      ) || null
    );
  }
  const desde = inicioSemanaLunes(hoy);
  return (
    pendientes.find((e) => {
      const f = inicioDelDiaLocal(e.fechaProgramada);
      return f && f.getTime() >= desde.getTime();
    }) || null
  );
}

function cuotaFuenteParaRegla(reglaD, reglaPagoId) {
  const id = idStr(reglaPagoId);
  const fuente = fuentesSeleccionadas(reglaD).find(
    (f) => idStr(f.reglaPagoId) === id
  );
  return fuente ? redondear2(fuente.monto) : 0;
}

function esEventoVariable(evento, reglaPago) {
  return !!(
    evento?.modalidadMonto === "Variable" ||
    reglaPago?.montoVariable ||
    reglaPago?.frecuencia === "Dominical" ||
    (reglaPago?.transaccionNomina || "")
      .toString()
      .toLowerCase()
      .includes("dominical")
  );
}

function saldoActualPrestamo(reglaD) {
  if (reglaD.saldoPendientePrestamo != null) {
    return redondear2(Math.max(0, Number(reglaD.saldoPendientePrestamo) || 0));
  }
  return redondear2(
    reglaD.montoTotalDeuda || reglaD.monto || reglaD.montoPrestado || 0
  );
}

async function listarReglasPagoAsociablesPrestamo(cedula) {
  const doc = (cedula || "").trim();
  if (!doc) return [];
  return ReglaPagoNomina.find({
    cedulaBeneficiario: doc,
    tipoRegla: { $in: ["A", "B"] },
    estadoRegla: "Autorizada",
  })
    .select(
      "_id transaccionNomina frecuencia parametro monto montoVariable tipoRegla nombreBeneficiario cedulaBeneficiario centroCosto"
    )
    .sort({ tipoRegla: 1, transaccionNomina: 1, createdAt: -1 })
    .lean();
}

async function cargarReglasCPorReglaA(idsReglaA) {
  if (!idsReglaA.length) return new Map();
  const reglasC = await ReglaPagoNomina.find({
    reglaPagoAsociadaId: { $in: idsReglaA },
    tipoRegla: "C",
    estadoRegla: "Autorizada",
  }).lean();
  const mapa = new Map();
  for (const reglaC of reglasC) {
    const clave = idStr(reglaC.reglaPagoAsociadaId);
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(reglaC);
  }
  return mapa;
}

async function cargarEventosPorReglaA(idsReglaA) {
  if (!idsReglaA.length) return new Map();
  const eventos = await EventoPagoProgramado.find({
    reglaPagoId: { $in: idsReglaA },
  }).sort({ fechaProgramada: 1 });
  const mapa = new Map();
  for (const ev of eventos) {
    const clave = idStr(ev.reglaPagoId);
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(ev);
  }
  return mapa;
}

function descuentoCDeEvento(evento, reglasCPorA, eventosPorA) {
  const clave = idStr(evento.reglaPagoId);
  const reglasC = reglasCPorA.get(clave) || [];
  if (!reglasC.length) return 0;
  const todos = eventosPorA.get(clave) || [evento];
  let total = 0;
  for (const reglaC of reglasC) {
    total = redondear2(
      total + montoDescuentoReglaCEnEvento(reglaC, evento, todos)
    );
  }
  return total;
}

function brutoDeEvento(evento, reglaPago) {
  if (esEventoVariable(evento, reglaPago)) {
    return 0;
  }
  if (evento.montoBruto != null && Number(evento.montoBruto) > 0) {
    return redondear2(evento.montoBruto);
  }
  const montoRegla = redondear2(reglaPago?.monto || 0);
  if (montoRegla > 0) return montoRegla;
  return redondear2(
    (Number(evento.monto) || 0) + (Number(evento.montoDescuento) || 0)
  );
}

async function contextoDescuentosBeneficiario(cedula) {
  const reglasD = await ReglaPagoNomina.find({
    cedulaBeneficiario: cedula,
    tipoRegla: "D",
    estadoRegla: "Autorizada",
  })
    .sort({ fechaAutorizacion: 1, createdAt: 1 })
    .lean();

  const eventos = await EventoPagoProgramado.find({
    cedulaBeneficiario: cedula,
    estado: { $in: ["Pendiente", "Parcial"] },
  }).sort({ fechaProgramada: 1, numeroCuota: 1 });

  const idsReglaPago = [
    ...new Set(eventos.map((e) => idStr(e.reglaPagoId)).filter(Boolean)),
  ];
  const reglasPago = await ReglaPagoNomina.find({
    _id: { $in: idsReglaPago },
  }).lean();
  const mapaReglasPago = new Map(
    reglasPago.map((r) => [idStr(r._id), r])
  );
  const idsA = reglasPago.filter((r) => r.tipoRegla === "A").map((r) => r._id);
  const reglasCPorA = await cargarReglasCPorReglaA(idsA);
  const eventosPorA = await cargarEventosPorReglaA(idsA);

  return {
    reglasD,
    eventos,
    mapaReglasPago,
    reglasCPorA,
    eventosPorA,
  };
}

function asignarDescuentosDEnEventos(ctx) {
  const {
    reglasD,
    eventos,
    mapaReglasPago,
    reglasCPorA,
    eventosPorA,
  } = ctx;
  const porEvento = new Map();

  for (const evento of eventos) {
    const reglaPago = mapaReglasPago.get(idStr(evento.reglaPagoId));
    if (evento.tipoRegla === "D" || reglaPago?.tipoRegla === "D") continue;
    const descC = descuentoCDeEvento(evento, reglasCPorA, eventosPorA);
    const bruto = brutoDeEvento(evento, reglaPago);
    const variable = esEventoVariable(evento, reglaPago);
    porEvento.set(idStr(evento._id), {
      evento,
      reglaPago,
      descC,
      descD: 0,
      bruto,
      variable,
      notasD: [],
      reglasDIds: [],
      lineasD: [],
    });
  }

  for (const reglaD of reglasD) {
    let saldo = saldoActualPrestamo(reglaD);
    if (saldo <= 0) continue;
    const notaD = String(reglaD.notas || "").trim();

    for (const evento of eventos) {
      if (saldo <= 0.009) break;
      const info = porEvento.get(idStr(evento._id));
      if (!info) continue;
      if (evento.omitirDescuentoPrestamo) continue;
      const cuota = cuotaFuenteParaEvento(reglaD, evento);
      if (!(cuota > 0)) continue;

      let disponible;
      if (info.variable) {
        disponible = cuota;
      } else {
        const bruto = info.bruto;
        if (!(bruto > 0)) continue;
        disponible = redondear2(Math.max(0, bruto - info.descC - info.descD));
      }
      const aplicar = redondear2(Math.min(cuota, saldo, disponible));
      if (!(aplicar > 0.009)) continue;

      const esAnticipo = esReglaAnticipo(reglaD);
      info.descD = redondear2(info.descD + aplicar);
      info.reglasDIds.push(reglaD._id);
      info.lineasD.push({
        reglaDescuentoId: reglaD._id,
        transaccionNomina: reglaD.transaccionNomina || TRANSACCION_PRESTAMO,
        conceptoDescuento: esAnticipo ? "Anticipo" : "Préstamo",
        etiqueta: esAnticipo
          ? `Anticipo (${evento.transaccionNomina || "pago"})`
          : `Préstamo (cuota ${evento.transaccionNomina || "pago"})`,
        monto: aplicar,
        centroCosto: (reglaD.centroCosto || "").trim() || undefined,
        notas: notaD || undefined,
        subCuenta: esAnticipo
          ? subCuentaDescuentoNomina(TRANSACCION_ANTICIPO)
          : subCuentaAbonoPrestamoNomina(),
      });
      if (notaD && !info.notasD.includes(notaD)) info.notasD.push(notaD);
      saldo = redondear2(saldo - aplicar);
    }
  }

  return porEvento;
}

async function reactivarPrestamosCerradosPorDesembolso(cedula) {
  const doc = (cedula || "").trim();
  if (!doc) return 0;
  const cerradas = await ReglaPagoNomina.find({
    cedulaBeneficiario: doc,
    tipoRegla: "D",
    estadoRegla: "Finalizada",
    saldoPendientePrestamo: { $gt: 0.009 },
  });
  let reabiertas = 0;
  for (const regla of cerradas) {
    const desembolsoPagado = await EventoPagoProgramado.countDocuments({
      reglaPagoId: regla._id,
      tipoRegla: "D",
      estado: "Ejecutado",
    });
    if (!desembolsoPagado) continue;
    regla.estadoRegla = "Autorizada";
    await regla.save();
    reabiertas += 1;
  }
  return reabiertas;
}

async function recalcularPrestamosBeneficiario(cedula) {
  const doc = (cedula || "").trim();
  if (!doc) return 0;
  await reactivarPrestamosCerradosPorDesembolso(doc);
  const ctx = await contextoDescuentosBeneficiario(doc);
  const asignado = asignarDescuentosDEnEventos(ctx);
  let actualizados = 0;

  for (const info of asignado.values()) {
    const evento = info.evento;
    const descTotal = redondear2(info.descC + info.descD);
    const notasC = [];
    const claveA = idStr(evento.reglaPagoId);
    const reglasC = ctx.reglasCPorA.get(claveA) || [];
    for (const reglaC of reglasC) {
      const todos = ctx.eventosPorA.get(claveA) || [];
      if (montoDescuentoReglaCEnEvento(reglaC, evento, todos) > 0) {
        const n = String(reglaC.notas || "").trim();
        if (n) notasC.push(n);
      }
    }
    let notas = [...new Set([...notasC, ...info.notasD])].join(" | ");
    if (evento.omitirDescuentoPrestamo) {
      const marca = "Préstamo omitido esta semana — se cobrará en un pago posterior";
      notas = notas ? `${notas} | ${marca}` : marca;
    }
    evento.montoDescuentoPrestamo = info.descD;

    if (info.variable) {
      evento.montoDescuento = descTotal;
      if (info.reglasDIds[0]) {
        evento.reglaDescuentoId = info.reglasDIds[0];
      } else if (!info.descC) {
        evento.reglaDescuentoId = null;
      }
      evento.notas = notas;
    } else if (descTotal > 0.009 && info.bruto > 0) {
      evento.montoBruto = info.bruto;
      evento.montoDescuento = descTotal;
      evento.monto = redondear2(Math.max(0, info.bruto - descTotal));
      evento.reglaDescuentoId =
        (reglasC[0] && info.descC > 0 ? reglasC[0]._id : null) ||
        info.reglasDIds[0] ||
        evento.reglaDescuentoId ||
        null;
      evento.notas = notas;
    } else if (info.descC <= 0.009) {
      evento.monto = info.bruto || evento.monto;
      evento.montoBruto = null;
      evento.montoDescuento = 0;
      evento.reglaDescuentoId = null;
      evento.notas = notas || "";
    } else {
      evento.montoBruto = info.bruto;
      evento.montoDescuento = info.descC;
      evento.monto = redondear2(Math.max(0, info.bruto - info.descC));
      evento.notas = notas;
    }

    await evento.save();
    actualizados += 1;
  }

  return actualizados;
}

async function aplicarPrestamosSobreReglaPago(reglaPagoId) {
  if (!reglaPagoId) return 0;
  const regla = await ReglaPagoNomina.findById(reglaPagoId).lean();
  if (!regla?.cedulaBeneficiario) return 0;
  return recalcularPrestamosBeneficiario(regla.cedulaBeneficiario);
}

function lineasPrestamoParaEvento(evento, ctx) {
  if (evento.tipoRegla === "D") return [];
  const fromCtx = (ctx.eventos || []).find(
    (e) => idStr(e._id) === idStr(evento._id)
  );
  if (evento.omitirDescuentoPrestamo || fromCtx?.omitirDescuentoPrestamo) {
    return [];
  }
  const asignado = asignarDescuentosDEnEventos(ctx);
  const info = asignado.get(idStr(evento._id));
  return info && info.lineasD ? info.lineasD : [];
}

async function obtenerLineasPrestamoEvento(evento) {
  const cedula = (evento.cedulaBeneficiario || "").trim();
  if (!cedula) return [];
  const ctx = await contextoDescuentosBeneficiario(cedula);
  return lineasPrestamoParaEvento(evento, ctx);
}

async function registrarAbonosPrestamo(evento, lineas, opciones = {}) {
  const creadas = [];
  for (const linea of lineas || []) {
    const monto = redondear2(linea.monto);
    if (!(monto > 0.009) || !linea.reglaDescuentoId) continue;
    const reglaD = await ReglaPagoNomina.findById(linea.reglaDescuentoId);
    if (!reglaD || reglaD.tipoRegla !== "D") continue;

    const saldoAntes = saldoActualPrestamo(reglaD);
    const abono = redondear2(Math.min(monto, saldoAntes));
    if (!(abono > 0.009)) continue;

    reglaD.saldoPendientePrestamo = redondear2(Math.max(0, saldoAntes - abono));
    reglaD.abonosPrestamo = reglaD.abonosPrestamo || [];
    reglaD.abonosPrestamo.push({
      fecha: new Date(),
      monto: abono,
      eventoPagoId: evento._id,
      transaccionFinancieraId: opciones.transaccionId || undefined,
      transaccionNominaOrigen: evento.transaccionNomina || "",
      tipoMovimiento: "Descuento nomina",
      saldoAntes,
      saldoDespues: reglaD.saldoPendientePrestamo,
      notas: `Descuento en ${evento.transaccionNomina || "nómina"}`,
      ejecutadoPor: opciones.usuario || "",
    });
    if (reglaD.saldoPendientePrestamo <= 0.009) {
      reglaD.saldoPendientePrestamo = 0;
      reglaD.estadoRegla = "Finalizada";
    }
    await reglaD.save();
    await registrarBitacoraPrestamo({
      regla: reglaD,
      tipoMovimiento: "Descuento nomina",
      monto: abono,
      saldoAntes,
      saldoDespues: reglaD.saldoPendientePrestamo,
      transaccionFinancieraId: opciones.transaccionId || undefined,
      eventoPagoId: evento._id,
      ejecutadoPor: opciones.usuario || "",
      notas: `Descuento en ${evento.transaccionNomina || "nómina"}`,
    });
    creadas.push({ reglaD, monto: abono, linea });
  }

  if (evento.cedulaBeneficiario) {
    await recalcularPrestamosBeneficiario(evento.cedulaBeneficiario);
  }
  return creadas;
}

async function quitarDescuentosPrestamo(reglaD) {
  if (reglaD?._id) {
    await EventoPagoProgramado.deleteMany({
      reglaPagoId: reglaD._id,
      estado: { $in: ["Pendiente", "Parcial"] },
    });
  }
  const cedula = (reglaD?.cedulaBeneficiario || "").trim();
  if (!cedula) return 0;
  return recalcularPrestamosBeneficiario(cedula);
}

function esPrestamoExterno(regla) {
  return (regla.tipoBeneficiario || "").toString().trim().toLowerCase() === "externo";
}

function construirProyeccionCobrosExternos(regla, total) {
  const MESES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  const tabla = regla.tablaAmortizacion || [];
  const mapa = new Map();
  let saldo = total;
  for (const fila of tabla) {
    const fecha = new Date(fila.fechaMin || fila.fechaMax || fila.fechaProgramada);
    if (isNaN(fecha.getTime())) continue;
    const key = `${fecha.getFullYear()}-${fecha.getMonth()}`;
    if (!mapa.has(key)) {
      mapa.set(key, {
        mes: MESES[fecha.getMonth()],
        anio: fecha.getFullYear(),
        ocurrencias: [],
      });
    }
    const monto = redondear2(fila.monto);
    saldo = redondear2(Math.max(0, saldo - monto));
    mapa.get(key).ocurrencias.push({
      fecha,
      etiqueta: `Cobro préstamo cuota ${fila.numeroCuota || ""}`.trim(),
      monto,
      montoNeto: monto,
      estado: "Pendiente",
    });
  }
  return {
    etiquetaFila: "Cobros préstamo externo",
    meses: Array.from(mapa.values()),
    tipoRegla: "D",
    montoTotalDescuento: total,
  };
}

function construirProyeccionTipoD(regla, opciones = {}) {
  const fuentes = fuentesSeleccionadas(regla);
  const total = redondear2(
    regla.montoTotalDeuda || calcularMontosPrestamo(regla.montoPrestado, regla.porcentajeInteres).montoTotal
  );
  if (esPrestamoExterno(regla)) {
    return construirProyeccionCobrosExternos(regla, total);
  }
  if (!fuentes.length) {
    return {
      etiquetaFila: "Préstamo",
      meses: [],
      tipoRegla: "D",
      advertencia: "Seleccione al menos un tipo de pago para descontar el préstamo",
      montoTotalDescuento: total,
    };
  }

  const MESES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  const mapa = new Map();
  let saldo = total;
  const reglasAsociadas = opciones.reglasAsociadas || [];

  const fechasCombinadas = [];
  for (const fuente of fuentes) {
    const asociada =
      reglasAsociadas.find((r) => idStr(r._id) === idStr(fuente.reglaPagoId)) ||
      fuente;
    const fechas = generarFechasPorRegla(
      {
        ...asociada,
        frecuencia: asociada.frecuencia || fuente.frecuencia,
        parametro: asociada.parametro || fuente.parametro,
        fechaInicioPagos: asociada.fechaInicioPagos,
      },
      { mesesProyeccion: opciones.mesesProyeccion || 6 }
    );
    fechas.forEach((fecha) => {
      fechasCombinadas.push({
        fecha,
        fuente,
        asociada,
      });
    });
  }
  fechasCombinadas.sort((a, b) => a.fecha - b.fecha);

  fechasCombinadas.forEach((item) => {
    const { fecha, fuente, asociada } = item;
    const claveMes = `${fecha.getFullYear()}-${fecha.getMonth()}`;
    if (!mapa.has(claveMes)) {
      mapa.set(claveMes, {
        mes: MESES[fecha.getMonth()],
        anio: fecha.getFullYear(),
        ocurrencias: [],
      });
    }
    const bruto = redondear2(asociada.monto || fuente.montoPago || 0);
    const cuota = redondear2(Math.min(fuente.monto, Math.max(0, saldo)));
    const aplica = cuota > 0 && saldo > 0;
    const desc = aplica ? cuota : 0;
    if (aplica) saldo = redondear2(saldo - desc);
    const neto = redondear2(Math.max(0, bruto - desc));
    mapa.get(claveMes).ocurrencias.push({
      fecha,
      etiqueta: `${etiquetaFechaCorta(fecha)} ${fuente.transaccionNomina || ""}`.trim(),
      monto: neto,
      montoBruto: bruto,
      montoDescuento: desc,
      montoNeto: neto,
    });
  });

  return {
    etiquetaFila: `Préstamo $${total.toFixed(2)} (capital + interés)`,
    meses: Array.from(mapa.values()).sort(
      (a, b) =>
        a.anio - b.anio || MESES.indexOf(a.mes) - MESES.indexOf(b.mes)
    ),
    tipoRegla: "D",
    montoTotalDescuento: total,
    saldoPendiente: saldo,
  };
}

async function generarTablaPrestamoPrevia(regla, opciones = {}) {
  const montos = calcularMontosPrestamo(
    regla.montoPrestado,
    regla.porcentajeInteres
  );
  const total = montos.montoTotal;
  const fuentes = fuentesSeleccionadas(regla);
  if (!fuentes.length || !total) {
    return {
      tabla: [],
      total,
      cuotaEvento: 0,
      montoPrestado: montos.montoPrestado,
      montoInteres: montos.montoInteres,
      porcentajeInteres: montos.porcentajeInteres,
      saldoPendiente: total,
      validacionDescuento: {
        ok: false,
        mensaje: "Indique el préstamo y al menos un tipo de pago con cuota",
      },
    };
  }

  const ids = fuentes.map((f) => f.reglaPagoId);
  const eventos = await EventoPagoProgramado.find({
    reglaPagoId: { $in: ids },
    estado: "Pendiente",
  }).sort({ fechaProgramada: 1, numeroCuota: 1 });

  const reglasPago = await ReglaPagoNomina.find({ _id: { $in: ids } }).lean();
  const mapaReglas = new Map(reglasPago.map((r) => [idStr(r._id), r]));
  const idsA = reglasPago.filter((r) => r.tipoRegla === "A").map((r) => r._id);
  const reglasCPorA = await cargarReglasCPorReglaA(idsA);
  const eventosPorA = await cargarEventosPorReglaA(idsA);

  let saldo = total;
  const tabla = [];
  const conflictos = [];
  let n = 0;

  for (const evento of eventos) {
    if (saldo <= 0.009) break;
    if (evento.omitirDescuentoPrestamo) continue;
    const fuente = fuentes.find(
      (f) => idStr(f.reglaPagoId) === idStr(evento.reglaPagoId)
    );
    if (!fuente) continue;
    const reglaPago = mapaReglas.get(idStr(evento.reglaPagoId));
    const descC = descuentoCDeEvento(evento, reglasCPorA, eventosPorA);
    const variable = esEventoVariable(evento, reglaPago);
    const bruto = brutoDeEvento(evento, reglaPago);
    const disponible = variable
      ? redondear2(fuente.monto)
      : redondear2(Math.max(0, bruto - descC));
    const cuota = redondear2(Math.min(fuente.monto, saldo, disponible));
    if (!(cuota > 0.009)) {
      if (!variable && bruto > 0 && fuente.monto > disponible + 0.009) {
        conflictos.push({
          fecha: evento.fechaProgramada,
          bruto,
          disponible,
          cuota: fuente.monto,
          transaccion: evento.transaccionNomina,
        });
      }
      continue;
    }
    n += 1;
    saldo = redondear2(saldo - cuota);
    tabla.push({
      numeroCuota: n,
      fechaMin: evento.fechaProgramada,
      fechaMax: evento.fechaProgramada,
      monto: cuota,
      transaccionNomina: evento.transaccionNomina || fuente.transaccionNomina,
      montoBrutoPago: variable ? null : bruto,
      descuentoExistente: descC,
      descuentoNuevo: cuota,
      netoProyectado: variable ? null : redondear2(Math.max(0, bruto - descC - cuota)),
      descuentoValido: variable || bruto - descC - cuota >= -0.009,
      saldoDespues: saldo,
    });
  }

  const cuotaEvento = redondear2(
    fuentes.reduce((s, f) => s + (Number(f.monto) || 0), 0)
  );

  let validacionDescuento = { ok: true };
  if (conflictos.length) {
    const c = conflictos[0];
    validacionDescuento = {
      ok: false,
      mensaje: `La cuota de ${c.transaccion} ($${c.cuota.toFixed(
        2
      )}) supera lo disponible en el pago ($${c.disponible.toFixed(
        2
      )}). Reduzca la cuota referencial.`,
    };
  }

  return {
    tabla,
    total,
    cuotaEvento,
    montoPrestado: montos.montoPrestado,
    montoInteres: montos.montoInteres,
    porcentajeInteres: montos.porcentajeInteres,
    saldoPendiente: saldo,
    validacionDescuento,
  };
}

async function calcularDescuentoPrestamoParaPago(evento, montoDisponible) {
  if (evento.omitirDescuentoPrestamo || evento.tipoRegla === "D") {
    return { monto: 0, lineas: [] };
  }
  const cedula = (evento.cedulaBeneficiario || "").trim();
  if (!cedula) return { monto: 0, lineas: [] };
  const ctx = await contextoDescuentosBeneficiario(cedula);
  const lineas = lineasPrestamoParaEvento(evento, ctx);
  let disponible = redondear2(montoDisponible);
  const aplicadas = [];
  for (const linea of lineas) {
    if (disponible <= 0.009) break;
    const monto = redondear2(Math.min(linea.monto, disponible));
    if (monto > 0.009) {
      aplicadas.push({ ...linea, monto });
      disponible = redondear2(disponible - monto);
    }
  }
  const monto = redondear2(aplicadas.reduce((s, l) => s + l.monto, 0));
  return { monto, lineas: aplicadas };
}

async function omitirDescuentoPrestamoEvento(eventoId, opciones = {}) {
  const evento = await EventoPagoProgramado.findById(eventoId);
  if (!evento) throw new Error("Evento programado no encontrado");
  if (evento.estado !== "Pendiente" && evento.estado !== "Parcial") {
    throw new Error("Solo se puede omitir el préstamo en pagos pendientes");
  }

  const omitir = opciones.omitir !== false;
  const usuario = (opciones.usuario || "").toString().trim();

  if (omitir) {
    if (!evento.omitirDescuentoPrestamo) {
      const lineas = await obtenerLineasPrestamoEvento(evento);
      const monto = redondear2(
        lineas.reduce((s, l) => s + (Number(l.monto) || 0), 0)
      );
      if (!(monto > 0.009)) {
        throw new Error(
          "Este pago no tiene descuento de préstamo pendiente. Verifique el saldo del préstamo."
        );
      }
      evento.montoPrestamoOmitido = monto;
    }
    evento.omitirDescuentoPrestamo = true;
    evento.omitirDescuentoPrestamoPor = usuario;
    evento.fechaOmitirDescuentoPrestamo = new Date();
  } else {
    evento.omitirDescuentoPrestamo = false;
    evento.omitirDescuentoPrestamoPor = usuario;
    evento.fechaOmitirDescuentoPrestamo = new Date();
    evento.montoPrestamoOmitido = 0;
  }
  await evento.save();
  await recalcularPrestamosBeneficiario(evento.cedulaBeneficiario);
  return EventoPagoProgramado.findById(eventoId);
}

async function listarEventosDisponiblesAnticipo(cedula) {
  const doc = (cedula || "").trim();
  if (!doc) return [];
  const ctx = await contextoDescuentosBeneficiario(doc);
  const asignado = asignarDescuentosDEnEventos(ctx);
  const hoy = inicioDelDiaLocal(new Date());
  const porRegla = new Map();
  for (const evento of ctx.eventos || []) {
    if (evento.tipoRegla === "D") continue;
    const clave = idStr(evento.reglaPagoId);
    if (!clave) continue;
    if (!porRegla.has(clave)) porRegla.set(clave, []);
    porRegla.get(clave).push(evento);
  }

  const resultado = [];
  for (const [clave, eventosRegla] of porRegla.entries()) {
    const reglaPago = ctx.mapaReglasPago.get(clave);
    if (!reglaPago || !["A", "B"].includes(reglaPago.tipoRegla)) continue;
    const proximo = elegirProximoEventoAnticipo(reglaPago, eventosRegla, hoy);
    if (!proximo) continue;
    const info = asignado.get(idStr(proximo._id));
    const variable = !!(info && info.variable);
    const bruto = info
      ? redondear2(info.bruto)
      : brutoDeEvento(proximo, reglaPago);
    const descC = info ? redondear2(info.descC) : 0;
    const descD = info ? redondear2(info.descD) : 0;
    const descuentos = redondear2(descC + descD);
    const disponible =
      variable && !(bruto > 0.009)
        ? null
        : redondear2(Math.max(0, bruto - descuentos));
    if (!variable && !(disponible > 0.009)) continue;
    resultado.push({
      reglaPagoId: reglaPago._id,
      eventoPagoId: proximo._id,
      transaccionNomina: proximo.transaccionNomina || reglaPago.transaccionNomina,
      frecuencia: reglaPago.frecuencia,
      parametro: reglaPago.parametro,
      tipoRegla: reglaPago.tipoRegla,
      fechaEvento: proximo.fechaProgramada,
      montoVariable: variable,
      montoPago: bruto,
      montoDescuentoExistente: descuentos,
      montoDisponible: disponible,
      numeroCuota: proximo.numeroCuota,
      totalCuotas: proximo.totalCuotas,
      etiquetaDisplay: `${proximo.transaccionNomina || reglaPago.transaccionNomina} — ${reglaPago.frecuencia}`,
    });
  }
  return resultado.sort((a, b) => {
    const fa = new Date(a.fechaEvento) - new Date(b.fechaEvento);
    if (fa) return fa;
    return (a.transaccionNomina || "").localeCompare(b.transaccionNomina || "", "es");
  });
}

module.exports = {
  TRANSACCION_PRESTAMO,
  TRANSACCION_ANTICIPO,
  esReglaAnticipo,
  calcularMontosPrestamo,
  fuentesSeleccionadas,
  cuotaFuenteParaRegla,
  saldoActualPrestamo,
  listarReglasPagoAsociablesPrestamo,
  listarEventosDisponiblesAnticipo,
  recalcularPrestamosBeneficiario,
  aplicarPrestamosSobreReglaPago,
  obtenerLineasPrestamoEvento,
  registrarAbonosPrestamo,
  quitarDescuentosPrestamo,
  construirProyeccionTipoD,
  generarTablaPrestamoPrevia,
  calcularDescuentoPrestamoParaPago,
  omitirDescuentoPrestamoEvento,
};
