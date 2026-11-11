# 6. Informe de pruebas

Fecha de ejecución: 11/11/2026 · Entorno: Windows 11, Node.js 24.19, PostgreSQL 18 (Docker), Chromium (Playwright 1.56).

## 6.1 Resumen

| Suite | Herramienta | Alcance | Resultado |
|---|---|---|---|
| Unitarias backend | Jest | Motor de recurrencias, fechas en Bogotá, indicadores, criticidad, prioridad, política de contraseñas, detección de tipo de archivo, transiciones | **28/28** |
| Integración API | Jest + Supertest | Flujo completo contra **PostgreSQL real** (base efímera creada y eliminada en cada ejecución) | **55/55** |
| Unitarias frontend | Vitest | Formatos DD/MM/AAAA, hora de Bogotá, COP y etiquetas de estado | **7/7** |
| Extremo a extremo | Playwright | Navegador real sobre el entorno de desarrollo con datos demo | **7/7** |
| Respaldo y restauración | Scripts en Docker | Respaldo verificado, restauración de prueba, rechazo de respaldo alterado | **OK** (ver [04](04-respaldo-restauracion.md)) |
| Despliegue | Docker Compose | Construcción de imágenes, migraciones automáticas, HTTPS, cabeceras, administrador inicial | **OK** |

Comandos:
```bash
cd backend && npm test
```
```bash
cd frontend && npm test
```
```bash
cd frontend && npm run e2e
```

## 6.2 Escenarios obligatorios

| # | Escenario | Cobertura |
|---|---|---|
| 1 | Inicio de sesión válido e inválido | API (mensaje idéntico para usuario inexistente o clave errónea, cookie HttpOnly/SameSite, bloqueo tras 5 intentos, cambio obligatorio de contraseña) y E2E |
| 2 | Control de acceso de todos los roles | API (solicitante, auditor, técnico, responsable de área por alcance, coordinador, administrador) y E2E (menú y rutas) |
| 3 | Registro de activos | API (un activo por cada categoría de TI, validación de IP/MAC, unicidad de código, criticidad, QR) y E2E (formulario) |
| 4 | Programas preventivos | API (sustento obligatorio; mensual, trimestral, semestral, anual, personalizado y fechas específicas; vista previa) |
| 5 | Generación del cronograma anual | API (conteos por categoría y mes) y unitarias (todas las periodicidades, fin de mes, bisiesto, cambio de año, inicio a mitad de año, vigencia) |
| 6 | Prevención de duplicados | API (plan duplicado = 409; dos generaciones concurrentes no crean actividades nuevas) y E2E (regenerar crea 0) |
| 7 | Impresión del cronograma | E2E (vista de impresión, menú y barra ocultos en medio *print*, PDF del navegador generado) y revisión visual |
| 8 | Descarga del PDF | API (`%PDF-`, varias páginas, A3, prueba de volumen con más de 365 actividades y más de 8 páginas) y E2E (descarga real) con revisión visual |
| 9 | Exportación Excel | API (3 hojas: Resumen anual, Cronograma mensual, Detalle de actividades; autofiltro; formato dd/mm/yyyy; filas = actividades) y E2E |
| 10 | Órdenes preventivas | API (desde la actividad; no la marca ejecutada; no duplica) y E2E |
| 11 | Solicitudes correctivas | API (consecutivo FA, prioridad URGENTE, indisponibilidad, alcance del solicitante) y E2E (formulario) |
| 12 | Cierre de órdenes | API (campos obligatorios, pausa con justificación, repuestos y costos, segregación de funciones, actividad ejecutada con su fecha real, cancelación con traza) |
| 13 | Registro de evidencias | API (PDF válido; rechaza HTML disfrazado de PNG y ejecutables; descarga íntegra; acceso denegado al solicitante) |
| 14 | Hoja de vida | API (órdenes, repuestos, costos, criticidad y PDF F-06) |
| 15 | Reprogramación y trazabilidad | API (motivo obligatorio, pendiente hasta aprobación, fecha original intacta, versión del plan incrementada, historial) |
| 16 | Indicadores | Unitarias (base vs. reprogramado, corte, exclusiones, datos insuficientes) y API (costos, tiempos y filtros por área) |
| 17 | Años anteriores | API (plan del año anterior y del siguiente, consulta y cierre) y E2E (selector de año) |
| 18 | Errores de base de datos | API (503 si no hay BD, 409 por unicidad y por *trigger*, transacción sin cambios parciales) |
| 19 | Restauración de respaldo | Prueba en Docker (ver 6.1) |
| 20 | Auditoría de operaciones críticas | API (registro con valores anteriores/nuevos e IP; 10 tipos de operación; inmutabilidad UPDATE/DELETE/TRUNCATE; sin secretos) |

Reglas de integridad adicionales verificadas: la fecha originalmente aprobada no se puede modificar ni por SQL directo; las órdenes no se pueden eliminar; un activo dado de baja deja de generar fechas y conserva su historial; un activo con historial no se elimina; el cambio de periodicidad en borrador excluye o reactiva fechas sin borrarlas; un plan aprobado no se altera al cambiar un programa; un correctivo no marca preventivos como cumplidos; la liberación de un activo crítico exige competencia técnica.

## 6.3 Defectos encontrados y corregidos durante las pruebas

| Defecto | Detección | Corrección |
|---|---|---|
| La prioridad de fallas validaba todos los campos del reporte como puntuaciones, lo que rechazaba cualquier reporte vía API | Integración API | Solo se validan los 3 criterios |
| Un error de *trigger* llegaba al usuario como "violación de relación" genérica | Integración API | El filtro de errores muestra el mensaje original de la regla |
| Un estado global compartido entre solicitudes en el servicio de fallas (riesgo de concurrencia) | Revisión de código | El contexto se pasa explícitamente |
| Interbloqueo potencial al reasignar una falla con orden activa (dos transacciones) | Revisión de código | Operación en una sola transacción |
| `main.js` no se emitía (compilación incremental con `deleteOutDir`) | Arranque | `incremental: false` en la compilación de producción |
| La vista de impresión apilaba las celdas (colisión de la clase `row` con estilos globales) | Revisión visual (Playwright) | Clase propia `prow` |
| Las tablas PDF perdían los estilos base al personalizar estilos | Revisión visual del PDF | Fusión de estilos |
| Código de activo partido en el PDF A4 | Revisión visual del PDF | Ajuste de columnas |
| Gráficas del dashboard sin altura y tarjeta desalineada | Revisión visual | CSS del componente Chart y de la grilla |
| Script de inicio con saltos de línea CRLF en la imagen Docker | Despliegue | `.gitattributes` y normalización a LF en las imágenes |
| La imagen de producción dependía de ts-node para los scripts administrativos | Despliegue | Scripts compilados (`dist-tools`) |

## 6.4 Limitaciones de las pruebas

- Las pruebas E2E se ejecutan sobre la base de desarrollo con datos demo y crean registros con prefijo `E2E`.
- No se realizaron pruebas de carga ni pruebas de penetración externas; se recomiendan antes de la puesta en producción.
- La impresión física se validó mediante la generación del PDF del navegador en medio *print* (A4 horizontal), no en una impresora real.
