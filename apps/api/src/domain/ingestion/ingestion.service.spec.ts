import { Test, TestingModule } from '@nestjs/testing';
import { IngestionService } from './ingestion.service';
import { ApiFootballService } from '../../core/integrations/api-football/api-football.service';
import { PrismaService } from '../../core/prisma/prisma.service';

describe('IngestionService', () => {
  let service: IngestionService;
  let apiFootball: { resolveLeague: jest.Mock };
  let prisma: Record<string, unknown>;

  beforeEach(async () => {
    apiFootball = { resolveLeague: jest.fn() };
    prisma = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IngestionService,
        { provide: ApiFootballService, useValue: apiFootball },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(IngestionService);
  });

  describe('syncAll', () => {
    it('reporta error sin lanzar excepción cuando la liga no se puede resolver en API-Football', async () => {
      apiFootball.resolveLeague.mockResolvedValue(null);

      const results = await service.syncAll({ leagueId: 999 });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        leagueId: 999,
        season: null,
        fixtures: { error: 'Liga no encontrada en API-Football' },
        odds: { error: 'Liga no encontrada en API-Football' },
      });
    });

    it('sincroniza solo la liga solicitada cuando se pasa leagueId, ignorando TRACKED_LEAGUES', async () => {
      apiFootball.resolveLeague.mockResolvedValue(null);

      await service.syncAll({ leagueId: 140 });

      expect(apiFootball.resolveLeague).toHaveBeenCalledTimes(1);
      expect(apiFootball.resolveLeague).toHaveBeenCalledWith({ id: 140 });
    });
  });
});
