import { Module } from '@nestjs/common';
import { OddsController } from './odds.controller';
import { OddsService } from './odds.service';

@Module({
  controllers: [OddsController],
  providers: [OddsService],
})
export class OddsModule {}
