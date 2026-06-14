import { createApp } from "vue";
import { createPinia } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App.vue";
import "@xterm/xterm/css/xterm.css";
import "./app/styles/global.css";

window.addEventListener("contextmenu", (event) => event.preventDefault(), { capture: true });

createApp(App).use(createPinia()).mount("#app");

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const appWindow = getCurrentWindow();
    void appWindow.show();
    void appWindow.setFocus();
  });
});
