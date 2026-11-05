//! P-ORACLE and P-FILE for F.5: JSONC edits, the config decoder, the V1 migration, `cli.json`,
//! `model.json`, storage, and the JSONL parsers against the TypeScript code, through
//! `parity/oracle/F.5-config.ts`.
//!
//! The TypeScript side comes from `OPENCODE_TS_ROOT`, else this checkout; without its `node_modules`
//! the tests print "skipped" and pass. Every test uses temporary directories.

#![recursion_limit = "512"]

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::Duration;

use opencode_local::cli_config::{CliConfig, Decode, Info, Resolved};
use opencode_local::jsonc::{self, Segment};
use opencode_local::lock;
use opencode_local::migrate::{self, V1};
use opencode_local::model_pref::{Model, ModelPreferences};
use opencode_local::paths::Paths;
use opencode_local::storage::Storage;
use opencode_local::{jsonl, lock::Options};
use serde_json::{Map, Value, json};

fn ts_root() -> PathBuf {
    std::env::var_os("OPENCODE_TS_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..").canonicalize().unwrap())
}

fn available() -> bool {
    let present = ts_root().join("node_modules").is_dir() && Command::new("bun").arg("--version").output().is_ok();
    if !present {
        eprintln!("skipped: needs bun and {}/node_modules; set OPENCODE_TS_ROOT", ts_root().display());
    }
    present
}

fn command(args: &[&str], home: Option<&Path>) -> Command {
    let script = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/oracle/F.5-config.ts");
    let mut command = Command::new("bun");
    command
        .arg("--cwd")
        .arg(ts_root().join("packages/cli"))
        .arg(script)
        .arg(ts_root())
        .args(args)
        .env_remove("OPENCODE_CLI_CONFIG_CONTENT")
        .env_remove("OPENCODE_CONFIG_DIR")
        // Keep Bun's transpiler cache out of the temporary homes and warm across runs.
        .env("BUN_RUNTIME_TRANSPILER_CACHE_PATH", bun_cache())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(home) = home {
        for (name, value) in env(home) {
            command.env(name, value);
        }
    }
    command
}

fn spawn(args: &[&str], home: Option<&Path>, input: &Value) -> Child {
    let mut child = command(args, home).spawn().unwrap();
    child.stdin.take().unwrap().write_all(input.to_string().as_bytes()).unwrap();
    child
}

fn finish(child: Child) -> Vec<Value> {
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    // Effect logs (the migration's "migrated cli config") go to stdout before the result line.
    let stdout = String::from_utf8(output.stdout).unwrap();
    serde_json::from_str(stdout.lines().last().unwrap_or_default()).unwrap()
}

fn oracle(args: &[&str], home: Option<&Path>, input: &Value) -> Vec<Value> {
    finish(spawn(args, home, input))
}

fn bun_cache() -> PathBuf {
    std::env::temp_dir().join("opencode-rs-f5-bun-cache")
}

fn env(home: &Path) -> Vec<(&'static str, PathBuf)> {
    vec![
        ("HOME", home.to_path_buf()),
        ("XDG_CONFIG_HOME", home.join("config")),
        ("XDG_STATE_HOME", home.join("state")),
        ("XDG_DATA_HOME", home.join("data")),
        ("XDG_CACHE_HOME", home.join("cache")),
    ]
}

fn paths(home: &Path) -> Paths {
    let vars = env(home);
    Paths::from_vars(|name| vars.iter().find(|(key, _)| *key == name).map(|(_, value)| value.clone().into_os_string()))
        .unwrap()
}

fn segments(path: &Value) -> Vec<Segment> {
    path.as_array()
        .unwrap()
        .iter()
        .map(|segment| match segment {
            Value::String(key) => Segment::Key(key.clone()),
            other => Segment::Index(other.as_u64().unwrap() as usize),
        })
        .collect()
}

fn text(value: &Value) -> String {
    jsonc::stringify(value)
}

