import { createApp } from "vue";
import { nextTick } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "@xterm/xterm/css/xterm.css";
import "./app/styles/global.css";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

window.addEventListener("contextmenu", (event) => event.preventDefault(), { capture: true });

async function bootstrap() {
  const app = createApp(App).use(createPinia());

  app.mount("#app");

  await nextTick();
  requestAnimationFrame(() => {
    if (isTauri()) {
      void getCurrentWindow().show();
    }
  });
}

void bootstrap();
