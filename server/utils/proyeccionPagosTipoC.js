const ReglaPagoNomina = require("../models/reglaPagoNomina");
const EventoPagoProgramado = require("../models/eventoPagoProgramado");
const {
  generarFechasPorRegla,
  etiquetaFechaCorta,
} = require("./proyeccionPagosNomina");

const CUOTAS_SEG_SOCIAL = 4;
const TRANSACCION_SEG_SOCIAL = "pago seguridad social";

function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function normalizarTexto(valor) {
  return (valor || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function esTransaccionSeguridadSocial(transaccion) {
  return normalizarTexto(transaccion).includes("seguridad social");
}

function esDescuentosGenerales(transaccion) {
  const t = normalizarTexto(transaccion);
  return t === "descuentos" || (!esTransaccionSeguridadSocial(transaccion) && t.includes("descuento"));
}

function inicioSemanaLunes(fecha) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  const dia = d.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  d.setDate(d.getDate() + diff);
  return d;
}

function mismaSemanaCalendario(fechaA, fechaB) {
  return (
    inicioSemanaLunes(fechaA).getTime() === inicioSemanaLunes(fechaB).getTime()
  );
}

function fechaReferenciaAplicacion(regla) {
  if (normalizarTexto(regla.semanaAplicacion) === "esta semana") {
    return new Date();
  }
  const f = regla.fechaAplicacionDescuento;
  return f ? new Date(f) : new Date();
}

function distribuirEnCuotas(total, n = CUOTAS_SEG_SOCIAL) {
  const t = redondear2(total);
  const cuotas = [];
  let acum = 0;
  for (let i = 0; i < n; i++) {
    const c =
      i === n - 1 ? redondear2(t - acum) : redondear2(t / n);
    cuotas.push(c);
    acum = redondear2(acum + c);
  }
  return cuotas;
}

function cuotaSegSocial(montoTotal) {
  const cuotas = distribuirEnCuotas(montoTotal);
  return cuotas[0] || 0;
}

/** Primeras 4 fechas semanales de cada mes calendario (índice 1–4). */
function mapaPrimerasCuatroSemanasDelMes(fechas) {
  const porMes = new Map();
  (fechas || []).forEach((f) => {
    const d = new Date(f);
    d.setHours(0, 0, 0, 0);
    const clave = `${d.getFullYear()}-${d.getMonth()}`;
    if (!porMes.has(clave)) porMes.set(clave, []);
    porMes.get(clave).push(d);
  });
  const indicePorFecha = new Map();
  porMes.forEach((lista) => {
    lista.sort((a, b) => a - b);
    lista.slice(0, CUOTAS_SEG_SOCIAL).forEach((f, i) => {
      indicePorFecha.set(f.getTime(), i + 1);
    });
  });
  return indicePorFecha;
}

function debeAplicarDescuentoEnFecha(fecha, indicePorFecha) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  return indicePorFecha.has(d.getTime());
}

function indiceCuotaEnMes(fecha, indicePorFecha) {
  return indicePorFecha.get(new Date(fecha).setHours(0, 0, 0, 0)) || 0;
}

function generarTablaCuotasSegSocial(regla, opciones = {}) {
  const total = redondear2(regla.montoTotalDeuda || regla.monto || 0);
  const cuotasValores = distribuirEnCuotas(total);
  const reglaRef = opciones.reglaAsociada || regla;
  const fechas = generarFechasPorRegla(reglaRef, {
    mesesProyeccion: opciones.mesesProyeccion || 3,
    fechaDesde: opciones.fechaDesde,
    fechaHasta: opciones.fechaHasta,
  });
  const indicePorFecha = mapaPrimerasCuatroSemanasDelMes(fechas);
  const filas = [];
  let n = 0;
  fechas.forEach((fecha) => {
    const idx = indiceCuotaEnMes(fecha, indicePorFecha);
    if (!idx) return;
    n += 1;
    const montoCuota = cuotasValores[Math.min(idx - 1, CUOTAS_SEG_SOCIAL - 1)];
    filas.push({
      numeroCuota: idx,
      fechaMin: new Date(fecha),
      fechaMax: new Date(fecha),
      monto: montoCuota,
      etiquetaMes: `${fecha.getMonth() + 1}/${fecha.getFullYear()}`,
    });
  });
  return { tabla: filas, cuotaEvento: cuotasValores[0], total, cuotasValores };
}

