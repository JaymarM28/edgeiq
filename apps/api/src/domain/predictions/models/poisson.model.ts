import type { MatchOutcomeProbabilities } from './types';

export interface TeamGoalStats {
  matchesPlayed: number;
  goalsScored: number;
  goalsConceded: number;
}

export interface LeagueGoalAverages {
  avgHomeGoalsScored: number;
  avgAwayGoalsScored: number;
}

export interface PoissonInput {
  league: LeagueGoalAverages;
  home: TeamGoalStats;
  away: TeamGoalStats;
}

export interface ExpectedGoals {
  home: number;
  away: number;
}

function rate(total: number, matches: number): number {
  return matches > 0 ? total / matches : 0;
}

/**
 * Modelo de Poisson para fútbol con corrección Dixon-Coles para marcadores
 * bajos (0-0, 1-0, 0-1, 1-1). Fuerza de ataque/defensa de cada equipo
 * relativa al promedio de goles de la liga (local vs visitante por separado).
 *
 * Dixon-Coles (1997): el Poisson independiente subestima la correlación
 * negativa entre goles de ambos equipos en marcadores bajos. El parámetro ρ
 * corrige esto multiplicando las probabilidades P(0,0), P(1,0), P(0,1) y
 * P(1,1) por un factor τ(ρ). Sin estimación MLE real de ρ todavía
 * (requeriría optimización numérica sobre el historial completo), usamos
 * un ρ fijo empírico de -0.05, que es un valor representativo en la
 * literatura para ligas europeas.
 */
export function expectedGoals(input: PoissonInput): ExpectedGoals {
  const { league, home, away } = input;

  const homeAttack =
    rate(home.goalsScored, home.matchesPlayed) / league.avgHomeGoalsScored;
  const homeDefense =
    rate(home.goalsConceded, home.matchesPlayed) / league.avgAwayGoalsScored;
  const awayAttack =
    rate(away.goalsScored, away.matchesPlayed) / league.avgAwayGoalsScored;
  const awayDefense =
    rate(away.goalsConceded, away.matchesPlayed) / league.avgHomeGoalsScored;

  return {
    home: league.avgHomeGoalsScored * homeAttack * awayDefense,
    away: league.avgAwayGoalsScored * awayAttack * homeDefense,
  };
}

function factorial(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
}

function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * lambda ** k) / factorial(k);
}

/**
 * Valor empírico fijo de ρ (Dixon-Coles). Negativo indica correlación
 * negativa: marcadores muy bajos son ligeramente más probables de lo que
 * Poisson independiente predice. Valor de -0.05 es representativo para
 * ligas europeas principales. Idealmente se estimaría con MLE sobre el
 * historial — queda para una fase posterior.
 */
const DIXON_COLES_RHO = -0.05;

/**
 * Factor de corrección τ(h, a, λ_h, λ_a, ρ) de Dixon-Coles.
 * Solo modifica las probabilidades de los marcadores (0,0), (1,0), (0,1), (1,1).
 * Para todos los demás marcadores, τ = 1 (sin corrección).
 */
function dixonColesTau(
  homeGoals: number,
  awayGoals: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number,
): number {
  if (homeGoals === 0 && awayGoals === 0) {
    return 1 - lambdaHome * lambdaAway * rho;
  }
  if (homeGoals === 1 && awayGoals === 0) {
    return 1 + lambdaAway * rho;
  }
  if (homeGoals === 0 && awayGoals === 1) {
    return 1 + lambdaHome * rho;
  }
  if (homeGoals === 1 && awayGoals === 1) {
    return 1 - rho;
  }
  return 1;
}

/**
 * Suma la matriz de probabilidad de marcador con corrección Dixon-Coles
 * para obtener P(1X2). El parámetro ρ ajusta marcadores bajos.
 */
export function matchOutcomeProbabilities(
  goals: ExpectedGoals,
  maxGoals = 8,
  rho = DIXON_COLES_RHO,
): MatchOutcomeProbabilities {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;

  for (let h = 0; h <= maxGoals; h += 1) {
    const pHome = poissonPmf(goals.home, h);
    for (let a = 0; a <= maxGoals; a += 1) {
      const pIndep = pHome * poissonPmf(goals.away, a);
      const tau = dixonColesTau(h, a, goals.home, goals.away, rho);
      const p = pIndep * tau;
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
    }
  }

  const total = homeWin + draw + awayWin;
  return {
    homeWin: homeWin / total,
    draw: draw / total,
    awayWin: awayWin / total,
  };
}
