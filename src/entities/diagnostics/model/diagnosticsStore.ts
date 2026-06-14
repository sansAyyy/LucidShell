import { defineStore } from "pinia";
import { ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { appendDiagnosticLog, clearDiagnosticLog, readDiagnosticLog } from "../../../shared/api/tauri";
import { buildInfo } from "../../../shared/config/buildInfo";

export type DiagnosticLevel = "info" | "warn" | "error";
export type DiagnosticScope = "connection" | "terminal" | "sftp" | "credential" | "settings" | "system";

export type DiagnosticEntry = {
  context?: Record<string, unknown>;
  id: string;
  level: DiagnosticLevel;
  message: string;
  scope: DiagnosticScope;
  timestamp: string;
};

const MAX_ENTRIES = 300;

function createDiagnosticId() {
  return `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeParseEntry(line: string): DiagnosticEntry | undefined {
  try {
    const parsed = JSON.parse(line) as Partial<DiagnosticEntry>;

    if (!parsed.id || !parsed.level || !parsed.message || !parsed.scope || !parsed.timestamp) {
      return undefined;
    }

    return parsed as DiagnosticEntry;
  } catch {
    return undefined;
  }
}

export const useDiagnosticsStore = defineStore("diagnostics", () => {
  const entries = ref<DiagnosticEntry[]>([]);
  const hydrated = ref(false);

  async function hydrateDiagnostics() {
    if (hydrated.value || !isTauri()) {
      hydrated.value = true;
      return;
    }

    try {
      const content = await readDiagnosticLog();
      entries.value = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map(safeParseEntry)
        .filter((entry): entry is DiagnosticEntry => Boolean(entry))
        .slice(-MAX_ENTRIES);
    } catch {
      entries.value = [];
    } finally {
      hydrated.value = true;
    }
  }

  function record(entry: Omit<DiagnosticEntry, "id" | "timestamp">) {
    const nextEntry: DiagnosticEntry = {
      ...entry,
      context: {
        appVersion: buildInfo.appVersion,
        buildDate: buildInfo.buildDate,
        gitBranch: buildInfo.gitBranch,
        gitCommit: buildInfo.gitCommit,
        ...entry.context,
      },
      id: createDiagnosticId(),
      timestamp: new Date().toISOString(),
    };

    entries.value = [...entries.value, nextEntry].slice(-MAX_ENTRIES);

    if (isTauri()) {
      void appendDiagnosticLog({ line: JSON.stringify(nextEntry) }).catch(() => undefined);
    }
  }

  async function clear() {
    entries.value = [];

    if (isTauri()) {
      await clearDiagnosticLog();
    }
  }

  return {
    clear,
    entries,
    hydrateDiagnostics,
    record,
  };
});
