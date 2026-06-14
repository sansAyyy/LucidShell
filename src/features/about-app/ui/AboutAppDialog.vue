<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { getBundleType, getIdentifier, getName, getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { appCacheDir, appConfigDir } from "@tauri-apps/api/path";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, X } from "@lucide/vue";
import { useNotificationStore } from "../../../entities/notification/model/notificationStore";
import { buildInfo } from "../../../shared/config/buildInfo";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

type AppInfo = {
  appCacheDir: string;
  appConfigDir: string;
  bundleType: string;
  identifier: string;
  name: string;
  tauriVersion: string;
  version: string;
};

const notification = useNotificationStore();
const appInfo = ref<AppInfo>({
  appCacheDir: "",
  appConfigDir: "",
  bundleType: "",
  identifier: "",
  name: "LucidShell",
  tauriVersion: "",
  version: "",
});
const loading = ref(false);

const diagnosticText = computed(() => [
  `应用名称: ${appInfo.value.name}`,
  `应用版本: ${appInfo.value.version}`,
  `前端版本: ${buildInfo.appVersion}`,
  `构建时间: ${buildInfo.buildDate}`,
  `Git 分支: ${buildInfo.gitBranch}`,
  `Git Commit: ${buildInfo.gitCommit}`,
  `应用标识: ${appInfo.value.identifier}`,
  `Tauri 版本: ${appInfo.value.tauriVersion}`,
  `安装包类型: ${appInfo.value.bundleType || "unknown"}`,
  `配置目录: ${appInfo.value.appConfigDir}`,
  `缓存目录: ${appInfo.value.appCacheDir}`,
  `诊断日志: ${appInfo.value.appConfigDir ? `${appInfo.value.appConfigDir}\\diagnostics.log` : ""}`,
].join("\n"));

async function loadAppInfo() {
  if (loading.value) {
    return;
  }

  loading.value = true;

  try {
    const [
      name,
      version,
      identifier,
      tauriVersion,
      bundleType,
      configDir,
      cacheDir,
    ] = await Promise.all([
      getName(),
      getVersion(),
      getIdentifier(),
      getTauriVersion(),
      getBundleType().catch(() => ""),
      appConfigDir(),
      appCacheDir(),
    ]);

    appInfo.value = {
      appCacheDir: cacheDir,
      appConfigDir: configDir,
      bundleType,
      identifier,
      name,
      tauriVersion,
      version,
    };
  } catch (error) {
    notification.showToast(`读取版本信息失败：${String(error)}`, "error");
  } finally {
    loading.value = false;
  }
}

async function copyInfo() {
  try {
    await writeText(diagnosticText.value);
    notification.showToast("版本信息已复制。", "success");
  } catch (error) {
    notification.showToast(`复制失败：${String(error)}`, "error");
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      void loadAppInfo();
    }
  },
);

onMounted(() => {
  if (props.open) {
    void loadAppInfo();
  }
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="about-layer" @click="emit('close')" @contextmenu.prevent="emit('close')">
      <section class="about-dialog" role="dialog" aria-modal="true" aria-label="关于 LucidShell" @click.stop>
        <header class="about-dialog__header">
          <div class="about-dialog__brand">
            <div class="about-dialog__mark" aria-hidden="true">LS</div>
            <div>
              <h2>LucidShell</h2>
              <p>SSH Terminal 与 SFTP 桌面工具</p>
            </div>
          </div>
          <button title="关闭" type="button" @click="emit('close')">
            <X :size="16" />
          </button>
        </header>

        <dl class="about-dialog__grid">
          <div>
            <dt>应用版本</dt>
            <dd>{{ appInfo.version || "读取中" }}</dd>
          </div>
          <div>
            <dt>前端版本</dt>
            <dd>{{ buildInfo.appVersion }}</dd>
          </div>
          <div>
            <dt>构建时间</dt>
            <dd>{{ new Date(buildInfo.buildDate).toLocaleString() }}</dd>
          </div>
          <div>
            <dt>Git Commit</dt>
            <dd>{{ buildInfo.gitCommit }}</dd>
          </div>
          <div>
            <dt>应用标识</dt>
            <dd>{{ appInfo.identifier || "读取中" }}</dd>
          </div>
          <div>
            <dt>Tauri 版本</dt>
            <dd>{{ appInfo.tauriVersion || "读取中" }}</dd>
          </div>
          <div>
            <dt>安装包类型</dt>
            <dd>{{ appInfo.bundleType || "unknown" }}</dd>
          </div>
        </dl>

        <div class="about-dialog__paths">
          <label>
            <span>配置目录</span>
            <code>{{ appInfo.appConfigDir || "读取中" }}</code>
          </label>
          <label>
            <span>缓存目录</span>
            <code>{{ appInfo.appCacheDir || "读取中" }}</code>
          </label>
          <label>
            <span>诊断日志</span>
            <code>{{ appInfo.appConfigDir ? `${appInfo.appConfigDir}\\diagnostics.log` : "读取中" }}</code>
          </label>
        </div>

        <footer>
          <button class="about-dialog__copy" type="button" @click="copyInfo">
            <Copy :size="15" />
            <span>复制版本信息</span>
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.about-layer {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: grid;
  place-items: center;
  background: var(--overlay-bg);
}

.about-dialog {
  width: min(540px, calc(100vw - 32px));
  border: 1px solid var(--field-border);
  border-radius: 8px;
  background: var(--surface-4);
  box-shadow: var(--shadow-strong);
  overflow: hidden;
}

.about-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 16px;
  border-bottom: 1px solid var(--app-border);
}

.about-dialog__brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.about-dialog__mark {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid var(--accent-soft-hover);
  border-radius: 8px;
  color: var(--accent);
  background: var(--accent-soft);
  font-size: 13px;
  font-weight: 700;
}

.about-dialog h2,
.about-dialog p {
  margin: 0;
}

.about-dialog h2 {
  color: var(--text-strong);
  font-size: 16px;
}

.about-dialog p {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 12px;
}

.about-dialog__header > button {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 6px;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

.about-dialog__header > button:hover {
  color: var(--text-strong);
  background: var(--surface-hover);
}

.about-dialog__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
  padding: 16px;
}

.about-dialog__grid div,
.about-dialog__paths label {
  display: grid;
  gap: 5px;
  border-radius: 7px;
  padding: 10px;
  background: var(--field-bg);
}

.about-dialog dt,
.about-dialog__paths span {
  color: var(--text-muted);
  font-size: 11px;
}

.about-dialog dd {
  margin: 0;
  color: var(--text-strong);
  font-size: 13px;
}

.about-dialog__paths {
  display: grid;
  gap: 8px;
  padding: 0 16px 16px;
}

.about-dialog code {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-main);
  font-size: 11px;
}

.about-dialog footer {
  display: flex;
  justify-content: flex-end;
  padding: 12px 16px 16px;
  border-top: 1px solid var(--app-border);
}

.about-dialog__copy {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 7px;
  border-radius: 6px;
  padding: 0 12px;
  color: #ffffff;
  background: var(--accent);
  cursor: pointer;
  font-size: 12px;
}

.about-dialog__copy:hover {
  background: var(--accent-strong);
}

@media (max-width: 560px) {
  .about-dialog__grid {
    grid-template-columns: 1fr;
  }
}
</style>
