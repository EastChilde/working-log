// 探针：直接调用 editTag 并返回完整错误堆栈
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const targets = await fetchTargets();
const main = targets.find((t) => t.title.includes("工作清单") && t.webSocketDebuggerUrl);
const { ev, close } = await cdpConnect(main.webSocketDebuggerUrl);
const storeExpr = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tasks')";

const r = await ev(`(async function(){
  const store = ${storeExpr};
  await store.fetch();
  try {
    const t = await store.addTag('探针标签', 'blue', null);
    if (!t) return { stage: 'addTag 返回 null', tags: store.tags.map(x=>x.name) };
    try {
      const ok = await store.editTag(t.id, { name: '探针标签2' });
      return { stage: 'editTag 完成', ok: !!ok };
    } catch (e2) {
      return { stage: 'editTag 异常', msg: e2.message, stack: (e2.stack||'').split('\\n').slice(0,4).join(' | ') };
    }
  } catch (e) {
    return { stage: 'addTag 异常', msg: e.message, stack: (e.stack||'').split('\\n').slice(0,4).join(' | ') };
  }
})()`);
console.log(JSON.stringify(r, null, 1));
close();
