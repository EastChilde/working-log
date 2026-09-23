<script setup lang="ts">
import { computed, ref } from "vue";
import { useTaskStore } from "../stores/tasks";
import { fmtCn } from "../utils/date";
import type { Task } from "../types";

const props = defineProps<{ selected: string; today: string }>();
const store = useTaskStore();
const input = ref("");
const newPri = ref<Task["priority"]>(null);

const list = computed(() => store.tasks.filter((t) => t.created_at === props.selected));
const doneN = computed(() => list.value.filter((t) => t.status === "done").length);
const isToday = computed(() => props.selected === props.today);

async function add() {
  if (!input.value.trim()) return;
  await store.add(input.value, props.selected, null, newPri.value);
  input.value = "";
  newPri.value = null;
}

const PRI: { v: Task["priority"]; label: string; cls: string }[] = [
  { v: "高", label: "高", cls: "hi" },
  { v: "中", label: "中", cls: "mid" },
  { v: "低", label: "低", cls: "low" },
];
function priCls(p: Task["priority"]) {
  return p === "高" ? "hi" : p === "中" ? "mid" : p === "低" ? "low" : "none";
}
/** 点击圆点循环：无 → 低 → 中 → 高 → 无 */
function cyclePri(t: Task) {
  const next = t.priority === null ? "低" : t.priority === "低" ? "中" : t.priority === "中" ? "高" : null;
  store.setPriority(t.id, next);
}
</script>

<template>
  <div class="daypanel">
    <div class="dp-head">
      <h3>{{ fmtCn(selected) }}{{ isToday ? " · 今天" : "" }}</h3>
      <div class="sub">{{ doneN }}/{{ list.length }} 完成</div>
    </div>
    <div class="dp-body">
      <div v-for="t in list" :key="t.id" class="task" :class="{ done: t.status === 'done' }">
        <div class="chk" :class="{ on: t.status === 'done' }" @click="store.toggle(t.id)">{{ t.status === 'done' ? '✓' : '' }}</div>
        <div class="t-main">
          <div class="t-title" style="display:flex;align-items:center;gap:6px;">
            <button
              class="pri-dot"
              :class="priCls(t.priority)"
              :title="t.priority ? '紧急级别：' + t.priority + '（点击切换）' : '未设置紧急级别（点击设为低）'"
              @click.stop="cyclePri(t)"
            ></button>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ t.title }}</span>
          </div>
          <div v-if="t.status === 'done' && t.completed_at" class="t-meta">
            <span class="ok">{{ t.created_at.slice(5) }} 创建 → {{ t.completed_at.slice(5) }} 完成</span>
          </div>
        </div>
        <button class="del" @click="store.remove(t.id)">✕</button>
      </div>
      <div v-if="!list.length" class="dp-empty">这一天还没有任务<br />下方可直接添加</div>
    </div>
    <div class="dp-add pri-row">
      <div class="pri-pick" title="紧急级别（可不选）">
        <button
          v-for="p in PRI"
          :key="p.v"
          class="pri-dot"
          :class="[p.cls, { pick: newPri === p.v }]"
          :title="'设为' + p.label"
          @click="newPri = newPri === p.v ? null : p.v"
        ></button>
      </div>
      <input v-model="input" placeholder="添加任务到这一天…" @keydown.enter="add" />
      <button @click="add">＋</button>
    </div>
  </div>
</template>
