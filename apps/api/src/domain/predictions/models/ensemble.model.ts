import type { MatchOutcomeProbabilities } from './types';

/**
 * Combina predicciones Poisson y Elo con media ponderada.
 * Poisson recibe peso dominante (0.75) dado su ROI positivo.
 * Elo aporta estabilidad con historial amplio pero tiene ROI
 * negativo solo, así que su contribución es minoritaria (0.25).
 */
export function ensembleProbabilities(
  poisson: MatchOutcomeProbabilities,
  elo: MatchOutcomeProbabilities,
  poissonWeight = 0.75,
): MatchOutcomeProbabilities {
  const eloWeight = 1 - poissonWeight;

  const homeWin = poisson.homeWin * poissonWeight + elo.homeWin * eloWeight;
  const draw = poisson.draw * poissonWeight + elo.draw * eloWeight;
  const awayWin = poisson.awayWin * poissonWeight + elo.awayWin * eloWeight;

  const total = homeWin + draw + awayWin;
  return {
    homeWin: homeWin / total,
    draw: draw / total,
    awayWin: awayWin / total,
  };
}
