<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { download, http } from '@/api/http';
import ReasonDialog from '@/components/ReasonDialog.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { dateToYmd, fmtDate, fmtDateTime, MONTHS, MONTHS_SHORT, ymdToDate } from '@/utils/format';
import { ACTIVITY_STATUS, CRITICALITY, KIND, opts } from '@/utils/labels';

const auth = useAuth();
const cat = useCatalog();
const n = useNotify();
const route = useRoute();
const router = useRouter();
const reason = ref<InstanceType<typeof ReasonDialog>>();

const year = ref<number>(Number(route.query.year) || cat.year);
const years = computed(() => Array.from({ length: 12 }, (_, i) => cat.year + 2 - i));
const plan = ref<Record<string, any> | null>(null);
const tab = ref('matrix');
const f = ref({ month: null as number | null, areaId: null as string | null, categoryId: null as string | null, assetId: null as string | null, responsibleId: null as string | null, criticality: null as string | null, status: null as string | null, kind: null as string | null, q: '' });
type ScheduleType = 'PREVENTIVO' | 'CORRECTIVO';
const scheduleType = ref<ScheduleType>(route.query.tipo === 'CORRECTIVO' ? 'CORRECTIVO' : 'PREVENTIVO');
const view = ref<'grupos' | 'equipos'>(route.query.vista === 'equipos' ? 'equipos' : 'grupos');
const typeOptions = [{ label: 'Preventivo', value: 'PREVENTIVO', icon: 'pi pi-shield' }, { label: 'Correctivo', value: 'CORRECTIVO', icon: 'pi pi-wrench' }];
const viewOptions = [{ label: 'Por grupos', value: 'grupos', icon: 'pi pi-th-large' }, { label: 'Por equipo', value: 'equipos', icon: 'pi pi-list' }];
const typeLabel = computed(() => (scheduleType.value === 'CORRECTIVO' ? 'correctivo' : 'preventivo'));
type MatrixData = { rows: Record<string, any>[]; today: string; total: number; executed: number; assetCount: number; monthTotals: { total: number; executed: number }[] };
const matrix = ref<MatrixData | null>(null);
const detail = ref<{ items: Record<string, any>[]; total: number }>({ items: [], total: 0 });
const summary = ref<Record<string, any> | null>(null);
const history = ref<Record<string, any> | null>(null);
const pending = ref<Record<string, any>[]>([]);
const loading = ref(false);
const sort = ref({ field: 'committedDate', order: 1 });
const page = ref({ first: 0, rows: 50 });

const params = computed(() => ({ ...Object.fromEntries(Object.entries(f.value).filter(([, v]) => v !== null && v !== '')), scheduleType: scheduleType.value }));

async function loadPlan() {
  plan.value = (await http.get(`/plans/${year.value}`)).data.plan;
}
async function loadData() {
  if (!plan.value) {
    matrix.value = null;
    detail.value = { items: [], total: 0 };
    summary.value = null;
    return;
  }
  loading.value = true;
  try {
    const sortMap: Record<string, string> = { committedDate: 'committedDate', 'asset.code': 'asset', 'asset.area.name': 'area', 'responsible.fullName': 'responsible' };
    const [m, d, s] = await Promise.all([
      http.get(`/plans/${year.value}/matrix`, { params: { ...params.value, view: view.value } }),
      http.get(`/plans/${year.value}/activities`, { params: { ...params.value, page: page.value.first / page.value.rows + 1, pageSize: page.value.rows, sort: sortMap[sort.value.field] ?? 'committedDate', dir: sort.value.order === -1 ? 'desc' : 'asc' } }),
      http.get(`/plans/${year.value}/summary`, { params: params.value }),
    ]);
    matrix.value = m.data;
    detail.value = d.data;
    summary.value = s.data;
  } catch (e) {
    n.error(e);
  } finally {
    loading.value = false;
  }
}
async function loadHistory() {
  if (!plan.value) return;
  history.value = (await http.get(`/plans/${year.value}/history`)).data;
  pending.value = (await http.get('/reschedules/pending')).data.filter((r: { activity: { plan: { year: number } } }) => r.activity.plan.year === year.value);
}
async function reload() {
  try {
    await loadPlan();
    await Promise.all([loadData(), loadHistory()]);
  } catch (e) {
    n.error(e);
  }
}
watch([scheduleType, view], ([tipo, vista]) => {
  void router.replace({ query: { ...route.query, tipo, vista } });
  page.value.first = 0;
  void loadData();
});
watch(year, (y) => {
  void router.replace({ query: { ...route.query, year: String(y) } });
  page.value.first = 0;
  void reload();
});
let t: ReturnType<typeof setTimeout>;
watch(f, () => {
  clearTimeout(t);
  t = setTimeout(() => {
    page.value.first = 0;
    void loadData();
  }, 250);
}, { deep: true });
onMounted(async () => {
  await cat.load();
  if (!route.query.year) year.value = cat.year;
  await Promise.all([reload(), cat.loadAssets()]);
});

