// 临时脚本：验证顶栏便签按钮的显隐联动
(async () => {
  const res = await fetch("http://127.0.0.1:9223/json");
  const list = await res.json();
  const main = list.find((t) => t.type === "page" && (t.url || "").endsWith("5173/"));
  const sticky = list.find((t) => t.type === "page" && (t.url || "").includes("sticky.html"));
  const conn = (page) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const opened = new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let seq = 0;
    const ask = (expr, awaitP = true) => opened.then(() => new Promise((resolve, reject) => {
      const id = ++seq;
      const h = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === id) {
          ws.removeEventListener("message", h);
          if (m.result && m.result.exceptionDetails) reject(new Error(JSON.stringify(m.result.exceptionDetails.exception?.description || "").slice(0, 200)));
          else resolve(m.result?.result?.value);
        }
      };
      ws.addEventListener("message", h);
      ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: awaitP } }));
    }));
    return { ask, ws };
  };
  const M = conn(main), S = conn(sticky);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const v0 = await S.ask("document.visibilityState", false);
  // 点一次 → 隐藏便签
  await M.ask('document.querySelector(".sticky-toggle").click()', false);
  await wait(1500);
  const v1 = await S.ask("document.visibilityState", false);
  // 再点一次 → 显示便签
  await M.ask('document.querySelector(".sticky-toggle").click()', false);
  await wait(1500);
  const v2 = await S.ask("document.visibilityState", false);
  console.log("STICKY_VIS: 初始", v0, "→ 点击后", v1, "→ 再点击", v2);
  console.log(v0 === "visible" && v1 === "hidden" && v2 === "visible" ? "✅ 按钮显隐联动正常" : "❌ 行为异常");
  M.ws.close(); S.ws.close();
  process.exit(0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
