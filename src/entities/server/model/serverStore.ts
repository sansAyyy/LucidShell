import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import {
  createDefaultConnectionSnapshot,
  exportConnectionSnapshot,
  importConnectionSnapshot,
  loadConnectionSnapshot,
  resetConnectionSnapshot,
  saveConnectionSnapshot,
} from "../../../shared/lib/connectionStorage";
import type { ConnectionGroup, ConnectionStorageSnapshot, ServerConnection, ServerConnectionForm } from "./types";

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function toConnection(form: ServerConnectionForm, existing?: ServerConnection): ServerConnection {
  const port = Number.isInteger(form.port) ? Math.min(Math.max(form.port, 1), 65535) : 22;

  return {
    id: form.id ?? existing?.id ?? createId("server"),
    name: form.name.trim(),
    groupId: form.groupId,
    host: form.host.trim(),
    port,
    user: form.user.trim(),
    authType: form.authType,
    password:
      form.authType === "password" && form.credentialStorage === "plain"
        ? form.password || existing?.password
        : undefined,
    privateKeyPath: form.authType === "privateKey" ? form.privateKeyPath.trim() : undefined,
    credentialStorage: form.credentialStorage,
    hostKeyFingerprint: form.hostKeyFingerprint ?? existing?.hostKeyFingerprint,
    favorite: form.favorite,
    lastConnectedAt: existing?.lastConnectedAt,
    latencyMs: existing?.latencyMs,
    lastError: undefined,
    status: "disconnected",
  };
}

