//! P-FILE and P-ORACLE for F.4: the Rust lock, registration, and service config against the
//! TypeScript code, through `parity/oracle/F.4-local.ts`.
//!
//! The TypeScript side comes from `OPENCODE_TS_ROOT`, else this checkout. Lock tests need only `bun`;
//! the others also need the root's `node_modules` and are skipped, with a note, without it. Every
//! test uses temporary directories.

use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime};

use opencode_local::channel;
use opencode_local::lock::{self, Options};
use opencode_local::paths::Paths;
use opencode_local::registration::Registration;
use opencode_local::service_config::{Edit, ServiceConfig};
use serde_json::Value;

fn ts_root() -> PathBuf {
    std::env::var_os("OPENCODE_TS_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../..")
                .canonicalize()
                .unwrap()
        })
}

fn script() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/oracle/F.4-local.ts")
}

fn bun(args: &[&str]) -> Option<Command> {
    if Command::new("bun").arg("--version").output().is_err() {
        eprintln!("skipped: bun is not on PATH");
        return None;
    }
    let mut command = Command::new("bun");
    command.arg(script()).arg(ts_root()).args(args);
    Some(command)
}

fn with_modules() -> bool {
    let present = ts_root().join("node_modules").is_dir();
    if !present {
        eprintln!(
            "skipped: {} has no node_modules; set OPENCODE_TS_ROOT",
            ts_root().display()
        );
    }
    present
}

fn quick(stale_ms: u64) -> Options {
    Options {
        stale: Duration::from_millis(stale_ms),
        timeout: Duration::from_millis(300),
        base_delay: Duration::from_millis(10),
        max_delay: Duration::from_millis(50),
    }
}

fn lock_try(dir: &Path, key: &str, stale_ms: u64) -> Option<String> {
    let output = bun(&[
        "lock-try",
        dir.to_str().unwrap(),
        key,
        "300",
        &stale_ms.to_string(),
    ])?
    .output()
    .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Some(String::from_utf8(output.stdout).unwrap().trim().to_string())
}

#[test]
fn typescript_holds_rust_waits() {
    let dir = tempfile::tempdir().unwrap();
    let Some(mut command) = bun(&[
        "lock-hold",
        dir.path().to_str().unwrap(),
        "shared-key",
        "60000",
    ]) else {
        return;
    };
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut out = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    out.read_line(&mut line).unwrap();
    assert_eq!(line.trim(), "acquired");

    let err = lock::acquire(dir.path(), "shared-key", &quick(60_000)).unwrap_err();
    assert!(matches!(err, lock::Error::Timeout(_)), "{err}");

    child.stdin.take().unwrap().write_all(b"\n").unwrap();
    line.clear();
    out.read_line(&mut line).unwrap();
    assert_eq!(line.trim(), "released");
    assert!(child.wait().unwrap().success());
    lock::acquire(dir.path(), "shared-key", &quick(60_000))
        .unwrap()
        .release()
        .unwrap();
}

#[test]
fn rust_holds_typescript_waits() {
    let dir = tempfile::tempdir().unwrap();
    let held = lock::acquire(dir.path(), "shared-key", &quick(60_000)).unwrap();
    let Some(result) = lock_try(dir.path(), "shared-key", 60_000) else {
        return;
    };
    assert_eq!(result, "timeout");
    held.release().unwrap();
    assert_eq!(
        lock_try(dir.path(), "shared-key", 60_000).unwrap(),
        "acquired"
    );
}

