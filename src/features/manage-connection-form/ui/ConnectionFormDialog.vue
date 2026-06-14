<script setup lang="ts">
import { Eye, EyeOff } from "@lucide/vue";
import { computed, reactive, ref, watch } from "vue";
import type { ConnectionGroup, ServerConnectionForm } from "../../../entities/server/model/types";

const props = defineProps<{
  existingNames: string[];
  groups: ConnectionGroup[];
  modelValue: ServerConnectionForm;
  mode: "create" | "edit";
  open: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  save: [form: ServerConnectionForm];
}>();

const form = reactive<ServerConnectionForm>({ ...props.modelValue });
const plainPasswordConfirmed = ref(false);
const submitted = ref(false);
const passwordVisible = ref(false);
const touched = reactive<Partial<Record<keyof ServerConnectionForm, boolean>>>({});

function assignForm(nextForm: ServerConnectionForm) {
  delete form.id;
  delete form.hostKeyFingerprint;
  Object.assign(form, nextForm);
}

watch(
  () => props.modelValue,
  (nextForm) => {
    assignForm(nextForm);
    resetInteractionState();
  },
  { deep: true },
);

watch(
  () => props.open,
  (open) => {
    if (open) {
      assignForm(props.modelValue);
      resetInteractionState();
    }
  },
);

watch(
  () => form.authType,
  (authType) => {
    if (authType === "privateKey") {
      form.credentialStorage = "none";
      form.password = "";
    } else {
      form.privateKeyPath = "";
    }

    plainPasswordConfirmed.value = false;
  },
);

watch(
  () => form.credentialStorage,
  () => {
    plainPasswordConfirmed.value = false;
  },
);

const trimmedName = computed(() => form.name.trim());
const trimmedHost = computed(() => form.host.trim());
const trimmedUser = computed(() => form.user.trim());
const trimmedPrivateKeyPath = computed(() => form.privateKeyPath.trim());

const isDuplicateName = computed(() =>
  props.existingNames.some((name) => name.toLowerCase() === trimmedName.value.toLowerCase()),
);

const errors = computed(() => {
  const nextErrors: Partial<Record<keyof ServerConnectionForm, string>> = {};

  if (!trimmedName.value) {
    nextErrors.name = "请输入连接名称";
  } else if (isDuplicateName.value) {
    nextErrors.name = "连接名称已存在";
  }

  if (!trimmedHost.value) {
    nextErrors.host = "请输入主机地址";
  } else if (/\s/.test(trimmedHost.value)) {
    nextErrors.host = "主机地址不能包含空格";
  }

  const normalizedPort = Number(form.port);

  if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    nextErrors.port = "端口范围为 1-65535";
  }

  if (!trimmedUser.value) {
    nextErrors.user = "请输入用户名";
  }

  if (
    form.authType === "password" &&
    (form.credentialStorage === "plain" || form.credentialStorage === "keychain") &&
    !form.password &&
    (props.mode === "create" || props.modelValue.credentialStorage !== form.credentialStorage)
  ) {
    nextErrors.password = "保存凭据时需要填写密码";
  }

  if (form.authType === "privateKey" && !trimmedPrivateKeyPath.value) {
    nextErrors.privateKeyPath = "请输入私钥路径";
  }

  return nextErrors;
});

const canSave = computed(() => Object.keys(errors.value).length === 0);
const shouldShowPlainPasswordWarning = computed(
  () => form.authType === "password" && form.credentialStorage === "plain",
);
const passwordPlaceholder = computed(() =>
  props.mode === "edit" && form.credentialStorage === "keychain"
    ? "••••••••"
    : "输入密码",
);

function resetInteractionState() {
  submitted.value = false;
  plainPasswordConfirmed.value = false;
  passwordVisible.value = false;

  Object.keys(touched).forEach((field) => {
    delete touched[field as keyof ServerConnectionForm];
  });
}

