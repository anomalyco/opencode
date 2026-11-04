//! Service config with legacy migrations (F.4).
//!
//! Ports the file handling of `packages/cli/src/services/service-config.ts`: the config at
//! `<config>/service.json` (or `service-<channel>.json`) behind `opencode service get/set/unset`.
//! Writes keep the key order the TypeScript object spreads produce (decoded fields in schema order,
//! new keys appended), so either client can rewrite the other's file without reordering it.
//!
//! Stopping the service before a change and creating the remote tunnel are not file operations:
//! [`Edit::stops_service`] and [`Edit::needs_tunnel`] tell the caller when to do them.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use indexmap::IndexMap;
use serde::Serialize;
use serde_json::{Map, Value};

use crate::channel;
use crate::paths::Paths;
use crate::registration::write_new_private;

/// The service config (`ServiceConfig.Info`). Field order is the schema order.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    /// The secret subdomain of remote access, present while it is on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote: Option<Remote>,
    /// Set once the user accepted exposing the service; only `true` is valid.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub remote_accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cors: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<IndexMap<String, String>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Remote {
    pub route: String,
}

impl Info {
    /// Decodes config text; `None` when it does not match the schema.
    pub fn parse(text: &str) -> Option<Self> {
        let map = object(text)?;
        let remote = match map.get("remote") {
            None => None,
            Some(value) => Some(Remote {
                route: value.as_object()?.get("route")?.as_str()?.to_string(),
            }),
        };
        decode(&map, remote)
    }

    fn to_map(&self) -> Map<String, Value> {
        match serde_json::to_value(self).expect("info serializes") {
            Value::Object(map) => map,
            _ => unreachable!(),
        }
    }
}

fn object(text: &str) -> Option<Map<String, Value>> {
    serde_json::from_str(text).ok()
}

// Every field but `remote`, whose encoding differs between the current and the legacy schema.
fn decode(map: &Map<String, Value>, remote: Option<Remote>) -> Option<Info> {
    let string = |key: &str| match map.get(key) {
        None => Some(None),
        Some(value) => Some(Some(value.as_str()?.to_string())),
    };
    let strings = |value: &Value| {
        value
            .as_array()?
            .iter()
            .map(|item| item.as_str().map(str::to_string))
            .collect::<Option<Vec<_>>>()
    };
    Some(Info {
        disabled: match map.get("disabled") {
            None => None,
            Some(value) => Some(value.as_bool()?),
        },
        remote,
        remote_accepted: match map.get("remoteAccepted") {
            None => false,
            Some(Value::Bool(true)) => true,
            Some(_) => return None,
        },
        hostname: string("hostname")?,
        port: match map.get("port") {
            None => None,
            Some(value) => {
                let port = value
                    .as_f64()
                    .filter(|port| port.fract() == 0.0 && (1.0..=65_535.0).contains(port))?;
                Some(port as u16)
            }
        },
        password: string("password")?,
        cors: match map.get("cors") {
            None => None,
            Some(value) => Some(strings(value)?),
        },
        env: match map.get("env") {
            None => None,
            Some(value) => Some(
                value
                    .as_object()?
                    .iter()
                    .map(|(key, value)| Some((key.clone(), value.as_str()?.to_string())))
                    .collect::<Option<IndexMap<_, _>>>()?,
            ),
        },
    })
}

// Earlier builds stored remote access as a boolean; the field is required in that schema.
fn parse_legacy(text: &str) -> Option<(bool, Info)> {
    let map = object(text)?;
    let enabled = map.get("remote")?.as_bool()?;
    Some((enabled, decode(&map, None)?))
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A usage or validation message, worded as in TypeScript.
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Io(#[from] io::Error),
}

fn invalid(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}

/// A key of `opencode service get/set/unset`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    Disabled,
    Remote,
    Hostname,
    Port,
    Password,
    Cors,
    Env,
}

impl Key {
    pub const ALL: [Key; 7] = [
        Key::Disabled,
        Key::Remote,
        Key::Hostname,
        Key::Port,
        Key::Password,
        Key::Cors,
        Key::Env,
    ];