#[test]
fn jsonc_edits_and_parse_match_typescript() {
    if !available() {
        return;
    }
    let texts = [
        "{}",
        "{\n}\n",
        "",
        "{\n  // comment\n  \"a\": 1\n}\n",
        "{\n  \"a\": 1, // trailing\n  \"b\": { \"c\": true },\n}\n",
        "{\"a\":1,\"b\":{\"c\":[1,2]}}",
        "{\r\n  \"a\": 1,\r\n  \"b\": {}\r\n}\r\n",
        "{\n\t\"a\": {\n\t\t\"b\": 1\n\t}\n}\n",
        "/* head */\n{\n  \"theme\": {\n    \"name\": \"x\" /* inline */\n  },\n  \"keybinds\": {}\n}\n// tail\n",
        "{\n  \"a\": 1,\n  \"a\": 2\n}\n",
        "{ \"nested\": { \"deep\": { \"x\": 1 } } }",
        "[1, 2]",
        "{ \"a\": [ { \"b\": 1 } ], \"ü\": \"é\" }",
        "{\n  \"b\": {\n    // only a comment\n  }\n}",
        "{\n    \"a\": 1\n}\n",
    ];
    let edits = [
        json!({"path": ["a"], "value": 2}),
        json!({"path": ["a"]}),
        json!({"path": ["b"], "value": {"x": [1, "y"], "z": {}}}),
        json!({"path": ["b", "c"], "value": false}),
        json!({"path": ["b", "c"]}),
        json!({"path": ["b", "new"], "value": "v"}),
        json!({"path": ["theme", "name"], "value": "tokyonight"}),
        json!({"path": ["theme"]}),
        json!({"path": ["keybinds", "app.exit"], "value": "ctrl+q"}),
        json!({"path": ["new"], "value": "x"}),
        json!({"path": ["nested", "deep", "x"]}),
        json!({"path": ["nested", "deep", "y"], "value": 0.5}),
        json!({"path": [], "value": {"z": 1}}),
        json!({"path": ["a", 0], "value": 9}),
        json!({"path": ["a", 1]}),
        json!({"path": ["ü"], "value": "é😀\u{1}"}),
        json!({"path": ["n"], "value": 1e21}),
        json!({"path": ["n"], "value": 1.5e-7}),
    ];
    let invalid = ["{", "{\"a\" 1}", "{a: 1}", "[01]", "{} x", "/* open", "{\"a\": tru}", "\"\\x\""];
    let mut cases: Vec<Value> = texts
        .iter()
        .flat_map(|text| {
            edits.iter().map(move |edit| {
                let mut case = edit.clone();
                case["text"] = json!(text);
                case
            })
        })
        .collect();
    cases.extend(texts.iter().chain(&invalid).map(|text| json!({ "text": text })));
    let expected = oracle(&["jsonc"], None, &Value::Array(cases.clone()));
    let mut failures = Vec::new();
    for (case, expected) in cases.iter().zip(&expected) {
        let source = case["text"].as_str().unwrap();
        let actual = match case.get("path") {
            None => jsonc::parse(source).unwrap_or(Value::Null),
            Some(path) => match jsonc::modify(source, &segments(path), case.get("value")) {
                Ok(text) => json!({ "ok": text }),
                Err(error) => json!({ "error": error.to_string() }),
            },
        };
        if text(&actual) != text(expected) {
            failures.push(format!("{case}: TypeScript {expected}, Rust {actual}"));
        }
    }
    assert!(failures.is_empty(), "{} of {} cases differ:\n{}", failures.len(), cases.len(), failures.join("\n"));
    eprintln!("{} JSONC cases match", cases.len());
}

