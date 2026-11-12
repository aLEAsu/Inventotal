<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { http } from '@/api/http';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { fmtDateTime } from '@/utils/format';

const auth = useAuth();
const cat = useCatalog();
const n = useNotify();
const users = ref<Record<string, any>[]>([]);
const roles = ref<{ id: string; code: string; name: string; description: string; scope: string; permissions: string[]; userCount: number }[]>([]);
const perms = ref<{ code: string; module: string; description: string }[]>([]);
const q = ref('');
const canManage = computed(() => auth.can('users.manage'));

async function load() {
  try {
    const [u, r, p] = await Promise.all([http.get('/users', { params: { q: q.value || undefined, pageSize: 500 } }), http.get('/roles'), http.get('/permissions')]);
    users.value = u.data.items;
    roles.value = r.data;
    perms.value = p.data;
  } catch (e) {
    n.error(e);
  }
}
onMounted(load);

const form = ref({ visible: false, id: '', username: '', fullName: '', email: '', documentId: '', position: '', roleId: null as string | null, areaIds: [] as string[], isTechnicalStaff: false, isActive: true, password: '' });
function openNew() {
  form.value = { visible: true, id: '', username: '', fullName: '', email: '', documentId: '', position: '', roleId: null, areaIds: [], isTechnicalStaff: false, isActive: true, password: '' };
}
function openEdit(u: Record<string, any>) {
  form.value = { visible: true, id: u.id, username: u.username, fullName: u.fullName, email: u.email ?? '', documentId: u.documentId ?? '', position: u.position ?? '', roleId: u.role.id, areaIds: u.areas.map((a: { id: string }) => a.id), isTechnicalStaff: u.isTechnicalStaff, isActive: u.isActive, password: '' };
}
async function save() {
  const fv = form.value;
  const base = { fullName: fv.fullName, email: fv.email, documentId: fv.documentId, position: fv.position, roleId: fv.roleId, areaIds: fv.areaIds, isTechnicalStaff: fv.isTechnicalStaff };
  const r = await n.run<unknown>(() => (fv.id ? http.patch(`/users/${fv.id}`, { ...base, isActive: fv.isActive }) : http.post('/users', { ...base, username: fv.username, password: fv.password })), fv.id ? 'Usuario actualizado' : 'Usuario creado. Deberá cambiar la contraseña en su primer ingreso.');
  if (r) {
    const released = (r as { data?: { released?: { activities: number; programs: number; openWorkOrders: number } } }).data?.released;
    if (released && (released.activities || released.programs || released.openWorkOrders)) {
      n.info(`Usuario desactivado: ${released.activities} actividad(es) y ${released.programs} programa(s) quedaron sin responsable${released.openWorkOrders ? `; reasigne sus ${released.openWorkOrders} orden(es) abiertas` : ''}`);
    }
    form.value.visible = false;
    await load();
    await cat.load(true);
  }
}
const pwd = ref({ visible: false, id: '', name: '', password: '' });
async function resetPwd() {
  if (await n.run(() => http.post(`/users/${pwd.value.id}/reset-password`, { password: pwd.value.password }), 'Contraseña temporal asignada. Las sesiones del usuario fueron cerradas.')) pwd.value.visible = false;
}
async function unlock(id: string) {
  if (await n.run(() => http.post(`/users/${id}/unlock`), 'Usuario desbloqueado')) await load();
}
const selectedRole = computed(() => roles.value.find((r) => r.id === form.value.roleId));
// Matriz de permisos
const modules = computed(() => [...new Set(perms.value.map((p) => p.module))]);
const edited = ref<Record<string, Set<string>>>({});
function has(roleId: string, code: string) {
  return (edited.value[roleId] ?? new Set(roles.value.find((r) => r.id === roleId)!.permissions)).has(code);
}
function toggle(roleId: string, code: string) {
  const s = new Set(edited.value[roleId] ?? roles.value.find((r) => r.id === roleId)!.permissions);
  if (s.has(code)) s.delete(code);
  else s.add(code);
  edited.value = { ...edited.value, [roleId]: s };
}
async function saveRole(roleId: string) {
  if (await n.run(() => http.put(`/roles/${roleId}/permissions`, { permissions: [...edited.value[roleId]] }), 'Permisos actualizados')) {
    delete edited.value[roleId];
    await load();
  }
}
const scopeLabel: Record<string, string> = { ALL: 'Todas las áreas', AREA: 'Solo sus áreas', OWN: 'Solo sus registros' };
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Usuarios y permisos</h1><div class="sub">El control de acceso se aplica en el servidor por módulo, acción y área.</div></div>
      <div class="actions"><Button v-if="canManage" label="Nuevo usuario" icon="pi pi-user-plus" @click="openNew" /></div>
    </div>
    <div class="card">
      <Tabs value="users">
        <TabList><Tab value="users">Usuarios ({{ users.length }})</Tab><Tab value="roles">Roles y matriz de permisos</Tab></TabList>
        <TabPanels>
          <TabPanel value="users">
            <div class="filters"><InputText v-model="q" placeholder="Buscar usuario" @keyup.enter="load" /><Button label="Buscar" text @click="load" /></div>
            <DataTable :value="users" size="small" paginator :rows="25">
              <Column header="Usuario"><template #body="{ data }"><strong>{{ data.fullName }}</strong><div class="muted mono">{{ data.username }}</div></template></Column>
              <Column header="Rol"><template #body="{ data }">{{ data.role.name }}<div class="muted">{{ data.areas.map((a: any) => a.name).join(', ') }}</div></template></Column>
              <Column field="position" header="Cargo" />
              <Column header="Competencia técnica"><template #body="{ data }"><Tag v-if="data.isTechnicalStaff" value="Certificada" severity="info" /></template></Column>
              <Column header="Estado"><template #body="{ data }"><Tag :value="data.isActive ? 'Activo' : 'Inactivo'" :severity="data.isActive ? 'success' : 'secondary'" /><Tag v-if="data.lockedUntil && new Date(data.lockedUntil) > new Date()" value="Bloqueado" severity="danger" style="margin-left: 4px" /><Tag v-if="data.mustChangePassword" value="Cambio de clave pendiente" severity="warn" style="margin-left: 4px" /></template></Column>
              <Column header="Último ingreso"><template #body="{ data }">{{ fmtDateTime(data.lastLoginAt) }}</template></Column>
              <Column v-if="canManage" style="width: 150px"><template #body="{ data }">
                <Button icon="pi pi-pencil" text rounded aria-label="Editar" v-tooltip="'Editar'" @click="openEdit(data)" />
                <Button icon="pi pi-key" text rounded aria-label="Restablecer contraseña" v-tooltip="'Restablecer contraseña'" @click="pwd = { visible: true, id: data.id, name: data.fullName, password: '' }" />
                <Button v-if="data.lockedUntil" icon="pi pi-lock-open" text rounded aria-label="Desbloquear" v-tooltip="'Desbloquear'" @click="unlock(data.id)" />
              </template></Column>
            </DataTable>
          </TabPanel>
          <TabPanel value="roles">
            <div class="mx-wrap">
              <table class="pm">
                <thead><tr><th>Permiso</th><th v-for="r in roles" :key="r.id" class="rc">{{ r.name }}<div class="muted">{{ scopeLabel[r.scope] }}</div><Button v-if="canManage && edited[r.id]" label="Guardar" size="small" @click="saveRole(r.id)" /></th></tr></thead>
                <tbody>
                  <template v-for="m in modules" :key="m">
                    <tr class="mod"><td :colspan="roles.length + 1">{{ m }}</td></tr>
                    <tr v-for="p in perms.filter((x) => x.module === m)" :key="p.code">
                      <td>{{ p.description }}<div class="muted mono">{{ p.code }}</div></td>
                      <td v-for="r in roles" :key="r.id" class="rc"><Checkbox :model-value="has(r.id, p.code)" binary :disabled="!canManage || r.code === 'ADMIN'" @update:model-value="toggle(r.id, p.code)" /></td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>

    <Dialog v-model:visible="form.visible" modal :header="form.id ? 'Editar usuario' : 'Nuevo usuario'" :style="{ width: '700px', maxWidth: '96vw' }">
      <div class="form">
        <div class="field"><label>Usuario <span class="req">*</span></label><InputText v-model="form.username" :disabled="!!form.id" /></div>
        <div class="field"><label>Nombre completo <span class="req">*</span></label><InputText v-model="form.fullName" /></div>
        <div class="field"><label>Correo institucional</label><InputText v-model="form.email" /></div>
        <div class="field"><label>Documento</label><InputText v-model="form.documentId" /></div>
        <div class="field"><label>Cargo</label><InputText v-model="form.position" /></div>
        <div class="field"><label>Rol <span class="req">*</span></label><Select v-model="form.roleId" :options="roles" option-label="name" option-value="id" /><small v-if="selectedRole">{{ selectedRole.description }}</small></div>
        <div v-if="selectedRole?.scope === 'AREA'" class="field full"><label>Áreas asignadas</label><MultiSelect v-model="form.areaIds" :options="cat.areas" option-label="name" option-value="id" display="chip" /></div>
        <div class="field full"><label class="row"><Checkbox v-model="form.isTechnicalStaff" binary /> Competencia técnica certificada (puede liberar activos críticos si su rol lo permite)</label></div>
        <div v-if="form.id" class="field"><label class="row"><ToggleSwitch v-model="form.isActive" /> Usuario activo</label></div>
        <div v-if="!form.id" class="field full"><label>Contraseña temporal <span class="req">*</span></label><Password v-model="form.password" toggle-mask :feedback="false" fluid /><small>Mín. 10 caracteres con mayúsculas, minúsculas, número y símbolo. El usuario deberá cambiarla al ingresar.</small></div>
      </div>
      <template #footer><Button label="Cancelar" text severity="secondary" @click="form.visible = false" /><Button label="Guardar" :disabled="!form.username || !form.fullName || !form.roleId || (!form.id && form.password.length < 10)" @click="save" /></template>
    </Dialog>
    <Dialog v-model:visible="pwd.visible" modal :header="`Restablecer contraseña · ${pwd.name}`" :style="{ width: '440px', maxWidth: '95vw' }">
      <div class="field"><label>Contraseña temporal</label><Password v-model="pwd.password" toggle-mask :feedback="false" fluid /><small>El usuario deberá cambiarla al ingresar. Se cerrarán sus sesiones activas.</small></div>
      <template #footer><Button label="Cancelar" text severity="secondary" @click="pwd.visible = false" /><Button label="Restablecer" :disabled="pwd.password.length < 10" @click="resetPwd" /></template>
    </Dialog>
  </div>
</template>

<style scoped>
.mx-wrap { overflow: auto; max-height: 70vh; }
.pm { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
.pm th { position: sticky; top: 0; background: #f8fafc; padding: 8px; border-bottom: 1px solid var(--app-border); text-align: left; z-index: 1; }
.pm td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; }
.pm .rc { text-align: center; min-width: 110px; }
.pm .mod td { background: #eef2f7; font-weight: 600; }
</style>
