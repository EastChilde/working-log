<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useTaskStore, todayKey } from "../stores/tasks";
import { getCurrentWindow, currentMonitor, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import type { Task } from "../types";

const store = useTaskStore();
const today = todayKey();
const input = ref("");

const isTauri = "__TAURI_INTERNALS__" in window;
const win = isTauri ? getCurrentWindow() : null;

/** 贴边吸附：
 * - 展开态：标题栏 JS 拖拽，松手时距屏幕边 < SNAP_PX 自动吸附收起
 * - 吸附态：鼠标碰拉手自动滑出（autoPeek），移开 PEEK_DELAY 后自动收回；拖拽/点击 = 主动展开不自动收回
 * - 吸附边与展开位置都持久化（localStorage） */
type DockEdge = "top" | "bottom" | "left" | "right";
const minimized = ref(false);
/** 本次展开是否由 hover 触发（true 则鼠标移开自动收回） */
const autoPeek = ref(false);
let savedGeom: { x: number; y: number; w: number; h: number } | null = null;
const SIDE_W = 18, SIDE_H = 64;   // 左右侧边拉手（竖排）
const EDGE_W = 64, EDGE_H = 18;   // 上下横边拉手（横排）
const DOCK_KEY = "sticky-dock-v1";
const POS_KEY = "sticky-pos-v1";  // 展开态窗口几何记忆
const SNAP_PX = 32;               // 距屏幕边多少像素内松手 → 自动吸附
const PEEK_DELAY = 700;           // hover 展开后鼠标移开多久自动收回
let lastDockTs = 0;               // 收起时间戳：短暂冷却，防收起/展开循环抖动

/** 几何有效性：必须明显大于拉手尺寸，防止把 tab 尺寸当展开几何持久化（污染死循环） */
function validGeom(g: { x: number; y: number; w: number; h: number } | null | undefined): g is { x: number; y: number; w: number; h: number } {
  return !!g && g.w > SIDE_W + 60 && g.h > SIDE_H + 60;
}
function readStoredPos(): { x: number; y: number; w: number; h: number } | null {
  try {
    const g = JSON.parse(localStorage.getItem(POS_KEY) || "null");
    return validGeom(g) ? g : null;
  } catch { return null; }
}
function persistPos(g: { x: number; y: number; w: number; h: number }) {
  if (!validGeom(g)) return; // 脏几何直接丢弃
  try { localStorage.setItem(POS_KEY, JSON.stringify(g)); } catch { /* ignore */ }
}

const dockEdge = ref<DockEdge>("right");
try { dockEdge.value = JSON.parse(localStorage.getItem(DOCK_KEY) || "null")?.edge || "right"; } catch { /* ignore */ }

function persistDock(off: number) {
  try { localStorage.setItem(DOCK_KEY, JSON.stringify({ edge: dockEdge.value, off })); } catch { /* ignore */ }
}

const tabSize = () => (dockEdge.value === "left" || dockEdge.value === "right" ? { w: SIDE_W, h: SIDE_H } : { w: EDGE_W, h: EDGE_H });

async function minimizeToEdge() {
  if (!win) return;
  try {
    const [mon, pos, size] = [await currentMonitor(), await win.outerPosition(), await win.innerSize()];
    const cand = { x: pos.x, y: pos.y, w: size.width, h: size.height };
    if (validGeom(cand)) { savedGeom = cand; persistPos(cand); }
    if (mon) {
      let saved: { edge: DockEdge; off: number } | null = null;
      try { saved = JSON.parse(localStorage.getItem(DOCK_KEY) || "null"); } catch { /* ignore */ }
      const edge = saved?.edge || "right";
      dockEdge.value = edge;
      const ts = tabSize();
      const m = mon.size;
      let x: number, y: number;
      if (edge === "left") { x = 0; y = clamp(saved?.off ?? pos.y, 0, m.height - ts.h); }
      else if (edge === "right") { x = m.width - ts.w; y = clamp(saved?.off ?? pos.y, 0, m.height - ts.h); }
      else if (edge === "top") { y = 0; x = clamp(saved?.off ?? pos.x, 0, m.width - ts.w); }
      else { y = m.height - ts.h; x = clamp(saved?.off ?? pos.x, 0, m.width - ts.w); }
      await win.setSize(new PhysicalSize(ts.w, ts.h));
      await win.setPosition(new PhysicalPosition(x, y));
    }
    minimized.value = true;
    autoPeek.value = false;
    lastDockTs = Date.now();
  } catch (e) {
    console.error("minimize failed", e);
  }
}

function clamp(v: number | undefined, lo: number, hi: number): number {
  const n = typeof v === "number" && !isNaN(v) ? v : lo;
  return Math.max(lo, Math.min(n, hi));
}

async function restoreFromEdge() {
  if (!win) return;
  const g0 = savedGeom || readStoredPos();
  const g = validGeom(g0) ? g0 : null; // 脏几何不恢复，窗口保持默认尺寸
  if (g) {
    await win.setPosition(new PhysicalPosition(g.x, g.y));
    await win.setSize(new PhysicalSize(g.w, g.h));
  }
  minimized.value = false;
}

/** hover 拉手 → 自动滑出（不抢焦点）；收起后短暂冷却防止边缘抖动 */
async function peekExpand() {
  if (!win || !minimized.value) return;
  if (Date.now() - lastDockTs < 350) return;
  autoPeek.value = true;
  try { await restoreFromEdge(); } catch { /* ignore */ }
}

/* ---- hover 展开后移开自动收回 ---- */
let peekTimer: number | null = null;
function schedulePeekHide() {
  if (!autoPeek.value || minimized.value) return;
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return; // 输入中不收回
  if (peekTimer !== null) window.clearTimeout(peekTimer);
  peekTimer = window.setTimeout(async () => {
    peekTimer = null;
    if (!autoPeek.value || minimized.value) return;
    await minimizeToEdge();
  }, PEEK_DELAY);
}
function cancelPeekHide() {
  if (peekTimer !== null) { window.clearTimeout(peekTimer); peekTimer = null; }
}

/** 通用窗口拖拽：mousedown 起步、mousemove 跟随、mouseup 回调落点（moved 才回调） */
function startWindowDrag(e: MouseEvent, onDrop: (moved: boolean) => void) {
  if (!win || e.button !== 0) return;
  e.preventDefault();
  const scale = window.devicePixelRatio || 1;
  win.outerPosition().then((p0) => {
    const sx = e.clientX, sy = e.clientY, wx = p0.x, wy = p0.y;
    let moved = false;
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      moved = true;
      void win!.setPosition(new PhysicalPosition(Math.round(wx + dx * scale), Math.round(wy + dy * scale)));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      onDrop(moved);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }).catch(() => { /* ignore */ });
}

/** 展开态标题栏拖拽：松手距屏幕边 < SNAP_PX 自动吸附收起，否则记忆位置 */
function onHeadDown(e: MouseEvent) {
  if ((e.target as HTMLElement).closest(".s-btns")) return; // 按钮区不拖拽
  cancelPeekHide();
  autoPeek.value = false; // 主动拖拽 = 主动使用，之后不自动收回
  startWindowDrag(e, async (moved) => {
    if (!moved) return;
    try {
      const mon = await currentMonitor();
      if (!mon) return;
      const pos = await win!.outerPosition();
      const size = await win!.innerSize();
      const dist: Record<DockEdge, number> = {
        left: pos.x,
        right: mon.size.width - pos.x - size.width,
        top: pos.y,
        bottom: mon.size.height - pos.y - size.height,
      };
      const edge = (Object.keys(dist) as DockEdge[]).reduce((a, b) => (dist[a] <= dist[b] ? a : b));
      if (dist[edge] < SNAP_PX) {
        dockEdge.value = edge;
        await snapToEdge();
      } else {
        const cand = { x: pos.x, y: pos.y, w: size.width, h: size.height };
        if (validGeom(cand)) { savedGeom = cand; persistPos(cand); }
      }
    } catch { /* ignore */ }
  });
}

/** 拉手兜底交互：拖动换边 / 原地点击展开（正常路径是 mouseenter 自动展开） */
function onTabDown(e: MouseEvent) {
  cancelPeekHide();
  startWindowDrag(e, async (moved) => {
    if (moved) await snapToEdge();
    else { autoPeek.value = false; await restoreFromEdge(); }
  });
}

async function snapToEdge() {
  if (!win) return;
  // 从展开态收起：先记录展开几何，供下次 hover/点击展开时恢复
  // （tab 拖拽换边时已 minimized，此时窗口是 tab 尺寸，不能记录）
  if (!minimized.value) {
    try {
      const [p, s] = [await win.outerPosition(), await win.innerSize()];
      savedGeom = { x: p.x, y: p.y, w: s.width, h: s.height };
      persistPos(savedGeom);
    } catch { /* ignore */ }
  }
  const mon = await currentMonitor();
  const pos = await win.outerPosition();
  if (!mon) return;
  const m = mon.size;
  const ts = tabSize();
  const d = {
    left: pos.x,
    right: m.width - pos.x - ts.w,
    top: pos.y,
    bottom: m.height - pos.y - ts.h,
  };
  const edge = (Object.keys(d) as DockEdge[]).reduce((a, b) => (d[a] <= d[b] ? a : b));
  dockEdge.value = edge;
  const size = edge === "left" || edge === "right" ? { w: SIDE_W, h: SIDE_H } : { w: EDGE_W, h: EDGE_H };
  let x: number, y: number, off: number;
  if (edge === "left") { x = 0; y = clamp(pos.y, 0, m.height - size.h); off = y; }
  else if (edge === "right") { x = m.width - size.w; y = clamp(pos.y, 0, m.height - size.h); off = y; }
  else if (edge === "top") { y = 0; x = clamp(pos.x, 0, m.width - size.w); off = x; }
  else { y = m.height - size.h; x = clamp(pos.x, 0, m.width - size.w); off = x; }
  await win.setSize(new PhysicalSize(size.w, size.h));
  await win.setPosition(new PhysicalPosition(x, y));
  persistDock(off);
  minimized.value = true;
  autoPeek.value = false;
  lastDockTs = Date.now();
}

/* ===== 紧急程度排序视图 ===== */
/** 滞留天数 */
const stayDays = (t: Task) => Math.floor((Date.parse(today) - Date.parse(t.created_at)) / 86400000);
/** 预计结束日期距今天数 */
const dueDays = (t: Task) => Math.round((Date.parse(t.deadline + "T00:00:00") - Date.parse(today + "T00:00:00")) / 86400000);
/** 已逾期（未完成且预计结束日期已过） */
const isOverdue = (t: Task) => !!t.deadline && t.status !== "done" && dueDays(t) < 0;
/** 紧急程度 → 样式类（与主界面红黄绿同源） */
function priCls(p: Task["priority"]) {
  return p === "高" ? "hi" : p === "中" ? "mid" : p === "低" ? "low" : "none";
}
/** 任务的标签对象列表（过滤已删除的标签 id） */
function taskTags(t: Task) {
  return t.tags.map((id) => store.tagsById[id]).filter(Boolean);
}
/** 状态徽章：逾期(红) / 今天到期(黄) / 预计结束(灰) / 滞留(橙) */
function chips(t: Task): { txt: string; cls: string }[] {  const out: { txt: string; cls: string }[] = [];
  if (t.deadline && t.status !== "done") {
    const d = dueDays(t);
    if (d < 0) out.push({ txt: `已逾期 ${-d} 天`, cls: "overdue" });
    else if (d === 0) out.push({ txt: "今天到期", cls: "due-today" });
    else out.push({ txt: `预计 ${t.deadline.slice(5)} 结束`, cls: "due" });
  }
  const s = stayDays(t);
  if (s > 0) out.push({ txt: `${s} 天前`, cls: "stay" });
  return out;
}

/** 分组：紧急(高) > 一般(中) > 不急(低) > 未设置；组内逾期优先、滞留久的靠前 */
const groups = computed(() => {
  const defs = [
    { key: "hi", label: "紧急", pri: "高" as Task["priority"] },
    { key: "mid", label: "一般", pri: "中" as Task["priority"] },
    { key: "low", label: "不急", pri: "低" as Task["priority"] },
    { key: "none", label: "未设置", pri: null as Task["priority"] },
  ];
  return defs
    .map((d) => ({
      ...d,
      tasks: store.openTasks
        .filter((t) => (t.priority ?? null) === d.pri)
        .sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || stayDays(b) - stayDays(a) || a.sort - b.sort),
    }))
    .filter((g) => g.tasks.length > 0);
});

