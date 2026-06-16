<script setup lang="ts">
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Link,
  Link2Off,
  ChevronDown,
  File,
  Folder,
  FolderPlus,
  RefreshCw,
  RotateCcw,
  X,
} from "@lucide/vue";
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from "vue";
import { SftpEntryContextMenu } from "../../../features/sftp-entry-menu";
import type { SftpPaneState } from "../../../entities/sftp/model/types";

const props = defineProps<{
  collapsed: boolean;
  dragActive: boolean;
  followTerminalCwd: boolean;
  followTerminalCwdError?: string;
  followTerminalCwdStatus: "disabled" | "enabling" | "enabled" | "error";
  sftp: SftpPaneState;
}>();

const emit = defineEmits<{
  "cancel-download": [];
  "cancel-upload": [];
  "clear-transfer-queue": [];
  "drag-active": [active: boolean];
  download: [];
  "entry-open": [entry: SftpPaneState["entries"][number]];
  "go-path": [path: string];
  refresh: [];
  "select-entry": [entry: SftpPaneState["entries"][number]];
  "go-parent": [];
  "new-folder": [];
  "entry-context-delete": [entry: SftpPaneState["entries"][number]];
  "entry-context-download": [entry: SftpPaneState["entries"][number]];
  "entry-context-edit": [entry: SftpPaneState["entries"][number]];
  "entry-context-rename": [entry: SftpPaneState["entries"][number], name: string];
  "remove-transfer-item": [itemId: string];
  "retry-transfer-item": [itemId: string];
  "resume-upload-queue": [];
  "toggle-collapse": [];
  "toggle-follow-cwd": [];
  upload: [];
}>();

const contextMenu = ref<{
  entry?: SftpPaneState["entries"][number];
  open: boolean;
  x: number;
  y: number;
}>({
  open: false,
  x: 0,
  y: 0,
});
const renameInput = ref<HTMLInputElement>();
const editingEntryPath = ref("");
const editingEntryName = ref("");
const activeView = ref<"files" | "queue">("files");
const pathSegments = computed(() => buildPathSegments(props.sftp.currentPath));
const canResumeUploadQueue = computed(() =>
  props.sftp.transferQueue.some((item) => item.direction === "upload" && item.status === "queued")
  && !props.sftp.activeUploadId
  && !props.sftp.activeDownloadId,
);

watch(
  [() => props.sftp.activeUploadId, () => props.sftp.transferQueue.length],
  ([activeUploadId, transferQueueLength], [previousActiveUploadId, previousTransferQueueLength]) => {
    const uploadStarted = Boolean(activeUploadId && activeUploadId !== previousActiveUploadId);
    const queueAdded = transferQueueLength > previousTransferQueueLength;

    if (uploadStarted || queueAdded) {
      showTransferQueue();
    }
  },
);

function openContextMenu(event: MouseEvent, entry: SftpPaneState["entries"][number]) {
  emit("select-entry", entry);
  contextMenu.value = {
    entry,
    open: true,
    x: event.clientX,
    y: event.clientY,
  };
}

function closeContextMenu() {
  contextMenu.value = {
    open: false,
    x: 0,
    y: 0,
  };
}

function runContextAction(action: () => void) {
  closeContextMenu();
  action();
}

function showTransferQueue() {
  activeView.value = "queue";
}

function buildPathSegments(path: string) {
  const normalizedPath = path || ".";

  if (normalizedPath === ".") {
    return [{ label: ".", path: "." }];
  }

  const isAbsolute = normalizedPath.startsWith("/");
  const parts = normalizedPath.split("/").filter(Boolean);
  const segments = isAbsolute
    ? [{ label: "/", path: "/" }]
    : [];

  parts.forEach((part, index) => {
    const path = isAbsolute
      ? `/${parts.slice(0, index + 1).join("/")}`
      : parts.slice(0, index + 1).join("/");

    segments.push({
      label: part,
      path,
    });
  });

  return segments.length ? segments : [{ label: normalizedPath, path: normalizedPath }];
}

function goPath(path: string) {
  if (path === props.sftp.currentPath || props.sftp.loading) {
    return;
  }

  emit("go-path", path);
}

function deleteEntry(entry: SftpPaneState["entries"][number]) {
  runContextAction(() => emit("entry-context-delete", entry));
}

