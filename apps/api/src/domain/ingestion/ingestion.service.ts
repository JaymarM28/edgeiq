import { Injectable, Logger } from '@nestjs/common';
import {
  ApiFootballService,
  type ResolvedLeague,
} from '../../core/integrations/api-football/api-football.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ODDS_MARKET_MAPPINGS, STATS_BATCH_SIZE } from './ingestion.constants';
import { BACKFILL_SEASONS, TRACKED_LEAGUES } from './leagues.config';

/**
 * Mapeo de estados de API-Football a nuestro enum MatchStatus.
 * Se declara como union local (en vez de importar el enum generado por
 * Prisma) para que este archivo compile incluso antes de correr
 * `prisma generate` — son estructuralmente compatibles con Prisma.MatchStatus.
 */
type MatchStatusValue =
  'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';

const STATUS_MAP: Record<string, MatchStatusValue> = {
  NS: 'SCHEDULED',
  TBD: 'SCHEDULED',
  '1H': 'LIVE',
  HT: 'LIVE',
  '2H': 'LIVE',
  ET: 'LIVE',
  P: 'LIVE',
  BT: 'LIVE',
  SUSP: 'LIVE',
  INT: 'LIVE',
  FT: 'FINISHED',
  AET: 'FINISHED',
  PEN: 'FINISHED',
  PST: 'POSTPONED',
  CANC: 'CANCELLED',
  ABD: 'CANCELLED',
  AWD: 'FINISHED',
  WO: 'FINISHED',
};

type SyncOutcome = { synced: number } | { error: string };

export interface SyncAllResult {
  league: string;
  leagueId: number | null;
  season: number | null;
  fixtures: SyncOutcome;
  odds: SyncOutcome;
  matchStats: SyncOutcome;
  playerStats: SyncOutcome;
  injuries: SyncOutcome;
}

