# 1. Instalación y despliegue

## 1.1 Requisitos del servidor institucional

- Servidor Linux o Windows con Docker Engine 24+ y Docker Compose v2.
- 2 vCPU, 4 GB RAM y 40 GB de disco como mínimo para la aplicación. Para los respaldos se recomienda un **disco o recurso de red distinto** al de los datos.
- Acceso desde la red interna de la clínica a los puertos 80/443.
- Un nombre DNS interno (ej. `sigm.clinica.local`) y, preferiblemente, un certificado TLS emitido por la institución.

## 1.2 Despliegue con Docker Compose

1. Copie el proyecto en el servidor y cree el archivo de variables:
   ```bash
   cp .env.example .env
   ```
2. Edite `.env`:
   - `POSTGRES_PASSWORD`: contraseña larga y aleatoria (mínimo 24 caracteres).
   - `SIGM_HOSTNAME`: nombre DNS interno.
   - `BACKUP_PATH`: ruta de un disco/recurso **separado** para las copias.
3. Certificado TLS institucional (recomendado): copie `sigm.crt` y `sigm.key` en `infra/certs/`. Si no existen, Nginx genera un certificado autofirmado temporal, solo apto para pruebas.
4. Construya y levante los servicios:
   ```bash
   docker compose up -d --build
   ```
   Al iniciar, la API aplica automáticamente las **migraciones versionadas** y la **configuración base**: roles, permisos, categorías de TI, criterios de criticidad, formatos F-01 a F-12, procedimientos y parámetros. Nunca carga datos de demostración.
5. Cree el administrador inicial:
   ```bash
   docker compose exec api npm run create-admin:prod
   ```
   La contraseña temporal se muestra **una sola vez**: anótela en un medio seguro y cámbiela en el primer ingreso. Para definirla usted mismo, use la variable `ADMIN_PASSWORD` solo durante ese comando; no la deje en `.env`.
6. Ingrese a `https://<SIGM_HOSTNAME>` y complete la configuración:
   - Configuración › Parámetros: nombre de la institución, NIT, color institucional y URL interna para los QR.
   - Configuración › Áreas y ubicaciones.
   - Usuarios y permisos: crear los usuarios por rol.
   - Configuración › Formatos: códigos documentales, versiones y responsables (elaboró, revisó, aprobó).
   - Validar las ponderaciones de la matriz de criticidad y los procedimientos (marcados como "pendiente de validación").

## 1.3 Servicios

| Servicio | Función | Persistencia |
|---|---|---|
| `db` | PostgreSQL 18 (zona horaria America/Bogota) | volumen `pgdata` |
| `api` | API NestJS (solo red interna de Docker) | volumen `storage` (documentos privados) |
| `web` | Nginx: SPA, HTTPS, proxy `/api`, limitación de solicitudes | `infra/certs` |
| `backup` | Respaldo diario verificado y prueba de restauración semanal | `${BACKUP_PATH}` |

## 1.4 Actualización

```bash
git pull
```
```bash
docker compose up -d --build
```
Las migraciones nuevas se aplican al iniciar la API. Haga **siempre** un respaldo manual antes de actualizar:

```bash
docker compose exec backup sh -c '. /etc/backup.env; backup.sh'
```

## 1.5 Entornos

- **Producción**: `.env` en la raíz (Docker Compose). `COOKIE_SECURE=true` y `NODE_ENV=production`.
- **Desarrollo**: `backend/.env` (plantilla en `backend/.env.example`), base local en el puerto 55432, `COOKIE_SECURE=false`.
- **Pruebas**: `backend/.env.test`. Cada ejecución crea y elimina su propia base efímera `sigm_test_<marca de tiempo>`.

## 1.6 Datos de demostración

Solo para desarrollo o capacitación: `npm run seed:demo` en `backend`. Exige `DEMO_PASSWORD` y se niega a ejecutarse con `NODE_ENV=production`. Todos sus registros llevan el prefijo `DEMO` y la institución se llama "Clínica Demostración SIGM (datos ficticios)".
