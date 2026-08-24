import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class LeaguesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.league.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, country: true, externalId: true },
    });
  }
}
