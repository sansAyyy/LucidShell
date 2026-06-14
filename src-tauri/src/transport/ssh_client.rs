use std::error::Error;
use std::fmt::{Display, Formatter};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use russh::client;
use russh::keys::{load_secret_key, HashAlg, PrivateKeyWithHashAlg};
use russh::{ChannelMsg, Disconnect};
use russh_sftp::client::SftpSession;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::transport::sftp_client::SftpClient;

const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const DEFAULT_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(20);
const TERMINAL_WRITE_CHUNK_SIZE: usize = 4096;

#[derive(Clone, Debug)]
pub struct SshClientConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuthMethod,
    pub host_key_policy: HostKeyPolicy,
    pub connect_timeout: Duration,
    pub keepalive_interval: Duration,
}

impl SshClientConfig {
    pub fn new(
        host: impl Into<String>,
        port: u16,
        username: impl Into<String>,
        auth: SshAuthMethod,
    ) -> Self {
        Self {
            host: host.into(),
            port,
            username: username.into(),
            auth,
            host_key_policy: HostKeyPolicy::TrustOnFirstUse,
            connect_timeout: DEFAULT_CONNECT_TIMEOUT,
            keepalive_interval: DEFAULT_KEEPALIVE_INTERVAL,
        }
    }
}

#[derive(Clone, Debug)]
pub enum SshAuthMethod {
    Password {
        password: String,
    },
    PrivateKey {
        path: PathBuf,
        passphrase: Option<String>,
    },
}

#[derive(Clone, Debug)]
pub enum HostKeyPolicy {
    Sha256Fingerprints(Vec<String>),
    TrustOnFirstUse,
}

impl HostKeyPolicy {
    fn check(
        &self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, SshClientError> {
        let fingerprint = server_public_key.fingerprint(HashAlg::Sha256).to_string();
        match self {
            Self::Sha256Fingerprints(allowed) => {
                if allowed.iter().any(|item| item == &fingerprint) {
                    Ok(true)
                } else {
                    Err(SshClientError::HostKeyMismatch { fingerprint })
                }
            }
            Self::TrustOnFirstUse => Err(SshClientError::UnknownHostKey { fingerprint }),
        }
    }
}

#[derive(Clone, Debug)]
pub struct TerminalPtyConfig {
    pub term: String,
    pub cols: u32,
    pub rows: u32,
    pub width_px: u32,
    pub height_px: u32,
}

impl Default for TerminalPtyConfig {
    fn default() -> Self {
        Self {
            term: "xterm-256color".to_string(),
            cols: 80,
            rows: 24,
            width_px: 0,
            height_px: 0,
        }
    }
}

#[derive(Clone, Debug)]
pub struct TerminalSize {
    pub cols: u32,
    pub rows: u32,
    pub width_px: u32,
    pub height_px: u32,
}

impl From<&TerminalPtyConfig> for TerminalSize {
    fn from(value: &TerminalPtyConfig) -> Self {
        Self {
            cols: value.cols,
            rows: value.rows,
            width_px: value.width_px,
            height_px: value.height_px,
        }
    }
}

#[derive(Clone, Debug)]
pub enum SshTerminalEvent {
    Output(Vec<u8>),
    ExtendedOutput { ext: u32, data: Vec<u8> },
    Eof,
    ExitStatus(u32),
    Closed,
    Error(String),
}

#[derive(Debug)]
pub enum SshClientError {
    Russh(russh::Error),
    Key(String),
    Sftp(String),
    AuthenticationFailed,
    UnknownHostKey { fingerprint: String },
    HostKeyMismatch { fingerprint: String },
    ConnectTimeout,
    CommandChannelClosed,
}

impl Display for SshClientError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Russh(error) => write!(f, "{error}"),
            Self::Key(error) => write!(f, "{error}"),
            Self::Sftp(error) => write!(f, "{error}"),
            Self::AuthenticationFailed => write!(f, "SSH authentication failed"),
            Self::UnknownHostKey { fingerprint } => {
                write!(f, "UNKNOWN_HOST_KEY:{fingerprint}")
            }
            Self::HostKeyMismatch { fingerprint } => {
                write!(f, "HOST_KEY_MISMATCH:{fingerprint}")
            }
            Self::ConnectTimeout => write!(f, "SSH connection timed out"),
            Self::CommandChannelClosed => write!(f, "SSH terminal command channel is closed"),
        }
    }
}

