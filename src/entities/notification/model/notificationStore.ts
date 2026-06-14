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

type PendingConfirm = ConfirmRequest & {
  id: string;
  resolve: (value: boolean) => void;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useNotificationStore = defineStore("notification", () => {
  const toasts = ref<ToastItem[]>([]);
  const pendingConfirm = ref<PendingConfirm>();

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

  function resolveConfirm(value: boolean) {
    const current = pendingConfirm.value;

    if (!current) {
      return;
    }

    pendingConfirm.value = undefined;
    current.resolve(value);
  }

  const activeConfirm = computed(() => pendingConfirm.value);

  return {
    activeConfirm,
    confirm,
    dismissToast,
    resolveConfirm,
    showToast,
    toasts,
  };
});
