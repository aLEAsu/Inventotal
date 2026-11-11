<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { http } from '@/api/http';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { dateToYmd, fmtDate, fmtDateTime, ymdToDate } from '@/utils/format';

const auth = useAuth();
const cat = useCatalog();
const n = useNotify();
const tab = ref(auth.can('catalog.manage') ? 'areas' : auth.can('criticality.configure') ? 'criteria' : 'procedures');
const settings = ref<{ key: string; value: unknown; description: string; updatedAt: string | null }[]>([]);
const criteria = ref<Record<string, any>[]>([]);
const formats = ref<Record<string, any>[]>([]);
const procedures = ref<Record<string, any>[]>([]);

async function load() {
  try {
    await cat.load(true);
    const jobs: Promise<void>[] = [];
    if (auth.can('settings.manage')) jobs.push(http.get('/settings').then((r) => void (settings.value = r.data)));
    if (auth.can('assets.read')) jobs.push(http.get('/criticality/criteria').then((r) => void (criteria.value = r.data)));
    if (auth.can('procedures.read')) {
      jobs.push(http.get('/formats').then((r) => void (formats.value = r.data)));
      jobs.push(http.get('/procedures').then((r) => void (procedures.value = r.data)));
    }
    await Promise.all(jobs);
  } catch (e) {
    n.error(e);
  }
}
onMounted(load);

// ---- Catálogos genéricos
type Kind = 'areas' | 'locations' | 'categories' | 'subcategories';
const dlg = ref({ visible: false, kind: 'areas' as Kind, id: '', f: {} as Record<string, any> });
function openCat(kind: Kind, row?: Record<string, any>) {
  const defaults: Record<Kind, Record<string, any>> = {
    areas: { code: '', name: '', description: '', isActive: true },
    locations: { code: '', name: '', building: '', floor: '', areaId: null, isActive: true },
    categories: { code: '', name: '', description: '', color: '#1d4ed8', isActive: true },
    subcategories: { categoryId: null, name: '', isActive: true },
  };
  const f = { ...defaults[kind] };
  if (row) for (const k of Object.keys(f)) f[k] = row[k] ?? f[k];
  dlg.value = { visible: true, kind, id: row?.id ?? '', f };
}
async function saveCat() {
  const { kind, id, f } = dlg.value;
  if (await n.run(() => (id ? http.patch(`/${kind}/${id}`, f) : http.post(`/${kind}`, f)), 'Registro guardado')) {
    dlg.value.visible = false;
    await load();
  }
}
const subs = computed(() => cat.categories.flatMap((c) => c.subcategories.map((s) => ({ ...s, categoryName: c.name }))));

// ---- Parámetros
const editVal = ref<Record<string, string>>({});
function startEdit(key: string, v: unknown) {
  editVal.value[key] = JSON.stringify(v, null, typeof v === 'object' ? 2 : 0);
}
async function saveSetting(key: string) {
  let value: unknown;
  try {
    value = JSON.parse(editVal.value[key]);
  } catch {
    return n.error(new Error('Valor inválido: use formato JSON (texto entre comillas, números sin comillas)'));
  }
  if (await n.run(() => http.put(`/settings/${encodeURIComponent(key)}`, { value }), 'Parámetro actualizado')) {
    delete editVal.value[key];
    await load();
  }
}

// ---- Criterios
const cr = ref({ visible: false, id: '', f: {} as Record<string, any> });
function openCrit(row?: Record<string, any>) {
  cr.value = { visible: true, id: row?.id ?? '', f: row ? { code: row.code, name: row.name, description: row.description ?? '', weight: Number(row.weight), maxScore: row.maxScore, isActive: row.isActive, sortOrder: row.sortOrder, scaleGuide: (row.scaleGuide ?? []).join('\n') } : { code: '', name: '', description: '', weight: 10, maxScore: 5, isActive: true, sortOrder: 10, scaleGuide: '' } };
}
async function saveCrit() {
  const f = { ...cr.value.f, scaleGuide: String(cr.value.f.scaleGuide).split('\n').map((s) => s.trim()).filter(Boolean) };
  if (await n.run(() => (cr.value.id ? http.put(`/criticality/criteria/${cr.value.id}`, f) : http.post('/criticality/criteria', f)), 'Criterio guardado')) {
    cr.value.visible = false;
    await load();
  }
}
const weightSum = computed(() => criteria.value.filter((c) => c.isActive).reduce((s, c) => s + Number(c.weight), 0));