function downloadEntry(entry: SftpPaneState["entries"][number]) {
  runContextAction(() => emit("entry-context-download", entry));
}

function editEntry(entry: SftpPaneState["entries"][number]) {
  runContextAction(() => emit("entry-context-edit", entry));
}

function renameEntry(entry: SftpPaneState["entries"][number]) {
  runContextAction(() => beginRenameEntry(entry));
}

function transferStatusLabel(status: SftpPaneState["transferQueue"][number]["status"]) {
  return {
    cancelled: "已取消",
    completed: "已完成",
    error: "失败",
    queued: "等待中",
    running: "传输中",
  }[status];
}

function transferDirectionLabel(direction: SftpPaneState["transferQueue"][number]["direction"]) {
  return direction === "download" ? "下载" : "上传";
}

function cancelTransfer(direction: SftpPaneState["transferQueue"][number]["direction"]) {
  if (direction === "download") {
    emit("cancel-download");
    return;
  }

  emit("cancel-upload");
}

function removeTransferItem(item: SftpPaneState["transferQueue"][number]) {
  if (item.status === "running") {
    cancelTransfer(item.direction);
    return;
  }

  emit("remove-transfer-item", item.id);
}

function retryTransferItem(item: SftpPaneState["transferQueue"][number]) {
  if (!item.retryable) {
    return;
  }

  emit("retry-transfer-item", item.id);
}

function clearTransferQueue() {
  emit("clear-transfer-queue");
}

function resumeUploadQueue() {
  if (!canResumeUploadQueue.value) {
    return;
  }

  emit("resume-upload-queue");
}

function emitUpload() {
  showTransferQueue();
  emit("upload");
}

function emitDownload() {
  emit("download");
}

function emitNewFolder() {
  emit("new-folder");
}

function beginRenameEntry(entry: SftpPaneState["entries"][number]) {
  editingEntryPath.value = entry.path;
  editingEntryName.value = entry.name;

  void nextTick(() => {
    focusRenameInput();
  });
}

function setRenameInput(element: Element | ComponentPublicInstance | null) {
  renameInput.value = element instanceof HTMLInputElement ? element : undefined;
}

function focusRenameInput() {
  renameInput.value?.focus();
  renameInput.value?.select();
}

function commitEntryRename(entry: SftpPaneState["entries"][number]) {
  if (editingEntryPath.value !== entry.path) {
    return;
  }

  const name = editingEntryName.value.trim();
  editingEntryPath.value = "";
  editingEntryName.value = "";

  if (name && name !== entry.name) {
    emit("entry-context-rename", entry, name);
  }
}

function cancelEntryRename() {
  editingEntryPath.value = "";
  editingEntryName.value = "";
}

function followCwdTitle(
  status: "disabled" | "enabling" | "enabled" | "error",
  error?: string,
) {
  if (status === "enabling") {
    return "正在启用 SFTP 跟随终端目录";
  }

  if (status === "error") {
    return error ? `跟随终端目录失败：${error}` : "跟随终端目录失败";
  }

  return status === "enabled" ? "停止跟随终端目录" : "跟随终端目录";
}

function handleDragEnter(event: DragEvent) {
  if (!hasDraggedFiles(event)) {
    return;
  }

  event.preventDefault();
  emit("drag-active", true);
}

function handleDragLeave(event: DragEvent) {
  if (event.currentTarget instanceof HTMLElement && event.relatedTarget instanceof Node) {
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
  }

  emit("drag-active", false);
}

function handleDragOver(event: DragEvent) {
  if (!hasDraggedFiles(event)) {
    return;
  }

  event.preventDefault();
  emit("drag-active", true);
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
}

function handleDrop(event: DragEvent) {
  if (!hasDraggedFiles(event)) {
    return;
  }

  event.preventDefault();
  emit("drag-active", false);
}

function hasDraggedFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function loadingMessage(sftp: SftpPaneState) {
  const path = sftp.loadingPath ?? sftp.currentPath;

  if (sftp.loadingAction === "delete") {
    return `正在删除 ${path}`;
  }

  if (sftp.loadingAction === "refresh") {
    return `正在刷新 ${path}`;
  }

  return `正在打开 ${path}`;
}

</script>

