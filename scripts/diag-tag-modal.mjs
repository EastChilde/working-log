/** 诊断2：完整弹窗 UI 流程插桩——每步检查 DOM 与 store 状态 */
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const targets = await fetchTargets();
const main = targets.find((t) => t.title.includes("工作清单") && t.webSocketDebuggerUrl);
const { ev, close } = await cdpConnect(main.webSocketDebuggerUrl);

const storeExpr = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tasks')`;

// 打开弹窗
const s1 = await ev(`(function(){
  const store = ${storeExpr};
  const t = store.tasks.find(x => x.status !== 'done');
  window.__tid = t.id;
  window.__before = JSON.stringify(t.tags);
  store.openEditor(t);
  return null;
})()`);
await ev(`new Promise(r=>setTimeout(r,500))`);
const s2 = await ev(`(function(){
  const modal = document.querySelector('.tm-modal');
  const opts = [...document.querySelectorAll('.tag-opt')];
  const title = document.querySelector('.tm-modal input');
  return { modalOpen: !!modal, optCount: opts.length, titleVal: title ? title.value : null,
           onOpts: opts.filter(o=>o.className.includes(' on')).map(o=>o.textContent.trim()) };
})()`);
console.log("1) 弹窗打开后:", JSON.stringify(s2));

// 点一个未选中的标签
const s3 = await ev(`(function(){
  const btn = [...document.querySelectorAll('.tag-opt')].find(b => !b.className.includes(' on'));
  window.__pickName = btn.textContent.trim();
  btn.click();
  return null;
})()`);
await ev(`new Promise(r=>setTimeout(r,300))`);
const s4 = await ev(`(function(){
  const opts = [...document.querySelectorAll('.tag-opt')];
  return { picked: window.__pickName,
           onOpts: opts.filter(o=>o.className.includes(' on')).map(o=>o.textContent.trim()) };
})()`);
console.log("2) 点标签后选中态:", JSON.stringify(s4));

// 点保存
const s5 = await ev(`(function(){
  const btns = [...document.querySelectorAll('.btn-ok')];
  const b = btns.find(b => b.offsetParent !== null);
  if (!b) return 'no visible btn-ok';
  b.click();
  return 'clicked';
})()`);
console.log("3) 保存按钮:", s5);
await ev(`new Promise(r=>setTimeout(r,800))`);

const s6 = await ev(`(async function(){
  const store = ${storeExpr};
  const t = store.tasks.find(x => x.id === window.__tid);
  const modalStill = !!document.querySelector('.tm-modal');
  await store.fetch();
  const t2 = store.tasks.find(x => x.id === window.__tid);
  return { editorOpen: store.editor.open, modalStillOpen: modalStill,
           storeTags: JSON.stringify(t ? t.tags : null), dbTags: JSON.stringify(t2 ? t2.tags : null) };
})()`);
console.log("4) 保存后:", JSON.stringify(s6));
console.log("   改动前:", (await ev("window.__before")));

// 还原
await ev(`(async function(){ const store = ${storeExpr}; await store.updateTask(window.__tid, { tags: JSON.parse(window.__before) }); })()`);
close();
