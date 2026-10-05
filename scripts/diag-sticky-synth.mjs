// 合成 mousedown 测试：打桩 start_dragging 后验证 onHeadDown 处理链
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const targets = await fetchTargets();
const sticky = targets.find((t) => (t.title.includes("便签") || t.url.includes("sticky")) && t.webSocketDebuggerUrl);
const { ev, close } = await cdpConnect(sticky.webSocketDebuggerUrl);

// 1. 打桩：记录调用 + 拦截 start_dragging（返回已解决 Promise，不进入 OS 拖拽循环）
const r0 = await ev(`(function(){
  try {
    const I = window.__TAURI_INTERNALS__;
    window.__calls = [];
    const orig = I.invoke.bind(I);
    I.invoke = function(cmd, ...a) {
      window.__calls.push(cmd);
      if (cmd === 'plugin:window|start_dragging') return Promise.resolve(null);
      return orig(cmd, ...a);
    };
    const el = document.elementFromPoint(150, 16);
    return { patched: true, hitEl: el ? el.tagName + '.' + el.className : 'null' };
  } catch(e) { return String(e); }
})()`);
console.log("打桩+命中元素:", JSON.stringify(r0));

// 2. 合成 mousedown 在标题栏上
const r1 = await ev(`(function(){
  const head = document.querySelector('.s-head');
  if (!head) return { ERR: 'no head' };
  head.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 150, clientY: 16 }));
  return 'dispatched';
})()`);
console.log("合成 mousedown:", JSON.stringify(r1));

// 3. 等待异步链完成后读取调用记录
await new Promise((r) => setTimeout(r, 800));
const r2 = await ev(`(function(){
  return { calls: window.__calls, hasHead: !!document.querySelector('.s-head') };
})()`);
console.log("调用记录:", JSON.stringify(r2));

close();
