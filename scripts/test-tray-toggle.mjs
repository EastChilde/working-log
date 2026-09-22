// 验证主窗口挂载与窗口 API 可用性（托盘修复后的回归检查）
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const res = await fetch("http://127.0.0.1:9223/json");
  const list = await res.json();
  const main = list.find((t) => t.type === "page" && (t.url || "").endsWith("5173/"));
  if (!main) { console.log("MAIN MISSING"); process.exit(1); }
  const ws = new WebSocket(main.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 100;
  const evalExpr = (expr) => new Promise((resolve, reject) => {
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

  console.log("readyState:", await evalExpr("document.readyState"));
  console.log("appChildren:", await evalExpr("document.querySelector('#app')?.children.length"));
  console.log("topbarBtns:", await evalExpr("document.querySelectorAll('.topbar button, header button').length"));
  console.log("windowLabel:", await evalExpr('(async()=>{const w=(await import("/node_modules/@tauri-apps/api/window.js")).getCurrentWindow();return w.label})()'));
  console.log("mainVisible:", await evalExpr('(async()=>{const w=(await import("/node_modules/@tauri-apps/api/window.js")).getCurrentWindow();return JSON.stringify({visible:await w.isVisible(),minimized:await w.isMinimized()})})()'));
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
