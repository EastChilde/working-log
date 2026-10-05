<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTaskStore, todayKey, inSubtree } from "./stores/tasks";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { TAG_HEX, TAG_COLORS } from "./types";
import type { Tag, TagColor } from "./types";
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

/** 标签下任务总数（侧栏角标）——含已完成；父标签聚合整棵子树 */
function tagCount(id: string) {
  return store.tasks.filter((t) => t.tags.some((tid) => inSubtree(store.tags, tid, id))).length;
}
/** 标签下未完成任务数（悬浮提示用） */
function tagOpenCount(id: string) {
  return store.openTasks.filter((t) => t.tags.some((tid) => inSubtree(store.tags, tid, id))).length;
}

/* ---------- 二级标签：树形渲染 ---------- */
const expandedTags = ref<Record<string, boolean>>({});
const tagTree = computed(() =>
  store.tags
    .filter((t) => !t.parent_id)
    .map((r) => ({ tag: r, children: store.tags.filter((c) => c.parent_id === r.id) })),
);
function toggleExpand(id: string) {
  expandedTags.value[id] = expandedTags.value[id] === false ? true : false;
}
/** 删除标签：有子标签时子标签升级为顶级，任务上的引用一并移除 */
async function delTag(tag: { id: string; name: string }) {
  const childN = store.tags.filter((t) => t.parent_id === tag.id).length;
  const msg = childN
    ? `删除标签「${tag.name}」？其下 ${childN} 个子标签将升级为顶级标签，任务不会删除，仅摘除该标签。`
    : `删除标签「${tag.name}」？任务不会删除，仅摘除该标签。`;
  if (!window.confirm(msg)) return;
  await store.removeTag(tag.id);
}

/* ---------- 标签编辑：改名 / 换色 / 改归属（可把现有标签调成子标签） ---------- */
const editingId = ref<string | null>(null);
const editName = ref("");
const editColor = ref<TagColor>("blue");
const editPid = ref<string | null>(null);
const editErr = ref(false);
const editInput = ref<HTMLInputElement | null>(null);
const editingTag = computed(() => store.tags.find((t) => t.id === editingId.value) || null);
/** 已有子标签的标签不能再当子标签（会超两级），归属下拉锁定 */
const editPidLocked = computed(() => !!editingTag.value && store.tags.some((t) => t.parent_id === editingTag.value!.id));
/** 可选归属：除自己外的全部顶级标签 */
const editPidOptions = computed(() => store.tags.filter((t) => !t.parent_id && t.id !== editingId.value));
function startEdit(tag: Tag) {
  editingId.value = tag.id;
  editName.value = tag.name;
  editColor.value = tag.color;
  editPid.value = tag.parent_id ?? null;
  editErr.value = false;
  nextTick(() => editInput.value?.focus());
}
function cancelEdit() {
  editingId.value = null;
}
async function saveEdit() {
  if (!editingId.value) return;
  const ok = await store.editTag(editingId.value, { name: editName.value, color: editColor.value, parent_id: editPid.value });
  if (!ok) {
    editErr.value = true;
    return;
  }
  editingId.value = null;
}