// --------------------------------------------- Flujo del plan
const genResult = ref<Record<string, any> | null>(null);
const busy = ref(false);
async function createPlan() {
  if (await n.run(() => http.post(`/plans/${year.value}`, {}), `Plan anual ${year.value} creado en borrador`)) await reload();
}
async function generate() {
  let why: string | null = null;
  if (plan.value?.status === 'APROBADO') {
    why = await reason.value!.ask({ title: 'Agregar actividades a un plan aprobado', message: 'Solo se agregarán actividades de programas que aún no hacen parte del plan (p. ej. equipos nuevos). Se incrementa la versión del plan.' });
    if (!why) return;
  }
  busy.value = true;
  const r = await n.run(() => http.post(`/plans/${year.value}/generate`, { reason: why, scheduleType: scheduleType.value }));
  busy.value = false;
  if (r) {
    genResult.value = r.data;
    await reload();
  }
}
async function transition(action: 'submit' | 'review' | 'return' | 'approve' | 'close') {
  const titles = { submit: 'Enviar a revisión', review: 'Registrar revisión', return: 'Devolver a borrador', approve: 'Aprobar plan', close: 'Cerrar y archivar plan' };
  const needs = action === 'return' || action === 'close';
  const why = await reason.value!.ask({
    title: titles[action], min: needs ? 10 : 0, label: needs ? 'Justificación' : 'Observación (opcional)', confirmLabel: titles[action],
    message: action === 'approve' ? 'Se creará una versión inmutable del plan. Las fechas aprobadas quedarán protegidas: los cambios posteriores requieren reprogramación aprobada.' : action === 'close' ? 'El plan cerrado no admitirá más cambios.' : undefined,
  });
  if (why === null) return;
  if (await n.run(() => http.post(`/plans/${year.value}/${action}`, { reason: why || null }), 'Estado del plan actualizado')) await reload();
}
const exp = (kind: 'pdf' | 'xlsx', paper?: 'a4' | 'a3', annex = false) =>
  n.run(() => download(`/plans/${year.value}/export.${kind}`, { ...params.value, view: view.value, paper, annex: annex ? '1' : undefined }, `Cronograma_${typeLabel.value}_${year.value}.${kind}`), kind === 'pdf' ? 'PDF descargado' : 'Excel descargado');
const exportMenu = ref();
const exportItems = computed(() => [
  { label: 'PDF A4 · una hoja', icon: 'pi pi-file-pdf', command: () => exp('pdf', 'a4') },
  { label: 'PDF A3 · una hoja', icon: 'pi pi-file-pdf', command: () => exp('pdf', 'a3') },
  { label: 'PDF con anexo por equipo', icon: 'pi pi-copy', command: () => exp('pdf', 'a4', true) },
  { label: 'Excel', icon: 'pi pi-file-excel', command: () => exp('xlsx') },
]);
function printView() {
  const q = new URLSearchParams({ ...(params.value as Record<string, string>), view: view.value }).toString();
  window.open(`/imprimir/cronograma/${year.value}${q ? `?${q}` : ''}`, '_blank');
}

// --------------------------------------------- Actividad
const act = ref<Record<string, any> | null>(null);
const actVisible = ref(false);
const groupedCell = ref<Record<string, any> | null>(null);
const groupedCellVisible = ref(false);
const resched = ref({ toDate: null as Date | null, reason: '', autoApprove: false });
async function openActivity(id: string) {
  act.value = (await http.get(`/activities/${id}`)).data;
  resched.value = { toDate: ymdToDate(act.value!.committedDate), reason: '', autoApprove: auth.can('plans.approve') };
  actVisible.value = true;
}
function openMatrixCell(cell: Record<string, any>, row: Record<string, any>) {
  if (!row.grouped) {
    void openActivity(cell.id);
    return;
  }
  groupedCell.value = { ...cell, programName: row.programName, targetName: row.targetName, groupType: row.groupType };
  groupedCellVisible.value = true;
}
function openGroupedActivity(id: string) {
  groupedCellVisible.value = false;
  void openActivity(id);
}
function matrixCellTitle(cell: Record<string, any>, grouped: boolean) {
  const status = ACTIVITY_STATUS[cell.status]?.label ?? cell.status;
  const detail = grouped ? `${cell.count} equipo(s) · ${cell.executed} ejecutado(s) · ${cell.mixed ? 'estados mixtos, el color muestra el más urgente' : status}` : status;
  return `${fmtDate(cell.date)} · ${detail}${cell.rescheduled ? ' · con reprogramaciones' : ''}`;
}
const currentMonth = computed(() => (matrix.value?.today && Number(matrix.value.today.slice(0, 4)) === year.value ? Number(matrix.value.today.slice(5, 7)) - 1 : -1));
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
async function createWo() {
  const r = await n.run(() => http.post(`/workorders/from-activity/${act.value!.id}`, {}), 'Orden de trabajo creada');
  if (r) await router.push(`/ordenes/${r.data.id}`);
}
async function doReschedule() {
  const r = await n.run(() => http.post(`/activities/${act.value!.id}/reschedule`, { toDate: dateToYmd(resched.value.toDate), reason: resched.value.reason, autoApprove: resched.value.autoApprove }));
  if (r) {
    n.ok(r.data.applied ? 'Reprogramación aplicada y registrada' : 'Solicitud de reprogramación enviada para aprobación');
    actVisible.value = false;
    await reload();
  }
}
async function assign(userId: string | null) {
  if (await n.run(() => http.post(`/activities/${act.value!.id}/assign`, { responsibleId: userId }), 'Responsable asignado')) {
    await openActivity(act.value!.id);
    await loadData();
  }
}
async function setStatus(status: 'CANCELADO' | 'NO_APLICA' | 'PROGRAMADO') {
  const label = { CANCELADO: 'Cancelar actividad', NO_APLICA: 'Marcar como no aplica', PROGRAMADO: 'Restituir actividad' }[status];
  const why = await reason.value!.ask({ title: label, danger: status !== 'PROGRAMADO', message: 'El registro se conserva y queda en la trazabilidad del plan.' });
  if (!why) return;
  if (await n.run(() => http.post(`/activities/${act.value!.id}/status`, { status, reason: why }), 'Actividad actualizada')) {
    actVisible.value = false;
    await reload();
  }
}
async function decide(id: string, approve: boolean) {
  let note: string | null = null;
  if (!approve) {
    note = await reason.value!.ask({ title: 'Rechazar reprogramación', min: 5, danger: true });
    if (!note) return;
  }
  if (await n.run(() => http.post(`/reschedules/${id}/decide`, { approve, note }), approve ? 'Reprogramación aprobada' : 'Reprogramación rechazada')) await reload();
}
const inspection = () => n.run(() => download(`/reports/inspection/${act.value!.id}.pdf`), 'Formato F-08 generado');

