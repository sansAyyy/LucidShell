<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { RemoteFileEntry } from "../../../entities/sftp/model/types";
import { clampFloatingMenuPosition } from "../../../shared/lib/floatingMenuPosition";

const props = defineProps<{
  entry?: RemoteFileEntry;
  open: boolean;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  close: [];
  delete: [entry: RemoteFileEntry];
  download: [entry: RemoteFileEntry];
  edit: [entry: RemoteFileEntry];
  rename: [entry: RemoteFileEntry];
}>();

const menuElement = ref<HTMLElement>();
const menuPosition = ref({ left: 0, top: 0 });

watch(
  () => [props.open, props.x, props.y, props.entry?.id] as const,
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
    <div v-if="open && entry" class="menu-layer" @click="emit('close')" @contextmenu.prevent="emit('close')">
      <div
        ref="menuElement"
        class="context-menu"
        :style="{ left: `${menuPosition.left}px`, top: `${menuPosition.top}px` }"
        @click.stop
      >
        <div class="context-menu__title">{{ entry.name }}</div>
        <button v-if="entry.kind === 'file'" type="button" @click="emit('edit', entry)">本地编辑</button>
        <button v-if="entry.kind === 'file'" type="button" @click="emit('download', entry)">下载</button>
        <button type="button" @click="emit('rename', entry)">重命名</button>
        <div class="context-menu__separator" />
        <button class="context-menu__danger" type="button" @click="emit('delete', entry)">删除</button>
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
  width: 172px;
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

.context-menu .context-menu__danger {
  color: var(--danger);
}

.context-menu .context-menu__danger:hover {
  color: #ffffff;
  background: var(--danger-hover);
}
</style>
