// Transfer queue workflows will live here.
use std::collections::HashMap;

use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct TransferRegistry {
    downloads: Mutex<HashMap<String, CancellationToken>>,
    uploads: Mutex<HashMap<String, CancellationToken>>,
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
}
