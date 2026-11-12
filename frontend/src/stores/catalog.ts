import { defineStore } from 'pinia';
import { palette, updatePrimaryPalette } from '@primeuix/themes';
import { http } from '@/api/http';

export interface Opt {
  id: string;
  name: string;
}
export interface Category extends Opt {
  code: string;
  color: string | null;
  isActive: boolean;
  assetCount?: number;
  subcategories: (Opt & { categoryId: string; isActive: boolean; assetCount?: number })[];
}
export interface UserOpt {
  id: string;
  fullName: string;
  roleCode: string;
  isTechnicalStaff: boolean;
}
export interface AssetOpt {
  id: string;
  code: string;
  name: string;
  areaId: string;
  criticality: string;
  status: string;
  location: { name: string } | null;
}

/** Catálogos compartidos (áreas, ubicaciones, categorías, usuarios, proveedores) y parámetros de identidad */
export const useCatalog = defineStore('catalog', {
  state: () => ({
    areas: [] as (Opt & { code: string; isActive: boolean })[],
    locations: [] as (Opt & { code: string; areaId: string | null; isActive: boolean; building: string | null; floor: string | null })[],
    categories: [] as Category[],
    users: [] as UserOpt[],
    suppliers: [] as (Opt & { type: string })[],
    assets: [] as AssetOpt[],
    settings: {} as Record<string, unknown>,
    year: new Date().getFullYear(),
    today: '',
    loadedAt: 0,
  }),
  getters: {
    institution: (s) => String(s.settings['institution.name'] ?? 'Institución'),
    shortName: (s) => String(s.settings['institution.shortName'] ?? 'SIGM'),
    activeAreas: (s) => s.areas.filter((a) => a.isActive),
    activeCategories: (s) => s.categories.filter((c) => c.isActive),
    technicians: (s) => s.users,
  },
  actions: {
    async load(force = false) {
      if (!force && Date.now() - this.loadedAt < 60_000) return;
      const [a, l, c, u, s, sp, y] = await Promise.all([
        http.get('/areas'), http.get('/locations'), http.get('/categories'), http.get('/users/options'),
        http.get('/settings/public'), http.get('/suppliers/options'), http.get('/plans/current-year'),
      ]);
      this.areas = a.data;
      this.locations = l.data;
      this.categories = c.data;
      this.users = u.data;
      this.settings = s.data;
      this.suppliers = sp.data;
      this.year = y.data.year;
      this.today = y.data.today;
      this.loadedAt = Date.now();
      this.applyBrand();
    },
    async loadAssets() {
      this.assets = (await http.get('/assets/options')).data;
    },
    async loadPublic() {
      try {
        this.settings = (await http.get('/settings/public')).data;
        this.applyBrand();
      } catch {
        /* sin sesión: identidad por defecto */
      }
    },
    applyBrand() {
      const color = String(this.settings['institution.primaryColor'] ?? '');
      if (/^#[0-9a-fA-F]{6}$/.test(color)) updatePrimaryPalette(palette(color));
      document.title = `${this.shortName} · ${this.institution}`;
    },
  },
});
