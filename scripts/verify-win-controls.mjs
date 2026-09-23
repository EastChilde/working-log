// CDP 验证：无边框窗口控制按钮 + 权限链路
const list = await (await fetch('http://127.0.0.1:9223/json')).json();
const page = list.find(t => t.url.includes('5173') && !t.url.includes('sticky.html'));
if (!page) { console.log('MAIN_PAGE_NOT_FOUND'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
function send(method, params) {
  return new Promise((res, rej) => { id++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
}
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
    else p.res(msg);
  }
});
await new Promise(r => ws.addEventListener('open', r, { once: true }));

const expr = `(async () => {
  const out = [];
  const inv = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
  // 1. 按钮渲染
  const btns = document.querySelectorAll('.win-controls .win-btn');
  out.push('buttons=' + btns.length);
  // 2. is_maximized 权限
  try { out.push('isMax=' + await inv('plugin:window|is_maximized', { label: 'main' })); }
  catch (e) { out.push('isMax_FAIL:' + (e.message || e)); }
  // 3. minimize 权限（minimize 后立即还原）
  try { await inv('plugin:window|minimize', { label: 'main' }); await new Promise(r => setTimeout(r, 600)); await inv('plugin:window|unminimize', { label: 'main' }); out.push('minimize+unminimize=OK'); }
  catch (e) { out.push('minimize_FAIL:' + (e.message || e)); }
  // 4. toggle_maximize 权限（最大化后还原）
  try { await inv('plugin:window|toggle_maximize', { label: 'main' }); await new Promise(r => setTimeout(r, 600)); const m1 = await inv('plugin:window|is_maximized', { label: 'main' }); await inv('plugin:window|toggle_maximize', { label: 'main' }); await new Promise(r => setTimeout(r, 400)); const m2 = await inv('plugin:window|is_maximized', { label: 'main' }); out.push('toggleMax OK max=' + m1 + '->' + m2); }
  catch (e) { out.push('toggleMax_FAIL:' + (e.message || e)); }
  // 5. 主题仍正常
  out.push('data-theme=' + document.documentElement.getAttribute('data-theme'));
  return out.join(' | ');
})()`;
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log('RESULT:', r.result?.result?.value ?? JSON.stringify(r.result));
ws.close();
process.exit(0);
