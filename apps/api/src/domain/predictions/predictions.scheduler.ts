import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PredictionsService } from './predictions.service';

@Injectable()
export class PredictionsScheduler {
  private readonly logger = new Logger(PredictionsScheduler.name);

  constructor(private readonly predictionsService: PredictionsService) {}

  /** Corre 1.5h después de la ingesta diaria (06:00 UTC) para darle margen
   * a que termine de traer datos frescos antes de generar predicciones. */
  @Cron('30 7 * * *', { timeZone: 'UTC' })
  async handleDailyGenerate() {
    this.logger.log('Corriendo generateForUpcoming programado');
    await this.predictionsService.generateForUpcoming();
  }
}
