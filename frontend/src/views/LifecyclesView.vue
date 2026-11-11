<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { download, http } from '@/api/http';
import StatusTag from '@/components/StatusTag.vue';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { fmtDate } from '@/utils/format';

const cat = useCatalog();
const n = useNotify();
const router = useRouter();
const q = ref('');
const categoryId = ref<string | null>(null);
const items = ref<Record<string, any>[]>([]);
const loading = ref(false);
async function load() {
  loading.value = true;
  try {
    items.value = (await http.get('/assets', { params: { q: q.value || undefined, categoryId: categoryId.value || undefined, includeInactive: 'true', pageSize: 200 } })).data.items;
  } catch (e) {
    n.error(e);
  } finally {
    loading.value = false;
  }
}
let t: ReturnType<typeof setTimeout>;
watch([q, categoryId], () => {
  clearTimeout(t);
  t = setTimeout(load, 300);
});
onMounted(load);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Hojas de vida de activos</h1><div class="sub">Historial acumulativo de cada equipo o sistema: intervenciones, fallas, repuestos, costos y soportes.</div></div>
    </div>
    <div class="card">
      <div class="filters">
        <IconField style="min-width: 280px"><InputIcon class="pi pi-search" /><InputText v-model="q" placeholder="Buscar activo (código, nombre, serie, hostname)" style="width: 100%" /></IconField>
        <Select v-model="categoryId" :options="cat.categories" option-label="name" option-value="id" placeholder="Categoría" show-clear />
      </div>
      <DataTable :value="items" :loading="loading" size="small" paginator :rows="25" row-hover class="clickable" @row-click="(e) => router.push(`/activos/${e.data.id}`)">
        <Column header="Código"><template #body="{ data }"><span class="mono">{{ data.code }}</span></template></Column>
        <Column field="name" header="Activo" />
        <Column header="Categoría"><template #body="{ data }">{{ data.category.name }}</template></Column>
        <Column header="Área"><template #body="{ data }">{{ data.area.name }}</template></Column>
        <Column header="Estado"><template #body="{ data }"><StatusTag :value="data.status" kind="asset" /></template></Column>
        <Column header="Próximo"><template #body="{ data }">{{ fmtDate(data.nextMaintenanceDate) }}</template></Column>
        <Column style="width: 120px"><template #body="{ data }"><Button label="PDF" icon="pi pi-file-pdf" size="small" text @click.stop="n.run(() => download(`/assets/${data.id}/lifecycle/pdf`), 'Hoja de vida generada')" /></template></Column>
      </DataTable>
    </div>
  </div>
</template>
