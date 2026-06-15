<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, type DragDropEvent } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import AppTitleBar from "../../../widgets/app-title-bar/ui/AppTitleBar.vue";
import ConnectionSidebar from "../../../widgets/connection-sidebar/ui/ConnectionSidebar.vue";
import StatusBar from "../../../widgets/status-bar/ui/StatusBar.vue";
import TerminalWorkspace from "../../../widgets/terminal-workspace/ui/TerminalWorkspace.vue";
import { useLayoutStore } from "../../../entities/layout/model/layoutStore";
import { useDiagnosticsStore } from "../../../entities/diagnostics/model/diagnosticsStore";
import { useServerStore } from "../../../entities/server/model/serverStore";
import { useSettingsStore } from "../../../entities/settings/model/settingsStore";
import { AppSettingsDialog } from "../../../features/app-settings";
import { AboutAppDialog } from "../../../features/about-app";
import { AppConfirmDialog } from "../../../features/app-confirm";
import { ToastViewport } from "../../../features/app-toast";
import { SelectServerDialog } from "../../../features/create-terminal-tab";
import { SftpFollowCwdConfirmDialog } from "../../../features/sftp-follow-cwd-confirm";
import { SshHostKeyConfirmDialog } from "../../../features/ssh-host-key-confirm";

const layout = useLayoutStore();
const diagnostics = useDiagnosticsStore();
const serverStore = useServerStore();
const settingsStore = useSettingsStore();
const sftpDragActive = ref(false);
const aboutDialogOpen = ref(false);
const settingsDialogOpen = ref(false);
const followCwdConfirmTabId = ref("");
const connectionSidebar = ref<InstanceType<typeof ConnectionSidebar>>();
let unlistenDragDrop: UnlistenFn | undefined;

type DragPosition = {
  x: number;
  y: number;
};

onMounted(() => {
  void settingsStore.hydrateSettings().then(() =>
    Promise.all([
      diagnostics.hydrateDiagnostics(),
      serverStore.hydrateConnections(),
    ]),
  ).then(() => layout.initTerminalEvents());

  if (isTauri()) {
    void getCurrentWindow().onDragDropEvent((event) => {
      handleNativeDragDropEvent(event.payload);
    }).then((unlisten) => {
      unlistenDragDrop = unlisten;
    });
  }
});

onBeforeUnmount(() => {
  void layout.cleanupConnections();
  layout.disposeTerminalEvents();
  unlistenDragDrop?.();
});

function setSftpDragActive(active: boolean) {
  sftpDragActive.value = active;
}

function handleNativeDragDropEvent(event: DragDropEvent) {
  if (event.type === "leave") {
    setSftpDragActive(false);
    return;
  }

  const overSftp = Boolean(layout.activeTab) && isNativePositionInsideSftpDropZone(event.position);

  if (event.type === "enter" || event.type === "over") {
    setSftpDragActive(overSftp);
    return;
  }

  const shouldUploadToSftp = overSftp && event.paths.length > 0;
  setSftpDragActive(false);

  if (shouldUploadToSftp) {
    void layout.handleSftpDroppedPaths(event.paths);
  }
}

function isNativePositionInsideSftpDropZone(position: DragPosition) {
  const scale = window.devicePixelRatio || 1;

  return (
    isPointInsideSftpDropZone(position.x, position.y)
    || isPointInsideSftpDropZone(position.x / scale, position.y / scale)
  );
}

function isPointInsideSftpDropZone(x: number, y: number) {
  const zones = document.querySelectorAll<HTMLElement>("[data-sftp-drop-zone='true']");

  return Array.from(zones).some((zone) => {
    const rect = zone.getBoundingClientRect();

    return (
      x >= rect.left
      && x <= rect.right
      && y >= rect.top
      && y <= rect.bottom
    );
  });
}

function openCreateConnection() {
  connectionSidebar.value?.openCreateConnection();
}

function openCreateConnectionFromSelectServer() {
  layout.closeServerSelectDialog();
  openCreateConnection();
}

function requestToggleSftpFollowCwd(tabId: string) {
  const tab = layout.tabs.find((item) => item.id === tabId);

  if (!tab) {
    return;
  }

  if (
    !tab.sftpFollowTerminalCwd
    && !settingsStore.settings.sftp.followTerminalCwdByDefault
    && !settingsStore.settings.sftp.followTerminalCwdPromptAcknowledged
  ) {
    followCwdConfirmTabId.value = tabId;
    return;
  }

  void layout.toggleSftpFollowTerminalCwd(tabId);
}

async function confirmSftpFollowCwd() {
  const tabId = followCwdConfirmTabId.value;
  followCwdConfirmTabId.value = "";

  await settingsStore.acknowledgeFollowTerminalCwdPrompt();

  if (tabId) {
    void layout.toggleSftpFollowTerminalCwd(tabId);
  }
}

function openSettingsFromFollowConfirm() {
  followCwdConfirmTabId.value = "";
  settingsDialogOpen.value = true;
}
</script>

