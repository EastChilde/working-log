// 便签贴边诊断 v2
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const targets = await fetchTargets();
const sticky = targets.find((t) => (t.title.includes("便签") || t.url.includes("sticky")) && t.webSocketDebuggerUrl);
if (!sticky) {
  console.error("targets:", targets.map((t) => t.title + " | " + t.url));
  process.exit(1);
}
const { ev, close } = await cdpConnect(sticky.webSocketDebuggerUrl);

const r1 = await ev(`(function(){
  try {
    const el = document.querySelector('.sticky') || document.querySelector('.mini-tab');
    const comp = el && el.__vueParentComponent;
    const s = comp && comp.setupState;
    if (!s) return { ERR: 'no setupState', hasSticky: !!document.querySelector('.sticky'), hasTab: !!document.querySelector('.mini-tab') };
    return {
      minimized: s.minimized, tabVisible: s.tabVisible, dockEdge: s.dockEdge,
      autoPeek: s.autoPeek, savedGeom: s.savedGeom,
      hasDockTo: typeof s.dockTo, hasSnapToEdge: typeof s.snapToEdge, hasMinimize: typeof s.minimizeToEdge,
    };
  } catch (e) { return { ERR: String(e) }; }
})()`);
console.log("内部状态:", JSON.stringify(r1));

const r2 = await ev(`(async function(){
  try {
    const I = window.__TAURI_INTERNALS__;
    const pos = await I.invoke('plugin:window|outer_position');
    const size = await I.invoke('plugin:window|inner_size');
    const mon = await I.invoke('plugin:window|current_monitor');
    return { pos, size: { w: size.width, h: size.height }, mon: { w: mon.size.width, h: mon.size.height, scale: mon.scaleFactor } };
  } catch (e) { return { ERR: String(e) }; }
})()`);
console.log("几何:", JSON.stringify(r2));

// 3. 直接调用内部 minimizeToEdge 测试停靠机制是否工作
const r3 = await ev(`(async function(){
  try {
    const el = document.querySelector('.sticky') || document.querySelector('.mini-tab');
    const s = el.__vueParentComponent.setupState;
    await s.minimizeToEdge();
    await new Promise(r => setTimeout(r, 600));
    const pos = await window.__TAURI_INTERNALS__.invoke('plugin:window|outer_position');
    return { afterDock: pos, minimized: s.minimized, tabVisible: s.tabVisible };
  } catch (e) { return { ERR: String(e) }; }
})()`);
console.log("停靠测试:", JSON.stringify(r3));

close();
