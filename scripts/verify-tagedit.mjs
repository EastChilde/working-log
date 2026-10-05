// 标签编辑功能 e2e：改名/换色/改归属/非法操作拦截（全部用临时标签，不碰用户数据）
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? " | " + detail : ""}`);
}

const targets = await fetchTargets();
const main = targets.find((t) => t.title.includes("工作清单") && t.webSocketDebuggerUrl);
if (!main) {
  console.error("找不到主窗口 CDP 目标");
  process.exit(1);
}
const { ev, close } = await cdpConnect(main.webSocketDebuggerUrl);
const storeExpr = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('tasks')";

try {
  // 场景 1：建临时顶级标签 → 改名+换色
  const r1 = await ev(`(async function(){
    const store = ${storeExpr};
    const t = await store.addTag('编辑测试A', 'blue', null);
    if (!t) return { ERR: '建标签失败' };
    const ok = await store.editTag(t.id, { name: '编辑测试B', color: 'pink' });
    return { rename: ok && ok.name === '编辑测试B' && ok.color === 'pink', inStore: store.tags.some(x => x.id === t.id && x.name === '编辑测试B') };
  })()`);
  check("改名+换色生效", !!r1.rename && !!r1.inStore, JSON.stringify(r1));

  // 场景 2：同级重名拦截（用用户已有的顶级标签名试改名）
  const r2 = await ev(`(async function(){
    const store = ${storeExpr};
    const t = store.tags.find(x => x.name === '编辑测试B');
    const other = store.tags.find(x => x.id !== t.id && !x.parent_id);
    if (!other) return { skip: true };
    const bad = await store.editTag(t.id, { name: other.name });
    return { rejected: bad === null, kept: store.tags.find(x => x.id === t.id).name === '编辑测试B' };
  })()`);
  check("同级重名被拦截", r2.skip || (!!r2.rejected && !!r2.kept), JSON.stringify(r2));

  // 场景 3：改归属——把临时标签挂为某个用户顶级标签的子标签，再升级回顶级
  const r3 = await ev(`(async function(){
    const store = ${storeExpr};
    const t = store.tags.find(x => x.name === '编辑测试B');
    const host = store.tags.find(x => x.id !== t.id && !x.parent_id);
    const asChild = await store.editTag(t.id, { parent_id: host.id });
    const midOk = asChild && asChild.parent_id === host.id;
    const back = await store.editTag(t.id, { parent_id: null });
    const backOk = back && back.parent_id === null;
    return { asChild: midOk, backTop: backOk };
  })()`);
  check("改归属（挂子→升顶级）", !!r3.asChild && !!r3.backTop, JSON.stringify(r3));

  // 场景 4：非法归属拦截——挂自己 / 挂到子标签下
  const r4 = await ev(`(async function(){
    const store = ${storeExpr};
    const t = store.tags.find(x => x.name === '编辑测试B');
    const self = await store.editTag(t.id, { parent_id: t.id });
    // 建个子标签，尝试把 t 挂到它的子下（父已是子标签 → 拦截）
    const child = await store.addTag('编辑测试C', 'teal', t.id);
    const toChild = await store.editTag(t.id, { parent_id: child.id });
    return { selfRejected: self === null, toChildRejected: toChild === null };
  })()`);
  check("挂自己/挂到子标签下被拦截", !!r4.selfRejected && !!r4.toChildRejected, JSON.stringify(r4));

  // 场景 5：有子标签的标签不能再当子标签（锁定逻辑在 UI；store 层同样拦截）
  const r5 = await ev(`(async function(){
    const store = ${storeExpr};
    const t = store.tags.find(x => x.name === '编辑测试B'); // 它有子标签 编辑测试C
    const other = store.tags.find(x => x.id !== t.id && !x.parent_id);
    const bad = await store.editTag(t.id, { parent_id: other.id });
    return { rejected: bad === null, stillTop: store.tags.find(x => x.id === t.id).parent_id === null };
  })()`);
  check("父标签不能改挂为子标签", !!r5.rejected && !!r5.stillTop, JSON.stringify(r5));

  // 场景 6：改名同步生效到任务侧引用检查（改名不影响 id，任务引用天然保留）+ DOM 渲染
  const r6 = await ev(`(async function(){
    const store = ${storeExpr};
    const t = store.tags.find(x => x.name === '编辑测试B');
    const dom = document.body.innerText.includes('编辑测试B');
    const final = await store.editTag(t.id, { name: '编辑测试D' });
    return { domShown: dom, renamed: final && final.name === '编辑测试D' };
  })()`);
  check("侧栏 DOM 渲染与再改名", !!r6.domShown && !!r6.renamed, JSON.stringify(r6));
} catch (e) {
  console.error("脚本异常:", e.message || e);
} finally {
  // 清理临时标签
  try {
    await ev(`(async function(){
      const store = ${storeExpr};
      for (const t of store.tags.filter(x => x.name.startsWith('编辑测试'))) await store.removeTag(t.id);
      await store.fetch();
      return store.tags.length;
    })()`);
  } catch (e) {
    console.error("清理失败（手工删除「编辑测试*」即可）:", e.message || e);
  }
  close();
}

const fails = results.filter((r) => !r.ok).length;
console.log(`\n==== ${results.length - fails}/${results.length} 通过 ====`);
process.exit(fails ? 1 : 0);
