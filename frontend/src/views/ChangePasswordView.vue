<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { errMsg, http } from '@/api/http';
import { useAuth } from '@/stores/auth';
import { useNotify } from '@/utils/notify';

const auth = useAuth();
const router = useRouter();
const n = useNotify();
const current = ref('');
const next = ref('');
const confirm = ref('');
const error = ref('');
const loading = ref(false);
const rules = computed(() => [
  { ok: next.value.length >= 10, t: 'Al menos 10 caracteres' },
  { ok: /[a-z]/.test(next.value) && /[A-Z]/.test(next.value), t: 'Mayúsculas y minúsculas' },
  { ok: /\d/.test(next.value), t: 'Al menos un número' },
  { ok: /[^A-Za-z0-9]/.test(next.value), t: 'Al menos un símbolo' },
  { ok: !!next.value && !next.value.toLowerCase().includes(auth.me?.username.toLowerCase() ?? '~'), t: 'No contiene el nombre de usuario' },
  { ok: !!next.value && next.value === confirm.value, t: 'La confirmación coincide' },
]);

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await http.post('/auth/change-password', { currentPassword: current.value, newPassword: next.value });
    await auth.fetchMe();
    n.ok('Contraseña actualizada. Las demás sesiones fueron cerradas.');
    await router.replace('/');
  } catch (e) {
    error.value = errMsg(e);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="page" style="max-width: 560px">
    <div class="card">
      <h1 class="mb">Cambiar contraseña</h1>
      <Message v-if="auth.me?.mustChangePassword" severity="warn" :closable="false" class="mb">Debe establecer una nueva contraseña antes de continuar.</Message>
      <Message v-if="error" severity="error" :closable="false" class="mb">{{ error }}</Message>
      <form class="grid" @submit.prevent="submit">
        <div class="field"><label>Contraseña actual</label><Password v-model="current" :feedback="false" toggle-mask autocomplete="current-password" fluid /></div>
        <div class="field"><label>Nueva contraseña</label><Password v-model="next" :feedback="false" toggle-mask autocomplete="new-password" fluid /></div>
        <div class="field"><label>Confirmar nueva contraseña</label><Password v-model="confirm" :feedback="false" toggle-mask autocomplete="new-password" fluid /></div>
        <ul class="rules">
          <li v-for="r in rules" :key="r.t" :class="{ ok: r.ok }"><i :class="r.ok ? 'pi pi-check-circle' : 'pi pi-circle'" /> {{ r.t }}</li>
        </ul>
        <div class="actions">
          <Button type="submit" label="Guardar" :loading="loading" :disabled="!current || rules.some((r) => !r.ok)" />
          <Button v-if="!auth.me?.mustChangePassword" label="Cancelar" text severity="secondary" @click="router.back()" />
          <Button v-else label="Cerrar sesión" text severity="secondary" @click="auth.logout().then(() => router.push('/login'))" />
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.rules { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; font-size: 0.85rem; color: var(--app-muted); }
.rules li.ok { color: #15803d; }
</style>
