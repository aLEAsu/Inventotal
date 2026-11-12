<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { http } from '@/api/http';
import { useAuth } from '@/stores/auth';
import { fmtDate, fmtDateTime, MONTHS, MONTHS_SHORT } from '@/utils/format';
import { ACTIVITY_STATUS, PLAN_STATUS } from '@/utils/labels';

/**
 * Vista de impresión del cronograma (formato institucional F-02).
 * Por defecto: una fila por grupo de mantenimiento y todo el cronograma ajustado a UNA hoja horizontal.
 */
const route = useRoute();
const auth = useAuth();
const year = Number(route.params.year);
const params = Object.fromEntries(Object.entries(route.query).filter(([, v]) => typeof v === 'string' && v)) as Record<string, string>;
/** Filas del cronograma impreso: una por categoría (grupos) o una por equipo; se puede cambiar antes de imprimir */
const view = ref<'grupos' | 'equipos'>(params.view === 'equipos' ? 'equipos' : 'grupos');
const grouped = computed(() => view.value === 'grupos');
const typeLabel = params.scheduleType === 'CORRECTIVO' ? 'CORRECTIVO' : params.scheduleType === 'PREVENTIVO' ? 'PREVENTIVO' : '';
const paper = ref<'A4' | 'A3'>('A4');
// La hoja única aplica a la vista por grupos; la vista por equipo puede ocupar varias hojas
const fit = ref(grouped.value);
const scale = ref(1);
const overflow = ref(false);
/** Por debajo de esta escala el texto deja de ser legible: se imprime en varias hojas */
const MIN_SCALE = 0.55;
const plan = ref<Record<string, any> | null>(null);
const matrix = ref<Record<string, any> | null>(null);
const settings = ref<Record<string, unknown>>({});
const error = ref('');
const sheet = ref<HTMLElement>();
const generatedAt = new Date();
const doPrint = () => window.print();

const SYM: Record<string, string> = { PROGRAMADO: 'P', PROXIMO: 'X', EN_EJECUCION: 'E', EJECUTADO: '✓', VENCIDO: 'V', REPROGRAMADO: 'R', CANCELADO: 'C', NO_APLICA: 'NA' };
const LEGEND = ['PROGRAMADO', 'PROXIMO', 'EN_EJECUCION', 'EJECUTADO', 'VENCIDO', 'REPROGRAMADO', 'CANCELADO'];

// Área imprimible (mm) con márgenes de 8 mm
const PAGE = { A4: { w: 297, h: 210 }, A3: { w: 420, h: 297 } } as const;
const MARGIN = 8;
const MM = 96 / 25.4;
const printable = computed(() => ({ w: PAGE[paper.value].w - 2 * MARGIN, h: PAGE[paper.value].h - 2 * MARGIN }));

/** Calcula la escala para que todo el contenido quepa en una sola hoja (el ancho se compensa para conservar el formato). */
async function fitToPage() {
  await nextTick();
  const el = sheet.value;
  if (!el) return;
  overflow.value = false;
  if (!fit.value) {
    scale.value = 1;
    el.style.zoom = '1';
    el.style.width = `${printable.value.w}mm`;
    return;
  }
  let s = 1;
  for (let i = 0; i < 10; i++) {
    el.style.zoom = '1';
    el.style.width = `${printable.value.w / s}mm`;
    const h = el.scrollHeight / MM; // mm a escala 1
    const next = Math.min(1, (printable.value.h - 1) / h);
    if (Math.abs(next - s) < 0.005) {
      s = next;
      break;
    }
    s = next;
  }
  if (s < MIN_SCALE) {
    overflow.value = true;
    s = MIN_SCALE;
  }
  el.style.width = `${printable.value.w / s}mm`;
  el.style.zoom = String(s);
  scale.value = s;
}

