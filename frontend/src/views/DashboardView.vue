<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { http } from '@/api/http';
import IndicatorFilters, { type IndFilters } from '@/components/IndicatorFilters.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { fmtCOP, fmtDate, fmtDateTime, fmtNum, MONTHS_SHORT } from '@/utils/format';
import { WO_STATUS } from '@/utils/labels';

interface Ratio { value: number | null; numerator: number; denominator: number; insufficient: boolean; note?: string; excluded?: number }
interface Hours { value: number | null; n: number; insufficient: boolean; ongoing?: number }
interface Dash {
  period: { start: string; end: string; cutoff: string };
  general: Record<string, number> & { complianceBase: Ratio; complianceRescheduled: Ratio; outOfServicePct: Ratio };
  times: { meanResponseHours: Hours; meanRepairHours: Hours; meanResolutionHours: Hours; downtimeHours: Hours; recurrenceRate: Ratio };
  charts: {
    byCategory: Record<string, { programmed: number; executed: number; overdue: number }>;
    byMonth: { month: number; programmed: number; executed: number; cost: number; preventive: number; corrective: number }[];
    preventiveVsCorrective: { preventive: number; corrective: number };
    complianceByArea: { area: string; base: Ratio; rescheduled: Ratio }[];
    complianceBySupplier: { supplier: string; base: Ratio; rescheduled: Ratio }[];
    failuresByCategory: Record<string, number>;
    topFailureAssets: { code: string; name: string; count: number }[];
    costByCategory: Record<string, number>;
    woByStatus: Record<string, number>;
  };
  urgentFailures: { id: string; code: string; title: string; priority: string; status: string; reportedAt: string; asset: { code: string; name: string }; area: { name: string } }[];
  upcoming: { id: string; date: string; assetCode: string; assetName: string; area: string; responsible: string | null }[];
}

const cat = useCatalog();
const n = useNotify();
const f = ref<IndFilters>({ year: cat.year, month: null, areaId: null, categoryId: null, responsibleId: null });
const d = ref<Dash | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const params = Object.fromEntries(Object.entries(f.value).filter(([, v]) => v !== null));
    d.value = (await http.get('/dashboard', { params })).data;
  } catch (e) {
    n.error(e);
  } finally {
    loading.value = false;
  }
}
watch(f, load, { deep: true, immediate: true });
watch(() => cat.year, (y) => (f.value.year = y));

const pct = (r?: Ratio) => (r && !r.insufficient && r.value !== null ? `${fmtNum(r.value)} %` : null);
const C = { blue: '#2563eb', teal: '#0d9488', amber: '#d97706', red: '#dc2626', slate: '#64748b', indigo: '#4f46e5', green: '#16a34a' };
const baseOpts = { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } };

