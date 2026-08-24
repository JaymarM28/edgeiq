import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GroqService } from '../../core/integrations/groq/groq.service';
import type { BacktestReport } from '../backtesting/backtesting.service';

// ── System prompts ────────────────────────────────────────────────────

const PRE_MATCH_SYSTEM = `Eres un analista deportivo experto en fútbol. Tu trabajo es analizar datos estadísticos reales y dar un análisis pre-partido completo en español.

Estructura tu análisis así:
1. **Contexto**: situación de ambos equipos (forma reciente, posición, momento)
2. **Datos clave**: estadísticas que más influyen (goles promedio, rendimiento local/visitante, lesiones importantes)
3. **Factores decisivos**: qué puede inclinar la balanza
4. **Predicción**: tu pronóstico claro con nivel de confianza (alta/media/baja) y por qué

Reglas:
- Español latino, tono profesional pero accesible.
- Basa TODO en los datos proporcionados, no inventes estadísticas.
- Si faltan datos, dilo explícitamente.
- Máximo 250 palabras.
- Usa negritas para resaltar datos clave.`;

const POST_MATCH_SYSTEM = `Eres un analista deportivo que evalúa predicciones. Recibirás lo que se predijo antes del partido y el resultado real.

Estructura tu análisis así:
1. **Resultado vs Predicción**: qué dijimos y qué pasó
2. **Aciertos**: qué predicciones acertaron y por qué el modelo las capturó bien
3. **Fallos**: qué predicciones fallaron y posibles razones (estadísticas del partido, eventos inesperados)
4. **Lección**: qué se puede aprender para mejorar el modelo

Reglas:
- Español latino, autocrítico y constructivo.
- No justifiques fallos — analízalos fríamente.
- Máximo 200 palabras.`;

const BACKTEST_SYSTEM = `Eres un data scientist experto en modelos predictivos de fútbol. Recibirás un reporte de backtesting con métricas por modelo.

Tu análisis debe cubrir:
1. **Resumen ejecutivo**: ¿los modelos son rentables? ¿Cuál es mejor?
2. **Calibración**: ¿las probabilidades predichas se alinean con la realidad?
3. **Por liga**: ¿en qué ligas rinden mejor/peor? ¿Por qué podría ser?
4. **ROI**: ¿la estrategia de value bets es rentable? ¿Qué umbral de edge es óptimo?
5. **Recomendaciones**: acciones concretas para mejorar (ajustar umbrales, combinar modelos, descartar ligas)

Reglas:
- Español latino, técnico pero claro.
- Sé directo: si un modelo es malo, dilo.
- Máximo 350 palabras.`;

// ── Interfaces ────────────────────────────────────────────────────────

interface TeamForm {
  team: string;
  results: Array<{
    opponent: string;
    goalsFor: number;
    goalsAgainst: number;
    home: boolean;
  }>;
  avgGoalsScored: number;
  avgGoalsConceded: number;
  wins: number;
  draws: number;
  losses: number;
}

