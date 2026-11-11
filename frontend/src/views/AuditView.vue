<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { download, http } from '@/api/http';
import { useAuth } from '@/stores/auth';
import { useCatalog } from '@/stores/catalog';
import { useNotify } from '@/utils/notify';
import { dateToYmd, fmtDateTime } from '@/utils/format';

/** Bitácora de auditoría (solo lectura; inmutable en la base de datos) y registro de respaldos */
const auth = useAuth();
const cat = useCatalog();
const n = useNotify();
const tab = ref(auth.can('audit.read') ? 'audit' : 'backups');
const items = ref<Record<string, any>[]>([]);
const total = ref(0);
const loading = ref(false);
const page = ref({ first: 0, rows: 50 });
const facets = ref<{ modules: string[]; actions: string[] }>({ modules: [], actions: [] });
const f = ref({ q: '', module: null as string | null, action: null as string | null, userId: null as string | null, from: null as Date | null, to: null as Date | null });
const backups = ref<Record<string, any>[]>([]);
const detail = ref<Record<string, any> | null>(null);

const params = () => ({ q: f.value.q || undefined, module: f.value.module || undefined, action: f.value.action || undefined, userId: f.value.userId || undefined, from: dateToYmd(f.value.from) || undefined, to: dateToYmd(f.value.to) || undefined });
async function load() {
  if (!auth.can('audit.read')) return;
  loading.value = true;
  try {
    const r = await http.get('/audit', { params: { ...params(), page: page.value.first / page.value.rows + 1, pageSize: page.value.rows } });
    items.value = r.data.items;
    total.value = r.data.total;
  } catch (e) {
    n.error(e);
  } finally {
    loading.value = false;
  }
}
let t: ReturnType<typeof setTimeout>;
watch(f, () => {
  clearTimeout(t);
  t = setTimeout(() => {
    page.value.first = 0;
    void load();
  }, 300);
}, { deep: true });
onMounted(async () => {
  await load();
  try {
    if (auth.can('audit.read')) facets.value = (await http.get('/audit/facets')).data;
    if (auth.can('backups.read')) backups.value = (await http.get('/backups')).data;
  } catch (e) {
    n.error(e);
  }
});
const size = (b: string | null) => (b ? `${(Number(b) / 1048576).toFixed(2)} MB` : '—');
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Auditoría del sistema</h1><div class="sub">Registro inmutable de operaciones: usuario, fecha y hora (Bogotá), operación, módulo, registro, valores anteriores y nuevos, justificación e IP.</div></div>
      <div class="actions"><Button v-if="auth.can('audit.read')" label="Exportar Excel" icon="pi pi-file-excel" severity="secondary" outlined @click="n.run(() => download('/audit/export.xlsx', params()), 'Bitácora exportada')" /></div>
    </div>
    <div class="card">
      <Tabs v-model:value="tab">
        <TabList><Tab v-if="auth.can('audit.read')" value="audit">Bitácora</Tab><Tab v-if="auth.can('backups.read')" value="backups">Respaldos</Tab></TabList>
        <TabPanels>
          <TabPanel value="audit">
            <div class="filters">
              <InputText v-model="f.q" placeholder="Usuario, registro o justificación" />
              <Select v-model="f.module" :options="facets.modules" placeholder="Módulo" show-clear filter />
              <Select v-model="f.action" :options="facets.actions" placeholder="Operación" show-clear filter />
              <Select v-model="f.userId" :options="cat.users" option-label="fullName" option-value="id" placeholder="Usuario" show-clear filter />
              <DatePicker v-model="f.from" date-format="dd/mm/yy" placeholder="Desde" show-icon show-button-bar />
              <DatePicker v-model="f.to" date-format="dd/mm/yy" placeholder="Hasta" show-icon show-button-bar />
            </div>
            <DataTable :value="items" :loading="loading" lazy paginator :rows="page.rows" :first="page.first" :total-records="total" size="small" row-hover class="clickable" @page="(e) => { page = { first: e.first, rows: e.rows }; load(); }" @row-click="(e) => (detail = e.data)">
              <Column header="Fecha y hora"><template #body="{ data }"><span class="nowrap">{{ fmtDateTime(data.createdAt) }}</span></template></Column>
              <Column header="Usuario"><template #body="{ data }">{{ data.username ?? 'sistema' }}</template></Column>
              <Column field="module" header="Módulo" />
              <Column field="action" header="Operación" />
              <Column header="Registro"><template #body="{ data }">{{ data.entity }}<div class="muted mono" style="font-size: 0.75rem">{{ data.entityId }}</div></template></Column>
              <Column header="Justificación"><template #body="{ data }">{{ data.reason ?? '' }}</template></Column>
              <Column field="ip" header="IP" />
            </DataTable>
          </TabPanel>
          <TabPanel value="backups">
            <Message severity="info" :closable="false" class="mb">El servicio de respaldo registra cada copia diaria de PostgreSQL y de documentos. Un respaldo solo se considera exitoso si el archivo existe, tiene tamaño coherente y su contenido pudo verificarse (catálogo pg_restore y, periódicamente, restauración de prueba).</Message>
            <DataTable :value="backups" size="small" paginator :rows="25">
              <template #empty><div class="empty">Aún no hay respaldos registrados. Verifique que el servicio "backup" esté en ejecución.</div></template>
              <Column header="Inicio"><template #body="{ data }">{{ fmtDateTime(data.startedAt) }}</template></Column>
              <Column header="Tipo"><template #body="{ data }">{{ data.kind === 'DB' ? 'Base de datos' : 'Documentos' }}</template></Column>
              <Column field="fileName" header="Archivo" />
              <Column header="Tamaño"><template #body="{ data }">{{ size(data.sizeBytes) }}</template></Column>
              <Column header="Estado"><template #body="{ data }"><Tag :value="data.status" :severity="data.status === 'OK' ? 'success' : 'danger'" /></template></Column>
              <Column header="Verificado"><template #body="{ data }"><Tag :value="data.verified ? 'Sí' : 'No'" :severity="data.verified ? 'success' : 'warn'" /><div class="muted">{{ data.verifyMessage }}</div></template></Column>
              <Column header="Prueba de restauración"><template #body="{ data }"><Tag v-if="data.restoreTested" value="Restaurado OK" severity="success" /></template></Column>
              <Column header="SHA-256"><template #body="{ data }"><span class="mono muted" :title="data.sha256">{{ data.sha256?.slice(0, 12) }}</span></template></Column>
            </DataTable>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </div>
    <Dialog :visible="!!detail" modal header="Detalle del registro de auditoría" :style="{ width: '760px', maxWidth: '96vw' }" @update:visible="detail = null">
      <template v-if="detail">
        <dl class="kv mb">
          <div><dt>Fecha</dt><dd>{{ fmtDateTime(detail.createdAt) }}</dd></div><div><dt>Usuario</dt><dd>{{ detail.username }}</dd></div>
          <div><dt>Operación</dt><dd>{{ detail.module }} · {{ detail.action }}</dd></div><div><dt>IP</dt><dd>{{ detail.ip }}</dd></div>
          <div style="grid-column: 1 / -1"><dt>Justificación</dt><dd>{{ detail.reason ?? '—' }}</dd></div>
        </dl>
        <div class="grid g2">
          <div><h3 class="mb">Valores anteriores</h3><pre class="json">{{ detail.before ? JSON.stringify(detail.before, null, 2) : '—' }}</pre></div>
          <div><h3 class="mb">Valores nuevos</h3><pre class="json">{{ detail.after ? JSON.stringify(detail.after, null, 2) : '—' }}</pre></div>
        </div>
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.json { background: #f8fafc; border: 1px solid var(--app-border); border-radius: 6px; padding: 8px; font-size: 0.78rem; max-height: 360px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
</style>
