export interface ValueBetInput {
  /** Probabilidad que asigna el modelo al resultado, en [0,1]. */
  modelProbability: number;
  /** Cuota decimal ofrecida por la casa (ej. 2.10). */
  decimalOdds: number;
}

export interface ValueBetResult {
  impliedProbability: number;
  /** Valor esperado por unidad apostada. edge > 0 implica EV positivo. */
  edge: number;
  isValueBet: boolean;
}

/**
 * Regla determinística de value bet (docs/DECISION_ENGINE.md: "el modelo
 * calcula, la regla decide"). No descuenta el margen de la casa (overround)
 * de la probabilidad implícita — simplificación de MVP.
 */
export function evaluateValueBet(
  input: ValueBetInput,
  edgeThreshold: number,
): ValueBetResult {
  const impliedProbability = 1 / input.decimalOdds;
  const edge = input.modelProbability * input.decimalOdds - 1;

  return {
    impliedProbability,
    edge,
    isValueBet: edge > edgeThreshold,
  };
}
