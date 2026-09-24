// 便签吸附交互端到端测试：真实驱动 收起→hover弹出→移开收回→输入保护 全链路
const CDP = "http://127.0.0.1:9223";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch(`${CDP}/json`)).json();
const sticky = targets.find((t) => t.url.includes("sticky") && t.webSocketDebuggerUrl);
if (!sticky) { console.log("STICKY_TAB_MISSING"); process.exit(1); }

const ws = new WebSocket(sticky.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
const send = (method, params) => new Promise((res) => { id++; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (r.result?.exceptionDetails) return "EXC: " + (r.result.exceptionDetails.exception?.description || "").slice(0, 150);
  return r.result?.result?.value;
};
const state = () => evalJs(`document.querySelector('.sticky') ? 'expanded' : document.querySelector('.mini-tab') ? 'docked' : 'unknown'`);
const vw = () => evalJs(`window.innerWidth + 'x' + window.innerHeight`);

await sleep(1500);
const log = [];
log.push(`initial: ${await state()} viewport=${await vw()}`);

// 步骤0：修复历史坏状态——展开态但窗口仍是 tab 尺寸（旧 bug 遗留）→ 先恢复正常窗口
if ((await state()) === "expanded" && (await evalJs("window.innerWidth")) < 100) {
  const win0 = await send("Browser.getWindowForTarget");
  const bounds = win0.result?.windowBounds;
  await send("Browser.setWindowBounds", { windowId: win0.result?.windowId, bounds: { width: 300, height: 440, windowState: bounds?.windowState ?? "normal" } });
  await sleep(1500);
  log.push(`repaired window: ${await state()} viewport=${await vw()}`);
}

// 步骤1：若展开 → 点 — 收起；若已吸附 → 直接进入步骤2
if ((await state()) === "expanded") {
  await evalJs(`document.querySelector('.s-btn').click()`);
  await sleep(1500);
  log.push(`after click hide: ${await state()} viewport=${await vw()}  (expect docked, ~18x64)`);
}

// 步骤2：hover 拉手 → 自动弹出
await evalJs(`document.querySelector('.mini-tab')?.dispatchEvent(new MouseEvent('mouseenter'))`);
await sleep(1800);
log.push(`after hover tab: ${await state()} viewport=${await vw()}  (expect expanded, restored size)`);

// 步骤3：移开鼠标 → 700ms 后自动收回
await evalJs(`document.querySelector('.sticky').dispatchEvent(new MouseEvent('mouseleave'))`);
await sleep(1300);
log.push(`after leave 1.3s: ${await state()}  (expect docked = auto re-dock)`);

// 步骤4：输入框聚焦时移开 → 不收回
await evalJs(`document.querySelector('.mini-tab')?.dispatchEvent(new MouseEvent('mouseenter'))`);
await sleep(1800);
const focusRes = await evalJs(`
  (() => {
    const i = document.querySelector('.s-add input');
    i.focus();
    document.querySelector('.sticky').dispatchEvent(new MouseEvent('mouseleave'));
    return 'focused=' + (document.activeElement === i);
  })()
`);
await sleep(1300);
log.push(`input-protect (${focusRes}): ${await state()}  (expect expanded)`);

// 收尾：清空输入焦点，恢复展开态且不自动收回（模拟一次拖拽把 autoPeek 置 false）
await evalJs(`
  (() => {
    document.activeElement?.blur();
    const head = document.querySelector('.s-head');
    head.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    return 'reset';
  })()
`);
await sleep(300);
log.push(`final: ${await state()}`);

console.log(log.join("\n"));
ws.close();
process.exit(0);
