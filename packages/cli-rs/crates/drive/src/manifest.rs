//! The drive manifest, as `packages/simulation/src/manifest.ts` resolves it from `OPENCODE_DRIVE`.

use serde::Deserialize;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};

/// Where the endpoints listen and the screen size, from `OPENCODE_DRIVE`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Manifest {
    /// The UI endpoint, `ws://127.0.0.1:<port>`.
    pub ui: String,
    /// The backend endpoint the simulated server connects to; the TUI does not use it.
    pub backend: String,
    /// Columns and rows; the TUI then starts at 100 by 40 when absent.
    pub viewport: Option<(u16, u16)>,
    /// The timeline path TS records into; the Rust endpoint does not record.
    pub recording: Option<PathBuf>,
}

impl Manifest {
    /// The defaults for `OPENCODE_DRIVE=1` (`manifest.ts` `defaults`).
    pub fn defaults() -> Self {
        Self {
            ui: "ws://127.0.0.1:40900".into(),
            backend: "ws://127.0.0.1:40950".into(),
            viewport: None,
            recording: None,
        }
    }

    /// The UI endpoint's socket address. [`resolve`] has checked it.
    pub fn ui_addr(&self) -> SocketAddr {
        endpoint(&self.ui).expect("a checked endpoint")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error(pub String);

impl std::fmt::Display for Error {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

/// Resolves the manifest named by `OPENCODE_DRIVE`, or `None` when it is unset or empty. `env` reads a variable.
pub fn resolve(env: impl Fn(&str) -> Option<String>) -> Option<Result<Manifest, Error>> {
    let name = env("OPENCODE_DRIVE").filter(|name| !name.is_empty())?;
    Some(resolve_name(&name, env))
}

fn resolve_name(name: &str, env: impl Fn(&str) -> Option<String>) -> Result<Manifest, Error> {
    if !valid_name(name) {
        return Err(Error(format!(
            "Invalid Drive configuration: OPENCODE_DRIVE: expected a valid Drive instance name, got {name:?}"
        )));
    }
    if name == "1" {
        return Ok(Manifest::defaults());
    }
    let directory = env("DRIVE_REGISTRY_DIR").map(PathBuf::from).unwrap_or_else(|| {
        let state = env("XDG_STATE_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| Path::new(&env("HOME").unwrap_or_default()).join(".local").join("state"));
        state.join("opencode-drive").join("instances")
    });
    let file = directory.join(format!("{name}.json"));
    let contents = std::fs::read_to_string(&file).map_err(|error| {
        Error(match error.kind() {
            std::io::ErrorKind::NotFound => format!("Drive manifest not found: {}", file.display()),
            _ => format!("Failed to read Drive manifest: {}: {error}", file.display()),
        })
    })?;
    decode(&contents).map_err(|message| Error(format!("Invalid Drive manifest: {}: {message}", file.display())))
}

fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|first| first.is_ascii_alphanumeric())
        && name.len() <= 64
        && chars.all(|char| char.is_ascii_alphanumeric() || matches!(char, '.' | '_' | '-'))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Raw {
    endpoints: Endpoints,
    viewport: Option<Viewport>,
    recording: Option<Recording>,
}

#[derive(Deserialize)]
struct Endpoints {
    ui: String,
    backend: String,
}

#[derive(Deserialize)]
struct Viewport {
    cols: u64,
    rows: u64,
}

#[derive(Deserialize)]
struct Recording {
    timeline: String,
}

fn decode(contents: &str) -> Result<Manifest, String> {
    let raw: Raw = serde_json::from_str(contents).map_err(|error| error.to_string())?;
    for (key, value) in [("endpoints.ui", &raw.endpoints.ui), ("endpoints.backend", &raw.endpoints.backend)] {
        if endpoint(value).is_none() {
            return Err(format!("{key}: expected a loopback WebSocket endpoint with an explicit port, got {value:?}"));
        }
    }
    let viewport = raw
        .viewport
        .map(|viewport| {
            let size = |value: u64| u16::try_from(value).ok().filter(|value| *value > 0);
            size(viewport.cols)
                .zip(size(viewport.rows))
                .ok_or_else(|| "viewport: expected positive columns and rows".to_owned())
        })
        .transpose()?;
    let recording = raw
        .recording
        .map(|recording| {
            Path::new(&recording.timeline)
                .is_absolute()
                .then(|| PathBuf::from(&recording.timeline))
                .ok_or_else(|| "recording.timeline: expected an absolute path".to_owned())
        })
        .transpose()?;
    Ok(Manifest { ui: raw.endpoints.ui, backend: raw.endpoints.backend, viewport, recording })
}

/// A `ws://127.0.0.1:<port>` endpoint's address, as `manifest.ts` `Endpoint` accepts it.
fn endpoint(value: &str) -> Option<SocketAddr> {
    let url = url::Url::parse(value).ok()?;
    let port = url.port().filter(|port| *port >= 1)?;
    (url.scheme() == "ws" && url.host_str() == Some("127.0.0.1")).then(|| SocketAddr::from(([127, 0, 0, 1], port)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(vars: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let vars: HashMap<String, String> =
            vars.iter().map(|(key, value)| ((*key).to_owned(), (*value).to_owned())).collect();
        move |key| vars.get(key).cloned()
    }

    #[test]
    fn unset_and_default() {
        assert_eq!(resolve(env(&[])), None);
        assert_eq!(resolve(env(&[("OPENCODE_DRIVE", "")])), None);
        assert_eq!(resolve(env(&[("OPENCODE_DRIVE", "1")])), Some(Ok(Manifest::defaults())));
        assert_eq!(Manifest::defaults().ui_addr(), SocketAddr::from(([127, 0, 0, 1], 40900)));
    }

    #[test]
    fn names_are_checked() {
        for name in ["-x", "a/b", "a b", &"a".repeat(65)] {
            let error = resolve(env(&[("OPENCODE_DRIVE", name)])).unwrap().unwrap_err();
            assert!(error.0.starts_with("Invalid Drive configuration"), "{name}: {error}");
        }
    }

    #[test]
    fn manifests_come_from_the_registry() {
        let directory = tempfile::tempdir().unwrap();
        let instances = directory.path().join("opencode-drive").join("instances");
        std::fs::create_dir_all(&instances).unwrap();
        let state = directory.path().to_str().unwrap();
        let write = |name: &str, body: &str| std::fs::write(instances.join(format!("{name}.json")), body).unwrap();
        write(
            "good",
            r#"{"endpoints":{"ui":"ws://127.0.0.1:4100","backend":"ws://127.0.0.1:4101"},"viewport":{"cols":80,"rows":24},"recording":{"timeline":"/tmp/t.json"}}"#,
        );
        write("remote", r#"{"endpoints":{"ui":"ws://10.0.0.1:4100","backend":"ws://127.0.0.1:4101"}}"#);
        write("portless", r#"{"endpoints":{"ui":"ws://127.0.0.1","backend":"ws://127.0.0.1:4101"}}"#);
        write(
            "zero",
            r#"{"endpoints":{"ui":"ws://127.0.0.1:1","backend":"ws://127.0.0.1:2"},"viewport":{"cols":0,"rows":2}}"#,
        );
        let get = |name: &str| resolve(env(&[("OPENCODE_DRIVE", name), ("XDG_STATE_HOME", state)])).unwrap();

        let good = get("good").unwrap();
        assert_eq!(good.ui_addr(), SocketAddr::from(([127, 0, 0, 1], 4100)));
        assert_eq!(good.viewport, Some((80, 24)));
        assert_eq!(good.recording, Some(PathBuf::from("/tmp/t.json")));
        for name in ["remote", "portless", "zero"] {
            assert!(get(name).unwrap_err().0.starts_with("Invalid Drive manifest: "), "{name}");
        }
        assert!(get("missing").unwrap_err().0.starts_with("Drive manifest not found: "));

        let registry = resolve(env(&[("OPENCODE_DRIVE", "good"), ("DRIVE_REGISTRY_DIR", instances.to_str().unwrap())]));
        assert_eq!(registry.unwrap().unwrap(), good);
    }
}
