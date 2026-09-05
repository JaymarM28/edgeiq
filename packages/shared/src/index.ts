// Punto de entrada de tipos y utilidades compartidas entre apps/api y apps/web.
// Reflejan el contrato definido en apps/api/prisma/schema.prisma — si el
// schema cambia, estos tipos deben actualizarse a mano (no se generan).

export const EDGEIQ_API_VERSION = 'v1';

export * from './prop-suggestions';

export type MatchStatus = 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';

export type NotificationType = 'VALUE_BET' | 'RESULT_UPDATE' | 'SYSTEM';

export interface League {
  id: string;
  name: string;
  country: string | null;
  externalId: string;
}

export interface Team {
  id: string;
  name: string;
  shortName?: string | null;
  country?: string | null;
  externalId?: string | null;
}

export interface Odds {
  bookmaker: string;
  market: string;
  selection: string;
  price: string;
  fetchedAt: string;
}

export interface Prediction {
  market: string;
  selection: string;
  modelName: string;
  modelProbability: number;
  impliedProbability: number | null;
  edge: number | null;
  explanation?: string | null;
}

export interface MatchResult {
  homeScore: number;
  awayScore: number;
}

export interface MatchSummary {
  id: string;
  kickoffAt: string;
  status: MatchStatus;
  season: string | null;
  matchday: number | null;
  homeTeam: Team;
  awayTeam: Team;
  league: League;
}
