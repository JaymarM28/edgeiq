import { Global, Module } from '@nestjs/common';
import { PlayersModule } from '../players/players.module';
import { DigestService } from './digest.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsScheduler } from './notifications.scheduler';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  imports: [PlayersModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    DigestService,
    NotificationsScheduler,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
