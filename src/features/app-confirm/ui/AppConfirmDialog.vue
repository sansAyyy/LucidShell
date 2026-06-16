<script setup lang="ts">
import { useNotificationStore } from "../../../entities/notification/model/notificationStore";

const notification = useNotificationStore();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="notification.activeConfirm"
      class="confirm-layer"
      @click.self="notification.resolveConfirm(false)"
    >
      <section class="confirm-dialog" role="dialog" aria-modal="true">
        <header>
          <h2>{{ notification.activeConfirm.title }}</h2>
        </header>
        <p>{{ notification.activeConfirm.message }}</p>
        <footer>
          <button type="button" @click="notification.resolveConfirm(false)">
            {{ notification.activeConfirm.cancelText ?? "取消" }}
          </button>
          <button class="confirm-dialog__primary" type="button" @click="notification.resolveConfirm(true)">
            {{ notification.activeConfirm.confirmText ?? "确认" }}
          </button>
        </footer>
      </section>
    </div>
    <div
      v-if="notification.activeChoice"
      class="confirm-layer"
    >
      <section class="confirm-dialog" role="dialog" aria-modal="true">
        <header>
          <h2>{{ notification.activeChoice.title }}</h2>
        </header>
        <p>{{ notification.activeChoice.message }}</p>
        <footer>
          <button
            v-for="choice in notification.activeChoice.choices"
            :key="choice.value"
            :class="{
              'confirm-dialog__primary': choice.tone === 'primary',
              'confirm-dialog__danger': choice.tone === 'danger'
            }"
            type="button"
            @click="notification.resolveChoice(choice.value)"
          >
            {{ choice.label }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-layer {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  background: var(--overlay-bg);
}

.confirm-dialog {
  width: min(420px, calc(100vw - 40px));
  border: 1px solid var(--field-border);
  border-radius: 8px;
  background: var(--surface-4);
  box-shadow: var(--shadow-strong);
}

.confirm-dialog header {
  padding: 16px 18px 10px;
  border-bottom: 1px solid var(--app-border);
}

.confirm-dialog h2 {
  margin: 0;
  color: var(--text-strong);
  font-size: 15px;
}

.confirm-dialog p {
  margin: 0;
  padding: 14px 18px;
  color: var(--text-main);
  font-size: 13px;
  line-height: 1.6;
}

.confirm-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px 16px;
  border-top: 1px solid var(--app-border);
}

.confirm-dialog button {
  height: 32px;
  border-radius: 6px;
  padding: 0 13px;
  color: var(--text-main);
  background: var(--surface-hover);
  cursor: pointer;
}

.confirm-dialog button:hover {
  background: var(--surface-active);
}

.confirm-dialog__primary {
  color: #ffffff !important;
  background: var(--accent) !important;
}

.confirm-dialog__primary:hover {
  background: var(--accent-strong) !important;
}

.confirm-dialog__danger {
  color: #ffffff !important;
  background: var(--danger) !important;
}

.confirm-dialog__danger:hover {
  background: var(--danger-hover) !important;
}
</style>
