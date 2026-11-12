# 09 · Despliegue en producción: Vercel + Supabase

Arquitectura de producción:

| Pieza | Servicio | Notas |
|---|---|---|
| Frontend (Vue + Vite) | Vercel (servicio `frontend`) | Estático; `/` y rutas de la SPA |
| API (NestJS) | Vercel Functions (servicio `backend`) | Rutas `/api/*`, misma URL que el frontend (sin CORS) |
| Base de datos | Supabase PostgreSQL 17 (`us-east-1`) | Proyecto `inventotal` (`njztosvsbwtkdihmhuep`) |
| Documentos adjuntos | Supabase Storage, bucket privado `documents` | El disco de Vercel es de solo lectura y no persiste |

## 1. Variables de entorno en Vercel

Vercel → proyecto → **Settings → Environment Variables** (entorno *Production*). Después de cambiarlas, **Redeploy**.

| Variable | Valor | Obligatoria |
|---|---|---|
| `DATABASE_URL` | Cadena del **Transaction pooler** de Supabase (puerto `6543`), ver abajo | Sí |
| `SUPABASE_URL` | `https://njztosvsbwtkdihmhuep.supabase.co` | Sí (documentos) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave **secret / service_role** de Supabase (Settings → API Keys). Nunca en el frontend | Sí (documentos) |
| `NODE_ENV` | `production` | Recomendada (Vercel ya la define) |
| `COOKIE_SECURE` | `true` | Recomendada (es el valor por defecto) |
| `DB_POOL_MAX` | `3` | Opcional (por defecto 5 conexiones por instancia) |
| `DB_SSL_CA` | Certificado PEM de Supabase (Settings → Database → SSL) para verificar el servidor | Opcional |
| `SWAGGER_ENABLED` | `true` solo si se quiere publicar `/api/docs` | Opcional (apagado en producción) |

**`DATABASE_URL`**: Supabase → botón **Connect** → *Transaction pooler*:

```
postgresql://postgres.njztosvsbwtkdihmhuep:[CONTRASEÑA]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

- Use el *pooler* (no la conexión directa `db.…supabase.co`): las funciones serverless abren muchas conexiones cortas.
- La API cifra siempre la conexión con Supabase; si la cadena trae `sslmode=require` se ajusta sola. Con `DB_SSL_CA` además verifica el certificado.
- Si la contraseña tiene caracteres especiales (`@ : / ? #`), codifíquelos en URL o regenérela en Supabase → Settings → Database.

## 2. Comprobar el despliegue

1. `https://inventotal.vercel.app/api/v1/health` debe responder `{"status":"ok","database":"ok"}`.
   Si responde 503, el campo `reason` indica el problema (variable faltante, servidor inalcanzable, credenciales, SSL, migraciones).
2. Iniciar sesión con el usuario `admin`. El sistema obliga a cambiar la contraseña temporal en el primer ingreso.
3. Subir un PDF de prueba en Documentos y descargarlo (valida Supabase Storage).

## 3. Migraciones de base de datos

Las migraciones viven en `backend/prisma/migrations` y la tabla `_prisma_migrations` de Supabase está sincronizada con ellas.
Para aplicar migraciones nuevas (use la **conexión de sesión**, puerto `5432`, no la de transacciones):

```bash
cd backend && DATABASE_URL="postgresql://postgres.njztosvsbwtkdihmhuep:[CONTRASEÑA]@aws-0-us-east-1.pooler.supabase.com:5432/postgres" npx prisma migrate deploy
```

La migración `20261112040000_security_hardening` activa RLS en todas las tablas y retira los permisos de los roles
`anon` y `authenticated`: la API REST pública de Supabase (PostgREST) no puede leer ni modificar datos.
La API de NestJS usa el rol dueño de las tablas y no se ve afectada. Las tablas creadas por migraciones futuras
heredan la restricción de permisos; ejecute `ALTER TABLE … ENABLE ROW LEVEL SECURITY` en cada tabla nueva.

## 4. Copiar datos desde la base local

Desde el equipo con el contenedor `sigm-dev-db`, el siguiente comando copia los datos de `sigm_clinica` a Supabase.
Es **idempotente** (`--on-conflict-do-nothing`): puede repetirse sin duplicar registros.

```bash
docker exec sigm-dev-db sh -c 'pg_dump -U sigm -d sigm_clinica --data-only --inserts --on-conflict-do-nothing -T _prisma_migrations -T sessions -T login_attempts | psql "$0" -v ON_ERROR_STOP=1 -q' "postgresql://postgres.njztosvsbwtkdihmhuep:[CONTRASEÑA]@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require"
```

## 5. Límites de la plataforma

- **Tamaño de archivos**: Vercel rechaza peticiones de más de 4,5 MB; la API limita los adjuntos a 4 MB en Vercel.
- **Tareas programadas**: el sistema no usa tareas en segundo plano. Las copias de seguridad las gestiona Supabase
  (plan gratuito: copia diaria con 7 días de retención; activar PITR en planes de pago si se requiere).
- **Bitácora**: la auditoría de producción inicia con el registro `MIGRAR_BASE_DATOS`; el historial previo queda en la base local.
