// 数据访问层：Tauri 环境走 SQLite（tauri-plugin-sql），纯浏览器开发时降级 localStorage
import type { Tag, Task } from "./types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const MIGRATIONS = [
  {
    version: 1,
    description: "init schema",
    sql: `
      CREATE TABLE IF NOT EXISTS task (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        parent_id TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT,
        tag TEXT,
        deadline TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        sort INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_task_created ON task(created_at);
      CREATE INDEX IF NOT EXISTS idx_task_parent ON task(parent_id);
      CREATE TABLE IF NOT EXISTS recycle (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        deleted_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS setting (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `,
  },
  {
    version: 2,
    description: "tags: tag_def 表 + task.tags JSON 列（旧 task.tag 单文本列废弃保留）",
    sql: `
      CREATE TABLE IF NOT EXISTS tag_def (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT 'blue',
        sort INTEGER NOT NULL DEFAULT 0
      );
      ALTER TABLE task ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
    `,
  },
];

function uuid(): string {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------------- Tauri SQLite 实现 ---------------- */
// 迁移已在 Rust 侧通过 add_migrations 注册（见 src-tauri/src/lib.rs）
let dbPromise: Promise<any> | null = null;
async function getDb(): Promise<any> {
  if (!dbPromise) {
    const mod = await import("@tauri-apps/plugin-sql");
    const Database = (mod as any).default ?? mod;
    dbPromise = Database.load("sqlite:workinglog.db");
  }
  return dbPromise;
}

/* ---------------- 浏览器降级实现（localStorage） ---------------- */
const LS_KEY = "workinglog.tasks";
const LS_TAGS = "workinglog.tags";
function localLoad(): Task[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
}
function localSave(list: Task[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}
function localLoadTags(): Tag[] {
  try { return JSON.parse(localStorage.getItem(LS_TAGS) || "[]"); } catch { return []; }
}
function localSaveTags(list: Tag[]) {
  localStorage.setItem(LS_TAGS, JSON.stringify(list));
}

/** task.tags 列：DB 存 JSON 字符串，读出时安全解析为数组 */
function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
  }
  return [];
}

/* ---------------- 仓储接口 ---------------- */
export const repo = {
  async list(): Promise<Task[]> {
    if (isTauri) {
      const db = await getDb();
      const rows: any[] = await db.select("SELECT * FROM task ORDER BY created_at ASC, sort ASC");
      return rows.map((r) => ({ ...r, tags: parseTags(r.tags) }));
    }
    return localLoad().map((t) => ({ ...t, tags: parseTags(t.tags) }));
  },

  async insert(t: Omit<Task, "id">): Promise<Task> {
    const task: Task = { ...t, id: uuid() };
    if (isTauri) {
      const db = await getDb();
      await db.execute(
        `INSERT INTO task (id,title,parent_id,status,priority,tag,tags,deadline,created_at,completed_at,sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [task.id, task.title, task.parent_id, task.status, task.priority, null, JSON.stringify(task.tags), task.deadline, task.created_at, task.completed_at, task.sort],
      );
    } else {
      localSave([...localLoad(), task]);
    }
    return task;
  },

  async update(id: string, patch: Partial<Task>): Promise<void> {
    const fields = Object.keys(patch).filter((k) => k !== "id");
    if (!fields.length) return;
    if (isTauri) {
      const db = await getDb();
      const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
      // tags 数组在 DB 中存 JSON 字符串，其余字段原样
      const vals = fields.map((f) => (f === "tags" ? JSON.stringify((patch as any).tags ?? []) : (patch as any)[f]));
      await db.execute(`UPDATE task SET ${sets} WHERE id = $1`, [id, ...vals]);
    } else {
      localSave(localLoad().map((t) => (t.id === id ? { ...t, ...patch } : t)));
    }
  },

  /** 软删除：任务移入 recycle，子任务一并删除 */
  async removeSoft(id: string): Promise<void> {
    if (isTauri) {
      const db = await getDb();
      const rows: any[] = await db.select("SELECT * FROM task WHERE id = $1 OR parent_id = $2", [id, id]);
      const now = new Date().toISOString();
      for (const r of rows) {
        await db.execute("INSERT INTO recycle (id,payload,deleted_at) VALUES ($1,$2,$3)", [r.id, JSON.stringify(r), now]);
        await db.execute("DELETE FROM task WHERE id = $1", [r.id]);
      }
    } else {
      const list = localLoad();
      localSave(list.filter((t) => t.id !== id && t.parent_id !== id));
    }
  },

  /* ---------------- 标签定义（tag_def） ---------------- */
  async listTags(): Promise<Tag[]> {
    if (isTauri) {
      const db = await getDb();
      return (await db.select("SELECT * FROM tag_def ORDER BY sort ASC, name ASC")) as Tag[];
    }
    return localLoadTags();
  },

  async insertTag(t: Tag): Promise<void> {
    if (isTauri) {
      const db = await getDb();
      await db.execute("INSERT INTO tag_def (id,name,color,sort) VALUES ($1,$2,$3,$4)", [t.id, t.name, t.color, Date.now()]);
    } else {
      localSaveTags([...localLoadTags(), t]);
    }
  },

  /** 删除标签定义；任务上的引用由调用方（store）负责摘除 */
  async deleteTag(id: string): Promise<void> {
    if (isTauri) {
      const db = await getDb();
      await db.execute("DELETE FROM tag_def WHERE id = $1", [id]);
    } else {
      localSaveTags(localLoadTags().filter((t) => t.id !== id));
    }
  },
};
