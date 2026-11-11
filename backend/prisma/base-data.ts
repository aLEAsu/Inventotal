/**
 * Datos base de configuración (NO son datos de demostración).
 * ALCANCE: equipos de cómputo, sistemas (TI) e infraestructura de climatización (aires acondicionados).
 * Las ponderaciones y textos son PUNTOS DE PARTIDA configurables: deben ser validados por la
 * coordinación de sistemas / mantenimiento y la normativa colombiana vigente.
 */
export const CATEGORIES = [
  { code: 'CMP', name: 'Equipos de cómputo', color: '#1d4ed8', description: 'Computadores de escritorio, portátiles y estaciones de trabajo', subs: ['Escritorio', 'Portátil', 'Todo en uno', 'Estación de trabajo', 'Tableta'] },
  { code: 'SRV', name: 'Servidores y almacenamiento', color: '#4338ca', description: 'Servidores físicos y virtuales, almacenamiento y respaldo de datos', subs: ['Servidor físico', 'Servidor virtual', 'Almacenamiento (NAS/SAN)', 'Unidad de respaldo'] },
  { code: 'RED', name: 'Redes y comunicaciones', color: '#0e7490', description: 'Equipos activos de red y cableado estructurado', subs: ['Switch', 'Router', 'Firewall', 'Punto de acceso inalámbrico', 'Cableado estructurado', 'Rack / gabinete'] },
  { code: 'PER', name: 'Impresión y periféricos', color: '#7c3aed', description: 'Impresoras, escáneres, monitores y periféricos', subs: ['Impresora', 'Impresora de etiquetas', 'Escáner', 'Lector de código de barras', 'Lector biométrico', 'Monitor', 'Televisor / pantalla', 'Videoproyector', 'Mouse', 'Teclado'] },
  { code: 'TEL', name: 'Telefonía y comunicaciones unificadas', color: '#0f766e', description: 'Telefonía IP, centrales y equipos de comunicación', subs: ['Teléfono IP', 'Central telefónica', 'Diadema / audio', 'Videoconferencia'] },
  { code: 'UPS', name: 'Respaldo eléctrico de TI', color: '#b45309', description: 'UPS y reguladores que protegen equipos de cómputo', subs: ['UPS', 'Regulador de voltaje', 'PDU', 'Multitoma'] },
  { code: 'MOV', name: 'Dispositivos móviles', color: '#be185d', description: 'Celulares y tabletas institucionales', subs: ['Celular', 'Tableta'] },
  { code: 'AAC', name: 'Climatización (aire acondicionado)', color: '#0369a1', description: 'Infraestructura: aires acondicionados y equipos de climatización', subs: ['Mini split', 'Aire central', 'Ventilación / extracción'] },
  { code: 'SIS', name: 'Sistemas de información y software', color: '#374151', description: 'Aplicaciones, bases de datos, licencias y plataformas', subs: ['Sistema de información clínico', 'Sistema administrativo / ERP', 'Base de datos', 'Sistema operativo / licencias', 'Antivirus / seguridad', 'Copias de seguridad'] },
];

