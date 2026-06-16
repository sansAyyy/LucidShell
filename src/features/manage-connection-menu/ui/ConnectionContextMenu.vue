<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { ConnectionGroup, ServerConnection } from "../../../entities/server/model/types";
import {
  clampFloatingMenuPosition,
  clampFloatingPanelTop,
  shouldOpenFloatingPanelToLeft,
} from "../../../shared/lib/floatingMenuPosition";

const props = defineProps<{
  groups: ConnectionGroup[];
  open: boolean;
  server?: ServerConnection;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  connect: [server: ServerConnection];
  close: [];
  delete: [serverId: string];
  disconnect: [serverId: string];
  duplicate: [serverId: string];
  edit: [server: ServerConnection];
  move: [serverId: string, groupId: string];
  retry: [serverId: string];
  toggleFavorite: [serverId: string];
}>();

const menuElement = ref<HTMLElement>();
const submenuElement = ref<HTMLElement>();
const submenuPanelElement = ref<HTMLElement>();
const menuPosition = ref({ left: 0, top: 0 });
const submenuOpensLeft = ref(false);
const submenuTop = ref(-5);

watch(
  () => [props.open, props.x, props.y, props.server?.id, props.groups.length] as const,
  async () => {
    if (!props.open) {
      return;
    }

    menuPosition.value = { left: props.x, top: props.y };
    submenuOpensLeft.value = false;
    submenuTop.value = -5;
    await nextTick();

    if (menuElement.value) {
      menuPosition.value = clampFloatingMenuPosition(props.x, props.y, menuElement.value);
    }

    await nextTick();
    updateSubmenuPosition();
  },
  { immediate: true },
);

function updateSubmenuPosition() {
  if (!submenuElement.value || !submenuPanelElement.value) {
    return;
  }

  submenuOpensLeft.value = shouldOpenFloatingPanelToLeft(submenuElement.value, submenuPanelElement.value);
  submenuTop.value = clampFloatingPanelTop(submenuElement.value, submenuPanelElement.value);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open && server" class="menu-layer" @click="emit('close')" @contextmenu.prevent="emit('close')">
      <div
        ref="menuElement"
        class="context-menu"
        :style="{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px` }"
        @click.stop
      >
      <div class="context-menu__title">{{ server.name }}</div>
      <button
        v-if="
          server.status === 'connected'
          || server.status === 'connecting'
          || server.status === 'reconnecting'
          || server.status === 'disconnecting'
        "
        type="button"
        :disabled="server.status === 'disconnecting' || server.status === 'reconnecting'"
        @click="emit('disconnect', server.id)"
      >
        {{ server.status === 'reconnecting' ? '重连中' : '断开连接' }}
      </button>
        <button v-else-if="server.status === 'error'" type="button" @click="emit('retry', server.id)">
          重新连接
        </button>
        <button v-else type="button" @click="emit('connect', server)">
          连接
        </button>
        <div class="context-menu__separator" />
        <button type="button" @click="emit('edit', server)">编辑连接</button>
        <button type="button" @click="emit('duplicate', server.id)">复制连接</button>
        <button type="button" @click="emit('toggleFavorite', server.id)">
          {{ server.favorite ? "从收藏移除" : "新增到收藏" }}
        </button>
        <div class="context-menu__separator" />
        <div
          ref="submenuElement"
          class="context-menu__submenu"
          :class="{ 'context-menu__submenu--left': submenuOpensLeft }"
          @mouseenter="updateSubmenuPosition"
          @focusin="updateSubmenuPosition"
        >
          <button type="button">
            <span>移动到分组</span>
            <span class="context-menu__arrow">›</span>
          </button>
          <div
            ref="submenuPanelElement"
            class="context-menu__submenu-panel"
            :style="{ top: `${submenuTop}px` }"
          >
            <button
              type="button"
              :disabled="!server.groupId"
              @click="emit('move', server.id, '')"
            >
              未分组
            </button>
            <button
              v-for="group in groups"
              :key="group.id"
              type="button"
              :disabled="server.groupId === group.id"
              @click="emit('move', server.id, group.id)"
            >
              {{ group.name }}
            </button>
          </div>
        </div>
        <div class="context-menu__separator" />
        <button class="context-menu__danger" type="button" @click="emit('delete', server.id)">删除连接</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.menu-layer {
  position: fixed;
  inset: 0;
  z-index: 30;
}

.context-menu {
  position: fixed;
  width: 190px;
  border: 1px solid var(--field-border);
  border-radius: 7px;
  padding: 5px;
  background: var(--surface-4);
  box-shadow: var(--shadow-strong);
}

.context-menu__title,
.context-menu__label {
  overflow: hidden;
  padding: 7px 8px 5px;
  color: var(--text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-menu button {
  width: 100%;
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: 5px;
  padding: 0 8px;
  color: var(--text-main);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.context-menu button:hover:not(:disabled) {
  background: var(--surface-hover);
}

.context-menu button:disabled {
  color: var(--text-subtle);
  cursor: default;
}

.context-menu__separator {
  height: 1px;
  margin: 5px 4px;
  background: var(--app-border);
}

.context-menu__submenu {
  position: relative;
}

.context-menu__submenu::after {
  position: absolute;
  top: 0;
  right: -8px;
  width: 8px;
  height: 100%;
  content: "";
}

.context-menu__arrow {
  color: var(--text-muted);
}

.context-menu__submenu-panel {
  position: absolute;
  left: calc(100% + 4px);
  display: none;
  min-width: 150px;
  border: 1px solid var(--field-border);
  border-radius: 7px;
  padding: 5px;
  background: var(--surface-4);
  box-shadow: var(--shadow-strong);
}

.context-menu__submenu--left .context-menu__submenu-panel {
  right: calc(100% + 4px);
  left: auto;
}

.context-menu__submenu:hover .context-menu__submenu-panel,
.context-menu__submenu:focus-within .context-menu__submenu-panel {
  display: block;
}

.context-menu .context-menu__danger {
  color: var(--danger);
}

.context-menu .context-menu__danger:hover {
  color: #ffffff;
  background: var(--danger-hover);
}
</style>
