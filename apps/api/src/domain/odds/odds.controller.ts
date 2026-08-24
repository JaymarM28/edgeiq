import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { OddsService } from './odds.service';

@Controller('odds')
export class OddsController {
  constructor(private readonly oddsService: OddsService) {}

  @Get('match/:matchId')
  matchOdds(
    @Param('matchId') matchId: string,
    @Query('market') market?: string,
  ) {
    return this.oddsService.getMatchOdds(matchId, market);
  }

  @Get('movement/:matchId')
  movement(
    @Param('matchId') matchId: string,
    @Query('market') market?: string,
    @Query('selection') selection?: string,
  ) {
    if (!market || !selection) {
      throw new BadRequestException('market y selection son requeridos');
    }
    return this.oddsService.getLineMovement(matchId, market, selection);
  }
}