<template>
  <section
    v-if="collapsed"
    class="sftp-strip"
    data-sftp-drop-zone="true"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
    @dragover="handleDragOver"
    @drop="handleDrop"
  >
    <span class="sftp-strip__label">SFTP</span>
    <span class="sftp-strip__path">{{ sftp.currentPath }}</span>
    <span class="sftp-strip__meta">{{ sftp.selectedCount }} selected</span>
    <span class="sftp-strip__meta">{{ sftp.transferSummary }}</span>
    <button title="展开 SFTP" type="button" @click="emit('toggle-collapse')">
      <slot name="collapsed-icon" />
    </button>
  </section>

  <section
    v-else
    class="sftp-pane"
    :class="{ 'sftp-pane--drag-active': dragActive }"
    data-sftp-drop-zone="true"
    @dragenter="handleDragEnter"
    @dragleave="handleDragLeave"
    @dragover="handleDragOver"
    @drop="handleDrop"
  >
    <header class="sftp-pane__header">
      <div class="sftp-pane__path">
        <span>SFTP</span>
        <nav class="sftp-breadcrumb" aria-label="SFTP current path">
          <button
            v-for="(segment, index) in pathSegments"
            :key="`${segment.path}-${index}`"
            :disabled="sftp.loading || segment.path === sftp.currentPath"
            :title="segment.path"
            type="button"
            @click="goPath(segment.path)"
          >
            {{ segment.label }}
          </button>
        </nav>
      </div>
      <div class="sftp-pane__actions">
         <button :disabled="sftp.loading" title="上级目录" type="button" @click="emit('go-parent')">
          ..
        </button>
        <button
          v-if="sftp.activeUploadId"
          title="取消上传队列"
          type="button"
          @click="emit('cancel-upload')"
        >
          <X :size="16" />
        </button>
        <button v-else title="上传" type="button" @click="emitUpload">
          <ArrowUpFromLine :size="16" />
        </button>
        <button
          v-if="sftp.activeDownloadId"
          title="取消下载"
          type="button"
          @click="emit('cancel-download')"
        >
          <X :size="16" />
        </button>
        <button v-else title="下载选中文件" type="button" @click="emitDownload">
          <ArrowDownToLine :size="16" />
        </button>
        <button title="新建文件夹" type="button" @click="emitNewFolder">
          <FolderPlus :size="16" />
        </button>
        <button
          :class="{
            'sftp-pane__action--active': followTerminalCwdStatus === 'enabled',
            'sftp-pane__action--busy': followTerminalCwdStatus === 'enabling',
            'sftp-pane__action--error': followTerminalCwdStatus === 'error'
          }"
          :disabled="followTerminalCwdStatus === 'enabling'"
          :title="followCwdTitle(followTerminalCwdStatus, followTerminalCwdError)"
          type="button"
          @click="emit('toggle-follow-cwd')"
        >
          <Link v-if="followTerminalCwd" :size="16" />
          <Link2Off v-else :size="16" />
        </button>
        <button :disabled="sftp.loading" title="刷新" type="button" @click="emit('refresh')">
          <RefreshCw :size="16" />
        </button>
        <button title="折叠 SFTP" type="button" @click="emit('toggle-collapse')">
          <ChevronDown :size="16" />
        </button>
      </div>
    </header>

    <div v-if="sftp.activeDownloadId || sftp.activeUploadId" class="sftp-pane__progress">
      <span :style="{ width: `${sftp.transferProgress ?? 0}%` }" />
    </div>

    <div class="sftp-tabs">
      <button
        class="sftp-tabs__button"
        :class="{ 'sftp-tabs__button--active': activeView === 'files' }"
        type="button"
        @click="activeView = 'files'"
      >
        文件
      </button>
      <button
        class="sftp-tabs__button"
        :class="{ 'sftp-tabs__button--active': activeView === 'queue' }"
        type="button"
        @click="activeView = 'queue'"
      >
        传输队列
        <span v-if="sftp.transferQueue.length">{{ sftp.transferQueue.length }}</span>
      </button>
    </div>

    <div
      v-if="activeView === 'files'"
      class="file-table"
      :class="{ 'file-table--loading': sftp.loading }"
      role="table"
      aria-label="Remote files"
    >
      <div class="file-table__row file-table__row--head" role="row">
        <span>Name</span>
        <span>Size</span>
        <span>Modified</span>
        <span>Mode</span>
      </div>
      <button
        v-for="entry in sftp.entries"
        :key="entry.id"
        class="file-table__row"
        :class="{ 'file-table__row--selected': sftp.selectedEntryPath === entry.path }"
        type="button"
        role="row"
        :disabled="sftp.loading"
        @click="emit('select-entry', entry)"
        @dblclick="emit('entry-open', entry)"
        @contextmenu.prevent="openContextMenu($event, entry)"
      >
        <span class="file-table__name">
          <Folder v-if="entry.kind === 'directory'" :size="16" />
          <File v-else :size="16" />
          <input
            v-if="editingEntryPath === entry.path"
            :ref="setRenameInput"
            v-model="editingEntryName"
            class="file-table__rename-input"
            @blur="commitEntryRename(entry)"
            @click.stop
            @contextmenu.stop
            @dblclick.stop
            @keydown.enter.prevent="commitEntryRename(entry)"
            @keydown.esc.prevent="cancelEntryRename"
            @mousedown.stop
          >
          <template v-else>{{ entry.name }}</template>
        </span>
        <span>{{ entry.size }}</span>
        <span>{{ entry.modified }}</span>
        <span>{{ entry.mode }}</span>
      </button>

      <div v-if="sftp.loading" class="file-table__loading" aria-live="polite">
        <span class="file-table__spinner" />
        <span>{{ loadingMessage(sftp) }}</span>
      </div>
    </div>

    <div v-else class="transfer-queue">
      <header class="transfer-queue__header">
        <span class="transfer-queue__count">{{ sftp.transferQueue.length }} 项</span>
        <span class="transfer-queue__actions">
          <button
            v-if="canResumeUploadQueue"
            class="transfer-queue__action"
            title="继续剩余上传"
            type="button"
            @click="resumeUploadQueue"
          >
            继续
          </button>
          <button
            class="transfer-queue__action"
            :disabled="!sftp.transferQueue.length"
            title="清空传输队列"
            type="button"
            @click="clearTransferQueue"
          >
            清空
          </button>
        </span>
      </header>
      <div v-if="sftp.transferQueue.length" class="transfer-queue__list">
        <div
          v-for="item in sftp.transferQueue"
          :key="item.id"
          class="transfer-item"
          :class="`transfer-item--${item.status}`"
        >
          <span class="transfer-item__icon">
            <ArrowUpFromLine v-if="item.direction === 'upload'" :size="14" />
            <ArrowDownToLine v-else :size="14" />
          </span>
          <span class="transfer-item__name" :title="item.name">{{ item.name }}</span>
          <span class="transfer-item__summary">
            {{ transferDirectionLabel(item.direction) }} · {{ item.summary ?? transferStatusLabel(item.status) }}
          </span>
          <span class="transfer-item__progress">
            <span :style="{ width: `${item.progress ?? 0}%` }" />
          </span>
          <button
            v-if="item.retryable"
            title="重试任务"
            type="button"
            @click.stop="retryTransferItem(item)"
          >
            <RotateCcw :size="14" />
          </button>
          <button
            :title="item.status === 'running' ? '取消任务' : '从队列移除'"
            type="button"
            @click.stop="removeTransferItem(item)"
          >
            <X :size="14" />
          </button>
        </div>
      </div>
      <div v-else class="transfer-queue__empty">暂无传输任务</div>
    </div>

    <SftpEntryContextMenu
      :entry="contextMenu.entry"
      :open="contextMenu.open"
      :x="contextMenu.x"
      :y="contextMenu.y"
      @close="closeContextMenu"
      @delete="deleteEntry"
      @download="downloadEntry"
      @edit="editEntry"
      @rename="renameEntry"
    />

    <div v-if="dragActive" class="sftp-pane__drop-overlay">
      <strong>释放以上传到当前目录</strong>
      <span>{{ sftp.currentPath }}</span>
    </div>
  </section>
