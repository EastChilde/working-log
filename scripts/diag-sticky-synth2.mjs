// 正确打桩（处理 getter-only 属性）+ 合成 mousedown 重测
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const targets = await fetchTargets();
const sticky = targets.find((t) => (t.title.includes("便签") || t.url.includes("sticky")) && t.webSocketDebuggerUrl);
const { ev, close } = await cdpConnect(sticky.webSocketDebuggerUrl);

const r0 = await ev(`(function(){
  try {
    const I = window.__TAURI_INTERNALS__;
    const desc = Object.getOwnPropertyDescriptor(I, 'invoke');
    const info = { hasDesc: !!desc, writable: desc ? !!desc.writable : null, configurable: desc ? !!desc.configurable : null, isAccessor: desc ? !!desc.get : null };
    window.__calls = [];
    const realInvoke = desc && desc.get ? desc.get.call(I) : I.invoke;
    const wrapper = function(cmd, ...a) {
      window.__calls.push(String(cmd));
      if (cmd === 'plugin:window|start_dragging') return Promise.resolve(null);
      return realInvoke.apply(I, [cmd, ...a]);
    };
    if (desc && desc.configurable) {
      Object.defineProperty(I, 'invoke', { get() { return wrapper; }, set(v) { /* 忽略外部覆盖 */ }, configurable: true });
      info.patched = 'defineProperty';
    } else {
      I.invoke = wrapper;
      info.patched = 'plain-assign';
    }
    info.verify = I.invoke('plugin:window|outer_position') instanceof Promise;
    return info;
  } catch(e) { return { ERR: String(e) }; }
})()`);
console.log("打桩信息:", JSON.stringify(r0));

// 等待 verify 调用落账
await new Promise((r) => setTimeout(r, 300));
const rv = await ev(`window.__calls.join(',')`);
console.log("打桩验证(应含 outer_position):", JSON.stringify(rv));

// 合成 mousedown
await ev(`(function(){
  window.__calls.length = 0;
  const head = document.querySelector('.s-head');
  head.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 150, clientY: 16 }));
  return 'ok';
})()`);
await new Promise((r) => setTimeout(r, 800));
const r2 = await ev(`window.__calls.join(',')`);
console.log("合成 mousedown 后调用(应含 outer_position/start_dragging):", JSON.stringify(r2));

close();
