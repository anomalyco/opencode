//! Reads and edits the per-channel service config. Preserve schema field order and append new keys. The caller
//! handles any required service stop or tunnel setup.

use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use base64::Engine;
use indexmap::IndexMap;
use serde::Serialize;
use serde_json::{Map, Value};

use crate::channel;
use crate::paths::Paths;
use crate::registration::write_new_private;

/// The service config (`ServiceConfig.Info`). Field order is the schema order.
#[derive(Clone, Default, PartialEq, Eq, Serialize)]
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

// Keeps the password and the secret route out of logs.
impl fmt::Debug for Info {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Info")
            .field("disabled", &self.disabled)
            .field("remote", &self.remote.as_ref().map(|_| "<redacted>"))
            .field("remote_accepted", &self.remote_accepted)
            .field("hostname", &self.hostname)
            .field("port", &self.port)
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .field("cors", &self.cors)
            .field("env", &self.env)
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Remote {
    pub route: String,
}

/// The Effect `Schema.TaggedError` tag of `ServiceConfig.InvalidError`.
pub const INVALID_ERROR_TAG: &str = "ServiceConfig.InvalidError";

impl Info {
    /// Decodes config text; `None` when it does not match the schema.
    pub fn parse(text: &str) -> Option<Self> {
        Self::decode(text).ok()
    }

    /// Decodes config text, returning Effect Schema's `{ errors: "all" }` message on failure.
    pub fn decode(text: &str) -> Result<Self, String> {
        let value: Value = serde_json::from_str(text).map_err(|_| "Expected a valid JSON string".to_owned())?;
        let Value::Object(map) = value else {
            return Err("Expected object".to_owned());
        };
        decode_object(&map)
    }

