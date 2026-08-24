import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PredictionsService } from './predictions.service';

@Controller('predictions')
export class PredictionsController {
  constructor(private readonly predictionsService: PredictionsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('generate')
  generate(
    @Query('matchId') matchId?: string,
    @Query('leagueId') leagueId?: string,
  ) {
    return matchId
      ? this.predictionsService.generateForMatch(matchId)
      : this.predictionsService.generateForUpcoming(leagueId);
  }

  /** Progreso del análisis en curso (polling). */
  @Get('generate/progress')
  getProgress() {
    return this.predictionsService.progress;
  }

  /** Público — el dashboard lo necesita sin auth. */
  @Get('value-bets')
  valueBets(@Query('minEdge') minEdge?: string) {
    return this.predictionsService.getValueBets(
      minEdge ? Number(minEdge) : undefined,
    );
  }
}
