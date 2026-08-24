import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GroqService } from '../../core/integrations/groq/groq.service';

const SYSTEM_PROMPT = `Eres un analista deportivo de élite especializado en apuestas de fútbol con enfoque cuantitativo. Tu trabajo es explicar en español POR QUÉ una apuesta específica tiene valor, basándote ÚNICAMENTE en los datos estadísticos que te proporciono.

Reglas estrictas:
- Habla en español latino, tono directo y seguro como analista de datos.
- Máximo 4 oraciones. Cada oración debe contener un dato concreto (número, racha, tendencia).
- Nunca digas "apostar" ni "apuesta segura". Usa "valor", "ventaja", "oportunidad".
- NO inventes datos que no estén en el contexto. Si un dato no está, no lo menciones.
- NO uses emojis, bullet points ni frases genéricas como "el modelo detecta valor".
- Estructura: (1) dato más fuerte que apoya la predicción, (2) dato secundario de soporte, (3) por qué la casa subestima esto, (4) conclusión con el edge.
- Si hay bajas/lesiones relevantes, menciónalas como factor.`;

/** Forma reciente de un equipo: últimos N partidos. */
interface TeamForm {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsScored: number;
  goalsConceded: number;
  /** String compacto: "WDLWW" (más reciente primero) */
  streak: string;
}

/** Head-to-head entre dos equipos. */
interface H2HStats {
  totalMatches: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  avgGoals: number;
}

interface RichValueBetContext {
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoff: string;
  market: string;
  selection: string;
  modelName: string;
  modelProbability: number;
  impliedProbability: number;
  edge: number;
  // Datos ricos
  homeForm: TeamForm;
  awayForm: TeamForm;
  homeFormAtHome: TeamForm;
  awayFormAway: TeamForm;
  h2h: H2HStats;
  leagueHomeWinRate: number; // % de partidos ganados por local en esta liga
  homeGoalsPerGame: number; // Goles promedio del local como local
  awayGoalsPerGame: number; // Goles promedio del visitante como visitante
  homeConcededPerGame: number; // Goles recibidos promedio del local como local
  awayConcededPerGame: number; // Goles recibidos promedio del visitante como visitante
  homeInjuries: string[];
  awayInjuries: string[];
}

@Injectable()
export class ExplanationsService {
  private readonly logger = new Logger(ExplanationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly groq: GroqService,
  ) {}

