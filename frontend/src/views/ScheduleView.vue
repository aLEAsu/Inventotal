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
const matrix = ref<{ rows: Record<string, any>[]; today: string } | null>(null);
const detail = ref<{ items: Record<string, any>[]; total: number }>({ items: [], total: 0 });
const summary = ref<Record<string, any> | null>(null);
const history = ref<Record<string, any> | null>(null);
const pending = ref<Record<string, any>[]>([]);
const loading = ref(false);
const sort = ref({ field: 'committedDate', order: 1 });
const page = ref({ first: 0, rows: 50 });

const params = computed(() => Object.fromEntries(Object.entries(f.value).filter(([, v]) => v !== null && v !== '')));

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
      http.get(`/plans/${year.value}/matrix`, { params: params.value }),
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
  const r = await n.run(() => http.post(`/plans/${year.value}/generate`, { reason: why }));
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
const exp = (kind: 'pdf' | 'xlsx', paper?: 'a4' | 'a3') =>
  n.run(() => download(`/plans/${year.value}/export.${kind}`, { ...params.value, paper }, `Plan_${year.value}.${kind}`), kind === 'pdf' ? 'PDF descargado' : 'Excel descargado');
function printView() {
  const q = new URLSearchParams(params.value as Record<string, string>).toString();
  window.open(`/imprimir/cronograma/${year.value}${q ? `?${q}` : ''}`, '_blank');
}

