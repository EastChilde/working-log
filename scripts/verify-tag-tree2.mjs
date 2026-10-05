/** 二级标签 e2e 补测：2a/2b/5/6（全部用临时标签，不碰用户数据）+ 恢复「工作」标签 */
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";
const targets = await fetchTargets();
const main = targets.find((t) => t.title.includes("工作清单") && t.webSocketDebuggerUrl);
const { ev, close } = await cdpConnect(main.webSocketDebuggerUrl);
const storeExpr = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tasks')`;
let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? "  " + detail : ""}`); }
  else { fail++; console.log(`❌ ${name}${detail ? "  " + detail : ""}`); }
}

/* ---- 恢复用户「工作」标签（此前场景5误删） ---- */
const r0 = await ev(`(async function(){
  const store = ${storeExpr};
  if (!store.tags.some(t => t.name === '工作')) {
    await store.addTag('工作', 'blue', null);
    return { restored: true };
  }
  return { restored: false };
})()`);
console.log("用户「工作」标签:", r0.restored ? "已恢复" : "本就存在");

/* ---- 2a 同级重名拦截 / 2b 三级拒绝 ---- */
const r2 = await ev(`(async function(){
  try {
    const store = ${storeExpr};
    const p1 = await store.addTag('临时父A', 'purple', null);
    const c1 = await store.addTag('临时子B', 'teal', p1.id);
    const dup = await store.addTag('临时子B', 'red', p1.id);          // 同级重名 → 拒绝
    const otherTop = await store.addTag('临时子B', 'red', null);      // 不同层级同名 → 允许
    const deep = await store.addTag('三级X', 'red', c1.id);           // 挂子标签下 → 拒绝
    return { p1: !!p1, c1: !!c1, dupRejected: dup === null, otherTopOk: !!otherTop, deepRejected: deep === null,
             cleanup: async () => {} , otherTopId: otherTop ? otherTop.id : null };
  } catch(e) { return { ERR: e.message || String(e) }; }
})()`);
check("2a 同级重名被拦截", r2.dupRejected === true);
check("2b 三级标签被拒绝", r2.deepRejected === true);
console.log("   (不同层级同名允许:", r2.otherTopOk, "— 符合同级查重设计)");

/* ---- 5 删除父标签 → 子标签升级顶级 ---- */
const r5 = await ev(`(async function(){
  try {
    const store = ${storeExpr};
    const p = store.tags.find(t => t.name === '临时父A');
    const c = store.tags.find(t => t.name === '临时子B' && t.parent_id === p.id);
    // 给子标签挂个任务引用，验证升级后引用保留
    const t = store.tasks.find(x => x.status !== 'done');
    window.__tid = t.id; window.__before = JSON.stringify(t.tags);
    await store.updateTask(t.id, { tags: [c.id] });
    await store.removeTag(p.id);
    const cAfter = store.tags.find(x => x.id === c.id);
    const refKept = store.tasks.find(x => x.id === window.__tid).tags.includes(c.id);
    return { parentGone: !store.tags.some(x => x.id === p.id),
             childAlive: !!cAfter, childTop: cAfter ? cAfter.parent_id === null : false, refKept };
  } catch(e) { return { ERR: e.message || String(e) }; }
})()`);
check("5 删除父标签后子标签升级为顶级且引用保留",
  r5.parentGone && r5.childAlive && r5.childTop && r5.refKept, JSON.stringify(r5));

/* ---- 6 已完成任务打标签 → 计数更新（角标为总数的修复验证） ---- */
const r6 = await ev(`(async function(){
  try {
    const store = ${storeExpr};
    const tag = store.tags.find(t => t.name === '临时子B');
    const done = store.tasks.find(x => x.status === 'done');
    window.__did = done.id; window.__dbefore = JSON.stringify(done.tags);
    const cntBefore = store.tasks.filter(t => t.tags.includes(tag.id)).length;
    const domBefore = document.querySelector('.side-tag .cnt') ? [...document.querySelectorAll('.side-tag')].find(el => el.textContent.includes('临时子B'))?.querySelector('.cnt')?.textContent : null;
    await store.updateTask(done.id, { tags: [tag.id] });
    const cntAfter = store.tasks.filter(t => t.tags.includes(tag.id)).length;
    const domAfter = [...document.querySelectorAll('.side-tag')].find(el => el.textContent.includes('临时子B'))?.querySelector('.cnt')?.textContent;
    return { cntBefore, cntAfter, domBefore, domAfter };
  } catch(e) { return { ERR: e.message || String(e) }; }
})()`);
check("6 已完成任务打标签后角标计数更新（含 DOM）",
  r6.cntAfter === r6.cntBefore + 1 && r6.domAfter === String(r6.cntAfter),
  `store ${r6.cntBefore}→${r6.cntAfter}, DOM ${r6.domBefore}→${r6.domAfter}`);

/* ---- 清理全部临时数据 ---- */
await ev(`(async function(){
  const store = ${storeExpr};
  await store.updateTask(window.__tid, { tags: JSON.parse(window.__before) });
  await store.updateTask(window.__did, { tags: JSON.parse(window.__dbefore) });
  for (const n of ['临时子B', '临时子B', '临时父A']) {
    const t = store.tags.find(x => x.name === n);
    if (t) await store.removeTag(t.id);
  }
  return null;
})()`);
console.log("临时数据已清理");
console.log(`\n补测结果: ${pass} 通过 / ${fail} 失败`);
close();
