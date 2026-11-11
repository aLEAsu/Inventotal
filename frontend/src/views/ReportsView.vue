<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { download, http } from '@/api/http';
import IndicatorFilters, { type IndFilters } from '@/components/IndicatorFilters.vue';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { fmtDate } from '@/utils/format';

/** Formatos institucionales F-01 a F-12 e informes de indicadores */
const auth = useAuth();
const cat = useCatalog();
const n = useNotify();
const router = useRouter();
const f = ref<IndFilters>({ year: cat.year, month: new Date().getMonth() + 1, areaId: null, categoryId: null, responsibleId: null });
const recurring = ref<Record<string, any> | null>(null);
const formats = ref<Record<string, any>[]>([]);

onMounted(async () => {
  f.value.year = cat.year;
  try {
    if (auth.can('failures.read_all')) recurring.value = (await http.get('/failures/recurring')).data;
    if (auth.can('procedures.read')) formats.value = (await http.get('/formats')).data;
  } catch (e) {
    n.error(e);
  }
});
const p = () => Object.fromEntries(Object.entries(f.value).filter(([, v]) => v !== null));
const get = (url: string, params: Record<string, unknown> = {}) => n.run(() => download(url, params), 'Informe generado');
const fmt = (code: string) => formats.value.find((x) => x.code === code);

const list = [
  { code: 'F-01', desc: 'Inventario general de activos (PDF y Excel).', run: () => get('/reports/inventory.pdf'), alt: () => get('/reports/inventory.xlsx') },
  { code: 'F-02', desc: 'Plan maestro anual: imprimir, PDF o Excel desde el cronograma.', go: '/cronograma' },
  { code: 'F-03', desc: 'Orden de trabajo: se descarga desde cada orden.', go: '/ordenes' },
  { code: 'F-04', desc: 'Registro de mantenimiento preventivo: desde la orden preventiva.', go: '/ordenes?type=PREVENTIVA' },
  { code: 'F-05', desc: 'Registro de mantenimiento correctivo: desde la orden correctiva.', go: '/ordenes?type=CORRECTIVA' },
  { code: 'F-06', desc: 'Hoja de vida del activo: desde cada activo.', go: '/hojas-de-vida' },
  { code: 'F-07', desc: 'Solicitud de mantenimiento: desde cada reporte de falla.', go: '/correctivos' },
  { code: 'F-08', desc: 'Registro de inspección técnica: desde cada actividad del cronograma.', go: '/cronograma' },
  { code: 'F-09', desc: 'Informe mensual de mantenimiento (año y mes seleccionados).', run: () => get('/reports/monthly.pdf', p()) },
  { code: 'F-10', desc: 'Informe de cumplimiento del plan anual (año seleccionado).', run: () => get('/reports/compliance.pdf', { ...p(), month: undefined }) },
  { code: 'F-11', desc: 'Evaluación de proveedores: desde cada proveedor.', go: '/proveedores' },
  { code: 'F-12', desc: 'Registro de fallas recurrentes.', run: () => get('/reports/recurring-failures.pdf') },
];
</script>

<template>
  <div class="page">
    <div class="page-head"><div><h1>Informes e indicadores</h1><div class="sub">Formatos institucionales generados a partir de la información registrada. Código, versión y responsables se configuran en Configuración › Formatos.</div></div></div>
    <div class="card mb">
      <h3 class="mb">Parámetros de los informes F-09 y F-10</h3>
      <IndicatorFilters v-model="f" />
    </div>
    <div class="grid g3">
      <div v-for="r in list" :key="r.code" class="card">
        <div class="row"><Tag :value="r.code" /><strong>{{ fmt(r.code)?.name ?? '' }}</strong></div>
        <p class="muted">{{ r.desc }}</p>
        <div v-if="fmt(r.code)" class="muted" style="font-size: 0.78rem">{{ fmt(r.code)!.documentCode }} · v{{ fmt(r.code)!.version }} · vigente desde {{ fmtDate(fmt(r.code)!.effectiveDate) }}</div>
        <div class="actions mt">
          <Button v-if="r.run" label="Generar PDF" icon="pi pi-file-pdf" size="small" :data-testid="`rep-${r.code}`" @click="r.run" />
          <Button v-if="r.alt" label="Excel" icon="pi pi-file-excel" size="small" severity="secondary" outlined @click="r.alt" />
          <Button v-if="r.go" label="Ir" icon="pi pi-arrow-right" size="small" severity="secondary" outlined @click="router.push(r.go)" />
        </div>
      </div>
    </div>
    <div v-if="recurring" class="card mt">
      <h2 class="mb">Fallas recurrentes</h2>
      <p class="muted">Criterio configurable: {{ recurring.rule.count }} o más fallas del mismo activo en {{ recurring.rule.days }} días.</p>
      <DataTable :value="recurring.items" size="small">
        <template #empty><div class="empty">No hay activos con fallas recurrentes según el criterio.</div></template>
        <Column header="Activo"><template #body="{ data }"><RouterLink :to="`/activos/${data.asset.id}`">{{ data.asset.code }}</RouterLink> {{ data.asset.name }}</template></Column>
        <Column header="Área"><template #body="{ data }">{{ data.asset.area.name }}</template></Column>
        <Column field="count" header="Fallas" />
        <Column header="Reportes"><template #body="{ data }"><RouterLink v-for="x in data.failures" :key="x.id" :to="`/correctivos/${x.id}`" style="margin-right: 6px">{{ x.code }}</RouterLink></template></Column>
      </DataTable>
    </div>
  </div>
</template>
