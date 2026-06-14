<script setup lang="ts">
defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
  settings: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="confirm-layer" @click="emit('cancel')" @contextmenu.prevent="emit('cancel')">
      <section class="confirm-dialog" role="dialog" aria-modal="true" aria-label="开启 SFTP 跟随终端目录" @click.stop>
        <header>
          <h2>开启 SFTP 跟随终端目录？</h2>
        </header>

        <div class="confirm-dialog__body">
          <p>SFTP 会跟随当前 Terminal 的工作目录变化，例如终端执行 <code>cd /etc</code> 后，SFTP 会自动切换到 <code>/etc</code>。</p>
          <p>为实现这个能力，LucidShell 会向当前 shell 注入一个轻量 hook，用来读取当前目录。</p>
          <p>也可以在“设置”里开启默认跟随，让新建 Tab 自动启用。</p>
        </div>

        <footer>
          <button type="button" @click="emit('settings')">打开设置</button>
          <button type="button" @click="emit('cancel')">取消</button>
          <button class="confirm-dialog__primary" type="button" @click="emit('confirm')">开启当前 Tab</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-layer {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: grid;
  place-items: center;
  background: var(--overlay-bg);
}

.confirm-dialog {
  width: min(480px, calc(100vw - 32px));
  border: 1px solid var(--field-border);
  border-radius: 8px;
  background: var(--surface-4);
  box-shadow: var(--shadow-strong);
}

.confirm-dialog header {
  display: flex;
  height: 48px;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid var(--app-border);
}

.confirm-dialog h2 {
  margin: 0;
  color: var(--text-strong);
  font-size: 15px;
}

.confirm-dialog__body {
  display: grid;
  gap: 10px;
  padding: 16px;
  color: var(--text-main);
  font-size: 13px;
  line-height: 1.6;
}

.confirm-dialog__body p {
  margin: 0;
}

.confirm-dialog code {
  border-radius: 4px;
  padding: 1px 5px;
  color: var(--accent);
  background: var(--field-bg);
}

.confirm-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px 16px;
  border-top: 1px solid var(--app-border);
}

.confirm-dialog button {
  height: 30px;
  border-radius: 5px;
  padding: 0 11px;
  color: var(--text-main);
  background: var(--surface-hover);
  cursor: pointer;
}

.confirm-dialog button:hover {
  background: var(--surface-active);
}

.confirm-dialog__primary {
  color: #ffffff;
  background: var(--accent);
}

.confirm-dialog__primary:hover {
  background: var(--accent-strong);
}
</style>
