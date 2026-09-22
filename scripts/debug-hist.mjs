const CDP = "http://127.0.0.1:9223/json";
(async () => {
  const list = await (await fetch(CDP)).json();
  const main = list.find((t) => t.type === "page" && (t.url || "").endsWith("5173/"));
  const ws = new WebSocket(main.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const ask = (expr, awaitP = true) => new Promise((resolve, reject) => {
    const id = ++seq;
    const h = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        ws.removeEventListener("message", h);
        m.result?.exceptionDetails
          ? reject(new Error(String(m.result.exceptionDetails.exception?.description || "").slice(0, 400)))
          : resolve(m.result?.result?.value);
      }
    };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: awaitP } }));
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log("SEG BUTTONS:", JSON.stringify(await ask(`[...document.querySelectorAll(".seg button")].map(b=>b.textContent.trim())`, false)));
  console.log("VITE OVERLAY:", await ask(`!!document.querySelector("vite-error-overlay")`, false));
  // 手动点击并看结果
  const clickRes = await ask(`(()=>{
    const b=[...document.querySelectorAll(".seg button")].find(b=>b.textContent.includes("回顾"));
    if(!b) return "NO_BTN";
    b.click();
    const seg=b.closest(".seg");
    return "clicked, on-btns="+[...seg.querySelectorAll("button.on")].map(x=>x.textContent.trim()).join("/");
  })()`, false);
  console.log("CLICK:", clickRes);
  await wait(800);
  console.log("HIST EXISTS:", await ask(`!!document.querySelector(".hist")`, false));
  console.log("VIEW ON:", await ask(`[...document.querySelectorAll(".view")].map(v=>v.className)`, false));
  // 检查控制台错误
  ws.close();
  process.exit(0);
})().catch((e) => { console.log("FAIL:", e.message); process.exit(1); });