export const CRITERIA = [
  { code: 'IMPACTO_ASISTENCIAL', name: 'Impacto sobre la atención y la seguridad del paciente', weight: 25, sortOrder: 1, scaleGuide: ['1 = No se usa en procesos asistenciales', '2 = Apoyo indirecto', '3 = Retrasa la atención', '4 = Impide registrar/consultar información clínica', '5 = Compromete directamente la atención'] },
  { code: 'CONTINUIDAD_SERVICIO', name: 'Impacto en la continuidad de los servicios', weight: 20, sortOrder: 2, scaleGuide: ['1 = Afecta a un usuario', '2 = Afecta a un puesto de trabajo', '3 = Afecta a un área', '4 = Afecta a varias áreas', '5 = Afecta a toda la institución'] },
  { code: 'INFORMACION', name: 'Impacto sobre la información (confidencialidad, integridad, disponibilidad)', weight: 15, sortOrder: 3, scaleGuide: ['1 = Sin información relevante', '2 = Información de uso interno', '3 = Información administrativa importante', '4 = Información sensible', '5 = Información clínica o crítica sin respaldo'] },
  { code: 'PROBABILIDAD_FALLA', name: 'Probabilidad de falla', weight: 15, sortOrder: 4, scaleGuide: ['1 = Muy baja', '2 = Baja', '3 = Media', '4 = Alta (antigüedad, uso intensivo)', '5 = Muy alta (historial de fallas frecuentes)'] },
  { code: 'RESPALDO', name: 'Redundancia o equipo de respaldo', weight: 15, sortOrder: 5, scaleGuide: ['1 = Redundancia automática', '2 = Equipo de respaldo inmediato', '3 = Respaldo disponible en horas', '4 = Respaldo parcial', '5 = Sin respaldo'] },
  { code: 'ALTERNATIVAS', name: 'Alternativas o plan de contingencia', weight: 10, sortOrder: 6, scaleGuide: ['1 = Múltiples alternativas', '2 = Alternativa interna', '3 = Contingencia manual documentada', '4 = Alternativa limitada', '5 = Sin alternativa'] },
];

export const FORMATS = [
  ['F-01', 'Inventario general de equipos de cómputo, sistemas e infraestructura'],
  ['F-02', 'Plan maestro anual de mantenimiento'],
  ['F-03', 'Orden de trabajo'],
  ['F-04', 'Registro de mantenimiento preventivo'],
  ['F-05', 'Registro de mantenimiento correctivo'],
  ['F-06', 'Hoja de vida del equipo'],
  ['F-07', 'Solicitud de soporte y mantenimiento'],
  ['F-08', 'Registro de inspección técnica'],
  ['F-09', 'Informe mensual de mantenimiento'],
  ['F-10', 'Informe de cumplimiento del plan anual'],
  ['F-11', 'Evaluación de proveedores'],
  ['F-12', 'Registro de fallas recurrentes'],
].map(([code, name]) => ({ code, name, documentCode: `SIS-${code}`, version: '1' }));

const pv = 'Plantilla inicial: debe ser revisada, ajustada y aprobada por la institución antes de su uso oficial.';

