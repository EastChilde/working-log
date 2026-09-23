<script setup lang="ts">
import { computed } from "vue";
import { useTaskStore } from "../stores/tasks";
import { daysBetween, fmtCn } from "../utils/date";
import type { Task } from "../types";

const store = useTaskStore();
const emit = defineEmits<{ (e: "open", id: string): void }>();

const today = computed(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
});

/** 往日滞留（未完成且创建日早于今天），按创建时间正序 */
const stay = computed(() =>
  store.openTasks.filter((t) => t.created_at < today.value).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)),
);
const todayList = computed(() => store.tasks.filter((t) => t.created_at === today.value));
const pastDates = computed(() =>
  [...new Set(store.tasks.filter((t) => t.created_at < today.value).map((t) => t.created_at))].sort().reverse(),
);

function rowMeta(t: Task): { text: string; cls: string }[] {
  const meta: { text: string; cls: string }[] = [];
  if (t.tag) meta.push({ text: t.tag, cls: "pill p-tag" });
  if (t.priority === "高") meta.push({ text: "紧急 · 高", cls: "pill p-hi" });
  if (t.priority === "中") meta.push({ text: "紧急 · 中", cls: "pill p-mid" });
  if (t.priority === "低") meta.push({ text: "紧急 · 低", cls: "pill p-low" });
  if (t.status !== "done" && t.created_at < today.value)
    meta.push({ text: `已滞留 ${daysBetween(t.created_at, today.value)} 天`, cls: "stay" });
  if (t.deadline && t.status !== "done") {
    const left = daysBetween(today.value, t.deadline);
    meta.push(left < 0 ? { text: `已逾期 ${-left} 天（截止 ${t.deadline.slice(5)}）`, cls: "over" } : { text: `🚩 截止 ${t.deadline.slice(5)}（剩 ${left} 天）`, cls: "stay" });
  }
  if (t.status === "done" && t.completed_at)
    meta.push({ text: `${t.created_at.slice(5)} 创建 → ${t.completed_at.slice(5)} 完成（${daysBetween(t.created_at, t.completed_at)} 天）`, cls: "ok" });
  return meta;
}
</script>

<template>
  <!-- 滞留任务置顶区 -->
  <div v-if="stay.length" class="stagnant-sec">
    <div class="st-title">⏳ 未完成 · 往日滞留 {{ stay.length }} 项（不会沉底）</div>
    <div v-for="t in stay" :key="t.id" class="task" :class="{ done: t.status === 'done' }">
      <div class="chk" :class="{ on: t.status === 'done' }" @click="store.toggle(t.id)">{{ t.status === 'done' ? '✓' : '' }}</div>
      <div class="t-main">
        <div class="t-title">{{ t.title }}</div>
        <div class="t-meta"><span v-for="(m, i) in rowMeta(t)" :key="i" :class="m.cls">{{ m.text }}</span></div>
        <div v-if="t.children" class="kids"></div>
      </div>
      <button class="del" title="删除" @click="store.remove(t.id)">✕</button>
    </div>
  </div>

  <!-- 今天 -->
  <div class="group-head"><b>☀️ 今天（{{ today.slice(5) }}）</b><span>{{ todayList.filter(t => t.status === 'done').length }}/{{ todayList.length }} 完成</span><div class="line"></div></div>
  <div v-for="t in todayList" :key="t.id" class="task" :class="{ done: t.status === 'done' }">
    <div class="chk" :class="{ on: t.status === 'done' }" @click="store.toggle(t.id)">{{ t.status === 'done' ? '✓' : '' }}</div>
    <div class="t-main">
      <div class="t-title">{{ t.title }}</div>
      <div class="t-meta"><span v-for="(m, i) in rowMeta(t)" :key="i" :class="m.cls">{{ m.text }}</span></div>
    </div>
    <button class="del" title="删除" @click="store.remove(t.id)">✕</button>
  </div>
  <div v-if="!todayList.length" class="empty">今天还没有任务，上方输入框快速添加</div>

  <!-- 往日分组 -->
  <template v-for="k in pastDates" :key="k">
    <div class="group-head">
      <b>{{ fmtCn(k) }}</b>
      <span>{{ store.tasks.filter(t => t.created_at === k && t.status === 'done').length }}/{{ store.tasks.filter(t => t.created_at === k).length }} 完成</span>
      <div class="line"></div>
    </div>
    <div v-for="t in store.tasks.filter(t => t.created_at === k)" :key="t.id" class="task" :class="{ done: t.status === 'done' }">
      <div class="chk" :class="{ on: t.status === 'done' }" @click="store.toggle(t.id)">{{ t.status === 'done' ? '✓' : '' }}</div>
      <div class="t-main">
        <div class="t-title">{{ t.title }}</div>
        <div class="t-meta"><span v-for="(m, i) in rowMeta(t)" :key="i" :class="m.cls">{{ m.text }}</span></div>
      </div>
      <button class="del" title="删除" @click="store.remove(t.id)">✕</button>
    </div>
  </template>
</template>
