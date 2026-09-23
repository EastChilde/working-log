<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTaskStore, todayKey } from "./stores/tasks";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import CalendarView from "./components/CalendarView.vue";
import ListView from "./components/ListView.vue";
import DayPanel from "./components/DayPanel.vue";
import HistoryView from "./components/HistoryView.vue";
import TaskModal from "./components/TaskModal.vue";

const store = useTaskStore();
const view = ref<"cal" | "list" | "hist">("cal");
const year = ref(new Date().getFullYear());
const month = ref(new Date().getMonth() + 1);
const selected = ref(todayKey());
const today = todayKey();

onMounted(() => store.initSync());

function shiftMonth(n: number) {
  month.value += n;
  if (month.value > 12) { month.value = 1; year.value++; }
  if (month.value < 1) { month.value = 12; year.value--; }
}
function goToday() {
  const d = new Date();
  year.value = d.getFullYear(); month.value = d.getMonth() + 1; selected.value = today;
}

const quickInput = ref("");
async function quickAdd() {
  if (!quickInput.value.trim()) return;
  await store.add(quickInput.value, selected.value || today);
  quickInput.value = "";
}

const sideToday = computed(() => store.tasks.filter((t) => t.created_at === today && t.status !== "done").length);
const sideStay = computed(() => store.openTasks.filter((t) => t.created_at < today).length);
const inboxCount = computed(() => 0);

/** 主题：light / dark，存 localStorage，启动即应用（防闪烁在 main.ts 同步处理） */
const theme = ref<"light" | "dark">((localStorage.getItem("workinglog-theme") as "light" | "dark") || "light");
async function applyTheme(t: "light" | "dark") {
  theme.value = t;
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("workinglog-theme", t);
  // 同步原生窗口主题，让 Windows 标题栏跟随深浅色
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTheme(t);
  } catch {
    /* 非 Tauri 环境忽略 */
  }
}
function toggleTheme() {
  applyTheme(theme.value === "dark" ? "light" : "dark");
}
applyTheme(theme.value);

/** 顶栏切换便签窗口显示/隐藏 */
const stickyBtn = ref<"show" | "hide">("show");
async function toggleSticky() {
  const w = await WebviewWindow.getByLabel("sticky");
  if (!w) return;
  if (await w.isVisible()) {
    await w.hide();
    stickyBtn.value = "show";
  } else {
    await w.show();
    await w.setFocus();
    stickyBtn.value = "hide";
  }
}

/** 无边框窗口控制：最小化 / 最大化还原 / 关闭（关闭走 Rust 端拦截 → 隐藏到托盘） */
const isMax = ref(false);
let unlistenResize: (() => void) | null = null;
onMounted(async () => {
  try {
    const win = getCurrentWindow();
    isMax.value = await win.isMaximized();
    unlistenResize = await win.onResized(async () => {
      try { isMax.value = await win.isMaximized(); } catch { /* ignore */ }
    });
  } catch { /* 非 Tauri 环境忽略 */ }
});
onUnmounted(() => unlistenResize?.());

async function winMinimize() {
  await getCurrentWindow().minimize();
}
async function winToggleMaximize() {
  await getCurrentWindow().toggleMaximize();
}
async function winClose() {
  await getCurrentWindow().close(); // Rust 端 CloseRequested 已拦截为隐藏，托盘驻留
}
</script>

<template>
  <div class="topbar" data-tauri-drag-region>
    <div class="logo" data-tauri-drag-region><div class="dot">清</div>工作清单助手</div>
    <div class="seg">
      <button :class="{ on: view === 'cal' }" @click="view = 'cal'">📅 日历</button>
      <button :class="{ on: view === 'list' }" @click="view = 'list'">📋 清单</button>
      <button :class="{ on: view === 'hist' }" @click="view = 'hist'">📈 回顾</button>
    </div>
    <div class="month-nav">
      <button @click="shiftMonth(-1)">‹</button>
      <b>{{ year }}年{{ month }}月</b>
      <button @click="shiftMonth(1)">›</button>
    </div>
    <button class="icon-btn today-chip" @click="goToday">今天</button>
    <button class="icon-btn sticky-toggle" :class="{ off: stickyBtn === 'show' }" @click="toggleSticky">
      🗒 便签
    </button>
    <button class="icon-btn theme-btn" :title="theme === 'dark' ? '切换到浅色' : '切换到深色'" @click="toggleTheme">
      {{ theme === 'dark' ? '☀️' : '🌙' }}
    </button>
    <div class="spacer" data-tauri-drag-region></div>
    <span class="mode-hint">{{ store.loaded ? '' : '加载中…' }}</span>
    <div class="win-controls">
      <button class="win-btn" title="最小化" @click="winMinimize">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 5h8" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>
      </button>
      <button class="win-btn" :title="isMax ? '还原' : '最大化'" @click="winToggleMaximize">
        <svg v-if="!isMax" width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="3" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M3.5 3V2a1 1 0 0 1 1-1H8a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1H7" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>
      </button>
      <button class="win-btn win-close" title="关闭" @click="winClose">
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>

  <div class="layout">
    <div class="sidebar">
      <div class="side-item on">🗂 全部任务</div>
      <div class="side-item">☀️ 今日待办 <span class="cnt">{{ sideToday }}</span></div>
      <div class="side-item">⏳ 滞留任务 <span class="cnt">{{ sideStay }}</span></div>
      <div class="side-sec">标签</div>
      <div class="side-item">💻 开发 <span class="cnt">—</span></div>
      <div class="side-item">📄 文档 <span class="cnt">—</span></div>
      <div class="side-item">🗣 会议 <span class="cnt">—</span></div>
      <div class="side-sec">回顾</div>
      <div class="side-item" :class="{ on: view === 'hist' }" @click="view = 'hist'">📈 年度统计</div>
      <div class="side-item" :class="{ on: view === 'hist' }" @click="view = 'hist'">📤 年终总结导出</div>
      <div class="legend">
        <span><i style="background: var(--green)"></i>全部完成</span>
        <span><i style="background: var(--yellow)"></i>部分完成</span>
        <span><i style="background: var(--red)"></i>全部未完成</span>
        <span><i style="background: #c9d2e0"></i>当天无任务</span>
      </div>
    </div>

    <div class="view" :class="{ on: view === 'cal' }">
      <CalendarView :year="year" :month="month" :selected="selected" :today="today" @select="selected = $event" />
    </div>

    <div class="view" :class="{ on: view === 'list' }">
      <div class="quick-add">
        <input v-model="quickInput" placeholder="回车快速添加任务到选中日期…" @keydown.enter="quickAdd" />
        <button @click="quickAdd">＋ 添加</button>
      </div>
      <ListView />
    </div>

    <div class="view" :class="{ on: view === 'hist' }">
      <HistoryView />
    </div>

    <DayPanel :selected="selected" :today="today" v-if="view !== 'hist'" />
  </div>

  <TaskModal />
</template>
