<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { http } from '@/api/http';
import StatusTag from '@/components/StatusTag.vue';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { fmtDateTime } from '@/utils/format';
import { ASSET_CONDITION, FAILURE_STATUS, opts, PRIORITY } from '@/utils/labels';

const auth = useAuth();
const cat = useCatalog();
const n = useNotify();
const route = useRoute();
const router = useRouter();
const canRead = computed(() => auth.canAny('failures.read', 'failures.read_all'));
const items = ref<Record<string, any>[]>([]);
const total = ref(0);
const loading = ref(false);
const page = ref({ first: 0, rows: 25 });
const f = ref({ q: '', status: null as string | null, priority: null as string | null, areaId: null as string | null, open: true });

async function load() {
  if (!canRead.value) return;
  loading.value = true;
  try {
    const params = { ...Object.fromEntries(Object.entries(f.value).filter(([, v]) => v !== null && v !== '' && v !== false)), page: page.value.first / page.value.rows + 1, pageSize: page.value.rows };
    const r = await http.get('/failures', { params });
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
onMounted(async () => {
  await Promise.all([load(), cat.loadAssets()]);
  if (typeof route.query.nuevo === 'string') openReport(route.query.nuevo);
});

// ------------- Reporte de falla
const show = ref(false);
const form = ref({ assetId: null as string | null, title: '', description: '', assetCondition: 'NO_FUNCIONA', serviceImpact: '', safety: 3, care: 3, continuity: 3, observations: '', markOutOfService: false });
const preview = ref<{ score: number; priority: string } | null>(null);
function openReport(assetId?: string) {
  form.value = { assetId: assetId ?? null, title: '', description: '', assetCondition: 'NO_FUNCIONA', serviceImpact: '', safety: 3, care: 3, continuity: 3, observations: '', markOutOfService: false };
  show.value = true;
}
watch(() => [form.value.assetId, form.value.safety, form.value.care, form.value.continuity], async () => {
  if (!form.value.assetId) return (preview.value = null);
  try {
    preview.value = (await http.post('/failures/priority-preview', { assetId: form.value.assetId, safety: form.value.safety, care: form.value.care, continuity: form.value.continuity })).data;
  } catch {
    preview.value = null;
  }
});
const saving = ref(false);
async function report() {
  saving.value = true;
  const r = await n.run(() => http.post('/failures', form.value));
  saving.value = false;
  if (r) {
    n.ok(`Solicitud registrada con el consecutivo ${r.data.code}. Prioridad: ${PRIORITY[r.data.priority].label}.`, 'Falla reportada');
    show.value = false;
    if (canRead.value) await router.push(`/correctivos/${r.data.id}`);
  }
}
const selectedAsset = computed(() => cat.assets.find((a) => a.id === form.value.assetId));
const assetLabel = (a: { code: string; name: string; location: { name: string } | null }) => `${a.code} · ${a.name}${a.location ? ` (${a.location.name})` : ''}`;
const scale = [1, 2, 3, 4, 5];
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Mantenimientos correctivos</h1><div class="sub">Reporte y atención de fallas de equipos de cómputo y sistemas.</div></div>
      <div class="actions">
        <Button v-if="auth.can('failures.read_all')" label="Fallas recurrentes" icon="pi pi-replay" severity="secondary" outlined @click="router.push('/informes')" />
        <Button v-if="auth.can('failures.report')" label="Reportar falla" icon="pi pi-exclamation-triangle" severity="warn" data-testid="btn-report" @click="openReport()" />
      </div>
    </div>
    <div v-if="canRead" class="card">
      <div class="filters">
        <IconField style="min-width: 240px"><InputIcon class="pi pi-search" /><InputText v-model="f.q" placeholder="Consecutivo, título o activo" style="width: 100%" /></IconField>
        <Select v-model="f.status" :options="opts(FAILURE_STATUS)" option-label="label" option-value="value" placeholder="Estado" show-clear />
        <Select v-model="f.priority" :options="opts(PRIORITY)" option-label="label" option-value="value" placeholder="Prioridad" show-clear />
        <Select v-if="auth.can('failures.read_all')" v-model="f.areaId" :options="cat.areas" option-label="name" option-value="id" placeholder="Área" show-clear />
        <label class="row" style="min-width: auto"><Checkbox v-model="f.open" binary /> Solo abiertas</label>
      </div>
      <DataTable :value="items" :loading="loading" lazy paginator :rows="page.rows" :first="page.first" :total-records="total" size="small" row-hover class="clickable" @page="(e) => { page = { first: e.first, rows: e.rows }; load(); }" @row-click="(e) => router.push(`/correctivos/${e.data.id}`)">
        <template #empty><div class="empty">No hay reportes de falla.</div></template>
        <Column header="Consecutivo"><template #body="{ data }"><span class="mono nowrap">{{ data.code }}</span></template></Column>
        <Column header="Fecha y hora"><template #body="{ data }"><span class="nowrap">{{ fmtDateTime(data.reportedAt) }}</span></template></Column>
        <Column header="Falla"><template #body="{ data }">{{ data.title }}<Tag v-if="data.recurring" value="Recurrente" severity="danger" style="margin-left: 6px" /></template></Column>
        <Column header="Activo"><template #body="{ data }"><span class="mono">{{ data.asset.code }}</span> {{ data.asset.name }}<div class="muted">{{ data.area.name }}</div></template></Column>
        <Column header="Prioridad"><template #body="{ data }"><StatusTag :value="data.priority" kind="priority" /></template></Column>
        <Column header="Estado"><template #body="{ data }"><StatusTag :value="data.status" kind="failure" /><i v-if="data.outOfService" class="pi pi-power-off" style="color: #b91c1c; margin-left: 6px" v-tooltip="'Activo fuera de servicio'" /></template></Column>
        <Column header="Reportó / asignado"><template #body="{ data }">{{ data.reporter.fullName }}<div class="muted">{{ data.assignedTo?.fullName ?? 'Sin asignar' }}</div></template></Column>
      </DataTable>
    </div>
    <div v-else class="card empty">Use "Reportar falla" para registrar una solicitud. Recibirá un número consecutivo para su seguimiento.</div>

    <Dialog v-model:visible="show" modal header="Reportar falla" :style="{ width: '760px', maxWidth: '96vw' }">
      <Message severity="info" :closable="false" class="mb">Describa la falla del equipo o sistema. No registre nombres, historias clínicas ni diagnósticos de pacientes, ni contraseñas.</Message>
      <div class="form">
        <div class="field full"><label>Activo afectado <span class="req">*</span></label><Select v-model="form.assetId" :options="cat.assets" :option-label="assetLabel" option-value="id" filter placeholder="Busque por código, nombre o ubicación" data-testid="failure-asset" /></div>
        <div class="field full"><label>Título <span class="req">*</span></label><InputText v-model="form.title" placeholder="Ej. El computador no enciende" data-testid="failure-title" /></div>
        <div class="field full"><label>Descripción de la falla <span class="req">*</span></label><Textarea v-model="form.description" rows="3" data-testid="failure-desc" /></div>
        <div class="field"><label>Condición operativa del activo</label><Select v-model="form.assetCondition" :options="opts(ASSET_CONDITION)" option-label="label" option-value="value" /></div>
        <div class="field"><label>Impacto sobre el servicio</label><InputText v-model="form.serviceImpact" placeholder="Ej. No se pueden registrar admisiones" /></div>
        <div class="field"><label>Impacto en la atención / seguridad del paciente (1-5)</label><SelectButton v-model="form.safety" :options="scale" :allow-empty="false" /></div>
        <div class="field"><label>Impacto asistencial (1-5)</label><SelectButton v-model="form.care" :options="scale" :allow-empty="false" /></div>
        <div class="field"><label>Continuidad del servicio (1-5)</label><SelectButton v-model="form.continuity" :options="scale" :allow-empty="false" /></div>
        <div class="field"><label>Prioridad calculada</label><div class="row"><StatusTag v-if="preview" :value="preview.priority" kind="priority" /><span v-if="preview" class="muted">puntaje {{ preview.score }} (incluye criticidad del activo)</span><span v-else class="muted">Seleccione el activo</span></div></div>
        <div class="field full"><label>Observaciones</label><Textarea v-model="form.observations" rows="2" /></div>
        <div v-if="auth.can('failures.manage') && selectedAsset" class="field full"><label class="row"><Checkbox v-model="form.markOutOfService" binary /> Marcar el activo como fuera de servicio (inicia el registro de indisponibilidad)</label></div>
      </div>
      <small class="muted">Puede adjuntar fotografías o capturas desde el detalle de la solicitud una vez registrada.</small>
      <template #footer>
        <Button label="Cancelar" text severity="secondary" @click="show = false" />
        <Button label="Registrar reporte" icon="pi pi-send" :loading="saving" :disabled="!form.assetId || form.title.trim().length < 3 || form.description.trim().length < 10" data-testid="btn-submit-failure" @click="report" />
      </template>
    </Dialog>
  </div>
</template>
