<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { http } from '@/api/http';
import { useAuth } from '@/stores/auth';
import { useNotify } from '@/utils/notify';
import { fmtDateTime } from '@/utils/format';
import { DOC_TYPE, opts } from '@/utils/labels';
import ReasonDialog from './ReasonDialog.vue';

/** Documentos y evidencias asociados a un registro (activo, orden, falla, proveedor, contrato o plan) */
const props = defineProps<{ link: Partial<Record<'assetId' | 'workOrderId' | 'failureReportId' | 'supplierId' | 'contractId' | 'planId', string>>; readonly?: boolean; defaultType?: string }>();
const emit = defineEmits<{ changed: [] }>();
const auth = useAuth();
const n = useNotify();
const docs = ref<{ id: string; type: string; title: string; originalName: string; mimeType: string; sizeBytes: number; uploadedAt: string; uploadedBy: string | null }[]>([]);
const loading = ref(false);
const showUpload = ref(false);
const form = ref({ type: props.defaultType ?? 'FOTOGRAFIA', title: '', description: '' });
const file = ref<File | null>(null);
const uploading = ref(false);
const reason = ref<InstanceType<typeof ReasonDialog>>();

async function load() {
  loading.value = true;
  try {
    docs.value = (await http.get('/documents', { params: { ...props.link, pageSize: 200 } })).data.items;
  } catch (e) {
    n.error(e);
  } finally {
    loading.value = false;
  }
}
function pick(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] ?? null;
  if (file.value && !form.value.title) form.value.title = file.value.name.replace(/\.[^.]+$/, '');
}
async function upload() {
  if (!file.value) return;
  uploading.value = true;
  const fd = new FormData();
  fd.append('type', form.value.type);
  fd.append('title', form.value.title);
  if (form.value.description) fd.append('description', form.value.description);
  for (const [k, v] of Object.entries(props.link)) if (v) fd.append(k, v);
  fd.append('file', file.value);
  const r = await n.run(() => http.post('/documents', fd), 'Documento adjuntado');
  uploading.value = false;
  if (r) {
    showUpload.value = false;
    file.value = null;
    form.value = { type: props.defaultType ?? 'FOTOGRAFIA', title: '', description: '' };
    await load();
    emit('changed');
  }
}
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
async function voidDoc(id: string) {
  const why = await reason.value!.ask({ title: 'Anular documento', message: 'El documento se conserva para trazabilidad, pero deja de mostrarse como vigente.', danger: true, confirmLabel: 'Anular' });
  if (!why) return;
  if (await n.run(() => http.post(`/documents/${id}/void`, { reason: why }), 'Documento anulado')) await load();
}
const size = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);
onMounted(load);
watch(() => JSON.stringify(props.link), load);
defineExpose({ load });
</script>

<template>
  <div>
    <div class="card-title">
      <h3>Documentos y evidencias</h3>
      <Button v-if="!readonly && auth.can('documents.upload')" label="Adjuntar" icon="pi pi-paperclip" size="small" @click="showUpload = true" />
    </div>
    <DataTable :value="docs" :loading="loading" size="small" data-key="id">
      <template #empty><div class="empty">No hay documentos adjuntos.</div></template>
      <Column header="Tipo"><template #body="{ data }">{{ DOC_TYPE[data.type] }}</template></Column>
      <Column header="Título"><template #body="{ data }"><a href="#" @click.prevent="open(data.id)">{{ data.title }}</a><div class="muted">{{ data.originalName }} · {{ size(data.sizeBytes) }}</div></template></Column>
      <Column header="Cargado"><template #body="{ data }"><span class="nowrap">{{ fmtDateTime(data.uploadedAt) }}</span><div class="muted">{{ data.uploadedBy }}</div></template></Column>
      <Column v-if="auth.can('documents.void') && !readonly" style="width: 60px"><template #body="{ data }"><Button icon="pi pi-ban" text rounded severity="danger" aria-label="Anular" v-tooltip.left="'Anular'" @click="voidDoc(data.id)" /></template></Column>
    </DataTable>

    <Dialog v-model:visible="showUpload" modal header="Adjuntar documento" :style="{ width: '520px', maxWidth: '95vw' }">
      <div class="form">
        <div class="field"><label>Tipo documental <span class="req">*</span></label><Select v-model="form.type" :options="opts(DOC_TYPE)" option-label="label" option-value="value" /></div>
        <div class="field"><label>Título <span class="req">*</span></label><InputText v-model="form.title" maxlength="200" /></div>
        <div class="field full"><label>Archivo <span class="req">*</span></label><input type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx" data-testid="file-input" @change="pick" /><small>PDF, JPG o PNG (otros formatos según configuración). El tipo real del archivo se verifica en el servidor.</small></div>
        <div class="field full"><label>Descripción</label><Textarea v-model="form.description" rows="2" /></div>
      </div>
      <template #footer>
        <Button label="Cancelar" text severity="secondary" @click="showUpload = false" />
        <Button label="Cargar" icon="pi pi-upload" :loading="uploading" :disabled="!file || form.title.trim().length < 2" @click="upload" />
      </template>
    </Dialog>
    <ReasonDialog ref="reason" />
  </div>
</template>