interface PreMatchContext {
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoff: string;
  homeForm: TeamForm;
  awayForm: TeamForm;
  homeInjuries: string[];
  awayInjuries: string[];
  homeStats: {
    corners: number;
    shotsOnTarget: number;
    yellowCards: number;
    matches: number;
  } | null;
  awayStats: {
    corners: number;
    shotsOnTarget: number;
    yellowCards: number;
    matches: number;
  } | null;
  predictions: Array<{
    model: string;
    selection: string;
    probability: number;
    edge: number | null;
  }>;
}

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly groq: GroqService,
  ) {}

  // ── Pre-partido ─────────────────────────────────────────────────────

  async analyzePreMatch(matchId: string): Promise<string> {
    if (!this.groq.isConfigured) {
      throw new Error('GROQ_API_KEY no configurada');
    }

    // Check if already exists
    const existing = await this.prisma.matchAnalysis.findUnique({
      where: { matchId_type: { matchId, type: 'pre_match' } },
    });
    if (existing) return existing.content;

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        homeTeam: true,
        awayTeam: true,
        league: true,
        predictions: {
          where: { market: '1X2' },
          select: {
            modelName: true,
            selection: true,
            modelProbability: true,
            edge: true,
          },
        },
      },
    });
    if (!match) throw new NotFoundException('Partido no encontrado');

    // Gather context data
    const [
      homeForm,
      awayForm,
      homeStats,
      awayStats,
      homeInjuries,
      awayInjuries,
    ] = await Promise.all([
      this.getTeamForm(match.leagueId, match.homeTeamId, 5),
      this.getTeamForm(match.leagueId, match.awayTeamId, 5),
      this.getTeamAggregateStats(match.leagueId, match.homeTeamId),
      this.getTeamAggregateStats(match.leagueId, match.awayTeamId),
      this.getTeamInjuries(match.homeTeam.externalId),
      this.getTeamInjuries(match.awayTeam.externalId),
    ]);

    const ctx: PreMatchContext = {
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      league: match.league.name,
      kickoff: new Date(match.kickoffAt).toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
      homeForm: { ...homeForm, team: match.homeTeam.name },
      awayForm: { ...awayForm, team: match.awayTeam.name },
      homeInjuries,
      awayInjuries,
      homeStats,
      awayStats,
      predictions: match.predictions.map((p) => ({
        model: p.modelName,
        selection: p.selection,
        probability: Number(p.modelProbability),
        edge: p.edge ? Number(p.edge) : null,
      })),
    };

    const prompt = this.buildPreMatchPrompt(ctx);
    const content = await this.groq.chat(
      [
        { role: 'system', content: PRE_MATCH_SYSTEM },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.5, maxTokens: 600 },
    );

    // Store
    await this.prisma.matchAnalysis.upsert({
      where: { matchId_type: { matchId, type: 'pre_match' } },
      create: {
        matchId,
        type: 'pre_match',
        content,
        metadata: ctx as unknown as Prisma.InputJsonValue,
      },
      update: { content, metadata: ctx as unknown as Prisma.InputJsonValue },
    });

    return content;
  }

  // ── Post-partido ────────────────────────────────────────────────────

  async analyzePostMatch(matchId: string): Promise<string> {
    if (!this.groq.isConfigured) {
      throw new Error('GROQ_API_KEY no configurada');
    }

    const existing = await this.prisma.matchAnalysis.findUnique({
      where: { matchId_type: { matchId, type: 'post_match' } },
    });
    if (existing) return existing.content;

    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      include: {
        homeTeam: true,
        awayTeam: true,
        league: true,
        result: true,
        predictions: {
          select: {
            market: true,
            selection: true,
            modelName: true,
            modelProbability: true,
            edge: true,
            explanation: true,
          },
        },
        matchStatistics: {
          select: {
            teamId: true,
            corners: true,
            shotsOnTarget: true,
            shotsTotal: true,
            yellowCards: true,
            redCards: true,
            fouls: true,
          },
        },
      },
    });

    if (!match) throw new NotFoundException('Partido no encontrado');
    if (!match.result)
      throw new NotFoundException('Este partido aún no tiene resultado');

    const actual =
      match.result.homeScore > match.result.awayScore
        ? 'Home'
        : match.result.homeScore < match.result.awayScore
          ? 'Away'
          : 'Draw';

    const homeMatchStats = match.matchStatistics.find(
      (s) => s.teamId === match.homeTeamId,
    );
    const awayMatchStats = match.matchStatistics.find(
      (s) => s.teamId === match.awayTeamId,
    );

    const prompt = `Partido: ${match.homeTeam.name} vs ${match.awayTeam.name}
Liga: ${match.league.name}
Resultado: ${match.result.homeScore} - ${match.result.awayScore} (${actual === 'Home' ? 'Ganó local' : actual === 'Away' ? 'Ganó visitante' : 'Empate'})

Predicciones que hicimos:
${match.predictions
  .filter((p) => p.market === '1X2')
  .map(
    (p) =>
      `- ${p.modelName}: ${p.selection} (${(Number(p.modelProbability) * 100).toFixed(1)}%)${p.edge ? `, edge ${(Number(p.edge) * 100).toFixed(1)}%` : ''}`,
  )
  .join('\n')}

${
  match.predictions.filter(
    (p) => p.market !== '1X2' && p.edge && Number(p.edge) > 0.05,
  ).length > 0
    ? `Value bets adicionales:
