<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { download, http } from '@/api/http';
import DocumentsPanel from '@/components/DocumentsPanel.vue';
import ReasonDialog from '@/components/ReasonDialog.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { dateToYmd, fmtDateTime } from '@/utils/format';
import { ASSET_CONDITION, opts, PRIORITY, WO_TYPE } from '@/utils/labels';

const route = useRoute();
const auth = useAuth();
const cat = useCatalog();
const n = useNotify();
const reason = ref<InstanceType<typeof ReasonDialog>>();
const fr = ref<Record<string, any> | null>(null);
const id = computed(() => String(route.params.id));
async function load() {
  try {
    fr.value = (await http.get(`/failures/${id.value}`)).data;
  } catch (e) {
    n.error(e);
  }
}
onMounted(load);
const open = computed(() => fr.value && !['RESUELTA', 'CERRADA', 'ANULADA'].includes(fr.value.status));

const ev = ref({ visible: false, safety: 3, care: 3, continuity: 3, priority: null as string | null, overrideReason: '', markOutOfService: false, note: '' });
function openEval() {
  const p = fr.value!.priorityInputs;
  ev.value = { visible: true, safety: p.safety, care: p.care, continuity: p.continuity, priority: null, overrideReason: '', markOutOfService: false, note: '' };
}
async function evaluate() {
  if (await n.run(() => http.post(`/failures/${id.value}/evaluate`, ev.value), 'Evaluación registrada')) {
    ev.value.visible = false;
    await load();
  }
}
const asg = ref({ visible: false, assignedToId: null as string | null, supplierId: null as string | null, note: '', dueDate: null as Date | null });
async function assign() {
  const r = await n.run(() => http.post(`/failures/${id.value}/assign`, { ...asg.value, dueDate: dateToYmd(asg.value.dueDate) }));
  if (r) {
    n.ok(`Responsable asignado. Orden correctiva ${r.data.workOrder?.code ?? ''}`);
    asg.value.visible = false;
    await load();
  }
}
async function release() {
  const why = await reason.value!.ask({ title: 'Autorizar liberación del activo', label: 'Verificación realizada antes de liberar', message: fr.value!.asset.criticality === 'CRITICA' ? 'Activo CRÍTICO: requiere competencia técnica certificada.' : undefined, confirmLabel: 'Autorizar liberación' });
  if (why && (await n.run(() => http.post(`/failures/${id.value}/release`, { note: why }), 'Liberación autorizada'))) await load();
}
async function closeF() {
  const why = await reason.value!.ask({ title: 'Cerrar reporte', label: 'Observación de cierre' });
  if (why && (await n.run(() => http.post(`/failures/${id.value}/close`, { note: why }), 'Reporte cerrado'))) await load();
}
async function cancel() {
  const why = await reason.value!.ask({ title: 'Anular reporte', danger: true, message: 'El reporte se conserva con estado Anulada.' });
  if (why && (await n.run(() => http.post(`/failures/${id.value}/cancel`, { reason: why }), 'Reporte anulado'))) await load();
}
const pdf = () => n.run(() => download(`/reports/failures/${id.value}.pdf`), 'Formato F-07 generado');
const scale = [1, 2, 3, 4, 5];
</script>

