/** 诊断3：重新分配（摘除A+换B）弹窗全流程 + DOM 计数联动 */
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const targets = await fetchTargets();
const main = targets.find((t) => t.title.includes("工作清单") && t.webSocketDebuggerUrl);
const { ev, close } = await cdpConnect(main.webSocketDebuggerUrl);

const storeExpr = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tasks')`;

const counts = `(function(){
  return [...document.querySelectorAll('.side-tag')].map(el => {
    const name = el.textContent.replace(/\\d+|✕/g,'').trim();
    const cnt = el.querySelector('.cnt');
    return name + '=' + (cnt ? cnt.textContent : '?');
  }).join(' ');
})()`;

// 准备：给任务打上「工作」标签
const s0 = await ev(`(async function(){
  const store = ${storeExpr};
  const t = store.tasks.find(x => x.status !== 'done');
  window.__tid = t.id;
  const gz = store.tags.find(g => g.name === '工作');
  const xx = store.tags.find(g => g.name === '学习');
  window.__gz = gz.id; window.__xx = xx.id;
  await store.updateTask(t.id, { tags: [gz.id] });
  return null;
})()`);
await ev(`new Promise(r=>setTimeout(r,300))`);
console.log("0) 初始计数:", await ev(counts), "（任务 tags=[工作]，应为 工作=1）");

// 打开弹窗 → 摘除工作 → 选中学习 → 保存
await ev(`(function(){ const store = ${storeExpr}; store.openEditor(store.tasks.find(x=>x.id===window.__tid)); })()`);
await ev(`new Promise(r=>setTimeout(r,500))`);
const s1 = await ev(`(function(){
  const off = [...document.querySelectorAll('.tag-opt')].filter(b => !b.className.includes(' on'));
  const gzBtn = off.find(b => b.textContent.trim() === '工作');
  gzBtn.click(); // 摘除工作
  return null;
})()`);
await ev(`new Promise(r=>setTimeout(r,200))`);
const s2 = await ev(`(function(){
  const on = [...document.querySelectorAll('.tag-opt')].filter(b => b.className.includes(' on'));
  const xxBtn = on.find(b => b.textContent.trim() === '学习');
  if (xxBtn) { xxBtn.click(); return '取消工作→选学习'; }
  // 学习本来就没选，从 off 里找
  const off = [...document.querySelectorAll('.tag-opt')].filter(b => !b.className.includes(' on'));
  const b2 = off.find(b => b.textContent.trim() === '学习');
  b2.click(); return '选学习';
})()`);
await ev(`new Promise(r=>setTimeout(r,200))`);
const s3 = await ev(`(function(){
  const on = [...document.querySelectorAll('.tag-opt')].filter(b => b.className.includes(' on')).map(b=>b.textContent.trim());
  [...document.querySelectorAll('.btn-ok')].find(b => b.offsetParent !== null).click();
  return { onBeforeSave: on };
})()`);
console.log("1) 弹窗内选中:", JSON.stringify(s3), "（应为只有 学习）");
await ev(`new Promise(r=>setTimeout(r,800))`);

const s4 = await ev(`(async function(){
  const store = ${storeExpr};
  const t = store.tasks.find(x => x.id === window.__tid);
  const domCounts = ${counts};
  await store.fetch();
  const t2 = store.tasks.find(x => x.id === window.__tid);
  return { storeTags: t.tags.map(id => store.tags.find(g=>g.id===id).name).join(','),
           domCounts, dbTags: t2.tags.map(id => store.tags.find(g=>g.id===id).name).join(',') };
})()`);
console.log("2) 保存后:", JSON.stringify(s4), "（store/DB 应为 学习，DOM 应为 工作=0 学习=1）");

// 还原
await ev(`(async function(){ const store = ${storeExpr}; await store.updateTask(window.__tid, { tags: [] }); })()`);
close();
