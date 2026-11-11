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
