<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { download, http } from '@/api/http';
import DocumentsPanel from '@/components/DocumentsPanel.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { dateToYmd, fmtCOP, fmtDate, fmtDateTime, ymdToDate } from '@/utils/format';
import { WO_TYPE } from '@/utils/labels';

const route = useRoute();
const auth = useAuth();
const cat = useCatalog();
const n = useNotify();
const s = ref<Record<string, any> | null>(null);
const id = computed(() => String(route.params.id));
async function load() {
  try {
    s.value = (await http.get(`/suppliers/${id.value}`)).data;
  } catch (e) {
    n.error(e);
  }
}
onMounted(async () => {
  await load();
  await cat.loadAssets();
});

const edit = ref({ visible: false, f: {} as Record<string, any> });
function openEdit() {
  const x = s.value!;
  edit.value = { visible: true, f: { name: x.name, nit: x.nit ?? '', type: x.type, contactName: x.contactName ?? '', email: x.email ?? '', phone: x.phone ?? '', specialty: x.specialty ?? '', services: x.services ?? '', address: x.address ?? '', isActive: x.isActive } };
}
async function saveEdit() {
  if (await n.run(() => http.patch(`/suppliers/${id.value}`, edit.value.f), 'Proveedor actualizado')) {
    edit.value.visible = false;
    await load();
  }
}
const ct = ref({ visible: false, id: '', number: '', object: '', startDate: null as Date | null, endDate: null as Date | null, value: null as number | null, status: 'VIGENTE', notes: '', assetIds: [] as string[] });
function openContract(c?: Record<string, any>) {
  ct.value = c
    ? { visible: true, id: c.id, number: c.number, object: c.object, startDate: ymdToDate(c.startDate), endDate: ymdToDate(c.endDate), value: c.value ? Number(c.value) : null, status: c.status, notes: c.notes ?? '', assetIds: c.assets.map((a: { asset: { id: string } }) => a.asset.id) }
    : { visible: true, id: '', number: '', object: '', startDate: null, endDate: null, value: null, status: 'VIGENTE', notes: '', assetIds: [] };
}
async function saveContract() {
  const b = { supplierId: id.value, number: ct.value.number, object: ct.value.object, startDate: dateToYmd(ct.value.startDate), endDate: dateToYmd(ct.value.endDate), value: ct.value.value, status: ct.value.status, notes: ct.value.notes, assetIds: ct.value.assetIds };
  if (await n.run(() => (ct.value.id ? http.patch(`/contracts/${ct.value.id}`, b) : http.post('/contracts', b)), 'Contrato guardado')) {
    ct.value.visible = false;
    await load();
  }
}
const evf = ref({ visible: false, periodStart: null as Date | null, periodEnd: null as Date | null, scores: { oportunidad: 3, calidad: 3, documentacion: 3, cumplimientoContractual: 3, atencion: 3 }, observations: '' });
const criteria = [['oportunidad', 'Oportunidad'], ['calidad', 'Calidad técnica'], ['documentacion', 'Documentación y soportes'], ['cumplimientoContractual', 'Cumplimiento contractual'], ['atencion', 'Atención y comunicación']] as const;
async function saveEval() {
  const b = { ...evf.value, periodStart: dateToYmd(evf.value.periodStart), periodEnd: dateToYmd(evf.value.periodEnd) };
  if (await n.run(() => http.post(`/suppliers/${id.value}/evaluations`, b), 'Evaluación registrada')) {
    evf.value.visible = false;
    await load();
  }
}
const pdf = () => n.run(() => download(`/reports/suppliers/${id.value}/evaluation.pdf`), 'Formato F-11 generado');
const assetLabel = (a: { code: string; name: string }) => `${a.code} · ${a.name}`;
</script>

