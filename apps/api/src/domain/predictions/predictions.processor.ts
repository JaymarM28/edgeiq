import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { GENERATE_ALL_JOB, PREDICTIONS_QUEUE } from './predictions.constants';
import { PredictionsService } from './predictions.service';

@Processor(PREDICTIONS_QUEUE)
export class PredictionsProcessor extends WorkerHost {
  private readonly logger = new Logger(PredictionsProcessor.name);

  constructor(private readonly predictionsService: PredictionsService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    this.logger.log(`Procesando job "${job.name}" (${job.id})`);

    switch (job.name) {
      case GENERATE_ALL_JOB:
        return this.predictionsService.generateForUpcoming();
      default:
        throw new Error(`Job desconocido: ${job.name}`);
    }
  }
}
