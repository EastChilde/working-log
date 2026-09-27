/** 侧栏单选互斥验证：全部/今日/滞留/标签/回顾 五类选中必须互斥 */
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const targets = await fetchTargets();
const main = targets.find((t) => t.title.includes("工作清单") && t.webSocketDebuggerUrl);
const { ev, close } = await cdpConnect(main.webSocketDebuggerUrl);

// 当前选中态快照：哪个侧栏项亮着 + 在哪个页面
const snap = `(function(){
  const on=[...document.querySelectorAll('.side-item.on, .side-tag.on')].map(x=>x.textContent.trim().replace(/\\d+$/,'').slice(0,10));
  const views=[...document.querySelectorAll('.view')];
  const vi=views.findIndex(v=>v.className.includes('on'));
  return {on, view:['cal','list','hist'][vi]};
})()`;

const click = (kw) => `[...document.querySelectorAll('.side-item, .side-tag')].find(b=>b.textContent.includes('${kw}')).click()`;

const step = async (name, action) => {
  const err = await ev(`(function(){try{${action};return null}catch(e){return e.message}})()`);
  if (err) return console.log(name, "ERROR:", err);
  await ev(`new Promise(r=>setTimeout(r,350))`);
  console.log(name, JSON.stringify(await ev(snap)));
};

await step("0 初始态", "0");
await step("1 点今日待办 → 只亮今日待办+清单页", click("今日待办"));
await step("2 点标签 → 只亮该标签", click("工作"));
await step("3 点滞留任务 → 只亮滞留", click("滞留任务"));
await step("4 点年度统计 → 只亮回顾", click("年度统计"));
await step("5 回顾页点今日待办 → 切出并只亮今日待办", click("今日待办"));
await step("6 点标签 → 只亮标签", click("工作"));
await step("7 再点同标签取消 → 回到全部任务", click("工作"));
await step("8 点全部任务 → 只亮全部任务", click("全部任务"));
close();
