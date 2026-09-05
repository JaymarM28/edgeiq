import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../core/prisma/prisma.service';
import { withDbRetry } from '../../core/prisma/db-retry';
import {
  NotificationsService,
  type ValueBetAlert,
} from '../notifications/notifications.service';
import { ExplanationsService } from './explanations.service';
import {
  DEFAULT_ELO_RATING,
  computeEloRatings,
  eloToOutcomeProbabilities,
  type EloMatchResult,
} from './models/elo.model';
import { evaluateValueBet } from './models/expected-value.model';
import {
  type EventStatType,
  type LeagueEventAverages,
  type TeamEventStats,
  predictEventOverUnder,
} from './models/events-poisson.model';
import {
  type PlayerStatType,
  type PlayerHistoryStat,
  predictPlayerOverUnder,
} from './models/player-poisson.model';
import {
  expectedGoals,
  matchOutcomeProbabilities,
  type LeagueGoalAverages,
  type TeamGoalStats,
} from './models/poisson.model';
import { ensembleProbabilities } from './models/ensemble.model';
import type { MatchOutcomeProbabilities } from './models/types';
import { CalibrationService } from './calibration.service';

type Selection = 'Home' | 'Draw' | 'Away';
const MARKET_1X2 = '1X2';

/** Stats de equipo que modelamos como over/under con Poisson. */
const EVENT_STAT_TYPES: EventStatType[] = [
  'corners',
  'shotsOnTarget',
  'yellowCards',
];

/** Mapeo de campo de PlayerMatchStat al PlayerStatType del modelo. */
const PLAYER_STAT_FIELDS: Array<{ field: string; statType: PlayerStatType }> = [
  { field: 'shotsOn', statType: 'shotsOn' },
  { field: 'shotsTotal', statType: 'shotsTotal' },
  { field: 'goals', statType: 'goals' },
  { field: 'yellowCards', statType: 'yellowCards' },
];

/**
 * Orquesta los modelos de Fase 1 (docs/AI_MODELS.md) contra los datos ya
 * ingeridos. Poisson y Elo corren por separado (no se combinan en un solo
 * número) para poder comparar cuál acierta más con backtesting real.
 */
export interface GenerationProgress {
  status: 'idle' | 'running' | 'done' | 'error';
  phase: string;
  current: number;
  total: number;
  detail: string;
  startedAt: string | null;
  finishedAt: string | null;
}

@Injectable()
export class PredictionsService {
  private readonly logger = new Logger(PredictionsService.name);

  /** Progreso in-memory para polling desde el frontend. */
  private _progress: GenerationProgress = {
    status: 'idle',
    phase: '',
    current: 0,
    total: 0,
    detail: '',
    startedAt: null,
    finishedAt: null,
  };

  get progress(): GenerationProgress {
    return { ...this._progress };
  }

  private updateProgress(update: Partial<GenerationProgress>) {
    Object.assign(this._progress, update);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly explanations: ExplanationsService,
    private readonly calibration: CalibrationService,
  ) {}

  private get edgeThreshold(): number {
    return Number(this.config.get<string>('VALUE_BET_EDGE_THRESHOLD', '0.02'));
  }

