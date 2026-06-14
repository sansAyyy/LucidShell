<script setup lang="ts">
import type { ServerConnection } from "../model/types";

defineProps<{
  active: boolean;
  server: ServerConnection;
}>();

const emit = defineEmits<{
  context: [event: MouseEvent, server: ServerConnection];
  select: [serverId: string];
}>();

function statusLabel(status: ServerConnection["status"]) {
  const labels: Record<ServerConnection["status"], string> = {
    connected: "已连接",
    connecting: "连接中",
    disconnecting: "断开中",
    disconnected: "未连接",
    error: "连接失败",
  };

  return labels[status];
}
</script>

<template>
  <button
    class="server-item"
    :class="{ 'server-item--active': active }"
    type="button"
    :title="server.lastError ? `${statusLabel(server.status)}：${server.lastError}` : statusLabel(server.status)"
    @click="emit('select', server.id)"
    @contextmenu.prevent="emit('context', $event, server)"
  >
    <span class="status-dot" :class="`status-dot--${server.status}`" />
    <span class="server-item__main">
      <span class="server-item__name">{{ server.name }}</span>
      <span class="server-item__meta">{{ server.user }}@{{ server.host }}:{{ server.port }}</span>
    </span>
    <span v-if="server.status === 'error'" class="server-item__status-text">失败</span>
    <span v-else-if="server.status === 'connecting'" class="server-item__status-text">连接中</span>
    <span v-else-if="server.status === 'disconnecting'" class="server-item__status-text">断开中</span>
    <span v-else-if="server.latencyMs" class="server-item__latency">{{ server.latencyMs }}ms</span>
  </button>
</template>

<style scoped>
.server-item {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
  width: 100%;
  align-items: center;
  gap: 9px;
  padding: 8px;
  border-radius: 7px;
  color: var(--text-main);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.server-item:hover {
  background: var(--surface-hover);
}

.server-item--active {
  background: var(--surface-active);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.status-dot--connected {
  background: var(--success);
}

.status-dot--connecting {
  background: var(--warning);
}

.status-dot--disconnecting {
  background: #8ca0b7;
}

.status-dot--disconnected {
  background: #697584;
}

.status-dot--error {
  background: var(--danger);
}

.server-item__main {
  display: grid;
  min-width: 0;
}

.server-item__name,
.server-item__meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-item__name {
  font-size: 13px;
  font-weight: 600;
}

.server-item__meta,
.server-item__latency,
.server-item__status-text {
  color: var(--text-muted);
  font-size: 11px;
}

.server-item__status-text {
  white-space: nowrap;
}
</style>
