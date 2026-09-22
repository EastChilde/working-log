// 验证关闭拦截：window.close() 触发 CloseRequested → 应隐藏而非销毁，且可再次唤起
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 100;
  return (expr) => new Promise((resolve, reject) => {
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
}

async function listPages() {
  const res = await fetch("http://127.0.0.1:9223/json");
  return (await res.json()).filter((t) => t.type === "page");
}

async function main() {
  let pages = await listPages();
  const findMain = (list) => list.find((t) => (t.url || "").endsWith("5173/"));
  let main = findMain(pages);
  if (!main) { console.log("MAIN MISSING"); process.exit(1); }

  let evalMain = await connect(main);
  console.log("STEP1 visible before close:", await evalMain('(async()=>{const w=(await import("/node_modules/@tauri-apps/api/window.js")).getCurrentWindow();return JSON.stringify({visible:await w.isVisible()})})()'));

  // 模拟点 X：触发 CloseRequested（prevent_close 应拦截，仅隐藏）
  await evalMain('getCurrentWindow_close = async () => { const w = (await import("/node_modules/@tauri-apps/api/window.js")).getCurrentWindow(); await w.close(); "closed" }');
  await wait(1500);

  // 窗口对象必须仍然存在（未销毁）且已隐藏
  pages = await listPages();
  main = findMain(pages);
  console.log("STEP2 page still exists after close:", !!main);
  if (!main) { console.log("FAIL: window destroyed by close"); process.exit(1); }
  evalMain = await connect(main);
  console.log("STEP2 state after close:", await evalMain('(async()=>{const w=(await import("/node_modules/@tauri-apps/api/window.js")).getCurrentWindow();return JSON.stringify({visible:await w.isVisible()})})()'));

  // 再唤起（模拟托盘 show）
  await evalMain('(async()=>{const w=(await import("/node_modules/@tauri-apps/api/window.js")).getCurrentWindow();await w.show();await w.setFocus();"shown"})()');
  await wait(800);
  console.log("STEP3 state after re-show:", await evalMain('(async()=>{const w=(await import("/node_modules/@tauri-apps/api/window.js")).getCurrentWindow();return JSON.stringify({visible:await w.isVisible()})})()'));

  ws && evalMain;
  process.exit(0);
}

main().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
