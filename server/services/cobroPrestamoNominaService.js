const EventoCobroPrestamo = require("../models/eventoCobroPrestamo");
const ReglaPagoNomina = require("../models/reglaPagoNomina");
const TransaccionFinanciera = require("../models/transaccionFinanciera");
const Cuenta = require("../models/cuentas");
const {
  CUENTA_INGRESOS,
  MAPA_CUENTA_POR_SUBCUENTA,
  SUBCUENTAS_NOMINA,
  subCuentaAbonoPrestamoNomina,
} = require("../utils/cuentasContablesNomina");

function redondear2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function escapeRegex(valor) {
  return String(valor || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function saldoActualPrestamo(regla) {
  if (regla.saldoPendientePrestamo != null) {
    return redondear2(regla.saldoPendientePrestamo);
  }
  return redondear2(regla.montoTotalDeuda || regla.monto || 0);
}

async function resolverCuentaCobroPrestamo() {
  const subCuenta = subCuentaAbonoPrestamoNomina();
  const fija = MAPA_CUENTA_POR_SUBCUENTA[subCuenta] || {
    cuenta: CUENTA_INGRESOS,
    tipoCuenta: "Ingresos",
  };
  const cuentaDoc = await Cuenta.findOne({
    nombre: { $regex: /^1\.3\s+INGRESOS/i },
  });
  return {
    cuenta: cuentaDoc?.nombre || fija.cuenta || CUENTA_INGRESOS,
    subCuenta: subCuenta || SUBCUENTAS_NOMINA.PRESTAMOS,
    tipoCuentaIngreso: "Ingresos",
  };
}

async function listarCobrosPrestamo(filtros = {}) {
  const filtro = {};
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

  const estado = (filtros.estado || "Pendiente").toString().trim();
  if (estado && estado !== "Todos") {
    filtro.estado =
      estado === "Pendiente" ? { $in: ["Pendiente", "Parcial"] } : estado;
  }

  const cobros = await EventoCobroPrestamo.find(filtro)
    .sort({ fechaProgramada: 1, numeroCuota: 1 })
    .lean();
  const reglaIds = [
    ...new Set(cobros.map((c) => String(c.reglaPagoId)).filter(Boolean)),
  ];
  const reglas = reglaIds.length
    ? await ReglaPagoNomina.find({ _id: { $in: reglaIds } })
        .select(
          "saldoPendientePrestamo montoTotalDeuda montoPrestado porcentajeInteres centroCosto"
        )
        .lean()
    : [];
  const mapaReglas = new Map(reglas.map((r) => [String(r._id), r]));

  return cobros.map((c) => {
    const regla = mapaReglas.get(String(c.reglaPagoId));
    return {
      ...c,
      montoPendiente: redondear2(
        Math.max(0, (Number(c.monto) || 0) - (Number(c.montoPagado) || 0))
      ),
      saldoPrestamo: regla ? saldoActualPrestamo(regla) : null,
      montoTotalDeuda: regla?.montoTotalDeuda,
      montoPrestado: regla?.montoPrestado,
    };
  });
}

async function listarPersonasConCobrosPendientes() {
  const cobros = await EventoCobroPrestamo.find({
    estado: { $in: ["Pendiente", "Parcial"] },
  })
    .select("cedulaBeneficiario nombreBeneficiario tipoBeneficiario")
    .lean();
  const mapa = new Map();
  for (const cobro of cobros) {
    const cedula = (cobro.cedulaBeneficiario || "").trim();
    if (!cedula || mapa.has(cedula)) continue;
    const nombre = (cobro.nombreBeneficiario || "").trim();
    mapa.set(cedula, {
      cedula,
      nombre,
      tipoBeneficiario: cobro.tipoBeneficiario || "Externo",
      etiquetaDisplay: `${nombre || "Sin nombre"} — ${cedula}`,
    });
  }
  return Array.from(mapa.values()).sort((a, b) =>
    (a.nombre || "").localeCompare(b.nombre || "", "es")
  );
}

async function ejecutarCobroPrestamo(id, opciones = {}) {
  const cobro = await EventoCobroPrestamo.findById(id);
  if (!cobro) {
    throw new Error("Cobro no encontrado");
  }
  if (cobro.estado === "Ejecutado") {
    throw new Error("Este cobro ya fue ejecutado");
  }
  if (cobro.estado === "Anulado") {
    throw new Error("Este cobro está anulado");
  }

  const pendienteCuota = redondear2(
    Math.max(0, (Number(cobro.monto) || 0) - (Number(cobro.montoPagado) || 0))
  );
  if (!(pendienteCuota > 0.009)) {
    throw new Error("Esta cuota ya está cubierta");
  }

  let montoCobrar =
    opciones.monto != null ? redondear2(opciones.monto) : pendienteCuota;
  if (!(montoCobrar > 0.009)) {
    throw new Error("Indique un monto mayor a cero");
  }
  if (montoCobrar > pendienteCuota + 0.01) {
    throw new Error(
      `El monto ($${montoCobrar.toFixed(
        2
      )}) supera el saldo de la cuota ($${pendienteCuota.toFixed(2)})`
    );
  }

  const regla = await ReglaPagoNomina.findById(cobro.reglaPagoId);
  if (!regla) {
    throw new Error("No se encontró la regla de préstamo asociada");
  }
  const saldoPrestamo = saldoActualPrestamo(regla);
  if (!(saldoPrestamo > 0.009)) {
    throw new Error("El préstamo ya no tiene saldo pendiente");
  }
  montoCobrar = redondear2(Math.min(montoCobrar, saldoPrestamo));

  const cuenta = await resolverCuentaCobroPrestamo();
  const fechaContable = new Date();
  const cuotaTxt = `cuota ${cobro.numeroCuota}/${cobro.totalCuotas}`;
  const notas = [
    `Recibo de cobro préstamo — ${cobro.nombreBeneficiario || ""} — ${cuotaTxt}`,
    "1.3 INGRESOS / 1.3.3 Pago o Abono Préstamo",
    opciones.notas || cobro.notas || "",
  ]
    .filter(Boolean)
    .join(". ");

  const tx = new TransaccionFinanciera({
    fecha: fechaContable,
    fechaContable,
    sucursal: opciones.sucursal || "matriz",
    cliente: cobro.nombreBeneficiario,
    beneficiario: cobro.nombreBeneficiario,
    cedula: cobro.cedulaBeneficiario,
    centroCosto: cobro.centroCosto || regla.centroCosto,
    isContabilizada: true,
    usuario: opciones.usuario || "",
    valor: montoCobrar,
    tipoPago: "Ingreso",
    cuenta: cuenta.cuenta,
    tipoCuenta: cuenta.tipoCuentaIngreso,
    subCuenta: cuenta.subCuenta,
    tipoTransaccion: "COBRO_PRESTAMO_NOMINA",
    referenciaPrestamo: String(regla._id),
    notas,
  });
  await tx.save();

  cobro.montoPagado = redondear2((Number(cobro.montoPagado) || 0) + montoCobrar);
  cobro.transaccionFinancieraId = tx._id;
  cobro.ejecutadoPor = opciones.usuario || "";
  cobro.fechaEjecucion = fechaContable;
  if (cobro.montoPagado >= (Number(cobro.monto) || 0) - 0.01) {
    cobro.estado = "Ejecutado";
    cobro.montoPagado = Number(cobro.monto);
  } else {
    cobro.estado = "Parcial";
  }
  await cobro.save();

  regla.saldoPendientePrestamo = redondear2(
    Math.max(0, saldoPrestamo - montoCobrar)
  );
  regla.abonosPrestamo = regla.abonosPrestamo || [];
  regla.abonosPrestamo.push({
    fecha: fechaContable,
    monto: montoCobrar,
    eventoCobroId: cobro._id,
    transaccionFinancieraId: tx._id,
    transaccionNominaOrigen: "Recibo de cobro",
    ejecutadoPor: opciones.usuario || "",
  });

  const cobrosPendientes = await EventoCobroPrestamo.countDocuments({
    reglaPagoId: regla._id,
    estado: { $in: ["Pendiente", "Parcial"] },
  });
  if (regla.saldoPendientePrestamo <= 0.009 || cobrosPendientes === 0) {
    regla.saldoPendientePrestamo = Math.max(0, regla.saldoPendientePrestamo);
    if (regla.saldoPendientePrestamo <= 0.009) {
      regla.saldoPendientePrestamo = 0;
      regla.estadoRegla = "Finalizada";
    }
  }
  await regla.save();

  return {
    cobro,
    transaccion: tx,
    montoCobrado: montoCobrar,
    saldoPendienteCuota: redondear2(
      Math.max(0, (Number(cobro.monto) || 0) - cobro.montoPagado)
    ),
    saldoPrestamo: regla.saldoPendientePrestamo,
  };
}

module.exports = {
  listarCobrosPrestamo,
  listarPersonasConCobrosPendientes,
  ejecutarCobroPrestamo,
};
