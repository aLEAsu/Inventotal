# 8. Procedimientos operativos

> Plantillas iniciales cargadas en el sistema (Configuración › Procedimientos), donde se consultan y versionan. **Deben ser revisadas y aprobadas por la institución**; al validarlas, desmarque "Pendiente de validación".

## PR-01 — Alta y clasificación de equipos

**Objetivo:** Registrar todo equipo de cómputo o sistema sujeto a mantenimiento con información completa y clasificarlo según su criticidad.  
**Responsable:** Coordinador de sistemas / mantenimiento

1. Verificar que el equipo no exista en el inventario (buscar por serie, hostname, IP y código).
2. Registrarlo en Inventario > Nuevo activo con datos de identificación, datos técnicos (hostname, IP, MAC, sistema operativo, procesador, RAM, almacenamiento), ubicación, área, usuario final, proveedor y garantía.
3. Adjuntar fotografías, ficha técnica y soportes de licencia (sin registrar claves de licencia ni contraseñas).
4. Evaluar la criticidad con la matriz configurada y documentar la justificación.
5. Generar e imprimir el código QR y fijarlo en el equipo.
6. Verificar en la hoja de vida que la información quedó completa.

## PR-02 — Creación del programa preventivo

**Objetivo:** Definir actividades preventivas con periodicidad técnicamente sustentada.  
**Responsable:** Coordinador de sistemas / responsable técnico

1. Consultar las recomendaciones del fabricante, las condiciones de uso (horas, ambiente, polvo) y el historial de fallas.
2. Crear el programa en Plan maestro > Nuevo programa: actividad (limpieza física, actualización de sistema operativo y antivirus, verificación de respaldos, revisión de discos, etc.), procedimiento, lista de verificación, periodicidad y fecha base.
3. Documentar obligatoriamente el sustento técnico de la periodicidad. La criticidad NO define por sí sola la frecuencia.
4. Asignar responsable y, si aplica, proveedor externo.
5. Revisar la vista previa de fechas del año.

## PR-03 — Generación del cronograma anual

**Objetivo:** Generar de forma controlada y sin duplicados el cronograma del año.  
**Responsable:** Coordinador de sistemas / mantenimiento

1. En Cronograma anual seleccionar el año (por defecto el año actual de Bogotá).
2. Crear el plan anual si no existe.
3. Ejecutar "Generar cronograma". La operación es transaccional e idempotente: repetirla no duplica actividades.
4. Revisar el resumen por categoría y mes, la vista matricial y el detalle.
5. Ajustar en borrador las fechas que lo requieran, con justificación.

## PR-04 — Aprobación del plan

**Objetivo:** Establecer la línea base aprobada del plan anual.  
**Responsable:** Coordinador / Gerencia

1. Enviar el plan a revisión.
2. El revisor verifica cobertura de equipos, periodicidades y responsables; si hay observaciones devuelve el plan a borrador con justificación.
3. Aprobar el plan: el sistema crea una versión inmutable y protege las fechas originalmente aprobadas.
4. Imprimir o descargar el PDF para firmas.

## PR-05 — Asignación de actividades

**Objetivo:** Asegurar que cada actividad tenga un responsable.  
**Responsable:** Coordinador de sistemas / mantenimiento

1. Filtrar en el cronograma las actividades del mes.
2. Asignar o cambiar el responsable.
3. Coordinar con el área la disponibilidad del equipo y generar la orden de trabajo preventiva.

## PR-06 — Ejecución de mantenimiento preventivo

**Objetivo:** Ejecutar y documentar el mantenimiento preventivo de forma verificable.  
**Responsable:** Técnico de sistemas / proveedor

1. Consultar la orden asignada y el procedimiento técnico.
2. Confirmar con el usuario final y verificar que exista copia de la información antes de intervenir.
3. Iniciar la ejecución en el sistema.
4. Diligenciar la lista de chequeo, actividades ejecutadas, hallazgos, resultado, repuestos y costos.
5. Adjuntar fotografías y soportes.
6. Si se detecta una falla, generar la orden correctiva relacionada.
7. Registrar la condición final y solicitar validación.

## PR-07 — Reporte de falla

**Objetivo:** Reportar oportunamente fallas de equipos de cómputo y sistemas.  
**Responsable:** Cualquier usuario autorizado (solicitante)

