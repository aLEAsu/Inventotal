# Matriz de roles y permisos

> Generado automáticamente desde `backend/src/common/permissions.ts` (`npx ts-node scripts/gen-roles-matrix.ts`). Es la matriz **inicial**: el administrador puede ajustarla en Usuarios y permisos › Roles. El control se aplica en el backend (guardia de permisos + filtros por área en cada servicio).

## Roles

| Rol | Código | Alcance de datos | Descripción |
|---|---|---|---|
| Administrador del sistema | `ADMIN` | Todas las áreas | Control total de configuración, usuarios, permisos y parámetros. |
| Coordinador de mantenimiento | `COORDINADOR` | Todas las áreas | Responsable central del mantenimiento institucional. |
| Responsable de área | `RESPONSABLE_AREA` | Solo áreas asignadas | Gestiona activos y actividades de sus áreas asignadas. |
| Técnico de mantenimiento | `TECNICO` | Todas las áreas | Ejecuta y documenta las órdenes asignadas. |
| Solicitante | `SOLICITANTE` | Solo sus propios registros | Reporta fallas y consulta el estado de sus solicitudes. |
| Auditor / Calidad | `AUDITOR` | Todas las áreas | Acceso de lectura a registros, trazabilidad e indicadores. |

## Permisos por rol