function generarTablaDescuentoGeneral(regla, opciones = {}) {
  const total = redondear2(regla.montoTotalDeuda || regla.monto || 0);
  const modalidad = regla.modalidadDescuento || "Valor unico";
  const nCuotas =
    modalidad === "Por cuota"
      ? Math.max(1, Number(regla.cuotas) || 1)
      : 1;
  const cuotasValores = distribuirEnCuotas(total, nCuotas);
  const reglaRef = opciones.reglaAsociada || regla;
  const fechaRef = fechaReferenciaAplicacion(regla);
  const inicioRef = inicioSemanaLunes(fechaRef);

  const fechas = generarFechasPorRegla(reglaRef, {
    mesesProyeccion: opciones.mesesProyeccion || 6,
    fechaDesde: inicioRef,
  });

  let fechasObjetivo = [];
  if (nCuotas === 1) {
    fechasObjetivo = fechas.filter((f) => mismaSemanaCalendario(f, fechaRef));
    if (!fechasObjetivo.length) {
      fechasObjetivo = fechas.slice(0, 1);
    }
  } else {
    fechasObjetivo = fechas.slice(0, nCuotas);
  }

  const filas = fechasObjetivo.map((fecha, i) => ({
    numeroCuota: i + 1,
    fechaMin: new Date(fecha),
    fechaMax: new Date(fecha),
    monto: cuotasValores[Math.min(i, cuotasValores.length - 1)],
    etiquetaMes: `${fecha.getMonth() + 1}/${fecha.getFullYear()}`,
  }));

  return {
    tabla: filas,
    cuotaEvento: cuotasValores[0],
    total,
    cuotasValores,
    nCuotas,
  };
}

function seleccionarEventosDescuentoGeneral(reglaC, eventos) {
  const modalidad = reglaC.modalidadDescuento || "Valor unico";
  const nCuotas =
    modalidad === "Por cuota"
      ? Math.max(1, Number(reglaC.cuotas) || 1)
      : 1;
  const cuotasValores = distribuirEnCuotas(
    redondear2(reglaC.montoTotalDeuda || reglaC.monto || 0),
    nCuotas
  );
  const fechaRef = fechaReferenciaAplicacion(reglaC);
  const inicioRef = inicioSemanaLunes(fechaRef);
  const lista = [...eventos].sort(
    (a, b) => new Date(a.fechaProgramada) - new Date(b.fechaProgramada)
  );

  let candidatos = [];
  if (nCuotas === 1) {
    candidatos = lista.filter((e) =>
      mismaSemanaCalendario(e.fechaProgramada, fechaRef)
    );
    if (!candidatos.length) {
      candidatos = lista
        .filter((e) => new Date(e.fechaProgramada) >= inicioRef)
        .slice(0, 1);
    }
  } else {
    candidatos = lista
      .filter((e) => new Date(e.fechaProgramada) >= inicioRef)
      .slice(0, nCuotas);
  }

  return candidatos.map((ev, i) => ({
    evento: ev,
    montoDescuento: cuotasValores[Math.min(i, cuotasValores.length - 1)],
  }));
}

function montoDescuentoSegSocialEnEvento(reglaC, evento, todosEventos) {
  const cuotaDesc = cuotaSegSocial(reglaC.montoTotalDeuda || reglaC.monto || 0);
  const fechas = (todosEventos || []).map((e) => e.fechaProgramada);
  const indicePorFecha = mapaPrimerasCuatroSemanasDelMes(fechas);
  return debeAplicarDescuentoEnFecha(evento.fechaProgramada, indicePorFecha)
    ? cuotaDesc
    : 0;
}

function montoDescuentoGeneralEnEvento(reglaC, evento, todosEventos) {
  const aplicaciones = seleccionarEventosDescuentoGeneral(reglaC, todosEventos);
  const item = aplicaciones.find(
    (a) => String(a.evento._id) === String(evento._id)
  );
  return item ? redondear2(item.montoDescuento) : 0;
}

function montoDescuentoReglaCEnEvento(reglaC, evento, todosEventos) {
  if (esDescuentosGenerales(reglaC.transaccionNomina)) {
    return montoDescuentoGeneralEnEvento(reglaC, evento, todosEventos);
  }
  return montoDescuentoSegSocialEnEvento(reglaC, evento, todosEventos);
}

/** Suma todos los descuentos tipo C autorizados sobre los eventos de la regla A. */
async function recalcularDescuentosEnEventos(reglaA) {
  const reglasC = await ReglaPagoNomina.find({
    reglaPagoAsociadaId: reglaA._id,
    tipoRegla: "C",
    estadoRegla: "Autorizada",
  }).lean();

  const eventos = await EventoPagoProgramado.find({
    reglaPagoId: reglaA._id,
    estado: { $in: ["Pendiente", "Parcial"] },
  }).sort({ fechaProgramada: 1 });

  const montoBrutoNomina = redondear2(reglaA.monto || 0);
  let actualizados = 0;
  let cuotaDescReferencia = 0;

  for (const evento of eventos) {
    const bruto =
      evento.montoBruto != null
        ? redondear2(evento.montoBruto)
        : montoBrutoNomina > 0
        ? montoBrutoNomina
        : redondear2(evento.monto);

    let descTotal = 0;
    const reglasQueAplican = [];

    for (const reglaC of reglasC) {
      const desc = montoDescuentoReglaCEnEvento(reglaC, evento, eventos);
      if (desc > 0) {
        descTotal = redondear2(descTotal + desc);
        reglasQueAplican.push(reglaC._id);
        if (!cuotaDescReferencia) {
          cuotaDescReferencia = desc;
        }
      }
    }

    evento.montoBruto = bruto;
    evento.montoDescuento = descTotal;
    evento.monto = redondear2(Math.max(0, bruto - descTotal));
    evento.reglaDescuentoId = reglasQueAplican[0] || null;

    if (descTotal === 0) {
      evento.monto = bruto;
      evento.montoBruto = null;
      evento.reglaDescuentoId = null;
    }

    await evento.save();
    actualizados += 1;
  }

  return { actualizados, cuotaDesc: cuotaDescReferencia };
}

