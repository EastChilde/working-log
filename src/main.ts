import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles.css";

// 诊断：把未捕获错误写入窗口标题，便于从 tasklist /V 观察
window.addEventListener("error", (e) => {
  document.title = "ERR: " + e.message;
});
window.addEventListener("unhandledrejection", (e: any) => {
  document.title = "REJ: " + (e.reason?.message || String(e.reason));
});

createApp(App).use(createPinia()).mount("#app");
