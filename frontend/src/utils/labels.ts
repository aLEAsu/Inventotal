/** Etiquetas en español y severidad visual (colores con significado) de los estados del sistema */
type Sev = 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast';
interface L {
  label: string;
  sev: Sev;
}
const m = (label: string, sev: Sev): L => ({ label, sev });

export const ASSET_STATUS: Record<string, L> = {
  OPERATIVO: m('Operativo', 'success'),
  OPERATIVO_CON_OBSERVACIONES: m('Operativo con observaciones', 'warn'),
  EN_MANTENIMIENTO: m('En mantenimiento', 'info'),
  FUERA_DE_SERVICIO: m('Fuera de servicio', 'danger'),
  RETIRADO: m('Retirado', 'secondary'),
  DADO_DE_BAJA: m('Dado de baja', 'contrast'),
};
export const CRITICALITY: Record<string, L> = {
  CRITICA: m('Crítica', 'danger'), ALTA: m('Alta', 'warn'), MEDIA: m('Media', 'info'), BAJA: m('Baja', 'secondary'),
};
export const PRIORITY: Record<string, L> = {
  URGENTE: m('Urgente', 'danger'), ALTA: m('Alta', 'warn'), MEDIA: m('Media', 'info'), BAJA: m('Baja', 'secondary'),
};
export const ACTIVITY_STATUS: Record<string, L> = {
  PROGRAMADO: m('Programado', 'info'), PROXIMO: m('Próximo', 'warn'), EN_EJECUCION: m('En ejecución', 'contrast'),
  EJECUTADO: m('Ejecutado', 'success'), VENCIDO: m('Vencido', 'danger'), REPROGRAMADO: m('Reprogramado', 'secondary'),
  CANCELADO: m('Cancelado', 'secondary'), NO_APLICA: m('No aplica', 'secondary'),
};
export const PLAN_STATUS: Record<string, L> = {
  BORRADOR: m('Borrador', 'secondary'), EN_REVISION: m('En revisión', 'warn'), APROBADO: m('Aprobado', 'success'), CERRADO: m('Cerrado', 'contrast'),
};
export const WO_STATUS: Record<string, L> = {
  ABIERTA: m('Abierta', 'secondary'), ASIGNADA: m('Asignada', 'info'), EN_EJECUCION: m('En ejecución', 'contrast'),
  PENDIENTE_REPUESTOS: m('Pendiente de repuestos', 'warn'), PENDIENTE_PROVEEDOR: m('Pendiente de proveedor', 'warn'),
  PENDIENTE_VALIDACION: m('Pendiente de validación', 'warn'), CERRADA: m('Cerrada', 'success'), CANCELADA: m('Cancelada', 'secondary'),
};
export const FAILURE_STATUS: Record<string, L> = {
  REPORTADA: m('Reportada', 'danger'), EN_EVALUACION: m('En evaluación', 'warn'), ASIGNADA: m('Asignada', 'info'),
  EN_ATENCION: m('En atención', 'contrast'), RESUELTA: m('Resuelta', 'success'), CERRADA: m('Cerrada', 'secondary'), ANULADA: m('Anulada', 'secondary'),
};
export const RESCHEDULE_STATUS: Record<string, L> = { PENDIENTE: m('Pendiente', 'warn'), APROBADA: m('Aprobada', 'success'), RECHAZADA: m('Rechazada', 'danger') };

export const WO_TYPE: Record<string, string> = { PREVENTIVA: 'Preventiva', CORRECTIVA: 'Correctiva' };
export const FINAL_CONDITION: Record<string, string> = {
  OPERATIVO: 'Operativo', OPERATIVO_CON_OBSERVACIONES: 'Operativo con observaciones', FUERA_DE_SERVICIO: 'Fuera de servicio', REQUIERE_BAJA: 'Requiere baja',
};
export const ASSET_CONDITION: Record<string, string> = {
  FUNCIONA_NORMAL: 'Funciona normalmente', FUNCIONA_CON_LIMITACIONES: 'Funciona con limitaciones', NO_FUNCIONA: 'No funciona', RIESGO_SEGURIDAD: 'Representa un riesgo',
};
export const KIND: Record<string, string> = {
  PREVENTIVO: 'Preventivo', CORRECTIVO: 'Correctivo', INSPECCION: 'Inspección', CALIBRACION: 'Calibración', VERIFICACION_METROLOGICA: 'Verificación técnica',
  LIMPIEZA: 'Limpieza', PRUEBA_FUNCIONAL: 'Prueba funcional / verificación', OTRO: 'Otro',
};
export const FREQUENCY: Record<string, string> = {
  SEMANAL: 'Semanal', QUINCENAL: 'Quincenal (15 días)', MENSUAL: 'Mensual', BIMESTRAL: 'Bimestral', TRIMESTRAL: 'Trimestral',
  CUATRIMESTRAL: 'Cuatrimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual', PERSONALIZADO: 'Intervalo personalizado', FECHAS_ESPECIFICAS: 'Fechas específicas',
  SEMANA_DEL_MES: 'Semana específica del mes',
};
export const DOC_TYPE: Record<string, string> = {
  MANUAL_TECNICO: 'Manual técnico', FICHA_TECNICA: 'Ficha técnica', CERTIFICADO: 'Certificado', INFORME_MANTENIMIENTO: 'Informe de mantenimiento',
  FOTOGRAFIA: 'Fotografía', ACTA_SERVICIO: 'Acta de servicio', COTIZACION: 'Cotización', FACTURA: 'Factura', GARANTIA: 'Garantía', CONTRATO: 'Contrato', OTRO: 'Otro soporte',
};
export const CHECK_RESULT: Record<string, string> = { CUMPLE: 'Cumple', NO_CUMPLE: 'No cumple', NO_APLICA: 'No aplica' };

export const opts = (o: Record<string, L | string>) =>
  Object.entries(o).map(([value, v]) => ({ value, label: typeof v === 'string' ? v : v.label }));