${match.predictions
  .filter((p) => p.market !== '1X2' && p.edge && Number(p.edge) > 0.05)
  .map(
    (p) =>
      `- ${p.market}: ${p.selection} (${(Number(p.modelProbability) * 100).toFixed(1)}%, edge ${(Number(p.edge!) * 100).toFixed(1)}%)`,
  )
  .join('\n')}`
    : ''
}

Stats del partido:
${homeMatchStats ? `${match.homeTeam.name}: ${homeMatchStats.shotsTotal} tiros (${homeMatchStats.shotsOnTarget} a puerta), ${homeMatchStats.corners} córners, ${homeMatchStats.yellowCards} amarillas${homeMatchStats.redCards > 0 ? `, ${homeMatchStats.redCards} rojas` : ''}` : 'Sin stats disponibles para local'}
${awayMatchStats ? `${match.awayTeam.name}: ${awayMatchStats.shotsTotal} tiros (${awayMatchStats.shotsOnTarget} a puerta), ${awayMatchStats.corners} córners, ${awayMatchStats.yellowCards} amarillas${awayMatchStats.redCards > 0 ? `, ${awayMatchStats.redCards} rojas` : ''}` : 'Sin stats disponibles para visitante'}

Evalúa nuestras predicciones contra el resultado real.`;

    const content = await this.groq.chat(
      [
        { role: 'system', content: POST_MATCH_SYSTEM },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.4, maxTokens: 500 },
    );

    await this.prisma.matchAnalysis.upsert({
      where: { matchId_type: { matchId, type: 'post_match' } },
      create: { matchId, type: 'post_match', content },
      update: { content },
    });

    return content;
  }

  /**
   * Genera análisis post-partido para todos los partidos FINISHED
   * que tienen predicciones pero no tienen análisis post-partido todavía.
   */
  async generatePendingPostMatchAnalyses(): Promise<number> {
    if (!this.groq.isConfigured) return 0;

    const matches = await this.prisma.match.findMany({
      where: {
        status: 'FINISHED',
        result: { isNot: null },
        predictions: { some: {} },
        analyses: { none: { type: 'post_match' } },
      },
      select: { id: true },
      take: 10,
    });

    let generated = 0;
    for (const m of matches) {
      try {
        await this.analyzePostMatch(m.id);
        generated += 1;
        await new Promise((r) => setTimeout(r, 200));
      } catch (err) {
        this.logger.warn(
          `Post-match analysis failed for ${m.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    this.logger.log(
      `Post-match analyses generated: ${generated}/${matches.length}`,
    );
    return generated;
  }

  // ── Meta-análisis backtesting ───────────────────────────────────────

  async analyzeBacktest(report: BacktestReport): Promise<string> {
    if (!this.groq.isConfigured) {
      throw new Error('GROQ_API_KEY no configurada');
    }

    const prompt = `Reporte de Backtesting — ${report.totalMatchesEvaluated} partidos evaluados

${report.models
  .map(
    (m) => `## Modelo: ${m.model}
- Accuracy: ${(m.accuracy * 100).toFixed(1)}% (${m.correctPredictions} aciertos)
- Brier Score: ${m.brierScore.toFixed(3)} (menor = mejor, 0 = perfecto)
- Value Bets ROI: ${(m.valueBetROI.roi * 100).toFixed(1)}% (${m.valueBetROI.totalBets} apuestas, win rate ${(m.valueBetROI.winRate * 100).toFixed(1)}%)
- Retorno: $${m.valueBetROI.totalReturn.toFixed(0)} sobre $${m.valueBetROI.totalStaked} apostados

Calibración:
${m.calibration
  .filter((b) => b.count > 0)
  .map(
    (b) =>
      `  ${b.range}: predicho ${(b.predicted * 100).toFixed(1)}%, real ${(b.actual * 100).toFixed(1)}%, n=${b.count}`,
  )
  .join('\n')}

Por liga:
${m.byLeague.map((l) => `  ${l.league}: accuracy ${(l.accuracy * 100).toFixed(1)}%, Brier ${l.brierScore.toFixed(3)}, ${l.matches} partidos`).join('\n')}`,
  )
  .join('\n\n')}

Analiza estos resultados y da recomendaciones concretas.`;

    return this.groq.chat(
      [
        { role: 'system', content: BACKTEST_SYSTEM },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.3, maxTokens: 800 },
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private async getTeamForm(
    leagueId: string,
    teamId: string,
    limit: number,
  ): Promise<Omit<TeamForm, 'team'>> {
    const matches = await this.prisma.match.findMany({
      where: {
        leagueId,
        status: 'FINISHED',
        result: { isNot: null },
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      },
      include: {
        result: true,
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
      },
      orderBy: { kickoffAt: 'desc' },
      take: limit,
    });

    const results = matches.map((m) => {
      const isHome = m.homeTeamId === teamId;
      const goalsFor = isHome ? m.result!.homeScore : m.result!.awayScore;
      const goalsAgainst = isHome ? m.result!.awayScore : m.result!.homeScore;
      const opponent = isHome ? m.awayTeam.name : m.homeTeam.name;
      return { opponent, goalsFor, goalsAgainst, home: isHome };
    });

    const wins = results.filter((r) => r.goalsFor > r.goalsAgainst).length;
    const draws = results.filter((r) => r.goalsFor === r.goalsAgainst).length;
    const losses = results.filter((r) => r.goalsFor < r.goalsAgainst).length;
    const totalGF = results.reduce((s, r) => s + r.goalsFor, 0);
    const totalGA = results.reduce((s, r) => s + r.goalsAgainst, 0);

    return {
      results,
      avgGoalsScored: results.length > 0 ? totalGF / results.length : 0,
      avgGoalsConceded: results.length > 0 ? totalGA / results.length : 0,
      wins,
      draws,
      losses,
    };
  }

  private async getTeamAggregateStats(leagueId: string, teamId: string) {
    const stats = await this.prisma.matchStatistic.findMany({
      where: { teamId, match: { leagueId, status: 'FINISHED' } },
      select: { corners: true, shotsOnTarget: true, yellowCards: true },
    });

    if (stats.length === 0) return null;

    return {
      corners: stats.reduce((s, x) => s + x.corners, 0),
      shotsOnTarget: stats.reduce((s, x) => s + x.shotsOnTarget, 0),
      yellowCards: stats.reduce((s, x) => s + x.yellowCards, 0),
      matches: stats.length,
    };
  }

  private async getTeamInjuries(
    teamExternalId: string | null,
  ): Promise<string[]> {
    if (!teamExternalId) return [];
    const injuries = await this.prisma.playerInjury.findMany({
      where: { teamExternalId, status: 'active' },
      include: { player: { select: { name: true } } },
    });
    return injuries.map((i) => `${i.player.name} (${i.reason})`);
  }

  private buildPreMatchPrompt(ctx: PreMatchContext): string {
    const formLine = (f: TeamForm) => {
      if (f.results.length === 0) return 'Sin partidos recientes';
      const streak = f.results
        .map((r) =>
          r.goalsFor > r.goalsAgainst
            ? 'V'
            : r.goalsFor < r.goalsAgainst
              ? 'D'
              : 'E',
        )
        .join('');
      const detail = f.results
        .map(
          (r) =>
            `${r.home ? 'vs' : '@'} ${r.opponent} ${r.goalsFor}-${r.goalsAgainst}`,
        )
        .join(', ');
      return `${streak} (${f.wins}V ${f.draws}E ${f.losses}D) — Prom: ${f.avgGoalsScored.toFixed(1)} GF, ${f.avgGoalsConceded.toFixed(1)} GC\n  Últimos: ${detail}`;
    };

    const statsLine = (
      s: {
        corners: number;
        shotsOnTarget: number;
        yellowCards: number;
        matches: number;
      } | null,
      team: string,
    ) => {
      if (!s) return `${team}: sin estadísticas`;
      return `${team}: ${(s.corners / s.matches).toFixed(1)} córners/partido, ${(s.shotsOnTarget / s.matches).toFixed(1)} tiros a puerta/partido, ${(s.yellowCards / s.matches).toFixed(1)} amarillas/partido (${s.matches} partidos)`;
    };

    return `Partido: ${ctx.homeTeam} (local) vs ${ctx.awayTeam} (visitante)
Liga: ${ctx.league}
Fecha: ${ctx.kickoff}

FORMA RECIENTE (últimos 5):
${ctx.homeTeam}: ${formLine(ctx.homeForm)}
${ctx.awayTeam}: ${formLine(ctx.awayForm)}

ESTADÍSTICAS DE LA TEMPORADA:
${statsLine(ctx.homeStats, ctx.homeTeam)}
${statsLine(ctx.awayStats, ctx.awayTeam)}

BAJAS:
${ctx.homeTeam}: ${ctx.homeInjuries.length > 0 ? ctx.homeInjuries.join(', ') : 'Ninguna'}
${ctx.awayTeam}: ${ctx.awayInjuries.length > 0 ? ctx.awayInjuries.join(', ') : 'Ninguna'}

PREDICCIONES DE NUESTROS MODELOS:
${ctx.predictions.map((p) => `- ${p.model}: ${p.selection} (${(p.probability * 100).toFixed(1)}%)${p.edge ? ` — edge ${(p.edge * 100).toFixed(1)}%` : ''}`).join('\n')}

Analiza estos datos y da tu pronóstico.`;
  }
}
