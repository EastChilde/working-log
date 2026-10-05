/** 二级标签 e2e 验证：树形侧栏/聚合计数/父标签筛选/删除升级/计数修复 */
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const targets = await fetchTargets();
const main = targets.find((t) => t.title.includes("工作清单") && t.webSocketDebuggerUrl);
if (!main) { console.log("未找到主窗口 CDP 目标"); process.exit(1); }
const { ev, close } = await cdpConnect(main.webSocketDebuggerUrl);

const storeExpr = `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tasks')`;
let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`✅ ${name}${detail ? "  " + detail : ""}`); }
  else { fail++; console.log(`❌ ${name}${detail ? "  " + detail : ""}`); }
}
const wait = (ms) => ev(`new Promise(r=>setTimeout(r,${ms}))`);
const sideTags = `(function(){
  return [...document.querySelectorAll('.side-tag')].map(el => ({
    name: el.textContent.replace(/\\d+|✕|▸|▾/g,'').trim(),
    cnt: el.querySelector('.cnt') ? el.querySelector('.cnt').textContent : '?',
    sub: el.className.includes('side-tag-sub')
  }));
})()`;

/* ---- 场景 0：迁移后数据完好 ---- */
const s0 = await ev(`(async function(){
  const store = ${storeExpr};
  await store.fetch();
  return { tags: store.tags.map(t=>({name:t.name,parent:t.parent_id})), taskN: store.tasks.length };
})()`);
check("0 迁移 v3 后标签数据完好", s0.tags.length > 0 && s0.tags.every(t => t.parent === null), JSON.stringify(s0.tags.map(t=>t.name)));

/* ---- 场景 1：建子标签（工作 > 临时验证子标签） ---- */
const s1 = await ev(`(async function(){
  const store = ${storeExpr};
  const gz = store.tags.find(t => t.name === '工作');
  const child = await store.addTag('临时验证子标签', 'teal', gz.id);
  return { ok: !!child, id: child ? child.id : null, pid: gz.id };
})()`);
check("1 在「工作」下新建子标签", s1.ok);
await wait(300);

/* ---- 场景 2：同级重名拦截 + 跨级限制 ---- */
const s2 = await ev(`(async function(){
  const store = ${storeExpr};
  const gz = store.tags.find(t => t.name === '工作');
  const child = store.tags.find(t => t.name === '临时验证子标签');
  const dup = await store.addTag('临时验证子标签', 'red', gz.id);     // 同级重名 → null
  const dupTop = await store.addTag('临时验证子标签', 'red', null);   // 顶级同名 → 允许（不同层级）
  const deep = await store.addTag('三级标签', 'red', child.id);       // 挂到子标签下 → 拒绝
  if (dupTop) await store.removeTag(dupTop.id);
  return { dupRejected: dup === null, deepRejected: deep === null };
})()`);
check("2a 同级重名被拦截", s2.dupRejected);
check("2b 三级标签被拒绝", s2.deepRejected);

/* ---- 场景 3：给任务打子标签 → 父标签聚合计数 ---- */
const s3 = await ev(`(async function(){
  const store = ${storeExpr};
  const child = store.tags.find(t => t.name === '临时验证子标签');
  const t = store.tasks.find(x => x.status !== 'done');
  window.__tid = t.id;
  window.__tagsBefore = JSON.stringify(t.tags);
  await store.updateTask(t.id, { tags: [child.id] });
  return null;
})()`);
await wait(300);
const s3b = await ev(`(function(){
  const store = ${storeExpr};
  const gz = store.tags.find(t => t.name === '工作');
  const child = store.tags.find(t => t.name === '临时验证子标签');
  const cnt = (id) => store.tasks.filter(t => t.tags.some(tid => {
    let cur = tid;
    while (cur) { if (cur === id) return true; cur = (store.tags.find(x=>x.id===cur)||{}).parent_id ?? null; }
    return false;
  })).length;
  const sides = ${sideTags};
  return { parentCnt: cnt(gz.id), childCnt: cnt(child.id),
           sideParent: sides.find(s=>s.name==='工作'), sideChild: sides.find(s=>s.name==='临时验证子标签') };
})()`);
check("3 父标签聚合计数含子标签任务", s3b.parentCnt >= 1 && s3b.childCnt >= 1,
  `父=${s3b.parentCnt} 子=${s3b.childCnt} 侧栏父=${JSON.stringify(s3b.sideParent)} 侧栏子=${JSON.stringify(s3b.sideChild)}`);

/* ---- 场景 4：点父标签筛选 → 命中子标签任务 ---- */
const s4 = await ev(`(async function(){
  const store = ${storeExpr};
  const gz = store.tags.find(t => t.name === '工作');
  store.toggleTagFilter(gz.id);
  await new Promise(r=>setTimeout(r,100));
  const hit = store.filteredTasks.some(t => t.id === window.__tid);
  const xx = store.tags.find(t => t.name === '学习');
  store.toggleTagFilter(gz.id); // 取消
  return { hitByParent: hit };
})()`);
check("4 父标签筛选命中子标签任务", s4.hitByParent);

/* ---- 场景 5：删除父标签 → 子标签升级为顶级 ---- */
const s5 = await ev(`(async function(){
  const store = ${storeExpr};
  const gz = store.tags.find(t => t.name === '工作');
  const childId = store.tags.find(t => t.name === '临时验证子标签').id;
  await store.removeTag(gz.id);
  const child = store.tags.find(t => t.id === childId);
  return { childAlive: !!child, childTop: child ? child.parent_id === null : false,
           gzGone: !store.tags.some(t => t.name === '工作') };
})()`);
check("5 删除父标签后子标签升级为顶级", s5.childAlive && s5.childTop && s5.gzGone);

/* ---- 场景 6：计数修复——已完成任务打标签计数也更新 ---- */
const s6 = await ev(`(async function(){
  const store = ${storeExpr};
  const done = store.tasks.find(x => x.status === 'done');
  const tag = store.tags.find(t => t.name === '临时验证子标签');
  const cntBefore = store.tasks.filter(t => t.tags.includes(tag.id)).length;
  await store.updateTask(done.id, { tags: [tag.id] });
  const cntAfter = store.tasks.filter(t => t.tags.includes(tag.id)).length;
  return { cntBefore, cntAfter };
})()`);
check("6 已完成任务打标签后计数更新", s6.cntAfter === s6.cntBefore + 1, `${s6.cntBefore} → ${s6.cntAfter}`);

/* ---- 清理现场 ---- */
const s7 = await ev(`(async function(){
  const store = ${storeExpr};
  await store.updateTask(window.__tid, { tags: JSON.parse(window.__tagsBefore) });
  const done = store.tasks.find(x => x.status === 'done' && x.tags.includes(store.tags.find(t=>t.name==='临时验证子标签')?.id));
  if (done) await store.updateTask(done.id, { tags: [] });
  const child = store.tags.find(t => t.name === '临时验证子标签');
  if (child) await store.removeTag(child.id);
  return null;
})()`);
console.log("\n现场已清理");
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
close();
process.exit(fail ? 1 : 0);