function touchField(field: keyof ServerConnectionForm) {
  touched[field] = true;
}

function visibleError(field: keyof ServerConnectionForm) {
  if (!submitted.value && !touched[field]) {
    return undefined;
  }

  return errors.value[field];
}

function save() {
  submitted.value = true;

  if (!canSave.value) {
    return;
  }

  if (shouldShowPlainPasswordWarning.value && !plainPasswordConfirmed.value) {
    plainPasswordConfirmed.value = true;
    return;
  }

  emit("save", { ...form });
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @click.self="emit('cancel')">
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="connection-form-title">
        <header class="dialog__header">
          <div>
            <h2 id="connection-form-title">{{ mode === "create" ? "新增连接" : "编辑连接" }}</h2>
            <p>配置 SSH 连接信息，连接会保存到本机应用配置中。</p>
          </div>
        </header>

        <div class="form-grid">
          <label>
            连接名称
            <input
              v-model="form.name"
              :class="{ 'field-error': visibleError('name') }"
              placeholder="prod-01"
              @blur="touchField('name')"
            />
            <span v-if="visibleError('name')" class="error-text">{{ visibleError("name") }}</span>
          </label>

          <label>
            分组
            <select
              v-model="form.groupId"
              :class="{ 'field-error': visibleError('groupId') }"
              @blur="touchField('groupId')"
              @change="touchField('groupId')"
            >
              <option value="">未分组</option>
              <option v-for="group in groups" :key="group.id" :value="group.id">
                {{ group.name }}
              </option>
            </select>
            <span v-if="visibleError('groupId')" class="error-text">{{ visibleError("groupId") }}</span>
          </label>

          <label>
            主机
            <input
              v-model="form.host"
              :class="{ 'field-error': visibleError('host') }"
              placeholder="10.0.0.12"
              @blur="touchField('host')"
            />
            <span v-if="visibleError('host')" class="error-text">{{ visibleError("host") }}</span>
          </label>

          <label>
            端口
            <input
              v-model.number="form.port"
              :class="{ 'field-error': visibleError('port') }"
              inputmode="numeric"
              placeholder="22"
              type="text"
              @blur="touchField('port')"
            />
            <span v-if="visibleError('port')" class="error-text">{{ visibleError("port") }}</span>
          </label>

          <label>
            用户名
            <input
              v-model="form.user"
              :class="{ 'field-error': visibleError('user') }"
              placeholder="root"
              @blur="touchField('user')"
            />
            <span v-if="visibleError('user')" class="error-text">{{ visibleError("user") }}</span>
          </label>

          <label>
            认证方式
            <select v-model="form.authType" @blur="touchField('authType')" @change="touchField('authType')">
              <option value="password">密码</option>
              <option value="privateKey">私钥</option>
            </select>
          </label>

          <label v-if="form.authType === 'password'" class="form-grid__wide">
            密码
            <span class="password-field">
              <input
                v-model="form.password"
                :class="{ 'field-error': visibleError('password') }"
                :type="passwordVisible ? 'text' : 'password'"
                :placeholder="passwordPlaceholder"
                @blur="touchField('password')"
              />
              <button
                v-if="form.credentialStorage === 'plain' && form.password"
                :title="passwordVisible ? '隐藏明文密码' : '查看明文密码'"
                type="button"
                @click="passwordVisible = !passwordVisible"
              >
                <EyeOff v-if="passwordVisible" :size="16" />
                <Eye v-else :size="16" />
              </button>
            </span>
            <span v-if="visibleError('password')" class="error-text">{{ visibleError("password") }}</span>
            <span
              v-else-if="mode === 'edit' && form.credentialStorage === 'keychain'"
              class="field-hint"
            >
              留空表示继续使用已保存的系统凭据。
            </span>
          </label>

          <label v-else class="form-grid__wide">
            私钥路径
            <input
              v-model="form.privateKeyPath"
              :class="{ 'field-error': visibleError('privateKeyPath') }"
              placeholder="~/.ssh/id_ed25519"
              @blur="touchField('privateKeyPath')"
            />
            <span v-if="visibleError('privateKeyPath')" class="error-text">{{ visibleError("privateKeyPath") }}</span>
          </label>

          <label class="form-grid__wide">
            凭据保存
            <select
              v-model="form.credentialStorage"
              @blur="touchField('credentialStorage')"
              @change="touchField('credentialStorage')"
            >
              <option value="none">不保存凭据</option>
              <option value="plain">保存明文密码</option>
              <option value="keychain">保存到系统凭据</option>
            </select>
          </label>

          <label class="checkbox-row">
            <input v-model="form.favorite" type="checkbox" />
            加入收藏
          </label>
        </div>

        <div v-if="shouldShowPlainPasswordWarning" class="warning-box">
          明文密码会直接保存在本地配置中，不建议在共享设备上使用。
          <label class="warning-box__confirm">
            <input v-model="plainPasswordConfirmed" type="checkbox" />
            我了解风险，仍然保存明文密码
          </label>
        </div>

        <footer class="dialog__footer">
          <button class="button" type="button" @click="emit('cancel')">取消</button>
          <button class="button button--primary" type="button" @click="save">
            {{ shouldShowPlainPasswordWarning && !plainPasswordConfirmed ? "确认风险" : mode === "create" ? "新增连接" : "保存修改" }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  background: var(--overlay-bg);
}

.dialog {
  width: min(560px, calc(100vw - 48px));
  border: 1px solid var(--field-border);
  border-radius: 8px;
  background: var(--surface-4);
  box-shadow: var(--shadow-strong);
}

.dialog__header {
  padding: 18px 20px 12px;
  border-bottom: 1px solid var(--app-border);
}

.dialog__header h2 {
  margin: 0;
  color: var(--text-strong);
  font-size: 16px;
}

.dialog__header p {
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 12px;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 16px 20px;
}

.form-grid label {
  display: grid;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.form-grid__wide {
  grid-column: 1 / -1;
}

.form-grid input,
.form-grid select {
  width: 100%;
  height: 34px;
  border: 1px solid var(--field-border);
  border-radius: 6px;
  padding: 0 10px;
  color: var(--text-main);
  background: var(--field-bg);
}

.field-error {
  border-color: var(--danger) !important;
}

.password-field {
  position: relative;
  display: block;
}

.password-field input {
  padding-right: 38px;
}

.password-field button {
  position: absolute;
  top: 4px;
  right: 5px;
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 5px;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}

.password-field button:hover {
  color: var(--text-strong);
  background: var(--surface-hover);
}

.error-text {
  color: var(--danger);
  font-size: 11px;
}

.field-hint {
  color: var(--text-muted);
  font-size: 11px;
}

.checkbox-row {
  display: flex !important;
  grid-column: 1 / -1;
  align-items: center;
  gap: 8px !important;
}

.checkbox-row input {
  width: 14px;
  height: 14px;
}

.warning-box {
  margin: 0 20px 16px;
  border: 1px solid #7f6330;
  border-radius: 6px;
  padding: 10px 12px;
  color: #f2d18a;
  background: #2a2418;
  font-size: 12px;
}

.warning-box__confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 9px;
  color: #f7dfaa;
}

.warning-box__confirm input {
  width: 14px;
  height: 14px;
}

.dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px 18px;
  border-top: 1px solid var(--app-border);
}

.button {
  height: 32px;
  border-radius: 6px;
  padding: 0 14px;
  color: var(--text-main);
  background: var(--surface-hover);
  cursor: pointer;
}

.button:hover {
  background: var(--surface-active);
}

.button:disabled {
  color: var(--text-subtle);
  cursor: not-allowed;
}

.button--primary {
  color: #ffffff;
  background: var(--accent);
}

.button--primary:hover {
  background: var(--accent-strong);
}
</style>
