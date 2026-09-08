import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IngestionService } from './ingestion.service';

@Injectable()
export class IngestionScheduler {
  private readonly logger = new Logger(IngestionScheduler.name);

  constructor(private readonly ingestionService: IngestionService) {}

  /** Sincronización diaria 06:00 UTC. */
  @Cron('0 6 * * *', { timeZone: 'UTC' })
  async handleDailySync() {
    this.logger.log('Corriendo sync-all programado');
    await this.ingestionService.syncAll();
  }
}
