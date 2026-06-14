import { invoke, isTauri } from "@tauri-apps/api/core";
import { mockConnectionGroups, mockServers } from "../config/mockData";
import type {
  ConnectionGroup,
  ConnectionStorageSnapshot,
  CredentialStorage,
  ServerConnection,
  ServerStatus,
} from "../../entities/server/model/types";

const STORAGE_KEY = "lucidshell.connections.v1";
const CURRENT_CONNECTION_SNAPSHOT_VERSION = 2;
const DEFAULT_GROUP_ID = "default";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function asPort(value: unknown) {
  const port = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return 22;
  }

  return port;
}

function asStatus(value: unknown): ServerStatus {
  return value === "connected" ||
    value === "connecting" ||
    value === "disconnecting" ||
    value === "disconnected" ||
    value === "error"
    ? value
    : "disconnected";
}

function persistedStatus(status: ServerStatus): ServerStatus {
  return status === "disconnected" ? "disconnected" : "disconnected";
}

function asCredentialStorage(value: unknown): CredentialStorage {
  return value === "plain" || value === "keychain" || value === "none" ? value : "none";
}

function createId(prefix: string, index: number) {
  return `${prefix}-${index + 1}`;
}

function cloneGroups(groups: ConnectionGroup[]) {
  return groups.map((group) => ({ ...group }));
}

function cloneServers(servers: ServerConnection[]) {
  return servers.map((server) => ({
    ...server,
    lastError: undefined,
    status: persistedStatus(server.status),
  }));
}

export function createDefaultConnectionSnapshot(): ConnectionStorageSnapshot {
  return {
    version: CURRENT_CONNECTION_SNAPSHOT_VERSION,
    activeServerId: mockServers[0]?.id ?? "",
    groups: cloneGroups(mockConnectionGroups),
    servers: cloneServers(mockServers),
  };
}

function normalizeGroups(value: unknown): ConnectionGroup[] {
  const rawGroups = Array.isArray(value) ? value : [];
  const seenIds = new Set<string>();
  const groups: ConnectionGroup[] = [];

  rawGroups.forEach((rawGroup, index) => {
    if (!isRecord(rawGroup)) {
      return;
    }

    const fallbackId = createId("group", index);
    let id = asString(rawGroup.id, fallbackId).trim() || fallbackId;
    const name = asString(rawGroup.name, id).trim() || id;

    if (seenIds.has(id)) {
      id = `${id}-${index + 1}`;
    }

    seenIds.add(id);
    groups.push({ id, name });
  });

  if (!groups.length) {
    groups.push({ id: DEFAULT_GROUP_ID, name: "Default" });
  }

  return groups;
}

function normalizeServers(value: unknown, groups: ConnectionGroup[]): ServerConnection[] {
  const rawServers = Array.isArray(value) ? value : [];
  const groupIds = new Set(groups.map((group) => group.id));
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const defaultGroupId = groups[0]?.id ?? DEFAULT_GROUP_ID;
  const servers: ServerConnection[] = [];

  rawServers.forEach((rawServer, index) => {
    if (!isRecord(rawServer)) {
      return;
    }

    const fallbackId = createId("server", index);
    let id = asString(rawServer.id, fallbackId).trim() || fallbackId;

    if (seenIds.has(id)) {
      id = `${id}-${index + 1}`;
    }

    let name = asString(rawServer.name, id).trim() || id;
    const normalizedNameKey = name.toLowerCase();

    if (seenNames.has(normalizedNameKey)) {
      name = `${name} ${index + 1}`;
    }

    const host = asString(rawServer.host).trim();
    const user = asString(rawServer.user).trim();

    if (!host || !user) {
      return;
    }

    const rawAuthType = asString(rawServer.authType, "password");
    const authType = rawAuthType === "privateKey" ? "privateKey" : "password";
    const credentialStorage = asCredentialStorage(rawServer.credentialStorage);
    const password =
      authType === "password" && credentialStorage === "plain"
        ? asString(rawServer.password)
        : undefined;
    const privateKeyPath =
      authType === "privateKey" ? asString(rawServer.privateKeyPath).trim() || undefined : undefined;
    const rawGroupId = asString(rawServer.groupId, defaultGroupId).trim();

    seenIds.add(id);
    seenNames.add(name.toLowerCase());

    servers.push({
      id,
      name,
      groupId: groupIds.has(rawGroupId) ? rawGroupId : defaultGroupId,
      host,
      port: asPort(rawServer.port),
      user,
      authType,
      password,
      privateKeyPath,
      credentialStorage: authType === "privateKey" ? "none" : credentialStorage,
      hostKeyFingerprint: asString(rawServer.hostKeyFingerprint).trim() || undefined,
      favorite: asBoolean(rawServer.favorite),
      lastConnectedAt: asString(rawServer.lastConnectedAt) || undefined,
      latencyMs:
        typeof rawServer.latencyMs === "number" && rawServer.latencyMs >= 0
          ? rawServer.latencyMs
          : undefined,
      status: persistedStatus(asStatus(rawServer.status)),
    });
  });

  return servers;
}

