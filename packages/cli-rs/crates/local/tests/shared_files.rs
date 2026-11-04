//! P-FILE under contention for the state files the TypeScript TUI shares (MS1 review, carbon-7):
//! `session.json` and `prompt-history.jsonl`, written at the same time by this crate and by
//! `parity/oracle/MS1-files.ts`, which writes with the TypeScript TUI's own `util/persistence`
//! functions. A reader thread checks every state of the files meanwhile.
//!
//! The TypeScript side comes from `OPENCODE_TS_ROOT`, else this checkout; without its `node_modules`
//! the tests are skipped.

use std::collections::HashSet;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use opencode_local::{jsonl, pins};
use serde_json::{Value, json};

const WRITES: usize = 20;

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

fn available() -> bool {
    let present = ts_root().join("node_modules").is_dir()
        && Command::new("bun").arg("--version").output().is_ok();
    if !present {
        eprintln!(
            "skipped: needs bun and {}/node_modules; set OPENCODE_TS_ROOT",
            ts_root().display()
        );
    }
    present
}

/// A running oracle and its output.
struct Oracle(Child, BufReader<ChildStdout>);

/// Starts the oracle; a writing command waits for [`Oracle::go`].
fn typescript(args: &[&str]) -> Oracle {
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/oracle/MS1-files.ts");
    let mut child = Command::new("bun")
        .arg("--cwd")
        .arg(ts_root().join("packages/cli"))
        .arg(script)
        .arg(ts_root())
        .args(args)
        .env(
            "BUN_RUNTIME_TRANSPILER_CACHE_PATH",
            std::env::temp_dir().join("opencode-rs-f5-bun-cache"),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let stdout = BufReader::new(child.stdout.take().unwrap());
    Oracle(child, stdout)
}

impl Oracle {
    /// Waits until the oracle is ready to write, then lets it.
    fn go(&mut self) {
        let mut line = String::new();
        self.1.read_line(&mut line).unwrap();
        assert_eq!(line.trim(), "ready", "{}", self.stderr());
        self.0.stdin.take().unwrap().write_all(b"go\n").unwrap();
    }

    fn finish(mut self) -> Value {
        let mut stdout = String::new();
        self.1.read_to_string(&mut stdout).unwrap();
        let status = self.0.wait().unwrap();
        assert!(status.success(), "{}", self.stderr());
        serde_json::from_str(stdout.lines().last().unwrap()).unwrap()
    }

    fn stderr(&mut self) -> String {
        let mut text = String::new();
        if let Some(mut stderr) = self.0.stderr.take() {
            let _ = stderr.read_to_string(&mut text);
        }
        text
    }
}

fn read(state: &Path) -> Value {
    typescript(&["read", state.to_str().unwrap()]).finish()
}

/// Reads `file` until `stop`, failing on any state `valid` rejects. Returns how many reads it made.
fn watch(
    file: PathBuf,
    stop: Arc<AtomicBool>,
    valid: impl Fn(&str) -> Result<(), String> + Send + 'static,
) -> thread::JoinHandle<usize> {
    thread::spawn(move || {
        let mut reads = 0;
        while !stop.load(Ordering::SeqCst) {
            if let Ok(text) = std::fs::read_to_string(&file) {
                if let Err(error) = valid(&text) {
                    panic!("a reader saw {error}: {text:?}");
                }
                reads += 1;
            }
            thread::sleep(Duration::from_micros(200));
        }
        reads
    })
}

fn leftovers(state: &Path) -> Vec<String> {
    std::fs::read_dir(state)
        .unwrap()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".tmp"))
        .collect()
}

/// `session.json`: the TypeScript TUI saves its whole list while Rust pins. Every state a reader sees is
/// whole, no temporary file is left, and the next Rust pin keeps every pin TypeScript wrote. (TypeScript
/// itself saves the list it read at startup, so it can drop the pins Rust wrote meanwhile; see the step
/// notes.)
#[test]
fn session_json_under_contention() {
    if !available() {
        return;
    }
    let state = tempfile::tempdir().unwrap();
    let dir = state.path().to_owned();
    let stop = Arc::new(AtomicBool::new(false));
    let reader = watch(pins::file(&dir), stop.clone(), |text| {
        let value: Value = serde_json::from_str(text).map_err(|error| error.to_string())?;
        value["pinned"]
            .as_array()
            .filter(|pins| pins.iter().all(Value::is_string))
            .map(|_| ())
            .ok_or_else(|| "no pinned list".to_owned())
    });
    let mut ts = typescript(&["pins", dir.to_str().unwrap(), "ts", &WRITES.to_string()]);
    ts.go();
    for i in 0..WRITES {
        pins::set(&dir, &format!("rs-{i}"), true).unwrap();
        thread::sleep(Duration::from_millis(1));
    }
    let typescript_saw = ts.finish();
    stop.store(true, Ordering::SeqCst);
    let reads = reader.join().unwrap();
    assert!(leftovers(&dir).is_empty(), "{:?}", leftovers(&dir));

    let written = pins::set(&dir, "rs-last", true).unwrap();
    for i in 0..WRITES {
        assert!(
            written.contains(&format!("ts-{i}")),
            "ts-{i} was lost: {written:?}"
        );
    }
    assert_eq!(written.last().map(String::as_str), Some("rs-last"));
    // TypeScript reads what Rust wrote, byte for byte as it would write it.
    let read_back = read(&dir);
    assert_eq!(read_back["pinned"], json!(written));
    assert_eq!(
        std::fs::read_to_string(pins::file(&dir)).unwrap(),
        json!({ "pinned": written }).to_string()
    );
    eprintln!(
        "session.json: {reads} reads, all whole; TS ended with {} pins, Rust's next write kept all {WRITES} of TS's",
        typescript_saw["pinned"].as_array().map_or(0, Vec::len)
    );
}

