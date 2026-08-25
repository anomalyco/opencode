//! HTTP client for the pencode server API.

use anyhow::Context;
use pencode_protocol::Session;

#[derive(Clone)]
pub struct Client {
    http: reqwest::Client,
    base_url: String,
}

impl Client {
    pub fn new(base_url: impl Into<String>) -> Self {
        Client {
            http: reqwest::Client::new(),
            base_url: base_url.into().trim_end_matches('/').to_string(),
        }
    }

    pub async fn health(&self) -> anyhow::Result<bool> {
        let url = format!("{}/health", self.base_url);
        let response = self.http.get(&url).send().await?;
        Ok(response.status().is_success())
    }

    pub async fn create_session(&self, directory: &str) -> anyhow::Result<Session> {
        let url = format!("{}/session", self.base_url);
        let session = self
            .http
            .post(&url)
            .json(&serde_json::json!({ "directory": directory }))
            .send()
            .await?
            .error_for_status()
            .with_context(|| "creating session")?
            .json()
            .await?;
        Ok(session)
    }

    pub async fn list_sessions(&self) -> anyhow::Result<Vec<Session>> {
        let url = format!("{}/session", self.base_url);
        let sessions = self
            .http
            .get(&url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(sessions)
    }

    pub async fn get_session(&self, id: &str) -> anyhow::Result<Session> {
        let url = format!("{}/session/{id}", self.base_url);
        let session = self
            .http
            .get(&url)
            .send()
            .await?
            .error_for_status()
            .with_context(|| format!("getting session {id}"))?
            .json()
            .await?;
        Ok(session)
    }

    /// Sends a user message to a session and returns the updated session.
    pub async fn send_message(&self, id: &str, text: &str) -> anyhow::Result<Session> {
        let url = format!("{}/session/{id}/message", self.base_url);
        let session = self
            .http
            .post(&url)
            .json(&serde_json::json!({ "text": text }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        Ok(session)
    }
}
