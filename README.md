# SIGM — Sistema Integral de Gestión de Mantenimiento

Aplicación web institucional para gestionar el **mantenimiento preventivo y correctivo de los equipos de cómputo, sistemas e infraestructura (climatización)** de una IPS colombiana: inventario técnico, plan maestro, cronograma anual versionado, órdenes de trabajo, reportes de falla, hojas de vida, proveedores, documentos, indicadores y auditoría.

> **Alcance:** computadores, servidores y almacenamiento, redes y comunicaciones, impresión y periféricos, telefonía, UPS de TI y sistemas de información/software. Las categorías son configurables dentro de este alcance.

## Arquitectura

Monolito modular con tres servicios de aplicación y uno de respaldo:

| Componente | Tecnología |
|---|---|
| Frontend | Vue 3 + TypeScript estricto, Vite, PrimeVue 4, Pinia, Vue Router, Axios, Lucide, Chart.js |
| Backend | Node.js 24 LTS, NestJS 11, API REST `/api/v1`, Prisma 7 (driver adapter `pg`), validación Zod, Swagger/OpenAPI, logs estructurados (pino) |
| Base de datos | PostgreSQL 18 — 3 migraciones versionadas, claves foráneas, índices, *triggers* de integridad |
| Infraestructura | Docker Compose, Nginx (HTTPS + proxy inverso + cabeceras de seguridad), volúmenes persistentes, servicio de respaldo verificado |

```
├── backend/            API NestJS (src/modules/*), Prisma (prisma/), pruebas (test/)
├── frontend/           SPA Vue 3 (src/views/*), Nginx (nginx/), E2E Playwright (e2e/)
├── infra/backup/       Respaldo diario, verificación, prueba de restauración, restore.sh
├── docs/               Manuales, matriz de roles, OpenAPI, informes
├── docker-compose.yml
└── .env.example
```

## Inicio rápido — producción / red interna

```bash
cp .env.example .env
```
Edite `.env` (contraseña de PostgreSQL larga y aleatoria, nombre de host). Luego:

```bash
docker compose up -d --build
```

```bash
docker compose exec api npm run create-admin:prod
```
El último comando crea el administrador inicial con una contraseña temporal aleatoria que se muestra **una sola vez** y obliga a cambiarla en el primer ingreso. Acceso: `https://<SIGM_HOSTNAME>`. Detalle en [docs/01-instalacion-despliegue.md](docs/01-instalacion-despliegue.md).

## Desarrollo local

Requisitos: Node.js 24, Docker.

```bash
docker run -d --name sigm-dev-db -e POSTGRES_USER=sigm -e POSTGRES_PASSWORD=<clave> -e POSTGRES_DB=sigm -p 55432:5432 postgres:18-alpine
```
```bash
cd backend && cp .env.example .env && npm ci && npx prisma migrate deploy && npm run seed
```
```bash
cd backend && npm run seed:demo
```
(datos de demostración, solo desarrollo: requiere `DEMO_PASSWORD` en `backend/.env`)
```bash
cd backend && npm run start:dev
```
```bash
cd frontend && npm ci && npm run dev
```
Frontend en `http://localhost:5173`, API en `http://localhost:3000/api/v1`, Swagger en `http://localhost:3000/api/docs`.

## Pruebas

| Tipo | Comando | Resultado actual |
|---|---|---|
| Unitarias backend (Jest) | `cd backend && npm run test:unit` | 28/28 |
| Integración API (Jest + Supertest, PostgreSQL real efímero) | `cd backend && npm run test:e2e` | 55/55 |
| Unitarias frontend (Vitest) | `cd frontend && npm test` | 7/7 |
| Extremo a extremo (Playwright) | `cd frontend && npm run e2e` | 7/7 |

Ver [docs/06-informe-pruebas.md](docs/06-informe-pruebas.md).

## Documentación

1. [Instalación y despliegue](docs/01-instalacion-despliegue.md)
2. [Manual de usuario](docs/02-manual-usuario.md)
3. [Manual técnico (arquitectura, modelo de datos y diagrama E-R, reglas de negocio)](docs/03-manual-tecnico.md)
4. [Respaldo y restauración](docs/04-respaldo-restauracion.md)
5. [Matriz de roles y permisos](docs/05-matriz-roles-permisos.md)
6. [Informe de pruebas](docs/06-informe-pruebas.md)
7. [Informe de seguridad](docs/07-informe-seguridad.md)
8. [Procedimientos operativos](docs/08-procedimientos-operativos.md)
9. API: Swagger en `/api/docs` y especificación en [docs/openapi.json](docs/openapi.json)

## Aviso importante

Los parámetros iniciales (ponderaciones de criticidad y prioridad, umbrales, textos de procedimientos, periodicidades de los datos demo) son **puntos de partida configurables**, no requisitos normativos. Deben validarse con el responsable técnico, Calidad y la normativa colombiana vigente. El sistema no recopila información clínica de pacientes.
