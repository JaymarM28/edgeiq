import type { MatchOutcomeProbabilities } from './types';

/**
 * Platt scaling: ajusta probabilidades crudas usando regresión logística
 * sobre el log-odds, entrenada con datos históricos.
 *
 * calibrated(p) = sigmoid(a * logit(p) + b)
 *
 * Donde a=1, b=0 → sin cambio (identidad).
 * a>1 → sharpen (más confianza), a<1 → smooth (más conservador).
 * b>0 → shift up, b<0 → shift down.
 */
export interface PlattParams {
  a: number;
  b: number;
}

const DEFAULT_PARAMS: PlattParams = { a: 1, b: 0 };

function logit(p: number): number {
  const clamped = Math.max(1e-7, Math.min(1 - 1e-7, p));
  return Math.log(clamped / (1 - clamped));
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Límites razonables para parámetros Platt. a∈[0.1,10], b∈[-5,5]. */
const PARAM_BOUNDS = { aMin: 0.1, aMax: 10, bMin: -5, bMax: 5 };

function clampParams(a: number, b: number): { a: number; b: number } {
  return {
    a: Math.max(PARAM_BOUNDS.aMin, Math.min(PARAM_BOUNDS.aMax, a)),
    b: Math.max(PARAM_BOUNDS.bMin, Math.min(PARAM_BOUNDS.bMax, b)),
  };
}

/**
 * Ajusta Platt scaling con Newton's method.
 *
 * @param predictions  probabilidades del modelo (0-1)
 * @param outcomes     1 si el evento ocurrió, 0 si no
 * @returns            parámetros {a, b} optimizados
 */
export function fitPlattScaling(
  predictions: number[],
  outcomes: number[],
): PlattParams {
  const n = predictions.length;
  if (n < 20) return DEFAULT_PARAMS; // necesita suficiente data para calibrar bien

  let a = 1.0;
  let b = 0.0;

  // Newton-Raphson, 20 iteraciones con regularización fuerte
  for (let iter = 0; iter < 20; iter++) {
    let gradA = 0,
      gradB = 0;
    let hAA = 0,
      hAB = 0,
      hBB = 0;

    for (let i = 0; i < n; i++) {
      const l = logit(predictions[i]);
      const q = sigmoid(a * l + b);
      const err = q - outcomes[i];

      gradA += err * l;
      gradB += err;

      const w = q * (1 - q) + 1e-8;
      hAA += w * l * l;
      hAB += w * l;
      hBB += w;
    }

    // Regularización L2 fuerte — escala con 1/n para ser independiente del tamaño
    const lambda = 1.0;
    gradA += lambda * (a - 1); // regularizar hacia a=1 (identidad)
    gradB += lambda * b; // regularizar hacia b=0
    hAA += lambda;
    hBB += lambda;

    const det = hAA * hBB - hAB * hAB;
    if (Math.abs(det) < 1e-12) break;

    a -= (hBB * gradA - hAB * gradB) / det;
    b -= (hAA * gradB - hAB * gradA) / det;

    // Clamp después de cada paso para evitar divergencia
    const clamped = clampParams(a, b);
    a = clamped.a;
    b = clamped.b;
  }

  // Sanity check final: si los parámetros son extremos, no calibrar
  if (!isFinite(a) || !isFinite(b)) return DEFAULT_PARAMS;

  return { a, b };
}

/** Aplica Platt scaling a una probabilidad. Retorna valor seguro (nunca NaN). */
export function calibrate(p: number, params: PlattParams): number {
  const result = sigmoid(params.a * logit(p) + params.b);
  return isFinite(result) ? result : p; // fallback a probabilidad original si falla
}

/**
 * Calibra un trío de probabilidades 1X2 y renormaliza.
 * Usa parámetros separados por selección (cada una puede tener distinto sesgo).
 */
export function calibrateOutcome(
  probs: MatchOutcomeProbabilities,
  paramsHome: PlattParams,
  paramsDraw: PlattParams,
  paramsAway: PlattParams,
): MatchOutcomeProbabilities {
  const homeWin = calibrate(probs.homeWin, paramsHome);
  const draw = calibrate(probs.draw, paramsDraw);
  const awayWin = calibrate(probs.awayWin, paramsAway);

  const total = homeWin + draw + awayWin;
  // Safety: si total es 0 o NaN, devolver probabilidades originales sin calibrar
  if (!isFinite(total) || total < 1e-10) return probs;

  return {
    homeWin: homeWin / total,
    draw: draw / total,
    awayWin: awayWin / total,
  };
}
