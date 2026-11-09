//! Three real TypeScript TUI plugins, ported to native plugins on the public SDK alone (`crates/plugin/examples`):
//! each is built as a library, found in a `plugins` directory and loaded into the real TUI over a fake server. The
//! expected rows follow the original's TS rendering logic for the same data. `Dialog::Select`, which the subagents
//! port picks with, is proven on both paths here too.

use crate::support::{self, DIRECTORY, Harness, Log, Reply, Seen, deref_harness};

use std::ffi::c_void;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};

use opencode_api::memory::Memory;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_plugin::abi;
use opencode_plugin::loader::entry_file;
use opencode_tui::plugins::host::{External, external};
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

/// The example plugin `name` (`crates/plugin/examples/<name>`), built once per test run.
fn build(name: &str) -> Vec<u8> {
    static BUILT: Mutex<Vec<(String, Vec<u8>)>> = Mutex::new(Vec::new());
    let mut built = BUILT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((_, library)) = built.iter().find(|(known, _)| known == name) {
        return library.clone();
    }
    let examples = Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugin/examples");
    let target = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/sample-plugin");
    let status = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned()))
        .args(["build", "--quiet", "--manifest-path"])
        .arg(examples.join(name).join("Cargo.toml"))
        .arg("--target-dir")
        .arg(&target)
        .status()
        .unwrap();
    assert!(status.success(), "the {name} plugin did not build");
    let file =
        format!("{}opencode_{}{}", std::env::consts::DLL_PREFIX, name.replace('-', "_"), std::env::consts::DLL_SUFFIX);
    let library = std::fs::read(target.join("debug").join(file)).unwrap();
    built.push((name.to_owned(), library.clone()));
    library
}

type Handler = Arc<dyn Fn(&Seen) -> Option<Reply> + Send + Sync>;

/// A fake server: `/api/event` from `events`, everything else from `handler`, else [`support::base`]; it logs each
/// request but the event stream.
#[derive(Clone)]
struct Server {
    events: Memory,
    log: Log,
    handler: Handler,
}

impl Transport for Server {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        if request.url.path() == "/api/event" {
            return self.events.send(request);
        }
        let seen = Seen {
            method: request.method.to_owned(),
            path: request.url.path().to_owned(),
            query: request.url.query().unwrap_or_default().to_owned(),
            body: request.body.as_ref().and_then(|body| serde_json::from_slice(body).ok()).unwrap_or(Value::Null),
            headers: request.headers.clone(),
        };
        self.log.lock().unwrap().push(seen.clone());
        let (status, body) = (self.handler)(&seen).unwrap_or_else(|| support::base(&seen, DIRECTORY));
        Box::pin(async move { Ok(support::respond(status, &body)) })
    }
}

struct Port {
    harness: Harness,
    events: Memory,
    log: Log,
    _root: opencode_util::temp::TempDir,
}

deref_harness!(Port);

/// The TUI on session `ses_p`, `width` wide, with the port `name` in `<config>/plugins/<name>`, over `handler`.
fn open(name: &str, width: u16, handler: impl Fn(&Seen) -> Option<Reply> + Send + Sync + 'static) -> Port {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let plugin = config.join("plugins").join(name);
    std::fs::create_dir_all(&plugin).unwrap();
    std::fs::write(plugin.join(entry_file()), build(name)).unwrap();
    let server = Server { events: Memory::new(Vec::new()), log: Log::default(), handler: Arc::new(handler) };
    let deps = Deps {
        config: support::config(support::still()),
        route: support::session_route("ses_p"),
        events: true,
        ..support::deps(Arc::new(server.clone()))
    };
    let harness = support::mount(width, 40, deps);
    external(&harness.tui, External { config_dir: config, cwd: root.path().to_path_buf() });
    Port { harness, events: server.events, log: server.log, _root: root }
}

impl Port {
    /// The rows of the sidebar, right of column `from`, trimmed, without blank rows.
    fn sidebar(&self, from: usize) -> Vec<String> {
        self.app
            .text()
            .lines()
            .map(|line| line.chars().skip(from).collect::<String>().trim().to_owned())
            .filter(|line| !line.is_empty())
            .collect()
    }

    /// The foreground of the cell `offset` cells right of where `needle` starts.
    fn fg(&self, needle: &str, offset: u16) -> opentui::prelude::Color {
        let (x, y) = self.find(needle);
        self.app.render().cell(u32::from(x + offset), u32::from(y)).unwrap().fg
    }

