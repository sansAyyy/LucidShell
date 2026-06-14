<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  create: [name: string];
}>();

const name = ref("");

watch(
  () => props.open,
  (open) => {
    if (open) {
      name.value = "";
    }
  },
);

function create() {
  if (!name.value.trim()) {
    return;
  }

  emit("create", name.value);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @click.self="emit('cancel')">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="create-group-title">
        <header class="dialog__header">
          <h2 id="create-group-title">新增分组</h2>
          <p>分组用于整理连接列表。</p>
        </header>

        <label class="field">
          分组名称
          <input v-model="name" placeholder="Production" @keyup.enter="create" />
        </label>

        <footer class="dialog__footer">
          <button class="button" type="button" @click="emit('cancel')">取消</button>
          <button class="button button--primary" :disabled="!name.trim()" type="button" @click="create">
            新增分组
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  background: var(--overlay-bg);
}

.dialog {
  width: min(420px, calc(100vw - 48px));
  border: 1px solid var(--field-border);
  border-radius: 8px;
  background: var(--surface-4);
  box-shadow: var(--shadow-strong);
}

.dialog__header {
  padding: 18px 20px 12px;
  border-bottom: 1px solid var(--app-border);
}

.dialog__header h2 {
  margin: 0;
  color: var(--text-strong);
  font-size: 16px;
}

.dialog__header p {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.field {
  display: grid;
  gap: 6px;
  padding: 16px 20px;
  color: var(--text-muted);
  font-size: 12px;
}

.field input {
  height: 34px;
  border: 1px solid var(--field-border);
  border-radius: 6px;
  padding: 0 10px;
  color: var(--text-main);
  background: var(--field-bg);
}

.dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px 18px;
  border-top: 1px solid var(--app-border);
}

.button {
  height: 32px;
  border-radius: 6px;
  padding: 0 14px;
  color: var(--text-main);
  background: var(--surface-hover);
  cursor: pointer;
}

.button:hover {
  background: var(--surface-active);
}

.button:disabled {
  color: var(--text-subtle);
  cursor: not-allowed;
}

.button--primary {
  color: #ffffff;
  background: var(--accent);
}

.button--primary:hover {
  background: var(--accent-strong);
}
</style>
