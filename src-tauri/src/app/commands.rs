use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::app::state::AppState;
use crate::dto::commands::{
    AppendDiagnosticLogPayload, CancelSftpDownloadPayload, CancelSftpUploadPayload, CheckServerSessionHealthPayload, CloseTerminalTabPayload,
    ConnectServerPayload, CreateSftpDirectoryPayload, DeleteSftpEntryPayload,
    DisconnectServerPayload, DownloadSftpDirectoryPayload, DownloadSftpFilePayload,
    ExportDiagnosticLogPayload, KeychainCredentialPayload, ListSftpDirectoryPayload, LocalEditSessionDto, OpenSftpLocalEditPayload,
    OpenTerminalTabPayload, PreparedSftpUploadFileDto, PreparedSftpUploadQueueDto,
    PrepareSftpUploadQueuePayload, ReadLoginShellPayload, ReadServerMonitorPayload, RenameSftpEntryPayload,
    ServerMonitorDto, ServerSessionDto, TerminalResizePayload, TerminalSessionDto, TerminalWritePayload,
    UploadSftpFilePayload,
};
use crate::dto::events::{
    ConnectionStatusChangedEvent, SftpDownloadProgressEvent, SftpDownloadStatus,
    SftpUploadProgressEvent, SftpUploadStatus, TerminalClosedEvent, TerminalOutputEvent,
};
use crate::domain::server::ServerSession;
use crate::services::local_edit_service::LocalEditSessionConfig;
use crate::services::session_manager::{session_to_dto, status_to_string, terminal_to_dto};
use crate::transport::sftp_client::{RemoteDirectory, RemoteFileKind, SftpClient};
use crate::transport::ssh_pool::SshPool;
use crate::transport::ssh_client::{SshTerminalEvent, TerminalSize};

const CONNECTIONS_FILE_NAME: &str = "connections.json";
const SETTINGS_FILE_NAME: &str = "settings.json";
const DIAGNOSTIC_LOG_FILE_NAME: &str = "diagnostics.log";
const LOCAL_EDIT_CACHE_DIR: &str = "local-edit";
const KEYCHAIN_SERVICE: &str = "LucidShell";
static KEYCHAIN_INIT: OnceLock<Result<(), String>> = OnceLock::new();

fn emit_connection_status(app: &AppHandle, session: &ServerSession) -> Result<(), String> {
    app.emit(
        "connection_status_changed",
        ConnectionStatusChangedEvent {
            session_id: session.id.clone(),
            profile_id: session.profile.id.clone(),
            status: status_to_string(&session.status),
            error: session.error.clone(),
        },
    )
    .map_err(|error| error.to_string())
}

fn keychain_account(profile_id: &str) -> String {
    format!("lucidshell:{profile_id}")
}

fn keychain_entry(profile_id: &str) -> Result<keyring_core::Entry, String> {
    KEYCHAIN_INIT
        .get_or_init(|| keyring::use_native_store(false).map_err(|error| error.to_string()))
        .clone()?;
    keyring_core::Entry::new(KEYCHAIN_SERVICE, &keychain_account(profile_id))
        .map_err(|error| error.to_string())
}

fn connections_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;

    Ok(config_dir.join(CONNECTIONS_FILE_NAME))
}

fn settings_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;

    Ok(config_dir.join(SETTINGS_FILE_NAME))
}

fn diagnostic_log_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;

    Ok(config_dir.join(DIAGNOSTIC_LOG_FILE_NAME))
}

