import { defineStore } from "pinia";
import { computed, ref } from "vue";

export type ToastTone = "success" | "error" | "info";

export type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
};

export type ConfirmRequest = {
  cancelText?: string;
  confirmText?: string;
  message: string;
  title: string;
};

export type ChoiceOption = {
  label: string;
  tone?: "default" | "primary" | "danger";
  value: string;
};

export type ChoiceRequest = {
  choices: ChoiceOption[];
  message: string;
  title: string;
};

type PendingConfirm = ConfirmRequest & {
  id: string;
  resolve: (value: boolean) => void;
};

type PendingChoice = ChoiceRequest & {
  id: string;
  resolve: (value: string | undefined) => void;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useNotificationStore = defineStore("notification", () => {
  const toasts = ref<ToastItem[]>([]);
  const pendingConfirm = ref<PendingConfirm>();
  const pendingChoice = ref<PendingChoice>();

  function showToast(message: string, tone: ToastTone = "info") {
    const id = createId("toast");
    toasts.value = [...toasts.value, { id, message, tone }];
    window.setTimeout(() => dismissToast(id), 3600);
  }

  function dismissToast(id: string) {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function confirm(request: ConfirmRequest) {
    return new Promise<boolean>((resolve) => {
      pendingConfirm.value = {
        ...request,
        id: createId("confirm"),
        resolve,
      };
    });
  }

  function choose(request: ChoiceRequest) {
    return new Promise<string | undefined>((resolve) => {
      pendingChoice.value = {
        ...request,
        id: createId("choice"),
        resolve,
      };
    });
  }

  function resolveConfirm(value: boolean) {
    const current = pendingConfirm.value;

    if (!current) {
      return;
    }

    pendingConfirm.value = undefined;
    current.resolve(value);
  }

  function resolveChoice(value: string | undefined) {
    const current = pendingChoice.value;

    if (!current) {
      return;
    }

    pendingChoice.value = undefined;
    current.resolve(value);
  }

  const activeConfirm = computed(() => pendingConfirm.value);
  const activeChoice = computed(() => pendingChoice.value);

  return {
    activeChoice,
    activeConfirm,
    choose,
    confirm,
    dismissToast,
    resolveChoice,
    resolveConfirm,
    showToast,
    toasts,
  };
});