/** 顶部汇总胶囊：高/中/低数量 */
const priCount = computed(() => ({
  hi: store.openTasks.filter((t) => t.priority === "高").length,
  mid: store.openTasks.filter((t) => t.priority === "中").length,
  low: store.openTasks.filter((t) => t.priority === "低").length,
}));

const doneToday = computed(() => store.doneToday);

async function add() {
  if (!input.value.trim()) return;
  await store.add(input.value, today);
  input.value = "";
}

onMounted(() => {
  store.initSync();
  // 恢复上次的展开位置/尺寸
  if (win) {
    const g = readStoredPos();
    if (g) {
      void win.setSize(new PhysicalSize(g.w, g.h)).catch(() => { /* ignore */ });
      void win.setPosition(new PhysicalPosition(g.x, g.y)).catch(() => { /* ignore */ });
    }
  }
});
</script>

<template>
  <!-- 贴边拉手：鼠标移过自动滑出；按住可拖拽换边 -->
  <div
    v-if="minimized"
    class="mini-tab"
    :class="'edge-' + dockEdge"
    title="移过来自动展开 · 按住拖拽换边"
    @mouseenter="peekExpand"
    @mousedown="onTabDown"
  >便签</div>

  <div v-else class="sticky" @mouseenter="cancelPeekHide" @mouseleave="schedulePeekHide">
    <div class="s-head" @mousedown="onHeadDown">
      <span class="s-date">今日待办 · {{ today.slice(5) }}</span>
      <div class="s-sum">
        <b v-if="priCount.hi" class="hi"><i></i>{{ priCount.hi }}</b>
        <b v-if="priCount.mid" class="mid"><i></i>{{ priCount.mid }}</b>
        <b v-if="priCount.low" class="low"><i></i>{{ priCount.low }}</b>
      </div>
      <div class="s-btns">
        <button class="s-btn" title="贴边隐藏（也可把便签拖到屏幕边缘松手自动吸附）" @click="minimizeToEdge">—</button>
      </div>
    </div>

    <div class="s-body">
      <template v-for="g in groups" :key="g.key">
        <div class="g-head" :class="'g-' + g.key">
          <i></i>{{ g.label }}<span class="n">{{ g.tasks.length }} 项</span>
        </div>
        <div
          v-for="t in g.tasks"
          :key="t.id"
          class="s-task"
          :class="[priCls(t.priority), { over: isOverdue(t) }]"
        >
          <div class="chk" @click="store.toggle(t.id)"></div>
          <div class="s-main">
            <div class="s-title">{{ t.title }}</div>
            <div v-if="taskTags(t).length" class="s-tags">
              <span v-for="tag in taskTags(t)" :key="tag.id" class="tag-chip" :class="'tg-' + tag.color"><i class="td"></i>{{ tag.name }}</span>
            </div>
            <div v-if="chips(t).length" class="s-meta">
              <span v-for="(c, i) in chips(t)" :key="i" class="chip" :class="c.cls">{{ c.txt }}</span>
            </div>
          </div>
        </div>
      </template>

      <template v-if="doneToday.length">
        <div class="g-head g-none"><i></i>已完成<span class="n">{{ doneToday.length }} 项</span></div>
        <div v-for="t in doneToday" :key="t.id" class="s-task done none">
          <div class="chk on" @click="store.toggle(t.id)">✓</div>
          <div class="s-main"><div class="s-title">{{ t.title }}</div></div>
        </div>
      </template>

      <div v-if="!groups.length && !doneToday.length" class="s-empty">
        今天还没有任务<br />下方输入直接添加
      </div>
    </div>

    <div class="s-add">
      <input v-model="input" placeholder="回车添加…" @keydown.enter="add" />
      <button @click="add">＋</button>
    </div>
  </div>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app { height: 100%; background: transparent; overflow: hidden; }
