// 通过 GitHub Git Data API 复刻本地提交（代理对 github.com:443 CONNECT 502 时的替代推送方案）
// 用法: node scripts/git-push-via-api.mjs <本地commit SHA> <远程分支，默认 main>
// 原理: blob→tree→commit→update ref。已验证关键点：
//   1. 日期必须带原始时区偏移（如 2026-09-23T10:46:16+08:00），GitHub 会保留偏移；
//      传 ISO Z(+0000) 会导致 commit SHA 与本地不一致
//   2. message 用 git cat-file 提取（空行之后的原始字节），不要用 %B
//      （bash shim 下 %B 输出会被加引号+多一个换行，SHA 必错）
//   3. 重置远端 ref 回退时 PATCH 也要 force:true
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CWD = "D:/projects/todo/working-log";
const sha = process.argv[2];
const branch = process.argv[3] || "main";
if (!sha) { console.error("usage: node git-push-via-api.mjs <sha> [branch]"); process.exit(1); }

const raw = execSync(`git cat-file commit ${sha}`, { cwd: CWD }).toString("utf8");
const headerEnd = raw.indexOf("\n\n");
const header = raw.slice(0, headerEnd);
const message = raw.slice(headerEnd + 2); // 精确保留尾随换行
const getHeader = (k) => header.split("\n").find(l => l.startsWith(k + " "))?.slice(k.length + 1);
const tree = getHeader("tree").trim();
const parents = header.split("\n").filter(l => l.startsWith("parent ")).map(l => l.slice(7).trim());

// "EastChilde <a@b.c> 1790131576 +0800" → {name, email, date:"...+08:00"}
function parseIdent(line) {
  const m = line.match(/^(.*) <([^>]*)> (\d+) ([+-]\d{4})$/);
  if (!m) throw new Error("bad ident line: " + line);
  const [, name, email, epoch, off] = m;
  const d = new Date(Number(epoch) * 1000);
  // 用偏移量手动构造带时区字符串，避免本机时区干扰
  const sign = off[0] === "-" ? -1 : 1;
  const oh = Number(off.slice(1, 3)), om = Number(off.slice(3, 5));
  const local = new Date(d.getTime() + sign * (oh * 60 + om) * 60000);
  const p = (n) => String(n).padStart(2, "0");
  const date = `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}` +
    `T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}${off[0]}${p(oh)}:${p(om)}`;
  return { name, email, date };
}
const author = parseIdent(getHeader("author"));
const committer = parseIdent(getHeader("committer"));

const changed = execSync(`git diff-tree --no-commit-id --name-status -r ${sha}`, { cwd: CWD, encoding: "utf8" })
  .split("\n").filter(Boolean)
  .map(l => { const [st, ...p] = l.split("\t"); return { status: st, path: p.join("\t") }; });

// 取 token（git credential 助手）
const cred = execSync("git credential fill", { cwd: CWD, encoding: "utf8", input: `protocol=https\nhost=github.com\n\n` });
const token = cred.split("\n").find(l => l.startsWith("password="))?.slice(9);
if (!token) { console.error("NO_TOKEN"); process.exit(1); }

const API = "https://api.github.com/repos/EastChilde/working-log";
const H = {
  "Authorization": `Bearer ${token}`,
  "Accept": "application/vnd.github+json",
  "Content-Type": "application/json",
  "User-Agent": "working-log-push",
};
async function api(path, body, method = "POST") {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(API + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    const t = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : {};
  } finally { clearTimeout(timer); }
}

// 1. 为每个变更文件创建 blob（D=删除 sha 传 null）
const treeItems = [];
for (const f of changed) {
  if (f.status === "D") { treeItems.push({ path: f.path, mode: "100644", type: "blob", sha: null }); continue; }
  const content = readFileSync(`${CWD}/${f.path}`).toString("utf8");
  const b = await api("/git/blobs", { content: Buffer.from(content, "utf8").toString("base64"), encoding: "base64" });
  treeItems.push({ path: f.path, mode: "100644", type: "blob", sha: b.sha });
  console.log("blob", f.path, b.sha.slice(0, 8));
}

// 2. 基于父提交的 tree 建新 tree
const baseTree = getHeader("tree") && parents.length ? tree : tree; // base = 父提交 tree
const parentTree = execSync(`git cat-file commit ${parents[0]}`, { cwd: CWD, encoding: "utf8" })
  .split("\n").find(l => l.startsWith("tree ")).slice(5).trim();
const t = await api("/git/trees", { base_tree: parentTree, tree: treeItems });
console.log("tree", t.sha, "match:", t.sha === tree);
if (t.sha !== tree) { console.error("TREE_MISMATCH: 远端内容与本地不一致，中止"); process.exit(1); }

// 3. 复刻 commit（元数据一致 → SHA 必与本地相同）
const c = await api("/git/commits", { message, tree: t.sha, parents, author, committer });
console.log("commit", c.sha, "match:", c.sha === sha);
if (c.sha !== sha) {
  // SHA 仍不一致时把 ref 指回父提交，避免留下分叉
  await api(`/git/refs/heads/${branch}`, { sha: parents[0], force: true }, "PATCH");
  console.error("SHA_MISMATCH: 已回退远端 ref 到", parents[0], "，请检查 message/日期格式");
  process.exit(1);
}

// 4. 更新分支（SHA 相同即 fast-forward）
await api(`/git/refs/heads/${branch}`, { sha: c.sha, force: false }, "PATCH");
console.log("PUSHED", c.sha, "->", branch, "(fast-forward)");
