<script setup lang="ts">
import { Download, Trash2 } from "@lucide/vue";
import { computed } from "vue";
import { save } from "@tauri-apps/plugin-dialog";
import { exportDiagnosticLog } from "../../../shared/api/tauri";
import { useDiagnosticsStore, type DiagnosticEntry } from "../../../entities/diagnostics/model/diagnosticsStore";
import { useNotificationStore } from "../../../entities/notification/model/notificationStore";

const diagnostics = useDiagnosticsStore();
const notification = useNotificationStore();

const visibleEntries = computed(() => [...diagnostics.entries].reverse());

function levelLabel(level: DiagnosticEntry["level"]) {
  return {
    error: "错误",
    info: "信息",
    warn: "警告",
  }[level];
}

function scopeLabel(scope: DiagnosticEntry["scope"]) {
  return {
    connection: "连接",
    credential: "凭据",
    settings: "设置",
    sftp: "SFTP",
    system: "系统",
    terminal: "终端",
  }[scope];
}

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleString();
}

function formatContext(context?: Record<string, unknown>) {
  if (!context || !Object.keys(context).length) {
    return "";
  }

  return JSON.stringify(context, undefined, 2);
}

async function exportLog() {
  const defaultPath = `lucidshell-diagnostics-${new Date().toISOString().slice(0, 10)}.log`;
  const path = await save({
    defaultPath,
    filters: [{ name: "Log", extensions: ["log", "txt"] }],
    title: "导出诊断日志",
  });

  if (!path) {
    return;
  }

  try {
    await exportDiagnosticLog({ path });
    notification.showToast("诊断日志已导出。", "success");
  } catch (error) {
    notification.showToast(`导出失败：${String(error)}`, "error");
  }
}

async function clearLog() {
  if (!await notification.confirm({
    title: "清空诊断日志",
    message: "确定清空当前诊断日志吗？这个操作不会影响连接配置。",
    confirmText: "清空",
  })) {
    return;
  }

  try {
    await diagnostics.clear();
    notification.showToast("诊断日志已清空。", "success");
  } catch (error) {
    notification.showToast(`清空失败：${String(error)}`, "error");
  }
}
</script>

<template>
  <section class="diagnostics">
    <header class="diagnostics__header">
      <div>
        <h3>诊断日志</h3>
        <small>记录最近的连接、终端、SFTP 和凭据错误。</small>
      </div>
      <div class="diagnostics__actions">
        <button title="导出日志" type="button" @click="exportLog">
          <Download :size="15" />
          <span>导出</span>
        </button>
        <button title="清空日志" type="button" @click="clearLog">
          <Trash2 :size="15" />
          <span>清空</span>
        </button>
      </div>
    </header>

    <div v-if="!visibleEntries.length" class="diagnostics__empty">
      暂无诊断日志
    </div>

    <div v-else class="diagnostics__list">
      <article
        v-for="entry in visibleEntries"
        :key="entry.id"
        class="diagnostic-entry"
        :class="`diagnostic-entry--${entry.level}`"
      >
        <div class="diagnostic-entry__meta">
          <span>{{ levelLabel(entry.level) }}</span>
          <span>{{ scopeLabel(entry.scope) }}</span>
          <time>{{ formatTime(entry.timestamp) }}</time>
        </div>
        <p>{{ entry.message }}</p>
        <pre v-if="formatContext(entry.context)">{{ formatContext(entry.context) }}</pre>
      </article>
    </div>
  </section>
</template>

<style scoped>
.diagnostics {
  display: grid;
  min-height: 0;
  gap: 10px;
}

.diagnostics__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.diagnostics__header h3 {
  margin: 0 0 4px;
  color: var(--accent);
  font-size: 12px;
}

.diagnostics__header small {
  color: var(--text-muted);
  font-size: 12px;
}

.diagnostics__actions {
  display: flex;
  gap: 8px;
}

.diagnostics__actions button {
  display: inline-flex;
  height: 30px;
  align-items: center;
  gap: 6px;
  border-radius: 6px;
  padding: 0 10px;
  color: var(--text-main);
  background: var(--surface-hover);
  cursor: pointer;
  font-size: 12px;
}

.diagnostics__actions button:hover {
  background: var(--surface-active);
}

.diagnostics__empty {
  display: grid;
  height: 120px;
  place-items: center;
  border: 1px dashed var(--field-border);
  border-radius: 7px;
  color: var(--text-muted);
  font-size: 12px;
}

.diagnostics__list {
  display: grid;
  max-height: 260px;
  gap: 8px;
  overflow: auto;
  padding-right: 4px;
}

.diagnostic-entry {
  display: grid;
  gap: 6px;
  border: 1px solid var(--field-border);
  border-left: 3px solid var(--accent);
  border-radius: 7px;
  padding: 9px 10px;
  background: var(--field-bg);
}

.diagnostic-entry--warn {
  border-left-color: var(--warning);
}

.diagnostic-entry--error {
  border-left-color: var(--danger);
}

.diagnostic-entry__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  color: var(--text-muted);
  font-size: 11px;
}

.diagnostic-entry p {
  margin: 0;
  color: var(--text-strong);
  font-size: 12px;
  line-height: 1.45;
}

.diagnostic-entry pre {
  max-height: 120px;
  overflow: auto;
  margin: 0;
  border-radius: 6px;
  padding: 8px;
  color: var(--text-main);
  background: var(--surface-2);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