<template>
  <div class="page">
    <template v-if="s">
      <div class="page-head">
        <div><div class="row"><Tag :value="s.type === 'INTERNO' ? 'Interno' : 'Externo'" severity="secondary" /><Tag v-if="!s.isActive" value="Inactivo" severity="secondary" /></div><h1 style="margin-top: 4px">{{ s.name }}</h1><div class="sub">NIT {{ s.nit ?? '—' }} · {{ s.specialty ?? '' }}</div></div>
        <div class="actions">
          <Button v-if="auth.can('reports.read')" label="F-11 Evaluación" icon="pi pi-file-pdf" severity="secondary" outlined @click="pdf" />
          <Button v-if="auth.can('suppliers.write')" label="Evaluar proveedor" icon="pi pi-star" severity="secondary" outlined @click="evf.visible = true" />
          <Button v-if="auth.can('suppliers.write')" label="Editar" icon="pi pi-pencil" @click="openEdit" />
        </div>
      </div>
      <div class="card mb">
        <dl class="kv">
          <div><dt>Contacto</dt><dd>{{ s.contactName ?? '—' }}</dd></div>
          <div><dt>Correo</dt><dd>{{ s.email ?? '—' }}</dd></div>
          <div><dt>Teléfono</dt><dd>{{ s.phone ?? '—' }}</dd></div>
          <div><dt>Dirección</dt><dd>{{ s.address ?? '—' }}</dd></div>
          <div style="grid-column: 1 / -1"><dt>Servicios prestados</dt><dd>{{ s.services ?? '—' }}</dd></div>
        </dl>
      </div>
      <div class="card">
        <Tabs value="contracts">
          <TabList><Tab value="contracts">Contratos ({{ s.contracts.length }})</Tab><Tab value="assets">Activos atendidos ({{ s.assets.length }})</Tab><Tab value="wo">Intervenciones ({{ s.workOrders.length }})</Tab><Tab value="eval">Evaluaciones ({{ s.evaluations.length }})</Tab><Tab value="docs">Documentos</Tab></TabList>
          <TabPanels>
            <TabPanel value="contracts">
              <div class="row mb"><span class="spacer" /><Button v-if="auth.can('suppliers.write')" label="Nuevo contrato" icon="pi pi-plus" size="small" @click="openContract()" /></div>
              <DataTable :value="s.contracts" size="small" row-hover :class="{ clickable: auth.can('suppliers.write') }" @row-click="(e) => auth.can('suppliers.write') && openContract(e.data)">
                <template #empty><div class="empty">Sin contratos.</div></template>
                <Column field="number" header="Número" />
                <Column field="object" header="Objeto" />
                <Column header="Vigencia"><template #body="{ data }"><span class="nowrap">{{ fmtDate(data.startDate.slice(0, 10)) }} – {{ fmtDate(data.endDate.slice(0, 10)) }}</span></template></Column>
                <Column header="Valor"><template #body="{ data }">{{ fmtCOP(data.value) }}</template></Column>
                <Column field="status" header="Estado" />
                <Column header="Activos"><template #body="{ data }">{{ data.assets.length }}</template></Column>
              </DataTable>
            </TabPanel>
            <TabPanel value="assets">
              <DataTable :value="s.assets" size="small">
                <Column header="Código"><template #body="{ data }"><RouterLink :to="`/activos/${data.id}`" class="mono">{{ data.code }}</RouterLink></template></Column>
                <Column field="name" header="Activo" />
                <Column header="Estado"><template #body="{ data }"><StatusTag :value="data.status" kind="asset" /></template></Column>
              </DataTable>
            </TabPanel>
            <TabPanel value="wo">
              <DataTable :value="s.workOrders" size="small" paginator :rows="20">
                <Column header="Orden"><template #body="{ data }"><RouterLink :to="`/ordenes/${data.id}`">{{ data.code }}</RouterLink></template></Column>
                <Column header="Tipo"><template #body="{ data }">{{ WO_TYPE[data.type] }}</template></Column>
                <Column header="Activo"><template #body="{ data }">{{ data.asset.code }}</template></Column>
                <Column header="Estado"><template #body="{ data }"><StatusTag :value="data.status" kind="wo" /></template></Column>
                <Column header="Fecha"><template #body="{ data }">{{ fmtDateTime(data.createdAt) }}</template></Column>
                <Column header="Costo"><template #body="{ data }">{{ fmtCOP(data.totalCost) }}</template></Column>
              </DataTable>
            </TabPanel>
            <TabPanel value="eval">
              <DataTable :value="s.evaluations" size="small">
                <template #empty><div class="empty">Sin evaluaciones.</div></template>
                <Column header="Periodo"><template #body="{ data }">{{ fmtDate(data.periodStart.slice(0, 10)) }} – {{ fmtDate(data.periodEnd.slice(0, 10)) }}</template></Column>
                <Column v-for="[k, l] in criteria" :key="k" :header="l"><template #body="{ data }">{{ data.scores[k] }}</template></Column>
                <Column field="totalScore" header="Promedio" />
                <Column field="observations" header="Observaciones" />
              </DataTable>
            </TabPanel>
            <TabPanel value="docs"><DocumentsPanel :link="{ supplierId: s.id }" default-type="CONTRATO" /></TabPanel>
          </TabPanels>
        </Tabs>
      </div>

      <Dialog v-model:visible="edit.visible" modal header="Editar proveedor" :style="{ width: '680px', maxWidth: '96vw' }">
        <div class="form">
          <div class="field full"><label>Nombre</label><InputText v-model="edit.f.name" /></div>
          <div class="field"><label>NIT</label><InputText v-model="edit.f.nit" /></div>
          <div class="field"><label>Contacto</label><InputText v-model="edit.f.contactName" /></div>
          <div class="field"><label>Correo</label><InputText v-model="edit.f.email" /></div>
          <div class="field"><label>Teléfono</label><InputText v-model="edit.f.phone" /></div>
          <div class="field"><label>Especialidad</label><InputText v-model="edit.f.specialty" /></div>
          <div class="field"><label class="row"><ToggleSwitch v-model="edit.f.isActive" /> Activo</label></div>
          <div class="field full"><label>Servicios</label><Textarea v-model="edit.f.services" rows="2" /></div>
        </div>
        <template #footer><Button label="Cancelar" text severity="secondary" @click="edit.visible = false" /><Button label="Guardar" @click="saveEdit" /></template>
      </Dialog>
      <Dialog v-model:visible="ct.visible" modal :header="ct.id ? 'Editar contrato' : 'Nuevo contrato'" :style="{ width: '680px', maxWidth: '96vw' }">
        <div class="form">
          <div class="field"><label>Número <span class="req">*</span></label><InputText v-model="ct.number" /></div>
          <div class="field"><label>Estado</label><Select v-model="ct.status" :options="['VIGENTE', 'VENCIDO', 'TERMINADO', 'ANULADO']" /></div>
          <div class="field full"><label>Objeto <span class="req">*</span></label><Textarea v-model="ct.object" rows="2" /></div>
          <div class="field"><label>Fecha de inicio <span class="req">*</span></label><DatePicker v-model="ct.startDate" date-format="dd/mm/yy" show-icon /></div>
          <div class="field"><label>Fecha de vencimiento <span class="req">*</span></label><DatePicker v-model="ct.endDate" date-format="dd/mm/yy" show-icon /></div>
          <div class="field"><label>Valor (COP)</label><InputNumber v-model="ct.value" mode="currency" currency="COP" locale="es-CO" :min-fraction-digits="0" /></div>
          <div class="field full"><label>Activos cubiertos</label><MultiSelect v-model="ct.assetIds" :options="cat.assets" :option-label="assetLabel" option-value="id" filter display="chip" /></div>
        </div>
        <template #footer><Button label="Cancelar" text severity="secondary" @click="ct.visible = false" /><Button label="Guardar" :disabled="!ct.number || ct.object.length < 5 || !ct.startDate || !ct.endDate" @click="saveContract" /></template>
      </Dialog>
      <Dialog v-model:visible="evf.visible" modal header="Evaluación de proveedor (F-11)" :style="{ width: '560px', maxWidth: '96vw' }">
        <div class="form">
          <div class="field"><label>Desde</label><DatePicker v-model="evf.periodStart" date-format="dd/mm/yy" show-icon /></div>
          <div class="field"><label>Hasta</label><DatePicker v-model="evf.periodEnd" date-format="dd/mm/yy" show-icon /></div>
          <div v-for="[k, l] in criteria" :key="k" class="field full"><label>{{ l }} (1-5)</label><SelectButton v-model="evf.scores[k]" :options="[1, 2, 3, 4, 5]" :allow-empty="false" /></div>
          <div class="field full"><label>Observaciones</label><Textarea v-model="evf.observations" rows="2" /></div>
        </div>
        <template #footer><Button label="Cancelar" text severity="secondary" @click="evf.visible = false" /><Button label="Registrar" :disabled="!evf.periodStart || !evf.periodEnd" @click="saveEval" /></template>
      </Dialog>
    </template>
  </div>
</template>
