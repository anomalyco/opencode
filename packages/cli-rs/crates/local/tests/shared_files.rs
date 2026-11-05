//! P-FILE under contention for the state files the TypeScript TUI shares (MS1 review carbon-7, MS3/MS4
//! review carbon-3): `session.json`, `prompt-history.jsonl`, `frecency.jsonl` and `prompt-stash.jsonl`,
//! written at the same time by this crate and by
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
/// whole, no temporary file is left, every Rust pin is written, and a Rust pin after TypeScript's last
/// save keeps every pin TypeScript wrote.
///
/// TypeScript saves without the lock, so neither side can keep everything while both write: a
/// TypeScript save between a Rust read and rename is lost, and TypeScript saves the list it read at
/// startup, so it drops Rust's pins (see `steps/rs-test-flakes.md`). A racing Rust write can drop only
/// TypeScript's newest pins, so TypeScript's pins in the file stay a prefix of its own list.
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
        let pin = format!("rs-{i}");
        let written = pins::set(&dir, &pin, true).unwrap();
        assert_eq!(written.last(), Some(&pin), "{written:?}");
        thread::sleep(Duration::from_millis(1));
    }
    let typescript_saw = ts.finish();
    stop.store(true, Ordering::SeqCst);
    let reads = reader.join().unwrap();
    assert!(leftovers(&dir).is_empty(), "{:?}", leftovers(&dir));
    let raced = pins::load(&dir);
    let kept: Vec<&String> = raced.iter().filter(|pin| pin.starts_with("ts-")).collect();
    let prefix: Vec<String> = (0..kept.len()).map(|i| format!("ts-{i}")).collect();
    assert_eq!(kept, prefix.iter().collect::<Vec<_>>(), "{raced:?}");

    // TypeScript saves once more with nothing racing it; the next Rust pin keeps all of it.
    let mut ts = typescript(&["pins", dir.to_str().unwrap(), "late", "1"]);
    ts.go();
    let saved: Vec<String> = serde_json::from_value(ts.finish()["pinned"].clone()).unwrap();
    assert_eq!(saved, [raced.clone(), vec!["late-0".into()]].concat());
    let written = pins::set(&dir, "rs-last", true).unwrap();
    assert_eq!(written, [saved, vec!["rs-last".into()]].concat());
    // TypeScript reads what Rust wrote, byte for byte as it would write it.
    let read_back = read(&dir);
    assert_eq!(read_back["pinned"], json!(written));
    assert_eq!(
        std::fs::read_to_string(pins::file(&dir)).unwrap(),
        json!({ "pinned": written }).to_string()
    );
    eprintln!(
        "session.json: {reads} reads, all whole; TS ended with {} pins, {} of its {WRITES} survived the race",
        typescript_saw["pinned"].as_array().map_or(0, Vec::len),
        prefix.len()
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

/// `frecency.jsonl` at the limit: the TypeScript TUI opens new files while Rust does. Every state a reader
/// sees is whole lines, no visit either side wrote is lost, and the newest 1000 paths both TUIs read are
/// the same.
#[test]
fn frecency_at_the_limit_under_contention() {
    if !available() {
        return;
    }
    let state = tempfile::tempdir().unwrap();
    let dir = state.path().to_owned();
    let file = dir.join("frecency.jsonl");
    let full: String = (0..jsonl::MAX_FRECENCY_ENTRIES)
        .map(|n| format!("{{\"path\":\"/w/old-{n}\",\"frequency\":1,\"lastOpen\":{n}}}\n"))
        .collect();
    std::fs::write(&file, full).unwrap();
    let mut frecency = jsonl::Frecency::load(&dir, Path::new("/w"));
    let stop = Arc::new(AtomicBool::new(false));
    let reader = watch(file.clone(), stop.clone(), whole_lines);
    let mut ts = typescript(&["frecency", dir.to_str().unwrap(), "ts", &WRITES.to_string()]);
    ts.go();
    for i in 0..WRITES {
        frecency.update(&format!("rs-{i}"), jsonl::now_ms());
        thread::sleep(Duration::from_millis(1));
    }
    ts.finish();
    // Rust reopens one of TypeScript's files: it counts from TypeScript's line.
    frecency.update("ts-0", jsonl::now_ms());
    stop.store(true, Ordering::SeqCst);
    let reads = reader.join().unwrap();

    let typescript_read = read(&dir)["frecency"].clone();
    for side in ["ts", "rs"] {
        for i in 0..WRITES {
            let path = format!("/w/{side}-{i}");
            assert!(typescript_read.get(&path).is_some(), "{path} was lost");
        }
    }
    assert_eq!(typescript_read["/w/ts-0"], 2);
    let lines = std::fs::read_to_string(&file).unwrap().lines().count();
    let loaded = jsonl::Frecency::load(&dir, Path::new("/w"));
    assert_eq!(loaded.data().len(), jsonl::MAX_FRECENCY_ENTRIES);
    let rust_read: serde_json::Map<String, Value> = loaded
        .data()
        .iter()
        .map(|(path, visit)| (path.clone(), json!(visit.frequency as i64)))
        .collect();
    assert_eq!(Value::Object(rust_read), typescript_read);
    assert!(leftovers(&dir).is_empty(), "{:?}", leftovers(&dir));
    eprintln!(
        "frecency.jsonl: {reads} reads, all whole; {lines} lines before the load trimmed it to 1000"
    );
}

/// `prompt-stash.jsonl`: the TypeScript TUI stashes while Rust does, and then Rust pops its own entries.
/// Every state a reader sees is whole lines, no entry either side stashed is lost, and a pop drops only
/// its own line.
///
/// The pops run after TypeScript stopped: a pop rewrites the file, and TypeScript appends without the
/// lock, so an append that opened the file just before the rename and writes just after it is lost (see
/// `steps/rs-ms34-files.md`).
#[test]
fn prompt_stash_under_contention() {
    if !available() {
        return;
    }
    let state = tempfile::tempdir().unwrap();
    let dir = state.path().to_owned();
    let stop = Arc::new(AtomicBool::new(false));
    let reader = watch(dir.join("prompt-stash.jsonl"), stop.clone(), whole_lines);
    let mut stash = jsonl::Stash::load(&dir);
    let mut ts = typescript(&["stash", dir.to_str().unwrap(), "ts", &WRITES.to_string()]);
    ts.go();
    for i in 0..WRITES {
        let prompt = json!({ "text": format!("rs-{i}"), "pasted": [] });
        stash.push(prompt, jsonl::now_ms());
        thread::sleep(Duration::from_millis(1));
    }
    ts.finish();
    for _ in 0..WRITES / 2 {
        stash.pop();
    }
    stop.store(true, Ordering::SeqCst);
    let reads = reader.join().unwrap();

    let texts: HashSet<String> = read(&dir)["stash"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|text| text.as_str().map(str::to_owned))
        .collect();
    for i in 0..WRITES {
        assert!(
            texts.contains(&format!("ts-{i}")),
            "ts-{i} was lost: {texts:?}"
        );
        assert_eq!(
            texts.contains(&format!("rs-{i}")),
            i < WRITES / 2,
            "rs-{i}: {texts:?}"
        );
    }
    assert!(leftovers(&dir).is_empty(), "{:?}", leftovers(&dir));
    eprintln!(
        "prompt-stash.jsonl: {reads} reads, all whole; {} entries",
        texts.len()
    );
}

fn whole_lines(text: &str) -> Result<(), String> {
    if !text.is_empty() && !text.ends_with('\n') {
        return Err("a partial line".into());
    }
    match text
        .lines()
        .find(|line| serde_json::from_str::<Value>(line).is_err())
    {
        Some(line) => Err(format!("a broken line {line:?}")),
        None => Ok(()),
    }
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
