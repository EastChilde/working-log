export type TaskStatus = "todo" | "doing" | "done" | "cancelled";

export interface Task {
  id: string;
  title: string;
  parent_id: string | null;
  status: TaskStatus;
  priority: "高" | "中" | "低" | null;
  tag: string | null;
  deadline: string | null;   // YYYY-MM-DD，可选
  created_at: string;        // YYYY-MM-DD
  completed_at: string | null; // YYYY-MM-DD
  sort: number;
}

export interface TaskNode extends Task {
  children: TaskNode[];
}