export const useServerStore = defineStore("server", () => {
  const initialSnapshot = createDefaultConnectionSnapshot();
  const hydrated = ref(false);
  let hydrationPromise: Promise<void> | undefined;
  const activeServerId = ref(initialSnapshot.activeServerId);
  const groups = ref<ConnectionGroup[]>(initialSnapshot.groups);
  const servers = ref<ServerConnection[]>(initialSnapshot.servers);

  const activeServer = computed(
    () => servers.value.find((server) => server.id === activeServerId.value) ?? servers.value[0],
  );

  const favoriteServers = computed(() => servers.value.filter((server) => server.favorite));

  const recentServers = computed(() =>
    servers.value
      .filter((server) => !server.favorite && server.lastConnectedAt)
      .sort((a, b) => (b.lastConnectedAt ?? "").localeCompare(a.lastConnectedAt ?? "")),
  );

  function getServersByGroup(groupId: string) {
    return servers.value.filter((server) => server.groupId === groupId);
  }

  function setActiveServer(serverId: string) {
    activeServerId.value = serverId;
  }

  function setServerStatus(
    serverId: string,
    status: ServerConnection["status"],
    patch: Partial<Pick<ServerConnection, "lastConnectedAt" | "latencyMs" | "lastError">> = {},
  ) {
    servers.value = servers.value.map((server) =>
      server.id === serverId ? { ...server, ...patch, status } : server,
    );
  }

  function toSnapshot(): ConnectionStorageSnapshot {
    return {
      version: 2,
      activeServerId: activeServerId.value,
      groups: groups.value,
      servers: servers.value.map((server) => ({
        ...server,
        status: "disconnected",
      })),
    };
  }

  function applySnapshot(snapshot: ConnectionStorageSnapshot) {
    groups.value = snapshot.groups;
    servers.value = snapshot.servers;
    activeServerId.value = snapshot.activeServerId || snapshot.servers[0]?.id || "";
  }

  async function hydrateConnections() {
    if (hydrated.value) {
      return;
    }

    hydrationPromise ??= loadConnectionSnapshot().then((snapshot) => {
      applySnapshot(snapshot);
      hydrated.value = true;
    });

    await hydrationPromise;
  }

  function addGroup(name: string) {
    const trimmedName = name.trim();

    if (!trimmedName) {
      return;
    }

    groups.value = [...groups.value, { id: createId("group"), name: trimmedName }];
  }

  function isDuplicateServerName(name: string, ignoredServerId?: string) {
    return servers.value.some(
      (server) =>
        server.id !== ignoredServerId &&
        server.name.trim().toLowerCase() === name.trim().toLowerCase(),
    );
  }

  function isDuplicateServerId(serverId?: string) {
    return Boolean(serverId && servers.value.some((server) => server.id === serverId));
  }

  function isValidServerForm(form: ServerConnectionForm) {
    const hasRequiredFields = Boolean(form.name.trim() && form.host.trim() && form.user.trim());
    const hasValidPort = Number.isInteger(form.port) && form.port >= 1 && form.port <= 65535;
    const hasValidAuth =
      form.authType === "password" ||
      (form.authType === "privateKey" && Boolean(form.privateKeyPath.trim()));

    return hasRequiredFields && hasValidPort && hasValidAuth && !isDuplicateServerName(form.name, form.id);
  }

  function addServer(form: ServerConnectionForm) {
    if (!isValidServerForm(form) || isDuplicateServerId(form.id)) {
      return false;
    }

    const nextServer = toConnection(form);
    servers.value = [nextServer, ...servers.value];
    activeServerId.value = nextServer.id;
    return true;
  }

  function updateServer(form: ServerConnectionForm) {
    if (!form.id || !isValidServerForm(form)) {
      return false;
    }

    servers.value = servers.value.map((server) =>
      server.id === form.id ? toConnection(form, server) : server,
    );
    return true;
  }

  function updateServerHostKeyFingerprint(serverId: string, fingerprint: string) {
    servers.value = servers.value.map((server) =>
      server.id === serverId ? { ...server, hostKeyFingerprint: fingerprint } : server,
    );
  }

  function duplicateServer(serverId: string) {
    const source = servers.value.find((server) => server.id === serverId);

    if (!source) {
      return;
    }

    const copy: ServerConnection = {
      ...source,
      id: createId("server"),
      name: `${source.name} copy`,
      status: "disconnected",
      latencyMs: undefined,
      lastConnectedAt: undefined,
      lastError: undefined,
    };

    servers.value = [copy, ...servers.value];
  }

  function deleteServer(serverId: string) {
    servers.value = servers.value.filter((server) => server.id !== serverId);

    if (activeServerId.value === serverId) {
      activeServerId.value = servers.value[0]?.id ?? "";
    }
  }

  function toggleFavorite(serverId: string) {
    servers.value = servers.value.map((server) =>
      server.id === serverId ? { ...server, favorite: !server.favorite } : server,
    );
  }

  function moveServerToGroup(serverId: string, groupId: string) {
    servers.value = servers.value.map((server) =>
      server.id === serverId ? { ...server, groupId } : server,
    );
  }

  async function resetConnections() {
    applySnapshot(await resetConnectionSnapshot());
  }

  function exportConnections() {
    return exportConnectionSnapshot(toSnapshot());
  }

  function importConnections(raw: string) {
    const snapshot = importConnectionSnapshot(raw);

    if (!snapshot) {
      return false;
    }

    applySnapshot(snapshot);
    return true;
  }

  if (!servers.value.length) {
    applySnapshot(createDefaultConnectionSnapshot());
  }

  void hydrateConnections();

  watch(
    [activeServerId, groups, servers],
    () => {
      if (!hydrated.value) {
        return;
      }

      void saveConnectionSnapshot(toSnapshot());
    },
    { deep: true },
  );

  return {
    activeServer,
    activeServerId,
    addGroup,
    addServer,
    deleteServer,
    duplicateServer,
    exportConnections,
    favoriteServers,
    getServersByGroup,
    groups,
    hydrated,
    hydrateConnections,
    importConnections,
    moveServerToGroup,
    recentServers,
    resetConnections,
    servers,
    setActiveServer,
    setServerStatus,
    toggleFavorite,
    updateServer,
    updateServerHostKeyFingerprint,
  };
});
