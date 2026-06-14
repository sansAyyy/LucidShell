use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectServerPayload {
    pub profile_id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth_type: ConnectAuthType,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub host_key_fingerprint: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeychainCredentialPayload {
    pub profile_id: String,
    pub password: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendDiagnosticLogPayload {
    pub line: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDiagnosticLogPayload {
    pub path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectAuthType {
    Password,
    PrivateKey,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisconnectServerPayload {
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadServerMonitorPayload {
    pub server_session_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadLoginShellPayload {
    pub server_session_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckServerSessionHealthPayload {
    pub server_session_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSessionDto {
    pub id: String,
    pub profile_id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTerminalTabPayload {
    pub server_session_id: String,
    pub title: Option<String>,
    pub cwd: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWritePayload {
    pub terminal_id: String,
    pub data: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizePayload {
    pub terminal_id: String,
    pub cols: u32,
    pub rows: u32,
    pub width_px: u32,
    pub height_px: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseTerminalTabPayload {
    pub terminal_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSftpDirectoryPayload {
    pub server_session_id: String,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSftpFilePayload {
    pub transfer_id: String,
    pub server_session_id: String,
    pub remote_path: String,
    pub local_path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSftpDirectoryPayload {
    pub transfer_id: String,
    pub server_session_id: String,
    pub remote_path: String,
    pub local_directory: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelSftpDownloadPayload {
    pub transfer_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadSftpFilePayload {
    pub transfer_id: String,
    pub server_session_id: String,
    pub local_path: String,
    pub remote_path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareSftpUploadQueuePayload {
    pub server_session_id: String,
    pub local_paths: Vec<String>,
    pub remote_directory: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedSftpUploadQueueDto {
    pub directories: Vec<String>,
    pub files: Vec<PreparedSftpUploadFileDto>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedSftpUploadFileDto {
    pub local_path: String,
    pub remote_path: String,
    pub file_name: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelSftpUploadPayload {
    pub transfer_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteSftpEntryPayload {
    pub server_session_id: String,
    pub path: String,
    pub is_directory: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameSftpEntryPayload {
    pub server_session_id: String,
    pub source_path: String,
    pub target_path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSftpDirectoryPayload {
    pub server_session_id: String,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenSftpLocalEditPayload {
    pub server_session_id: String,
    pub remote_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEditSessionDto {
    pub id: String,
    pub server_session_id: String,
    pub remote_path: String,
    pub local_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerMonitorDto {
    pub cpu: Option<u8>,
    pub memory: Option<u8>,
    pub disk: Option<u8>,
    pub load: Option<String>,
    pub uptime: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionDto {
    pub id: String,
    pub server_session_id: String,
    pub title: String,
    pub cwd: String,
    pub status: String,
    pub error: Option<String>,
}
