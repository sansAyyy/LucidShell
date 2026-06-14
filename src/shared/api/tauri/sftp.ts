import { invoke } from "@tauri-apps/api/core";
import type { RemoteFileEntry } from "../../../entities/sftp/model/types";

export type ListSftpDirectoryPayload = {
  serverSessionId: string;
  path: string;
};

export type DownloadSftpFilePayload = {
  transferId: string;
  serverSessionId: string;
  remotePath: string;
  localPath: string;
};

export type DownloadSftpDirectoryPayload = {
  transferId: string;
  serverSessionId: string;
  remotePath: string;
  localDirectory: string;
};

export type CancelSftpDownloadPayload = {
  transferId: string;
};

export type UploadSftpFilePayload = {
  transferId: string;
  serverSessionId: string;
  localPath: string;
  remotePath: string;
};

export type PrepareSftpUploadQueuePayload = {
  serverSessionId: string;
  localPaths: string[];
  remoteDirectory: string;
};

export type PreparedSftpUploadFileDto = {
  localPath: string;
  remotePath: string;
  fileName: string;
};

export type PreparedSftpUploadQueueDto = {
  directories: string[];
  files: PreparedSftpUploadFileDto[];
};

export type CancelSftpUploadPayload = {
  transferId: string;
};

export type DeleteSftpEntryPayload = {
  serverSessionId: string;
  path: string;
  isDirectory: boolean;
};

export type RenameSftpEntryPayload = {
  serverSessionId: string;
  sourcePath: string;
  targetPath: string;
};

export type CreateSftpDirectoryPayload = {
  serverSessionId: string;
  path: string;
};

export type OpenSftpLocalEditPayload = {
  serverSessionId: string;
  remotePath: string;
};

export type LocalEditSessionDto = {
  id: string;
  serverSessionId: string;
  remotePath: string;
  localPath: string;
};

export type SftpDownloadProgressEvent = {
  transferId: string;
  serverSessionId: string;
  remotePath: string;
  localPath: string;
  transferredBytes: number;
  totalBytes?: number;
  status: "started" | "progress" | "completed" | "cancelled" | "error";
  error?: string;
};

export type SftpUploadProgressEvent = {
  transferId: string;
  serverSessionId: string;
  localPath: string;
  remotePath: string;
  transferredBytes: number;
  totalBytes?: number;
  status: "started" | "progress" | "completed" | "cancelled" | "error";
  error?: string;
};

export type LocalEditSyncEvent = {
  editId: string;
  serverSessionId: string;
  remotePath: string;
  localPath: string;
  status: "started" | "completed" | "error";
  error?: string;
};

export type RemoteDirectoryDto = {
  currentPath: string;
  entries: RemoteFileEntry[];
};

export function listSftpDirectory(payload: ListSftpDirectoryPayload) {
  return invoke<RemoteDirectoryDto>("list_sftp_directory", { payload });
}

export function downloadSftpFile(payload: DownloadSftpFilePayload) {
  return invoke<string>("download_sftp_file", { payload });
}

export function downloadSftpDirectory(payload: DownloadSftpDirectoryPayload) {
  return invoke<string>("download_sftp_directory", { payload });
}

export function cancelSftpDownload(payload: CancelSftpDownloadPayload) {
  return invoke<void>("cancel_sftp_download", { payload });
}

export function uploadSftpFile(payload: UploadSftpFilePayload) {
  return invoke<string>("upload_sftp_file", { payload });
}

export function prepareSftpUploadQueue(payload: PrepareSftpUploadQueuePayload) {
  return invoke<PreparedSftpUploadQueueDto>("prepare_sftp_upload_queue", { payload });
}

export function cancelSftpUpload(payload: CancelSftpUploadPayload) {
  return invoke<void>("cancel_sftp_upload", { payload });
}

export function deleteSftpEntry(payload: DeleteSftpEntryPayload) {
  return invoke<void>("delete_sftp_entry", { payload });
}

export function renameSftpEntry(payload: RenameSftpEntryPayload) {
  return invoke<void>("rename_sftp_entry", { payload });
}

export function createSftpDirectory(payload: CreateSftpDirectoryPayload) {
  return invoke<void>("create_sftp_directory", { payload });
}

export function openSftpLocalEdit(payload: OpenSftpLocalEditPayload) {
  return invoke<LocalEditSessionDto>("open_sftp_local_edit", { payload });
}
