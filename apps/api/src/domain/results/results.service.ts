import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class ResultsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Historial de resultados de un equipo (partidos terminados, más recientes primero). */
  async getTeamResults(teamId: string, limit = 20) {
    return this.prisma.match.findMany({
      where: {
        status: 'FINISHED',
        result: { isNot: null },
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      },
      orderBy: { kickoffAt: 'desc' },
      take: limit,
      include: {
        homeTeam: { select: { id: true, name: true } },
        awayTeam: { select: { id: true, name: true } },
        league: { select: { id: true, name: true } },
        result: {
          select: { homeScore: true, awayScore: true, settledAt: true },
        },
      },
    });
  }

  /** Historial cara a cara entre dos equipos (en cualquier orden local/visitante). */
  async getHeadToHead(teamAId: string, teamBId: string, limit = 10) {
    return this.prisma.match.findMany({
      where: {
        status: 'FINISHED',
        result: { isNot: null },
        OR: [
          { homeTeamId: teamAId, awayTeamId: teamBId },
          { homeTeamId: teamBId, awayTeamId: teamAId },
        ],
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
}
