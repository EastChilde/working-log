/** 动画平滑性验证：收起动画期间每 30ms 采样一次窗口 x，确认渐变插值 */
import { fetchTargets, cdpConnect } from "./cdp-helpers.mjs";

const targets = await fetchTargets();
const sticky = targets.find((t) => t.title.includes("便签") && t.webSocketDebuggerUrl);
const { ev, close } = await cdpConnect(sticky.webSocketDebuggerUrl);

const SAMPLE = `(new Promise(async (resolve) => {
  const inv = window.__TAURI_INTERNALS__.invoke;
  const xs = [];
  const t0 = performance.now();
  const iv = setInterval(async () => {
    try {
      const p = await inv("plugin:window|outer_position");
      xs.push(p.x + "@" + Math.round(performance.now() - t0));
    } catch (e) { xs.push("err"); }
    if (performance.now() - t0 > 1100) { clearInterval(iv); resolve(xs); }
  }, 30);
}))`;

// 若当前是收起态，先展开（hover 拉手）
const st0 = await ev(`(function(){return {tab:!!document.querySelector(".mini-tab"),panel:!!document.querySelector(".sticky")}})()`);
if (st0.tab) {
  await ev(`document.querySelector(".mini-tab").dispatchEvent(new MouseEvent("mouseenter"))`);
  await new Promise((r) => setTimeout(r, 900));
}

// 收起（点「—」按钮）并采样
await ev(`document.querySelector(".s-btn").click()`);
const collapseXs = await ev(SAMPLE);
console.log("collapse x:", collapseXs.join("  "));

// 展开并采样
await ev(`(function(){const t=document.querySelector(".mini-tab");if(t)t.dispatchEvent(new MouseEvent("mouseenter"));return 1})()`);
const expandXs = await ev(SAMPLE);
console.log("expand x:", expandXs.join("  "));
close();
