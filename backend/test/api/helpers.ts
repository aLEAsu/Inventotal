import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma.service';
import { configureApp } from '../../src/main';
import { hashPassword } from '../../src/modules/auth/auth.service';
import { seedBase } from '../../prisma/seed';

export const TEST_PASSWORD = process.env.DEMO_PASSWORD ?? 'Prueba-Segura-2026!';

export async function bootApp() {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

export async function createUsers(prisma: PrismaService) {
  await seedBase(prisma);
  const area1 = await prisma.area.create({ data: { code: 'UCI', name: 'UCI Adultos' } });
  const area2 = await prisma.area.create({ data: { code: 'URG', name: 'Urgencias' } });
  const area3 = await prisma.area.create({ data: { code: 'SGE', name: 'Servicios generales' } });
  const hash = await hashPassword(TEST_PASSWORD);
  const role = async (code: string) => (await prisma.role.findUniqueOrThrow({ where: { code } })).id;
  const mk = async (username: string, r: string, opts: { tech?: boolean; areas?: string[] } = {}) =>
    prisma.user.create({ data: { username, fullName: `Usuario ${username}`, roleId: await role(r), passwordHash: hash, isTechnicalStaff: !!opts.tech, areas: { create: (opts.areas ?? []).map((areaId) => ({ areaId })) } } });
  const users = {
    admin: await mk('t.admin', 'ADMIN', { tech: true }),
    coord: await mk('t.coord', 'COORDINADOR', { tech: true }),
    coord2: await mk('t.coord2', 'COORDINADOR', { tech: false }),
    resp: await mk('t.resp', 'RESPONSABLE_AREA', { areas: [area1.id] }),
    tech: await mk('t.tecnico', 'TECNICO', { tech: true }),
    req: await mk('t.solicitante', 'SOLICITANTE'),
    auditor: await mk('t.auditor', 'AUDITOR'),
  };
  return { users, areas: { uci: area1, urg: area2, sge: area3 } };
}

export class Client {
  agent: ReturnType<typeof request.agent>;
  csrf = '';
  constructor(app: INestApplication) {
    this.agent = request.agent(app.getHttpServer());
  }
  async login(username: string, password = TEST_PASSWORD) {
    const r = await this.agent.post('/api/v1/auth/login').send({ username, password });
    if (r.status === 200) this.csrf = r.body.csrfToken;
    return r;
  }
  get(url: string) {
    return this.agent.get(`/api/v1${url}`);
  }
  post(url: string, body: object = {}) {
    return this.agent.post(`/api/v1${url}`).set('X-CSRF-Token', this.csrf).send(body);
  }
  patch(url: string, body: object = {}) {
    return this.agent.patch(`/api/v1${url}`).set('X-CSRF-Token', this.csrf).send(body);
  }
  put(url: string, body: object = {}) {
    return this.agent.put(`/api/v1${url}`).set('X-CSRF-Token', this.csrf).send(body);
  }
  delete(url: string, body: object = {}) {
    return this.agent.delete(`/api/v1${url}`).set('X-CSRF-Token', this.csrf).send(body);
  }
  upload(url: string, fields: Record<string, string>, file: Buffer, filename: string, contentType: string) {
    let r = this.agent.post(`/api/v1${url}`).set('X-CSRF-Token', this.csrf);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach('file', file, { filename, contentType });
  }
}

/** Parser binario para respuestas PDF/XLSX en supertest */
export function binaryParser(res: NodeJS.ReadableStream & { setEncoding: (e: string) => void; on: (e: string, cb: (c?: unknown) => void) => void }, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c) => chunks.push(c as Buffer));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}
