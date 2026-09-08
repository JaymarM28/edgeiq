import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DigestService } from './digest.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsScheduler {
  private readonly logger = new Logger(NotificationsScheduler.name);

  constructor(
    private readonly digestService: DigestService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Corre 2h después de la ingesta diaria (06:00 UTC) y 30 min después de
   * generar predicciones (07:30 UTC), para que el digest tenga datos frescos. */
  @Cron('0 8 * * *', { timeZone: 'UTC' })
  async handleDailyDigest() {
    this.logger.log('Corriendo daily-digest programado');
    const digest = await this.digestService.build();
    await this.notificationsService.sendDailyDigest(digest);
  }
}
