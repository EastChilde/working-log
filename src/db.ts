// 数据访问层：Tauri 环境走 SQLite（tauri-plugin-sql），纯浏览器开发时降级 localStorage
import type { Task } from "./types";

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
function localLoad(): Task[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
}
function localSave(list: Task[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}

/* ---------------- 仓储接口 ---------------- */
export const repo = {
  async list(): Promise<Task[]> {
    if (isTauri) {
      const db = await getDb();
      return db.select<Task[]>("SELECT * FROM task ORDER BY created_at ASC, sort ASC");
    }
    return localLoad();
  },

  async insert(t: Omit<Task, "id">): Promise<Task> {
    const task: Task = { ...t, id: uuid() };
    if (isTauri) {
      const db = await getDb();
      await db.execute(
        `INSERT INTO task (id,title,parent_id,status,priority,tag,deadline,created_at,completed_at,sort)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [task.id, task.title, task.parent_id, task.status, task.priority, task.tag, task.deadline, task.created_at, task.completed_at, task.sort],
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
      const vals = fields.map((f) => (patch as any)[f]);
      await db.execute(`UPDATE task SET ${sets} WHERE id = $1`, [id, ...vals]);
    } else {
      localSave(localLoad().map((t) => (t.id === id ? { ...t, ...patch } : t)));
    }
  },

  /** 软删除：任务移入 recycle，子任务一并删除 */
  async removeSoft(id: string): Promise<void> {
    if (isTauri) {
      const db = await getDb();
      const rows = await db.select<Task[]>("SELECT * FROM task WHERE id = $1 OR parent_id = $2", [id, id]);
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
};
