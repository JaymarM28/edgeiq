/**
 * Modelo Poisson para eventos de partido (Nivel 1).
 *
 * Aplica la misma distribución de Poisson que usamos para goles, pero a
 * estadísticas contables: corners, tarjetas, tiros a puerta. El enfoque es
 * idéntico — fuerza de ataque/defensa relativa al promedio de la liga — pero
 * por cada tipo de stat en vez de solo goles (docs/DECISIONS.md).
 *
 * Produce probabilidades over/under para líneas configurables (ej. corners
 * O/U 8.5, tarjetas O/U 3.5).
 */

// ─── Tipos ────────────────────────────────────────────────────────────────

export type EventStatType = 'corners' | 'shotsOnTarget' | 'yellowCards';

export interface TeamEventStats {
  matchesPlayed: number;
  /** Suma total de ese stat en todos los partidos jugados en ese rol (local/visitante). */
  totalValue: number;
}

export interface LeagueEventAverages {
  /** Promedio por partido del stat para equipos locales. */
  avgHome: number;
  /** Promedio por partido del stat para equipos visitantes. */
  avgAway: number;
}

export interface EventOverUnder {
  /** Tipo de evento (corners, shotsOnTarget, yellowCards). */
  statType: EventStatType;
  /** Línea evaluada (ej. 8.5, 9.5). */
  line: number;
  /** Probabilidad de que el total del partido sea > line. */
  overProb: number;
  /** Probabilidad de que el total del partido sea ≤ line. */
  underProb: number;
}

// ─── Líneas estándar por tipo de evento ───────────────────────────────────

export const DEFAULT_LINES: Record<EventStatType, number[]> = {
  corners: [7.5, 8.5, 9.5, 10.5, 11.5],
  shotsOnTarget: [3.5, 4.5, 5.5, 6.5],
  yellowCards: [2.5, 3.5, 4.5, 5.5],
};

// ─── Funciones puras ──────────────────────────────────────────────────────

function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // log-space para evitar overflow con k grande
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i += 1) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * Calcula los λ esperados (local y visitante) para un stat tipo evento,
 * usando fuerza de producción/concesión relativa al promedio de la liga —
 * misma lógica que el Poisson de goles.
 */
export function expectedEventTotals(
  league: LeagueEventAverages,
  home: TeamEventStats,
  away: TeamEventStats,
): { lambdaHome: number; lambdaAway: number } {
  if (
    home.matchesPlayed === 0 ||
    away.matchesPlayed === 0 ||
    league.avgHome === 0 ||
    league.avgAway === 0
  ) {
    return { lambdaHome: 0, lambdaAway: 0 };
  }

  const homeAvg = home.totalValue / home.matchesPlayed;
  const awayAvg = away.totalValue / away.matchesPlayed;

  // Fuerza relativa (producción del equipo vs promedio de la liga en ese rol)
  const homeStrength = homeAvg / league.avgHome;
  const awayStrength = awayAvg / league.avgAway;

  return {
    lambdaHome: league.avgHome * homeStrength,
    lambdaAway: league.avgAway * awayStrength,
  };
}

/**
 * Calcula P(over) y P(under) para una línea dada, sumando la distribución
 * de Poisson del total (home + away) independiente.
 *
 * `maxValue` limita la iteración — para corners un partido rara vez pasa de
 * 20; para tarjetas, de 12.
 */
export function overUnderProbability(
  lambdaHome: number,
  lambdaAway: number,
  line: number,
  maxValue = 20,
): { overProb: number; underProb: number } {
  if (lambdaHome <= 0 || lambdaAway <= 0) {
    return { overProb: 0, underProb: 1 };
  }

  let underProb = 0;
  const lineInt = Math.floor(line); // para línea 8.5, sumar P(total ≤ 8)

  for (let h = 0; h <= maxValue; h += 1) {
    const pH = poissonPmf(lambdaHome, h);
    for (let a = 0; a <= maxValue; a += 1) {
      if (h + a <= lineInt) {
        underProb += pH * poissonPmf(lambdaAway, a);
      }
    }
  }

  return { overProb: 1 - underProb, underProb };
}

/**
 * Genera todas las predicciones over/under para un stat type y sus líneas
 * default. Devuelve array vacío si λ es degenerado.
 */
export function predictEventOverUnder(
  statType: EventStatType,
  league: LeagueEventAverages,
  home: TeamEventStats,
  away: TeamEventStats,
  lines?: number[],
): EventOverUnder[] {
  const { lambdaHome, lambdaAway } = expectedEventTotals(league, home, away);
  if (lambdaHome <= 0 || lambdaAway <= 0) return [];

  const activeLines = lines ?? DEFAULT_LINES[statType];
  return activeLines.map((line) => {
    const { overProb, underProb } = overUnderProbability(
      lambdaHome,
      lambdaAway,
      line,
    );
    return { statType, line, overProb, underProb };
  });
}
