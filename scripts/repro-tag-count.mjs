/** 复现：重新分配任务标签后，侧栏标签计数是否更新 */
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const targets = await fetchTargets();
const main = targets.find((t) => t.title.includes("工作清单") && t.webSocketDebuggerUrl);
const { ev, close } = await cdpConnect(main.webSocketDebuggerUrl);

// 侧栏标签计数快照
const snap = `(function(){
  const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tasks');
  const counts = [...document.querySelectorAll('.side-tag')].map(el => {
    const cnt = el.querySelector('.cnt');
    return { text: el.textContent.trim().slice(0, 20), count: cnt ? cnt.textContent : '?' };
  });
  return { tags: store.tags.map(t=>({id:t.id,name:t.name})), counts,
           tasks: store.tasks.map(t=>({id:t.id,title:t.title.slice(0,10),tags:t.tags,status:t.status})) };
})()`;

console.log("== 改动前 ==");
const before = await ev(snap);
console.log(JSON.stringify(before, null, 1));

// 找一个未完成任务，点击打开编辑弹窗
const openErr = await ev(`(function(){
  try {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tasks');
    const t = store.tasks.find(x => x.status !== 'done');
    if (!t) return 'no open task';
    window.__testTaskId = t.id;
    // 在清单视图里点该任务条打开弹窗：直接调用 store.openEditor 更稳
    store.openEditor(t);
    return null;
  } catch(e) { return e.message; }
})()`);
if (openErr) { console.log("打开弹窗失败:", openErr); close(); process.exit(1); }
await ev(`new Promise(r=>setTimeout(r,400))`);

// 弹窗内：取消所有已选标签，选中另一个标签（模拟“重新分配”）
const reassignErr = await ev(`(function(){
  try {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tasks');
    const cur = store.tasks.find(x => x.id === window.__testTaskId).tags;
    window.__oldTags = [...cur];
    const other = store.tags.find(t => !cur.includes(t.id));
    if (!other) return 'no other tag to switch to';
    window.__newTag = other.id;
    // 点弹窗内该标签胶囊（off 状态的）
    const btn = [...document.querySelectorAll('.tag-opt')].find(b => b.textContent.includes(other.name));
    if (!btn) return 'tag button not found';
    btn.click();
    return null;
  } catch(e) { return e.message; }
})()`);
if (reassignErr) { console.log("选标签失败:", reassignErr); close(); process.exit(1); }
await ev(`new Promise(r=>setTimeout(r,200))`);

// 点保存
const saveErr = await ev(`(function(){
  try {
    const btn = [...document.querySelectorAll('.btn-ok')].find(b => b.offsetParent !== null);
    if (!btn) return 'save btn not found';
    btn.click();
    return null;
  } catch(e) { return e.message; }
})()`);
if (saveErr) { console.log("保存失败:", saveErr); close(); process.exit(1); }
await ev(`new Promise(r=>setTimeout(r,600))`);

console.log("\n== 改动后 ==");
const after = await ev(snap);
console.log(JSON.stringify(after, null, 1));

const tid = "__testTaskId";
console.log("\n== 结论 ==");
const bt = before.tasks.find(x => x.id === eval(tid));
const at = after.tasks.find(x => x.id === eval(tid));
console.log("任务标签:", JSON.stringify(bt?.tags), "→", JSON.stringify(at?.tags));
for (const c of after.counts) {
  const b = before.counts.find(x => x.text === c.text);
  const changed = b && b.count !== c.count;
  console.log(`侧栏 ${c.text}: ${b?.count} → ${c.count} ${changed ? "✅已更新" : "（未变化）"}`);
}
close();
