<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { http } from '@/api/http';
import StatusTag from '@/components/StatusTag.vue';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { fmtDate, MONTHS } from '@/utils/format';

/** Gestión preventiva: actividades del cronograma pendientes de ejecutar y conversión en órdenes de trabajo */
const auth = useAuth();
const cat = useCatalog();
const n = useNotify();
const router = useRouter();
const view = ref<'VENCIDO' | 'PROXIMO' | 'MES' | 'EN_EJECUCION'>('VENCIDO');
const month = ref(new Date().getMonth() + 1);
const items = ref<Record<string, any>[]>([]);
const loading = ref(false);
const noPlan = ref(false);

async function load() {
  if (!auth.can('plans.read')) return;
  loading.value = true;
  noPlan.value = false;
  try {
    const params: Record<string, unknown> = { pageSize: 500 };
    if (view.value === 'MES') params.month = month.value;
    else params.status = view.value;
    items.value = (await http.get(`/plans/${cat.year}/activities`, { params })).data.items;
  } catch (e: unknown) {
    if ((e as { response?: { status: number } }).response?.status === 404) noPlan.value = true;
    else n.error(e);
    items.value = [];
  } finally {
    loading.value = false;
  }
}
watch([view, month], load);
onMounted(async () => {
  await cat.load();
  await load();
});
async function createWo(id: string) {
  const r = await n.run(() => http.post(`/workorders/from-activity/${id}`, {}), 'Orden preventiva creada');
  if (r) await router.push(`/ordenes/${r.data.id}`);
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Mantenimientos preventivos</h1><div class="sub">Actividades del cronograma {{ cat.year }}. Generar una orden NO marca la actividad como ejecutada: se marca al cerrar la orden validada.</div></div>
      <div class="actions"><Button label="Órdenes preventivas" icon="pi pi-list" severity="secondary" outlined @click="router.push({ path: '/ordenes', query: { type: 'PREVENTIVA' } })" /></div>
    </div>
    <div class="card">
      <div class="filters">
        <SelectButton v-model="view" :options="[{ l: 'Vencidas', v: 'VENCIDO' }, { l: 'Próximas', v: 'PROXIMO' }, { l: 'En ejecución', v: 'EN_EJECUCION' }, { l: 'Por mes', v: 'MES' }]" option-label="l" option-value="v" :allow-empty="false" />
        <Select v-if="view === 'MES'" v-model="month" :options="MONTHS.map((l, i) => ({ l, v: i + 1 }))" option-label="l" option-value="v" />
      </div>
      <Message v-if="!auth.can('plans.read')" severity="info" :closable="false">Consulte sus órdenes asignadas en Órdenes de trabajo.</Message>
      <Message v-else-if="noPlan" severity="warn" :closable="false">No existe plan anual para {{ cat.year }}. <RouterLink to="/cronograma">Ir al cronograma</RouterLink></Message>
      <DataTable v-else :value="items" :loading="loading" size="small" paginator :rows="25">
        <template #empty><div class="empty">No hay actividades en esta vista.</div></template>
        <Column header="Fecha"><template #body="{ data }"><span class="nowrap">{{ fmtDate(data.committedDate) }}</span><div v-if="data.rescheduled" class="muted">orig. {{ fmtDate(data.originalDate) }}</div></template></Column>
        <Column header="Activo"><template #body="{ data }"><RouterLink :to="`/activos/${data.asset.id}`" class="mono">{{ data.asset.code }}</RouterLink> {{ data.asset.name }}<div class="muted">{{ data.asset.area.name }}</div></template></Column>
        <Column header="Mantenimiento"><template #body="{ data }">{{ data.program.name }}</template></Column>
        <Column header="Criticidad"><template #body="{ data }"><StatusTag :value="data.asset.criticality" kind="crit" /></template></Column>
        <Column header="Responsable"><template #body="{ data }">{{ data.responsible?.fullName ?? '—' }}</template></Column>
        <Column header="Estado"><template #body="{ data }"><StatusTag :value="data.displayStatus" kind="activity" /></template></Column>
        <Column header="Orden" style="width: 180px"><template #body="{ data }">
          <RouterLink v-if="data.workOrder" :to="`/ordenes/${data.workOrder.id}`">{{ data.workOrder.code }}</RouterLink>
          <Button v-else-if="auth.can('workorders.create')" label="Generar OT" icon="pi pi-wrench" size="small" text @click="createWo(data.id)" />
        </template></Column>
      </DataTable>
    </div>
  </div>
</template>
