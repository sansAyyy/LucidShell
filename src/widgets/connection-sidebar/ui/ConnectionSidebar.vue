<script setup lang="ts">
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Filter,
  FolderPlus,
  History,
  PanelLeftClose,
  Search,
  Star,
} from "@lucide/vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { computed, ref } from "vue";
import { useDiagnosticsStore } from "../../../entities/diagnostics/model/diagnosticsStore";
import { useLayoutStore } from "../../../entities/layout/model/layoutStore";
import { useNotificationStore } from "../../../entities/notification/model/notificationStore";
import { useServerStore } from "../../../entities/server/model/serverStore";
import type { ServerConnection, ServerConnectionForm } from "../../../entities/server/model/types";
import {
  deleteKeychainPassword,
  readKeychainPassword,
  saveKeychainPassword,
} from "../../../shared/api/tauri/server";
import ServerListItem from "../../../entities/server/ui/ServerListItem.vue";
import { CreateConnectionGroupDialog } from "../../../features/create-connection-group";
import {
  ConnectionFormDialog,
  createConnectionFormFromServer,
  createEmptyConnectionForm,
} from "../../../features/manage-connection-form";
import { ConnectionContextMenu } from "../../../features/manage-connection-menu";

defineProps<{
  collapsed: boolean;
}>();

const emit = defineEmits<{
  "toggle-collapse": [];
}>();

const serverStore = useServerStore();
const layoutStore = useLayoutStore();
const notification = useNotificationStore();
const diagnostics = useDiagnosticsStore();
const search = ref("");
const importFileInput = ref<HTMLInputElement>();
const groupDialogOpen = ref(false);
const formDialogOpen = ref(false);
const formMode = ref<"create" | "edit">("create");
const connectionForm = ref<ServerConnectionForm>(createEmptyConnectionForm());
const contextMenu = ref<{
  open: boolean;
  server?: ServerConnection;
  x: number;
  y: number;
}>({
  open: false,
  x: 0,
  y: 0,
});

const normalizedSearch = computed(() => search.value.trim().toLowerCase());
const activeServerId = computed(() => layoutStore.activeTab?.serverProfileId);

const visibleServers = computed(() => {
  if (!normalizedSearch.value) {
    return serverStore.servers;
  }

  return serverStore.servers.filter((server) =>
    [server.name, server.host, server.user].some((part) => part.toLowerCase().includes(normalizedSearch.value)),
  );
});

const favoriteServers = computed(() => visibleServers.value.filter((server) => server.favorite));
const ungroupedServers = computed(() => visibleServers.value.filter((server) => !server.groupId && !server.favorite));
const existingConnectionNames = computed(() =>
  serverStore.servers
    .filter((server) => server.id !== connectionForm.value.id)
    .map((server) => server.name),
);

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function createUniqueServerId() {
  let id = createId("server");

  while (serverStore.servers.some((server) => server.id === id)) {
    id = createId("server");
  }

  return id;
}

function serversByGroup(groupId: string) {
  return visibleServers.value.filter((server) => server.groupId === groupId && !server.favorite);
}

function openCreateConnection() {
  formMode.value = "create";
  connectionForm.value = createEmptyConnectionForm();
  formDialogOpen.value = true;
}

defineExpose({
  openCreateConnection,
});

function openEditConnection(server: ServerConnection) {
  closeContextMenu();
  formMode.value = "edit";
  connectionForm.value = createConnectionFormFromServer(server);
  formDialogOpen.value = true;
}

async function syncKeychainPassword(form: ServerConnectionForm, serverId: string) {
  if (!isTauri()) {
    return;
  }

  if (form.authType !== "password" || form.credentialStorage !== "keychain") {
    await deleteKeychainPassword(serverId);
    return;
  }

  if (form.password) {
    await saveKeychainPassword(serverId, form.password);
    return;
  }

  const existingPassword = await readKeychainPassword(serverId);
  if (!existingPassword) {
    throw new Error("请输入密码以保存到系统凭据。");
  }
}