  /**
   * Sin `externalLeagueId`: genera para todas las ligas ya ingeridas (no
   * solo una), para poder comparar value bets entre competiciones — ver
   * docs/DECISIONS.md ("soporte multi-liga"). `externalLeagueId` es el ID
   * de API-Football (ej. "140" = La Liga), igual que en `IngestionController`.
   */
  async generateForUpcoming(externalLeagueId?: string) {
    this.updateProgress({
      status: 'running',
      phase: 'init',
      current: 0,
      total: 0,
      detail: 'Cargando ligas...',
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });

    try {
      const leagues = externalLeagueId
        ? await this.prisma.league.findMany({
            where: { externalId: externalLeagueId },
          })
        : await this.prisma.league.findMany();

      if (leagues.length === 0) {
        this.updateProgress({
          status: 'error',
          detail: 'No hay ligas ingeridas',
        });
        throw new NotFoundException(
          'No hay ligas ingeridas todavía. Corre la ingesta (POST /v1/ingestion/sync) primero.',
        );
      }

      // ── Fase 1: Calibración ──
      this.updateProgress({
        phase: 'calibration',
        detail: 'Entrenando calibración con historial...',
      });
      try {
        const trained = await this.calibration.trainAll();
        if (trained.length > 0) {
          this.logger.log(`Calibración entrenada para: ${trained.join(', ')}`);
        }
      } catch (err) {
        this.logger.warn(
          `Calibración falló: ${err instanceof Error ? err.message : err}`,
        );
      }

      // ── Fase 2: Contar partidos ──
      const allUpcoming: Array<{ id: string; leagueName: string }> = [];
      for (const league of leagues) {
        const upcoming = await this.prisma.match.findMany({
          where: { leagueId: league.id, status: 'SCHEDULED' },
          select: { id: true },
        });
        for (const m of upcoming) {
          allUpcoming.push({ id: m.id, leagueName: league.name });
        }
      }

      this.updateProgress({
        phase: 'predictions',
        current: 0,
        total: allUpcoming.length,
        detail: `Generando predicciones para ${allUpcoming.length} partidos...`,
      });

      // ── Fase 3: Generar predicciones ──
      let generated = 0;
      let skipped = 0;
      const leagueCounters = new Map<
        string,
        { upcoming: number; generated: number; skipped: number }
      >();

      for (let i = 0; i < allUpcoming.length; i++) {
        const { id, leagueName } = allUpcoming[i];
        if (!leagueCounters.has(leagueName)) {
          leagueCounters.set(leagueName, {
            upcoming: 0,
            generated: 0,
            skipped: 0,
          });
        }
        const lc = leagueCounters.get(leagueName)!;
        lc.upcoming += 1;

        this.updateProgress({
          current: i + 1,
          detail: `Partido ${i + 1}/${allUpcoming.length} — ${leagueName}`,
        });

        let ok = false;
        try {
          ok = await withDbRetry(() => this.generateForMatch(id));
        } catch (err) {
          this.logger.warn(
            `Partido ${id} falló tras reintentos, se omite: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
        if (ok) {
          generated += 1;
          lc.generated += 1;
        } else {
          skipped += 1;
          lc.skipped += 1;
        }
      }

      const totalUpcoming = allUpcoming.length;
      const perLeague = [...leagueCounters.entries()].map(([league, c]) => ({
        league,
        ...c,
      }));

      // ── Fase 4: Notificaciones ──
      if (generated > 0) {
        this.updateProgress({
          phase: 'notifications',
          current: 0,
          total: 0,
          detail: 'Enviando notificaciones...',
        });
        try {
          await this.notifyNewValueBets();
        } catch (err) {
          this.logger.warn(
            `Notificación falló: ${err instanceof Error ? err.message : err}`,
          );
        }

        // ── Fase 5: Explicaciones IA ──
        this.updateProgress({
          phase: 'explanations',
          current: 0,
          total: 0,
          detail: 'Generando explicaciones IA...',
        });
        try {
          const explained = await this.explanations.generateForPendingValueBets(
            (current, total) => {
              this.updateProgress({
                current,
                total,
                detail: `Explicación IA ${current}/${total}`,
              });
            },
          );
          this.logger.log(`Explicaciones LLM generadas: ${explained}`);
        } catch (err) {
          this.logger.warn(
            `Explicaciones LLM fallaron: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      this.updateProgress({
        status: 'done',
        phase: 'done',
        detail: `Listo: ${generated} predicciones generadas`,
        finishedAt: new Date().toISOString(),
      });

      return { totalUpcoming, generated, skipped, leagues: perLeague };
    } catch (err) {
      if (this._progress.status !== 'error') {
        this.updateProgress({
          status: 'error',
          detail: `Error: ${err instanceof Error ? err.message : String(err)}`,
          finishedAt: new Date().toISOString(),
        });
      }
      throw err;
    }
  }

  /**
   * Busca value bets activos con edge > 7% (media + alta confianza)
   * y envía una notificación consolidada.
   */
  private async notifyNewValueBets() {
    const MAX_EDGE = 2.0;
    const MIN_NOTIFY_EDGE = 0.07; // Solo media y alta

    const valueBets = await this.prisma.prediction.findMany({
      where: {
        edge: { gt: MIN_NOTIFY_EDGE, lte: MAX_EDGE },
        match: { status: 'SCHEDULED' },
      },
      orderBy: { edge: 'desc' },
      include: {
        match: {
          include: {
            homeTeam: true,
            awayTeam: true,
            league: true,
          },
        },
      },
      take: 20,
    });

    if (valueBets.length === 0) return;

    const alerts: ValueBetAlert[] = valueBets.map((vb) => {
      const edge = Number(vb.edge ?? 0);
      const modelPct = Number(vb.modelProbability);
      const housePct = Number(vb.impliedProbability ?? 0);
      const kickoff = new Date(vb.match.kickoffAt);
      const kickoffStr =
        kickoff.toLocaleDateString('es-ES', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }) +
        ' · ' +
        kickoff.toLocaleTimeString('es-ES', {
          hour: '2-digit',
          minute: '2-digit',
        });

      let recommendation = vb.selection;
      if (vb.market === MARKET_1X2) {
        recommendation =
          vb.selection === 'Home'
            ? `Gana ${vb.match.homeTeam.name}`
            : vb.selection === 'Away'
              ? `Gana ${vb.match.awayTeam.name}`
              : 'Empate';
      } else if (vb.selection === 'Over') {
        recommendation = `Más — ${vb.market.replace('O/U ', '')}`;
      } else if (vb.selection === 'Under') {
        recommendation = `Menos — ${vb.market.replace('O/U ', '')}`;
      }

      return {
        match: `${vb.match.homeTeam.name} vs ${vb.match.awayTeam.name}`,
        league: vb.match.league.name,
        kickoff: kickoffStr,
        recommendation,
        market: vb.market,
        edge,
        modelPct,
        housePct,
        confidence: edge >= 0.15 ? ('alta' as const) : ('media' as const),
      };
    });

    await this.notifications.notifyValueBets(alerts);
  }

  async generateForMatch(matchId: string): Promise<boolean> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
    });
    if (!match) {
      throw new NotFoundException('Partido no encontrado');
    }

