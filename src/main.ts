import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "@xterm/xterm/css/xterm.css";
import "./app/styles/global.css";

window.addEventListener("contextmenu", (event) => event.preventDefault(), { capture: true });

createApp(App).use(createPinia()).mount("#app");
