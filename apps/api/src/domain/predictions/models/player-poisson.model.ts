/**
 * Modelo Poisson para predicciones de jugador (Nivel 2).
 *
 * Cada jugador tiene un λ = promedio por partido (ponderado por minutos
 * jugados). Se evalúa P(over/under line) usando Poisson directamente,
 * sin fuerza relativa a la liga — el historial individual del jugador es
 * la señal principal (docs/DECISIONS.md).
 *
 * Mercados: tiros a puerta, goles, tarjetas amarillas por jugador.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────

export type PlayerStatType = 'shotsOn' | 'shotsTotal' | 'goals' | 'yellowCards';

export interface PlayerHistoryStat {
  /** Valor del stat en ese partido (ej. 2 tiros a puerta). */
  value: number;
  /** Minutos jugados en ese partido. */
  minutes: number;
}

export interface PlayerOverUnder {
  statType: PlayerStatType;
  line: number;
  overProb: number;
  underProb: number;
  /** λ usado (promedio por partido con ≥ 45 min jugados). */
  lambda: number;
  /** Partidos con ≥ 45 min usados para calcular λ. */
  sampleSize: number;
}

// ─── Líneas estándar por tipo de stat de jugador ──────────────────────────

export const PLAYER_DEFAULT_LINES: Record<PlayerStatType, number[]> = {
  shotsOn: [0.5, 1.5, 2.5],
  shotsTotal: [0.5, 1.5, 2.5, 3.5],
  goals: [0.5, 1.5],
  yellowCards: [0.5, 1.5],
};

/** Mínimo de partidos con ≥45 min para generar predicción de jugador. */
export const MIN_PLAYER_MATCHES = 5;

/** Solo partidos donde jugó ≥ este umbral de minutos cuentan para el λ. */
const MIN_MINUTES = 45;

// ─── Funciones puras ──────────────────────────────────────────────────────

function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i += 1) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * Calcula λ del jugador filtrando solo partidos donde jugó ≥ MIN_MINUTES.
 * Devuelve null si no hay suficiente muestra.
 */
export function playerLambda(
  history: PlayerHistoryStat[],
): { lambda: number; sampleSize: number } | null {
  const qualifying = history.filter((h) => h.minutes >= MIN_MINUTES);
  if (qualifying.length < MIN_PLAYER_MATCHES) return null;

  const total = qualifying.reduce((sum, h) => sum + h.value, 0);
  return {
    lambda: total / qualifying.length,
    sampleSize: qualifying.length,
  };
}

/**
 * P(over) y P(under) para un jugador en un stat dado.
 */
function playerOverUnderProb(
  lambda: number,
  line: number,
): { overProb: number; underProb: number } {
  let underProb = 0;
  const lineInt = Math.floor(line);
  for (let k = 0; k <= lineInt; k += 1) {
    underProb += poissonPmf(lambda, k);
  }
  // Clamp por precisión numérica
  underProb = Math.min(1, Math.max(0, underProb));
  return { overProb: 1 - underProb, underProb };
}

/**
 * Genera predicciones over/under para un jugador y un stat type.
 * Devuelve array vacío si no hay suficiente historial.
 *
 * `rivalAdjustment` (opcional): factor multiplicativo que refleja la fuerza
 * defensiva del rival respecto al promedio de la liga. >1 = rival más débil
 * (concede más), <1 = rival más fuerte. Se calcula en PredictionsService
 * comparando las concesiones del rival vs el promedio de la liga para ese
 * stat. Default 1.0 (sin ajuste).
 */
export function predictPlayerOverUnder(
  statType: PlayerStatType,
  history: PlayerHistoryStat[],
  lines?: number[],
  rivalAdjustment = 1.0,
): PlayerOverUnder[] {
  const result = playerLambda(history);
  if (!result || result.lambda <= 0) return [];

  const adjustedLambda = result.lambda * rivalAdjustment;

  const activeLines = lines ?? PLAYER_DEFAULT_LINES[statType];
  return activeLines.map((line) => {
    const { overProb, underProb } = playerOverUnderProb(adjustedLambda, line);
    return {
      statType,
      line,
      overProb,
      underProb,
      lambda: adjustedLambda,
      sampleSize: result.sampleSize,
    };
  });
}
