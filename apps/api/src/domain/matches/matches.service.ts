import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class MatchesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Partidos programados con predicciones y odds asociadas.
   * Opcionalmente filtrados por liga.
   */
  async findUpcoming(leagueId?: string) {
    const matches = await this.prisma.match.findMany({
      where: {
        status: 'SCHEDULED',
        ...(leagueId ? { leagueId } : {}),
      },
      orderBy: { kickoffAt: 'asc' },
      include: {
        homeTeam: { select: { id: true, name: true, externalId: true } },
        awayTeam: { select: { id: true, name: true, externalId: true } },
        league: { select: { id: true, name: true, country: true } },
        predictions: {
          select: {
            market: true,
            selection: true,
            modelName: true,
            modelProbability: true,
            impliedProbability: true,
            edge: true,
            explanation: true,
          },
        },
        odds: {
          select: {
            bookmaker: true,
            market: true,
            selection: true,
            price: true,
            fetchedAt: true,
          },
          orderBy: { fetchedAt: 'desc' },
        },
      },
    });

    // Fetch active injuries for teams in upcoming matches
    const teamExternalIds = new Set<string>();
    for (const m of matches) {
      if (m.homeTeam.externalId) teamExternalIds.add(m.homeTeam.externalId);
      if (m.awayTeam.externalId) teamExternalIds.add(m.awayTeam.externalId);
    }

    const injuries =
      teamExternalIds.size > 0
        ? await this.prisma.playerInjury.findMany({
            where: {
              status: 'active',
              teamExternalId: { in: [...teamExternalIds] },
            },
            select: {
              teamExternalId: true,
              type: true,
              reason: true,
              player: { select: { id: true, name: true } },
            },
          })
        : [];

    // Group injuries by team external ID
    const injuryMap = new Map<string, typeof injuries>();
    for (const inj of injuries) {
      if (!inj.teamExternalId) continue;
      if (!injuryMap.has(inj.teamExternalId))
        injuryMap.set(inj.teamExternalId, []);
      injuryMap.get(inj.teamExternalId)!.push(inj);
    }

    return matches.map((m) => ({
      id: m.id,
      kickoffAt: m.kickoffAt,
      season: m.season,
      matchday: m.matchday,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      league: m.league,
      predictions: m.predictions,
      odds: this.dedupeOdds(m.odds),
      injuries: {
        home:
          (m.homeTeam.externalId
            ? injuryMap.get(m.homeTeam.externalId)
            : []
          )?.map((i) => ({
            player: i.player,
            type: i.type,
            reason: i.reason,
          })) ?? [],
        away:
          (m.awayTeam.externalId
            ? injuryMap.get(m.awayTeam.externalId)
            : []
          )?.map((i) => ({
            player: i.player,
            type: i.type,
            reason: i.reason,
          })) ?? [],
      },
    }));
  }

  /** Partidos terminados con resultados (para historial). */
  async findRecent(leagueId?: string, limit = 20) {
    return this.prisma.match.findMany({
      where: {
        status: 'FINISHED',
        ...(leagueId ? { leagueId } : {}),
      },
      orderBy: { kickoffAt: 'desc' },
      take: limit,
      include: {
        homeTeam: { select: { id: true, name: true } },
        awayTeam: { select: { id: true, name: true } },
        league: { select: { id: true, name: true } },
        result: { select: { homeScore: true, awayScore: true } },
      },
    });
  }

  private dedupeOdds(
    odds: Array<{
      bookmaker: string;
      market: string;
      selection: string;
      price: unknown;
      fetchedAt: Date;
    }>,
  ) {
    const seen = new Set<string>();
    const deduped: typeof odds = [];
    for (const o of odds) {
      const key = `${o.bookmaker}|${o.market}|${o.selection}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(o);
    }
    return deduped;
  }
}
