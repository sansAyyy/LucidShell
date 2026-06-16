import type { SftpTransferItem } from "../../sftp/model/types";
import { formatBytes } from "./layoutUtils";

export type SftpUploadQueueItem = {
  id: string;
  localPath: string;
  remotePath: string;
  fileName: string;
  ensureDirectories: string[];
};

export type SftpUploadQueueState = {
  cancelled: boolean;
  completed: number;
  current?: SftpUploadQueueItem;
  items: SftpUploadQueueItem[];
  running: boolean;
  total: number;
};

const SFTP_TRANSFER_HISTORY_LIMIT = 20;
const SFTP_QUEUED_UPLOAD_LIMIT = 20;

export function createQueuedUploadTransfer(
  item: SftpUploadQueueItem,
): SftpTransferItem {
  return {
    id: item.id,
    direction: "upload",
    name: item.fileName,
    status: "queued",
    summary: "等待上传",
  };
}

export function buildSftpTransferQueue(
  tabId: string,
  current: {
    activeDownloadId?: string;
    activeDownloadName?: string;
    activeDownloadProgress?: number;
    activeUploadId?: string;
    activeUploadName?: string;
    activeUploadProgress?: number;
    transferProgress?: number;
    transferSummary: string;
  },
  queue: SftpUploadQueueState | undefined,
  history: SftpTransferItem[],
): SftpTransferItem[] {
  const transfers: SftpTransferItem[] = [];

  if (current.activeDownloadId) {
    transfers.push({
      id: current.activeDownloadId,
      direction: "download",
      name: current.activeDownloadName ?? "download",
      status: "running",
      progress: current.activeDownloadProgress ?? current.transferProgress,
      summary: current.transferSummary,
    });
  }

  if (current.activeUploadId || queue?.current) {
    transfers.push({
      id: current.activeUploadId ?? `upload-current-${tabId}`,
      direction: "upload",
      name: current.activeUploadName ?? queue?.current?.fileName ?? "upload",
      status: "running",
      progress: current.activeUploadProgress ?? current.transferProgress,
      summary: queue
        ? `${Math.min(queue.completed + 1, queue.total)}/${queue.total}`
        : current.transferSummary,
    });
  }

  if (queue?.items.length) {
    transfers.push(
      ...queue.items
        .slice(0, SFTP_QUEUED_UPLOAD_LIMIT)
        .map((item) => createQueuedUploadTransfer(item)),
    );

    if (queue.items.length > SFTP_QUEUED_UPLOAD_LIMIT) {
      transfers.push({
        id: `queued-upload-more-${tabId}`,
        direction: "upload",
        name: `还有 ${queue.items.length - SFTP_QUEUED_UPLOAD_LIMIT} 项`,
        status: "queued",
        summary: "等待上传",
      });
    }
  }

  return [...transfers, ...history].slice(0, SFTP_TRANSFER_HISTORY_LIMIT);
}

export function rememberSftpTransfer(
  currentQueue: SftpTransferItem[],
  transfer: SftpTransferItem,
): SftpTransferItem[] {
  const activeTransfers = currentQueue.filter((item) => item.status === "queued" || item.status === "running");
  const history = currentQueue.filter((item) =>
    item.status === "cancelled" || item.status === "completed" || item.status === "error",
  );

  return [
    ...activeTransfers,
    transfer,
    ...history.filter((item) => item.id !== transfer.id),
  ].slice(0, SFTP_TRANSFER_HISTORY_LIMIT);
}

export function splitSftpTransferQueue(currentQueue: SftpTransferItem[]) {
  return {
    activeTransfers: currentQueue.filter((item) => item.status === "queued" || item.status === "running"),
    history: currentQueue.filter((item) =>
      item.status === "cancelled" || item.status === "completed" || item.status === "error",
    ),
  };
}

export function formatUploadQueueSummary(
  queue: SftpUploadQueueState,
  progress: number,
  transferredBytes?: number,
  totalBytes?: number,
) {
  const currentIndex = Math.min(queue.completed + 1, queue.total);
  const fileName = queue.current?.fileName ?? "file";
  const suffix = totalBytes
    ? `${progress}%`
    : transferredBytes
      ? formatBytes(transferredBytes)
      : "0%";

  return queue.total > 1
    ? `${currentIndex}/${queue.total} ${fileName} ${suffix}`
    : `上传 ${fileName} ${suffix}`;
}
