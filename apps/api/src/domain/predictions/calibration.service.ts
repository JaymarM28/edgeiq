import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  type PlattParams,
  fitPlattScaling,
  calibrateOutcome,
} from './models/calibration.model';
import type { MatchOutcomeProbabilities } from './models/types';

type Selection = 'Home' | 'Draw' | 'Away';

interface CalibrationData {
  home: PlattParams;
  draw: PlattParams;
  away: PlattParams;
  sampleSize: number;
}

/**
 * Calcula parámetros de Platt scaling por modelo usando predicciones
 * históricas vs resultados reales. Los parámetros se cachean en memoria
 * y se recalculan cada vez que se generan predicciones nuevas.
 */
@Injectable()
export class CalibrationService {
  private readonly logger = new Logger(CalibrationService.name);
  private cache = new Map<string, CalibrationData>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Entrena calibración para un modelo usando su historial de predicciones
   * contra partidos ya terminados.
   */
  async train(modelName: string): Promise<CalibrationData | null> {
    const matches = await this.prisma.match.findMany({
      where: {
        status: 'FINISHED',
        result: { isNot: null },
        predictions: { some: { modelName, market: '1X2' } },
      },
      select: {
        id: true,
        result: { select: { homeScore: true, awayScore: true } },
        predictions: {
          where: { modelName, market: '1X2' },
          select: { selection: true, modelProbability: true },
        },
      },
    });

    // Mínimo alto: la calibración necesita muchos datos del MISMO modelo.
    // Si el modelo cambió (ej. se agregó forma ponderada), las predicciones
    // viejas no son representativas y la calibración distorsiona.
    const MIN_MATCHES = 100;
    if (matches.length < MIN_MATCHES) {
      this.logger.debug(
        `Insuficientes partidos para calibrar ${modelName} (${matches.length}/${MIN_MATCHES})`,
      );
      return null;
    }

    // Agrupar predicciones por selección
    const data: Record<Selection, { preds: number[]; outcomes: number[] }> = {
      Home: { preds: [], outcomes: [] },
      Draw: { preds: [], outcomes: [] },
      Away: { preds: [], outcomes: [] },
    };

    for (const m of matches) {
      if (!m.result) continue;
      const actual = this.actualOutcome(m.result.homeScore, m.result.awayScore);

      for (const p of m.predictions) {
        const sel = p.selection as Selection;
        if (!data[sel]) continue;
        data[sel].preds.push(Number(p.modelProbability));
        data[sel].outcomes.push(sel === actual ? 1 : 0);
      }
    }

    const cal: CalibrationData = {
      home: fitPlattScaling(data.Home.preds, data.Home.outcomes),
      draw: fitPlattScaling(data.Draw.preds, data.Draw.outcomes),
      away: fitPlattScaling(data.Away.preds, data.Away.outcomes),
      sampleSize: matches.length,
    };

    this.cache.set(modelName, cal);
    this.logger.log(
      `Calibración ${modelName}: a_H=${cal.home.a.toFixed(3)} b_H=${cal.home.b.toFixed(3)}, ` +
        `a_D=${cal.draw.a.toFixed(3)} b_D=${cal.draw.b.toFixed(3)}, ` +
        `a_A=${cal.away.a.toFixed(3)} b_A=${cal.away.b.toFixed(3)} ` +
        `(${matches.length} partidos)`,
    );

    return cal;
  }

  /**
   * Calibra probabilidades 1X2 para un modelo.
   * Si no hay parámetros entrenados, devuelve las probabilidades sin cambio.
   */
  apply(
    modelName: string,
    probs: MatchOutcomeProbabilities,
  ): MatchOutcomeProbabilities {
    const cal = this.cache.get(modelName);
    if (!cal) return probs;

    const calibrated = calibrateOutcome(probs, cal.home, cal.draw, cal.away);

    // Sanity check: si la calibración distorsiona demasiado (cualquier prob < 3%
    // o la diferencia máxima entre raw y calibrado > 25pp), descartarla.
    const minProb = Math.min(
      calibrated.homeWin,
      calibrated.draw,
      calibrated.awayWin,
    );
    const maxDiff = Math.max(
      Math.abs(calibrated.homeWin - probs.homeWin),
      Math.abs(calibrated.draw - probs.draw),
      Math.abs(calibrated.awayWin - probs.awayWin),
    );
    if (minProb < 0.03 || maxDiff > 0.25) {
      this.logger.warn(
        `Calibración ${modelName} descartada: distorsión excesiva (minP=${minProb.toFixed(3)}, maxDiff=${maxDiff.toFixed(3)})`,
      );
      return probs;
    }

    return calibrated;
  }

  /** Entrena calibración para todos los modelos con historial. */
  async trainAll(): Promise<string[]> {
    const modelNames = await this.prisma.prediction.findMany({
      where: { market: '1X2' },
      select: { modelName: true },
      distinct: ['modelName'],
    });

    const trained: string[] = [];
    for (const { modelName } of modelNames) {
      const result = await this.train(modelName);
      if (result) trained.push(modelName);
    }
    return trained;
  }

  private actualOutcome(homeScore: number, awayScore: number): Selection {
    if (homeScore > awayScore) return 'Home';
    if (homeScore < awayScore) return 'Away';
    return 'Draw';
  }
}
