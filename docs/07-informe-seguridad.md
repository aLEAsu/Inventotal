# 7. Informe de seguridad

## 7.1 Controles implementados

| Requisito | Implementación | Verificación |
|---|---|---|
| Contraseñas | Argon2id (m=19 MiB, t=2, p=1). Política: ≥10 caracteres, mayúscula, minúscula, número, símbolo y no contener el usuario. Cambio obligatorio en el primer ingreso o tras restablecimiento. | Pruebas unitarias y de API |
| Sesiones | Token opaco aleatorio de 256 bits en cookie `HttpOnly`, `Secure` (producción) y `SameSite=Strict`; en la base solo se guarda su hash SHA-256. Expira por tiempo (TTL) y por inactividad (2 h); se revoca al cerrar sesión, cambiar contraseña, desactivar el usuario o cambiar su rol. | API: cookie, cierre de sesión |
| Tokens en el navegador | No se usa `localStorage` ni `sessionStorage`; el token CSRF vive solo en memoria. | E2E verifica `localStorage` |
| CSRF | Token sincronizado por sesión, exigido en la cabecera `X-CSRF-Token` en toda escritura y comparado en tiempo constante. | API: escritura sin token devuelve 403 |
| Intentos de inicio de sesión | Bloqueo tras 5 fallos (15 min, configurable). Mensajes que no revelan si el usuario existe; tiempo constante con hash ficticio. Registro en `login_attempts` y en la auditoría. | API |
| Limitación de solicitudes | Throttler global en la API (600/min) e inicio de sesión (10/min por IP), más `limit_req` en Nginx. | Verificado en E2E (mensaje "Demasiadas solicitudes") |
| Autorización | Guardia global con permisos granulares (`módulo.acción`), alcance por área (ALL/AREA/OWN) en cada servicio, segregación ejecutor/validador y competencia técnica para liberar activos críticos. | API: control de acceso de todos los roles |
| Validación de entradas | Zod en cada endpoint (tipos, rangos, fechas, IP, MAC, NIT), límites de tamaño y JSON de 2 MB como máximo. | API |
| Inyección SQL | Prisma con consultas parametrizadas; el SQL crudo usa *tagged templates* parametrizados. | Revisión de código |
| Archivos | Almacenamiento privado fuera del directorio web, nombres aleatorios (UUID) y protección contra *path traversal*. Se verifican **firma real**, MIME y extensión, con lista blanca configurable y tamaño máximo; se registra SHA-256. Descarga con control de acceso y `nosniff`. | API: rechaza HTML disfrazado de PNG y ejecutables |
| HTTPS y cabeceras | Nginx con TLS 1.2/1.3, redirección 80→443, HSTS, CSP restrictiva, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` y `Permissions-Policy`; Helmet en la API. | Verificado con curl en Docker |
| Secretos | Solo variables de entorno; `.env` excluido de git; `.env.example` sin valores reales. El administrador inicial recibe una contraseña aleatoria que se muestra una sola vez. | Revisión |
| Auditoría | Bitácora con usuario, fecha y hora (TIMESTAMPTZ), operación, módulo, registro, valores anteriores y nuevos, justificación, IP y navegador. Se escribe en la misma transacción que la operación. **Inmutable por *trigger*** (UPDATE, DELETE y TRUNCATE bloqueados). No registra contraseñas ni tokens. | API: inmutabilidad y ausencia de secretos |
| Datos de pacientes | El modelo no tiene campos clínicos; las pantallas y procedimientos advierten no registrar datos de pacientes ni contraseñas. | Revisión |
| Errores | Respuestas genéricas en español, sin trazas; las fallas de base de datos devuelven 503 sin cambios parciales (transacciones). | API |

## 7.2 Riesgos residuales y recomendaciones

1. **Certificado TLS**: el certificado autofirmado automático es solo para pruebas. Instale el certificado de la institución en `infra/certs/`.
2. **Usuario de base de datos**: la composición usa el usuario propietario creado por la imagen de PostgreSQL. Para producción se recomienda un usuario de aplicación sin privilegios de superusuario y otro exclusivo para respaldos.
3. **Bitácora a nivel de base**: los *triggers* impiden modificar la bitácora desde la aplicación y desde SQL ordinario, pero un superusuario de PostgreSQL podría desactivarlos. Proteja las credenciales del servidor y, si se requiere, envíe los logs a un SIEM o almacenamiento WORM.
4. **Respaldo fuera del servidor**: configure `BACKUP_PATH` en un disco o recurso de red distinto y una copia periódica fuera de sitio.
5. **Swagger**: está habilitado por defecto en la red interna; desactívelo con `SWAGGER_ENABLED=false` si la política institucional lo exige.
6. **Dependencias**: ejecute `npm audit` periódicamente y actualice las imágenes base (`node:24-alpine`, `postgres:18-alpine`, `nginx`).
7. **CSP**: permite `'unsafe-inline'` en estilos porque lo requieren los componentes PrimeVue; los scripts están restringidos a `'self'`.

## Revisión para producción en Vercel + Supabase (noviembre de 2026)

### Hallazgos corregidos

| Severidad | Hallazgo | Corrección |
|---|---|---|
| Crítica | Las 38 tablas del esquema `public` eran legibles y modificables desde la API REST pública de Supabase (PostgREST) con la clave `anon`, incluidos los hashes de contraseña. | Migración `security_hardening`: RLS activo sin políticas en todas las tablas y sin privilegios para `anon`/`authenticated` (también para tablas futuras). Verificado: 0 de 39 tablas accesibles. |
| Alta | XSS almacenado al imprimir la etiqueta QR de un activo: el nombre y el código se insertaban como HTML en una ventana nueva. | La etiqueta se construye con nodos DOM y `textContent`, sin scripts en línea. |
| Alta | El frontend en producción no enviaba CSP ni protección contra *clickjacking*. | `vercel.json`: CSP estricta (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`; respuestas de la API con `Cache-Control: no-store`. |
| Media | El freno de fuerza bruta del login vivía en memoria de cada instancia; en serverless no se comparte. | Límite por IP persistido en la base (`LOGIN_IP_MAX_FAILURES`, 20 fallos en 15 min → 429), además del bloqueo por cuenta. |
| Media | El contador de intentos fallidos podía perder incrementos con intentos simultáneos. | Incremento atómico en la base. |
| Media | Sesiones y registros de acceso (IP, navegador) se conservaban indefinidamente. | Depuración automática: sesiones vencidas/cerradas > 30 días y accesos > 180 días (la bitácora inmutable no se toca). Minimización de datos personales, Ley 1581 de 2012. |
| Media | Conexión a Supabase: `sslmode=require` fallaba la verificación y sin `sslmode` no se cifraba. | TLS siempre activo hacia Supabase; verificación completa con `DB_SSL_CA`. |
| Media | Adjuntos en disco efímero de Vercel. | Supabase Storage, bucket privado `documents` sin políticas públicas (solo la API con la clave de servicio). |
| Baja | 18 columnas de trazabilidad sin clave foránea; funciones con `search_path` mutable; Swagger público. | Claves foráneas `RESTRICT`, `search_path` fijo, Swagger apagado en producción. |

