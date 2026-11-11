# 2. Manual de usuario

SIGM gestiona el mantenimiento de **equipos de cómputo y sistemas**. Todas las fechas se muestran en formato DD/MM/AAAA y en hora de Bogotá; los valores en pesos colombianos (COP). El menú lateral solo muestra las secciones que su rol puede usar.

## Ingreso
- Ingrese con su usuario y contraseña. Tras 5 intentos fallidos la cuenta se bloquea 15 minutos (parámetro configurable).
- En el primer ingreso, o después de un restablecimiento, el sistema exige cambiar la contraseña: mínimo 10 caracteres, con mayúsculas, minúsculas, número y símbolo, y sin incluir el nombre de usuario.
- La sesión se cierra tras 2 horas sin actividad o con el botón **Cerrar sesión**.

## Dashboard
Resumen en tiempo real filtrable por año, mes, área, categoría y responsable:
- **Inventario**: activos, operativos y fuera de servicio.
- **Mantenimientos**: programados, ejecutados, pendientes y vencidos.
- **Correctivos**: abiertos y urgentes. Las fallas urgentes aparecen destacadas arriba.
- **Cumplimiento**, en dos indicadores separados:
  - *Programa base aprobado*: compara contra la fecha originalmente aprobada.
  - *Fechas reprogramadas aprobadas*: compara contra la fecha vigente.
- **Tiempos**: respuesta, reparación, solución, indisponibilidad y reincidencia.
- **Costos** del periodo.

Cuando faltan datos, el sistema muestra "Sin datos suficientes" en lugar de calcular un valor.

## Inventario de activos
- **Registrar activo**:
  - Identificación: código (automático si se deja vacío), categoría, marca, modelo y serie.
  - **Datos técnicos**: hostname, IP, MAC, sistema operativo, procesador, RAM, almacenamiento y vencimiento de licencia.
  - Ubicación, usuario final, responsable, proveedor, adquisición y garantía.
- **No registre contraseñas, claves de licencia ni información de pacientes.**
- Búsqueda por código, nombre, serie, hostname, IP, MAC o usuario final. Filtros por categoría, área, ubicación, criticidad y estado.
- Exportación: **F-01 PDF** y **Excel**.

## Hoja de vida del activo
Abre al hacer clic en un activo y conserva todo su historial:
- **Pestañas**:
  - Información general y QR.
  - Programas y cronograma histórico.
  - Órdenes, fallas, repuestos y costos.
  - Documentos y trazabilidad de estados.
- **Evaluar criticidad**: se califican los criterios de la matriz; el sistema calcula el nivel y se puede asignar otro con justificación. La criticidad sirve para priorizar, **no** define la frecuencia de mantenimiento.
- **Cambiar estado**: requiere justificación. Al dar de baja o retirar, las actividades futuras pasan a "No aplica" (se conservan) y los programas se desactivan.
- **Hoja de vida PDF** (F-06) e **Imprimir QR**.

## Plan maestro
- **Nuevo programa** de mantenimiento por activo:
  - Datos: actividad, procedimiento, lista de verificación, periodicidad, fecha de inicio y fecha base, responsable y proveedor.
  - Periodicidades: semanal, quincenal (15 días), mensual, bimestral, trimestral, cuatrimestral, semestral, anual, intervalo personalizado (días, semanas o meses) o fechas específicas (MM-DD).
  - El **sustento técnico de la periodicidad** es obligatorio (fabricante, condiciones de uso, historial).
- Si cambia la periodicidad, debe indicar el motivo. Los planes ya aprobados **no** se modifican automáticamente.

## Cronograma anual
1. Elija el **año**; por defecto aparece el año actual de Bogotá.
2. **Crear plan anual** (queda en *Borrador*).
3. **Generar cronograma**: crea las actividades del año sin duplicarlas y muestra cuántas se generaron por categoría y mes. Repetir la generación no duplica nada.
4. Revise la **vista matricial** (filas = activo/mantenimiento, columnas = meses) o la **vista detallada** (filtrable y ordenable).
5. **Enviar a revisión** → **Aprobar**: se crea una versión inmutable y la fecha aprobada queda protegida.
6. **Imprimir cronograma** (vista de impresión institucional, A4/A3 horizontal, con firmas y numeración), **PDF A4/A3** y **Exportar Excel** (3 hojas).
7. **Cerrar y archivar** al finalizar el año.

### Actividades
Al hacer clic en una actividad puede:
- Asignar el responsable.
- **Generar la orden de trabajo**.
- **Reprogramar**: exige justificación y, en un plan aprobado, aprobación. Se conservan la fecha original, la comprometida y la de ejecución.
- Marcar "No aplica" o cancelar, con justificación.
- Descargar el **F-08** de inspección técnica.

## Mantenimientos preventivos
Muestra las actividades vencidas, próximas, en ejecución o de un mes, y genera las órdenes preventivas. **Generar una orden no marca la actividad como ejecutada**: eso ocurre al cerrar la orden validada.

## Órdenes de trabajo
Flujo: *Abierta → Asignada → En ejecución → (Pendiente de repuestos / de proveedor) → Pendiente de validación → Cerrada*.

1. **Iniciar ejecución**: lo hace el responsable asignado.
2. **Registro de ejecución**:
   - Actividades realizadas, lista de chequeo y hallazgos.
   - Resultado o, en correctivos, diagnóstico y pruebas.
   - Condición final, mano de obra y servicios externos.
   - **Repuestos**.
3. Adjunte **evidencias**: fotografías, actas e informes.
4. **Solicitar validación**: el sistema verifica los campos obligatorios.
5. **Validar y cerrar** (coordinación): verificación e identificación de quien valida. Quien ejecutó no puede validar su propia orden.
6. **Cancelar** exige justificación; la orden se conserva.

Si durante un preventivo se detecta una falla, use **Registrar falla detectada**: se crean el reporte y la orden correctiva relacionada.

## Mantenimientos correctivos
- **Reportar falla**: seleccione el activo, describa la falla y su impacto, y califique 3 criterios de 1 a 5. El sistema calcula la prioridad, incluyendo la criticidad del activo, y asigna un consecutivo **FA-AAAA-NNNNN**.
- Coordinación:
  - **Evaluar y clasificar**: ajuste de prioridad con justificación y marcar el activo fuera de servicio, lo que inicia el registro de indisponibilidad.
  - **Asignar responsable**: genera la orden correctiva.
  - **Autorizar liberación** y **Cerrar reporte**.
- Un **activo crítico** solo lo libera personal con competencia técnica certificada.

## Proveedores y contratos
Proveedores internos y externos, contratos con sus equipos cubiertos, documentos, intervenciones y **evaluación F-11**. Hay alertas de vencimiento de contratos, garantías y licencias.

## Documentos y evidencias
Repositorio con acceso controlado: PDF, JPG y PNG, más otros formatos autorizados. El sistema verifica el tipo real del archivo. Los documentos no se eliminan: se **anulan** con justificación.

## Informes
Formatos F-01 a F-12 e informe de **fallas recurrentes** (criterio configurable).

## Usuarios, configuración y auditoría
- **Usuarios y permisos** (administrador):
  - Gestión de usuarios, áreas y competencia técnica.
  - Restablecimiento de contraseñas y desbloqueo.
  - Matriz editable de permisos por rol.
- **Configuración**:
  - Áreas, ubicaciones y categorías.
  - Matriz de criticidad y parámetros (identidad institucional, umbrales, tipos de archivo).
  - Formatos documentales y procedimientos.
- **Auditoría**:
  - Bitácora inmutable con filtros y exportación a Excel.
  - Registro de respaldos.
