import {
  computeEloRatings,
  eloToOutcomeProbabilities,
  DEFAULT_ELO_RATING,
} from './elo.model';

describe('elo.model', () => {
  describe('computeEloRatings', () => {
    it('sube el rating del equipo que gana repetidamente y baja el del que pierde', () => {
      const results = Array.from({ length: 5 }, (_, i) => ({
        homeTeamId: 'A',
        awayTeamId: 'B',
        homeScore: 2,
        awayScore: 0,
        playedAt: new Date(2026, 0, i + 1),
      }));

      const ratings = computeEloRatings(results);

      expect(ratings.A).toBeGreaterThan(DEFAULT_ELO_RATING);
      expect(ratings.B).toBeLessThan(DEFAULT_ELO_RATING);
    });

    it('no cambia los ratings si todos los partidos terminan en empate entre equipos parejos', () => {
      const results = [
        {
          homeTeamId: 'A',
          awayTeamId: 'B',
          homeScore: 1,
          awayScore: 1,
          playedAt: new Date(2026, 0, 1),
        },
      ];

      const ratings = computeEloRatings(results);
      // El empate entre iguales es el resultado esperado, así que el ajuste es ~0
      // salvo por la ventaja de local (que sí produce un pequeño desajuste).
      expect(Math.abs(ratings.A - DEFAULT_ELO_RATING)).toBeLessThan(15);
    });
  });

  describe('eloToOutcomeProbabilities', () => {
    it('da 1X2 simétrico entre equipos iguales sin ventaja de local', () => {
      const probs = eloToOutcomeProbabilities(1500, 1500, 0);
      expect(probs.homeWin).toBeCloseTo(probs.awayWin, 5);
      expect(probs.draw).toBeGreaterThan(0);
      expect(probs.homeWin + probs.draw + probs.awayWin).toBeCloseTo(1, 5);
    });

    it('favorece fuertemente al equipo con mucho mejor rating', () => {
      const probs = eloToOutcomeProbabilities(1900, 1400, 0);
      expect(probs.homeWin).toBeGreaterThan(0.8);
      expect(probs.homeWin + probs.draw + probs.awayWin).toBeCloseTo(1, 5);
    });
  });
});
