use std::sync::Arc;

use crate::services::local_edit_service::LocalEditRegistry;
use crate::services::session_manager::SessionManager;
use crate::services::transfer_service::TransferRegistry;
use tokio::sync::Mutex;

pub struct AppState {
    pub session_manager: Mutex<SessionManager>,
    pub transfer_registry: TransferRegistry,
    pub local_edit_registry: Arc<LocalEditRegistry>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            session_manager: Mutex::new(SessionManager::default()),
            transfer_registry: TransferRegistry::default(),
            local_edit_registry: Arc::new(LocalEditRegistry::default()),
        }
    }
}

impl AppState {
    pub fn local_edit_registry(&self) -> Arc<LocalEditRegistry> {
        Arc::clone(&self.local_edit_registry)
    }
}