// ---- Formatos
const fm = ref({ visible: false, code: '', f: {} as Record<string, any> });
function openFmt(row: Record<string, any>) {
  fm.value = { visible: true, code: row.code, f: { name: row.name, documentCode: row.documentCode, version: row.version, effectiveDate: ymdToDate(row.effectiveDate), elaboratedBy: row.elaboratedBy ?? '', reviewedBy: row.reviewedBy ?? '', approvedBy: row.approvedBy ?? '', changeDescription: '' } };
}
async function saveFmt() {
  if (await n.run(() => http.patch(`/formats/${fm.value.code}`, { ...fm.value.f, effectiveDate: dateToYmd(fm.value.f.effectiveDate) }), 'Formato actualizado')) {
    fm.value.visible = false;
    await load();
  }
}
// ---- Procedimientos
const pr = ref({ visible: false, id: '', f: {} as Record<string, any>, view: false });
function openProc(row: Record<string, any>, view = false) {
  pr.value = { visible: true, id: row.id, view, f: { title: row.title, objective: row.objective, scope: row.scope ?? '', responsible: row.responsible ?? '', content: row.content, isActive: row.isActive, pendingValidation: row.pendingValidation, changeReason: '' } };
}
async function saveProc() {
  if (await n.run(() => http.patch(`/procedures/${pr.value.id}`, pr.value.f), 'Procedimiento actualizado')) {
    pr.value.visible = false;
    await load();
  }
}
const titles: Record<Kind, string> = { areas: 'Área', locations: 'Ubicación', categories: 'Categoría', subcategories: 'Subcategoría' };
</script>

