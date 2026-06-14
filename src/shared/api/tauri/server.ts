import { invoke } from "@tauri-apps/api/core";

export type ConnectServerPayload = {
  profileId: string;
  name: string;
  host: string;
  port: number;
  user: string;
  authType: "password" | "privateKey";
  password?: string;
  privateKeyPath?: string;
  hostKeyFingerprint?: string;
};

export type DisconnectServerPayload = {
  sessionId: string;
};

export type ReadServerMonitorPayload = {
  serverSessionId: string;
};

export type ReadLoginShellPayload = {
  serverSessionId: string;
};

export type CheckServerSessionHealthPayload = {
  serverSessionId: string;
};

export type ServerSessionDto = {
  id: string;
  profileId: string;
  name: string;
  host: string;
  port: number;
  user: string;
  status: "connecting" | "connected" | "disconnecting" | "disconnected" | "error";
  error?: string;
};

export type ServerMonitorDto = {
  cpu?: number;
  memory?: number;
  disk?: number;
  load?: string;
  uptime?: string;
  error?: string;
};

export type ConnectionStatusChangedEvent = {
  sessionId: string;
  profileId: string;
  status: ServerSessionDto["status"];
  error?: string;
};

export function connectServer(payload: ConnectServerPayload) {
  return invoke<ServerSessionDto>("connect_server", { payload });
}

export function disconnectServer(payload: DisconnectServerPayload) {
  return invoke<ServerSessionDto | null>("disconnect_server", { payload });
}

export function cleanupSshSessions() {
  return invoke<void>("cleanup_ssh_sessions");
}

export function listServerSessions() {
  return invoke<ServerSessionDto[]>("list_server_sessions");
}

export function readServerMonitor(payload: ReadServerMonitorPayload) {
  return invoke<ServerMonitorDto>("read_server_monitor", { payload });
}

export function readLoginShell(payload: ReadLoginShellPayload) {
  return invoke<string>("read_login_shell", { payload });
}

export function checkServerSessionHealth(payload: CheckServerSessionHealthPayload) {
  return invoke<ServerSessionDto>("check_server_session_health", { payload });
}

export function saveKeychainPassword(profileId: string, password: string) {
  return invoke<void>("save_keychain_password", {
    payload: {
      profileId,
      password,
    },
  });
}

export function readKeychainPassword(profileId: string) {
  return invoke<string | null>("read_keychain_password", {
    payload: {
      profileId,
    },
  });
}

export function deleteKeychainPassword(profileId: string) {
  return invoke<void>("delete_keychain_password", {
    payload: {
      profileId,
    },
  });
}