// --------------------------------------------- Actividad
const act = ref<Record<string, any> | null>(null);
const actVisible = ref(false);
const resched = ref({ toDate: null as Date | null, reason: '', autoApprove: false });
async function openActivity(id: string) {
  act.value = (await http.get(`/activities/${id}`)).data;
  resched.value = { toDate: ymdToDate(act.value!.committedDate), reason: '', autoApprove: auth.can('plans.approve') };
  actVisible.value = true;
}
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
          <h1>Cronograma anual de mantenimiento</h1>
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
          <Button label="Imprimir cronograma" icon="pi pi-print" severity="secondary" outlined data-testid="btn-print" @click="printView" />
          <Button label="PDF A4" icon="pi pi-file-pdf" severity="secondary" outlined data-testid="btn-pdf" @click="exp('pdf', 'a4')" />
          <Button label="PDF A3" icon="pi pi-file-pdf" severity="secondary" text @click="exp('pdf', 'a3')" />
          <Button label="Exportar Excel" icon="pi pi-file-excel" severity="secondary" outlined data-testid="btn-xlsx" @click="exp('xlsx')" />
        </template>
      </div>
    </div>

    <div class="card mb">
      <div class="row">
        <template v-if="!plan">
          <span>Para planificar {{ year }} cree el plan anual (quedará en borrador).</span>
          <Button v-if="auth.can('plans.generate')" label="Crear plan anual" icon="pi pi-plus" data-testid="btn-create-plan" @click="createPlan" />
        </template>
        <template v-else>
          <Button v-if="auth.can('plans.generate') && canEditPlan" :label="plan.status === 'APROBADO' ? 'Agregar actividades nuevas' : 'Generar cronograma'" icon="pi pi-bolt" :loading="busy" data-testid="btn-generate" @click="generate" />
          <Button v-if="auth.can('plans.submit') && plan.status === 'BORRADOR'" label="Enviar a revisión" icon="pi pi-send" severity="secondary" outlined @click="transition('submit')" />
          <Button v-if="auth.can('plans.approve') && plan.status === 'EN_REVISION'" label="Registrar revisión" icon="pi pi-eye" severity="secondary" outlined @click="transition('review')" />
          <Button v-if="auth.can('plans.approve') && plan.status === 'EN_REVISION'" label="Aprobar" icon="pi pi-verified" severity="success" @click="transition('approve')" />
          <Button v-if="auth.can('plans.approve') && plan.status === 'EN_REVISION'" label="Devolver a borrador" icon="pi pi-undo" severity="warn" text @click="transition('return')" />
          <Button v-if="auth.can('plans.close') && plan.status === 'APROBADO'" label="Cerrar y archivar" icon="pi pi-lock" severity="contrast" text @click="transition('close')" />
          <span class="spacer" />
          <span v-if="plan.pendingReschedules" class="row"><i class="pi pi-clock" style="color: #b45309" /> {{ plan.pendingReschedules }} reprogramaciones pendientes</span>
          <span v-if="summary" class="muted">{{ summary.total }} actividades</span>
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
        <Select v-model="f.kind" :options="opts(KIND)" option-label="label" option-value="value" placeholder="Tipo" show-clear />
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
              <div class="legend">
                <span v-for="o in statusOpts" :key="o.value" class="lg" :class="cellClass(o.value)">{{ o.label }}</span>
                <span class="muted">· El número es el día del mes · ↻ reprogramada</span>
              </div>
              <div class="mx-wrap">
                <table class="mx" data-testid="matrix">
                  <thead><tr><th class="sticky">Activo / mantenimiento</th><th>Área</th><th>Periodicidad</th><th v-for="m in MONTHS_SHORT" :key="m">{{ m }}</th></tr></thead>
                  <tbody>
                    <tr v-if="!matrix?.rows.length"><td :colspan="15" class="empty">{{ loading ? 'Cargando…' : 'Sin actividades. Genere el cronograma o ajuste los filtros.' }}</td></tr>
                    <tr v-for="r in matrix?.rows" :key="r.programId">
                      <td class="sticky"><RouterLink :to="`/activos/${r.assetId}`" class="mono">{{ r.assetCode }}</RouterLink> {{ r.assetName }}<div class="muted">{{ r.programName }}</div></td>
                      <td>{{ r.areaName }}</td>
                      <td class="nowrap">{{ r.frequency }}</td>
                      <td v-for="(cell, mi) in r.months" :key="mi" class="mc">
                        <button v-for="x in cell" :key="x.id" class="chip" :class="cellClass(x.status)" :title="`${fmtDate(x.date)} · ${ACTIVITY_STATUS[x.status].label}${x.rescheduled ? ` · original ${fmtDate(x.originalDate)}` : ''}`" @click="openActivity(x.id)">{{ x.day }}<span v-if="x.rescheduled">↻</span></button>
                      </td>
                    </tr>
                  </tbody>
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
        <div v-if="Object.keys(genResult.byCategory).length" class="grid g2">
          <div><h3 class="mb">Por categoría</h3><div v-for="(v, k) in genResult.byCategory" :key="k" class="row"><span>{{ k }}</span><span class="spacer" /><strong>{{ v }}</strong></div></div>
          <div><h3 class="mb">Por mes</h3><div v-for="(v, i) in (genResult.byMonth as number[])" :key="i" class="row"><span>{{ MONTHS[i] }}</span><span class="spacer" /><strong>{{ v }}</strong></div></div>
        </div>
        <Message v-for="e in genResult.errors" :key="e.program" severity="error" :closable="false" class="mt">{{ e.program }}: {{ e.error }}</Message>
      </template>
      <template #footer><Button label="Cerrar" @click="genResult = null" /></template>
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
.mx-wrap { overflow: auto; max-height: 70vh; border: 1px solid var(--app-border); border-radius: 8px; }
.mx { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 0.84rem; }
.mx th { position: sticky; top: 0; background: #f1f5f9; z-index: 2; padding: 7px 6px; border-bottom: 1px solid var(--app-border); font-weight: 600; text-align: left; }
.mx td { padding: 5px 6px; border-bottom: 1px solid #eef2f6; vertical-align: top; }
.mx .sticky { position: sticky; left: 0; background: #fff; z-index: 1; min-width: 260px; max-width: 320px; }
.mx th.sticky { z-index: 3; background: #f1f5f9; }
.mc { min-width: 54px; text-align: center; }
.chip { border: 0; border-radius: 5px; padding: 2px 5px; margin: 1px; font-size: 0.78rem; font-weight: 600; cursor: pointer; }
.legend { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; align-items: center; font-size: 0.8rem; }
.lg { padding: 2px 8px; border-radius: 5px; }
.st-PROGRAMADO { background: #dbeafe; color: #1e3a8a; }
.st-PROXIMO { background: #fef3c7; color: #92400e; }
.st-EN_EJECUCION { background: #e0e7ff; color: #3730a3; }
.st-EJECUTADO { background: #d1fae5; color: #065f46; }
.st-VENCIDO { background: #fecaca; color: #991b1b; }
.st-REPROGRAMADO { background: #ede9fe; color: #5b21b6; }
.st-CANCELADO { background: #e5e7eb; color: #374151; text-decoration: line-through; }
.st-NO_APLICA { background: #f3f4f6; color: #6b7280; }
</style>
