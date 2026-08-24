/**
 * Ligas que EdgeIQ sigue. Es una decisión de producto (qué competiciones
 * analizar), no una diferencia de entorno — por eso vive en código
 * versionado en vez de `.env` (ver docs/DECISIONS.md).
 *
 * Se resuelven contra API-Football por nombre + país en vez de IDs
 * numéricos quemados: si el nombre no calza, falla con un warning claro en
 * vez de traer silenciosamente la liga equivocada.
 */
export interface TrackedLeague {
  name: string;
  /** "World" para competiciones continentales/internacionales sin país único. */
  country: string;
}

export const TRACKED_LEAGUES: TrackedLeague[] = [
  { name: 'Premier League', country: 'England' },
  { name: 'La Liga', country: 'Spain' },
  { name: 'Serie A', country: 'Italy' },
  { name: 'Bundesliga', country: 'Germany' },
  { name: 'Ligue 1', country: 'France' },
  { name: 'UEFA Champions League', country: 'World' },
  { name: 'UEFA Europa League', country: 'World' },
  { name: 'CONMEBOL Libertadores', country: 'World' },
  { name: 'Serie A', country: 'Brazil' },
  { name: 'Primera A', country: 'Colombia' },
];

/** Temporadas anteriores a la actual que se auto-completan si faltan (arranque en frío). */
export const BACKFILL_SEASONS = 2;
