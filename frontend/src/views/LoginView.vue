<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errMsg } from '@/api/http';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';

const auth = useAuth();
const cat = useCatalog();
const router = useRouter();
const route = useRoute();
const username = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

onMounted(() => cat.loadPublic());

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    await auth.login(username.value, password.value);
    const r = typeof route.query.r === 'string' && route.query.r.startsWith('/') && !route.query.r.startsWith('//') ? route.query.r : '/';
    await router.replace(auth.me?.mustChangePassword ? '/cambiar-contrasena' : r);
  } catch (e) {
    error.value = errMsg(e);
    password.value = '';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="wrap">
    <form class="box" @submit.prevent="submit">
      <div class="brand-logos"><img src="/brand/unop.png" alt="UNO-P Unidad Oncológica del Putumayo" /></div>
      <div class="head">
        <div>
          <h1>Gestión de mantenimiento</h1>
          <div class="muted">Equipos de cómputo y sistemas</div>
        </div>
      </div>
      <Message v-if="error" severity="error" :closable="false" class="mb" data-testid="login-error">{{ error }}</Message>
      <div class="field mb">
        <label for="u">Usuario</label>
        <InputText id="u" v-model="username" autocomplete="username" autofocus required />
      </div>
      <div class="field mb">
        <label for="p">Contraseña</label>
        <Password v-model="password" input-id="p" :feedback="false" toggle-mask autocomplete="current-password" required fluid />
      </div>
      <Button type="submit" label="Ingresar" icon="pi pi-sign-in" :loading="loading" class="w-full" :disabled="!username || !password" />
      <p class="foot muted">Uso exclusivo del personal autorizado. Las operaciones quedan registradas en la bitácora de auditoría.</p>
    </form>
  </div>
</template>

<style scoped>
.wrap { min-height: 100vh; display: grid; place-items: center; padding: 16px; background: linear-gradient(160deg, #0f2a3d 0%, #13405c 55%, #e8eef3 55%); }
.box { width: 400px; max-width: 100%; background: #fff; border-radius: 14px; padding: 28px; box-shadow: 0 20px 50px rgba(15, 42, 61, 0.25); }
.head { display: flex; gap: 12px; align-items: center; margin-bottom: 22px; }
.brand-logos { display: flex; align-items: center; justify-content: center; gap: 18px; margin-bottom: 18px; padding-bottom: 16px; border-bottom: 1px solid var(--app-border); }
.brand-logos img { height: 64px; width: auto; max-width: 80%; object-fit: contain; }
.w-full { width: 100%; }
.foot { font-size: 0.76rem; margin: 16px 0 0; text-align: center; }
</style>
