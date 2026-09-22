<script setup lang="ts">
import { computed, ref } from "vue";
import { useTaskStore } from "../stores/tasks";
import type { Task } from "../types";

const store = useTaskStore();

/* ---------------- 区间计算 ---------------- */
type Grain = "day" | "week" | "month" | "year" | "custom";
const grain = ref<Grain>("month");
const base = ref<"done" | "created">("done"); // 统计基准：完成日期 / 创建日期
const anchor = ref(todayStr()); // 锚点日期
const customFrom = ref(todayStr().slice(0, 8) + "01");
const customTo = ref(todayStr());

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parse(k: string): Date {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const range = computed<{ from: string; to: string; label: string }>(() => {
  const a = parse(anchor.value);
  if (grain.value === "day") {
    return { from: anchor.value, to: anchor.value, label: anchor.value };
  }
  if (grain.value === "week") {
    const dow = (a.getDay() + 6) % 7; // 周一=0
    const mon = new Date(a); mon.setDate(a.getDate() - dow);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: fmt(mon), to: fmt(sun), label: `${fmt(mon)} ~ ${fmt(sun)}` };
  }
  if (grain.value === "month") {
    const from = fmt(new Date(a.getFullYear(), a.getMonth(), 1));
    const to = fmt(new Date(a.getFullYear(), a.getMonth() + 1, 0));
    return { from, to, label: `${a.getFullYear()}年${a.getMonth() + 1}月` };
  }
  if (grain.value === "year") {
    return { from: `${a.getFullYear()}-01-01`, to: `${a.getFullYear()}-12-31`, label: `${a.getFullYear()}年` };
  }
  return { from: customFrom.value, to: customTo.value, label: `${customFrom.value} ~ ${customTo.value}` };
});

function shift(n: number) {
  const a = parse(anchor.value);
  if (grain.value === "day") a.setDate(a.getDate() + n);
  else if (grain.value === "week") a.setDate(a.getDate() + 7 * n);
  else if (grain.value === "month") a.setMonth(a.getMonth() + n);
  else if (grain.value === "year") a.setFullYear(a.getFullYear() + n);
  anchor.value = fmt(a);
}

/* ---------------- 范围内任务 ---------------- */
const tasksInRange = computed<Task[]>(() => {
  const { from, to } = range.value;
  return store.tasks.filter((t) => {
    const k = base.value === "done" ? t.completed_at : t.created_at;
    return !!k && k >= from && k <= to;
  });
});
const doneInRange = computed(() => tasksInRange.value.filter((t) => t.status === "done"));

