// Sugerencias de props de jugador (over/under) a partir de promedios
// recientes. Compartido entre apps/web (página /players) y apps/api
// (digest diario por email) para no divergir la matemática ni los
// umbrales entre las dos superficies.

export interface PlayerAverages {
  shotsOn: number;
  shotsTotal: number;
  goals: number;
  assists: number;
  yellowCards: number;
  minutes: number;
  matchesPlayed: number;
}

export interface PropSuggestion {
  label: string;
  probability: number;
  description: string;
}

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/** Poisson P(X >= k) = 1 - sum_{i=0}^{k-1} e^-λ * λ^i / i! */
export function poissonAtLeast(lambda: number, k: number): number {
  if (lambda <= 0) return 0;
  let cdf = 0;
  for (let i = 0; i < k; i++) {
    cdf += (Math.exp(-lambda) * Math.pow(lambda, i)) / factorial(i);
  }
  return Math.max(0, Math.min(1, 1 - cdf));
}

export function buildPropSuggestions(avg: PlayerAverages | null): PropSuggestion[] {
  if (!avg) return [];
  const suggestions: PropSuggestion[] = [];

  const p1Goal = poissonAtLeast(avg.goals, 1);
  if (p1Goal > 0.25) {
    suggestions.push({
      label: '1+ Gol',
      probability: p1Goal,
      description: `Promedio: ${avg.goals.toFixed(2)} goles/partido`,
    });
  }

  const p1SOT = poissonAtLeast(avg.shotsOn, 1);
  if (p1SOT > 0.4) {
    suggestions.push({
      label: '1+ Tiro a puerta',
      probability: p1SOT,
      description: `Promedio: ${avg.shotsOn.toFixed(2)} SOT/partido`,
    });
  }
  const p2SOT = poissonAtLeast(avg.shotsOn, 2);
  if (p2SOT > 0.35) {
    suggestions.push({
      label: '2+ Tiros a puerta',
      probability: p2SOT,
      description: `Promedio: ${avg.shotsOn.toFixed(2)} SOT/partido`,
    });
  }

  const p2Shots = poissonAtLeast(avg.shotsTotal, 2);
  if (p2Shots > 0.4) {
    suggestions.push({
      label: '2+ Tiros totales',
      probability: p2Shots,
      description: `Promedio: ${avg.shotsTotal.toFixed(2)} tiros/partido`,
    });
  }

  const p1YC = poissonAtLeast(avg.yellowCards, 1);
  if (p1YC > 0.3) {
    suggestions.push({
      label: '1+ Tarjeta amarilla',
      probability: p1YC,
      description: `Promedio: ${avg.yellowCards.toFixed(2)} TA/partido`,
    });
  }

  const p1Assist = poissonAtLeast(avg.assists, 1);
  if (p1Assist > 0.2) {
    suggestions.push({
      label: '1+ Asistencia',
      probability: p1Assist,
      description: `Promedio: ${avg.assists.toFixed(2)} asist./partido`,
    });
  }

  return suggestions.sort((a, b) => b.probability - a.probability);
}