    pub fn parse(key: &str) -> Result<Self, Error> {
        Self::ALL
            .into_iter()
            .find(|candidate| candidate.name() == key)
            .ok_or_else(|| invalid(format!("Unknown service config key: {key}")))
    }

    pub fn name(self) -> &'static str {
        match self {
            Key::Disabled => "disabled",
            Key::Remote => "remote",
            Key::Hostname => "hostname",
            Key::Port => "port",
            Key::Password => "password",
            Key::Cors => "cors",
            Key::Env => "env",
        }
    }
}

/// A validated `set` or `unset`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Edit {
    Disabled(bool),
    Remote(bool),
    Hostname(String),
    Port(u16),
    Password(String),
    Cors(Vec<String>),
    Env(String, String),
    Unset(Key),
    UnsetEnv(String),
}

impl Edit {
    /// `opencode service set <key> <value> [<nested value>]`.
    pub fn set(key: &str, value: &str, nested: Option<&str>) -> Result<Self, Error> {
        let key = Key::parse(key)?;
        if key != Key::Env && nested.is_some() {
            return Err(invalid(format!(
                "Usage: opencode service set {} <value>",
                key.name()
            )));
        }
        let flag = |name: &str| match value {
            "true" => Ok(true),
            "false" => Ok(false),
            _ => Err(invalid(format!("{name} must be true or false"))),
        };
        Ok(match key {
            Key::Disabled => Edit::Disabled(flag("Disabled")?),
            Key::Remote => Edit::Remote(flag("Remote")?),
            Key::Hostname => Edit::Hostname(value.to_string()),
            Key::Port => Edit::Port(
                js_number(value)
                    .filter(|port| port.fract() == 0.0 && (1.0..=65_535.0).contains(port))
                    .ok_or_else(|| invalid("Port must be between 1 and 65535"))?
                    as u16,
            ),
            Key::Password => Edit::Password(value.to_string()),
            Key::Env => {
                let nested = nested
                    .ok_or_else(|| invalid("Usage: opencode service set env <key> <value>"))?;
                Edit::Env(value.to_string(), nested.to_string())
            }
            Key::Cors => {
                let cors: Vec<String> = value
                    .split(',')
                    .map(|origin| origin.trim().to_string())
                    .collect();
                if !cors.iter().all(|origin| is_origin(origin)) {
                    return Err(invalid(
                        "CORS must be a comma-separated list of HTTP(S) origins without paths or trailing slashes",
                    ));
                }
                Edit::Cors(cors)
            }
        })
    }

    /// `opencode service unset <key> [<name>]`.
    pub fn unset(key: &str, name: Option<&str>) -> Result<Self, Error> {
        let key = Key::parse(key)?;
        if key != Key::Env && name.is_some() {
            return Err(invalid(format!(
                "Usage: opencode service unset {}",
                key.name()
            )));
        }
        if key == Key::Env {
            return Ok(Edit::UnsetEnv(
                name.ok_or_else(|| invalid("Usage: opencode service unset env <key>"))?
                    .to_string(),
            ));
        }
        Ok(Edit::Unset(key))
    }

    /// Whether TypeScript stops the running service before applying the edit: every edit except
    /// `set disabled false` and `unset disabled`.
    pub fn stops_service(&self) -> bool {
        !matches!(self, Edit::Disabled(false) | Edit::Unset(Key::Disabled))
    }

    /// Whether the remote tunnel must exist first (`set remote true`); a tunnel that cannot be
    /// created leaves remote access off.
    pub fn needs_tunnel(&self) -> bool {
        matches!(self, Edit::Remote(true))
    }
}

// `URL.parse(origin)` is an http or https URL whose origin is exactly the input.
fn is_origin(origin: &str) -> bool {
    url::Url::parse(origin).is_ok_and(|url| {
        matches!(url.scheme(), "http" | "https") && url.origin().ascii_serialization() == origin
    })
}

