import { InjectQueue, BullModule } from '@nestjs/bullmq';
import { Global, Module, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PlayersModule } from '../players/players.module';
import { DigestService } from './digest.service';
import {
  DAILY_DIGEST_JOB,
  NOTIFICATIONS_QUEUE,
} from './notifications.constants';
import { NotificationsController } from './notifications.controller';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  imports: [
    PlayersModule,
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, DigestService, NotificationsProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule implements OnModuleInit {
  constructor(
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    // Corre 2h después de la ingesta diaria (06:00 UTC) y 30 min después
    // de generar predicciones (07:30 UTC), para que el digest tenga datos
    // frescos. jobId fijo evita duplicar el repeatable job si el proceso
    // se reinicia.
    await this.queue.add(
      DAILY_DIGEST_JOB,
      {},
      {
        repeat: { pattern: '0 8 * * *' },
        jobId: 'daily-digest',
      },
    );
  }
}
