/**
 * Catálogo de permisos granulares (módulo.acción) y matriz inicial de roles.
 * El control se aplica en el backend (PermissionsGuard + filtros de alcance por área en los servicios).
 */
export const PERMISSIONS: { code: string; module: string; action: string; description: string }[] = [
  ['dashboard.read', 'Dashboard', 'Consultar dashboard e indicadores'],
  ['assets.read', 'Inventario', 'Consultar activos'],
  ['assets.write', 'Inventario', 'Registrar y editar activos'],
  ['assets.status', 'Inventario', 'Cambiar estado / dar de baja activos'],
  ['criticality.assess', 'Criticidad', 'Evaluar criticidad de activos'],
  ['criticality.configure', 'Criticidad', 'Configurar criterios y ponderaciones'],
  ['catalog.manage', 'Configuración', 'Administrar áreas, ubicaciones y categorías'],
  ['programs.read', 'Plan maestro', 'Consultar programas preventivos'],
  ['programs.write', 'Plan maestro', 'Crear y editar programas preventivos'],
  ['plans.read', 'Cronograma', 'Consultar planes anuales y cronograma'],
  ['plans.generate', 'Cronograma', 'Crear plan anual y generar cronograma'],
  ['plans.submit', 'Cronograma', 'Enviar plan a revisión'],
  ['plans.approve', 'Cronograma', 'Revisar/aprobar planes y reprogramaciones'],
  ['plans.close', 'Cronograma', 'Cerrar y archivar plan anual'],
  ['plans.export', 'Cronograma', 'Imprimir y exportar cronograma'],
  ['schedule.reschedule', 'Cronograma', 'Solicitar reprogramación de actividades'],
  ['schedule.assign', 'Cronograma', 'Asignar responsables de actividades'],
  ['workorders.read', 'Órdenes de trabajo', 'Consultar órdenes propias o asignadas'],
  ['workorders.read_all', 'Órdenes de trabajo', 'Consultar todas las órdenes (según área)'],
  ['workorders.create', 'Órdenes de trabajo', 'Crear órdenes de trabajo'],
  ['workorders.assign', 'Órdenes de trabajo', 'Asignar y reasignar órdenes'],
  ['workorders.execute', 'Órdenes de trabajo', 'Ejecutar y documentar órdenes'],
  ['workorders.verify', 'Órdenes de trabajo', 'Validar y cerrar órdenes'],
  ['workorders.cancel', 'Órdenes de trabajo', 'Cancelar órdenes'],
  ['failures.report', 'Correctivos', 'Reportar fallas'],
  ['failures.read', 'Correctivos', 'Consultar fallas propias o asignadas'],
  ['failures.read_all', 'Correctivos', 'Consultar todas las fallas (según área)'],
  ['failures.manage', 'Correctivos', 'Evaluar, clasificar y asignar fallas'],
  ['failures.release', 'Correctivos', 'Autorizar liberación de activos tras reparación'],
  ['suppliers.read', 'Proveedores', 'Consultar proveedores y contratos'],
  ['suppliers.write', 'Proveedores', 'Administrar proveedores, contratos y evaluaciones'],
  ['documents.read', 'Documentos', 'Consultar y descargar documentos'],
  ['documents.upload', 'Documentos', 'Adjuntar documentos y evidencias'],
  ['documents.void', 'Documentos', 'Anular documentos'],
  ['reports.read', 'Informes', 'Generar informes y formatos institucionales'],
  ['procedures.read', 'Procedimientos', 'Consultar procedimientos operativos'],
  ['procedures.manage', 'Procedimientos', 'Editar procedimientos y formatos documentales'],
  ['users.read', 'Usuarios', 'Consultar usuarios y roles'],
  ['users.manage', 'Usuarios', 'Administrar usuarios, roles y permisos'],
  ['settings.manage', 'Configuración', 'Administrar parámetros del sistema'],
  ['audit.read', 'Auditoría', 'Consultar la bitácora de auditoría'],
  ['backups.read', 'Respaldos', 'Consultar el registro de respaldos'],
].map(([code, module, description]) => ({ code, module, action: code.split('.')[1], description }));

const ALL = PERMISSIONS.map((p) => p.code);

export const ROLES: {
  code: string;
  name: string;
  description: string;
  scope: 'ALL' | 'AREA' | 'OWN';
  permissions: string[];
}[] = [
  {
    code: 'ADMIN',
    name: 'Administrador del sistema',
    description: 'Control total de configuración, usuarios, permisos y parámetros.',
    scope: 'ALL',
    permissions: ALL,
  },
  {
    code: 'COORDINADOR',
    name: 'Coordinador de mantenimiento',
    description: 'Responsable central del mantenimiento institucional.',
    scope: 'ALL',
    permissions: ALL.filter((p) => !['users.manage', 'settings.manage'].includes(p)),
  },
  {
    code: 'RESPONSABLE_AREA',
    name: 'Responsable de área',
    description: 'Gestiona activos y actividades de sus áreas asignadas.',
    scope: 'AREA',
    permissions: [
      'dashboard.read', 'assets.read', 'programs.read', 'plans.read', 'plans.export', 'schedule.reschedule',
      'workorders.read', 'workorders.read_all', 'workorders.create', 'workorders.execute',
      'failures.report', 'failures.read', 'failures.read_all', 'suppliers.read',
      'documents.read', 'documents.upload', 'reports.read', 'procedures.read',
    ],
  },
  {
    code: 'TECNICO',
    name: 'Técnico de mantenimiento',
    description: 'Ejecuta y documenta las órdenes asignadas.',
    scope: 'ALL',
    permissions: [
      'assets.read', 'programs.read', 'plans.read', 'workorders.read', 'workorders.execute',
      'failures.report', 'failures.read', 'documents.read', 'documents.upload', 'procedures.read',
    ],
  },
  {
    code: 'SOLICITANTE',
    name: 'Solicitante',
    description: 'Reporta fallas y consulta el estado de sus solicitudes.',
    scope: 'OWN',
    permissions: ['failures.report', 'failures.read', 'documents.read', 'documents.upload'],
  },
  {
    code: 'AUDITOR',
    name: 'Auditor / Calidad',
    description: 'Acceso de lectura a registros, trazabilidad e indicadores.',
    scope: 'ALL',
    permissions: [
      'dashboard.read', 'assets.read', 'programs.read', 'plans.read', 'plans.export', 'workorders.read',
      'workorders.read_all', 'failures.read', 'failures.read_all', 'suppliers.read', 'documents.read',
      'reports.read', 'procedures.read', 'audit.read', 'backups.read', 'users.read',
    ],
  },
];