  /**
   * Genera explicaciones para todas las value bets que no tienen una todavía.
   * Se llama después de generateForUpcoming().
   */
  async generateForPendingValueBets(
    onProgress?: (current: number, total: number) => void,
  ): Promise<number> {
    if (!this.groq.isConfigured) {
      this.logger.warn('Groq no configurado, se omiten explicaciones');
      return 0;
    }

    const MAX_EDGE = 2.0;
    const MIN_EDGE = 0.05;

    const predictions = await this.prisma.prediction.findMany({
      where: {
        edge: { gte: MIN_EDGE, lte: MAX_EDGE },
        explanation: null,
        match: { status: 'SCHEDULED' },
      },
      include: {
        match: {
          include: {
            homeTeam: true,
            awayTeam: true,
            league: true,
          },
        },
      },
      orderBy: { edge: 'desc' },
      take: 30,
    });

    if (predictions.length === 0) return 0;

    // Cargar lesiones activas
    const teamExtIds = new Set<string>();
    for (const p of predictions) {
      if (p.match.homeTeam.externalId)
        teamExtIds.add(p.match.homeTeam.externalId);
      if (p.match.awayTeam.externalId)
        teamExtIds.add(p.match.awayTeam.externalId);
    }

    const injuries = await this.prisma.playerInjury.findMany({
      where: { status: 'active', teamExternalId: { in: [...teamExtIds] } },
      include: { player: { select: { name: true } } },
    });

    const injuryByTeam = new Map<string, string[]>();
    for (const inj of injuries) {
      if (!inj.teamExternalId) continue;
      if (!injuryByTeam.has(inj.teamExternalId))
        injuryByTeam.set(inj.teamExternalId, []);
      injuryByTeam
        .get(inj.teamExternalId)!
        .push(`${inj.player.name} (${inj.reason})`);
    }

    let generated = 0;

    for (const pred of predictions) {
      try {
        const match = pred.match;

        // Recopilar datos ricos en paralelo
        const [
          homeForm,
          awayForm,
          homeFormAtHome,
          awayFormAway,
          h2h,
          leagueHomeWinRate,
        ] = await Promise.all([
          this.getTeamForm(match.homeTeamId, 5),
          this.getTeamForm(match.awayTeamId, 5),
          this.getTeamFormByRole(match.leagueId, match.homeTeamId, 'home', 5),
          this.getTeamFormByRole(match.leagueId, match.awayTeamId, 'away', 5),
          this.getH2H(match.homeTeamId, match.awayTeamId, 6),
          this.getLeagueHomeWinRate(match.leagueId),
        ]);

        const ctx: RichValueBetContext = {
          homeTeam: match.homeTeam.name,
          awayTeam: match.awayTeam.name,
          league: match.league.name,
          kickoff: new Date(match.kickoffAt).toLocaleDateString('es-ES', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }),
          market: pred.market,
          selection: pred.selection,
          modelName: pred.modelName,
          modelProbability: Number(pred.modelProbability),
          impliedProbability: Number(pred.impliedProbability ?? 0),
          edge: Number(pred.edge ?? 0),
          homeForm,
          awayForm,
          homeFormAtHome,
          awayFormAway,
          h2h,
          leagueHomeWinRate,
          homeGoalsPerGame:
            homeFormAtHome.played > 0
              ? homeFormAtHome.goalsScored / homeFormAtHome.played
              : 0,
          awayGoalsPerGame:
            awayFormAway.played > 0
              ? awayFormAway.goalsScored / awayFormAway.played
              : 0,
          homeConcededPerGame:
            homeFormAtHome.played > 0
              ? homeFormAtHome.goalsConceded / homeFormAtHome.played
              : 0,
          awayConcededPerGame:
            awayFormAway.played > 0
              ? awayFormAway.goalsConceded / awayFormAway.played
              : 0,
          homeInjuries: injuryByTeam.get(match.homeTeam.externalId ?? '') ?? [],
          awayInjuries: injuryByTeam.get(match.awayTeam.externalId ?? '') ?? [],
        };

        const explanation = await this.generateExplanation(ctx);
        if (explanation) {
          await this.prisma.prediction.update({
            where: { id: pred.id },
            data: { explanation },
          });
          generated += 1;
        }

        onProgress?.(generated, predictions.length);
        await new Promise((r) => setTimeout(r, 100));
      } catch (err) {
        this.logger.warn(
          `Error generando explicación para prediction ${pred.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    this.logger.log(
      `Explicaciones generadas: ${generated}/${predictions.length}`,
    );
    return generated;
  }

  // ─── Data gathering ────────────────────────────────────────────────

  /** Forma general del equipo (últimos N partidos, cualquier liga/rol). */
  private async getTeamForm(teamId: string, lastN: number): Promise<TeamForm> {
    const matches = await this.prisma.match.findMany({
      where: {
        status: 'FINISHED',
        result: { isNot: null },
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      },
      include: { result: true },
      orderBy: { kickoffAt: 'desc' },
      take: lastN,
    });

    return this.computeForm(matches, teamId);
  }

  /** Forma del equipo en un rol específico (local/visitante) dentro de una liga. */
  private async getTeamFormByRole(
    leagueId: string,
    teamId: string,
    role: 'home' | 'away',
    lastN: number,
  ): Promise<TeamForm> {
    const where =
      role === 'home'
        ? {
            leagueId,
            homeTeamId: teamId,
            status: 'FINISHED' as const,
            result: { isNot: null },
          }
        : {
            leagueId,
            awayTeamId: teamId,
            status: 'FINISHED' as const,
            result: { isNot: null },
          };

    const matches = await this.prisma.match.findMany({
      where,
      include: { result: true },
      orderBy: { kickoffAt: 'desc' },
      take: lastN,
    });

    return this.computeForm(matches, teamId);
  }

  private computeForm(
    matches: Array<{
      homeTeamId: string;
      awayTeamId: string;
      result: { homeScore: number; awayScore: number } | null;
    }>,
    teamId: string,
  ): TeamForm {
    let wins = 0,
      draws = 0,
      losses = 0,
      goalsScored = 0,
      goalsConceded = 0;
    const streakLetters: string[] = [];

    for (const m of matches) {
      if (!m.result) continue;
      const isHome = m.homeTeamId === teamId;
      const scored = isHome ? m.result.homeScore : m.result.awayScore;
      const conceded = isHome ? m.result.awayScore : m.result.homeScore;
      goalsScored += scored;
      goalsConceded += conceded;

      if (scored > conceded) {
        wins++;
        streakLetters.push('W');
      } else if (scored === conceded) {
        draws++;
        streakLetters.push('D');
      } else {
        losses++;
        streakLetters.push('L');
      }
    }

    return {
      played: matches.length,
      wins,
      draws,
      losses,
      goalsScored,
      goalsConceded,
      streak: streakLetters.join(''),
    };
  }

  /** Historial de enfrentamientos directos. */
  private async getH2H(
    teamAId: string,
    teamBId: string,
    lastN: number,
  ): Promise<H2HStats> {
    const matches = await this.prisma.match.findMany({
      where: {
        status: 'FINISHED',
        result: { isNot: null },
        OR: [
          { homeTeamId: teamAId, awayTeamId: teamBId },
          { homeTeamId: teamBId, awayTeamId: teamAId },
        ],
      },
      include: { result: true },
      orderBy: { kickoffAt: 'desc' },
      take: lastN,
    });

    let homeWins = 0,
      draws = 0,
      awayWins = 0,
      totalGoals = 0;
    for (const m of matches) {
      if (!m.result) continue;
      totalGoals += m.result.homeScore + m.result.awayScore;
      if (m.result.homeScore > m.result.awayScore) homeWins++;
      else if (m.result.homeScore === m.result.awayScore) draws++;
      else awayWins++;
    }

    return {
      totalMatches: matches.length,
      homeWins,
      draws,
      awayWins,
      avgGoals: matches.length > 0 ? totalGoals / matches.length : 0,
    };
  }

  /** % de partidos ganados por el local en esta liga (ventaja de local real). */
  private async getLeagueHomeWinRate(leagueId: string): Promise<number> {
    const matches = await this.prisma.match.findMany({
      where: { leagueId, status: 'FINISHED', result: { isNot: null } },
      include: { result: true },
    });

    if (matches.length === 0) return 0.45; // fallback
    const homeWins = matches.filter(
      (m) => m.result && m.result.homeScore > m.result.awayScore,
    ).length;
    return homeWins / matches.length;
  }

  // ─── LLM prompt ────────────────────────────────────────────────────

  private async generateExplanation(ctx: RichValueBetContext): Promise<string> {
    let selectionText = ctx.selection;
    if (ctx.market === '1X2') {
      selectionText =
        ctx.selection === 'Home'
          ? `victoria de ${ctx.homeTeam}`
          : ctx.selection === 'Away'
            ? `victoria de ${ctx.awayTeam}`
            : 'empate';
    } else if (ctx.selection === 'Over') {
      selectionText = `más de ${ctx.market.replace(/.*O\/U\s*/, '')} en ${ctx.market.split(' O/U')[0]}`;
    } else if (ctx.selection === 'Under') {
      selectionText = `menos de ${ctx.market.replace(/.*O\/U\s*/, '')} en ${ctx.market.split(' O/U')[0]}`;
    }

    // Construir contexto rico
    const lines: string[] = [
      `Partido: ${ctx.homeTeam} vs ${ctx.awayTeam}`,
      `Liga: ${ctx.league} | Fecha: ${ctx.kickoff}`,
      `Predicción: ${selectionText}`,
      `Modelo: ${ctx.modelName} → ${(ctx.modelProbability * 100).toFixed(1)}% | Casa: ${(ctx.impliedProbability * 100).toFixed(1)}% | Edge: +${(ctx.edge * 100).toFixed(1)}%`,
      '',
      '── FORMA RECIENTE (últimos 5 partidos, general) ──',
      `${ctx.homeTeam}: ${ctx.homeForm.streak || 'Sin datos'} (${ctx.homeForm.wins}W-${ctx.homeForm.draws}D-${ctx.homeForm.losses}L, ${ctx.homeForm.goalsScored} GF - ${ctx.homeForm.goalsConceded} GC)`,
      `${ctx.awayTeam}: ${ctx.awayForm.streak || 'Sin datos'} (${ctx.awayForm.wins}W-${ctx.awayForm.draws}D-${ctx.awayForm.losses}L, ${ctx.awayForm.goalsScored} GF - ${ctx.awayForm.goalsConceded} GC)`,
    ];

    if (ctx.homeFormAtHome.played > 0) {
      lines.push('', '── RENDIMIENTO COMO LOCAL/VISITANTE ──');
      lines.push(
        `${ctx.homeTeam} como LOCAL: ${ctx.homeFormAtHome.wins}W-${ctx.homeFormAtHome.draws}D-${ctx.homeFormAtHome.losses}L, promedio ${ctx.homeGoalsPerGame.toFixed(1)} goles/partido, recibe ${ctx.homeConcededPerGame.toFixed(1)}/partido`,
      );
      lines.push(
        `${ctx.awayTeam} como VISITANTE: ${ctx.awayFormAway.wins}W-${ctx.awayFormAway.draws}D-${ctx.awayFormAway.losses}L, promedio ${ctx.awayGoalsPerGame.toFixed(1)} goles/partido, recibe ${ctx.awayConcededPerGame.toFixed(1)}/partido`,
      );
    }

    lines.push('', `── VENTAJA DE LOCAL EN ESTA LIGA ──`);
    lines.push(
      `El local gana el ${(ctx.leagueHomeWinRate * 100).toFixed(0)}% de los partidos en ${ctx.league}`,
    );

    if (ctx.h2h.totalMatches > 0) {
      lines.push('', '── HISTORIAL DIRECTO (H2H) ──');
      lines.push(
        `${ctx.h2h.totalMatches} partidos: ${ctx.h2h.homeWins} victorias local, ${ctx.h2h.draws} empates, ${ctx.h2h.awayWins} victorias visitante`,
      );
      lines.push(
        `Promedio de goles: ${ctx.h2h.avgGoals.toFixed(1)} por partido`,
      );
    }

    if (ctx.homeInjuries.length > 0 || ctx.awayInjuries.length > 0) {
      lines.push('', '── BAJAS ──');
      if (ctx.homeInjuries.length > 0)
        lines.push(`${ctx.homeTeam}: ${ctx.homeInjuries.join(', ')}`);
      if (ctx.awayInjuries.length > 0)
        lines.push(`${ctx.awayTeam}: ${ctx.awayInjuries.join(', ')}`);
    }

    lines.push(
      '',
      'Con estos datos, explica POR QUÉ tiene valor esta predicción. Sé específico con los números.',
    );

    return this.groq.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: lines.join('\n') },
      ],
      { temperature: 0.3, maxTokens: 300 },
    );
  }
}
