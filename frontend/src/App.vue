<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useToast } from 'primevue/usetoast';
import { setAuthErrorHandler } from '@/api/http';
import { useAuth } from '@/stores/auth';

const router = useRouter();
const toast = useToast();
const auth = useAuth();

setAuthErrorHandler((status) => {
  if (status === 401 && auth.me) {
    auth.me = null;
    toast.add({ severity: 'warn', summary: 'Sesión finalizada', detail: 'Su sesión expiró. Inicie sesión nuevamente.', life: 5000 });
    void router.push({ name: 'login', query: { r: router.currentRoute.value.fullPath } });
  } else if (status === 403 && auth.me) {
    void router.push({ name: 'change-password' });
  }
});
</script>

<template>
  <Toast position="top-right" />
  <ConfirmDialog />
  <RouterView />
</template>