    const leagueAverages = await this.getLeagueGoalAverages(match.leagueId);
    if (!leagueAverages) {
      this.logger.warn(
        `Sin resultados históricos en la liga ${match.leagueId}; se omite predicción para ${matchId}.`,
      );
      return false;
    }

    const [homeStats, awayStats, eloResults] = await Promise.all([
      this.getTeamHomeStats(match.leagueId, match.homeTeamId),
      this.getTeamAwayStats(match.leagueId, match.awayTeamId),
      this.getLeagueResults(match.leagueId),
    ]);

    // Guard contra Poisson degenerado: si matchesPlayed=0 O si los goles
    // esperados (λ) resultan 0 (ej. equipo jugó pero anotó 0 goles en ese
    // rol local/visitante), poissonPmf(0,0)=1 → "empate 100%" falso.
    let poissonProbs: MatchOutcomeProbabilities | null = null;

    if (homeStats.matchesPlayed > 0 && awayStats.matchesPlayed > 0) {
      const goals = expectedGoals({
        league: leagueAverages,
        home: homeStats,
        away: awayStats,
      });

      if (goals.home > 0 && goals.away > 0) {
        poissonProbs = matchOutcomeProbabilities(goals);
        const calibratedPoisson = this.calibration.apply(
          'poisson_v1',
          poissonProbs,
        );
        await this.storePrediction(match.id, 'poisson_v1', calibratedPoisson);
      } else {
        this.logger.warn(
          `λ degenerado (home=${goals.home}, away=${goals.away}) para partido ${matchId}; se omite poisson_v1.`,
        );
      }
    } else {
      this.logger.warn(
        `Sin historial para uno de los equipos del partido ${matchId}; se omite poisson_v1 (queda solo elo_v1).`,
      );
    }

    const ratings = computeEloRatings(eloResults);
    const eloProbs = eloToOutcomeProbabilities(
      ratings[match.homeTeamId] ?? DEFAULT_ELO_RATING,
      ratings[match.awayTeamId] ?? DEFAULT_ELO_RATING,
    );
    const calibratedElo = this.calibration.apply('elo_v1', eloProbs);
    await this.storePrediction(match.id, 'elo_v1', calibratedElo);