// JavaScript `Number(text)` for the forms a port can take: surrounding whitespace, decimal and
// exponent forms, and `0x`, `0o`, `0b` prefixes. Anything else is NaN, here `None`.
fn js_number(text: &str) -> Option<f64> {
    let text = text.trim();
    if text.is_empty() {
        return Some(0.0);
    }
    let prefixed = |radix| {
        u64::from_str_radix(&text[2..], radix)
            .ok()
            .map(|n| n as f64)
    };
    match text.get(..2).map(str::to_ascii_lowercase).as_deref() {
        Some("0x") => return prefixed(16),
        Some("0o") => return prefixed(8),
        Some("0b") => return prefixed(2),
        _ => {}
    }
    if text
        .bytes()
        .any(|b| b.is_ascii_alphabetic() && b != b'e' && b != b'E')
    {
        return None;
    }
    text.parse().ok()
}

/// Drops `XDG_STATE_HOME` from the configured service environment: the service keeps the state
/// directory it was started with, where clients find its registration.
pub fn process_env(env: Option<&IndexMap<String, String>>) -> Option<IndexMap<String, String>> {
    env.map(|env| {
        env.iter()
            .filter(|(key, _)| *key != "XDG_STATE_HOME")
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    })
}

/// The service config file of a channel.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServiceConfig {
    pub file: PathBuf,
    /// Where earlier builds kept it; migrated on read.
    pub legacy: Option<PathBuf>,
}

impl ServiceConfig {
    pub fn new(paths: &Paths, channel: &str) -> Self {
        Self {
            file: paths.config.join(channel::filename(channel)),
            legacy: channel::legacy_filename(channel).map(|legacy| paths.config.join(legacy)),
        }
    }

    /// Reads the config. A missing or invalid file is empty; a file with the legacy boolean
    /// `remote` is repaired in place, so every reader sees the same route.
    pub fn read(&self) -> io::Result<Info> {
        if let Some(legacy) = &self.legacy
            && let Ok(text) = fs::read_to_string(legacy)
            && Info::parse(&text).is_some()
        {
            let _ = write_new_private(&self.file, &text);
        }
        let Ok(text) = fs::read_to_string(&self.file) else {
            return Ok(Info::default());
        };
        if let Some(info) = Info::parse(&text) {
            return Ok(info);
        }
        let Some((enabled, rest)) = parse_legacy(&text) else {
            return Ok(Info::default());
        };
        let mut map = rest.to_map();
        if enabled {
            map.insert("remote".into(), serde_json::json!({ "route": route() }));
        }
        self.write(&map)?;
        Ok(Info::parse(&Value::Object(map).to_string()).expect("repaired config is valid"))
    }

    fn update(&self, edit: impl FnOnce(&mut Map<String, Value>)) -> io::Result<()> {
        let mut map = self.read()?.to_map();
        edit(&mut map);
        self.write(&map)
    }

    // A temporary file and a rename, mode 0600 for a new file, `JSON.stringify(value, null, 2)`.
    fn write(&self, map: &Map<String, Value>) -> io::Result<()> {
        let dir = self.file.parent().unwrap_or(Path::new("."));
        fs::create_dir_all(dir)?;
        let temp = PathBuf::from(format!(
            "{}.{}.tmp",
            self.file.display(),
            std::process::id()
        ));
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let body = serde_json::to_string_pretty(map).expect("config serializes") + "\n";
        io::Write::write_all(&mut options.open(&temp)?, body.as_bytes())?;
        // Windows fails a rename onto a file another process has open; retry as TypeScript does.
        let mut attempt = 0;
        loop {
            match fs::rename(&temp, &self.file) {
                Err(_) if attempt < 20 => {
                    attempt += 1;
                    std::thread::sleep(Duration::from_millis(10));
                }
                other => return other,
            }
        }
    }