    fn to_map(&self) -> Map<String, Value> {
        match serde_json::to_value(self).expect("info serializes") {
            Value::Object(map) => map,
            _ => unreachable!(),
        }
    }
}

// Validates every field in `ServiceConfig.Info` schema order so the collected error matches Effect Schema's
// `Schema.decodeUnknownResult(Schema.fromJsonString(Info))(text, { errors: "all" })`.
fn decode_object(map: &Map<String, Value>) -> Result<Info, String> {
    let mut issues = Vec::new();
    let string = |key: &str, issues: &mut Vec<String>| match map.get(key) {
        None => None,
        Some(Value::String(value)) => Some(value.clone()),
        Some(_) => {
            issues.push(format!("Expected string | undefined\n  at [\"{key}\"]"));
            None
        }
    };
    let disabled = match map.get("disabled") {
        None => None,
        Some(Value::Bool(value)) => Some(*value),
        Some(_) => {
            issues.push("Expected boolean | undefined\n  at [\"disabled\"]".into());
            None
        }
    };
    let remote = match map.get("remote") {
        None => None,
        Some(Value::Object(object)) => match object.get("route") {
            None => {
                issues.push("Missing key\n  at [\"remote\"][\"route\"]".into());
                None
            }
            Some(Value::String(route)) => Some(Remote { route: route.clone() }),
            Some(_) => {
                issues.push("Expected string\n  at [\"remote\"][\"route\"]".into());
                None
            }
        },
        Some(_) => {
            issues.push("Expected object | undefined\n  at [\"remote\"]".into());
            None
        }
    };
    let remote_accepted = match map.get("remoteAccepted") {
        None => false,
        Some(Value::Bool(true)) => true,
        Some(_) => {
            issues.push("Expected true | undefined\n  at [\"remoteAccepted\"]".into());
            false
        }
    };
    let hostname = string("hostname", &mut issues);
    let port = match map.get("port") {
        None => None,
        Some(value) => match value.as_f64() {
            None => {
                issues.push("Expected number | undefined\n  at [\"port\"]".into());
                None
            }
            Some(port) => {
                let mut ok = true;
                if port.fract() != 0.0 || !(-9_007_199_254_740_991.0..=9_007_199_254_740_991.0).contains(&port) {
                    issues.push("Expected an integer\n  at [\"port\"]".into());
                    ok = false;
                }
                if port < 1.0 {
                    issues.push("Expected a value greater than or equal to 1\n  at [\"port\"]".into());
                    ok = false;
                }
                if port > 65_535.0 {
                    issues.push("Expected a value less than or equal to 65535\n  at [\"port\"]".into());
                    ok = false;
                }
                ok.then_some(port as u16)
            }
        },
    };
    let password = string("password", &mut issues);
    let cors = match map.get("cors") {
        None => None,
        Some(Value::Array(items)) => {
            let mut list = Vec::with_capacity(items.len());
            for (index, item) in items.iter().enumerate() {
                match item.as_str() {
                    Some(value) => list.push(value.to_string()),
                    None => issues.push(format!("Expected string\n  at [\"cors\"][{index}]")),
                }
            }
            Some(list)
        }
        Some(_) => {
            issues.push("Expected array | undefined\n  at [\"cors\"]".into());
            None
        }
    };
    let env = match map.get("env") {
        None => None,
        Some(Value::Object(entries)) => {
            let mut vars = IndexMap::with_capacity(entries.len());
            for (key, value) in entries {
                match value.as_str() {
                    Some(value) => {
                        vars.insert(key.clone(), value.to_string());
                    }
                    None => {
                        let key = serde_json::to_string(key).expect("key serializes");
                        issues.push(format!("Expected string\n  at [\"env\"][{key}]"));
                    }
                }
            }
            Some(vars)
        }
        Some(_) => {
            issues.push("Expected object | undefined\n  at [\"env\"]".into());
            None
        }
    };
    if !issues.is_empty() {
        return Err(issues.join("\n"));
    }
    Ok(Info { disabled, remote, remote_accepted, hostname, port, password, cors, env })
}

// Earlier builds stored remote access as a boolean; the field is required in that schema.
fn parse_legacy(text: &str) -> Option<(bool, Info)> {
    let mut map: Map<String, Value> = serde_json::from_str(text).ok()?;
    let enabled = map.shift_remove("remote")?.as_bool()?;
    Some((enabled, decode_object(&map).ok()?))
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A usage or validation message, worded as in TypeScript.
    #[error("{0}")]
    Invalid(String),
    /// An existing `service.json` failed schema decoding (`ServiceConfig.InvalidError`).
    #[error("Invalid service config at {}: {issue}", path.display())]
    InvalidConfig { path: PathBuf, issue: String },
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
    pub const ALL: [Key; 7] =
        [Key::Disabled, Key::Remote, Key::Hostname, Key::Port, Key::Password, Key::Cors, Key::Env];

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
            return Err(invalid(format!("Usage: opencode service set {} <value>", key.name())));
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
                opencode_api_types::js::parse_number(value)
                    .filter(|port| port.fract() == 0.0 && (1.0..=65_535.0).contains(port))
                    .ok_or_else(|| invalid("Port must be between 1 and 65535"))? as u16,
            ),
            Key::Password => Edit::Password(value.to_string()),
            Key::Env => {
                let nested = nested.ok_or_else(|| invalid("Usage: opencode service set env <key> <value>"))?;
                Edit::Env(value.to_string(), nested.to_string())
            }
            Key::Cors => {
                let cors: Vec<String> = value.split(',').map(|origin| origin.trim().to_string()).collect();
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
            return Err(invalid(format!("Usage: opencode service unset {}", key.name())));
        }
        if key == Key::Env {
            return Ok(Edit::UnsetEnv(
                name.ok_or_else(|| invalid("Usage: opencode service unset env <key>"))?.to_string(),
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
    opencode_api_types::js::parse_url(origin)
        .is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.origin().ascii_serialization() == origin)
}

/// Drops `XDG_STATE_HOME` from the configured service environment: the service keeps the state
/// directory it was started with, where clients find its registration.
pub fn process_env(env: Option<&IndexMap<String, String>>) -> Option<IndexMap<String, String>> {
    env.map(|env| env.iter().filter(|(key, _)| *key != "XDG_STATE_HOME").map(|(k, v)| (k.clone(), v.clone())).collect())
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

    /// Reads the config. A missing file is empty; a file with the legacy boolean `remote` is repaired in place,
    /// so every reader sees the same route. Any other unreadable or invalid file fails without modifying it.
    pub fn read(&self) -> Result<Info, Error> {
        if let Some(legacy) = &self.legacy
            && let Ok(text) = crate::read_text(legacy)
            && Info::parse(&text).is_some()
        {
            let _ = write_new_private(&self.file, &text);
        }
        let text = match crate::read_text(&self.file) {
            Ok(text) => text,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Info::default()),
            Err(error) => return Err(error.into()),
        };
        let issue = match Info::decode(&text) {
            Ok(info) => return Ok(info),
            Err(issue) => issue,
        };
        let Some((enabled, rest)) = parse_legacy(&text) else {
            return Err(Error::InvalidConfig { path: self.file.clone(), issue });
        };
        let mut map = rest.to_map();
        if enabled {
            map.insert("remote".into(), serde_json::json!({ "route": route() }));
        }
        self.write(&map)?;
        Ok(Info::parse(&Value::Object(map).to_string()).expect("repaired config is valid"))
    }

    fn update(&self, edit: impl FnOnce(&mut Map<String, Value>)) -> Result<(), Error> {
        let mut map = self.read()?.to_map();
        edit(&mut map);
        self.write(&map)?;
        Ok(())
    }

    // A synced temporary file and a rename, mode 0600 for a new file, `JSON.stringify(value, null, 2)`.
    fn write(&self, map: &Map<String, Value>) -> io::Result<()> {
        let dir = self.file.parent().unwrap_or(Path::new("."));
        fs::create_dir_all(dir)?;
        let temp = PathBuf::from(format!("{}.{}.tmp", self.file.display(), std::process::id()));
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let body = serde_json::to_string_pretty(map).expect("config serializes") + "\n";
        // Windows fails a rename onto a file another process has open; retry as TypeScript does.
        opencode_util::busy::replace(&self.file, &temp, &options, body.as_bytes())
    }

    /// The private credential, created once and kept across restarts; `Some` replaces it.
    pub fn password(&self, value: Option<&str>) -> Result<String, Error> {
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
    pub fn accept_remote(&self) -> Result<(), Error> {
        self.update(|map| {
            map.insert("remoteAccepted".into(), true.into());
        })
    }

    /// Turns remote access on and returns its route, created once and kept.
    pub fn remote(&self) -> Result<String, Error> {
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
    fn disable_remote(&self) -> Result<(), Error> {
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
            return Err(invalid(format!("Usage: opencode service get {}", key.name())));
        }
        if key == Key::Password {
            return self.password(None);
        }
        let info = self.read()?;
        Ok(match key {
            Key::Disabled => info.disabled.unwrap_or(false).to_string(),
            Key::Remote => info.remote.is_some().to_string(),
            Key::Hostname => info.hostname.unwrap_or_default(),
            Key::Port => info.port.map(|port| port.to_string()).unwrap_or_default(),
            Key::Cors => pretty(&serde_json::to_value(info.cors.unwrap_or_default()).expect("cors serializes")),
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

    /// Applies a validated edit to the file. The caller validates the config and stops the service first when
    /// [`Edit::stops_service`] says so, and ensures the tunnel when [`Edit::needs_tunnel`] does.
    pub fn apply(&self, edit: &Edit) -> Result<(), Error> {
        match edit {
            Edit::Remote(true) => self.remote().map(drop),
            Edit::Remote(false) | Edit::Unset(Key::Remote) => self.disable_remote(),
            Edit::Password(value) => self.password(Some(value)).map(drop),
            Edit::Env(name, value) => self.update(|map| {
                let env = map.entry("env").or_insert_with(|| Value::Object(Map::new()));
                env.as_object_mut().expect("env is an object").insert(name.clone(), value.clone().into());
            }),
            Edit::UnsetEnv(name) => self.update(|map| {
                // TypeScript rebuilds the object, so a remaining `env` moves to the end.
                let Some(Value::Object(mut env)) = map.shift_remove("env") else { return };
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
    rand::random::<[u8; 8]>().iter().map(|b| format!("{b:02x}")).collect()
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
        let info = Info::parse(
            r#"{"port":80.0,"remote":{"route":"r","x":1},"remoteAccepted":true,"env":{"A":"b"},"other":1}"#,
        )
        .unwrap();
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
    fn debug_redacts_the_password_and_route() {
        let info = Info::parse(r#"{"port":80,"password":"hunter2","remote":{"route":"r0ute"}}"#).unwrap();
        let shown = format!("{info:?}");
        assert!(!shown.contains("hunter2") && !shown.contains("r0ute"), "{shown}");
        assert!(shown.contains("password: Some(\"<redacted>\")") && shown.contains("port: Some(80)"), "{shown}");
    }

    #[test]
    fn repairs_legacy_remote_and_migrates_legacy_names() {
        let dir = opencode_util::temp::tempdir().unwrap();
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
        assert_eq!(config.read().unwrap(), Info { port: Some(5), ..Info::default() });
        fs::write(&config.file, "not json").unwrap();
        assert!(matches!(config.read(), Err(Error::InvalidConfig { .. })));
        // An editor's BOM and a Latin-1 byte read as TypeScript reads them.
        fs::write(&config.file, b"\xef\xbb\xbf{\"port\":5,\"hostname\":\"caf\xe9\"}").unwrap();
        assert_eq!(
            config.read().unwrap(),
            Info { port: Some(5), hostname: Some("caf\u{fffd}".into()), ..Info::default() }
        );

        let dev = super::tests::config(dir.path(), "oc-x");
        let legacy = dev.legacy.clone().unwrap();
        fs::write(&legacy, r#"{"port":7}"#).unwrap();
        assert_eq!(dev.read().unwrap().port, Some(7));
        assert_eq!(fs::read_to_string(&dev.file).unwrap(), r#"{"port":7}"#);
    }

    #[test]
    fn corrupt_or_unreadable_config_fails_without_overwriting() {
        let dir = opencode_util::temp::tempdir().unwrap();
        let config = config(dir.path(), "latest");
        fs::create_dir_all(config.file.parent().unwrap()).unwrap();
        let samples = [
            "{\"hostname\":\"0.0.0.0\",\"port\":\"4096\",\"password\":\"keep-me\",\"env\":{\"KEEP\":\"1\"}}\n",
            r#"{"port": 4096,"#,
            r#"{"remote":true,"port":"4096","password":"keep-me"}"#,
        ];
        for raw in samples {
            fs::write(&config.file, raw).unwrap();
            let err = config.read().unwrap_err();
            assert!(matches!(err, Error::InvalidConfig { .. }), "{raw}: {err}");
            assert!(err.to_string().contains(&config.file.display().to_string()), "{err}");
            for result in [
                config.password(None).map(drop),
                config.apply(&Edit::Port(4097)),
                config.apply(&Edit::Remote(true)),
                config.apply(&Edit::Unset(Key::Port)),
                config.get(None, None).map(drop),
            ] {
                assert!(matches!(result, Err(Error::InvalidConfig { .. })), "{raw}: {result:?}");
                assert_eq!(fs::read_to_string(&config.file).unwrap(), raw);
            }
        }
        fs::remove_file(&config.file).unwrap();
        fs::create_dir(&config.file).unwrap();
        assert!(matches!(config.apply(&Edit::Port(4097)), Err(Error::Io(_))));
        assert!(config.file.is_dir());
    }

    #[test]
    fn process_env_keeps_the_state_directory() {
        let env: IndexMap<String, String> =
            [("XDG_STATE_HOME", "/x"), ("A", "b")].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        assert_eq!(
            process_env(Some(&env)).unwrap().into_iter().collect::<Vec<_>>(),
            vec![("A".to_string(), "b".to_string())]
        );
        assert_eq!(process_env(None), None);
    }
}