    /// The requests to `path`, as `METHOD path?query`.
    fn sent(&self, path: &str) -> Vec<String> {
        let log = self.log.lock().unwrap();
        log.iter()
            .filter(|seen| seen.path.starts_with(path))
            .map(|seen| format!("{} {}", seen.method, seen.url()))
            .collect()
    }
}

fn session(id: &str, title: &str, parent: Option<&str>, updated: u64) -> Value {
    let session = support::merge(support::session(id, title), json!({ "agent": "build", "parentID": parent }));
    support::merge(session, json!({ "time": { "created": 1, "updated": updated } }))
}

/// `/api/session/active` with `running`.
fn active(running: &[&str]) -> Reply {
    let data: serde_json::Map<String, Value> =
        running.iter().map(|id| ((*id).to_owned(), json!({ "type": "running" }))).collect();
    (200, json!({ "data": data }))
}

// --- opencode-subagents-sidebar

/// Twelve children of `ses_p` in shuffled update order, `ses_c03` and `ses_c07` running, `ses_c05` untitled; a
/// running grandchild under `ses_c01` and an unrelated root, which are no direct children.
fn family() -> Vec<Value> {
    let mut sessions = vec![session("ses_p", "Parent", None, 1), session("ses_x", "Other root", None, 2)];
    for index in 1..=12u64 {
        let title = if index == 5 { String::new() } else { format!("Child {index:02}") };
        sessions.push(session(&format!("ses_c{index:02}"), &title, Some("ses_p"), 100 + (index * 7) % 12));
    }
    sessions.push(session("ses_g", "Grandchild", Some("ses_c01"), 999));
    sessions
}

fn subagents(seen: &Seen) -> Option<Reply> {
    let sessions = family();
    let list = |parent: Option<&str>| {
        let data: Vec<&Value> = sessions.iter().filter(|session| session["parentID"].as_str() == parent).collect();
        (200, json!({ "data": data, "cursor": {} }))
    };
    match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/active") => Some(active(&["ses_c03", "ses_c07", "ses_g"])),
        ("GET", "/api/session") => {
            let parent = seen.param("parentID");
            Some(list((!parent.is_empty()).then_some(parent.as_str())))
        }
        ("GET", path) if path.ends_with("/inbox") => Some((200, json!({ "data": [] }))),
        ("GET", path) if path.ends_with("/message") => Some((200, json!({ "data": [], "cursor": {} }))),
        ("GET", path) => {
            let id = path.strip_prefix("/api/session/")?;
            let session = sessions.iter().find(|session| session["id"] == id)?;
            Some((200, json!({ "data": session })))
        }
        _ => None,
    }
}

/// What the TS plugin lists for [`family`]: the direct children by `time.updated`, newest first, as ID, title and
/// state.
fn by_update() -> Vec<(String, String, &'static str)> {
    let mut children: Vec<(u64, String, String, &str)> = (1..=12u64)
        .map(|index| {
            let title = if index == 5 { "Subagent".to_owned() } else { format!("Child {index:02}") };
            let state = if index == 3 || index == 7 { "running" } else { "done" };
            (100 + (index * 7) % 12, format!("ses_c{index:02}"), title, state)
        })
        .collect();
    children.sort_by_key(|child| std::cmp::Reverse(child.0));
    children.into_iter().map(|(_, id, title, state)| (id, title, state)).collect()
}

