// 重载便签页并捕获运行时异常/控制台错误
import fs from "fs";

const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
const sticky = targets.find((t) => (t.title.includes("便签") || t.url.includes("sticky")) && t.webSocketDebuggerUrl);
if (!sticky) { console.error("no sticky target"); process.exit(1); }

const ws = new WebSocket(sticky.webSocketDebuggerUrl);
const logs = [];
let id = 0;
const pending = {};

function send(method, params) {
  return new Promise((res) => {
    const i = ++id;
    pending[i] = res;
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending[m.id]) { pending[m.id](m.result); delete pending[m.id]; return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    logs.push("EXCEPTION: " + (d.exception?.description || d.text) + " @" + (d.url || "") + ":" + (d.lineNumber ?? ""));
  } else if (m.method === "Runtime.consoleAPICalled") {
    const txt = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    if (m.params.type === "error" || m.params.type === "warning") logs.push("CONSOLE." + m.params.type + ": " + txt.slice(0, 300));
  } else if (m.method === "Log.entryAdded") {
    const en = m.params.entry;
    if (en.level === "error") logs.push("LOG: " + (en.text || "").slice(0, 300) + " @" + (en.url || ""));
  }
};

await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Page.reload");
await new Promise((r) => setTimeout(r, 6000));

// 页面加载后检查 Vue 挂载状态
const check = await send("Runtime.evaluate", { expression: `JSON.stringify({
  hasApp: !!document.querySelector('#app'),
  hasVueApp: !!(document.querySelector('#app') && document.querySelector('#app').__vue_app__),
  hasInstance: !!(document.querySelector('#app') && document.querySelector('#app').__vue_app__ && document.querySelector('#app').__vue_app__._instance),
  hasStickyDom: !!document.querySelector('.sticky'),
  childCount: document.querySelector('#app') ? document.querySelector('#app').childElementCount : -1,
})`, returnByValue: true });
console.log("挂载状态:", check.result.value);
console.log("捕获错误", logs.length, "条:");
for (const l of logs.slice(0, 20)) console.log(" ", l);
ws.close();
process.exit(0);
