import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { ResultsService } from './results.service';

@Controller('results')
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Get('h2h')
  headToHead(
    @Query('teamA') teamA: string,
    @Query('teamB') teamB: string,
    @Query('limit') limit?: string,
  ) {
    if (!teamA || !teamB) {
      throw new BadRequestException('teamA y teamB son requeridos');
    }
    return this.resultsService.getHeadToHead(
      teamA,
      teamB,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('team/:teamId')
  teamResults(@Param('teamId') teamId: string, @Query('limit') limit?: string) {
    return this.resultsService.getTeamResults(
      teamId,
      limit ? Number(limit) : undefined,
    );
  }
}
