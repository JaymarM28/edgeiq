// Tipos mínimos de la respuesta de API-Football v3 (solo los campos que consumimos).
// Referencia: https://www.api-football.com/documentation-v3

export interface ApiFootballEnvelope<T> {
  response: T[];
}

export interface ApiFootballLeague {
  league: {
    id: number;
    name: string;
    type: string;
  };
  country: {
    name: string | null;
  };
}

export interface ApiFootballSeason {
  year: number;
  start: string;
  end: string;
  current: boolean;
}

/** Respuesta de /leagues cuando se pide con `current=true` (incluye `seasons`). */
export interface ApiFootballLeagueWithSeasons extends ApiFootballLeague {
  seasons: ApiFootballSeason[];
}

export interface ApiFootballFixture {
  fixture: {
    id: number;
    date: string; // ISO 8601
    status: {
      short: string; // NS, LIVE, FT, PST, CANC, etc.
    };
  };
  league: {
    id: number;
    season: number;
    round: string;
  };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: {
    home: number | null;
    away: number | null;
  };
}

export interface ApiFootballOddsValue {
  value: string; // "Home" | "Draw" | "Away" (mercado 1X2)
  odd: string;
}

export interface ApiFootballOddsBet {
  id: number;
  name: string; // "Match Winner" = mercado 1X2
  values: ApiFootballOddsValue[];
}

export interface ApiFootballOddsBookmaker {
  id: number;
  name: string;
  bets: ApiFootballOddsBet[];
}

export interface ApiFootballOddsEntry {
  fixture: { id: number };
  bookmakers: ApiFootballOddsBookmaker[];
}

// --- /fixtures/statistics ---

export interface ApiFootballStatisticItem {
  type: string; // "Corner Kicks", "Shots on Goal", "Yellow Cards", etc.
  value: number | string | null;
}

export interface ApiFootballFixtureStatistics {
  team: { id: number; name: string };
  statistics: ApiFootballStatisticItem[];
}

// --- /fixtures/players ---

export interface ApiFootballPlayerStats {
  player: { id: number; name: string };
  statistics: Array<{
    games: {
      minutes: number | null;
      position: string | null;
      rating: string | null;
    };
    shots: { total: number | null; on: number | null } | null;
    goals: { total: number | null; assists: number | null } | null;
    cards: { yellow: number | null; red: number | null } | null;
    fouls: { drawn: number | null; committed: number | null } | null;
  }>;
}

export interface ApiFootballFixturePlayers {
  team: { id: number; name: string };
  players: ApiFootballPlayerStats[];
}

// --- /injuries ---

export interface ApiFootballInjury {
  player: {
    id: number;
    name: string;
    photo: string;
    type: string;
    reason: string;
  };
  team: { id: number; name: string; logo: string };
  fixture: { id: number; timezone: string; date: string; timestamp: number };
  league: {
    id: number;
    season: number;
    name: string;
    country: string;
    flag: string | null;
  };
}
