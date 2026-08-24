import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ensembleProbabilities } from '../predictions/models/ensemble.model';
import { evaluateValueBet } from '../predictions/models/expected-value.model';

/** Resultado real de un partido: Home, Draw o Away. */
function actualOutcome(homeScore: number, awayScore: number): string {
  if (homeScore > awayScore) return 'Home';
  if (homeScore < awayScore) return 'Away';
  return 'Draw';
}

interface PredictionRow {
  matchId: string;
  modelName: string;
  market: string;
  selection: string;
  modelProbability: number;
  impliedProbability: number | null;
  edge: number | null;
}

interface ResultRow {
  matchId: string;
  homeScore: number;
  awayScore: number;
}

export interface ModelReport {
  model: string;
  totalPredictions: number; // Predicciones 1X2 evaluadas
  correctPredictions: number; // El selection con mayor prob fue el resultado real
  accuracy: number; // correctPredictions / totalMatches
  brierScore: number; // Brier score promedio (menor = mejor, 0 = perfecto)
  calibration: CalibrationBucket[];
  /** ROI simulado con flat betting ($1 por apuesta) en value bets (edge > 0). */
  valueBetROI: {
    totalBets: number;
    totalStaked: number;
    totalReturn: number;
    roi: number; // (return - staked) / staked
    winRate: number;
  };
  /** Desglose por liga. */
  byLeague: LeagueBreakdown[];
}

export interface CalibrationBucket {
  range: string; // "0-10%", "10-20%", etc.
  predicted: number; // Probabilidad promedio predicha
  actual: number; // Frecuencia real de acierto
  count: number; // Cantidad de predicciones en este bucket
}

export interface LeagueBreakdown {
  league: string;
  leagueId: string;
  matches: number;
  accuracy: number;
  brierScore: number;
}

export interface BacktestReport {
  totalMatchesEvaluated: number;
  models: ModelReport[];
  generatedAt: string;
}