// Expected: as TS draws it, the sidebar lists the direct children of the session in view, newest activity first, ten
// of them, with a dot, a title (`Subagent` without one) and running or done, then `+2 more`; a click on the header
// folds the list to `▶ Subagents (12, 2 running)`; `/subagents` picks from all twelve, and the pick and a click on a
// row each open their child.
#[test]
fn subagents_lists_ten_children_newest_first_and_opens_them() {
    let h = open("subagents-sidebar", 170, subagents);
    h.wait_for("+2 more");
    let rows = h.sidebar(120);
    let start = rows.iter().position(|row| row == "▼ Subagents").unwrap_or_else(|| panic!("{rows:#?}"));
    let listed: Vec<(String, String)> = rows[start + 1..start + 11]
        .iter()
        .map(|row| {
            let (title, state) = row.rsplit_once(' ').unwrap();
            (title.trim().to_owned(), state.to_owned())
        })
        .collect();
    let expected: Vec<(String, String)> =
        by_update().into_iter().take(10).map(|(_, title, state)| (format!("• {title}"), state.to_owned())).collect();
    assert_eq!(listed, expected, "{rows:#?}");
    assert_eq!(rows[start + 11], "+2 more");
    let screen = h.app.text();
    assert!(!screen.contains("Grandchild") && !screen.contains("Other root"), "{screen}");
    // A running dot is green, as TS's `text.feedback.success.base`; a done one muted.
    let theme = h.tui.page();
    assert_eq!(h.fg("• Child 03", 0), theme.text.feedback.success.base);
    assert_eq!(h.fg("• Child 04", 0), theme.text.muted);

    // The header folds the list, and the fold is kept.
    let (x, y) = h.find("▼ Subagents");
    h.app.click(x, y);
    h.wait_for("▶ Subagents (12, 2 running)");
    h.wait_gone("+2 more");
    let (x, y) = h.find("▶ Subagents");
    h.app.click(x, y);
    h.wait_for("+2 more");

    // `/subagents` lists all twelve, the last too, and opens the pick.
    let session = |id: &str| Route::Session { id: opencode_api::generated::SessionID(id.to_owned()) };
    h.tui.keymap.dispatch("subagents-sidebar.pick", None);
    h.wait_for("Child 12");
    let (Some((y11, _)), Some((y12, _))) = (
        h.app.text().lines().enumerate().find(|(_, line)| line.contains("Child 07 running")),
        h.app.text().lines().enumerate().find(|(_, line)| line.contains("Child 12 done")),
    ) else {
        panic!("the picker does not list all twelve:\n{}", h.app.text());
    };
    assert!(y11 < y12, "{}", h.app.text());
    let (last, title, _) = by_update().pop().unwrap();
    h.app.type_text(&title);
    h.wait("the filtered list", || h.app.text().lines().filter(|line| line.contains(&title)).count() >= 2);
    h.app.press("return");
    h.wait("the pick opens its child", || h.tui.route() == session(&last));

    // A click on a row opens its child too.
    h.tui.navigate(support::session_route("ses_p"));
    h.wait_for("+2 more");
    let (first, title, _) = &by_update()[0];
    let (x, y) = h.find(&format!("• {title}"));
    h.app.click(x + 2, y);
    h.wait("the click opens the child", || h.tui.route() == session(first));
    h.wait_gone("▼ Subagents");
}

// --- @mynameistito/opencode-force-input

fn running(seen: &Seen) -> Option<Reply> {
    match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session/active") => Some(active(&["ses_p"])),
        ("GET", "/api/session") => Some((
            200,
            json!({ "data": [session("ses_p", "Busy", None, 1), session("ses_q", "Calm", None, 1)], "cursor": {} }),
        )),
        ("GET", "/api/session/ses_p") => Some((200, json!({ "data": session("ses_p", "Busy", None, 1) }))),
        ("GET", "/api/session/ses_q") => Some((200, json!({ "data": session("ses_q", "Calm", None, 1) }))),
        ("GET", path) if path.ends_with("/message") => Some((200, json!({ "data": [], "cursor": {} }))),
        ("POST", path) if path.ends_with("/interrupt") => Some((200, json!({}))),
        _ => None,
    }
}

// Expected: ctrl+enter on a running session sends, in this order, one interrupt (the guarded interrupt fires on its
// second press, and the third arms it again) and then the prompt; the hint reads as TS draws it, running and idle, and
// shell mode hides it.
#[test]
fn force_input_interrupts_then_submits_and_hints_the_keys() {
    let h = open("force-input", 120, running);
    h.wait_for("⏎ steer · ctrl+⏎ interrupt & send");
    let theme = h.tui.page();
    assert_eq!(h.fg("ctrl+⏎", 0), theme.text.action.primary.base);
    assert_eq!(h.fg("steer", 0), theme.text.muted);
    assert_eq!(h.fg("⏎ steer", 0), theme.text.base);
    h.app.type_text("hello");
    h.app.press("ctrl+return");
    h.wait("the prompt is sent", || !h.sent("/api/session/ses_p/prompt").is_empty());
    let wire: Vec<String> = h
        .log
        .lock()
        .unwrap()
        .iter()
        .filter(|seen| seen.method == "POST" && (seen.path.ends_with("/interrupt") || seen.path.ends_with("/prompt")))
        .map(|seen| format!("{} {}", seen.method, seen.path))
        .collect();
    assert_eq!(wire, ["POST /api/session/ses_p/interrupt", "POST /api/session/ses_p/prompt"]);
    let prompts: Vec<Value> = h
        .log
        .lock()
        .unwrap()
        .iter()
        .filter(|seen| seen.path.ends_with("/prompt"))
        .map(|seen| seen.body.clone())
        .collect();
    assert_eq!(prompts.len(), 1, "{prompts:?}");
    assert_eq!(prompts[0]["text"], "hello", "ctrl+enter added no newline");

    h.app.type_text("!");
    h.wait_gone("⏎ steer");
    h.app.press("backspace");
    h.wait_for("⏎ steer");
    h.tui.navigate(support::session_route("ses_q"));
    h.wait_for("⏎ send");
}

