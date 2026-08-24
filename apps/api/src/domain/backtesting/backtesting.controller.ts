import { Controller, Get, Query } from '@nestjs/common';
import { BacktestingService, BacktestReport } from './backtesting.service';

@Controller('backtesting')
export class BacktestingController {
  constructor(private readonly svc: BacktestingService) {}

  @Get()
  async getReport(
    @Query('leagueId') leagueId?: string,
    @Query('season') season?: string,
    @Query('modelName') modelName?: string,
  ): Promise<BacktestReport> {
    return this.svc.generateReport({
      leagueId: leagueId || undefined,
      season: season || undefined,
      modelName: modelName || undefined,
    });
  }
}
