<script setup lang="ts">
import { computed } from "vue";
import { useTaskStore } from "../stores/tasks";
import { fmtCn } from "../utils/date";
import type { Task } from "../types";

const props = defineProps<{ selected: string; today: string }>();
const store = useTaskStore();

const list = computed(() => store.tasks.filter((t) => t.created_at === props.selected));
const doneN = computed(() => list.value.filter((t) => t.status === "done").length);
const isToday = computed(() => props.selected === props.today);

function priCls(p: Task["priority"]) {
  return p === "高" ? "hi" : p === "中" ? "mid" : p === "低" ? "low" : "none";
}

/** 预计结束日期展示：临近（<=2天）高亮，逾期红色 */
function dueMeta(t: Task): { txt: string; cls: string } | null {
  if (!t.deadline || t.status === "done") return null;
  const diff = Math.round((new Date(t.deadline + "T00:00:00").getTime() - new Date(props.today + "T00:00:00").getTime()) / 86400000);
  if (diff < 0) return { txt: `预计 ${t.deadline.slice(5)} 结束 · 已逾期 ${-diff} 天`, cls: "overdue" };
  if (diff <= 2) return { txt: `预计 ${t.deadline.slice(5)} 结束${diff === 0 ? " · 就是今天" : ""}`, cls: "soon" };
  return { txt: `预计 ${t.deadline.slice(5)} 结束`, cls: "" };
}
</script>

<template>
  <div class="daypanel">
    <div class="dp-head">
      <h3>{{ fmtCn(selected) }}{{ isToday ? " · 今天" : "" }}</h3>
      <div class="sub">{{ doneN }}/{{ list.length }} 完成</div>
    </div>
    <button class="dp-addbtn" @click="store.openEditor(selected)">
      <span class="plus">＋</span>新增任务
    </button>
    <div class="dp-body">
      <div v-for="t in list" :key="t.id" class="task" :class="{ done: t.status === 'done' }">
        <div class="chk" :class="{ on: t.status === 'done' }" @click="store.toggle(t.id)">{{ t.status === 'done' ? '✓' : '' }}</div>
        <div class="t-main" @click="store.openEditor(t)">
          <div class="t-title">
            <button
              class="pri-dot"
              :class="priCls(t.priority)"
              :title="t.priority ? '紧急级别：' + t.priority + '（点击切换）' : '未设置紧急级别（点击设为低）'"
              @click.stop="store.setPriority(t.id, t.priority === null ? '低' : t.priority === '低' ? '中' : t.priority === '中' ? '高' : null)"
            ></button>
            <span>{{ t.title }}</span>
          </div>
          <div v-if="t.status === 'done' && t.completed_at" class="t-meta">
            <span class="ok">{{ t.created_at.slice(5) }} 创建 → {{ t.completed_at.slice(5) }} 完成</span>
          </div>
          <div v-else-if="dueMeta(t)" class="t-meta" :class="dueMeta(t)!.cls">{{ dueMeta(t)!.txt }}</div>
        </div>
        <button class="t-edit" title="编辑任务" @click.stop="store.openEditor(t)">✎</button>
        <button class="del" title="删除" @click.stop="store.remove(t.id)">✕</button>
      </div>
      <div v-if="!list.length" class="dp-empty">这一天还没有任务<br />点上方「新增任务」添加</div>
    </div>
  </div>
</template>
