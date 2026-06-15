<script setup lang="ts">
import { ChevronUp, PanelBottomClose, RotateCcw, X } from "@lucide/vue";
import { computed, nextTick, ref, type ComponentPublicInstance } from "vue";
import TerminalView from "../../../entities/terminal/ui/TerminalView.vue";
import SftpPane from "../../sftp-pane/ui/SftpPane.vue";
import { TerminalTabContextMenu } from "../../../features/terminal-tab-menu";
import type { TerminalInputPayload, TerminalTab } from "../../../entities/terminal/model/types";
import type { RemoteFileEntry } from "../../../entities/sftp/model/types";

const TABBAR_HEIGHT = 38;
const SPLITTER_HEIGHT = 5;
const MIN_TERMINAL_HEIGHT = 240;
const MIN_SFTP_HEIGHT = 180;
const DEFAULT_SFTP_RATIO = 0.38;

const props = defineProps<{
  activeTabId: string;
  sftpDragActive: boolean;
  sftpCollapsed: boolean;
  tabs: TerminalTab[];
}>();

const emit = defineEmits<{
  "close-tab": [tabId: string];
  "close-other-tabs": [tabId: string];
  "create-tab": [];
  "reconnect-tab": [tabId: string];
  "rename-tab": [tabId: string, title: string];
  "reset-sftp-split": [];
  "reset-sftp-split-for-tab": [tabId: string];
  "resize-sftp-split": [tabId: string, ratio: number];
  "select-tab": [tabId: string];
  "sftp-cancel-download": [tabId: string];
  "sftp-cancel-upload": [tabId: string];
  "sftp-drag-active": [active: boolean];
  "sftp-download": [tabId: string];
  "sftp-entry-delete": [tabId: string, entry: RemoteFileEntry];
  "sftp-entry-edit": [tabId: string, entry: RemoteFileEntry];
  "sftp-clear-transfer-queue": [tabId: string];
  "terminal-input": [tabId: string, payload: TerminalInputPayload];
  "terminal-resize": [tabId: string, size: { cols: number; rows: number; widthPx: number; heightPx: number }];
  "sftp-entry-open": [tabId: string, entry: RemoteFileEntry];
  "sftp-entry-rename": [tabId: string, entry: RemoteFileEntry, name: string];
  "sftp-remove-transfer-item": [tabId: string, itemId: string];
  "sftp-go-parent": [tabId: string];
  "sftp-new-folder": [tabId: string];
  "sftp-refresh": [tabId: string];
  "sftp-select-entry": [tabId: string, entry: RemoteFileEntry];
  "sftp-toggle-follow-cwd": [tabId: string];
  "sftp-upload": [tabId: string];
  "toggle-sftp": [];
  "toggle-sftp-for-tab": [tabId: string];
}>();

const currentTab = computed(() => props.tabs.find((tab) => tab.id === props.activeTabId));
const workspaceElement = ref<HTMLElement>();
const tabRenameInput = ref<HTMLInputElement>();
const editingTabId = ref("");
const editingTabTitle = ref("");
const tabContextMenu = ref<{
  open: boolean;
  tab?: TerminalTab;
  x: number;
  y: number;
}>({
  open: false,
  x: 0,
  y: 0,
});

const workspaceGridRows = computed(() => {
  const tab = currentTab.value;

  if (!tab) {
    return {
      gridTemplateRows: `${TABBAR_HEIGHT}px minmax(0, 1fr)`,
    };
  }

  if (props.sftpCollapsed) {
    return {
      gridTemplateRows: `${TABBAR_HEIGHT}px minmax(${MIN_TERMINAL_HEIGHT}px, 1fr) ${SPLITTER_HEIGHT}px 38px`,
    };
  }

  const sftpRatio = tab.sftpHeightRatio ?? DEFAULT_SFTP_RATIO;
  const terminalRatio = 1 - sftpRatio;

  return {
    gridTemplateRows: `${TABBAR_HEIGHT}px minmax(${MIN_TERMINAL_HEIGHT}px, ${terminalRatio}fr) ${SPLITTER_HEIGHT}px minmax(${MIN_SFTP_HEIGHT}px, ${sftpRatio}fr)`,
  };
});

