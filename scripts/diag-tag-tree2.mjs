/** 二级标签失败场景聚焦诊断 */
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";
const targets = await fetchTargets();
const main = targets.find((t) => t.title.includes("工作清单") && t.webSocketDebuggerUrl);
const { ev, close } = await cdpConnect(main.webSocketDebuggerUrl);
const storeExpr = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tasks')`;

const r1 = await ev(`(async function(){
  try {
    const store = ${storeExpr};
    const gz = store.tags.find(t => t.name === '工作');
    const created = await store.addTag('诊断子标签', 'teal', gz.id);
    const dup = await store.addTag('诊断子标签', 'red', gz.id);
    const child = store.tags.find(t => t.name === '诊断子标签');
    const deep = child ? await store.addTag('三级', 'red', child.id) : 'no-child';
    return { gzExists: !!gz, created: created ? created.id : null,
             dup: dup === null ? 'REJECTED' : (dup ? dup.id : 'undefined?'),
             childParent: child ? child.parent_id : 'CHILD-NOT-FOUND',
             deep: deep === null ? 'REJECTED' : JSON.stringify(deep),
             allTags: store.tags.map(t => t.name + '/' + (t.parent_id ? '子' : '顶')) };
  } catch(e) { return { ERR: e.message || String(e) }; }
})()`);
console.log("R1:", JSON.stringify(r1, null, 1));

const r2 = await ev(`(async function(){
  try {
    const store = ${storeExpr};
    const gz = store.tags.find(t => t.name === '工作');
    const before = store.tags.length;
    await store.removeTag(gz.id);
    const diag = store.tags.find(t => t.name === '诊断子标签');
    return { before, after: store.tags.length, gzGone: !store.tags.some(t=>t.name==='工作'),
             diagAlive: !!diag, diagParent: diag ? diag.parent_id : null };
  } catch(e) { return { ERR: e.message || String(e) }; }
})()`);
console.log("R2:", JSON.stringify(r2, null, 1));

// 清理
await ev(`(async function(){ try { const store = ${storeExpr}; const d = store.tags.find(t=>t.name==='诊断子标签'); if (d) await store.removeTag(d.id); } catch(e){} })()`);
close();
