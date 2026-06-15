import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppSettingsSnapshot } from "../../entities/settings/model/types";

const STORAGE_KEY = "lucidshell.settings.v2";
const LEGACY_STORAGE_KEY = "lucidshell.settings.v1";
const CURRENT_SETTINGS_VERSION = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createDefaultSettingsSnapshot(): AppSettingsSnapshot {
  return {
    version: CURRENT_SETTINGS_VERSION,
    appearance: {
      theme: "dark",
    },
    diagnostics: {
      enabled: false,
    },
    sftp: {
      followTerminalCwdByDefault: false,
      followTerminalCwdPromptAcknowledged: false,
    },
  };
}

export function migrateSettingsSnapshot(value: unknown): AppSettingsSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const version = typeof value.version === "number" ? value.version : 0;

  if (version > CURRENT_SETTINGS_VERSION) {
    return undefined;
  }

  const sftp = isRecord(value.sftp) ? value.sftp : {};
  const appearance = isRecord(value.appearance) ? value.appearance : {};
  const diagnostics = isRecord(value.diagnostics) ? value.diagnostics : {};
  const theme = appearance.theme === "light" || appearance.theme === "dark"
    ? appearance.theme
    : "dark";

  return {
    version: CURRENT_SETTINGS_VERSION,
    appearance: {
      theme,
    },
    diagnostics: {
      enabled: typeof diagnostics.enabled === "boolean" ? diagnostics.enabled : false,
    },
    sftp: {
      followTerminalCwdByDefault:
        typeof sftp.followTerminalCwdByDefault === "boolean"
          ? sftp.followTerminalCwdByDefault
          : false,
      followTerminalCwdPromptAcknowledged:
        typeof sftp.followTerminalCwdPromptAcknowledged === "boolean"
          ? sftp.followTerminalCwdPromptAcknowledged
          : false,
    },
  };
}

function parseSnapshot(raw: string | undefined | null) {
  if (!raw) {
    return undefined;
  }

  try {
    return migrateSettingsSnapshot(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function stringifySnapshot(snapshot: AppSettingsSnapshot) {
  return JSON.stringify(snapshot, null, 2);
}

export async function loadSettingsSnapshot(): Promise<AppSettingsSnapshot> {
  const fallback = createDefaultSettingsSnapshot();

  if (!isTauri()) {
    return parseSnapshot(localStorage.getItem(STORAGE_KEY))
      ?? parseSnapshot(localStorage.getItem(LEGACY_STORAGE_KEY))
      ?? fallback;
  }

  try {
    const raw = await invoke<string | null>("load_settings_config");
    return parseSnapshot(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

export async function saveSettingsSnapshot(snapshot: AppSettingsSnapshot) {
  if (!isTauri()) {
    localStorage.setItem(STORAGE_KEY, stringifySnapshot(snapshot));
    return;
  }

  await invoke("save_settings_config", {
    content: stringifySnapshot(snapshot),
  });
}