export function migrateConnectionSnapshot(value: unknown): ConnectionStorageSnapshot | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const version = typeof value.version === "number" ? value.version : 0;

  if (version > CURRENT_CONNECTION_SNAPSHOT_VERSION) {
    return undefined;
  }

  const groups = normalizeGroups(value.groups);
  const servers = normalizeServers(value.servers, groups);

  if (!servers.length) {
    return undefined;
  }

  const rawActiveServerId = asString(value.activeServerId);
  const activeServerId = servers.some((server) => server.id === rawActiveServerId)
    ? rawActiveServerId
    : servers[0]?.id ?? "";

  return {
    version: CURRENT_CONNECTION_SNAPSHOT_VERSION,
    activeServerId,
    groups,
    servers,
  };
}

function parseSnapshot(raw: string | undefined | null) {
  if (!raw) {
    return undefined;
  }

  try {
    return migrateConnectionSnapshot(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function stringifySnapshot(snapshot: ConnectionStorageSnapshot) {
  return JSON.stringify(snapshot, null, 2);
}

function loadBrowserSnapshot() {
  return parseSnapshot(localStorage.getItem(STORAGE_KEY));
}

function saveBrowserSnapshot(snapshot: ConnectionStorageSnapshot) {
  localStorage.setItem(STORAGE_KEY, stringifySnapshot(snapshot));
}

function resetBrowserSnapshot() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function loadConnectionSnapshot(): Promise<ConnectionStorageSnapshot> {
  const fallback = createDefaultConnectionSnapshot();

  if (!isTauri()) {
    return loadBrowserSnapshot() ?? fallback;
  }

  try {
    const raw = await invoke<string | null>("load_connections_config");
    return parseSnapshot(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

export async function saveConnectionSnapshot(snapshot: ConnectionStorageSnapshot) {
  if (!isTauri()) {
    saveBrowserSnapshot(snapshot);
    return;
  }

  await invoke("save_connections_config", {
    content: stringifySnapshot(snapshot),
  });
}

export async function resetConnectionSnapshot() {
  if (!isTauri()) {
    resetBrowserSnapshot();
    return createDefaultConnectionSnapshot();
  }

  await invoke("reset_connections_config");
  return createDefaultConnectionSnapshot();
}

export function exportConnectionSnapshot(snapshot: ConnectionStorageSnapshot) {
  return JSON.stringify(
    {
      ...snapshot,
      version: CURRENT_CONNECTION_SNAPSHOT_VERSION,
      servers: snapshot.servers.map((server) => ({
        ...server,
        password: server.credentialStorage === "plain" ? server.password : undefined,
        privateKeyPath: server.privateKeyPath,
      })),
    },
    null,
    2,
  );
}

export function importConnectionSnapshot(raw: string): ConnectionStorageSnapshot | undefined {
  return parseSnapshot(raw);
}