<template>
  <div class="shell">
    <AppTitleBar
      :theme="settingsStore.settings.appearance.theme"
      @about="aboutDialogOpen = true"
      @create-connection="openCreateConnection"
      @settings="settingsDialogOpen = true"
      @toggle-theme="settingsStore.toggleTheme"
    />
    <div class="shell__body">
      <ConnectionSidebar
        ref="connectionSidebar"
        :collapsed="layout.sidebarCollapsed"
        @toggle-collapse="layout.toggleSidebar"
      />
      <TerminalWorkspace
        :tabs="layout.tabs"
        :active-tab-id="layout.activeTabId"
        :sftp-drag-active="sftpDragActive"
        :sftp-collapsed="layout.isActiveSftpCollapsed"
        @close-tab="layout.closeTerminalTab"
        @close-other-tabs="layout.closeOtherTerminalTabs"
        @create-tab="layout.createTerminalTab"
        @reconnect-tab="layout.reconnectTerminalTab"
        @rename-tab="layout.renameTerminalTab"
        @select-tab="layout.setActiveTab"
        @sftp-cancel-download="layout.handleSftpCancelDownload"
        @sftp-cancel-upload="layout.handleSftpCancelUpload"
        @sftp-clear-transfer-queue="layout.clearSftpTransferQueue"
        @sftp-drag-active="setSftpDragActive"
        @sftp-download="layout.handleSftpDownload"
        @sftp-entry-delete="layout.handleSftpDeleteEntry"
        @sftp-entry-edit="layout.handleSftpEditEntry"
        @terminal-input="layout.handleTerminalInput"
        @terminal-resize="layout.handleTerminalResize"
        @sftp-entry-open="layout.handleSftpEntryOpen"
        @sftp-entry-rename="layout.handleSftpRenameEntry"
        @sftp-go-parent="layout.handleSftpGoParent"
        @sftp-go-path="layout.handleSftpGoPath"
        @sftp-new-folder="layout.handleSftpNewFolder"
        @sftp-refresh="layout.refreshSftpForTab"
        @sftp-remove-transfer-item="layout.removeSftpTransferItem"
        @sftp-retry-transfer-item="layout.retrySftpTransferItem"
        @sftp-select-entry="layout.handleSftpSelectEntry"
        @sftp-toggle-follow-cwd="requestToggleSftpFollowCwd"
        @sftp-upload="layout.handleSftpUpload"
        @toggle-sftp="layout.toggleSftp"
        @toggle-sftp-for-tab="layout.toggleSftpForTab"
        @reset-sftp-split="layout.resetSftpSplit"
        @reset-sftp-split-for-tab="layout.resetSftpSplitForTab"
        @resize-sftp-split="layout.resizeSftpSplit"
      />
    </div>
    <StatusBar
      :server="layout.activeTabServer"
      :monitor="layout.monitor"
      :tab="layout.activeTab"
    />
    <SelectServerDialog
      :open="layout.serverSelectDialogOpen"
      :servers="serverStore.servers"
      @cancel="layout.closeServerSelectDialog"
      @create-connection="openCreateConnectionFromSelectServer"
      @select="layout.selectServerForNewTab"
    />
    <AppSettingsDialog
      :diagnostics-enabled="settingsStore.settings.diagnostics.enabled"
      :open="settingsDialogOpen"
      :follow-terminal-cwd-by-default="settingsStore.settings.sftp.followTerminalCwdByDefault"
      @close="settingsDialogOpen = false"
      @update-diagnostics-enabled="settingsStore.setDiagnosticsEnabled"
      @update-follow-terminal-cwd-by-default="settingsStore.setFollowTerminalCwdByDefault"
    />
    <AboutAppDialog
      :open="aboutDialogOpen"
      @close="aboutDialogOpen = false"
    />
    <SftpFollowCwdConfirmDialog
      :open="Boolean(followCwdConfirmTabId)"
      @cancel="followCwdConfirmTabId = ''"
      @confirm="confirmSftpFollowCwd"
      @settings="openSettingsFromFollowConfirm"
    />
    <SshHostKeyConfirmDialog
      :kind="layout.pendingHostKeyTrust?.kind"
      :new-fingerprint="layout.pendingHostKeyTrust?.newFingerprint"
      :old-fingerprint="layout.pendingHostKeyTrust?.oldFingerprint"
      :open="Boolean(layout.pendingHostKeyTrust)"
      @cancel="layout.cancelHostKeyTrust"
      @confirm="layout.confirmHostKeyTrust"
    />
    <AppConfirmDialog />
    <ToastViewport />
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-rows: 42px minmax(0, 1fr) 26px;
  width: 100vw;
  height: 100vh;
  color: var(--text-main);
  background: var(--app-bg);
}

.shell__body {
  display: flex;
  min-height: 0;
  border-top: 1px solid var(--app-border);
  border-bottom: 1px solid var(--app-border);
}
</style>
