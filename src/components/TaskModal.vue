<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useTaskStore } from "../stores/tasks";
import { todayKey } from "../stores/tasks";
import type { TagColor, Task } from "../types";
import { TAG_COLORS, TAG_HEX } from "../types";

const store = useTaskStore();
// editor 是被整体替换的对象，必须用 computed 保持响应性
const editor = computed(() => store.editor);

const title = ref("");
const deadline = ref<string | null>(null);
const pri = ref<Task["priority"]>(null);
const tags = ref<string[]>([]);
const inputEl = ref<HTMLInputElement | null>(null);

/* 打开时初始化表单 */
watch(
  () => editor.value.open,
  async (open) => {
    if (!open) return;
    if (editor.value.mode === "edit" && editor.value.task) {
      title.value = editor.value.task.title;
      deadline.value = editor.value.task.deadline;
      pri.value = editor.value.task.priority;
      tags.value = [...editor.value.task.tags];
    } else {
      title.value = "";
      deadline.value = null;
      pri.value = null;
      tags.value = [];
    }
    closeNewTag();
    await nextTick();
    inputEl.value?.focus();
  },
);

async function submit() {
  const v = title.value.trim();
  if (!v) return;
  if (editor.value.mode === "edit" && editor.value.task) {
    await store.updateTask(editor.value.task.id, { title: v, deadline: deadline.value, priority: pri.value, tags: tags.value });
  } else {
    await store.add(v, editor.value.date, null, pri.value, deadline.value, tags.value);
  }
  store.closeEditor();
}

/* 紧急级别胶囊：点已选中的取消 */
function pickPri(v: Task["priority"]) {
  pri.value = pri.value === v ? null : v;
}

/* ---------- 标签选择 / 新建 ---------- */
function toggleTag(id: string) {
  tags.value = tags.value.includes(id) ? tags.value.filter((x) => x !== id) : [...tags.value, id];
}
const newTagOpen = ref(false);
const newTagName = ref("");
const newTagColor = ref<TagColor>("teal");
const newTagErr = ref(false);
const newTagInput = ref<HTMLInputElement | null>(null);
function openNewTag() {
  newTagOpen.value = true;
  newTagName.value = "";
  newTagErr.value = false;
  newTagColor.value = TAG_COLORS[store.tags.length % TAG_COLORS.length]; // 色板顺序轮转，少翻页
  nextTick(() => newTagInput.value?.focus());
}
function closeNewTag() {
  newTagOpen.value = false;
  newTagName.value = "";
  newTagErr.value = false;
}
async function addTag() {
  const name = newTagName.value.trim();
  if (!name) { newTagInput.value?.focus(); return; }
  const t = await store.addTag(name, newTagColor.value);
  if (!t) { newTagErr.value = true; newTagInput.value?.focus(); return; } // 重名
  tags.value = [...tags.value, t.id]; // 新建的标签自动选中
  closeNewTag();
}

/* ---------- 预计结束日期：内嵌月历 ---------- */
const pickerOpen = ref(false);
const pkY = ref(new Date().getFullYear());
const pkM = ref(new Date().getMonth());
const WEEK = ["一", "二", "三", "四", "五", "六", "日"];

