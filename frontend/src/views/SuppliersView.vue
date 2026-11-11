<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { http } from '@/api/http';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { fmtDate } from '@/utils/format';

const auth = useAuth();
const cat = useCatalog();
const n = useNotify();
const router = useRouter();
const items = ref<Record<string, any>[]>([]);
const loading = ref(false);
const q = ref('');
const alerts = ref<Record<string, any> | null>(null);

async function load() {
  loading.value = true;
  try {
    items.value = (await http.get('/suppliers', { params: { q: q.value || undefined, pageSize: 500 } })).data.items;
    alerts.value = (await http.get('/alerts/expirations')).data;
  } catch (e) {
    n.error(e);
  } finally {
    loading.value = false;
  }
}
let t: ReturnType<typeof setTimeout>;
watch(q, () => {
  clearTimeout(t);
  t = setTimeout(load, 300);
});
onMounted(load);

const show = ref(false);
const form = ref({ name: '', nit: '', type: 'EXTERNO', contactName: '', email: '', phone: '', specialty: '', services: '', address: '' });
async function create() {
  const r = await n.run(() => http.post('/suppliers', form.value), 'Proveedor registrado');
  if (r) {
    show.value = false;
    await cat.load(true);
    await router.push(`/proveedores/${r.data.id}`);
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Proveedores y contratos</h1><div class="sub">Proveedores internos y externos, contratos, garantías y licencias.</div></div>
      <div class="actions"><Button v-if="auth.can('suppliers.write')" label="Nuevo proveedor" icon="pi pi-plus" @click="show = true" /></div>
    </div>

    <div v-if="alerts && (alerts.contracts.length || alerts.warranties.length || alerts.licenses.length)" class="card mb" style="border-left: 4px solid #d97706">
      <h3 class="mb">Alertas de vencimiento (próximos {{ alerts.days }} días)</h3>
      <div v-for="c in alerts.contracts" :key="c.id" class="row"><Tag :value="c.expired ? 'Vencido' : 'Por vencer'" :severity="c.expired ? 'danger' : 'warn'" />Contrato <strong>{{ c.number }}</strong> · {{ c.supplier.name }} · vence {{ fmtDate(c.endDate) }}</div>
      <div v-for="w in alerts.warranties" :key="w.id" class="row"><Tag :value="w.expired ? 'Vencida' : 'Por vencer'" :severity="w.expired ? 'danger' : 'warn'" />Garantía <RouterLink :to="`/activos/${w.id}`">{{ w.code }} {{ w.name }}</RouterLink> · {{ fmtDate(w.warrantyUntil) }}</div>
      <div v-for="l in alerts.licenses" :key="l.id" class="row"><Tag :value="l.expired ? 'Vencida' : 'Por vencer'" :severity="l.expired ? 'danger' : 'warn'" />Licencia <RouterLink :to="`/activos/${l.id}`">{{ l.code }} {{ l.name }}</RouterLink> · {{ fmtDate(l.licenseExpiresAt) }}</div>
    </div>

    <div class="card">
      <div class="filters"><IconField style="min-width: 280px"><InputIcon class="pi pi-search" /><InputText v-model="q" placeholder="Nombre, NIT o especialidad" style="width: 100%" /></IconField></div>
      <DataTable :value="items" :loading="loading" size="small" paginator :rows="25" row-hover class="clickable" @row-click="(e) => router.push(`/proveedores/${e.data.id}`)">
        <template #empty><div class="empty">No hay proveedores registrados.</div></template>
        <Column field="name" header="Proveedor" />
        <Column field="nit" header="NIT" />
        <Column header="Tipo"><template #body="{ data }"><Tag :value="data.type === 'INTERNO' ? 'Interno' : 'Externo'" severity="secondary" /></template></Column>
        <Column field="specialty" header="Especialidad" />
        <Column header="Contacto"><template #body="{ data }">{{ data.contactName ?? '—' }}<div class="muted">{{ [data.email, data.phone].filter(Boolean).join(' · ') }}</div></template></Column>
        <Column header="Contratos vigentes"><template #body="{ data }"><span v-for="c in data.contracts" :key="c.id" class="nowrap">{{ c.number }} (hasta {{ fmtDate(c.endDate.slice(0, 10)) }})<br /></span><span v-if="!data.contracts.length" class="muted">—</span></template></Column>
        <Column header="Activos / órdenes"><template #body="{ data }">{{ data._count.assets }} / {{ data._count.workOrders }}</template></Column>
      </DataTable>
    </div>

    <Dialog v-model:visible="show" modal header="Nuevo proveedor" :style="{ width: '680px', maxWidth: '96vw' }">
      <div class="form">
        <div class="field full"><label>Nombre o razón social <span class="req">*</span></label><InputText v-model="form.name" /></div>
        <div class="field"><label>NIT</label><InputText v-model="form.nit" placeholder="900123456-7" /></div>
        <div class="field"><label>Tipo</label><Select v-model="form.type" :options="[{ v: 'EXTERNO', l: 'Externo' }, { v: 'INTERNO', l: 'Interno' }]" option-label="l" option-value="v" /></div>
        <div class="field"><label>Contacto</label><InputText v-model="form.contactName" /></div>
        <div class="field"><label>Correo</label><InputText v-model="form.email" type="email" /></div>
        <div class="field"><label>Teléfono</label><InputText v-model="form.phone" /></div>
        <div class="field"><label>Especialidad</label><InputText v-model="form.specialty" /></div>
        <div class="field full"><label>Servicios prestados</label><Textarea v-model="form.services" rows="2" /></div>
        <div class="field full"><label>Dirección</label><InputText v-model="form.address" /></div>
      </div>
      <template #footer><Button label="Cancelar" text severity="secondary" @click="show = false" /><Button label="Guardar" :disabled="form.name.trim().length < 2" @click="create" /></template>
    </Dialog>
  </div>
</template>
