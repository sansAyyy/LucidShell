<script setup lang="ts">
import { X } from "@lucide/vue";
import { useNotificationStore } from "../../../entities/notification/model/notificationStore";

const notification = useNotificationStore();
</script>

<template>
  <div class="toast-viewport" aria-live="polite">
    <div
      v-for="toast in notification.toasts"
      :key="toast.id"
      class="toast"
      :class="`toast--${toast.tone}`"
    >
      <span>{{ toast.message }}</span>
      <button title="关闭" type="button" @click="notification.dismissToast(toast.id)">
        <X :size="14" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.toast-viewport {
  position: fixed;
  right: 18px;
  bottom: 36px;
  z-index: 80;
  display: grid;
  width: min(360px, calc(100vw - 36px));
  gap: 8px;
  pointer-events: none;
}

.toast {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--field-border);
  border-left: 3px solid var(--accent);
  border-radius: 7px;
  padding: 9px 8px 9px 11px;
  color: var(--text-main);
  background: var(--surface-4);
  box-shadow: var(--shadow-strong);
  font-size: 12px;
  pointer-events: auto;
}

.toast--success {
  border-left-color: var(--success);
}

.toast--error {
  border-left-color: var(--danger);
}

.toast span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toast button {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 5px;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

.toast button:hover {
  color: var(--text-strong);
  background: var(--surface-hover);
}
</style>
