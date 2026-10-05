// 韧性清理：逐个删除测试残留标签，单个失败重试（应对间歇性 readonly）
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const targets = await fetchTargets();
const main = targets.find((t) => t.title.includes("工作清单") && t.webSocketDebuggerUrl);
const { ev, close } = await cdpConnect(main.webSocketDebuggerUrl);
const storeExpr = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tasks')";

const r = await ev(`(async function(){
  const store = ${storeExpr};
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  await store.fetch();
  for (let round = 0; round < 8; round++) {
    const junk = store.tags.filter(t => t.name.startsWith('压测') || t.name.startsWith('探针') || t.name.startsWith('编辑测试'));
    if (!junk.length) return { done: true, rounds: round, final: store.tags.map(t => t.name) };
    for (const j of junk) {
      try { await store.removeTag(j.id); } catch (e) { /* readonly 突发，下轮再试 */ }
    }
    await sleep(2000);
    await store.fetch().catch(() => {});
  }
  return { done: false, final: store.tags.map(t => t.name) };
})()`);
console.log(JSON.stringify(r, null, 1));
close();
