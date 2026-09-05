import { Injectable } from '@nestjs/common';
import { buildPropSuggestions } from '@edgeiq/shared';
import { PrismaService } from '../../core/prisma/prisma.service';
import { PlayersService } from '../players/players.service';

/** Mínimo de partidos con 45+ min para que una sugerencia de prop sea confiable. */
const MIN_PLAYER_SAMPLE = 5;
/** Ventana de partidos próximos que considera el digest. */
const UPCOMING_WINDOW_DAYS = 5;
const PREFERRED_MODELS = ['ensemble_v1', 'elo_v1'];
/** Tope de jugadores candidatos por corrida — evita N+1 descontrolado en jornadas grandes. */
const MAX_CANDIDATE_PLAYERS = 150;

export interface MatchHighlight {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffAt: Date;
  recommendation: string;
  probability: number;
}

export interface PropHighlight {
  playerName: string;
  teamName: string | null;
  label: string;
  probability: number;
  description: string;
}

export interface DailyDigest {
  matches: MatchHighlight[];
  props: PropHighlight[];
}

@Injectable()
export class DigestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly playersService: PlayersService,
  ) {}

  async build(matchLimit = 8, propLimit = 8): Promise<DailyDigest> {
    const [matches, props] = await Promise.all([
      this.getMatchHighlights(matchLimit),
      this.getPlayerPropHighlights(propLimit),
    ]);
    return { matches, props };
  }

  private windowEnd(): Date {
    const end = new Date();
    end.setDate(end.getDate() + UPCOMING_WINDOW_DAYS);
    return end;
  }

  /** Rango [ahora, ahora+N días) — evita incluir partidos ya arrancados
   * que todavía no se marcaron LIVE/FINISHED (ese sync corre aparte). */
  private upcomingWindow() {
    return { gte: new Date(), lte: this.windowEnd() };
  }

  private recommendationLabel(
    selection: string,
    homeTeam: string,
    awayTeam: string,
  ): string {
    if (selection === 'Home') return `Gana ${homeTeam}`;
    if (selection === 'Away') return `Gana ${awayTeam}`;
    if (selection === 'Draw') return 'Empate';
    return selection;
  }

  private async getMatchHighlights(limit: number): Promise<MatchHighlight[]> {
    const matches = await this.prisma.match.findMany({
      where: {
        status: 'SCHEDULED',
        kickoffAt: this.upcomingWindow(),
        predictions: { some: { market: '1X2' } },
      },
      orderBy: { kickoffAt: 'asc' },
      include: {
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
        league: { select: { name: true } },
        predictions: { where: { market: '1X2' } },
      },
    });

    const highlights: MatchHighlight[] = [];
    for (const m of matches) {
      const modelName = PREFERRED_MODELS.find((name) =>
        m.predictions.some((p) => p.modelName === name),
      );
      if (!modelName) continue;

      const modelPreds = m.predictions.filter((p) => p.modelName === modelName);
      const best = modelPreds.reduce((a, b) =>
        Number(b.modelProbability) > Number(a.modelProbability) ? b : a,
      );

      highlights.push({
        matchId: m.id,
        homeTeam: m.homeTeam.name,
        awayTeam: m.awayTeam.name,
        league: m.league.name,
        kickoffAt: m.kickoffAt,
        recommendation: this.recommendationLabel(
          best.selection,
          m.homeTeam.name,
          m.awayTeam.name,
        ),
        probability: Number(best.modelProbability),
      });
    }

    return highlights
      .sort((a, b) => b.probability - a.probability)
      .slice(0, limit);
  }

  private async getPlayerPropHighlights(
    limit: number,
  ): Promise<PropHighlight[]> {
    const upcoming = await this.prisma.match.findMany({
      where: { status: 'SCHEDULED', kickoffAt: this.upcomingWindow() },
      select: { homeTeamId: true, awayTeamId: true },
    });
    const teamIds = [
      ...new Set(upcoming.flatMap((m) => [m.homeTeamId, m.awayTeamId])),
    ];
    if (teamIds.length === 0) return [];

    const players = await this.prisma.player.findMany({
      where: { teamId: { in: teamIds }, matchStats: { some: {} } },
      select: { id: true },
      take: MAX_CANDIDATE_PLAYERS,
    });

    const details = await Promise.all(
      players.map((p) => this.playersService.getPlayerStats(p.id)),
    );

    const highlights: PropHighlight[] = [];
    for (const detail of details) {
      if (
        !detail?.averages ||
        detail.averages.matchesPlayed < MIN_PLAYER_SAMPLE
      )
        continue;

      for (const suggestion of buildPropSuggestions(detail.averages)) {
        highlights.push({
          playerName: detail.name,
          teamName: detail.team?.name ?? null,
          label: suggestion.label,
          probability: suggestion.probability,
          description: suggestion.description,
        });
      }
    }

    return highlights
      .sort((a, b) => b.probability - a.probability)
      .slice(0, limit);
  }
}
