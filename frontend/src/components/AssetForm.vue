<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { http } from '@/api/http';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { dateToYmd, ymdToDate } from '@/utils/format';
import { CRITICALITY, opts } from '@/utils/labels';

/** Formulario de registro / edición de activos (incluye datos técnicos de TI) */
const props = defineProps<{ asset?: Record<string, unknown> | null }>();
const visible = defineModel<boolean>('visible', { required: true });
const emit = defineEmits<{ saved: [id: string] }>();
const cat = useCatalog();
const n = useNotify();
const saving = ref(false);
const errors = ref<Record<string, string>>({});

const empty = () => ({
  code: '', name: '', categoryId: null as string | null, subcategoryId: null as string | null, description: '', brand: '', model: '', serialNumber: '',
  locationId: null as string | null, areaId: null as string | null, acquisitionDate: null as Date | null, installationDate: null as Date | null,
  manufacturer: '', supplierId: null as string | null, warrantyUntil: null as Date | null, warrantyInfo: '', acquisitionCost: null as number | null,
  criticality: 'MEDIA', responsibleId: null as string | null, notes: '',
  hostname: '', ipAddress: '', macAddress: '', operatingSystem: '', softwareVersion: '', processor: '', ramGb: null as number | null,
  storageGb: null as number | null, endUser: '', licenseExpiresAt: null as Date | null,
});
const f = ref(empty());

watch(visible, (v) => {
  if (!v) return;
  errors.value = {};
  const a = props.asset;
  if (!a) {
    f.value = empty();
    return;
  }
  const e = empty() as Record<string, unknown>;
  for (const k of Object.keys(e)) {
    const val = a[k];
    if (['acquisitionDate', 'installationDate', 'warrantyUntil', 'licenseExpiresAt'].includes(k)) e[k] = ymdToDate(val as string | null);
    else if (k === 'acquisitionCost') e[k] = val == null ? null : Number(val);
    else e[k] = val ?? (typeof e[k] === 'string' ? '' : null);
  }
  f.value = e as ReturnType<typeof empty>;
});

const subs = computed(() => cat.categories.find((c) => c.id === f.value.categoryId)?.subcategories.filter((s) => s.isActive) ?? []);
const locs = computed(() => cat.locations.filter((l) => l.isActive && (!f.value.areaId || !l.areaId || l.areaId === f.value.areaId)));
const isSoftware = computed(() => cat.categories.find((c) => c.id === f.value.categoryId)?.code === 'SIS');

