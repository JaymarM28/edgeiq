import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return {
      status: 'ok',
      service: 'edgeiq-api',
      timestamp: new Date().toISOString(),
    };
  }
}
