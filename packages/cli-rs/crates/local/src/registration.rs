//! Service registration file (F.4).
//!
//! The background service writes `<state>/service.json` (or `service-<channel>.json`, see
//! [`channel::filename`]) with its URL, PID, version, and private password, mode 0600. Clients read
//! it to find the service (`packages/client/src/effect/service.ts:142-157`). This module reads it and
//! runs the legacy-name migration of `packages/cli/src/services/service-config.ts:79-92,116-132`;
//! probing and lifecycle belong to `opencode-service`.

use std::fmt;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::channel;
use crate::paths::Paths;

/// The registration (`Service.Info`). Unknown fields are ignored, as the TypeScript decoder does.
#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct Registration {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub url: String,
    pub pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

// Keeps the password out of logs.
impl fmt::Debug for Registration {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Registration")
            .field("id", &self.id)
            .field("version", &self.version)
            .field("url", &self.url)
            .field("pid", &self.pid)
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .finish()
    }
}

impl Registration {
    /// Parses registration text; `None` when it does not match the schema: `url` a string, `pid` a
    /// positive integer (`3.0` counts, as in JavaScript), and the optional fields absent or strings
    /// (`null` fails, as with `Schema.optional`).
    pub fn parse(text: &str) -> Option<Self> {
        let value: serde_json::Map<String, serde_json::Value> = serde_json::from_str(text).ok()?;
        let optional = |key: &str| match value.get(key) {
            None => Some(None),
            Some(serde_json::Value::String(text)) => Some(Some(text.clone())),
            Some(_) => None,
        };
        let pid =
            value.get("pid")?.as_f64().filter(|pid| pid.fract() == 0.0 && *pid > 0.0 && *pid <= f64::from(u32::MAX))?;
        Some(Self {
            id: optional("id")?,
            version: optional("version")?,
            url: value.get("url")?.as_str()?.to_string(),
            pid: pid as u32,
            password: optional("password")?,
        })
    }

    /// Whether two registrations describe the same service instance (`same` in
    /// `packages/client/src/service-probe.ts:43-46`); the password is not compared.
    pub fn same(&self, other: &Self) -> bool {
        self.id == other.id && self.version == other.version && self.url == other.url && self.pid == other.pid
    }
}

/// Reads a registration file. A missing or corrupt file is `None`: clients treat both as "no
/// service", and a registering server evicts itself.
pub fn read(file: &Path) -> Option<Registration> {
    Registration::parse(&fs::read_to_string(file).ok()?)
}

/// The registration file for a channel and the legacy files migrated into it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Files {
    pub file: PathBuf,
    pub legacy: Vec<PathBuf>,
}

impl Files {
    pub fn new(paths: &Paths, channel: &str) -> Self {
        let name = channel::filename(channel);
        let mut legacy: Vec<PathBuf> =
            channel::legacy_filename(channel).map(|legacy| paths.state.join(legacy)).into_iter().collect();
        // A preview channel once shared `service.json`.
        if name != "service.json" && channel != "local" {
            legacy.push(paths.state.join("service.json"));
        }
        Self { file: paths.state.join(name), legacy }
    }

    /// Copies each legacy registration whose version belongs to the channel into [`Files::file`],
    /// unless the file exists. The TypeScript CLI does this before every service operation.
    pub fn migrate(&self, channel: &str, installed_version: &str) {
        for legacy in &self.legacy {
            let Ok(text) = fs::read_to_string(legacy) else {
                continue;
            };
            let Some(info) = Registration::parse(&text) else {
                continue;
            };
            if !channel::version_belongs_to_channel(info.version.as_deref(), channel, installed_version) {
                continue;
            }
            let _ = write_new_private(&self.file, &text);
        }
    }

    /// Reads [`Files::file`].
    pub fn read(&self) -> Option<Registration> {
        read(&self.file)
    }
}

/// Writes `text` to a file that must not exist yet, mode 0600 (`{ flag: "wx", mode: 0o600 }`).
pub(crate) fn write_new_private(file: &Path, text: &str) -> io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(file)?.write_all(text.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn paths(root: &Path) -> Paths {
        let state = root.join("state").into_os_string();
        Paths::from_vars(|name| match name {
            "HOME" => Some(OsString::from(root)),
            "XDG_STATE_HOME" => Some(state.clone()),
            _ => None,
        })
        .unwrap()
    }

    #[test]
    fn parse_follows_the_schema() {
        let ok = Registration::parse(r#"{"id":"a","version":"1","url":"http://x","pid":3,"password":"p","extra":1}"#)
            .unwrap();
        assert_eq!(ok.pid, 3);
        assert_eq!(ok.password.as_deref(), Some("p"));
        assert!(!format!("{ok:?}").contains("\"p\""));
        assert!(Registration::parse(r#"{"url":"http://x","pid":1}"#).is_some());
        assert_eq!(Registration::parse(r#"{"url":"http://x","pid":3.0}"#).unwrap().pid, 3);
        for bad in [
            r#"{"url":"http://x","pid":0}"#,
            r#"{"url":"http://x","pid":1.5}"#,
            r#"{"url":"http://x","pid":"1"}"#,
            r#"{"url":"http://x","pid":1,"password":null}"#,
            r#"{"pid":1}"#,
            "[]",
            "{",
            "",
        ] {
            assert!(Registration::parse(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn files_per_channel() {
        let dir = tempfile::tempdir().unwrap();
        let p = paths(dir.path());
        let state = p.state.clone();
        assert_eq!(Files::new(&p, "latest"), Files { file: state.join("service.json"), legacy: vec![] });
        assert_eq!(Files::new(&p, "local"), Files { file: state.join("service-local.json"), legacy: vec![] });
        assert_eq!(
            Files::new(&p, "dev"),
            Files {
                file: state.join("service.json"),
                legacy: vec![state.join(format!("service-{}.json", crate::lock::hash("dev")))]
            }
        );
        assert_eq!(
            Files::new(&p, "oc-x"),
            Files {
                file: state.join("service-oc-x.json"),
                legacy: vec![
                    state.join(format!("service-{}.json", crate::lock::hash("oc-x"))),
                    state.join("service.json")
                ],
            }
        );
    }

    #[test]
    fn migrates_only_matching_versions_once() {
        let dir = tempfile::tempdir().unwrap();
        let p = paths(dir.path());
        fs::create_dir_all(&p.state).unwrap();
        let files = Files::new(&p, "oc-x");
        fs::write(&files.legacy[1], r#"{"version":"9.9.9","url":"http://old","pid":1}"#).unwrap();
        files.migrate("oc-x", "1.0.0");
        assert!(files.read().is_none());
        let text = r#"{"version":"0.0.0-oc-x-7","url":"http://new","pid":2}"#;
        fs::write(&files.legacy[0], text).unwrap();
        files.migrate("oc-x", "1.0.0");
        assert_eq!(fs::read_to_string(&files.file).unwrap(), text);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&files.file).unwrap().permissions().mode() & 0o777, 0o600);
        }
        // An existing registration is never overwritten.
        fs::write(&files.legacy[0], r#"{"version":"1.0.0","url":"http://newer","pid":3}"#).unwrap();
        files.migrate("oc-x", "1.0.0");
        assert_eq!(files.read().unwrap().url, "http://new");
    }
}