async function saveConnection(form: ServerConnectionForm) {
  const serverId = form.id ?? createUniqueServerId();
  const nextForm = { ...form, id: serverId };

  try {
    await syncKeychainPassword(nextForm, serverId);
  } catch (error) {
    diagnostics.record({
      context: {
        error: String(error),
        serverId,
      },
      level: "error",
      message: "系统凭据保存失败",
      scope: "credential",
    });
    notification.showToast(`系统凭据保存失败：${String(error)}`, "error");
    return;
  }

  const saved =
    formMode.value === "create"
      ? serverStore.addServer(nextForm)
      : serverStore.updateServer(nextForm);

  if (!saved) {
    diagnostics.record({
      context: {
        mode: formMode.value,
        serverId,
      },
      level: "error",
      message: "连接配置保存失败",
      scope: "connection",
    });
    if (formMode.value === "create") {
      await deleteKeychainPassword(serverId).catch(() => undefined);
    }
    notification.showToast("连接配置保存失败，请检查名称是否重复或字段是否完整。", "error");
    return;
  }

  formDialogOpen.value = false;
  notification.showToast("连接配置已保存。", "success");
}

function createGroup(name: string) {
  serverStore.addGroup(name);
  groupDialogOpen.value = false;
}

function openContextMenu(event: MouseEvent, server: ServerConnection) {
  contextMenu.value = {
    open: true,
    server,
    x: event.clientX,
    y: event.clientY,
  };
}

function selectServer(serverId: string) {
  const server = serverStore.servers.find((item) => item.id === serverId);

  if (server) {
    layoutStore.openServerInNewTab(server);
  }
}

function connectServer(server: ServerConnection) {
  closeContextMenu();
  layoutStore.openServerInNewTab(server);
}

function retryServer(serverId: string) {
  closeContextMenu();
  void layoutStore.retryServerConnection(serverId);
}

function disconnectServer(serverId: string) {
  closeContextMenu();
  void layoutStore.disconnectServerProfile(serverId);
}

function closeContextMenu() {
  contextMenu.value = {
    open: false,
    x: 0,
    y: 0,
  };
}

function duplicateServer(serverId: string) {
  serverStore.duplicateServer(serverId);
  closeContextMenu();
}

async function deleteServer(serverId: string) {
  const server = serverStore.servers.find((item) => item.id === serverId);

  if (!server) {
    return;
  }

  if (await notification.confirm({
    title: "删除连接",
    message: `确定删除连接 "${server.name}" 吗？`,
    confirmText: "删除",
  })) {
    serverStore.deleteServer(serverId);
    await deleteKeychainPassword(serverId).catch(() => undefined);
    notification.showToast("连接已删除。", "success");
  }

  closeContextMenu();
}

function toggleFavorite(serverId: string) {
  serverStore.toggleFavorite(serverId);
  closeContextMenu();
}

function moveServer(serverId: string, groupId: string) {
  serverStore.moveServerToGroup(serverId, groupId);
  closeContextMenu();
}

async function exportConnections() {
  const exported = serverStore.exportConnections();
  const date = new Date().toISOString().slice(0, 10);
  const fileName = `lucidshell-connections-${date}.json`;

  if (isTauri()) {
    const path = await save({
      defaultPath: fileName,
      filters: [
        {
          name: "LucidShell Connections",
          extensions: ["json"],
        },
      ],
      title: "导出连接配置",
    });

    if (!path) {
      return;
    }

    await invoke("export_connections_to_file", {
      path,
      content: exported,
    });

    notification.showToast("连接配置已导出。明文保存的密码会包含在导出文件中。", "success");
    return;
  }

  const blob = new Blob([exported], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);

  notification.showToast("连接配置已下载。明文保存的密码会包含在导出文件中。", "success");
}

