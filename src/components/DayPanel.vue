<script setup lang="ts">
import { computed, ref } from "vue";
import { useTaskStore } from "../stores/tasks";
import { fmtCn } from "../utils/date";

const props = defineProps<{ selected: string; today: string }>();
const store = useTaskStore();
const input = ref("");

const list = computed(() => store.tasks.filter((t) => t.created_at === props.selected));
const doneN = computed(() => list.value.filter((t) => t.status === "done").length);
const isToday = computed(() => props.selected === props.today);

async function add() {
  if (!input.value.trim()) return;
  await store.add(input.value, props.selected);
  input.value = "";
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
          <div class="t-title">{{ t.title }}</div>
          <div v-if="t.status === 'done' && t.completed_at" class="t-meta">
            <span class="ok">{{ t.created_at.slice(5) }} 创建 → {{ t.completed_at.slice(5) }} 完成</span>
          </div>
        </div>
        <button class="del" @click="store.remove(t.id)">✕</button>
      </div>
      <div v-if="!list.length" class="dp-empty">这一天还没有任务<br />下方可直接添加</div>
    </div>
    <div class="dp-add">
      <input v-model="input" placeholder="添加任务到这一天…" @keydown.enter="add" />
      <button @click="add">＋</button>
    </div>
  </div>
</template>
