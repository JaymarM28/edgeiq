import {
  playerLambda,
  predictPlayerOverUnder,
  MIN_PLAYER_MATCHES,
} from './player-poisson.model';

describe('player-poisson.model', () => {
  // 10 partidos con ≥ 45 min, promedio de 2 tiros a puerta
  const history = Array.from({ length: 10 }, (_, i) => ({
    value: i % 3 === 0 ? 3 : 1, // 3, 1, 1, 3, 1, 1, 3, 1, 1, 3 → total=18, avg=1.8
    minutes: 90,
  }));

  describe('playerLambda', () => {
    it('calcula λ solo con partidos de ≥ 45 min', () => {
      const result = playerLambda(history);
      expect(result).not.toBeNull();
      expect(result!.lambda).toBeCloseTo(1.8, 5);
      expect(result!.sampleSize).toBe(10);
    });

    it('devuelve null si no hay suficientes partidos', () => {
      const short = history.slice(0, MIN_PLAYER_MATCHES - 1);
      expect(playerLambda(short)).toBeNull();
    });

    it('filtra partidos con < 45 min', () => {
      const mixed = [
        ...history.slice(0, 5),
        { value: 10, minutes: 10 }, // debe excluirse
        { value: 10, minutes: 30 }, // debe excluirse
      ];
      const result = playerLambda(mixed);
      expect(result).not.toBeNull();
      expect(result!.sampleSize).toBe(5);
    });
  });

  describe('predictPlayerOverUnder', () => {
    it('genera predicciones para líneas default de shotsOn', () => {
      const preds = predictPlayerOverUnder('shotsOn', history);
      expect(preds.length).toBe(3); // 0.5, 1.5, 2.5
      for (const p of preds) {
        expect(p.statType).toBe('shotsOn');
        expect(p.overProb + p.underProb).toBeCloseTo(1.0, 5);
        expect(p.lambda).toBeCloseTo(1.8, 5);
        expect(p.sampleSize).toBe(10);
      }
    });

    it('P(over 0.5) > P(over 2.5) cuando λ ≈ 1.8', () => {
      const preds = predictPlayerOverUnder('shotsOn', history);
      const over05 = preds.find((p) => p.line === 0.5)!;
      const over25 = preds.find((p) => p.line === 2.5)!;
      expect(over05.overProb).toBeGreaterThan(over25.overProb);
    });

    it('devuelve vacío si historial insuficiente', () => {
      const preds = predictPlayerOverUnder('goals', history.slice(0, 2));
      expect(preds).toEqual([]);
    });

    it('devuelve vacío si λ = 0', () => {
      const zeroHistory = Array.from({ length: 10 }, () => ({
        value: 0,
        minutes: 90,
      }));
      const preds = predictPlayerOverUnder('goals', zeroHistory);
      expect(preds).toEqual([]);
    });

    it('P(over 0.5 goals) razonable para delantero con λ ≈ 0.5', () => {
      const striker = Array.from({ length: 20 }, (_, i) => ({
        value: i % 2 === 0 ? 1 : 0, // 10 goles en 20 partidos → λ=0.5
        minutes: 90,
      }));
      const preds = predictPlayerOverUnder('goals', striker);
      const over05 = preds.find((p) => p.line === 0.5)!;
      // P(goals > 0) = 1 - P(0) = 1 - e^(-0.5) ≈ 0.3935
      expect(over05.overProb).toBeCloseTo(0.3935, 2);
    });
  });
});
