import type { SftpPaneState } from "../../sftp/model/types";

export type TerminalInputPayload = {
  data: string;
  kind: "key" | "paste";
};

export type TerminalTab = {
  id: string;
  title: string;
  cwd: string;
  status: "active" | "idle" | "warning" | "error";
  serverProfileId?: string;
  serverSessionId?: string;
  terminalSessionId?: string;
  cwdHookTerminalSessionId?: string;
  reconnectOnInput?: boolean;
  sftpFollowTerminalCwd: boolean;
  sftpFollowTerminalCwdError?: string;
  sftpFollowTerminalCwdStatus: "disabled" | "enabling" | "enabled" | "error";
  sftpHeightRatio: number;
  sftp: SftpPaneState;
  output: string;
};