<template>
  <div class="page">
    <template v-if="fr">
      <div class="page-head">
        <div>
          <div class="row"><span class="mono">{{ fr.code }}</span><StatusTag :value="fr.status" kind="failure" /><StatusTag :value="fr.priority" kind="priority" /><Tag v-if="fr.recurring" value="Falla recurrente" severity="danger" /><Tag v-if="fr.outOfService" value="Fuera de servicio" severity="danger" icon="pi pi-power-off" /></div>
          <h1 style="margin-top: 4px">{{ fr.title }}</h1>
          <div class="sub"><RouterLink v-if="auth.can('assets.read')" :to="`/activos/${fr.asset.id}`">{{ fr.asset.code }} · {{ fr.asset.name }}</RouterLink><template v-else>{{ fr.asset.code }} · {{ fr.asset.name }}</template> · {{ fr.area.name }} · reportada {{ fmtDateTime(fr.reportedAt) }} por {{ fr.reporter.fullName }}</div>
        </div>
        <div class="actions">
          <Button label="F-07 PDF" icon="pi pi-file-pdf" severity="secondary" outlined @click="pdf" />
          <Button v-if="auth.can('failures.manage') && open" label="Evaluar y clasificar" icon="pi pi-sliders-h" severity="secondary" outlined @click="openEval" />
          <Button v-if="auth.can('failures.manage') && auth.can('workorders.assign') && open" label="Asignar responsable" icon="pi pi-user-plus" @click="asg = { visible: true, assignedToId: fr.assignedToId, supplierId: null, note: '', dueDate: null }" />
          <Button v-if="auth.can('failures.release') && fr.status === 'RESUELTA' && !fr.releaseAuthorizedAt" label="Autorizar liberación" icon="pi pi-unlock" severity="success" @click="release" />
          <Button v-if="auth.can('failures.manage') && fr.status === 'RESUELTA'" label="Cerrar reporte" icon="pi pi-check" @click="closeF" />
          <Button v-if="auth.can('failures.manage') && open" label="Anular" text severity="danger" @click="cancel" />
        </div>
      </div>
      <div class="grid g2">
        <div class="card">
          <h3 class="mb">Reporte</h3>
          <dl class="kv">
            <div style="grid-column: 1 / -1"><dt>Descripción</dt><dd class="pre">{{ fr.description }}</dd></div>
            <div><dt>Condición del activo</dt><dd>{{ ASSET_CONDITION[fr.assetCondition] }}</dd></div>
            <div><dt>Impacto sobre el servicio</dt><dd>{{ fr.serviceImpact ?? '—' }}</dd></div>
            <div><dt>Criterios (seguridad / asistencial / continuidad)</dt><dd>{{ fr.priorityInputs.safety }} / {{ fr.priorityInputs.care }} / {{ fr.priorityInputs.continuity }} · criticidad {{ fr.priorityInputs.criticality }}</dd></div>
            <div><dt>Puntaje de prioridad</dt><dd>{{ fr.priorityScore }} → {{ PRIORITY[fr.priority].label }}</dd></div>
            <div v-if="fr.priorityOverrideReason" style="grid-column: 1 / -1"><dt>Justificación del ajuste de prioridad</dt><dd>{{ fr.priorityOverrideReason }}</dd></div>
            <div style="grid-column: 1 / -1"><dt>Observaciones</dt><dd class="pre">{{ fr.observations ?? '—' }}</dd></div>
            <div><dt>Fallas históricas del activo</dt><dd>{{ fr.assetFailureCount }}</dd></div>
          </dl>
        </div>
        <div class="card">
          <h3 class="mb">Atención</h3>
          <dl class="kv">
            <div><dt>Asignado a</dt><dd>{{ fr.assignedTo?.fullName ?? 'Sin asignar' }}</dd></div>
            <div><dt>Primera respuesta</dt><dd>{{ fmtDateTime(fr.firstResponseAt) }}</dd></div>
            <div><dt>Inicio de indisponibilidad</dt><dd>{{ fmtDateTime(fr.downtimeStart) }}</dd></div>
            <div><dt>Restablecimiento</dt><dd>{{ fr.downtimeStart && !fr.downtimeEnd ? 'En curso' : fmtDateTime(fr.downtimeEnd) }}</dd></div>
            <div><dt>Resuelta</dt><dd>{{ fmtDateTime(fr.resolvedAt) }}<span v-if="fr.resolvedBy"> con {{ fr.resolvedBy.code }}</span></dd></div>
            <div><dt>Liberación autorizada</dt><dd>{{ fr.releasedBy ? `${fr.releasedBy.fullName} · ${fmtDateTime(fr.releaseAuthorizedAt)}` : '—' }}</dd></div>
            <div v-if="fr.releaseNote" style="grid-column: 1 / -1"><dt>Verificación de liberación</dt><dd>{{ fr.releaseNote }}</dd></div>
            <div v-if="fr.cancelReason" style="grid-column: 1 / -1"><dt>Motivo de anulación</dt><dd>{{ fr.cancelReason }}</dd></div>
          </dl>
          <h3 class="mt mb">Órdenes de trabajo</h3>
          <DataTable :value="fr.workOrders" size="small">
            <template #empty><div class="empty">Aún no hay órdenes. Al asignar un responsable se genera la orden correctiva.</div></template>
            <Column header="Orden"><template #body="{ data }"><RouterLink :to="`/ordenes/${data.id}`">{{ data.code }}</RouterLink></template></Column>
            <Column header="Tipo"><template #body="{ data }">{{ WO_TYPE[data.type] }}</template></Column>
            <Column header="Estado"><template #body="{ data }"><StatusTag :value="data.status" kind="wo" /></template></Column>
            <Column header="Responsable"><template #body="{ data }">{{ data.assignedTo?.fullName ?? '—' }}</template></Column>
          </DataTable>
        </div>
      </div>
      <div class="card mt"><DocumentsPanel :link="{ failureReportId: fr.id }" default-type="FOTOGRAFIA" /></div>

      <Dialog v-model:visible="ev.visible" modal header="Evaluación y clasificación" :style="{ width: '620px', maxWidth: '95vw' }">
        <div class="form">
          <div class="field"><label>Impacto en la atención / seguridad del paciente</label><SelectButton v-model="ev.safety" :options="scale" :allow-empty="false" /></div>
          <div class="field"><label>Impacto asistencial</label><SelectButton v-model="ev.care" :options="scale" :allow-empty="false" /></div>
          <div class="field"><label>Continuidad del servicio</label><SelectButton v-model="ev.continuity" :options="scale" :allow-empty="false" /></div>
          <div class="field"><label>Ajustar prioridad (opcional)</label><Select v-model="ev.priority" :options="opts(PRIORITY)" option-label="label" option-value="value" show-clear placeholder="Usar la calculada" /></div>
          <div v-if="ev.priority" class="field full"><label>Justificación del ajuste <span class="req">*</span></label><Textarea v-model="ev.overrideReason" rows="2" /></div>
          <div class="field full"><label>Nota de evaluación</label><Textarea v-model="ev.note" rows="2" /></div>
          <div v-if="!fr.outOfService" class="field full"><label class="row"><Checkbox v-model="ev.markOutOfService" binary /> Marcar el activo como fuera de servicio</label></div>
        </div>
        <template #footer><Button label="Cancelar" text severity="secondary" @click="ev.visible = false" /><Button label="Guardar evaluación" :disabled="!!ev.priority && ev.overrideReason.trim().length < 10" @click="evaluate" /></template>
      </Dialog>
      <Dialog v-model:visible="asg.visible" modal header="Asignar responsable" :style="{ width: '480px', maxWidth: '95vw' }">
        <div class="grid">
          <div class="field"><label>Responsable técnico <span class="req">*</span></label><Select v-model="asg.assignedToId" :options="cat.executors" option-label="fullName" option-value="id" filter /></div>
          <div class="field"><label>Proveedor</label><Select v-model="asg.supplierId" :options="cat.suppliers" option-label="name" option-value="id" filter show-clear /></div>
          <div class="field"><label>Fecha límite</label><DatePicker v-model="asg.dueDate" date-format="dd/mm/yy" show-icon /></div>
          <div class="field"><label>Nota</label><Textarea v-model="asg.note" rows="2" /></div>
        </div>
        <template #footer><Button label="Cancelar" text severity="secondary" @click="asg.visible = false" /><Button label="Asignar y generar orden" :disabled="!asg.assignedToId" @click="assign" /></template>
      </Dialog>
      <ReasonDialog ref="reason" />
    </template>
    <div v-else class="grid"><Skeleton height="120px" /><Skeleton height="300px" /></div>
  </div>
</template>
