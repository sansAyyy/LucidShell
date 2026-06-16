use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::domain::server::{ServerAuthType, ServerProfile, ServerSession, ServerSessionStatus};
use crate::domain::terminal::{TerminalSession, TerminalStatus};
use crate::dto::commands::{
    ConnectAuthType, ConnectServerPayload, OpenTerminalTabPayload, ServerSessionDto,
    ServerMonitorDto, TerminalSessionDto,
};
use crate::transport::sftp_client::{RemoteDirectory, SftpClient};
use crate::transport::ssh_client::{SshClient, TerminalEventSender, TerminalPtyConfig, TerminalSize};
use crate::transport::ssh_pool::SshPool;

#[derive(Default)]
pub struct SessionManager {
    sessions: HashMap<String, ServerSession>,
    terminals: HashMap<String, TerminalSession>,
    ssh_pool: SshPool,
}

impl SessionManager {
    pub async fn connect_server(&mut self, payload: ConnectServerPayload) -> ServerSession {
        let session = self.prepare_connect_server(&payload);
        match self
            .ssh_pool
            .connect_server(session.id.clone(), &payload)
            .await
        {
            Ok(()) => self.finish_connect_server(&session.id, Ok(())),
            Err(error) => self.finish_connect_server(&session.id, Err(error.to_string())),
        }
    }

    pub fn prepare_connect_server(&mut self, payload: &ConnectServerPayload) -> ServerSession {
        let session_id = format!("session-{}-{}", payload.profile_id, now_millis());
        let session = ServerSession {
            id: session_id.clone(),
            profile: profile_from_payload(payload),
            status: ServerSessionStatus::Connecting,
            error: None,
        };

        self.sessions.insert(session_id, session.clone());
        session
    }

    pub fn finish_connect_server(
        &mut self,
        session_id: &str,
        result: Result<(), String>,
    ) -> ServerSession {
        let session = self.sessions.get_mut(session_id).expect("server session exists");

        match result {
            Ok(()) => {
                session.status = ServerSessionStatus::Connected;
                session.error = None;
            }
            Err(error) => {
                session.status = ServerSessionStatus::Error;
                session.error = Some(error);
            }
        }

        session.clone()
    }

    pub fn attach_connected_client(&mut self, session_id: String, client: SshClient) {
        self.ssh_pool.insert_client(session_id, client);
    }

    pub async fn disconnect_server(&mut self, session_id: &str) -> Option<ServerSession> {
        let pool_result = self.ssh_pool.disconnect_server(session_id).await;
        if let Ok(terminal_ids) = &pool_result {
            for terminal_id in terminal_ids {
                if let Some(terminal) = self.terminals.get_mut(terminal_id) {
                    terminal.status = TerminalStatus::Closed;
                }
            }
        }

        let session = self.sessions.get_mut(session_id)?;
        match pool_result {
            Ok(_) => {
                session.status = ServerSessionStatus::Disconnected;
                session.error = None;
            }
            Err(error) => {
                session.status = ServerSessionStatus::Error;
                session.error = Some(error.to_string());
            }
        }

        Some(session.clone())
    }

    pub async fn disconnect_all(&mut self) {
        self.ssh_pool.disconnect_all().await;

        for terminal in self.terminals.values_mut() {
            terminal.status = TerminalStatus::Closed;
            terminal.error = None;
        }

        for session in self.sessions.values_mut() {
            session.status = ServerSessionStatus::Disconnected;
            session.error = None;
        }
    }

    pub fn list_sessions(&self) -> Vec<ServerSession> {
        self.sessions.values().cloned().collect()
    }