#[test]
fn decode_and_resolve_match_typescript() {
    if !available() {
        return;
    }
    let corpus = json!([
        {},
        {"$schema": "s", "mouse": true, "zzz": 1, "theme": {"mode": "dark", "name": "x", "extra": 1}},
        {"theme": {"mode": "dim"}},
        {"theme": null},
        {"theme": []},
        [],
        {"keybinds": {"session.new": {"name": "a", "key": "b", "foo": 1}, "app.exit": "ctrl+q", "nope": "x"}},
        {"keybinds": {"app.exit": {"foo": 1, "key": {"name": "a", "x": 1}, "desc": "d", "event": "press"}}},
        {"keybinds": {"app.exit": {"key": "a", "event": "hold"}}},
        {"keybinds": {"app.exit": {"key": "a", "preventDefault": 1}}},
        {"keybinds": {"app.exit": [{"name": "a", "ctrl": true}, "b", {"key": "c", "fallthrough": true}]}},
        {"keybinds": {"app.exit": [{"name": "a"}, "b", false]}},
        {"keybinds": {"app.exit": false, "leader": "none", "input.undo": []}},
        {"keybinds": {"app.exit": true}},
        {"keybinds": {"app.exit": null}},
        {"keybinds": []},
        {"plugins": ["a", {"package": "b", "extra": 1, "options": {"z": null}}]},
        {"plugins": [{"options": {}}]},
        {"plugins": [{"package": "b", "options": []}]},
        {"leader": {"timeout": 2000.0}},
        {"leader": {"timeout": 1.5}},
        {"leader": {"timeout": 0}},
        {"leader": {"timeout": -5}},
        {"scroll": {"speed": 0.001, "acceleration": false}},
        {"scroll": {"speed": 0.0005}},
        {"attention": {"notifications": true, "sound": true, "volume": 0, "sound_pack": "p", "sounds": {"done": "x", "other": "y", "default": "z"}}},
        {"attention": {"volume": 1.01}},
        {"attention": {"sounds": {"done": 1}}},
        {"diffs": {"source": "turn", "wrap": "word", "tree": true, "single": false, "fullscreen": true, "view": "split"}},
        {"diffs": {"source": "head"}},
        {"terminal": {"title": false, "copy": "select", "copy_on_select": true}},
        {"prompt": {"editor": true, "paste": "full", "image_preview": false}},
        {"session": {"sidebar": "hide", "scrollbar": true, "submit_scroll": "keep", "thinking": "show", "grouping": "none", "verbosity": "high", "image_preview": true, "tps": false, "markdown": "rendered", "new_location": "inherit", "permissions": "autoaccept"}},
        {"session": {"verbosity": "max"}},
        {"tabs": {"mode": "off", "enabled": true, "scope": "global", "layout": "vertical", "indicators": "numbers"}},
        {"tabs": {"enabled": false}},
        {"mini": {"thinking": "hide", "tools": "show", "shell_output": "hide", "turn_summary": "show", "footer": "hide", "splash": "show", "work_spinner": "seed", "mono": true, "replay": false, "replay_limit": 10}},
        {"mini": {"work_spinner": "spin"}},
        {"mini": {"replay_limit": 0}},
        {"debug": {"devtools": true, "timing": false, "turn_tokens": "verbose"}},
        {"debug": {"turn_tokens": "loud"}},
        {"experimental": {"b": true, "a": false}},
        {"experimental": {"a": 1}},
        {"animations": false, "highlights": true, "mouse": false, "cursor": {"style": "line", "blinking": false}},
        {"cursor": {"style": "bar"}},
        {"mouse": "yes"},
    ]);
    let expected = oracle(&["decode"], None, &corpus);
    let mut failures = Vec::new();
    for (value, expected) in corpus.as_array().unwrap().iter().zip(&expected) {
        let actual = Info::decode(value).map_or(Value::Null, |info| info.to_value());
        if text(&actual) != text(expected) {
            failures.push(format!("{value}: TypeScript {expected}, Rust {actual}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));

    let valid: Vec<Value> = expected.into_iter().filter(|v| !v.is_null()).collect();
    let resolved = oracle(&["resolve"], None, &Value::Array(valid.clone()));
    for (value, expected) in valid.iter().zip(&resolved) {
        let r = Resolved::new(Info::decode(value).unwrap(), |_| None);
        let mut session = r.info.session.clone().unwrap_or_default();
        session.new_location = Some(r.new_location);
        session.permissions = Some(r.permissions);
        session.tps = Some(r.tps);
        let tabs = r.info.tabs.clone().unwrap_or_default();
        let mut tabs_value = serde_json::to_value(&tabs).unwrap();
        for (key, item) in [
            ("mode", json!(r.tabs.mode.as_str())),
            ("enabled", json!(r.tabs.enabled)),
            ("scope", json!(r.tabs.scope.as_str())),
            ("layout", json!(r.tabs.layout.as_str())),
            ("indicators", json!(r.tabs.indicators.as_str())),
        ] {
            tabs_value[key] = item;
        }
        let mut actual = r.info.to_value();
        let map = actual.as_object_mut().unwrap();
        map.shift_remove("keybinds");
        let overrides = [
            (
                "attention",
                json!({
                    "notifications": r.attention.notifications,
                    "sound": r.attention.sound,
                    "volume": jsonc::number(r.attention.volume),
                    "sound_pack": r.attention.sound_pack,
                    "sounds": r.attention.sounds,
                }),
            ),
            ("leader", json!({"timeout": r.leader_timeout.as_millis() as u64})),
            ("mouse", json!(r.mouse)),
            ("cursor", json!({"style": r.cursor_style.as_str(), "blinking": r.cursor_blinking})),
            ("session", serde_json::to_value(&session).unwrap()),
            ("tabs", tabs_value),
        ];
        for (key, item) in overrides {
            map.insert(key.into(), item);
        }
        assert_eq!(sorted(&actual), sorted(expected), "{value}");
    }
    eprintln!("{} decode and {} resolve cases match", corpus.as_array().unwrap().len(), valid.len());
}

// Resolve spreads its input, so its key order is not the schema's; compare without order.
fn sorted(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut entries: Vec<_> = map.iter().map(|(k, v)| (k.clone(), sorted(v))).collect();
            entries.sort_by(|a, b| a.0.cmp(&b.0));
            Value::Object(entries.into_iter().collect())
        }
        Value::Array(items) => Value::Array(items.iter().map(sorted).collect()),
        Value::Number(n) => jsonc::number(n.as_f64().unwrap()),
        other => other.clone(),
    }
}

#[test]
fn migrate_v1_matches_typescript() {
    if !available() {
        return;
    }
    let corpus = json!([
        {"legacy": {}, "kv": {}},
        {"legacy": {"theme": "tokyonight", "mouse": false, "cursor": {"blinking": false}}, "kv": {"theme": "ignored", "theme_mode_lock": "dark"}},
        {"legacy": {"keybinds": {"session_new": "ctrl+n", "app_exit": "ctrl+q", "dialog.select.prev": "up", "bogus": "x"}}, "kv": {}},
        {"legacy": {"keybinds": {"session_new": null}}, "kv": {"theme": "kv"}},
        {"legacy": {"plugin": ["a", ["b", {"x": 1}]], "plugin_enabled": {"c": false, "d": true}}, "kv": {}},
        {"legacy": {"leader_timeout": 500, "scroll_speed": 2, "scroll_acceleration": {"enabled": true}}, "kv": {}},
        {"legacy": {"scroll_acceleration": {}}, "kv": {"sidebar": "hide"}},
        {"legacy": {"attention": {"enabled": true, "sound": false, "sounds": {"done": "d"}}}, "kv": {"attention_sound_pack": "p"}},
        {"legacy": {"diff_style": "stacked"}, "kv": {"diff_wrap_mode": "word", "diff_viewer_show_file_tree": false}},
        {"legacy": {"diff_style": "auto"}, "kv": {"diff_viewer_view": "split"}},
        {"legacy": {"prompt": {"max_width": "auto", "max_height": 3}}, "kv": {"terminal_title_enabled": false, "file_context_enabled": true, "paste_summary_enabled": 0}},
        {"legacy": {"prompt": {"max_width": "wide"}}, "kv": {"thinking_mode": null, "thinking_visibility": 1, "exploration_grouping": "", "scrollbar_visible": true}},
        {"legacy": null, "kv": {"theme": null, "animations_enabled": true, "thinking_mode": "hide"}},
    ]);
    let expected = oracle(&["migrate-v1"], None, &corpus);
    for (case, expected) in corpus.as_array().unwrap().iter().zip(&expected) {
        let legacy = V1::decode(&case["legacy"]);
        let actual = migrate::migrate_v1(legacy.as_ref(), case["kv"].as_object().unwrap());
        assert_eq!(text(&Value::Object(actual)), text(expected), "{case}");
    }
}

#[test]
fn jsonl_parsers_match_typescript() {
    if !available() {
        return;
    }
    let history: String = (0..55)
        .map(|i| format!("{{\"text\":\"p{i}\",\"pasted\":[],\"files\":[{{\"x\":{i}}}]}}\n"))
        .chain([
            "broken\n".into(),
            "{\"text\":1,\"pasted\":[]}\n".into(),
            "{\"text\":\"crlf\",\"pasted\":[]}\r\n".into(),
            "\n\n".into(),
        ])
        .collect();
    let stash = "{\"prompt\":{\"text\":\"a\",\"pasted\":[]},\"timestamp\":5,\"extra\":1}\n{\"prompt\":{\"text\":\"b\"},\"timestamp\":6}\n{\"timestamp\":\"7\",\"prompt\":{\"text\":\"c\",\"pasted\":[]}}\n{\"timestamp\":8,\"prompt\":{\"pasted\":[],\"text\":\"d\"}}\n";
    let frecency = "{\"path\":\"/a\",\"frequency\":1,\"lastOpen\":10}\n{\"path\":\"/b\",\"frequency\":1,\"lastOpen\":30,\"x\":1}\n{\"path\":\"/a\",\"frequency\":2,\"lastOpen\":20}\nnope\n{\"path\":\"/c\",\"frequency\":4,\"lastOpen\":20}\n";
    let expected = oracle(&["jsonl"], None, &json!({"history": history, "stash": stash, "frecency": frecency}));
    assert_eq!(text(&Value::Array(jsonl::parse_history(&history))), text(&expected[0]));
    assert_eq!(text(&Value::Array(jsonl::parse_stash(stash))), text(&expected[1]));
    assert_eq!(text(&Value::Array(jsonl::parse_frecency(frecency))), text(&expected[2]));
}

/// One `cli.json` scenario: files to seed, an overlay, and ops.
struct Scenario {
    name: &'static str,
    files: Vec<(&'static str, &'static str)>,
    overlay: Option<&'static str>,
    ops: Value,
}

fn seed(home: &Path, files: &[(&str, &str)]) {
    for (path, text) in files {
        let file = home.join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, text).unwrap();
    }
}

fn rust_config_op(config: &CliConfig, op: &Value) -> Value {
    let result = if op.get("get").is_some() {
        config.get()
    } else {
        config.update_value(|draft| {
            for edit in op["update"].as_array().unwrap() {
                set(draft, edit[0].as_array().unwrap(), &edit[1]);
            }
        })
    };
    match result {
        Ok(info) => json!({ "ok": info.to_value() }),
        Err(error) => json!({ "error": error.to_string() }),
    }
}

// The oracle's draft edit: create objects along the path, `null` deletes.
fn set(draft: &mut Value, path: &[Value], value: &Value) {
    let (last, parents) = path.split_last().unwrap();
    let parent = parents.iter().fold(draft, |node, key| {
        let map = node.as_object_mut().unwrap();
        map.entry(key.as_str().unwrap()).or_insert_with(|| json!({}))
    });
    let map = parent.as_object_mut().unwrap();
    if value.is_null() {
        map.shift_remove(last.as_str().unwrap());
    } else {
        map.insert(last.as_str().unwrap().into(), value.clone());
    }
}

fn same_result(rust: &Value, typescript: &Value) -> bool {
    match (rust.get("ok"), typescript.get("ok")) {
        (Some(a), Some(b)) => text(a) == text(b),
        (None, None) => true,
        _ => false,
    }
}

fn files_of(home: &Path) -> Vec<(String, String)> {
    let mut files: Vec<(String, String)> = Vec::new();
    let mut stack = vec![home.join("config"), home.join("state")];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() {
                if path.file_name().is_some_and(|n| n != "locks") {
                    stack.push(path);
                }
                continue;
            }
            let name = path.strip_prefix(home).unwrap().display().to_string();
            files.push((name, fs::read_to_string(&path).unwrap_or_default()));
        }
    }
    files.sort();
    files
}

