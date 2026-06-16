// Transfer queue workflows will live here.
use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Default)]
pub struct TransferRegistry {
    downloads: Arc<Mutex<HashMap<String, TransferHandle>>>,
    uploads: Arc<Mutex<HashMap<String, TransferHandle>>>,
}

impl TransferRegistry {
    pub async fn register_download(
        &self,
        transfer_id: String,
        server_session_id: String,
    ) -> CancellationToken {
        let token = CancellationToken::new();
        self.downloads.lock().await.insert(
            transfer_id,
            TransferHandle {
                server_session_id,
                token: token.clone(),
            },
        );
        token
    }

    pub async fn cancel_download(&self, transfer_id: &str) -> bool {
        let transfer = self.downloads.lock().await.remove(transfer_id);

        if let Some(transfer) = transfer {
            transfer.token.cancel();
            true
        } else {
            false
        }
    }

    pub async fn complete_download(&self, transfer_id: &str) {
        self.downloads.lock().await.remove(transfer_id);
    }

    pub async fn register_upload(
        &self,
        transfer_id: String,
        server_session_id: String,
    ) -> CancellationToken {
        let token = CancellationToken::new();
        self.uploads.lock().await.insert(
            transfer_id,
            TransferHandle {
                server_session_id,
                token: token.clone(),
            },
        );
        token
    }

    pub async fn cancel_upload(&self, transfer_id: &str) -> bool {
        let transfer = self.uploads.lock().await.remove(transfer_id);

        if let Some(transfer) = transfer {
            transfer.token.cancel();
            true
        } else {
            false
        }
    }

    pub async fn complete_upload(&self, transfer_id: &str) {
        self.uploads.lock().await.remove(transfer_id);
    }

    pub async fn cancel_session(&self, server_session_id: &str) -> usize {
        let mut cancelled = 0;
        cancelled += cancel_transfers_for_session(&self.downloads, server_session_id).await;
        cancelled += cancel_transfers_for_session(&self.uploads, server_session_id).await;
        cancelled
    }

    pub async fn cancel_all(&self) -> usize {
        let mut cancelled = 0;
        cancelled += cancel_all_transfers(&self.downloads).await;
        cancelled += cancel_all_transfers(&self.uploads).await;
        cancelled
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

#[derive(Clone)]
struct TransferHandle {
    server_session_id: String,
    token: CancellationToken,
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

async fn cancel_transfers_for_session(
    transfers: &Mutex<HashMap<String, TransferHandle>>,
    server_session_id: &str,
) -> usize {
    let mut transfers = transfers.lock().await;
    let transfer_ids = transfers
        .iter()
        .filter_map(|(transfer_id, transfer)| {
            (transfer.server_session_id == server_session_id).then(|| transfer_id.clone())
        })
        .collect::<Vec<_>>();

    let cancelled = transfer_ids.len();
    for transfer_id in transfer_ids {
        if let Some(transfer) = transfers.remove(&transfer_id) {
            transfer.token.cancel();
        }
    }

    cancelled
}

async fn cancel_all_transfers(transfers: &Mutex<HashMap<String, TransferHandle>>) -> usize {
    let mut transfers = transfers.lock().await;
    let cancelled = transfers.len();

    for (_, transfer) in transfers.drain() {
        transfer.token.cancel();
    }

    cancelled
}
