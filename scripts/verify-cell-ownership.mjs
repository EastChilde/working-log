// 验证：完成任务只在创建日的格子显示一次（划线跟创建日），完成日不再重复
import http from "node:http";
const getJson = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(JSON.parse(d))); }).on("error", rej);
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await wait(1500);
  const list = (await getJson("http://127.0.0.1:9223/json")).filter((t) => t.type === "page");
  const main = list.find((t) => (t.url || "").endsWith(":5173/"));
  if (!main) { console.log("MAIN_NOT_FOUND"); process.exit(1); }
  const ws = new WebSocket(main.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let seq = 0; const pend = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || ""); return r.result?.value; };

  const r = await ev(`(() => {
    // 1. 所有划线条目的标题在全部格子中出现的次数（应恰好 1 次）
    const cells = [...document.querySelectorAll(".cal-grid .cell")];
    const allTitles = cells.flatMap((c) => [...c.querySelectorAll(".t:not(.more) .txt")].map((x) => x.textContent.trim()));
    const doneTitles = [...new Set(cells.flatMap((c) => [...c.querySelectorAll(".t.done .txt")].map((x) => x.textContent.replace(/^✓\\s*/, "").trim())))];
    const dup = doneTitles.filter((t) => allTitles.filter((x) => x.replace(/^✓\\s*/, "") === t).length > 1);
    // 2. 今天格子角标 vs 今天创建的任务数（应由创建数决定）
    const todayCell = cells.find((c) => c.classList.contains("today"));
    const badge = todayCell?.querySelector(".badge")?.textContent.trim();
    const todayCount = todayCell ? todayCell.querySelectorAll(".t:not(.more)").length : 0;
    return JSON.stringify({ doneTitles: doneTitles.length, duplicates: dup, todayBadge: badge, todayVisibleItems: todayCount });
  })()`);
  console.log(r);
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
