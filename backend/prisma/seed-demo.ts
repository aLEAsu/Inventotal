/**
 * DATOS DE DEMOSTRACIÓN — claramente separados de producción.
 *   DEMO_PASSWORD='...' npm run seed:demo
 * - Se niega a ejecutarse si NODE_ENV=production.
 * - Todos los registros de demostración usan el prefijo "DEMO" en códigos o nombres.
 * - Alcance: equipos de cómputo y sistemas (TI).
 * - Las periodicidades son ILUSTRATIVAS y no constituyen recomendación técnica.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import type { AuthUser } from '../src/common/auth.types';
import { currentYearBogota } from '../src/common/dates';
import { PrismaService } from '../src/common/prisma.service';
import { hashPassword, validatePasswordPolicy } from '../src/modules/auth/auth.service';
import { PlansService } from '../src/modules/plans/plans.service';
import { seedBase } from './seed';

const DEMO_NOTE = 'DEMO: periodicidad ilustrativa para demostración. Debe sustituirse por la definida según recomendaciones del fabricante, condiciones de uso e historial de fallas.';

type Tech = {
  hostname?: string; ipAddress?: string; macAddress?: string; operatingSystem?: string; softwareVersion?: string;
  processor?: string; ramGb?: number; storageGb?: number; endUser?: string; licenseExpiresAt?: string;
};
type Def = [cat: string, name: string, brand: string, model: string, area: string, crit: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAJA', sup: 'A' | 'B' | 'C', loc: string, freq: string, resp: string, tech: Tech];

const HW_CHECKLIST = [
  { id: 'c1', text: 'Respaldo de información del usuario (si aplica)', required: false },
  { id: 'c2', text: 'Limpieza física interna y externa', required: true },
  { id: 'c3', text: 'Revisión de discos, memoria y temperatura', required: true },
  { id: 'c4', text: 'Actualizaciones de sistema operativo, firmware y antivirus', required: true },
  { id: 'c5', text: 'Prueba de funcionamiento con el usuario', required: true },
  { id: 'c6', text: 'Etiqueta de mantenimiento actualizada', required: false },
];
const SW_CHECKLIST = [
  { id: 'c1', text: 'Servicio disponible y con desempeño normal', required: true },
  { id: 'c2', text: 'Registros de eventos revisados sin alertas críticas', required: true },
  { id: 'c3', text: 'Actualizaciones aprobadas aplicadas', required: true },
  { id: 'c4', text: 'Respaldo verificado (prueba de restauración)', required: true },
];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('La semilla de demostración no puede ejecutarse en producción');
  const pwd = process.env.DEMO_PASSWORD;
  if (!pwd) throw new Error('Defina DEMO_PASSWORD (solo entornos de desarrollo/pruebas)');
  const errs = validatePasswordPolicy(pwd, 'demo');
  if (errs.length) throw new Error(`DEMO_PASSWORD no cumple la política: ${errs.join('; ')}`);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  try {
    await seedBase(prisma);
    if (await prisma.user.findUnique({ where: { username: 'demo.coordinador' } })) {
      console.log('Los datos de demostración ya existen.');
      return;
    }
    await prisma.setting.update({ where: { key: 'institution.name' }, data: { value: 'Clínica Demostración SIGM (datos ficticios)' } });

    const areaDefs = [
      ['URG', 'Urgencias'], ['UCI', 'UCI Adultos'], ['HOS', 'Hospitalización'], ['LAB', 'Laboratorio clínico'],
      ['IMG', 'Imagenología'], ['ADM', 'Administración y sistemas'],
    ];
    const areas: Record<string, string> = {};
    for (const [code, name] of areaDefs) areas[code] = (await prisma.area.create({ data: { code, name } })).id;
    const locs: Record<string, string> = {};
    const locDefs: [string, string, string, string][] = [
      ['URG-01', 'Estación de urgencias', 'URG', '1'], ['URG-02', 'Admisiones y triage', 'URG', '1'], ['UCI-01', 'Estación de enfermería UCI', 'UCI', '3'],
      ['HOS-01', 'Hospitalización piso 4', 'HOS', '4'], ['LAB-01', 'Laboratorio - área técnica', 'LAB', '1'], ['IMG-01', 'Sala de lectura', 'IMG', '1'],
      ['ADM-01', 'Centro de datos', 'ADM', 'Sótano'], ['ADM-02', 'Oficina de sistemas', 'ADM', '2'],
    ];
    for (const [code, name, area, floor] of locDefs) locs[code] = (await prisma.location.create({ data: { code, name, areaId: areas[area], floor, building: 'Sede principal' } })).id;

    const role = async (code: string) => (await prisma.role.findUniqueOrThrow({ where: { code } })).id;
    const hash = await hashPassword(pwd);
    const userDefs: [string, string, string, boolean, string[]][] = [
      ['demo.admin', 'Administrador Demo', 'ADMIN', true, []],
      ['demo.coordinador', 'Coordinadora de Sistemas Demo', 'COORDINADOR', true, []],
      ['demo.responsable', 'Responsable UCI y Urgencias Demo', 'RESPONSABLE_AREA', false, ['UCI', 'URG']],
      ['demo.tecnico', 'Técnico de Soporte TI Demo', 'TECNICO', true, []],
      ['demo.tecnico2', 'Técnico de Redes Demo', 'TECNICO', false, []],
      ['demo.solicitante', 'Enfermera Jefe Demo', 'SOLICITANTE', false, []],
      ['demo.auditor', 'Auditora de Calidad Demo', 'AUDITOR', false, []],
    ];
    const users: Record<string, string> = {};
    for (const [username, fullName, r, tech, ar] of userDefs) {
      users[username] = (await prisma.user.create({
        data: { username, fullName, roleId: await role(r), passwordHash: hash, isTechnicalStaff: tech, areas: { create: ar.map((a) => ({ areaId: areas[a] })) } },
      })).id;
    }
    const year = currentYearBogota();
    const sup = {
      A: await prisma.supplier.create({ data: { name: 'DEMO Soluciones TI S.A.S.', nit: '900000001-1', type: 'EXTERNO', contactName: 'Contacto demo', email: 'contacto@demo.invalid', phone: '6010000000', specialty: 'Mantenimiento de equipos de cómputo', services: 'Preventivo y correctivo de computadores, impresoras y periféricos' } }),
      B: await prisma.supplier.create({ data: { name: 'DEMO Redes y Datacenter Ltda.', nit: '900000002-2', type: 'EXTERNO', specialty: 'Redes, servidores y UPS', services: 'Soporte de infraestructura de red, servidores y respaldo eléctrico de TI' } }),
      C: await prisma.supplier.create({ data: { name: 'Área de sistemas (interno)', type: 'INTERNO', specialty: 'Soporte técnico y sistemas de información' } }),
    };
    await prisma.contract.create({ data: { supplierId: sup.A.id, number: `DEMO-CT-${year}-001`, object: 'Mantenimiento preventivo y correctivo de equipos de cómputo y periféricos (demostración)', startDate: new Date(`${year}-01-01T00:00:00Z`), endDate: new Date(`${year}-12-31T00:00:00Z`), value: 60000000 } });
    await prisma.contract.create({ data: { supplierId: sup.B.id, number: `DEMO-CT-${year}-002`, object: 'Soporte de red, servidores y UPS (demostración)', startDate: new Date(`${year}-02-01T00:00:00Z`), endDate: new Date(`${year + 1}-01-31T00:00:00Z`), value: 45000000 } });

    const cat = async (code: string) => (await prisma.assetCategory.findUniqueOrThrow({ where: { code } })).id;
    const defs: Def[] = [
      ['SRV', 'Servidor sistema de información clínico', 'DemoServ', 'SV-1', 'ADM', 'CRITICA', 'B', 'ADM-01', 'TRIMESTRAL', 'demo.tecnico', { hostname: 'SRV-HIS-01', ipAddress: '10.0.10.10', operatingSystem: 'Linux (demo)', processor: '2x CPU 16 núcleos', ramGb: 128, storageGb: 4000 }],
      ['SRV', 'Servidor de base de datos', 'DemoServ', 'SV-2', 'ADM', 'CRITICA', 'B', 'ADM-01', 'TRIMESTRAL', 'demo.tecnico', { hostname: 'SRV-DB-01', ipAddress: '10.0.10.11', operatingSystem: 'Linux (demo)', ramGb: 256, storageGb: 8000 }],
      ['SRV', 'Almacenamiento NAS de respaldos', 'DemoStor', 'NAS-8', 'ADM', 'ALTA', 'B', 'ADM-01', 'SEMESTRAL', 'demo.tecnico', { hostname: 'NAS-BKP-01', ipAddress: '10.0.10.20', storageGb: 32000 }],
      ['RED', 'Switch de núcleo', 'DemoNet', 'SW-48', 'ADM', 'CRITICA', 'B', 'ADM-01', 'SEMESTRAL', 'demo.tecnico2', { hostname: 'SW-CORE-01', ipAddress: '10.0.0.1', macAddress: '00:1A:2B:3C:4D:01' }],
      ['RED', 'Firewall perimetral', 'DemoSec', 'FW-200', 'ADM', 'CRITICA', 'B', 'ADM-01', 'TRIMESTRAL', 'demo.tecnico2', { hostname: 'FW-01', ipAddress: '10.0.0.254', softwareVersion: 'Firmware 7.x (demo)' }],
      ['RED', 'Switch de acceso UCI', 'DemoNet', 'SW-24', 'UCI', 'ALTA', 'B', 'UCI-01', 'SEMESTRAL', 'demo.tecnico2', { hostname: 'SW-UCI-01', ipAddress: '10.0.3.2' }],
      ['RED', 'Punto de acceso inalámbrico urgencias', 'DemoWifi', 'AP-6', 'URG', 'MEDIA', 'B', 'URG-01', 'ANUAL', 'demo.tecnico2', { hostname: 'AP-URG-01', ipAddress: '10.0.1.30' }],
      ['CMP', 'Computador estación de enfermería UCI', 'DemoPC', 'PC-5', 'UCI', 'ALTA', 'A', 'UCI-01', 'SEMESTRAL', 'demo.tecnico', { hostname: 'UCI-ENF-01', ipAddress: '10.0.3.101', operatingSystem: 'Windows 11 (demo)', processor: 'Core i5', ramGb: 16, storageGb: 512, endUser: 'Estación de enfermería UCI' }],
      ['CMP', 'Computador triage urgencias', 'DemoPC', 'PC-5', 'URG', 'ALTA', 'A', 'URG-02', 'SEMESTRAL', 'demo.tecnico', { hostname: 'URG-TRI-01', ipAddress: '10.0.1.101', operatingSystem: 'Windows 11 (demo)', ramGb: 16, storageGb: 512, endUser: 'Consultorio de triage' }],
      ['CMP', 'Computador admisiones', 'DemoPC', 'PC-3', 'URG', 'MEDIA', 'A', 'URG-02', 'SEMESTRAL', 'demo.tecnico', { hostname: 'URG-ADM-01', ipAddress: '10.0.1.102', operatingSystem: 'Windows 11 (demo)', ramGb: 8, storageGb: 256, endUser: 'Admisiones urgencias' }],
      ['CMP', 'Portátil coordinación médica', 'DemoBook', 'NB-14', 'HOS', 'MEDIA', 'A', 'HOS-01', 'ANUAL', 'demo.tecnico', { hostname: 'HOS-NB-01', operatingSystem: 'Windows 11 (demo)', ramGb: 16, storageGb: 512, endUser: 'Coordinación médica' }],
      ['CMP', 'Estación de trabajo de imagenología', 'DemoWS', 'WS-7', 'IMG', 'ALTA', 'A', 'IMG-01', 'TRIMESTRAL', 'demo.tecnico', { hostname: 'IMG-WS-01', ipAddress: '10.0.6.50', operatingSystem: 'Windows 11 (demo)', processor: 'Xeon', ramGb: 64, storageGb: 2000, endUser: 'Sala de lectura' }],
      ['CMP', 'Computador laboratorio clínico', 'DemoPC', 'PC-5', 'LAB', 'ALTA', 'A', 'LAB-01', 'SEMESTRAL', 'demo.tecnico', { hostname: 'LAB-PC-01', ipAddress: '10.0.5.101', operatingSystem: 'Windows 11 (demo)', ramGb: 16, storageGb: 512, endUser: 'Área técnica laboratorio' }],
      ['PER', 'Impresora multifuncional admisiones', 'DemoPrint', 'MF-40', 'URG', 'MEDIA', 'A', 'URG-02', 'TRIMESTRAL', 'demo.tecnico2', { hostname: 'IMP-URG-01', ipAddress: '10.0.1.200' }],
      ['PER', 'Impresora de manillas de identificación', 'DemoLabel', 'ZL-4', 'URG', 'ALTA', 'A', 'URG-02', 'BIMESTRAL', 'demo.tecnico2', { hostname: 'IMP-MAN-01', ipAddress: '10.0.1.201' }],
      ['PER', 'Impresora de etiquetas laboratorio', 'DemoLabel', 'ZL-2', 'LAB', 'MEDIA', 'A', 'LAB-01', 'TRIMESTRAL', 'demo.tecnico2', { hostname: 'IMP-LAB-01', ipAddress: '10.0.5.200' }],
      ['PER', 'Lector de código de barras hospitalización', 'DemoScan', 'LB-1', 'HOS', 'BAJA', 'A', 'HOS-01', 'ANUAL', 'demo.tecnico2', {}],
      ['TEL', 'Central telefónica IP', 'DemoTel', 'PBX-1', 'ADM', 'ALTA', 'B', 'ADM-01', 'SEMESTRAL', 'demo.tecnico2', { hostname: 'PBX-01', ipAddress: '10.0.20.5', softwareVersion: 'v3 (demo)' }],
      ['TEL', 'Teléfono IP central de enfermería', 'DemoTel', 'TIP-2', 'UCI', 'MEDIA', 'B', 'UCI-01', 'ANUAL', 'demo.tecnico2', { ipAddress: '10.0.20.101', macAddress: '00:1A:2B:3C:4D:65' }],
      ['UPS', 'UPS centro de datos', 'DemoUPS', 'UPS-20', 'ADM', 'CRITICA', 'B', 'ADM-01', 'TRIMESTRAL', 'demo.tecnico2', {}],
      ['UPS', 'UPS rack de comunicaciones UCI', 'DemoUPS', 'UPS-3', 'UCI', 'ALTA', 'B', 'UCI-01', 'SEMESTRAL', 'demo.tecnico2', {}],
      ['SIS', 'Sistema de información clínico (HIS)', 'Proveedor demo', 'HIS', 'ADM', 'CRITICA', 'C', 'ADM-01', 'MENSUAL', 'demo.tecnico', { softwareVersion: '2026.1 (demo)', licenseExpiresAt: `${year}-12-20` }],
      ['SIS', 'Copias de seguridad de bases de datos', '', '', 'ADM', 'CRITICA', 'C', 'ADM-01', 'MENSUAL', 'demo.tecnico', {}],
      ['SIS', 'Antivirus corporativo', 'DemoAV', 'EP', 'ADM', 'ALTA', 'C', 'ADM-02', 'MENSUAL', 'demo.tecnico2', { softwareVersion: 'Consola 12 (demo)', licenseExpiresAt: `${year + 1}-01-15` }],
    ];
    const coordinator = users['demo.coordinador'];
    let n = 0;
    for (const [c, name, brand, model, area, crit, s, loc, freq, resp, tech] of defs) {
      n++;
      const { licenseExpiresAt, ...techRest } = tech;
      const isSoftware = c === 'SIS';
      const asset = await prisma.asset.create({
        data: {
          code: `DEMO-${c}-${String(n).padStart(3, '0')}`, name, categoryId: await cat(c), brand: brand || null, model: model || null,
          serialNumber: brand && !isSoftware ? `SN-DEMO-${1000 + n}` : null, areaId: areas[area], locationId: locs[loc], criticality: crit, supplierId: sup[s].id,
          acquisitionDate: new Date(`${year - 3}-03-15T00:00:00Z`), installationDate: new Date(`${year - 3}-04-01T00:00:00Z`),
          warrantyUntil: n % 5 === 0 ? new Date(`${year}-12-15T00:00:00Z`) : null, responsibleId: users[resp], createdById: coordinator,
          acquisitionCost: 500_000 * (n + 4), notes: 'Registro de demostración', ...techRest,
          licenseExpiresAt: licenseExpiresAt ? new Date(`${licenseExpiresAt}T00:00:00Z`) : null,
        },
      });
      const day = String(((n * 3) % 27) + 1).padStart(2, '0');
      await prisma.maintenanceProgram.create({
        data: {
          code: `DEMO-PM-${String(n).padStart(3, '0')}`, assetId: asset.id, categoryId: asset.categoryId, kind: isSoftware ? 'PRUEBA_FUNCIONAL' : 'PREVENTIVO',
          name: isSoftware ? `Verificación y actualización: ${name.toLowerCase()}` : `Mantenimiento preventivo ${name.toLowerCase()}`,
          description: isSoftware ? 'Verificación de funcionamiento, actualizaciones, registros y respaldos.' : 'Limpieza física, revisión de hardware, actualizaciones y pruebas de funcionamiento.',
          procedure: isSoftware
            ? '1. Verificar disponibilidad y desempeño.\n2. Revisar registros de eventos y alertas.\n3. Aplicar actualizaciones aprobadas.\n4. Verificar ejecución y restauración de respaldos.\n5. Registrar resultados.'
            : '1. Confirmar con el usuario y respaldar información si aplica.\n2. Limpieza física interna y externa.\n3. Revisión de componentes, conexiones y temperatura.\n4. Actualización de sistema operativo, controladores y antivirus.\n5. Pruebas de funcionamiento y registro de resultados.',
          checklist: isSoftware ? SW_CHECKLIST : HW_CHECKLIST,
          frequencyType: freq as never, startDate: new Date(`${year - 1}-01-01T00:00:00Z`), baseDate: new Date(`${year - 1}-01-${day}T00:00:00Z`),
          estimatedDurationMin: isSoftware ? 60 : 90, responsibleId: users[resp], supplierId: sup[s].id, frequencyJustification: DEMO_NOTE, createdById: coordinator,
        },
      });
      await prisma.counter.upsert({ where: { key_year: { key: 'PROGRAM', year: 0 } }, update: { value: n }, create: { key: 'PROGRAM', year: 0, value: n } });
    }
    // Programa con fechas específicas (ejemplo): prueba de restauración de respaldos
    const bkp = await prisma.asset.findFirstOrThrow({ where: { name: 'Copias de seguridad de bases de datos' } });
    await prisma.maintenanceProgram.create({
      data: {
        code: 'DEMO-PM-REST-01', assetId: bkp.id, categoryId: bkp.categoryId, kind: 'PRUEBA_FUNCIONAL', name: 'Prueba completa de restauración en ambiente aislado',
        checklist: [{ id: 't1', text: 'Restauración completa ejecutada', required: true }, { id: 't2', text: 'Integridad de datos verificada', required: true }],
        frequencyType: 'FECHAS_ESPECIFICAS', specificDates: ['03-15', '09-15'], startDate: new Date(`${year - 1}-01-01T00:00:00Z`), baseDate: new Date(`${year - 1}-01-01T00:00:00Z`),
        responsibleId: users['demo.tecnico'], frequencyJustification: DEMO_NOTE, createdById: coordinator,
      },
    });

    // Plan anual del año actual generado con la lógica real del sistema
    const coordUser = await prisma.user.findUniqueOrThrow({ where: { id: coordinator }, include: { role: { include: { permissions: true } } } });
    const ctx = {
      user: {
        id: coordUser.id, username: coordUser.username, fullName: coordUser.fullName, roleCode: 'COORDINADOR', roleName: coordUser.role.name, scope: 'ALL',
        permissions: new Set(coordUser.role.permissions.map((p) => p.permissionCode)), areaIds: [], isTechnicalStaff: true, sessionId: '', csrfToken: '', mustChangePassword: false,
      } as AuthUser,
      ip: '127.0.0.1',
    };
    const plans = app.get(PlansService);
    await plans.createPlan(ctx, year, 'Plan de demostración — equipos de cómputo y sistemas');
    const r = await plans.generate(ctx, year);
    console.log(`Datos de demostración creados. Plan ${year}: ${r.created} actividades generadas.`);
    console.log('Usuarios demo: demo.admin, demo.coordinador, demo.responsable, demo.tecnico, demo.tecnico2, demo.solicitante, demo.auditor (contraseña = DEMO_PASSWORD).');
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
