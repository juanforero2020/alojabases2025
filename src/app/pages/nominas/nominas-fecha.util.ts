import {
  AjusteNominaPendiente,
  EventoPagoDominical,
  EventoPagoProgramado,
  FilaAmortizacion,
  NominaConfigGlobal,
  ProyeccionPagoNomina,
  ReglaPagoNomina,
  ReporteEstadoEmpleado,
  TablaMaestraSalarial,
} from "./nominas";

/** Convierte fechas calendario del API (ISO UTC) a medianoche local sin desfase de un día. */
export function fechaCalendarioLocal(
  valor: Date | string | null | undefined
): Date | null | undefined {
  if (valor == null || valor === "") return valor as null | undefined;
  if (typeof valor === "string") {
    const soloFecha = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (soloFecha) {
      return new Date(
        Number(soloFecha[1]),
        Number(soloFecha[2]) - 1,
        Number(soloFecha[3])
      );
    }
  }
  const d = new Date(valor);
  if (isNaN(d.getTime())) return d;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Formato YYYY-MM-DD para parámetros de consulta al API. */
export function fechaCalendarioParam(
  fecha: Date | null | undefined
): string | undefined {
  if (!fecha) return undefined;
  const d = fechaCalendarioLocal(fecha);
  if (!d) return undefined;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatoFechaCalendarioNomina(
  valor: Date | string | null | undefined,
  opciones: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  },
  locale = "es-EC"
): string {
  if (!valor) return "—";
  const d = fechaCalendarioLocal(valor);
  if (!d || isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale, opciones);
}

export function inicioDiaCalendarioNomina(fecha: Date | string): Date {
  const d = fechaCalendarioLocal(fecha);
  return d instanceof Date ? d : new Date(fecha);
}

export function mismoDiaCalendarioNomina(
  a: Date | string | null | undefined,
  b: Date | string | null | undefined
): boolean {
  if (!a || !b) return false;
  const da = fechaCalendarioLocal(a);
  const db = fechaCalendarioLocal(b);
  if (!da || !db) return false;
  return da.getTime() === db.getTime();
}

export function textoFechaPagoNomina(
  ev: {
    fechaMin?: Date | string;
    fechaMax?: Date | string;
    fechaProgramada?: Date | string;
  },
  opciones: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }
): string {
  if (ev.fechaMin && ev.fechaMax) {
    if (mismoDiaCalendarioNomina(ev.fechaMin, ev.fechaMax)) {
      return formatoFechaCalendarioNomina(ev.fechaMin, opciones);
    }
    return `${formatoFechaCalendarioNomina(
      ev.fechaMin,
      opciones
    )} — ${formatoFechaCalendarioNomina(ev.fechaMax, opciones)}`;
  }
  if (ev.fechaMin) {
    return formatoFechaCalendarioNomina(ev.fechaMin, opciones);
  }
  return formatoFechaCalendarioNomina(ev.fechaProgramada, opciones);
}

export function normalizarFilaAmortizacion(
  fila: FilaAmortizacion
): FilaAmortizacion {
  const fecha = fechaCalendarioLocal(fila.fechaMin || fila.fechaMax) as Date;
  return {
    ...fila,
    fechaMin: fecha,
    fechaMax: fecha,
  };
}

export function normalizarTablaAmortizacion(
  tabla: FilaAmortizacion[] = []
): FilaAmortizacion[] {
  return tabla.map(normalizarFilaAmortizacion);
}

export function normalizarEventoPagoProgramado(
  ev: EventoPagoProgramado
): EventoPagoProgramado {
  const estado =
    (ev.estado as string) === "Cancelado" ? "Anulado" : ev.estado;
  return {
    ...ev,
    estado,
    fechaProgramada: fechaCalendarioLocal(ev.fechaProgramada) as Date,
    fechaMin: ev.fechaMin
      ? (fechaCalendarioLocal(ev.fechaMin) as Date)
      : ev.fechaMin,
    fechaMax: ev.fechaMax
      ? (fechaCalendarioLocal(ev.fechaMax) as Date)
      : ev.fechaMax,
  };
}

export function normalizarProyeccionPago(
  proyeccion: ProyeccionPagoNomina
): ProyeccionPagoNomina {
  if (!proyeccion?.meses) return proyeccion;
  return {
    ...proyeccion,
    meses: proyeccion.meses.map((mes) => ({
      ...mes,
      ocurrencias: (mes.ocurrencias || []).map((oc) => ({
        ...oc,
        fecha: fechaCalendarioLocal(oc.fecha) as Date,
      })),
    })),
  };
}

export function normalizarReglaPagoNomina(
  regla: ReglaPagoNomina
): ReglaPagoNomina {
  return {
    ...regla,
    fechaAplicacionDescuento: regla.fechaAplicacionDescuento
      ? (fechaCalendarioLocal(regla.fechaAplicacionDescuento) as Date)
      : regla.fechaAplicacionDescuento,
    fechaReferenciaAnual: regla.fechaReferenciaAnual
      ? (fechaCalendarioLocal(regla.fechaReferenciaAnual) as Date)
      : regla.fechaReferenciaAnual,
    fechaAutorizacion: regla.fechaAutorizacion
      ? (fechaCalendarioLocal(regla.fechaAutorizacion) as Date)
      : regla.fechaAutorizacion,
    tablaAmortizacion: regla.tablaAmortizacion
      ? normalizarTablaAmortizacion(regla.tablaAmortizacion)
      : regla.tablaAmortizacion,
    proyeccion: regla.proyeccion
      ? normalizarProyeccionPago(regla.proyeccion)
      : regla.proyeccion,
  };
}

export function normalizarAjusteNomina(
  aj: AjusteNominaPendiente
): AjusteNominaPendiente {
  return {
    ...aj,
    fechaDominical: aj.fechaDominical
      ? (fechaCalendarioLocal(aj.fechaDominical) as Date)
      : aj.fechaDominical,
  };
}

export function normalizarEventoDominical(
  ev: EventoPagoDominical
): EventoPagoDominical {
  return {
    ...ev,
    fechaDominical: fechaCalendarioLocal(ev.fechaDominical) as Date,
  };
}

export function normalizarTablaMaestraSalarial(
  registro: TablaMaestraSalarial
): TablaMaestraSalarial {
  return {
    ...registro,
    fechaInicioLabores: registro.fechaInicioLabores
      ? (fechaCalendarioLocal(registro.fechaInicioLabores) as Date)
      : registro.fechaInicioLabores,
  };
}

export function normalizarNominaConfigGlobal(
  config: NominaConfigGlobal
): NominaConfigGlobal {
  if (!config?.otrosCargos) return config;
  return {
    ...config,
    otrosCargos: config.otrosCargos.map((cargo) => ({
      ...cargo,
      fechaLimite: cargo.fechaLimite
        ? (fechaCalendarioLocal(cargo.fechaLimite) as Date)
        : cargo.fechaLimite,
    })),
  };
}

export function normalizarReporteEstadoEmpleado(
  reporte: ReporteEstadoEmpleado
): ReporteEstadoEmpleado {
  return {
    ...reporte,
    eventos: (reporte.eventos || []).map(normalizarEventoPagoProgramado),
  };
}
