import { invoke } from "@tauri-apps/api/core";

export type OpenTerminalTabPayload = {
  serverSessionId: string;
  title?: string;
  cwd?: string;
};

export type TerminalWritePayload = {
  terminalId: string;
  data: string;
};

export type TerminalResizePayload = {
  terminalId: string;
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
};

export type CloseTerminalTabPayload = {
  terminalId: string;
};

export type TerminalSessionDto = {
  id: string;
  serverSessionId: string;
  title: string;
  cwd: string;
  status: "opening" | "open" | "closed" | "error";
  error?: string;
};

export type TerminalOutputEvent = {
  terminalId: string;
  data: string;
};

export type TerminalClosedEvent = {
  terminalId: string;
  reason?: string;
};

export function openTerminalTab(payload: OpenTerminalTabPayload) {
  return invoke<TerminalSessionDto>("open_terminal_tab", { payload });
}

export function terminalWrite(payload: TerminalWritePayload) {
  return invoke<void>("terminal_write", { payload });
}

export function terminalResize(payload: TerminalResizePayload) {
  return invoke<void>("terminal_resize", { payload });
}

export function closeTerminalTab(payload: CloseTerminalTabPayload) {
  return invoke<TerminalSessionDto | null>("close_terminal_tab", { payload });
}
