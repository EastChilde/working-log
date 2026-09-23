// 验证明暗主题切换：data-theme 属性、body 背景色实际变化、双主题截图
import http from "node:http";
import fs from "node:fs";
const getJson = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(JSON.parse(d))); }).on("error", rej);
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await wait(2000);
  const list = (await getJson("http://127.0.0.1:9223/json")).filter((t) => t.type === "page");
  const main = list.find((t) => (t.url || "").endsWith(":5173/"));
  if (!main) { console.log("MAIN_NOT_FOUND"); process.exit(1); }
  const ws = new WebSocket(main.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  let seq = 0; const pend = new Map();
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pend.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || ""); return r.result?.value; };
  await send("Page.enable");

  // 1. 初始状态（可能是用户上次的选择）
  console.log("init:", await ev('JSON.stringify({theme:document.documentElement.getAttribute("data-theme"),bg:getComputedStyle(document.body).backgroundColor,btn:!!document.querySelector(".theme-btn")})'));

  // 2. 切到深色
  await ev('(async()=>{document.querySelector(".theme-btn").click();await new Promise(r=>setTimeout(r,400));return "ok"})()');
  const dark = JSON.parse(await ev('JSON.stringify({theme:document.documentElement.getAttribute("data-theme"),bg:getComputedStyle(document.body).backgroundColor,panel:getComputedStyle(document.querySelector(".topbar")).backgroundColor,text:getComputedStyle(document.body).color,ls:localStorage.getItem("workinglog-theme")})'));
  console.log("dark:", JSON.stringify(dark));

  // 深色截图
  let shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("screenshots/theme-dark.png", Buffer.from(shot.data, "base64"));

  // 3. 切回浅色
  await ev('(async()=>{document.querySelector(".theme-btn").click();await new Promise(r=>setTimeout(r,400));return "ok"})()');
  const light = JSON.parse(await ev('JSON.stringify({theme:document.documentElement.getAttribute("data-theme"),bg:getComputedStyle(document.body).backgroundColor,ls:localStorage.getItem("workinglog-theme")})'));
  console.log("light:", JSON.stringify(light));

  shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("screenshots/theme-light.png", Buffer.from(shot.data, "base64"));

  // 断言
  const ok = dark.theme === "dark" && light.theme === "light" && dark.bg !== light.bg && dark.ls === "dark";
  console.log(ok ? "VERIFY_PASS ✅" : "VERIFY_FAIL ❌");
  // 恢复浅色为默认演示状态
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
