import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SYNC_ALL_JOB, INGESTION_QUEUE } from './ingestion.constants';
import { IngestionService } from './ingestion.service';

@Processor(INGESTION_QUEUE)
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(private readonly ingestionService: IngestionService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    this.logger.log(`Procesando job "${job.name}" (${job.id})`);

    switch (job.name) {
      case SYNC_ALL_JOB:
        return this.ingestionService.syncAll();
      default:
        throw new Error(`Job desconocido: ${job.name}`);
    }
  }
}
