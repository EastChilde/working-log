// 验证便签拉手 v2：DOM 事件直发，确定性测试拖拽吸附/点击展开
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const res = await fetch("http://127.0.0.1:9223/json");
  const list = await res.json();
  const sticky = list.find((t) => t.type === "page" && (t.url || "").includes("sticky.html"));
  if (!sticky) { console.log("STICKY MISSING"); process.exit(1); }
  const ws = new WebSocket(sticky.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 200;
  const evalExpr = (expr) => new Promise((resolve, reject) => {
    const id = ++seq;
    const h = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        ws.removeEventListener("message", h);
        m.result?.exceptionDetails ? reject(new Error(JSON.stringify(m.result.exceptionDetails.exception?.description || "").slice(0, 300))) : resolve(m.result?.result?.value);
      }
    };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  });

  await evalExpr('(() => { const s = document.createElement("script"); s.textContent = "window.__errs=[];window.addEventListener(\'error\',e=>__errs.push(e.message));window.addEventListener(\'unhandledrejection\',e=>__errs.push(\'REJ:\'+(e.reason?.message||e.reason)));"; document.head.appendChild(s); })()');
  const geom = '(async()=>{const w=(await import("/node_modules/@tauri-apps/api/window.js")).getCurrentWindow();const p=await w.outerPosition();const s=await w.outerSize();return JSON.stringify({x:p.x,y:p.y,w:s.width,h:s.height})})()';

  const g0 = JSON.parse(await evalExpr(geom));
  await evalExpr('localStorage.removeItem("sticky-dock-v1")');

  // 1) 缩小
  await evalExpr('document.querySelector(".s-btn").click()');
  await wait(1000);
  const g1 = JSON.parse(await evalExpr(geom));
  const tabW = await evalExpr('document.querySelector(".mini-tab")?.getBoundingClientRect().width');
  console.log("MINIMIZED:", JSON.stringify(g1), "tabW:", tabW);

  // 2) DOM 事件模拟拖拽到左侧
  await evalExpr(`(async () => {
    const tab = document.querySelector(".mini-tab");
    tab.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 9, clientY: 32, bubbles: true }));
    await new Promise(r => setTimeout(r, 150)); // 等 onTabDown 里 await outerPosition 完成并挂好监听
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: -400, clientY: 20, bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: -1200, clientY: 10, bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: -1900, clientY: 10, bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: -1900, clientY: 10, bubbles: true }));
  })()`);
  await wait(1200);
  const g2 = JSON.parse(await evalExpr(geom));
  const dock = JSON.parse(await evalExpr('localStorage.getItem("sticky-dock-v1")'));
  console.log("AFTER_DRAG:", JSON.stringify(g2), "DOCK:", JSON.stringify(dock));

  // 3) 原地点击展开
  await evalExpr(`(async () => {
    const tab = document.querySelector(".mini-tab");
    const r = tab.getBoundingClientRect();
    tab.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: r.x + 5, clientY: r.y + 5, bubbles: true }));
    await new Promise(res => setTimeout(res, 150));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: r.x + 5, clientY: r.y + 5, bubbles: true }));
  })()`);
  await wait(1200);
  const g3 = JSON.parse(await evalExpr(geom));
  const uiBack = await evalExpr('!!document.querySelector(".sticky")');
  const errs = await evalExpr('window.__errs || []');
  console.log("RESTORED:", JSON.stringify(g3), "UI:", uiBack, "ERRS:", JSON.stringify(errs));

  const minOK = g1.w <= 40 && tabW === 18;
  const dockOK = dock && ["left", "right", "top", "bottom"].includes(dock.edge);
  const resOK = uiBack && Math.abs(g3.w - g0.w) <= 2 && Math.abs(g3.h - g0.h) <= 2;
  console.log(minOK ? "✅ 拉手更小巧(18px)" : "❌ 缩小异常", dockOK ? "✅ 拖拽吸附成功 → " + dock.edge : "❌ 吸附异常", resOK ? "✅ 点击展开恢复" : "❌ 恢复异常");
  ws.close();
  process.exit(minOK && dockOK && resOK ? 0 : 1);
}
main().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
