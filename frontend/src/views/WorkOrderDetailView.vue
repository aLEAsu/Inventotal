<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { download, http } from '@/api/http';
import DocumentsPanel from '@/components/DocumentsPanel.vue';
import ReasonDialog from '@/components/ReasonDialog.vue';
import StatusTag from '@/components/StatusTag.vue';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { fmtCOP, fmtDate, fmtDateTime, localDateTimeToIso } from '@/utils/format';
import { ASSET_CONDITION, CHECK_RESULT, FINAL_CONDITION, opts, WO_TYPE } from '@/utils/labels';

const route = useRoute();
const auth = useAuth();
const cat = useCatalog();
const n = useNotify();
const reason = ref<InstanceType<typeof ReasonDialog>>();
const w = ref<Record<string, any> | null>(null);
const id = computed(() => String(route.params.id));

const ex = ref({
  interventionType: '', activitiesPerformed: '', diagnosis: '', findings: '', result: '', testsPerformed: '', finalCondition: null as string | null,
  laborCost: 0, externalCost: 0, startedAt: null as Date | null, finishedAt: null as Date | null,
  checklistResults: [] as { itemId: string; text: string; required: boolean; result: string | null; note: string | null }[],
});
async function load() {
  try {
    w.value = (await http.get(`/workorders/${id.value}`)).data;
    const x = w.value!;
    ex.value = {
      interventionType: x.interventionType ?? '', activitiesPerformed: x.activitiesPerformed ?? '', diagnosis: x.diagnosis ?? '', findings: x.findings ?? '',
      result: x.result ?? '', testsPerformed: x.testsPerformed ?? '', finalCondition: x.finalCondition, laborCost: Number(x.laborCost), externalCost: Number(x.externalCost),
      startedAt: x.startedAt ? new Date(x.startedAt) : null, finishedAt: x.finishedAt ? new Date(x.finishedAt) : null,
      checklistResults: (x.checklistResults ?? []).map((c: any) => ({ ...c, note: c.note ?? '' })),
    };
  } catch (e) {
    n.error(e);
  }
}
onMounted(() => {
  void load();
});
watch(id, load);

const isExecutor = computed(() => !!w.value && auth.can('workorders.execute') && (w.value.assignedToId === auth.me?.id || auth.can('workorders.assign')));
const editable = computed(() => !!w.value && isExecutor.value && ['EN_EJECUCION', 'PENDIENTE_REPUESTOS', 'PENDIENTE_PROVEEDOR'].includes(w.value.status));
const isCorr = computed(() => w.value?.type === 'CORRECTIVA');

