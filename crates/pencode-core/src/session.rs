use anyhow::Context;
use pencode_protocol::{Message, Session};
use std::path::PathBuf;

/// Durable session storage: one JSON file per session under `<root>/session/`.
#[derive(Debug, Clone)]
pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn open(root: impl Into<PathBuf>) -> anyhow::Result<Self> {
        let root = root.into();
        std::fs::create_dir_all(root.join("session"))
            .with_context(|| format!("creating {}", root.join("session").display()))?;
        Ok(Store { root })
    }

    fn path_for(&self, id: &str) -> PathBuf {
        self.root.join("session").join(format!("{id}.json"))
    }

    pub fn create(&self, directory: &str) -> anyhow::Result<Session> {
        let session = Session::new(directory);
        self.save(&session)?;
        Ok(session)
    }

    pub fn save(&self, session: &Session) -> anyhow::Result<()> {
        let raw = serde_json::to_string_pretty(session)?;
        std::fs::write(self.path_for(&session.id), raw)?;
        Ok(())
    }

    pub fn get(&self, id: &str) -> anyhow::Result<Session> {
        let raw = std::fs::read_to_string(self.path_for(id))
            .with_context(|| format!("loading session {id}"))?;
        serde_json::from_str(&raw).with_context(|| format!("parsing session {id}"))
    }

    pub fn list(&self) -> anyhow::Result<Vec<Session>> {
        let mut sessions = Vec::new();
        let dir = self.root.join("session");
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            if entry.path().extension().is_some_and(|ext| ext == "json") {
                let raw = std::fs::read_to_string(entry.path())?;
                if let Ok(session) = serde_json::from_str::<Session>(&raw) {
                    sessions.push(session);
                }
            }
        }
        sessions.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(sessions)
    }

    pub fn remove(&self, id: &str) -> anyhow::Result<()> {
        std::fs::remove_file(self.path_for(id))
            .with_context(|| format!("removing session {id}"))
    }

    /// Appends a message and persists the session in one step.
    pub fn append(&self, session_id: &str, message: Message) -> anyhow::Result<Session> {
        let mut session = self.get(session_id)?;
        session.push(message);
        self.save(&session)?;
        Ok(session)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pencode_protocol::{Part, Role};

    #[test]
    fn create_append_roundtrip() -> anyhow::Result<()> {
        let tmp = std::env::temp_dir().join(format!("pencode-test-{}", std::process::id()));
        let store = Store::open(&tmp)?;
        let ses = store.create("/tmp/project")?;

        store.append(
            &ses.id,
            Message::new(Role::User, vec![Part::text("hello world")]),
        )?;

        let loaded = store.get(&ses.id)?;
        assert_eq!(loaded.messages.len(), 1);
        assert_eq!(loaded.title, "hello world");

        let listed = store.list()?;
        assert_eq!(listed.len(), 1);
        std::fs::remove_dir_all(tmp).ok();
        Ok(())
    }
}
