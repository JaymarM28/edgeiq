import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  DAILY_DIGEST_JOB,
  NOTIFICATIONS_QUEUE,
} from './notifications.constants';
import { DigestService } from './digest.service';
import { NotificationsService } from './notifications.service';

@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly digestService: DigestService,
    private readonly notificationsService: NotificationsService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    this.logger.log(`Procesando job "${job.name}" (${job.id})`);

    switch (job.name) {
      case DAILY_DIGEST_JOB: {
        const digest = await this.digestService.build();
        return this.notificationsService.sendDailyDigest(digest);
      }
      default:
        throw new Error(`Job desconocido: ${job.name}`);
    }
  }
}
