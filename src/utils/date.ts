import dayjs from "dayjs";

export const WEEK_HEAD = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 月历网格：周一开头，返回 6 周（或不足）日期数组，含前后月补位 */
export function monthGrid(year: number, month: number): { key: string; day: number; dim: boolean }[] {
  const first = dayjs(new Date(year, month - 1, 1));
  const lead = (first.day() + 6) % 7;
  const dim = first.daysInMonth();
  const prevDim = first.subtract(1, "month").daysInMonth();
  const cells: { key: string; day: number; dim: boolean }[] = [];
  for (let i = lead; i > 0; i--) {
    const d = first.subtract(i, "day");
    cells.push({ key: d.format("YYYY-MM-DD"), day: d.date(), dim: true });
  }
  for (let d = 1; d <= dim; d++) cells.push({ key: first.date(d).format("YYYY-MM-DD"), day: d, dim: false });
  while (cells.length % 7) {
    const d = first.endOf("month").add(cells.length - dim - lead + 1, "day");
    cells.push({ key: d.format("YYYY-MM-DD"), day: d.date(), dim: true });
  }
  return cells;
}

export function daysBetween(a: string, b: string): number {
  return dayjs(b).diff(dayjs(a), "day");
}

export function fmtCn(key: string): string {
  return dayjs(key).format("M月D日") + " 周" + "日一二三四五六"[dayjs(key).day()];
}

export { dayjs };
