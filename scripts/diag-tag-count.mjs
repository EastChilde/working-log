/** 诊断：updateTask/setTaskTags 是否真正生效（store + DB + 侧栏计数三层） */
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const targets = await fetchTargets();
const main = targets.find((t) => t.title.includes("工作清单") && t.webSocketDebuggerUrl);
const { ev, close } = await cdpConnect(main.webSocketDebuggerUrl);

const storeExpr = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tasks')`;

// 第 1 步：直接调 updateTask 改标签，逐步检查
const r1 = await ev(`(async function(){
  try {
    const store = ${storeExpr};
    const t = store.tasks.find(x => x.status !== 'done');
    if (!t) return { err: 'no open task' };
    window.__tid = t.id;
    window.__tagBefore = JSON.stringify(t.tags);
    const other = store.tags.find(g => !t.tags.includes(g.id));
    window.__newTagId = other ? other.id : null;
    window.__newTagName = other ? other.name : null;
    await store.updateTask(t.id, { tags: other ? [...t.tags, other.id] : t.tags });
    return { ok: true, id: t.id, before: window.__tagBefore, after: JSON.stringify(t.tags), tag: window.__newTagName };
  } catch(e) { return { err: e.message || String(e), stack: e.stack }; }
})()`);
console.log("1) updateTask 直接调用:", JSON.stringify(r1));

await ev(`new Promise(r=>setTimeout(r,800))`);

// 第 2 步：重新从 DB 读（fetch），看持久化是否成功
const r2 = await ev(`(async function(){
  try {
    const store = ${storeExpr};
    await store.fetch();
    const t = store.tasks.find(x => x.id === window.__tid);
    return { afterFetch: JSON.stringify(t ? t.tags : null) };
  } catch(e) { return { err: e.message }; }
})()`);
console.log("2) fetch 后（DB 持久化检查）:", JSON.stringify(r2));

// 第 3 步：侧栏计数现状 + 若标签加上了，计数是否变化
const r3 = await ev(`(function(){
  const store = ${storeExpr};
  const counts = [...document.querySelectorAll('.side-tag')].map(el => {
    const name = el.textContent.replace(/\\d+|✕/g,'').trim();
    const cnt = el.querySelector('.cnt');
    return name + '=' + (cnt ? cnt.textContent : '?');
  });
  const t = store.tasks.find(x => x.id === window.__tid);
  return { counts, taskTags: JSON.stringify(t ? t.tags : null), newTag: window.__newTagName };
})()`);
console.log("3) 侧栏计数:", JSON.stringify(r3));

// 第 4 步：把标签撤回原样（还原现场）
const r4 = await ev(`(async function(){
  try {
    const store = ${storeExpr};
    await store.updateTask(window.__tid, { tags: JSON.parse(window.__tagBefore) });
    const t = store.tasks.find(x => x.id === window.__tid);
    return { restored: JSON.stringify(t.tags) };
  } catch(e) { return { err: e.message }; }
})()`);
console.log("4) 还原:", JSON.stringify(r4));
close();