impl Error for SshClientError {}

impl From<russh::Error> for SshClientError {
    fn from(value: russh::Error) -> Self {
        Self::Russh(value)
    }
}

impl From<russh::keys::Error> for SshClientError {
    fn from(value: russh::keys::Error) -> Self {
        Self::Key(value.to_string())
    }
}

pub type SshResult<T> = Result<T, SshClientError>;
pub type TerminalEventSender = mpsc::UnboundedSender<SshTerminalEvent>;

pub struct SshClient {
    session: client::Handle<RusshClientHandler>,
}

impl SshClient {
    pub async fn connect(config: SshClientConfig) -> SshResult<Self> {
        let client_config = client::Config {
            keepalive_interval: Some(config.keepalive_interval),
            nodelay: true,
            ..Default::default()
        };
        let handler = RusshClientHandler {
            host_key_policy: config.host_key_policy.clone(),
        };

        let mut session = tokio::time::timeout(
            config.connect_timeout,
            client::connect(
                Arc::new(client_config),
                (config.host.as_str(), config.port),
                handler,
            ),
        )
        .await
        .map_err(|_| SshClientError::ConnectTimeout)??;

        let auth_result = match &config.auth {
            SshAuthMethod::Password { password } => {
                session
                    .authenticate_password(config.username.clone(), password.clone())
                    .await?
            }
            SshAuthMethod::PrivateKey { path, passphrase } => {
                let key = load_secret_key(path, passphrase.as_deref())?;
                let rsa_hash = session.best_supported_rsa_hash().await?.flatten();
                session
                    .authenticate_publickey(
                        config.username.clone(),
                        PrivateKeyWithHashAlg::new(Arc::new(key), rsa_hash),
                    )
                    .await?
            }
        };

        if !auth_result.success() {
            return Err(SshClientError::AuthenticationFailed);
        }

        Ok(Self { session })
    }

    pub async fn open_terminal(
        &mut self,
        pty: TerminalPtyConfig,
        event_tx: TerminalEventSender,
    ) -> SshResult<SshTerminalChannel> {
        let channel = self.session.channel_open_session().await?;
        channel
            .request_pty(
                false,
                &pty.term,
                pty.cols,
                pty.rows,
                pty.width_px,
                pty.height_px,
                &[],
            )
            .await?;
        channel.request_shell(true).await?;

        let channel_id = channel.id().number();
        let (read_half, write_half) = channel.split();
        let (command_tx, command_rx) = mpsc::channel(128);
        let task = tokio::spawn(run_terminal_channel(
            read_half, write_half, command_rx, event_tx,
        ));

        Ok(SshTerminalChannel {
            id: channel_id,
            command_tx,
            task,
        })
    }

    pub async fn open_sftp(&mut self) -> SshResult<SftpClient> {
        let channel = self.session.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        let session = SftpSession::new(channel.into_stream())
            .await
            .map_err(|error| SshClientError::Sftp(error.to_string()))?;

        Ok(SftpClient::new(session))
    }

    pub async fn exec_command(&mut self, command: &str) -> SshResult<SshExecOutput> {
        let mut channel = self.session.channel_open_session().await?;
        channel.exec(true, command).await?;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_status = None;

        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                ChannelMsg::ExtendedData { data, .. } => stderr.extend_from_slice(&data),
                ChannelMsg::ExitStatus { exit_status: status } => exit_status = Some(status),
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }

