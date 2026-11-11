import { useToast } from 'primevue/usetoast';
import { errMsg } from '@/api/http';

/** Notificaciones de éxito y error homogéneas */
export function useNotify() {
  const toast = useToast();
  return {
    ok: (detail: string, summary = 'Operación exitosa') => toast.add({ severity: 'success', summary, detail, life: 3500 }),
    info: (detail: string, summary = 'Información') => toast.add({ severity: 'info', summary, detail, life: 4500 }),
    error: (e: unknown, summary = 'No se pudo completar la operación') => toast.add({ severity: 'error', summary, detail: errMsg(e), life: 7000 }),
    /** Ejecuta una operación mostrando error si falla; devuelve el resultado o null */
    async run<T>(fn: () => Promise<T>, success?: string): Promise<T | null> {
      try {
        const r = await fn();
        if (success) toast.add({ severity: 'success', summary: 'Operación exitosa', detail: success, life: 3500 });
        return r;
      } catch (e) {
        toast.add({ severity: 'error', summary: 'No se pudo completar la operación', detail: errMsg(e), life: 7000 });
        return null;
      }
    },
  };
}
