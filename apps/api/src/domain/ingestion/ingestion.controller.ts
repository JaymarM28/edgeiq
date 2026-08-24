import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IngestionService } from './ingestion.service';

@Controller('ingestion')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @UseGuards(JwtAuthGuard)
  @Post('sync')
  sync(@Query('leagueId') leagueId?: string, @Query('season') season?: string) {
    return this.ingestionService.syncAll({
      leagueId: leagueId ? Number(leagueId) : undefined,
      season: season ? Number(season) : undefined,
    });
  }
}
