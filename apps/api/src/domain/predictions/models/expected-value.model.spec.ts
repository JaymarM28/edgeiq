import { evaluateValueBet } from './expected-value.model';

describe('expected-value.model', () => {
  it('detecta un value bet cuando el edge supera el umbral', () => {
    const result = evaluateValueBet(
      { modelProbability: 0.6, decimalOdds: 2.0 },
      0.02,
    );

    expect(result.impliedProbability).toBeCloseTo(0.5, 5);
    expect(result.edge).toBeCloseTo(0.2, 5);
    expect(result.isValueBet).toBe(true);
  });

  it('no marca value bet cuando el edge es negativo', () => {
    const result = evaluateValueBet(
      { modelProbability: 0.4, decimalOdds: 2.0 },
      0.02,
    );

    expect(result.edge).toBeCloseTo(-0.2, 5);
    expect(result.isValueBet).toBe(false);
  });

  it('no marca value bet cuando el edge está por debajo del umbral', () => {
    const result = evaluateValueBet(
      { modelProbability: 0.51, decimalOdds: 2.0 },
      0.05,
    );

    expect(result.edge).toBeCloseTo(0.02, 5);
    expect(result.isValueBet).toBe(false);
  });
});
