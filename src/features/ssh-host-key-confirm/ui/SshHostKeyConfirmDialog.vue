<script setup lang="ts">
defineProps<{
  kind?: "unknown" | "mismatch";
  newFingerprint?: string;
  oldFingerprint?: string;
  open: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="host-key-layer">
      <section class="host-key-dialog" role="dialog" aria-modal="true" aria-label="确认 SSH 主机密钥">
        <header>
          <h2>{{ kind === "mismatch" ? "SSH 主机密钥已变更" : "确认 SSH 主机密钥" }}</h2>
        </header>
        <div class="host-key-dialog__body">
          <p v-if="kind === 'mismatch'" class="host-key-dialog__warning">
            当前服务器返回的指纹与已保存的指纹不一致。只有在确认服务器确实重装系统、更换密钥或由你信任的管理员变更后，才应更新指纹。
          </p>
          <p v-else>这是第一次连接该服务器。请确认服务器指纹可信后再继续。</p>
          <div v-if="kind === 'mismatch'" class="host-key-dialog__fingerprints">
            <span>已保存指纹</span>
            <code>{{ oldFingerprint || "未知" }}</code>
            <span>服务器当前指纹</span>
            <code>{{ newFingerprint }}</code>
          </div>
          <code v-else>{{ newFingerprint }}</code>
        </div>
        <footer>
          <button type="button" @click="emit('cancel')">取消</button>
          <button class="host-key-dialog__primary" type="button" @click="emit('confirm')">
            {{ kind === "mismatch" ? "更新指纹并连接" : "信任并连接" }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.host-key-layer {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  background: var(--overlay-bg);
}

.host-key-dialog {
  width: min(480px, calc(100vw - 40px));
  border: 1px solid var(--field-border);
  border-radius: 8px;
  background: var(--surface-4);
  box-shadow: var(--shadow-strong);
}

.host-key-dialog header {
  padding: 16px 18px 10px;
  border-bottom: 1px solid var(--app-border);
}

.host-key-dialog h2 {
  margin: 0;
  color: var(--text-strong);
  font-size: 15px;
}

.host-key-dialog__body {
  display: grid;
  gap: 10px;
  padding: 14px 18px;
}

.host-key-dialog p {
  margin: 0;
  color: var(--text-main);
  font-size: 13px;
  line-height: 1.6;
}

.host-key-dialog__warning {
  color: #f2d18a !important;
}

.host-key-dialog__fingerprints {
  display: grid;
  gap: 6px;
}

.host-key-dialog__fingerprints span {
  color: var(--text-muted);
  font-size: 12px;
}

.host-key-dialog code {
  overflow: auto;
  border-radius: 6px;
  padding: 8px 10px;
  color: var(--accent);
  background: var(--field-bg);
  font-family: "JetBrains Mono", "Cascadia Code", monospace;
  font-size: 12px;
}

.host-key-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px 16px;
  border-top: 1px solid var(--app-border);
}

.host-key-dialog button {
  height: 32px;
  border-radius: 6px;
  padding: 0 13px;
  color: var(--text-main);
  background: var(--surface-hover);
  cursor: pointer;
}

.host-key-dialog button:hover {
  background: var(--surface-active);
}

.host-key-dialog__primary {
  color: #ffffff !important;
  background: var(--accent) !important;
}

.host-key-dialog__primary:hover {
  background: var(--accent-strong) !important;
}
</style>
