// 侧栏范围筛选（今日待办/滞留/全部）+ 回顾单入口 验证脚本
const CDP = "http://127.0.0.1:9223";

const targets = await (await fetch(`${CDP}/json`)).json();
const main = targets.find((t) => t.title.includes("工作清单") && t.webSocketDebuggerUrl);
if (!main) { console.error("main window not found"); process.exit(1); }

const ws = new WebSocket(main.webSocketDebuggerUrl);
let id = 0;
const cbs = {};
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && cbs[m.id]) { cbs[m.id](m); delete cbs[m.id]; } };
await new Promise((r) => (ws.onopen = r));
function ev(expr) {
  id++;
  return new Promise((res) => {
    cbs[id] = (m) => {
      if (m.error) return res({ cdpError: m.error.message });
      if (m.result?.exceptionDetails) return res({ err: m.result.exceptionDetails.exception?.description || m.result.exceptionDetails.text });
      res(m.result?.result?.value);
    };
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const activeView = "[...document.querySelectorAll('.view')].findIndex(v=>v.className.includes('on'))";
const clickSide = (kw) => `[...document.querySelectorAll('.side-item')].find(b=>b.textContent.includes('${kw}')).click()`;

console.log("1 今日待办:", JSON.stringify(await ev(`(async()=>{${clickSide("今日待办")};await new Promise(r=>setTimeout(r,300));return {view:${activeView},onItems:[...document.querySelectorAll('.side-item.on')].map(x=>x.textContent.trim().slice(0,6)),scope:window.__st?window.__st.scope:'?',groupHeads:[...document.querySelectorAll('.group-head b')].map(x=>x.textContent),dpScope:document.querySelector('.dp-scope')?.textContent}})()`)));

console.log("2 滞留任务:", JSON.stringify(await ev(`(async()=>{${clickSide("滞留任务")};await new Promise(r=>setTimeout(r,300));return {view:${activeView},stayItems:document.querySelectorAll('.stagnant-sec .task').length,groupHeads:[...document.querySelectorAll('.group-head b')].map(x=>x.textContent)}})()`)));

console.log("3 回顾单入口+切回:", JSON.stringify(await ev(`(async()=>{${clickSide("年度统计")};await new Promise(r=>setTimeout(r,200));const v0=${activeView};const n=[...document.querySelectorAll('.side-item')].filter(x=>x.textContent.includes('年度')).length;${clickSide("今日待办")};await new Promise(r=>setTimeout(r,200));return {histView:v0,年度入口数:n,切回后view:${activeView}}})()`)));

console.log("4 全部任务:", JSON.stringify(await ev(`(async()=>{${clickSide("全部任务")};await new Promise(r=>setTimeout(r,300));return {scope:window.__st.scope,view:${activeView},groupHeads:[...document.querySelectorAll('.group-head b')].map(x=>x.textContent),todayCnt:document.querySelectorAll('.group-head ~ * .task, .task').length}})()`)));

ws.close();
