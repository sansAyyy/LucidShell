<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useNotificationStore } from "../../../entities/notification/model/notificationStore";

const notification = useNotificationStore();
const inputValue = ref("");
const inputError = ref("");
const inputElement = ref<HTMLInputElement>();

watch(
  () => notification.activeTextInput?.id,
  () => {
    const request = notification.activeTextInput;
    inputValue.value = request?.initialValue ?? "";
    inputError.value = "";

    if (request) {
      void nextTick(() => inputElement.value?.focus());
    }
  },
);

function cancelTextInput() {
  notification.resolveTextInput(undefined);
}

function submitTextInput() {
  const request = notification.activeTextInput;

  if (!request) {
    return;
  }

  const value = inputValue.value.trim();
  const error = request.validate?.(value);

  if (error) {
    inputError.value = error;
    return;
  }

  notification.resolveTextInput(value);
}
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
    <div
      v-if="notification.activeTextInput"
      class="confirm-layer"
      @click.self="cancelTextInput"
    >
      <section class="confirm-dialog" role="dialog" aria-modal="true">
        <header>
          <h2>{{ notification.activeTextInput.title }}</h2>
        </header>
        <form class="confirm-dialog__form" @submit.prevent="submitTextInput">
          <p v-if="notification.activeTextInput.message">{{ notification.activeTextInput.message }}</p>
          <label>
            <span>{{ notification.activeTextInput.label }}</span>
            <input
              ref="inputElement"
              v-model="inputValue"
              :placeholder="notification.activeTextInput.placeholder"
              type="text"
              @input="inputError = ''"
              @keydown.esc.prevent="cancelTextInput"
            >
          </label>
          <span v-if="inputError" class="confirm-dialog__error">{{ inputError }}</span>
          <footer>
            <button type="button" @click="cancelTextInput">
              {{ notification.activeTextInput.cancelText ?? "取消" }}
            </button>
            <button class="confirm-dialog__primary" type="submit">
              {{ notification.activeTextInput.confirmText ?? "确认" }}
            </button>
          </footer>
        </form>
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

.confirm-dialog__form {
  margin: 0;
}

.confirm-dialog__form p {
  padding-bottom: 0;
}

.confirm-dialog label {
  display: grid;
  gap: 7px;
  padding: 14px 18px 4px;
  color: var(--text-main);
  font-size: 12px;
}

.confirm-dialog input {
  height: 34px;
  min-width: 0;
  border: 1px solid var(--field-border);
  border-radius: 6px;
  padding: 0 10px;
  color: var(--text-strong);
  background: var(--surface-2);
  outline: none;
}

.confirm-dialog input:focus {
  border-color: var(--accent);
}

.confirm-dialog__error {
  display: block;
  padding: 6px 18px 0;
  color: var(--danger);
  font-size: 12px;
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
