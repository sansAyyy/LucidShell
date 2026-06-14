use std::collections::HashMap;
use std::env;
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::path::PathBuf;
use std::sync::Arc;

use crate::dto::commands::{ConnectAuthType, ConnectServerPayload};
use crate::transport::sftp_client::{RemoteDirectory, SftpClient, SftpClientError};
use crate::transport::ssh_client::{
    HostKeyPolicy, SshAuthMethod, SshClient, SshClientConfig, SshClientError, SshTerminalChannel,
    SshExecOutput, TerminalEventSender, TerminalPtyConfig, TerminalSize,
};

#[derive(Default)]
pub struct SshPool {
    clients: HashMap<String, SshClient>,
    sftp_clients: HashMap<String, Arc<SftpClient>>,
    terminals: HashMap<String, PooledTerminal>,
}

impl SshPool {
    pub async fn connect_server(
        &mut self,
        session_id: String,
        payload: &ConnectServerPayload,
    ) -> Result<(), SshPoolError> {
        let client = Self::connect_client(payload).await?;
        self.insert_client(session_id, client);
        Ok(())
    }

    pub async fn connect_client(payload: &ConnectServerPayload) -> Result<SshClient, SshPoolError> {
        let config = ssh_config_from_payload(payload)?;
        SshClient::connect(config).await.map_err(SshPoolError::from)
    }

    pub fn insert_client(&mut self, session_id: String, client: SshClient) {
        self.clients.insert(session_id, client);
    }

    pub async fn disconnect_server(
        &mut self,
        session_id: &str,
    ) -> Result<Vec<String>, SshPoolError> {
        let terminal_ids = self
            .terminals
            .iter()
            .filter_map(|(terminal_id, terminal)| {
                (terminal.server_session_id == session_id).then(|| terminal_id.clone())
            })
            .collect::<Vec<_>>();

        for terminal_id in &terminal_ids {
            self.close_terminal(terminal_id).await?;
        }

        if let Some(client) = self.clients.remove(session_id) {
            client.disconnect().await?;
        }

        if let Some(sftp) = self.sftp_clients.remove(session_id) {
            let _ = sftp.close().await;
        }

        Ok(terminal_ids)
    }

    pub async fn disconnect_all(&mut self) {
        let terminal_ids = self.terminals.keys().cloned().collect::<Vec<_>>();

        for terminal_id in terminal_ids {
            let _ = self.close_terminal(&terminal_id).await;
        }

        let sftp_clients = self.sftp_clients.drain().map(|(_, sftp)| sftp).collect::<Vec<_>>();
        for sftp in sftp_clients {
            let _ = sftp.close().await;
        }

        let clients = self.clients.drain().map(|(_, client)| client).collect::<Vec<_>>();
        for client in clients {
            let _ = client.disconnect().await;
        }
    }

    pub async fn open_terminal(
        &mut self,
        server_session_id: &str,
        terminal_id: String,
        pty: TerminalPtyConfig,
        event_tx: TerminalEventSender,
    ) -> Result<(), SshPoolError> {
        let client = self
            .clients
            .get_mut(server_session_id)
            .ok_or_else(|| SshPoolError::ServerSessionNotFound(server_session_id.to_string()))?;

        let channel = client.open_terminal(pty, event_tx).await?;
        self.terminals.insert(
            terminal_id,
            PooledTerminal {
                server_session_id: server_session_id.to_string(),
                channel,
            },
        );

        Ok(())
    }

    pub async fn write_terminal(
        &self,
        terminal_id: &str,
        data: impl Into<Vec<u8>>,
    ) -> Result<(), SshPoolError> {
        let terminal = self
            .terminals
            .get(terminal_id)
            .ok_or_else(|| SshPoolError::TerminalSessionNotFound(terminal_id.to_string()))?;

        terminal.channel.write(data).await?;
        Ok(())
    }

    pub async fn resize_terminal(
        &self,
        terminal_id: &str,
        size: TerminalSize,
    ) -> Result<(), SshPoolError> {
        let terminal = self
            .terminals
            .get(terminal_id)
            .ok_or_else(|| SshPoolError::TerminalSessionNotFound(terminal_id.to_string()))?;

        terminal.channel.resize(size).await?;
        Ok(())
    }

    pub async fn list_sftp_directory(
        &mut self,
        server_session_id: &str,
        path: &str,
    ) -> Result<RemoteDirectory, SshPoolError> {
        self.ensure_sftp_client(server_session_id).await?;
        let sftp = self
            .sftp_clients
            .get(server_session_id)
            .cloned()
            .ok_or_else(|| SshPoolError::ServerSessionNotFound(server_session_id.to_string()))?;

        sftp.list_directory(path).await.map_err(SshPoolError::Sftp)
    }

