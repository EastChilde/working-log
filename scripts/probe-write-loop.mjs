// 快速写循环：页内捕获真实错误信息，定位间歇性异常
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const targets = await fetchTargets();
const main = targets.find((t) => t.title.includes("工作清单") && t.webSocketDebuggerUrl);
const { ev, close } = await cdpConnect(main.webSocketDebuggerUrl);
const storeExpr = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tasks')";

const r = await ev(`(async function(){
  const store = ${storeExpr};
  const log = [];
  for (let i = 0; i < 6; i++) {
    try {
      const t = await store.addTag('压测' + i, 'blue', null);
      if (!t) { log.push(i + ':addTag null'); continue; }
      await store.removeTag(t.id);
      log.push(i + ':ok');
    } catch (e) {
      log.push(i + ':ERR ' + String(e).slice(0, 200));
    }
    await new Promise(r => setTimeout(r, 300));
  }
  return log;
})()`);
console.log(JSON.stringify(r, null, 1));
close();
