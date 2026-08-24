import { Module } from '@nestjs/common';
import { BacktestingController } from './backtesting.controller';
import { BacktestingService } from './backtesting.service';

@Module({
  controllers: [BacktestingController],
  providers: [BacktestingService],
  exports: [BacktestingService],
})
export class BacktestingModule {}
