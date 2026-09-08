import { Module } from '@nestjs/common';
import { ApiFootballModule } from '../../core/integrations/api-football/api-football.module';
import { IngestionController } from './ingestion.controller';
import { IngestionScheduler } from './ingestion.scheduler';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [ApiFootballModule],
  controllers: [IngestionController],
  providers: [IngestionService, IngestionScheduler],
})
export class IngestionModule {}
