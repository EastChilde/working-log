import { defineStore } from "pinia";
import { repo } from "../db";
import type { Task, TaskNode, TaskStatus } from "../types";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 向所有窗口广播「任务已变更」（仅 Tauri 环境） */
async function broadcast() {
  if (!isTauri) return;
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit("tasks-changed", Date.now());
  } catch {
    /* 忽略广播失败 */
  }
}

interface State {
  tasks: Task[];
  loaded: boolean;
}

export const useTaskStore = defineStore("tasks", {
  state: (): State => ({ tasks: [], loaded: false }),

  getters: {
    /** 已完成任务按完成日期索引：key = completed_at */
    doneByDate(state): Record<string, number> {
      const map: Record<string, number> = {};
      for (const t of state.tasks) {
        if (t.status === "done" && t.completed_at) map[t.completed_at] = (map[t.completed_at] || 0) + 1;
      }
      return map;
    },
    /** 按创建日期分组 */
    byCreatedDate(state): Record<string, Task[]> {
      const map: Record<string, Task[]> = {};
      for (const t of state.tasks) (map[t.created_at] ||= []).push(t);
      return map;
    },
    openTasks(state): Task[] {
      return state.tasks.filter((t) => t.status === "todo" || t.status === "doing");
    },
    doneToday(state): Task[] {
      const k = todayKey();
      return state.tasks.filter((t) => t.status === "done" && t.completed_at === k);
    },
    /** 树形结构（仅顶层+一层子任务，MVP 足够） */
    tree(state): TaskNode[] {
      const nodes = new Map<string, TaskNode>();
      for (const t of state.tasks) nodes.set(t.id, { ...t, children: [] });
      const roots: TaskNode[] = [];
      for (const n of nodes.values()) {
        if (n.parent_id && nodes.has(n.parent_id)) nodes.get(n.parent_id)!.children.push(n);
        else roots.push(n);
      }
      return roots;
    },
  },

  actions: {
    /** 初始化跨窗口同步：监听广播 + 定时轮询兜底（每个窗口调用一次） */
    async initSync() {
      if (this.syncing) return;
      this.syncing = true;
      await this.fetch();
      if (isTauri) {
        try {
          const { listen } = await import("@tauri-apps/api/event");
          listen("tasks-changed", () => {
            // 收到别的窗口的变更广播 → 重载（注意避免循环广播，fetch 不 emit）
            this.fetch();
          });
        } catch {
          /* 监听失败则仅靠轮询 */
        }
        setInterval(() => this.fetch(), 5000);
      }
    },

    async fetch() {
      this.tasks = await repo.list();
      this.loaded = true;
    },

    async add(title: string, dateKey: string, parent: Task | null = null) {
      if (!title.trim()) return;
      const t = await repo.insert({
        title: title.trim(),
        parent_id: parent ? parent.id : null,
        status: "todo",
        priority: null,
        tag: null,
        deadline: null,
        created_at: dateKey,
        completed_at: null,
        sort: this.tasks.length,
      });
      this.tasks.push(t);
      await broadcast();
    },

    async setStatus(id: string, status: TaskStatus) {
      const t = this.tasks.find((x) => x.id === id);
      if (!t) return;
      const patch: Partial<Task> = { status };
      patch.completed_at = status === "done" ? todayKey() : null;
      // 完成父任务时联动完成子任务
      if (status === "done") {
        for (const c of this.tasks.filter((x) => x.parent_id === id && x.status !== "done")) {
          await this.setStatus(c.id, "done");
        }
      }
      await repo.update(id, patch);
      Object.assign(t, patch);
      await broadcast();
    },

    async toggle(id: string) {
      const t = this.tasks.find((x) => x.id === id);
      if (!t) return;
      await this.setStatus(id, t.status === "done" ? "todo" : "done");
    },

    async setDeadline(id: string, deadline: string | null) {
      await repo.update(id, { deadline });
      const t = this.tasks.find((x) => x.id === id);
      if (t) t.deadline = deadline;
      await broadcast();
    },

    async remove(id: string) {
      await repo.removeSoft(id);
      this.tasks = this.tasks.filter((t) => t.id !== id && t.parent_id !== id);
      await broadcast();
    },
  },
});

export { todayKey };
