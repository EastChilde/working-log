import { createApp } from "vue";
import { createPinia } from "pinia";
import StickyView from "./components/StickyView.vue";

window.addEventListener("error", (e) => {
  document.title = "ERR: " + e.message;
});
window.addEventListener("unhandledrejection", (e: any) => {
  document.title = "REJ: " + (e.reason?.message || String(e.reason));
});

createApp(StickyView).use(createPinia()).mount("#app");