function construirProyeccionTipoC(regla, opciones = {}) {
  const reglaAsociada = opciones.reglaAsociada;
  if (!reglaAsociada) {
    return {
      etiquetaFila: regla.transaccionNomina || "Descuento",
      meses: [],
      tipoRegla: "C",
      advertencia: "Seleccione la regla de pago asociada",
    };
  }

  const montoBrutoPago = redondear2(reglaAsociada.monto || 0);
  const esGeneral = esDescuentosGenerales(regla.transaccionNomina);
  const cuotaDesc = esGeneral
    ? redondear2(
        (regla.montoTotalDeuda || regla.monto || 0) /
          (regla.modalidadDescuento === "Por cuota"
            ? Math.max(1, Number(regla.cuotas) || 1)
            : 1)
      )
    : cuotaSegSocial(regla.montoTotalDeuda || regla.monto || 0);
  const fechas = generarFechasPorRegla(reglaAsociada, opciones);
  const indicePorFecha = esGeneral
    ? null
    : mapaPrimerasCuatroSemanasDelMes(fechas);
  const tablaGeneral = esGeneral
    ? generarTablaDescuentoGeneral(regla, {
        reglaAsociada: reglaAsociada,
        mesesProyeccion: opciones.mesesProyeccion || 3,
      }).tabla
    : [];
  const MESES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  const mapa = new Map();

  fechas.forEach((fecha) => {
    const claveMes = `${fecha.getFullYear()}-${fecha.getMonth()}`;
    if (!mapa.has(claveMes)) {
      mapa.set(claveMes, {
        mes: MESES[fecha.getMonth()],
        anio: fecha.getFullYear(),
        ocurrencias: [],
      });
    }
    let aplica = false;
    let desc = 0;
    if (esGeneral) {
      const t = new Date(fecha).setHours(0, 0, 0, 0);
      const fila = tablaGeneral.find(
        (f) => new Date(f.fechaMin).setHours(0, 0, 0, 0) === t
      );
      if (fila) {
        aplica = true;
        desc = fila.monto;
      }
    } else {
      aplica = debeAplicarDescuentoEnFecha(fecha, indicePorFecha);
      desc = aplica ? cuotaDesc : 0;
    }
    const neto = redondear2(montoBrutoPago - desc);
    mapa.get(claveMes).ocurrencias.push({
      fecha,
      etiqueta: etiquetaFechaCorta(fecha),
      monto: neto,
      montoBruto: montoBrutoPago,
      montoDescuento: desc,
      montoNeto: neto,
    });
  });

  const etiquetaConcepto = regla.conceptoDescuento
    ? ` — ${regla.conceptoDescuento}`
    : "";
  return {
    etiquetaFila: `${regla.transaccionNomina || "Descuento"}${etiquetaConcepto} (neto a liquidar)`,
    meses: Array.from(mapa.values()).sort(
      (a, b) =>
        a.anio - b.anio || MESES.indexOf(a.mes) - MESES.indexOf(b.mes)
    ),
    tipoRegla: "C",
    cuotaDescuento: cuotaDesc,
    montoTotalDescuento: redondear2(regla.montoTotalDeuda || regla.monto || 0),
  };
}

async function cargarReglaAsociada(reglaC) {
  if (!reglaC.reglaPagoAsociadaId) return null;
  const regla = await ReglaPagoNomina.findById(reglaC.reglaPagoAsociadaId);
  if (!regla || regla.tipoRegla !== "A" || regla.estadoRegla !== "Autorizada") {
    return null;
  }
  return regla;
}

async function aplicarDescuentosEnEventos(reglaC, reglaA) {
  return recalcularDescuentosEnEventos(reglaA);
}

async function quitarDescuentosRegla(reglaCId) {
  const reglaC = await ReglaPagoNomina.findById(reglaCId).lean();
  if (!reglaC?.reglaPagoAsociadaId) return 0;
  const reglaA = await ReglaPagoNomina.findById(reglaC.reglaPagoAsociadaId);
  if (!reglaA) return 0;
  const { actualizados } = await recalcularDescuentosEnEventos(reglaA);
  return actualizados;
}

module.exports = {
  CUOTAS_SEG_SOCIAL,
  esTransaccionSeguridadSocial,
  esDescuentosGenerales,
  distribuirEnCuotas,
  cuotaSegSocial,
  generarTablaCuotasSegSocial,
  generarTablaDescuentoGeneral,
  construirProyeccionTipoC,
  aplicarDescuentosEnEventos,
  recalcularDescuentosEnEventos,
  montoDescuentoReglaCEnEvento,
  quitarDescuentosRegla,
  cargarReglaAsociada,
  mapaPrimerasCuatroSemanasDelMes,
  fechaReferenciaAplicacion,
};
