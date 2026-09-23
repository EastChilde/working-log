<script setup lang="ts">
import { computed, ref } from "vue";
import { useTaskStore } from "../stores/tasks";
import { monthGrid, daysBetween, fmtCn, WEEK_HEAD } from "../utils/date";

const props = defineProps<{ year: number; month: number; selected: string; today: string }>();
const emit = defineEmits<{ (e: "select", key: string): void }>();
const store = useTaskStore();

interface Cell { key: string; day: number; dim: boolean; created: number; done: number; hasDeadline: boolean; overdue: boolean; top: { title: string; done: boolean; pri: string | null }[] }
const cells = computed<Cell[]>(() =>
  monthGrid(props.year, props.month).map((c) => {
    const created = (store.byCreatedDate[c.key] || []).length;
    const done = (store.byCreatedDate[c.key] || []).filter((t) => t.status === "done").length;
    const hasDeadline = store.openTasks.some((t) => t.deadline === c.key);
    const overdue = hasDeadline && daysBetween(props.today, c.key) <= 0;
    // 任务只归属创建日：完成划线显示在创建那天，完成日不重复显示
    const top = store.tasks
      .filter((t) => t.created_at === c.key)
      .slice(0, 2)
      .map((t) => ({ title: t.title, done: t.status === "done", pri: t.priority }));
    return { ...c, created, done, hasDeadline, overdue, top };
  }),
);

function badgeClass(c: Cell) {
  if (!c.created) return "b-gray";
  if (c.done >= c.created) return "b-green";
  if (c.done > 0) return "b-yellow";
  return "b-red";
}

/* 紧急级别 → 圆点样式 */
function priCls(p: string | null) {
  return p === "高" ? "hi" : p === "中" ? "mid" : p === "低" ? "low" : "none";
}

/* 悬浮提示：显示当日完整任务列表 */
const tip = ref<{ x: number; y: number; key: string } | null>(null);
const tipTasks = computed(() =>
  tip.value
    ? store.tasks
        .filter((t) => t.created_at === tip.value!.key)
        .map((t) => ({ id: t.id, title: t.title, done: t.status === "done", pri: t.priority }))
    : [],
);
function dayCount(key: string) {
  return (store.byCreatedDate[key] || []).length;
}
function onEnter(e: MouseEvent, c: Cell) {
  if (c.dim || !dayCount(c.key)) return;
  tip.value = { x: e.clientX, y: e.clientY, key: c.key };
}
function onMove(e: MouseEvent) {
  if (tip.value) {
    tip.value.x = e.clientX;
    tip.value.y = e.clientY;
  }
}
function onLeave() {
  tip.value = null;
}
/* 提示框定位：靠右/靠下时自动翻转 */
function tipLeft() {
  return Math.min((tip.value?.x || 0) + 14, window.innerWidth - 320) + "px";
}
function tipTop() {
  const n = Math.min(tipTasks.value.length, 12);
  return Math.min((tip.value?.y || 0) + 14, window.innerHeight - 60 - n * 22) + "px";
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
      @mouseenter="onEnter($event, c)"
      @mousemove="onMove"
      @mouseleave="onLeave"
    >
      <div class="cell-top">
        <span class="d">{{ c.day }}</span>
        <span v-if="c.overdue" class="flag" title="有截止任务">🚩</span>
        <span class="badge" :class="badgeClass(c)">{{ c.created ? c.done + '/' + c.created : '—' }}</span>
      </div>
      <div v-for="(t, i) in c.top" :key="i" class="t" :class="{ done: t.done }">
        <span v-if="t.pri" class="pri-dot" :class="priCls(t.pri)" :title="'紧急级别：' + t.pri"></span>
        <span class="txt">{{ t.done ? '✓ ' : '' }}{{ t.title }}</span>
      </div>
      <div v-if="c.created > 2" class="t more">还有 {{ c.created - 2 }} 项…</div>
    </div>
  </div>

  <!-- 悬浮任务提示（跟随鼠标，靠边自动翻转） -->
  <Teleport to="body">
    <div
      v-if="tip"
      class="cal-tip"
      :style="{ left: tipLeft(), top: tipTop() }"
    >
      <div class="tip-head">{{ fmtCn(tip.key) }} · {{ tipTasks.length }} 项</div>
      <div v-for="t in tipTasks.slice(0, 12)" :key="t.id" class="tip-row" :class="{ done: t.done }">
        <span v-if="t.pri" class="pri-dot" :class="priCls(t.pri)"></span>
        <span>{{ t.done ? '✓ ' : '' }}{{ t.title }}</span>
      </div>
      <div v-if="tipTasks.length > 12" class="tip-more">…共 {{ tipTasks.length }} 项，点击日期查看全部</div>
    </div>
  </Teleport>
</template>
