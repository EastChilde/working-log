<script setup lang="ts">
import { computed } from "vue";
import { useTaskStore } from "../stores/tasks";
import { monthGrid, daysBetween, WEEK_HEAD } from "../utils/date";

const props = defineProps<{ year: number; month: number; selected: string; today: string }>();
const emit = defineEmits<{ (e: "select", key: string): void }>();
const store = useTaskStore();

interface Cell { key: string; day: number; dim: boolean; created: number; done: number; hasDeadline: boolean; overdue: boolean; top: { title: string; done: boolean }[] }
const cells = computed<Cell[]>(() =>
  monthGrid(props.year, props.month).map((c) => {
    const created = (store.byCreatedDate[c.key] || []).length;
    const done = store.doneByDate[c.key] || 0;
    const hasDeadline = store.openTasks.some((t) => t.deadline === c.key);
    const overdue = hasDeadline && daysBetween(props.today, c.key) <= 0;
    const top = store.tasks
      .filter((t) => t.created_at === c.key || (t.status === "done" && t.completed_at === c.key))
      .slice(0, 2)
      .map((t) => ({ title: t.title, done: t.status === "done" }));
    return { ...c, created, done, hasDeadline, overdue, top };
  }),
);

function badgeClass(c: Cell) {
  if (!c.created) return "b-gray";
  if (c.done >= c.created) return "b-green";
  if (c.done > 0) return "b-yellow";
  return "b-red";
}
</script>

<template>
  <div class="cal-head">
    <div v-for="w in WEEK_HEAD" :key="w">{{ w }}</div>
  </div>
  <div class="cal-grid">
    <div
      v-for="c in cells"
      :key="c.key + c.day"
      class="cell"
      :class="{ dim: c.dim, sel: c.key === selected, today: c.key === today }"
      @click="!c.dim && emit('select', c.key)"
    >
      <div class="cell-top">
        <span class="d">{{ c.day }}</span>
        <span v-if="c.overdue" class="flag" title="有截止任务">🚩</span>
        <span class="badge" :class="badgeClass(c)">{{ c.created ? c.done + '/' + c.created : '—' }}</span>
      </div>
      <div v-for="(t, i) in c.top" :key="i" class="t" :class="{ done: t.done }">{{ t.done ? '✓ ' : '' }}{{ t.title }}</div>
      <div v-if="c.created > 2" class="t more">还有 {{ c.created - 2 }} 项…</div>
    </div>
  </div>
</template>
