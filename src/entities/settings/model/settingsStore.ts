import { defineStore } from "pinia";
import { ref } from "vue";
import type { AppSettingsSnapshot, AppTheme } from "./types";
import {
  createDefaultSettingsSnapshot,
  loadSettingsSnapshot,
  saveSettingsSnapshot,
} from "../../../shared/lib/settingsStorage";

export const useSettingsStore = defineStore("settings", () => {
  const snapshot = ref<AppSettingsSnapshot>(createDefaultSettingsSnapshot());
  const hydrated = ref(false);

  async function hydrateSettings() {
    snapshot.value = await loadSettingsSnapshot();
    applyTheme(snapshot.value.appearance.theme);
    hydrated.value = true;
  }

  async function setTheme(theme: AppTheme) {
    snapshot.value = {
      ...snapshot.value,
      appearance: {
        ...snapshot.value.appearance,
        theme,
      },
    };
    applyTheme(theme);
    await saveSettingsSnapshot(snapshot.value);
  }

  async function toggleTheme() {
    await setTheme(snapshot.value.appearance.theme === "dark" ? "light" : "dark");
  }

  async function setFollowTerminalCwdByDefault(value: boolean) {
    snapshot.value = {
      ...snapshot.value,
      sftp: {
        ...snapshot.value.sftp,
        followTerminalCwdByDefault: value,
      },
    };
    await saveSettingsSnapshot(snapshot.value);
  }

  async function acknowledgeFollowTerminalCwdPrompt() {
    if (snapshot.value.sftp.followTerminalCwdPromptAcknowledged) {
      return;
    }

    snapshot.value = {
      ...snapshot.value,
      sftp: {
        ...snapshot.value.sftp,
        followTerminalCwdPromptAcknowledged: true,
      },
    };
    await saveSettingsSnapshot(snapshot.value);
  }

  return {
    hydrated,
    settings: snapshot,
    acknowledgeFollowTerminalCwdPrompt,
    hydrateSettings,
    setFollowTerminalCwdByDefault,
    setTheme,
    toggleTheme,
  };
});

function applyTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme;
}
