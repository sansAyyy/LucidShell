export type ServerStatus = "connected" | "connecting" | "disconnecting" | "disconnected" | "error";

export type CredentialStorage = "none" | "plain" | "keychain";

export type ConnectionGroup = {
  id: string;
  name: string;
};

export type ServerConnection = {
  id: string;
  name: string;
  groupId: string;
  host: string;
  port: number;
  user: string;
  authType: "password" | "privateKey";
  password?: string;
  privateKeyPath?: string;
  credentialStorage: CredentialStorage;
  hostKeyFingerprint?: string;
  favorite: boolean;
  lastConnectedAt?: string;
  latencyMs?: number;
  lastError?: string;
  status: ServerStatus;
};

export type ServerConnectionForm = {
  id?: string;
  name: string;
  groupId: string;
  host: string;
  port: number;
  user: string;
  authType: "password" | "privateKey";
  password: string;
  privateKeyPath: string;
  credentialStorage: CredentialStorage;
  hostKeyFingerprint?: string;
  favorite: boolean;
};

export type ConnectionStorageSnapshot = {
  version: 2;
  activeServerId: string;
  groups: ConnectionGroup[];
  servers: ServerConnection[];
};

export type MonitorState = {
  cpu?: number;
  memory?: number;
  disk?: number;
  load?: string;
  uptime?: string;
  error?: string;
};
