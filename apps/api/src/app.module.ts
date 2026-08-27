import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import Redis from 'ioredis';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './core/prisma/prisma.module';
import { LeaguesModule } from './domain/leagues/leagues.module';
import { TeamsModule } from './domain/teams/teams.module';
import { MatchesModule } from './domain/matches/matches.module';
import { PlayersModule } from './domain/players/players.module';
import { OddsModule } from './domain/odds/odds.module';
import { PredictionsModule } from './domain/predictions/predictions.module';
import { ResultsModule } from './domain/results/results.module';
import { NotificationsModule } from './domain/notifications/notifications.module';
import { UsersModule } from './domain/users/users.module';
import { AuthModule } from './domain/auth/auth.module';
import { IngestionModule } from './domain/ingestion/ingestion.module';
import { BacktestingModule } from './domain/backtesting/backtesting.module';
import { GroqModule } from './core/integrations/groq/groq.module';
import { AnalysisModule } from './domain/analysis/analysis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        // Límite global por defecto: 100 req/min por IP. Endpoints
        // sensibles (auth) usan @Throttle con un límite más estricto.
        ttl: 60_000,
        limit: 100,
      },
    ]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: new Redis(
          config.get<string>('REDIS_URL', 'redis://localhost:6379'),
          {
            maxRetriesPerRequest: null,
          },
        ),
      }),
    }),
    GroqModule,
    PrismaModule,
    LeaguesModule,
    TeamsModule,
    MatchesModule,
    PlayersModule,
    OddsModule,
    PredictionsModule,
    ResultsModule,
    NotificationsModule,
    UsersModule,
    AuthModule,
    IngestionModule,
    BacktestingModule,
    AnalysisModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