function openTabContextMenu(event: MouseEvent, tab: TerminalTab) {
  emit("select-tab", tab.id);
  tabContextMenu.value = {
    open: true,
    tab,
    x: event.clientX,
    y: event.clientY,
  };
}

function closeTabContextMenu() {
  tabContextMenu.value = {
    open: false,
    x: 0,
    y: 0,
  };
}

function beginRenameTab(tab: TerminalTab) {
  closeTabContextMenu();
  editingTabId.value = tab.id;
  editingTabTitle.value = tab.title;

  void nextTick(() => {
    focusTabRenameInput();
  });
}

function setTabRenameInput(element: Element | ComponentPublicInstance | null) {
  tabRenameInput.value = element instanceof HTMLInputElement ? element : undefined;
}

function focusTabRenameInput() {
  tabRenameInput.value?.focus();
  tabRenameInput.value?.select();
}

function commitTabRename(tab: TerminalTab) {
  if (editingTabId.value !== tab.id) {
    return;
  }

  const title = editingTabTitle.value.trim();
  editingTabId.value = "";
  editingTabTitle.value = "";

  if (title && title !== tab.title) {
    emit("rename-tab", tab.id, title);
  }
}

function cancelTabRename() {
  editingTabId.value = "";
  editingTabTitle.value = "";
}

function runMenuAction(action: () => void) {
  closeTabContextMenu();
  action();
}

function closeTabFromMenu(tabId: string) {
  runMenuAction(() => emit("close-tab", tabId));
}

function closeOtherTabsFromMenu(tabId: string) {
  runMenuAction(() => emit("close-other-tabs", tabId));
}

function reconnectTabFromMenu(tabId: string) {
  runMenuAction(() => emit("reconnect-tab", tabId));
}

function resetSftpSplitFromMenu(tabId: string) {
  runMenuAction(() => emit("reset-sftp-split-for-tab", tabId));
}

function toggleSftpFromMenu(tabId: string) {
  runMenuAction(() => emit("toggle-sftp-for-tab", tabId));
}

function renameSftpEntryFromPane(entry: RemoteFileEntry, name: string) {
  if (!currentTab.value) {
    return;
  }

  emit("sftp-entry-rename", currentTab.value.id, entry, name);
}

function startSplitResize(event: PointerEvent) {
  if (!currentTab.value || props.sftpCollapsed || !workspaceElement.value) {
    return;
  }

  const tabId = currentTab.value.id;
  const bounds = workspaceElement.value.getBoundingClientRect();
  const availableHeight = bounds.height - TABBAR_HEIGHT - SPLITTER_HEIGHT;

  if (availableHeight <= MIN_TERMINAL_HEIGHT + MIN_SFTP_HEIGHT) {
    return;
  }

  const target = event.currentTarget as HTMLElement;
  const pointerId = event.pointerId;
  target.setPointerCapture(pointerId);

  const updateRatio = (clientY: number) => {
    const terminalHeight = clientY - bounds.top - TABBAR_HEIGHT;
    const sftpHeight = availableHeight - terminalHeight;
    const minRatio = MIN_SFTP_HEIGHT / availableHeight;
    const maxRatio = 1 - MIN_TERMINAL_HEIGHT / availableHeight;
    const ratio = Math.min(Math.max(sftpHeight / availableHeight, minRatio), maxRatio);

    emit("resize-sftp-split", tabId, ratio);
  };

  const handlePointerMove = (moveEvent: PointerEvent) => {
    updateRatio(moveEvent.clientY);
  };

  const stopResize = () => {
    document.body.classList.remove("is-resizing-sftp");
    target.releasePointerCapture(pointerId);
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
  };

  document.body.classList.add("is-resizing-sftp");
  updateRatio(event.clientY);
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", stopResize);
  window.addEventListener("pointercancel", stopResize);
}
</script>

