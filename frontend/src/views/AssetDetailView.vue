<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { download, http } from '@/api/http';
import AssetForm from '@/components/AssetForm.vue';
import DocumentsPanel from '@/components/DocumentsPanel.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuth } from '@/stores/auth';
import { useNotify } from '@/utils/notify';
import { dateToYmd, fmtCOP, fmtDate, fmtDateTime } from '@/utils/format';
import { ASSET_STATUS, CRITICALITY, FINAL_CONDITION, opts, WO_TYPE } from '@/utils/labels';

const route = useRoute();
const router = useRouter();
const auth = useAuth();
const n = useNotify();
const d = ref<Record<string, any> | null>(null);
const loading = ref(false);
const showEdit = ref(false);
const qrUrl = ref('');

const id = computed(() => String(route.params.id));
async function load() {
  loading.value = true;
  try {
    d.value = (await http.get(`/assets/${id.value}/lifecycle`)).data;
    const q = await http.get(`/assets/${id.value}/qr`, { responseType: 'blob' });
    if (qrUrl.value) URL.revokeObjectURL(qrUrl.value);
    qrUrl.value = URL.createObjectURL(q.data as Blob);
  } catch (e) {
    n.error(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(id, load);
const a = computed(() => d.value?.asset);

// ---- Cambio de estado
const st = ref({ visible: false, status: null as string | null, reason: '', effectiveDate: null as Date | null });
async function saveStatus() {
  const r = await n.run(() => http.post(`/assets/${id.value}/status`, { status: st.value.status, reason: st.value.reason, effectiveDate: dateToYmd(st.value.effectiveDate) }), 'Estado actualizado');
  if (r) {
    st.value.visible = false;
    await load();
  }
}

// ---- Evaluación de criticidad
const criteria = ref<{ id: string; code: string; name: string; weight: string; maxScore: number; scaleGuide: string[] | null; isActive: boolean }[]>([]);
const crit = ref({ visible: false, scores: {} as Record<string, number>, justification: '', overrideLevel: null as string | null });
async function openCrit() {
  criteria.value = (await http.get('/criticality/criteria')).data.filter((c: { isActive: boolean }) => c.isActive);
  crit.value = { visible: true, scores: Object.fromEntries(criteria.value.map((c) => [c.code, 3])), justification: '', overrideLevel: null };
}
async function saveCrit() {
  const r = await n.run(() => http.post(`/assets/${id.value}/criticality`, crit.value), 'Evaluación registrada');
  if (r) {
    crit.value.visible = false;
    n.info(`Nivel calculado: ${CRITICALITY[r.data.computedLevel].label} (puntaje ${r.data.totalScore}). Asignado: ${CRITICALITY[r.data.assignedLevel].label}.`);
    await load();
  }
}
const pdf = () => n.run(() => download(`/assets/${id.value}/lifecycle/pdf`), 'Hoja de vida generada');
/**
 * Etiqueta QR imprimible. Se construye con nodos DOM y textContent (nunca HTML interpolado):
 * el nombre y el código del activo son datos de usuario y no deben interpretarse como HTML (XSS).
 * Sin scripts en línea, compatible con la política de seguridad de contenido (CSP).
 */
function printQr() {
  const w = window.open('', '_blank', 'width=420,height=520');
  if (!w || !a.value) return;
  const doc = w.document;
  doc.title = `QR ${a.value.code}`;
  doc.body.style.cssText = 'font-family:sans-serif;text-align:center';
  const img = doc.createElement('img');
  img.style.width = '300px';
  img.alt = `Código QR ${a.value.code}`;
  const code = doc.createElement('h2');
  code.textContent = a.value.code;
  const name = doc.createElement('div');
  name.textContent = a.value.name;
  doc.body.append(img, code, name);
  img.onload = () => setTimeout(() => w.print(), 100);
  img.src = qrUrl.value;
}
</script>

<template>
  <div class="page">
    <div v-if="loading && !d" class="grid"><Skeleton height="120px" /><Skeleton height="300px" /></div>
    <template v-if="d && a">
      <div class="page-head">
        <div>
          <div class="row"><span class="mono muted">{{ a.code }}</span><StatusTag :value="a.status" kind="asset" /><StatusTag :value="a.criticality" kind="crit" /></div>
          <h1 style="margin-top: 4px">{{ a.name }}</h1>
          <div class="sub">{{ a.category.name }}<template v-if="a.subcategory"> · {{ a.subcategory.name }}</template> · {{ a.area.name }}<template v-if="a.location"> · {{ a.location.name }}</template></div>
        </div>
        <div class="actions">
          <Button label="Hoja de vida PDF" icon="pi pi-file-pdf" severity="secondary" outlined @click="pdf" />
          <Button v-if="auth.can('failures.report')" label="Reportar falla" icon="pi pi-exclamation-triangle" severity="warn" outlined @click="router.push({ path: '/correctivos', query: { nuevo: a.id } })" />
          <Button v-if="auth.can('criticality.assess')" label="Evaluar criticidad" icon="pi pi-sliders-h" severity="secondary" outlined @click="openCrit" />
          <Button v-if="auth.can('assets.status') && a.status !== 'DADO_DE_BAJA'" label="Cambiar estado" icon="pi pi-sync" severity="secondary" outlined @click="st = { visible: true, status: null, reason: '', effectiveDate: null }" />
          <Button v-if="auth.can('assets.write') && a.status !== 'DADO_DE_BAJA'" label="Editar" icon="pi pi-pencil" @click="showEdit = true" />
        </div>
      </div>

      <div class="grid g4 mb">
        <div class="card kpi"><span class="l">Último mantenimiento</span><span class="v" style="font-size: 1.2rem">{{ fmtDate(d.stats.lastMaintenanceDate) }}</span></div>
        <div class="card kpi"><span class="l">Próximo mantenimiento</span><span class="v" style="font-size: 1.2rem">{{ fmtDate(d.stats.nextMaintenanceDate) }}</span></div>
        <div class="card kpi"><span class="l">Órdenes (prev. / corr.)</span><span class="v" style="font-size: 1.2rem">{{ d.stats.preventiveOrders }} / {{ d.stats.correctiveOrders }}</span><span class="h">{{ d.stats.failures }} fallas · {{ d.stats.downtimeHours }} h indisponible</span></div>
        <div class="card kpi"><span class="l">Costo acumulado</span><span class="v" style="font-size: 1.2rem">{{ fmtCOP(d.stats.costs.total) }}</span><span class="h">Repuestos {{ fmtCOP(d.stats.costs.parts) }}</span></div>
      </div>

      <div class="card">
        <Tabs value="general">
          <TabList>
            <Tab value="general">Información general</Tab>
            <Tab value="programs">Programas ({{ d.programs.length }})</Tab>
            <Tab value="schedule">Cronograma histórico ({{ d.activities.length }})</Tab>
            <Tab value="wo">Órdenes ({{ d.workOrders.length }})</Tab>
            <Tab value="failures">Fallas ({{ d.failures.length }})</Tab>
            <Tab value="parts">Repuestos y costos</Tab>
            <Tab value="docs">Documentos ({{ d.documents.length }})</Tab>
            <Tab value="history">Trazabilidad</Tab>
          </TabList>
          <TabPanels>
            <TabPanel value="general">
              <div class="grid" style="grid-template-columns: 1fr 200px; align-items: start">
                <dl class="kv">
                  <div><dt>Marca</dt><dd>{{ a.brand ?? '—' }}</dd></div>
                  <div><dt>Modelo</dt><dd>{{ a.model ?? '—' }}</dd></div>
                  <div><dt>Número de serie</dt><dd class="mono">{{ a.serialNumber ?? '—' }}</dd></div>
                  <div><dt>Fabricante</dt><dd>{{ a.manufacturer ?? '—' }}</dd></div>
                  <div><dt>Hostname</dt><dd class="mono">{{ a.hostname ?? '—' }}</dd></div>
                  <div><dt>Dirección IP</dt><dd class="mono">{{ a.ipAddress ?? '—' }}</dd></div>
                  <div><dt>MAC</dt><dd class="mono">{{ a.macAddress ?? '—' }}</dd></div>
                  <div><dt>Sistema operativo</dt><dd>{{ a.operatingSystem ?? '—' }}</dd></div>
                  <div><dt>Versión software / firmware</dt><dd>{{ a.softwareVersion ?? '—' }}</dd></div>
                  <div><dt>Procesador</dt><dd>{{ a.processor ?? '—' }}</dd></div>
                  <div><dt>RAM / almacenamiento</dt><dd>{{ a.ramGb ?? '—' }} GB / {{ a.storageGb ?? '—' }} GB</dd></div>
                  <div><dt>Licencia vence</dt><dd>{{ fmtDate(a.licenseExpiresAt) }}</dd></div>
                  <div><dt>Usuario final / puesto</dt><dd>{{ a.endUser ?? '—' }}</dd></div>
                  <div><dt>Responsable</dt><dd>{{ a.responsible?.fullName ?? '—' }}</dd></div>
                  <div><dt>Proveedor</dt><dd><RouterLink v-if="a.supplier" :to="`/proveedores/${a.supplier.id}`">{{ a.supplier.name }}</RouterLink><template v-else>—</template></dd></div>
                  <div><dt>Adquisición / instalación</dt><dd>{{ fmtDate(a.acquisitionDate) }} / {{ fmtDate(a.installationDate) }}</dd></div>
                  <div><dt>Garantía hasta</dt><dd>{{ fmtDate(a.warrantyUntil) }}</dd></div>
                  <div><dt>Costo de adquisición</dt><dd>{{ fmtCOP(a.acquisitionCost) }}</dd></div>
                  <div><dt>Registrado</dt><dd>{{ fmtDateTime(a.createdAt) }} · {{ a.createdBy.fullName }}</dd></div>
                  <div v-if="a.statusReason"><dt>Motivo del estado</dt><dd>{{ a.statusReason }}</dd></div>
                  <div style="grid-column: 1 / -1"><dt>Descripción</dt><dd class="pre">{{ a.description ?? '—' }}</dd></div>
                  <div style="grid-column: 1 / -1"><dt>Garantía</dt><dd>{{ a.warrantyInfo ?? '—' }}</dd></div>
                  <div style="grid-column: 1 / -1"><dt>Observaciones</dt><dd class="pre">{{ a.notes ?? '—' }}</dd></div>
                </dl>
                <div class="card" style="text-align: center">
                  <img v-if="qrUrl" :src="qrUrl" alt="Código QR del activo" style="width: 160px" />
                  <div class="mono">{{ a.code }}</div>
                  <Button label="Imprimir QR" size="small" text icon="pi pi-print" @click="printQr" />
                </div>
              </div>
              <h3 class="mt mb">Evaluaciones de criticidad</h3>
              <DataTable :value="d.criticality" size="small">
                <template #empty><div class="empty">Sin evaluaciones. La criticidad apoya la priorización; no define por sí sola la frecuencia de mantenimiento.</div></template>
                <Column header="Fecha"><template #body="{ data }">{{ fmtDateTime(data.assessedAt) }}</template></Column>
                <Column field="totalScore" header="Puntaje" />
                <Column header="Calculado"><template #body="{ data }"><StatusTag :value="data.computedLevel" kind="crit" /></template></Column>
                <Column header="Asignado"><template #body="{ data }"><StatusTag :value="data.assignedLevel" kind="crit" /></template></Column>
                <Column field="justification" header="Justificación" />
                <Column field="assessedBy" header="Evaluó" />
              </DataTable>
            </TabPanel>
            <TabPanel value="programs">
              <DataTable :value="d.programs" size="small">
                <template #empty><div class="empty">Sin programas preventivos. <RouterLink v-if="auth.can('programs.write')" :to="{ path: '/plan-maestro', query: { nuevo: a.id } }">Crear programa</RouterLink></div></template>
                <Column field="code" header="Código" />
                <Column field="name" header="Mantenimiento" />
                <Column field="frequencyLabel" header="Periodicidad" />
                <Column field="frequencyJustification" header="Sustento" />
                <Column header="Último realizado"><template #body="{ data }">{{ fmtDate(data.lastPerformedDate) }}</template></Column>
                <Column header="Vigente"><template #body="{ data }"><Tag :value="data.isActive ? 'Sí' : 'No'" :severity="data.isActive ? 'success' : 'secondary'" /></template></Column>
              </DataTable>
            </TabPanel>
            <TabPanel value="schedule">
              <DataTable :value="d.activities" size="small" paginator :rows="20">
                <Column field="year" header="Año" />
                <Column header="Mantenimiento"><template #body="{ data }">{{ data.programName }}</template></Column>
                <Column header="Fecha original"><template #body="{ data }">{{ fmtDate(data.originalDate) }}</template></Column>
                <Column header="Fecha comprometida"><template #body="{ data }">{{ fmtDate(data.committedDate) }}</template></Column>
                <Column header="Ejecución"><template #body="{ data }">{{ fmtDate(data.executedDate) }}</template></Column>
                <Column header="Estado"><template #body="{ data }"><StatusTag :value="data.displayStatus" kind="activity" /></template></Column>
                <Column header="OT"><template #body="{ data }"><RouterLink v-if="data.workOrder" :to="`/ordenes/${data.workOrder.id}`">{{ data.workOrder.code }}</RouterLink></template></Column>
              </DataTable>
            </TabPanel>
            <TabPanel value="wo">
              <DataTable :value="d.workOrders" size="small" paginator :rows="20">
                <Column header="Orden"><template #body="{ data }"><RouterLink :to="`/ordenes/${data.id}`" class="mono">{{ data.code }}</RouterLink></template></Column>
                <Column header="Tipo"><template #body="{ data }">{{ WO_TYPE[data.type] }}</template></Column>
                <Column field="title" header="Título" />
                <Column header="Estado"><template #body="{ data }"><StatusTag :value="data.status" kind="wo" /></template></Column>
                <Column header="Ejecutor"><template #body="{ data }">{{ data.assignedTo?.fullName ?? '—' }}</template></Column>
                <Column header="Cierre"><template #body="{ data }">{{ fmtDateTime(data.closedAt) }}</template></Column>
                <Column header="Condición final"><template #body="{ data }">{{ data.finalCondition ? FINAL_CONDITION[data.finalCondition] : '—' }}</template></Column>
                <Column header="Costo"><template #body="{ data }"><span class="nowrap">{{ fmtCOP(data.totalCost) }}</span></template></Column>
              </DataTable>
            </TabPanel>
            <TabPanel value="failures">
              <DataTable :value="d.failures" size="small">
                <template #empty><div class="empty">Sin fallas reportadas.</div></template>
                <Column header="Reporte"><template #body="{ data }"><RouterLink :to="`/correctivos/${data.id}`" class="mono">{{ data.code }}</RouterLink></template></Column>
                <Column header="Fecha"><template #body="{ data }">{{ fmtDateTime(data.reportedAt) }}</template></Column>
                <Column field="title" header="Falla" />
                <Column header="Prioridad"><template #body="{ data }"><StatusTag :value="data.priority" kind="priority" /></template></Column>
                <Column header="Estado"><template #body="{ data }"><StatusTag :value="data.status" kind="failure" /></template></Column>
                <Column header="Indisponibilidad"><template #body="{ data }"><span v-if="data.downtimeStart">{{ fmtDateTime(data.downtimeStart) }} → {{ data.downtimeEnd ? fmtDateTime(data.downtimeEnd) : 'en curso' }}</span><span v-else>—</span></template></Column>
                <Column header="Resuelta con"><template #body="{ data }">{{ data.resolvedBy?.code ?? '—' }}</template></Column>
              </DataTable>
            </TabPanel>
            <TabPanel value="parts">
              <dl class="kv mb">
                <div><dt>Costo total</dt><dd>{{ fmtCOP(d.stats.costs.total) }}</dd></div>
                <div><dt>Preventivo</dt><dd>{{ fmtCOP(d.stats.costs.preventive) }}</dd></div>
                <div><dt>Correctivo</dt><dd>{{ fmtCOP(d.stats.costs.corrective) }}</dd></div>
                <div><dt>Repuestos</dt><dd>{{ fmtCOP(d.stats.costs.parts) }}</dd></div>
              </dl>
              <DataTable :value="d.parts" size="small">
                <template #empty><div class="empty">Sin repuestos registrados.</div></template>
                <Column field="workOrderCode" header="Orden" />
                <Column field="name" header="Repuesto" />
                <Column field="partNumber" header="Referencia" />
                <Column field="quantity" header="Cantidad" />
                <Column header="Total"><template #body="{ data }">{{ fmtCOP(data.totalCost) }}</template></Column>
              </DataTable>
              <h3 class="mt mb">Contratos asociados</h3>
              <DataTable :value="d.contracts" size="small">
                <template #empty><div class="empty">Sin contratos.</div></template>
                <Column field="number" header="Contrato" />
                <Column header="Proveedor"><template #body="{ data }">{{ data.supplier.name }}</template></Column>
                <Column header="Vigencia"><template #body="{ data }">{{ fmtDate(data.startDate) }} – {{ fmtDate(data.endDate) }}</template></Column>
                <Column field="status" header="Estado" />
              </DataTable>
            </TabPanel>
            <TabPanel value="docs"><DocumentsPanel :link="{ assetId: a.id }" default-type="FICHA_TECNICA" @changed="load" /></TabPanel>
            <TabPanel value="history">
              <DataTable :value="d.statusHistory" size="small">
                <template #empty><div class="empty">Sin cambios de estado desde el registro.</div></template>
                <Column header="Fecha"><template #body="{ data }">{{ fmtDateTime(data.createdAt) }}</template></Column>
                <Column header="De"><template #body="{ data }"><StatusTag :value="data.fromStatus" kind="asset" /></template></Column>
                <Column header="A"><template #body="{ data }"><StatusTag :value="data.toStatus" kind="asset" /></template></Column>
                <Column field="reason" header="Motivo" />
                <Column field="user" header="Usuario" />
              </DataTable>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </div>

      <AssetForm v-model:visible="showEdit" :asset="a" @saved="load" />

      <Dialog v-model:visible="st.visible" modal header="Cambiar estado del activo" :style="{ width: '520px', maxWidth: '95vw' }">
        <div class="grid">
          <div class="field"><label>Nuevo estado <span class="req">*</span></label><Select v-model="st.status" :options="opts(ASSET_STATUS).filter((o) => o.value !== a.status)" option-label="label" option-value="value" /></div>
          <Message v-if="st.status === 'DADO_DE_BAJA' || st.status === 'RETIRADO'" severity="warn" :closable="false">Las actividades futuras pendientes pasarán a "No aplica" (se conservan) y los programas se desactivan. El historial se mantiene completo.</Message>
          <div v-if="st.status === 'DADO_DE_BAJA' || st.status === 'RETIRADO'" class="field"><label>Fecha efectiva</label><DatePicker v-model="st.effectiveDate" date-format="dd/mm/yy" show-icon /></div>
          <div class="field"><label>Justificación <span class="req">*</span></label><Textarea v-model="st.reason" rows="3" /><small>Mínimo 10 caracteres.</small></div>
        </div>
        <template #footer>
          <Button label="Cancelar" text severity="secondary" @click="st.visible = false" />
          <Button label="Guardar" :severity="st.status === 'DADO_DE_BAJA' ? 'danger' : undefined" :disabled="!st.status || st.reason.trim().length < 10" @click="saveStatus" />
        </template>
      </Dialog>

      <Dialog v-model:visible="crit.visible" modal header="Evaluación de criticidad" :style="{ width: '680px', maxWidth: '96vw' }">
        <p class="muted mb">La criticidad prioriza inspecciones, atención de fallas y seguimiento. No asigna automáticamente frecuencias de mantenimiento.</p>
        <div v-for="c in criteria" :key="c.code" class="field mb">
          <label>{{ c.name }} <span class="muted">(peso {{ c.weight }})</span></label>
          <SelectButton v-model="crit.scores[c.code]" :options="Array.from({ length: c.maxScore }, (_, i) => i + 1)" :allow-empty="false" />
          <small v-if="c.scaleGuide">{{ c.scaleGuide[(crit.scores[c.code] ?? 1) - 1] }}</small>
        </div>
        <div class="form">
          <div class="field"><label>Asignar otro nivel (opcional)</label><Select v-model="crit.overrideLevel" :options="opts(CRITICALITY)" option-label="label" option-value="value" show-clear placeholder="Usar el calculado" /></div>
          <div class="field full"><label>Justificación <span class="req">*</span></label><Textarea v-model="crit.justification" rows="3" /><small>{{ crit.overrideLevel ? 'Si asigna un nivel distinto al calculado, documente al menos 20 caracteres.' : 'Mínimo 10 caracteres.' }}</small></div>
        </div>
        <template #footer>
          <Button label="Cancelar" text severity="secondary" @click="crit.visible = false" />
          <Button label="Registrar evaluación" :disabled="crit.justification.trim().length < (crit.overrideLevel ? 20 : 10)" @click="saveCrit" />
        </template>
      </Dialog>
    </template>
  </div>
</template>