async function importConnections() {
  if (!isTauri()) {
    importFileInput.value?.click();
    return;
  }

  const path = await open({
    filters: [
      {
        name: "LucidShell Connections",
        extensions: ["json"],
      },
    ],
    multiple: false,
    title: "导入连接配置",
  });

  if (!path || Array.isArray(path)) {
    return;
  }

  if (!await notification.confirm({
    title: "导入连接配置",
    message: "导入会覆盖当前本地连接配置，确定继续吗？",
    confirmText: "导入",
  })) {
    return;
  }

  const raw = await invoke<string>("read_connections_import_file", { path });
  const imported = serverStore.importConnections(raw);

  notification.showToast(imported ? "连接配置已导入，系统凭据需要重新输入密码。" : "导入失败：文件格式不正确。", imported ? "success" : "error");
}

async function importConnectionsFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  input.value = "";

  if (!file) {
    return;
  }

  if (!await notification.confirm({
    title: "导入连接配置",
    message: "导入会覆盖当前本地连接配置，确定继续吗？",
    confirmText: "导入",
  })) {
    return;
  }

  const raw = await file.text();
  const imported = serverStore.importConnections(raw);

  notification.showToast(imported ? "连接配置已导入，系统凭据需要重新输入密码。" : "导入失败：文件格式不正确。", imported ? "success" : "error");
}

async function importConnectionsFromDrop(event: DragEvent) {
  const file = event.dataTransfer?.files[0];

  if (!file) {
    return;
  }

  const raw = await file.text();
  if (!await notification.confirm({
    title: "导入连接配置",
    message: "导入会覆盖当前本地连接配置，确定继续吗？",
    confirmText: "导入",
  })) {
    return;
  }

  const imported = serverStore.importConnections(raw);
  notification.showToast(imported ? "连接配置已导入，系统凭据需要重新输入密码。" : "导入失败：文件格式不正确。", imported ? "success" : "error");
}

</script>

<template>
  <aside
    class="sidebar"
    :class="{ 'sidebar--collapsed': collapsed }"
    @dragover.prevent
    @drop.prevent="importConnectionsFromDrop"
  >
    <input
      ref="importFileInput"
      class="sr-only"
      accept="application/json,.json"
      type="file"
      @change="importConnectionsFile"
    />
    <template v-if="collapsed">
      <button class="rail-button rail-button--brand" title="展开连接栏" type="button" @click="emit('toggle-collapse')">
        LS
      </button>
      <button class="rail-button" title="搜索连接" type="button" @click="emit('toggle-collapse')">
        <Search :size="18" />
      </button>
      <button class="rail-button" title="收藏" type="button" @click="emit('toggle-collapse')">
        <Star :size="18" />
      </button>
      <button class="rail-button" title="最近连接" type="button" @click="emit('toggle-collapse')">
        <History :size="18" />
      </button>
    </template>

    <template v-else>
      <div class="sidebar__header">
        <span class="sidebar__title">连接</span>
        <div class="sidebar__tools">
          <button class="tool-button" title="导入连接" type="button" @click="importConnections">
            <ArrowDownToLine :size="17" />
          </button>
          <button class="tool-button" title="导出连接" type="button" @click="exportConnections">
            <ArrowUpFromLine :size="17" />
          </button>
          <button class="tool-button" title="新增分组" type="button" @click="groupDialogOpen = true">
            <FolderPlus :size="17" />
          </button>
          <button class="tool-button" title="折叠连接栏" type="button" @click="emit('toggle-collapse')">
            <PanelLeftClose :size="17" />
          </button>
        </div>
      </div>

      <div class="search-row">
        <Search class="search-row__icon" :size="18" />
        <input v-model="search" class="search-row__input" placeholder="搜索..." />
        <button class="search-row__button" title="筛选/排序" type="button">
          <Filter :size="18" />
        </button>
      </div>

      <div class="sidebar__groups">
        <section v-if="favoriteServers.length" class="server-group">
          <h2>Favorites</h2>
          <ServerListItem
            v-for="server in favoriteServers"
            :key="server.id"
            :active="server.id === activeServerId"
            :server="server"
            @context="openContextMenu"
            @select="selectServer"
          />
        </section>

        <section v-if="ungroupedServers.length" class="server-group">
          <h2>未分组</h2>
          <ServerListItem
            v-for="server in ungroupedServers"
            :key="server.id"
            :active="server.id === activeServerId"
            :server="server"
            @context="openContextMenu"
            @select="selectServer"
          />
        </section>

        <section v-for="group in serverStore.groups" :key="group.id" class="server-group">
          <h2>{{ group.name }}</h2>
          <ServerListItem
            v-for="server in serversByGroup(group.id)"
            :key="server.id"
            :active="server.id === activeServerId"
            :server="server"
            @context="openContextMenu"
            @select="selectServer"
          />
          <p v-if="!serversByGroup(group.id).length" class="server-group__empty">暂无连接</p>
        </section>

      </div>
    </template>

    <ConnectionFormDialog
      :existing-names="existingConnectionNames"
      :groups="serverStore.groups"
      :model-value="connectionForm"
      :mode="formMode"
      :open="formDialogOpen"
      @cancel="formDialogOpen = false"
      @save="saveConnection"
    />

    <CreateConnectionGroupDialog
      :open="groupDialogOpen"
      @cancel="groupDialogOpen = false"
      @create="createGroup"
    />

    <ConnectionContextMenu
      :groups="serverStore.groups"
      :open="contextMenu.open"
      :server="contextMenu.server"
      :x="contextMenu.x"
      :y="contextMenu.y"
      @connect="connectServer"
      @close="closeContextMenu"
      @delete="deleteServer"
      @disconnect="disconnectServer"
      @duplicate="duplicateServer"
      @edit="openEditConnection"
      @move="moveServer"
      @retry="retryServer"
      @toggle-favorite="toggleFavorite"
    />
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex: 0 0 268px;
  width: 268px;
  min-height: 0;
  flex-direction: column;
  border-right: 1px solid var(--app-border);
  background: var(--surface-4);
  transition: width 140ms ease, flex-basis 140ms ease;
}

