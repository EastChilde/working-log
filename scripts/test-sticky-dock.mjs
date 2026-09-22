// 验证便签拉手：缩小尺寸、拖拽换边吸附、位置记忆、点击展开
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const res = await fetch("http://127.0.0.1:9223/json");
  const list = await res.json();
  const sticky = list.find((t) => t.type === "page" && (t.url || "").includes("sticky.html"));
  if (!sticky) { console.log("STICKY MISSING"); process.exit(1); }
  const ws = new WebSocket(sticky.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 100;
  const send = (method, params) => ws.send(JSON.stringify({ id: ++seq, method, params }));
  const ask = (expr) => new Promise((resolve, reject) => {
    const id = ++seq;
    const h = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        ws.removeEventListener("message", h);
        m.result?.exceptionDetails ? reject(new Error(JSON.stringify(m.result.exceptionDetails.exception?.description || "").slice(0, 250))) : resolve(m.result?.result?.value);
      }
    };
    ws.addEventListener("message", h);
    send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, id: undefined });
    // 重发：Runtime.evaluate 的 id 就是上面 ++seq
  });
  // 简化：直接包一层
  const evalExpr = (expr) => new Promise((resolve, reject) => {
    const id = ++seq;
    const h = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        ws.removeEventListener("message", h);
        m.result?.exceptionDetails ? reject(new Error(JSON.stringify(m.result.exceptionDetails.exception?.description || "").slice(0, 250))) : resolve(m.result?.result?.value);
      }
    };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  });
  const input = (type, params) => new Promise((r) => {
    const id = ++seq;
    const h = (ev) => { if (JSON.parse(ev.data).id === id) { ws.removeEventListener("message", h); r(); } };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method: "Input.dispatchMouseEvent", params: { type, ...params } }));
  });

  await send("Page.reload", {});
  await wait(3000);

  const geomOuter = '(async()=>{const w=(await import("/node_modules/@tauri-apps/api/window.js")).getCurrentWindow();const p=await w.outerPosition();const s=await w.outerSize();return JSON.stringify({x:p.x,y:p.y,w:s.width,h:s.height})})()';

  // 0) 初始状态
  const g0 = JSON.parse(await evalExpr(geomOuter));
  await evalExpr('localStorage.removeItem("sticky-dock-v1")');

  // 1) 点击「—」缩小 → 默认吸附右缘
  await evalExpr('document.querySelector(".s-btn").click()');
  await wait(1200);
  const g1 = JSON.parse(await evalExpr(geomOuter));
  console.log("MINIMIZED:", JSON.stringify(g1), "(client≈18x64)");

  // 2) 模拟拖拽：从右缘拖到屏幕左上方向 → 应吸附左缘或顶缘
  await input("mousePressed", { x: 9, y: 32, button: "left", buttons: 1, clickCount: 1 });
  await wait(80);
  const steps = [[-120, -10], [-350, -30], [-700, -60], [-1100, -90], [-1500, -110], [-1850, -120]];
  for (const [x, y] of steps) {
    await input("mouseMoved", { x, y, buttons: 1 });
    await wait(60);
  }
  await input("mouseReleased", { x: -1850, y: -120, button: "left", buttons: 0 });
  await wait(1200);
  const g2 = JSON.parse(await evalExpr(geomOuter));
  const dock = JSON.parse(await evalExpr('localStorage.getItem("sticky-dock-v1")'));
  console.log("AFTER_DRAG:", JSON.stringify(g2), "DOCK:", JSON.stringify(dock));

  // 3) 原地点击拉手 → 展开恢复
  const tabRect = JSON.parse(await evalExpr('(()=>{const r=document.querySelector(".mini-tab").getBoundingClientRect();return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()'));
  await input("mousePressed", { x: tabRect.x, y: tabRect.y, button: "left", buttons: 1, clickCount: 1 });
  await wait(80);
  await input("mouseReleased", { x: tabRect.x, y: tabRect.y, button: "left", buttons: 0 });
  await wait(1200);
  const g3 = JSON.parse(await evalExpr(geomOuter));
  const uiBack = await evalExpr('!!document.querySelector(".sticky")');
  console.log("RESTORED:", JSON.stringify(g3), "UI:", uiBack);

  // 判定
  const minOK = g1.w <= 40 && g1.h <= 75;
  const dockOK = dock && ["left", "right", "top", "bottom"].includes(dock.edge) && g2.w <= 40;
  const resOK = uiBack && Math.abs(g3.w - g0.w) <= 2 && Math.abs(g3.h - g0.h) <= 2 && Math.abs(g3.x - g0.x) <= 6;
  console.log(minOK ? "✅ 缩小尺寸更小巧" : "❌ 缩小异常", dockOK ? "✅ 拖拽换边吸附成功(" + dock.edge + ")" : "❌ 吸附异常", resOK ? "✅ 点击展开恢复精确" : "❌ 恢复异常");
  ws.close();
  process.exit(minOK && dockOK && resOK ? 0 : 1);
}
main().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