onMounted(async () => {
  try {
    const [p, m, st] = await Promise.all([
      http.get(`/plans/${year}`), http.get(`/plans/${year}/matrix`, { params: { ...params, view: view.value, split: '1' } }), http.get('/settings/public'),
    ]);
    plan.value = p.data.plan;
    matrix.value = m.data;
    settings.value = st.data;
    const prog = m.data.program as { code: string; name: string } | null;
    document.title = `Cronograma de mantenimiento ${typeLabel.toLowerCase()} ${prog ? `${prog.code} ` : ''}${year}`.replace(/\s+/g, ' ');
    await fitToPage();
  } catch {
    error.value = 'No fue posible cargar el plan para impresión.';
  }
});
watch([paper, fit], fitToPage);
/** Cambia las filas (categoría / equipo) recargando la matriz y conservando el enlace */
watch(view, async (v) => {
  try {
    matrix.value = null;
    const m = await http.get(`/plans/${year}/matrix`, { params: { ...params, view: v, split: '1' } });
    matrix.value = m.data;
    fit.value = v === 'grupos';
    const url = new URL(window.location.href);
    url.searchParams.set('view', v);
    window.history.replaceState(window.history.state, '', url);
    await fitToPage();
  } catch {
    error.value = 'No fue posible cargar el plan para impresión.';
  }
});
const onResize = () => void fitToPage();
onMounted(() => window.addEventListener('resize', onResize));
onBeforeUnmount(() => window.removeEventListener('resize', onResize));

const title = computed(() => (typeLabel ? `CRONOGRAMA DE MANTENIMIENTO ${typeLabel}` : plan.value?.title || 'PLAN ANUAL DE MANTENIMIENTO'));
const filterText = computed(() => {
  const parts: string[] = [];
  if (matrix.value?.program) parts.push(`Programa: ${matrix.value.program.code} · ${matrix.value.program.name}`);
  if (params.month) parts.push(`Mes: ${MONTHS[Number(params.month) - 1]}`);
  if (params.status) parts.push(`Estado: ${ACTIVITY_STATUS[String(params.status)]?.label}`);
  if (params.criticality) parts.push(`Criticidad: ${params.criticality}`);
  if (params.areaId || params.categoryId || params.assetId || params.responsibleId || params.q || params.kind) parts.push('Filtros adicionales aplicados');
  return parts.join(' · ');
});
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const cellLabel = (x: Record<string, any>) => (grouped.value ? `${x.day}·${x.executed ? `${x.executed}/${x.count}` : x.count}${x.rescheduled ? 'R' : ''}` : `${x.day}${SYM[x.status] ?? ''}`);
const URGENCY = ['VENCIDO', 'PROXIMO', 'EN_EJECUCION', 'REPROGRAMADO', 'PROGRAMADO', 'EJECUTADO', 'CANCELADO', 'NO_APLICA'];
/** Color del mes: el estado más urgente entre sus fechas (igual que la pantalla y el PDF) */
const lastStatus = (cell: Record<string, any>[]) => (cell.length ? URGENCY.find((k) => cell.some((x) => x.status === k)) ?? cell[0].status : '');
const pageStyle = computed(() => `@page { size: ${paper.value} landscape; margin: ${MARGIN}mm; }`);
</script>

