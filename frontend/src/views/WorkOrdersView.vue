<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { http } from '@/api/http';
import StatusTag from '@/components/StatusTag.vue';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { dateToYmd, fmtCOP, fmtDate, fmtDateTime } from '@/utils/format';
import { opts, PRIORITY, WO_STATUS, WO_TYPE } from '@/utils/labels';

const auth = useAuth();
const cat = useCatalog();
const n = useNotify();
const route = useRoute();
const router = useRouter();
const items = ref<Record<string, any>[]>([]);
const total = ref(0);
const loading = ref(false);
const page = ref({ first: 0, rows: 25 });
const f = ref({
  q: '', type: (route.query.type as string) ?? null, status: null as string | null, priority: null as string | null, areaId: null as string | null,
  assignedToId: null as string | null, mine: !auth.can('workorders.read_all'), active: true,
});

async function load() {
  loading.value = true;
  try {
    const params = { ...Object.fromEntries(Object.entries(f.value).filter(([, v]) => v !== null && v !== '' && v !== false)), page: page.value.first / page.value.rows + 1, pageSize: page.value.rows };
    const r = await http.get('/workorders', { params });
    items.value = r.data.items;
    total.value = r.data.total;
  } catch (e) {
    n.error(e);
  } finally {
    loading.value = false;
  }
}
let t: ReturnType<typeof setTimeout>;
watch(f, () => {
  clearTimeout(t);
  t = setTimeout(() => {
    page.value.first = 0;
    void load();
  }, 250);
}, { deep: true });
onMounted(() => {
  void load();
  void cat.loadAssets();
});

// Nueva orden manual
const show = ref(false);
const form = ref({ type: 'PREVENTIVA', assetId: null as string | null, title: '', description: '', priority: 'MEDIA', assignedToId: null as string | null, supplierId: null as string | null, scheduledDate: null as Date | null, interventionType: '' });
async function create() {
  const r = await n.run(() => http.post('/workorders', { ...form.value, scheduledDate: dateToYmd(form.value.scheduledDate) }), 'Orden creada');
  if (r) await router.push(`/ordenes/${r.data.id}`);
}
const assetLabel = (a: { code: string; name: string }) => `${a.code} · ${a.name}`;
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Órdenes de trabajo</h1><div class="sub">Consolidado de órdenes preventivas y correctivas · {{ total }} registros</div></div>
      <div class="actions"><Button v-if="auth.can('workorders.create')" label="Nueva orden" icon="pi pi-plus" @click="show = true" /></div>
    </div>
    <div class="card">
      <div class="filters">
        <IconField style="min-width: 240px"><InputIcon class="pi pi-search" /><InputText v-model="f.q" placeholder="Código, título o activo" style="width: 100%" /></IconField>
        <Select v-model="f.type" :options="opts(WO_TYPE)" option-label="label" option-value="value" placeholder="Tipo" show-clear />
        <Select v-model="f.status" :options="opts(WO_STATUS)" option-label="label" option-value="value" placeholder="Estado" show-clear />
        <Select v-model="f.priority" :options="opts(PRIORITY)" option-label="label" option-value="value" placeholder="Prioridad" show-clear />
        <Select v-if="auth.can('workorders.read_all')" v-model="f.areaId" :options="cat.areas" option-label="name" option-value="id" placeholder="Área" show-clear />
        <Select v-if="auth.can('workorders.read_all')" v-model="f.assignedToId" :options="cat.users" option-label="fullName" option-value="id" placeholder="Responsable" show-clear filter />
        <label class="row" style="min-width: auto"><Checkbox v-model="f.active" binary /> Solo activas</label>
        <label class="row" style="min-width: auto"><Checkbox v-model="f.mine" binary /> Asignadas a mí</label>
      </div>
      <DataTable :value="items" :loading="loading" lazy paginator :rows="page.rows" :first="page.first" :total-records="total" :rows-per-page-options="[25, 50, 100]" size="small" row-hover class="clickable" @page="(e) => { page = { first: e.first, rows: e.rows }; load(); }" @row-click="(e) => router.push(`/ordenes/${e.data.id}`)">
        <template #empty><div class="empty">No hay órdenes con los filtros seleccionados.</div></template>
        <Column header="Orden"><template #body="{ data }"><span class="mono nowrap">{{ data.code }}</span><div class="muted">{{ WO_TYPE[data.type] }}</div></template></Column>
        <Column header="Título"><template #body="{ data }">{{ data.title }}</template></Column>
        <Column header="Activo"><template #body="{ data }"><span class="mono">{{ data.asset.code }}</span> {{ data.asset.name }}<div class="muted">{{ data.area.name }}</div></template></Column>
        <Column header="Prioridad"><template #body="{ data }"><StatusTag :value="data.priority" kind="priority" /></template></Column>
        <Column header="Estado"><template #body="{ data }"><StatusTag :value="data.status" kind="wo" /></template></Column>
        <Column header="Responsable"><template #body="{ data }">{{ data.assignedTo?.fullName ?? '—' }}<div class="muted">{{ data.supplier?.name }}</div></template></Column>
        <Column header="Programada"><template #body="{ data }">{{ fmtDate(data.scheduledDate) }}</template></Column>
        <Column header="Creada"><template #body="{ data }"><span class="nowrap">{{ fmtDateTime(data.createdAt) }}</span></template></Column>
        <Column header="Costo"><template #body="{ data }"><span class="nowrap">{{ fmtCOP(data.totalCost) }}</span></template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="show" modal header="Nueva orden de trabajo" :style="{ width: '720px', maxWidth: '96vw' }">
      <Message severity="info" :closable="false" class="mb">Las órdenes preventivas del cronograma se generan desde la actividad programada. Las correctivas se originan desde un reporte de falla.</Message>
      <div class="form">
        <div class="field"><label>Tipo</label><Select v-model="form.type" :options="[{ v: 'PREVENTIVA', l: 'Preventiva (no programada)' }]" option-label="l" option-value="v" /></div>
        <div class="field"><label>Prioridad</label><Select v-model="form.priority" :options="opts(PRIORITY)" option-label="label" option-value="value" /></div>
        <div class="field full"><label>Activo <span class="req">*</span></label><Select v-model="form.assetId" :options="cat.assets" :option-label="assetLabel" option-value="id" filter /></div>
        <div class="field full"><label>Título <span class="req">*</span></label><InputText v-model="form.title" /></div>
        <div class="field full"><label>Descripción</label><Textarea v-model="form.description" rows="3" /></div>
        <div class="field"><label>Responsable</label><Select v-model="form.assignedToId" :options="cat.executors" option-label="fullName" option-value="id" filter show-clear /></div>
        <div class="field"><label>Proveedor</label><Select v-model="form.supplierId" :options="cat.suppliers" option-label="name" option-value="id" filter show-clear /></div>
        <div class="field"><label>Fecha programada</label><DatePicker v-model="form.scheduledDate" date-format="dd/mm/yy" show-icon /></div>
        <div class="field"><label>Tipo de intervención</label><InputText v-model="form.interventionType" /></div>
      </div>
      <template #footer>
        <Button label="Cancelar" text severity="secondary" @click="show = false" />
        <Button label="Crear orden" :disabled="!form.assetId || form.title.trim().length < 3" @click="create" />
      </template>
    </Dialog>
  </div>
</template>
