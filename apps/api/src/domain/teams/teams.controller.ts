import { Controller, Get, Param, Query } from '@nestjs/common';
import { TeamsService } from './teams.service';

@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get('search')
  search(@Query('q') query: string) {
    return this.teamsService.search(query ?? '');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.teamsService.getTeamDetail(id);
  }
}
