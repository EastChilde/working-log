// 通过 git credential fill 获取已存的 GitHub 凭据，调用 REST API 创建 Release 并上传安装包
// 用法: node scripts/gh-release.mjs <tag> <标题> <说明文件> <安装包路径> <资产文件名>
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const [tag, title, notesFile, assetPath, assetName] = process.argv.slice(2);
if (!tag || !title || !assetPath || !assetName) {
  console.error("usage: node gh-release.mjs <tag> <title> <notesFile> <assetPath> <assetName>");
  process.exit(1);
}

// 1. 从凭据管理器取 token（不打印明文）
const cred = spawnSync("git", ["credential", "fill"], {
  input: `protocol=https\nhost=github.com\n\n`,
  encoding: "utf8",
});
const tokenLine = (cred.stdout || "").split("\n").find((l) => l.startsWith("password="));
if (!tokenLine) {
  console.error("CRED_FAIL: 未取到 GitHub 凭据");
  process.exit(1);
}
const token = tokenLine.slice("password=".length).trim();
console.log("cred: OK (user=" + ((cred.stdout || "").match(/username=(.*)/) || [])[1] + ")");

const API = "https://api.github.com/repos/EastChilde/working-log";
const UPLOAD = "https://uploads.github.com/repos/EastChilde/working-log";
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "working-log-release",
};

// 2. 创建 Release（tag 不存在则自动创建在 main 上）
const notes = notesFile && fs.existsSync(notesFile) ? fs.readFileSync(notesFile, "utf8") : title;
const createRes = await fetch(`${API}/releases`, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({
    tag_name: tag,
    target_commitish: "main",
    name: title,
    body: notes,
    draft: false,
    prerelease: false,
  }),
});
const created = await createRes.json();
if (!createRes.ok) {
  // 已存在则查找
  if (createRes.status === 422) {
    const list = await (await fetch(`${API}/releases/tags/${tag}`, { headers })).json();
    if (list.id) {
      console.log("release exists, id:", list.id);
      var releaseId = list.id;
    } else {
      console.error("CREATE_FAIL_422:", JSON.stringify(created).slice(0, 300));
      process.exit(1);
    }
  } else {
    console.error("CREATE_FAIL:", createRes.status, JSON.stringify(created).slice(0, 300));
    process.exit(1);
  }
} else {
  console.log("release created:", created.html_url);
  var releaseId = created.id;
}

// 3. 上传安装包（已存在同名资产则先删）
const existList = await (await fetch(`${API}/releases/${releaseId}/assets`, { headers })).json();
for (const a of existList) {
  if (a.name === assetName) {
    await fetch(`${API}/assets/${a.id}`, { method: "DELETE", headers });
    console.log("deleted existing asset:", a.name);
  }
}
const body = fs.readFileSync(assetPath);
const upRes = await fetch(`${UPLOAD}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/octet-stream",
    "Content-Length": body.length,
    "User-Agent": "working-log-release",
  },
  body: body,
});
const up = await upRes.json();
if (upRes.ok) {
  console.log("ASSET_UPLOADED:", up.name, (up.size / 1048576).toFixed(1) + "MB");
  console.log("URL:", up.browser_download_url);
} else {
  console.error("UPLOAD_FAIL:", upRes.status, JSON.stringify(up).slice(0, 300));
  process.exit(1);
}