#[test]
fn stale_locks_are_broken_across_clients() {
    // A TypeScript owner killed while holding the lock.
    let dir = tempfile::tempdir().unwrap();
    let Some(mut command) = bun(&["lock-hold", dir.path().to_str().unwrap(), "k", "300"]) else {
        return;
    };
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    assert_eq!(line.trim(), "acquired");
    child.kill().unwrap();
    child.wait().unwrap();
    let options = Options {
        timeout: Duration::from_secs(3),
        ..quick(300)
    };
    lock::acquire(dir.path(), "k", &options)
        .unwrap()
        .release()
        .unwrap();

    // A Rust owner that left its directory behind with an old heartbeat.
    let lock_dir = dir.path().join(format!("{}.lock", lock::hash("k")));
    fs::create_dir(&lock_dir).unwrap();
    fs::write(lock_dir.join("heartbeat"), "").unwrap();
    fs::write(lock_dir.join("meta.json"), r#"{"token":"gone"}"#).unwrap();
    let old = SystemTime::now() - Duration::from_secs(5);
    for file in ["heartbeat", "meta.json"] {
        fs::File::open(lock_dir.join(file))
            .unwrap()
            .set_modified(old)
            .unwrap();
    }
    assert_eq!(lock_try(dir.path(), "k", 200).unwrap(), "acquired");
}

#[test]
fn channel_and_registration_match_typescript() {
    if !with_modules() {
        return;
    }
    let Some(mut command) = bun(&["oracle"]) else {
        return;
    };
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let oracle: Value = serde_json::from_slice(&output.stdout).unwrap();
    for case in oracle["channels"].as_array().unwrap() {
        let name = case["channel"].as_str().unwrap();
        assert_eq!(channel::filename(name), case["filename"], "{name}");
        assert_eq!(
            channel::legacy_filename(name)
                .map(Value::from)
                .unwrap_or(Value::Null),
            case["legacy"],
            "{name}"
        );
        assert_eq!(
            channel::default_port(name, false),
            case["port"].as_u64().unwrap() as u16,
            "{name}"
        );
        assert_eq!(
            channel::default_port(name, true),
            case["windows"].as_u64().unwrap() as u16,
            "{name}"
        );
    }
    for case in oracle["versions"].as_array().unwrap() {
        let version = case["version"].as_str().unwrap();
        assert_eq!(
            channel::version_belongs_to_channel(Some(version), "oc-x", "1.2.3"),
            case["belongs"],
            "{version}"
        );
    }
    for case in oracle["registrations"].as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        let rust = Registration::parse(text)
            .map(|info| serde_json::to_value(info).unwrap())
            .unwrap_or(Value::Null);
        assert_eq!(rust, case["decoded"], "{text}");
    }
}

// A temporary home whose XDG roots both clients use. TypeScript run from source is channel `local`.
struct Home {
    dir: tempfile::TempDir,
}

impl Home {
    fn new() -> Self {
        Self {
            dir: tempfile::tempdir().unwrap(),
        }
    }

    fn var(&self, name: &str) -> Option<OsString> {
        let root = self.dir.path();
        Some(match name {
            "HOME" => root.into(),
            "XDG_CONFIG_HOME" => root.join("config").into(),
            "XDG_STATE_HOME" => root.join("state").into(),
            "XDG_DATA_HOME" => root.join("data").into(),
            "XDG_CACHE_HOME" => root.join("cache").into(),
            _ => return None,
        })
    }

    fn config(&self) -> ServiceConfig {
        ServiceConfig::new(&Paths::from_vars(|name| self.var(name)).unwrap(), "local")
    }

    fn text(&self) -> String {
        fs::read_to_string(&self.config().file).unwrap()
    }

