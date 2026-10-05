// 注入监听器记录器 → 重载便签页 → 检查 @mousedown 是否注册 + v-model 是否活着
const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
const sticky = targets.find((t) => (t.title.includes("便签") || t.url.includes("sticky")) && t.webSocketDebuggerUrl);
if (!sticky) { console.error("no sticky target"); process.exit(1); }

const ws = new WebSocket(sticky.webSocketDebuggerUrl);
let id = 0;
const pending = {};
function send(method, params) {
  return new Promise((res) => {
    const i = ++id;
    pending[i] = res;
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}
let events = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending[m.id]) { pending[m.id](m.result); delete pending[m.id]; return; }
  if (m.method === "Runtime.exceptionThrown") {
    events.push("EXC: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 200));
  }
};
await new Promise((r) => (ws.onopen = r));

// 页面脚本运行前注入 addEventListener 包裹
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    window.__listeners = [];
    const orig = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, fn, opts) {
      try { window.__listeners.push({ tag: this.tagName || 'obj', cls: (this.className || '').toString().slice(0, 30), type }); } catch(e) {}
      return orig.call(this, type, fn, opts);
    };
  `,
});
await send("Page.enable");
await send("Runtime.enable");
await send("Page.reload");
await new Promise((r) => setTimeout(r, 5000));

// 汇总监听器
const r1 = await send("Runtime.evaluate", {
  expression: `JSON.stringify({
    total: window.__listeners.length,
    mousedowns: window.__listeners.filter(l => l.type === 'mousedown'),
    mouseenters: window.__listeners.filter(l => l.type === 'mouseenter').length,
    keys: window.__listeners.filter(l => l.type === 'keydown').length,
    heads: window.__listeners.filter(l => l.cls.includes('s-head')),
  })`,
  returnByValue: true,
});
console.log("监听器统计:", r1.result.value);

// v-model 活性：聚焦输入框 → insertText → 读 value
await send("Runtime.evaluate", { expression: `document.querySelector('.s-add input').focus()` });
await send("Input.insertText", { text: "V" });
await new Promise((r) => setTimeout(r, 300));
const r2 = await send("Runtime.evaluate", {
  expression: `document.querySelector('.s-add input').value`,
  returnByValue: true,
});
console.log("输入框值(应为'V'):", JSON.stringify(r2.result?.value));

console.log("异常:", events.length ? events : "无");
ws.close();
process.exit(0);
