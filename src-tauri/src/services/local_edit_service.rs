use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use notify::{Event, EventKind, RecursiveMode, Watcher};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use tokio_util::sync::CancellationToken;

use crate::dto::events::{LocalEditSyncEvent, LocalEditSyncStatus};
use crate::transport::sftp_client::SftpClient;

const LOCAL_EDIT_SYNC_DEBOUNCE_MS: u64 = 700;

#[derive(Default)]
pub struct LocalEditRegistry {
    sessions: Mutex<HashMap<String, LocalEditSessionHandle>>,
}

pub struct LocalEditSessionConfig {
    pub edit_id: String,
    pub server_session_id: String,
    pub remote_path: String,
    pub local_path: String,
    pub sftp: Arc<SftpClient>,
}

struct LocalEditSessionHandle {
    _watcher: notify::RecommendedWatcher,
    task: JoinHandle<()>,
}

impl LocalEditRegistry {
    pub async fn watch(
        &self,
        app: AppHandle,
        config: LocalEditSessionConfig,
    ) -> Result<(), String> {
        let edit_id = config.edit_id.clone();
        let local_path = PathBuf::from(&config.local_path);
        let watch_path = local_path.clone();
        let config = Arc::new(config);
        let (change_tx, change_rx) = mpsc::unbounded_channel::<()>();
        let watcher_app = app.clone();
        let watcher_config = Arc::clone(&config);
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<Event>| match result {
                Ok(event) if should_sync_event(&event) => {
                    let _ = change_tx.send(());
                }
                Ok(_) => {}
                Err(error) => {
                    emit_local_edit_sync(
                        &watcher_app,
                        &watcher_config,
                        LocalEditSyncStatus::Error,
                        Some(error.to_string()),
                    );
                }
            })
            .map_err(|error| error.to_string())?;

        watcher
            .watch(&watch_path, RecursiveMode::NonRecursive)
            .map_err(|error| error.to_string())?;

        let mut sessions = self.sessions.lock().await;
        if let Some(old_session) = sessions.remove(&edit_id) {
            old_session.task.abort();
        }

        let task =
            tauri::async_runtime::spawn(local_edit_sync_loop(app, Arc::clone(&config), change_rx));

        sessions.insert(
            edit_id,
            LocalEditSessionHandle {
                _watcher: watcher,
                task,
            },
        );

        Ok(())
    }
}

fn should_sync_event(event: &Event) -> bool {
    matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Any
    )
}

async fn local_edit_sync_loop(
    app: AppHandle,
    config: Arc<LocalEditSessionConfig>,
    mut change_rx: mpsc::UnboundedReceiver<()>,
) {
    while change_rx.recv().await.is_some() {
        let debounce = tokio::time::sleep(Duration::from_millis(LOCAL_EDIT_SYNC_DEBOUNCE_MS));
        tokio::pin!(debounce);

        loop {
            tokio::select! {
                _ = &mut debounce => break,
                event = change_rx.recv() => {
                    if event.is_none() {
                        return;
                    }
                    debounce.as_mut().reset(tokio::time::Instant::now() + Duration::from_millis(LOCAL_EDIT_SYNC_DEBOUNCE_MS));
                }
            }
        }

        sync_local_edit(app.clone(), Arc::clone(&config)).await;
    }
}

async fn sync_local_edit(app: AppHandle, config: Arc<LocalEditSessionConfig>) {
    emit_local_edit_sync(&app, &config, LocalEditSyncStatus::Started, None);

    let result = config
        .sftp
        .upload_file(
            &config.local_path,
            &config.remote_path,
            CancellationToken::new(),
            |_| {},
        )
        .await;

    match result {
        Ok(_) => emit_local_edit_sync(&app, &config, LocalEditSyncStatus::Completed, None),
        Err(error) => emit_local_edit_sync(
            &app,
            &config,
            LocalEditSyncStatus::Error,
            Some(error.to_string()),
        ),
    }
}

fn emit_local_edit_sync(
    app: &AppHandle,
    config: &LocalEditSessionConfig,
    status: LocalEditSyncStatus,
    error: Option<String>,
) {
    let _ = app.emit(
        "sftp_local_edit_sync",
        LocalEditSyncEvent {
            edit_id: config.edit_id.clone(),
            server_session_id: config.server_session_id.clone(),
            remote_path: config.remote_path.clone(),
            local_path: config.local_path.clone(),
            status,
            error,
        },
    );
}
