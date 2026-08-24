import {
  expectedEventTotals,
  overUnderProbability,
  predictEventOverUnder,
} from './events-poisson.model';

describe('events-poisson.model', () => {
  const league = { avgHome: 5.0, avgAway: 4.0 };
  const home = { matchesPlayed: 10, totalValue: 60 }; // 6.0 avg
  const away = { matchesPlayed: 10, totalValue: 35 }; // 3.5 avg

  describe('expectedEventTotals', () => {
    it('calcula λ con fuerza relativa a la liga', () => {
      const result = expectedEventTotals(league, home, away);
      // homeStrength = 6.0 / 5.0 = 1.2 → λHome = 5.0 * 1.2 = 6.0
      // awayStrength = 3.5 / 4.0 = 0.875 → λAway = 4.0 * 0.875 = 3.5
      expect(result.lambdaHome).toBeCloseTo(6.0, 5);
      expect(result.lambdaAway).toBeCloseTo(3.5, 5);
    });

    it('devuelve 0 si no hay partidos jugados', () => {
      const result = expectedEventTotals(
        league,
        { matchesPlayed: 0, totalValue: 0 },
        away,
      );
      expect(result.lambdaHome).toBe(0);
      expect(result.lambdaAway).toBe(0);
    });

    it('devuelve 0 si promedio de la liga es 0', () => {
      const result = expectedEventTotals(
        { avgHome: 0, avgAway: 0 },
        home,
        away,
      );
      expect(result.lambdaHome).toBe(0);
    });
  });

  describe('overUnderProbability', () => {
    it('P(over 8.5) + P(under 8.5) ≈ 1', () => {
      const { overProb, underProb } = overUnderProbability(6.0, 3.5, 8.5);
      expect(overProb + underProb).toBeCloseTo(1.0, 5);
    });

    it('línea alta tiene menor P(over)', () => {
      const low = overUnderProbability(5.0, 4.0, 7.5);
      const high = overUnderProbability(5.0, 4.0, 11.5);
      expect(high.overProb).toBeLessThan(low.overProb);
    });

    it('λ altos producen P(over) alto para líneas bajas', () => {
      const { overProb } = overUnderProbability(8.0, 7.0, 8.5);
      expect(overProb).toBeGreaterThan(0.5);
    });

    it('λ = 0 → P(under) = 1', () => {
      const { overProb, underProb } = overUnderProbability(0, 0, 5.5);
      expect(overProb).toBe(0);
      expect(underProb).toBe(1);
    });
  });

  describe('predictEventOverUnder', () => {
    it('genera predicciones para todas las líneas default de corners', () => {
      const preds = predictEventOverUnder('corners', league, home, away);
      expect(preds.length).toBe(5); // 7.5, 8.5, 9.5, 10.5, 11.5
      for (const p of preds) {
        expect(p.statType).toBe('corners');
        expect(p.overProb + p.underProb).toBeCloseTo(1.0, 5);
        expect(p.overProb).toBeGreaterThan(0);
        expect(p.overProb).toBeLessThan(1);
      }
    });

    it('devuelve vacío si datos insuficientes', () => {
      const preds = predictEventOverUnder(
        'corners',
        league,
        { matchesPlayed: 0, totalValue: 0 },
        away,
      );
      expect(preds).toEqual([]);
    });

    it('acepta líneas custom', () => {
      const preds = predictEventOverUnder(
        'yellowCards',
        league,
        home,
        away,
        [3.5],
      );
      expect(preds.length).toBe(1);
      expect(preds[0].line).toBe(3.5);
    });
  });
});