1. Ingresar a Mantenimientos correctivos > Reportar falla.
2. Seleccionar el equipo o sistema, describir la falla y su impacto en el servicio, y calificar los criterios de priorización.
3. Adjuntar capturas de pantalla o fotografías si es posible.
4. NO registrar información de pacientes (nombres, historias clínicas o diagnósticos) ni contraseñas.
5. Consultar el estado de la solicitud con su número consecutivo.

## PR-08 — Atención del mantenimiento correctivo

**Objetivo:** Diagnosticar, reparar y restablecer el equipo con trazabilidad.  
**Responsable:** Coordinador / técnico de sistemas

1. Evaluar y clasificar el reporte; ajustar prioridad con justificación si corresponde.
2. Marcar el equipo como fuera de servicio cuando comprometa la operación (se registra el inicio de indisponibilidad) y activar la contingencia.
3. Asignar el responsable: se genera la orden correctiva.
4. Registrar diagnóstico, intervención, repuestos, pruebas y condición final.
5. Validar y cerrar; para equipos críticos la liberación solo la autoriza personal con competencia técnica.

## PR-09 — Reprogramación

**Objetivo:** Modificar fechas sin perder la línea base ni ocultar retrasos.  
**Responsable:** Responsable de área / coordinador

1. Solicitar la reprogramación desde la actividad indicando la nueva fecha y la justificación.
2. En planes aprobados la solicitud queda pendiente hasta su aprobación.
3. El sistema conserva la fecha originalmente aprobada, la fecha comprometida y la fecha real de ejecución.
4. Cada aprobación incrementa la versión del plan.

## PR-10 — Validación y cierre de órdenes

**Objetivo:** Verificar técnicamente la calidad de la intervención antes del cierre.  
**Responsable:** Coordinador de sistemas / mantenimiento

1. Revisar la documentación de la orden pendiente de validación.
2. Si está incompleta, devolverla al ejecutor con observaciones.
3. Si es conforme, registrar la verificación e identificación de quien valida y cerrar.
4. Quien ejecutó no puede validar su propia orden (segregación de funciones).

## PR-11 — Actualización de hojas de vida

**Objetivo:** Mantener la hoja de vida acumulativa y completa.  
**Responsable:** Coordinador de sistemas / mantenimiento

1. La hoja de vida se actualiza automáticamente con órdenes, fallas, repuestos, costos y estados.
2. Actualizar los datos técnicos (RAM, almacenamiento, sistema operativo) cuando cambien.
3. Adjuntar certificados, informes de proveedores y actas.
4. Imprimir el F-06 cuando se requiera.

## PR-12 — Gestión de proveedores

**Objetivo:** Controlar contratos, garantías, licencias y desempeño de proveedores.  
**Responsable:** Coordinador de sistemas / mantenimiento

1. Registrar proveedor, contratos, fechas de vigencia y equipos atendidos.
2. Atender las alertas de vencimiento de contratos y garantías.
3. Registrar el proveedor en cada intervención externa.
4. Evaluar periódicamente al proveedor (F-11).

## PR-13 — Control de evidencias

**Objetivo:** Asegurar la conservación y acceso controlado de los soportes.  
**Responsable:** Todos los usuarios que adjuntan soportes

1. Adjuntar solo formatos autorizados (PDF, JPG, PNG u otros configurados).
2. Los documentos no se eliminan; se anulan con justificación conservando el archivo.
3. Los archivos se almacenan en un repositorio privado con acceso controlado.
4. No adjuntar contraseñas, claves de licencia ni información de pacientes.

## PR-14 — Elaboración del informe mensual

**Objetivo:** Reportar el desempeño mensual del mantenimiento de TI.  
**Responsable:** Coordinador de sistemas / mantenimiento

1. Generar el F-09 para el mes, con los filtros requeridos.
2. Analizar cumplimiento base y reprogramado, fallas, tiempos y costos.
3. Documentar acciones de mejora y presentar a Calidad y Gerencia.

## PR-15 — Cierre y archivo anual

**Objetivo:** Cerrar formalmente el plan anual y archivar su información.  
**Responsable:** Coordinador de sistemas / mantenimiento

1. Verificar que no existan reprogramaciones pendientes.
2. Generar el F-10 de cumplimiento anual.
3. Cerrar el plan con justificación: queda protegido contra modificaciones.
4. Descargar PDF y Excel del plan para el archivo documental.
5. Verificar los respaldos de base de datos y documentos del cierre.

