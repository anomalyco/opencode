//! Shared wire types for pencode: sessions, messages, events.
//!
//! Mirrors the shape of the original TypeScript protocol package so clients
//! and servers can evolve independently while staying compatible.

use serde::{Deserialize, Serialize};

pub type ID = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Part {
    Text { text: String },
    ToolUse { call_id: String, name: String },
    ToolResult { call_id: String, output: String },
}

impl Part {
    pub fn text(text: impl Into<String>) -> Self {
        Part::Text { text: text.into() }
    }

    pub fn as_text(&self) -> Option<&str> {
        match self {
            Part::Text { text } => Some(text),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: ID,
    pub role: Role,
    pub parts: Vec<Part>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl Message {
    pub fn new(role: Role, parts: Vec<Part>) -> Self {
        Message {
            id: new_id("msg"),
            role,
            parts,
            created_at: chrono::Utc::now(),
        }
    }

    /// Concatenation of all text parts, the canonical plain-text view.
    pub fn text(&self) -> String {
        self.parts
            .iter()
            .filter_map(Part::as_text)
            .collect::<Vec<_>>()
            .join("\n")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: ID,
    pub title: String,
    pub directory: String,
    pub messages: Vec<Message>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl Session {
    pub fn new(directory: impl Into<String>) -> Self {
        Session {
            id: new_id("ses"),
            title: "New session".to_string(),
            directory: directory.into(),
            messages: Vec::new(),
            created_at: chrono::Utc::now(),
        }
    }

    pub fn push(&mut self, message: Message) {
        if self.messages.is_empty() && message.role == Role::User {
            let text = message.text();
            if !text.is_empty() {
                self.title = text.chars().take(60).collect();
            }
        }
        self.messages.push(message);
    }
}

/// Server-sent event pushed to connected clients.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    SessionUpdated { session_id: ID },
    MessageAdded { session_id: ID, message: Message },
}

pub fn new_id(prefix: &str) -> ID {
    format!("{}_{}", prefix, uuid::Uuid::new_v4().simple())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_roundtrips_through_json() {
        let msg = Message::new(Role::User, vec![Part::text("hello"), Part::ToolUse { call_id: "c1".into(), name: "bash".into() }]);
        let json = serde_json::to_string(&msg).unwrap();
        let back: Message = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, msg.id);
        assert_eq!(back.text(), "hello");
    }

    #[test]
    fn session_title_from_first_user_message() {
        let mut ses = Session::new("/tmp");
        ses.push(Message::new(Role::User, vec![Part::text("fix the login bug please")]));
        assert_eq!(ses.title, "fix the login bug please");
    }
}
