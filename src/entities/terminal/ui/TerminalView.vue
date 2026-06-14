<script setup lang="ts">
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { TerminalInputPayload } from "../model/types";

const props = defineProps<{
  content: string;
  cwd: string;
}>();

const emit = defineEmits<{
  data: [payload: TerminalInputPayload];
  resize: [size: { cols: number; rows: number; widthPx: number; heightPx: number }];
}>();

const terminalElement = ref<HTMLDivElement>();
let terminal: Terminal | undefined;
let fitAddon: FitAddon | undefined;
let resizeObserver: ResizeObserver | undefined;
let lastContent = "";
let lastSize: { cols: number; rows: number; widthPx: number; heightPx: number } | undefined;
let resizeTimer: number | undefined;
let suppressNextPasteData = false;

function scrollTerminalToBottom() {
  requestAnimationFrame(() => {
    terminal?.scrollToBottom();
  });
}

function focusTerminal() {
  requestAnimationFrame(() => {
    terminal?.focus();
  });
}

function isScrolledToBottom() {
  const viewport = terminalElement.value?.querySelector(".xterm-viewport");

  if (!viewport) {
    return true;
  }

  return viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 4;
}

function writeContent() {
  if (!terminal) {
    return;
  }

  const shouldStickToBottom = isScrolledToBottom();

  if (props.content.startsWith(lastContent)) {
    terminal.write(props.content.slice(lastContent.length));
  } else {
    terminal.clear();
    terminal.write(props.content);
  }

  lastContent = props.content;

  if (shouldStickToBottom) {
    scrollTerminalToBottom();
  }
}

function fitTerminal() {
  requestAnimationFrame(() => {
    try {
      const shouldStickToBottom = isScrolledToBottom();
      fitAddon?.fit();

      if (shouldStickToBottom) {
        scrollTerminalToBottom();
      }

      emitResize();
    } catch {
      // xterm can throw while its container is hidden during layout transitions.
    }
  });
}

function emitResize() {
  if (!terminal || !terminalElement.value) {
    return;
  }

  const nextSize = {
    cols: terminal.cols,
    rows: terminal.rows,
    widthPx: Math.round(terminalElement.value.clientWidth),
    heightPx: Math.round(terminalElement.value.clientHeight),
  };

  if (
    lastSize &&
    lastSize.cols === nextSize.cols &&
    lastSize.rows === nextSize.rows &&
    lastSize.widthPx === nextSize.widthPx &&
    lastSize.heightPx === nextSize.heightPx
  ) {
    return;
  }

  lastSize = nextSize;

  if (resizeTimer) {
    window.clearTimeout(resizeTimer);
  }

  resizeTimer = window.setTimeout(() => {
    emit("resize", nextSize);
  }, 80);
}

function normalizePasteText(text: string) {
  return text.replace(/\r?\n/g, "\r");
}

function formatPastePayload(text: string) {
  const normalized = normalizePasteText(text);

  if (terminal?.modes.bracketedPasteMode) {
    return `\x1b[200~${normalized}\x1b[201~`;
  }

  return normalized;
}

function emitPaste(text: string) {
  if (!text) {
    return;
  }

  emit("data", {
    data: formatPastePayload(text),
    kind: "paste",
  });
}

function handlePaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData("text/plain") ?? "";

  if (!text) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  suppressNextPasteData = true;
  window.setTimeout(() => {
    suppressNextPasteData = false;
  }, 0);
  emitPaste(text);
}

async function handleContextMenu(event: MouseEvent) {
  event.preventDefault();

  if (!terminal) {
    return;
  }

  const selection = terminal.getSelection();

  if (selection) {
    try {
      await writeText(selection);
      terminal.clearSelection();
      terminal.focus();
    } catch {
      // Clipboard access can be denied by the host.
    }
    return;
  }

  try {
    const text = await readText();

    if (text) {
      emitPaste(text);
      terminal.focus();
    }
  } catch {
    // Clipboard access can be denied by the host.
  }
}

onMounted(() => {
  terminal = new Terminal({
    allowProposedApi: false,
    cursorBlink: true,
    cursorStyle: "block",
    fontFamily: '"JetBrains Mono", "Cascadia Code", ui-monospace, monospace',
    fontSize: 13,
    lineHeight: 1.25,
    scrollback: 5000,
    theme: {
      background: "#0c0f13",
      black: "#1f2430",
      blue: "#78a9ff",
      brightBlack: "#626b7a",
      brightBlue: "#9fc9ff",
      brightCyan: "#8fd9e6",
      brightGreen: "#8ce99a",
      brightMagenta: "#d2a8ff",
      brightRed: "#ff8f8f",
      brightWhite: "#ffffff",
      brightYellow: "#ffe08a",
      cursor: "#9fc9ff",
      cyan: "#72d0e0",
      foreground: "#dbe7d7",
      green: "#75d083",
      magenta: "#bf8cff",
      red: "#ff7373",
      selectionBackground: "#34506f",
      white: "#dbe2ea",
      yellow: "#ffd166",
    },
  });
  fitAddon = new FitAddon();

  terminal.loadAddon(fitAddon);
  terminal.onData((data) => {
    if (suppressNextPasteData && data.length > 1) {
      suppressNextPasteData = false;
      return;
    }

    emit("data", {
      data,
      kind: "key",
    });
  });
  terminal.open(terminalElement.value!);
  writeContent();
  fitTerminal();
  focusTerminal();

  resizeObserver = new ResizeObserver(fitTerminal);

  if (terminalElement.value) {
    resizeObserver.observe(terminalElement.value);
  }
});

watch(
  () => props.content,
  async () => {
    await nextTick();
    writeContent();
    fitTerminal();
  },
);

onBeforeUnmount(() => {
  if (resizeTimer) {
    window.clearTimeout(resizeTimer);
  }

  resizeObserver?.disconnect();
  terminal?.dispose();
});
</script>

<template>
  <div class="terminal-view">
    <div
      ref="terminalElement"
      class="terminal-host"
      @contextmenu="handleContextMenu"
      @paste.capture="handlePaste"
    />
  </div>
</template>

<style scoped>
.terminal-view {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 10px 12px;
  background: #0c0f13;
}

.terminal-host {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.terminal-host :deep(.xterm) {
  height: 100%;
}

.terminal-host :deep(.xterm-viewport) {
  background: transparent !important;
  scrollbar-color: #394454 #0c0f13;
  scrollbar-width: thin;
}

.terminal-host :deep(.xterm-viewport::-webkit-scrollbar) {
  width: 10px;
}

.terminal-host :deep(.xterm-viewport::-webkit-scrollbar-track) {
  background: #0c0f13;
}

.terminal-host :deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  border: 2px solid #0c0f13;
  border-radius: 999px;
  background: #394454;
}

.terminal-host :deep(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
  background: #4a586b;
}
</style>
