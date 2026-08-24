export const INGESTION_QUEUE = 'ingestion';
export const SYNC_ALL_JOB = 'sync-all';

/**
 * Máximo de partidos terminados por liga por sync a los que se les piden
 * stats (/fixtures/statistics + /fixtures/players). Controla el consumo
 * diario de API-Football: 2 requests por partido × STATS_BATCH_SIZE por liga.
 * Con 10 ligas y batch=30 → ~600 requests/sync, dentro del margen del
 * plan Pro (7 500/día). El backfill completo ocurre en varias corridas.
 *
 * Con el rate-limit de ~10 req/min, un batch de 10 tarda ~2 minutos
 * (10 stats + 10 players = 20 requests con delay de 6.5s entre cada una).
 */
export const STATS_BATCH_SIZE = 10;

/**
 * Mapeo de nombres de apuesta de API-Football → nuestros markets internos.
 * La respuesta de `/odds` ya incluye todas las apuestas de cada bookmaker;
 * solo procesamos las que aparecen aquí. El mapeo es por nombre de bet de
 * la API, no por ID numérico (los IDs de pre-match y live son distintos y
 * no deben mezclarse — docs/DECISIONS.md).
 *
 * `selectionParser` transforma el `value.value` de la API (ej. "Over 2.5")
 * en el par (market, selection) que guardamos en Odds/Prediction.
 */
export interface OddsMarketMapping {
  /** Nombre de la apuesta en la respuesta de API-Football. */
  apiBetName: string;
  /** Función que convierte el value.value de la API al market+selection nuestro. */
  parse: (apiValue: string) => { market: string; selection: string } | null;
}

export const ODDS_MARKET_MAPPINGS: OddsMarketMapping[] = [
  {
    apiBetName: 'Match Winner',
    parse: (v) => ({ market: '1X2', selection: v }),
  },
  {
    // "Goals Over/Under" o "Over/Under" — nombres pueden variar por bookmaker
    apiBetName: 'Goals Over/Under',
    parse: (v) => {
      // v = "Over 2.5" o "Under 2.5"
      const match = /^(Over|Under)\s+([\d.]+)$/.exec(v);
      if (!match) return null;
      return { market: `Goals O/U ${match[2]}`, selection: match[1] };
    },
  },
  {
    apiBetName: 'Over/Under',
    parse: (v) => {
      const match = /^(Over|Under)\s+([\d.]+)$/.exec(v);
      if (!match) return null;
      return { market: `Goals O/U ${match[2]}`, selection: match[1] };
    },
  },
  {
    apiBetName: 'Asian Corners Over/Under',
    parse: (v) => {
      const match = /^(Over|Under)\s+([\d.]+)$/.exec(v);
      if (!match) return null;
      return { market: `Corners O/U ${match[2]}`, selection: match[1] };
    },
  },
  {
    apiBetName: 'Corners Over Under',
    parse: (v) => {
      const match = /^(Over|Under)\s+([\d.]+)$/.exec(v);
      if (!match) return null;
      return { market: `Corners O/U ${match[2]}`, selection: match[1] };
    },
  },
  {
    apiBetName: 'Total - Corners',
    parse: (v) => {
      const match = /^(Over|Under)\s+([\d.]+)$/.exec(v);
      if (!match) return null;
      return { market: `Corners O/U ${match[2]}`, selection: match[1] };
    },
  },
  {
    apiBetName: 'Total Cards',
    parse: (v) => {
      const match = /^(Over|Under)\s+([\d.]+)$/.exec(v);
      if (!match) return null;
      return { market: `Yellow Cards O/U ${match[2]}`, selection: match[1] };
    },
  },
  {
    apiBetName: 'Bookings Over/Under',
    parse: (v) => {
      const match = /^(Over|Under)\s+([\d.]+)$/.exec(v);
      if (!match) return null;
      return { market: `Yellow Cards O/U ${match[2]}`, selection: match[1] };
    },
  },
  {
    apiBetName: 'Shots on Target Over/Under',
    parse: (v) => {
      const match = /^(Over|Under)\s+([\d.]+)$/.exec(v);
      if (!match) return null;
      return { market: `Shots on Target O/U ${match[2]}`, selection: match[1] };
    },
  },
];