// --- opencode-session-usage

/// `count` assistant messages of `cost` each, `tokens` input tokens each, on model `p/m`.
fn assistant(prefix: &str, count: usize, cost: f64, tokens: u64) -> Vec<Value> {
    (0..count)
        .map(|index| {
            json!({
                "id": format!("msg_{prefix}{index:03}"), "type": "assistant", "agent": "build",
                "model": { "providerID": "p", "id": "m" }, "time": { "created": 1000 + index },
                "content": [], "cost": cost,
                "tokens": { "input": tokens, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
            })
        })
        .collect()
}

/// A page of `messages`, a hundred at most, after `cursor`.
fn page(messages: &[Value], cursor: &str) -> Reply {
    let start = cursor.strip_prefix("page").and_then(|start| start.parse().ok()).unwrap_or(0);
    let end = (start + 100).min(messages.len());
    let next = (end < messages.len()).then(|| format!("page{end}"));
    (200, json!({ "data": messages[start..end], "cursor": { "next": next } }))
}

/// The model `p/m` at $1 per million input tokens.
fn priced_model() -> Value {
    support::merge(
        support::model("p", "m", "Model M"),
        json!({ "cost": [{ "input": 1, "output": 2, "cache": { "read": 0, "write": 0 } }] }),
    )
}

/// `ses_p` has 150 messages at $0.01 reported, over two pages; its child `ses_c` reports nothing, so it is priced from
/// the catalog: one message of a million input tokens, and a second once `grown` is set.
fn usage(grown: Arc<Mutex<bool>>) -> impl Fn(&Seen) -> Option<Reply> + Send + Sync {
    let resets = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64
        + (4 * 24 + 9) * 3_600_000
        + 1_800_000;
    move |seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/session") => {
            let data = match seen.param("parentID").as_str() {
                "" => vec![session("ses_p", "Tree", None, 1)],
                "ses_p" => vec![session("ses_c", "Child", Some("ses_p"), 2)],
                _ => Vec::new(),
            };
            Some((200, json!({ "data": data, "cursor": {} })))
        }
        ("GET", "/api/session/ses_p") => Some((200, json!({ "data": session("ses_p", "Tree", None, 1) }))),
        ("GET", "/api/session/ses_c") => Some((200, json!({ "data": session("ses_c", "Child", Some("ses_p"), 2) }))),
        ("GET", "/api/session/ses_p/message") => Some(page(&assistant("p", 150, 0.01, 10), &seen.param("cursor"))),
        ("GET", "/api/session/ses_c/message") => {
            let count = if *grown.lock().unwrap() { 2 } else { 1 };
            Some(page(&assistant("c", count, 0.0, 1_000_000), &seen.param("cursor")))
        }
        ("GET", "/api/model") => Some((200, support::list(DIRECTORY, json!([priced_model()])))),
        ("GET", "/api/experimental/usage/limits") => Some((
            200,
            json!({
                "location": { "directory": DIRECTORY },
                "data": {
                    "workspace": { "id": "wrk", "name": "Work" }, "budgets": [],
                    "go": {
                        "rolling": { "percent": 2.4, "limited": false, "resetsAt": resets },
                        "weekly": { "percent": 75, "limited": false, "resetsAt": resets },
                        "monthly": { "percent": 12, "limited": true, "resetsAt": resets },
                    },
                },
            }),
        )),
        _ => None,
    }
}

