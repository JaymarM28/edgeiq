import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class PlayersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Búsqueda de jugadores por nombre (parcial, case-insensitive). */
  async search(query: string, leagueId?: string, limit = 50) {
    return this.prisma.player.findMany({
      where: {
        name: { contains: query, mode: 'insensitive' },
        ...(leagueId
          ? { team: { matchStatistics: { some: { match: { leagueId } } } } }
          : {}),
      },
      take: limit,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        externalId: true,
        team: { select: { id: true, name: true } },
        _count: { select: { matchStats: true } },
      },
    });
  }

  /** Stats detallados de un jugador: historial por partido + promedios. */
  async getPlayerStats(playerId: string) {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: {
        team: { select: { id: true, name: true } },
        matchStats: {
          orderBy: { match: { kickoffAt: 'desc' } },
          include: {
            match: {
              select: {
                id: true,
                kickoffAt: true,
                homeTeam: { select: { name: true } },
                awayTeam: { select: { name: true } },
                league: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (!player) return null;

    // Calcular promedios (solo partidos con >= 45 min)
    const qualifying = player.matchStats.filter((s) => s.minutes >= 45);
    const count = qualifying.length;

    const averages =
      count > 0
        ? {
            shotsOn: qualifying.reduce((s, m) => s + m.shotsOn, 0) / count,
            shotsTotal:
              qualifying.reduce((s, m) => s + m.shotsTotal, 0) / count,
            goals: qualifying.reduce((s, m) => s + m.goals, 0) / count,
            assists: qualifying.reduce((s, m) => s + m.assists, 0) / count,
            yellowCards:
              qualifying.reduce((s, m) => s + m.yellowCards, 0) / count,
            minutes: qualifying.reduce((s, m) => s + m.minutes, 0) / count,
            matchesPlayed: count,
          }
        : null;

    // Active injuries/suspensions
    const activeInjuries = await this.prisma.playerInjury.findMany({
      where: { playerId, status: 'active' },
      orderBy: { reportedAt: 'desc' },
      select: {
        id: true,
        type: true,
        reason: true,
        reportedAt: true,
      },
    });

    return {
      id: player.id,
      name: player.name,
      team: player.team,
      averages,
      injuries: activeInjuries,
      recentMatches: player.matchStats.slice(0, 20).map((s) => ({
        matchId: s.match.id,
        date: s.match.kickoffAt,
        opponent: `${s.match.homeTeam.name} vs ${s.match.awayTeam.name}`,
        league: s.match.league.name,
        minutes: s.minutes,
        shotsOn: s.shotsOn,
        shotsTotal: s.shotsTotal,
        goals: s.goals,
        assists: s.assists,
        yellowCards: s.yellowCards,
        redCards: s.redCards,
      })),
    };
  }

  /** Top jugadores por stat (para la vista general). */
  async topPlayers(
    stat: 'goals' | 'assists' | 'yellowCards' | 'shotsOn' = 'goals',
    limit = 20,
  ) {
    // Agregación: sumar el stat por jugador
    const stats = await this.prisma.playerMatchStat.groupBy({
      by: ['playerId'],
      _sum: { [stat]: true },
      _count: { _all: true },
      orderBy: { _sum: { [stat]: 'desc' } as Record<string, 'desc'> },
      take: limit,
    });

    const playerIds = stats.map((s) => s.playerId);
    const players = await this.prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { id: true, name: true, team: { select: { name: true } } },
    });

    const playerMap = new Map(players.map((p) => [p.id, p]));

    return stats.map((s) => ({
      player: playerMap.get(s.playerId) ?? {
        id: s.playerId,
        name: 'Unknown',
        team: null,
      },
      total: (s._sum as Record<string, number | null>)[stat] ?? 0,
      matches: s._count._all,
    }));
  }
}
