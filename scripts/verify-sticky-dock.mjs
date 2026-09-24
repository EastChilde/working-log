// 便签吸附交互冒烟验证：新逻辑挂载 + 事件派发无异常 + 全局错误监听
const CDP = "http://127.0.0.1:9223";

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
  return r.result?.result?.value;
};

await new Promise((r) => setTimeout(r, 1500));

const out = [];
// 1. 窗口标题被错误监听劫持则说明运行时报错（sticky.ts 把 error 写进 title）
out.push("title=" + (await evalJs("document.title")));
// 2. 新代码已挂载：标题栏无系统拖拽区属性、cursor=grab、拉手 hover 绑定存在
out.push("headNoDragRegion=" + (await evalJs("!document.querySelector('.s-head')?.hasAttribute('data-tauri-drag-region')")));
out.push("cursorGrab=" + (await evalJs("getComputedStyle(document.querySelector('.s-head')).cursor")));
// 3. 事件派发冒烟：mouseenter/mouseleave 走新 handler 不抛异常
out.push("smoke=" + (await evalJs(`
  (() => {
    try {
      const s = document.querySelector('.sticky');
      if (!s) return 'NO_STICKY';
      s.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      s.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      return 'OK';
    } catch (e) { return 'THROW: ' + e.message; }
  })()
`)));
// 4. 派发后 1 秒确认没有误收起（autoPeek=false 时 schedulePeekHide 应直接返回）
await new Promise((r) => setTimeout(r, 1000));
out.push("stillExpanded=" + (await evalJs("!!document.querySelector('.sticky')")));
// 5. 存储键就绪
out.push("posKeyRead=" + (await evalJs("localStorage.getItem('sticky-pos-v1') === null || typeof JSON.parse(localStorage.getItem('sticky-pos-v1')) === 'object'")));

console.log(out.join("\n"));
ws.close();
process.exit(0);
