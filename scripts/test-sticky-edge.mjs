// 验证便签贴边隐藏/拉手呼出
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(9000); // 等应用起来
  const res = await fetch("http://127.0.0.1:9223/json");
  const list = await res.json();
  const sticky = list.find((t) => t.type === "page" && (t.url || "").includes("sticky.html"));
  const main = list.find((t) => t.type === "page" && (t.url || "").endsWith("5173/"));
  if (!sticky || !main) { console.log("PAGE MISSING", !!sticky, !!main); process.exit(1); }

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
          m.result?.exceptionDetails ? reject(new Error(JSON.stringify(m.result.exceptionDetails.exception?.description || "").slice(0, 250))) : resolve(m.result?.result?.value);
        }
      };
      ws.addEventListener("message", h);
      ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: awaitP } }));
    }));
    return { ask, ws };
  };
  const S = conn(sticky);

  // 1) 记录初始位置
  const pos0 = JSON.parse(await S.ask('(async()=>{const w=(await import("/node_modules/@tauri-apps/api/window.js")).getCurrentWindow();const p=await w.outerPosition();return JSON.stringify({x:p.x,y:p.y})})()'));
  console.log("POS_BEFORE:", JSON.stringify(pos0));

  // 2) 点击「—」贴边
  await S.ask('document.querySelector(".s-btn").click()', false);
  await wait(1500);
  const pos1 = JSON.parse(await S.ask('(async()=>{const w=(await import("/node_modules/@tauri-apps/api/window.js")).getCurrentWindow();const p=await w.outerPosition();return JSON.stringify({x:p.x,y:p.y})})()'));
  const tab = await S.ask('!!document.querySelector(".mini-tab")', false);
  console.log("POS_AFTER_MIN:", JSON.stringify(pos1), "MINI_TAB:", tab);

  // 3) 点击拉手恢复
  await S.ask('document.querySelector(".mini-tab").click()', false);
  await wait(1500);
  const pos2 = JSON.parse(await S.ask('(async()=>{const w=(await import("/node_modules/@tauri-apps/api/window.js")).getCurrentWindow();const p=await w.outerPosition();return JSON.stringify({x:p.x,y:p.y})})()'));
  const backUI = await S.ask('!!document.querySelector(".sticky")', false);
  console.log("POS_AFTER_RESTORE:", JSON.stringify(pos2), "STICKY_UI:", backUI);

  const monW = JSON.parse(await S.ask('(async()=>{const m=await (await import("/node_modules/@tauri-apps/api/window.js")).currentMonitor();return JSON.stringify({w:m.size.width})})()'));
  const minOK = Math.abs(pos1.x - (monW.w - 26)) <= 4;
  const restoreOK = Math.abs(pos2.x - pos0.x) <= 4 && Math.abs(pos2.y - pos0.y) <= 4;
  console.log("MON_W:", monW.w, "| 贴边:", minOK ? "✅" : "❌", "| 复位:", restoreOK ? "✅" : "❌");
  S.ws.close();
  process.exit(minOK && restoreOK && tab && backUI ? 0 : 1);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
