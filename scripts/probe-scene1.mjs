// 逐字复刻 verify 场景 1，但在页内捕获异常返回详细信息
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const targets = await fetchTargets();
const main = targets.find((t) => t.title.includes("工作清单") && t.webSocketDebuggerUrl);
const { ev, close } = await cdpConnect(main.webSocketDebuggerUrl);
const storeExpr = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tasks')";

const r = await ev(`(async function(){
  try {
    const store = ${storeExpr};
    const t = await store.addTag('编辑测试A', 'blue', null);
    if (!t) return { ERR: 'addTag 返回 null', tags: store.tags.map(x=>x.name) };
    const ok = await store.editTag(t.id, { name: '编辑测试B', color: 'pink' });
    return { rename: ok && ok.name === '编辑测试B' && ok.color === 'pink', inStore: store.tags.some(x => x.id === t.id && x.name === '编辑测试B') };
  } catch (e) {
    return { CAUGHT: true, msg: e && e.message, name: e && e.name, stack: (e && e.stack || '').split('\\n').slice(0, 5).join(' | ') };
  }
})()`);
console.log(JSON.stringify(r, null, 1));
close();
