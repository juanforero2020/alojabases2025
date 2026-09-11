/**
 * PRUEBAS: ponga true para habilitar Pagar/Liquidar cualquier día (no solo domingo).
 * Vuelva a false cuando termine de probar.
 */
const NOMINA_PRUEBA_PAGO_CUALQUIER_DIA = true;

/**
 * Dominical: false = rango según ventas globales de la tienda (todos los cargos).
 * true = vendedores/usuarios vuelven a calcularse con las ventas de ese trabajador.
 */
const NOMINA_CALCULAR_DOMINICAL_POR_TRABAJADOR = false;

module.exports = {
  NOMINA_PRUEBA_PAGO_CUALQUIER_DIA,
  NOMINA_CALCULAR_DOMINICAL_POR_TRABAJADOR,
};
