// 验证便签紧急程度排序：分组顺序、色条、徽章、汇总胶囊
const CDP = "http://127.0.0.1:9223/json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 等 exe + vite 就绪
  for (let i = 0; i < 30; i++) {
    try {
      const targets = await (await fetch(CDP)).json();
      const sticky = targets.find((t) => t.url.includes("sticky"));
      if (sticky) break;
    } catch { /* retry */ }
    await sleep(1000);
  }
  const targets = await (await fetch(CDP)).json();
  const sticky = targets.find((t) => t.url.includes("sticky"));
  if (!sticky) { console.log("NO_STICKY_TARGET"); console.log(targets.map((t) => t.url.slice(0, 50)).join("\n")); return; }

  const ws = new WebSocket(sticky.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p) => new Promise((res) => { id++; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result?.result?.value;

  await sleep(2500); // 等数据加载
  const out = await ev(`(() => {
    const heads = [...document.querySelectorAll(".g-head")].map(g => g.textContent.replace(/\\s+/g, "").trim());
    const tasks = [...document.querySelectorAll(".s-task")].map(t => ({
      bar: t.classList.contains("hi") ? "hi" : t.classList.contains("mid") ? "mid" : t.classList.contains("low") ? "low" : "none",
      over: t.classList.contains("over"),
      title: t.querySelector(".s-title")?.textContent.trim().slice(0, 16),
      chips: [...t.querySelectorAll(".chip")].map(c => c.textContent.trim()),
    }));
    const sum = [...document.querySelectorAll(".s-sum b")].map(b => b.className + ":" + b.textContent.trim());
    const barColor = document.querySelector(".s-task.hi") ? getComputedStyle(document.querySelector(".s-task.hi"), "::before").backgroundColor : "n/a";
    return JSON.stringify({ heads, sum, tasks, barColor }, null, 1);
  })()`);
  console.log("STICKY_CHECK:", out);
  ws.close();
  process.exit(0);
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
