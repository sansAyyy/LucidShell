use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatusChangedEvent {
    pub session_id: String,
    pub profile_id: String,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputEvent {
    pub terminal_id: String,
    pub data: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalClosedEvent {
    pub terminal_id: String,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDownloadProgressEvent {
    pub transfer_id: String,
    pub server_session_id: String,
    pub remote_path: String,
    pub local_path: String,
    pub transferred_bytes: u64,
    pub total_bytes: Option<u64>,
    pub status: SftpDownloadStatus,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SftpDownloadStatus {
    Started,
    Progress,
    Completed,
    Cancelled,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpUploadProgressEvent {
    pub transfer_id: String,
    pub server_session_id: String,
    pub local_path: String,
    pub remote_path: String,
    pub transferred_bytes: u64,
    pub total_bytes: Option<u64>,
    pub status: SftpUploadStatus,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SftpUploadStatus {
    Started,
    Progress,
    Completed,
    Cancelled,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEditSyncEvent {
    pub edit_id: String,
    pub server_session_id: String,
    pub remote_path: String,
    pub local_path: String,
    pub status: LocalEditSyncStatus,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LocalEditSyncStatus {
    Started,
    Completed,
    Error,
}
