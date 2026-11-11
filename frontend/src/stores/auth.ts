import { defineStore } from 'pinia';
import { http, setCsrf } from '@/api/http';

export interface Me {
  id: string;
  username: string;
  fullName: string;
  role: { code: string; name: string; scope: 'ALL' | 'AREA' | 'OWN' };
  permissions: string[];
  areas: { id: string; name: string }[];
  isTechnicalStaff: boolean;
  mustChangePassword: boolean;
  csrfToken: string;
}

export const useAuth = defineStore('auth', {
  state: () => ({ me: null as Me | null, loaded: false }),
  getters: {
    isLogged: (s) => !!s.me,
  },
  actions: {
    can(...perms: string[]) {
      return !!this.me && perms.every((p) => this.me!.permissions.includes(p));
    },
    canAny(...perms: string[]) {
      return !!this.me && perms.some((p) => this.me!.permissions.includes(p));
    },
    async fetchMe() {
      try {
        const r = await http.get<Me>('/auth/me');
        this.me = r.data;
        setCsrf(r.data.csrfToken);
      } catch {
        this.me = null;
      } finally {
        this.loaded = true;
      }
    },
    async login(username: string, password: string) {
      const r = await http.post<{ csrfToken: string }>('/auth/login', { username, password });
      setCsrf(r.data.csrfToken);
      await this.fetchMe();
    },
    async logout() {
      try {
        await http.post('/auth/logout');
      } finally {
        this.me = null;
        setCsrf('');
      }
    },
  },
});