        Ok(SshExecOutput {
            stdout: String::from_utf8_lossy(&stdout).to_string(),
            stderr: String::from_utf8_lossy(&stderr).to_string(),
            exit_status,
        })
    }

    pub async fn disconnect(&self) -> SshResult<()> {
        self.session
            .disconnect(Disconnect::ByApplication, "client disconnect", "en")
            .await?;
        Ok(())
    }

    pub fn is_closed(&self) -> bool {
        self.session.is_closed()
    }
}

pub struct SshExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_status: Option<u32>,
}

pub struct SshTerminalChannel {
    id: u32,
    command_tx: mpsc::Sender<TerminalCommand>,
    task: JoinHandle<()>,
}

impl SshTerminalChannel {
    pub fn id(&self) -> u32 {
        self.id
    }

    pub async fn write(&self, data: impl Into<Vec<u8>>) -> SshResult<()> {
        self.command_tx
            .send(TerminalCommand::Write(data.into()))
            .await
            .map_err(|_| SshClientError::CommandChannelClosed)
    }

    pub async fn resize(&self, size: TerminalSize) -> SshResult<()> {
        self.command_tx
            .send(TerminalCommand::Resize(size))
            .await
            .map_err(|_| SshClientError::CommandChannelClosed)
    }

    pub async fn close(self) -> SshResult<()> {
        let _ = self.command_tx.send(TerminalCommand::Close).await;
        let _ = self.task.await;
        Ok(())
    }
}

struct RusshClientHandler {
    host_key_policy: HostKeyPolicy,
}

impl client::Handler for RusshClientHandler {
    type Error = SshClientError;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        self.host_key_policy.check(server_public_key)
    }
}

enum TerminalCommand {
    Write(Vec<u8>),
    Resize(TerminalSize),
    Close,
}

async fn run_terminal_channel(
    mut read_half: russh::ChannelReadHalf,
    write_half: russh::ChannelWriteHalf<client::Msg>,
    mut command_rx: mpsc::Receiver<TerminalCommand>,
    event_tx: TerminalEventSender,
) {
    loop {
        tokio::select! {
            command = command_rx.recv() => {
                match command {
                    Some(TerminalCommand::Write(data)) => {
                        let mut write_failed = false;
                        for chunk in data.chunks(TERMINAL_WRITE_CHUNK_SIZE) {
                            if let Err(error) = write_half.data_bytes(chunk.to_vec()).await {
                                emit_terminal_error(&event_tx, error);
                                write_failed = true;
                                break;
                            }
                        }

                        if write_failed {
                            break;
                        }
                    }
                    Some(TerminalCommand::Resize(size)) => {
                        if let Err(error) = write_half
                            .window_change(size.cols, size.rows, size.width_px, size.height_px)
                            .await
                        {
                            emit_terminal_error(&event_tx, error);
                            break;
                        }
                    }
                    Some(TerminalCommand::Close) | None => {
                        let _ = write_half.close().await;
                        break;
                    }
                }
            }
            message = read_half.wait() => {
                match message {
                    Some(ChannelMsg::Data { data }) => {
                        let _ = event_tx.send(SshTerminalEvent::Output(data.to_vec()));
                    }
                    Some(ChannelMsg::ExtendedData { data, ext }) => {
                        let _ = event_tx.send(SshTerminalEvent::ExtendedOutput {
                            ext,
                            data: data.to_vec(),
                        });
                    }
                    Some(ChannelMsg::Eof) => {
                        let _ = event_tx.send(SshTerminalEvent::Eof);
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        let _ = event_tx.send(SshTerminalEvent::ExitStatus(exit_status));
                    }
                    Some(ChannelMsg::Close) | None => {
                        let _ = event_tx.send(SshTerminalEvent::Closed);
                        break;
                    }
                    Some(_) => {}
                }
            }
        }
    }
}

fn emit_terminal_error(event_tx: &TerminalEventSender, error: russh::Error) {
    let _ = event_tx.send(SshTerminalEvent::Error(error.to_string()));
}
