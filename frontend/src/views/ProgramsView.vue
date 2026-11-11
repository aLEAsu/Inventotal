<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { http } from '@/api/http';
import StatusTag from '@/components/StatusTag.vue';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { dateToYmd, fmtDate, ymdToDate } from '@/utils/format';
import { FREQUENCY, KIND, opts } from '@/utils/labels';

const auth = useAuth();
const cat = useCatalog();
const n = useNotify();
const route = useRoute();
const items = ref<Record<string, any>[]>([]);
const total = ref(0);
const loading = ref(false);
const f = ref({ q: '', categoryId: null as string | null, areaId: null as string | null, frequencyType: null as string | null, active: 'true' as string | null });

async function load() {
  loading.value = true;
  try {
    const params = { ...Object.fromEntries(Object.entries(f.value).filter(([, v]) => v)), pageSize: 500 };
    const r = await http.get('/programs', { params });
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
  t = setTimeout(load, 300);
}, { deep: true });
onMounted(async () => {
  await Promise.all([load(), cat.loadAssets()]);
  if (typeof route.query.nuevo === 'string') openNew(route.query.nuevo);
});

// ---------------- Formulario
type CL = { id: string; text: string; required: boolean };
const empty = () => ({
  id: '' as string, assetId: null as string | null, kind: 'PREVENTIVO', name: '', description: '', procedure: '', checklist: [] as CL[],
  frequencyType: 'SEMESTRAL', intervalValue: null as number | null, intervalUnit: null as string | null, specificDates: [] as string[],
  startDate: null as Date | null, baseDate: null as Date | null, endDate: null as Date | null, lastPerformedDate: null as Date | null,
  estimatedDurationMin: null as number | null, responsibleId: null as string | null, supplierId: null as string | null,
  technicalRequirements: '', references: '', frequencyJustification: '', notes: '', isActive: true, changeReason: '',
});
const form = ref(empty());
const show = ref(false);
const saving = ref(false);
const preview = ref<string[]>([]);
const original = ref<Record<string, unknown> | null>(null);
const newDate = ref('');
const newItem = ref('');