/* ---------- 侧栏范围筛选：单选模型，点任何一个其他选中自动清除 ---------- */
function scopeAll() {
  store.scope = "all";
  store.activeTag = null;
  view.value = "list";
}
function scopeToday() {
  store.scope = "today";
  store.activeTag = null;
  view.value = "list";
}
function scopeStay() {
  store.scope = "stay";
  store.activeTag = null;
  view.value = "list";
}
/** 点标签：选中即切回清单视图；再点同一标签取消（回到「全部任务」选中态） */
function pickTag(id: string) {
  store.toggleTagFilter(id);
  view.value = "list";
}

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
      <div class="side-item" :class="{ on: view !== 'hist' && store.scope === 'all' && !store.activeTag }" @click="scopeAll">🗂 全部任务</div>
      <div class="side-item" :class="{ on: view !== 'hist' && store.scope === 'today' && !store.activeTag }" title="只看今天创建且未完成的任务" @click="scopeToday">☀️ 今日待办 <span class="cnt">{{ sideToday }}</span></div>
      <div class="side-item" :class="{ on: view !== 'hist' && store.scope === 'stay' && !store.activeTag }" title="只看往日创建至今未完成的任务" @click="scopeStay">⏳ 滞留任务 <span class="cnt">{{ sideStay }}</span></div>
      <div class="side-sec"><span>标签</span></div>
      <template v-for="node in tagTree" :key="node.tag.id">
        <div
          class="side-tag"
          :class="{ on: view !== 'hist' && store.activeTag === node.tag.id, 'side-tag-p': node.children.length }"
          :title="store.activeTag === node.tag.id ? '再次点击取消筛选' : '点击只看「' + node.tag.name + '」及其子标签的任务'"
          @click="pickTag(node.tag.id)"
        >
          <span
            v-if="node.children.length"
            class="tw"
            :title="expandedTags[node.tag.id] === false ? '展开' : '收起'"
            @click.stop="toggleExpand(node.tag.id)"
          >{{ expandedTags[node.tag.id] === false ? '▸' : '▾' }}</span>
          <i class="sd" :style="{ background: TAG_HEX[node.tag.color] }"></i><span class="tname">{{ node.tag.name }}</span>
          <span class="cnt" :title="'共 ' + tagCount(node.tag.id) + ' 个任务，未完成 ' + tagOpenCount(node.tag.id) + ' 个'">{{ tagCount(node.tag.id) }}</span>
          <button class="side-tag-edit" title="编辑标签（改名 / 换色 / 调整归属）" @click.stop="startEdit(node.tag)">✎</button>
          <button class="side-tag-del" title="删除标签（子标签升级为顶级，任务保留仅摘除）" @click.stop="delTag(node.tag)">✕</button>
        </div>
        <template v-if="node.children.length && expandedTags[node.tag.id] !== false">
          <div
            v-for="c in node.children"
            :key="c.id"
            class="side-tag side-tag-sub"
            :class="{ on: view !== 'hist' && store.activeTag === c.id }"
            :title="store.activeTag === c.id ? '再次点击取消筛选' : '点击只看「' + c.name + '」的任务'"
            @click="pickTag(c.id)"
          >
            <i class="sd" :style="{ background: TAG_HEX[c.color] }"></i><span class="tname">{{ c.name }}</span>
            <span class="cnt" :title="'共 ' + tagCount(c.id) + ' 个任务，未完成 ' + tagOpenCount(c.id) + ' 个'">{{ tagCount(c.id) }}</span>
            <button class="side-tag-edit" title="编辑标签（改名 / 换色 / 调整归属）" @click.stop="startEdit(c)">✎</button>
            <button class="side-tag-del" title="删除标签（任务保留，仅摘除标签）" @click.stop="delTag(c)">✕</button>
          </div>
        </template>
      </template>
      <div v-if="!store.tags.length" class="side-tag-empty">暂无标签<br />编辑任务时点「＋ 新建标签」创建</div>
      <!-- 标签编辑面板（就地展开在标签列表下方） -->
      <div v-if="editingTag" class="side-tag-editpanel" @click.stop>
        <div class="ste-title">编辑「{{ editingTag.name }}」</div>
        <input
          ref="editInput"
          v-model="editName"
          type="text"
          placeholder="标签名称"
          maxlength="8"
          :class="{ err: editErr }"
          @keydown.enter.prevent="saveEdit"
          @keydown.esc.prevent="cancelEdit"
        />
        <div class="color-dots">
          <button
            v-for="c2 in TAG_COLORS"
            :key="c2"
            type="button"
            class="cdot"
            :class="{ sel: editColor === c2 }"
            :style="{ background: TAG_HEX[c2] }"
            :title="c2"
            @click="editColor = c2"
          ></button>
        </div>
        <select v-model="editPid" class="ste-pid" :disabled="editPidLocked" :title="editPidLocked ? '该标签下已有子标签，不能再归属到其他标签下' : ''">
          <option :value="null">顶级标签</option>
          <option v-for="p in editPidOptions" :key="p.id" :value="p.id">归属：{{ p.name }}</option>
        </select>
        <div class="ste-btns">
          <button class="ste-save" @click="saveEdit">保存</button>
          <button class="ste-cancel" @click="cancelEdit">取消</button>
        </div>
        <div v-if="editErr" class="ste-err">名称重复或归属非法（同级不能重名 / 不能超过两级）</div>
      </div>
      <div class="side-sec">回顾</div>
      <div class="side-item" :class="{ on: view === 'hist' }" @click="view = 'hist'">📈 年度统计与总结</div>
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