export const PROCEDURES: { code: string; title: string; objective: string; responsible: string; content: string }[] = [
  {
    code: 'PR-01', title: 'Alta y clasificación de equipos', objective: 'Registrar todo equipo de cómputo o sistema sujeto a mantenimiento con información completa y clasificarlo según su criticidad.', responsible: 'Coordinador de sistemas / mantenimiento',
    content: `${pv}\n\n1. Verificar que el equipo no exista en el inventario (buscar por serie, hostname, IP y código).\n2. Registrarlo en Inventario > Nuevo activo con datos de identificación, datos técnicos (hostname, IP, MAC, sistema operativo, procesador, RAM, almacenamiento), ubicación, área, usuario final, proveedor y garantía.\n3. Adjuntar fotografías, ficha técnica y soportes de licencia (sin registrar claves de licencia ni contraseñas).\n4. Evaluar la criticidad con la matriz configurada y documentar la justificación.\n5. Generar e imprimir el código QR y fijarlo en el equipo.\n6. Verificar en la hoja de vida que la información quedó completa.`,
  },
  {
    code: 'PR-02', title: 'Creación del programa preventivo', objective: 'Definir actividades preventivas con periodicidad técnicamente sustentada.', responsible: 'Coordinador de sistemas / responsable técnico',
    content: `${pv}\n\n1. Consultar las recomendaciones del fabricante, las condiciones de uso (horas, ambiente, polvo) y el historial de fallas.\n2. Crear el programa en Plan maestro > Nuevo programa: actividad (limpieza física, actualización de sistema operativo y antivirus, verificación de respaldos, revisión de discos, etc.), procedimiento, lista de verificación, periodicidad y fecha base.\n3. Documentar obligatoriamente el sustento técnico de la periodicidad. La criticidad NO define por sí sola la frecuencia.\n4. Asignar responsable y, si aplica, proveedor externo.\n5. Revisar la vista previa de fechas del año.`,
  },
  {
    code: 'PR-03', title: 'Generación del cronograma anual', objective: 'Generar de forma controlada y sin duplicados el cronograma del año.', responsible: 'Coordinador de sistemas / mantenimiento',
    content: `${pv}\n\n1. En Cronograma anual seleccionar el año (por defecto el año actual de Bogotá).\n2. Crear el plan anual si no existe.\n3. Ejecutar "Generar cronograma". La operación es transaccional e idempotente: repetirla no duplica actividades.\n4. Revisar el resumen por categoría y mes, la vista matricial y el detalle.\n5. Ajustar en borrador las fechas que lo requieran, con justificación.`,
  },
  {
    code: 'PR-04', title: 'Aprobación del plan', objective: 'Establecer la línea base aprobada del plan anual.', responsible: 'Coordinador / Gerencia',
    content: `${pv}\n\n1. Enviar el plan a revisión.\n2. El revisor verifica cobertura de equipos, periodicidades y responsables; si hay observaciones devuelve el plan a borrador con justificación.\n3. Aprobar el plan: el sistema crea una versión inmutable y protege las fechas originalmente aprobadas.\n4. Imprimir o descargar el PDF para firmas.`,
  },
  {
    code: 'PR-05', title: 'Asignación de actividades', objective: 'Asegurar que cada actividad tenga un responsable.', responsible: 'Coordinador de sistemas / mantenimiento',
    content: `${pv}\n\n1. Filtrar en el cronograma las actividades del mes.\n2. Asignar o cambiar el responsable.\n3. Coordinar con el área la disponibilidad del equipo y generar la orden de trabajo preventiva.`,
  },
  {
    code: 'PR-06', title: 'Ejecución de mantenimiento preventivo', objective: 'Ejecutar y documentar el mantenimiento preventivo de forma verificable.', responsible: 'Técnico de sistemas / proveedor',
    content: `${pv}\n\n1. Consultar la orden asignada y el procedimiento técnico.\n2. Confirmar con el usuario final y verificar que exista copia de la información antes de intervenir.\n3. Iniciar la ejecución en el sistema.\n4. Diligenciar la lista de chequeo, actividades ejecutadas, hallazgos, resultado, repuestos y costos.\n5. Adjuntar fotografías y soportes.\n6. Si se detecta una falla, generar la orden correctiva relacionada.\n7. Registrar la condición final y solicitar validación.`,
  },
  {
    code: 'PR-07', title: 'Reporte de falla', objective: 'Reportar oportunamente fallas de equipos de cómputo y sistemas.', responsible: 'Cualquier usuario autorizado (solicitante)',
    content: `${pv}\n\n1. Ingresar a Mantenimientos correctivos > Reportar falla.\n2. Seleccionar el equipo o sistema, describir la falla y su impacto en el servicio, y calificar los criterios de priorización.\n3. Adjuntar capturas de pantalla o fotografías si es posible.\n4. NO registrar información de pacientes (nombres, historias clínicas o diagnósticos) ni contraseñas.\n5. Consultar el estado de la solicitud con su número consecutivo.`,
  },
  {
    code: 'PR-08', title: 'Atención del mantenimiento correctivo', objective: 'Diagnosticar, reparar y restablecer el equipo con trazabilidad.', responsible: 'Coordinador / técnico de sistemas',
    content: `${pv}\n\n1. Evaluar y clasificar el reporte; ajustar prioridad con justificación si corresponde.\n2. Marcar el equipo como fuera de servicio cuando comprometa la operación (se registra el inicio de indisponibilidad) y activar la contingencia.\n3. Asignar el responsable: se genera la orden correctiva.\n4. Registrar diagnóstico, intervención, repuestos, pruebas y condición final.\n5. Validar y cerrar; para equipos críticos la liberación solo la autoriza personal con competencia técnica.`,
  },
  {
    code: 'PR-09', title: 'Reprogramación', objective: 'Modificar fechas sin perder la línea base ni ocultar retrasos.', responsible: 'Responsable de área / coordinador',
    content: `${pv}\n\n1. Solicitar la reprogramación desde la actividad indicando la nueva fecha y la justificación.\n2. En planes aprobados la solicitud queda pendiente hasta su aprobación.\n3. El sistema conserva la fecha originalmente aprobada, la fecha comprometida y la fecha real de ejecución.\n4. Cada aprobación incrementa la versión del plan.`,
  },
  {
    code: 'PR-10', title: 'Validación y cierre de órdenes', objective: 'Verificar técnicamente la calidad de la intervención antes del cierre.', responsible: 'Coordinador de sistemas / mantenimiento',
    content: `${pv}\n\n1. Revisar la documentación de la orden pendiente de validación.\n2. Si está incompleta, devolverla al ejecutor con observaciones.\n3. Si es conforme, registrar la verificación e identificación de quien valida y cerrar.\n4. Quien ejecutó no puede validar su propia orden (segregación de funciones).`,
  },
  {
    code: 'PR-11', title: 'Actualización de hojas de vida', objective: 'Mantener la hoja de vida acumulativa y completa.', responsible: 'Coordinador de sistemas / mantenimiento',
    content: `${pv}\n\n1. La hoja de vida se actualiza automáticamente con órdenes, fallas, repuestos, costos y estados.\n2. Actualizar los datos técnicos (RAM, almacenamiento, sistema operativo) cuando cambien.\n3. Adjuntar certificados, informes de proveedores y actas.\n4. Imprimir el F-06 cuando se requiera.`,
  },
  {
    code: 'PR-12', title: 'Gestión de proveedores', objective: 'Controlar contratos, garantías, licencias y desempeño de proveedores.', responsible: 'Coordinador de sistemas / mantenimiento',
    content: `${pv}\n\n1. Registrar proveedor, contratos, fechas de vigencia y equipos atendidos.\n2. Atender las alertas de vencimiento de contratos y garantías.\n3. Registrar el proveedor en cada intervención externa.\n4. Evaluar periódicamente al proveedor (F-11).`,
  },
  {
    code: 'PR-13', title: 'Control de evidencias', objective: 'Asegurar la conservación y acceso controlado de los soportes.', responsible: 'Todos los usuarios que adjuntan soportes',
    content: `${pv}\n\n1. Adjuntar solo formatos autorizados (PDF, JPG, PNG u otros configurados).\n2. Los documentos no se eliminan; se anulan con justificación conservando el archivo.\n3. Los archivos se almacenan en un repositorio privado con acceso controlado.\n4. No adjuntar contraseñas, claves de licencia ni información de pacientes.`,
  },
  {
    code: 'PR-14', title: 'Elaboración del informe mensual', objective: 'Reportar el desempeño mensual del mantenimiento de TI.', responsible: 'Coordinador de sistemas / mantenimiento',
    content: `${pv}\n\n1. Generar el F-09 para el mes, con los filtros requeridos.\n2. Analizar cumplimiento base y reprogramado, fallas, tiempos y costos.\n3. Documentar acciones de mejora y presentar a Calidad y Gerencia.`,
  },
  {
    code: 'PR-15', title: 'Cierre y archivo anual', objective: 'Cerrar formalmente el plan anual y archivar su información.', responsible: 'Coordinador de sistemas / mantenimiento',
    content: `${pv}\n\n1. Verificar que no existan reprogramaciones pendientes.\n2. Generar el F-10 de cumplimiento anual.\n3. Cerrar el plan con justificación: queda protegido contra modificaciones.\n4. Descargar PDF y Excel del plan para el archivo documental.\n5. Verificar los respaldos de base de datos y documentos del cierre.`,
  },
];
