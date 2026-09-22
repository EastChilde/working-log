// 验证顶栏按钮 show/hide 便签（用 isVisible 权威指标）
(async () => {
  const res = await fetch("http://127.0.0.1:9223/json");
  const list = await res.json();
  const main = list.find((t) => t.type === "page" && (t.url || "").endsWith("5173/"));
  const ws = new WebSocket(main.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const ask = (expr) => new Promise((resolve, reject) => {
    const id = ++seq;
    const h = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        ws.removeEventListener("message", h);
        m.result?.exceptionDetails ? reject(new Error(JSON.stringify(m.result.exceptionDetails.exception?.description || "").slice(0, 200))) : resolve(m.result?.result?.value);
      }
    };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = () => ask('document.querySelector(".sticky-toggle").click()');
  const vis = () => ask('(async()=>{const m=await import("/node_modules/@tauri-apps/api/webviewWindow.js");const w=await m.WebviewWindow.getByLabel("sticky");return w?await w.isVisible():"NO_WIN"})()');

  const before = await vis();
  await click(); await wait(1200);
  const after1 = await vis();
  await click(); await wait(1200);
  const after2 = await vis();
  console.log("BEFORE:", before, "→ 点击", after1, "→ 再点击", after2);
  console.log(before === false && after1 === true && after2 === false ? "✅ show/hide 双向正常" : before === true && after1 === false && after2 === true ? "✅ show/hide 双向正常（反向起点）" : "❌ 异常");
  ws.close(); process.exit(0);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