    /// The private credential, created once and kept across restarts; `Some` replaces it.
    pub fn password(&self, value: Option<&str>) -> io::Result<String> {
        let existing = self.read()?;
        if value.is_none()
            && let Some(password) = existing.password
        {
            return Ok(password);
        }
        let next = value.map_or_else(
            || base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>()),
            str::to_string,
        );
        let mut map = existing.to_map();
        map.insert("password".into(), next.clone().into());
        self.write(&map)?;
        Ok(next)
    }

    /// Records that the user accepted remote access.
    pub fn accept_remote(&self) -> io::Result<()> {
        self.update(|map| {
            map.insert("remoteAccepted".into(), true.into());
        })
    }

    /// Turns remote access on and returns its route, created once and kept.
    pub fn remote(&self) -> io::Result<String> {
        let existing = self.read()?;
        if let Some(remote) = existing.remote {
            return Ok(remote.route);
        }
        let next = route();
        let mut map = existing.to_map();
        map.insert("remote".into(), serde_json::json!({ "route": next }));
        self.write(&map)?;
        Ok(next)
    }

    // Forgets the route, so turning remote access on again issues a new one; having had it on
    // counts as accepting it.
    fn disable_remote(&self) -> io::Result<()> {
        self.update(|map| {
            if map.shift_remove("remote").is_some() {
                map.insert("remoteAccepted".into(), true.into());
            }
        })
    }

    /// `opencode service get [<key> [<name>]]`. Without a key: the config as JSON without the
    /// password and with the route hidden. `get password` creates the password when missing.
    pub fn get(&self, key: Option<&str>, name: Option<&str>) -> Result<String, Error> {
        let Some(key) = key else {
            let mut map = self.read()?.to_map();
            map.shift_remove("password");
            if let Some(remote) = map.get_mut("remote") {
                *remote = Value::Object(Map::new());
            }
            return Ok(pretty(&Value::Object(map)));
        };
        let key = Key::parse(key)?;
        if key != Key::Env && name.is_some() {
            return Err(invalid(format!(
                "Usage: opencode service get {}",
                key.name()
            )));
        }
        if key == Key::Password {
            return Ok(self.password(None)?);
        }
        let info = self.read()?;
        Ok(match key {
            Key::Disabled => info.disabled.unwrap_or(false).to_string(),
            Key::Remote => info.remote.is_some().to_string(),
            Key::Hostname => info.hostname.unwrap_or_default(),
            Key::Port => info.port.map(|port| port.to_string()).unwrap_or_default(),
            Key::Cors => pretty(
                &serde_json::to_value(info.cors.unwrap_or_default()).expect("cors serializes"),
            ),
            Key::Env => {
                let env = info.env.unwrap_or_default();
                match name {
                    Some(name) => env.get(name).cloned().unwrap_or_default(),
                    None => pretty(&serde_json::to_value(env).expect("env serializes")),
                }
            }
            Key::Password => unreachable!(),
        })
    }

    /// Applies a validated edit to the file. The caller stops the service first when
    /// [`Edit::stops_service`] says so, and ensures the tunnel when [`Edit::needs_tunnel`] does.
    pub fn apply(&self, edit: &Edit) -> io::Result<()> {
        match edit {
            Edit::Remote(true) => self.remote().map(drop),
            Edit::Remote(false) | Edit::Unset(Key::Remote) => self.disable_remote(),
            Edit::Password(value) => self.password(Some(value)).map(drop),
            Edit::Env(name, value) => self.update(|map| {
                let env = map
                    .entry("env")
                    .or_insert_with(|| Value::Object(Map::new()));
                env.as_object_mut()
                    .expect("env is an object")
                    .insert(name.clone(), value.clone().into());
            }),
            Edit::UnsetEnv(name) => self.update(|map| {
                // TypeScript rebuilds the object, so a remaining `env` moves to the end.
                let Some(Value::Object(mut env)) = map.shift_remove("env") else {
                    return;
                };
                env.shift_remove(name);
                if !env.is_empty() {
                    map.insert("env".into(), Value::Object(env));
                }
            }),
            Edit::Unset(key) => self.update(|map| {
                map.shift_remove(key.name());
            }),
            Edit::Disabled(value) => self.update(|map| {
                map.insert("disabled".into(), (*value).into());
            }),
            Edit::Hostname(value) => self.update(|map| {
                map.insert("hostname".into(), value.clone().into());
            }),
            Edit::Port(value) => self.update(|map| {
                map.insert("port".into(), (*value).into());
            }),
            Edit::Cors(value) => self.update(|map| {
                map.insert("cors".into(), value.clone().into());
            }),
        }
    }
}

fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).expect("json serializes")
}

// 64 random bits as 16 hex characters, a valid DNS label.
fn route() -> String {
    rand::random::<[u8; 8]>()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn config(root: &Path, channel: &str) -> ServiceConfig {
        let paths = Paths::from_vars(|name| match name {
            "HOME" => Some(OsString::from(root)),
            "XDG_CONFIG_HOME" => Some(root.join("config").into_os_string()),
            _ => None,
        })
        .unwrap();
        ServiceConfig::new(&paths, channel)
    }

    #[test]
    fn parse_follows_the_schema() {
        let info = Info::parse(r#"{"port":80.0,"remote":{"route":"r","x":1},"remoteAccepted":true,"env":{"A":"b"},"other":1}"#).unwrap();
        assert_eq!(info.port, Some(80));
        assert_eq!(info.remote, Some(Remote { route: "r".into() }));
        assert!(info.remote_accepted);
        for bad in [
            r#"{"port":0}"#,
            r#"{"port":65536}"#,
            r#"{"port":1.5}"#,
            r#"{"remote":true}"#,
            r#"{"remoteAccepted":false}"#,
            r#"{"cors":[1]}"#,
            r#"{"env":{"A":1}}"#,
            r#"{"hostname":null}"#,
            "[]",
        ] {
            assert!(Info::parse(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn edits_validate_like_typescript() {
        let message = |result: Result<Edit, Error>| result.unwrap_err().to_string();
        assert_eq!(
            message(Edit::set("nope", "1", None)),
            "Unknown service config key: nope"
        );
        assert_eq!(
            message(Edit::set("port", "1", Some("x"))),
            "Usage: opencode service set port <value>"
        );
        assert_eq!(
            message(Edit::set("disabled", "yes", None)),
            "Disabled must be true or false"
        );
        assert_eq!(
            message(Edit::set("remote", "1", None)),
            "Remote must be true or false"
        );
        assert_eq!(
            message(Edit::set("env", "A", None)),
            "Usage: opencode service set env <key> <value>"
        );
        assert_eq!(
            message(Edit::unset("env", None)),
            "Usage: opencode service unset env <key>"
        );
        assert_eq!(
            message(Edit::unset("port", Some("x"))),
            "Usage: opencode service unset port"
        );
        for bad in ["", "0", "65536", "1.5", "abc", "1_0"] {
            assert_eq!(
                message(Edit::set("port", bad, None)),
                "Port must be between 1 and 65535",
                "{bad}"
            );
        }
        for (text, port) in [
            ("80", 80),
            (" 80 ", 80),
            ("80.0", 80),
            ("8e1", 80),
            ("0x50", 80),
            ("+80", 80),
        ] {
            assert_eq!(
                Edit::set("port", text, None).unwrap(),
                Edit::Port(port),
                "{text}"
            );
        }
        assert_eq!(
            Edit::set("cors", "http://a.test, https://b.test:8443", None).unwrap(),
            Edit::Cors(vec!["http://a.test".into(), "https://b.test:8443".into()])
        );
        for bad in [
            "http://a.test/",
            "http://a.test/x",
            "ftp://a.test",
            "http://A.test",
            "http://a.test:80",
            "a,,b",
        ] {
            assert!(Edit::set("cors", bad, None).is_err(), "{bad}");
        }
        assert!(
            !Edit::set("disabled", "false", None)
                .unwrap()
                .stops_service()
        );
        assert!(Edit::set("disabled", "true", None).unwrap().stops_service());
        assert!(!Edit::unset("disabled", None).unwrap().stops_service());
        assert!(Edit::set("remote", "true", None).unwrap().needs_tunnel());
    }

    #[test]
    fn writes_keep_typescript_key_order() {
        let dir = tempfile::tempdir().unwrap();
        let config = config(dir.path(), "latest");
        assert_eq!(config.get(None, None).unwrap(), "{}");
        config.apply(&Edit::Password("p".into())).unwrap();
        config.apply(&Edit::Port(5000)).unwrap();
        config.apply(&Edit::Env("B".into(), "1".into())).unwrap();
        config.apply(&Edit::Env("A".into(), "2".into())).unwrap();
        config.apply(&Edit::Hostname("h".into())).unwrap();
        let text = fs::read_to_string(&config.file).unwrap();
        // Decoding puts the existing keys in schema order; new keys go last.
        assert_eq!(
            text,
            "{\n  \"port\": 5000,\n  \"password\": \"p\",\n  \"env\": {\n    \"B\": \"1\",\n    \"A\": \"2\"\n  },\n  \"hostname\": \"h\"\n}\n"
        );
        config.apply(&Edit::UnsetEnv("B".into())).unwrap();
        config.apply(&Edit::Disabled(true)).unwrap();
        assert_eq!(
            config.get(Some("env"), None).unwrap(),
            "{\n  \"A\": \"2\"\n}"
        );
        assert_eq!(config.get(Some("env"), Some("A")).unwrap(), "2");
        assert_eq!(config.get(Some("port"), None).unwrap(), "5000");
        assert_eq!(config.get(Some("disabled"), None).unwrap(), "true");
        assert_eq!(config.get(Some("cors"), None).unwrap(), "[]");
        assert_eq!(config.get(Some("password"), None).unwrap(), "p");
        assert_eq!(
            config.get(None, None).unwrap(),
            "{\n  \"disabled\": true,\n  \"hostname\": \"h\",\n  \"port\": 5000,\n  \"env\": {\n    \"A\": \"2\"\n  }\n}"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&config.file).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn password_and_remote() {
        let dir = tempfile::tempdir().unwrap();
        let config = config(dir.path(), "latest");
        let password = config.get(Some("password"), None).unwrap();
        assert_eq!(password.len(), 43);
        assert_eq!(config.password(None).unwrap(), password);
        let route = config.remote().unwrap();
        assert_eq!(route.len(), 16);
        assert_eq!(config.remote().unwrap(), route);
        assert_eq!(config.get(Some("remote"), None).unwrap(), "true");
        assert_eq!(config.get(None, None).unwrap(), "{\n  \"remote\": {}\n}");
        config.apply(&Edit::Remote(false)).unwrap();
        let info = config.read().unwrap();
        assert!(info.remote.is_none());
        assert!(info.remote_accepted);
    }

    #[test]
    fn repairs_legacy_remote_and_migrates_legacy_names() {
        let dir = tempfile::tempdir().unwrap();
        let config = config(dir.path(), "latest");
        fs::create_dir_all(config.file.parent().unwrap()).unwrap();
        fs::write(&config.file, r#"{"remote":true,"port":5}"#).unwrap();
        let info = config.read().unwrap();
        let route = info.remote.unwrap().route;
        assert_eq!(
            fs::read_to_string(&config.file).unwrap(),
            format!("{{\n  \"port\": 5,\n  \"remote\": {{\n    \"route\": \"{route}\"\n  }}\n}}\n")
        );
        fs::write(&config.file, r#"{"remote":false,"port":5}"#).unwrap();
        assert_eq!(
            config.read().unwrap(),
            Info {
                port: Some(5),
                ..Info::default()
            }
        );
        fs::write(&config.file, "not json").unwrap();
        assert_eq!(config.read().unwrap(), Info::default());

        let dev = super::tests::config(dir.path(), "oc-x");
        let legacy = dev.legacy.clone().unwrap();
        fs::write(&legacy, r#"{"port":7}"#).unwrap();
        assert_eq!(dev.read().unwrap().port, Some(7));
        assert_eq!(fs::read_to_string(&dev.file).unwrap(), r#"{"port":7}"#);
    }

    #[test]
    fn process_env_keeps_the_state_directory() {
        let env: IndexMap<String, String> = [("XDG_STATE_HOME", "/x"), ("A", "b")]
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        assert_eq!(
            process_env(Some(&env))
                .unwrap()
                .into_iter()
                .collect::<Vec<_>>(),
            vec![("A".to_string(), "b".to_string())]
        );
        assert_eq!(process_env(None), None);
    }
}
