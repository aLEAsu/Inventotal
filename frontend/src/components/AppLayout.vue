<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  LayoutDashboard, Monitor, ClipboardList, CalendarRange, ShieldCheck, Wrench, ListChecks, FileHeart, Truck, FolderOpen,
  BarChart3, Users, Settings, ScrollText, LogOut, Menu as MenuIcon, KeyRound,
} from 'lucide-vue-next';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';

const auth = useAuth();
const cat = useCatalog();
const route = useRoute();
const router = useRouter();
const open = ref(false);

const items = computed(() =>
  [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, show: auth.can('dashboard.read') },
    { to: '/activos', label: 'Inventario de activos', icon: Monitor, show: auth.can('assets.read') },
    { to: '/plan-maestro', label: 'Plan maestro', icon: ClipboardList, show: auth.can('programs.read') },
    { to: '/cronograma', label: 'Cronograma anual', icon: CalendarRange, show: auth.can('plans.read') },
    { to: '/preventivos', label: 'Mantenimientos preventivos', icon: ShieldCheck, show: auth.canAny('workorders.read', 'workorders.read_all') },
    { to: '/correctivos', label: 'Mantenimientos correctivos', icon: Wrench, show: auth.canAny('failures.read', 'failures.read_all', 'failures.report') },
    { to: '/ordenes', label: 'Órdenes de trabajo', icon: ListChecks, show: auth.canAny('workorders.read', 'workorders.read_all') },
    { to: '/hojas-de-vida', label: 'Hojas de vida', icon: FileHeart, show: auth.can('assets.read') },
    { to: '/proveedores', label: 'Proveedores y contratos', icon: Truck, show: auth.can('suppliers.read') },
    { to: '/documentos', label: 'Documentos y evidencias', icon: FolderOpen, show: auth.can('documents.read') },
    { to: '/informes', label: 'Informes e indicadores', icon: BarChart3, show: auth.can('reports.read') },
    { to: '/usuarios', label: 'Usuarios y permisos', icon: Users, show: auth.can('users.read') },
    { to: '/configuracion', label: 'Configuración', icon: Settings, show: auth.canAny('catalog.manage', 'settings.manage', 'criticality.configure', 'procedures.read') },
    { to: '/auditoria', label: 'Auditoría del sistema', icon: ScrollText, show: auth.canAny('audit.read', 'backups.read') },
  ].filter((i) => i.show),
);

const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to));
watch(() => route.fullPath, () => (open.value = false));
onMounted(() => cat.load());

async function logout() {
  await auth.logout();
  await router.push({ name: 'login' });
}
</script>

<template>
  <div class="shell" :class="{ open }">
    <aside class="sidebar no-print" aria-label="Menú principal">
      <div class="brand">
        <div class="logo">{{ cat.shortName.slice(0, 4) }}</div>
        <div>
          <div class="bname">{{ cat.shortName }}</div>
          <div class="binst" :title="cat.institution">{{ cat.institution }}</div>
        </div>
      </div>
      <div class="scope">Mantenimiento de equipos de cómputo y sistemas</div>
      <nav>
        <RouterLink v-for="i in items" :key="i.to" :to="i.to" class="nav" :class="{ active: isActive(i.to) }">
          <component :is="i.icon" :size="18" :stroke-width="1.8" />
          <span>{{ i.label }}</span>
        </RouterLink>
      </nav>
    </aside>
    <div class="backdrop no-print" @click="open = false" />
    <div class="main">
      <header class="topbar no-print">
        <button class="hamb" aria-label="Abrir menú" @click="open = !open"><MenuIcon :size="20" /></button>
        <div class="spacer" />
        <div class="user">
          <div class="uname">{{ auth.me?.fullName }}</div>
          <div class="urole">{{ auth.me?.role.name }}<template v-if="auth.me?.areas.length"> · {{ auth.me.areas.map((a) => a.name).join(', ') }}</template></div>
        </div>
        <RouterLink to="/cambiar-contrasena" class="icon-btn" title="Cambiar contraseña" aria-label="Cambiar contraseña"><KeyRound :size="18" /></RouterLink>
        <button class="icon-btn" title="Cerrar sesión" aria-label="Cerrar sesión" @click="logout"><LogOut :size="18" /></button>
      </header>
      <main><RouterView /></main>
    </div>
  </div>
</template>

<style scoped>
.shell { display: flex; min-height: 100vh; }
.sidebar { width: var(--sidebar-w); background: var(--app-sidebar); color: var(--app-sidebar-text); position: fixed; inset: 0 auto 0 0; overflow-y: auto; z-index: 30; display: flex; flex-direction: column; }
.brand { display: flex; gap: 10px; align-items: center; padding: 16px 14px 8px; }
.logo { width: 40px; height: 40px; border-radius: 9px; background: var(--p-primary-500); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 0.78rem; letter-spacing: 0.03em; flex: none; }
.bname { color: #fff; font-weight: 700; }
.binst { font-size: 0.75rem; opacity: 0.8; max-width: 170px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scope { font-size: 0.72rem; margin: 0 14px 10px; padding: 6px 8px; border-radius: 6px; background: rgba(255, 255, 255, 0.06); }
nav { display: flex; flex-direction: column; padding: 4px 8px 20px; gap: 2px; }
.nav { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 7px; color: var(--app-sidebar-text); font-size: 0.9rem; }
.nav:hover { background: rgba(255, 255, 255, 0.07); text-decoration: none; }
.nav.active { background: rgba(255, 255, 255, 0.13); color: var(--app-sidebar-active); font-weight: 600; }
.main { flex: 1; margin-left: var(--sidebar-w); min-width: 0; }
.topbar { position: sticky; top: 0; z-index: 20; background: #fff; border-bottom: 1px solid var(--app-border); height: 56px; display: flex; align-items: center; gap: 10px; padding: 0 18px; }
.user { text-align: right; line-height: 1.2; }
.uname { font-weight: 600; font-size: 0.9rem; }
.urole { font-size: 0.76rem; color: var(--app-muted); }
.icon-btn { border: 1px solid var(--app-border); background: #fff; border-radius: 8px; width: 34px; height: 34px; display: grid; place-items: center; color: #334155; cursor: pointer; }
.hamb { display: none; border: 0; background: transparent; cursor: pointer; }
.backdrop { display: none; }
@media (max-width: 960px) {
  .sidebar { transform: translateX(-100%); transition: transform 0.2s; }
  .shell.open .sidebar { transform: none; }
  .shell.open .backdrop { display: block; position: fixed; inset: 0; background: rgba(15, 23, 42, 0.4); z-index: 25; }
  .main { margin-left: 0; }
  .hamb { display: grid; }
  .urole { display: none; }
}
@media print { .main { margin-left: 0; } }
</style>