<template>
  <main ref="workspaceElement" class="workspace" :style="workspaceGridRows">
    <nav class="tabbar" aria-label="Terminal tabs">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="tab"
        :class="{
          'tab--active': tab.id === activeTabId,
          'tab--error': tab.status === 'error',
          'tab--warning': tab.status === 'warning'
        }"
        role="button"
        tabindex="0"
        @click="emit('select-tab', tab.id)"
        @keydown.enter.prevent="emit('select-tab', tab.id)"
        @keydown.space.prevent="emit('select-tab', tab.id)"
        @contextmenu.prevent="openTabContextMenu($event, tab)"
      >
        <span class="tab__status" />
        <input
          v-if="editingTabId === tab.id"
          :ref="setTabRenameInput"
          v-model="editingTabTitle"
          class="tab__rename-input"
          @blur="commitTabRename(tab)"
          @click.stop
          @contextmenu.stop
          @keydown.enter.prevent="commitTabRename(tab)"
          @keydown.esc.prevent="cancelTabRename"
          @mousedown.stop
        >
        <span v-else class="tab__title">{{ tab.title }}</span>
        <button
          class="tab__close"
          title="关闭 Tab"
          type="button"
          @click.stop="emit('close-tab', tab.id)"
        >
          <X
            :size="13"
          />
        </button>
      </div>
      <button
        class="tab tab--new"
        title="新建 Terminal Tab"
        type="button"
        @click="emit('create-tab')"
      >
        +
      </button>
    </nav>

    <section v-if="!currentTab" class="workspace-empty">
      <h2>还没有打开的 Terminal Tab</h2>
      <p>选择一个服务器来开始新的 SSH 会话。</p>
      <button type="button" @click="emit('create-tab')">选择服务器</button>
    </section>

    <section v-else class="terminal-panel" :class="{ 'terminal-panel--expanded': sftpCollapsed }">
      <div class="terminal-panel__toolbar">
        <span>{{ currentTab.cwd }}</span>
        <div class="terminal-panel__actions">
          <button title="重置分栏比例" type="button" @click="emit('reset-sftp-split')">
            <RotateCcw :size="15" />
          </button>
          <button title="显示/隐藏 SFTP" type="button" @click="emit('toggle-sftp')">
            <PanelBottomClose :size="15" />
          </button>
        </div>
      </div>
      <TerminalView
        :key="currentTab.id"
        :content="currentTab.output"
        :cwd="currentTab.cwd"
        @data="emit('terminal-input', currentTab.id, $event)"
        @resize="emit('terminal-resize', currentTab.id, $event)"
      />
    </section>

    <button
      v-if="currentTab"
      class="splitter"
      title="拖拽调整 SFTP 高度，双击折叠/展开"
      type="button"
      @pointerdown="startSplitResize"
      @dblclick="emit('toggle-sftp')"
    />

    <SftpPane
      v-if="currentTab"
      :collapsed="sftpCollapsed"
      :drag-active="sftpDragActive"
      :follow-terminal-cwd="currentTab.sftpFollowTerminalCwd"
      :follow-terminal-cwd-error="currentTab.sftpFollowTerminalCwdError"
      :follow-terminal-cwd-status="currentTab.sftpFollowTerminalCwdStatus"
      :sftp="currentTab.sftp"
      @cancel-download="emit('sftp-cancel-download', currentTab.id)"
      @cancel-upload="emit('sftp-cancel-upload', currentTab.id)"
      @drag-active="emit('sftp-drag-active', $event)"
      @clear-transfer-queue="emit('sftp-clear-transfer-queue', currentTab.id)"
      @download="emit('sftp-download', currentTab.id)"
      @entry-context-delete="emit('sftp-entry-delete', currentTab.id, $event)"
      @entry-context-download="emit('sftp-download', currentTab.id)"
      @entry-context-edit="emit('sftp-entry-edit', currentTab.id, $event)"
      @entry-context-rename="renameSftpEntryFromPane"
      @entry-open="emit('sftp-entry-open', currentTab.id, $event)"
      @go-parent="emit('sftp-go-parent', currentTab.id)"
      @new-folder="emit('sftp-new-folder', currentTab.id)"
      @refresh="emit('sftp-refresh', currentTab.id)"
      @remove-transfer-item="emit('sftp-remove-transfer-item', currentTab.id, $event)"
      @select-entry="emit('sftp-select-entry', currentTab.id, $event)"
      @toggle-collapse="emit('toggle-sftp')"
      @toggle-follow-cwd="emit('sftp-toggle-follow-cwd', currentTab.id)"
      @upload="emit('sftp-upload', currentTab.id)"
    >
      <template #collapsed-icon>
        <ChevronUp :size="16" />
      </template>
    </SftpPane>

    <TerminalTabContextMenu
      :open="tabContextMenu.open"
      :sftp-collapsed="sftpCollapsed"
      :tab="tabContextMenu.tab"
      :x="tabContextMenu.x"
      :y="tabContextMenu.y"
      @close-tab="closeTabFromMenu"
      @close-others="closeOtherTabsFromMenu"
      @dismiss="closeTabContextMenu"
      @reconnect="reconnectTabFromMenu"
      @rename="beginRenameTab"
      @reset-sftp-split="resetSftpSplitFromMenu"
      @toggle-sftp="toggleSftpFromMenu"
    />
  </main>