/**
 * Orquesta la sincronización con API-Football hacia el esquema Prisma.
 *
 * Multi-liga (docs/DECISIONS.md): las ligas se configuran por nombre+país en
 * `leagues.config.ts` y se resuelven contra la API (ID + temporada actual)
 * en cada corrida — nada de IDs ni años quemados. La temporada actual
 * siempre se sincroniza; las `BACKFILL_SEASONS` anteriores solo se traen si
 * todavía no hay datos propios (arranque en frío, sin gastar cupo de más).
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly apiFootball: ApiFootballService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Pausa entre requests a API-Football para respetar rate limit.
   * El plan Pro permite ~30 req/min; 2s entre requests es conservador
   * pero evita ráfagas que disparan 429.
   */
  private delay(ms = 2000): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private upsertLeague(resolved: ResolvedLeague) {
    return this.prisma.league.upsert({
      where: { externalId: String(resolved.id) },
      create: {
        externalId: String(resolved.id),
        name: resolved.name,
        country: resolved.country ?? undefined,
        sport: 'football',
      },
      update: {
        name: resolved.name,
        country: resolved.country ?? undefined,
      },
    });
  }

  private upsertTeam(team: { id: number; name: string }) {
    return this.prisma.team.upsert({
      where: { externalId: String(team.id) },
      create: { externalId: String(team.id), name: team.name },
      update: { name: team.name },
    });
  }

  private parseRound(round: string): number | undefined {
    const match = /(\d+)/.exec(round);
    return match ? Number(match[1]) : undefined;
  }

  private async hasSeasonData(
    leagueDbId: string,
    season: number,
  ): Promise<boolean> {
    const count = await this.prisma.match.count({
      where: { leagueId: leagueDbId, season: String(season) },
    });
    return count > 0;
  }

  private async syncFixtures(
    leagueDbId: string,
    externalLeagueId: number,
    season: number,
  ): Promise<{ synced: number }> {
    await this.delay();
    const fixtures = await this.apiFootball.getFixtures(
      externalLeagueId,
      season,
    );
    let synced = 0;

    for (const f of fixtures) {
      const [homeTeam, awayTeam] = await Promise.all([
        this.upsertTeam(f.teams.home),
        this.upsertTeam(f.teams.away),
      ]);

      const status = STATUS_MAP[f.fixture.status.short] ?? 'SCHEDULED';

      const match = await this.prisma.match.upsert({
        where: { externalId: String(f.fixture.id) },
        create: {
          externalId: String(f.fixture.id),
          leagueId: leagueDbId,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          kickoffAt: new Date(f.fixture.date),
          status,
          season: String(f.league.season),
          matchday: this.parseRound(f.league.round),
        },
        update: {
          kickoffAt: new Date(f.fixture.date),
          status,
        },
      });

      if (
        f.fixture.status.short === 'FT' &&
        f.goals.home !== null &&
        f.goals.away !== null
      ) {
        await this.prisma.result.upsert({
          where: { matchId: match.id },
          create: {
            matchId: match.id,
            homeScore: f.goals.home,
            awayScore: f.goals.away,
          },
          update: { homeScore: f.goals.home, awayScore: f.goals.away },
        });
      }

      synced += 1;
    }

    return { synced };
  }

  /**
   * Cuotas de los próximos `daysAhead` días para todos los mercados
   * configurados en ODDS_MARKET_MAPPINGS (1X2, Over/Under goles, corners,
   * tarjetas, tiros a puerta). La respuesta de `/odds` ya incluye todas
   * las apuestas de cada bookmaker; solo procesamos las que nos interesan.
   */
  private async syncUpcomingOdds(
    externalLeagueId: number,
    season: number,
    daysAhead = 10,
  ): Promise<{ synced: number }> {
    let synced = 0;

    // Índice rápido de bet names → parsers
    const betNameMap = new Map(
      ODDS_MARKET_MAPPINGS.map((m) => [m.apiBetName, m.parse]),
    );

    for (let i = 0; i < daysAhead; i += 1) {
      const date = new Date();
      date.setDate(date.getDate() + i);
      const isoDate = date.toISOString().slice(0, 10);

      await this.delay();
      const entries = await this.apiFootball.getOddsByDate(
        externalLeagueId,
        season,
        isoDate,
      );

      for (const entry of entries) {
        const match = await this.prisma.match.findUnique({
          where: { externalId: String(entry.fixture.id) },
        });
        if (!match) continue;

        for (const bookmaker of entry.bookmakers) {
          for (const bet of bookmaker.bets) {
            const parser = betNameMap.get(bet.name);
            if (!parser) continue; // bet type que no nos interesa

            for (const value of bet.values) {
              const parsed = parser(value.value);
              if (!parsed) continue;

              await this.prisma.odds.create({
                data: {
                  matchId: match.id,
                  bookmaker: bookmaker.name,
                  market: parsed.market,
                  selection: parsed.selection,
                  price: value.odd,
                },
              });
              synced += 1;
            }
          }
        }
      }
    }

    return { synced };
  }

  /**
   * Parsea un valor numérico de la respuesta de stats de API-Football.
   * Puede ser number, string numérico, string con "%" (posesión), o null.
   */
  private parseStatValue(value: number | string | null): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    const n = parseInt(value, 10);
    return isNaN(n) ? 0 : n;
  }

  /**
   * Sincroniza stats de equipo por partido (/fixtures/statistics) para partidos
   * FINISHED que aún no tienen MatchStatistic. Máximo STATS_BATCH_SIZE por
   * llamada para controlar el consumo de cupo de la API.
   */
  private async syncMatchStats(
    leagueDbId: string,
  ): Promise<{ synced: number }> {
    // Partidos terminados sin stats todavía
    const finished = await this.prisma.match.findMany({
      where: {
        leagueId: leagueDbId,
        status: 'FINISHED',
        externalId: { not: null },
        matchStatistics: { none: {} },
      },
      select: { id: true, externalId: true },
      take: STATS_BATCH_SIZE,
      orderBy: { kickoffAt: 'desc' }, // más recientes primero
    });

    let synced = 0;
    for (const match of finished) {
      try {
        await this.delay();
        const stats = await this.apiFootball.getFixtureStatistics(
          Number(match.externalId),
        );
        for (const teamStats of stats) {
          const team = await this.prisma.team.findUnique({
            where: { externalId: String(teamStats.team.id) },
          });
          if (!team) continue;

          const get = (type: string) => {
            const item = teamStats.statistics.find((s) => s.type === type);
            return item ? this.parseStatValue(item.value) : 0;
          };

          await this.prisma.matchStatistic.upsert({
            where: {
              matchId_teamId: { matchId: match.id, teamId: team.id },
            },
            create: {
              matchId: match.id,
              teamId: team.id,
              corners: get('Corner Kicks'),
              shotsOnTarget: get('Shots on Goal'),
              shotsTotal: get('Total Shots'),
              yellowCards: get('Yellow Cards'),
              redCards: get('Red Cards'),
              fouls: get('Fouls'),
            },
            update: {
              corners: get('Corner Kicks'),
              shotsOnTarget: get('Shots on Goal'),
              shotsTotal: get('Total Shots'),
              yellowCards: get('Yellow Cards'),
              redCards: get('Red Cards'),
              fouls: get('Fouls'),
            },
          });
        }
        synced += 1;
      } catch (err) {
        this.logger.warn(
          `Stats del partido ${match.externalId} falló: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    return { synced };
  }

  /**
   * Sincroniza stats de jugador por partido (/fixtures/players) para partidos
   * FINISHED que aún no tienen PlayerMatchStat. Mismo batch que syncMatchStats.
   */
  private async syncPlayerStats(
    leagueDbId: string,
  ): Promise<{ synced: number }> {
    const finished = await this.prisma.match.findMany({
      where: {
        leagueId: leagueDbId,
        status: 'FINISHED',
        externalId: { not: null },
        playerStats: { none: {} },
      },
      select: { id: true, externalId: true },
      take: STATS_BATCH_SIZE,
      orderBy: { kickoffAt: 'desc' },
    });

    let synced = 0;
    for (const match of finished) {
      try {
        await this.delay();
        const teamPlayers = await this.apiFootball.getFixturePlayers(
          Number(match.externalId),
        );

        for (const teamEntry of teamPlayers) {
          const team = await this.prisma.team.findUnique({
            where: { externalId: String(teamEntry.team.id) },
          });
          if (!team) continue;

          for (const p of teamEntry.players) {
            // Upsert player (puede ser la primera vez que lo vemos)
            const player = await this.prisma.player.upsert({
              where: { externalId: String(p.player.id) },
              create: {
                externalId: String(p.player.id),
                name: p.player.name,
                teamId: team.id,
              },
              update: { name: p.player.name, teamId: team.id },
            });

            const s = p.statistics[0]; // API-Football devuelve un array, siempre 1 elemento
            if (!s) continue;

            await this.prisma.playerMatchStat.upsert({
              where: {
                matchId_playerId: { matchId: match.id, playerId: player.id },
              },
              create: {
                matchId: match.id,
                playerId: player.id,
                teamId: team.id,
                minutes: s.games.minutes ?? 0,
                shotsTotal: s.shots?.total ?? 0,
                shotsOn: s.shots?.on ?? 0,
                goals: s.goals?.total ?? 0,
                assists: s.goals?.assists ?? 0,
                yellowCards: s.cards?.yellow ?? 0,
                redCards: s.cards?.red ?? 0,
                foulsCommitted: s.fouls?.committed ?? 0,
                foulsDrawn: s.fouls?.drawn ?? 0,
              },
              update: {
                minutes: s.games.minutes ?? 0,
                shotsTotal: s.shots?.total ?? 0,
                shotsOn: s.shots?.on ?? 0,
                goals: s.goals?.total ?? 0,
                assists: s.goals?.assists ?? 0,
                yellowCards: s.cards?.yellow ?? 0,
                redCards: s.cards?.red ?? 0,
                foulsCommitted: s.fouls?.committed ?? 0,
                foulsDrawn: s.fouls?.drawn ?? 0,
              },
            });
          }
        }
        synced += 1;
      } catch (err) {
        this.logger.warn(
          `Player stats del partido ${match.externalId} falló: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    return { synced };
  }

  /**
   * Sincroniza lesiones y sanciones de una liga desde /injuries.
   * Hace upsert por (playerId, fixtureExternalId) para no duplicar.
   */
  private async syncInjuries(
    externalLeagueId: number,
    season: number,
  ): Promise<{ synced: number }> {
    await this.delay();
    const injuries = await this.apiFootball.getInjuries(
      externalLeagueId,
      season,
    );
    let synced = 0;

    for (const inj of injuries) {
      // Solo procesar si tenemos al jugador en nuestra DB
      const player = await this.prisma.player.findUnique({
        where: { externalId: String(inj.player.id) },
      });
      if (!player) continue;

      await this.prisma.playerInjury.upsert({
        where: {
          playerId_fixtureExternalId: {
            playerId: player.id,
            fixtureExternalId: String(inj.fixture.id),
          },
        },
        create: {
          playerId: player.id,
          teamExternalId: String(inj.team.id),
          fixtureExternalId: String(inj.fixture.id),
          type: inj.player.type ?? 'Missing Fixture',
          reason: inj.player.reason ?? 'Unknown',
          status: 'active',
          reportedAt: new Date(inj.fixture.date),
        },
        update: {
          type: inj.player.type ?? 'Missing Fixture',
          reason: inj.player.reason ?? 'Unknown',
        },
      });
      synced += 1;
    }

    return { synced };
  }

  private toSyncOutcome(err: unknown): { error: string } {
    return { error: err instanceof Error ? err.message : 'Error desconocido' };
  }

  /**
   * Sincroniza una liga ya resuelta: temporada actual (siempre) + backfill
   * automático de temporadas anteriores (solo si faltan) + cuotas próximas.
   * `seasonOverride` fuerza una temporada puntual y desactiva el backfill
   * (uso manual, ej. `?season=2025`).
   */
  private async syncResolvedLeague(
    resolved: ResolvedLeague,
    seasonOverride?: number,
  ): Promise<SyncAllResult> {
    const league = await this.upsertLeague(resolved);
    const season = seasonOverride ?? resolved.currentSeason;

    this.logger.log(`  [${resolved.name}] Sincronizando fixtures…`);
    let fixtures: SyncOutcome;
    try {
      fixtures = await this.syncFixtures(league.id, resolved.id, season);
      this.logger.log(
        `  [${resolved.name}] Fixtures: ${'synced' in fixtures ? fixtures.synced : 'error'}`,
      );
    } catch (err) {
      fixtures = this.toSyncOutcome(err);
      this.logger.warn(
        `  [${resolved.name}] Fixtures falló: ${(err as Error).message}`,
      );
    }

    if (seasonOverride === undefined) {
      for (let i = 1; i <= BACKFILL_SEASONS; i += 1) {
        const pastSeason = resolved.currentSeason - i;
        if (await this.hasSeasonData(league.id, pastSeason)) continue;
        try {
          await this.syncFixtures(league.id, resolved.id, pastSeason);
          this.logger.log(
            `[${resolved.name}] Backfill temporada ${pastSeason}`,
          );
        } catch (err) {
          this.logger.warn(
            `[${resolved.name}] Backfill temporada ${pastSeason} falló: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
    }

    this.logger.log(`  [${resolved.name}] Sincronizando odds…`);
    let odds: SyncOutcome;
    try {
      odds = await this.syncUpcomingOdds(resolved.id, season);
      this.logger.log(
        `  [${resolved.name}] Odds: ${'synced' in odds ? odds.synced : 'error'}`,
      );
    } catch (err) {
      odds = this.toSyncOutcome(err);
      this.logger.warn(
        `  [${resolved.name}] Odds falló: ${(err as Error).message}`,
      );
    }

    // Stats de equipo y jugador para partidos terminados sin stats
    this.logger.log(`  [${resolved.name}] Sincronizando match stats…`);
    let matchStats: SyncOutcome;
    try {
      matchStats = await this.syncMatchStats(league.id);
      this.logger.log(
        `  [${resolved.name}] Match stats: ${'synced' in matchStats ? matchStats.synced : 'error'}`,
      );
    } catch (err) {
      matchStats = this.toSyncOutcome(err);
      this.logger.warn(
        `  [${resolved.name}] Match stats falló: ${(err as Error).message}`,
      );
    }

    this.logger.log(`  [${resolved.name}] Sincronizando player stats…`);
    let playerStats: SyncOutcome;
    try {
      playerStats = await this.syncPlayerStats(league.id);
      this.logger.log(
        `  [${resolved.name}] Player stats: ${'synced' in playerStats ? playerStats.synced : 'error'}`,
      );
    } catch (err) {
      playerStats = this.toSyncOutcome(err);
      this.logger.warn(
        `  [${resolved.name}] Player stats falló: ${(err as Error).message}`,
      );
    }

    // Lesiones y sanciones
    this.logger.log(`  [${resolved.name}] Sincronizando lesiones…`);
    let injuries: SyncOutcome;
    try {
      injuries = await this.syncInjuries(resolved.id, season);
      this.logger.log(
        `  [${resolved.name}] Lesiones: ${'synced' in injuries ? injuries.synced : 'error'}`,
      );
    } catch (err) {
      injuries = this.toSyncOutcome(err);
      this.logger.warn(
        `  [${resolved.name}] Lesiones falló: ${(err as Error).message}`,
      );
    }

    return {
      league: resolved.name,
      leagueId: resolved.id,
      season,
      fixtures,
      odds,
      matchStats,
      playerStats,
      injuries,
    };
  }

  /**
   * Sin `leagueId`: recorre todas las ligas de `TRACKED_LEAGUES` (secuencial,
   * no en paralelo, para no ráfaguear la API). `leagueId` sincroniza solo esa
   * liga puntual (ID de API-Football). `season` fuerza una temporada
   * específica y desactiva el backfill automático.
   */
  async syncAll(options?: {
    leagueId?: number;
    season?: number;
  }): Promise<SyncAllResult[]> {
    const queries: Array<{ id: number } | { name: string; country: string }> =
      options?.leagueId ? [{ id: options.leagueId }] : TRACKED_LEAGUES;

    const results: SyncAllResult[] = [];
    for (let qi = 0; qi < queries.length; qi += 1) {
      const query = queries[qi];
      this.logger.log(
        `[${qi + 1}/${queries.length}] Resolviendo liga ${
          'id' in query
            ? `id=${query.id}`
            : `"${query.name}" (${query.country})`
        }…`,
      );
      const resolved = await this.apiFootball.resolveLeague(query);
      if (!resolved) {
        const label =
          'id' in query
            ? `id=${query.id}`
            : `"${query.name}" (${query.country})`;
        this.logger.warn(
          `No se pudo resolver la liga ${label} en API-Football`,
        );
        results.push({
          league: label,
          leagueId: 'id' in query ? query.id : null,
          season: null,
          fixtures: { error: 'Liga no encontrada en API-Football' },
          odds: { error: 'Liga no encontrada en API-Football' },
          matchStats: { error: 'Liga no encontrada en API-Football' },
          playerStats: { error: 'Liga no encontrada en API-Football' },
          injuries: { error: 'Liga no encontrada en API-Football' },
        });
        continue;
      }
      this.logger.log(
        `[${qi + 1}/${queries.length}] Sincronizando ${resolved.name} (${resolved.id}) temporada ${options?.season ?? resolved.currentSeason}…`,
      );
      results.push(await this.syncResolvedLeague(resolved, options?.season));
    }
    return results;
  }
}