#[tauri::command]
pub fn load_connections_config(app: AppHandle) -> Result<Option<String>, String> {
    let path = connections_config_path(&app)?;

    if !path.exists() {
        return Ok(None);
    }

    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_connections_config(app: AppHandle, content: String) -> Result<(), String> {
    let path = connections_config_path(&app)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn reset_connections_config(app: AppHandle) -> Result<(), String> {
    let path = connections_config_path(&app)?;

    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn load_settings_config(app: AppHandle) -> Result<Option<String>, String> {
    let path = settings_config_path(&app)?;

    if !path.exists() {
        return Ok(None);
    }

    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_settings_config(app: AppHandle, content: String) -> Result<(), String> {
    let path = settings_config_path(&app)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn export_connections_to_file(path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(path);

    fs::write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_connections_import_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);

    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_keychain_password(payload: KeychainCredentialPayload) -> Result<(), String> {
    let password = payload
        .password
        .as_deref()
        .ok_or_else(|| "password is required".to_string())?;
    keychain_entry(&payload.profile_id)?
        .set_password(password)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_keychain_password(payload: KeychainCredentialPayload) -> Result<Option<String>, String> {
    match keychain_entry(&payload.profile_id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn delete_keychain_password(payload: KeychainCredentialPayload) -> Result<(), String> {
    match keychain_entry(&payload.profile_id)?.delete_credential() {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn append_diagnostic_log(app: AppHandle, payload: AppendDiagnosticLogPayload) -> Result<(), String> {
    let path = diagnostic_log_path(&app)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{}", payload.line).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_diagnostic_log(app: AppHandle) -> Result<String, String> {
    let path = diagnostic_log_path(&app)?;

    if !path.exists() {
        return Ok(String::new());
    }

    fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_diagnostic_log(app: AppHandle) -> Result<(), String> {
    let path = diagnostic_log_path(&app)?;

    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn export_diagnostic_log(app: AppHandle, payload: ExportDiagnosticLogPayload) -> Result<(), String> {
    let content = read_diagnostic_log(app)?;
    fs::write(PathBuf::from(payload.path), content).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn connect_server(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: ConnectServerPayload,
) -> Result<ServerSessionDto, String> {
    let connecting_session = {
        let mut session_manager = state.session_manager.lock().await;
        session_manager.prepare_connect_server(&payload)
    };

    app.emit(
        "connection_status_changed",
        ConnectionStatusChangedEvent {
            session_id: connecting_session.id.clone(),
            profile_id: connecting_session.profile.id.clone(),
            status: status_to_string(&connecting_session.status),
            error: connecting_session.error.clone(),
        },
    )
    .map_err(|error| error.to_string())?;

    let connect_result = SshPool::connect_client(&payload).await;

    let session = {
        let mut session_manager = state.session_manager.lock().await;

        match connect_result {
            Ok(client) => {
                session_manager.attach_connected_client(connecting_session.id.clone(), client);
                session_manager.finish_connect_server(&connecting_session.id, Ok(()))
            }
            Err(error) => session_manager.finish_connect_server(&connecting_session.id, Err(error.to_string())),
        }
    };

    app.emit(
        "connection_status_changed",
        ConnectionStatusChangedEvent {
            session_id: session.id.clone(),
            profile_id: session.profile.id.clone(),
            status: status_to_string(&session.status),
            error: session.error.clone(),
        },
    )
    .map_err(|error| error.to_string())?;

    if let Some(error) = &session.error {
        return Err(error.clone());
    }

    Ok(session_to_dto(&session))
}

#[tauri::command]
pub async fn disconnect_server(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: DisconnectServerPayload,
) -> Result<Option<ServerSessionDto>, String> {
    let _ = state
        .transfer_registry
        .cancel_session(&payload.session_id)
        .await;

    let session = {
        let mut session_manager = state.session_manager.lock().await;
        session_manager.disconnect_server(&payload.session_id).await
    };

    if let Some(session) = &session {
        app.emit(
            "connection_status_changed",
            ConnectionStatusChangedEvent {
                session_id: session.id.clone(),
                profile_id: session.profile.id.clone(),
                status: status_to_string(&session.status),
                error: session.error.clone(),
            },
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(session.as_ref().map(session_to_dto))
}

#[tauri::command]
pub async fn cleanup_ssh_sessions(state: State<'_, AppState>) -> Result<(), String> {
    let _ = state.transfer_registry.cancel_all().await;
    let mut session_manager = state.session_manager.lock().await;
    session_manager.disconnect_all().await;
    Ok(())
}

#[tauri::command]
pub async fn list_server_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<ServerSessionDto>, String> {
    let session_manager = state.session_manager.lock().await;
    Ok(session_manager
        .list_sessions()
        .iter()
        .map(session_to_dto)
        .collect())
}

#[tauri::command]
pub async fn read_server_monitor(
    state: State<'_, AppState>,
    payload: ReadServerMonitorPayload,
) -> Result<ServerMonitorDto, String> {
    let mut session_manager = state.session_manager.lock().await;
    session_manager
        .read_server_monitor(&payload.server_session_id)
        .await
}

#[tauri::command]
pub async fn read_login_shell(
    state: State<'_, AppState>,
    payload: ReadLoginShellPayload,
) -> Result<String, String> {
    let mut session_manager = state.session_manager.lock().await;
    session_manager
        .read_login_shell(&payload.server_session_id)
        .await
}

#[tauri::command]
pub async fn check_server_session_health(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: CheckServerSessionHealthPayload,
) -> Result<ServerSessionDto, String> {
    let session = {
        let mut session_manager = state.session_manager.lock().await;
        session_manager
            .check_server_session_health(&payload.server_session_id)
            .await?
    };

    if session.error.is_some() {
        let _ = state
            .transfer_registry
            .cancel_session(&payload.server_session_id)
            .await;
        emit_connection_status(&app, &session)?;
    }

    if let Some(error) = &session.error {
        return Err(error.clone());
    }

    Ok(session_to_dto(&session))
}

#[tauri::command]
pub async fn open_terminal_tab(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: OpenTerminalTabPayload,
) -> Result<TerminalSessionDto, String> {
    let (event_tx, event_rx) = mpsc::unbounded_channel();
    let terminal = {
        let mut session_manager = state.session_manager.lock().await;
        session_manager.open_terminal_tab(payload, event_tx).await?
    };

    spawn_terminal_event_bridge(app, terminal.id.clone(), event_rx);

    Ok(terminal_to_dto(&terminal))
}

#[tauri::command]
pub async fn terminal_write(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: TerminalWritePayload,
) -> Result<(), String> {
    let result = {
        let session_manager = state.session_manager.lock().await;
        session_manager
            .terminal_write(&payload.terminal_id, payload.data)
            .await
    };

    if let Err(error) = result {
        finalize_terminal(&app, &payload.terminal_id, error.clone()).await;
        return Err(error);
    }

    Ok(())
}

#[tauri::command]
pub async fn terminal_resize(
    _app: AppHandle,
    state: State<'_, AppState>,
    payload: TerminalResizePayload,
) -> Result<(), String> {
    let session_manager = state.session_manager.lock().await;
    session_manager
        .terminal_resize(
            &payload.terminal_id,
            TerminalSize {
                cols: payload.cols,
                rows: payload.rows,
                width_px: payload.width_px,
                height_px: payload.height_px,
            },
        )
        .await
}

#[tauri::command]
pub async fn close_terminal_tab(
    _app: AppHandle,
    state: State<'_, AppState>,
    payload: CloseTerminalTabPayload,
) -> Result<Option<TerminalSessionDto>, String> {
    let terminal = {
        let mut session_manager = state.session_manager.lock().await;
        session_manager
            .close_terminal_tab(&payload.terminal_id)
            .await
    };

    Ok(terminal.as_ref().map(terminal_to_dto))
}

#[tauri::command]
pub async fn list_sftp_directory(
    state: State<'_, AppState>,
    payload: ListSftpDirectoryPayload,
) -> Result<RemoteDirectory, String> {
    let mut session_manager = state.session_manager.lock().await;
    session_manager
        .list_sftp_directory(&payload.server_session_id, &payload.path)
        .await
}

#[tauri::command]
pub async fn download_sftp_file(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: DownloadSftpFilePayload,
) -> Result<String, String> {
    let cancellation_token = state
        .transfer_registry
        .register_download(
            payload.transfer_id.clone(),
            payload.server_session_id.clone(),
        )
        .await;
    let transfer_guard = state
        .transfer_registry
        .download_guard(payload.transfer_id.clone());
    let sftp = {
        let mut session_manager = state.session_manager.lock().await;
        session_manager
            .sftp_client_for_download(&payload.server_session_id)
            .await?
    };

    emit_sftp_download_progress(&app, &payload, 0, None, SftpDownloadStatus::Started, None)?;

    let transfer_id = payload.transfer_id.clone();
    let task_transfer_id = transfer_id.clone();
    tauri::async_runtime::spawn(async move {
        let result = {
            let app = app.clone();
            let payload = payload.clone();
            let progress_payload = payload.clone();

            sftp.download_file(
                &payload.remote_path,
                &payload.local_path,
                cancellation_token,
                move |progress| {
                    emit_sftp_download_progress(
                        &app,
                        &progress_payload,
                        progress.transferred_bytes,
                        progress.total_bytes,
                        SftpDownloadStatus::Progress,
                        None,
                    )
                    .ok();
                },
            )
            .await
        };

        match result {
            Ok(progress) => {
                emit_sftp_download_progress(
                    &app,
                    &payload,
                    progress.transferred_bytes,
                    progress.total_bytes,
                    SftpDownloadStatus::Completed,
                    None,
                )
                .ok();
            }
            Err(error) if error.is_cancelled() => {
                let _ = tokio::fs::remove_file(&payload.local_path).await;
                emit_sftp_download_progress(
                    &app,
                    &payload,
                    0,
                    None,
                    SftpDownloadStatus::Cancelled,
                    None,
                )
                .ok();
            }
            Err(error) => {
                emit_sftp_download_progress(
                    &app,
                    &payload,
                    0,
                    None,
                    SftpDownloadStatus::Error,
                    Some(error.to_string()),
                )
                .ok();
            }
        }

        let state = app.state::<AppState>();
        state
            .transfer_registry
            .complete_download(&task_transfer_id)
            .await;
    });
    transfer_guard.disarm();

    Ok(transfer_id)
}

#[tauri::command]
pub async fn download_sftp_directory(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: DownloadSftpDirectoryPayload,
) -> Result<String, String> {
    let cancellation_token = state
        .transfer_registry
        .register_download(
            payload.transfer_id.clone(),
            payload.server_session_id.clone(),
        )
        .await;
    let transfer_guard = state
        .transfer_registry
        .download_guard(payload.transfer_id.clone());
    let sftp = {
        let mut session_manager = state.session_manager.lock().await;
        session_manager
            .sftp_client_for_download(&payload.server_session_id)
            .await?
    };

    let root_name = remote_file_name(&payload.remote_path);
    let local_root = PathBuf::from(&payload.local_directory).join(sanitize_file_name(root_name));
    tokio::fs::create_dir_all(&local_root)
        .await
        .map_err(|error| error.to_string())?;

    let started_payload = DownloadSftpFilePayload {
        transfer_id: payload.transfer_id.clone(),
        server_session_id: payload.server_session_id.clone(),
        remote_path: payload.remote_path.clone(),
        local_path: local_root.to_string_lossy().to_string(),
    };
    emit_sftp_download_progress(
        &app,
        &started_payload,
        0,
        None,
        SftpDownloadStatus::Started,
        None,
    )?;

    let transfer_id = payload.transfer_id.clone();
    let task_transfer_id = transfer_id.clone();
    tauri::async_runtime::spawn(async move {
        let result = download_remote_directory_tree(
            app.clone(),
            Arc::clone(&sftp),
            payload.clone(),
            local_root,
            cancellation_token,
        )
        .await;

        match result {
            Ok(()) => {
                let completed_payload = DownloadSftpFilePayload {
                    transfer_id: payload.transfer_id.clone(),
                    server_session_id: payload.server_session_id.clone(),
                    remote_path: payload.remote_path.clone(),
                    local_path: payload.local_directory.clone(),
                };
                emit_sftp_download_progress(
                    &app,
                    &completed_payload,
                    1,
                    Some(1),
                    SftpDownloadStatus::Completed,
                    None,
                )
                .ok();
            }
            Err(error) if error == "transfer cancelled" => {
                let cancelled_payload = DownloadSftpFilePayload {
                    transfer_id: payload.transfer_id.clone(),
                    server_session_id: payload.server_session_id.clone(),
                    remote_path: payload.remote_path.clone(),
                    local_path: payload.local_directory.clone(),
                };
                emit_sftp_download_progress(
                    &app,
                    &cancelled_payload,
                    0,
                    None,
                    SftpDownloadStatus::Cancelled,
                    None,
                )
                .ok();
            }
            Err(error) => {
                let error_payload = DownloadSftpFilePayload {
                    transfer_id: payload.transfer_id.clone(),
                    server_session_id: payload.server_session_id.clone(),
                    remote_path: payload.remote_path.clone(),
                    local_path: payload.local_directory.clone(),
                };
                emit_sftp_download_progress(
                    &app,
                    &error_payload,
                    0,
                    None,
                    SftpDownloadStatus::Error,
                    Some(error),
                )
                .ok();
            }
        }

        let state = app.state::<AppState>();
        state
            .transfer_registry
            .complete_download(&task_transfer_id)
            .await;
    });
    transfer_guard.disarm();

    Ok(transfer_id)
}

#[tauri::command]
pub async fn cancel_sftp_download(
    state: State<'_, AppState>,
    payload: CancelSftpDownloadPayload,
) -> Result<(), String> {
    let _ = state
        .transfer_registry
        .cancel_download(&payload.transfer_id)
        .await;
    Ok(())
}

#[tauri::command]
pub async fn upload_sftp_file(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: UploadSftpFilePayload,
) -> Result<String, String> {
    let cancellation_token = state
        .transfer_registry
        .register_upload(
            payload.transfer_id.clone(),
            payload.server_session_id.clone(),
        )
        .await;
    let transfer_guard = state
        .transfer_registry
        .upload_guard(payload.transfer_id.clone());
    let sftp = {
        let mut session_manager = state.session_manager.lock().await;
        session_manager
            .sftp_client_for_download(&payload.server_session_id)
            .await?
    };

    emit_sftp_upload_progress(&app, &payload, 0, None, SftpUploadStatus::Started, None)?;

    let transfer_id = payload.transfer_id.clone();
    let task_transfer_id = transfer_id.clone();
    tauri::async_runtime::spawn(async move {
        let result = {
            let app = app.clone();
            let payload = payload.clone();
            let progress_payload = payload.clone();

            sftp.upload_file(
                &payload.local_path,
                &payload.remote_path,
                cancellation_token,
                move |progress| {
                    emit_sftp_upload_progress(
                        &app,
                        &progress_payload,
                        progress.transferred_bytes,
                        progress.total_bytes,
                        SftpUploadStatus::Progress,
                        None,
                    )
                    .ok();
                },
            )
            .await
        };

        match result {
            Ok(progress) => {
                emit_sftp_upload_progress(
                    &app,
                    &payload,
                    progress.transferred_bytes,
                    progress.total_bytes,
                    SftpUploadStatus::Completed,
                    None,
                )
                .ok();
            }
            Err(error) if error.is_cancelled() => {
                let _ = sftp.remove_file(&payload.remote_path).await;
                emit_sftp_upload_progress(
                    &app,
                    &payload,
                    0,
                    None,
                    SftpUploadStatus::Cancelled,
                    None,
                )
                .ok();
            }
            Err(error) => {
                emit_sftp_upload_progress(
                    &app,
                    &payload,
                    0,
                    None,
                    SftpUploadStatus::Error,
                    Some(error.to_string()),
                )
                .ok();
            }
        }

        let state = app.state::<AppState>();
        state
            .transfer_registry
            .complete_upload(&task_transfer_id)
            .await;
    });
    transfer_guard.disarm();

    Ok(transfer_id)
}

#[tauri::command]
pub async fn prepare_sftp_upload_queue(
    payload: PrepareSftpUploadQueuePayload,
) -> Result<PreparedSftpUploadQueueDto, String> {
    let mut directories = Vec::new();
    let mut files = Vec::new();
    let remote_directory = normalize_remote_directory(&payload.remote_directory);

    for local_path in payload.local_paths {
        let local_path = PathBuf::from(local_path);
        let metadata = tokio::fs::metadata(&local_path)
            .await
            .map_err(|error| format!("failed to read {}: {error}", local_path.display()))?;
        let entry_name = local_path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .ok_or_else(|| format!("invalid local path {}", local_path.display()))?
            .to_string();

        if metadata.is_dir() {
            let remote_root = join_remote_path(&remote_directory, &entry_name);
            directories.push(remote_root.clone());
            collect_local_upload_directory(
                &local_path,
                &remote_root,
                &mut directories,
                &mut files,
            )
            .await?;
        } else if metadata.is_file() {
            files.push(PreparedSftpUploadFileDto {
                local_path: local_path.to_string_lossy().to_string(),
                remote_path: join_remote_path(&remote_directory, &entry_name),
                file_name: entry_name,
            });
        }
    }

    directories.sort_by_key(|path| path.matches('/').count());
    directories.dedup();

    Ok(PreparedSftpUploadQueueDto { directories, files })
}

#[tauri::command]
pub async fn cancel_sftp_upload(
    state: State<'_, AppState>,
    payload: CancelSftpUploadPayload,
) -> Result<(), String> {
    let _ = state
        .transfer_registry
        .cancel_upload(&payload.transfer_id)
        .await;
    Ok(())
}

#[tauri::command]
pub async fn delete_sftp_entry(
    state: State<'_, AppState>,
    payload: DeleteSftpEntryPayload,
) -> Result<(), String> {
    let sftp = {
        let mut session_manager = state.session_manager.lock().await;
        session_manager
            .sftp_client_for_download(&payload.server_session_id)
            .await?
    };

    if payload.is_directory {
        sftp.remove_directory_recursive(&payload.path)
            .await
            .map_err(|error| error.to_string())
    } else {
        sftp.remove_file(&payload.path)
            .await
            .map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub async fn rename_sftp_entry(
    state: State<'_, AppState>,
    payload: RenameSftpEntryPayload,
) -> Result<(), String> {
    let sftp = {
        let mut session_manager = state.session_manager.lock().await;
        session_manager
            .sftp_client_for_download(&payload.server_session_id)
            .await?
    };

    sftp.rename(&payload.source_path, &payload.target_path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_sftp_directory(
    state: State<'_, AppState>,
    payload: CreateSftpDirectoryPayload,
) -> Result<(), String> {
    let sftp = {
        let mut session_manager = state.session_manager.lock().await;
        session_manager
            .sftp_client_for_download(&payload.server_session_id)
            .await?
    };

    sftp.create_directory(&payload.path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn open_sftp_local_edit(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: OpenSftpLocalEditPayload,
) -> Result<LocalEditSessionDto, String> {
    let edit_id = format!(
        "edit-{}-{:016x}",
        chrono_like_timestamp(),
        stable_hash(&format!(
            "{}:{}",
            payload.server_session_id, payload.remote_path
        ))
    );
    let file_name = sanitize_file_name(remote_file_name(&payload.remote_path));
    let local_path = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join(LOCAL_EDIT_CACHE_DIR)
        .join(&payload.server_session_id)
        .join(&edit_id)
        .join(file_name);

    if let Some(parent) = local_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| error.to_string())?;
    }

    let sftp = {
        let mut session_manager = state.session_manager.lock().await;
        session_manager
            .sftp_client_for_download(&payload.server_session_id)
            .await?
    };
    let local_path_string = local_path.to_string_lossy().to_string();

    sftp.download_file(
        &payload.remote_path,
        &local_path_string,
        CancellationToken::new(),
        |_| {},
    )
    .await
    .map_err(|error| error.to_string())?;

    state
        .local_edit_registry
        .watch(
            app,
            LocalEditSessionConfig {
                edit_id: edit_id.clone(),
                server_session_id: payload.server_session_id.clone(),
                remote_path: payload.remote_path.clone(),
                local_path: local_path_string.clone(),
                sftp,
            },
        )
        .await?;

    Ok(LocalEditSessionDto {
        id: edit_id,
        server_session_id: payload.server_session_id,
        remote_path: payload.remote_path,
        local_path: local_path_string,
    })
}

fn spawn_terminal_event_bridge(
    app: AppHandle,
    terminal_id: String,
    mut event_rx: mpsc::UnboundedReceiver<SshTerminalEvent>,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            match event {
                SshTerminalEvent::Output(data) => {
                    emit_terminal_output(&app, &terminal_id, String::from_utf8_lossy(&data));
                }
                SshTerminalEvent::ExtendedOutput { data, .. } => {
                    emit_terminal_output(&app, &terminal_id, String::from_utf8_lossy(&data));
                }
                SshTerminalEvent::Eof => {
                    finalize_terminal(&app, &terminal_id, "remote eof".to_string()).await;
                    break;
                }
                SshTerminalEvent::ExitStatus(exit_status) => {
                    emit_terminal_output(
                        &app,
                        &terminal_id,
                        format!("\r\n[process exited with status {exit_status}]\r\n"),
                    );
                    finalize_terminal(
                        &app,
                        &terminal_id,
                        format!("process exited with status {exit_status}"),
                    )
                    .await;
                    break;
                }
                SshTerminalEvent::Closed => {
                    finalize_terminal(&app, &terminal_id, "remote closed".to_string()).await;
                    break;
                }
                SshTerminalEvent::Error(error) => {
                    emit_terminal_output(
                        &app,
                        &terminal_id,
                        format!("\r\n[ssh error: {error}]\r\n"),
                    );
                    finalize_terminal(&app, &terminal_id, error).await;
                    break;
                }
            }
        }
    });
}

async fn finalize_terminal(app: &AppHandle, terminal_id: &str, reason: String) {
    emit_terminal_closed(app, terminal_id, Some(reason));

    let state = app.state::<AppState>();
    let mut session_manager = state.session_manager.lock().await;
    let _ = session_manager.close_terminal_tab(terminal_id).await;
}

fn emit_terminal_output(app: &AppHandle, terminal_id: &str, data: impl Into<String>) {
    let _ = app.emit(
        "terminal_output",
        TerminalOutputEvent {
            terminal_id: terminal_id.to_string(),
            data: data.into(),
        },
    );
}

fn emit_terminal_closed(app: &AppHandle, terminal_id: &str, reason: Option<String>) {
    let _ = app.emit(
        "terminal_closed",
        TerminalClosedEvent {
            terminal_id: terminal_id.to_string(),
            reason,
        },
    );
}

fn emit_sftp_download_progress(
    app: &AppHandle,
    payload: &DownloadSftpFilePayload,
    transferred_bytes: u64,
    total_bytes: Option<u64>,
    status: SftpDownloadStatus,
    error: Option<String>,
) -> Result<(), String> {
    app.emit(
        "sftp_download_progress",
        SftpDownloadProgressEvent {
            transfer_id: payload.transfer_id.clone(),
            server_session_id: payload.server_session_id.clone(),
            remote_path: payload.remote_path.clone(),
            local_path: payload.local_path.clone(),
            transferred_bytes,
            total_bytes,
            status,
            error,
        },
    )
    .map_err(|error| error.to_string())
}

async fn collect_local_upload_directory(
    local_directory: &Path,
    remote_directory: &str,
    directories: &mut Vec<String>,
    files: &mut Vec<PreparedSftpUploadFileDto>,
) -> Result<(), String> {
    let mut pending = vec![(local_directory.to_path_buf(), remote_directory.to_string())];

    while let Some((current_local, current_remote)) = pending.pop() {
        let mut entries = tokio::fs::read_dir(&current_local)
            .await
            .map_err(|error| format!("failed to read {}: {error}", current_local.display()))?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| format!("failed to read {}: {error}", current_local.display()))?
        {
            let path = entry.path();
            let metadata = entry
                .metadata()
                .await
                .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
            let file_name = entry.file_name().to_string_lossy().to_string();

            if metadata.is_dir() {
                let child_remote = join_remote_path(&current_remote, &file_name);
                directories.push(child_remote.clone());
                pending.push((path, child_remote));
            } else if metadata.is_file() {
                files.push(PreparedSftpUploadFileDto {
                    local_path: path.to_string_lossy().to_string(),
                    remote_path: join_remote_path(&current_remote, &file_name),
                    file_name,
                });
            }
        }
    }

    Ok(())
}

async fn download_remote_directory_tree(
    app: AppHandle,
    sftp: Arc<SftpClient>,
    payload: DownloadSftpDirectoryPayload,
    local_root: PathBuf,
    cancellation_token: CancellationToken,
) -> Result<(), String> {
    let mut pending = vec![(payload.remote_path.clone(), local_root)];

    while let Some((remote_directory, local_directory)) = pending.pop() {
        if cancellation_token.is_cancelled() {
            return Err("transfer cancelled".to_string());
        }

        tokio::fs::create_dir_all(&local_directory)
            .await
            .map_err(|error| error.to_string())?;

        let directory = sftp
            .list_directory(&remote_directory)
            .await
            .map_err(|error| error.to_string())?;

        for entry in directory.entries {
            if cancellation_token.is_cancelled() {
                return Err("transfer cancelled".to_string());
            }

            let local_path = local_directory.join(sanitize_file_name(&entry.name));

            match entry.kind {
                RemoteFileKind::Directory => {
                    tokio::fs::create_dir_all(&local_path)
                        .await
                        .map_err(|error| error.to_string())?;
                    pending.push((entry.path, local_path));
                }
                RemoteFileKind::File => {
                    let file_payload = DownloadSftpFilePayload {
                        transfer_id: payload.transfer_id.clone(),
                        server_session_id: payload.server_session_id.clone(),
                        remote_path: entry.path.clone(),
                        local_path: local_path.to_string_lossy().to_string(),
                    };

                    emit_sftp_download_progress(
                        &app,
                        &file_payload,
                        0,
                        None,
                        SftpDownloadStatus::Progress,
                        None,
                    )
                    .ok();

                    sftp.download_file(
                        &entry.path,
                        &local_path.to_string_lossy(),
                        cancellation_token.clone(),
                        {
                            let app = app.clone();
                            let file_payload = file_payload.clone();
                            move |progress| {
                                emit_sftp_download_progress(
                                    &app,
                                    &file_payload,
                                    progress.transferred_bytes,
                                    progress.total_bytes,
                                    SftpDownloadStatus::Progress,
                                    None,
                                )
                                .ok();
                            }
                        },
                    )
                    .await
                    .map_err(|error| error.to_string())?;
                }
                RemoteFileKind::Other => {}
            }
        }
    }

    Ok(())
}

fn normalize_remote_directory(path: &str) -> String {
    let trimmed = path.trim();

    if trimmed.is_empty() || trimmed == "." {
        ".".to_string()
    } else if trimmed == "/" {
        "/".to_string()
    } else {
        trimmed.trim_end_matches('/').to_string()
    }
}

fn join_remote_path(directory: &str, name: &str) -> String {
    let name = sanitize_remote_path_part(name);

    if directory.is_empty() || directory == "." {
        name
    } else if directory == "/" {
        format!("/{name}")
    } else {
        format!("{}/{}", directory.trim_end_matches('/'), name)
    }
}

fn sanitize_remote_path_part(path: &str) -> String {
    Path::new(path)
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn remote_file_name(remote_path: &str) -> &str {
    remote_path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("remote-file")
}

fn sanitize_file_name(file_name: &str) -> String {
    let sanitized = file_name
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect::<String>()
        .trim_matches(['.', ' '])
        .to_string();

    if sanitized.is_empty() {
        "remote-file".to_string()
    } else {
        sanitized
    }
}

fn stable_hash(value: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    hasher.finish()
}

fn chrono_like_timestamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn emit_sftp_upload_progress(
    app: &AppHandle,
    payload: &UploadSftpFilePayload,
    transferred_bytes: u64,
    total_bytes: Option<u64>,
    status: SftpUploadStatus,
    error: Option<String>,
) -> Result<(), String> {
    app.emit(
        "sftp_upload_progress",
        SftpUploadProgressEvent {
            transfer_id: payload.transfer_id.clone(),
            server_session_id: payload.server_session_id.clone(),
            local_path: payload.local_path.clone(),
            remote_path: payload.remote_path.clone(),
            transferred_bytes,
            total_bytes,
            status,
            error,
        },
    )
    .map_err(|error| error.to_string())
}
