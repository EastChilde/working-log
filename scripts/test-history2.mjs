// 历史回顾视图完整验证：插入对照数据 → 验证统计/分组/导出 → 清理
const CDP = "http://127.0.0.1:9223/json";

async function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const ask = (expr, awaitP = true) => new Promise((resolve, reject) => {
    const id = ++seq;
    const h = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        ws.removeEventListener("message", h);
        m.result?.exceptionDetails
          ? reject(new Error(String(m.result.exceptionDetails.exception?.description || "").slice(0, 300)))
          : resolve(m.result?.result?.value);
      }
    };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: awaitP } }));
  });
  return { ask, ws };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TODAY = (() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })();

(async () => {
  const list = await (await fetch(CDP)).json();
  const main = list.find((t) => t.type === "page" && (t.url || "").endsWith("5173/"));
  const { ask, ws } = await connect(main);

  // 1. 通过 repo 插入两条对照任务（一条今日完成、一条今日创建未完成）
  const ins = await ask(`(async()=>{
    const m = await import("/src/db.ts");
    const a = await m.repo.insert({ title: "【验证】回顾统计-已完成", parent_id: null, status: "done", priority: null, tag: "验证", deadline: null, created_at: "${TODAY}", completed_at: "${TODAY}", sort: 98 });
    const b = await m.repo.insert({ title: "【验证】回顾统计-未完成", parent_id: null, status: "todo", priority: null, tag: "验证", deadline: null, created_at: "${TODAY}", completed_at: null, sort: 99 });
    return JSON.stringify([a.id, b.id]);
  })()`);
  const [idA, idB] = JSON.parse(ins);
  console.log("INSERTED:", idA, idB);

  // 2. 等 store 轮询同步后切到回顾视图
  await wait(1200);
  await ask(`[...document.querySelectorAll(".seg button")].find(b=>b.textContent.includes("回顾")).click()`, false);
  await wait(700);

  // 3. 统计卡片（默认：按完成日期 + 月视图）
  const cards = JSON.parse(await ask(`JSON.stringify([...document.querySelectorAll(".h-card .n")].map(e=>e.textContent.trim()))`));
  console.log("CARDS:", JSON.stringify(cards)); // 期望 ["1","2","50%","0.0 天"] 附近
  const groups = await ask(`document.querySelectorAll(".h-group").length`, false);
  console.log("GROUPS:", groups); // 期望 ≥1（今日完成组）

  // 4. 切「按创建日期」基准 → 未完成任务也应出现
  await ask(`[...document.querySelectorAll(".hist .seg.mini button")].find(b=>b.textContent.includes("按创建日期")).click()`, false);
  await wait(500);
  const g2 = await ask(`(function(){var t=document.body.innerText;return t.includes("回顾统计-未完成")&&t.includes("回顾统计-已完成")})()`, false);
  console.log("CREATED_BASE:", g2 ? "✅ 两种基准下任务都可见" : "❌ 基准切换异常");

  // 5. 导出 Markdown 内容
  await ask(`[...document.querySelectorAll(".hist .seg.mini button")].find(b=>b.textContent.includes("按完成日期")).click()`, false);
  await wait(400);
  await ask(`document.querySelector(".h-export").click()`, false);
  await wait(500);
  const md = await ask(`document.querySelector(".h-md").value`, false);
  const mdOk = md.includes("# 工作回顾") && md.includes("【验证】回顾统计-已完成") && md.includes("- [x]");
  console.log("EXPORT:", mdOk ? "✅ Markdown 含标题/任务/勾选标记" : "❌ 内容异常", "| 长度:", md.length);
  const btns = await ask(`document.querySelector(".h-modal-foot").innerText`, false);
  console.log("MODAL BTNS:", btns.replace(/\n/g, " | "));
  await ask(`document.querySelector(".h-modal-head .s-btn").click()`, false);

  // 6. 清理验证数据
  await ask(`(async()=>{const m=await import("/src/db.ts");await m.repo.removeSoft("${idA}");await m.repo.removeSoft("${idB}");return "CLEANED"})()`);
  await wait(1200);
  const clean = await ask(`!document.body.innerText.includes("回顾统计")`, false);
  console.log("CLEANUP:", clean ? "✅ 验证数据已清理" : "⚠️ 清理未同步，等轮询");

  console.log("RESULT:", mdOk && g2 && groups >= 1 ? "✅ 历史回顾视图全链路验证通过" : "❌ 存在失败项");
  ws.close();
  process.exit(mdOk && g2 && groups >= 1 ? 0 : 1);
})().catch((e) => { console.log("FAIL:", e.message); process.exit(1); });
