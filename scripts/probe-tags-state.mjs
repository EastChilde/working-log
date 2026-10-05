// 查询 store 当前标签与 DB 持久化状态
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const targets = await fetchTargets();
const main = targets.find((t) => t.title.includes("工作清单") && t.webSocketDebuggerUrl);
const { ev, close } = await cdpConnect(main.webSocketDebuggerUrl);
const storeExpr = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tasks')";

const r = await ev(`(async function(){
  const store = ${storeExpr};
  await store.fetch();
  return store.tags.map(t => ({ name: t.name, color: t.color, pid: t.parent_id }));
})()`);
console.log(JSON.stringify(r, null, 1));
close();
