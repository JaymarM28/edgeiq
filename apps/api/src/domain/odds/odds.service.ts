import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class OddsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Todas las cuotas registradas para un partido (opcionalmente filtradas por mercado). */
  async getMatchOdds(matchId: string, market?: string) {
    return this.prisma.odds.findMany({
      where: { matchId, ...(market ? { market } : {}) },
      orderBy: [{ bookmaker: 'asc' }, { market: 'asc' }, { fetchedAt: 'desc' }],
    });
  }

  /**
   * Serie temporal de una selección específica (para graficar el movimiento
   * de línea): todas las lecturas ordenadas cronológicamente.
   */
  async getLineMovement(matchId: string, market: string, selection: string) {
    return this.prisma.odds.findMany({
      where: { matchId, market, selection },
      orderBy: [{ bookmaker: 'asc' }, { fetchedAt: 'asc' }],
      select: { bookmaker: true, price: true, fetchedAt: true },
    });
  }
}
