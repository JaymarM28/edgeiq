import { InjectQueue, BullModule } from '@nestjs/bullmq';
import { Module, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { ApiFootballModule } from '../../core/integrations/api-football/api-football.module';
import { INGESTION_QUEUE, SYNC_ALL_JOB } from './ingestion.constants';
import { IngestionController } from './ingestion.controller';
import { IngestionProcessor } from './ingestion.processor';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [
    ApiFootballModule,
    BullModule.registerQueue({ name: INGESTION_QUEUE }),
  ],
  controllers: [IngestionController],
  providers: [IngestionService, IngestionProcessor],
})
export class IngestionModule implements OnModuleInit {
  constructor(@InjectQueue(INGESTION_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    // Sincronización diaria 06:00. jobId fijo evita duplicar el repeatable
    // job si el proceso se reinicia.
    await this.queue.add(
      SYNC_ALL_JOB,
      {},
      {
        repeat: { pattern: '0 6 * * *' },
        jobId: 'daily-sync',
      },
    );
  }
}
