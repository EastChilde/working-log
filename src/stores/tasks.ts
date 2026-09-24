import { defineStore } from "pinia";
import { repo } from "../db";
import type { Tag, TagColor, Task, TaskNode, TaskStatus } from "../types";

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
  /** 标签定义（全局共用） */
  tags: Tag[];
  /** 侧栏选中的标签筛选：null = 不筛选 */
  activeTag: string | null;
  loaded: boolean;
  /** initSync 防重入标记 */
  syncing: boolean;
  /** 新增/编辑弹窗状态：mode=add 时 date 为归属创建日；mode=edit 时 task 必有 */
  editor: { open: boolean; mode: "add" | "edit"; date: string; task: Task | null };
}

export const useTaskStore = defineStore("tasks", {
  state: (): State => ({ tasks: [], tags: [], activeTag: null, loaded: false, syncing: false, editor: { open: false, mode: "add", date: todayKey(), task: null } }),

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
    /** 标签 id → 标签对象（视图渲染用，未知 id 忽略） */
    tagsById(state): Record<string, Tag> {
      const map: Record<string, Tag> = {};
      for (const t of state.tags) map[t.id] = t;
      return map;
    },
    /** 按侧栏标签筛选后的任务（activeTag 为 null 时即全部） */
    filteredTasks(state): Task[] {
      if (!state.activeTag) return state.tasks;
      return state.tasks.filter((t) => t.tags.includes(state.activeTag!));
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
      this.tags = await repo.listTags();
      // 标签被删后残留的筛选 id 自动清空，避免筛出空列表还不知道原因
      if (this.activeTag && !this.tags.some((t) => t.id === this.activeTag)) this.activeTag = null;
      this.loaded = true;
    },

    async add(title: string, dateKey: string, parent: Task | null = null, priority: Task["priority"] = null, deadline: string | null = null, tags: string[] = []) {
      if (!title.trim()) return;
      const t = await repo.insert({
        title: title.trim(),
        parent_id: parent ? parent.id : null,
        status: "todo",
        priority,
        tags,
        deadline,
        created_at: dateKey,
        completed_at: null,
        sort: this.tasks.length,
      });
      this.tasks.push(t);
      await broadcast();
    },

    /** 编辑任务：标题 / 预计结束日期 / 紧急级别 / 标签 */
    async updateTask(id: string, patch: { title?: string; deadline?: string | null; priority?: Task["priority"]; tags?: string[] }) {
      await repo.update(id, patch);
      const t = this.tasks.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
      await broadcast();
    },

    /* ---------- 新增/编辑弹窗 ---------- */
    openEditor(arg: string | Task): void {
      if (typeof arg === "string") this.editor = { open: true, mode: "add", date: arg, task: null };
      else this.editor = { open: true, mode: "edit", date: arg.created_at, task: arg };
    },
    closeEditor() {
      this.editor = { ...this.editor, open: false };
    },

    /** 设置紧急级别（高/中/低/null 循环或直接指定） */
    async setPriority(id: string, priority: Task["priority"]) {
      await repo.update(id, { priority });
      const t = this.tasks.find((x) => x.id === id);
      if (t) t.priority = priority;
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

    /* ---------- 标签管理 ---------- */
    /** 新建标签：重名返回 null（调用方提示），成功返回新标签 */
    async addTag(name: string, color: TagColor): Promise<Tag | null> {
      const n = name.trim();
      if (!n) return null;
      if (this.tags.some((t) => t.name === n)) return null;
      const tag: Tag = { id: "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: n, color };
      await repo.insertTag(tag);
      this.tags.push(tag);
      await broadcast(); // 让便签窗口同步标签定义
      return tag;
    },

    /** 删除标签定义，并从所有任务上摘除引用 */
    async removeTag(id: string) {
      await repo.deleteTag(id);
      this.tags = this.tags.filter((t) => t.id !== id);
      for (const t of this.tasks.filter((x) => x.tags.includes(id))) {
        const tags = t.tags.filter((x) => x !== id);
        await repo.update(t.id, { tags });
        t.tags = tags;
      }
      if (this.activeTag === id) this.activeTag = null;
      await broadcast();
    },

    /** 设置任务的标签（整体替换） */
    async setTaskTags(id: string, tags: string[]) {
      await repo.update(id, { tags });
      const t = this.tasks.find((x) => x.id === id);
      if (t) t.tags = tags;
      await broadcast();
    },

    /** 侧栏标签筛选：再点取消 */
    toggleTagFilter(id: string) {
      this.activeTag = this.activeTag === id ? null : id;
    },

    async remove(id: string) {
      await repo.removeSoft(id);
      this.tasks = this.tasks.filter((t) => t.id !== id && t.parent_id !== id);
      await broadcast();
    },
  },
});

export { todayKey };