<template>
  <div class="page">
    <div class="page-head"><div><h1>Configuración</h1><div class="sub">Catálogos, matriz de criticidad, parámetros, formatos documentales y procedimientos operativos.</div></div></div>
    <div class="card">
      <Tabs v-model:value="tab">
        <TabList>
          <Tab v-if="auth.can('catalog.manage')" value="areas">Áreas y ubicaciones</Tab>
          <Tab v-if="auth.can('catalog.manage')" value="categories">Categorías</Tab>
          <Tab v-if="auth.can('assets.read')" value="criteria">Matriz de criticidad</Tab>
          <Tab v-if="auth.can('settings.manage')" value="params">Parámetros e identidad</Tab>
          <Tab v-if="auth.can('procedures.read')" value="formats">Formatos documentales</Tab>
          <Tab v-if="auth.can('procedures.read')" value="procedures">Procedimientos</Tab>
        </TabList>
        <TabPanels>
          <TabPanel value="areas">
            <div class="grid g2">
              <div>
                <div class="card-title"><h3>Áreas</h3><Button label="Nueva" icon="pi pi-plus" size="small" text @click="openCat('areas')" /></div>
                <DataTable :value="cat.areas" size="small" row-hover class="clickable" @row-click="(e) => openCat('areas', e.data)">
                  <Column field="code" header="Código" /><Column field="name" header="Nombre" />
                  <Column header="Activa"><template #body="{ data }">{{ data.isActive ? 'Sí' : 'No' }}</template></Column>
                </DataTable>
              </div>
              <div>
                <div class="card-title"><h3>Ubicaciones</h3><Button label="Nueva" icon="pi pi-plus" size="small" text @click="openCat('locations')" /></div>
                <DataTable :value="cat.locations" size="small" row-hover class="clickable" @row-click="(e) => openCat('locations', e.data)">
                  <Column field="code" header="Código" /><Column field="name" header="Nombre" />
                  <Column header="Área"><template #body="{ data }">{{ cat.areas.find((a) => a.id === data.areaId)?.name ?? '—' }}</template></Column>
                  <Column header="Piso"><template #body="{ data }">{{ data.floor ?? '' }}</template></Column>
                </DataTable>
              </div>
            </div>
          </TabPanel>
          <TabPanel value="categories">
            <Message severity="info" :closable="false" class="mb">El sistema está enfocado en equipos de cómputo, sistemas e infraestructura (climatización). Puede agregar categorías dentro de ese alcance.</Message>
            <div class="grid g2">
              <div>
                <div class="card-title"><h3>Categorías</h3><Button label="Nueva" icon="pi pi-plus" size="small" text @click="openCat('categories')" /></div>
                <DataTable :value="cat.categories" size="small" row-hover class="clickable" @row-click="(e) => openCat('categories', e.data)">
                  <Column field="code" header="Código" />
                  <Column header="Nombre"><template #body="{ data }"><span class="dot" :style="{ background: data.color ?? '#999' }" />{{ data.name }}</template></Column>
                  <Column header="Activa"><template #body="{ data }">{{ data.isActive ? 'Sí' : 'No' }}</template></Column>
                </DataTable>
              </div>
              <div>
                <div class="card-title"><h3>Subcategorías</h3><Button label="Nueva" icon="pi pi-plus" size="small" text @click="openCat('subcategories')" /></div>
                <DataTable :value="subs" size="small" row-hover class="clickable" paginator :rows="15" @row-click="(e) => openCat('subcategories', e.data)">
                  <Column field="categoryName" header="Categoría" /><Column field="name" header="Subcategoría" />
                </DataTable>
              </div>
            </div>
          </TabPanel>
          <TabPanel value="criteria">
            <div class="card-title">
              <div><h3>Criterios y ponderaciones</h3><span class="muted">Suma de pesos activos: <strong :style="{ color: weightSum === 100 ? '#15803d' : '#b45309' }">{{ weightSum }}</strong> (se normaliza al calcular)</span></div>
              <Button v-if="auth.can('criticality.configure')" label="Nuevo criterio" icon="pi pi-plus" size="small" @click="openCrit()" />
            </div>
            <Message severity="warn" :closable="false" class="mb">La criticidad se usa para priorizar. No asigna frecuencias de mantenimiento: estas se sustentan en el fabricante, condiciones de uso e historial.</Message>
            <DataTable :value="criteria" size="small" row-hover :class="{ clickable: auth.can('criticality.configure') }" @row-click="(e) => auth.can('criticality.configure') && openCrit(e.data)">
              <Column field="sortOrder" header="#" style="width: 50px" />
              <Column field="name" header="Criterio" />
              <Column field="weight" header="Peso" />
              <Column field="maxScore" header="Escala" />
              <Column header="Guía"><template #body="{ data }"><span class="muted">{{ (data.scaleGuide ?? []).join(' · ') }}</span></template></Column>
              <Column header="Activo"><template #body="{ data }">{{ data.isActive ? 'Sí' : 'No' }}</template></Column>
            </DataTable>
          </TabPanel>
          <TabPanel value="params">
            <Message severity="info" :closable="false" class="mb">Los valores por defecto son puntos de partida operativos y deben validarse institucionalmente. Formato JSON: texto entre comillas ("Clínica X"), números sin comillas.</Message>
            <DataTable :value="settings" size="small">
              <Column header="Parámetro"><template #body="{ data }"><strong>{{ data.description }}</strong><div class="muted mono">{{ data.key }}</div></template></Column>
              <Column header="Valor"><template #body="{ data }">
                <template v-if="editVal[data.key] !== undefined"><Textarea v-model="editVal[data.key]" rows="2" auto-resize style="width: 100%; font-family: monospace" /></template>
                <span v-else class="mono pre">{{ JSON.stringify(data.value) }}</span>
              </template></Column>
              <Column header="Actualizado"><template #body="{ data }">{{ fmtDateTime(data.updatedAt) }}</template></Column>
              <Column style="width: 130px"><template #body="{ data }">
                <template v-if="editVal[data.key] !== undefined"><Button icon="pi pi-check" text aria-label="Guardar" @click="saveSetting(data.key)" /><Button icon="pi pi-times" text severity="secondary" aria-label="Cancelar" @click="delete editVal[data.key]" /></template>
                <Button v-else icon="pi pi-pencil" text aria-label="Editar" @click="startEdit(data.key, data.value)" />
              </template></Column>
            </DataTable>
          </TabPanel>
          <TabPanel value="formats">
            <DataTable :value="formats" size="small" row-hover :class="{ clickable: auth.can('procedures.manage') }" @row-click="(e) => auth.can('procedures.manage') && openFmt(e.data)">
              <Column field="code" header="Formato" /><Column field="name" header="Nombre" /><Column field="documentCode" header="Código documental" /><Column field="version" header="Versión" />
              <Column header="Vigencia"><template #body="{ data }">{{ fmtDate(data.effectiveDate) }}</template></Column>
              <Column header="Elaboró / Revisó / Aprobó"><template #body="{ data }">{{ [data.elaboratedBy, data.reviewedBy, data.approvedBy].map((x) => x || '—').join(' / ') }}</template></Column>
              <Column header="Cambios"><template #body="{ data }">{{ data.changeLog.length }}</template></Column>
            </DataTable>
          </TabPanel>
          <TabPanel value="procedures">
            <DataTable :value="procedures" size="small" row-hover class="clickable" @row-click="(e) => openProc(e.data, !auth.can('procedures.manage'))">
              <Column field="code" header="Código" /><Column field="title" header="Procedimiento" /><Column field="responsible" header="Responsable" /><Column field="version" header="Versión" />
              <Column header="Estado"><template #body="{ data }"><Tag v-if="data.pendingValidation" value="Plantilla pendiente de validación" severity="warn" /><Tag v-else value="Validado" severity="success" /></template></Column>
            </DataTable>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>

    <Dialog v-model:visible="dlg.visible" modal :header="`${dlg.id ? 'Editar' : 'Nueva'} ${titles[dlg.kind].toLowerCase()}`" :style="{ width: '520px', maxWidth: '95vw' }">
      <div class="form">
        <div v-if="dlg.kind !== 'subcategories'" class="field"><label>Código <span class="req">*</span></label><InputText v-model="dlg.f.code" /></div>
        <div v-if="dlg.kind === 'subcategories'" class="field"><label>Categoría <span class="req">*</span></label><Select v-model="dlg.f.categoryId" :options="cat.categories" option-label="name" option-value="id" :disabled="!!dlg.id" /></div>
        <div class="field"><label>Nombre <span class="req">*</span></label><InputText v-model="dlg.f.name" /></div>
        <div v-if="dlg.kind === 'locations'" class="field"><label>Área</label><Select v-model="dlg.f.areaId" :options="cat.areas" option-label="name" option-value="id" show-clear /></div>
        <div v-if="dlg.kind === 'locations'" class="field"><label>Edificio / sede</label><InputText v-model="dlg.f.building" /></div>
        <div v-if="dlg.kind === 'locations'" class="field"><label>Piso</label><InputText v-model="dlg.f.floor" /></div>
        <div v-if="dlg.kind === 'categories'" class="field"><label>Color</label><input v-model="dlg.f.color" type="color" /></div>
        <div v-if="dlg.kind === 'areas' || dlg.kind === 'categories'" class="field full"><label>Descripción</label><Textarea v-model="dlg.f.description" rows="2" /></div>
        <div class="field"><label class="row"><ToggleSwitch v-model="dlg.f.isActive" /> Activo</label></div>
      </div>
      <template #footer><Button label="Cancelar" text severity="secondary" @click="dlg.visible = false" /><Button label="Guardar" @click="saveCat" /></template>
    </Dialog>
    <Dialog v-model:visible="cr.visible" modal header="Criterio de criticidad" :style="{ width: '600px', maxWidth: '95vw' }">
      <div class="form">
        <div class="field"><label>Código</label><InputText v-model="cr.f.code" :disabled="!!cr.id" /></div>
        <div class="field"><label>Orden</label><InputNumber v-model="cr.f.sortOrder" /></div>
        <div class="field full"><label>Nombre</label><InputText v-model="cr.f.name" /></div>
        <div class="field"><label>Peso (0-100)</label><InputNumber v-model="cr.f.weight" :min="0" :max="100" :max-fraction-digits="2" /></div>
        <div class="field"><label>Escala máxima</label><InputNumber v-model="cr.f.maxScore" :min="2" :max="10" /></div>
        <div class="field full"><label>Guía de la escala (una línea por nivel)</label><Textarea v-model="cr.f.scaleGuide" rows="5" /></div>
        <div class="field full"><label>Descripción</label><Textarea v-model="cr.f.description" rows="2" /></div>
        <div class="field"><label class="row"><ToggleSwitch v-model="cr.f.isActive" /> Activo</label></div>
      </div>
      <template #footer><Button label="Cancelar" text severity="secondary" @click="cr.visible = false" /><Button label="Guardar" @click="saveCrit" /></template>
    </Dialog>
    <Dialog v-model:visible="fm.visible" modal :header="`Formato ${fm.code}`" :style="{ width: '600px', maxWidth: '95vw' }">
      <div class="form">
        <div class="field full"><label>Nombre</label><InputText v-model="fm.f.name" /></div>
        <div class="field"><label>Código documental</label><InputText v-model="fm.f.documentCode" /></div>
        <div class="field"><label>Versión</label><InputText v-model="fm.f.version" /></div>
        <div class="field"><label>Fecha de vigencia</label><DatePicker v-model="fm.f.effectiveDate" date-format="dd/mm/yy" show-icon /></div>
        <div class="field"><label>Elaboró</label><InputText v-model="fm.f.elaboratedBy" /></div>
        <div class="field"><label>Revisó</label><InputText v-model="fm.f.reviewedBy" /></div>
        <div class="field"><label>Aprobó</label><InputText v-model="fm.f.approvedBy" /></div>
        <div class="field full"><label>Descripción del cambio (registro de cambios) <span class="req">*</span></label><Textarea v-model="fm.f.changeDescription" rows="2" /></div>
      </div>
      <template #footer><Button label="Cancelar" text severity="secondary" @click="fm.visible = false" /><Button label="Guardar" :disabled="fm.f.changeDescription?.trim().length < 5" @click="saveFmt" /></template>
    </Dialog>
    <Dialog v-model:visible="pr.visible" modal :header="pr.f.title" :style="{ width: '820px', maxWidth: '96vw' }">
      <template v-if="pr.view">
        <dl class="kv mb"><div><dt>Objetivo</dt><dd>{{ pr.f.objective }}</dd></div><div><dt>Responsable</dt><dd>{{ pr.f.responsible }}</dd></div></dl>
        <div class="pre">{{ pr.f.content }}</div>
      </template>
      <div v-else class="form">
        <div class="field full"><label>Título</label><InputText v-model="pr.f.title" /></div>
        <div class="field full"><label>Objetivo</label><Textarea v-model="pr.f.objective" rows="2" /></div>
        <div class="field"><label>Alcance</label><InputText v-model="pr.f.scope" /></div>
        <div class="field"><label>Responsable</label><InputText v-model="pr.f.responsible" /></div>
        <div class="field full"><label>Contenido / pasos</label><Textarea v-model="pr.f.content" rows="14" style="font-family: inherit" /></div>
        <div class="field"><label class="row"><Checkbox v-model="pr.f.pendingValidation" binary /> Pendiente de validación institucional</label></div>
        <div class="field full"><label>Motivo del cambio <span class="req">*</span></label><InputText v-model="pr.f.changeReason" /></div>
      </div>
      <template #footer><Button label="Cerrar" text severity="secondary" @click="pr.visible = false" /><Button v-if="!pr.view" label="Guardar nueva versión" :disabled="pr.f.changeReason?.trim().length < 5" @click="saveProc" /></template>
    </Dialog>
  </div>
</template>

<style scoped>
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
</style>
