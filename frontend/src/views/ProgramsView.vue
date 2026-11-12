<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { http } from '@/api/http';
import StatusTag from '@/components/StatusTag.vue';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { dateToYmd, fmtDate, MONTHS, ymdToDate } from '@/utils/format';
import { FREQUENCY, KIND, opts } from '@/utils/labels';

const auth = useAuth();
const cat = useCatalog();
const n = useNotify();
const route = useRoute();
const items = ref<Record<string, any>[]>([]);
const total = ref(0);
const loading = ref(false);
const routeType = route.query.tipo === 'CORRECTIVO' ? 'CORRECTIVO' : route.query.tipo === 'PREVENTIVO' ? 'PREVENTIVO' : null;
const f = ref({ q: '', scheduleType: routeType as string | null, categoryId: null as string | null, areaId: null as string | null, frequencyType: null as string | null, active: 'true' as string | null });
const groups = ref<Record<string, any>[]>([]);

async function loadGroups() {
  groups.value = (await http.get('/maintenance-groups')).data;
}

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
  await Promise.all([load(), cat.loadAssets(), loadGroups()]);
  if (route.query.nuevo === 'grupo') openNew(undefined, routeType ?? 'PREVENTIVO');
  else if (typeof route.query.nuevo === 'string') openNew(route.query.nuevo);
});

