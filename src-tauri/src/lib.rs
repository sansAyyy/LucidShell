pub mod app;
pub mod domain;
pub mod dto;
pub mod infrastructure;
pub mod services;
pub mod transport;

use crate::app::commands::{
    append_diagnostic_log, cancel_sftp_download, cancel_sftp_upload, check_server_session_health, cleanup_ssh_sessions, close_terminal_tab, connect_server,
    create_sftp_directory, delete_sftp_entry, disconnect_server, download_sftp_directory,
    download_sftp_file, export_connections_to_file, export_diagnostic_log, clear_diagnostic_log, delete_keychain_password, list_server_sessions, list_sftp_directory,
    load_connections_config, load_settings_config, open_sftp_local_edit, open_terminal_tab, prepare_sftp_upload_queue,
    read_connections_import_file, read_diagnostic_log, read_keychain_password, read_login_shell, read_server_monitor, rename_sftp_entry, reset_connections_config,
    save_connections_config, save_keychain_password, save_settings_config, terminal_resize, terminal_write, upload_sftp_file,
};
use crate::app::state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            append_diagnostic_log,
            connect_server,
            cancel_sftp_download,
            cancel_sftp_upload,
            check_server_session_health,
            clear_diagnostic_log,
            cleanup_ssh_sessions,
            close_terminal_tab,
            disconnect_server,
            create_sftp_directory,
            delete_sftp_entry,
            delete_keychain_password,
            download_sftp_directory,
            download_sftp_file,
            export_connections_to_file,
            export_diagnostic_log,
            list_server_sessions,
            list_sftp_directory,
            load_connections_config,
            load_settings_config,
            open_sftp_local_edit,
            open_terminal_tab,
            prepare_sftp_upload_queue,
            read_connections_import_file,
            read_diagnostic_log,
            read_keychain_password,
            read_login_shell,
            read_server_monitor,
            rename_sftp_entry,
            reset_connections_config,
            save_connections_config,
            save_keychain_password,
            save_settings_config,
            terminal_resize,
            terminal_write,
            upload_sftp_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building LucidShell")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                let app_handle = app.clone();
                tauri::async_runtime::block_on(async move {
                    let state = app_handle.state::<AppState>();
                    let mut session_manager = state.session_manager.lock().await;
                    session_manager.disconnect_all().await;
                });
            }
        });
}
