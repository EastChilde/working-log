// 清理所有 测试残留 标签
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const targets = await fetchTargets();
const main = targets.find((t) => t.title.includes("工作清单") && t.webSocketDebuggerUrl);
const { ev, close } = await cdpConnect(main.webSocketDebuggerUrl);
const storeExpr = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tasks')";

const r = await ev(`(async function(){
  const store = ${storeExpr};
  await store.fetch();
  const junk = store.tags.filter(t => t.name.startsWith('探针') || t.name.startsWith('编辑测试'));
  for (const j of junk) await store.removeTag(j.id);
  await store.fetch();
  return { removed: junk.map(t => t.name), final: store.tags.map(t => t.name) };
})()`);
console.log(JSON.stringify(r, null, 1));
close();
