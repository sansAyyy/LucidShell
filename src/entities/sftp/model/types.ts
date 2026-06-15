export type RemoteFileEntry = {
  id: string;
  name: string;
  path: string;
  kind: "file" | "directory" | "other";
  size: string;
  modified: string;
  mode: string;
};

export type SftpTransferItem = {
  id: string;
  direction: "upload" | "download";
  name: string;
  status: "cancelled" | "completed" | "error" | "queued" | "running";
  progress?: number;
  summary?: string;
};

export type SftpPaneState = {
  currentPath: string;
  loading: boolean;
  loadingAction?: "open" | "refresh" | "delete";
  loadingPath?: string;
  selectedEntryPath?: string;
  selectedCount: number;
  transferSummary: string;
  activeDownloadId?: string;
  activeDownloadName?: string;
  activeDownloadProgress?: number;
  activeUploadId?: string;
  activeUploadName?: string;
  activeUploadProgress?: number;
  uploadQueueTotal?: number;
  uploadQueueCompleted?: number;
  uploadQueuePending?: number;
  transferProgress?: number;
  transferQueue: SftpTransferItem[];
  entries: RemoteFileEntry[];
};
