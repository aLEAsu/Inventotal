<script setup lang="ts">
import { ref } from 'vue';

/**
 * Diálogo de confirmación para operaciones críticas que exigen justificación.
 * Uso: const r = await reasonDlg.value.ask({ title, message, min }) → string | null
 */
const visible = ref(false);
const title = ref('');
const message = ref('');
const label = ref('Justificación');
const confirmLabel = ref('Confirmar');
const danger = ref(false);
const min = ref(10);
const text = ref('');
let resolver: ((v: string | null) => void) | null = null;

function ask(o: { title: string; message?: string; label?: string; min?: number; confirmLabel?: string; danger?: boolean; initial?: string }) {
  title.value = o.title;
  message.value = o.message ?? '';
  label.value = o.label ?? 'Justificación';
  min.value = o.min ?? 10;
  confirmLabel.value = o.confirmLabel ?? 'Confirmar';
  danger.value = !!o.danger;
  text.value = o.initial ?? '';
  visible.value = true;
  return new Promise<string | null>((res) => (resolver = res));
}
function close(v: string | null) {
  visible.value = false;
  resolver?.(v);
  resolver = null;
}
defineExpose({ ask });
</script>

<template>
  <Dialog v-model:visible="visible" modal :header="title" :style="{ width: '520px', maxWidth: '95vw' }" @hide="close(null)">
    <p v-if="message" class="mb">{{ message }}</p>
    <div class="field">
      <label>{{ label }} <span v-if="min > 0" class="req">*</span></label>
      <Textarea v-model="text" rows="4" auto-resize autofocus />
      <small v-if="min > 0">Mínimo {{ min }} caracteres ({{ text.trim().length }}).</small>
    </div>
    <template #footer>
      <Button label="Cancelar" severity="secondary" text @click="close(null)" />
      <Button :label="confirmLabel" :severity="danger ? 'danger' : undefined" :disabled="text.trim().length < min" @click="close(text.trim())" />
    </template>
  </Dialog>
</template>