| Módulo | Permiso | Descripción | Administrador del sistema | Coordinador de mantenimiento | Responsable de área | Técnico de mantenimiento | Solicitante | Auditor / Calidad |
|---|---|---|---|---|---|---|---|---|
| Dashboard | `dashboard.read` | Consultar dashboard e indicadores | ✔ | ✔ | ✔ |  |  | ✔ |
| Inventario | `assets.read` | Consultar activos | ✔ | ✔ | ✔ | ✔ |  | ✔ |
| Inventario | `assets.write` | Registrar y editar activos | ✔ | ✔ |  |  |  |  |
| Inventario | `assets.status` | Cambiar estado / dar de baja activos | ✔ | ✔ |  |  |  |  |
| Criticidad | `criticality.assess` | Evaluar criticidad de activos | ✔ | ✔ |  |  |  |  |
| Criticidad | `criticality.configure` | Configurar criterios y ponderaciones | ✔ | ✔ |  |  |  |  |
| Configuración | `catalog.manage` | Administrar áreas, ubicaciones y categorías | ✔ | ✔ |  |  |  |  |
| Plan maestro | `programs.read` | Consultar programas preventivos | ✔ | ✔ | ✔ | ✔ |  | ✔ |
| Plan maestro | `programs.write` | Crear y editar programas preventivos | ✔ | ✔ |  |  |  |  |
| Cronograma | `plans.read` | Consultar planes anuales y cronograma | ✔ | ✔ | ✔ | ✔ |  | ✔ |
| Cronograma | `plans.generate` | Crear plan anual y generar cronograma | ✔ | ✔ |  |  |  |  |
| Cronograma | `plans.submit` | Enviar plan a revisión | ✔ | ✔ |  |  |  |  |
| Cronograma | `plans.approve` | Revisar/aprobar planes y reprogramaciones | ✔ | ✔ |  |  |  |  |
| Cronograma | `plans.close` | Cerrar y archivar plan anual | ✔ | ✔ |  |  |  |  |
| Cronograma | `plans.export` | Imprimir y exportar cronograma | ✔ | ✔ | ✔ |  |  | ✔ |
| Cronograma | `schedule.reschedule` | Solicitar reprogramación de actividades | ✔ | ✔ | ✔ |  |  |  |
| Cronograma | `schedule.assign` | Asignar responsables de actividades | ✔ | ✔ |  |  |  |  |
| Órdenes de trabajo | `workorders.read` | Consultar órdenes propias o asignadas | ✔ | ✔ | ✔ | ✔ |  | ✔ |
| Órdenes de trabajo | `workorders.read_all` | Consultar todas las órdenes (según área) | ✔ | ✔ | ✔ |  |  | ✔ |
| Órdenes de trabajo | `workorders.create` | Crear órdenes de trabajo | ✔ | ✔ | ✔ |  |  |  |
| Órdenes de trabajo | `workorders.assign` | Asignar y reasignar órdenes | ✔ | ✔ |  |  |  |  |
| Órdenes de trabajo | `workorders.execute` | Ejecutar y documentar órdenes | ✔ | ✔ | ✔ | ✔ |  |  |
| Órdenes de trabajo | `workorders.verify` | Validar y cerrar órdenes | ✔ | ✔ |  |  |  |  |
| Órdenes de trabajo | `workorders.cancel` | Cancelar órdenes | ✔ | ✔ |  |  |  |  |
| Correctivos | `failures.report` | Reportar fallas | ✔ | ✔ | ✔ | ✔ | ✔ |  |
| Correctivos | `failures.read` | Consultar fallas propias o asignadas | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Correctivos | `failures.read_all` | Consultar todas las fallas (según área) | ✔ | ✔ | ✔ |  |  | ✔ |
| Correctivos | `failures.manage` | Evaluar, clasificar y asignar fallas | ✔ | ✔ |  |  |  |  |
| Correctivos | `failures.release` | Autorizar liberación de activos tras reparación | ✔ | ✔ |  |  |  |  |
| Proveedores | `suppliers.read` | Consultar proveedores y contratos | ✔ | ✔ | ✔ |  |  | ✔ |
| Proveedores | `suppliers.write` | Administrar proveedores, contratos y evaluaciones | ✔ | ✔ |  |  |  |  |
| Documentos | `documents.read` | Consultar y descargar documentos | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Documentos | `documents.upload` | Adjuntar documentos y evidencias | ✔ | ✔ | ✔ | ✔ | ✔ |  |
| Documentos | `documents.void` | Anular documentos | ✔ | ✔ |  |  |  |  |
| Informes | `reports.read` | Generar informes y formatos institucionales | ✔ | ✔ | ✔ |  |  | ✔ |
| Procedimientos | `procedures.read` | Consultar procedimientos operativos | ✔ | ✔ | ✔ | ✔ |  | ✔ |
| Procedimientos | `procedures.manage` | Editar procedimientos y formatos documentales | ✔ | ✔ |  |  |  |  |
| Usuarios | `users.read` | Consultar usuarios y roles | ✔ | ✔ |  |  |  | ✔ |
| Usuarios | `users.manage` | Administrar usuarios, roles y permisos | ✔ |  |  |  |  |  |
| Configuración | `settings.manage` | Administrar parámetros del sistema | ✔ |  |  |  |  |  |
| Auditoría | `audit.read` | Consultar la bitácora de auditoría | ✔ | ✔ |  |  |  | ✔ |
| Respaldos | `backups.read` | Consultar el registro de respaldos | ✔ | ✔ |  |  |  | ✔ |

## Reglas adicionales aplicadas en el servidor

- **Alcance por área**: el rol *Responsable de área* solo consulta y gestiona activos, programas, actividades, órdenes, fallas y documentos de sus áreas asignadas.
- **Órdenes de trabajo**: con `workorders.read` solo se ven las órdenes asignadas o creadas por el usuario; con `workorders.read_all` todas las del alcance. Solo el responsable asignado (o quien tiene `workorders.assign`) puede ejecutar.
- **Segregación de funciones**: quien ejecutó una orden no puede validarla (parámetro `workorders.allowSelfVerification`, desactivado por defecto).
- **Activos críticos**: solo un usuario con *competencia técnica certificada* y permiso `failures.release` puede declararlos reparados y liberarlos.
- **Plan aprobado**: modificarlo (reprogramar, cancelar o agregar actividades) exige `plans.approve` y queda versionado.
- **Solicitante**: solo reporta fallas y consulta/adjunta soportes de sus propios reportes.
- **Auditor / Calidad**: solo lectura; no tiene permisos de escritura.
- **Administrador**: sus permisos no se pueden reducir desde la interfaz; ningún usuario puede desactivarse ni cambiar su propio rol.
