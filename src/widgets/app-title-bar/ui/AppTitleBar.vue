<script setup lang="ts">
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Info, Maximize2, Minus, Moon, Plus, Settings, Square, Sun, X } from "@lucide/vue";
import type { AppTheme } from "../../../entities/settings/model/types";

const appWindow = getCurrentWindow();

const emit = defineEmits<{
  about: [];
  "create-connection": [];
  settings: [];
  "toggle-theme": [];
}>();

defineProps<{
  theme: AppTheme;
}>();

function minimize(event?: MouseEvent) {
  event?.stopPropagation();
  void appWindow.minimize();
}

function toggleMaximize(event?: MouseEvent) {
  event?.stopPropagation();
  void appWindow.toggleMaximize();
}

function closeWindow(event?: MouseEvent) {
  event?.stopPropagation();
  void appWindow.close();
}

function startDrag(event: MouseEvent) {
  const target = event.target instanceof HTMLElement ? event.target : undefined;

  if (event.button !== 0 || event.detail > 1 || target?.closest("[data-titlebar-control='true']")) {
    return;
  }

  void appWindow.startDragging();
}

function handleDoubleClick(event: MouseEvent) {
  const target = event.target instanceof HTMLElement ? event.target : undefined;

  if (event.button !== 0 || target?.closest("[data-titlebar-control='true']")) {
    return;
  }

  toggleMaximize(event);
}
</script>

<template>
  <header class="titlebar" @dblclick="handleDoubleClick" @mousedown="startDrag">
    <div class="titlebar__left">
      <div class="brand">
        <div class="brand__mark" aria-hidden="true">LS</div>
        <span>LucidShell</span>
      </div>
      <button
        class="primary-action"
        data-titlebar-control="true"
        title="新增连接"
        type="button"
        @click="emit('create-connection')"
      >
        <Plus :size="15" />
        <span>新增连接</span>
      </button>
    </div>

    <div class="titlebar__actions" data-titlebar-control="true" @dblclick.stop @mousedown.stop>
      <button
        class="icon-button"
        data-titlebar-control="true"
        :title="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
        type="button"
        @click="emit('toggle-theme')"
      >
        <Sun v-if="theme === 'dark'" :size="17" />
        <Moon v-else :size="17" />
      </button>
      <button class="icon-button" data-titlebar-control="true" title="关于 LucidShell" type="button" @click="emit('about')">
        <Info :size="17" />
      </button>
      <button class="icon-button" data-titlebar-control="true" title="设置" type="button" @click="emit('settings')">
        <Settings :size="17" />
      </button>
      <button class="window-button" data-titlebar-control="true" title="最小化" type="button" @click="minimize">
        <Minus :size="17" />
      </button>
      <button class="window-button" data-titlebar-control="true" title="最大化/还原" type="button" @click="toggleMaximize">
        <Square :size="13" />
        <Maximize2 class="window-button__ghost" :size="15" />
      </button>
      <button class="window-button window-button--danger" data-titlebar-control="true" title="关闭" type="button" @click="closeWindow">
        <X :size="17" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding-left: 14px;
  background: var(--surface-3);
  user-select: none;
}

.titlebar__left {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-strong);
  font-size: 13px;
  font-weight: 650;
}

.brand__mark {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border: 1px solid var(--accent-soft-hover);
  border-radius: 6px;
  color: var(--accent);
  background: var(--accent-soft);
  font-size: 10px;
  letter-spacing: 0;
}

.primary-action {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--accent-soft-hover);
  border-radius: 6px;
  padding: 0 10px;
  color: var(--accent);
  background: var(--accent-soft);
  cursor: pointer;
  font-size: 12px;
  font-weight: 620;
}

.primary-action:hover {
  color: var(--text-strong);
  background: var(--accent-soft-hover);
}

.titlebar__actions {
  display: flex;
  align-items: center;
  height: 100%;
}

.icon-button,
.window-button {
  display: grid;
  width: 42px;
  height: 100%;
  place-items: center;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

.icon-button {
  width: 36px;
  height: 30px;
  border-radius: 6px;
}

.icon-button:hover,
.window-button:hover {
  color: var(--text-strong);
  background: var(--surface-hover);
}

.window-button--danger:hover {
  color: #ffffff;
  background: var(--danger-hover);
}

.window-button__ghost {
  display: none;
}
</style>
