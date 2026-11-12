import 'dotenv/config';
import { INestApplication, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

process.env.TZ = 'America/Bogota';

/** Configuración compartida entre el servidor y las pruebas de integración */
export function configureApp(app: INestApplication) {
  const exp = app as NestExpressApplication;
  exp.set('trust proxy', 1); // detrás de Nginx: IP real del cliente
  exp.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } }));
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({ origin: (process.env.CORS_ORIGIN ?? '').split(',').filter(Boolean), credentials: true });
  return app;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  app.useBodyParser('json', { limit: '2mb' });
  if (process.env.SWAGGER_ENABLED !== 'false') {
    const cfg = new DocumentBuilder()
      .setTitle('SIGM — API')
      .setDescription('Sistema Integral de Gestión de Mantenimiento. Autenticación por cookie de sesión HttpOnly + cabecera X-CSRF-Token en operaciones de escritura.')
      .setVersion('1.0')
      .addCookieAuth('sigm_session')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, cfg), { jsonDocumentUrl: 'api/docs-json' });
  }
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

// Arranca al ejecutarse directamente (node dist/main.js) o en Vercel, cuyo lanzador importa este
// archivo como entrada (ahí require.main no es este módulo). Las pruebas lo importan sin arrancarlo.
if (require.main === module || process.env.VERCEL) {
  bootstrap().catch((e) => {
    // Visible en los logs del despliegue (Vercel → Logs) en vez de un fallo silencioso
    console.error('[SIGM] La API no pudo iniciar:', e);
    process.exit(1);
  });
}