/** 按基准日期分组（倒序） */
const groups = computed(() => {
  const map = new Map<string, Task[]>();
  for (const t of tasksInRange.value) {
    const k = (base.value === "done" ? t.completed_at : t.created_at)!;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
});

/* ---------------- 统计 ---------------- */
const stats = computed(() => {
  const { from, to } = range.value;
  const created = store.tasks.filter((t) => t.created_at >= from && t.created_at <= to);
  const doneCreated = created.filter((t) => t.status === "done").length;
  const done = doneInRange.value.length;
  // 平均耗时（天）
  let cost = 0, costN = 0;
  for (const t of doneInRange.value) {
    if (t.completed_at && t.created_at) {
      cost += (parse(t.completed_at).getTime() - parse(t.created_at).getTime()) / 86400000;
      costN++;
    }
  }
  return {
    done,
    created: created.length,
    rate: created.length ? Math.round((doneCreated / created.length) * 100) : null,
    avgCost: costN ? (cost / costN).toFixed(1) : null,
  };
});

/** 月度趋势（当年 1-12 月完成数） */
const trend = computed(() => {
  const y = parse(range.value.from).getFullYear();
  const counts = Array.from({ length: 12 }, () => 0);
  for (const t of store.tasks) {
    const k = base.value === "done" ? t.completed_at : t.created_at;
    if (t.status !== "done" && base.value === "done") continue;
    if (k && k.startsWith(String(y))) counts[Number(k.slice(5, 7)) - 1]++;
  }
  const max = Math.max(...counts, 1);
  return { year: y, counts, max };
});

/* ---------------- Markdown 导出 ---------------- */
const showExport = ref(false);
const exportMd = computed(() => {
  const { label, from, to } = range.value;
  const lines: string[] = [];
  lines.push(`# 工作回顾：${label}`);
  lines.push("");
  lines.push(`> 区间：${from} ~ ${to}　基准：${base.value === "done" ? "完成日期" : "创建日期"}`);
  lines.push("");
  lines.push(`- 完成任务：**${stats.value.done}** 项`);
  lines.push(`- 新建任务：**${stats.value.created}** 项`);
  if (stats.value.rate !== null) lines.push(`- 当期创建任务的完成率：**${stats.value.rate}%**`);
  if (stats.value.avgCost !== null) lines.push(`- 平均完成耗时：**${stats.value.avgCost}** 天`);
  lines.push("");
  if (!groups.value.length) {
    lines.push("_该区间暂无任务记录。_");
  }
  for (const [date, list] of groups.value) {
    lines.push(`## ${date}`);
    lines.push("");
    for (const t of list) {
      const mark = t.status === "done" ? "x" : " ";
      let extra = "";
      if (t.status === "done" && t.completed_at && t.created_at) {
        const days = Math.round((parse(t.completed_at).getTime() - parse(t.created_at).getTime()) / 86400000);
        extra = `（${t.created_at.slice(5)} 创建，${days === 0 ? "当天" : `${days} 天`}完成）`;
      } else if (t.status !== "done") {
        extra = `（${t.status === "todo" ? "待完成" : t.status === "doing" ? "进行中" : "已取消"}）`;
      }
      lines.push(`- [${mark}] ${t.title}${extra}`);
    }
    lines.push("");
  }
  return lines.join("\n");
});

async function copyMd() {
  try {
    await navigator.clipboard.writeText(exportMd.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    /* 剪贴板失败时用户可手动全选复制 */
  }
}
const copied = ref(false);

function downloadMd() {
  const blob = new Blob([exportMd.value], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `工作回顾_${range.value.from}_${range.value.to}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const STATUS_TXT: Record<string, string> = { todo: "待完成", doing: "进行中", done: "已完成", cancelled: "已取消" };
function daysOf(t: Task): number | null {
  if (t.status !== "done" || !t.completed_at) return null;
  return Math.round((parse(t.completed_at).getTime() - parse(t.created_at).getTime()) / 86400000);
}
</script>

<template>
  <div class="hist">
    <!-- 工具条 -->
    <div class="h-bar">
      <div class="seg mini">
        <button :class="{ on: base === 'done' }" @click="base = 'done'">按完成日期</button>
        <button :class="{ on: base === 'created' }" @click="base = 'created'">按创建日期</button>
      </div>
      <div class="seg mini">
        <button :class="{ on: grain === 'day' }" @click="grain = 'day'">日</button>
        <button :class="{ on: grain === 'week' }" @click="grain = 'week'">周</button>
        <button :class="{ on: grain === 'month' }" @click="grain = 'month'">月</button>
        <button :class="{ on: grain === 'year' }" @click="grain = 'year'">年</button>
        <button :class="{ on: grain === 'custom' }" @click="grain = 'custom'">自定义</button>
      </div>
      <template v-if="grain === 'custom'">
        <input type="date" v-model="customFrom" class="h-date" />
        <span class="h-sep">~</span>
        <input type="date" v-model="customTo" class="h-date" />
      </template>
      <template v-else>
        <div class="month-nav">
          <button @click="shift(-1)">‹</button>
          <b>{{ range.label }}</b>
          <button @click="shift(1)">›</button>
        </div>
        <button class="icon-btn" @click="anchor = todayStr()">今天</button>
      </template>
      <div class="h-spacer"></div>
      <button class="icon-btn h-export" @click="showExport = true">📤 导出 Markdown</button>
    </div>

    <!-- 统计卡片 -->
    <div class="h-cards">
      <div class="h-card">
        <div class="n green">{{ stats.done }}</div>
        <div class="l">{{ base === "done" ? "区间内完成" : "区间内新建且已完成" }}</div>
      </div>
      <div class="h-card">
        <div class="n blue">{{ stats.created }}</div>
        <div class="l">区间内新建任务</div>
      </div>
      <div class="h-card">
        <div class="n" :class="stats.rate !== null && stats.rate >= 80 ? 'green' : 'yellow'">
          {{ stats.rate === null ? "—" : stats.rate + "%" }}
        </div>
        <div class="l">当期任务完成率</div>
      </div>
      <div class="h-card">
        <div class="n">{{ stats.avgCost === null ? "—" : stats.avgCost + " 天" }}</div>
        <div class="l">平均完成耗时</div>
      </div>
    </div>

    <!-- 月度趋势 -->
    <div class="h-trend">
      <div class="h-trend-title">{{ trend.year }} 年逐月{{ base === "done" ? "完成" : "新建" }}趋势</div>
      <div class="h-bars">
        <div v-for="(c, i) in trend.counts" :key="i" class="h-bar-col">
          <div class="h-bar-n">{{ c || "" }}</div>
          <div class="h-bar-v" :style="{ height: (c / trend.max) * 100 + '%', opacity: c ? 1 : 0.15 }"></div>
          <div class="h-bar-m">{{ i + 1 }}</div>
        </div>
      </div>
    </div>

    <!-- 明细分组 -->
    <div v-for="[date, list] in groups" :key="date" class="h-group">
      <div class="group-head"><b>{{ date }}</b><span class="line"></span><span>{{ list.length }} 项</span></div>
      <div v-for="t in list" :key="t.id" class="task" :class="{ done: t.status === 'done' }">
        <div class="chk" :class="{ on: t.status === 'done' }" @click="store.toggle(t.id)">
          {{ t.status === "done" ? "✓" : "" }}
        </div>
        <div class="t-main">
          <div class="t-title">{{ t.title }}</div>
          <div class="t-meta">
            <span>{{ t.created_at.slice(5) }} 创建</span>
            <span v-if="t.completed_at" class="ok">{{ t.completed_at.slice(5) }} 完成</span>
            <span v-if="daysOf(t) !== null" class="ok">{{ daysOf(t) === 0 ? "当天完成" : `耗时 ${daysOf(t)} 天` }}</span>
            <span v-if="t.status !== 'done'" class="stay">{{ STATUS_TXT[t.status] }}</span>
          </div>
        </div>
      </div>
    </div>
    <div v-if="!groups.length" class="empty">该区间暂无任务记录，换个区间或基准试试</div>

    <!-- 导出弹窗 -->
    <div v-if="showExport" class="h-mask" @click.self="showExport = false">
      <div class="h-modal">
        <div class="h-modal-head">
          <b>导出 Markdown · {{ range.label }}</b>
          <button class="s-btn" @click="showExport = false">✕</button>
        </div>
        <textarea class="h-md" readonly :value="exportMd"></textarea>
        <div class="h-modal-foot">
          <button class="icon-btn" @click="copyMd">{{ copied ? "✅ 已复制" : "📋 复制全文" }}</button>
          <button class="icon-btn h-export" @click="downloadMd">⬇ 下载 .md 文件</button>
        </div>
      </div>
    </div>
  </div>
</template>
