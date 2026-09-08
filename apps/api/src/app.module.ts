import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { ClaudeModule } from './core/integrations/claude/claude.module';
import { AnalysisModule } from './domain/analysis/analysis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        // Límite global por defecto: 100 req/min por IP. Endpoints
        // sensibles (auth) usan @Throttle con un límite más estricto.
        ttl: 60_000,
        limit: 100,
      },
    ]),
    GroqModule,
    ClaudeModule,
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
