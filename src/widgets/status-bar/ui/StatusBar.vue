<script setup lang="ts">
import type { MonitorState, ServerConnection } from "../../../entities/server/model/types";
import type { TerminalTab } from "../../../entities/terminal/model/types";

defineProps<{
  monitor: MonitorState;
  server?: ServerConnection;
  tab?: TerminalTab;
}>();

function serverStatusLabel(status?: ServerConnection["status"]) {
  const labels: Record<NonNullable<ServerConnection["status"]>, string> = {
    connected: "已连接",
    connecting: "连接中",
    reconnecting: "重连中",
    disconnecting: "断开中",
    disconnected: "未连接",
    error: "连接失败",
  };

  return status ? labels[status] : "未连接";
}

function percent(value?: number) {
  return typeof value === "number" ? `${value}%` : "--";
}
</script>

<template>
  <footer class="statusbar">
    <span>{{ server ? server.name : "未连接" }}</span>
    <span v-if="server">{{ server.user }}@{{ server.host }}</span>
    <span v-if="server">{{ serverStatusLabel(server.status) }}</span>
    <span v-if="server?.latencyMs">{{ server.latencyMs }}ms</span>
    <span>CPU {{ percent(monitor.cpu) }}</span>
    <span>MEM {{ percent(monitor.memory) }}</span>
    <span>DISK {{ percent(monitor.disk) }}</span>
    <span>LOAD {{ monitor.load ?? "--" }}</span>
    <span>UP {{ monitor.uptime ?? "--" }}</span>
    <span v-if="monitor.error">MON {{ monitor.error }}</span>
    <span>{{ tab?.sftp.transferSummary ?? "no tab" }}</span>
  </footer>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 0 12px;
  color: var(--text-muted);
  background: var(--surface-3);
  font-size: 11px;
  white-space: nowrap;
}

.statusbar span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.statusbar span:first-child {
  color: var(--text-strong);
  font-weight: 650;
}
</style>
