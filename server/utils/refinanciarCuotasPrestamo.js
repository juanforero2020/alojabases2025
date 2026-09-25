function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pendienteCuota(item) {
  return redondear2(
    Math.max(0, (Number(item.monto) || 0) - (Number(item.montoPagado) || 0))
  );
}

function filaAmortizacionPlain(fila) {
  const plain = {
    numeroCuota: fila.numeroCuota,
    fechaMin: fila.fechaMin,
    fechaMax: fila.fechaMax || fila.fechaMin,
    monto: redondear2(fila.monto),
  };
  if (fila.transaccionNomina) {
    plain.transaccionNomina = fila.transaccionNomina;
  }
  if (fila.eventoPagoId) {
    plain.eventoPagoId = fila.eventoPagoId;
  }
  return plain;
}

function tiempoCuota(item) {
  const valor =
    item && (item.fechaProgramada || item.fechaMin || item.fechaMax || item.fecha);
  const n = valor ? new Date(valor).getTime() : NaN;
  return isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

function ordenarCuotasProximas(items) {
  return (items || []).slice().sort((a, b) => {
    const fa = tiempoCuota(a);
    const fb = tiempoCuota(b);
    if (fa !== fb) return fa - fb;
    return (Number(a.numeroCuota) || 0) - (Number(b.numeroCuota) || 0);
  });
}

/**
 * Aplica el abono a las cuotas pendientes más próximas a pagar
 * (de la más cercana en adelante). Si el abono cubre una cuota, esa
 * desaparece; el remanente reduce la siguiente.
 * items: solo pendientes/parciales. item se mantiene por referencia.
 */
function refinanciarCuotasProximas(items, montoAbono) {
  const lista = ordenarCuotasProximas(items).map((item, index) => ({
    item,
    index,
    numeroCuota: item.numeroCuota,
    monto: redondear2(item.monto),
    montoPagado: redondear2(item.montoPagado || 0),
    pendiente: pendienteCuota(item),
    accion: "mantener",
    montoNuevo: redondear2(item.monto),
  }));

  let restante = redondear2(montoAbono);
  for (let i = 0; i < lista.length && restante > 0.009; i++) {
    const row = lista[i];
    if (!(row.pendiente > 0.009)) continue;

    if (restante >= row.pendiente - 0.01) {
      restante = redondear2(restante - row.pendiente);
      if (row.montoPagado > 0.009) {
        row.accion = "cerrar";
        row.montoNuevo = row.montoPagado;
      } else {
        row.accion = "eliminar";
        row.montoNuevo = 0;
      }
    } else {
      row.accion = "ajustar";
      row.montoNuevo = redondear2(row.monto - restante);
      restante = 0;
    }
  }

  return {
    filas: lista,
    eliminados: lista.filter((r) => r.accion === "eliminar"),
    ajustados: lista.filter(
      (r) => r.accion === "ajustar" || r.accion === "cerrar"
    ),
    vigentes: lista.filter((r) => r.accion !== "eliminar"),
    cuotasEliminadas: lista.filter((r) => r.accion === "eliminar").length,
    cuotasAjustadas: lista.filter((r) => r.accion === "ajustar").length,
    cuotasCerradas: lista.filter((r) => r.accion === "cerrar").length,
    restanteSinAplicar: restante,
  };
}

function textoRefinanciacion(resultado) {
  if (!resultado) return "";
  const partes = [];
  if (resultado.cuotasEliminadas === 1) {
    partes.push("se eliminó 1 cuota próxima");
  } else if (resultado.cuotasEliminadas > 1) {
    partes.push(`se eliminaron ${resultado.cuotasEliminadas} cuotas próximas`);
  }
  for (const row of resultado.filas || []) {
    if (row.accion !== "ajustar") continue;
    const n = row.numeroCuota != null ? ` ${row.numeroCuota}` : "";
    partes.push(`la cuota${n} quedó en $${row.montoNuevo.toFixed(2)}`);
  }
  if (resultado.cuotasCerradas) {
    partes.push(
      resultado.cuotasCerradas === 1
        ? "se cerró 1 cuota con cobro parcial"
        : `se cerraron ${resultado.cuotasCerradas} cuotas con cobro parcial`
    );
  }
  if (!partes.length) return "";
  return `Refinanciación: ${partes.join("; ")}`;
}

function extraerPendientesDeTabla(tabla, yaPagado) {
  const filas = (tabla || [])
    .slice()
    .sort((a, b) => (Number(a.numeroCuota) || 0) - (Number(b.numeroCuota) || 0));
  const pagadas = [];
  const pendientes = [];
  let consumido = 0;
  const pagado = redondear2(yaPagado);

  for (const fila of filas) {
    const monto = redondear2(fila.monto);
    const falta = redondear2(Math.max(0, pagado - consumido));
    if (falta <= 0.009) {
      pendientes.push({
        ...filaAmortizacionPlain(fila),
        montoPagado: 0,
      });
      continue;
    }
    if (falta >= monto - 0.01) {
      pagadas.push(filaAmortizacionPlain(fila));
      consumido = redondear2(consumido + monto);
    } else {
      pendientes.push({
        ...filaAmortizacionPlain(fila),
        montoPagado: falta,
      });
      consumido = redondear2(consumido + falta);
    }
  }
  return { pagadas, pendientes };
}

function reconstruirTablaDesdeRefinanciacion(pagadas, resultado) {
  const pendientesVigentes = (resultado.vigentes || []).map((row) => ({
    numeroCuota: row.item.numeroCuota,
    fechaMin: row.item.fechaMin,
    fechaMax: row.item.fechaMax || row.item.fechaMin,
    monto: redondear2(
      row.accion === "mantener" ? row.monto : row.montoNuevo
    ),
  }));
  return [...(pagadas || []), ...pendientesVigentes];
}

function sintetizarCuotasPorSaldo(saldo, cuotaRef) {
  const cuota = redondear2(cuotaRef);
  let rest = redondear2(saldo);
  if (!(cuota > 0.009) || !(rest > 0.009)) return [];
  const tabla = [];
  let n = 0;
  while (rest > 0.009 && n < 500) {
    n += 1;
    const monto = redondear2(Math.min(cuota, rest));
    rest = redondear2(rest - monto);
    tabla.push({
      numeroCuota: n,
      fechaMin: null,
      fechaMax: null,
      monto,
    });
  }
  return tabla;
}

module.exports = {
  redondear2,
  pendienteCuota,
  filaAmortizacionPlain,
  ordenarCuotasProximas,
  refinanciarCuotasProximas,
  refinanciarCuotasDesdeAtras: refinanciarCuotasProximas,
  textoRefinanciacion,
  extraerPendientesDeTabla,
  reconstruirTablaDesdeRefinanciacion,
  sintetizarCuotasPorSaldo,
};
