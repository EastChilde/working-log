import { getCurrentWindow } from "@tauri-apps/api/window";
import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles.css";

// 防闪烁：挂载前同步应用已保存的主题
const savedTheme = localStorage.getItem("workinglog-theme");
if (savedTheme === "dark" || savedTheme === "light") {
  document.documentElement.setAttribute("data-theme", savedTheme);
  // 同步原生窗口主题（Windows 标题栏深浅色跟随），仅主窗口，便签不在此入口
  try {
    void getCurrentWindow().setTheme(savedTheme);
  } catch {
    /* 非 Tauri 环境忽略 */
  }
}

// 诊断：把未捕获错误写入窗口标题，便于从 tasklist /V 观察
window.addEventListener("error", (e) => {
  document.title = "ERR: " + e.message;
});
window.addEventListener("unhandledrejection", (e: any) => {
  document.title = "REJ: " + (e.reason?.message || String(e.reason));
});

createApp(App).use(createPinia()).mount("#app");
