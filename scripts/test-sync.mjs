// 临时脚本：验证便签→主界面跨窗口数据联动
(async () => {
  const res = await fetch("http://127.0.0.1:9223/json");
  const list = await res.json();
  const main = list.find((t) => t.type === "page" && (t.url || "").endsWith("5173/"));
  const sticky = list.find((t) => t.type === "page" && (t.url || "").includes("sticky.html"));
  if (!main || !sticky) { console.log("PAGE MISSING", !!main, !!sticky); process.exit(1); }

  let seq = 0;
  const conn = (page) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const opened = new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    const ask = (expr, awaitP = true) => opened.then(() => new Promise((resolve, reject) => {
      const id = ++seq;
      const h = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === id) {
          ws.removeEventListener("message", h);
          if (m.result && m.result.exceptionDetails) reject(new Error(JSON.stringify(m.result.exceptionDetails.exception?.description || "").slice(0, 300)));
          else resolve(m.result?.result?.value);
        }
      };
      ws.addEventListener("message", h);
      ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: awaitP } }));
    }));
    return { ask, ws };
  };
  const M = conn(main), S = conn(sticky);

  // 主界面：当前当日面板任务数
  const n0 = await M.ask('document.querySelectorAll(".dp-body .task").length', false);

  // 便签窗口：通过 repo 插入一条任务（created_at=今天）
  const insertExpr = `(async()=>{
    const m = await import("/src/db.ts");
    const d = new Date();
    const today = d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
    await m.repo.insert({title:"V1.0 便签联动测试",parent_id:null,status:"todo",priority:null,tag:null,deadline:null,created_at:today,completed_at:null,sort:99});
    return "INSERTED";
  })()`;
  const ins = await S.ask(insertExpr);
  console.log("MAIN_BEFORE:", n0, "STICKY_INSERT:", ins);

  // 等主界面轮询同步（5s 轮询 + 余量）
  setTimeout(async () => {
    const n1 = await M.ask('document.querySelectorAll(".dp-body .task").length', false);
    const stickyRows = await S.ask('document.querySelectorAll(".s-task:not(.done)").length', false);
    console.log("MAIN_AFTER:", n1, "(expect", Number(n0) + 1, ") STICKY_ROWS:", stickyRows);
    M.ws.close(); S.ws.close();
    process.exit(0);
  }, 7000);
})().catch((e) => { console.log("FAIL", e.message); process.exit(1); });