</template>

<style scoped>
.workspace {
  display: grid;
  min-width: 0;
  min-height: 0;
  flex: 1;
  background: var(--surface-1);
}

.workspace-empty {
  display: grid;
  grid-row: 2 / -1;
  place-content: center;
  justify-items: center;
  gap: 8px;
  padding: 24px;
  color: var(--text-muted);
  text-align: center;
}

.workspace-empty h2 {
  margin: 0;
  color: var(--text-strong);
  font-size: 18px;
}

.workspace-empty p {
  margin: 0 0 8px;
  font-size: 13px;
}

.workspace-empty button {
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  color: #ffffff;
  background: var(--accent);
  cursor: pointer;
}

.workspace-empty button:hover {
  background: var(--accent-strong);
}

.tabbar {
  display: flex;
  align-items: end;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  gap: 2px;
  padding: 5px 10px 0;
  border-bottom: 1px solid var(--app-border);
  background: var(--surface-3);
}

.tab {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  max-width: 168px;
  height: 32px;
  padding: 0 10px;
  border-radius: 7px 7px 0 0;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

.tab:hover {
  color: var(--text-strong);
  background: var(--surface-hover);
}

.tab--active {
  color: var(--text-strong);
  background: var(--surface-active);
}

.tab__status {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--success);
}

.tab--warning .tab__status {
  background: var(--warning);
}

.tab--error .tab__status {
  background: var(--danger);
}

.tab__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 620;
}

.tab__rename-input {
  width: 94px;
  min-width: 0;
  height: 22px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 0 6px;
  color: var(--text-strong);
  background: var(--field-bg);
  font-size: 12px;
  outline: none;
}

.tab__close {
  display: grid;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 4px;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

.tab__close:hover {
  color: var(--text-strong);
  background: var(--surface-hover);
}

.tab--new {
  width: 34px;
  justify-content: center;
  padding: 0;
  font-size: 18px;
}

.terminal-panel {
  display: grid;
  min-height: 0;
  grid-template-rows: 30px minmax(0, 1fr);
  background: #0c0f13;
}

.terminal-panel--expanded {
  grid-row: span 1;
}

.terminal-panel__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid #202630;
  color: #7f8b99;
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
  font-size: 12px;
}

.terminal-panel__actions {
  display: flex;
  gap: 4px;
}

.terminal-panel__actions button {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 5px;
  color: #8793a1;
  background: transparent;
  cursor: pointer;
}

.terminal-panel__actions button:hover {
  color: #eef3f8;
  background: #252b35;
}

.splitter {
  width: 100%;
  height: 5px;
  background: var(--app-border);
  cursor: row-resize;
  touch-action: none;
  user-select: none;
}

.splitter:hover {
  background: var(--accent-soft-hover);
}

:global(body.is-resizing-sftp) {
  cursor: row-resize;
  user-select: none;
}
</style>