    pub async fn open_terminal_tab(
        &mut self,
        payload: OpenTerminalTabPayload,
        event_tx: TerminalEventSender,
    ) -> Result<TerminalSession, String> {
        let server_session = self
            .sessions
            .get(&payload.server_session_id)
            .ok_or_else(|| "server session not found".to_string())?;

        if !matches!(server_session.status, ServerSessionStatus::Connected) {
            return Err(server_session
                .error
                .clone()
                .unwrap_or_else(|| "server session is not connected".to_string()));
        }

        let terminal_id = format!("terminal-{}-{}", payload.server_session_id, now_millis());
        let cwd = payload
            .cwd
            .unwrap_or_else(|| format!("/home/{}", server_session.profile.user));
        let terminal = TerminalSession {
            id: terminal_id.clone(),
            server_session_id: payload.server_session_id,
            title: payload.title.unwrap_or_else(|| "shell".to_string()),
            cwd,
            status: TerminalStatus::Opening,
            error: None,
        };

        self.terminals.insert(terminal_id.clone(), terminal.clone());

        let mut terminal = terminal;
        match self
            .ssh_pool
            .open_terminal(
                &terminal.server_session_id,
                terminal_id.clone(),
                TerminalPtyConfig::default(),
                event_tx,
            )
            .await
        {
            Ok(()) => {
                terminal.status = TerminalStatus::Open;
                terminal.error = None;
                self.terminals.insert(terminal_id, terminal.clone());
                Ok(terminal)
            }
            Err(error) => {
                terminal.status = TerminalStatus::Error;
                terminal.error = Some(error.to_string());
                self.terminals.insert(terminal_id, terminal);
                Err(error.to_string())
            }
        }
    }

