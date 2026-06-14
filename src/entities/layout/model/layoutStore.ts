import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { useServerStore } from "../../server/model/serverStore";
import { useSettingsStore } from "../../settings/model/settingsStore";
import { useNotificationStore } from "../../notification/model/notificationStore";
import { useDiagnosticsStore, type DiagnosticScope } from "../../diagnostics/model/diagnosticsStore";
import {
  cancelSftpDownload,
  cancelSftpUpload,
  checkServerSessionHealth,
  cleanupSshSessions,
  closeTerminalTab,
  connectServer,
  createSftpDirectory,
  deleteSftpEntry,
  disconnectServer,
  downloadSftpDirectory,
  downloadSftpFile,
  listSftpDirectory,
  openSftpLocalEdit,
  openTerminalTab,
  prepareSftpUploadQueue,
  readKeychainPassword,
  readLoginShell,
  readServerMonitor,
  renameSftpEntry,
  terminalResize,
  terminalWrite,
  uploadSftpFile,
  type ConnectionStatusChangedEvent,
  type LocalEditSyncEvent,
  type SftpDownloadProgressEvent,
  type SftpUploadProgressEvent,
  type TerminalClosedEvent,
  type TerminalOutputEvent,
} from "../../../shared/api/tauri";
import type { RemoteFileEntry, SftpTransferItem } from "../../sftp/model/types";
import type { MonitorState, ServerConnection } from "../../server/model/types";
import type { TerminalInputPayload, TerminalTab } from "../../terminal/model/types";

type SftpUploadQueueItem = {
  localPath: string;
  remotePath: string;
  fileName: string;
  ensureDirectories: string[];
};

type SftpUploadQueueState = {
  cancelled: boolean;
  completed: number;
  current?: SftpUploadQueueItem;
  items: SftpUploadQueueItem[];
  running: boolean;
  total: number;
};

type TerminalWriteQueueState = {
  items: TerminalInputPayload[];
  running: boolean;
};

