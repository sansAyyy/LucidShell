// Transfer queue workflows will live here.
use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Default)]
pub struct TransferRegistry {
    downloads: Arc<Mutex<HashMap<String, CancellationToken>>>,
    uploads: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl TransferRegistry {
    pub async fn register_download(&self, transfer_id: String) -> CancellationToken {
        let token = CancellationToken::new();
        self.downloads
            .lock()
            .await
            .insert(transfer_id, token.clone());
        token
    }

    pub async fn cancel_download(&self, transfer_id: &str) -> bool {
        let token = self.downloads.lock().await.remove(transfer_id);

        if let Some(token) = token {
            token.cancel();
            true
        } else {
            false
        }
    }

    pub async fn complete_download(&self, transfer_id: &str) {
        self.downloads.lock().await.remove(transfer_id);
    }

    pub async fn register_upload(&self, transfer_id: String) -> CancellationToken {
        let token = CancellationToken::new();
        self.uploads.lock().await.insert(transfer_id, token.clone());
        token
    }

    pub async fn cancel_upload(&self, transfer_id: &str) -> bool {
        let token = self.uploads.lock().await.remove(transfer_id);

        if let Some(token) = token {
            token.cancel();
            true
        } else {
            false
        }
    }

    pub async fn complete_upload(&self, transfer_id: &str) {
        self.uploads.lock().await.remove(transfer_id);
    }

    pub fn download_guard(&self, transfer_id: String) -> TransferGuard {
        TransferGuard {
            registry: self.clone(),
            transfer_id: Some(transfer_id),
            transfer_kind: TransferKind::Download,
        }
    }

    pub fn upload_guard(&self, transfer_id: String) -> TransferGuard {
        TransferGuard {
            registry: self.clone(),
            transfer_id: Some(transfer_id),
            transfer_kind: TransferKind::Upload,
        }
    }
}

pub enum TransferKind {
    Download,
    Upload,
}

pub struct TransferGuard {
    registry: TransferRegistry,
    transfer_id: Option<String>,
    transfer_kind: TransferKind,
}

impl TransferGuard {
    pub fn disarm(mut self) {
        self.transfer_id = None;
    }
}

impl Drop for TransferGuard {
    fn drop(&mut self) {
        if let Some(transfer_id) = self.transfer_id.take() {
            let registry = self.registry.clone();
            let transfer_kind = match self.transfer_kind {
                TransferKind::Download => TransferKind::Download,
                TransferKind::Upload => TransferKind::Upload,
            };

            tokio::spawn(async move {
                match transfer_kind {
                    TransferKind::Download => registry.complete_download(&transfer_id).await,
                    TransferKind::Upload => registry.complete_upload(&transfer_id).await,
                }
            });
        }
    }
}