</template>

<style scoped>
.sftp-pane {
  position: relative;
  display: grid;
  min-height: 0;
  grid-template-rows: 36px 31px minmax(0, 1fr);
  border-top: 1px solid var(--app-border);
  background: var(--surface-2);
}

.sftp-pane--drag-active {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.sftp-pane__drop-overlay {
  position: absolute;
  inset: 8px;
  z-index: 5;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 6px;
  border: 1px dashed var(--accent);
  border-radius: 7px;
  color: var(--text-strong);
  background: color-mix(in srgb, var(--surface-4) 86%, transparent);
  pointer-events: none;
}

.sftp-pane__drop-overlay strong {
  font-size: 14px;
}

.sftp-pane__drop-overlay span {
  max-width: min(520px, 86%);
  overflow: hidden;
  color: var(--accent);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sftp-pane__progress {
  position: absolute;
  top: 36px;
  right: 0;
  left: 0;
  z-index: 1;
  height: 3px;
  overflow: hidden;
  background: var(--app-border);
}

.sftp-pane__progress span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--accent-strong);
  transition: width 120ms ease;
}

.sftp-pane__header,
.sftp-strip {
  display: flex;
  align-items: center;
  min-width: 0;
  border-bottom: 1px solid var(--app-border);
}

.sftp-pane__header {
  justify-content: space-between;
  padding: 0 8px 0 12px;
}