### Verificado sin hallazgos

- Contraseñas con argon2id (parámetros OWASP), tokens de sesión aleatorios de 256 bits guardados como hash, CSRF por sesión con comparación en tiempo constante, cookies `HttpOnly`, `Secure`, `SameSite=Strict`.
- Autenticación obligatoria por defecto (guardia global); los endpoints sin permiso explícito solo devuelven listas mínimas para formularios.
- Cierre por inactividad (2 h), revocación de sesiones al cambiar la contraseña y al desactivar el usuario; cambio de contraseña obligatorio en el primer ingreso.
- Errores sin detalles internos; la bitácora excluye contraseñas, hashes y tokens; los logs ocultan cookies y cabeceras CSRF.
- Validación de entrada con Zod; adjuntos validados por firma binaria, tipo y extensión.
- Sin secretos en el historial de git. `npm audit`: frontend sin vulnerabilidades; backend con 1 moderada (`uuid` vía `exceljs`) no explotable en el uso que hace `exceljs`.

### Configuración pendiente en los paneles (no se puede hacer desde el código)

**Supabase**
1. *Authentication → Sign In / Providers*: desactivar **Allow new users to sign up** (el sistema no usa Supabase Auth).
2. *Settings → Database → SSL Configuration*: activar **Enforce SSL on incoming connections**.
3. *Settings → Database → Network Restrictions*: si no se usa conexión directa desde otros equipos, restringir el acceso.
4. *Settings → API → Data API*: desactivar la Data API o quitar `public` de los esquemas expuestos (defensa adicional al RLS).
5. Contraseña de la base larga y aleatoria; guardarla solo en Vercel y en un gestor de contraseñas.
6. Copias de seguridad: el plan gratuito no garantiza restauración puntual; programar un `pg_dump` periódico o activar PITR en un plan de pago.

**Vercel**
1. Variables `DATABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` marcadas como *Sensitive* y solo en el entorno *Production*.
2. Activar la autenticación de dos factores en las cuentas de Vercel, Supabase y GitHub.
3. *Deployment Protection* para las vistas previas (Preview) si contienen datos reales.

**Operación**
- Cambiar la contraseña temporal del usuario `admin` en el primer ingreso y crear usuarios nominales (no compartir `admin`).
- Revisar la bitácora (`LOGIN_FALLIDO`, `LOGIN_BLOQUEADO_IP`, `RESTABLECER_CONTRASENA`) periódicamente.