    // ── Ensemble: combina Poisson + Elo ──
    if (poissonProbs) {
      const raw = ensembleProbabilities(poissonProbs, eloProbs);
      const calibratedEnsemble = this.calibration.apply('ensemble_v1', raw);
      await this.storePrediction(match.id, 'ensemble_v1', calibratedEnsemble);
    }

    // ── Nivel 1: over/under de eventos por equipo ──
    await this.generateEventPredictions(
      match.id,
      match.leagueId,
      match.homeTeamId,
      match.awayTeamId,
    );

    // ── Nivel 2: over/under por jugador ──
    await this.generatePlayerPredictions(
      match.id,
      match.leagueId,
      match.homeTeamId,
      match.awayTeamId,
    );

    return true;
  }

  getValueBets(minEdge?: number) {
    const MAX_EDGE = 2.0; // Cap at 200% — higher edges are unreliable (low-data teams)
    return this.prisma.prediction.findMany({
      where: {
        edge: { gt: minEdge ?? this.edgeThreshold, lte: MAX_EDGE },
        match: { status: 'SCHEDULED' },
      },
      orderBy: { edge: 'desc' },
      include: {
        match: { include: { homeTeam: true, awayTeam: true, league: true } },
      },
    });
  }

  private async storePrediction(
    matchId: string,
    modelName: string,
    probs: MatchOutcomeProbabilities,
  ) {
    const selections: Array<[Selection, number]> = [
      ['Home', probs.homeWin],
      ['Draw', probs.draw],
      ['Away', probs.awayWin],
    ];

    for (const [selection, modelProbability] of selections) {
      const latestOdds = await this.prisma.odds.findFirst({
        where: { matchId, market: MARKET_1X2, selection },
        orderBy: { fetchedAt: 'desc' },
      });

      let impliedProbability: number | undefined;
      let edge: number | undefined;
      if (latestOdds) {
        const evaluation = evaluateValueBet(
          { modelProbability, decimalOdds: Number(latestOdds.price) },
          this.edgeThreshold,
        );
        impliedProbability = evaluation.impliedProbability;
        edge = evaluation.edge;
      }

      await this.prisma.prediction.upsert({
        where: {
          matchId_market_selection_modelName: {
            matchId,
            market: MARKET_1X2,
            selection,
            modelName,
          },
        },
        create: {
          matchId,
          market: MARKET_1X2,
          selection,
          modelName,
          modelProbability,
          impliedProbability,
          edge,
        },
        update: {
          modelProbability,
          impliedProbability,
          edge,
        },
      });
    }
  }

  // ─── Nivel 1: predicciones over/under de eventos ─────────────────────

  private async generateEventPredictions(
    matchId: string,
    leagueId: string,
    homeTeamId: string,
    awayTeamId: string,
  ) {
    for (const statType of EVENT_STAT_TYPES) {
      const [leagueAvg, homeStats, awayStats] = await Promise.all([
        this.getLeagueEventAverages(leagueId, statType),
        this.getTeamEventStats(leagueId, homeTeamId, 'home', statType),
        this.getTeamEventStats(leagueId, awayTeamId, 'away', statType),
      ]);

      if (!leagueAvg) continue;

      const predictions = predictEventOverUnder(
        statType,
        leagueAvg,
        homeStats,
        awayStats,
      );
      if (predictions.length === 0) {
        this.logger.debug(
          `λ degenerado para ${statType} en partido ${matchId}; se omite events_poisson_v1.`,
        );
        continue;
      }

      for (const pred of predictions) {
        const market = `${this.statTypeLabel(statType)} O/U ${pred.line}`;
        // Over
        await this.storeRawPrediction(
          matchId,
          market,
          'Over',
          'events_poisson_v1',
          pred.overProb,
        );
        // Under
        await this.storeRawPrediction(
          matchId,
          market,
          'Under',
          'events_poisson_v1',
          pred.underProb,
        );
      }
    }
  }

  private statTypeLabel(statType: EventStatType): string {
    const labels: Record<EventStatType, string> = {
      corners: 'Corners',
      shotsOnTarget: 'Shots on Target',
      yellowCards: 'Yellow Cards',
    };
    return labels[statType];
  }

  private async getLeagueEventAverages(
    leagueId: string,
    statType: EventStatType,
  ): Promise<LeagueEventAverages | null> {
    // Sumar stats de todos los partidos terminados de la liga, separando
    // local vs visitante.
    const matches = await this.prisma.match.findMany({
      where: { leagueId, status: 'FINISHED', matchStatistics: { some: {} } },
      include: {
        matchStatistics: { select: { teamId: true, [statType]: true } },
      },
    });

    if (matches.length === 0) return null;

    let totalHome = 0;
    let totalAway = 0;
    let count = 0;

    for (const m of matches) {
      const homeStat = m.matchStatistics.find((s) => s.teamId === m.homeTeamId);
      const awayStat = m.matchStatistics.find((s) => s.teamId === m.awayTeamId);
      if (!homeStat || !awayStat) continue;
      totalHome += (homeStat as Record<string, unknown>)[statType] as number;
      totalAway += (awayStat as Record<string, unknown>)[statType] as number;
      count += 1;
    }

    if (count === 0) return null;
    return { avgHome: totalHome / count, avgAway: totalAway / count };
  }

  private async getTeamEventStats(
    leagueId: string,
    teamId: string,
    role: 'home' | 'away',
    statType: EventStatType,
  ): Promise<TeamEventStats> {
    const whereClause =
      role === 'home'
        ? { leagueId, homeTeamId: teamId, status: 'FINISHED' as const }
        : { leagueId, awayTeamId: teamId, status: 'FINISHED' as const };

    const matches = await this.prisma.match.findMany({
      where: { ...whereClause, matchStatistics: { some: { teamId } } },
      include: {
        matchStatistics: {
          where: { teamId },
          select: { [statType]: true },
        },
      },
    });

    let totalValue = 0;
    let matchesPlayed = 0;
    for (const m of matches) {
      const stat = m.matchStatistics[0];
      if (!stat) continue;
      totalValue += (stat as Record<string, unknown>)[statType] as number;
      matchesPlayed += 1;
    }

    return { matchesPlayed, totalValue };
  }

  // ─── Nivel 2: predicciones over/under por jugador ───────────────────

  private async generatePlayerPredictions(
    matchId: string,
    leagueId: string,
    homeTeamId: string,
    awayTeamId: string,
  ) {
    // Jugadores de ambos equipos que tienen historial
    const players = await this.prisma.player.findMany({
      where: {
        teamId: { in: [homeTeamId, awayTeamId] },
        matchStats: { some: {} },
      },
      select: { id: true, name: true, teamId: true },
    });

    for (const player of players) {
      // El rival es el equipo contrario al del jugador
      const rivalTeamId =
        player.teamId === homeTeamId ? awayTeamId : homeTeamId;
      // El rol del rival: si el jugador es del equipo local, el rival juega away
      const rivalRole: 'home' | 'away' =
        player.teamId === homeTeamId ? 'away' : 'home';

      for (const { field, statType } of PLAYER_STAT_FIELDS) {
        const history = await this.getPlayerHistory(player.id, field);

        // Ajuste por rival: cuánto concede el rival de este stat vs el promedio
        const rivalAdj = await this.getRivalAdjustment(
          leagueId,
          rivalTeamId,
          rivalRole,
          statType,
        );

        const predictions = predictPlayerOverUnder(
          statType,
          history,
          undefined,
          rivalAdj,
        );

        for (const pred of predictions) {
          const market = `Player ${this.playerStatLabel(statType)} O/U ${pred.line}`;
          const selection = player.name;

          await this.storeRawPrediction(
            matchId,
            market,
            selection,
            'player_poisson_v1',
            pred.overProb,
          );
        }
      }
    }
  }

  /**
   * Calcula el factor de ajuste por rival: cuánto concede el rival de un
   * stat versus el promedio de la liga. >1 = rival débil defensivamente
   * (boost al jugador), <1 = rival fuerte (nerf).
   *
   * Enfoque: miramos cuántos tiros/goles recibe el rival de sus oponentes.
   * Si el rival juega de local, lo que "concede" son los stats del equipo
   * visitante EN los partidos del rival como local. Esto se obtiene
   * buscando los MatchStatistic del oponente (no del rival) en esos
   * partidos.
   *
   * Para tarjetas: no hay relación causal directa con el rival → sin ajuste.
   */
  private async getRivalAdjustment(
    leagueId: string,
    rivalTeamId: string,
    rivalRole: 'home' | 'away',
    statType: PlayerStatType,
  ): Promise<number> {
    if (statType === 'yellowCards') return 1.0;

    // Mapeo: qué stat de MatchStatistic medir en el oponente.
    // Usamos shotsOnTarget como proxy para todos los stats ofensivos
    // (goals, shotsOn, shotsTotal) porque es el que mejor refleja la
    // permeabilidad defensiva del rival y está modelado en EventStatType.
    const matchStatField: EventStatType = 'shotsOnTarget';

    // Partidos del rival en su rol, con stats del oponente (no del rival)
    const rivalMatches = await withDbRetry(() =>
      this.prisma.match.findMany({
        where: {
          leagueId,
          ...(rivalRole === 'home'
            ? { homeTeamId: rivalTeamId }
            : { awayTeamId: rivalTeamId }),
          status: 'FINISHED' as const,
          matchStatistics: { some: {} },
        },
        select: {
          homeTeamId: true,
          awayTeamId: true,
          matchStatistics: {
            select: { teamId: true, [matchStatField]: true },
          },
        },
      }),
    );

    if (rivalMatches.length === 0) return 1.0;

    // Sumar los stats del oponente (no del rival) en cada partido
    let totalConceded = 0;
    let count = 0;
    for (const m of rivalMatches) {
      // El oponente es el equipo que NO es el rival
      const opponentId = rivalRole === 'home' ? m.awayTeamId : m.homeTeamId;
      const opponentStat = m.matchStatistics.find(
        (s) => s.teamId === opponentId,
      );
      if (!opponentStat) continue;
      totalConceded += (opponentStat as Record<string, unknown>)[
        matchStatField
      ] as number;
      count += 1;
    }

    if (count === 0) return 1.0;
    const avgConceded = totalConceded / count;

    // Promedio de la liga para ese stat en el rol del oponente
    const leagueAvg = await this.getLeagueEventAverages(
      leagueId,
      matchStatField,
    );
    if (!leagueAvg) return 1.0;

    // El oponente juega el rol opuesto al del rival
    const opponentAvg =
      rivalRole === 'home' ? leagueAvg.avgAway : leagueAvg.avgHome;
    if (opponentAvg === 0) return 1.0;

    // ratio > 1 = el rival concede más que el promedio → boost al jugador
    const raw = avgConceded / opponentAvg;
    return Math.max(0.5, Math.min(2.0, raw));
  }

  private playerStatLabel(statType: PlayerStatType): string {
    const labels: Record<PlayerStatType, string> = {
      shotsOn: 'Shots on Target',
      shotsTotal: 'Total Shots',
      goals: 'Goals',
      yellowCards: 'Yellow Cards',
    };
    return labels[statType];
  }

  private async getPlayerHistory(
    playerId: string,
    field: string,
  ): Promise<PlayerHistoryStat[]> {
    const stats = await withDbRetry(() =>
      this.prisma.playerMatchStat.findMany({
        where: { playerId },
        select: { minutes: true, [field]: true },
        orderBy: { match: { kickoffAt: 'desc' } },
      }),
    );

    return stats.map((s) => ({
      value: (s as Record<string, unknown>)[field] as number,
      minutes: s.minutes,
    }));
  }

  // ─── Storage helpers ────────────────────────────────────────────────

  /**
   * Guarda una predicción comparándola contra las odds más recientes del
   * mismo mercado+selección (si existen). Si hay odds, calcula edge; si no,
   * impliedProbability y edge quedan null (se llenarán cuando se ingieran
   * odds para ese mercado).
   */
  private async storeRawPrediction(
    matchId: string,
    market: string,
    selection: string,
    modelName: string,
    modelProbability: number,
  ) {
    const latestOdds = await this.prisma.odds.findFirst({
      where: { matchId, market, selection },
      orderBy: { fetchedAt: 'desc' },
    });

    let impliedProbability: number | undefined;
    let edge: number | undefined;
    if (latestOdds) {
      const evaluation = evaluateValueBet(
        { modelProbability, decimalOdds: Number(latestOdds.price) },
        this.edgeThreshold,
      );
      impliedProbability = evaluation.impliedProbability;
      edge = evaluation.edge;
    }

    await this.prisma.prediction.upsert({
      where: {
        matchId_market_selection_modelName: {
          matchId,
          market,
          selection,
          modelName,
        },
      },
      create: {
        matchId,
        market,
        selection,
        modelName,
        modelProbability,
        impliedProbability,
        edge,
      },
      update: { modelProbability, impliedProbability, edge },
    });
  }

  private async getLeagueGoalAverages(
    leagueId: string,
  ): Promise<LeagueGoalAverages | null> {
    const matches = await this.prisma.match.findMany({
      where: { leagueId, result: { isNot: null } },
      include: { result: true },
    });
    if (matches.length === 0) return null;

    const totalHome = matches.reduce(
      (sum, m) => sum + (m.result?.homeScore ?? 0),
      0,
    );
    const totalAway = matches.reduce(
      (sum, m) => sum + (m.result?.awayScore ?? 0),
      0,
    );

    return {
      avgHomeGoalsScored: totalHome / matches.length,
      avgAwayGoalsScored: totalAway / matches.length,
    };
  }

  /**
   * Aplica decaimiento exponencial: el partido más reciente pesa 1.0,
   * cada partido anterior se multiplica por `decay` acumulativo.
   * Con decay=0.85 y 10 partidos: [1, 0.85, 0.72, 0.61, 0.52, 0.44, 0.38, 0.32, 0.27, 0.23]
   * Esto hace que la forma reciente domine sin ignorar el historial.
   */
  private applyDecayWeights(
    matches: Array<{ scored: number; conceded: number }>,
    decay = 0.85,
    maxMatches = 10,
  ): TeamGoalStats {
    const recent = matches.slice(0, maxMatches); // ya ordenados desc por kickoff
    if (recent.length === 0) {
      return { matchesPlayed: 0, goalsScored: 0, goalsConceded: 0 };
    }

    let weightedScored = 0;
    let weightedConceded = 0;
    let totalWeight = 0;

    for (let i = 0; i < recent.length; i++) {
      const w = decay ** i;
      weightedScored += recent[i].scored * w;
      weightedConceded += recent[i].conceded * w;
      totalWeight += w;
    }

    // matchesPlayed = totalWeight para que rate() devuelva el promedio ponderado
    return {
      matchesPlayed: totalWeight,
      goalsScored: weightedScored,
      goalsConceded: weightedConceded,
    };
  }

  private async getTeamHomeStats(
    leagueId: string,
    teamId: string,
  ): Promise<TeamGoalStats> {
    const matches = await this.prisma.match.findMany({
      where: { leagueId, homeTeamId: teamId, result: { isNot: null } },
      include: { result: true },
      orderBy: { kickoffAt: 'desc' },
    });

    return this.applyDecayWeights(
      matches.map((m) => ({
        scored: m.result?.homeScore ?? 0,
        conceded: m.result?.awayScore ?? 0,
      })),
    );
  }

  private async getTeamAwayStats(
    leagueId: string,
    teamId: string,
  ): Promise<TeamGoalStats> {
    const matches = await this.prisma.match.findMany({
      where: { leagueId, awayTeamId: teamId, result: { isNot: null } },
      include: { result: true },
      orderBy: { kickoffAt: 'desc' },
    });

    return this.applyDecayWeights(
      matches.map((m) => ({
        scored: m.result?.awayScore ?? 0,
        conceded: m.result?.homeScore ?? 0,
      })),
    );
  }

  private async getLeagueResults(leagueId: string): Promise<EloMatchResult[]> {
    const matches = await this.prisma.match.findMany({
      where: { leagueId, result: { isNot: null } },
      include: { result: true },
      orderBy: { kickoffAt: 'asc' },
    });

    return matches
      .filter((m) => m.result)
      .map((m) => ({
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
        homeScore: m.result!.homeScore,
        awayScore: m.result!.awayScore,
        playedAt: m.kickoffAt,
      }));
  }
}
