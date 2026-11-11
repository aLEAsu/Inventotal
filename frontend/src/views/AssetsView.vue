<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { download, http } from '@/api/http';
import AssetForm from '@/components/AssetForm.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { fmtDate } from '@/utils/format';
import { ASSET_STATUS, CRITICALITY, opts } from '@/utils/labels';

const auth = useAuth();
const cat = useCatalog();
const n = useNotify();
const router = useRouter();
const items = ref<Record<string, any>[]>([]);
const total = ref(0);
const loading = ref(false);
const page = ref({ first: 0, rows: 25 });
const f = ref({ q: '', categoryId: null as string | null, areaId: null as string | null, locationId: null as string | null, criticality: null as string | null, status: null as string | null, includeInactive: false });
const showForm = ref(false);

async function load() {
  loading.value = true;
  try {
    const params = { ...Object.fromEntries(Object.entries(f.value).filter(([, v]) => v !== null && v !== '' && v !== false)), page: page.value.first / page.value.rows + 1, pageSize: page.value.rows };
    const r = await http.get('/assets', { params });
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
  }, 300);
}, { deep: true });
onMounted(load);
const onPage = (e: { first: number; rows: number }) => {
  page.value = { first: e.first, rows: e.rows };
  void load();
};
const exp = (fmt: 'pdf' | 'xlsx') => n.run(() => download(`/reports/inventory.${fmt}`, fmt === 'pdf' ? { categoryId: f.value.categoryId, areaId: f.value.areaId, status: f.value.status } : {}), 'Archivo generado');
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Inventario de activos</h1>
        <div class="sub">Equipos de cómputo, servidores, redes, periféricos, telefonía, UPS y sistemas de información · {{ total }} registros</div>
      </div>
      <div class="actions">
        <Button v-if="auth.can('reports.read')" label="F-01 PDF" icon="pi pi-file-pdf" severity="secondary" outlined @click="exp('pdf')" />
        <Button v-if="auth.can('reports.read')" label="Excel" icon="pi pi-file-excel" severity="secondary" outlined @click="exp('xlsx')" />
        <Button v-if="auth.can('assets.write')" label="Registrar activo" icon="pi pi-plus" @click="showForm = true" />
      </div>
    </div>
    <div class="card">
      <div class="filters">
        <IconField style="min-width: 260px"><InputIcon class="pi pi-search" /><InputText v-model="f.q" placeholder="Código, nombre, serie, hostname, IP, usuario…" style="width: 100%" /></IconField>
        <Select v-model="f.categoryId" :options="cat.categories" option-label="name" option-value="id" placeholder="Categoría" show-clear />
        <Select v-model="f.areaId" :options="cat.areas" option-label="name" option-value="id" placeholder="Área" show-clear filter />
        <Select v-model="f.locationId" :options="cat.locations" option-label="name" option-value="id" placeholder="Ubicación" show-clear filter />
        <Select v-model="f.criticality" :options="opts(CRITICALITY)" option-label="label" option-value="value" placeholder="Criticidad" show-clear />
        <Select v-model="f.status" :options="opts(ASSET_STATUS)" option-label="label" option-value="value" placeholder="Estado" show-clear />
        <label class="row" style="min-width: auto"><Checkbox v-model="f.includeInactive" binary input-id="inact" /><span>Incluir retirados y de baja</span></label>
      </div>
      <DataTable :value="items" :loading="loading" lazy paginator :rows="page.rows" :first="page.first" :total-records="total" :rows-per-page-options="[25, 50, 100]" data-key="id" row-hover class="clickable" scrollable @page="onPage" @row-click="(e) => router.push(`/activos/${e.data.id}`)">
        <template #empty><div class="empty">No hay activos que coincidan con los filtros.</div></template>
        <Column header="Código"><template #body="{ data }"><span class="mono nowrap">{{ data.code }}</span></template></Column>
        <Column header="Activo"><template #body="{ data }"><strong>{{ data.name }}</strong><div class="muted">{{ [data.brand, data.model].filter(Boolean).join(' · ') }}<template v-if="data.serialNumber"> · S/N {{ data.serialNumber }}</template></div></template></Column>
        <Column header="Red"><template #body="{ data }"><div class="mono">{{ data.hostname ?? '' }}</div><div class="mono muted">{{ data.ipAddress ?? '' }}</div></template></Column>
        <Column header="Categoría"><template #body="{ data }">{{ data.category.name }}</template></Column>
        <Column header="Área / ubicación"><template #body="{ data }">{{ data.area.name }}<div class="muted">{{ data.location?.name }}{{ data.endUser ? ` · ${data.endUser}` : '' }}</div></template></Column>
        <Column header="Criticidad"><template #body="{ data }"><StatusTag :value="data.criticality" kind="crit" /></template></Column>
        <Column header="Estado"><template #body="{ data }"><StatusTag :value="data.status" kind="asset" /></template></Column>
        <Column header="Próximo mantenimiento"><template #body="{ data }"><span class="nowrap">{{ fmtDate(data.nextMaintenanceDate) }}</span></template></Column>
      </DataTable>
    </div>
    <AssetForm v-model:visible="showForm" @saved="(id) => router.push(`/activos/${id}`)" />
  </div>
</template>
