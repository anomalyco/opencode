//! PTY handoff (F.9).
//!
//! Ports `packages/client/src/pty-handoff.ts`. Before a service stops for a restart, its persistent
//! terminals are published in a sidecar, `<registration>.pty-handoff`, so the next service adopts
//! them through `OPENCODE_PTY_HANDOFF`. Every step is best effort: a failure stops the service
//! without a handoff.

use opencode_api::transport::Transport;
use opencode_local::registration::Registration;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::probe::Endpoint;

/// How long a sidecar without terminals stays valid.
const EMPTY_TTL_MS: f64 = 30_000.0;

/// The sidecar of a registration file.
pub fn sidecar(file: &Path) -> PathBuf {
    let mut name = file.as_os_str().to_owned();
    name.push(".pty-handoff");
    PathBuf::from(name)
}

/// Publishes the terminals of the service in `info` before it is stopped. Never fails.
pub async fn prepare(transport: Arc<dyn Transport>, file: &Path, info: &Registration, timeout: Duration) {
    if read(file).is_some_and(|existing| existing.current() && existing.from(info)) {
        return;
    }
    let Ok(client) = Endpoint::new(&info.url, info.password.clone()).client(transport) else {
        return;
    };
    let handoff = match tokio::time::timeout(timeout, client.experimental_persistent_pty_handoff()).await {
        Ok(Ok(output)) => match output.handoff {
            None => Ok(Value::Null),
            Some(handoff) if handoff.expires_at > now_ms() => Ok(json!({
                "directory": handoff.directory,
                "instanceID": handoff.instance_id,
                "ticket": handoff.ticket,
                "expiresAt": number(handoff.expires_at),
            })),
            Some(_) => Err("Invalid or expired persistent terminal handoff".to_owned()),
        },
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err("The operation timed out.".to_owned()),
    };
    let handoff = match handoff {
        Ok(handoff) => handoff,
        Err(cause) => {
            // Another caller may already have prepared and stopped this server.
            if read(file).is_some_and(|concurrent| concurrent.current() && concurrent.from(info)) {
                return;
            }
            eprintln!(
                "Background service cannot hand off persistent terminals; shutting them down before replacement: {cause}"
            );
            let _ = tokio::time::timeout(timeout, client.experimental_persistent_pty_shutdown()).await;
            Value::Null
        }
    };
    if let Err(cause) = publish(file, info, handoff) {
        eprintln!("Failed to publish persistent terminal handoff: {cause}");
    }
}

/// `OPENCODE_PTY_HANDOFF` for a new service: the published handoff when it is current and belongs
/// to the registered service (or none is registered), else unset.
pub fn environment(file: &Path) -> (String, Option<String>) {
    let current: Option<Value> = std::fs::read_to_string(file).ok().and_then(|text| serde_json::from_str(&text).ok());
    let handoff = read(file)
        .filter(|record| record.current())
        .filter(|record| current.as_ref().is_none_or(|current| record.matches(current)))
        .map(|record| record.handoff)
        .filter(|handoff| !handoff.is_null())
        .map(|handoff| handoff.to_string());
    ("OPENCODE_PTY_HANDOFF".to_owned(), handoff)
}

/// Clears a sidecar that belongs to another service than `info`, once `info` is in use.
pub fn complete(file: &Path, info: &Registration) {
    if read(file).is_some_and(|record| !record.from(info)) {
        clear(file);
    }
}

pub fn clear(file: &Path) {
    let _ = std::fs::remove_file(sidecar(file));
}

struct Sidecar {
    id: Option<String>,
    pid: f64,
    url: String,
    handoff: Value,
    expires_at: f64,
}

impl Sidecar {
    fn current(&self) -> bool {
        self.expires_at > now_ms()
    }

    fn from(&self, info: &Registration) -> bool {
        self.id == info.id && self.pid == f64::from(info.pid) && self.url == info.url
    }

    // `same` against whatever JSON the registration file holds.
    fn matches(&self, current: &Value) -> bool {
        current.get("id").and_then(Value::as_str) == self.id.as_deref()
            && current.get("pid").and_then(Value::as_f64) == Some(self.pid)
            && current.get("url").and_then(Value::as_str) == Some(self.url.as_str())
    }
}

fn read(file: &Path) -> Option<Sidecar> {
    let value: Value = serde_json::from_str(&std::fs::read_to_string(sidecar(file)).ok()?).ok()?;
    let source = value.get("source")?.as_object()?;
    let id = match source.get("id") {
        None => None,
        Some(id) => Some(id.as_str()?.to_owned()),
    };
    let handoff = value.get("handoff")?.clone();
    if !handoff.is_null() && !is_handoff(&handoff) {
        return None;
    }
    Some(Sidecar {
        id,
        pid: source.get("pid")?.as_f64()?,
        url: source.get("url")?.as_str()?.to_owned(),
        handoff,
        expires_at: value.get("expiresAt")?.as_f64().filter(|at| at.is_finite())?,
    })
}

fn is_handoff(value: &Value) -> bool {
    ["directory", "instanceID", "ticket"].iter().all(|key| value.get(key).is_some_and(Value::is_string))
        && value.get("expiresAt").and_then(Value::as_f64).is_some_and(f64::is_finite)
}