const canEditPlan = computed(() => plan.value && ['BORRADOR', 'APROBADO'].includes(plan.value.status));
const cellClass = (s: string) => `st-${s}`;
const statusOpts = opts(ACTIVITY_STATUS);
const assetLabel = (a: { code: string; name: string }) => `${a.code} · ${a.name}`;
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <div class="row">
          <h1>Cronograma de mantenimiento {{ typeLabel }}</h1>
          <Select v-model="year" :options="years" aria-label="Año" data-testid="year-select" />
          <StatusTag v-if="plan" :value="plan.status" kind="plan" />
          <Tag v-if="plan" :value="`Versión ${plan.version}`" severity="secondary" />
        </div>
        <div class="sub">
          <template v-if="plan">{{ plan.documentCode }} · creado {{ fmtDateTime(plan.createdAt) }} por {{ plan.createdBy }}<template v-if="plan.approvedAt"> · aprobado {{ fmtDateTime(plan.approvedAt) }} por {{ plan.approvedBy }}</template><template v-if="plan.lastGeneratedAt"> · última generación {{ fmtDateTime(plan.lastGeneratedAt) }}</template></template>
          <template v-else>No existe plan para {{ year }}.</template>
        </div>
      </div>
      <div class="actions">
        <template v-if="plan && auth.can('plans.export')">
          <Button label="Imprimir (una hoja)" icon="pi pi-print" severity="secondary" outlined data-testid="btn-print" @click="printView" />
          <Button label="Exportar" icon="pi pi-download" severity="secondary" outlined data-testid="btn-export" aria-haspopup="true" @click="(e) => exportMenu.toggle(e)" />
          <Menu ref="exportMenu" :model="exportItems" popup />
        </template>
      </div>
    </div>

    <div class="type-bar mb">
      <SelectButton v-model="scheduleType" :options="typeOptions" option-label="label" option-value="value" :allow-empty="false" data-testid="schedule-type">
        <template #option="{ option }"><i :class="option.icon" /> <span>Cronograma {{ option.label.toLowerCase() }}</span></template>
      </SelectButton>
      <span class="spacer" />
      <span class="muted small">Ver:</span>
      <SelectButton v-model="view" :options="viewOptions" option-label="label" option-value="value" :allow-empty="false" data-testid="matrix-view">
        <template #option="{ option }"><i :class="option.icon" /> <span>{{ option.label }}</span></template>
      </SelectButton>
    </div>

    <div class="card mb">
      <div class="row">
        <template v-if="!plan">
          <span>Para planificar {{ year }} cree el plan anual (quedará en borrador).</span>
          <Button v-if="auth.can('plans.generate')" label="Crear plan anual" icon="pi pi-plus" data-testid="btn-create-plan" @click="createPlan" />
        </template>
        <template v-else>
          <Button v-if="auth.can('plans.generate') && canEditPlan" :label="plan.status === 'APROBADO' ? `Agregar actividades ${typeLabel}s nuevas` : `Generar cronograma ${typeLabel}`" icon="pi pi-bolt" :loading="busy" data-testid="btn-generate" @click="generate" />
          <Button v-if="auth.can('plans.submit') && plan.status === 'BORRADOR'" label="Enviar a revisión" icon="pi pi-send" severity="secondary" outlined @click="transition('submit')" />
          <Button v-if="auth.can('plans.approve') && plan.status === 'EN_REVISION'" label="Registrar revisión" icon="pi pi-eye" severity="secondary" outlined @click="transition('review')" />
          <Button v-if="auth.can('plans.approve') && plan.status === 'EN_REVISION'" label="Aprobar" icon="pi pi-verified" severity="success" @click="transition('approve')" />
          <Button v-if="auth.can('plans.approve') && plan.status === 'EN_REVISION'" label="Devolver a borrador" icon="pi pi-undo" severity="warn" text @click="transition('return')" />
          <Button v-if="auth.can('plans.close') && plan.status === 'APROBADO'" label="Cerrar y archivar" icon="pi pi-lock" severity="contrast" text @click="transition('close')" />
          <span class="spacer" />
          <span v-if="plan.pendingReschedules" class="row"><i class="pi pi-clock" style="color: #b45309" /> {{ plan.pendingReschedules }} reprogramaciones pendientes</span>
          <RouterLink :to="`/plan-maestro?tipo=${scheduleType}`" class="small">Definir grupos y periodicidades →</RouterLink>
        </template>
      </div>
    </div>

    <template v-if="plan">
      <div class="filters">
        <Select v-model="f.month" :options="MONTHS.map((l, i) => ({ l, v: i + 1 }))" option-label="l" option-value="v" placeholder="Mes" show-clear />
        <Select v-model="f.areaId" :options="cat.areas" option-label="name" option-value="id" placeholder="Área" show-clear filter />
        <Select v-model="f.categoryId" :options="cat.categories" option-label="name" option-value="id" placeholder="Categoría" show-clear />
        <Select v-model="f.assetId" :options="cat.assets" :option-label="assetLabel" option-value="id" placeholder="Activo" show-clear filter />
        <Select v-model="f.responsibleId" :options="cat.users" option-label="fullName" option-value="id" placeholder="Responsable" show-clear filter />
        <Select v-model="f.criticality" :options="opts(CRITICALITY)" option-label="label" option-value="value" placeholder="Criticidad" show-clear />
        <Select v-model="f.status" :options="statusOpts" option-label="label" option-value="value" placeholder="Estado" show-clear />
        <Select v-if="scheduleType === 'PREVENTIVO'" v-model="f.kind" :options="opts(KIND).filter((o) => o.value !== 'CORRECTIVO')" option-label="label" option-value="value" placeholder="Tipo de actividad" show-clear />
        <InputText v-model="f.q" placeholder="Buscar…" />
      </div>

      <div class="card">
        <Tabs v-model:value="tab">
          <TabList>
            <Tab value="matrix">Vista calendario matricial</Tab>
            <Tab value="detail">Vista detallada</Tab>
            <Tab value="summary">Resumen</Tab>
            <Tab value="resched">Reprogramaciones<span v-if="pending.length"> ({{ pending.length }})</span></Tab>
            <Tab value="history">Historial y versiones</Tab>
          </TabList>
          <TabPanels>
            <TabPanel value="matrix">
              <div v-if="matrix" class="kpis">
                <div v-if="view === 'grupos'" class="k"><span class="v">{{ matrix.rows.length }}</span><span class="l">grupos</span></div>
                <div class="k"><span class="v">{{ matrix.assetCount }}</span><span class="l">equipos</span></div>
                <div class="k"><span class="v">{{ matrix.total }}</span><span class="l">intervenciones</span></div>
                <div class="k grow">
                  <div class="row"><span class="v">{{ pct(matrix.executed, matrix.total) }} %</span><span class="l">ejecutado ({{ matrix.executed }} de {{ matrix.total }})</span></div>
                  <div class="bar"><span :style="{ width: `${pct(matrix.executed, matrix.total)}%` }" /></div>
                </div>
              </div>
              <div class="legend">
                <span v-for="o in statusOpts" :key="o.value" class="lg" :class="cellClass(o.value)">{{ o.label }}</span>
                <span class="muted">· {{ view === 'grupos' ? 'Celda: día del mes y equipos (ejecutados/programados); el color es el estado más urgente. Clic para ver los equipos.' : 'El número es el día del mes · ↻ reprogramada' }}</span>
              </div>
              <div class="mx-wrap">
                <table class="mx" :class="view" data-testid="matrix">
                  <thead>
                    <tr>
                      <th class="sticky">{{ view === 'grupos' ? 'Grupo de mantenimiento' : 'Equipo' }}</th>
                      <th v-if="view === 'grupos'" class="c">Equipos</th>
                      <th>Periodicidad</th>
                      <th>Responsable</th>
                      <th v-for="(m, i) in MONTHS_SHORT" :key="m" class="c" :class="{ cur: i === currentMonth }">{{ m }}</th>
                      <th class="c">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-if="!matrix?.rows.length">
                      <td :colspan="view === 'grupos' ? 17 : 16" class="empty">
                        <template v-if="loading">Cargando…</template>
                        <template v-else>
                          <div><strong>No hay actividades en el cronograma {{ typeLabel }} de {{ year }}.</strong></div>
                          <div class="muted mt">Defina en el plan maestro los grupos (categoría, subcategoría o agrupación personalizada) con su tipo «{{ typeLabel }}» y periodicidad; luego pulse «Generar cronograma {{ typeLabel }}».</div>
                          <RouterLink :to="`/plan-maestro?tipo=${scheduleType}&nuevo=grupo`"><Button class="mt" :label="`Definir programa ${typeLabel} por grupo`" icon="pi pi-plus" size="small" /></RouterLink>
                        </template>
                      </td>
                    </tr>
                    <tr v-for="r in matrix?.rows" :key="r.rowId">
                      <td class="sticky">
                        <template v-if="view === 'grupos'">
                          <div class="gname">{{ r.targetName }}</div>
                          <div class="small">{{ r.programName }}</div>
                          <div class="gtype">{{ r.groupType }}</div>
                        </template>
                        <template v-else>
                          <RouterLink :to="`/activos/${r.assetId}`" class="mono">{{ r.assetCode }}</RouterLink> {{ r.assetName }}
                          <div class="muted small">{{ r.targetName }} · {{ r.programName }}</div>
                        </template>
                      </td>
                      <td v-if="view === 'grupos'" class="c"><span class="badge">{{ r.assetCount }}</span></td>
                      <td class="small per">{{ r.frequency }}</td>
                      <td class="small resp">{{ r.responsible ?? '—' }}</td>
                      <td v-for="(cell, mi) in r.months" :key="mi" class="mc" :class="{ cur: mi === currentMonth }">
                        <button v-for="x in cell" :key="x.id" class="chip" :class="[cellClass(x.status), { mixed: x.mixed }]" :title="matrixCellTitle(x, view === 'grupos')" @click="openMatrixCell(x, r)">
                          <span class="d">{{ x.day }}<span v-if="x.rescheduled">↻</span></span>
                          <template v-if="view === 'grupos'">
                            <span class="n">{{ x.executed ? `${x.executed}/${x.count}` : `${x.count} eq` }}</span>
                            <span class="pb"><span :style="{ width: `${pct(x.executed, x.count)}%` }" /></span>
                          </template>
                        </button>
                      </td>
                      <td class="c tot">{{ r.total }}<div v-if="r.executed" class="muted small">{{ pct(r.executed, r.total) }} %</div></td>
                    </tr>
                  </tbody>
                  <tfoot v-if="matrix?.rows.length">
                    <tr>
                      <td class="sticky">Total por mes</td>
                      <td v-if="view === 'grupos'" class="c">{{ matrix.assetCount }}</td>
                      <td /><td />
                      <td v-for="(m, i) in matrix.monthTotals" :key="i" class="c" :class="{ cur: i === currentMonth }">{{ m.total || '·' }}</td>
                      <td class="c">{{ matrix.total }}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </TabPanel>
            <TabPanel value="detail">
              <DataTable :value="detail.items" :loading="loading" lazy paginator :rows="page.rows" :first="page.first" :total-records="detail.total" :rows-per-page-options="[50, 100, 250]" size="small" row-hover class="clickable"
                :sort-field="sort.field" :sort-order="sort.order" @sort="(e) => { sort = { field: String(e.sortField), order: e.sortOrder ?? 1 }; loadData(); }" @page="(e) => { page = { first: e.first, rows: e.rows }; loadData(); }" @row-click="(e) => openActivity(e.data.id)">
                <template #empty><div class="empty">Sin actividades.</div></template>
                <Column field="committedDate" header="Fecha" sortable><template #body="{ data }"><span class="nowrap">{{ fmtDate(data.committedDate) }}</span><div v-if="data.rescheduled" class="muted nowrap">orig. {{ fmtDate(data.originalDate) }}</div></template></Column>
                <Column field="asset.code" header="Código" sortable><template #body="{ data }"><span class="mono">{{ data.asset.code }}</span></template></Column>
                <Column header="Activo"><template #body="{ data }">{{ data.asset.name }}</template></Column>
                <Column field="asset.area.name" header="Área" sortable><template #body="{ data }">{{ data.asset.area.name }}</template></Column>
                <Column header="Mantenimiento"><template #body="{ data }">{{ data.program.name }}</template></Column>
                <Column field="responsible.fullName" header="Responsable" sortable><template #body="{ data }">{{ data.responsible?.fullName ?? '—' }}</template></Column>
                <Column header="Estado"><template #body="{ data }"><StatusTag :value="data.displayStatus" kind="activity" /><i v-if="data.reschedules.length" class="pi pi-clock" style="color: #b45309; margin-left: 4px" v-tooltip="'Reprogramación pendiente'" /></template></Column>
                <Column header="OT"><template #body="{ data }"><RouterLink v-if="data.workOrder" :to="`/ordenes/${data.workOrder.id}`" @click.stop>{{ data.workOrder.code }}</RouterLink></template></Column>
              </DataTable>
            </TabPanel>
            <TabPanel value="summary">
              <div v-if="summary" class="grid g2">
                <div>
                  <h3 class="mb">Totales por categoría</h3>
                  <DataTable :value="Object.entries(summary.byCategory).map(([k, v]: [string, any]) => ({ k, ...v }))" size="small">
                    <Column field="k" header="Categoría" />
                    <Column field="total" header="Total" />
                    <Column field="executed" header="Ejecutadas" />
                    <Column header="Vencidas"><template #body="{ data }">{{ data.byStatus.VENCIDO ?? 0 }}</template></Column>
                  </DataTable>
                </div>
                <div>
                  <h3 class="mb">Actividades por mes</h3>
                  <DataTable :value="summary.byMonth.map((m: any, i: number) => ({ m: MONTHS[i], ...m }))" size="small">
                    <Column field="m" header="Mes" />
                    <Column field="total" header="Programadas" />
                    <Column field="executed" header="Ejecutadas" />
                  </DataTable>
                </div>
              </div>
            </TabPanel>
            <TabPanel value="resched">
              <h3 class="mb">Pendientes de aprobación</h3>
              <DataTable :value="pending" size="small">
                <template #empty><div class="empty">No hay reprogramaciones pendientes.</div></template>
                <Column header="Activo"><template #body="{ data }"><span class="mono">{{ data.activity.asset.code }}</span> {{ data.activity.asset.name }}</template></Column>
                <Column header="Fecha original"><template #body="{ data }">{{ fmtDate(data.activity.originalDate) }}</template></Column>
                <Column header="De → A"><template #body="{ data }">{{ fmtDate(data.fromDate) }} → <strong>{{ fmtDate(data.toDate) }}</strong></template></Column>
                <Column field="reason" header="Justificación" />
                <Column header="Solicitó"><template #body="{ data }">{{ data.requestedBy }}<div class="muted">{{ fmtDateTime(data.requestedAt) }}</div></template></Column>
                <Column v-if="auth.can('plans.approve')" style="width: 190px"><template #body="{ data }"><Button label="Aprobar" size="small" severity="success" text @click="decide(data.id, true)" /><Button label="Rechazar" size="small" severity="danger" text @click="decide(data.id, false)" /></template></Column>
              </DataTable>
              <h3 class="mt mb">Historial de reprogramaciones</h3>
              <DataTable :value="history?.reschedules ?? []" size="small" paginator :rows="15">
                <template #empty><div class="empty">Sin reprogramaciones.</div></template>
                <Column header="Solicitada"><template #body="{ data }">{{ fmtDateTime(data.requestedAt) }}</template></Column>
                <Column header="Actividad"><template #body="{ data }">{{ data.activity.programSnapshot.assetCode }} · {{ data.activity.programSnapshot.programName }}</template></Column>
                <Column header="Original"><template #body="{ data }">{{ fmtDate(data.activity.originalDate) }}</template></Column>
                <Column header="De → A"><template #body="{ data }">{{ fmtDate(data.fromDate) }} → {{ fmtDate(data.toDate) }}</template></Column>
                <Column header="Estado"><template #body="{ data }"><StatusTag :value="data.status" kind="resched" /></template></Column>
                <Column field="reason" header="Justificación" />
                <Column header="Decidió"><template #body="{ data }">{{ data.decidedBy ?? '—' }}<div class="muted">{{ data.decisionNote }}</div></template></Column>
              </DataTable>
            </TabPanel>
            <TabPanel value="history">
              <h3 class="mb">Versiones aprobadas</h3>
              <DataTable :value="history?.versions ?? []" size="small">
                <template #empty><div class="empty">El plan aún no ha sido aprobado.</div></template>
                <Column field="version" header="Versión" />
                <Column header="Fecha"><template #body="{ data }">{{ fmtDateTime(data.approvedAt) }}</template></Column>
                <Column field="approvedBy" header="Aprobó" />
                <Column field="activityCount" header="Actividades" />
                <Column field="reason" header="Motivo" />
              </DataTable>
              <h3 class="mt mb">Historial de cambios del plan</h3>
              <DataTable :value="history?.events ?? []" size="small" paginator :rows="15">
                <Column header="Fecha"><template #body="{ data }">{{ fmtDateTime(data.createdAt) }}</template></Column>
                <Column field="action" header="Acción" />
                <Column header="Estado"><template #body="{ data }"><StatusTag v-if="data.toStatus" :value="data.toStatus" kind="plan" /></template></Column>
                <Column field="version" header="Versión" />
                <Column field="user" header="Usuario" />
                <Column header="Detalle"><template #body="{ data }"><span v-if="data.detail?.created !== undefined">Creadas {{ data.detail.created }} · existentes {{ data.detail.skippedExisting }} · excluidas {{ data.detail.excluded }}</span>{{ data.reason ?? '' }}</template></Column>
              </DataTable>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </div>
    </template>

    <!-- Resultado de la generación -->
    <Dialog :visible="!!genResult" modal header="Resultado de la generación" :style="{ width: '620px', maxWidth: '95vw' }" @update:visible="genResult = null">
      <template v-if="genResult">
        <div class="grid g3 mb">
          <div class="card kpi ok"><span class="l">Actividades creadas</span><span class="v" data-testid="gen-created">{{ genResult.created }}</span></div>
          <div class="card kpi"><span class="l">Ya existentes (sin duplicar)</span><span class="v">{{ genResult.skippedExisting }}</span></div>
          <div class="card kpi"><span class="l">Excluidas / reactivadas</span><span class="v">{{ genResult.excluded }} / {{ genResult.reactivated }}</span></div>
        </div>
        <p class="muted">Programas evaluados: {{ genResult.programsEvaluated }}. La generación es idempotente: repetirla no duplica actividades.</p>
        <Message v-if="genResult.programsEvaluated === 0 && genResult.eligibilityDiagnostics" severity="warn" :closable="false">
          <p>No hay programas elegibles para {{ genResult.year }}. «Programa vigente» solo indica que está activo; además, las fechas de vigencia deben cruzar el año y el equipo no puede estar retirado ni dado de baja.</p>
          <ul class="mb">
            <li>Programas inactivos: {{ genResult.eligibilityDiagnostics.inactivePrograms }}</li>
            <li>Asociados a equipos retirados o dados de baja: {{ genResult.eligibilityDiagnostics.inactiveAssets }}</li>
            <li>Agrupaciones sin equipos habilitados: {{ genResult.eligibilityDiagnostics.noEligibleAssets }}</li>
            <li>Con inicio posterior a {{ genResult.year }}: {{ genResult.eligibilityDiagnostics.startsAfterYear }}</li>
            <li>Con vigencia terminada antes de {{ genResult.year }}: {{ genResult.eligibilityDiagnostics.expiredBeforeYear }}</li>
            <li>Elegibles: {{ genResult.eligibilityDiagnostics.eligiblePrograms }}</li>
          </ul>
          <RouterLink to="/plan-maestro">Revisar el plan maestro de mantenimiento</RouterLink>.
        </Message>
        <div v-if="Object.keys(genResult.byCategory).length" class="grid g2">
          <div><h3 class="mb">Por categoría</h3><div v-for="(v, k) in genResult.byCategory" :key="k" class="row"><span>{{ k }}</span><span class="spacer" /><strong>{{ v }}</strong></div></div>
          <div><h3 class="mb">Por mes</h3><div v-for="(v, i) in (genResult.byMonth as number[])" :key="i" class="row"><span>{{ MONTHS[i] }}</span><span class="spacer" /><strong>{{ v }}</strong></div></div>
        </div>
        <Message v-for="e in genResult.errors" :key="e.program" severity="error" :closable="false" class="mt">{{ e.program }}: {{ e.error }}</Message>
      </template>
      <template #footer><Button label="Cerrar" @click="genResult = null" /></template>
    </Dialog>

    <Dialog v-model:visible="groupedCellVisible" modal header="Equipos del grupo en esta fecha" :style="{ width: '760px', maxWidth: '96vw' }">
      <template v-if="groupedCell">
        <div class="row mb">
          <div><strong>{{ groupedCell.targetName }}</strong> · {{ groupedCell.programName }}<div class="muted small">{{ groupedCell.groupType }} · {{ fmtDate(groupedCell.date) }}</div></div>
          <span class="spacer" />
          <Tag :value="`${groupedCell.executed} de ${groupedCell.count} ejecutados`" :severity="groupedCell.executed === groupedCell.count ? 'success' : 'secondary'" />
        </div>
        <DataTable :value="groupedCell.activities ?? []" size="small">
          <template #empty><div class="empty">No hay equipos asociados a esta fecha.</div></template>
          <Column field="assetCode" header="Código" />
          <Column field="assetName" header="Equipo" />
          <Column header="Estado"><template #body="{ data }"><StatusTag :value="data.status" kind="activity" /></template></Column>
          <Column header="Reprogramada"><template #body="{ data }">{{ data.rescheduled ? 'Sí' : 'No' }}</template></Column>
          <Column style="width: 130px"><template #body="{ data }"><Button label="Ver detalle" size="small" text @click="openGroupedActivity(data.id)" /></template></Column>
        </DataTable>
      </template>
    </Dialog>

    <!-- Actividad -->
    <Dialog v-model:visible="actVisible" modal header="Actividad programada" :style="{ width: '720px', maxWidth: '96vw' }">
      <template v-if="act">
        <div class="row mb"><StatusTag :value="act.displayStatus" kind="activity" /><strong>{{ act.asset.code }} · {{ act.asset.name }}</strong></div>
        <dl class="kv">
          <div><dt>Mantenimiento</dt><dd>{{ act.program.name }}</dd></div>
          <div><dt>Área</dt><dd>{{ act.asset.area.name }}</dd></div>
          <div><dt>Fecha originalmente aprobada</dt><dd>{{ fmtDate(act.originalDate) }}</dd></div>
          <div><dt>Fecha comprometida</dt><dd>{{ fmtDate(act.committedDate) }}</dd></div>
          <div><dt>Fecha real de ejecución</dt><dd>{{ fmtDate(act.executedDate) }}</dd></div>
          <div><dt>Orden de trabajo</dt><dd><RouterLink v-if="act.workOrder" :to="`/ordenes/${act.workOrder.id}`">{{ act.workOrder.code }}</RouterLink><template v-else>—</template></dd></div>
          <div v-if="act.statusReason" style="grid-column: 1 / -1"><dt>Observación de estado</dt><dd>{{ act.statusReason }}</dd></div>
        </dl>
        <div class="field mt" style="max-width: 360px">
          <label>Responsable</label>
          <Select :model-value="act.responsibleId" :options="cat.users" option-label="fullName" option-value="id" show-clear filter :disabled="!auth.can('schedule.assign') || ['EJECUTADO', 'CANCELADO', 'NO_APLICA'].includes(act.status)" @update:model-value="assign" />
        </div>
        <template v-if="auth.can('schedule.reschedule') && ['PROGRAMADO', 'REPROGRAMADO'].includes(act.status) && ['BORRADOR', 'APROBADO'].includes(act.plan.status)">
          <h3 class="mt mb">Reprogramar</h3>
          <Message v-if="act.plan.status === 'APROBADO'" severity="info" :closable="false" class="mb">El plan está aprobado: la fecha original se conserva y la nueva fecha requiere aprobación.</Message>
          <div class="form">
            <div class="field"><label>Nueva fecha</label><DatePicker v-model="resched.toDate" date-format="dd/mm/yy" show-icon :min-date="ymdToDate(`${act.plan.year}-01-01`)!" :max-date="ymdToDate(`${act.plan.year}-12-31`)!" /></div>
            <div v-if="act.plan.status === 'APROBADO' && auth.can('plans.approve')" class="field"><label class="row"><Checkbox v-model="resched.autoApprove" binary /> Aprobar en el mismo acto</label></div>
            <div class="field full"><label>Justificación <span class="req">*</span></label><Textarea v-model="resched.reason" rows="2" /></div>
          </div>
          <Button class="mt" label="Registrar reprogramación" icon="pi pi-calendar" :disabled="!resched.toDate || resched.reason.trim().length < 10" @click="doReschedule" />
        </template>
        <div v-if="act.reschedules.length" class="mt">
          <h3 class="mb">Historial de fechas</h3>
          <div v-for="r in act.reschedules" :key="r.id" class="row"><StatusTag :value="r.status" kind="resched" />{{ fmtDate(r.fromDate) }} → {{ fmtDate(r.toDate) }} <span class="muted">· {{ r.reason }}</span></div>
        </div>
      </template>
      <template #footer>
        <Button label="F-08 Inspección" icon="pi pi-file-pdf" text @click="inspection" />
        <Button v-if="act && ['CANCELADO', 'NO_APLICA'].includes(act.status) && auth.canAny('plans.generate', 'plans.approve')" label="Restituir" text @click="setStatus('PROGRAMADO')" />
        <Button v-if="act && ['PROGRAMADO', 'REPROGRAMADO'].includes(act.status) && !act.workOrder && auth.canAny('plans.generate', 'plans.approve')" label="No aplica" text severity="secondary" @click="setStatus('NO_APLICA')" />
        <Button v-if="act && ['PROGRAMADO', 'REPROGRAMADO'].includes(act.status) && !act.workOrder && auth.canAny('plans.generate', 'plans.approve')" label="Cancelar actividad" text severity="danger" @click="setStatus('CANCELADO')" />
        <Button v-if="act && !act.workOrder && ['PROGRAMADO', 'REPROGRAMADO'].includes(act.status) && auth.can('workorders.create')" label="Generar orden de trabajo" icon="pi pi-wrench" @click="createWo" />
      </template>
    </Dialog>
    <ReasonDialog ref="reason" />
  </div>
