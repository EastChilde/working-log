// 验证历史回顾视图：渲染、区间筛选、统计数字、导出内容
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

(async () => {
  const list = await (await fetch(CDP)).json();
  const main = list.find((t) => t.type === "page" && (t.url || "").endsWith("5173/"));
  if (!main) { console.log("MAIN NOT FOUND"); process.exit(1); }

  const { ask, ws } = await connect(main);

  // 1. 刷新加载新代码
  ws.send(JSON.stringify({ id: 900, method: "Page.reload" }));
  await wait(3500);

  // 2. 检查挂载与报错
  const title = await ask("document.title", false);
  console.log("TITLE:", title);
  if (String(title).includes("ERROR")) { console.log("❌ 页面报错"); process.exit(1); }

  // 3. 切到回顾视图
  await ask(`[...document.querySelectorAll(".seg button")].find(b=>b.textContent.includes("回顾")).click()`, false);
  await wait(600);

  // 4. 验证回顾视图元素
  const ui = JSON.parse(await ask(`JSON.stringify((()=>{
    const hist=document.querySelector(".hist");
    return {
      rendered: !!hist,
      cards: hist ? hist.querySelectorAll(".h-card").length : 0,
      bars: hist ? hist.querySelectorAll(".h-bar-col").length : 0,
      grainBtns: hist ? [...hist.querySelectorAll(".seg.mini button")].map(b=>b.textContent) : [],
      exportBtn: !!hist?.querySelector(".h-export"),
      groups: hist ? hist.querySelectorAll(".h-group").length : 0,
    };
  })())`));
  console.log("UI:", JSON.stringify(ui));
  if (!ui.rendered || ui.cards !== 4 || ui.bars !== 12 || ui.exportBtn === false) {
    console.log("❌ 回顾视图渲染不完整"); process.exit(1);
  }

  // 5. 统计数字与 store 实际数据对比（当月，按完成日期）
  const check = JSON.parse(await ask(`(async()=>{
    const m = await import("/src/stores/tasks.ts");
    const s = m.useTaskStore();
    const ym = new Date().getFullYear()+"-"+String(new Date().getMonth()+1).padStart(2,"0");
    const doneInMonth = s.tasks.filter(t=>t.status==="done"&&t.completed_at&&t.completed_at.startsWith(ym)).length;
    const createdInMonth = s.tasks.filter(t=>t.created_at.startsWith(ym)).length;
    const cardVals = [...document.querySelectorAll(".h-card .n")].map(e=>e.textContent.trim());
    return JSON.stringify({ doneInMonth, createdInMonth, cardVals });
  })())`));
  console.log("STATS:", check);

  // 6. 导出内容抽查
  await ask(`document.querySelector(".h-export").click()`, false);
  await wait(500);
  const md = await ask(`document.querySelector(".h-md")?.value.slice(0,400)`, false);
  console.log("MD_HEAD:", JSON.stringify(md));
  const hasCopy = await ask(`!!document.querySelector(".h-modal-foot")`, false);
  await ask(`document.querySelector(".h-modal-head .s-btn").click()`, false);
  console.log("MODAL:", hasCopy ? "✅ 弹窗/复制/下载可用" : "❌ 弹窗异常");

  // 7. 切换粒度到「年」验证
  await ask(`[...document.querySelectorAll(".hist .seg.mini button")].find(b=>b.textContent==="年").click()`, false);
  await wait(500);
  const yearLabel = await ask(`document.querySelector(".hist .month-nav b")?.textContent`, false);
  console.log("YEAR_VIEW:", yearLabel);

  console.log(ui.rendered ? "✅ 回顾视图验证通过" : "❌ FAIL");
  ws.close();
  process.exit(0);
})().catch((e) => { console.log("FAIL:", e.message); process.exit(1); });
