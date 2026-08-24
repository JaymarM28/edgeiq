import type { League, Team, Odds, Prediction } from '@edgeiq/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1';

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem('edgeiq_token'); } catch { return null; }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...init?.headers as Record<string, string> };
  if (init?.body) headers['Content-Type'] = 'application/json';

  // Attach JWT if available
  const token = getStoredToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`);
  return res.json();
}

// ── Types ──
// League, Team, Prediction, Odds vienen de @edgeiq/shared (contrato común
// con la API). Se re-exportan para no romper imports existentes de este módulo.

export type { League, Team, Prediction, Odds };

export interface MatchInjury {
  player: { id: string; name: string };
  type: string;
  reason: string;
}

export interface UpcomingMatch {
  id: string;
  kickoffAt: string;
  season: string | null;
  matchday: number | null;
  homeTeam: Team;
  awayTeam: Team;
  league: { id: string; name: string; country: string | null };
  predictions: Prediction[];
  odds: Odds[];
  injuries?: { home: MatchInjury[]; away: MatchInjury[] };
}

export interface ValueBet {
  id: string;
  market: string;
  selection: string;
  modelName: string;
  modelProbability: number;
  impliedProbability: number | null;
  edge: number | null;
  explanation?: string | null;
  match: {
    id: string;
    kickoffAt: string;
    homeTeam: Team;
    awayTeam: Team;
    league: { name: string };
  };
}

export interface PlayerSummary {
  id: string;
  name: string;
  team: { id: string; name: string } | null;
  _count: { matchStats: number };
}

export interface PlayerMatchDetail {
  matchId: string;
  date: string;
  opponent: string;
  league: string;
  minutes: number;
  shotsOn: number;
  shotsTotal: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
}

export interface PlayerInjury {
  id: string;
  type: string;
  reason: string;
  reportedAt: string;
}

export interface PlayerDetail {
  id: string;
  name: string;
  team: { id: string; name: string } | null;
  averages: {
    shotsOn: number;
    shotsTotal: number;
    goals: number;
    assists: number;
    yellowCards: number;
    minutes: number;
    matchesPlayed: number;
  } | null;
  injuries?: PlayerInjury[];
  recentMatches: PlayerMatchDetail[];
}

export interface TopPlayer {
  player: { id: string; name: string; team: { name: string } | null };
  total: number;
  matches: number;
}

// ── Teams ──

export interface TeamSearchResult {
  id: string;
  name: string;
  shortName: string | null;
  country: string | null;
  externalId: string | null;
}

export interface TeamFormEntry {
  matchId: string;
  kickoffAt: string;
  league: string;
  opponent: string;
  isHome: boolean;
  scored: number;
  conceded: number;
  outcome: 'W' | 'D' | 'L';
}

export interface TeamUpcomingMatch {
  id: string;
  kickoffAt: string;
  league: string;
  homeTeam: { id: string; name: string };
  awayTeam: { id: string; name: string };
}

export interface TeamDetail {
  team: TeamSearchResult;
  record: {
    matchesPlayed: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
  };
  recentForm: TeamFormEntry[];
  upcomingMatches: TeamUpcomingMatch[];
}

// ── Backtesting ──

export interface CalibrationBucket {
  range: string;
  predicted: number;
  actual: number;
  count: number;
}

export interface LeagueBreakdown {
  league: string;
  leagueId: string;
  matches: number;
  accuracy: number;
  brierScore: number;
}

export interface ModelReport {
  model: string;
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;
  brierScore: number;
  calibration: CalibrationBucket[];
  valueBetROI: {
    totalBets: number;
    totalStaked: number;
    totalReturn: number;
    roi: number;
    winRate: number;
  };
  byLeague: LeagueBreakdown[];
}

export interface BacktestReport {
  totalMatchesEvaluated: number;
  models: ModelReport[];
  generatedAt: string;
}

// ── Analysis ──

export interface MatchAnalysisResponse {
  matchId: string;
  type: string;
  content: string;
}

export interface BacktestAnalysisResponse {
  type: string;
  content: string;
  matchesEvaluated: number;
}
