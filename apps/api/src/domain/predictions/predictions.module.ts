import { Module } from '@nestjs/common';
import { PredictionsController } from './predictions.controller';
import { PredictionsService } from './predictions.service';
import { ExplanationsService } from './explanations.service';
import { CalibrationService } from './calibration.service';
import { PredictionsScheduler } from './predictions.scheduler';

@Module({
  controllers: [PredictionsController],
  providers: [
    PredictionsService,
    ExplanationsService,
    CalibrationService,
    PredictionsScheduler,
  ],
})
export class PredictionsModule {}