async function act(path: string, body: object = {}, msg = 'Orden actualizada') {
  const r = await n.run(() => http.post(`/workorders/${id.value}/${path}`, body), msg);
  if (r) await load();
  return r;
}
async function saveExecution(silent = false) {
  const b = { ...ex.value, startedAt: localDateTimeToIso(ex.value.startedAt), finishedAt: localDateTimeToIso(ex.value.finishedAt), checklistResults: ex.value.checklistResults.length ? ex.value.checklistResults : undefined };
  const r = await n.run(() => http.patch(`/workorders/${id.value}/execution`, b), silent ? undefined : 'Registro de ejecución guardado');
  if (r && !silent) await load();
  return r;
}
async function submit() {
  if (!(await saveExecution(true))) return;
  await act('submit', {}, 'Orden enviada a validación técnica');
}
async function pause(status: string) {
  const why = await reason.value!.ask({ title: status === 'PENDIENTE_REPUESTOS' ? 'Pausar: pendiente de repuestos' : 'Pausar: pendiente de proveedor' });
  if (why) await act('pause', { status, reason: why }, 'Orden en pausa');
}
async function cancel() {
  const why = await reason.value!.ask({ title: 'Cancelar orden', message: 'La orden se conserva con su historial. Si proviene del cronograma, la actividad vuelve a quedar pendiente.', danger: true, confirmLabel: 'Cancelar orden' });
  if (why) await act('cancel', { reason: why }, 'Orden cancelada');
}
async function reject() {
  const why = await reason.value!.ask({ title: 'Devolver al ejecutor', label: 'Observaciones de la validación' });
  if (why) await act('reject', { note: why }, 'Orden devuelta para completar');
}
// Asignación
const asg = ref({ visible: false, assignedToId: null as string | null, supplierId: null as string | null, note: '' });
async function assign() {
  if (await act('assign', { assignedToId: asg.value.assignedToId, supplierId: asg.value.supplierId, note: asg.value.note }, 'Responsable asignado')) asg.value.visible = false;
}
// Repuestos
const part = ref({ visible: false, name: '', partNumber: '', quantity: 1, unitCost: 0 });
async function addPart() {
  if (await act('parts', { name: part.value.name, partNumber: part.value.partNumber, quantity: part.value.quantity, unitCost: part.value.unitCost }, 'Repuesto registrado')) part.value = { visible: false, name: '', partNumber: '', quantity: 1, unitCost: 0 };
}
async function removePart(pid: string) {
  const why = await reason.value!.ask({ title: 'Retirar repuesto', danger: true });
  if (why && (await n.run(() => http.delete(`/workorders/${id.value}/parts/${pid}`, { data: { reason: why } }), 'Repuesto retirado'))) await load();
}
// Cierre
const close = ref({ visible: false, verificationNote: '', validatorSignature: '' });
async function doClose() {
  if (await act('close', close.value, 'Orden validada y cerrada')) close.value.visible = false;
}
// Falla detectada
const corr = ref({ visible: false, title: '', description: '', safety: 2, care: 2, continuity: 2, assetCondition: 'FUNCIONA_CON_LIMITACIONES' });
async function createCorrective() {
  const r = await n.run(() => http.post(`/workorders/${id.value}/corrective`, corr.value));
  if (r) {
    n.ok(`Se registró la falla ${r.data.failure.code} y la orden correctiva ${r.data.workOrder.code}`);
    corr.value.visible = false;
    await load();
  }
}
const pdf = () => n.run(() => download(`/workorders/${id.value}/pdf`), 'Formato generado');
const requiredMissing = computed(() => ex.value.checklistResults.filter((c) => c.required && !c.result).length);
const scale = [1, 2, 3, 4, 5];
</script>

