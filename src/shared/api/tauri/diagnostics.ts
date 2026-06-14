import { invoke } from "@tauri-apps/api/core";

export type AppendDiagnosticLogPayload = {
  line: string;
};

export type ExportDiagnosticLogPayload = {
  path: string;
};

export function appendDiagnosticLog(payload: AppendDiagnosticLogPayload) {
  return invoke<void>("append_diagnostic_log", { payload });
}

export function readDiagnosticLog() {
  return invoke<string>("read_diagnostic_log");
}

export function clearDiagnosticLog() {
  return invoke<void>("clear_diagnostic_log");
}

export function exportDiagnosticLog(payload: ExportDiagnosticLogPayload) {
  return invoke<void>("export_diagnostic_log", { payload });
}