const monthChart = computed(() => d.value ? {
  labels: MONTHS_SHORT,
  datasets: [
    { label: 'Programadas', data: d.value.charts.byMonth.map((m) => m.programmed), backgroundColor: '#bfdbfe' },
    { label: 'Ejecutadas', data: d.value.charts.byMonth.map((m) => m.executed), backgroundColor: C.blue },
  ],
} : undefined);
const catChart = computed(() => d.value ? {
  labels: Object.keys(d.value.charts.byCategory),
  datasets: [
    { label: 'Programadas', data: Object.values(d.value.charts.byCategory).map((v) => v.programmed), backgroundColor: '#cbd5e1' },
    { label: 'Ejecutadas', data: Object.values(d.value.charts.byCategory).map((v) => v.executed), backgroundColor: C.teal },
    { label: 'Vencidas', data: Object.values(d.value.charts.byCategory).map((v) => v.overdue), backgroundColor: C.red },
  ],
} : undefined);
const pvc = computed(() => d.value ? {
  labels: ['Preventivas', 'Correctivas'],
  datasets: [{ data: [d.value.charts.preventiveVsCorrective.preventive, d.value.charts.preventiveVsCorrective.corrective], backgroundColor: [C.blue, C.amber] }],
} : undefined);
const areaChart = computed(() => d.value ? {
  labels: d.value.charts.complianceByArea.map((a) => a.area),
  datasets: [
    { label: 'Base aprobada (%)', data: d.value.charts.complianceByArea.map((a) => a.base.value), backgroundColor: C.indigo },
    { label: 'Reprogramado (%)', data: d.value.charts.complianceByArea.map((a) => a.rescheduled.value), backgroundColor: '#a5b4fc' },
  ],
} : undefined);
const failCat = computed(() => d.value ? {
  labels: Object.keys(d.value.charts.failuresByCategory),
  datasets: [{ label: 'Fallas', data: Object.values(d.value.charts.failuresByCategory), backgroundColor: C.amber }],
} : undefined);
const topAssets = computed(() => d.value ? {
  labels: d.value.charts.topFailureAssets.map((a) => a.code),
  datasets: [{ label: 'Fallas', data: d.value.charts.topFailureAssets.map((a) => a.count), backgroundColor: C.red }],
} : undefined);
const costChart = computed(() => d.value ? {
  labels: MONTHS_SHORT,
  datasets: [{ label: 'Costo (COP)', data: d.value.charts.byMonth.map((m) => m.cost), borderColor: C.teal, backgroundColor: 'rgba(13,148,136,0.15)', fill: true, tension: 0.25 }],
} : undefined);
const woChart = computed(() => d.value ? {
  labels: Object.keys(d.value.charts.woByStatus).map((k) => WO_STATUS[k]?.label ?? k),
  datasets: [{ label: 'Órdenes', data: Object.values(d.value.charts.woByStatus), backgroundColor: C.slate }],
} : undefined);
const hBar = { ...baseOpts, indexAxis: 'y', scales: { x: { beginAtZero: true, max: 100 } } };
const costOpts = { ...baseOpts, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c: { raw: number }) => fmtCOP(c.raw) } } } };
const has = (o: object | unknown[] | undefined) => !!o && (Array.isArray(o) ? o.length > 0 : Object.keys(o).length > 0);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Resumen ejecutivo del mantenimiento</h1>
        <div v-if="d" class="sub">Periodo {{ fmtDate(d.period.start) }} – {{ fmtDate(d.period.end) }} · corte {{ fmtDate(d.period.cutoff) }} · datos en tiempo real</div>
      </div>
    </div>
    <IndicatorFilters v-model="f" />
    <div v-if="loading && !d" class="grid g4"><Skeleton v-for="i in 8" :key="i" height="96px" /></div>
    <template v-if="d">
      <div v-if="d.urgentFailures.some((u) => u.priority === 'URGENTE')" class="card banner-urgent mb" data-testid="urgent-banner">
        <div class="card-title"><h2>Fallas urgentes abiertas</h2><RouterLink to="/correctivos">Ver correctivos</RouterLink></div>
        <div v-for="u in d.urgentFailures.filter((x) => x.priority === 'URGENTE')" :key="u.id" class="row">
          <StatusTag :value="u.priority" kind="priority" />
          <RouterLink :to="`/correctivos/${u.id}`" class="mono">{{ u.code }}</RouterLink>
          <strong>{{ u.asset.code }} · {{ u.asset.name }}</strong> — {{ u.title }} <span class="muted">({{ u.area.name }}, {{ fmtDateTime(u.reportedAt) }})</span>
          <StatusTag :value="u.status" kind="failure" />
        </div>
      </div>

      <div class="grid g4">
        <div class="card kpi"><span class="l">Activos</span><span class="v">{{ d.general.totalAssets }}</span><span class="h">{{ d.general.operativeAssets }} operativos</span></div>
        <div class="card kpi" :class="{ danger: d.general.outOfServiceAssets > 0 }"><span class="l">Fuera de servicio</span><span class="v">{{ d.general.outOfServiceAssets }}</span><span class="h">{{ pct(d.general.outOfServicePct) ?? 'Sin datos' }} del inventario</span></div>
        <div class="card kpi"><span class="l">Mantenimientos programados</span><span class="v">{{ d.general.programmed }}</span><span class="h">{{ d.general.executed }} ejecutados · {{ d.general.pending }} pendientes</span></div>
        <div class="card kpi" :class="{ danger: d.general.overdue > 0 }"><span class="l">Vencidos</span><span class="v">{{ d.general.overdue }}</span><span class="h">a la fecha de corte</span></div>
        <div class="card kpi" :class="{ warn: d.general.openCorrective > 0 }"><span class="l">Correctivos abiertos</span><span class="v">{{ d.general.openCorrective }}</span><span class="h">{{ d.general.urgentCorrective }} urgentes</span></div>
        <div class="card kpi"><span class="l">Cumplimiento — programa base aprobado</span>
          <span v-if="pct(d.general.complianceBase)" class="v">{{ pct(d.general.complianceBase) }}</span><span v-else class="insufficient">Información insuficiente</span>
          <span class="h">{{ d.general.complianceBase.insufficient ? d.general.complianceBase.note : `${d.general.complianceBase.numerator} de ${d.general.complianceBase.denominator} exigibles` }}</span></div>
        <div class="card kpi"><span class="l">Cumplimiento — fechas reprogramadas aprobadas</span>
          <span v-if="pct(d.general.complianceRescheduled)" class="v">{{ pct(d.general.complianceRescheduled) }}</span><span v-else class="insufficient">Información insuficiente</span>
          <span class="h">{{ d.general.complianceRescheduled.insufficient ? d.general.complianceRescheduled.note : `${d.general.complianceRescheduled.numerator} de ${d.general.complianceRescheduled.denominator} exigibles` }}</span></div>
        <div class="card kpi"><span class="l">Costos de mantenimiento</span><span class="v" style="font-size: 1.35rem">{{ fmtCOP(d.general.maintenanceCost) }}</span><span class="h">órdenes cerradas en el periodo</span></div>
      </div>

      <div class="card mt">
        <div class="card-title"><h2>Tiempos y confiabilidad</h2></div>
        <dl class="kv">
          <div><dt>Tiempo medio de respuesta</dt><dd>{{ d.times.meanResponseHours.insufficient ? 'Sin datos suficientes' : `${fmtNum(d.times.meanResponseHours.value)} h (n=${d.times.meanResponseHours.n})` }}</dd></div>
          <div><dt>Tiempo medio de reparación</dt><dd>{{ d.times.meanRepairHours.insufficient ? 'Sin datos suficientes' : `${fmtNum(d.times.meanRepairHours.value)} h (n=${d.times.meanRepairHours.n})` }}</dd></div>
          <div><dt>Tiempo medio de solución</dt><dd>{{ d.times.meanResolutionHours.insufficient ? 'Sin datos suficientes' : `${fmtNum(d.times.meanResolutionHours.value)} h` }}</dd></div>
          <div><dt>Indisponibilidad</dt><dd>{{ d.times.downtimeHours.insufficient ? 'Sin datos suficientes' : `${fmtNum(d.times.downtimeHours.value)} h` }}<span v-if="d.times.downtimeHours.ongoing" class="muted"> · {{ d.times.downtimeHours.ongoing }} en curso</span></dd></div>
          <div><dt>Tasa de reincidencia</dt><dd>{{ pct(d.times.recurrenceRate) ?? 'Sin datos suficientes' }}</dd></div>
        </dl>
      </div>

      <div class="grid g2 mt">
        <div class="card"><h3 class="mb">Actividades por mes</h3><div class="ch"><Chart type="bar" :data="monthChart" :options="baseOpts" /></div></div>
        <div class="card"><h3 class="mb">Mantenimiento por categoría</h3><div class="ch"><Chart v-if="has(d.charts.byCategory)" type="bar" :data="catChart" :options="baseOpts" /><div v-else class="empty">Sin actividades en el periodo</div></div></div>
        <div class="card"><h3 class="mb">Cumplimiento por área</h3><div class="ch"><Chart v-if="has(d.charts.complianceByArea)" type="bar" :data="areaChart" :options="hBar" /><div v-else class="empty">Sin datos suficientes</div></div></div>
        <div class="card"><h3 class="mb">Preventivo vs. correctivo (órdenes)</h3><div class="ch"><Chart v-if="d.charts.preventiveVsCorrective.preventive + d.charts.preventiveVsCorrective.corrective" type="doughnut" :data="pvc" :options="{ maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }" /><div v-else class="empty">Sin órdenes en el periodo</div></div></div>
        <div class="card"><h3 class="mb">Fallas por categoría</h3><div class="ch"><Chart v-if="has(d.charts.failuresByCategory)" type="bar" :data="failCat" :options="{ ...baseOpts, plugins: { legend: { display: false } } }" /><div v-else class="empty">Sin fallas en el periodo</div></div></div>
        <div class="card"><h3 class="mb">Activos con mayor número de fallas</h3><div class="ch"><Chart v-if="has(d.charts.topFailureAssets)" type="bar" :data="topAssets" :options="{ ...baseOpts, indexAxis: 'y', plugins: { legend: { display: false } } }" /><div v-else class="empty">Sin fallas en el periodo</div></div></div>
        <div class="card"><h3 class="mb">Costos por mes</h3><div class="ch"><Chart type="line" :data="costChart" :options="costOpts" /></div></div>
        <div class="card"><h3 class="mb">Órdenes por estado</h3><div class="ch"><Chart v-if="has(d.charts.woByStatus)" type="bar" :data="woChart" :options="{ ...baseOpts, plugins: { legend: { display: false } } }" /><div v-else class="empty">Sin órdenes en el periodo</div></div></div>
      </div>

      <div class="grid g2 mt">
        <div class="card">
          <div class="card-title"><h2>Próximos mantenimientos</h2><RouterLink to="/preventivos">Ver todos</RouterLink></div>
          <DataTable :value="d.upcoming" size="small">
            <template #empty><div class="empty">No hay actividades próximas.</div></template>
            <Column header="Fecha"><template #body="{ data }">{{ fmtDate(data.date) }}</template></Column>
            <Column header="Activo"><template #body="{ data }"><span class="mono">{{ data.assetCode }}</span> {{ data.assetName }}</template></Column>
            <Column field="area" header="Área" />
            <Column header="Responsable"><template #body="{ data }">{{ data.responsible ?? '—' }}</template></Column>
          </DataTable>
        </div>
        <div class="card">
          <div class="card-title"><h2>Cumplimiento por proveedor</h2></div>
          <DataTable :value="d.charts.complianceBySupplier" size="small">
            <template #empty><div class="empty">Sin actividades a cargo de proveedores.</div></template>
            <Column field="supplier" header="Proveedor" />
            <Column header="Base"><template #body="{ data }">{{ pct(data.base) ?? 'Sin datos' }}</template></Column>
            <Column header="Reprogramado"><template #body="{ data }">{{ pct(data.rescheduled) ?? 'Sin datos' }}</template></Column>
          </DataTable>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ch { height: 260px; position: relative; }
</style>