const emptyMonitor: MonitorState = {};
const TERMINAL_WRITE_CHUNK_SIZE = 4096;
const TERMINAL_PASTE_CONFIRM_THRESHOLD = 20_000;
const TERMINAL_WRITE_QUEUE_LIMIT = 2_000_000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_MIN_GAP_MS = 5_000;
const CWD_OSC_PATTERN = /\x1b\]777;LucidShell;cwd=([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const CWD_HOOK_ECHO_PATTERNS = [
  /stty -echo 2>\/dev\/null\r?\n?/g,
  /.*__lucidshell_cwd_hook.*\r?\n?/g,
  /.*PROMPT_COMMAND.*\r?\n?/g,
  /.*precmd_functions.*\r?\n?/g,
  /.*add-zsh-hook.*\r?\n?/g,
  /.*fish_prompt.*\r?\n?/g,
  /(?:case|esac|end)\r?\n?/g,
  /stty echo 2>\/dev\/null\r?\n?/g,
];

export const useLayoutStore = defineStore("layout", () => {
  const defaultSftpHeightRatio = 0.38;
  const sidebarCollapsed = ref(false);
  const sftpCollapsedByTab = ref<Record<string, boolean>>({});
  const activeTabId = ref("");

  const tabs = ref<TerminalTab[]>([]);
  const monitorBySessionId = ref<Record<string, MonitorState>>({});
  const monitorRefreshTimer = ref<number>();
  const healthRefreshTimer = ref<number>();
  const healthCheckInFlight = ref<Record<string, boolean>>({});
  const lastHealthCheckAt = ref<Record<string, number>>({});
  const terminalEventsReady = ref(false);
  const terminalUnlisteners = ref<UnlistenFn[]>([]);
  const pendingTerminalOutput = ref<Record<string, string>>({});
  const terminalWriteQueues = ref<Record<string, TerminalWriteQueueState>>({});
  const serverSessionByProfileId = ref<Record<string, string>>({});
  const terminalTabCounter = ref(0);
  const serverSelectDialogOpen = ref(false);
  const uploadQueues = ref<Record<string, SftpUploadQueueState>>({});
  const pendingHostKeyTrust = ref<{
    kind: "unknown" | "mismatch";
    newFingerprint: string;
    oldFingerprint?: string;
    serverId: string;
    tabId: string;
  }>();

  const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeTabId.value));
  const monitor = computed(() => {
    const sessionId = activeTab.value?.serverSessionId;
    return sessionId ? (monitorBySessionId.value[sessionId] ?? emptyMonitor) : emptyMonitor;
  });

  const activeTabServer = computed(() => {
    const tab = activeTab.value;

    if (!tab?.serverProfileId) {
      return undefined;
    }

    return useServerStore().servers.find((server) => server.id === tab.serverProfileId);
  });

  const isActiveSftpCollapsed = computed(() => {
    const tab = activeTab.value;
    return tab ? (sftpCollapsedByTab.value[tab.id] ?? false) : false;
  });

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  function toggleSftp() {
    const tab = activeTab.value;

    if (!tab) {
      return;
    }

    toggleSftpForTab(tab.id);
  }

  function toggleSftpForTab(tabId: string) {
    sftpCollapsedByTab.value = {
      ...sftpCollapsedByTab.value,
      [tabId]: !(sftpCollapsedByTab.value[tabId] ?? false),
    };
  }

  function setActiveTab(tabId: string) {
    if (!tabs.value.some((tab) => tab.id === tabId)) {
      return;
    }

    activeTabId.value = tabId;
    void refreshActiveMonitor();
    void ensureTerminalForTab(tabId);
  }

  function openServerInNewTab(server: ServerConnection) {
    const nextIndex = terminalTabCounter.value + 1;
    terminalTabCounter.value = nextIndex;
    const tabId = `tab-${Date.now()}-${nextIndex}`;
    const tab = createEmptyTerminalTab(tabId, server.name);
    tab.serverProfileId = server.id;

    tabs.value = [...tabs.value, tab];
    sftpCollapsedByTab.value = {
      ...sftpCollapsedByTab.value,
      [tab.id]: false,
    };
    useServerStore().setActiveServer(server.id);
    activeTabId.value = tab.id;
    void ensureTerminalForTab(tab.id, server);
  }

  function selectServerForNewTab(server: ServerConnection) {
    serverSelectDialogOpen.value = false;
    openServerInNewTab(server);
  }

  function createTerminalTab() {
    return openServerSelectDialog();
  }

  function openServerSelectDialog() {
    serverSelectDialogOpen.value = true;
  }

  function closeServerSelectDialog() {
    serverSelectDialogOpen.value = false;
  }

  async function closeTerminalTabById(tabId: string) {
    const tabIndex = tabs.value.findIndex((item) => item.id === tabId);

    if (tabIndex < 0) {
      return;
    }

    const [tab] = tabs.value.splice(tabIndex, 1);
    const wasActive = activeTabId.value === tabId;
    clearTerminalWriteQueue(tabId);

    if (wasActive) {
      const fallbackTab = tabs.value[Math.min(tabIndex, tabs.value.length - 1)];
      activeTabId.value = fallbackTab?.id ?? "";

      if (fallbackTab) {
        void ensureTerminalForTab(fallbackTab.id);
      }
    }

    const { [tabId]: _removedSftpCollapsed, ...nextSftpCollapsed } = sftpCollapsedByTab.value;
    sftpCollapsedByTab.value = nextSftpCollapsed;

    await cancelTabTransfers(tab);
    removeUploadQueue(tab.id);

    if (tab.terminalSessionId && isTauri()) {
      try {
        await closeTerminalTab({ terminalId: tab.terminalSessionId });
      } catch (error) {
        appendLocalOutput(
          activeTabId.value,
          `\r\n[terminal close failed: ${formatError(error)}]\r\n`,
        );
      }
    }

    if (tab.terminalSessionId) {
      const { [tab.terminalSessionId]: _removedOutput, ...rest } = pendingTerminalOutput.value;
      pendingTerminalOutput.value = rest;
    }
  }

  function resetSftpSplit() {
    const tab = activeTab.value;

    if (!tab) {
      return;
    }

    resetSftpSplitForTab(tab.id);
  }

  function resetSftpSplitForTab(tabId: string) {
    updateTab(tabId, (tab) => {
      tab.sftpHeightRatio = defaultSftpHeightRatio;
    });
    sftpCollapsedByTab.value = {
      ...sftpCollapsedByTab.value,
      [tabId]: false,
    };
  }

  function resizeSftpSplit(tabId: string, ratio: number) {
    updateTab(tabId, (tab) => {
      tab.sftpHeightRatio = Math.min(Math.max(ratio, 0.18), 0.7);
    });
  }

  function renameTerminalTab(tabId: string, title: string) {
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      return;
    }

    updateTab(tabId, (tab) => {
      tab.title = trimmedTitle;
    });
  }

  async function closeOtherTerminalTabs(tabId: string) {
    const tabIds = tabs.value.filter((tab) => tab.id !== tabId).map((tab) => tab.id);

    for (const id of tabIds) {
      await closeTerminalTabById(id);
    }

    setActiveTab(tabId);
  }

  async function reconnectTerminalTab(tabId: string) {
    const tab = tabs.value.find((item) => item.id === tabId);

    if (!tab) {
      return;
    }

    await cancelTabTransfers(tab);
    clearTerminalWriteQueue(tab.id);

    if (tab.terminalSessionId && isTauri()) {
      try {
        await closeTerminalTab({ terminalId: tab.terminalSessionId });
      } catch (error) {
        tab.output += `\r\n[terminal close failed: ${formatError(error)}]\r\n`;
      }
    }

    if (tab.terminalSessionId) {
      const { [tab.terminalSessionId]: _removedOutput, ...rest } = pendingTerminalOutput.value;
      pendingTerminalOutput.value = rest;
    }

    resetTabConnectionState(tab, { clearOutput: true });

    activeTabId.value = tab.id;
    void ensureTerminalForTab(tab.id);
  }

  async function retryServerConnection(serverId: string) {
    const existingTab = tabs.value.find((tab) => tab.serverProfileId === serverId);

    if (existingTab) {
      await disconnectServerProfile(serverId);
      await reconnectTerminalTab(existingTab.id);
      return;
    }

    const server = useServerStore().servers.find((item) => item.id === serverId);

    if (server) {
      openServerInNewTab(server);
    }
  }

  async function disconnectServerProfile(serverId: string) {
    if (!isTauri()) {
      return;
    }

    const serverStore = useServerStore();
    const sessionId = serverSessionByProfileId.value[serverId];

    if (!sessionId) {
      serverStore.setServerStatus(serverId, "disconnected", { lastError: undefined });
      tabs.value
        .filter((tab) => tab.serverProfileId === serverId)
        .forEach((tab) => {
          clearTerminalWriteQueue(tab.id);
          markTabDisconnected(tab, "connection disconnected");
        });
      return;
    }

    serverStore.setServerStatus(serverId, "disconnecting", { lastError: undefined });

    try {
      await disconnectServer({ sessionId });
      removeServerSession(serverId);
      tabs.value
        .filter((tab) => tab.serverProfileId === serverId || tab.serverSessionId === sessionId)
        .forEach((tab) => {
          clearTerminalWriteQueue(tab.id);
          markTabDisconnected(tab, "connection disconnected");
        });
    } catch (error) {
      serverStore.setServerStatus(serverId, "error", { lastError: formatError(error) });
    }
  }

  async function cleanupConnections() {
    tabs.value.forEach((tab) => {
      clearTerminalWriteQueue(tab.id);
      resetTabConnectionState(tab, { clearOutput: false });
      tab.status = "idle";
    });
    serverSessionByProfileId.value = {};

    const serverStore = useServerStore();
    serverStore.servers.forEach((server) => {
      serverStore.setServerStatus(server.id, "disconnected", { lastError: undefined });
    });

    if (isTauri()) {
      await cleanupSshSessions();
    }
  }

  function updateTab(tabId: string, updater: (tab: (typeof tabs.value)[number]) => void) {
    const tab = tabs.value.find((item) => item.id === tabId);

    if (tab) {
      updater(tab);
    }
  }

  function appendTerminalOutput(terminalId: string, data: string) {
    const parsed = extractTerminalCwd(data);
    const tab = tabs.value.find((item) => item.terminalSessionId === terminalId);

    if (!tab) {
      const visibleData = parsed.visibleData;
      pendingTerminalOutput.value = {
        ...pendingTerminalOutput.value,
        [terminalId]: `${pendingTerminalOutput.value[terminalId] ?? ""}${visibleData}`,
      };
      return;
    }

    if (parsed.cwd) {
      handleTerminalCwdChanged(tab, parsed.cwd);
    }

    tab.output += parsed.visibleData;
  }

  function extractTerminalCwd(data: string) {
    let cwd: string | undefined;
    let visibleData = data.replace(CWD_OSC_PATTERN, (_match, nextCwd: string) => {
      cwd = nextCwd;
      return "";
    });

    for (const pattern of CWD_HOOK_ECHO_PATTERNS) {
      visibleData = visibleData.replace(pattern, "");
    }

    return { cwd, visibleData };
  }

  function handleTerminalCwdChanged(tab: TerminalTab, cwd: string) {
    const normalizedCwd = cwd.trim();

    if (!normalizedCwd || tab.cwd === normalizedCwd) {
      return;
    }

    tab.cwd = normalizedCwd;

    if (tab.sftpFollowTerminalCwd) {
      void refreshSftpForTab(tab.id, normalizedCwd);
    }
  }

  function resetTabConnectionState(tab: TerminalTab, options: { clearOutput: boolean }) {
    tab.serverSessionId = undefined;
    tab.terminalSessionId = undefined;
    tab.cwdHookTerminalSessionId = undefined;
    tab.reconnectOnInput = false;
    tab.sftpFollowTerminalCwdError = undefined;
    tab.sftpFollowTerminalCwdStatus = tab.sftpFollowTerminalCwd ? "enabled" : "disabled";
    tab.status = "idle";

    if (options.clearOutput) {
      tab.output = "";
    }

    tab.sftp = {
      ...tab.sftp,
      currentPath: ".",
      entries: [],
      loading: false,
      loadingAction: undefined,
      loadingPath: undefined,
      selectedEntryPath: undefined,
      selectedCount: 0,
      transferSummary: "idle",
      activeDownloadId: undefined,
      activeDownloadName: undefined,
      activeDownloadProgress: undefined,
      activeUploadId: undefined,
      activeUploadName: undefined,
      activeUploadProgress: undefined,
      uploadQueueCompleted: undefined,
      uploadQueuePending: undefined,
      uploadQueueTotal: undefined,
      transferProgress: undefined,
      transferQueue: [],
    };
  }

  function markTabDisconnected(tab: TerminalTab, reason: string) {
    if (tab.reconnectOnInput) {
      tab.status = tab.status === "error" ? "error" : "warning";
      return;
    }

    clearTerminalWriteQueue(tab.id);
    resetTabConnectionState(tab, { clearOutput: false });
    tab.status = "warning";
    tab.reconnectOnInput = true;
    tab.output += reconnectPrompt(reason);
  }

  function removeServerSession(serverId: string) {
    const sessionId = serverSessionByProfileId.value[serverId];
    const { [serverId]: _removed, ...rest } = serverSessionByProfileId.value;
    serverSessionByProfileId.value = rest;

    if (sessionId) {
      const { [sessionId]: _removedMonitor, ...monitorRest } = monitorBySessionId.value;
      const { [sessionId]: _removedHealthCheck, ...healthCheckRest } = healthCheckInFlight.value;
      const { [sessionId]: _removedLastHealthCheck, ...lastHealthCheckRest } = lastHealthCheckAt.value;
      monitorBySessionId.value = monitorRest;
      healthCheckInFlight.value = healthCheckRest;
      lastHealthCheckAt.value = lastHealthCheckRest;
    }
  }

  function recordDiagnostic(scope: DiagnosticScope, message: string, context?: Record<string, unknown>) {
    useDiagnosticsStore().record({
      context,
      level: "error",
      message,
      scope,
    });
  }

  function recordTabDiagnostic(scope: DiagnosticScope, tab: TerminalTab, message: string, context?: Record<string, unknown>) {
    recordDiagnostic(scope, message, {
      serverProfileId: tab.serverProfileId,
      serverSessionId: tab.serverSessionId,
      tabId: tab.id,
      terminalSessionId: tab.terminalSessionId,
      ...context,
    });
  }

  async function refreshActiveMonitor() {
    const sessionId = activeTab.value?.serverSessionId;

    if (!sessionId) {
      return;
    }

    await refreshMonitorForSession(sessionId);
  }

  async function refreshMonitorForSession(serverSessionId: string) {
    if (!isTauri()) {
      return;
    }

    try {
      const snapshot = await readServerMonitor({ serverSessionId });
      monitorBySessionId.value = {
        ...monitorBySessionId.value,
        [serverSessionId]: snapshot,
      };
    } catch (error) {
      recordDiagnostic("system", "读取服务器监控信息失败", {
        error: formatError(error),
        serverSessionId,
      });
      monitorBySessionId.value = {
        ...monitorBySessionId.value,
        [serverSessionId]: { error: formatError(error) },
      };
    }
  }

  function startMonitorRefresh() {
    if (monitorRefreshTimer.value) {
      return;
    }

    monitorRefreshTimer.value = window.setInterval(() => {
      void refreshActiveMonitor();
    }, 8000);
  }

  function startHealthRefresh() {
    if (healthRefreshTimer.value) {
      return;
    }

    healthRefreshTimer.value = window.setInterval(() => {
      void checkAllServerSessionsHealth();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  function stopMonitorRefresh() {
    if (!monitorRefreshTimer.value) {
      return;
    }

    window.clearInterval(monitorRefreshTimer.value);
    monitorRefreshTimer.value = undefined;
  }

  function stopHealthRefresh() {
    if (!healthRefreshTimer.value) {
      return;
    }

    window.clearInterval(healthRefreshTimer.value);
    healthRefreshTimer.value = undefined;
  }

  function handleAppResume() {
    void checkAllServerSessionsHealth({ force: true });
    void refreshActiveMonitor();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible") {
      handleAppResume();
    }
  }

  async function checkAllServerSessionsHealth(options: { force?: boolean } = {}) {
    if (!isTauri()) {
      return;
    }

    const sessionIds = Array.from(new Set(Object.values(serverSessionByProfileId.value).filter(Boolean)));

    await Promise.all(sessionIds.map((sessionId) => checkServerSessionHealthById(sessionId, options)));
  }

  async function checkServerSessionHealthById(
    serverSessionId: string,
    options: { force?: boolean } = {},
  ) {
    const now = Date.now();

    if (healthCheckInFlight.value[serverSessionId]) {
      return;
    }

    if (!options.force && now - (lastHealthCheckAt.value[serverSessionId] ?? 0) < HEALTH_CHECK_MIN_GAP_MS) {
      return;
    }

    healthCheckInFlight.value = {
      ...healthCheckInFlight.value,
      [serverSessionId]: true,
    };
    lastHealthCheckAt.value = {
      ...lastHealthCheckAt.value,
      [serverSessionId]: now,
    };

    try {
      await checkServerSessionHealth({ serverSessionId });
      const currentMonitor = monitorBySessionId.value[serverSessionId];

      if (currentMonitor?.error?.startsWith("connection health check")) {
        const { [serverSessionId]: _removed, ...rest } = monitorBySessionId.value;
        monitorBySessionId.value = rest;
      }
    } catch (error) {
      recordDiagnostic("connection", "连接健康检查失败", {
        error: formatError(error),
        serverSessionId,
      });
      monitorBySessionId.value = {
        ...monitorBySessionId.value,
        [serverSessionId]: { error: formatError(error) },
      };
    } finally {
      const { [serverSessionId]: _removed, ...rest } = healthCheckInFlight.value;
      healthCheckInFlight.value = rest;
    }
  }

  function reconnectPrompt(reason: string) {
    return `\r\n[${reason}]\r\n[按任意键重新连接]\r\n`;
  }

  function appendLocalOutput(tabId: string, data: string) {
    updateTab(tabId, (tab) => {
      tab.output += data;
    });
  }

  async function initTerminalEvents() {
    if (terminalEventsReady.value || !isTauri()) {
      terminalEventsReady.value = true;
      return;
    }

    const outputUnlisten = await listen<TerminalOutputEvent>("terminal_output", (event) => {
      appendTerminalOutput(event.payload.terminalId, event.payload.data);
    });
    const closedUnlisten = await listen<TerminalClosedEvent>("terminal_closed", (event) => {
      updateTabByTerminalId(event.payload.terminalId, (tab) => {
        recordDiagnostic("terminal", "终端会话已关闭", {
          reason: event.payload.reason,
          serverProfileId: tab.serverProfileId,
          serverSessionId: tab.serverSessionId,
          tabId: tab.id,
          terminalId: event.payload.terminalId,
        });
        markTabDisconnected(tab, `terminal closed${event.payload.reason ? `: ${event.payload.reason}` : ""}`);
      });
    });
    const statusUnlisten = await listen<ConnectionStatusChangedEvent>("connection_status_changed", (event) => {
      const serverStore = useServerStore();
      const status = mapServerSessionStatus(event.payload.status);
      serverStore.setServerStatus(
        event.payload.profileId,
        status,
        event.payload.status === "connected"
          ? { lastConnectedAt: new Date().toLocaleString(), lastError: undefined }
          : event.payload.status === "error"
            ? { lastError: event.payload.error }
            : { lastError: undefined },
      );
      if (status === "error") {
        recordDiagnostic("connection", "连接状态变为错误", {
          error: event.payload.error,
          profileId: event.payload.profileId,
          sessionId: event.payload.sessionId,
        });
      }
      if (status === "disconnected" || status === "error") {
        removeServerSession(event.payload.profileId);
      }
      syncTabsForConnectionStatus(event.payload.profileId, event.payload.sessionId, status, event.payload.error);
    });
    const sftpDownloadUnlisten = await listen<SftpDownloadProgressEvent>("sftp_download_progress", (event) => {
      handleSftpDownloadProgress(event.payload);
    });
    const sftpUploadUnlisten = await listen<SftpUploadProgressEvent>("sftp_upload_progress", (event) => {
      handleSftpUploadProgress(event.payload);
    });
    const localEditSyncUnlisten = await listen<LocalEditSyncEvent>("sftp_local_edit_sync", (event) => {
      handleLocalEditSync(event.payload);
    });

    terminalUnlisteners.value = [
      outputUnlisten,
      closedUnlisten,
      statusUnlisten,
      sftpDownloadUnlisten,
      sftpUploadUnlisten,
      localEditSyncUnlisten,
    ];
    terminalEventsReady.value = true;
    startMonitorRefresh();
    startHealthRefresh();
    window.addEventListener("focus", handleAppResume);
    window.addEventListener("online", handleAppResume);
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  function updateTabByTerminalId(terminalId: string, updater: (tab: (typeof tabs.value)[number]) => void) {
    const tab = tabs.value.find((item) => item.terminalSessionId === terminalId);

    if (tab) {
      updater(tab);
    }
  }

  function mapServerSessionStatus(status: ConnectionStatusChangedEvent["status"]): ServerConnection["status"] {
    if (status === "connected" || status === "connecting" || status === "disconnecting" || status === "error") {
      return status;
    }

    return "disconnected";
  }

  function syncTabsForConnectionStatus(
    profileId: string,
    sessionId: string,
    status: ServerConnection["status"],
    error?: string,
  ) {
    if (status === "connected" || status === "connecting") {
      return;
    }

    tabs.value
      .filter((tab) => tab.serverProfileId === profileId || tab.serverSessionId === sessionId)
      .forEach((tab) => {
        if (tab.reconnectOnInput) {
          tab.status = status === "error" ? "error" : "warning";
          return;
        }

        if (status === "error") {
          markTabDisconnected(tab, `ssh connection error${error ? `: ${error}` : ""}`);
          tab.status = "error";
        } else {
          markTabDisconnected(tab, "connection disconnected");
        }
      });
  }

  async function ensureTerminalForTab(tabId = activeTabId.value, serverOverride?: ServerConnection) {
    const tab = tabs.value.find((item) => item.id === tabId);

    if (!tab || tab.terminalSessionId) {
      return;
    }

    if (!isTauri()) {
      tab.terminalSessionId = `browser-terminal-${tab.id}`;
      return;
    }

    await initTerminalEvents();

    const serverStore = useServerStore();
    const server =
      serverOverride ??
      (tab.serverProfileId
        ? serverStore.servers.find((item) => item.id === tab.serverProfileId)
        : undefined) ??
      serverStore.activeServer;

    if (!server) {
      tab.status = "error";
      tab.reconnectOnInput = true;
      tab.output = `[ssh connection failed: no server selected]\r\n[按任意键重新连接]\r\n`;
      recordDiagnostic("connection", "SSH 连接失败：未选择服务器", { tabId });
      return;
    }

    tab.status = "active";
    tab.reconnectOnInput = false;
    tab.output = "";

    if (server.authType !== "password") {
      tab.status = "error";
      tab.reconnectOnInput = true;
      tab.output = "[ssh connection failed: MVP currently supports password login only]\r\n[按任意键重新连接]\r\n";
      recordDiagnostic("connection", "SSH 连接失败：暂不支持该认证方式", {
        authType: server.authType,
        serverId: server.id,
        tabId,
      });
      return;
    }

    const password = await resolveServerPassword(server);

    if (!password) {
      tab.status = "error";
      tab.reconnectOnInput = true;
      tab.output = server.credentialStorage === "keychain"
        ? "[ssh connection failed: system credential password is missing, please edit the connection and enter the password again]\r\n[按任意键重新连接]\r\n"
        : "[ssh connection failed: password is not saved for this connection]\r\n[按任意键重新连接]\r\n";
      recordDiagnostic("credential", "SSH 连接失败：密码凭据缺失", {
        credentialStorage: server.credentialStorage,
        serverId: server.id,
        tabId,
      });
      return;
    }

    serverStore.setServerStatus(server.id, "connecting", { lastError: undefined });

    try {
      const serverSession =
        tab.serverSessionId ??
        serverSessionByProfileId.value[server.id] ??
        (
          await connectServer({
            profileId: server.id,
            name: server.name,
            host: server.host,
            port: server.port,
            user: server.user,
            authType: server.authType,
            password,
            privateKeyPath: server.privateKeyPath,
            hostKeyFingerprint: server.hostKeyFingerprint,
          })
        ).id;

      const terminal = await openTerminalTab({
        serverSessionId: serverSession,
        title: tab.title,
        cwd: tab.cwd,
      });

      tab.serverSessionId = serverSession;
      serverSessionByProfileId.value = {
        ...serverSessionByProfileId.value,
        [server.id]: serverSession,
      };
      tab.terminalSessionId = terminal.id;
      if (tab.sftpFollowTerminalCwd) {
        tab.sftpFollowTerminalCwdStatus = "enabling";
        const installed = await installTerminalCwdHook(tab);
        tab.sftpFollowTerminalCwdStatus = installed ? "enabled" : tab.sftpFollowTerminalCwdStatus;
      }
      await refreshSftpForTab(tab.id, tab.sftpFollowTerminalCwd ? tab.cwd : ".");
      void refreshMonitorForSession(serverSession);
    } catch (error) {
      removeServerSession(server.id);
      const formattedError = formatError(error);
      recordDiagnostic("connection", "SSH 连接失败", {
        error: formattedError,
        serverId: server.id,
        tabId: tab.id,
      });
      const hostKeyError = parseHostKeyError(formattedError);
      if (hostKeyError?.kind === "unknown") {
        pendingHostKeyTrust.value = {
          kind: "unknown",
          newFingerprint: hostKeyError.fingerprint,
          serverId: server.id,
          tabId: tab.id,
        };
      } else if (hostKeyError?.kind === "mismatch") {
        pendingHostKeyTrust.value = {
          kind: "mismatch",
          oldFingerprint: server.hostKeyFingerprint,
          newFingerprint: hostKeyError.fingerprint,
          serverId: server.id,
          tabId: tab.id,
        };
        tab.output += "\r\n[ssh host key mismatch: saved fingerprint does not match the server]\r\n[请在弹窗中确认是否更新主机指纹]\r\n";
      }
      serverStore.setServerStatus(server.id, "error", { lastError: formattedError });
      tab.status = "error";
      tab.reconnectOnInput = true;
      tab.output += reconnectPrompt(`ssh connection failed: ${formattedError}`);
      return;
    }

    tab.status = "active";
    tab.reconnectOnInput = false;
    serverStore.setServerStatus(server.id, "connected", {
      lastConnectedAt: new Date().toLocaleString(),
      lastError: undefined,
    });

    if (tab.terminalSessionId && pendingTerminalOutput.value[tab.terminalSessionId]) {
      tab.output += pendingTerminalOutput.value[tab.terminalSessionId];
      const { [tab.terminalSessionId]: _flushed, ...rest } = pendingTerminalOutput.value;
      pendingTerminalOutput.value = rest;
    }
  }

  async function resolveServerPassword(server: ServerConnection) {
    if (server.credentialStorage === "plain") {
      return server.password;
    }

    if (server.credentialStorage === "keychain" && isTauri()) {
      return await readKeychainPassword(server.id);
    }

    return undefined;
  }

  function parseHostKeyError(error: string) {
    const unknown = error.match(/UNKNOWN_HOST_KEY:([^\s]+)/);
    if (unknown?.[1]) {
      return { kind: "unknown" as const, fingerprint: unknown[1] };
    }

    const mismatch = error.match(/HOST_KEY_MISMATCH:([^\s]+)/);
    if (mismatch?.[1]) {
      return { kind: "mismatch" as const, fingerprint: mismatch[1] };
    }

    return undefined;
  }

  function cancelHostKeyTrust() {
    pendingHostKeyTrust.value = undefined;
  }

  function confirmHostKeyTrust() {
    const pending = pendingHostKeyTrust.value;

    if (!pending) {
      return;
    }

    const serverStore = useServerStore();
    serverStore.updateServerHostKeyFingerprint(pending.serverId, pending.newFingerprint);
    pendingHostKeyTrust.value = undefined;
    const tab = tabs.value.find((item) => item.id === pending.tabId);
    if (tab) {
      resetTabConnectionState(tab, { clearOutput: true });
      tab.output = "[reconnecting with trusted host key...]\r\n";
      void ensureTerminalForTab(tab.id);
    }
  }

  async function handleTerminalInput(tabId: string, payload: TerminalInputPayload | string) {
    const input = normalizeTerminalInputPayload(payload);
    const tab = tabs.value.find((item) => item.id === tabId);

    if (!tab) {
      return;
    }

    if (tab.reconnectOnInput) {
      resetTabConnectionState(tab, { clearOutput: true });
      tab.output = "[reconnecting...]\r\n";
      void ensureTerminalForTab(tabId);
      return;
    }

    if (!tab.terminalSessionId) {
      await ensureTerminalForTab(tabId);
    }

    if (!isTauri()) {
      appendLocalOutput(tabId, input.data === "\r" ? "\r\n$ " : input.data);
      return;
    }

    if (!tab.terminalSessionId) {
      return;
    }

    if (input.kind === "paste" && input.data.length >= TERMINAL_PASTE_CONFIRM_THRESHOLD) {
      const confirmed = await useNotificationStore().confirm({
        title: "确认粘贴大量文本",
        message: `即将向当前终端粘贴 ${formatBytes(input.data.length)} 内容。请确认目标终端处于正确位置，避免误执行命令。`,
        cancelText: "取消",
        confirmText: "继续粘贴",
      });

      if (!confirmed) {
        return;
      }
    }

    enqueueTerminalWrite(tabId, input);
  }

  function normalizeTerminalInputPayload(payload: TerminalInputPayload | string): TerminalInputPayload {
    return typeof payload === "string"
      ? { data: payload, kind: "key" }
      : payload;
  }

  function enqueueTerminalWrite(tabId: string, input: TerminalInputPayload) {
    if (!input.data) {
      return;
    }

    const existing = terminalWriteQueues.value[tabId];
    const queue = existing ?? { items: [], running: false };
    const queuedBytes = queue.items.reduce((total, item) => total + item.data.length, 0);

    if (queuedBytes + input.data.length > TERMINAL_WRITE_QUEUE_LIMIT) {
      useNotificationStore().showToast("终端输入队列过大，请等待当前粘贴完成后再继续。", "error");
      return;
    }

    queue.items.push(input);

    if (!existing) {
      terminalWriteQueues.value = {
        ...terminalWriteQueues.value,
        [tabId]: queue,
      };
    }

    void flushTerminalWriteQueue(tabId);
  }

  async function flushTerminalWriteQueue(tabId: string) {
    const queue = terminalWriteQueues.value[tabId];

    if (!queue || queue.running) {
      return;
    }

    queue.running = true;

    try {
      while (queue.items.length) {
        const tab = tabs.value.find((item) => item.id === tabId);

        if (!tab?.terminalSessionId || tab.reconnectOnInput) {
          queue.items = [];
          break;
        }

        const input = queue.items.shift();

        if (!input) {
          continue;
        }

        for (const chunk of splitTerminalInput(input.data)) {
          const currentTab = tabs.value.find((item) => item.id === tabId);

          if (!currentTab?.terminalSessionId || currentTab.reconnectOnInput) {
            queue.items = [];
            return;
          }

          await terminalWrite({
            terminalId: currentTab.terminalSessionId,
            data: chunk,
          });

          if (input.kind === "paste") {
            await waitForTerminalWriteDrain();
          }
        }
      }
    } catch (error) {
      const tab = tabs.value.find((item) => item.id === tabId);

      if (tab) {
        recordTabDiagnostic("terminal", tab, "终端写入失败", {
          error: formatError(error),
        });
        markTabDisconnected(tab, `terminal write failed: ${formatError(error)}`);
        tab.status = "error";
      }
    } finally {
      queue.running = false;
      if (!queue.items.length) {
        clearTerminalWriteQueue(tabId);
      }
    }
  }

  function splitTerminalInput(data: string) {
    const chunks: string[] = [];

    for (let offset = 0; offset < data.length; offset += TERMINAL_WRITE_CHUNK_SIZE) {
      chunks.push(data.slice(offset, offset + TERMINAL_WRITE_CHUNK_SIZE));
    }

    return chunks;
  }

  function waitForTerminalWriteDrain() {
    return new Promise<void>((resolve) => window.setTimeout(resolve, 4));
  }

  function clearTerminalWriteQueue(tabId: string) {
    const queue = terminalWriteQueues.value[tabId];

    if (queue) {
      queue.items = [];
    }

    const { [tabId]: _removed, ...rest } = terminalWriteQueues.value;
    terminalWriteQueues.value = rest;
  }

  async function refreshSftpForTab(
    tabId: string,
    path?: string,
    options: { loadingAction?: "open" | "refresh" | "delete"; loadingPath?: string } = {},
  ) {
    const tab = tabs.value.find((item) => item.id === tabId);

    if (!tab?.serverSessionId || !isTauri()) {
      return;
    }

    const targetPath = path ?? (tab.sftp.currentPath || ".");
    const previousSftp = tab.sftp;
    const hasActiveTransfer = Boolean(
      previousSftp.activeDownloadId
      || previousSftp.activeUploadId
      || uploadQueues.value[tab.id],
    );

    tab.sftp.loading = true;
    tab.sftp.loadingAction = options.loadingAction ?? (path ? "open" : "refresh");
    tab.sftp.loadingPath = options.loadingPath ?? targetPath;
    tab.sftp.transferSummary = hasActiveTransfer ? previousSftp.transferSummary : "loading";

    try {
      const directory = await listSftpDirectory({
        serverSessionId: tab.serverSessionId,
        path: targetPath,
      });

      tab.sftp = {
        currentPath: directory.currentPath,
        entries: directory.entries,
        loading: false,
        loadingAction: undefined,
        loadingPath: undefined,
        selectedEntryPath: undefined,
        selectedCount: 0,
        transferSummary: hasActiveTransfer ? previousSftp.transferSummary : `${directory.entries.length} items`,
        activeDownloadId: previousSftp.activeDownloadId,
        activeDownloadName: previousSftp.activeDownloadName,
        activeDownloadProgress: previousSftp.activeDownloadProgress,
        activeUploadId: previousSftp.activeUploadId,
        activeUploadName: previousSftp.activeUploadName,
        activeUploadProgress: previousSftp.activeUploadProgress,
        uploadQueueCompleted: previousSftp.uploadQueueCompleted,
        uploadQueuePending: previousSftp.uploadQueuePending,
        uploadQueueTotal: previousSftp.uploadQueueTotal,
        transferProgress: previousSftp.transferProgress,
        transferQueue: previousSftp.transferQueue ?? [],
      };
    } catch (error) {
      recordTabDiagnostic("sftp", tab, "SFTP 目录读取失败", {
        error: formatError(error),
        path: targetPath,
      });
      tab.sftp.loading = false;
      tab.sftp.loadingAction = undefined;
      tab.sftp.loadingPath = undefined;
      tab.sftp.transferSummary = "error";
      tab.status = "warning";
      tab.output += `\r\n[sftp failed: ${formatError(error)}]\r\n`;
    }
  }

  function handleSftpEntryOpen(tabId: string, entry: RemoteFileEntry) {
    if (entry.kind !== "directory") {
      return;
    }

    updateTab(tabId, (tab) => {
      tab.sftpFollowTerminalCwd = false;
      tab.sftpFollowTerminalCwdError = undefined;
      tab.sftpFollowTerminalCwdStatus = "disabled";
      tab.sftp.selectedEntryPath = entry.path;
      tab.sftp.selectedCount = 1;
    });
    void refreshSftpForTab(tabId, entry.path);
  }

  function handleSftpSelectEntry(tabId: string, entry: RemoteFileEntry) {
    updateTab(tabId, (tab) => {
      tab.sftp = {
        ...tab.sftp,
        selectedEntryPath: entry.path,
        selectedCount: 1,
      };
    });
  }

  async function handleSftpNewFolder(tabId: string) {
    const tab = tabs.value.find((item) => item.id === tabId);

    if (!tab?.serverSessionId || !isTauri()) {
      return;
    }

    const folderName = window.prompt("新建文件夹名称")?.trim();

    if (!folderName) {
      return;
    }

    try {
      await createSftpDirectory({
        serverSessionId: tab.serverSessionId,
        path: joinRemotePath(tab.sftp.currentPath || ".", folderName),
      });
      await refreshSftpForTab(tab.id, tab.sftp.currentPath);
    } catch (error) {
      recordTabDiagnostic("sftp", tab, "SFTP 新建文件夹失败", {
        error: formatError(error),
        path: joinRemotePath(tab.sftp.currentPath || ".", folderName),
      });
      tab.status = "warning";
      tab.sftp.transferSummary = "mkdir error";
      tab.output += `\r\n[sftp mkdir failed: ${formatError(error)}]\r\n`;
    }
  }

  async function handleSftpRenameEntry(tabId: string, entry: RemoteFileEntry, name: string) {
    const tab = tabs.value.find((item) => item.id === tabId);

    if (!tab?.serverSessionId || !isTauri()) {
      return;
    }

    const nextName = name.trim();

    if (!nextName || nextName === entry.name) {
      return;
    }

    try {
      await renameSftpEntry({
        serverSessionId: tab.serverSessionId,
        sourcePath: entry.path,
        targetPath: joinRemotePath(parentPath(entry.path), nextName),
      });
      await refreshSftpForTab(tab.id, tab.sftp.currentPath);
    } catch (error) {
      recordTabDiagnostic("sftp", tab, "SFTP 重命名失败", {
        error: formatError(error),
        sourcePath: entry.path,
        targetName: nextName,
      });
      tab.status = "warning";
      tab.sftp.transferSummary = "rename error";
      tab.output += `\r\n[sftp rename failed: ${formatError(error)}]\r\n`;
    }
  }

  async function handleSftpDeleteEntry(tabId: string, entry: RemoteFileEntry) {
    const tab = tabs.value.find((item) => item.id === tabId);

    if (!tab?.serverSessionId || !isTauri()) {
      return;
    }

    const message = entry.kind === "directory"
      ? `确定删除文件夹 "${entry.name}" 及其所有内容吗？`
      : `确定删除 "${entry.name}" 吗？`;

    const notification = useNotificationStore();
    if (!await notification.confirm({
      title: "删除远端项目",
      message,
      confirmText: "删除",
    })) {
      return;
    }

    try {
      await deleteSftpEntry({
        serverSessionId: tab.serverSessionId,
        path: entry.path,
        isDirectory: entry.kind === "directory",
      });
      await refreshSftpForTab(tab.id, tab.sftp.currentPath, {
        loadingAction: "delete",
        loadingPath: entry.path,
      });
      notification.showToast("远端项目已删除。", "success");
    } catch (error) {
      recordTabDiagnostic("sftp", tab, "SFTP 删除失败", {
        error: formatError(error),
        isDirectory: entry.kind === "directory",
        path: entry.path,
      });
      tab.status = "warning";
      tab.sftp.transferSummary = "delete error";
      tab.output += `\r\n[sftp delete failed: ${formatError(error)}]\r\n`;
      notification.showToast(`删除失败：${formatError(error)}`, "error");
    }
  }

  async function handleSftpEditEntry(tabId: string, entry: RemoteFileEntry) {
    const tab = tabs.value.find((item) => item.id === tabId);

    if (!tab?.serverSessionId || !isTauri()) {
      return;
    }

    if (entry.kind !== "file") {
      tab.sftp.transferSummary = "files only";
      return;
    }

    tab.sftp.transferSummary = "preparing edit";

    try {
      const editSession = await openSftpLocalEdit({
        serverSessionId: tab.serverSessionId,
        remotePath: entry.path,
      });

      await openPath(editSession.localPath);
      tab.sftp.transferSummary = "watching edits";
    } catch (error) {
      recordTabDiagnostic("sftp", tab, "SFTP 本地编辑失败", {
        error: formatError(error),
        path: entry.path,
      });
      tab.status = "warning";
      tab.sftp.transferSummary = `edit error: ${shortError(error)}`;
    }
  }

  async function handleSftpDownload(tabId: string) {
    const tab = tabs.value.find((item) => item.id === tabId);

    if (!tab?.serverSessionId || !isTauri()) {
      return;
    }

    const selectedEntry = tab.sftp.entries.find((entry) => entry.path === tab.sftp.selectedEntryPath);

    if (!selectedEntry) {
      tab.sftp.transferSummary = "select a file";
      return;
    }

    if (selectedEntry.kind === "directory") {
      const localDirectory = await open({
        directory: true,
        multiple: false,
        title: "选择下载目录",
      });

      if (!localDirectory || Array.isArray(localDirectory)) {
        return;
      }

      const transferId = `download-${tab.id}-${Date.now()}`;
      tab.sftp.transferSummary = "download 0%";
      tab.sftp.activeDownloadId = transferId;
      tab.sftp.activeDownloadName = selectedEntry.name;
      tab.sftp.activeDownloadProgress = 0;
      tab.sftp.transferProgress = 0;
      updateSftpTransferQueue(tab);

      try {
        await downloadSftpDirectory({
          transferId,
          serverSessionId: tab.serverSessionId,
          remotePath: selectedEntry.path,
          localDirectory,
        });
      } catch (error) {
        recordTabDiagnostic("sftp", tab, "SFTP 文件夹下载失败", {
          error: formatError(error),
          remotePath: selectedEntry.path,
          transferId,
        });
        tab.sftp.transferSummary = "download error";
        tab.sftp.activeDownloadId = undefined;
        tab.sftp.activeDownloadName = undefined;
        tab.sftp.activeDownloadProgress = undefined;
        tab.sftp.transferProgress = undefined;
        updateSftpTransferQueue(tab);
        tab.status = "warning";
        tab.output += `\r\n[sftp download failed: ${formatError(error)}]\r\n`;
      }
      return;
    }

    if (selectedEntry.kind !== "file") {
      tab.sftp.transferSummary = "files only";
      return;
    }

    const localPath = await save({
      defaultPath: selectedEntry.name,
      title: "保存下载文件",
    });

    if (!localPath) {
      return;
    }

    const transferId = `download-${tab.id}-${Date.now()}`;
    tab.sftp.transferSummary = "download 0%";
    tab.sftp.activeDownloadId = transferId;
    tab.sftp.activeDownloadName = selectedEntry.name;
    tab.sftp.activeDownloadProgress = 0;
    tab.sftp.transferProgress = 0;
    updateSftpTransferQueue(tab);

    try {
      await downloadSftpFile({
        transferId,
        serverSessionId: tab.serverSessionId,
        remotePath: selectedEntry.path,
        localPath,
      });
    } catch (error) {
      recordTabDiagnostic("sftp", tab, "SFTP 文件下载失败", {
        error: formatError(error),
        remotePath: selectedEntry.path,
        transferId,
      });
      tab.sftp.transferSummary = "download error";
      tab.sftp.activeDownloadId = undefined;
      tab.sftp.activeDownloadName = undefined;
      tab.sftp.activeDownloadProgress = undefined;
      tab.sftp.transferProgress = undefined;
      updateSftpTransferQueue(tab);
      tab.status = "warning";
      tab.output += `\r\n[sftp download failed: ${formatError(error)}]\r\n`;
    }
  }

  async function handleSftpUpload(tabId: string) {
    const tab = tabs.value.find((item) => item.id === tabId);

    if (!tab?.serverSessionId || !isTauri()) {
      return;
    }

    const localPath = await open({
      multiple: true,
      title: "选择上传文件",
    });

    if (!localPath) {
      return;
    }

    await enqueueSftpUploads(tab, Array.isArray(localPath) ? localPath : [localPath]);
  }

  async function handleSftpDroppedPaths(localPaths: string[]) {
    const tab = activeTab.value;

    if (!tab?.serverSessionId || !isTauri()) {
      return;
    }

    if (!localPaths.length) {
      return;
    }

    await enqueueSftpUploads(tab, localPaths);
  }

  async function enqueueSftpUploads(tab: TerminalTab, localPaths: string[]) {
    if (!tab.serverSessionId) {
      return;
    }

    tab.sftp.transferSummary = "preparing upload";
    updateSftpTransferQueue(tab);

    try {
      const preparedQueue = await prepareSftpUploadQueue({
        serverSessionId: tab.serverSessionId,
        localPaths,
        remoteDirectory: tab.sftp.currentPath || ".",
      });
      const pendingDirectories = [...preparedQueue.directories];
      const items = preparedQueue.files.map((file, index) => ({
        fileName: file.fileName,
        localPath: file.localPath,
        remotePath: file.remotePath,
        ensureDirectories: index === 0 ? pendingDirectories : [],
      }));

      if (!items.length) {
        await ensureRemoteDirectories(tab, pendingDirectories);
        tab.sftp.transferSummary = pendingDirectories.length ? "folder uploaded" : "invalid file";
        updateSftpTransferQueue(tab);
        await refreshSftpForTab(tab.id, tab.sftp.currentPath);
        return;
      }

      const queue = getOrCreateUploadQueue(tab.id);
      queue.items.push(...items);
      queue.cancelled = false;
      queue.total += items.length;

      tab.sftp.uploadQueueCompleted = queue.completed;
      tab.sftp.uploadQueuePending = queue.items.length;
      tab.sftp.uploadQueueTotal = queue.total;
      tab.sftp.transferSummary = queue.running
        ? `queued ${queue.items.length}`
        : `queued ${items.length}`;
      updateSftpTransferQueue(tab);

      if (!queue.running) {
        void runNextSftpUpload(tab.id);
      }
    } catch (error) {
      recordTabDiagnostic("sftp", tab, "SFTP 上传队列准备失败", {
        error: formatError(error),
        localPaths,
        remoteDirectory: tab.sftp.currentPath || ".",
      });
      tab.sftp.transferSummary = "upload prepare error";
      updateSftpTransferQueue(tab);
      tab.status = "warning";
      tab.output += `\r\n[sftp upload prepare failed: ${formatError(error)}]\r\n`;
    }
  }

  async function runNextSftpUpload(tabId: string) {
    const tab = tabs.value.find((item) => item.id === tabId);
    const queue = uploadQueues.value[tabId];

    if (!tab?.serverSessionId || !queue || queue.running) {
      return;
    }

    const item = queue.items.shift();

    if (!item || queue.cancelled) {
      resetUploadQueueState(tab);
      removeUploadQueue(tabId);
      return;
    }

    queue.running = true;
    queue.current = item;
    const transferId = `upload-${tab.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    tab.sftp.activeUploadName = item.fileName;
    tab.sftp.activeUploadId = transferId;
    tab.sftp.activeUploadProgress = 0;
    tab.sftp.transferProgress = 0;
    tab.sftp.uploadQueueCompleted = queue.completed;
    tab.sftp.uploadQueuePending = queue.items.length;
    tab.sftp.uploadQueueTotal = queue.total;
    tab.sftp.transferSummary = formatUploadQueueSummary(queue, 0);
    updateSftpTransferQueue(tab);

    try {
      await ensureRemoteDirectories(tab, item.ensureDirectories);
      await uploadSftpFile({
        transferId,
        serverSessionId: tab.serverSessionId,
        localPath: item.localPath,
        remotePath: item.remotePath,
      });
    } catch (error) {
      recordTabDiagnostic("sftp", tab, "SFTP 上传失败", {
        error: formatError(error),
        localPath: item.localPath,
        remotePath: item.remotePath,
        transferId,
      });
      resetUploadQueueState(tab, "upload error");
      removeUploadQueue(tab.id);
      queue.running = false;
      queue.current = undefined;
      tab.status = "warning";
      tab.output += `\r\n[sftp upload failed: ${formatError(error)}]\r\n`;
    }
  }

  async function handleSftpCancelDownload(tabId: string) {
    const tab = tabs.value.find((item) => item.id === tabId);
    const transferId = tab?.sftp.activeDownloadId;

    if (!transferId || !isTauri()) {
      return;
    }

    tab.sftp.transferSummary = "cancelling";
    updateSftpTransferQueue(tab);

    try {
      await cancelSftpDownload({ transferId });
    } catch (error) {
      recordTabDiagnostic("sftp", tab, "SFTP 下载取消失败", {
        error: formatError(error),
        transferId,
      });
      tab.sftp.transferSummary = "cancel failed";
      tab.status = "warning";
      tab.output += `\r\n[sftp cancel failed: ${formatError(error)}]\r\n`;
    }
  }

  async function handleSftpCancelUpload(tabId: string) {
    const tab = tabs.value.find((item) => item.id === tabId);
    const transferId = tab?.sftp.activeUploadId;
    const queue = uploadQueues.value[tabId];

    if (queue) {
      queue.cancelled = true;
      queue.items = [];
      if (tab) {
        updateSftpTransferQueue(tab);
      }
    }

    if (!transferId || !isTauri()) {
      if (tab) {
        resetUploadQueueState(tab, "cancelled");
        removeUploadQueue(tabId);
      }
      return;
    }

    tab.sftp.transferSummary = "cancelling";
    updateSftpTransferQueue(tab);

    try {
      await cancelSftpUpload({ transferId });
    } catch (error) {
      recordTabDiagnostic("sftp", tab, "SFTP 上传取消失败", {
        error: formatError(error),
        transferId,
      });
      tab.sftp.transferSummary = "cancel failed";
      tab.status = "warning";
      tab.output += `\r\n[sftp cancel failed: ${formatError(error)}]\r\n`;
    }
  }

  function handleSftpDownloadProgress(event: SftpDownloadProgressEvent) {
    const tab = tabs.value.find((item) => item.sftp.activeDownloadId === event.transferId);

    if (!tab) {
      return;
    }

    const progress = transferPercent(event.transferredBytes, event.totalBytes);

    if (event.status === "started" || event.status === "progress") {
      tab.sftp.transferProgress = progress;
      const fileName = remoteBasename(event.remotePath);
      tab.sftp.activeDownloadName = fileName || tab.sftp.activeDownloadName;
      tab.sftp.activeDownloadProgress = progress;
      const suffix = event.totalBytes
        ? `${progress}%`
        : formatBytes(event.transferredBytes);
      tab.sftp.transferSummary = fileName
        ? `download ${fileName} ${suffix}`
        : `download ${suffix}`;
      updateSftpTransferQueue(tab);
      return;
    }

    if (event.status === "completed") {
      tab.sftp.transferProgress = 100;
      tab.sftp.activeDownloadProgress = 100;
      tab.sftp.transferSummary = "downloaded";
      tab.sftp.activeDownloadId = undefined;
      tab.sftp.activeDownloadName = undefined;
      tab.sftp.activeDownloadProgress = undefined;
      tab.sftp.transferProgress = undefined;
      updateSftpTransferQueue(tab);
      return;
    }

    if (event.status === "cancelled") {
      tab.sftp.transferSummary = "cancelled";
      tab.sftp.activeDownloadId = undefined;
      tab.sftp.activeDownloadName = undefined;
      tab.sftp.activeDownloadProgress = undefined;
      tab.sftp.transferProgress = undefined;
      updateSftpTransferQueue(tab);
      return;
    }

    tab.sftp.transferSummary = "download error";
    tab.sftp.activeDownloadId = undefined;
    tab.sftp.activeDownloadName = undefined;
    tab.sftp.activeDownloadProgress = undefined;
    tab.sftp.transferProgress = undefined;
    updateSftpTransferQueue(tab);
    tab.status = "warning";
    recordTabDiagnostic("sftp", tab, "SFTP 下载任务失败", {
      error: event.error,
      remotePath: event.remotePath,
      transferId: event.transferId,
    });
    tab.output += `\r\n[sftp download failed${event.error ? `: ${event.error}` : ""}]\r\n`;
  }

  function handleSftpUploadProgress(event: SftpUploadProgressEvent) {
    const tab = tabs.value.find((item) => item.sftp.activeUploadId === event.transferId);

    if (!tab) {
      return;
    }

    const progress = transferPercent(event.transferredBytes, event.totalBytes);

    if (event.status === "started" || event.status === "progress") {
      tab.sftp.transferProgress = progress;
      tab.sftp.activeUploadProgress = progress;
      const queue = uploadQueues.value[tab.id];
      tab.sftp.transferSummary = queue
        ? formatUploadQueueSummary(queue, progress, event.transferredBytes, event.totalBytes)
        : event.totalBytes
          ? `upload ${progress}%`
          : `upload ${formatBytes(event.transferredBytes)}`;
      updateSftpTransferQueue(tab);
      return;
    }

    if (event.status === "completed") {
      tab.sftp.transferProgress = 100;
      tab.sftp.activeUploadProgress = 100;
      const queue = uploadQueues.value[tab.id];
      const hasPendingAfterCurrent = Boolean(queue && queue.items.length > 0);
      completeCurrentUpload(tab, "completed");

      if (hasPendingAfterCurrent) {
        void runNextSftpUpload(tab.id);
      } else {
        void refreshSftpForTab(tab.id, tab.sftp.currentPath);
      }
      return;
    }

    if (event.status === "cancelled") {
      completeCurrentUpload(tab, "cancelled");
      removeUploadQueue(tab.id);
      return;
    }

    completeCurrentUpload(tab, "error");
    removeUploadQueue(tab.id);
    tab.status = "warning";
    recordTabDiagnostic("sftp", tab, "SFTP 上传任务失败", {
      error: event.error,
      remotePath: event.remotePath,
      transferId: event.transferId,
    });
    tab.output += `\r\n[sftp upload failed${event.error ? `: ${event.error}` : ""}]\r\n`;
  }

  function handleLocalEditSync(event: LocalEditSyncEvent) {
    const tab = tabs.value.find((item) => item.serverSessionId === event.serverSessionId);

    if (!tab) {
      return;
    }

    if (event.status === "started") {
      tab.sftp.transferSummary = "syncing edit";
      return;
    }

    if (event.status === "completed") {
      tab.sftp.transferSummary = "edit synced";
      void refreshSftpForTab(tab.id, tab.sftp.currentPath);
      return;
    }

    tab.status = "warning";
    tab.sftp.transferSummary = event.error ? `sync error: ${shortError(event.error)}` : "sync error";
    recordTabDiagnostic("sftp", tab, "SFTP 本地编辑同步失败", {
      editId: event.editId,
      error: event.error,
      remotePath: event.remotePath,
    });
  }

  function getOrCreateUploadQueue(tabId: string) {
    const existingQueue = uploadQueues.value[tabId];

    if (existingQueue) {
      return existingQueue;
    }

    const queue: SftpUploadQueueState = {
      cancelled: false,
      completed: 0,
      items: [],
      running: false,
      total: 0,
    };
    uploadQueues.value = {
      ...uploadQueues.value,
      [tabId]: queue,
    };
    return queue;
  }

  async function ensureRemoteDirectories(tab: TerminalTab, directories: string[]) {
    if (!tab.serverSessionId || !directories.length) {
      return;
    }

    const uniqueDirectories = Array.from(new Set(directories));

    for (const directory of uniqueDirectories) {
      try {
        await createSftpDirectory({
          serverSessionId: tab.serverSessionId,
          path: directory,
        });
      } catch (error) {
        try {
          await listSftpDirectory({
            serverSessionId: tab.serverSessionId,
            path: directory,
          });
        } catch {
          throw error;
        }
      }
    }
  }

  function removeUploadQueue(tabId: string) {
    const { [tabId]: _removed, ...rest } = uploadQueues.value;
    uploadQueues.value = rest;
  }

  function completeCurrentUpload(tab: TerminalTab, status: "cancelled" | "completed" | "error") {
    const queue = uploadQueues.value[tab.id];

    if (queue?.current) {
      queue.completed += status === "completed" ? 1 : 0;
      queue.current = undefined;
      queue.running = false;
    }

    tab.sftp.activeUploadId = undefined;
    tab.sftp.activeUploadName = undefined;
    tab.sftp.activeUploadProgress = undefined;
    tab.sftp.transferProgress = undefined;
    tab.sftp.uploadQueueCompleted = queue?.completed;
    tab.sftp.uploadQueuePending = queue?.items.length;
    tab.sftp.uploadQueueTotal = queue?.total;
    updateSftpTransferQueue(tab);

    if (status === "completed" && queue && queue.items.length > 0) {
      tab.sftp.transferSummary = `queued ${queue.items.length}`;
      updateSftpTransferQueue(tab);
      return;
    }

    if (status === "completed") {
      resetUploadQueueState(tab, queue && queue.total > 1 ? `uploaded ${queue.completed}/${queue.total}` : "uploaded");
      removeUploadQueue(tab.id);
      return;
    }

    resetUploadQueueState(tab, status === "cancelled" ? "cancelled" : "upload error");
  }

  function resetUploadQueueState(tab: TerminalTab, summary = "idle") {
    tab.sftp.activeUploadId = undefined;
    tab.sftp.activeUploadName = undefined;
    tab.sftp.activeUploadProgress = undefined;
    tab.sftp.transferProgress = undefined;
    tab.sftp.transferSummary = summary;
    tab.sftp.uploadQueueCompleted = undefined;
    tab.sftp.uploadQueuePending = undefined;
    tab.sftp.uploadQueueTotal = undefined;
    updateSftpTransferQueue(tab);
  }

  function updateSftpTransferQueue(tab: TerminalTab) {
    const queue = uploadQueues.value[tab.id];
    const transfers: SftpTransferItem[] = [];

    if (tab.sftp.activeDownloadId) {
      transfers.push({
        id: tab.sftp.activeDownloadId,
        direction: "download",
        name: tab.sftp.activeDownloadName ?? "download",
        status: "running",
        progress: tab.sftp.activeDownloadProgress ?? tab.sftp.transferProgress,
        summary: tab.sftp.transferSummary,
      });
    }

    if (tab.sftp.activeUploadId || queue?.current) {
      transfers.push({
        id: tab.sftp.activeUploadId ?? `upload-current-${tab.id}`,
        direction: "upload",
        name: tab.sftp.activeUploadName ?? queue?.current?.fileName ?? "upload",
        status: "running",
        progress: tab.sftp.activeUploadProgress ?? tab.sftp.transferProgress,
        summary: queue
          ? `${Math.min(queue.completed + 1, queue.total)}/${queue.total}`
          : tab.sftp.transferSummary,
      });
    }

    if (queue?.items.length) {
      transfers.push(
        ...queue.items.slice(0, 20).map((item, index) => ({
          id: `queued-upload-${tab.id}-${index}-${item.remotePath}`,
          direction: "upload" as const,
          name: item.fileName,
          status: "queued" as const,
          summary: "等待上传",
        })),
      );

      if (queue.items.length > 20) {
        transfers.push({
          id: `queued-upload-more-${tab.id}`,
          direction: "upload",
          name: `还有 ${queue.items.length - 20} 项`,
          status: "queued",
          summary: "等待上传",
        });
      }
    }

    tab.sftp.transferQueue = transfers;
  }

  function formatUploadQueueSummary(
    queue: SftpUploadQueueState,
    progress: number,
    transferredBytes?: number,
    totalBytes?: number,
  ) {
    const currentIndex = Math.min(queue.completed + 1, queue.total);
    const fileName = queue.current?.fileName ?? "file";
    const suffix = totalBytes
      ? `${progress}%`
      : transferredBytes
        ? formatBytes(transferredBytes)
        : "0%";

    return queue.total > 1
      ? `${currentIndex}/${queue.total} ${fileName} ${suffix}`
      : `upload ${fileName} ${suffix}`;
  }

  function handleSftpGoParent(tabId: string) {
    const tab = tabs.value.find((item) => item.id === tabId);

    if (!tab) {
      return;
    }

    tab.sftpFollowTerminalCwd = false;
    tab.sftpFollowTerminalCwdError = undefined;
    tab.sftpFollowTerminalCwdStatus = "disabled";
    void refreshSftpForTab(tabId, parentPath(tab.sftp.currentPath));
  }

  async function toggleSftpFollowTerminalCwd(tabId: string) {
    const tab = tabs.value.find((item) => item.id === tabId);

    if (!tab) {
      return;
    }

    const nextEnabled = !tab.sftpFollowTerminalCwd;

    tab.sftpFollowTerminalCwd = nextEnabled;
    tab.sftpFollowTerminalCwdError = undefined;

    if (!tab.sftpFollowTerminalCwd) {
      tab.sftpFollowTerminalCwdStatus = "disabled";
      return;
    }

    tab.sftpFollowTerminalCwdStatus = "enabling";
    const installed = await installTerminalCwdHook(tab);

    if (!installed) {
      return;
    }

    tab.sftpFollowTerminalCwdStatus = "enabled";
    await refreshSftpForTab(tab.id, tab.cwd || ".");
  }

  async function installTerminalCwdHook(tab: TerminalTab): Promise<boolean> {
    if (!isTauri() || !tab.terminalSessionId || !tab.serverSessionId) {
      tab.sftpFollowTerminalCwd = false;
      tab.sftpFollowTerminalCwdStatus = "error";
      tab.sftpFollowTerminalCwdError = "Terminal 尚未连接";
      tab.sftp.transferSummary = "cwd sync error";
      return false;
    }

    if (tab.cwdHookTerminalSessionId === tab.terminalSessionId) {
      return true;
    }

    try {
      let shell = "";
      try {
        shell = await readLoginShell({ serverSessionId: tab.serverSessionId });
      } catch {
        shell = "";
      }

      await terminalWrite({
        terminalId: tab.terminalSessionId,
        data: buildCwdHookScript(shell),
      });
      tab.cwdHookTerminalSessionId = tab.terminalSessionId;
      tab.sftpFollowTerminalCwdError = undefined;
      return true;
    } catch (error) {
      const message = formatError(error);
      recordTabDiagnostic("terminal", tab, "SFTP 跟随终端目录注入失败", {
        error: message,
      });
      tab.sftpFollowTerminalCwd = false;
      tab.sftpFollowTerminalCwdStatus = "error";
      tab.sftpFollowTerminalCwdError = message;
      tab.sftp.transferSummary = "cwd sync error";
      tab.status = "warning";
      tab.output += `\r\n[cwd sync failed: ${message}]\r\n`;
      return false;
    }
  }

  function buildCwdHookScript(shell: string) {
    const normalizedShell = shell.toLowerCase();

    if (normalizedShell.endsWith("/fish") || normalizedShell === "fish") {
      return [
        "stty -echo 2>/dev/null",
        "functions -q __lucidshell_cwd_hook; or function __lucidshell_cwd_hook --on-event fish_prompt",
        "  printf '\\033]777;LucidShell;cwd=%s\\007' \"$PWD\"",
        "end",
        "__lucidshell_cwd_hook",
        "stty echo 2>/dev/null",
        "",
      ].join("\n");
    }

    if (normalizedShell.endsWith("/zsh") || normalizedShell === "zsh") {
      return [
        "stty -echo 2>/dev/null",
        "autoload -Uz add-zsh-hook 2>/dev/null",
        "__lucidshell_cwd_hook() { printf '\\033]777;LucidShell;cwd=%s\\007' \"$PWD\"; }",
        "add-zsh-hook -d precmd __lucidshell_cwd_hook 2>/dev/null",
        "add-zsh-hook precmd __lucidshell_cwd_hook 2>/dev/null || {",
        "  case \" ${precmd_functions[*]} \" in",
        "    *' __lucidshell_cwd_hook '*) ;;",
        "    *) precmd_functions=(__lucidshell_cwd_hook $precmd_functions) ;;",
        "  esac",
        "}",
        "__lucidshell_cwd_hook",
        "stty echo 2>/dev/null",
        "",
      ].join("\n");
    }

    return [
      "stty -echo 2>/dev/null",
      "__lucidshell_cwd_hook() { printf '\\033]777;LucidShell;cwd=%s\\007' \"$PWD\"; }",
      "case \"$PROMPT_COMMAND\" in",
      "  *__lucidshell_cwd_hook*) ;;",
      "  *) PROMPT_COMMAND=\"__lucidshell_cwd_hook${PROMPT_COMMAND:+;$PROMPT_COMMAND}\" ;;",
      "esac",
      "__lucidshell_cwd_hook",
      "stty echo 2>/dev/null",
      "",
    ].join("\n");
  }

  async function handleTerminalResize(
    tabId: string,
    size: { cols: number; rows: number; widthPx: number; heightPx: number },
  ) {
    const tab = tabs.value.find((item) => item.id === tabId);

    if (!tab?.terminalSessionId || !isTauri()) {
      return;
    }

    try {
      await terminalResize({
        terminalId: tab.terminalSessionId,
        ...size,
      });
    } catch (error) {
      recordTabDiagnostic("terminal", tab, "终端尺寸同步失败", {
        error: formatError(error),
        size,
      });
      tab.status = "warning";
      tab.output += `\r\n[terminal resize failed: ${formatError(error)}]\r\n`;
    }
  }

  function disposeTerminalEvents() {
    terminalUnlisteners.value.forEach((unlisten) => unlisten());
    terminalUnlisteners.value = [];
    terminalEventsReady.value = false;
    stopMonitorRefresh();
    stopHealthRefresh();
    window.removeEventListener("focus", handleAppResume);
    window.removeEventListener("online", handleAppResume);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  }

  function reconnectActiveTab() {
    const tab = activeTab.value;

    if (!tab) {
      openServerSelectDialog();
      return;
    }

    void cancelTabTransfers(tab);
    removeUploadQueue(tab.id);

    resetTabConnectionState(tab, { clearOutput: true });
    void ensureTerminalForTab(tab.id);
  }

  function createEmptyTerminalTab(id: string, title: string): TerminalTab {
    return {
      id,
      title,
      cwd: ".",
      status: "idle",
      sftpFollowTerminalCwd: useSettingsStore().settings.sftp.followTerminalCwdByDefault,
      sftpFollowTerminalCwdStatus: "disabled",
      sftpHeightRatio: defaultSftpHeightRatio,
      sftp: {
        currentPath: ".",
        loading: false,
        loadingAction: undefined,
        selectedCount: 0,
        transferSummary: "idle",
        transferQueue: [],
        entries: [],
      },
      output: "",
    };
  }

  async function cancelTabTransfers(tab: TerminalTab) {
    if (!isTauri()) {
      return;
    }

    try {
      if (tab.sftp.activeDownloadId) {
        await cancelSftpDownload({ transferId: tab.sftp.activeDownloadId });
      }

      if (tab.sftp.activeUploadId) {
        await cancelSftpUpload({ transferId: tab.sftp.activeUploadId });
      }

      removeUploadQueue(tab.id);
    } catch (error) {
      recordTabDiagnostic("sftp", tab, "SFTP 传输取消失败", {
        error: formatError(error),
      });
      appendLocalOutput(
        activeTabId.value,
        `\r\n[sftp transfer cancel failed: ${formatError(error)}]\r\n`,
      );
    }
  }

  function formatError(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  function shortError(error: unknown) {
    const message = formatError(error);
    return message.length > 42 ? `${message.slice(0, 39)}...` : message;
  }

  function parentPath(path: string) {
    const normalized = path.replace(/\/+$/, "");

    if (!normalized || normalized === "/" || normalized === ".") {
      return ".";
    }

    const index = normalized.lastIndexOf("/");

    if (index <= 0) {
      return "/";
    }

    return normalized.slice(0, index);
  }

  function transferPercent(transferredBytes: number, totalBytes?: number) {
    if (!totalBytes || totalBytes <= 0) {
      return 0;
    }

    return Math.min(100, Math.floor((transferredBytes / totalBytes) * 100));
  }

  function formatBytes(bytes: number) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    return unitIndex === 0 ? `${bytes} B` : `${value.toFixed(1)} ${units[unitIndex]}`;
  }

  function joinRemotePath(directory: string, fileName: string) {
    if (!directory || directory === ".") {
      return fileName;
    }

    return `${directory.replace(/\/+$/, "")}/${fileName}`;
  }

  function remoteBasename(path: string) {
    const normalized = path.replace(/\/+$/, "");
    return normalized.slice(normalized.lastIndexOf("/") + 1);
  }

  return {
    activeTab,
    activeTabServer,
    activeTabId,
    cancelHostKeyTrust,
    closeTerminalTab: closeTerminalTabById,
    closeServerSelectDialog,
    createTerminalTab,
    closeOtherTerminalTabs,
    cleanupConnections,
    confirmHostKeyTrust,
    disconnectServerProfile,
    disposeTerminalEvents,
    ensureTerminalForTab,
    handleTerminalInput,
    handleTerminalResize,
    handleSftpEntryOpen,
    handleSftpEditEntry,
    handleSftpGoParent,
    handleSftpDownload,
    handleSftpCancelDownload,
    handleSftpDeleteEntry,
    handleSftpDroppedPaths,
    handleSftpUpload,
    handleSftpCancelUpload,
    handleSftpNewFolder,
    handleSftpRenameEntry,
    handleSftpSelectEntry,
    toggleSftpFollowTerminalCwd,
    initTerminalEvents,
    isActiveSftpCollapsed,
    monitor,
    pendingHostKeyTrust,
    reconnectActiveTab,
    reconnectTerminalTab,
    retryServerConnection,
    renameTerminalTab,
    refreshSftpForTab,
    resetSftpSplit,
    resetSftpSplitForTab,
    resizeSftpSplit,
    serverSelectDialogOpen,
    openServerInNewTab,
    openServerSelectDialog,
    selectServerForNewTab,
    setActiveTab,
    sidebarCollapsed,
    tabs,
    toggleSftp,
    toggleSftpForTab,
    toggleSidebar,
  };
});