fn publish(file: &Path, info: &Registration, handoff: Value) -> std::io::Result<()> {
    let expires_at = handoff.get("expiresAt").and_then(Value::as_f64).unwrap_or_else(|| now_ms() + EMPTY_TTL_MS);
    let mut source = serde_json::Map::new();
    if let Some(id) = &info.id {
        source.insert("id".to_owned(), json!(id));
    }
    source.insert("pid".to_owned(), json!(info.pid));
    source.insert("url".to_owned(), json!(info.url));
    let text = json!({ "source": source, "handoff": handoff, "expiresAt": number(expires_at) }).to_string();
    let mut temporary = sidecar(file).into_os_string();
    temporary.push(format!(".{}.tmp", opencode_local::id::v4()));
    let temporary = PathBuf::from(temporary);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let result = std::io::Write::write_all(&mut options.open(&temporary)?, text.as_bytes())
        .and_then(|()| std::fs::rename(&temporary, sidecar(file)));
    let _ = std::fs::remove_file(&temporary);
    result
}

// A whole number as JSON.stringify writes it, without `.0`.
fn number(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
        return json!(value as i64);
    }
    json!(value)
}

fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0.0, |elapsed| elapsed.as_secs_f64() * 1000.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{Reply, Server};

    fn info(pid: u32) -> Registration {
        Registration {
            id: Some("a".to_owned()),
            version: Some("test".to_owned()),
            url: "http://127.0.0.1:4096".to_owned(),
            pid,
            password: Some("private".to_owned()),
        }
    }

    const HANDOFF_URL: &str = "http://127.0.0.1:4096/api/experimental/persistent-pty/handoff";
    const SHUTDOWN_URL: &str = "http://127.0.0.1:4096/api/experimental/persistent-pty/shutdown";

    fn handoff_body() -> &'static str {
        let body = format!(
            r#"{{"handoff":{{"directory":"/d","instanceID":"i","ticket":"t","expiresAt":{}}}}}"#,
            now_ms() + 60_000.0
        );
        Box::leak(body.into_boxed_str())
    }

    #[tokio::test]
    async fn a_prepared_handoff_reaches_the_next_service_and_is_cleared_after_it() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("service.json");
        std::fs::write(&file, serde_json::to_string(&info(9)).unwrap()).unwrap();
        let server = Arc::new(Server::default().reply(HANDOFF_URL, Reply::json(200, handoff_body())));
        prepare(server.clone(), &file, &info(9), Duration::from_secs(1)).await;
        assert!(server.requests()[0].1.is_some(), "Basic auth sent");
        // The old service is still registered: the handoff is for its successor.
        let (name, value) = environment(&file);
        assert_eq!(name, "OPENCODE_PTY_HANDOFF");
        let value: Value = serde_json::from_str(&value.unwrap()).unwrap();
        assert_eq!(value["ticket"], "t");
        assert_eq!(value["instanceID"], "i");
        // Prepared once: a second prepare does not ask again.
        prepare(server.clone(), &file, &info(9), Duration::from_secs(1)).await;
        assert_eq!(server.requests().len(), 1);
        // Another service registered: the handoff is not its to take.
        std::fs::write(&file, serde_json::to_string(&info(10)).unwrap()).unwrap();
        assert_eq!(environment(&file).1, None);
        complete(&file, &info(9));
        assert!(sidecar(&file).exists());
        complete(&file, &info(10));
        assert!(!sidecar(&file).exists());
    }

    #[tokio::test]
    async fn a_failed_handoff_shuts_terminals_down_and_publishes_none() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("service.json");
        let server = Arc::new(
            Server::default().reply(HANDOFF_URL, Reply::json(500, "{}")).reply(SHUTDOWN_URL, Reply::json(200, "{}")),
        );
        prepare(server.clone(), &file, &info(9), Duration::from_secs(1)).await;
        let urls: Vec<String> = server.requests().into_iter().map(|(url, _)| url).collect();
        assert_eq!(urls, [HANDOFF_URL, SHUTDOWN_URL]);
        let text = std::fs::read_to_string(sidecar(&file)).unwrap();
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["handoff"], Value::Null);
        assert_eq!(value["source"]["pid"], 9);
        assert_eq!(environment(&file).1, None);
        clear(&file);
        assert!(!sidecar(&file).exists());
    }

    #[test]
    fn expired_and_malformed_sidecars_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("service.json");
        let write = |text: &str| std::fs::write(sidecar(&file), text).unwrap();
        let handoff = r#"{"directory":"/d","instanceID":"i","ticket":"t","expiresAt":1}"#;
        write(&format!(r#"{{"source":{{"pid":9,"url":"u"}},"handoff":{handoff},"expiresAt":1}}"#));
        assert_eq!(environment(&file).1, None);
        let later = now_ms() + 60_000.0;
        write(&format!(r#"{{"source":{{"pid":9,"url":"u"}},"handoff":{handoff},"expiresAt":{later}}}"#));
        assert!(environment(&file).1.is_some());
        write(&format!(r#"{{"source":{{"pid":9,"url":"u","id":3}},"handoff":{handoff},"expiresAt":{later}}}"#));
        assert_eq!(environment(&file).1, None);
        write(&format!(r#"{{"source":{{"pid":9,"url":"u"}},"handoff":{{"ticket":"t"}},"expiresAt":{later}}}"#));
        assert_eq!(environment(&file).1, None);
    }
}