.sftp-pane__path {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  color: var(--text-muted);
  font-size: 12px;
}

.sftp-breadcrumb {
  display: flex;
  min-width: 0;
  align-items: center;
  overflow: hidden;
}

.sftp-breadcrumb button {
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  border-radius: 5px;
  padding: 3px 5px;
  color: var(--text-strong);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sftp-breadcrumb button + button::before {
  content: "/";
  margin-right: 5px;
  color: var(--text-subtle);
}

.sftp-breadcrumb button:hover {
  background: var(--surface-hover);
}

.sftp-breadcrumb button:disabled {
  color: var(--text-strong);
  cursor: default;
}

.sftp-breadcrumb button:disabled:hover {
  background: transparent;
}

.sftp-pane__path strong {
  overflow: hidden;
  color: var(--text-strong);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sftp-pane__actions {
  display: flex;
  gap: 4px;
}

.sftp-pane__actions button,
.sftp-strip button {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 5px;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

.sftp-pane__actions button:hover,
.sftp-strip button:hover {
  color: var(--text-strong);
  background: var(--surface-hover);
}

.sftp-pane__actions button:disabled {
  color: var(--text-subtle);
  cursor: default;
}

.sftp-pane__actions .sftp-pane__action--active {
  color: var(--accent);
  background: var(--accent-soft);
}

.sftp-pane__actions .sftp-pane__action--busy {
  color: var(--warning);
  background: #2b2618;
  cursor: wait;
}

.sftp-pane__actions .sftp-pane__action--error {
  color: var(--danger);
  background: #342024;
}

.sftp-tabs {
  display: flex;
  min-height: 0;
  align-items: center;
  gap: 4px;
  padding: 4px 8px 0;
  border-bottom: 1px solid var(--app-border);
  background: var(--surface-2);
}

.sftp-tabs__button {
  display: inline-flex;
  height: 26px;
  align-items: center;
  gap: 6px;
  border-radius: 6px 6px 0 0;
  padding: 0 10px;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
}

.sftp-tabs__button:hover {
  color: var(--text-strong);
  background: var(--surface-hover);
}

.sftp-tabs__button--active {
  color: var(--text-strong);
  background: var(--surface-3);
}

.sftp-tabs__button span {
  min-width: 18px;
  border-radius: 999px;
  padding: 1px 6px;
  color: var(--accent);
  background: var(--accent-soft);
  font-size: 11px;
  text-align: center;
}

.transfer-queue {
  display: grid;
  grid-row: 3;
  min-height: 0;
  align-content: start;
  gap: 8px;
  overflow: auto;
  padding: 8px 10px 14px;
  background: var(--surface-3);
}

.transfer-queue__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 26px;
  padding: 0 4px 2px;
  color: var(--text-muted);
  font-size: 12px;
}

.transfer-queue__count {
  color: var(--text-strong);
  font-weight: 650;
}

.transfer-queue__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.transfer-queue__action {
  height: 24px;
  border: 1px solid var(--field-border);
  border-radius: 5px;
  padding: 0 10px;
  color: var(--text-muted);
  background: var(--surface-2);
  cursor: pointer;
  font-size: 12px;
}

.transfer-queue__action:hover {
  color: var(--text-strong);
  background: var(--surface-hover);
}

.transfer-queue__action:disabled {
  color: var(--text-subtle);
  background: transparent;
  cursor: default;
}

.transfer-queue__list {
  display: grid;
  gap: 3px;
}

.transfer-queue__empty {
  display: grid;
  min-height: 72px;
  place-items: center;
  border: 1px dashed var(--field-border);
  border-radius: 7px;
  color: var(--text-muted);
  font-size: 12px;
}

.transfer-item {
  display: grid;
  grid-template-columns: 22px minmax(120px, 1fr) minmax(70px, auto) 92px 24px;
  min-height: 30px;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
  border-radius: 5px;
  color: var(--text-main);
  font-size: 12px;
}

.transfer-item:hover {
  background: var(--surface-hover);
}

.transfer-item--queued {
  color: var(--text-muted);
}

.transfer-item--completed {
  color: var(--text-main);
}

.transfer-item--completed .transfer-item__icon {
  color: var(--success);
}

.transfer-item--cancelled .transfer-item__icon {
  color: var(--warning);
}

.transfer-item--error .transfer-item__icon {
  color: var(--danger);
}

.transfer-item__icon {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  color: var(--accent);
}

.transfer-item__name,
.transfer-item__summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-item__summary {
  color: var(--text-muted);
}

.transfer-item__progress {
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--app-border);
}

.transfer-item__progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent-strong);
  transition: width 120ms ease;
}

