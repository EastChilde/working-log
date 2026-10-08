/** 一体化诊断：hover 自动展开后光标移出是否自动收回
 * 单进程完成：spawn exe(CDP) → 连 sticky → 状态观测 → 模拟光标 → 结论 → kill */
import { spawn, execSync } from "child_process";

const EXE = "D:\\projects\\todo\\rls-target\\release\\working-log.exe";
const CWD = "D:\\projects\\todo\\rls-target\\release";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 光标控制（python ctypes，每次调用独立进程）----
const moveCursor = (x, y) =>
  execSync(`python -c "import ctypes; ctypes.windll.user32.SetCursorPos(${Math.round(x)},${Math.round(y)})"`, { stdio: "ignore" });

// ---- 1. spawn 应用 ----
console.log("[1] spawn exe ...");
const exe = spawn(EXE, [], {
  cwd: CWD,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9223" },
  stdio: "ignore",
});

// ---- 2. 等 CDP ready ----
let targets = null;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try {
    const r = await fetch("http://127.0.0.1:9223/json", { signal: AbortSignal.timeout(2000) });
    targets = await r.json();
    if (targets.some((t) => t.url.includes("sticky"))) break;
  } catch { /* retry */ }
}
if (!targets) { console.error("CDP_NOT_READY"); exe.kill(); process.exit(1); }
const sticky = targets.find((t) => t.url.includes("sticky") && t.webSocketDebuggerUrl);
if (!sticky) { console.error("NO_STICKY_TARGET", targets.map((t) => t.url)); exe.kill(); process.exit(1); }

// ---- 3. CDP 连接 ----
const ws = new WebSocket(sticky.webSocketDebuggerUrl);
let id = 0;
const cbs = {};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && cbs[m.id]) { cbs[m.id](m.result?.exceptionDetails ? { err: m.result.exceptionDetails.exception?.description } : m.result?.result?.value); delete cbs[m.id]; }
};
await new Promise((r) => (ws.onopen = r));
const ev = (expr) => { id++; return new Promise((res) => { cbs[id] = res; ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } })); }); };
console.log("[2] CDP connected");

// 等页面注入完成
for (let i = 0; i < 20; i++) {
  const ok = await ev(`(function(){ return !!window.__TAURI_INTERNALS__ && document.readyState; })()`);
  if (ok === "complete" || ok === true) break;
  await sleep(500);
}
console.log("[2.5] tauri ready");

// ---- 4. 状态读取 ----
async function readState() {
  return await ev(`(async function(){
    try {
      const el = document.querySelector('.sticky') || document.querySelector('.mini-tab');
      const s = el && el.__vueParentComponent && el.__vueParentComponent.setupState;
      const I = window.__TAURI_INTERNALS__;
      const pos = await I.invoke('plugin:window|outer_position');
      const size = await I.invoke('plugin:window|inner_size');
      const mon = await I.invoke('plugin:window|current_monitor');
      const dock = localStorage.getItem('sticky-dock-v1') || localStorage.getItem('sticky.dock');
      let dockLS = null;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.toLowerCase().includes('dock')) { dockLS = k + '=' + localStorage.getItem(k); }
      }
      return {
        minimized: s ? !!s.minimized.value : null,
        tabVisible: s ? !!s.tabVisible.value : null,
        dockEdge: s ? s.dockEdge.value : null,
        autoPeek: s ? !!s.autoPeek.value : null,
        pos: { x: pos.x, y: pos.y }, size: { w: size.width, h: size.height },
        mon: mon ? { x: mon.position.x, y: mon.position.y, w: mon.size.width, h: mon.size.height } : null,
        dockLS, hasSticky: !!document.querySelector('.sticky'), hasTab: !!document.querySelector('.mini-tab'),
        activeEl: document.activeElement ? document.activeElement.tagName : null,
      };
    } catch (e) { return { ERR: String(e) }; }
  })()`);
}

const S1 = await readState();
console.log("[3] S1(初始):", JSON.stringify(S1));
if (S1.ERR) { exe.kill(); process.exit(1); }

const mon = S1.mon;
let result = { S1 };

// ---- 5a. 若停靠态：光标移到条上触发展开 ----
if (S1.minimized) {
  // 条位置：从 localStorage 读 dock off，dockLen ≈ 展开尺寸（用窗口恢复后的尺寸近似；先读 LS）
  let off = 0, len = 200;
  try {
    const ls = S1.dockLS || "";
    const mOff = ls.match(/(\{.*\})/);
    if (mOff) { const j = JSON.parse(mOff[1]); off = j.off ?? 0; }
  } catch { /* ignore */ }
  // 展开尺寸：peekExpand 后窗口恢复 savedGeom；dockLen 未知时用屏高-40 兜底近似（沿边中点）
  const alongMid = off + len / 2;
  let cx, cy;
  if (S1.dockEdge === "right") { cx = mon.x + mon.w - 4; cy = mon.y + Math.min(alongMid, mon.h - 100); }
  else if (S1.dockEdge === "left") { cx = mon.x + 4; cy = mon.y + Math.min(alongMid, mon.h - 100); }
  else if (S1.dockEdge === "top") { cy = mon.y + 4; cx = mon.x + Math.min(alongMid, mon.w - 100); }
  else { cy = mon.y + mon.h - 4; cx = mon.x + Math.min(alongMid, mon.w - 100); }
  console.log("[4] 光标 -> 条", Math.round(cx), Math.round(cy));
  moveCursor(cx, cy);
  let expanded = null;
  for (let i = 0; i < 10; i++) {
    await sleep(400);
    expanded = await readState();
    if (!expanded.minimized) break;
  }
  console.log("[5] 展开后:", JSON.stringify(expanded));
  result.expanded = expanded;
  if (expanded.minimized) { console.error("RESULT: EXPAND_FAIL（hover 展开就没触发）"); exe.kill(); process.exit(0); }
}

// ---- 5b. 光标移出窗口（窗口中心右侧 300px / 屏内）----
const wx = S1.pos.x - (mon ? mon.x : 0), wy = S1.pos.y - (mon ? mon.y : 0);
const outX = mon.x + Math.min(mon.w - 20, wx + S1.size.w / 2 + 300);
const outY = mon.y + Math.min(mon.h - 20, wy + S1.size.h / 2);
console.log("[6] 光标 -> 窗口外", Math.round(outX), Math.round(outY));
moveCursor(outX, outY);

// ---- 5c. 每 400ms 观测 4 秒：是否收回 ----
let retracted = false;
const trace = [];
for (let i = 0; i < 10; i++) {
  await sleep(400);
  const s = await readState();
  trace.push({ t: (i + 1) * 400, minimized: s.minimized, tabVisible: s.tabVisible, autoPeek: s.autoPeek, w: s.size.w, h: s.size.h, activeEl: s.activeEl });
  if (s.minimized) { retracted = true; break; }
}
console.log("[7] trace:", JSON.stringify(trace));
console.log(retracted ? "RESULT: RETRACT_OK（自动收回正常）" : "RESULT: RETRACT_FAIL（4 秒未收回）");
result.trace = trace;

// ---- 6. 收尾 ----
ws.close();
exe.kill();
await sleep(500);
try { execSync("taskkill /F /IM working-log.exe", { stdio: "ignore" }); } catch { /* ignore */ }
console.log("DONE");
