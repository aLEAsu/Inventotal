import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuditService } from './common/audit.service';
import { CountersService } from './common/counters.service';
import { AllExceptionsFilter } from './common/errors.filter';
import { PrismaService } from './common/prisma.service';
import { SettingsService } from './common/settings.service';
import { StorageService } from './common/storage.service';
import { AssetsController } from './modules/assets/assets.controller';
import { AssetsService } from './modules/assets/assets.service';
import { AuditController } from './modules/audit/audit.controller';
import { AuthController } from './modules/auth/auth.controller';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthService } from './modules/auth/auth.service';
import { CatalogController } from './modules/catalog/catalog.controller';
import { DashboardController } from './modules/dashboard/dashboard.controller';
import { IndicatorsService } from './modules/dashboard/indicators.service';
import { DocumentsController } from './modules/documents/documents.controller';
import { FailuresController } from './modules/failures/failures.controller';
import { FailuresService } from './modules/failures/failures.service';
import { HealthController } from './modules/health/health.controller';
import { LifecycleController } from './modules/lifecycle/lifecycle.controller';
import { LifecycleService } from './modules/lifecycle/lifecycle.service';
import { PlanExportService } from './modules/plans/plan-export.service';
import { PlansController } from './modules/plans/plans.controller';
import { PlansService } from './modules/plans/plans.service';
import { ProceduresController } from './modules/procedures/procedures.controller';
import { MaintenanceGroupsController } from './modules/programs/maintenance-groups.controller';
import { ProgramsController } from './modules/programs/programs.controller';
import { ReportsController } from './modules/reports/reports.controller';
import { ReportsService } from './modules/reports/reports.service';
import { SuppliersController } from './modules/suppliers/suppliers.controller';
import { UsersController } from './modules/users/users.controller';
import { WorkOrdersController } from './modules/workorders/workorders.controller';
import { WorkOrdersService } from './modules/workorders/workorders.service';

const isTest = process.env.NODE_ENV === 'test';

@Global()
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: isTest ? 'silent' : process.env.LOG_LEVEL ?? 'info',
        transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
        redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
        customProps: (req) => ({ userId: (req as unknown as { user?: { id: string } }).user?.id }),
        autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      },
    }),
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: isTest ? 100_000 : 600 }] }),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    HealthController, AuthController, UsersController, CatalogController, AssetsController, ProgramsController, MaintenanceGroupsController,
    PlansController, WorkOrdersController, FailuresController, DocumentsController, SuppliersController,
    LifecycleController, DashboardController, AuditController, ProceduresController, ReportsController,
  ],
  providers: [
    PrismaService, AuditService, CountersService, SettingsService, StorageService, AuthService, AssetsService,
    PlansService, PlanExportService, WorkOrdersService, FailuresService, LifecycleService, IndicatorsService, ReportsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [PrismaService, AuditService, CountersService, SettingsService, StorageService],
})
export class AppModule {}