<template>
  <component :is="'style'">{{ pageStyle }}</component>
  <div class="toolbar no-print">
    <strong>Vista de impresión</strong>
    <label>Filas <select v-model="view" data-testid="print-rows"><option value="grupos">Una fila por categoría</option><option value="equipos">Una fila por equipo</option></select></label>
    <label>Papel <select v-model="paper"><option value="A4">A4 horizontal</option><option value="A3">A3 horizontal</option></select></label>
    <label><input v-model="fit" type="checkbox" /> Ajustar a una hoja</label>
    <span v-if="fit && scale < 1" class="hint">Escala {{ Math.round(scale * 100) }} %</span>
    <span v-if="overflow" class="warn">No cabe en una hoja de forma legible: se imprimirá en varias. Use la vista por grupos o papel A3 para una sola hoja.</span>
    <span v-else-if="!grouped" class="hint">La vista por equipo puede ocupar varias hojas; la vista por grupos cabe en una.</span>
    <button class="btn" data-testid="do-print" @click="doPrint">Imprimir</button>
    <span class="hint">En el diálogo use «Guardar como PDF», escala 100 % y sin encabezados del navegador.</span>
  </div>
  <div v-if="error" class="page-paper"><div class="sheet">{{ error }}</div></div>
  <div v-else class="page-paper" :class="paper">
    <div v-if="plan && matrix" ref="sheet" class="sheet" data-testid="print-sheet">
      <!-- Encabezado institucional -->
      <table class="hdr">
        <tr>
          <td class="inst"><div class="logos"><img src="/brand/unop.png" alt="UNO-P Unidad Oncológica del Putumayo" /></div><div v-if="settings['institution.nit']" class="nit">NIT {{ settings['institution.nit'] }}</div></td>
          <td class="ttl"><div class="t1">{{ title }}</div><div class="t2">Año {{ year }} · Estado: {{ PLAN_STATUS[plan.status].label }}</div><div v-if="filterText" class="t3">{{ filterText }}</div></td>
          <td class="ctl">
            <div>Código: <b>{{ plan.documentCode }}</b></div>
            <div>Versión: <b>{{ plan.version }}</b></div>
            <div v-if="plan.approvedAt">Vigencia: {{ fmtDate(plan.approvedAt) }}</div>
            <div>Generado: {{ fmtDateTime(generatedAt) }}</div>
          </td>
        </tr>
      </table>

      <!-- Control documental -->
      <table class="info">
        <tr>
          <th>Año</th><td>{{ year }}</td>
          <th>Versión</th><td>{{ plan.version }}</td>
          <th>Estado documental</th><td>{{ PLAN_STATUS[plan.status].label }}</td>
          <th>{{ grouped ? 'Grupos / equipos' : 'Equipos' }}</th><td>{{ grouped ? `${matrix.rows.length} / ${matrix.assetCount}` : matrix.assetCount }}</td>
        </tr>
        <tr>
          <th>Elaboró</th><td>{{ plan.createdBy ?? '—' }}</td>
          <th>Revisó</th><td>{{ plan.reviewedBy ?? '—' }}</td>
          <th>Aprobó</th><td>{{ plan.approvedBy ?? 'Pendiente de aprobación' }}</td>
          <th>Actividades</th><td>{{ matrix.total }} <span class="muted">({{ pct(matrix.executed, matrix.total) }} % ejecutado)</span></td>
        </tr>
      </table>

      <div class="bar">Cronograma anual (vista matricial) · {{ grouped ? 'por grupos de mantenimiento' : 'por equipo' }}</div>
      <table class="mx">
        <thead>
          <tr>
            <th class="w-grp">{{ grouped ? 'Grupo' : 'Equipo' }}</th>
            <th class="w-act">{{ grouped ? 'Actividad' : 'Grupo / actividad' }}</th>
            <th class="w-eq">{{ grouped ? 'Equipos' : 'Área' }}</th>
            <th class="w-per">Periodicidad</th>
            <th class="w-resp">Responsable</th>
            <th v-for="m in MONTHS_SHORT" :key="m" class="m">{{ m.toUpperCase() }}</th>
            <th class="m tot">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!matrix.rows.length"><td :colspan="18" class="center">Sin actividades para los filtros seleccionados. Genere el cronograma desde el sistema.</td></tr>
          <tr v-for="r in matrix.rows" :key="r.rowId">
            <td><b>{{ grouped ? r.targetName : r.assetCode }}</b><div v-if="!grouped">{{ r.assetName }}</div><div v-else class="sm">{{ r.groupType }}</div></td>
            <td>{{ grouped ? r.programName : `${r.targetName} · ${r.programName}` }}</td>
            <td class="center">{{ grouped ? r.assetCount : r.areaName }}</td>
            <td>{{ r.frequency }}</td>
            <td>{{ r.responsible ?? '—' }}</td>
            <td v-for="(cell, i) in r.months" :key="i" class="m" :class="cell.length ? `s-${lastStatus(cell)}` : ''">
              <span v-for="x in cell" :key="x.id" class="it">{{ cellLabel(x) }}</span>
            </td>
            <td class="m tot">{{ r.total }}</td>
          </tr>
        </tbody>
        <tfoot v-if="matrix.rows.length">
          <tr>
            <td colspan="2">TOTAL</td>
            <td class="center">{{ grouped ? matrix.assetCount : '' }}</td>
            <td /><td />
            <td v-for="(m, i) in matrix.monthTotals" :key="i" class="m">{{ m.total || '' }}</td>
            <td class="m tot">{{ matrix.total }}</td>
          </tr>
        </tfoot>
      </table>

      <div class="legend">
        <b>Estados:</b>
        <span v-for="k in LEGEND" :key="k" :class="`s-${k}`">{{ grouped ? '' : `${SYM[k]} ` }}{{ ACTIVITY_STATUS[k]?.label ?? k }}</span>
        <span class="note">{{ grouped ? 'Celda: día · equipos (ejecutados/programados). R = reprogramada. Color = estado más urgente del grupo.' : 'Celda: día del mes y estado. La fecha original aprobada se conserva en el sistema.' }}</span>
      </div>
      <div class="sign">
        <div><div class="line" /><b>Elaboró</b><div>{{ plan.createdBy }}</div></div>
        <div><div class="line" /><b>Revisó</b><div>{{ plan.reviewedBy }}</div></div>
        <div><div class="line" /><b>Aprobó</b><div>{{ plan.approvedBy }}</div></div>
      </div>
      <div class="foot">{{ plan.documentCode }} · v{{ plan.version }} · Impreso por {{ auth.me?.fullName }} el {{ fmtDateTime(generatedAt) }} · Documento generado a partir del plan almacenado en el sistema.</div>
    </div>
    <div v-else class="sheet">Cargando…</div>
  </div>