.sidebar--collapsed {
  flex-basis: 52px;
  width: 52px;
  align-items: center;
  padding-top: 8px;
  gap: 6px;
}

.sidebar__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 8px 0 14px;
  border-bottom: 1px solid var(--app-border);
}

.sidebar__title {
  color: var(--text-strong);
  font-size: 14px;
  font-weight: 650;
}

.sidebar__tools {
  display: flex;
  align-items: center;
  gap: 2px;
}

.tool-button,
.search-row__button,
.rail-button {
  display: grid;
  place-items: center;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

.tool-button {
  width: 26px;
  height: 28px;
  border-radius: 5px;
}

.tool-button:hover,
.search-row__button:hover,
.rail-button:hover {
  color: var(--text-strong);
  background: var(--surface-hover);
}

.search-row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) 28px;
  align-items: center;
  gap: 4px;
  margin: 10px 8px;
  padding: 0 5px 0 8px;
  border: 1px solid var(--field-border);
  border-radius: 7px;
  background: var(--field-bg);
}

.search-row__icon {
  color: var(--text-muted);
}

.search-row__input {
  width: 100%;
  height: 34px;
  border: 0;
  color: var(--text-main);
  background: transparent;
  outline: 0;
}

.search-row__input::placeholder {
  color: var(--text-subtle);
}

.search-row__button {
  width: 26px;
  height: 26px;
  border-radius: 5px;
}

.sidebar__groups {
  min-height: 0;
  overflow: auto;
  padding: 2px 8px 12px;
}

.server-group {
  margin-top: 14px;
}

.server-group h2 {
  margin: 0 0 6px;
  padding: 0 6px;
  color: var(--text-subtle);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.server-group__empty {
  margin: 4px 6px 0;
  color: var(--text-muted);
  font-size: 12px;
}

.rail-button {
  display: grid;
  width: 38px;
  height: 36px;
  place-items: center;
  border-radius: 8px;
}

.rail-button--brand {
  color: var(--accent);
  background: var(--accent-soft);
  font-size: 11px;
  font-weight: 750;
}
</style>