<template>
  <div class="page">
    <template v-if="w">
      <div class="page-head">
        <div>
          <div class="row"><span class="mono">{{ w.code }}</span><Tag :value="WO_TYPE[w.type]" :severity="w.type === 'CORRECTIVA' ? 'warn' : 'info'" /><StatusTag :value="w.status" kind="wo" /><StatusTag :value="w.priority" kind="priority" /></div>
          <h1 style="margin-top: 4px">{{ w.title }}</h1>
          <div class="sub"><RouterLink :to="`/activos/${w.asset.id}`">{{ w.asset.code }} · {{ w.asset.name }}</RouterLink> · {{ w.area.name }}<template v-if="w.asset.location"> · {{ w.asset.location.name }}</template> · criticidad <StatusTag :value="w.asset.criticality" kind="crit" /></div>
        </div>
        <div class="actions">
          <Button label="Formato PDF" icon="pi pi-file-pdf" severity="secondary" outlined @click="pdf" />
          <Button v-if="auth.can('workorders.assign') && ['ABIERTA', 'ASIGNADA', 'EN_EJECUCION', 'PENDIENTE_REPUESTOS', 'PENDIENTE_PROVEEDOR'].includes(w.status)" :label="w.assignedTo ? 'Reasignar' : 'Asignar'" icon="pi pi-user" severity="secondary" outlined @click="asg = { visible: true, assignedToId: w.assignedToId, supplierId: w.supplierId, note: '' }" />
          <Button v-if="isExecutor && w.status === 'ASIGNADA'" label="Iniciar ejecución" icon="pi pi-play" data-testid="btn-start" @click="act('start', {}, 'Ejecución iniciada')" />
          <Button v-if="isExecutor && ['PENDIENTE_REPUESTOS', 'PENDIENTE_PROVEEDOR'].includes(w.status)" label="Reanudar" icon="pi pi-play" @click="act('resume')" />
          <Button v-if="auth.can('workorders.verify') && w.status === 'PENDIENTE_VALIDACION'" label="Devolver" icon="pi pi-undo" severity="warn" outlined @click="reject" />
          <Button v-if="auth.can('workorders.verify') && w.status === 'PENDIENTE_VALIDACION'" label="Validar y cerrar" icon="pi pi-verified" severity="success" data-testid="btn-close" @click="close = { visible: true, verificationNote: '', validatorSignature: `${auth.me?.fullName}` }" />
          <Button v-if="auth.can('workorders.cancel') && !['CERRADA', 'CANCELADA'].includes(w.status)" label="Cancelar" icon="pi pi-times" severity="danger" text @click="cancel" />
        </div>
      </div>

      <Message v-if="w.status === 'CANCELADA'" severity="secondary" :closable="false" class="mb">Orden cancelada: {{ w.cancelReason }}</Message>
      <Message v-if="['PENDIENTE_REPUESTOS', 'PENDIENTE_PROVEEDOR'].includes(w.status)" severity="warn" :closable="false" class="mb">En pausa: {{ w.pauseReason }}</Message>
      <Message v-if="w.asset.criticality === 'CRITICA' && w.status === 'PENDIENTE_VALIDACION'" severity="warn" :closable="false" class="mb">Activo CRÍTICO: solo un responsable técnico autorizado puede declararlo reparado y liberarlo.</Message>

      <div class="grid" style="grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); align-items: start">
        <div>
          <div class="card">
            <dl class="kv">
              <div><dt>Responsable / técnico</dt><dd>{{ w.assignedTo?.fullName ?? 'Sin asignar' }}</dd></div>
              <div><dt>Proveedor</dt><dd>{{ w.supplier?.name ?? '—' }}</dd></div>
              <div><dt>Fecha programada</dt><dd>{{ fmtDate(w.scheduledDate) }}<span v-if="w.activity && w.activity.originalDate !== w.activity.committedDate" class="muted"> (original {{ fmtDate(w.activity.originalDate) }})</span></dd></div>
              <div><dt>Inicio / fin</dt><dd>{{ fmtDateTime(w.startedAt) }} / {{ fmtDateTime(w.finishedAt) }}</dd></div>
              <div v-if="w.activity"><dt>Actividad del cronograma</dt><dd>{{ w.activity.program.code }} · plan {{ w.activity.plan.year }}</dd></div>
              <div v-if="w.failureReport"><dt>Reporte de falla</dt><dd><RouterLink :to="`/correctivos/${w.failureReport.id}`">{{ w.failureReport.code }}</RouterLink></dd></div>
              <div v-if="w.parent"><dt>Generada desde</dt><dd><RouterLink :to="`/ordenes/${w.parent.id}`">{{ w.parent.code }}</RouterLink></dd></div>
              <div v-if="w.children.length"><dt>Correctivas derivadas</dt><dd><RouterLink v-for="c in w.children" :key="c.id" :to="`/ordenes/${c.id}`" style="margin-right: 6px">{{ c.code }}</RouterLink></dd></div>
              <div style="grid-column: 1 / -1"><dt>Descripción</dt><dd class="pre">{{ w.description ?? '—' }}</dd></div>
              <div v-if="w.activity?.program?.procedure" style="grid-column: 1 / -1"><dt>Procedimiento técnico</dt><dd class="pre">{{ w.activity.program.procedure }}</dd></div>
            </dl>
          </div>

          <div class="card">
            <div class="card-title"><h2>Registro de ejecución</h2><span v-if="!editable && !['CERRADA', 'CANCELADA', 'PENDIENTE_VALIDACION'].includes(w.status)" class="muted">Disponible al iniciar la ejecución</span></div>
            <fieldset :disabled="!editable" class="fs">
              <div class="form">
                <div class="field"><label>Inicio</label><DatePicker v-model="ex.startedAt" show-time hour-format="24" date-format="dd/mm/yy" show-icon :disabled="!editable" /></div>
                <div class="field"><label>Finalización</label><DatePicker v-model="ex.finishedAt" show-time hour-format="24" date-format="dd/mm/yy" show-icon :disabled="!editable" /><small>Si se deja vacía se registra al solicitar validación.</small></div>
                <div class="field"><label>Tipo de intervención</label><InputText v-model="ex.interventionType" /></div>
                <div class="field"><label>Condición final del activo <span class="req">*</span></label><Select v-model="ex.finalCondition" :options="opts(FINAL_CONDITION)" option-label="label" option-value="value" :disabled="!editable" /></div>
                <div v-if="isCorr" class="field full"><label>Diagnóstico técnico <span class="req">*</span></label><Textarea v-model="ex.diagnosis" rows="3" auto-resize /></div>
                <div class="field full"><label>Actividades ejecutadas <span class="req">*</span></label><Textarea v-model="ex.activitiesPerformed" rows="3" auto-resize data-testid="activities" /></div>
              </div>
              <template v-if="ex.checklistResults.length">
                <h3 class="mt mb">Lista de chequeo <span v-if="requiredMissing" class="muted">({{ requiredMissing }} obligatorios pendientes)</span></h3>
                <table class="cl">
                  <tr v-for="c in ex.checklistResults" :key="c.itemId">
                    <td>{{ c.text }} <span v-if="c.required" class="req">*</span></td>
                    <td style="width: 300px"><SelectButton v-model="c.result" :options="opts(CHECK_RESULT)" option-label="label" option-value="value" :disabled="!editable" size="small" /></td>
                    <td style="width: 30%"><InputText v-model="c.note" placeholder="Observación" style="width: 100%" /></td>
                  </tr>
                </table>
              </template>
              <div class="form mt">
                <div class="field full"><label>Hallazgos</label><Textarea v-model="ex.findings" rows="2" auto-resize /></div>
                <div class="field" :class="{ full: !isCorr }"><label>Resultado <span v-if="!isCorr" class="req">*</span></label><Textarea v-model="ex.result" rows="2" auto-resize data-testid="result" /></div>
                <div v-if="isCorr" class="field"><label>Pruebas realizadas <span class="req">*</span></label><Textarea v-model="ex.testsPerformed" rows="2" auto-resize /></div>
                <div class="field"><label>Mano de obra (COP)</label><InputNumber v-model="ex.laborCost" mode="currency" currency="COP" locale="es-CO" :min-fraction-digits="0" :min="0" :disabled="!editable" /></div>
                <div class="field"><label>Servicios externos (COP)</label><InputNumber v-model="ex.externalCost" mode="currency" currency="COP" locale="es-CO" :min-fraction-digits="0" :min="0" :disabled="!editable" /></div>
              </div>
            </fieldset>
            <div v-if="editable" class="actions mt">
              <Button label="Guardar avance" icon="pi pi-save" severity="secondary" outlined @click="saveExecution()" />
              <Button label="Pendiente de repuestos" severity="warn" text @click="pause('PENDIENTE_REPUESTOS')" />
              <Button label="Pendiente de proveedor" severity="warn" text @click="pause('PENDIENTE_PROVEEDOR')" />
              <Button v-if="w.type === 'PREVENTIVA' && auth.can('failures.report')" label="Registrar falla detectada" icon="pi pi-exclamation-triangle" severity="warn" text @click="corr.visible = true" />
              <span class="spacer" />
              <Button v-if="w.status === 'EN_EJECUCION'" label="Solicitar validación" icon="pi pi-check-square" data-testid="btn-submit" @click="submit" />
            </div>
          </div>

          <div class="card">
            <div class="card-title"><h2>Repuestos y costos</h2><Button v-if="editable" label="Agregar repuesto" icon="pi pi-plus" size="small" @click="part.visible = true" /></div>
            <DataTable :value="w.parts" size="small">
              <template #empty><div class="empty">Sin repuestos.</div></template>
              <Column field="name" header="Repuesto" />
              <Column field="partNumber" header="Referencia" />
              <Column header="Cantidad"><template #body="{ data }">{{ Number(data.quantity) }}</template></Column>
              <Column header="Unitario"><template #body="{ data }">{{ fmtCOP(data.unitCost) }}</template></Column>
              <Column header="Total"><template #body="{ data }">{{ fmtCOP(data.totalCost) }}</template></Column>
              <Column v-if="editable" style="width: 50px"><template #body="{ data }"><Button icon="pi pi-trash" text severity="danger" aria-label="Retirar" @click="removePart(data.id)" /></template></Column>
            </DataTable>
            <dl class="kv mt">
              <div><dt>Mano de obra</dt><dd>{{ fmtCOP(w.laborCost) }}</dd></div>
              <div><dt>Servicios externos</dt><dd>{{ fmtCOP(w.externalCost) }}</dd></div>
              <div><dt>Repuestos</dt><dd>{{ fmtCOP(w.partsCost) }}</dd></div>
              <div><dt>Costo total</dt><dd><strong>{{ fmtCOP(w.totalCost) }}</strong></dd></div>
            </dl>
          </div>
          <div class="card"><DocumentsPanel :link="{ workOrderId: w.id }" :readonly="['CERRADA', 'CANCELADA'].includes(w.status) && !auth.can('workorders.verify')" default-type="FOTOGRAFIA" /></div>
        </div>

        <div>
          <div v-if="w.verifiedAt" class="card">
            <h3 class="mb">Validación técnica</h3>
            <dl class="kv" style="grid-template-columns: 1fr">
              <div><dt>Verificó</dt><dd>{{ w.verifiedBy?.fullName }}</dd></div>
              <div><dt>Fecha</dt><dd>{{ fmtDateTime(w.verifiedAt) }}</dd></div>
              <div><dt>Identificación</dt><dd>{{ w.validatorSignature }}</dd></div>
              <div><dt>Observación</dt><dd class="pre">{{ w.verificationNote }}</dd></div>
            </dl>
          </div>
          <div class="card">
            <h3 class="mb">Historial de la orden</h3>
            <ol class="tl">
              <li v-for="e in [...w.events].reverse()" :key="e.id">
                <div class="row"><strong>{{ e.action.replaceAll('_', ' ').toLowerCase() }}</strong><StatusTag v-if="e.toStatus && e.toStatus !== e.fromStatus" :value="e.toStatus" kind="wo" /></div>
                <div class="muted">{{ fmtDateTime(e.createdAt) }} · {{ e.user }}</div>
                <div v-if="e.note" class="pre">{{ e.note }}</div>
              </li>
            </ol>
          </div>
        </div>
      </div>

      <Dialog v-model:visible="asg.visible" modal header="Asignar responsable" :style="{ width: '480px', maxWidth: '95vw' }">
        <div class="grid">
          <div class="field"><label>Responsable <span class="req">*</span></label><Select v-model="asg.assignedToId" :options="cat.users" option-label="fullName" option-value="id" filter /></div>
          <div class="field"><label>Proveedor (intervención externa)</label><Select v-model="asg.supplierId" :options="cat.suppliers" option-label="name" option-value="id" filter show-clear /></div>
          <div class="field"><label>Nota</label><Textarea v-model="asg.note" rows="2" /></div>
        </div>
        <template #footer><Button label="Cancelar" text severity="secondary" @click="asg.visible = false" /><Button label="Asignar" :disabled="!asg.assignedToId" @click="assign" /></template>
      </Dialog>
      <Dialog v-model:visible="part.visible" modal header="Registrar repuesto" :style="{ width: '480px', maxWidth: '95vw' }">
        <div class="form">
          <div class="field full"><label>Repuesto <span class="req">*</span></label><InputText v-model="part.name" /></div>
          <div class="field"><label>Referencia</label><InputText v-model="part.partNumber" /></div>
          <div class="field"><label>Cantidad</label><InputNumber v-model="part.quantity" :min="0.01" :max-fraction-digits="2" /></div>
          <div class="field full"><label>Valor unitario (COP)</label><InputNumber v-model="part.unitCost" mode="currency" currency="COP" locale="es-CO" :min-fraction-digits="0" :min="0" /></div>
        </div>
        <template #footer><Button label="Cancelar" text severity="secondary" @click="part.visible = false" /><Button label="Agregar" :disabled="part.name.trim().length < 2 || !part.quantity" @click="addPart" /></template>
      </Dialog>
      <Dialog v-model:visible="close.visible" modal header="Validación técnica y cierre" :style="{ width: '560px', maxWidth: '95vw' }">
        <p class="muted mb">Verifique que la intervención está completa y documentada. Al cerrar: la actividad preventiva queda ejecutada, se actualiza el estado del activo y, si aplica, se resuelve la falla con autorización de liberación.</p>
        <div class="grid">
          <div class="field"><label>Resultado de la verificación <span class="req">*</span></label><Textarea v-model="close.verificationNote" rows="3" /></div>
          <div class="field"><label>Identificación de quien valida (nombre, cargo, documento) <span class="req">*</span></label><InputText v-model="close.validatorSignature" /></div>
        </div>
        <template #footer><Button label="Cancelar" text severity="secondary" @click="close.visible = false" /><Button label="Validar y cerrar" severity="success" :disabled="close.verificationNote.trim().length < 10 || close.validatorSignature.trim().length < 5" data-testid="btn-confirm-close" @click="doClose" /></template>
      </Dialog>
      <Dialog v-model:visible="corr.visible" modal header="Falla detectada durante el mantenimiento" :style="{ width: '600px', maxWidth: '95vw' }">
        <div class="form">
          <div class="field full"><label>Título <span class="req">*</span></label><InputText v-model="corr.title" /></div>
          <div class="field full"><label>Descripción <span class="req">*</span></label><Textarea v-model="corr.description" rows="3" /></div>
          <div class="field"><label>Condición del activo</label><Select v-model="corr.assetCondition" :options="opts(ASSET_CONDITION)" option-label="label" option-value="value" /></div>
          <div class="field"><label>Impacto en la atención / seguridad del paciente</label><SelectButton v-model="corr.safety" :options="scale" :allow-empty="false" /></div>
          <div class="field"><label>Impacto asistencial</label><SelectButton v-model="corr.care" :options="scale" :allow-empty="false" /></div>
          <div class="field"><label>Continuidad del servicio</label><SelectButton v-model="corr.continuity" :options="scale" :allow-empty="false" /></div>
        </div>
        <template #footer><Button label="Cancelar" text severity="secondary" @click="corr.visible = false" /><Button label="Registrar falla y orden correctiva" :disabled="corr.title.length < 3 || corr.description.length < 10" @click="createCorrective" /></template>
      </Dialog>
      <ReasonDialog ref="reason" />
    </template>
    <div v-else class="grid"><Skeleton height="120px" /><Skeleton height="400px" /></div>
  </div>
</template>

<style scoped>
.fs { border: 0; padding: 0; margin: 0; min-width: 0; }
.cl { width: 100%; border-collapse: collapse; }
.cl td { border-bottom: 1px solid var(--app-border); padding: 6px 4px; }
.req { color: #b91c1c; }
.tl { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
.tl li { border-left: 3px solid var(--p-primary-200); padding-left: 10px; }
@media (max-width: 1000px) { .grid[style] { grid-template-columns: 1fr !important; } }
</style>
