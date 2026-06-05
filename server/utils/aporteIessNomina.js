const NominaConfigGlobal = require("../models/nominaConfigGlobal");
const TablaMaestraSalarial = require("../models/tablaMaestraSalarial");

const CONFIG_CLAVE = "principal";

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

function obtenerAportePersonal(aportesIess = []) {
  const lista = (aportesIess || []).filter((a) => a.activo !== false);
  let aporte = lista.find((a) => a.tipo === "personal");
  if (!aporte) {
    aporte = lista.find((a) => {
      const t = normalizarTexto(a.concepto);
      return t.includes("personal") && t.includes("trabajador");
    });
  }
  if (!aporte) {
    aporte = lista.find((a) => normalizarTexto(a.concepto).includes("personal"));
  }
  return aporte || null;
}

function calcularAporteDesdeBase(base, aportesIess = []) {
  const montoBase = redondear2(base);
  const aporte = obtenerAportePersonal(aportesIess);
  if (!aporte || !aporte.porcentaje) {
    return {
      montoBase,
      porcentaje: 0,
      monto: 0,
      concepto: null,
      error: "No está configurado el Aporte Personal (Trabajador) en Configuración Global",
    };
  }
  const porcentaje = Number(aporte.porcentaje) || 0;
  const monto = redondear2((montoBase * porcentaje) / 100);
  return {
    montoBase,
    porcentaje,
    monto,
    concepto: aporte.concepto,
    codigo: aporte.codigo,
  };
}

const APORTES_IESS_DEFECTO = [
  {
    concepto: "Aporte Personal (Trabajador)",
    codigo: "iess_personal",
    porcentaje: 9.45,
    tipo: "personal",
    activo: true,
  },
];

async function cargarAportesIessConfigSeguro() {
  try {
    const config = await NominaConfigGlobal.findOne({ clave: CONFIG_CLAVE }).lean();
    const lista = config?.aportesIess;
    return lista?.length ? lista : APORTES_IESS_DEFECTO;
  } catch {
    return APORTES_IESS_DEFECTO;
  }
}

async function calcularMontoSegSocialDesdeBase(base) {
  const aportes = await cargarAportesIessConfigSeguro();
  return calcularAporteDesdeBase(base, aportes);
}

async function calcularMontoSegSocialParaRegla(regla) {
  let base = Number(regla.montoBaseTms) || 0;
  if (!base && regla.tablaMaestraSalarialId) {
    const tms = await TablaMaestraSalarial.findById(regla.tablaMaestraSalarialId);
    base = tms?.salarioCalculoVariablesPrestacionales || 0;
  }
  if (!base && regla.cedulaBeneficiario) {
    const tms = await TablaMaestraSalarial.findOne({
      cedula: (regla.cedulaBeneficiario || "").trim(),
    });
    base = tms?.salarioCalculoVariablesPrestacionales || 0;
  }
  const calc = await calcularMontoSegSocialDesdeBase(base);
  return calc;
}

module.exports = {
  obtenerAportePersonal,
  calcularAporteDesdeBase,
  calcularMontoSegSocialDesdeBase,
  calcularMontoSegSocialParaRegla,
  cargarAportesIessConfigSeguro,
  APORTES_IESS_DEFECTO,
};
