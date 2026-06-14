<script setup lang="ts">
import { DiagnosticsPanel } from "../../diagnostics-panel";

defineProps<{
  followTerminalCwdByDefault: boolean;
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "update-follow-terminal-cwd-by-default": [value: boolean];
}>();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="settings-layer" @click="emit('close')" @contextmenu.prevent="emit('close')">
      <section class="settings-dialog" role="dialog" aria-modal="true" aria-label="应用设置" @click.stop>
        <header class="settings-dialog__header">
          <h2>设置</h2>
          <button type="button" @click="emit('close')">关闭</button>
        </header>

        <div class="settings-section">
          <h3>SFTP</h3>
          <label class="settings-row">
            <span>
              <strong>默认跟随终端目录</strong>
              <small>新建 Terminal Tab 时自动开启 SFTP 跟随当前 shell 目录。</small>
            </span>
            <input
              :checked="followTerminalCwdByDefault"
              type="checkbox"
              @change="emit('update-follow-terminal-cwd-by-default', ($event.target as HTMLInputElement).checked)"
            >
          </label>
        </div>

        <div class="settings-section">
          <DiagnosticsPanel />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.settings-layer {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: var(--overlay-bg);
}

.settings-dialog {
  display: grid;
  width: min(640px, calc(100vw - 32px));
  max-height: min(720px, calc(100vh - 36px));
  border: 1px solid var(--field-border);
  border-radius: 8px;
  background: var(--surface-4);
  box-shadow: var(--shadow-strong);
  overflow: hidden;
}

.settings-dialog__header {
  display: flex;
  height: 48px;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px 0 16px;
  border-bottom: 1px solid var(--app-border);
}

.settings-dialog__header h2,
.settings-section h3 {
  margin: 0;
}

.settings-dialog__header h2 {
  color: var(--text-strong);
  font-size: 15px;
}

.settings-dialog__header button {
  height: 28px;
  border-radius: 5px;
  padding: 0 10px;
  color: var(--text-main);
  background: var(--surface-hover);
  cursor: pointer;
}

.settings-dialog__header button:hover {
  background: var(--surface-active);
}

.settings-section {
  display: grid;
  gap: 12px;
  padding: 16px;
  min-height: 0;
  overflow: auto;
}

.settings-section + .settings-section {
  border-top: 1px solid var(--app-border);
}

.settings-section h3 {
  color: var(--accent);
  font-size: 12px;
}

.settings-row {
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-radius: 7px;
  padding: 10px 12px;
  background: var(--field-bg);
}

.settings-row span {
  display: grid;
  gap: 4px;
}

.settings-row strong {
  color: var(--text-strong);
  font-size: 13px;
}

.settings-row small {
  color: var(--text-muted);
  font-size: 12px;
}

.settings-row input {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
}
</style>
