// CDP 验证：新增/编辑弹窗全流程
const list = await (await fetch('http://127.0.0.1:9223/json')).json();
const page = list.find(t => t.url.includes('5173') && !t.url.includes('sticky.html'));
if (!page) { console.log('MAIN_PAGE_NOT_FOUND'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
function send(method, params) {
  return new Promise((res, rej) => { id++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
}
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
    else p.res(msg);
  }
});
await new Promise(r => ws.addEventListener('open', r, { once: true }));

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value;
}

await new Promise(r => setTimeout(r, 8000));
const out = [];

// 0. 页面无报错（main.ts 把错误写进标题）
out.push('title=' + await evalJs('document.title'));

// 1. 新增按钮存在 + 点击打开弹窗
out.push('addbtn=' + !!(await evalJs('document.querySelector(".dp-addbtn")')));
await evalJs('document.querySelector(".dp-addbtn").click()');
out.push('mask=' + !!(await evalJs('document.querySelector(".tm-mask")')));
out.push('mode=' + await evalJs('document.querySelector(".tm-title").textContent.trim()'));

// 2. 填标题 + 选高优先级 + 回车提交
const before = await evalJs(`window.__PINIA_TASK_COUNT__ || document.querySelectorAll(".dp-body .task").length`);
await evalJs(`const i=document.querySelector(".tm-body input[type=text]"); i.value="CDP测试任务"; i.dispatchEvent(new Event("input"));`);
await evalJs(`document.querySelector(".pri-pill.hi").click()`);
await evalJs(`const i2=document.querySelector(".tm-body input[type=text]"); i2.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));`);
await new Promise(r => setTimeout(r, 600));
const after = await evalJs(`document.querySelectorAll(".dp-body .task").length`);
out.push(`taskCount ${before}->${after} ${Number(after) > Number(before) ? 'ADD_OK' : 'ADD_FAIL'}`);

// 3. 找到测试任务，点行打开编辑
await evalJs(`[...document.querySelectorAll(".dp-body .task")].find(t=>t.textContent.includes("CDP测试任务"))?.querySelector(".t-main").click()`);
out.push('editMode=' + await evalJs(`document.querySelector(".tm-title")?.textContent.includes("编辑模式")`));
out.push('editValue=' + await evalJs(`document.querySelector(".tm-body input[type=text]")?.value`));

// 4. 设置预计结束日期（今天快捷）+ 保存
await evalJs(`document.querySelector(".tm-due-btn").click()`);
out.push('picker=' + !!(await evalJs('document.querySelector(".tm-picker")')));
out.push('pickerDays=' + await evalJs('document.querySelectorAll(".pk-day:not(.dim)").length'));
await evalJs(`[...document.querySelectorAll(".pk-quick")].find(b=>b.textContent==="今天").click()`);
out.push('duePicked=' + await evalJs(`document.querySelector(".tm-due").classList.contains("picked")`));
await evalJs(`document.querySelector(".btn-ok").click()`);
await new Promise(r => setTimeout(r, 600));
out.push('dueShown=' + await evalJs(`[...document.querySelectorAll(".dp-body .task")].find(t=>t.textContent.includes("CDP测试任务"))?.textContent.includes("预计")`));

// 5. Esc 关闭
await evalJs(`document.querySelector(".dp-addbtn").click()`);
await evalJs(`window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))`);
out.push('escClose=' + !(await evalJs(`document.querySelector(".tm-mask")`)));

// 6. 清理：删掉测试任务
await evalJs(`const el=[...document.querySelectorAll(".dp-body .task")].find(t=>t.textContent.includes("CDP测试任务")); if(el) el.querySelector(".del").click();`);
await new Promise(r => setTimeout(r, 400));
out.push('cleaned=' + !(await evalJs(`[...document.querySelectorAll(".dp-body .task")].some(t=>t.textContent.includes("CDP测试任务"))`)));

console.log(out.join('\n'));
ws.close();
process.exit(0);
