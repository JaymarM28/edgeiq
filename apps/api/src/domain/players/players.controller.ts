import { Controller, Get, Param, Query } from '@nestjs/common';
import { PlayersService } from './players.service';

@Controller('players')
export class PlayersController {
  constructor(private readonly playersService: PlayersService) {}

  @Get('search')
  search(@Query('q') query: string, @Query('leagueId') leagueId?: string) {
    return this.playersService.search(query ?? '', leagueId);
  }

  @Get('top')
  top(
    @Query('stat') stat?: 'goals' | 'assists' | 'yellowCards' | 'shotsOn',
    @Query('limit') limit?: string,
  ) {
    return this.playersService.topPlayers(
      stat,
      limit ? Number(limit) : undefined,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.playersService.getPlayerStats(id);
  }
}
