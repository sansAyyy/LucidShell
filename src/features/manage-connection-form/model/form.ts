import type { ServerConnection, ServerConnectionForm } from "../../../entities/server/model/types";

export function createEmptyConnectionForm(groupId = ""): ServerConnectionForm {
  return {
    name: "",
    groupId,
    host: "",
    port: 22,
    user: "",
    authType: "password",
    password: "",
    privateKeyPath: "",
    credentialStorage: "none",
    hostKeyFingerprint: undefined,
    favorite: false,
  };
}

export function createConnectionFormFromServer(server: ServerConnection): ServerConnectionForm {
  return {
    id: server.id,
    name: server.name,
    groupId: server.groupId,
    host: server.host,
    port: server.port,
    user: server.user,
    authType: server.authType,
    password: server.password ?? "",
    privateKeyPath: server.privateKeyPath ?? "",
    credentialStorage: server.credentialStorage,
    hostKeyFingerprint: server.hostKeyFingerprint,
    favorite: server.favorite,
  };
}
