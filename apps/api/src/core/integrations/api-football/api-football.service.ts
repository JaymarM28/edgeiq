import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type {
  ApiFootballEnvelope,
  ApiFootballFixture,
  ApiFootballFixturePlayers,
  ApiFootballFixtureStatistics,
  ApiFootballInjury,
  ApiFootballLeagueWithSeasons,
  ApiFootballOddsEntry,
} from './api-football.types';

export interface ResolvedLeague {
  id: number;
  name: string;
  country: string | null;
  /** Año de la temporada que la propia API marca como `current: true` para esta liga. */
  currentSeason: number;
}

/**
 * Cliente tipado y mínimo de API-Football v3. Solo expone los endpoints que
 * usa el módulo de ingesta (docs/DECISIONS.md → "Proveedor de datos").
 */
@Injectable()
export class ApiFootballService {
  private readonly logger = new Logger(ApiFootballService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Resuelve una liga (por `id` o por `name`+`country`) junto con su
   * temporada actual — todo calculado por la propia API (`current=true`),
   * no por lógica de fechas nuestra. Ver docs/DECISIONS.md ("soporte
   * multi-liga sin años ni IDs quemados").
   */
  async resolveLeague(
    query: { id: number } | { name: string; country: string },
  ): Promise<ResolvedLeague | null> {
    const { data } = await firstValueFrom(
      this.http.get<ApiFootballEnvelope<ApiFootballLeagueWithSeasons>>(
        '/leagues',
        {
          params: { ...query, current: true },
        },
      ),
    );

    const entry = data.response[0];
    if (!entry) return null;

    const season = entry.seasons.find((s) => s.current) ?? entry.seasons[0];
    if (!season) {
      this.logger.warn(
        `"${entry.league.name}" no tiene temporada marcada como actual`,
      );
      return null;
    }

    return {
      id: entry.league.id,
      name: entry.league.name,
      country: entry.country.name,
      currentSeason: season.year,
    };
  }

  async getFixtures(
    leagueId: number,
    season: number,
  ): Promise<ApiFootballFixture[]> {
    const { data } = await firstValueFrom(
      this.http.get<ApiFootballEnvelope<ApiFootballFixture>>('/fixtures', {
        params: { league: leagueId, season },
      }),
    );
    return data.response;
  }

  /** Estadísticas de equipo de un partido (corners, tiros, tarjetas…). */
  async getFixtureStatistics(
    fixtureId: number,
  ): Promise<ApiFootballFixtureStatistics[]> {
    const { data } = await firstValueFrom(
      this.http.get<ApiFootballEnvelope<ApiFootballFixtureStatistics>>(
        '/fixtures/statistics',
        { params: { fixture: fixtureId } },
      ),
    );
    return data.response;
  }

  /** Estadísticas de jugadores de un partido (tiros, goles, tarjetas…). */
  async getFixturePlayers(
    fixtureId: number,
  ): Promise<ApiFootballFixturePlayers[]> {
    const { data } = await firstValueFrom(
      this.http.get<ApiFootballEnvelope<ApiFootballFixturePlayers>>(
        '/fixtures/players',
        { params: { fixture: fixtureId } },
      ),
    );
    return data.response;
  }

  /** Lesiones y sanciones de una liga + temporada. */
  async getInjuries(
    leagueId: number,
    season: number,
  ): Promise<ApiFootballInjury[]> {
    const { data } = await firstValueFrom(
      this.http.get<ApiFootballEnvelope<ApiFootballInjury>>('/injuries', {
        params: { league: leagueId, season },
      }),
    );
    return data.response;
  }

  /** Lesiones de un fixture específico. */
  async getInjuriesByFixture(fixtureId: number): Promise<ApiFootballInjury[]> {
    const { data } = await firstValueFrom(
      this.http.get<ApiFootballEnvelope<ApiFootballInjury>>('/injuries', {
        params: { fixture: fixtureId },
      }),
    );
    return data.response;
  }

  /** Odds del mercado 1X2 para todos los partidos de una liga en una fecha (YYYY-MM-DD). */
  async getOddsByDate(
    leagueId: number,
    season: number,
    date: string,
  ): Promise<ApiFootballOddsEntry[]> {
    const { data } = await firstValueFrom(
      this.http.get<ApiFootballEnvelope<ApiFootballOddsEntry>>('/odds', {
        params: { league: leagueId, season, date },
      }),
    );
    return data.response;
  }
}
