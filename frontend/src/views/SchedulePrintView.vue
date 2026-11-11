<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { http } from '@/api/http';
import { useAuth } from '@/stores/auth';
import { fmtDate, fmtDateTime, MONTHS, MONTHS_SHORT } from '@/utils/format';
import { ACTIVITY_STATUS, PLAN_STATUS } from '@/utils/labels';

/** Vista exclusiva de impresión del plan anual (formato institucional F-02) */
const route = useRoute();
const auth = useAuth();
const year = Number(route.params.year);
const params = Object.fromEntries(Object.entries(route.query).filter(([, v]) => typeof v === 'string' && v));
const paper = ref<'A4' | 'A3'>('A4');
const plan = ref<Record<string, any> | null>(null);
const matrix = ref<{ rows: Record<string, any>[] } | null>(null);
const summary = ref<Record<string, any> | null>(null);
const settings = ref<Record<string, unknown>>({});
const error = ref('');
const generatedAt = new Date();
const doPrint = () => window.print();

const SYM: Record<string, string> = { PROGRAMADO: 'P', PROXIMO: 'X', EN_EJECUCION: 'E', EJECUTADO: '✓', VENCIDO: 'V', REPROGRAMADO: 'R', CANCELADO: 'C', NO_APLICA: 'NA' };

onMounted(async () => {
  try {
    const [p, m, s, st] = await Promise.all([
      http.get(`/plans/${year}`), http.get(`/plans/${year}/matrix`, { params }), http.get(`/plans/${year}/summary`, { params }), http.get('/settings/public'),
    ]);
    plan.value = p.data.plan;
    matrix.value = m.data;
    summary.value = s.data;
    settings.value = st.data;
    document.title = `Plan anual de mantenimiento ${year}`;
  } catch {
    error.value = 'No fue posible cargar el plan para impresión.';
  }
});
const filterText = computed(() => {
  const parts: string[] = [];
  if (params.month) parts.push(`Mes: ${MONTHS[Number(params.month) - 1]}`);
  if (params.status) parts.push(`Estado: ${ACTIVITY_STATUS[String(params.status)]?.label}`);
  if (params.criticality) parts.push(`Criticidad: ${params.criticality}`);
  if (params.areaId || params.categoryId || params.assetId || params.responsibleId || params.q) parts.push('Filtros adicionales aplicados');
  return parts.join(' · ');
});
const pageStyle = computed(() => `@page { size: ${paper.value} landscape; margin: 10mm 8mm 14mm; @bottom-right { content: "Página " counter(page) " de " counter(pages); font: 8pt sans-serif; color: #555; } @bottom-left { content: "${plan.value?.documentCode ?? ''} · v${plan.value?.version ?? ''}"; font: 8pt sans-serif; color: #555; } }`);
</script>

