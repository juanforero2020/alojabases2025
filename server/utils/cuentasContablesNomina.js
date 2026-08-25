function normalizarTexto(valor) {
  return (valor || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const CUENTA_GASTOS = "1.7 GASTOS OPERACIONALES";
const CUENTA_INGRESOS = "1.3 INGRESOS";

const SUBCUENTAS_NOMINA = {
  NOMINAS: "1.7.1 Nominas",
  DOMINICALES: "1.7.2 Nominas_Dominicales",
  COMPLEMENTARIOS: "1.7.3 Nominas_Complementarios",
  EXTRAS: "1.7.4 Nominas_Extras",
  ARRIENDOS: "1.7.2 Arriendos",
  SERVICIOS: "1.7.5 Servicios",
  SEGURIDAD_SOCIAL: "1.3.3 Nominas_Seguridad Social",
  DESCUENTOS: "1.3.4 Nominas_Descuentos",
};

const CONCEPTOS_COMPLEMENTARIOS = [
  "comisiones por ventas",
  "decimo tercer sueldo",
  "decimo cuarto sueldo",
  "vacaciones",
];

const MAPA_CUENTA_POR_SUBCUENTA = {
  [SUBCUENTAS_NOMINA.NOMINAS]: {
    cuenta: CUENTA_GASTOS,
    tipoCuenta: "Salidas",
  },
  [SUBCUENTAS_NOMINA.DOMINICALES]: {
    cuenta: CUENTA_GASTOS,
    tipoCuenta: "Salidas",
  },
  [SUBCUENTAS_NOMINA.COMPLEMENTARIOS]: {
    cuenta: CUENTA_GASTOS,
    tipoCuenta: "Salidas",
  },
  [SUBCUENTAS_NOMINA.EXTRAS]: {
    cuenta: CUENTA_GASTOS,
    tipoCuenta: "Salidas",
  },
  [SUBCUENTAS_NOMINA.ARRIENDOS]: {
    cuenta: CUENTA_GASTOS,
    tipoCuenta: "Salidas",
  },
  [SUBCUENTAS_NOMINA.SERVICIOS]: {
    cuenta: CUENTA_GASTOS,
    tipoCuenta: "Salidas",
  },
  [SUBCUENTAS_NOMINA.SEGURIDAD_SOCIAL]: {
    cuenta: CUENTA_INGRESOS,
    tipoCuenta: "Ingresos",
  },
  [SUBCUENTAS_NOMINA.DESCUENTOS]: {
    cuenta: CUENTA_INGRESOS,
    tipoCuenta: "Ingresos",
  },
  "1.7.4 Nominas - Descuentos": {
    cuenta: CUENTA_GASTOS,
    tipoCuenta: "Salidas",
  },
};

const SUBCUENTAS_CONSULTA_NOMINAS = [
  "1.5.2 Nominas",
  "1.5.3 Anticipos nomina",
  "1.5.4 Pagos extras",
  "1.5.5 Comisiones x Fletes",
  "1.5.6 Decimo cuarto",
  "1.5.7 Descuentos",
  "1.3.3 Pago o Abono Préstamo",
  "1.7.1 Nominas",
  "1.7.4 Nominas - Descuentos",
  SUBCUENTAS_NOMINA.DOMINICALES,
  SUBCUENTAS_NOMINA.COMPLEMENTARIOS,
  SUBCUENTAS_NOMINA.EXTRAS,
  SUBCUENTAS_NOMINA.ARRIENDOS,
  SUBCUENTAS_NOMINA.SERVICIOS,
  SUBCUENTAS_NOMINA.SEGURIDAD_SOCIAL,
  SUBCUENTAS_NOMINA.DESCUENTOS,
];

function esArriendos(transaccionNomina) {
  return normalizarTexto(transaccionNomina) === "arriendos";
}

function esExterno(tipoBeneficiario) {
  return normalizarTexto(tipoBeneficiario) === "externo";
}

function esConceptoExtra(transaccionNomina) {
  const t = normalizarTexto(transaccionNomina);
  return t.includes("puntual") || t.includes("bono");
}

function esConceptoComplementario(transaccionNomina) {
  const t = normalizarTexto(transaccionNomina);
  return CONCEPTOS_COMPLEMENTARIOS.some(
    (concepto) => t === concepto || t.includes(concepto)
  );
}

function subCuentaPagoNomina({
  tipoRegla,
  transaccionNomina,
  tipoBeneficiario,
  frecuencia,
} = {}) {
  const t = normalizarTexto(transaccionNomina);
  const freq = normalizarTexto(frecuencia);

  if (esArriendos(transaccionNomina)) {
    return SUBCUENTAS_NOMINA.ARRIENDOS;
  }

  if (esExterno(tipoBeneficiario)) {
    return SUBCUENTAS_NOMINA.SERVICIOS;
  }

  if (t.includes("anticipo")) {
    return "1.5.3 Anticipos nomina";
  }

  if (t.includes("dominical") || freq === "dominical") {
    return SUBCUENTAS_NOMINA.DOMINICALES;
  }

  if (tipoRegla === "B") {
    if (esConceptoExtra(transaccionNomina)) return SUBCUENTAS_NOMINA.EXTRAS;
    return SUBCUENTAS_NOMINA.COMPLEMENTARIOS;
  }

  if (esConceptoExtra(transaccionNomina)) return SUBCUENTAS_NOMINA.EXTRAS;
  if (esConceptoComplementario(transaccionNomina)) {
    return SUBCUENTAS_NOMINA.COMPLEMENTARIOS;
  }

  return SUBCUENTAS_NOMINA.NOMINAS;
}

function subCuentaDescuentoNomina(transaccionNomina) {
  const t = normalizarTexto(transaccionNomina);
  if (t.includes("seguridad social")) {
    return SUBCUENTAS_NOMINA.SEGURIDAD_SOCIAL;
  }
  return SUBCUENTAS_NOMINA.DESCUENTOS;
}

module.exports = {
  CUENTA_GASTOS,
  CUENTA_INGRESOS,
  SUBCUENTAS_NOMINA,
  MAPA_CUENTA_POR_SUBCUENTA,
  SUBCUENTAS_CONSULTA_NOMINAS,
  subCuentaPagoNomina,
  subCuentaDescuentoNomina,
};