</template>

<style scoped>
.toolbar { position: sticky; top: 0; display: flex; flex-wrap: wrap; gap: 14px; align-items: center; padding: 10px 16px; background: #0f2a3d; color: #fff; font-size: 13px; z-index: 5; }
.toolbar label { display: inline-flex; gap: 6px; align-items: center; }
.toolbar .btn { background: #fff; color: #0f2a3d; border: 0; border-radius: 6px; padding: 6px 14px; font-weight: 600; cursor: pointer; }
.toolbar .hint { opacity: 0.75; font-size: 12px; }
.toolbar .warn { background: #fef3c7; color: #92400e; border-radius: 4px; padding: 2px 8px; font-size: 12px; }
.page-paper { background: #fff; margin: 16px auto; padding: 8mm; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15); box-sizing: content-box; }
.page-paper.A4 { width: 281mm; min-height: 194mm; }
.page-paper.A3 { width: 404mm; min-height: 281mm; }
.sheet { color: #111; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; transform-origin: top left; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 0.6pt solid #8a8a8a; padding: 2pt 3pt; vertical-align: middle; }
.hdr td { border-color: #666; height: 20mm; }
.inst { width: 28%; text-align: center; }
.logos { display: flex; align-items: center; justify-content: center; gap: 8px; }
.logos img { height: 50px; width: auto; max-width: 92%; object-fit: contain; }
.iname { font-weight: 700; font-size: 11pt; color: #0f3d56; }
.nit { font-size: 7.5pt; color: #444; margin-top: 2pt; }
.ttl { text-align: center; }
.t1 { font-weight: 700; font-size: 14pt; letter-spacing: 0.2pt; }
.t2 { font-size: 9.5pt; margin-top: 3pt; }
.t3 { font-size: 7.5pt; color: #444; margin-top: 2pt; }
.ctl { width: 21%; font-size: 7.8pt; line-height: 1.55; }
.info { margin-top: 4pt; font-size: 7.8pt; }
.info th { background: #eef2f6; text-align: left; font-weight: 700; width: 9%; }
.bar { margin-top: 4pt; background: #0f5c7a; color: #fff; font-weight: 700; font-size: 9pt; padding: 3pt 6pt; text-transform: uppercase; }
.mx { font-size: 7.6pt; }
.mx thead th { background: #0f3d56; color: #fff; font-weight: 700; text-align: center; }
.mx tbody tr:nth-child(even) td:not([class*='s-']) { background: #f6f8fa; }
.w-grp { width: 12%; } .w-act { width: 14%; } .w-eq { width: 4.5%; } .w-per { width: 10%; } .w-resp { width: 8%; }
.m { text-align: center; }
.it { display: block; font-weight: 700; white-space: nowrap; }
.tot { font-weight: 700; background: #f1f5f9; }
.sm { font-size: 6.6pt; color: #555; }
.mx tfoot td { background: #e2e8f0; font-weight: 700; }
.center { text-align: center; }
.muted { color: #555; }
.legend { display: flex; flex-wrap: wrap; align-items: center; gap: 3pt; margin-top: 5pt; font-size: 7pt; }
.legend span { padding: 1pt 5pt; border-radius: 2pt; }
.legend .note { color: #444; padding-left: 6pt; }
.sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 30pt; margin-top: 22pt; text-align: center; font-size: 7.8pt; }
.sign .line { border-top: 0.8pt solid #333; margin-bottom: 2pt; }
.foot { margin-top: 6pt; font-size: 6.8pt; color: #555; }
.s-PROGRAMADO { background: #dbeafe; } .s-PROXIMO { background: #fef3c7; } .s-EN_EJECUCION { background: #e0e7ff; } .s-EJECUTADO { background: #d1fae5; }
.s-VENCIDO { background: #fecaca; } .s-REPROGRAMADO { background: #ede9fe; } .s-CANCELADO { background: #e5e7eb; } .s-NO_APLICA { background: #f3f4f6; }
.sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print {
  :global(body) { background: #fff !important; }
  .no-print { display: none !important; }
  .page-paper { margin: 0; padding: 0; box-shadow: none; width: auto !important; min-height: 0 !important; }
  .mx tr { break-inside: avoid; }
}
</style>