<template>
  <component :is="'style'">{{ pageStyle }}</component>
  <div class="toolbar no-print">
    <strong>Vista de impresión</strong>
    <label>Papel <select v-model="paper"><option value="A4">A4 horizontal</option><option value="A3">A3 horizontal</option></select></label>
    <button class="btn" data-testid="do-print" @click="doPrint">Imprimir</button>
    <span class="hint">Use "Guardar como PDF" en el diálogo de impresión si lo requiere; la descarga PDF oficial está en el cronograma.</span>
  </div>
  <div v-if="error" class="sheet">{{ error }}</div>
  <div v-else-if="plan && matrix && summary" class="sheet" :class="paper" data-testid="print-sheet">
    <table class="doc">
      <thead>
        <tr>
          <td :colspan="16">
            <table class="hdr">
              <tr>
                <td class="inst"><div class="iname">{{ settings['institution.name'] }}</div><div v-if="settings['institution.nit']">NIT {{ settings['institution.nit'] }}</div></td>
                <td class="ttl"><div class="t1">{{ plan.title || 'PLAN ANUAL DE MANTENIMIENTO' }}</div><div class="t2">Equipos de cómputo y sistemas · Año {{ year }}</div><div v-if="filterText" class="t3">{{ filterText }}</div></td>
                <td class="ctl">
                  <div>Código: <b>{{ plan.documentCode }}</b></div>
                  <div>Versión: <b>{{ plan.version }}</b></div>
                  <div>Estado: <b>{{ PLAN_STATUS[plan.status].label }}</b></div>
                  <div>Generado: {{ fmtDateTime(generatedAt) }}</div>
                </td>
              </tr>
              <tr class="resp">
                <td>Elaboró: <b>{{ plan.createdBy ?? '—' }}</b></td>
                <td>Revisó: <b>{{ plan.reviewedBy ?? '—' }}</b></td>
                <td>Aprobó: <b>{{ plan.approvedBy ?? 'Pendiente' }}</b><span v-if="plan.approvedAt"> ({{ fmtDate(plan.approvedAt) }})</span></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr class="cols">
          <th style="width: 7%">Código</th>
          <th style="width: 21%">Activo / mantenimiento</th>
          <th style="width: 9%">Área</th>
          <th style="width: 7%">Periodicidad</th>
          <th v-for="m in MONTHS_SHORT" :key="m" class="m">{{ m }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!matrix.rows.length"><td colspan="16" class="center">Sin actividades para los filtros seleccionados.</td></tr>
        <tr v-for="r in matrix.rows" :key="r.programId" class="prow">
          <td class="mono">{{ r.assetCode }}</td>
          <td><b>{{ r.assetName }}</b><br />{{ r.programName }}</td>
          <td>{{ r.areaName }}</td>
          <td>{{ r.frequency }}</td>
          <td v-for="(cell, i) in r.months" :key="i" class="m" :class="cell.length ? `s-${cell[cell.length - 1].status}` : ''">
            <span v-for="x in cell" :key="x.id" class="it">{{ x.day }}{{ SYM[x.status] }}</span>
          </td>
        </tr>
      </tbody>
    </table>

    <div class="block avoid">
      <h3>Leyenda de estados</h3>
      <div class="legend"><span v-for="(s, k) in SYM" :key="k" :class="`s-${k}`">{{ s }} = {{ ACTIVITY_STATUS[k].label }}</span></div>
      <p class="small">El número indica el día de la fecha comprometida. R = fecha reprogramada con aprobación; la fecha originalmente aprobada se conserva en el sistema.</p>
    </div>
    <div class="block avoid two">
      <div>
        <h3>Totales por categoría</h3>
        <table class="sum">
          <thead><tr><th>Categoría</th><th>Total</th><th>Ejecutadas</th><th>Vencidas</th><th>% ejecución</th></tr></thead>
          <tbody>
            <tr v-for="(v, k) in summary.byCategory" :key="k"><td>{{ k }}</td><td>{{ v.total }}</td><td>{{ v.executed }}</td><td>{{ v.byStatus.VENCIDO ?? 0 }}</td><td>{{ v.total ? ((v.executed / v.total) * 100).toFixed(1) + ' %' : '—' }}</td></tr>
            <tr class="tot"><td>TOTAL</td><td>{{ summary.total }}</td><td>{{ Object.values(summary.byCategory).reduce((s: number, v: any) => s + v.executed, 0) }}</td><td>{{ summary.byStatus.VENCIDO ?? 0 }}</td><td /></tr>
          </tbody>
        </table>
      </div>
      <div>
        <h3>Actividades por mes</h3>
        <table class="sum"><thead><tr><th v-for="m in MONTHS_SHORT" :key="m">{{ m }}</th></tr></thead><tbody><tr><td v-for="(m, i) in summary.byMonth" :key="i">{{ m.total }}</td></tr></tbody></table>
      </div>
    </div>
    <div class="sign avoid">
      <div><div class="line" /><b>Elaboró</b><div>{{ plan.createdBy }}</div></div>
      <div><div class="line" /><b>Revisó</b><div>{{ plan.reviewedBy }}</div></div>
      <div><div class="line" /><b>Aprobó</b><div>{{ plan.approvedBy }}</div></div>
    </div>
    <div class="small foot">Impreso por {{ auth.me?.fullName }} el {{ fmtDateTime(generatedAt) }}. Documento generado a partir del plan almacenado en el sistema.</div>
  </div>
  <div v-else class="sheet">Cargando…</div>
</template>

<style scoped>
.toolbar { position: sticky; top: 0; display: flex; gap: 14px; align-items: center; padding: 10px 16px; background: #0f2a3d; color: #fff; font-size: 13px; z-index: 5; }
.toolbar .btn { background: #fff; color: #0f2a3d; border: 0; border-radius: 6px; padding: 6px 14px; font-weight: 600; cursor: pointer; }
.toolbar .hint { opacity: 0.75; font-size: 12px; }
.sheet { background: #fff; color: #111; margin: 16px auto; padding: 10mm; font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12); }
.sheet.A4 { width: 297mm; }
.sheet.A3 { width: 420mm; font-size: 9.5pt; }
table { border-collapse: collapse; width: 100%; }
.doc > thead { display: table-header-group; }
.doc td, .doc th { border: 0.6pt solid #888; padding: 2.5pt 3pt; vertical-align: top; }
.hdr td { border: 0.6pt solid #666; }
.inst { width: 28%; text-align: center; vertical-align: middle !important; }
.iname { font-weight: 700; font-size: 10.5pt; color: #0f3d56; }
.ttl { text-align: center; vertical-align: middle !important; }
.t1 { font-weight: 700; font-size: 13pt; }
.t2 { font-size: 9.5pt; }
.t3 { font-size: 8pt; color: #444; }
.ctl { width: 22%; font-size: 8pt; line-height: 1.5; }
.resp td { font-size: 8pt; }
.cols th { background: #0f3d56 !important; color: #fff; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.m { text-align: center; width: 4.6%; }
.it { display: inline-block; margin: 0 1pt; font-weight: 700; }
.prow { break-inside: avoid; page-break-inside: avoid; }
.mono { font-family: Consolas, monospace; }
.center { text-align: center; }
.block { margin-top: 8pt; }
.block h3 { font-size: 9.5pt; margin: 0 0 4pt; }
.two { display: grid; grid-template-columns: 1.3fr 1fr; gap: 10pt; }
.sum td, .sum th { border: 0.6pt solid #999; padding: 2pt 4pt; text-align: center; }
.sum td:first-child { text-align: left; }
.tot td { font-weight: 700; }
.legend { display: flex; flex-wrap: wrap; gap: 4pt; }
.legend span { padding: 1pt 5pt; border: 0.5pt solid #aaa; }
.small { font-size: 7.5pt; color: #444; }
.avoid { break-inside: avoid; page-break-inside: avoid; }
.sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24pt; margin-top: 30pt; text-align: center; }
.sign .line { border-top: 0.8pt solid #333; margin-bottom: 3pt; }
.foot { margin-top: 10pt; }
.s-PROGRAMADO { background: #dbeafe; } .s-PROXIMO { background: #fef3c7; } .s-EN_EJECUCION { background: #e0e7ff; } .s-EJECUTADO { background: #d1fae5; }
.s-VENCIDO { background: #fecaca; } .s-REPROGRAMADO { background: #ede9fe; } .s-CANCELADO { background: #e5e7eb; } .s-NO_APLICA { background: #f3f4f6; }
[class^='s-'], [class*=' s-'] { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print {
  :global(body) { background: #fff !important; }
  .sheet { margin: 0; padding: 0; box-shadow: none; width: auto !important; }
}
</style>