#[test]
fn cli_config_files_match_typescript() {
    if !available() {
        return;
    }
    let commented = "/* head */\n{\n  \"$schema\": \"https://opencode.ai/v2/cli.json\",\n  // theme\n  \"theme\": {\n    \"name\": \"x\" /* inline */\n  },\n  \"tabs\": { \"enabled\": false },\n  \"keybinds\": {},\n}\n// tail\n";
    let legacy = "{\n  // copy\n  \"terminal\": { \"copy_on_select\": true, \"title\": false },\n  \"keybinds\": { \"session.new\": \"x\" },\n  \"keybinds\": {\n    \"session_new\": \"ctrl+n\", // new\n    \"session_list\": \"a\",\n    \"session.list\": \"b\",\n    \"app_exit\": \"q\",\n    \"app_exit\": \"ctrl+q\",\n    \"unknown_name\": \"z\",\n    \"command_list\": \"none\"\n  }\n}\n";
    let tui = "{\n  // v1\n  \"theme\": \"tokyonight\",\n  \"keybinds\": { \"session_new\": \"ctrl+n\" },\n  \"plugin\": [\"a\", [\"b\", { \"x\": 1 }]],\n  \"leader_timeout\": 900,\n  \"scroll_speed\": 0.5,\n  \"attention\": { \"enabled\": true },\n  \"diff_style\": \"stacked\",\n  \"cursor\": { \"style\": \"line\" },\n}\n";
    let kv = "{\"theme_mode_lock\":\"light\",\"sidebar\":\"hide\",\"animations_enabled\":false,\"paste_summary_enabled\":true}";
    let scenarios = vec![
        Scenario {
            name: "fresh",
            files: vec![],
            overlay: None,
            ops: json!([
                {"get": true},
                {"update": [[["theme", "name"], "tokyonight"]]},
                {"update": [[["theme", "mode"], "dark"]]},
                {"update": [[["keybinds", "app.exit"], "ctrl+q"], [["experimental", "new-designs"], true]]},
                {"update": [[["theme", "name"], null]]},
                {"update": [[["tabs", "mode"], "off"], [["attention", "volume"], 0.25]]},
                {"update": [[["theme"], null], [["mouse"], false]]},
                {"update": []},
                {"get": true},
            ]),
        },
        Scenario {
            name: "comments",
            files: vec![("config/opencode/cli.json", commented)],
            overlay: None,
            ops: json!([
                {"get": true},
                {"update": [[["theme", "mode"], "light"]]},
                {"update": [[["keybinds", "session.new"], {"key": "ctrl+n", "desc": "New"}]]},
                {"update": [[["session", "verbosity"], "low"], [["tabs", "scope"], "global"]]},
                {"update": [[["keybinds"], null]]},
            ]),
        },
        Scenario {
            name: "legacy names",
            files: vec![("config/opencode/cli.json", legacy)],
            overlay: None,
            ops: json!([{"get": true}, {"update": [[["mouse"], true]]}]),
        },
        Scenario {
            name: "v1 migration",
            files: vec![("config/opencode/tui.json", tui), ("state/opencode/kv.json", kv)],
            overlay: None,
            ops: json!([{"get": true}, {"update": [[["theme", "name"], "nord"]]}]),
        },
        Scenario {
            name: "broken",
            files: vec![("config/opencode/cli.json", "{ \"theme\": ")],
            overlay: None,
            ops: json!([{"get": true}, {"update": [[["mouse"], false]]}]),
        },
        Scenario {
            name: "schema failure",
            files: vec![("config/opencode/cli.json", "{\n  \"mouse\": 1\n}\n")],
            overlay: None,
            ops: json!([{"get": true}, {"update": [[["theme", "name"], "x"]]}]),
        },
        Scenario {
            name: "overlay",
            files: vec![("config/opencode/cli.json", "{\n  \"theme\": { \"name\": \"file\" }\n}\n")],
            overlay: Some("{\"theme\":{\"name\":\"over\"},\"session\":{\"tps\":false}}"),
            ops: json!([
                {"get": true},
                {"update": [[["theme", "mode"], "dark"]]},
                {"update": [[["theme", "name"], "mine"]]},
            ]),
        },
    ];
    for scenario in scenarios {
        let ts_home = tempfile::tempdir().unwrap();
        let rs_home = tempfile::tempdir().unwrap();
        let mixed_home = tempfile::tempdir().unwrap();
        for home in [&ts_home, &rs_home, &mixed_home] {
            seed(home.path(), &scenario.files);
        }
        let rust = CliConfig::with_content(&paths(rs_home.path()), scenario.overlay);
        let mixed = CliConfig::with_content(&paths(mixed_home.path()), scenario.overlay);
        let ops = scenario.ops.as_array().unwrap();
        for (index, op) in ops.iter().enumerate() {
            let typescript = ts_op(ts_home.path(), scenario.overlay, op);
            let actual = rust_config_op(&rust, op);
            assert!(
                same_result(&actual, &typescript),
                "{} op {index} {op}: TypeScript {typescript}, Rust {actual}",
                scenario.name
            );
            assert_eq!(files_of(rs_home.path()), files_of(ts_home.path()), "{} op {index} {op}", scenario.name);
            // The mixed home alternates clients on the same files.
            if index % 2 == 0 {
                ts_op(mixed_home.path(), scenario.overlay, op);
            } else {
                rust_config_op(&mixed, op);
            }
            assert_eq!(files_of(mixed_home.path()), files_of(ts_home.path()), "{} mixed op {index}", scenario.name);
        }
        eprintln!("{}: {} ops match", scenario.name, ops.len());
    }
}