interface PkDay { key: string; day: number; dim: boolean; today: boolean; past: boolean }
const pkDays = ref<PkDay[]>([]);
function renderPicker() {
  const first = new Date(pkY.value, pkM.value, 1);
  const lead = (first.getDay() + 6) % 7; // 周一开头
  const days = new Date(pkY.value, pkM.value + 1, 0).getDate();
  const out: PkDay[] = [];
  for (let i = 0; i < lead; i++) out.push({ key: "", day: 0, dim: true, today: false, past: false });
  const tk = todayKey();
  for (let d = 1; d <= days; d++) {
    const key = `${pkY.value}-${String(pkM.value + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const today = key === tk;
    out.push({ key, day: d, dim: false, today, past: !today && new Date(key) < new Date(tk) });
  }
  pkDays.value = out;
}
function shiftPk(n: number) {
  pkM.value += n;
  if (pkM.value < 0) { pkM.value = 11; pkY.value--; }
  if (pkM.value > 11) { pkM.value = 0; pkY.value++; }
  renderPicker();
}
function togglePicker() {
  if (!pickerOpen.value) {
    const base = deadline.value ? new Date(deadline.value + "T00:00:00") : new Date();
    pkY.value = base.getFullYear();
    pkM.value = base.getMonth();
    renderPicker();
  }
  pickerOpen.value = !pickerOpen.value;
}
function setDue(key: string) {
  deadline.value = key;
  pickerOpen.value = false;
}
function quickDue(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  setDue(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
}
function onMaskClick(e: MouseEvent) {
  if ((e.target as HTMLElement).closest(".tm-picker") || (e.target as HTMLElement).closest(".tm-due")) return;
  pickerOpen.value = false;
}

/* Esc：新建标签表单开 → 先收起；否则月历开 → 先关月历；否则关弹窗 */
function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || !editor.value.open) return;
  if (newTagOpen.value) closeNewTag();
  else if (pickerOpen.value) pickerOpen.value = false;
  else store.closeEditor();
}
window.addEventListener("keydown", onKey);
</script>

<template>
  <Teleport to="body">
    <div v-if="editor.open" class="tm-mask" @click="store.closeEditor(); onMaskClick($event)">
      <div class="tm-modal" @click.stop>
        <div class="tm-head">
          <div class="tm-title">
            {{ editor.mode === 'edit' ? '编辑任务' : '新增任务' }}
            <span class="mode-tag">{{ editor.mode === 'edit' ? '编辑模式' : '新建模式' }}</span>
          </div>
          <button class="tm-x" title="关闭 (Esc)" @click="store.closeEditor()">✕</button>
        </div>
        <div class="tm-body">
          <div>
            <label class="f-label">任务内容</label>
            <input
              ref="inputEl"
              v-model="title"
              type="text"
              placeholder="要做什么？一句话说清楚…"
              @keydown.enter="submit"
            />
          </div>
          <div>
            <label class="f-label">预计结束日期（可不填）</label>
            <div class="tm-due" :class="{ picked: !!deadline }">
              <button type="button" class="tm-due-btn" @click="togglePicker">
                <svg width="13" height="13" viewBox="0 0 14 14"><rect x="1.5" y="2.5" width="11" height="10" rx="2" stroke="currentColor" stroke-width="1.2" fill="none"/><path d="M1.5 5.5h11M4.5 1v3M9.5 1v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
                <span>{{ deadline ? deadline.slice(5) + ' 预计结束' : '选择预计结束日期' }}</span>
                <span v-if="deadline" class="due-clear" title="清除" @click.stop="deadline = null">✕</span>
              </button>
              <div v-if="pickerOpen" class="tm-picker">
                <div class="pk-head">
                  <button type="button" @click="shiftPk(-1)">‹</button>
                  <b>{{ pkY }}年{{ pkM + 1 }}月</b>
                  <button type="button" @click="shiftPk(1)">›</button>
                </div>
                <div class="pk-week"><span v-for="w in WEEK" :key="w">{{ w }}</span></div>
                <div class="pk-grid">
                  <button
                    v-for="(d, i) in pkDays"
                    :key="i"
                    type="button"
                    class="pk-day"
                    :class="{ dim: d.dim, today: d.today, sel: d.key === deadline, past: d.past }"
                    :disabled="d.dim"
                    @click="setDue(d.key)"
                  >{{ d.day || '' }}</button>
                </div>
                <div class="pk-foot">
                  <button type="button" class="pk-quick" @click="quickDue(0)">今天</button>
                  <button type="button" class="pk-quick" @click="quickDue(1)">明天</button>
                  <button type="button" class="pk-quick" @click="quickDue(7)">下周</button>
                </div>
              </div>
            </div>
          </div>
          <div>
            <label class="f-label">紧急级别（可不选）</label>
            <div class="pri-caps">
              <button type="button" class="pri-pill hi" :class="{ on: pri === '高' }" @click="pickPri('高')"><span class="pd"></span>高 · 紧急</button>
              <button type="button" class="pri-pill mid" :class="{ on: pri === '中' }" @click="pickPri('中')"><span class="pd"></span>中 · 一般</button>
              <button type="button" class="pri-pill low" :class="{ on: pri === '低' }" @click="pickPri('低')"><span class="pd"></span>低 · 不急</button>
            </div>
          </div>
          <div>
            <label class="f-label">标签（可多选）</label>
            <div class="tag-sel">
              <button
                v-for="t in store.tags"
                :key="t.id"
                type="button"
                class="tag-opt"
                :class="[tags.includes(t.id) ? 'on tg-' + t.color : 'off']"
                @click="toggleTag(t.id)"
              >
                <i class="td" :style="{ background: TAG_HEX[t.color] }"></i>{{ t.name }}
              </button>
              <button v-if="!newTagOpen" type="button" class="tag-new-btn" @click="openNewTag">＋ 新建标签</button>
            </div>
            <div v-if="newTagOpen" class="tag-new" style="border-top:none;padding-top:2px;margin-top:8px;">
              <div class="tag-new-form">
                <input
                  ref="newTagInput"
                  v-model="newTagName"
                  type="text"
                  placeholder="标签名称，如：项目A"
                  maxlength="8"
                  :class="{ err: newTagErr }"
                  @keydown.enter.prevent="addTag"
                />
                <div class="color-dots">
                  <button
                    v-for="c in TAG_COLORS"
                    :key="c"
                    type="button"
                    class="cdot"
                    :class="{ sel: newTagColor === c }"
                    :style="{ background: TAG_HEX[c] }"
                    :title="c"
                    @click="newTagColor = c"
                  ></button>
                </div>
                <button type="button" class="tag-add-ok" @click="addTag">添加</button>
              </div>
            </div>
            <div class="tm-hint" style="text-align:left;padding:6px 0 0;">
              {{ newTagErr ? '已有同名标签，换一个名字' : '标签全局共用，新建一次所有任务都能用 · Enter 快速添加' }}
            </div>
          </div>
        </div>
        <div class="tm-foot">
          <button v-if="editor.mode === 'edit' && editor.task" class="tm-del" @click="store.remove(editor.task.id); store.closeEditor()">🗑 删除任务</button>
          <div class="spacer"></div>
          <button class="btn-cancel" @click="store.closeEditor()">取消</button>
          <button class="btn-ok" @click="submit">{{ editor.mode === 'edit' ? '保存修改' : '创建任务' }}</button>
        </div>
        <div class="tm-hint"><kbd>Enter</kbd> 确认 · <kbd>Esc</kbd> 取消 · 点任务条或 ✎ 可随时编辑</div>
      </div>
    </div>
  </Teleport>
</template>