    // Runs `config <args>` in TypeScript: `Ok` with the result, `Err` with the error message.
    fn ts(&self, args: &[&str]) -> Result<Value, String> {
        let mut command = bun(&[&["config"], args].concat()).unwrap();
        command
            .env_remove("OPENCODE_CONFIG_DIR")
            .env_remove("OPENCODE_PASSWORD");
        for name in [
            "HOME",
            "XDG_CONFIG_HOME",
            "XDG_STATE_HOME",
            "XDG_DATA_HOME",
            "XDG_CACHE_HOME",
        ] {
            command.env(name, self.var(name).unwrap());
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let result: Value = serde_json::from_slice(&output.stdout).unwrap();
        match result.get("error") {
            Some(error) => Err(error.as_str().unwrap().to_string()),
            None => Ok(result["ok"].clone()),
        }
    }
}

fn ts_get(home: &Home, args: &[&str]) -> String {
    home.ts(&[&["get"], args].concat())
        .unwrap()
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn service_config_interop() {
    if !with_modules() || bun(&[]).is_none() {
        return;
    }
    // Rust writes, TypeScript reads.
    let home = Home::new();
    let config = home.config();
    for edit in [
        Edit::Password("p".into()),
        Edit::Port(5000),
        Edit::Env("B".into(), "1".into()),
    ] {
        config.apply(&edit).unwrap();
    }
    assert_eq!(ts_get(&home, &[]), config.get(None, None).unwrap());
    assert_eq!(ts_get(&home, &["env", "B"]), "1");
    assert_eq!(ts_get(&home, &["password"]), "p");

    // TypeScript writes; Rust reads, and the same edits from Rust give the same bytes.
    let steps: [&[&str]; 4] = [
        &["set", "env", "A", "2"],
        &["set", "hostname", "h"],
        &["unset", "env", "B"],
        &["set", "disabled", "true"],
    ];
    let twin = Home::new();
    for edit in [
        Edit::Password("p".into()),
        Edit::Port(5000),
        Edit::Env("B".into(), "1".into()),
    ] {
        twin.config().apply(&edit).unwrap();
    }
    for step in steps {
        home.ts(step).unwrap();
        let edit = match step[0] {
            "set" => Edit::set(step[1], step[2], step.get(3).copied()),
            _ => Edit::unset(step[1], step.get(2).copied()),
        };
        twin.config().apply(&edit.unwrap()).unwrap();
        assert_eq!(home.text(), twin.text(), "after {step:?}");
    }
    assert_eq!(config.get(None, None).unwrap(), ts_get(&home, &[]));
    assert_eq!(
        config.get(Some("env"), None).unwrap(),
        ts_get(&home, &["env"])
    );

    // The legacy boolean `remote` is repaired the same way.
    for home in [&home, &twin] {
        fs::write(home.config().file, r#"{"remote":true,"port":5}"#).unwrap();
    }
    assert_eq!(ts_get(&home, &["remote"]), "true");
    twin.config().read().unwrap();
    assert_eq!(mask_route(&home.text()), mask_route(&twin.text()));
}

// Replaces the 16-hex-digit route, which is random on each side.
fn mask_route(text: &str) -> String {
    let value: Value = serde_json::from_str(text).unwrap();
    let route = value["remote"]["route"].as_str().unwrap();
    assert_eq!(route.len(), 16);
    text.replace(route, "<route>")
}

#[test]
fn service_config_validation_matches_typescript() {
    if !with_modules() || bun(&[]).is_none() {
        return;
    }
    let cases: [&[&str]; 18] = [
        &["set", "nope", "1"],
        &["set", "port", "0x50"],
        &["set", "port", " 80 "],
        &["set", "port", "8e1"],
        &["set", "port", "1.5"],
        &["set", "port", "abc"],
        &["set", "port", ""],
        &["set", "port", "1", "x"],
        &["set", "disabled", "yes"],
        &["set", "env", "A"],
        &["set", "cors", "http://a.test, https://b.test:8443"],
        &["set", "cors", "http://a.test/"],
        &["set", "cors", "http://A.test"],
        &["set", "cors", "http://a.test:80"],
        &["set", "cors", "a,,b"],
        &["unset", "env"],
        &["unset", "port", "x"],
        &["unset", "nope"],
    ];
    for case in cases {
        let home = Home::new();
        let rust = match case[0] {
            "set" => Edit::set(case[1], case[2], case.get(3).copied()),
            _ => Edit::unset(case[1], case.get(2).copied()),
        };
        let ts = home.ts(case);
        match rust {
            Ok(edit) => {
                assert!(ts.is_ok(), "{case:?}: TypeScript failed with {ts:?}");
                // Both accepted it; the stored value must agree too.
                let twin = Home::new();
                twin.config().apply(&edit).unwrap();
                if let Edit::Port(_) | Edit::Cors(_) = edit {
                    assert_eq!(home.text(), twin.text(), "{case:?}");
                }
            }
            Err(err) => assert_eq!(Err(err.to_string()), ts.map(drop), "{case:?}"),
        }
    }
}
