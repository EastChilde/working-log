// 验证日历布局修复 + 优先级圆点 + 悬浮提示
import http from "node:http";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => res(JSON.parse(d)));
    }).on("error", rej);
  });
}

async function main() {
  const list = (await getJson("http://127.0.0.1:9223/json")).filter((t) => t.type === "page");
  const main = list.find((t) => (t.url || "").endsWith(":5173/"));
  if (!main) throw new Error("main window not found: " + list.map((t) => t.url).join(","));
  const ws = new WebSocket(main.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval fail");
    return r.result?.value;
  };

  await sleep(2000);
  // 确保在日历视图
  await ev(`(async()=>{const s=document.querySelectorAll('.seg button');for(const b of s){if(b.textContent.includes('日历'))b.click();}return 'ok'})()`).catch(()=>{});
  await sleep(500);

  // 1. 列宽一致性
  const widths = await ev(`JSON.stringify([...document.querySelectorAll('.cal-grid .cell')].slice(0,14).map(c=>Math.round(c.getBoundingClientRect().width)))`);
  const wArr = JSON.parse(widths);
  const uniq = [...new Set(wArr)];
  console.log("cell widths:", uniq.join(","), uniq.length === 1 ? "✅ 列宽一致" : "❌ 列宽不一致");

  // 2. 任务条是否单行省略（无换行溢出）
  const overflow = await ev(`(()=>{
    let bad=0;
    for(const t of document.querySelectorAll('.cal-grid .cell .t')){
      if(t.scrollHeight > t.clientHeight + 2) bad++;
    }
    return bad;
  })()`);
  console.log("单行溢出行数:", overflow, overflow === 0 ? "✅" : "❌");

  // 3. 悬浮有任务的格子 → 提示框出现
  const hover = await ev(`(async()=>{
    const cell=[...document.querySelectorAll('.cal-grid .cell')].find(c=>c.querySelectorAll('.t:not(.more)').length>0);
    if(!cell) return 'NO_TASK_CELL';
    const r=cell.getBoundingClientRect();
    cell.dispatchEvent(new MouseEvent('mouseenter',{clientX:r.x+r.width/2,clientY:r.y+30,bubbles:true}));
    cell.dispatchEvent(new MouseEvent('mousemove',{clientX:r.x+r.width/2,clientY:r.y+30,bubbles:true}));
    await new Promise(r=>setTimeout(r,300));
    const tip=document.querySelector('.cal-tip');
    return tip ? 'TIP_OK rows='+tip.querySelectorAll('.tip-row').length : 'TIP_MISSING';
  })()`);
  console.log("悬浮提示:", hover);

  // 4. 截图
  await ev(`(()=>{const t=document.querySelector('.cal-tip');if(t){const c=[...document.querySelectorAll('.cal-grid .cell')].find(c=>c.querySelectorAll('.t:not(.more)').length>0);const r=c.getBoundingClientRect();t.style.left=(r.right+8)+'px';t.style.top=r.y+'px';}})()`);
  await send("Page.enable");
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const fs = await import("node:fs");
  fs.writeFileSync("D:/projects/todo/working-log/screenshots/calendar-fixed.png", Buffer.from(shot.data, "base64"));
  console.log("screenshot saved");
  process.exit(0);
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
