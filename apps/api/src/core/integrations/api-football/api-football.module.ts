import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApiFootballService } from './api-football.service';

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        baseURL: config.get<string>(
          'API_FOOTBALL_BASE_URL',
          'https://v3.football.api-sports.io',
        ),
        timeout: 10_000,
        headers: {
          'x-apisports-key': config.getOrThrow<string>('API_FOOTBALL_KEY'),
        },
      }),
    }),
  ],
  providers: [ApiFootballService],
  exports: [ApiFootballService],
})
export class ApiFootballModule {}
