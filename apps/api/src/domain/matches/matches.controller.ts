import { Controller, Get, Query } from '@nestjs/common';
import { MatchesService } from './matches.service';

@Controller('matches')
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get('upcoming')
  upcoming(@Query('leagueId') leagueId?: string) {
    return this.matchesService.findUpcoming(leagueId);
  }

  @Get('recent')
  recent(@Query('leagueId') leagueId?: string, @Query('limit') limit?: string) {
    return this.matchesService.findRecent(
      leagueId,
      limit ? Number(limit) : undefined,
    );
  }
}
