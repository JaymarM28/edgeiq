import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Búsqueda de equipos por nombre (parcial, case-insensitive). */
  async search(query: string, limit = 20) {
    return this.prisma.team.findMany({
      where: { name: { contains: query, mode: 'insensitive' } },
      take: limit,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        shortName: true,
        country: true,
        externalId: true,
      },
    });
  }

  /** Detalle de un equipo: forma reciente (W/D/L, goles) + próximos partidos. */
  async getTeamDetail(teamId: string, recentLimit = 10) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        name: true,
        shortName: true,
        country: true,
        externalId: true,
      },
    });
    if (!team) return null;

    const finished = await this.prisma.match.findMany({
      where: {
        status: 'FINISHED',
        result: { isNot: null },
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      },
      orderBy: { kickoffAt: 'desc' },
      take: recentLimit,
      include: {
        homeTeam: { select: { id: true, name: true } },
        awayTeam: { select: { id: true, name: true } },
        league: { select: { id: true, name: true } },
        result: { select: { homeScore: true, awayScore: true } },
      },
    });

    const upcoming = await this.prisma.match.findMany({
      where: {
        status: 'SCHEDULED',
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      },
      orderBy: { kickoffAt: 'asc' },
      take: 10,
      include: {
        homeTeam: { select: { id: true, name: true } },
        awayTeam: { select: { id: true, name: true } },
        league: { select: { id: true, name: true } },
      },
    });

    let wins = 0;
    let draws = 0;
    let losses = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;

    const form = finished.map((m) => {
      const isHome = m.homeTeamId === teamId;
      const scored = isHome ? m.result!.homeScore : m.result!.awayScore;
      const conceded = isHome ? m.result!.awayScore : m.result!.homeScore;
      goalsFor += scored;
      goalsAgainst += conceded;

      let outcome: 'W' | 'D' | 'L';
      if (scored > conceded) {
        outcome = 'W';
        wins += 1;
      } else if (scored === conceded) {
        outcome = 'D';
        draws += 1;
      } else {
        outcome = 'L';
        losses += 1;
      }

      return {
        matchId: m.id,
        kickoffAt: m.kickoffAt,
        league: m.league.name,
        opponent: isHome ? m.awayTeam.name : m.homeTeam.name,
        isHome,
        scored,
        conceded,
        outcome,
      };
    });

    return {
      team,
      record: {
        matchesPlayed: finished.length,
        wins,
        draws,
        losses,
        goalsFor,
        goalsAgainst,
      },
      recentForm: form,
      upcomingMatches: upcoming.map((m) => ({
        id: m.id,
        kickoffAt: m.kickoffAt,
        league: m.league.name,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
      })),
    };
  }
}
