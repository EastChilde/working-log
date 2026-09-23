// 验证：当日面板完成任务不划线，日历格子完成任务保留划线
import http from "node:http";
const getJson = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(JSON.parse(d))); }).on("error", rej);
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await wait(1500); // 等 HMR 应用
  const list = (await getJson("http://127.0.0.1:9223/json")).filter((t) => t.type === "page");
  const main = list.find((t) => (t.url || "").endsWith(":5173/"));
  if (!main) { console.log("MAIN_NOT_FOUND"); process.exit(1); }
  const ws = new WebSocket(main.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let seq = 0; const pend = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || ""); return r.result?.value; };

  const r = await ev(`(async () => {
    const cs = (el) => getComputedStyle(el.querySelector(".t-title")).textDecorationLine;
    // 当日面板：找一条已完成任务
    const dpDone = document.querySelector(".dp-body .task.done .t-title");
    const dpLine = dpDone ? getComputedStyle(dpDone).textDecorationLine : "NO_DONE_TASK";
    const dpColor = dpDone ? getComputedStyle(dpDone).color : "";
    // 日历格子：找一条已完成任务条
    const calDone = document.querySelector(".cal-grid .cell .t.done .txt");
    const calLine = calDone ? getComputedStyle(calDone.parentElement).textDecorationLine : "NO_DONE_IN_CELLS";
    return JSON.stringify({ dpLine, dpColor, calLine });
  })()`);
  console.log(r);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
