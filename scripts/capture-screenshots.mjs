// 采集 README 截图：main.png / sticky.png / sticky-dock.png
// 流程：截主界面 → 截便签展开 → 点「—」贴边截拉手 → 点击拉手恢复
import { mkdirSync, writeFileSync } from "node:fs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(target) {
  return new Promise(async (resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let seq = 500;
    const call = (method, params) => new Promise((res2, rej2) => {
      const id = ++seq;
      const h = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === id) { ws.removeEventListener("message", h); m.error ? rej2(new Error(JSON.stringify(m.error).slice(0, 200))) : res2(m.result); }
      };
      ws.addEventListener("message", h);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evalExpr = async (expr) => {
      const r = await call("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval error");
      return r.result?.value;
    };
    resolve({ ws, call, evalExpr });
  });
}

async function pages() {
  const res = await fetch("http://127.0.0.1:9223/json");
  return (await res.json()).filter((t) => t.type === "page");
}

async function main() {
  mkdirSync("D:/projects/todo/working-log/screenshots", { recursive: true });
  await wait(6000); // 等待窗口就绪

  const list = await pages();
  const mainT = list.find((t) => (t.url || "").endsWith("5173/"));
  const stickyT = list.find((t) => (t.url || "").includes("sticky.html"));
  if (!mainT || !stickyT) { console.log("MISSING", !!mainT, !!stickyT); process.exit(1); }

  // 1) 主界面（先聚焦，确保日历视图完整渲染）
  const m = await connect(mainT);
  await m.evalExpr("document.readyState");
  await wait(1000);
  const shot1 = await m.call("Page.captureScreenshot", { format: "png" });
  writeFileSync("D:/projects/todo/working-log/screenshots/main.png", Buffer.from(shot1.data, "base64"));
  console.log("main.png saved");

  // 2) 便签展开态
  const s = await connect(stickyT);
  await s.evalExpr("document.readyState");
  // 若处于贴边态先展开
  if (await s.evalExpr("!!document.querySelector('.mini-tab')")) {
    await s.evalExpr(`(() => { const t=document.querySelector('.mini-tab'); const r=t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent('mousedown',{button:0,clientX:r.x+5,clientY:r.y+5,bubbles:true})); })()`);
    await wait(1200);
  }
  await wait(500);
  const shot2 = await s.call("Page.captureScreenshot", { format: "png" });
  writeFileSync("D:/projects/todo/working-log/screenshots/sticky.png", Buffer.from(shot2.data, "base64"));
  console.log("sticky.png saved");

  // 3) 贴边：点「—」按钮
  await s.evalExpr(`(() => { const b=document.querySelector('.s-btn'); b.dispatchEvent(new MouseEvent('click',{bubbles:true})); })()`);
  await wait(2000);
  const shot3 = await s.call("Page.captureScreenshot", { format: "png" });
  writeFileSync("D:/projects/todo/working-log/screenshots/sticky-dock.png", Buffer.from(shot3.data, "base64"));
  console.log("sticky-dock.png saved, tab:", await s.evalExpr("JSON.stringify(document.querySelector('.mini-tab')?.getBoundingClientRect())"));

  // 4) 恢复展开态（点击拉手）
  await s.evalExpr(`(() => { const t=document.querySelector('.mini-tab'); if(t){const r=t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent('mousedown',{button:0,clientX:r.x+5,clientY:r.y+5,bubbles:true}));} })()`);
  await wait(1200);
  console.log("restored, mini-tab exists:", await s.evalExpr("!!document.querySelector('.mini-tab')"));

  process.exit(0);
}

main().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