body {
  font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
  font-size: 13px;
  color: #4a4326;
}
.sticky {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #fdf6cf 0%, #fdf1b8 100%);
  border: 1px solid #ecd98a;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
}
.s-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px 7px 14px;
  border-bottom: 1px solid rgba(190, 160, 60, 0.25);
  cursor: grab;
  user-select: none;
}
.s-head:active { cursor: grabbing; }
/* 顶部汇总胶囊：高/中/低数量 */
.s-sum { display: flex; gap: 4px; }
.s-sum b {
  font-size: 9.5px; font-weight: 700; padding: 1.5px 6px; border-radius: 8px;
  display: flex; align-items: center; gap: 4px;
}
.s-sum i { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.s-sum b.hi { background: rgba(229, 72, 77, 0.14); color: #e5484d; }
.s-sum b.hi i { background: #e5484d; }
.s-sum b.mid { background: rgba(240, 165, 46, 0.16); color: #c47f10; }
.s-sum b.mid i { background: #f0a52e; }
.s-sum b.low { background: rgba(52, 185, 111, 0.14); color: #238a50; }
.s-sum b.low i { background: #34b96f; }

/* 贴边拉手：小巧、随吸附方向变形，可拖拽 */
.mini-tab {
  position: fixed;
  left: 0;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #fdf6cf 0%, #f4e29a 100%);
  border: 1px solid #e5cf7c;
  color: #8a7a30;
  font-weight: 700;
  font-size: 11px;
  cursor: grab;
  user-select: none;
  transition: background 0.15s, box-shadow 0.15s;
}
.mini-tab:hover {
  background: linear-gradient(180deg, #fffbe0 0%, #f9ecb4 100%);
  box-shadow: 0 2px 10px rgba(240, 200, 60, 0.45);
}
.mini-tab:active { cursor: grabbing; }
.mini-tab.edge-left,
.mini-tab.edge-right {
  width: 18px;
  height: 64px;
  writing-mode: vertical-lr;
  letter-spacing: 3px;
}
.mini-tab.edge-top,
.mini-tab.edge-bottom {
  width: 64px;
  height: 18px;
  letter-spacing: 3px;
}
.mini-tab.edge-left { border-left: none; border-radius: 0 6px 6px 0; box-shadow: 2px 2px 8px rgba(0, 0, 0, 0.18); }
.mini-tab.edge-right { border-right: none; border-radius: 6px 0 0 6px; box-shadow: -2px 2px 8px rgba(0, 0, 0, 0.18); }
.mini-tab.edge-top { border-top: none; border-radius: 0 0 6px 6px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18); }
.mini-tab.edge-bottom { border-bottom: none; border-radius: 6px 6px 0 0; box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.18); }
.s-date { font-weight: 700; font-size: 12px; color: #8a7a30; flex: 1; }
.s-btns { display: flex; gap: 4px; }
.s-btn {
  border: none;
  background: rgba(255, 255, 255, 0.55);
  color: #8a7a30;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.s-btn:hover { background: #fff; }
.s-body { flex: 1; overflow-y: auto; padding: 2px 10px 8px; }

/* 分组小标题 */
.g-head {
  display: flex; align-items: center; gap: 6px;
  font-size: 10px; font-weight: 700; letter-spacing: 1px;
  padding: 7px 4px 4px; color: #b0a568;
}
.g-head i { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.g-head .n { margin-left: auto; font-weight: 400; }
.g-head.g-hi { color: #c93a3f; } .g-head.g-hi i { background: #e5484d; }
.g-head.g-mid { color: #c47f10; } .g-head.g-mid i { background: #f0a52e; }
.g-head.g-low i { background: #34b96f; }
.g-head.g-none i { background: #cbb863; }

/* 任务行：左侧色条 = 紧急程度 */
.s-task {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 8px 7px 11px;
  margin: 0 0 5px 3px;
  background: rgba(255, 255, 255, 0.62);
  border-radius: 8px;
  transition: transform 0.12s, box-shadow 0.12s;
}
.s-task:hover { transform: translateX(2px); box-shadow: 0 2px 8px rgba(150, 120, 20, 0.18); }
.s-task::before {
  content: ""; position: absolute; left: -3px; top: 7px; bottom: 7px;
  width: 3px; border-radius: 2px;
}
.s-task.hi::before { background: #e5484d; }
.s-task.mid::before { background: #f0a52e; }
.s-task.low::before { background: #34b96f; }
.s-task.none::before { background: #cbb863; opacity: 0.55; }
/* 逾期行加红色微底 */
.s-task.over { background: rgba(229, 72, 77, 0.1); }
.s-task.over:hover { box-shadow: 0 2px 8px rgba(229, 72, 77, 0.22); }

/* 状态徽章 */
.s-meta { display: flex; gap: 5px; margin-top: 3px; flex-wrap: wrap; }
/* 标签行 */
.s-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 3px; }
.s-tags .tag-chip { font-size: 9.5px; padding: 1px 6px; }
.chip { font-size: 9.5px; padding: 1px 6px; border-radius: 7px; white-space: nowrap; font-weight: 600; }
.chip.overdue { background: #e5484d; color: #fff; }
.chip.due-today { background: #f0a52e; color: #fff; }
.chip.due { background: rgba(138, 122, 48, 0.12); color: #8a7a30; font-weight: 400; }
.chip.stay { background: #f0a52e; color: #fff; }

.s-task.done { opacity: 0.62; }
.s-task.done .s-title { text-decoration: line-through; color: #a89f78; }
.s-main { flex: 1; min-width: 0; }
.s-title { font-size: 12.5px; line-height: 1.45; word-break: break-all; }
.chk {
  width: 16px;
  height: 16px;
  margin-top: 2px;
  border-radius: 5px;
  border: 1.5px solid #cbb863;
  flex: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 11px;
}
.chk:hover { border-color: #34b96f; }
.chk.on { background: #34b96f; border-color: #34b96f; }
.s-empty { text-align: center; color: #b0a568; font-size: 12px; padding: 34px 0; line-height: 2; }
.s-add { display: flex; gap: 6px; padding: 9px 12px; border-top: 1px solid rgba(190, 160, 60, 0.25); }
.s-add input {
  flex: 1;
  border: 1px solid rgba(190, 160, 60, 0.35);
  border-radius: 7px;
  padding: 7px 10px;
  font-size: 12px;
  outline: none;
  background: rgba(255, 255, 255, 0.75);
  color: #4a4326;
}
.s-add input:focus { border-color: #34b96f; background: #fff; }
.s-add button {
  border: none;
  background: #34b96f;
  color: #fff;
  border-radius: 7px;
  width: 32px;
  cursor: pointer;
  font-size: 14px;
}
.s-add button:hover { background: #2ca45f; }
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-thumb { background: rgba(190, 160, 60, 0.35); border-radius: 3px; }
</style>
