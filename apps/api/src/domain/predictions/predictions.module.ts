import { InjectQueue, BullModule } from '@nestjs/bullmq';
import { Module, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PredictionsController } from './predictions.controller';
import { PredictionsService } from './predictions.service';
import { ExplanationsService } from './explanations.service';
import { CalibrationService } from './calibration.service';
import { PredictionsProcessor } from './predictions.processor';
import { GENERATE_ALL_JOB, PREDICTIONS_QUEUE } from './predictions.constants';

@Module({
  imports: [BullModule.registerQueue({ name: PREDICTIONS_QUEUE })],
  controllers: [PredictionsController],
  providers: [
    PredictionsService,
    ExplanationsService,
    CalibrationService,
    PredictionsProcessor,
  ],
})
export class PredictionsModule implements OnModuleInit {
  constructor(@InjectQueue(PREDICTIONS_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    // Corre 1.5h después de la ingesta diaria (06:00 UTC) para darle margen
    // a que termine de traer datos frescos antes de generar predicciones.
    // jobId fijo evita duplicar el repeatable job si el proceso se reinicia.
    await this.queue.add(
      GENERATE_ALL_JOB,
      {},
      {
        repeat: { pattern: '30 7 * * *' },
        jobId: 'daily-generate',
      },
    );
  }
}