function openNew(assetId?: string) {
  form.value = { ...empty(), assetId: assetId ?? null, startDate: ymdToDate(`${cat.year}-01-01`), baseDate: ymdToDate(`${cat.year}-01-15`) };
  original.value = null;
  preview.value = [];
  show.value = true;
}
async function openEdit(id: string) {
  const p = (await http.get(`/programs/${id}`)).data;
  original.value = p;
  form.value = {
    ...empty(), ...p, assetId: p.assetId, checklist: p.checklist ?? [], startDate: ymdToDate(p.startDate), baseDate: ymdToDate(p.baseDate),
    endDate: ymdToDate(p.endDate), lastPerformedDate: ymdToDate(p.lastPerformedDate), description: p.description ?? '', procedure: p.procedure ?? '',
    technicalRequirements: p.technicalRequirements ?? '', references: p.references ?? '', notes: p.notes ?? '', changeReason: '',
  };
  preview.value = (await http.get(`/programs/${id}/preview/${cat.year}`)).data.dates;
  show.value = true;
}
const ruleChanged = computed(() => {
  const o = original.value;
  if (!o) return false;
  const fv = form.value;
  return o.frequencyType !== fv.frequencyType || (o.intervalValue ?? null) !== fv.intervalValue || (o.intervalUnit ?? null) !== fv.intervalUnit ||
    JSON.stringify(o.specificDates ?? []) !== JSON.stringify(fv.specificDates) || o.startDate !== dateToYmd(fv.startDate) || o.baseDate !== dateToYmd(fv.baseDate) ||
    (o.endDate ?? null) !== dateToYmd(fv.endDate);
});
function addItem() {
  if (newItem.value.trim().length < 2) return;
  form.value.checklist.push({ id: `i${Date.now().toString(36)}`, text: newItem.value.trim(), required: true });
  newItem.value = '';
}
function addDate() {
  if (/^\d{2}-\d{2}$/.test(newDate.value) && !form.value.specificDates.includes(newDate.value)) form.value.specificDates.push(newDate.value);
  form.value.specificDates.sort();
  newDate.value = '';
}
async function save() {
  const fv = form.value;
  const body: Record<string, unknown> = {
    assetId: fv.assetId, kind: fv.kind, name: fv.name, description: fv.description, procedure: fv.procedure, checklist: fv.checklist,
    frequencyType: fv.frequencyType, intervalValue: fv.frequencyType === 'PERSONALIZADO' ? fv.intervalValue : null, intervalUnit: fv.frequencyType === 'PERSONALIZADO' ? fv.intervalUnit : null,
    specificDates: fv.frequencyType === 'FECHAS_ESPECIFICAS' ? fv.specificDates : [], startDate: dateToYmd(fv.startDate), baseDate: dateToYmd(fv.baseDate),
    endDate: dateToYmd(fv.endDate), lastPerformedDate: dateToYmd(fv.lastPerformedDate), estimatedDurationMin: fv.estimatedDurationMin,
    responsibleId: fv.responsibleId, supplierId: fv.supplierId, technicalRequirements: fv.technicalRequirements, references: fv.references,
    frequencyJustification: fv.frequencyJustification, notes: fv.notes,
  };
  if (fv.id) {
    body.isActive = fv.isActive;
    if (ruleChanged.value) body.changeReason = fv.changeReason;
  }
  saving.value = true;
  const r = await n.run(() => (fv.id ? http.patch(`/programs/${fv.id}`, body) : http.post('/programs', body)), fv.id ? 'Programa actualizado' : 'Programa creado');
  saving.value = false;
  if (r) {
    show.value = false;
    await load();
  }
}
const assetLabel = (a: { code: string; name: string }) => `${a.code} · ${a.name}`;
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Plan maestro de mantenimiento</h1>
        <div class="sub">Programas preventivos por activo. Las periodicidades se definen con sustento técnico (fabricante, condiciones de uso, historial) — el sistema no impone frecuencias universales.</div>
      </div>
      <div class="actions"><Button v-if="auth.can('programs.write')" label="Nuevo programa" icon="pi pi-plus" @click="openNew()" /></div>
    </div>
    <div class="card">
      <div class="filters">
        <IconField style="min-width: 260px"><InputIcon class="pi pi-search" /><InputText v-model="f.q" placeholder="Programa o activo" style="width: 100%" /></IconField>
        <Select v-model="f.categoryId" :options="cat.categories" option-label="name" option-value="id" placeholder="Categoría" show-clear />
        <Select v-model="f.areaId" :options="cat.areas" option-label="name" option-value="id" placeholder="Área" show-clear />
        <Select v-model="f.frequencyType" :options="opts(FREQUENCY)" option-label="label" option-value="value" placeholder="Periodicidad" show-clear />
        <Select v-model="f.active" :options="[{ l: 'Vigentes', v: 'true' }, { l: 'Inactivos', v: 'false' }]" option-label="l" option-value="v" placeholder="Todos" show-clear />
      </div>
      <DataTable :value="items" :loading="loading" size="small" paginator :rows="25" row-hover class="clickable" @row-click="(e) => auth.can('programs.write') && openEdit(e.data.id)">
        <template #empty><div class="empty">No hay programas.</div></template>
        <Column header="Código"><template #body="{ data }"><span class="mono">{{ data.code }}</span></template></Column>
        <Column header="Activo"><template #body="{ data }"><RouterLink :to="`/activos/${data.asset.id}`" @click.stop><span class="mono">{{ data.asset.code }}</span></RouterLink> {{ data.asset.name }}<div class="muted">{{ data.asset.area.name }}</div></template></Column>
        <Column header="Mantenimiento"><template #body="{ data }">{{ data.name }}<div class="muted">{{ KIND[data.kind] }}</div></template></Column>
        <Column header="Periodicidad"><template #body="{ data }">{{ data.frequencyLabel }}<div class="muted">{{ data.occurrencesThisYear }} en {{ cat.year }}</div></template></Column>
        <Column header="Criticidad"><template #body="{ data }"><StatusTag :value="data.asset.criticality" kind="crit" /></template></Column>
        <Column header="Responsable"><template #body="{ data }">{{ data.responsible?.fullName ?? '—' }}<div class="muted">{{ data.supplier?.name }}</div></template></Column>
        <Column header="Último"><template #body="{ data }">{{ fmtDate(data.lastPerformedDate) }}</template></Column>
        <Column header="Vigente"><template #body="{ data }"><Tag :value="data.isActive ? 'Sí' : 'No'" :severity="data.isActive ? 'success' : 'secondary'" /></template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="show" modal :header="form.id ? 'Editar programa preventivo' : 'Nuevo programa preventivo'" :style="{ width: '920px', maxWidth: '96vw' }">
      <div class="form">
        <div class="field full"><label>Activo <span class="req">*</span></label><Select v-model="form.assetId" :options="cat.assets" :option-label="assetLabel" option-value="id" filter placeholder="Seleccione el equipo o sistema" :disabled="!!form.id" /></div>
        <div class="field"><label>Nombre de la actividad <span class="req">*</span></label><InputText v-model="form.name" /></div>
        <div class="field"><label>Tipo de mantenimiento</label><Select v-model="form.kind" :options="opts(KIND)" option-label="label" option-value="value" /></div>
        <div class="field full"><label>Descripción</label><Textarea v-model="form.description" rows="2" auto-resize /></div>
        <div class="field full"><label>Procedimiento técnico</label><Textarea v-model="form.procedure" rows="4" auto-resize placeholder="Pasos de ejecución" /></div>
      </div>
      <h3 class="mt mb">Lista de verificación</h3>
      <div v-for="(i, idx) in form.checklist" :key="i.id" class="row mb">
        <span class="muted">{{ idx + 1 }}.</span><InputText v-model="i.text" style="flex: 1" />
        <label class="row"><Checkbox v-model="i.required" binary /> Obligatorio</label>
        <Button icon="pi pi-trash" text severity="danger" aria-label="Quitar" @click="form.checklist.splice(idx, 1)" />
      </div>
      <div class="row"><InputText v-model="newItem" placeholder="Nuevo ítem de verificación" style="flex: 1" @keyup.enter="addItem" /><Button label="Agregar ítem" icon="pi pi-plus" text @click="addItem" /></div>

      <h3 class="mt mb">Periodicidad</h3>
      <div class="form cols3">
        <div class="field"><label>Periodicidad <span class="req">*</span></label><Select v-model="form.frequencyType" :options="opts(FREQUENCY)" option-label="label" option-value="value" /></div>
        <template v-if="form.frequencyType === 'PERSONALIZADO'">
          <div class="field"><label>Cada <span class="req">*</span></label><InputNumber v-model="form.intervalValue" :min="1" /></div>
          <div class="field"><label>Unidad <span class="req">*</span></label><Select v-model="form.intervalUnit" :options="[{ v: 'DIAS', l: 'Días' }, { v: 'SEMANAS', l: 'Semanas' }, { v: 'MESES', l: 'Meses' }]" option-label="l" option-value="v" /></div>
        </template>
        <div v-if="form.frequencyType === 'FECHAS_ESPECIFICAS'" class="field" style="grid-column: span 2">
          <label>Fechas (MM-DD, se repiten cada año) <span class="req">*</span></label>
          <div class="row"><Tag v-for="(dt, i) in form.specificDates" :key="dt" :value="`${dt.slice(3)}/${dt.slice(0, 2)}`" severity="secondary" class="clickable" @click="form.specificDates.splice(i, 1)" /><InputText v-model="newDate" placeholder="MM-DD" style="width: 90px" @keyup.enter="addDate" /><Button label="Agregar" text @click="addDate" /></div>
        </div>
        <div class="field"><label>Fecha de inicio <span class="req">*</span></label><DatePicker v-model="form.startDate" date-format="dd/mm/yy" show-icon /></div>
        <div class="field"><label>Fecha base de programación <span class="req">*</span></label><DatePicker v-model="form.baseDate" date-format="dd/mm/yy" show-icon /><small>Ancla desde la que se calculan las fechas.</small></div>
        <div class="field"><label>Fin de vigencia</label><DatePicker v-model="form.endDate" date-format="dd/mm/yy" show-icon show-button-bar /></div>
        <div class="field"><label>Último mantenimiento realizado</label><DatePicker v-model="form.lastPerformedDate" date-format="dd/mm/yy" show-icon show-button-bar /></div>
        <div class="field"><label>Duración estimada (min)</label><InputNumber v-model="form.estimatedDurationMin" :min="1" /></div>
        <div class="field full"><label>Sustento técnico de la periodicidad <span class="req">*</span></label><Textarea v-model="form.frequencyJustification" rows="2" placeholder="Ej.: recomendación del fabricante (manual sección X), condiciones de uso 24/7, historial de fallas…" /></div>
        <div v-if="form.id && ruleChanged" class="field full"><label>Motivo del cambio de periodicidad <span class="req">*</span></label><Textarea v-model="form.changeReason" rows="2" /><small>Los planes ya aprobados no se modifican automáticamente; el cambio aplica al regenerar planes en borrador y años futuros.</small></div>
      </div>
      <div v-if="preview.length" class="mt"><span class="muted">Fechas en {{ cat.year }} (según la regla guardada): </span>{{ preview.map((x) => fmtDate(x)).join(' · ') }}</div>

      <h3 class="mt mb">Responsables y referencias</h3>
      <div class="form">
        <div class="field"><label>Responsable</label><Select v-model="form.responsibleId" :options="cat.users" option-label="fullName" option-value="id" filter show-clear /></div>
        <div class="field"><label>Proveedor (si aplica)</label><Select v-model="form.supplierId" :options="cat.suppliers" option-label="name" option-value="id" filter show-clear /></div>
        <div class="field"><label>Requisitos técnicos</label><Textarea v-model="form.technicalRequirements" rows="2" /></div>
        <div class="field"><label>Documentación de referencia</label><Textarea v-model="form.references" rows="2" /></div>
        <div class="field full"><label>Observaciones</label><Textarea v-model="form.notes" rows="2" /></div>
        <div v-if="form.id" class="field"><label class="row"><ToggleSwitch v-model="form.isActive" /> Programa vigente</label></div>
      </div>
      <template #footer>
        <Button label="Cancelar" text severity="secondary" @click="show = false" />
        <Button label="Guardar" icon="pi pi-check" :loading="saving" :disabled="!form.assetId || !form.name || form.frequencyJustification.trim().length < 10 || (!!form.id && ruleChanged && form.changeReason.trim().length < 5)" @click="save" />
      </template>
    </Dialog>
  </div>
</template>
