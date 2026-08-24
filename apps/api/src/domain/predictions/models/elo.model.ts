import type { MatchOutcomeProbabilities } from './types';

export interface EloMatchResult {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  playedAt: Date;
}

export type EloRatings = Record<string, number>;

export const DEFAULT_ELO_RATING = 1500;
export const ELO_K_FACTOR = 20;
/** Puntos de rating equivalentes a la ventaja de jugar de local. */
export const ELO_HOME_ADVANTAGE = 60;

/**
 * Recalcula ratings Elo repasando cronológicamente el historial de
 * resultados. No se persiste en `Team` (docs/DECISIONS.md): con el volumen
 * de datos actual recalcular es barato; optimizar de forma incremental si
 * el historial crece.
 */
export function computeEloRatings(
  results: EloMatchResult[],
  startingRating = DEFAULT_ELO_RATING,
): EloRatings {
  const ratings: EloRatings = {};
  const getRating = (teamId: string) => ratings[teamId] ?? startingRating;

  const sorted = [...results].sort(
    (a, b) => a.playedAt.getTime() - b.playedAt.getTime(),
  );

  for (const match of sorted) {
    const homeRating = getRating(match.homeTeamId);
    const awayRating = getRating(match.awayTeamId);

    const expectedHome =
      1 / (1 + 10 ** ((awayRating - (homeRating + ELO_HOME_ADVANTAGE)) / 400));
    const expectedAway = 1 - expectedHome;

    const actualHome =
      match.homeScore > match.awayScore
        ? 1
        : match.homeScore === match.awayScore
          ? 0.5
          : 0;
    const actualAway = 1 - actualHome;

    ratings[match.homeTeamId] =
      homeRating + ELO_K_FACTOR * (actualHome - expectedHome);
    ratings[match.awayTeamId] =
      awayRating + ELO_K_FACTOR * (actualAway - expectedAway);
  }

  return ratings;
}

/**
 * Convierte una diferencia de rating Elo en probabilidades 1X2.
 *
 * El "expected score" de Elo (1=gana, 0.5=empata, 0=pierde) se descompone
 * en P(gana)/P(empata)/P(pierde) usando la identidad
 * `expectedScore = P(gana) + 0.5 * P(empata)`. La probabilidad de empate en
 * sí es una heurística (mayor cuanto más cercanos los ratings) — Elo
 * clásico no la modela — y debe recalibrarse con backtesting real
 * (docs/LEARNINGS.md).
 */
export function eloToOutcomeProbabilities(
  homeRating: number,
  awayRating: number,
  homeAdvantage = ELO_HOME_ADVANTAGE,
): MatchOutcomeProbabilities {
  const diff = homeRating + homeAdvantage - awayRating;
  const expectedHome = 1 / (1 + 10 ** (-diff / 400));

  const baseDrawRate = 0.26; // aproximación de la tasa de empates en fútbol de liga
  const draw = baseDrawRate * Math.exp(-Math.abs(diff) / 400);

  const homeWin = Math.max(0, expectedHome - draw / 2);
  const awayWin = Math.max(0, 1 - expectedHome - draw / 2);

  const total = homeWin + draw + awayWin;
  return {
    homeWin: homeWin / total,
    draw: draw / total,
    awayWin: awayWin / total,
  };
}