    pub async fn terminal_write(&self, terminal_id: &str, data: String) -> Result<(), String> {
        if !self.terminals.contains_key(terminal_id) {
            return Err("terminal session not found".to_string());
        }

        self.ssh_pool
            .write_terminal(terminal_id, data.into_bytes())
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn terminal_resize(
        &self,
        terminal_id: &str,
        size: TerminalSize,
    ) -> Result<(), String> {
        if !self.terminals.contains_key(terminal_id) {
            return Err("terminal session not found".to_string());
        }

        self.ssh_pool
            .resize_terminal(terminal_id, size)
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn close_terminal_tab(&mut self, terminal_id: &str) -> Option<TerminalSession> {
        let close_result = self.ssh_pool.close_terminal(terminal_id).await;
        let terminal = self.terminals.get_mut(terminal_id)?;
        terminal.status = TerminalStatus::Closed;
        if let Err(error) = close_result {
            terminal.status = TerminalStatus::Error;
            terminal.error = Some(error.to_string());
        }
        Some(terminal.clone())
    }

    pub fn get_terminal(&self, terminal_id: &str) -> Option<TerminalSession> {
        self.terminals.get(terminal_id).cloned()
    }

    pub async fn list_sftp_directory(
        &mut self,
        server_session_id: &str,
        path: &str,
    ) -> Result<RemoteDirectory, String> {
        let server_session = self
            .sessions
            .get(server_session_id)
            .ok_or_else(|| "server session not found".to_string())?;

        if !matches!(server_session.status, ServerSessionStatus::Connected) {
            return Err(server_session
                .error
                .clone()
                .unwrap_or_else(|| "server session is not connected".to_string()));
        }

        self.ssh_pool
            .list_sftp_directory(server_session_id, path)
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn sftp_client_for_download(
        &mut self,
        server_session_id: &str,
    ) -> Result<Arc<SftpClient>, String> {
        let server_session = self
            .sessions
            .get(server_session_id)
            .ok_or_else(|| "server session not found".to_string())?;

        if !matches!(server_session.status, ServerSessionStatus::Connected) {
            return Err(server_session
                .error
                .clone()
                .unwrap_or_else(|| "server session is not connected".to_string()));
        }

        self.ssh_pool
            .sftp_client(server_session_id)
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn read_server_monitor(
        &mut self,
        server_session_id: &str,
    ) -> Result<ServerMonitorDto, String> {
        let server_session = self
            .sessions
            .get(server_session_id)
            .ok_or_else(|| "server session not found".to_string())?;

        if !matches!(server_session.status, ServerSessionStatus::Connected) {
            return Err(server_session
                .error
                .clone()
                .unwrap_or_else(|| "server session is not connected".to_string()));
        }

        let output = tokio::time::timeout(
            Duration::from_secs(4),
            self.ssh_pool.exec_command(server_session_id, MONITOR_COMMAND),
        )
        .await
        .map_err(|_| "monitor command timed out".to_string())?
        .map_err(|error| error.to_string())?;

        if output.exit_status.unwrap_or_default() != 0 {
            return Ok(ServerMonitorDto {
                cpu: None,
                memory: None,
                disk: None,
                load: None,
                uptime: None,
                error: Some(output.stderr.trim().to_string()),
            });
        }

        Ok(parse_monitor_output(&output.stdout))
    }

    pub async fn read_login_shell(&mut self, server_session_id: &str) -> Result<String, String> {
        let server_session = self
            .sessions
            .get(server_session_id)
            .ok_or_else(|| "server session not found".to_string())?;

        if !matches!(server_session.status, ServerSessionStatus::Connected) {
            return Err(server_session
                .error
                .clone()
                .unwrap_or_else(|| "server session is not connected".to_string()));
        }

        let output = tokio::time::timeout(
            Duration::from_secs(4),
            self.ssh_pool
                .exec_command(server_session_id, READ_LOGIN_SHELL_COMMAND),
        )
        .await
        .map_err(|_| "read login shell command timed out".to_string())?
        .map_err(|error| error.to_string())?;

        if output.exit_status.unwrap_or_default() != 0 {
            return Err(output.stderr.trim().to_string());
        }

        Ok(output.stdout.trim().to_string())
    }

    pub async fn check_server_session_health(
        &mut self,
        server_session_id: &str,
    ) -> Result<ServerSession, String> {
        let server_session = self
            .sessions
            .get(server_session_id)
            .ok_or_else(|| "server session not found".to_string())?;

        if !matches!(server_session.status, ServerSessionStatus::Connected) {
            return Err(server_session
                .error
                .clone()
                .unwrap_or_else(|| "server session is not connected".to_string()));
        }

        match self.ssh_pool.is_session_closed(server_session_id) {
            Ok(false) => {}
            Ok(true) => {
                return self
                    .mark_server_session_error(
                        server_session_id,
                        "connection health check failed: SSH session is closed".to_string(),
                    )
                    .await;
            }
            Err(error) => {
                return self
                    .mark_server_session_error(server_session_id, error.to_string())
                    .await;
            }
        }

        match tokio::time::timeout(
            HEALTH_CHECK_TIMEOUT,
            self.ssh_pool
                .exec_command(server_session_id, HEALTH_CHECK_COMMAND),
        )
        .await
        {
            Ok(Ok(output)) if output.exit_status.unwrap_or_default() == 0 => self
                .sessions
                .get(server_session_id)
                .cloned()
                .ok_or_else(|| "server session not found".to_string()),
            Ok(Ok(output)) => {
                let message = health_check_command_error(output.stderr.trim(), output.exit_status);
                self.mark_server_session_error(server_session_id, message).await
            }
            Ok(Err(error)) => {
                self.mark_server_session_error(
                    server_session_id,
                    format!("connection health check failed: {error}"),
                )
                .await
            }
            Err(_) => {
                self.mark_server_session_error(
                    server_session_id,
                    "connection health check timed out".to_string(),
                )
                .await
            }
        }
    }

    async fn mark_server_session_error(
        &mut self,
        server_session_id: &str,
        error: String,
    ) -> Result<ServerSession, String> {
        let _ = self.ssh_pool.disconnect_server(server_session_id).await;

        for terminal in self
            .terminals
            .values_mut()
            .filter(|terminal| terminal.server_session_id == server_session_id)
        {
            terminal.status = TerminalStatus::Closed;
            terminal.error = Some(error.clone());
        }

        let session = self
            .sessions
            .get_mut(server_session_id)
            .ok_or_else(|| "server session not found".to_string())?;
        session.status = ServerSessionStatus::Error;
        session.error = Some(error);

        Ok(session.clone())
    }
}

const MONITOR_COMMAND: &str = r#"sh -lc 'read cpu user nice system idle iowait irq softirq steal guest guest_nice < /proc/stat; total=$((user+nice+system+idle+iowait+irq+softirq+steal)); busy=$((total-idle-iowait)); cpu_pct=0; if [ "$total" -gt 0 ]; then cpu_pct=$((busy*100/total)); fi; mem_pct=$(free | awk "/Mem:/ { if (\$2 > 0) printf \"%d\", (\$3 * 100 / \$2); else printf \"0\" }"); disk_pct=$(df -P / | awk "NR==2 { gsub(/%/, \"\", \$5); print \$5 }"); load_avg=$(cut -d" " -f1 /proc/loadavg 2>/dev/null || echo "-"); uptime_text=$(uptime -p 2>/dev/null | sed "s/^up //" || echo "-"); printf "%s|%s|%s|%s|%s\n" "$cpu_pct" "$mem_pct" "$disk_pct" "$load_avg" "$uptime_text"'"#;
const READ_LOGIN_SHELL_COMMAND: &str = r#"printf "%s\n" "$SHELL""#;
const HEALTH_CHECK_COMMAND: &str = r#"printf "lucidshell-health-ok\n""#;
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(5);

pub fn session_to_dto(session: &ServerSession) -> ServerSessionDto {
    ServerSessionDto {
        id: session.id.clone(),
        profile_id: session.profile.id.clone(),
        name: session.profile.name.clone(),
        host: session.profile.host.clone(),
        port: session.profile.port,
        user: session.profile.user.clone(),
        status: status_to_string(&session.status),
        error: session.error.clone(),
    }
}

pub fn status_to_string(status: &ServerSessionStatus) -> String {
    match status {
        ServerSessionStatus::Connecting => "connecting",
        ServerSessionStatus::Connected => "connected",
        ServerSessionStatus::Disconnecting => "disconnecting",
        ServerSessionStatus::Disconnected => "disconnected",
        ServerSessionStatus::Error => "error",
    }
    .to_string()
}

pub fn terminal_to_dto(terminal: &TerminalSession) -> TerminalSessionDto {
    TerminalSessionDto {
        id: terminal.id.clone(),
        server_session_id: terminal.server_session_id.clone(),
        title: terminal.title.clone(),
        cwd: terminal.cwd.clone(),
        status: terminal_status_to_string(&terminal.status),
        error: terminal.error.clone(),
    }
}

pub fn terminal_status_to_string(status: &TerminalStatus) -> String {
    match status {
        TerminalStatus::Opening => "opening",
        TerminalStatus::Open => "open",
        TerminalStatus::Closed => "closed",
        TerminalStatus::Error => "error",
    }
    .to_string()
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn profile_from_payload(payload: &ConnectServerPayload) -> ServerProfile {
    ServerProfile {
        id: payload.profile_id.clone(),
        name: payload.name.clone(),
        host: payload.host.clone(),
        port: payload.port,
        user: payload.user.clone(),
        auth_type: match payload.auth_type {
            ConnectAuthType::Password => ServerAuthType::Password,
            ConnectAuthType::PrivateKey => ServerAuthType::PrivateKey,
        },
    }
}

fn parse_monitor_output(output: &str) -> ServerMonitorDto {
    let mut parts = output.trim().splitn(5, '|');
    let cpu = parse_percent(parts.next());
    let memory = parse_percent(parts.next());
    let disk = parse_percent(parts.next());
    let load = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "-")
        .map(ToString::to_string);
    let uptime = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "-")
        .map(ToString::to_string);

    ServerMonitorDto {
        cpu,
        memory,
        disk,
        load,
        uptime,
        error: None,
    }
}

fn parse_percent(value: Option<&str>) -> Option<u8> {
    value
        .and_then(|value| value.trim().parse::<u8>().ok())
        .map(|value| value.min(100))
}

fn health_check_command_error(stderr: &str, exit_status: Option<u32>) -> String {
    let status = exit_status
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown".to_string());

    if stderr.is_empty() {
        format!("connection health check failed with exit status {status}")
    } else {
        format!("connection health check failed with exit status {status}: {stderr}")
    }
}