</template>

<style scoped>
.type-bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.type-bar :deep(.p-togglebutton-content) { gap: 6px; }
.small { font-size: 0.8rem; }
.kpis { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
.kpis .k { display: flex; flex-direction: column; gap: 4px; padding: 10px 14px; border: 1px solid var(--app-border); border-radius: 8px; background: #f8fafc; min-width: 110px; }
.kpis .k.grow { flex: 1; min-width: 220px; }
.kpis .v { font-size: 1.35rem; font-weight: 650; line-height: 1.1; color: #0f3d56; }
.kpis .l { color: var(--app-muted); font-size: 0.8rem; }
.bar { height: 6px; border-radius: 3px; background: #e2e8f0; overflow: hidden; }
.bar span { display: block; height: 100%; background: #15803d; }
.legend { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; align-items: center; font-size: 0.8rem; }
.lg { padding: 2px 8px; border-radius: 5px; }
.mx-wrap { overflow: auto; max-height: 70vh; border: 1px solid var(--app-border); border-radius: 8px; }
.mx { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 0.84rem; }
.mx th { position: sticky; top: 0; background: #0f3d56; color: #fff; z-index: 2; padding: 8px 6px; font-weight: 600; text-align: left; font-size: 0.8rem; white-space: nowrap; }
.mx th.cur { background: #0369a1; }
.mx td { padding: 6px; border-bottom: 1px solid #eef2f6; border-right: 1px solid #f1f5f9; vertical-align: middle; }
.mx tbody tr:nth-child(even) td { background: #fbfcfe; }
.mx tbody tr:hover td { background: #f0f9ff; }
.mx .c { text-align: center; }
.mx .sticky { position: sticky; left: 0; background: #fff; z-index: 1; min-width: 220px; max-width: 300px; box-shadow: 1px 0 0 var(--app-border); }
.mx th.sticky { z-index: 3; background: #0f3d56; }
.mx td.cur { background: #f0f9ff !important; }
.gname { font-weight: 650; color: #0f3d56; }
.gtype { display: inline-block; margin-top: 3px; font-size: 0.7rem; color: #475569; background: #f1f5f9; border-radius: 4px; padding: 0 6px; }
.badge { display: inline-block; min-width: 28px; padding: 2px 8px; border-radius: 999px; background: #e0f2fe; color: #075985; font-weight: 650; font-size: 0.8rem; }
.mc { min-width: 58px; text-align: center; }
.per { min-width: 150px; }
.resp { min-width: 110px; }
.chip { display: inline-flex; flex-direction: column; align-items: center; gap: 1px; border: 0; border-radius: 6px; padding: 3px 6px 4px; margin: 1px; font-size: 0.78rem; font-weight: 650; cursor: pointer; line-height: 1.15; min-width: 34px; }
.chip:hover { outline: 2px solid rgba(15, 61, 86, 0.35); }
.chip.mixed { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18); }
.chip .d { font-size: 0.82rem; }
.chip .n { font-size: 0.68rem; font-weight: 600; opacity: 0.85; white-space: nowrap; }
.chip .pb { display: block; width: 100%; height: 3px; border-radius: 2px; background: rgba(0, 0, 0, 0.1); overflow: hidden; }
.chip .pb span { display: block; height: 100%; background: #15803d; }
.tot { font-weight: 700; }
.mx tfoot td { position: sticky; bottom: 0; background: #e2e8f0; font-weight: 700; border-top: 1px solid #cbd5e1; z-index: 1; }
.mx tfoot td.sticky { z-index: 2; background: #e2e8f0; }
.empty { text-align: center; padding: 28px 12px !important; }
.st-PROGRAMADO { background: #dbeafe; color: #1e3a8a; }
.st-PROXIMO { background: #fef3c7; color: #92400e; }
.st-EN_EJECUCION { background: #e0e7ff; color: #3730a3; }
.st-EJECUTADO { background: #d1fae5; color: #065f46; }
.st-VENCIDO { background: #fecaca; color: #991b1b; }
.st-REPROGRAMADO { background: #ede9fe; color: #5b21b6; }
.st-CANCELADO { background: #e5e7eb; color: #374151; text-decoration: line-through; }
.st-NO_APLICA { background: #f3f4f6; color: #6b7280; }
</style>