@Injectable()
export class BacktestingService {
  private readonly logger = new Logger(BacktestingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateReport(filters?: {
    leagueId?: string;
    season?: string;
    modelName?: string;
  }): Promise<BacktestReport> {
    // 1. Get all finished matches that have both predictions and results
    const matchWhere: Record<string, unknown> = {
      status: 'FINISHED',
      result: { isNot: null },
      predictions: { some: { market: '1X2' } },
    };
    if (filters?.leagueId) matchWhere['leagueId'] = filters.leagueId;
    if (filters?.season) matchWhere['season'] = filters.season;

    const matches = await this.prisma.match.findMany({
      where: matchWhere,
      select: {
        id: true,
        leagueId: true,
        league: { select: { name: true } },
        result: { select: { homeScore: true, awayScore: true } },
        predictions: {
          where: {
            market: '1X2',
            ...(filters?.modelName ? { modelName: filters.modelName } : {}),
          },
          select: {
            modelName: true,
            market: true,
            selection: true,
            modelProbability: true,
            impliedProbability: true,
            edge: true,
          },
        },
        odds: {
          where: { market: '1X2' },
          select: { selection: true, price: true },
          orderBy: { fetchedAt: 'desc' },
        },
      },
    });

    // Group predictions by model
    const modelMap = new Map<
      string,
      {
        predictions: Array<
          PredictionRow & {
            result: ResultRow;
            leagueId: string;
            leagueName: string;
            bestOdds: Map<string, number>;
          }
        >;
      }
    >();

    for (const m of matches) {
      if (!m.result) continue;
      const result: ResultRow = {
        matchId: m.id,
        homeScore: m.result.homeScore,
        awayScore: m.result.awayScore,
      };

      // Best odds per selection (deduped by selection, highest price)
      const bestOdds = new Map<string, number>();
      for (const o of m.odds) {
        const price = Number(o.price);
        const current = bestOdds.get(o.selection) ?? 0;
        if (price > current) bestOdds.set(o.selection, price);
      }

      for (const pred of m.predictions) {
        if (!modelMap.has(pred.modelName)) {
          modelMap.set(pred.modelName, { predictions: [] });
        }
        modelMap.get(pred.modelName)!.predictions.push({
          matchId: m.id,
          modelName: pred.modelName,
          market: pred.market,
          selection: pred.selection,
          modelProbability: Number(pred.modelProbability),
          impliedProbability: pred.impliedProbability
            ? Number(pred.impliedProbability)
            : null,
          edge: pred.edge ? Number(pred.edge) : null,
          result,
          leagueId: m.leagueId,
          leagueName: m.league.name,
          bestOdds,
        });
      }
    }

    // ── Ensemble retroactivo: sintetizar ensemble_v1 a partir de poisson_v1 + elo_v1 ──
    const poissonData = modelMap.get('poisson_v1');
    const eloData = modelMap.get('elo_v1');
    if (poissonData && eloData && !filters?.modelName) {
      // Agrupar por matchId para combinar
      const poissonByMatch = new Map<
        string,
        Map<string, (typeof poissonData.predictions)[0]>
      >();
      for (const p of poissonData.predictions) {
        if (!poissonByMatch.has(p.matchId))
          poissonByMatch.set(p.matchId, new Map());
        poissonByMatch.get(p.matchId)!.set(p.selection, p);
      }
      const eloByMatch = new Map<
        string,
        Map<string, (typeof eloData.predictions)[0]>
      >();
      for (const p of eloData.predictions) {
        if (!eloByMatch.has(p.matchId)) eloByMatch.set(p.matchId, new Map());
        eloByMatch.get(p.matchId)!.set(p.selection, p);
      }

      const ensembleName = 'ensemble_v1';
      if (!modelMap.has(ensembleName)) {
        modelMap.set(ensembleName, { predictions: [] });
      }
      const ensembleData = modelMap.get(ensembleName)!;

      for (const [matchId, poissonSels] of poissonByMatch) {
        const eloSels = eloByMatch.get(matchId);
        if (!eloSels) continue;
        const pH = poissonSels.get('Home');
        const pD = poissonSels.get('Draw');
        const pA = poissonSels.get('Away');
        const eH = eloSels.get('Home');
        const eD = eloSels.get('Draw');
        const eA = eloSels.get('Away');
        if (!pH || !pD || !pA || !eH || !eD || !eA) continue;

        const ensemble = ensembleProbabilities(
          {
            homeWin: pH.modelProbability,
            draw: pD.modelProbability,
            awayWin: pA.modelProbability,
          },
          {
            homeWin: eH.modelProbability,
            draw: eD.modelProbability,
            awayWin: eA.modelProbability,
          },
        );

        const selections: Array<[string, number]> = [
          ['Home', ensemble.homeWin],
          ['Draw', ensemble.draw],
          ['Away', ensemble.awayWin],
        ];

        for (const [selection, prob] of selections) {
          const ref = poissonSels.get(selection)!; // usar metadata del poisson como referencia
          const odds = ref.bestOdds.get(selection);
          let impliedProbability: number | null = null;
          let edge: number | null = null;
          if (odds) {
            const ev = evaluateValueBet(
              { modelProbability: prob, decimalOdds: odds },
              0.05,
            );
            impliedProbability = ev.impliedProbability;
            edge = ev.edge;
          }
          ensembleData.predictions.push({
            matchId,
            modelName: ensembleName,
            market: '1X2',
            selection,
            modelProbability: prob,
            impliedProbability,
            edge,
            result: ref.result,
            leagueId: ref.leagueId,
            leagueName: ref.leagueName,
            bestOdds: ref.bestOdds,
          });
        }
      }
    }

    // Generate report per model
    const models: ModelReport[] = [];

    for (const [modelName, data] of modelMap) {
      // Group by match to evaluate accuracy (pick the highest-prob selection per match)
      const matchPreds = new Map<string, typeof data.predictions>();
      for (const p of data.predictions) {
        if (!matchPreds.has(p.matchId)) matchPreds.set(p.matchId, []);
        matchPreds.get(p.matchId)!.push(p);
      }

      let correct = 0;
      let totalBrier = 0;
      let totalMatches = 0;

      // Value bet ROI
      let vbTotalBets = 0;
      let vbTotalReturn = 0;
      let vbWins = 0;

      // Calibration: 10 buckets (0-10%, 10-20%, ..., 90-100%)
      const calBuckets: Array<{
        sumPredicted: number;
        hits: number;
        count: number;
      }> = Array.from({ length: 10 }, () => ({
        sumPredicted: 0,
        hits: 0,
        count: 0,
      }));

      // By league
      const leagueStats = new Map<
        string,
        { name: string; matches: number; correct: number; brierSum: number }
      >();

      for (const [, preds] of matchPreds) {
        const result = preds[0].result;
        const actual = actualOutcome(result.homeScore, result.awayScore);
        const leagueId = preds[0].leagueId;
        const leagueName = preds[0].leagueName;
        const bestOdds = preds[0].bestOdds;

        // Find predicted winner (highest modelProbability)
        const predicted = preds.reduce((best, p) =>
          p.modelProbability > best.modelProbability ? p : best,
        );
        const isCorrect = predicted.selection === actual;
        if (isCorrect) correct += 1;
        totalMatches += 1;

        // Brier score: sum of (predicted_prob - actual)^2 for each selection
        let matchBrier = 0;
        for (const p of preds) {
          const actualVal = p.selection === actual ? 1 : 0;
          matchBrier += (p.modelProbability - actualVal) ** 2;
        }
        totalBrier += matchBrier;

        // Calibration
        for (const p of preds) {
          const bucket = Math.min(Math.floor(p.modelProbability * 10), 9);
          calBuckets[bucket].sumPredicted += p.modelProbability;
          calBuckets[bucket].hits += p.selection === actual ? 1 : 0;
          calBuckets[bucket].count += 1;
        }

        // Value bet ROI: simulate $1 flat bet on selections with edge > 0
        for (const p of preds) {
          if (p.edge && p.edge > 0) {
            vbTotalBets += 1;
            const odds = bestOdds.get(p.selection);
            if (p.selection === actual && odds) {
              vbTotalReturn += odds; // Won: get back odds * stake
              vbWins += 1;
            }
            // Lost: stake of $1 is already counted in vbTotalBets
          }
        }

        // League breakdown
        if (!leagueStats.has(leagueId)) {
          leagueStats.set(leagueId, {
            name: leagueName,
            matches: 0,
            correct: 0,
            brierSum: 0,
          });
        }
        const ls = leagueStats.get(leagueId)!;
        ls.matches += 1;
        if (isCorrect) ls.correct += 1;
        ls.brierSum += matchBrier;
      }

      const calibration: CalibrationBucket[] = calBuckets.map((b, i) => ({
        range: `${i * 10}-${(i + 1) * 10}%`,
        predicted: b.count > 0 ? b.sumPredicted / b.count : 0,
        actual: b.count > 0 ? b.hits / b.count : 0,
        count: b.count,
      }));

      const byLeague: LeagueBreakdown[] = [...leagueStats.entries()].map(
        ([leagueId, ls]) => ({
          league: ls.name,
          leagueId,
          matches: ls.matches,
          accuracy: ls.matches > 0 ? ls.correct / ls.matches : 0,
          brierScore: ls.matches > 0 ? ls.brierSum / ls.matches : 0,
        }),
      );

      models.push({
        model: modelName,
        totalPredictions: data.predictions.length,
        correctPredictions: correct,
        accuracy: totalMatches > 0 ? correct / totalMatches : 0,
        brierScore: totalMatches > 0 ? totalBrier / totalMatches : 0,
        calibration,
        valueBetROI: {
          totalBets: vbTotalBets,
          totalStaked: vbTotalBets, // $1 per bet
          totalReturn: vbTotalReturn,
          roi:
            vbTotalBets > 0 ? (vbTotalReturn - vbTotalBets) / vbTotalBets : 0,
          winRate: vbTotalBets > 0 ? vbWins / vbTotalBets : 0,
        },
        byLeague,
      });
    }

    // Sort by accuracy descending
    models.sort((a, b) => b.accuracy - a.accuracy);

    return {
      totalMatchesEvaluated: matches.filter((m) => m.result).length,
      models,
      generatedAt: new Date().toISOString(),
    };
  }
}