fn ts_op(home: &Path, overlay: Option<&str>, op: &Value) -> Value {
    let mut command = command(&["config"], Some(home));
    if let Some(overlay) = overlay {
        command.env("OPENCODE_CLI_CONFIG_CONTENT", overlay);
    }
    let mut child = command.spawn().unwrap();
    child.stdin.take().unwrap().write_all(json!([op]).to_string().as_bytes()).unwrap();
    finish(child).remove(0)
}

#[test]
fn model_and_storage_files_match_typescript() {
    if !available() {
        return;
    }
    let ops = json!([
        {"recent": {"providerID": "a", "modelID": "b"}},
        {"recent": {"providerID": "c", "modelID": "d"}},
        {"recent": {"providerID": "a", "modelID": "b"}},
        {"favorite": {"providerID": "c", "modelID": "d"}, "enabled": true},
        {"variant": {"providerID": "a", "modelID": "b"}, "value": "high"},
        {"variant": {"providerID": "c", "modelID": "d"}, "value": null},
        {"favorite": {"providerID": "c", "modelID": "d"}, "enabled": false},
        {},
    ]);
    let seed = "{\"x\":1,\"recent\":[{\"providerID\":\"z\",\"modelID\":\"y\",\"extra\":1},5],\"variant\":{\"\":\"a\"}}";
    let ts = tempfile::tempdir().unwrap();
    let mixed = tempfile::tempdir().unwrap();
    for dir in [&ts, &mixed] {
        fs::write(dir.path().join("model.json"), seed).unwrap();
    }
    let ts_file = ts.path().join("model.json");
    let typescript = oracle(&["model", ts_file.to_str().unwrap()], None, &ops);
    let prefs = ModelPreferences::new(mixed.path());
    let mixed_file = mixed.path().join("model.json");
    let model = |v: &Value| Model::new(v["providerID"].as_str().unwrap(), v["modelID"].as_str().unwrap());
    for (index, op) in ops.as_array().unwrap().iter().enumerate() {
        if index % 2 == 0 {
            oracle(&["model", mixed_file.to_str().unwrap()], None, &json!([op]));
            continue;
        }
        if let Some(m) = op.get("recent") {
            prefs.add_recent(&model(m)).unwrap();
        } else if let Some(m) = op.get("favorite") {
            prefs.set_favorite(&model(m), op["enabled"].as_bool().unwrap()).unwrap();
        } else if let Some(m) = op.get("variant") {
            prefs.save_variant(&model(m), op["value"].as_str()).unwrap();
        }
    }
    assert_eq!(fs::read_to_string(&mixed_file).unwrap(), fs::read_to_string(&ts_file).unwrap());
    let loaded = prefs.load();
    let last = &typescript.last().unwrap()["ok"];
    assert_eq!(
        loaded.recent.iter().map(Model::key).collect::<Vec<_>>(),
        last["recent"].as_array().unwrap().iter().map(|m| model(m).key()).collect::<Vec<_>>()
    );
    assert_eq!(
        Value::Object(loaded.variant.into_iter().map(|(k, v)| (k, Value::String(v))).collect()),
        last["variant"]
    );

    // Storage: the same updates by TypeScript alone and alternating with Rust.
    let initial = json!({"pinned": [], "sort": "updated"});
    let sets = [
        json!({"pinned": ["ses_1"]}),
        json!({"sort": "created", "extra": {"a": 1}}),
        json!({"pinned": ["ses_1", "ses_2"]}),
        json!({"sort": 1.5}),
    ];
    let storage_op = |set: &Value| json!({"key": "session-list", "initial": initial, "set": set});
    let ts_state = tempfile::tempdir().unwrap();
    let mixed_state = tempfile::tempdir().unwrap();
    let all: Vec<Value> = sets.iter().map(storage_op).collect();
    oracle(&["storage", ts_state.path().to_str().unwrap(), "dev"], None, &Value::Array(all));
    let storage = Storage::new(mixed_state.path(), "dev").unwrap();
    for (index, set) in sets.iter().enumerate() {
        if index % 2 == 0 {
            let state = mixed_state.path().to_str().unwrap();
            oracle(&["storage", state, "dev"], None, &json!([storage_op(set)]));
            continue;
        }
        storage
            .update("session-list", &initial, |value| {
                for (key, item) in set.as_object().unwrap() {
                    value[key] = item.clone();
                }
            })
            .unwrap();
    }
    let file = |dir: &Path| fs::read_to_string(dir.join("dev/tui/session-list.json")).unwrap();
    assert_eq!(file(mixed_state.path()), file(ts_state.path()));
    let read_back = oracle(
        &["storage", mixed_state.path().to_str().unwrap(), "dev"],
        None,
        &json!([{"key": "session-list", "initial": initial}]),
    );
    assert_eq!(read_back[0]["ok"], storage.load("session-list", &initial).unwrap());
}

