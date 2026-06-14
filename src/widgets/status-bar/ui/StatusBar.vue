<script setup lang="ts">
import type { MonitorState, ServerConnection } from "../../../entities/server/model/types";
import type { TerminalTab } from "../../../entities/terminal/model/types";

defineProps<{
  monitor: MonitorState;
  server: ServerConnection;
  tab?: TerminalTab;
}>();

function percent(value?: number) {
  return typeof value === "number" ? `${value}%` : "--";
}
</script>

<template>
  <footer class="statusbar">
    <span>{{ server.name }}</span>
    <span>{{ server.user }}@{{ server.host }}</span>
    <span>{{ server.status }}</span>
    <span v-if="server.latencyMs">{{ server.latencyMs }}ms</span>
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
