import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnalysisService } from './analysis.service';
import { BacktestingService } from '../backtesting/backtesting.service';

@Controller('analysis')
export class AnalysisController {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly backtesting: BacktestingService,
  ) {}

  /** Análisis pre-partido — público (el frontend lo pide). */
  @Get('match/:matchId/pre')
  async preMatch(@Param('matchId') matchId: string) {
    const content = await this.analysis.analyzePreMatch(matchId);
    return { matchId, type: 'pre_match', content };
  }

  /** Análisis post-partido — público. */
  @Get('match/:matchId/post')
  async postMatch(@Param('matchId') matchId: string) {
    const content = await this.analysis.analyzePostMatch(matchId);
    return { matchId, type: 'post_match', content };
  }

  /** Meta-análisis del backtesting — público. */
  @Get('backtesting')
  async backtestAnalysis() {
    const report = await this.backtesting.generateReport();
    const content = await this.analysis.analyzeBacktest(report);
    return {
      type: 'backtest_analysis',
      content,
      matchesEvaluated: report.totalMatchesEvaluated,
    };
  }

  /** Genera análisis post-partido pendientes (batch) — protegido. */
  @UseGuards(JwtAuthGuard)
  @Post('post-match/generate')
  async generatePostMatch() {
    const count = await this.analysis.generatePendingPostMatchAnalyses();
    return { generated: count };
  }
}
