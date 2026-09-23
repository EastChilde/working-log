// 替换 GitHub Release v0.1.0 资产：带超时与重试
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const cred = spawnSync("git", ["credential", "fill"], {
  input: "protocol=https\nhost=github.com\n\n",
  encoding: "utf8",
  timeout: 15000,
});
const token = (cred.stdout || "").split("\n").find((l) => l.startsWith("password="))?.slice(9).trim();
if (!token) { console.error("CRED_FAIL"); process.exit(1); }
console.log("cred OK");

const API = "https://api.github.com/repos/EastChilde/working-log";
const UPLOAD = "https://uploads.github.com/repos/EastChilde/working-log";
const NAME = "working-log_0.1.0_x64-setup.exe";
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "working-log-release",
};

function fetchT(url, opts = {}, ms = 60000) {
  return Promise.race([
    fetch(url, opts),
    new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT " + ms / 1000 + "s")), ms)),
  ]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const body = fs.readFileSync("D:/projects/todo/rls-target/release/bundle/nsis/工作清单助手_0.1.0_x64-setup.exe");

for (let i = 1; i <= 6; i++) {
  try {
    // 删同名旧资产
    const assets = await (await fetchT(`${API}/releases/394200660/assets`, { headers })).json();
    for (const a of assets) {
      if (a.name === NAME) {
        await fetchT(`${API}/releases/assets/${a.id}`, { method: "DELETE", headers });
        console.log(`#${i} deleted old asset`);
        await sleep(10000);
      }
    }
    // 上传
    const up = await fetchT(
      `${UPLOAD}/releases/394200660/assets?name=${NAME}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "Content-Length": body.length, "User-Agent": "working-log-release" },
        body,
      },
      180000,
    );
    const j = await up.json();
    if (up.ok) {
      console.log("UPLOAD_OK:", j.name, (j.size / 1048576).toFixed(1) + "MB");
      process.exit(0);
    }
    console.log(`#${i} upload ${up.status}:`, JSON.stringify(j).slice(0, 150));
  } catch (e) {
    console.log(`#${i} err:`, e.message);
  }
  await sleep(20000);
}
console.error("ALL_FAILED");
process.exit(1);
