<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { TerminalTab } from "../../../entities/terminal/model/types";
import { clampFloatingMenuPosition } from "../../../shared/lib/floatingMenuPosition";

const props = defineProps<{
  open: boolean;
  sftpCollapsed: boolean;
  tab?: TerminalTab;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  closeTab: [tabId: string];
  closeOthers: [tabId: string];
  dismiss: [];
  reconnect: [tabId: string];
  rename: [tab: TerminalTab];
  resetSftpSplit: [tabId: string];
  toggleSftp: [tabId: string];
}>();

const menuElement = ref<HTMLElement>();
const menuPosition = ref({ left: 0, top: 0 });

watch(
  () => [props.open, props.x, props.y, props.tab?.id] as const,
  async () => {
    if (!props.open) {
      return;
    }

    menuPosition.value = { left: props.x, top: props.y };
    await nextTick();

    if (menuElement.value) {
      menuPosition.value = clampFloatingMenuPosition(props.x, props.y, menuElement.value);
    }
  },
  { immediate: true },
);
</script>

<template>
  <Teleport to="body">
    <div v-if="open && tab" class="menu-layer" @click="emit('dismiss')" @contextmenu.prevent="emit('dismiss')">
      <div
        ref="menuElement"
        class="context-menu"
        :style="{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px` }"
        @click.stop
      >
        <div class="context-menu__title">{{ tab.title }}</div>
        <button type="button" @click="emit('rename', tab)">重命名</button>
        <button type="button" @click="emit('closeTab', tab.id)">关闭 Tab</button>
        <button type="button" @click="emit('closeOthers', tab.id)">关闭其他 Tab</button>
        <div class="context-menu__separator" />
        <button type="button" @click="emit('reconnect', tab.id)">重新连接</button>
        <div class="context-menu__separator" />
        <button type="button" @click="emit('toggleSftp', tab.id)">
          {{ sftpCollapsed ? "显示 SFTP" : "隐藏 SFTP" }}
        </button>
        <button type="button" @click="emit('resetSftpSplit', tab.id)">重置分栏比例</button>
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
  width: 180px;
  border: 1px solid var(--field-border);
  border-radius: 7px;
  padding: 5px;
  background: var(--surface-4);
  box-shadow: var(--shadow-strong);
}

.context-menu__title {
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
  border-radius: 5px;
  padding: 0 8px;
  color: var(--text-main);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.context-menu button:hover {
  background: var(--surface-hover);
}

.context-menu__separator {
  height: 1px;
  margin: 5px 4px;
  background: var(--app-border);
}
</style>
