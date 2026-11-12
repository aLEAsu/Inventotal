import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators';
import { describeDbError, PrismaService } from '../../common/prisma.service';

@ApiTags('Salud')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  async health() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.prisma.$queryRaw`SELECT 1 FROM "users" LIMIT 1`;
      this.prisma.connectionProblem = null;
      return { status: 'ok', database: 'ok', time: new Date().toISOString() };
    } catch (e) {
      const missingUrl = this.prisma.connectionProblem?.startsWith('DATABASE_URL');
      const reason = missingUrl ? this.prisma.connectionProblem : describeDbError(e);
      throw new ServiceUnavailableException({ status: 'error', database: 'unavailable', reason });
    }
  }
}
