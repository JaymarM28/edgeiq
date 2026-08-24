import { expectedGoals, matchOutcomeProbabilities } from './poisson.model';

describe('poisson.model', () => {
  const league = { avgHomeGoalsScored: 1.5, avgAwayGoalsScored: 1.2 };

  it('produce goles esperados = promedio de liga para un equipo "promedio"', () => {
    // Un equipo local promedio anota a la tasa avgHomeGoalsScored y concede
    // a la tasa avgAwayGoalsScored (y viceversa de visitante).
    const avgHomeTeam = {
      matchesPlayed: 10,
      goalsScored: 15,
      goalsConceded: 12,
    };
    const avgAwayTeam = {
      matchesPlayed: 10,
      goalsScored: 12,
      goalsConceded: 15,
    };

    const goals = expectedGoals({
      league,
      home: avgHomeTeam,
      away: avgAwayTeam,
    });

    expect(goals.home).toBeCloseTo(league.avgHomeGoalsScored, 5);
    expect(goals.away).toBeCloseTo(league.avgAwayGoalsScored, 5);
  });

  it('da probabilidades 1X2 que suman 1', () => {
    const probs = matchOutcomeProbabilities({ home: 1.6, away: 1.1 });
    expect(probs.homeWin + probs.draw + probs.awayWin).toBeCloseTo(1, 5);
  });

  it('favorece al local cuando anota más goles esperados', () => {
    const probs = matchOutcomeProbabilities({ home: 2.2, away: 0.8 });
    expect(probs.homeWin).toBeGreaterThan(probs.awayWin);
  });

  it('da probabilidades simétricas cuando los goles esperados son iguales', () => {
    const probs = matchOutcomeProbabilities({ home: 1.4, away: 1.4 });
    expect(probs.homeWin).toBeCloseTo(probs.awayWin, 5);
  });
});
