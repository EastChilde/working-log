// CDP 验证 window.set_theme 权限链路
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
  try {
    await window.__TAURI_INTERNALS__.invoke('plugin:window|set_theme', { label: 'main', theme: 'dark' });
    const t = document.documentElement.getAttribute('data-theme');
    return 'SET_THEME_OK data-theme=' + t;
  } catch (e) { return 'SET_THEME_FAIL: ' + (e && e.message || e); }
})()`;
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log('RESULT:', r.result?.result?.value ?? JSON.stringify(r.result));
ws.close();
process.exit(0);
