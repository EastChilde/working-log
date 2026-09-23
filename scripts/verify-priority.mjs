// 验证优先级圆点点击切换与清单徽标
import http from "node:http";
function getJson(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(JSON.parse(d))); }).on("error", rej);
  });
}
(async () => {
  const list = (await getJson("http://127.0.0.1:9223/json")).filter((t) => t.type === "page");
  const main = list.find((t) => (t.url || "").endsWith(":5173/"));
  const ws = new WebSocket(main.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let seq = 0;
  const pend = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pend.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "");
    return r.result?.value;
  };

  // 点击第一条任务的优先级圆点两次：null→低→中
  for (let i = 0; i < 2; i++) {
    const cls = await ev(`(async()=>{const d=document.querySelector(".dp-body .task .pri-dot");d.click();await new Promise(r=>setTimeout(r,300));return d.className})()`);
    console.log("click", i + 1, "→", cls);
  }
  // 查 store 中该任务的 priority
  const stored = await ev(`(async()=>{const m=window.__pinia||(document.querySelector("#app").__vue_app__.config.globalProperties.$pinia);const s=m._s.get("tasks");const t=s.tasks.find(x=>x.priority);return t?JSON.stringify({title:t.title.slice(0,12),pri:t.priority}):"NO_PRI_SET"})()`);
  console.log("stored:", stored);
  // 切到清单视图看徽标
  await ev(`(async()=>{for(const b of document.querySelectorAll(".seg button")){if(b.textContent.includes("清单")){b.click();break}}return "ok"})()`);
  await new Promise((r) => setTimeout(r, 500));
  const pill = await ev(`(()=>{const p=document.querySelector(".p-hi,.p-mid,.p-low");return p?(p.className+" | "+p.textContent):"NO_PILL"})()`);
  console.log("list pill:", pill);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