#[test]
fn typescript_waits_for_the_rust_locks() {
    if !available() {
        return;
    }
    let home = tempfile::tempdir().unwrap();
    let paths = paths(home.path());
    let config = CliConfig::with_content(&paths, None);
    let storage = Storage::new(&paths.state, "dev").unwrap();
    let prefs = ModelPreferences::new(&paths.state);
    let options = Options::default();
    let held = [
        lock::acquire(&paths.locks(), &config.path().to_string_lossy(), &options).unwrap(),
        lock::acquire(&paths.state.join("dev/locks"), &storage.file("view").unwrap().to_string_lossy(), &options)
            .unwrap(),
        lock::acquire(&paths.locks(), &prefs.path().to_string_lossy(), &options).unwrap(),
    ];
    let state = paths.state.to_str().unwrap().to_string();
    let model = prefs.path().to_str().unwrap().to_string();
    let children = [
        spawn(&["config"], Some(home.path()), &json!([{"update": [[["mouse"], false]]}])),
        spawn(&["storage", &state, "dev"], None, &json!([{"key": "view", "initial": {}, "set": {"open": true}}])),
        spawn(&["model", &model], None, &json!([{"recent": {"providerID": "a", "modelID": "b"}}])),
    ];
    let files = [config.path().to_path_buf(), storage.file("view").unwrap(), prefs.path().to_path_buf()];
    // Long enough for Bun to start and block on each lock.
    thread::sleep(Duration::from_secs(3));
    for file in &files {
        assert!(!file.exists(), "{} was written while Rust held its lock", file.display());
    }
    for lock in held {
        lock.release().unwrap();
    }
    for child in children {
        finish(child);
    }
    for file in &files {
        assert!(file.exists(), "{} was not written after the release", file.display());
    }
    let written: Map<String, Value> = serde_json::from_str(&fs::read_to_string(&files[0]).unwrap()).unwrap();
    assert_eq!(written.get("mouse"), Some(&json!(false)));
}
