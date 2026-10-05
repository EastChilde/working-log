/**
 * Gitee Release 发布：创建/复用 Release + 上传安装包附件。
 * 用法: node scripts/gitee-release.mjs <tag> <标题> <说明文件> <安装包路径> <资产文件名>
 * token 从环境变量 GITEE_TOKEN 读取。
 */
import { readFileSync } from "node:fs";

const [tag, name, notesFile, assetPath, assetName] = process.argv.slice(2);
const token = process.env.GITEE_TOKEN;
if (!tag || !name || !notesFile || !assetPath || !assetName || !token) {
  console.error("usage: node gitee-release.mjs <tag> <title> <notes-file> <asset> <asset-name>  (env GITEE_TOKEN required)");
  process.exit(1);
}
const REPO = "EastChilde/working-log";
const BASE = `https://gitee.com/api/v5/repos/${REPO}`;

function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}
async function api(method, path, body, timeoutMs = 60000) {
  const to = withTimeout(timeoutMs);
  try {
    const r = await fetch(`${BASE}${path}`, {
      method,
      headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: to.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
    if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`);
    return json;
  } finally { to.done(); }
}

// 1. 查已有 release（Gitee 查无此 tag 返回 200 + body null/[]）
let rel = null;
try {
  const got = await api("GET", `/releases/tags/${encodeURIComponent(tag)}?access_token=${token}`);
  rel = Array.isArray(got) ? got[0] : got;
} catch (e) { console.log("query existing release:", e.message); }

// 2. 创建或复用
const notes = readFileSync(notesFile, "utf8");
if (!rel || !rel.id) {
  rel = await api("POST", `/releases?access_token=${token}`, {
    access_token: token, tag_name: tag, name, body: notes, target_commitish: "main", prerelease: false,
  });
  console.log("release created:", rel.tag_name, "id=", rel.id);
} else {
  console.log("release exists:", rel.tag_name, "id=", rel.id, "—仅更新说明");
  rel = await api("PATCH", `/releases/${rel.id}`, { access_token: token, name, body: notes, tag_name: tag });
}

// 3. 上传附件（端点是 attach_files 下划线；先删同名旧附件）
const assets = rel.assets || [];
for (const a of assets) {
  if (a.name === assetName) {
    const to = withTimeout(60000);
    try {
      const d = await fetch(`${BASE}/releases/${rel.id}/attach_files/${a.id}?access_token=${token}`, { method: "DELETE", signal: to.signal });
      console.log("old asset deleted:", a.id, d.status);
    } finally { to.done(); }
  }
}
const form = new FormData();
form.append("access_token", token);
const buf = readFileSync(assetPath);
form.append("file", new Blob([buf]), assetName);
const up = await api("POST", `/releases/${rel.id}/attach_files`, form, 180000);
console.log("asset uploaded:", assetName, "size=", buf.length);
console.log("GITEE RELEASE DONE:", rel.tag_name, "id=", rel.id);