// Expected: the panel totals every message of the session and its child, over both pages of the parent's history:
// $1.50 reported plus $1.00 at catalog prices; `session.usage.updated` of the child reads it again, and the total
// follows. The meters draw as TS draws them: label, percentage and countdown, then a bar in the severity's color.
#[test]
fn session_usage_totals_the_paged_history_and_follows_usage_events() {
    let grown = Arc::new(Mutex::new(false));
    let h = open("session-usage", 170, usage(grown.clone()));
    h.wait_for("≈ $2.50 session total");
    let pages = h.sent("/api/session/ses_p/message");
    assert!(pages.contains(&"GET /api/session/ses_p/message?limit=100&cursor=page100".to_owned()), "{pages:#?}");
    // With the blank rows of TS's `paddingTop={1}` and `gap={1}`.
    let rows: Vec<String> =
        h.app.text().lines().map(|line| line.chars().skip(120).collect::<String>().trim().to_owned()).collect();
    let start = rows.iter().position(|row| row == "Usage").unwrap_or_else(|| panic!("{rows:#?}"));
    assert_eq!(
        rows[start..start + 11],
        [
            "Usage",
            "≈ $2.50 session total",
            "",
            "Rolling   2% used · resets 4d 9h",
            &format!("━{}", "─".repeat(21)),
            "",
            "Weekly   75% used · resets 4d 9h",
            &format!("{}{}", "━".repeat(17), "─".repeat(5)),
            "",
            "Monthly  12% used · resets 4d 9h",
            &format!("{}{}", "━".repeat(3), "─".repeat(19)),
        ],
        "{rows:#?}"
    );
    let theme = h.tui.page();
    for (label, color) in [
        ("2% used", theme.text.feedback.success.base),
        ("75% used", theme.text.feedback.warning.base),
        ("12% used", theme.text.feedback.error.base),
    ] {
        assert_eq!(h.fg(label, 0), color, "{label}");
    }

    *grown.lock().unwrap() = true;
    h.events.emit(&json!({
        "id": "evt_usage", "created": 2, "type": "session.usage.updated",
        "location": { "directory": DIRECTORY },
        "data": { "sessionID": "ses_c", "cost": 0, "tokens": { "input": 2_000_000, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } } },
    }));
    h.wait_for("≈ $3.50 session total");
}

// --- Dialog::Select on both paths

fn picking(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command { name: name.to_owned(), ..abi::Command::default() };
    setup.command(command("probe.pick"), |host, _| {
        let option = |title: &str, value: &str| abi::SelectOption::new(title, value);
        host.dialog(abi::Dialog::Select(abi::Select {
            title: "Pick one".to_owned(),
            placeholder: Some("Search picks".to_owned()),
            options: vec![
                option("Alpha", "a").description("first"),
                abi::SelectOption { footer: Some("2nd".to_owned()), ..option("Beta", "b") },
                option("Gamma", "c"),
            ],
            current: Some("b".to_owned()),
            action: abi::Action::Command { name: "probe.picked".to_owned(), input: None },
        }));
    });
    setup.command(command("probe.picked"), |host, input| {
        host.toast(abi::Toast::new(abi::Variant::Info, format!("picked {}", input.unwrap_or("nothing"))));
    });
    Ok(())
}

#[allow(unsafe_code)]
unsafe extern "C" fn picking_create(
    host: *const abi::HostApi,
    options: abi::Bytes,
    instance: *mut *mut c_void,
    out: *mut abi::Owned,
) -> i32 {
    // SAFETY: the loader passes what `PluginApi::create` documents.
    unsafe { abi::runtime::create("probe", picking, host, options, instance, out) }
}

/// The select's cells as it opens, and the toast after a move down and enter.
fn picked(loopback: bool) -> (Vec<opentui::testing::Cell>, String) {
    let h = support::mount(100, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let definition = match loopback {
        true => {
            opencode_plugin::loader::native::loopback(&opencode_tui::plugins::host::host(&h.tui), picking_create)
                .unwrap()
                .0
        }
        false => abi::Plugin { id: "probe", setup: picking }.into(),
    };
    opencode_tui::plugins::host::add(&h.tui, definition);
    h.tui.keymap.dispatch("probe.pick", None);
    h.wait_for("Pick one");
    let cells = h.app.render().cells;
    h.app.press("down");
    h.app.press("return");
    let screen = h.wait_for("picked ");
    h.wait_gone("Pick one");
    let toast = screen.lines().find(|line| line.contains("picked ")).unwrap().trim().to_owned();
    (cells, toast)
}

// Expected: a plugin's select opens on its current option, lists the options with their description and footer, and
// picking one closes it and runs the action with the value as its input; the same cells and pick through the C ABI's
// byte shims (`Loopback`).
#[test]
fn a_select_dialog_picks_the_same_through_the_c_abi_loopback() {
    let direct = picked(false);
    assert!(direct.1.contains("picked c"), "{}", direct.1);
    assert!(picked(true) == direct, "the loopback draws or picks otherwise");
}
