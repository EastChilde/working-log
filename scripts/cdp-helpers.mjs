/** CDP 公共助手：抓目标列表 + 建立 WebSocket eval 连接 */
export async function fetchTargets() {
  return (await (await fetch("http://127.0.0.1:9223/json")).json());
}

export async function cdpConnect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const cbs = {};
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && cbs[m.id]) {
      const r = m.result?.exceptionDetails
        ? { err: m.result.exceptionDetails.exception?.description || "exception" }
        : m.result?.result?.value;
      cbs[m.id](r);
      delete cbs[m.id];
    }
  };
  await new Promise((r) => (ws.onopen = r));
  return {
    ev(expr) {
      id++;
      return new Promise((res) => {
        cbs[id] = res;
        ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } }));
      });
    },
    close: () => ws.close(),
  };
}