    pub async fn sftp_client(
        &mut self,
        server_session_id: &str,
    ) -> Result<Arc<SftpClient>, SshPoolError> {
        self.ensure_sftp_client(server_session_id).await?;
        self.sftp_clients
            .get(server_session_id)
            .cloned()
            .ok_or_else(|| SshPoolError::ServerSessionNotFound(server_session_id.to_string()))
    }

    pub async fn exec_command(
        &mut self,
        server_session_id: &str,
        command: &str,
    ) -> Result<SshExecOutput, SshPoolError> {
        let client = self
            .clients
            .get_mut(server_session_id)
            .ok_or_else(|| SshPoolError::ServerSessionNotFound(server_session_id.to_string()))?;

        client.exec_command(command).await.map_err(SshPoolError::from)
    }

    pub fn is_session_closed(&self, server_session_id: &str) -> Result<bool, SshPoolError> {
        let client = self
            .clients
            .get(server_session_id)
            .ok_or_else(|| SshPoolError::ServerSessionNotFound(server_session_id.to_string()))?;

        Ok(client.is_closed())
    }

    pub async fn close_terminal(&mut self, terminal_id: &str) -> Result<(), SshPoolError> {
        if let Some(terminal) = self.terminals.remove(terminal_id) {
            terminal.channel.close().await?;
        }

        Ok(())
    }
}

impl SshPool {
    async fn ensure_sftp_client(&mut self, server_session_id: &str) -> Result<(), SshPoolError> {
        if self.sftp_clients.contains_key(server_session_id) {
            return Ok(());
        }

        let client = self
            .clients
            .get_mut(server_session_id)
            .ok_or_else(|| SshPoolError::ServerSessionNotFound(server_session_id.to_string()))?;
        let sftp = client.open_sftp().await?;
        self.sftp_clients
            .insert(server_session_id.to_string(), Arc::new(sftp));
        Ok(())
    }
}

struct PooledTerminal {
    server_session_id: String,
    channel: SshTerminalChannel,
}

#[derive(Debug)]
pub enum SshPoolError {
    Client(SshClientError),
    Sftp(SftpClientError),
    InvalidAuth(String),
    ServerSessionNotFound(String),
    TerminalSessionNotFound(String),
}

impl Display for SshPoolError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Client(error) => write!(f, "{error}"),
            Self::Sftp(error) => write!(f, "{error}"),
            Self::InvalidAuth(error) => write!(f, "{error}"),
            Self::ServerSessionNotFound(session_id) => {
                write!(f, "SSH server session not found: {session_id}")
            }
            Self::TerminalSessionNotFound(terminal_id) => {
                write!(f, "SSH terminal session not found: {terminal_id}")
            }
        }
    }
}

impl Error for SshPoolError {}

impl From<SshClientError> for SshPoolError {
    fn from(value: SshClientError) -> Self {
        Self::Client(value)
    }
}

fn ssh_config_from_payload(
    payload: &ConnectServerPayload,
) -> Result<SshClientConfig, SshPoolError> {
    let auth = match payload.auth_type {
        ConnectAuthType::Password => {
            let password = payload
                .password
                .clone()
                .ok_or_else(|| SshPoolError::InvalidAuth("password is required".to_string()))?;
            SshAuthMethod::Password { password }
        }
        ConnectAuthType::PrivateKey => {
            let path = payload
                .private_key_path
                .as_deref()
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .ok_or_else(|| {
                    SshPoolError::InvalidAuth("private key path is required".to_string())
                })?;

            SshAuthMethod::PrivateKey {
                path: expand_home_path(path),
                passphrase: payload.password.clone(),
            }
        }
    };

    let mut config = SshClientConfig::new(&payload.host, payload.port, &payload.user, auth);
    config.host_key_policy = if let Some(fingerprint) = payload
        .host_key_fingerprint
        .as_deref()
        .map(str::trim)
        .filter(|fingerprint| !fingerprint.is_empty())
    {
        HostKeyPolicy::Sha256Fingerprints(vec![fingerprint.to_string()])
    } else {
        HostKeyPolicy::TrustOnFirstUse
    };
    Ok(config)
}

fn expand_home_path(path: &str) -> PathBuf {
    if path == "~" {
        return home_dir().unwrap_or_else(|| PathBuf::from(path));
    }

    if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        if let Some(home) = home_dir() {
            return home.join(rest);
        }
    }

    PathBuf::from(path)
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}
