export type TaskStatus = "todo" | "doing" | "done" | "cancelled";

/** 标签颜色（8 色板减灰，共 7 色；色值与 styles.css 的 tg-* 类一一对应） */
export type TagColor = "blue" | "purple" | "green" | "orange" | "red" | "teal" | "pink";

export interface Tag {
  id: string;
  name: string;
  color: TagColor;
}

/** 标签色板：顺序即新建标签时色点顺序；hex 与 styles.css 中 tg-* 保持一致 */
export const TAG_COLORS: TagColor[] = ["blue", "purple", "green", "orange", "red", "teal", "pink"];
export const TAG_HEX: Record<TagColor, string> = {
  blue: "#4f7cff",
  purple: "#8b5cf6",
  green: "#34b96f",
  orange: "#f0a52e",
  red: "#e5484d",
  teal: "#14b8a6",
  pink: "#ec4899",
};

export interface Task {
  id: string;
  title: string;
  parent_id: string | null;
  status: TaskStatus;
  priority: "高" | "中" | "低" | null;
  /** 标签 id 列表（DB 中存 JSON 字符串） */
  tags: string[];
  deadline: string | null;   // YYYY-MM-DD，可选
  created_at: string;        // YYYY-MM-DD
  completed_at: string | null; // YYYY-MM-DD
  sort: number;
}

export interface TaskNode extends Task {
  children: TaskNode[];
}
