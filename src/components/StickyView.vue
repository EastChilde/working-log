<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useTaskStore, todayKey } from "../stores/tasks";
import { getCurrentWindow, currentMonitor, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";

const store = useTaskStore();
const today = todayKey();
const input = ref("");

const isTauri = "__TAURI_INTERNALS__" in window;
const win = isTauri ? getCurrentWindow() : null;

/** 贴边最小化：拉手可拖拽、自动吸附上下左右四边，位置记忆（localStorage） */
type DockEdge = "top" | "bottom" | "left" | "right";
const minimized = ref(false);
let savedGeom: { x: number; y: number; w: number; h: number } | null = null;
const SIDE_W = 18, SIDE_H = 64;   // 左右侧边拉手（竖排）
const EDGE_W = 64, EDGE_H = 18;   // 上下横边拉手（横排）
const DOCK_KEY = "sticky-dock-v1";

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
    savedGeom = { x: pos.x, y: pos.y, w: size.width, h: size.height };
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
  if (savedGeom) {
    await win.setPosition(new PhysicalPosition(savedGeom.x, savedGeom.y));
    await win.setSize(new PhysicalSize(savedGeom.w, savedGeom.h));
  }
  minimized.value = false;
}

/** 拉手拖拽：拖动跟随鼠标，松手吸附最近边缘；原地点击 = 展开便签 */
let dragMoved = false;
async function onTabDown(e: MouseEvent) {
  if (!win || e.button !== 0) return;
  e.preventDefault();
  dragMoved = false;
  const pos = await win.outerPosition();
  const scale = window.devicePixelRatio || 1;
  const sx = e.clientX, sy = e.clientY, wx = pos.x, wy = pos.y;
  const move = async (ev: MouseEvent) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!dragMoved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    dragMoved = true;
    await win.setPosition(new PhysicalPosition(Math.round(wx + dx * scale), Math.round(wy + dy * scale)));
  };
  const up = async () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    if (dragMoved) await snapToEdge();
    else await restoreFromEdge();
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

async function snapToEdge() {
  if (!win) return;
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
}

/** 便签视图：未完成任务（滞留在前）+ 今日已完成（置灰划线） */
const open = computed(() =>
  store.openTasks
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.sort - b.sort)
);
const doneToday = computed(() => store.doneToday);
const stayed = (t: { created_at: string }) => {
  const days = Math.floor((Date.parse(today) - Date.parse(t.created_at)) / 86400000);
  return days;
};

async function add() {
  if (!input.value.trim()) return;
  await store.add(input.value, today);
  input.value = "";
}

onMounted(() => store.initSync());
</script>

<template>
  <!-- 贴边最小化：可拖拽拉手（自动吸附上/下/左/右缘） -->
  <div
    v-if="minimized"
    class="mini-tab"
    :class="'edge-' + dockEdge"
    title="拖拽换边 · 点击展开便签"
    @mousedown="onTabDown"
  >便签</div>

  <div v-else class="sticky">
    <div class="s-head" data-tauri-drag-region>
      <span class="s-date" data-tauri-drag-region>今日待办 · {{ today.slice(5) }}</span>
      <div class="s-btns">
        <button class="s-btn" title="贴边隐藏（拖动拉手可换边）" @click="minimizeToEdge">—</button>
      </div>
    </div>

    <div class="s-body">
      <div
        v-for="t in open"
        :key="t.id"
        class="s-task"
        :class="{ stayed: t.created_at < today }"
      >
        <div class="chk" @click="store.toggle(t.id)"></div>
        <div class="s-title">
          {{ t.title }}
          <span v-if="t.created_at < today" class="s-stay">{{ stayed(t) }}天前</span>
        </div>
      </div>

      <div v-for="t in doneToday" :key="t.id" class="s-task done">
        <div class="chk on" @click="store.toggle(t.id)">✓</div>
        <div class="s-title">{{ t.title }}</div>
      </div>

      <div v-if="!open.length && !doneToday.length" class="s-empty">
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
  padding: 9px 10px 7px 14px;
  border-bottom: 1px solid rgba(190, 160, 60, 0.25);
  cursor: default;
  user-select: none;
}
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
.s-body { flex: 1; overflow-y: auto; padding: 10px 12px; }
.s-task {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 8px;
  margin-bottom: 6px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 8px;
}
.s-task.stayed { border-left: 3px solid #f0a52e; }
.s-task.done { opacity: 0.62; }
.s-task.done .s-title { text-decoration: line-through; color: #a89f78; }
.s-title { flex: 1; min-width: 0; word-break: break-all; line-height: 1.45; }
.s-stay {
  font-size: 10px;
  color: #fff;
  background: #f0a52e;
  border-radius: 7px;
  padding: 1px 6px;
  margin-left: 4px;
  white-space: nowrap;
}
.chk {
  width: 16px;
  height: 16px;
  margin-top: 1px;
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
