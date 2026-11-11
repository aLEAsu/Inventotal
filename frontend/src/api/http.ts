import axios, { AxiosError } from 'axios';

/**
 * Cliente HTTP.
 * - La sesión viaja en una cookie HttpOnly (el frontend nunca la lee ni la guarda).
 * - El token CSRF se mantiene solo en memoria y se envía en X-CSRF-Token en escrituras.
 * - No se usa localStorage para credenciales.
 */
export const http = axios.create({ baseURL: '/api/v1', withCredentials: true, timeout: 120_000 });

let csrfToken = '';
export function setCsrf(t: string) {
  csrfToken = t;
}

http.interceptors.request.use((cfg) => {
  if (cfg.method && !['get', 'head', 'options'].includes(cfg.method.toLowerCase()) && csrfToken) {
    cfg.headers.set('X-CSRF-Token', csrfToken);
  }
  return cfg;
});

type Handler = (status: number, data: unknown) => void;
let onAuthError: Handler = () => {};
export function setAuthErrorHandler(h: Handler) {
  onAuthError = h;
}

http.interceptors.response.use(
  (r) => r,
  (e: AxiosError) => {
    const st = e.response?.status ?? 0;
    if (st === 401 || (st === 403 && (e.response?.data as { code?: string })?.code === 'MUST_CHANGE_PASSWORD')) onAuthError(st, e.response?.data);
    return Promise.reject(e);
  },
);

/** Mensaje legible de un error de la API */
export function errMsg(e: unknown): string {
  const ax = e as AxiosError<{ message?: string | string[]; missing?: string[] }>;
  if (ax?.response?.data) {
    const d = ax.response.data;
    if (d instanceof Blob) return 'No fue posible generar el archivo';
    const m = Array.isArray(d.message) ? d.message.join('; ') : d.message;
    if (m) return m;
  }
  if (ax?.code === 'ECONNABORTED') return 'La solicitud tardó demasiado. Intente nuevamente.';
  if (ax?.request && !ax.response) return 'No hay conexión con el servidor.';
  return (e as Error)?.message ?? 'Error inesperado';
}

/** Descarga un archivo binario generado por el backend (PDF / Excel) */
export async function download(url: string, params: Record<string, unknown> = {}, fallbackName = 'archivo') {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const r = await http.get(url, { params: clean, responseType: 'blob' });
  const cd = String(r.headers['content-disposition'] ?? '');
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const href = URL.createObjectURL(r.data as Blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return name;
}

export interface Page<T> {
  items: T[];
  total: number;
}
