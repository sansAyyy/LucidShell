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
const openSelect = ref<keyof Pick<ServerConnectionForm, "groupId" | "authType" | "credentialStorage">>();
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
const portValue = computed(() => String(form.port || ""));
const groupOptions = computed(() => [
  { label: "未分组", value: "" },
  ...props.groups.map((group) => ({ label: group.name, value: group.id })),
]);
const selectedGroupLabel = computed(
  () => groupOptions.value.find((option) => option.value === form.groupId)?.label ?? "未分组",
);
const selectedAuthTypeLabel = computed(() => form.authType === "privateKey" ? "私钥" : "密码");
const selectedCredentialStorageLabel = computed(() => {
  if (form.credentialStorage === "plain") {
    return "保存明文密码";
  }

  if (form.credentialStorage === "keychain") {
    return "保存到系统凭据";
  }

  return "不保存凭据";
});

function resetInteractionState() {
  submitted.value = false;
  plainPasswordConfirmed.value = false;
  passwordVisible.value = false;
  openSelect.value = undefined;

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

function updatePort(event: Event) {
  const input = event.target as HTMLInputElement;
  const digits = input.value.replace(/\D/g, "").slice(0, 5);

  input.value = digits;
  form.port = digits ? Number(digits) : 0;
}

function normalizePort() {
  touchField("port");

  if (!form.port) {
    return;
  }

  form.port = Math.min(Math.max(form.port, 1), 65535);
}

function toggleSelect(field: typeof openSelect.value) {
  openSelect.value = openSelect.value === field ? undefined : field;
}

function closeSelect() {
  openSelect.value = undefined;
}

function selectGroup(groupId: string) {
  form.groupId = groupId;
  touchField("groupId");
  closeSelect();
}

function selectAuthType(authType: ServerConnectionForm["authType"]) {
  form.authType = authType;
  touchField("authType");
  closeSelect();
}

function selectCredentialStorage(credentialStorage: ServerConnectionForm["credentialStorage"]) {
  form.credentialStorage = credentialStorage;
  touchField("credentialStorage");
  closeSelect();
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
      <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="connection-form-title" @click="closeSelect">
        <header class="dialog__header">
          <div>
            <h2 id="connection-form-title">{{ mode === "create" ? "新增连接" : "编辑连接" }}</h2>
            <p>配置 SSH 连接信息，连接会保存到本机应用配置中。</p>
          </div>
        </header>

        <div class="form-grid">
          <label class="form-field">
            连接名称
            <input
              v-model="form.name"
              :class="{ 'field-error': visibleError('name') }"
              placeholder="prod-01"
              @blur="touchField('name')"
            />
            <span class="field-feedback">
              <span v-if="visibleError('name')" class="error-text">{{ visibleError("name") }}</span>
            </span>
          </label>

          <label class="form-field">
            分组
            <span class="select-field" @click.stop>
              <button
                class="select-button"
                :class="{ 'field-error': visibleError('groupId') }"
                type="button"
                @blur="touchField('groupId')"
                @click="toggleSelect('groupId')"
              >
                {{ selectedGroupLabel }}
              </button>
              <div v-if="openSelect === 'groupId'" class="select-menu">
                <button
                  v-for="option in groupOptions"
                  :key="option.value || 'ungrouped'"
                  class="select-option"
                  :class="{ 'select-option--active': option.value === form.groupId }"
                  type="button"
                  @click="selectGroup(option.value)"
                >
                  {{ option.label }}
                </button>
              </div>
            </span>
            <span class="field-feedback">
              <span v-if="visibleError('groupId')" class="error-text">{{ visibleError("groupId") }}</span>
            </span>
          </label>

          <label class="form-field">
            主机
            <input
              v-model="form.host"
              :class="{ 'field-error': visibleError('host') }"
              placeholder="10.0.0.12"
              @blur="touchField('host')"
            />
            <span class="field-feedback">
              <span v-if="visibleError('host')" class="error-text">{{ visibleError("host") }}</span>
            </span>
          </label>

          <label class="form-field">
            端口
            <input
              :value="portValue"
              :class="{ 'field-error': visibleError('port') }"
              inputmode="numeric"
              maxlength="5"
              placeholder="22"
              type="text"
              @blur="normalizePort"
              @input="updatePort"
            />
            <span class="field-feedback">
              <span v-if="visibleError('port')" class="error-text">{{ visibleError("port") }}</span>
            </span>
          </label>

          <label class="form-field">
            用户名
            <input
              v-model="form.user"
              :class="{ 'field-error': visibleError('user') }"
              placeholder="root"
              @blur="touchField('user')"
            />
            <span class="field-feedback">
              <span v-if="visibleError('user')" class="error-text">{{ visibleError("user") }}</span>
            </span>
          </label>

          <label class="form-field">
            认证方式
            <span class="select-field">
              <button class="select-button" type="button" @blur="touchField('authType')" @click.stop="toggleSelect('authType')">
                {{ selectedAuthTypeLabel }}
              </button>
              <div v-if="openSelect === 'authType'" class="select-menu" @click.stop>
                <button
                  class="select-option"
                  :class="{ 'select-option--active': form.authType === 'password' }"
                  type="button"
                  @click="selectAuthType('password')"
                >
                  密码
                </button>
                <button
                  class="select-option"
                  :class="{ 'select-option--active': form.authType === 'privateKey' }"
                  type="button"
                  @click="selectAuthType('privateKey')"
                >
                  私钥
                </button>
              </div>
            </span>
            <span class="field-feedback"></span>
          </label>

          <label v-if="form.authType === 'password'" class="form-field form-grid__wide">
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
            <span class="field-feedback">
              <span v-if="visibleError('password')" class="error-text">{{ visibleError("password") }}</span>
              <span
                v-else-if="mode === 'edit' && form.credentialStorage === 'keychain'"
                class="field-hint"
              >
                留空表示继续使用已保存的系统凭据。
              </span>
            </span>
          </label>

          <label v-else class="form-field form-grid__wide">
            私钥路径
            <input
              v-model="form.privateKeyPath"
              :class="{ 'field-error': visibleError('privateKeyPath') }"
              placeholder="~/.ssh/id_ed25519"
              @blur="touchField('privateKeyPath')"
            />
            <span class="field-feedback">
              <span v-if="visibleError('privateKeyPath')" class="error-text">{{ visibleError("privateKeyPath") }}</span>
            </span>
          </label>

          <label class="form-field form-grid__wide">
            凭据保存
            <span class="select-field">
              <button
                class="select-button"
                type="button"
                @blur="touchField('credentialStorage')"
                @click.stop="toggleSelect('credentialStorage')"
              >
                {{ selectedCredentialStorageLabel }}
              </button>
              <div v-if="openSelect === 'credentialStorage'" class="select-menu select-menu--up" @click.stop>
                <button
                  class="select-option"
                  :class="{ 'select-option--active': form.credentialStorage === 'none' }"
                  type="button"
                  @click="selectCredentialStorage('none')"
                >
                  不保存凭据
                </button>
                <button
                  class="select-option"
                  :class="{ 'select-option--active': form.credentialStorage === 'plain' }"
                  type="button"
                  @click="selectCredentialStorage('plain')"
                >
                  保存明文密码
                </button>
                <button
                  class="select-option"
                  :class="{ 'select-option--active': form.credentialStorage === 'keychain' }"
                  type="button"
                  @click="selectCredentialStorage('keychain')"
                >
                  保存到系统凭据
                </button>
              </div>
            </span>
            <span class="field-feedback"></span>
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
  column-gap: 12px;
  row-gap: 8px;
  padding: 16px 20px;
}

.form-field {
  display: grid;
  grid-template-rows: 15px 34px 14px;
  gap: 5px;
  color: var(--text-muted);
  font-size: 12px;
}

.form-grid__wide {
  grid-column: 1 / -1;
}

.form-grid input,
.select-button {
  width: 100%;
  height: 34px;
  border: 1px solid var(--field-border);
  border-radius: 6px;
  padding: 0 10px;
  color: var(--text-main);
  background: var(--field-bg);
}

.form-grid input::placeholder {
  color: var(--text-subtle);
}

.form-grid input:focus,
.select-button:focus {
  border-color: var(--accent);
  outline: 0;
}

.select-button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 34px;
  text-align: left;
  cursor: pointer;
}

.select-field {
  position: relative;
  display: block;
}

.select-field::after {
  position: absolute;
  top: 50%;
  right: 12px;
  width: 7px;
  height: 7px;
  border-right: 2px solid var(--text-muted);
  border-bottom: 2px solid var(--text-muted);
  content: "";
  pointer-events: none;
  transform: translateY(-65%) rotate(45deg);
}

.select-field:focus-within::after {
  border-color: var(--accent);
}

.select-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  left: 0;
  z-index: 2;
  display: grid;
  max-height: 168px;
  border: 1px solid var(--field-border);
  border-radius: 6px;
  overflow: auto;
  background: var(--surface-4);
  box-shadow: var(--shadow-strong);
}

.select-menu--up {
  top: auto;
  bottom: calc(100% + 4px);
}

.select-option {
  display: flex;
  align-items: center;
  min-height: 32px;
  padding: 0 10px;
  color: var(--text-main);
  background: transparent;
  cursor: pointer;
}

.select-option:hover,
.select-option--active {
  background: var(--surface-hover);
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
  line-height: 14px;
}

.field-hint {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 14px;
}

.field-feedback {
  display: block;
  min-height: 14px;
  overflow: hidden;
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
