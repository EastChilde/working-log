<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useTaskStore, todayKey } from "../stores/tasks";
import { getCurrentWindow, currentMonitor, cursorPosition, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
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
let lastExpandSize = { w: 310, h: 440 }; // 最近一次展开尺寸（停靠收缩后恢复用，无几何记忆时兜底）
const SLIM = 8;                   // 贴边条厚度（px）：侧边停靠露全高竖条、上下停靠露全宽横条
const DOCK_KEY = "sticky-dock-v1";
const POS_KEY = "sticky-pos-v1";  // 展开态窗口几何记忆
const SNAP_PX = 80;               // 距屏幕边多少像素内松手 → 自动吸附（32 太苛刻，用户"放到边上"经常差几十像素）
const PEEK_DELAY = 700;           // hover 展开后鼠标移开多久自动收回
let lastDockTs = 0;               // 收起时间戳：短暂冷却，防收起/展开循环抖动
let dockOff = 0;                  // 条沿贴边方向的起点（屏内局部坐标），贴边接近侦测用
let dockLen = 0;                  // 条沿贴边方向的长度

/** 几何有效性：必须明显大于拉手尺寸，防止把 tab 尺寸当展开几何持久化（污染死循环） */
function validGeom(g: { x: number; y: number; w: number; h: number } | null | undefined): g is { x: number; y: number; w: number; h: number } {
  return !!g && g.w > SLIM + 60 && g.h > SLIM + 60;
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
  dockOff = off;
  dockLen = dockEdge.value === "left" || dockEdge.value === "right" ? lastExpandSize.h : lastExpandSize.w;
  try { localStorage.setItem(DOCK_KEY, JSON.stringify({ edge: dockEdge.value, off })); } catch { /* ignore */ }
}

/* ===== 丝滑停靠：位置与尺寸边缘锚定联动 =====
 * 收起 = 整窗滑到贴边齐平（内容完整可见）→ 原地以边缘为锚收缩成条，内容 transform 同步「塞入」边缘；
 * 展开 = 逆过程（从条原地长出）。窗口全程屏内（WebView2 不会因不可见挂起输入），无离屏/透明空档 */
const tabVisible = ref(false); // 拉手覆盖层：停靠收缩段/停靠后显示，展开完成后隐藏
const stickyEl = ref<HTMLElement | null>(null); // 内容面板：动画期间需固定像素尺寸 + transform 同步
let transSeq = 0;              // 过渡序号：新过渡发起后旧过渡自动让位

/** 位置缓动滑行：easeOutCubic，约 220ms，每帧一次 setPosition（无重排） */
function slideTo(tx: number, ty: number, seq: number = ++transSeq, dur = 220) {
  return new Promise<void>((resolve) => {
    if (!win) return resolve();
    win.outerPosition()
      .then(async (p0) => {
        if (seq !== transSeq) return resolve();
        const dx = tx - p0.x, dy = ty - p0.y;
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return resolve();
        const t0 = performance.now();
        // 逐帧等待 IPC 应用后再走下一帧：fire-and-forget 会让命令在队列里积压，
        // JS 播完后窗口还在慢慢补帧（细条「延迟回去」的根源）；150ms 兜底防 IPC 卡死拖死动画
        for (;;) {
          if (seq !== transSeq) return resolve();
          const t = Math.min(1, (performance.now() - t0) / dur);
          const e = 1 - Math.pow(1 - t, 3);
          await Promise.race([
            win!.setPosition(new PhysicalPosition(Math.round(p0.x + dx * e), Math.round(p0.y + dy * e))).catch(() => { /* ignore */ }),
            new Promise((r) => setTimeout(r, 150)),
          ]);
          if (seq !== transSeq) return resolve();
          if (t >= 1) return resolve();
        }
      })
      .catch(() => resolve());
  });
}

/** 停靠到指定边。
 * 全尺寸收起：先整窗滑向边缘（动画），到位后把窗口收缩为条尺寸并完全留在屏内——
 * 旧方案把大窗口留在屏外，WebView2 会因窗口不可见而挂起输入，导致细条唤不出（进出几次后失灵）；
 * 条状态换边：直接以条尺寸滑到新边贴屏内位置。 */
async function dockTo(edge: DockEdge) {
  if (!win) return;
  const seq = ++transSeq;
  const mon = await ipc(currentMonitor());
  if (!mon) return;
  const m = mon.size;
  const rs = await ipc(Promise.all([win.outerPosition(), win.innerSize()] as const));
  if (!rs) return;
  const [pos, size] = rs;
  let x: number, y: number, off: number;

  if (minimized.value) {
    // 细条拖拽换边：变成目标方向的条尺寸后整条滑到新边（全程在屏内）
    const tw = edge === "left" || edge === "right" ? SLIM : lastExpandSize.w;
    const th = edge === "left" || edge === "right" ? lastExpandSize.h : SLIM;
    if (tw !== size.width || th !== size.height) {
      try { await ipc(win.setSize(new PhysicalSize(tw, th)), 400); } catch { /* ignore */ }
    }
    // 回读实际尺寸：若被系统最小尺寸钳制，按真实尺寸计算贴边位置
    let aw = tw, ah = th;
    try { const asz = await ipc(win.innerSize(), 300); if (asz) { aw = asz.width; ah = asz.height; } } catch { /* ignore */ }
    if (edge === "right") { x = aw <= SLIM ? m.width - aw : m.width - SLIM; y = clamp(pos.y, 0, m.height - ah); off = y; }
    else if (edge === "left") { x = aw <= SLIM ? 0 : -(aw - SLIM); y = clamp(pos.y, 0, m.height - ah); off = y; }
    else if (edge === "top") { y = ah <= SLIM ? 0 : -(ah - SLIM); x = clamp(pos.x, 0, m.width - aw); off = x; }
    else { y = ah <= SLIM ? m.height - ah : m.height - SLIM; x = clamp(pos.x, 0, m.width - aw); off = x; }
    dockEdge.value = edge;
    autoPeek.value = false;
    tabVisible.value = true;
    await slideTo(x, y, seq);
    if (seq !== transSeq) return;
    minimized.value = true;
    persistDock(off);
    lastDockTs = Date.now();
    return;
  }

  // 全尺寸收起（两段式，窗口全程屏内，内容不消失）：
  // ① 整窗滑到与目标边齐平（内容完整可见，条暂不显示）
  // ② 以边缘为锚原地收缩为条，内容 transform 同步「塞入」边缘 —— 无离屏/透明空档
  //    （旧方案整窗滑出屏外只留一条：tab 一显示内容就从 DOM 消失，窗口瞬间离屏再跳回，非常生硬）
  const flushX = edge === "left" ? 0 : edge === "right" ? m.width - size.width : clamp(pos.x, 0, Math.max(0, m.width - size.width));
  const flushY = edge === "top" ? 0 : edge === "bottom" ? m.height - size.height : clamp(pos.y, 0, Math.max(0, m.height - size.height));
  off = edge === "left" || edge === "right" ? flushY : flushX;
  dockEdge.value = edge;
  autoPeek.value = false;
  restoring = true; // 收缩途中窗口会小于 SLIM+2，防自愈哨兵抢翻状态
  try {
    minimized.value = false; // 内容保持可见（v-show，与条共存）
    await slideTo(flushX, flushY, seq, 200);
    if (seq !== transSeq) return;
    tabVisible.value = true; // 条上场，随收缩缘一起落到最终位置
    await shrinkDock(edge, size.width, size.height, seq, flushX, flushY);
    if (seq !== transSeq) return;
    minimized.value = true; // 切到条 DOM（窗口已是条尺寸）
    clearContentStyles();
    persistDock(off);
    lastDockTs = Date.now();
  } finally {
    restoring = false;
  }
}

/** 内容 transform 同步：固定尺寸的内容按 (w-cw, h-ch) 平移「塞入」边缘侧 */
function setTuckTransform(edge: DockEdge, el: HTMLElement | null, w: number, h: number, cw: number, ch: number) {
  if (!el) return;
  const dx = edge === "left" ? -(w - cw) : edge === "right" ? w - cw : 0;
  const dy = edge === "top" ? -(h - ch) : edge === "bottom" ? h - ch : 0;
  el.style.transform = `translate(${dx}px, ${dy}px)`;
}
function clearContentStyles() {
  const el = stickyEl.value;
  if (el) { el.style.width = ""; el.style.height = ""; el.style.transform = ""; }
}

/** 停靠收缩：从贴边齐平的全尺寸 (w0×h0) 以边缘为锚收缩到条尺寸。
 * 每帧 setSize+setPosition 成对（贴边一侧坐标锁定），内容 transform 同步滑入边缘；
 * 内容固定像素尺寸抵消视口重排 —— 视觉上 = 便签原地缩进屏幕边缘 */
async function shrinkDock(edge: DockEdge, w0: number, h0: number, seq: number, fx: number, fy: number, dur = 190) {
  if (!win) return;
  const mon = await ipc(currentMonitor());
  if (!mon) return;
  const m = mon.size;
  const content = stickyEl.value;
  const tw = edge === "left" || edge === "right" ? SLIM : w0;
  const th = edge === "top" || edge === "bottom" ? SLIM : h0;
  if (content) { content.style.width = w0 + "px"; content.style.height = h0 + "px"; }
  const t0 = performance.now();
  // 逐帧等待 IPC 应用后再走下一帧（自节奏）：命令积压会让 JS 播完后窗口继续补帧，
  // 视觉上细条最后慢慢溜回去；每帧 150ms 兜底防 IPC 卡死拖死状态机
  for (;;) {
    if (seq !== transSeq) return;
    const t = Math.min(1, (performance.now() - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    const cw = Math.round(w0 + (tw - w0) * e);
    const ch = Math.round(h0 + (th - h0) * e);
    let px = fx, py = fy;
    if (edge === "right") px = m.width - cw;
    else if (edge === "bottom") py = m.height - ch;
    if (content) setTuckTransform(edge, content, w0, h0, cw, ch);
    await Promise.race([
      Promise.all([
        win.setSize(new PhysicalSize(cw, ch)).catch(() => { /* ignore */ }),
        win.setPosition(new PhysicalPosition(px, py)).catch(() => { /* ignore */ }),
      ]),
      new Promise((r) => setTimeout(r, 150)),
    ]);
    if (seq !== transSeq) return;
    if (t >= 1) break;
  }
  // 收口：最终几何精确落定（带超时兜底，IPC 卡死也不阻塞状态机）
  const fw = edge === "left" || edge === "right" ? SLIM : w0;
  const fh = edge === "top" || edge === "bottom" ? SLIM : h0;
  let ax = fx, ay = fy;
  if (edge === "right") ax = m.width - fw;
  else if (edge === "bottom") ay = m.height - fh;
  await Promise.race([
    Promise.all([
      win.setSize(new PhysicalSize(fw, fh)).catch(() => { /* ignore */ }),
      win.setPosition(new PhysicalPosition(ax, ay)).catch(() => { /* ignore */ }),
    ]),
    new Promise((r) => setTimeout(r, 400)),
  ]);
}

/** 展开生长：从条尺寸以边缘为锚生长到 (w×h)，内容从边缘侧滑出（shrinkDock 的逆动画） */
async function growFromEdge(edge: DockEdge, w: number, h: number, seq: number, dur = 190) {
  if (!win) return;
  const mon = await ipc(currentMonitor());
  if (!mon) return;
  const m = mon.size;
  const content = stickyEl.value;
  let sw = edge === "left" || edge === "right" ? SLIM : w;
  let sh = edge === "top" || edge === "bottom" ? SLIM : h;
  let sx = 0, sy = 0;
  try {
    const [sz, pos] = await Promise.all([win.innerSize(), win.outerPosition()]);
    sw = sz.width; sh = sz.height; sx = pos.x; sy = pos.y;
  } catch { /* ignore */ }
  if (edge === "right") sx = m.width - sw;
  else if (edge === "left") sx = 0;
  if (edge === "bottom") sy = m.height - sh;
  else if (edge === "top") sy = 0;
  if (content) {
    content.style.width = w + "px"; content.style.height = h + "px";
    setTuckTransform(edge, content, w, h, sw, sh);
  }
  const t0 = performance.now();
  // 逐帧等待 IPC 应用后再走下一帧（与 shrinkDock 同理，消除积压补帧尾巴）
  for (;;) {
    if (seq !== transSeq) return;
    const t = Math.min(1, (performance.now() - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    const cw = Math.round(sw + (w - sw) * e);
    const ch = Math.round(sh + (h - sh) * e);
    let px = sx, py = sy;
    if (edge === "right") px = m.width - cw;
    else if (edge === "left") px = 0;
    else if (edge === "bottom") py = m.height - ch;
    else py = 0;
    if (content) setTuckTransform(edge, content, w, h, cw, ch);
    await Promise.race([
      Promise.all([
        win.setSize(new PhysicalSize(cw, ch)).catch(() => { /* ignore */ }),
        win.setPosition(new PhysicalPosition(px, py)).catch(() => { /* ignore */ }),
      ]),
      new Promise((r) => setTimeout(r, 150)),
    ]);
    if (seq !== transSeq) return;
    if (t >= 1) break;
  }
  let ax = sx, ay = sy;
  if (edge === "right") ax = m.width - w;
  else if (edge === "left") ax = 0;
  if (edge === "bottom") ay = m.height - h;
  else if (edge === "top") ay = 0;
  await Promise.race([
    Promise.all([
      win.setSize(new PhysicalSize(w, h)).catch(() => { /* ignore */ }),
      win.setPosition(new PhysicalPosition(ax, ay)).catch(() => { /* ignore */ }),
    ]),
    new Promise((r) => setTimeout(r, 400)),
  ]);
}

/** 收起：记录展开几何后停靠 */
async function minimizeToEdge() {
  if (!win) return;
  try {
    const rs = await ipc(Promise.all([win.outerPosition(), win.innerSize()] as const));
    if (rs) {
      const [p, s] = rs;
      const cand = { x: p.x, y: p.y, w: s.width, h: s.height };
      if (validGeom(cand)) { savedGeom = cand; persistPos(cand); lastExpandSize = { w: cand.w, h: cand.h }; }
    }
  } catch { /* ignore */ }
  try { await dockTo(dockEdge.value); } catch (e) { console.error("minimize failed", e); }
}

function clamp(v: number | undefined, lo: number, hi: number): number {
  const n = typeof v === "number" && !isNaN(v) ? v : lo;
  return Math.max(lo, Math.min(n, hi));
}

/** IPC 超时竞速：此环境窗口命令间歇卡死（实测），吸附/收回链路里任何无超时的
 * await 一旦挂起，整条状态机链就静默丢失——表现为「贴边不吸附」「hover 不收回」。
 * 超时/出错统一返回 null，调用方必须容错（放弃本次动作，靠重试/下一轮轮询收敛） */
function ipc<T>(p: Promise<T>, ms = 400): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ]);
}

/** 合并判边：光标距离与窗口矩形距离每边取 min，选最近的边。
 * 只看光标：窗口已贴边但手抓在标题栏中部（离边几十像素）→ 松手不吸附，「明明贴上了却没反应」；
 * 只看窗口：抓握点偏移会把「碰顶部」误判成贴其它近边（历史 bug）。
 * 两者取 min 后判边兼吸附，两类场景都命中 */
async function nearestEdgeCombined(): Promise<{ edge: DockEdge; dist: number } | null> {
  if (!win) return null;
  try {
    const mon = await ipc(currentMonitor());
    if (!mon) return null;
    const rs = await ipc(Promise.all([win.outerPosition(), win.innerSize()] as const));
    if (!rs) return null;
    const [pos, size] = rs;
    const mx = mon.position.x, my = mon.position.y;
    const wd: Record<DockEdge, number> = {
      left: pos.x - mx,
      right: mx + mon.size.width - pos.x - size.width,
      top: pos.y - my,
      bottom: my + mon.size.height - pos.y - size.height,
    };
    const pick = (d: Record<DockEdge, number>) => {
      const pairs = (Object.keys(d) as DockEdge[]).map((k) => [k, d[k]] as const);
      const [edge, dist] = pairs.reduce((a, b) => (a[1] <= b[1] ? a : b));
      return { edge, dist };
    };
    try {
      const c = await ipc(cursorPosition());
      if (!c) return pick(wd); // 光标读不到：退回纯窗口矩形判定，至少能吸附
      const cd: Record<DockEdge, number> = {
        left: c.x - mx,
        right: mx + mon.size.width - c.x,
        top: c.y - my,
        bottom: my + mon.size.height - c.y,
      };
      const d = (Object.keys(wd) as DockEdge[]).reduce(
        (acc, k) => { acc[k] = Math.min(cd[k], wd[k]); return acc; },
        {} as Record<DockEdge, number>,
      );
      return pick(d);
    } catch {
      return pick(wd); // 读不到光标退回窗口矩形
    }
  } catch { return null; }
}

/** 恢复展开（hover 或点击条触发）。
 * 两段式：① 从条尺寸以边缘为锚原地生长到展开尺寸，内容从边缘侧滑出（tab 覆盖条区防露馅）；
 * ② 滑回记忆位置。所有窗口命令加 400ms 超时兜底：Tauri IPC 在此环境偶发卡死，
 * 即便晚到，最终几何也会收敛正确 */
let restoring = false;
async function restoreFromEdge() {
  if (!win || restoring) return;
  restoring = true;
  try {
    const seq = ++transSeq;
    const g = validGeom(savedGeom) ? savedGeom : readStoredPos();
    const w = g ? g.w : lastExpandSize.w;
    const h = g ? g.h : lastExpandSize.h;
    minimized.value = false; // 内容 DOM 上场（条仍覆盖条区，展开完成后才收条）
    await growFromEdge(dockEdge.value, w, h, seq);
    if (seq !== transSeq) return;
    try {
      const mon = await ipc(currentMonitor());
      if (mon) {
        let x: number, y: number;
        if (g) {
          x = clamp(g.x, 0, Math.max(0, mon.size.width - w));
          y = clamp(g.y, 0, Math.max(0, mon.size.height - h));
        } else {
          const pos = await ipc(win.outerPosition());
          if (!pos) throw new Error("pos timeout");
          x = dockEdge.value === "left" ? 24 : dockEdge.value === "right" ? mon.size.width - w - 24 : pos.x;
          y = dockEdge.value === "top" ? 24 : dockEdge.value === "bottom" ? mon.size.height - h - 24 : pos.y;
          x = clamp(x, 0, Math.max(0, mon.size.width - w));
          y = clamp(y, 0, Math.max(0, mon.size.height - h));
        }
        await slideTo(x, y, seq, 200);
      }
    } catch { /* ignore */ }
    clearContentStyles();
    if (seq === transSeq) tabVisible.value = false; // 无论成败都收掉条，避免条罩在面板上
  } finally {
    restoring = false;
  }
}

/** hover 条 → 自动滑出（不抢焦点）；收起后短暂冷却防止边缘抖动。
 * 判定用 tabVisible（条是否在）而不是 minimized：IPC 卡死可能把 minimized 打成 false
 * 而窗口还是条尺寸，此时 hover 仍需能救回来 */
async function peekExpand() {
  if (!win || !tabVisible.value || restoring) return;
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

/** 原生窗口拖拽：OS 级移动（与系统拖标题栏同机制，满帧丝滑），松手后回调
 * 结束检测双保险：Windows 上 startDragging 的 Promise 在松手后才 resolve；
 * 位置轮询连续稳定 3 次兜底（防平台差异 Promise 提前返回） */
let nativeDragSeq = 0;
function startWindowDrag(e: MouseEvent, onDrop: (moved: boolean) => void) {
  if (!win || e.button !== 0) return;
  e.preventDefault();
  const seq = ++nativeDragSeq;
  let done = false;
  let changed = false;
  let lastX = NaN, lastY = NaN;
  let stable = 0;
  let iv: number | null = null;
  const finish = () => {
    if (done) return;
    done = true;
    if (iv !== null) window.clearInterval(iv);
    onDrop(changed);
  };
  win.outerPosition()
    .catch(() => null)
    .then((p0) => {
      if (!p0 || seq !== nativeDragSeq) return;
      lastX = p0.x;
      lastY = p0.y;
      iv = window.setInterval(async () => {
        if (done) return;
        try {
          const p = await ipc(win!.outerPosition(), 200);
          if (!p) return;
          if (p.x !== lastX || p.y !== lastY) { changed = true; lastX = p.x; lastY = p.y; stable = 0; }
          else if (changed && ++stable >= 3) finish();
        } catch { /* ignore */ }
      }, 33);
      // 松手后必须做一次最终位置对比：若拖拽期间 JS 被模态循环冻结，
      // 轮询从未观察到移动（changed 恒 false），仅靠轮询会误判"未移动"导致贴边吸附永不触发
      win!.startDragging().then(async () => {
        try {
          const p = await ipc(win!.outerPosition(), 300);
          if (p && (p.x !== p0.x || p.y !== p0.y)) changed = true;
        } catch { /* ignore */ }
        finish();
      }, finish);
    })
    .catch(() => { /* ignore */ });
}

/** 展开态标题栏拖拽：松手距屏幕边 < SNAP_PX 自动吸附收起，否则记忆位置 */
function onHeadDown(e: MouseEvent) {
  if ((e.target as HTMLElement).closest(".s-btns")) return; // 按钮区不拖拽
  cancelPeekHide();
  autoPeek.value = false; // 主动拖拽 = 主动使用，之后不自动收回
  startWindowDrag(e, async (moved) => {
    if (!moved) return;
    try {
      const rs = await ipc(Promise.all([win!.outerPosition(), win!.innerSize()] as const));
      if (!rs) return;
      const [pos, size] = rs;
      // 合并光标+窗口矩形判边：窗口贴到边（哪怕手抓在标题栏中部）就吸附
      const near = await nearestEdgeCombined();
      if (near && near.dist < SNAP_PX) {
        await snapToEdge();
      } else if (near) {
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
  // （拉手拖拽换边时已 minimized，窗口是展开尺寸，不受影响）
  if (!minimized.value) {
    try {
      const rs = await ipc(Promise.all([win.outerPosition(), win.innerSize()] as const));
      if (rs) {
        const [p, s] = rs;
        savedGeom = { x: p.x, y: p.y, w: s.width, h: s.height };
        persistPos(savedGeom);
        lastExpandSize = { w: s.width, h: s.height };
      }
    } catch { /* ignore */ }
  }
  const mon = await ipc(currentMonitor());
  if (!mon) return;
  // 合并光标+窗口矩形判边（贴到边就吸附；抓握偏移不再误判边）
  const near = await nearestEdgeCombined();
  if (!near) return; // IPC 全超时：放弃本次吸附，不硬猜边（宁可不吸也不能吸错边）
  await dockTo(near.edge);
}

/** 程序内自定义缩放：窗口 resizable:false（系统缩放带会覆盖 8px 贴边条，hover 全失效），
 * 而 startResizeDragging 依赖系统 SC_SIZE 缩放循环，在无边框+resizable:false 下不生效。
 * 改为手动跟随光标：mousedown 记初始几何，pointermove 每帧 setSize（自节奏：上一帧
 * 应用完成后才处理下一帧，防 IPC 积压），pointerup 记忆新几何 */
let resizing = false;
async function startResize(dir: "East" | "West" | "South" | "SouthEast" | "SouthWest", e: MouseEvent) {
  if (!win || e.button !== 0 || restoring) return;
  e.preventDefault();
  e.stopPropagation();
  cancelPeekHide();
  autoPeek.value = false; // 主动缩放 = 主动使用，之后不自动收回
  try {
    const rs0 = await ipc(Promise.all([win.outerPosition(), win.innerSize()] as const));
    if (!rs0) return;
    const [p0, s0] = rs0;
    resizing = true;
    // 拖动时固定不动的边（西向拖 = 右边缘锚定；北向不支持，标题栏已承担移动）
    const anchor = { right: p0.x + s0.width, bottom: p0.y + s0.height };
    let busy = false;
    const move = async () => {
      if (busy || !resizing || !win) return;
      busy = true;
      try {
        const c = await ipc(cursorPosition(), 200);
        if (c) {
          let w = s0.width, h = s0.height, x = p0.x;
          if (dir === "East" || dir === "SouthEast") w = c.x - p0.x;
          if (dir === "West" || dir === "SouthWest") w = anchor.right - c.x;
          if (dir === "South" || dir === "SouthEast" || dir === "SouthWest") h = c.y - p0.y;
          w = clamp(w, 240, 4000);
          h = clamp(h, 300, 4000);
          await ipc(win.setSize(new PhysicalSize(Math.round(w), Math.round(h))), 200);
          if (dir === "West" || dir === "SouthWest") {
            // 钳制后重算 x，保证右边缘不动
            await ipc(win.setPosition(new PhysicalPosition(Math.round(anchor.right - w), Math.round(p0.y))), 200);
          }
        }
      } catch { /* ignore */ } finally { busy = false; }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      resizing = false;
      void (async () => {
        try {
          const rs = await ipc(Promise.all([win!.outerPosition(), win!.innerSize()] as const));
          if (!rs) return;
          const [p, s] = rs;
          const cand = { x: p.x, y: p.y, w: s.width, h: s.height };
          if (validGeom(cand)) { savedGeom = cand; persistPos(cand); lastExpandSize = { w: s.width, h: s.height }; }
        } catch { /* ignore */ }
      })();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    await move(); // 立即一帧，手感即时
  } catch { /* ignore */ }
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
  // ---- 状态机自愈哨兵 ----
  // IPC 偶发卡死可能把状态机打死在「窗口已是条尺寸 + DOM 还是展开态」：
  // 此时 mini-tab 不存在，hover 永远无效。哨兵发现这种错位就把状态翻回条模式。
  if (win) {
    window.setInterval(() => {
      if (restoring || minimized.value) return;
      const dw = document.documentElement.clientWidth;
      const dh = document.documentElement.clientHeight;
      if (dw <= SLIM + 2 || dh <= SLIM + 2) {
        minimized.value = true;
        tabVisible.value = true;
      }
    }, 800);
    // ---- 贴边侦测轮询（每 220ms）----
    // ① 停靠中：光标接近贴边区且在条跨度内 → 自动展开。8px 条的 mouseenter 目标太小且
    //    常收不到（WebView 事件不稳），用全局光标位置判定大幅提升命中率；
    // ② hover 展开后：窗口在光标下生长时 DOM 收不到 mouseenter，光标随后离开也收不到
    //    mouseleave —— 光标既不在窗口内也不在贴边区时主动收回。
    //    全部调用带 300ms 超时兜底，IPC 卡死只跳过本 tick
    window.setInterval(async () => {
      if (!win || restoring) return;
      try {
        const mon = await Promise.race([currentMonitor(), new Promise<null>((r) => setTimeout(() => r(null), 300))]);
        if (!mon) return;
        const c = await Promise.race([cursorPosition(), new Promise<null>((r) => setTimeout(() => r(null), 300))]);
        if (!c) return;
        const lx = c.x - mon.position.x, ly = c.y - mon.position.y;
        const edge = dockEdge.value;
        const nearDist = edge === "left" ? lx : edge === "right" ? mon.size.width - lx : edge === "top" ? ly : mon.size.height - ly;
        const along = edge === "left" || edge === "right" ? ly : lx;
        if (minimized.value) {
          if (!tabVisible.value || dockLen <= 0) return;
          const inSpan = along > dockOff - 32 && along < dockOff + dockLen + 32;
          if (nearDist < 28 && inSpan) await peekExpand();
        } else if (autoPeek.value) {
          const rs = await Promise.race([
            Promise.all([win.outerPosition(), win.innerSize()]),
            new Promise<null>((r) => setTimeout(() => r(null), 300)),
          ]);
          if (!rs) return;
          const [p, s] = rs;
          const gx = p.x - mon.position.x, gy = p.y - mon.position.y;
          const inside = lx >= gx - 4 && lx <= gx + s.width + 4 && ly >= gy - 4 && ly <= gy + s.height + 4;
          if (!inside) schedulePeekHide();
        }
      } catch { /* ignore */ }
    }, 220);
    // ---- 手动缩放最小尺寸钳制 ----
    // 原生 resizable:false 后系统不再管最小尺寸（配置里的 minWidth 会钳制停靠收缩的 setSize）；
    // 缩得太小就在这里钳回。restoring/minimized 门控避开停靠动画与条状态窗口
    let clamping = false;
    void win.onResized(async ({ payload: s }) => {
      if (restoring || minimized.value || clamping) return;
      if (s.width >= 240 && s.height >= 300) return;
      clamping = true;
      try { await ipc(win.setSize(new PhysicalSize(Math.max(240, s.width), Math.max(300, s.height))), 400); } catch { /* ignore */ }
      clamping = false;
    });
  }
  // 恢复上次的展开位置/尺寸
  if (win) {
    const g = readStoredPos();
    if (g) {
      void win.setSize(new PhysicalSize(g.w, g.h)).catch(() => { /* ignore */ });
      // 恢复位置兜底：完整收进屏幕内。
      // 贴边吸附会把几乎贴边的松手位置存入记忆，原样恢复会让便签几乎全在屏外（看起来像消失）
      void (async () => {
        try {
          const mon = await ipc(currentMonitor());
          const x = mon ? clamp(g.x, 0, Math.max(0, mon.size.width - g.w)) : g.x;
          const y = mon ? clamp(g.y, 0, Math.max(0, mon.size.height - g.h)) : g.y;
          await ipc(win.setPosition(new PhysicalPosition(x, y)), 400);
        } catch {
          void win.setPosition(new PhysicalPosition(g.x, g.y)).catch(() => { /* ignore */ });
        }
      })();
    }
  }
});
</script>

<template>
  <!-- 贴边条：停靠时露出与面板同宽/同高的半透明细条；鼠标移过自动滑出；按住可拖拽换边 -->
  <div
    v-if="tabVisible"
    class="mini-tab"
    :class="'edge-' + dockEdge"
    title="移过来自动展开 · 按住拖拽换边"
    @mouseenter="peekExpand"
    @mousedown="onTabDown"
  ></div>

  <!-- v-show 而非 v-else：停靠/展开动画期间条与内容需同时在场（内容滑入边缘时条覆盖条区防露馅） -->
  <div v-show="!minimized" ref="stickyEl" class="sticky" @mouseenter="cancelPeekHide" @mouseleave="schedulePeekHide">
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

    <!-- 自定义缩放把手：窗口 resizable:false（系统隐形缩放带会覆盖 8px 贴边条致 hover 失效），
         缩放改由把手走 OS 原生缩放循环；右下角带可见拖拽标记 -->
    <div class="rz rz-e" @mousedown="startResize('East', $event)"></div>
    <div class="rz rz-w" @mousedown="startResize('West', $event)"></div>
    <div class="rz rz-s" @mousedown="startResize('South', $event)"></div>
    <div class="rz rz-se" @mousedown="startResize('SouthEast', $event)"></div>
    <div class="rz rz-sw" @mousedown="startResize('SouthWest', $event)"></div>
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
  position: relative;
}
/* ===== 自定义缩放把手（不可见热区；右下角带拖拽标记） ===== */
.rz { position: absolute; z-index: 40; }
.rz-e  { right: 0; top: 0; width: 6px; height: 100%; cursor: ew-resize; }
.rz-w  { left: 0; top: 0; width: 6px; height: 100%; cursor: ew-resize; }
.rz-s  { left: 0; bottom: 0; width: 100%; height: 6px; cursor: ns-resize; }
.rz-se { right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; }
.rz-sw { left: 0; bottom: 0; width: 16px; height: 16px; cursor: nesw-resize; }
.rz-se::after {
  content: "";
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 7px;
  height: 7px;
  border-right: 2px solid rgba(160, 130, 40, 0.45);
  border-bottom: 2px solid rgba(160, 130, 40, 0.45);
}
.rz-se:hover::after { border-color: rgba(160, 130, 40, 0.85); }
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

/* 贴边条：与面板同宽（上下停靠）/同高（左右停靠）的半透明细条；
 * 平时低调蛰伏，hover 点亮发光 —— 像从屏幕边缘长出来的一条琥珀色薄边 */
.mini-tab {
  position: fixed;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(250, 238, 180, 0.82), rgba(240, 220, 140, 0.72));
  cursor: grab;
  user-select: none;
  opacity: 0.7;
  transition: opacity 0.18s, background 0.18s, box-shadow 0.18s;
}
.mini-tab:hover {
  opacity: 1;
  background: linear-gradient(180deg, #fff8d6, #f6e6a2);
}
.mini-tab:active { cursor: grabbing; }
/* 条铺满窗口可见侧：贴屏幕边缘一侧平直，内侧圆角 + 亮线 + 柔和投影 */
.mini-tab.edge-right { left: 0; top: 0; width: 8px; height: 100%; border-left: 1px solid rgba(214, 190, 105, 0.9); border-radius: 6px 0 0 6px; box-shadow: -2px 0 10px rgba(0, 0, 0, 0.16); }
.mini-tab.edge-left  { right: 0; top: 0; width: 8px; height: 100%; border-right: 1px solid rgba(214, 190, 105, 0.9); border-radius: 0 6px 6px 0; box-shadow: 2px 0 10px rgba(0, 0, 0, 0.16); }
.mini-tab.edge-top    { bottom: 0; left: 0; width: 100%; height: 8px; border-bottom: 1px solid rgba(214, 190, 105, 0.9); border-radius: 0 0 6px 6px; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.16); }
.mini-tab.edge-bottom { top: 0; left: 0; width: 100%; height: 8px; border-top: 1px solid rgba(214, 190, 105, 0.9); border-radius: 6px 6px 0 0; box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.16); }
.mini-tab.edge-right:hover { box-shadow: -2px 0 14px rgba(240, 200, 60, 0.5); }
.mini-tab.edge-left:hover  { box-shadow: 2px 0 14px rgba(240, 200, 60, 0.5); }
.mini-tab.edge-top:hover   { box-shadow: 0 2px 14px rgba(240, 200, 60, 0.5); }
.mini-tab.edge-bottom:hover { box-shadow: 0 -2px 14px rgba(240, 200, 60, 0.5); }
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