// ---------------- Formulario
type CL = { id: string; text: string; required: boolean };
const empty = () => ({
  id: '' as string, targetType: 'CATEGORIA', displayMode: 'AGRUPADO', assetId: null as string | null, categoryId: null as string | null,
  subcategoryId: null as string | null, groupId: null as string | null, kind: 'PREVENTIVO', name: '', description: '', procedure: '', checklist: [] as CL[],
  frequencyType: 'SEMANA_DEL_MES', intervalValue: null as number | null, intervalUnit: null as string | null, specificDates: [] as string[],
  monthsOfYear: Array.from({ length: 12 }, (_, i) => i + 1), weekOfMonth: 1 as number | null, dayOfWeek: 1 as number | null,
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

function openNew(assetId?: string, scheduleType: 'PREVENTIVO' | 'CORRECTIVO' = (f.value.scheduleType as 'CORRECTIVO' | null) ?? 'PREVENTIVO') {
  form.value = {
    ...empty(), targetType: assetId ? 'ACTIVO' : 'SUBCATEGORIA', displayMode: assetId ? 'POR_ACTIVO' : 'AGRUPADO',
    kind: scheduleType === 'CORRECTIVO' ? 'CORRECTIVO' : 'PREVENTIVO',
    assetId: assetId ?? null, categoryId: cat.categories.find((c) => c.isActive)?.id ?? null,
    frequencyType: assetId ? 'SEMESTRAL' : 'SEMANA_DEL_MES',
    startDate: ymdToDate(`${cat.year}-01-01`), baseDate: ymdToDate(`${cat.year}-01-15`),
  };
  original.value = null;
  preview.value = [];
  show.value = true;
}
async function openEdit(id: string) {
  const p = (await http.get(`/programs/${id}`)).data;
  original.value = p;
  form.value = {
    ...empty(), ...p, targetType: p.targetType ?? 'ACTIVO', displayMode: p.displayMode ?? 'POR_ACTIVO',
    assetId: p.assetId ?? null, categoryId: p.categoryId ?? null, subcategoryId: p.subcategoryId ?? null, groupId: p.groupId ?? null,
    monthsOfYear: p.monthsOfYear ?? [], weekOfMonth: p.weekOfMonth ?? null, dayOfWeek: p.dayOfWeek ?? null,
    checklist: p.checklist ?? [], startDate: ymdToDate(p.startDate), baseDate: ymdToDate(p.baseDate),
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
    JSON.stringify(o.specificDates ?? []) !== JSON.stringify(fv.specificDates) || JSON.stringify(o.monthsOfYear ?? []) !== JSON.stringify(fv.monthsOfYear) ||
    (o.weekOfMonth ?? null) !== fv.weekOfMonth || (o.dayOfWeek ?? null) !== fv.dayOfWeek ||
    o.startDate !== dateToYmd(fv.startDate) || o.baseDate !== dateToYmd(fv.baseDate) ||
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
    targetType: fv.targetType, displayMode: fv.targetType === 'ACTIVO' ? 'POR_ACTIVO' : fv.displayMode,
    ...(fv.targetType === 'ACTIVO' ? { assetId: fv.assetId } : {}),
    ...(fv.targetType === 'CATEGORIA' || fv.targetType === 'SUBCATEGORIA' ? { categoryId: fv.categoryId } : {}),
    ...(fv.targetType === 'SUBCATEGORIA' ? { subcategoryId: fv.subcategoryId } : {}),
    ...(fv.targetType === 'GRUPO' ? { groupId: fv.groupId } : {}),
    kind: fv.kind, name: fv.name, description: fv.description, procedure: fv.procedure, checklist: fv.checklist,
    frequencyType: fv.frequencyType, intervalValue: fv.frequencyType === 'PERSONALIZADO' ? fv.intervalValue : null, intervalUnit: fv.frequencyType === 'PERSONALIZADO' ? fv.intervalUnit : null,
    specificDates: fv.frequencyType === 'FECHAS_ESPECIFICAS' ? fv.specificDates : [],
    monthsOfYear: fv.frequencyType === 'SEMANA_DEL_MES' ? fv.monthsOfYear : [],
    weekOfMonth: fv.frequencyType === 'SEMANA_DEL_MES' ? fv.weekOfMonth : null,
    dayOfWeek: fv.frequencyType === 'SEMANA_DEL_MES' ? fv.dayOfWeek : null,
    startDate: dateToYmd(fv.startDate), baseDate: dateToYmd(fv.baseDate),
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
const groupAssetOptions = computed(() => cat.assets
  .filter((asset) => asset.status !== 'RETIRADO' && asset.status !== 'DADO_DE_BAJA')
  .map((asset) => ({ ...asset, label: assetLabel(asset) })));
const targetTypeLabels: Record<string, string> = { ACTIVO: 'Activo individual', CATEGORIA: 'Categoría', SUBCATEGORIA: 'Subcategoría', GRUPO: 'Grupo personalizado' };
const assetTargetLabel = (p: Record<string, any>) => p.targetType === 'ACTIVO'
  ? `${p.asset?.code ?? ''} · ${p.asset?.name ?? p.targetName ?? ''}`
  : `${p.targetName ?? 'Agrupación'}${p.assetCount ? ` · ${p.assetCount} activos` : ''}`;
const targetValid = computed(() => {
  const fv = form.value;
  return fv.targetType === 'ACTIVO' ? !!fv.assetId
    : fv.targetType === 'CATEGORIA' ? !!fv.categoryId
      : fv.targetType === 'SUBCATEGORIA' ? !!fv.categoryId && !!fv.subcategoryId
        : !!fv.groupId;
});

const groupVisible = ref(false);
const groupSaving = ref(false);
const groupForm = ref({ id: '', name: '', description: '', assetIds: [] as string[] });
function openGroup(group?: Record<string, any>) {
  groupForm.value = { id: group?.id ?? '', name: group?.name ?? '', description: group?.description ?? '', assetIds: group?.assetIds ?? [] };
  groupVisible.value = true;
}
async function saveGroup() {
  groupSaving.value = true;
  const g = groupForm.value;
  const r = await n.run(() => g.id
    ? http.patch(`/maintenance-groups/${g.id}`, { name: g.name, description: g.description, assetIds: g.assetIds })
    : http.post('/maintenance-groups', { name: g.name, description: g.description, assetIds: g.assetIds }),
  g.id ? 'Agrupación actualizada' : 'Agrupación creada');
  groupSaving.value = false;
  if (r) {
    groupVisible.value = false;
    await loadGroups();
  }
}
const setTargetType = (targetType: string) => {
  form.value.targetType = targetType;
  form.value.assetId = null;
  form.value.categoryId = null;
  form.value.subcategoryId = null;
  form.value.groupId = null;
  form.value.displayMode = targetType === 'ACTIVO' ? 'POR_ACTIVO' : 'AGRUPADO';
};
/** Cronograma al que pertenece el programa: el correctivo es un tipo propio; los demás tipos van al preventivo. */
const formSchedule = computed({
  get: () => (form.value.kind === 'CORRECTIVO' ? 'CORRECTIVO' : 'PREVENTIVO'),
  set: (v: string) => { form.value.kind = v === 'CORRECTIVO' ? 'CORRECTIVO' : 'PREVENTIVO'; },
});
/** Etiqueta con el número de equipos habilitados que tomará el programa */
const withCount = (o: { name: string; assetCount?: number }) => o.assetCount === undefined ? o.name : `${o.name} · ${o.assetCount ? `${o.assetCount} equipo${o.assetCount === 1 ? '' : 's'}` : 'sin equipos aún'}`;
const selectedTargetCount = computed(() => {
  const c = cat.categories.find((x) => x.id === form.value.categoryId);
  if (form.value.targetType === 'SUBCATEGORIA') return c?.subcategories.find((s) => s.id === form.value.subcategoryId)?.assetCount;
  if (form.value.targetType === 'CATEGORIA') return c?.assetCount;
  return undefined;
});
const preventiveKinds = opts(KIND).filter((o) => o.value !== 'CORRECTIVO');
const monthOptions = MONTHS.map((label, index) => ({ label, value: index + 1 }));
const weekOptions = [{ label: '1.ª semana', value: 1 }, { label: '2.ª semana', value: 2 }, { label: '3.ª semana', value: 3 }, { label: '4.ª semana', value: 4 }, { label: 'Última semana', value: -1 }];
const weekdayOptions = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((label, index) => ({ label, value: index + 1 }));
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Plan maestro de mantenimiento</h1>
        <div class="sub">Define cómo queda cada cronograma (preventivo o correctivo): elige el grupo de equipos (categoría, subcategoría o agrupación personalizada), la actividad y la periodicidad. El cronograma muestra una fila por grupo; las órdenes y el seguimiento se conservan por equipo.</div>
      </div>
      <div class="actions">
        <Button v-if="auth.can('programs.write')" label="Nueva agrupación" icon="pi pi-users" severity="secondary" outlined @click="openGroup()" />
        <Button v-if="auth.can('programs.write')" label="Nuevo programa" icon="pi pi-plus" @click="openNew()" />
      </div>
    </div>
    <div v-if="groups.length" class="card mb">
      <div class="row mb"><h3>Agrupaciones personalizadas</h3><span class="spacer" /><span class="muted">{{ groups.length }} grupos</span></div>
      <div class="grid g3">
        <div v-for="group in groups" :key="group.id" class="card">
          <div class="row"><strong>{{ group.name }}</strong><span class="spacer" /><Tag :value="`${group.assetCount} equipos`" severity="secondary" /></div>
          <div class="muted mt">{{ group.description || 'Sin descripción' }}</div>
          <Button v-if="auth.can('programs.write')" label="Editar agrupación" text size="small" class="mt" @click="openGroup(group)" />
        </div>
      </div>
    </div>
    <div class="card">
      <div class="filters">
        <IconField style="min-width: 260px"><InputIcon class="pi pi-search" /><InputText v-model="f.q" placeholder="Programa o activo" style="width: 100%" /></IconField>
        <Select v-model="f.scheduleType" :options="[{ l: 'Cronograma preventivo', v: 'PREVENTIVO' }, { l: 'Cronograma correctivo', v: 'CORRECTIVO' }]" option-label="l" option-value="v" placeholder="Todos los cronogramas" show-clear />
        <Select v-model="f.categoryId" :options="cat.categories" option-label="name" option-value="id" placeholder="Categoría" show-clear />
        <Select v-model="f.areaId" :options="cat.areas" option-label="name" option-value="id" placeholder="Área" show-clear />
        <Select v-model="f.frequencyType" :options="opts(FREQUENCY)" option-label="label" option-value="value" placeholder="Periodicidad" show-clear />
        <Select v-model="f.active" :options="[{ l: 'Vigentes', v: 'true' }, { l: 'Inactivos', v: 'false' }]" option-label="l" option-value="v" placeholder="Todos" show-clear />
      </div>
      <DataTable :value="items" :loading="loading" size="small" paginator :rows="25" row-hover class="clickable" @row-click="(e) => auth.can('programs.write') && openEdit(e.data.id)">
        <template #empty><div class="empty">No hay programas.</div></template>
        <Column header="Código"><template #body="{ data }"><span class="mono">{{ data.code }}</span></template></Column>
        <Column header="Alcance"><template #body="{ data }">
          <RouterLink v-if="data.targetType === 'ACTIVO' && data.asset" :to="`/activos/${data.asset.id}`" @click.stop><span class="mono">{{ data.asset.code }}</span> {{ data.asset.name }}</RouterLink>
          <span v-else>{{ assetTargetLabel(data) }}</span>
          <div class="muted">{{ targetTypeLabels[data.targetType] ?? 'Agrupación' }}</div>
        </template></Column>
        <Column header="Mantenimiento"><template #body="{ data }">{{ data.name }}<div><Tag :value="data.kind === 'CORRECTIVO' ? 'Correctivo' : KIND[data.kind]" :severity="data.kind === 'CORRECTIVO' ? 'warn' : 'info'" class="kind-tag" /></div></template></Column>
        <Column header="Periodicidad"><template #body="{ data }">{{ data.frequencyLabel }}<div class="muted">{{ data.occurrencesThisYear }} en {{ cat.year }}</div></template></Column>
        <Column header="Criticidad"><template #body="{ data }"><StatusTag v-if="data.asset" :value="data.asset.criticality" kind="crit" /><span v-else>—</span></template></Column>
        <Column header="Responsable"><template #body="{ data }">{{ data.responsible?.fullName ?? '—' }}<div class="muted">{{ data.supplier?.name }}</div></template></Column>
        <Column header="Último"><template #body="{ data }">{{ fmtDate(data.lastPerformedDate) }}</template></Column>
        <Column header="Vigente"><template #body="{ data }"><Tag :value="data.isActive ? 'Sí' : 'No'" :severity="data.isActive ? 'success' : 'secondary'" /></template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="show" modal :header="form.id ? 'Editar programa de mantenimiento' : 'Nuevo programa de mantenimiento'" :style="{ width: '920px', maxWidth: '96vw' }">
      <div class="form">
        <div class="field full"><label>Cronograma <span class="req">*</span></label>
          <SelectButton v-model="formSchedule" :options="[{ label: 'Preventivo', value: 'PREVENTIVO' }, { label: 'Correctivo', value: 'CORRECTIVO' }]" option-label="label" option-value="value" :allow-empty="false" />
          <small>{{ formSchedule === 'CORRECTIVO' ? 'Intervenciones correctivas planificadas (reparaciones, cambios de partes o reemplazos programados).' : 'Mantenimiento preventivo, inspecciones, limpiezas, calibraciones y pruebas.' }}</small>
        </div>
        <div class="field full"><label>Alcance del programa <span class="req">*</span></label>
          <Select :model-value="form.targetType" :options="[{ label: 'Activo individual', value: 'ACTIVO' }, { label: 'Categoría', value: 'CATEGORIA' }, { label: 'Subcategoría', value: 'SUBCATEGORIA' }, { label: 'Agrupación personalizada', value: 'GRUPO' }]" option-label="label" option-value="value" :disabled="!!form.id && !!original" @update:model-value="setTargetType" />
          <small>Recomendado: subcategoría o agrupación, para que el cronograma salga en una fila por grupo. Las categorías y subcategorías incluyen automáticamente sus equipos habilitados.</small>
        </div>
        <div v-if="form.targetType === 'ACTIVO'" class="field full"><label>Activo <span class="req">*</span></label><Select v-model="form.assetId" :options="cat.assets" :option-label="assetLabel" option-value="id" filter placeholder="Seleccione el equipo o sistema" :disabled="!!form.id" /></div>
        <template v-if="form.targetType === 'CATEGORIA' || form.targetType === 'SUBCATEGORIA'">
          <div class="field"><label>Categoría <span class="req">*</span></label><Select v-model="form.categoryId" :options="cat.categories.filter((c) => c.isActive)" :option-label="withCount" option-value="id" filter placeholder="Seleccione una categoría" /></div>
          <div v-if="form.targetType === 'SUBCATEGORIA'" class="field"><label>Subcategoría <span class="req">*</span></label><Select v-model="form.subcategoryId" :options="cat.categories.find((c) => c.id === form.categoryId)?.subcategories.filter((s) => s.isActive) ?? []" :option-label="withCount" option-value="id" filter placeholder="Seleccione una subcategoría" /></div>
          <Message v-if="selectedTargetCount === 0" severity="warn" :closable="false" class="field full">Esta agrupación aún no tiene equipos: el programa se guarda, pero no generará actividades hasta que se registren equipos en ella.</Message>
        </template>
        <div v-if="form.targetType === 'GRUPO'" class="field full"><label>Agrupación personalizada <span class="req">*</span></label><Select v-model="form.groupId" :options="groups.filter((g) => g.isActive)" option-label="name" option-value="id" filter placeholder="Seleccione una agrupación" /><small>Edite los miembros del grupo para incorporar o retirar equipos.</small></div>
        <div v-if="form.targetType !== 'ACTIVO'" class="field full"><label>Presentación en el cronograma</label><Select v-model="form.displayMode" :options="[{ label: 'Una fila agrupada con desglose por equipo', value: 'AGRUPADO' }, { label: 'Una fila por cada equipo', value: 'POR_ACTIVO' }]" option-label="label" option-value="value" /><small>Ambas opciones conservan actividades, órdenes y seguimiento individual por equipo.</small></div>
        <div class="field"><label>Nombre de la actividad <span class="req">*</span></label><InputText v-model="form.name" /></div>
        <div v-if="formSchedule === 'PREVENTIVO'" class="field"><label>Tipo de actividad</label><Select v-model="form.kind" :options="preventiveKinds" option-label="label" option-value="value" /></div>
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
        <template v-if="form.frequencyType === 'SEMANA_DEL_MES'">
          <div class="field full"><label>Meses programados <span class="req">*</span></label><MultiSelect v-model="form.monthsOfYear" :options="monthOptions" option-label="label" option-value="value" display="chip" placeholder="Seleccione uno o varios meses" /></div>
          <div class="field"><label>Semana del mes <span class="req">*</span></label><Select v-model="form.weekOfMonth" :options="weekOptions" option-label="label" option-value="value" /></div>
          <div class="field"><label>Día de la semana <span class="req">*</span></label><Select v-model="form.dayOfWeek" :options="weekdayOptions" option-label="label" option-value="value" /></div>
          <small class="field full">Se calculará la fecha exacta, por ejemplo, el primer lunes de cada mes seleccionado.</small>
        </template>
        <div class="field"><label>Fecha de inicio <span class="req">*</span></label><DatePicker v-model="form.startDate" date-format="dd/mm/yy" show-icon /></div>
        <div v-if="form.frequencyType !== 'SEMANA_DEL_MES'" class="field"><label>Fecha base de programación <span class="req">*</span></label><DatePicker v-model="form.baseDate" date-format="dd/mm/yy" show-icon /><small>Ancla desde la que se calculan las fechas.</small></div>
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
        <Button label="Guardar" icon="pi pi-check" :loading="saving" :disabled="!targetValid || !form.name || !form.startDate || (form.frequencyType !== 'SEMANA_DEL_MES' && !form.baseDate) || (form.frequencyType === 'SEMANA_DEL_MES' && (!form.monthsOfYear.length || !form.weekOfMonth || !form.dayOfWeek)) || form.frequencyJustification.trim().length < 10 || (!!form.id && ruleChanged && form.changeReason.trim().length < 5)" @click="save" />
      </template>
    </Dialog>
    <Dialog v-model:visible="groupVisible" modal :header="groupForm.id ? 'Editar agrupación personalizada' : 'Nueva agrupación personalizada'" :style="{ width: '720px', maxWidth: '96vw' }">
      <div class="form">
        <div class="field full"><label>Nombre <span class="req">*</span></label><InputText v-model="groupForm.name" placeholder="Ej.: Impresoras de oficinas" /></div>
        <div class="field full"><label>Descripción</label><Textarea v-model="groupForm.description" rows="2" /></div>
        <div class="field full"><label>Equipos del grupo <span class="req">*</span></label><MultiSelect v-model="groupForm.assetIds" :options="groupAssetOptions" option-label="label" option-value="id" filter display="chip" placeholder="Seleccione los equipos" /></div>
      </div>
      <template #footer>
        <Button label="Cancelar" text severity="secondary" @click="groupVisible = false" />
        <Button label="Guardar agrupación" icon="pi pi-check" :loading="groupSaving" :disabled="groupForm.name.trim().length < 2 || !groupForm.assetIds.length" @click="saveGroup" />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.kind-tag { font-size: 0.7rem; padding: 0 6px; margin-top: 2px; }
</style>