async function save() {
  errors.value = {};
  if (!f.value.name.trim()) errors.value.name = 'Ingrese el nombre';
  if (!f.value.categoryId) errors.value.categoryId = 'Seleccione la categoría';
  if (!f.value.areaId) errors.value.areaId = 'Seleccione el área responsable';
  if (Object.keys(errors.value).length) return;
  const body: Record<string, unknown> = {
    ...f.value,
    acquisitionDate: dateToYmd(f.value.acquisitionDate), installationDate: dateToYmd(f.value.installationDate),
    warrantyUntil: dateToYmd(f.value.warrantyUntil), licenseExpiresAt: dateToYmd(f.value.licenseExpiresAt),
  };
  saving.value = true;
  const id = props.asset?.id as string | undefined;
  const r = await n.run(() => (id ? http.patch(`/assets/${id}`, body) : http.post('/assets', body)), id ? 'Activo actualizado' : 'Activo registrado');
  saving.value = false;
  if (r) {
    visible.value = false;
    emit('saved', r.data.id);
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="asset ? `Editar activo ${asset.code}` : 'Registrar activo'" :style="{ width: '900px', maxWidth: '96vw' }">
    <h3 class="mb">Identificación</h3>
    <div class="form cols3">
      <div class="field"><label>Código institucional</label><InputText v-model="f.code" placeholder="Automático si se deja vacío" maxlength="40" /><small>Único. Se genera según la categoría si no se indica.</small></div>
      <div class="field" style="grid-column: span 2"><label>Nombre del activo <span class="req">*</span></label><InputText v-model="f.name" :invalid="!!errors.name" maxlength="200" /><small v-if="errors.name" class="p-error">{{ errors.name }}</small></div>
      <div class="field"><label>Categoría <span class="req">*</span></label><Select v-model="f.categoryId" :options="cat.activeCategories" option-label="name" option-value="id" :invalid="!!errors.categoryId" @change="f.subcategoryId = null" /><small v-if="errors.categoryId" class="p-error">{{ errors.categoryId }}</small></div>
      <div class="field"><label>Subcategoría</label><Select v-model="f.subcategoryId" :options="subs" option-label="name" option-value="id" show-clear /></div>
      <div class="field"><label>Criticidad</label><Select v-model="f.criticality" :options="opts(CRITICALITY)" option-label="label" option-value="value" /><small>Puede evaluarse con la matriz en la hoja de vida.</small></div>
      <div class="field"><label>Marca / fabricante del software</label><InputText v-model="f.brand" /></div>
      <div class="field"><label>Modelo</label><InputText v-model="f.model" /></div>
      <div class="field"><label>Número de serie</label><InputText v-model="f.serialNumber" /></div>
      <div class="field full"><label>Descripción</label><Textarea v-model="f.description" rows="2" auto-resize /></div>
    </div>

    <h3 class="mb mt">Datos técnicos</h3>
    <div class="form cols3">
      <div class="field"><label>Hostname</label><InputText v-model="f.hostname" placeholder="Ej. UCI-ENF-01" /></div>
      <div class="field"><label>Dirección IP</label><InputText v-model="f.ipAddress" placeholder="Ej. 10.0.3.101" /></div>
      <div class="field"><label>Dirección MAC</label><InputText v-model="f.macAddress" placeholder="00:1A:2B:3C:4D:5E" /></div>
      <div class="field"><label>Sistema operativo</label><InputText v-model="f.operatingSystem" /></div>
      <div class="field"><label>Versión de software / firmware</label><InputText v-model="f.softwareVersion" /></div>
      <div v-if="!isSoftware" class="field"><label>Procesador</label><InputText v-model="f.processor" /></div>
      <div v-if="!isSoftware" class="field"><label>Memoria RAM (GB)</label><InputNumber v-model="f.ramGb" :min="0" :use-grouping="false" /></div>
      <div v-if="!isSoftware" class="field"><label>Almacenamiento (GB)</label><InputNumber v-model="f.storageGb" :min="0" /></div>
      <div class="field"><label>Vencimiento de licencia</label><DatePicker v-model="f.licenseExpiresAt" date-format="dd/mm/yy" show-icon show-button-bar /></div>
      <div class="field full"><small>No registre contraseñas, claves de licencia ni información de pacientes.</small></div>
    </div>

    <h3 class="mb mt">Ubicación y responsables</h3>
    <div class="form cols3">
      <div class="field"><label>Área responsable <span class="req">*</span></label><Select v-model="f.areaId" :options="cat.activeAreas" option-label="name" option-value="id" filter :invalid="!!errors.areaId" /><small v-if="errors.areaId" class="p-error">{{ errors.areaId }}</small></div>
      <div class="field"><label>Ubicación</label><Select v-model="f.locationId" :options="locs" option-label="name" option-value="id" filter show-clear /></div>
      <div class="field"><label>Usuario final / puesto</label><InputText v-model="f.endUser" placeholder="Ej. Estación de enfermería UCI" /></div>
      <div class="field"><label>Responsable de mantenimiento</label><Select v-model="f.responsibleId" :options="cat.users" option-label="fullName" option-value="id" filter show-clear /></div>
      <div class="field"><label>Proveedor</label><Select v-model="f.supplierId" :options="cat.suppliers" option-label="name" option-value="id" filter show-clear /></div>
      <div class="field"><label>Fabricante</label><InputText v-model="f.manufacturer" /></div>
    </div>

    <h3 class="mb mt">Adquisición y garantía</h3>
    <div class="form cols3">
      <div class="field"><label>Fecha de adquisición</label><DatePicker v-model="f.acquisitionDate" date-format="dd/mm/yy" show-icon /></div>
      <div class="field"><label>Fecha de instalación</label><DatePicker v-model="f.installationDate" date-format="dd/mm/yy" show-icon /></div>
      <div class="field"><label>Costo de adquisición (COP)</label><InputNumber v-model="f.acquisitionCost" mode="currency" currency="COP" locale="es-CO" :min-fraction-digits="0" /></div>
      <div class="field"><label>Garantía hasta</label><DatePicker v-model="f.warrantyUntil" date-format="dd/mm/yy" show-icon show-button-bar /></div>
      <div class="field" style="grid-column: span 2"><label>Información de garantía</label><InputText v-model="f.warrantyInfo" /></div>
      <div class="field full"><label>Observaciones</label><Textarea v-model="f.notes" rows="2" auto-resize /></div>
    </div>
    <template #footer>
      <Button label="Cancelar" text severity="secondary" @click="visible = false" />
      <Button label="Guardar" icon="pi pi-check" :loading="saving" @click="save" />
    </template>
  </Dialog>
</template>
