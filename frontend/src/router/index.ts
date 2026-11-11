import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useAuth } from '@/stores/auth';
import AppLayout from '@/components/AppLayout.vue';

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean;
    perms?: string[];
    anyPerms?: string[];
    title?: string;
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('@/views/LoginView.vue'), meta: { public: true, title: 'Iniciar sesión' } },
  { path: '/cambiar-contrasena', name: 'change-password', component: () => import('@/views/ChangePasswordView.vue'), meta: { title: 'Cambiar contraseña' } },
  { path: '/imprimir/cronograma/:year', name: 'print-schedule', component: () => import('@/views/SchedulePrintView.vue'), meta: { perms: ['plans.export'], title: 'Impresión del cronograma' } },
  {
    path: '/',
    component: AppLayout,
    children: [
      { path: '', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { title: 'Dashboard' } },
      { path: 'activos', name: 'assets', component: () => import('@/views/AssetsView.vue'), meta: { perms: ['assets.read'], title: 'Inventario de activos' } },
      { path: 'activos/:id', name: 'asset', component: () => import('@/views/AssetDetailView.vue'), meta: { perms: ['assets.read'], title: 'Hoja de vida' } },
      { path: 'hojas-de-vida', name: 'lifecycles', component: () => import('@/views/LifecyclesView.vue'), meta: { perms: ['assets.read'], title: 'Hojas de vida' } },
      { path: 'plan-maestro', name: 'programs', component: () => import('@/views/ProgramsView.vue'), meta: { perms: ['programs.read'], title: 'Plan maestro' } },
      { path: 'cronograma', name: 'schedule', component: () => import('@/views/ScheduleView.vue'), meta: { perms: ['plans.read'], title: 'Cronograma anual' } },
      { path: 'preventivos', name: 'preventive', component: () => import('@/views/PreventiveView.vue'), meta: { anyPerms: ['workorders.read', 'workorders.read_all'], title: 'Mantenimientos preventivos' } },
      { path: 'correctivos', name: 'failures', component: () => import('@/views/FailuresView.vue'), meta: { anyPerms: ['failures.read', 'failures.read_all', 'failures.report'], title: 'Mantenimientos correctivos' } },
      { path: 'correctivos/:id', name: 'failure', component: () => import('@/views/FailureDetailView.vue'), meta: { anyPerms: ['failures.read', 'failures.read_all'], title: 'Reporte de falla' } },
      { path: 'ordenes', name: 'workorders', component: () => import('@/views/WorkOrdersView.vue'), meta: { anyPerms: ['workorders.read', 'workorders.read_all'], title: 'Órdenes de trabajo' } },
      { path: 'ordenes/:id', name: 'workorder', component: () => import('@/views/WorkOrderDetailView.vue'), meta: { anyPerms: ['workorders.read', 'workorders.read_all'], title: 'Orden de trabajo' } },
      { path: 'proveedores', name: 'suppliers', component: () => import('@/views/SuppliersView.vue'), meta: { perms: ['suppliers.read'], title: 'Proveedores y contratos' } },
      { path: 'proveedores/:id', name: 'supplier', component: () => import('@/views/SupplierDetailView.vue'), meta: { perms: ['suppliers.read'], title: 'Proveedor' } },
      { path: 'documentos', name: 'documents', component: () => import('@/views/DocumentsView.vue'), meta: { perms: ['documents.read'], title: 'Documentos y evidencias' } },
      { path: 'informes', name: 'reports', component: () => import('@/views/ReportsView.vue'), meta: { perms: ['reports.read'], title: 'Informes e indicadores' } },
      { path: 'usuarios', name: 'users', component: () => import('@/views/UsersView.vue'), meta: { perms: ['users.read'], title: 'Usuarios y permisos' } },
      { path: 'configuracion', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { anyPerms: ['catalog.manage', 'settings.manage', 'criticality.configure', 'procedures.read'], title: 'Configuración' } },
      { path: 'auditoria', name: 'audit', component: () => import('@/views/AuditView.vue'), meta: { anyPerms: ['audit.read', 'backups.read'], title: 'Auditoría del sistema' } },
      { path: 'sin-acceso', name: 'forbidden', component: () => import('@/views/ForbiddenView.vue'), meta: { title: 'Sin acceso' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({ history: createWebHistory(), routes, scrollBehavior: () => ({ top: 0 }) });

router.beforeEach(async (to) => {
  const auth = useAuth();
  if (!auth.loaded) await auth.fetchMe();
  if (to.meta.public) return auth.isLogged && to.name === 'login' ? { name: 'dashboard' } : true;
  if (!auth.isLogged) return { name: 'login', query: { r: to.fullPath } };
  if (auth.me!.mustChangePassword && to.name !== 'change-password') return { name: 'change-password' };
  if (to.name === 'dashboard' && !auth.can('dashboard.read')) {
    if (auth.canAny('failures.report')) return { name: 'failures' };
    if (auth.canAny('workorders.read')) return { name: 'workorders' };
  }
  if (to.meta.perms && !auth.can(...to.meta.perms)) return { name: 'forbidden' };
  if (to.meta.anyPerms && !auth.canAny(...to.meta.anyPerms)) return { name: 'forbidden' };
  return true;
});

router.afterEach((to) => {
  if (to.meta.title) document.title = `${to.meta.title} · SIGM`;
});
