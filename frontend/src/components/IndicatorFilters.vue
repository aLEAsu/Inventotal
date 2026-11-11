<script setup lang="ts">
import { computed } from 'vue';
import { useCatalog } from '@/stores/catalog';
import { MONTHS } from '@/utils/format';

/** Filtros comunes de indicadores: año, mes, área, categoría y responsable */
export interface IndFilters {
  year: number;
  month: number | null;
  areaId: string | null;
  categoryId: string | null;
  responsibleId: string | null;
}
const model = defineModel<IndFilters>({ required: true });
const cat = useCatalog();
const years = computed(() => Array.from({ length: 8 }, (_, i) => cat.year + 1 - i));
const months = MONTHS.map((label, i) => ({ label, value: i + 1 }));
</script>

<template>
  <div class="filters">
    <Select v-model="model.year" :options="years" aria-label="Año" style="min-width: 110px" />
    <Select v-model="model.month" :options="months" option-label="label" option-value="value" placeholder="Todo el año" show-clear aria-label="Mes" />
    <Select v-model="model.areaId" :options="cat.areas" option-label="name" option-value="id" placeholder="Todas las áreas" show-clear filter aria-label="Área" />
    <Select v-model="model.categoryId" :options="cat.categories" option-label="name" option-value="id" placeholder="Todas las categorías" show-clear aria-label="Categoría" />
    <Select v-model="model.responsibleId" :options="cat.users" option-label="fullName" option-value="id" placeholder="Todos los responsables" show-clear filter aria-label="Responsable" />
  </div>
</template>
