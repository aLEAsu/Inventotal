<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { http } from '@/api/http';
import { useNotify } from '@/utils/notify';
import { fmtDateTime } from '@/utils/format';
import { DOC_TYPE, opts } from '@/utils/labels';

/** Repositorio documental: consulta de todos los soportes con su vínculo (activo, orden, falla, proveedor, contrato, plan) */
const n = useNotify();
const items = ref<Record<string, any>[]>([]);
const total = ref(0);
const loading = ref(false);
const page = ref({ first: 0, rows: 25 });
const f = ref({ q: '', type: null as string | null, includeVoided: false });

async function load() {
  loading.value = true;
  try {
    const r = await http.get('/documents', { params: { q: f.value.q || undefined, type: f.value.type || undefined, includeVoided: f.value.includeVoided ? 'true' : undefined, page: page.value.first / page.value.rows + 1, pageSize: page.value.rows } });
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
onMounted(load);
async function open(id: string) {
  try {
    const r = await http.get(`/documents/${id}/download`, { responseType: 'blob' });
    const url = URL.createObjectURL(r.data as Blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    n.error(e);
  }
}
const link = (d: Record<string, any>) =>
  d.asset ? { to: `/activos/${d.asset.id}`, t: `Activo ${d.asset.code}` } : d.workOrder ? { to: `/ordenes/${d.workOrder.id}`, t: `Orden ${d.workOrder.code}` } : d.failureReport ? { to: `/correctivos/${d.failureReport.id}`, t: `Falla ${d.failureReport.code}` }
    : d.supplier ? { to: `/proveedores/${d.supplier.id}`, t: `Proveedor ${d.supplier.name}` } : d.contract ? { to: '/proveedores', t: `Contrato ${d.contract.number}` } : d.plan ? { to: `/cronograma?year=${d.plan.year}`, t: `Plan ${d.plan.year}` } : null;
</script>

<template>
  <div class="page">
    <div class="page-head"><div><h1>Documentos y evidencias</h1><div class="sub">Almacenamiento privado con acceso controlado. Los documentos no se eliminan: se anulan conservando el archivo. Para adjuntar, ingrese al activo, orden, falla o proveedor correspondiente.</div></div></div>
    <div class="card">
      <div class="filters">
        <IconField style="min-width: 260px"><InputIcon class="pi pi-search" /><InputText v-model="f.q" placeholder="Título o nombre de archivo" style="width: 100%" /></IconField>
        <Select v-model="f.type" :options="opts(DOC_TYPE)" option-label="label" option-value="value" placeholder="Tipo documental" show-clear />
        <label class="row" style="min-width: auto"><Checkbox v-model="f.includeVoided" binary /> Incluir anulados</label>
      </div>
      <DataTable :value="items" :loading="loading" lazy paginator :rows="page.rows" :first="page.first" :total-records="total" size="small" @page="(e) => { page = { first: e.first, rows: e.rows }; load(); }">
        <template #empty><div class="empty">No hay documentos.</div></template>
        <Column header="Tipo"><template #body="{ data }">{{ DOC_TYPE[data.type] }}</template></Column>
        <Column header="Documento"><template #body="{ data }"><a href="#" @click.prevent="open(data.id)">{{ data.title }}</a><div class="muted">{{ data.originalName }}</div><Tag v-if="data.voidedAt" value="Anulado" severity="secondary" v-tooltip="data.voidReason" /></template></Column>
        <Column header="Asociado a"><template #body="{ data }"><RouterLink v-if="link(data)" :to="link(data)!.to">{{ link(data)!.t }}</RouterLink></template></Column>
        <Column header="Cargado"><template #body="{ data }"><span class="nowrap">{{ fmtDateTime(data.uploadedAt) }}</span><div class="muted">{{ data.uploadedBy }}</div></template></Column>
        <Column header="Integridad (SHA-256)"><template #body="{ data }"><span class="mono muted" :title="data.sha256">{{ data.sha256.slice(0, 12) }}…</span></template></Column>
      </DataTable>
    </div>
  </div>
</template>
