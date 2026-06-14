<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Plus, Search, X } from "@lucide/vue";
import type { ServerConnection } from "../../../entities/server/model/types";

const props = defineProps<{
  open: boolean;
  servers: ServerConnection[];
}>();

const emit = defineEmits<{
  cancel: [];
  createConnection: [];
  select: [server: ServerConnection];
}>();

const search = ref("");

const visibleServers = computed(() => {
  const query = search.value.trim().toLowerCase();

  if (!query) {
    return props.servers;
  }

  return props.servers.filter((server) =>
    [server.name, server.host, server.user].some((part) => part.toLowerCase().includes(query)),
  );
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      search.value = "";
    }
  },
);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @click.self="emit('cancel')">
      <section class="dialog" role="dialog" aria-modal="true" aria-label="选择服务器">
        <header class="dialog__header">
          <div>
            <h2>选择服务器</h2>
            <p>为新的 Terminal Tab 选择一个连接</p>
          </div>
          <div class="dialog__actions">
            <button class="dialog__add" type="button" @click="emit('createConnection')">
              <Plus :size="16" />
              新增连接
            </button>
            <button class="dialog__close" title="关闭" type="button" @click="emit('cancel')">
              <X :size="18" />
            </button>
          </div>
        </header>

        <label class="dialog__search">
          <Search :size="18" />
          <input v-model="search" autofocus placeholder="搜索服务器、主机或用户..." />
        </label>

        <div class="server-list">
          <button
            v-for="server in visibleServers"
            :key="server.id"
            class="server-option"
            type="button"
            @click="emit('select', server)"
          >
            <span class="server-option__status" :class="`server-option__status--${server.status}`" />
            <span class="server-option__main">
              <strong>{{ server.name }}</strong>
              <span>{{ server.user }}@{{ server.host }}:{{ server.port }}</span>
            </span>
            <span class="server-option__auth">{{ server.authType }}</span>
          </button>

          <p v-if="!visibleServers.length" class="server-list__empty">没有匹配的服务器</p>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  z-index: 40;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--overlay-bg);
}

.dialog {
  display: grid;
  width: min(520px, 100%);
  max-height: min(680px, calc(100vh - 48px));
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--field-border);
  border-radius: 8px;
  background: var(--surface-4);
  box-shadow: var(--shadow-strong);
}

.dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--app-border);
}

.dialog__header h2 {
  margin: 0;
  color: var(--text-strong);
  font-size: 16px;
}

.dialog__header p {
  margin: 4px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.dialog__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.dialog__add,
.dialog__close {
  display: grid;
  height: 30px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 6px;
  cursor: pointer;
}

.dialog__add {
  grid-template-columns: 16px auto;
  gap: 6px;
  padding: 0 10px;
  color: #ffffff;
  background: var(--accent);
  font-size: 12px;
  font-weight: 650;
}

.dialog__add:hover {
  background: var(--accent-strong);
}

.dialog__close {
  width: 30px;
  color: var(--text-muted);
  background: transparent;
}

.dialog__close:hover {
  color: var(--text-strong);
  background: var(--surface-hover);
}

.dialog__search {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  margin: 12px 14px;
  padding: 0 10px;
  border: 1px solid var(--field-border);
  border-radius: 7px;
  color: var(--text-muted);
  background: var(--field-bg);
}

.dialog__search input {
  height: 36px;
  min-width: 0;
  border: 0;
  color: var(--text-main);
  background: transparent;
  outline: 0;
}

.dialog__search input::placeholder {
  color: var(--text-subtle);
}

.server-list {
  min-height: 0;
  overflow: auto;
  padding: 0 10px 12px;
}

.server-option {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 7px;
  color: var(--text-main);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.server-option:hover {
  background: var(--surface-hover);
}

.server-option__status {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.server-option__status--connected {
  background: var(--success);
}

.server-option__status--connecting {
  background: var(--warning);
}

.server-option__status--disconnecting {
  background: #8ca0b7;
}

.server-option__status--disconnected {
  background: #697584;
}

.server-option__status--error {
  background: var(--danger);
}

.server-option__main {
  display: grid;
  min-width: 0;
}

.server-option__main strong,
.server-option__main span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-option__main strong {
  font-size: 13px;
}

.server-option__main span,
.server-option__auth,
.server-list__empty {
  color: var(--text-muted);
  font-size: 12px;
}

.server-option__auth {
  padding: 3px 6px;
  border-radius: 5px;
  background: var(--surface-hover);
}

.server-list__empty {
  margin: 20px 8px;
  text-align: center;
}
</style>