/// `prompt-history.jsonl`: the TypeScript TUI appends while Rust saves, first below the limit and then
/// past it. Every state a reader sees is whole and, past the limit, never shorter than the limit; no line
/// either side wrote is lost; TypeScript reads the result; and a Rust load trims it to the newest 50.
#[test]
fn prompt_history_under_contention() {
    if !available() {
        return;
    }
    let state = tempfile::tempdir().unwrap();
    let dir = state.path().to_owned();
    let file = dir.join("prompt-history.jsonl");

    let below = race(&dir, "a", 0);
    let history = read(&dir)["history"].clone();
    assert_eq!(history.as_array().unwrap().len(), 2 * WRITES, "{history}");
    assert_all(&history, "a");

    // Fill to the limit, so every Rust save rewrites.
    let full: String = (0..jsonl::MAX_HISTORY_ENTRIES)
        .map(|n| format!("{{\"text\":\"old-{n}\",\"pasted\":[]}}\n"))
        .collect();
    std::fs::write(&file, full).unwrap();
    let at = race(&dir, "b", jsonl::MAX_HISTORY_ENTRIES);
    let text = std::fs::read_to_string(&file).unwrap();
    let history = read(&dir)["history"].clone();
    assert_eq!(
        history.as_array().unwrap().len(),
        jsonl::MAX_HISTORY_ENTRIES
    );
    assert_all(&history, "b");
    let loaded = jsonl::History::load(&dir);
    assert_eq!(
        std::fs::read_to_string(&file).unwrap().lines().count(),
        jsonl::MAX_HISTORY_ENTRIES
    );
    assert_eq!(
        json!(
            loaded
                .entries()
                .iter()
                .map(|entry| &entry["text"])
                .collect::<Vec<_>>()
        ),
        history
    );
    assert!(leftovers(&dir).is_empty(), "{:?}", leftovers(&dir));
    eprintln!(
        "prompt-history.jsonl: {below} reads below the limit, {at} past it, all whole; {} lines before the load trimmed it",
        text.lines().count()
    );
}

/// TypeScript and Rust each write [`WRITES`] entries `<round>-ts-<i>` and `<round>-rs-<i>` at once.
fn race(dir: &Path, round: &str, minimum: usize) -> usize {
    let stop = Arc::new(AtomicBool::new(false));
    let reader = watch(
        dir.join("prompt-history.jsonl"),
        stop.clone(),
        move |text| {
            if !text.is_empty() && !text.ends_with('\n') {
                return Err("a partial line".into());
            }
            if let Some(line) = text
                .lines()
                .find(|line| serde_json::from_str::<Value>(line).is_err())
            {
                return Err(format!("a broken line {line:?}"));
            }
            let count = text.lines().count();
            if count < minimum {
                return Err(format!("{count} lines"));
            }
            Ok(())
        },
    );
    let mut ts = typescript(&[
        "history",
        dir.to_str().unwrap(),
        &format!("{round}-ts"),
        &WRITES.to_string(),
    ]);
    ts.go();
    for i in 0..WRITES {
        let entry = json!({ "text": format!("{round}-rs-{i}"), "pasted": [] });
        jsonl::save_history(dir, &entry).unwrap();
        thread::sleep(Duration::from_millis(1));
    }
    ts.finish();
    stop.store(true, Ordering::SeqCst);
    reader.join().unwrap()
}

fn assert_all(history: &Value, round: &str) {
    let texts: HashSet<&str> = history
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
        .collect();
    for side in ["ts", "rs"] {
        for i in 0..WRITES {
            let text = format!("{round}-{side}-{i}");
            assert!(texts.contains(text.as_str()), "{text} was lost: {texts:?}");
        }
    }
}
