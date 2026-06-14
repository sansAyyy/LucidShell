use std::error::Error;
use std::fmt::{Display, Formatter};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::FileType;
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

const TRANSFER_CHUNK_SIZE: usize = 256 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDirectory {
    pub current_path: String,
    pub entries: Vec<RemoteFileEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFileEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: RemoteFileKind,
    pub size: String,
    pub modified: String,
    pub mode: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RemoteFileKind {
    File,
    Directory,
    Other,
}

pub struct SftpClient {
    session: SftpSession,
}

impl SftpClient {
    pub fn new(session: SftpSession) -> Self {
        Self { session }
    }

    pub async fn list_directory(&self, path: &str) -> SftpResult<RemoteDirectory> {
        let current_path = self.session.canonicalize(path).await?;
        let mut entries = self
            .session
            .read_dir(current_path.clone())
            .await?
            .map(|entry| {
                let metadata = entry.metadata();
                RemoteFileEntry {
                    id: entry.path(),
                    name: entry.file_name(),
                    path: entry.path(),
                    kind: file_kind(entry.file_type()),
                    size: format_size(metadata.size.unwrap_or_default()),
                    modified: format_modified(metadata.mtime),
                    mode: format_mode(metadata.permissions),
                }
            })
            .collect::<Vec<_>>();

        entries.sort_by(|left, right| match (&left.kind, &right.kind) {
            (RemoteFileKind::Directory, RemoteFileKind::File | RemoteFileKind::Other) => {
                std::cmp::Ordering::Less
            }
            (RemoteFileKind::File | RemoteFileKind::Other, RemoteFileKind::Directory) => {
                std::cmp::Ordering::Greater
            }
            _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
        });

        Ok(RemoteDirectory {
            current_path,
            entries,
        })
    }

    pub async fn close(&self) -> SftpResult<()> {
        self.session.close().await?;
        Ok(())
    }

    pub async fn download_file(
        &self,
        remote_path: &str,
        local_path: &str,
        cancellation_token: CancellationToken,
        mut on_progress: impl FnMut(DownloadProgress) + Send,
    ) -> SftpResult<DownloadProgress> {
        let mut remote_file = self.session.open(remote_path).await?;
        let total_bytes = remote_file.metadata().await?.size;
        let mut local_file = tokio::fs::File::create(local_path).await?;
        let mut transferred_bytes = 0;
        let mut buffer = vec![0; TRANSFER_CHUNK_SIZE];
        let mut progress = DownloadProgress {
            transferred_bytes,
            total_bytes,
        };

        on_progress(progress);

        loop {
            let read_size = tokio::select! {
                _ = cancellation_token.cancelled() => {
                    return Err(SftpClientError::cancelled());
                }
                result = remote_file.read(&mut buffer) => result?,
            };

            if read_size == 0 {
                break;
            }

            tokio::select! {
                _ = cancellation_token.cancelled() => {
                    return Err(SftpClientError::cancelled());
                }
                result = local_file.write_all(&buffer[..read_size]) => result?,
            }
            transferred_bytes += read_size as u64;
            progress = DownloadProgress {
                transferred_bytes,
                total_bytes,
            };
            on_progress(progress);
        }

        local_file.flush().await?;
        remote_file.shutdown().await?;
        Ok(progress)
    }

    pub async fn upload_file(
        &self,
        local_path: &str,
        remote_path: &str,
        cancellation_token: CancellationToken,
        mut on_progress: impl FnMut(TransferProgress) + Send,
    ) -> SftpResult<TransferProgress> {
        let mut local_file = tokio::fs::File::open(local_path).await?;
        let total_bytes = local_file
            .metadata()
            .await
            .ok()
            .map(|metadata| metadata.len());
        let mut remote_file = self.session.create(remote_path).await?;
        let mut transferred_bytes = 0;
        let mut buffer = vec![0; TRANSFER_CHUNK_SIZE];
        let mut progress = TransferProgress {
            transferred_bytes,
            total_bytes,
        };

        on_progress(progress);

        loop {
            let read_size = tokio::select! {
                _ = cancellation_token.cancelled() => {
                    return Err(SftpClientError::cancelled());
                }
                result = local_file.read(&mut buffer) => result?,
            };

            if read_size == 0 {
                break;
            }

            tokio::select! {
                _ = cancellation_token.cancelled() => {
                    return Err(SftpClientError::cancelled());
                }
                result = remote_file.write_all(&buffer[..read_size]) => result?,
            }
            transferred_bytes += read_size as u64;
            progress = TransferProgress {
                transferred_bytes,
                total_bytes,
            };
            on_progress(progress);
        }

        remote_file.flush().await?;
        remote_file.shutdown().await?;
        Ok(progress)
    }

    pub async fn remove_file(&self, remote_path: &str) -> SftpResult<()> {
        self.session.remove_file(remote_path).await?;
        Ok(())
    }

    pub async fn remove_directory(&self, remote_path: &str) -> SftpResult<()> {
        self.session.remove_dir(remote_path).await?;
        Ok(())
    }

    pub async fn remove_directory_recursive(&self, remote_path: &str) -> SftpResult<()> {
        let mut pending = vec![remote_path.to_string()];
        let mut directories = Vec::new();

        while let Some(directory_path) = pending.pop() {
            let directory = self.list_directory(&directory_path).await?;
            directories.push(directory_path);

            for entry in directory.entries {
                match entry.kind {
                    RemoteFileKind::Directory => pending.push(entry.path),
                    RemoteFileKind::File | RemoteFileKind::Other => {
                        self.remove_file(&entry.path).await?;
                    }
                }
            }
        }

        for directory_path in directories.iter().rev() {
            self.remove_directory(directory_path).await?;
        }

        Ok(())
    }

    pub async fn rename(&self, source_path: &str, target_path: &str) -> SftpResult<()> {
        self.session.rename(source_path, target_path).await?;
        Ok(())
    }

    pub async fn create_directory(&self, remote_path: &str) -> SftpResult<()> {
        self.session.create_dir(remote_path).await?;
        Ok(())
    }
}

#[derive(Debug)]
pub struct SftpClientError(String);

#[derive(Clone, Copy, Debug)]
pub struct TransferProgress {
    pub transferred_bytes: u64,
    pub total_bytes: Option<u64>,
}

pub type DownloadProgress = TransferProgress;

impl SftpClientError {
    pub fn cancelled() -> Self {
        Self("transfer cancelled".to_string())
    }

    pub fn is_cancelled(&self) -> bool {
        self.0 == "transfer cancelled"
    }
}

impl Display for SftpClientError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl Error for SftpClientError {}

impl From<russh_sftp::client::error::Error> for SftpClientError {
    fn from(value: russh_sftp::client::error::Error) -> Self {
        Self(value.to_string())
    }
}

impl From<std::io::Error> for SftpClientError {
    fn from(value: std::io::Error) -> Self {
        Self(value.to_string())
    }
}

pub type SftpResult<T> = Result<T, SftpClientError>;

fn file_kind(file_type: FileType) -> RemoteFileKind {
    if file_type.is_dir() {
        RemoteFileKind::Directory
    } else if file_type.is_file() {
        RemoteFileKind::File
    } else {
        RemoteFileKind::Other
    }
}

fn format_size(size: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = size as f64;
    let mut unit_index = 0;

    while value >= 1024.0 && unit_index < UNITS.len() - 1 {
        value /= 1024.0;
        unit_index += 1;
    }

    if unit_index == 0 {
        format!("{size} B")
    } else {
        format!("{value:.1} {}", UNITS[unit_index])
    }
}

fn format_modified(mtime: Option<u32>) -> String {
    let Some(mtime) = mtime else {
        return "-".to_string();
    };

    let Some(datetime) = chrono::DateTime::from_timestamp(mtime as i64, 0) else {
        return "-".to_string();
    };

    datetime
        .with_timezone(&chrono::Local)
        .format("%Y-%m-%d %H:%M")
        .to_string()
}

fn format_mode(permissions: Option<u32>) -> String {
    permissions
        .map(|mode| format!("{:o}", mode & 0o7777))
        .unwrap_or_else(|| "-".to_string())
}