.transfer-item--queued .transfer-item__progress span {
  background: transparent;
}

.transfer-item button {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border-radius: 5px;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

.transfer-item button:hover {
  color: var(--text-strong);
  background: var(--surface-hover);
}

.transfer-item__placeholder {
  width: 22px;
  height: 22px;
}

.file-table {
  position: relative;
  grid-row: 3;
  min-height: 0;
  overflow: auto;
  padding: 6px 8px 12px;
}

.file-table--loading .file-table__row:not(.file-table__row--head) {
  color: var(--text-muted);
}

.file-table__row {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 110px 170px 100px;
  width: 100%;
  min-height: 30px;
  align-items: center;
  gap: 12px;
  padding: 0 8px;
  border-radius: 6px;
  color: var(--text-main);
  background: transparent;
  text-align: left;
}

.file-table__row:not(.file-table__row--head) {
  cursor: pointer;
}

.file-table__row:disabled {
  cursor: wait;
}

.file-table__row:not(.file-table__row--head):hover {
  background: var(--surface-hover);
}

.file-table__row--selected,
.file-table__row--selected:hover {
  background: var(--surface-active);
}

.file-table__row--head {
  color: var(--text-subtle);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.file-table__name {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-table__rename-input {
  min-width: 80px;
  width: min(260px, 100%);
  height: 24px;
  border: 1px solid var(--accent);
  border-radius: 5px;
  padding: 0 7px;
  color: var(--text-strong);
  background: var(--field-bg);
  font-size: 12px;
  outline: none;
}

.file-table__loading {
  position: sticky;
  bottom: 10px;
  left: 0;
  display: inline-flex;
  max-width: min(420px, calc(100% - 16px));
  align-items: center;
  gap: 8px;
  margin: 10px 8px 0;
  border: 1px solid var(--field-border);
  border-radius: 7px;
  padding: 7px 10px;
  color: var(--text-main);
  background: color-mix(in srgb, var(--surface-4) 94%, transparent);
  box-shadow: var(--shadow-strong);
  font-size: 12px;
  pointer-events: none;
}

.file-table__loading span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-table__spinner {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  border: 2px solid var(--app-border);
  border-top-color: var(--accent);
  border-radius: 999px;
  animation: sftp-loading-spin 700ms linear infinite;
}

@keyframes sftp-loading-spin {
  to {
    transform: rotate(360deg);
  }
}

.sftp-strip {
  height: 38px;
  gap: 12px;
  padding: 0 10px 0 12px;
  color: var(--text-main);
  background: var(--surface-2);
}

.sftp-strip__label {
  color: var(--accent);
  font-size: 12px;
  font-weight: 750;
}

.sftp-strip__path {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sftp-strip__meta {
  color: var(--text-muted);
  font-size: 12px;
}
</style>
