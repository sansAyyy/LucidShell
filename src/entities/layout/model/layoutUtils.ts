import type { TerminalInputPayload } from "../../terminal/model/types";

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

export type TerminalWriteQueueState = {
  items: TerminalInputPayload[];
  running: boolean;
};

export function extractTerminalCwd(data: string) {
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

export function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function shortError(error: unknown) {
  const message = formatError(error);
  return message.length > 42 ? `${message.slice(0, 39)}...` : message;
}

export function parentPath(path: string) {
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

export function transferPercent(transferredBytes: number, totalBytes?: number) {
  if (!totalBytes || totalBytes <= 0) {
    return 0;
  }

  return Math.min(100, Math.floor((transferredBytes / totalBytes) * 100));
}

export function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return unitIndex === 0 ? `${bytes} B` : `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function joinRemotePath(directory: string, fileName: string) {
  if (!directory || directory === ".") {
    return fileName;
  }

  return `${directory.replace(/\/+$/, "")}/${fileName}`;
}

export function remoteBasename(path: string) {
  const normalized = path.replace(/\/+$/, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
