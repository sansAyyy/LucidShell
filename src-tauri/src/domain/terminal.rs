use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalStatus {
    Opening,
    Open,
    Closed,
    Error,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSession {
    pub id: String,
    pub server_session_id: String,
    pub title: String,
    pub cwd: String,
    pub status: TerminalStatus,
    pub error: Option<String>,
}
