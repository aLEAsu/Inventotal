<script setup lang="ts">
import { computed } from 'vue';
import * as L from '@/utils/labels';

const props = defineProps<{ value: string | null | undefined; kind: 'asset' | 'crit' | 'priority' | 'activity' | 'plan' | 'wo' | 'failure' | 'resched' }>();
const map = {
  asset: L.ASSET_STATUS, crit: L.CRITICALITY, priority: L.PRIORITY, activity: L.ACTIVITY_STATUS, plan: L.PLAN_STATUS,
  wo: L.WO_STATUS, failure: L.FAILURE_STATUS, resched: L.RESCHEDULE_STATUS,
};
const v = computed(() => (props.value ? map[props.kind][props.value] : undefined));
</script>

<template>
  <Tag v-if="v" :value="v.label" :severity="v.sev" class="nowrap" />
  <span v-else class="muted">—</span>
</template>
