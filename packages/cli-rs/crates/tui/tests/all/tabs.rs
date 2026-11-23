//! Session tabs and panes over temporary shared storage.

use crate::support::{self, Harness, WAIT, deref_harness};

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

use opencode_api::generated::{EventKind, SessionID, V2Event};
use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_plugin::abi::{self, v2};
use opencode_tui::panel::{Presentation, Target};
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

const CHANNEL: &str = "test";

struct Tabs {
    harness: Harness,
    memory: Memory,
    state: PathBuf,
    _home: opencode_util::temp::TempDir,
}

deref_harness!(Tabs);

fn routes() -> Vec<MemoryRoute> {
    let mut routes: Vec<MemoryRoute> = [("ses_a", "Fix the parser"), ("ses_b", "Write the docs")]
        .iter()
        .flat_map(|(id, title)| support::session_routes(&support::test_session(id, title)))
        .collect();
    routes.push(MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })));
    routes.push(MemoryRoute::json("GET", "/api/config", 200, &json!([])));
    routes
}

fn mount(width: u16, config: Value) -> Tabs {
    let home = opencode_util::temp::tempdir().unwrap();
    let paths = support::home_paths(home.path());
    std::fs::create_dir_all(&paths.state).unwrap();
    let state = paths.state.clone();
    let memory = Memory::new(routes());
    let deps = Deps {
        config: support::config(support::decode(&config.to_string())),
        roots: support::roots(paths, CHANNEL),
        events: true,
        ..support::deps(Arc::new(memory.clone()))
    };
    let harness = Tabs { harness: support::mount(width, 30, deps), memory, state, _home: home };
    harness.wait_for("Fix the parser");
    harness
}

impl Tabs {
    fn open(&self, id: &str) {
        self.tui.navigate(support::session_route(id));
        let opened = self.app.wait_until(WAIT, || self.ids().iter().any(|tab| tab == id));
        assert!(opened, "no {id} tab: {:?}", self.ids());
    }

    /// Waits until the tabs are `ids` and the route is the session `route`, or home.
    fn wait_tabs(&self, ids: &[&str], route: Option<&str>) {
        let route = route.map_or(Route::Home, support::session_route);
        let found = self.app.wait_until(WAIT, || self.ids() == ids && *self.tui.route() == route);
        assert!(found, "tabs {:?}, route {:?}", self.ids(), self.tui.route());
    }

    fn file(&self, key: &str) -> Value {
        let path = self.state.join(CHANNEL).join("tui").join(format!("{key}.json"));
        std::fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or(Value::Null)
    }

    /// Waits until `key`'s file satisfies `check`.
    fn wait_file(&self, key: &str, check: impl Fn(&Value) -> bool) -> Value {
        let found = self.app.wait_until(WAIT, || check(&self.file(key)));
        let value = self.file(key);
        assert!(found, "{key}.json: {value}");
        value
    }

    fn ids(&self) -> Vec<String> {
        self.tui.tabs.tabs(&self.tui).iter().map(|tab| tab.session_id.clone()).collect()
    }

    /// Waits for the work a tab change started to land before a measurement: the tab file it wrote lists `tabs`, the
    /// storage watch's debounced reload has run, and the reads the tabs prefetch are answered. Their replies are
    /// output, not idle; counting them would make a measurement depend on when those threads ran.
    fn settled(&self, tabs: &Value) {
        self.wait_file("tabs", |file| file["cwd"][cwd()]["tabs"] == *tabs);
        // The watch debounces a write by 50 ms and nothing says when it reloads, so that time passes here, while the
        // app's mail is drained.
        self.app.wait_until(std::time::Duration::from_millis(100), || false);
        let quiet = self.app.wait_until(WAIT, || {
            self.app.render();
            self.memory.in_flight() == 0 && !self.app.needs_frame()
        });
        assert!(quiet, "the work the app started did not land");
    }
}

/// The stored tabs once both sessions are open and their titles have loaded.
fn both_tabs() -> Value {
    json!([{ "sessionID": "ses_a", "title": "Fix the parser" }, { "sessionID": "ses_b", "title": "Write the docs" }])
}

/// The stored tabs once the busy session's tab is closed.
fn only_b() -> Value {
    json!([{ "sessionID": "ses_b", "title": "Write the docs" }])
}

fn cwd() -> String {
    std::env::current_dir().unwrap().to_string_lossy().into_owned()
}

#[test]
fn tabs_open_close_and_persist_in_the_cwd_scope() {
    let h = mount(100, json!({ "animations": false }));
    h.open("ses_b");
    let screen = h.wait_for("Write the docs");
    assert!(screen.lines().next().unwrap().contains("Fix the parser"), "{screen}");
    let file = h.wait_file("tabs", |file| file["cwd"][cwd()]["tabs"] == both_tabs());
    assert_eq!(file["cwd"][cwd()]["unread"], json!({}));
    // A background tab's rename reaches the strip.
    h.memory.emit(&json!({
        "id": "evt_1", "created": 3, "type": "session.renamed",
        "durable": { "aggregateID": "ses_a", "seq": 1, "version": 1 },
        "location": { "directory": "/project" },
        "data": { "sessionID": "ses_a", "title": "Parse it all" },
    }));
    let screen = h.wait_for("Parse it all");
    assert!(screen.lines().next().unwrap().contains("Parse it all"), "{screen}");

    h.app.press("ctrl+x");
    h.app.press("w");
    h.wait_tabs(&["ses_a"], Some("ses_a"));
    h.app.press("ctrl+shift+t");
    h.wait_tabs(&["ses_a", "ses_b"], Some("ses_b"));
}

#[test]
fn deleting_the_open_tab_selects_another_without_a_toast() {
    let h = mount(100, json!({ "animations": false }));
    h.open("ses_b");
    h.wait_for("Write the docs");
    h.memory.emit(&json!({
        "id": "evt_1", "created": 3, "type": "session.deleted",
        "durable": { "aggregateID": "ses_b", "seq": 1, "version": 1 },
        "location": { "directory": "/project" },
        "data": { "sessionID": "ses_b" },
    }));
    let moved = h.app.wait_until(WAIT, || *h.tui.route() == support::session_route("ses_a"));
    assert!(moved, "{:?}", h.tui.route());
    assert_eq!(h.ids(), ["ses_a"]);
    assert!(!h.app.text().contains("was deleted"), "{}", h.app.text());
}

#[test]
fn clear_closes_the_tab_and_goes_home() {
    let h = mount(100, json!({ "animations": false }));
    h.open("ses_b");
    h.wait_for("Write the docs");
    h.tui.keymap.dispatch("session.clear", None);
    h.wait_tabs(&["ses_a"], None);
    let screen = h.wait_for("New session");
    assert!(screen.lines().next().unwrap().contains("Fix the parser"), "{screen}");
}

// Open tabs retain transcripts; background retention keeps the three most recently viewed roots.
#[test]
fn only_the_last_three_viewed_sessions_keep_their_transcripts() {
    let ids: Vec<String> = (1..=6).map(|n| format!("ses_{n}")).collect();
    let mut routes = vec![
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/config", 200, &json!([])),
    ];
    for id in &ids {
        let path = format!("/api/session/{id}");
        let message = json!({ "id": format!("msg_{id}"), "type": "user", "text": format!("Hello from {id}"), "time": { "created": 1 } });
        routes.push(MemoryRoute::json("GET", &path, 200, &json!({ "data": support::test_session(id, id) })));
        routes.push(MemoryRoute::json(
            "GET",
            &format!("{path}/message"),
            200,
            &json!({ "data": [message], "cursor": {} }),
        ));
        for list in ["inbox", "permission", "form"] {
            routes.push(MemoryRoute::json("GET", &format!("{path}/{list}"), 200, &json!({ "data": [] })));
        }
    }
    let deps = Deps {
        config: support::config(support::decode(r#"{ "animations": false, "tabs": { "mode": "off" } }"#)),
        ..support::deps(Arc::new(Memory::new(routes)))
    };
    let h = support::mount(100, 30, deps);
    for id in &ids {
        h.tui.navigate(support::session_route(id));
        h.wait_for(&format!("Hello from {id}"));
    }
    h.tui.navigate(Route::Home);
    let loaded = |id: &String| h.tui.data.read(|state| !state.messages(&SessionID(id.clone())).is_empty());
    let kept = h.app.wait_until(WAIT, || ids.iter().filter(|id| loaded(id)).count() == 3);
    let held: Vec<_> = ids.iter().filter(|id| loaded(id)).collect();
    assert!(kept, "{held:?}");
    assert_eq!(held, ids[3..].iter().collect::<Vec<_>>());
}

#[test]
fn a_background_tab_reads_its_pending_permission() {
    let home = opencode_util::temp::tempdir().unwrap();
    let paths = support::home_paths(home.path());
    let storage = paths.state.join(CHANNEL).join("tui");
    std::fs::create_dir_all(&storage).unwrap();
    let mut tabs = json!({ "cwd": {} });
    tabs["cwd"][cwd()] = json!({ "tabs": [{ "sessionID": "ses_a" }, { "sessionID": "ses_b" }] });
    std::fs::write(storage.join("tabs.json"), tabs.to_string()).unwrap();
    let mut routes = routes();
    let request = json!({ "id": "per_1", "sessionID": "ses_b", "action": "read", "resources": ["notes.md"] });
    routes.insert(0, MemoryRoute::json("GET", "/api/session/ses_b/permission", 200, &json!({ "data": [request] })));
    let deps = Deps {
        config: support::config(support::decode(r#"{ "animations": false }"#)),
        roots: support::roots(paths, CHANNEL),
        route: support::session_route("ses_a"),
        events: true,
        ..support::deps(Arc::new(Memory::new(routes)))
    };
    let h = support::mount(100, 30, deps);
    h.wait_for("Fix the parser");
    let waiting = h.app.wait_until(WAIT, || {
        h.app.advance(std::time::Duration::from_millis(100));
        h.tui.tabs.status(&h.tui, "ses_b").attention.is_some()
    });
    assert!(waiting, "{}", h.app.text());
}

#[test]
fn closing_a_session_whose_tab_another_tui_closed_selects_its_former_neighbour() {
    let home = opencode_util::temp::tempdir().unwrap();
    let paths = support::home_paths(home.path());
    let storage = paths.state.join(CHANNEL).join("tui");
    std::fs::create_dir_all(&storage).unwrap();
    let file = |ids: &[&str]| {
        let mut tabs = json!({ "cwd": {} });
        tabs["cwd"][cwd()] = json!({ "tabs": ids.iter().map(|id| json!({ "sessionID": id })).collect::<Vec<_>>() });
        tabs.to_string()
    };
    std::fs::write(storage.join("tabs.json"), file(&["ses_a", "ses_b", "ses_c"])).unwrap();
    let mut routes = routes();
    routes.splice(0..0, support::session_routes(&support::test_session("ses_c", "Ship the release")));
    let deps = Deps {
        config: support::config(support::decode(r#"{ "animations": false }"#)),
        roots: support::roots(paths, CHANNEL),
        route: support::session_route("ses_b"),
        events: true,
        ..support::deps(Arc::new(Memory::new(routes)))
    };
    let h = support::mount(100, 30, deps);
    h.wait_for("Write the docs");
    let ids = || h.tui.tabs.tabs(&h.tui).iter().map(|tab| tab.session_id.clone()).collect::<Vec<_>>();

    h.tui
        .storage()
        .unwrap()
        .update("tabs", &json!({}), |value| *value = serde_json::from_str(&file(&["ses_a", "ses_c"])).unwrap())
        .unwrap();
    assert!(h.app.wait_until(WAIT, || ids() == ["ses_a", "ses_c"]), "{:?}", ids());
    assert_eq!(*h.tui.route(), support::session_route("ses_b"));

    opencode_tui::tabs::close(&h.tui, None);
    let moved = h.app.wait_until(WAIT, || *h.tui.route() == support::session_route("ses_c"));
    assert!(moved, "{:?}", h.tui.route());
    assert_eq!(ids(), ["ses_a", "ses_c"]);
}

// A held file lock should delay the write but leave the UI responsive.
#[test]
fn a_held_tabs_lock_does_not_block_the_ui() {
    let h = mount(100, json!({ "animations": false }));
    h.wait_file("tabs", |file| !file.is_null());
    let file = h.state.join(CHANNEL).join("tui").join("tabs.json");
    let locks = h.state.join(CHANNEL).join("locks");
    let lock = opencode_local::lock::acquire(&locks, &file.to_string_lossy(), &Default::default()).unwrap();
    let releaser = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        lock.release().unwrap();
    });
    let started = std::time::Instant::now();
    h.tui.navigate(support::session_route("ses_b"));
    std::thread::sleep(std::time::Duration::from_millis(200));
    opencode_tui::tabs::reorder(&h.tui, "ses_b", 0);
    let elapsed = started.elapsed();
    assert!(elapsed < std::time::Duration::from_secs(1), "the UI waited {elapsed:?} for the lock");
    releaser.join().unwrap();
    // Both writes land, in order, once the lock is free.
    h.wait_file("tabs", |file| {
        let tabs = file["cwd"][cwd()]["tabs"].as_array().cloned().unwrap_or_default();
        tabs.iter().map(|tab| tab["sessionID"].clone()).collect::<Vec<_>>() == [json!("ses_b"), json!("ses_a")]
    });
}

// Another client writing `tabs.json` while this one's writes wait on its lock: the reload replays them over the
// file, so the tab and its normalized title stay, and land in the file once the lock is free.
#[test]
fn a_reload_keeps_the_writes_held_behind_the_lock() {
    let h = mount(120, json!({ "animations": false, "tabs": { "layout": "vertical" } }));
    h.wait_file("tabs", |file| !file.is_null());
    let storage = h.state.join(CHANNEL).join("tui");
    let file = storage.join("tabs.json");
    let locks = h.state.join(CHANNEL).join("locks");
    let lock = opencode_local::lock::acquire(&locks, &file.to_string_lossy(), &Default::default()).unwrap();
    let title = |id: &str| {
        let tabs = h.tui.tabs.tabs(&h.tui);
        tabs.iter().find(|tab| tab.session_id == id).and_then(|tab| tab.title.clone())
    };
    h.tui.navigate(support::session_route("ses_b"));
    let titled = h.app.wait_until(WAIT, || title("ses_b").as_deref() == Some("Write the docs"));
    assert!(titled, "{:?}", h.tui.tabs.tabs(&h.tui));

    // The other client, holding the lock, writes its tabs and then the layout; the rail shows the reload.
    let mut other = json!({ "cwd": {} });
    other["cwd"][cwd()] = json!({ "tabs": [{ "sessionID": "ses_a", "title": "Fix the parser" }] });
    std::fs::write(&file, other.to_string()).unwrap();
    std::fs::write(storage.join("layout.json"), json!({ "verticalTabsWidth": 50 }).to_string()).unwrap();
    let reloaded = h.app.wait_until(WAIT, || h.tui.frame.rail_width(&h.tui) == 50);
    assert!(reloaded, "rail {}", h.tui.frame.rail_width(&h.tui));
    assert_eq!(title("ses_b").as_deref(), Some("Write the docs"), "{:?}", h.tui.tabs.tabs(&h.tui));

    lock.release().unwrap();
    h.wait_file("tabs", |file| file["cwd"][cwd()]["tabs"] == both_tabs());
}

// A `session.deleted` in a burst of signals the store passes on while the UI is busy still closes its tab.
#[test]
fn a_deletion_in_a_burst_of_signals_still_closes_its_tab() {
    let h = mount(100, json!({ "animations": false }));
    h.open("ses_b");
    h.tui.navigate(support::session_route("ses_a"));
    h.wait_for("Write the docs");
    let _listening = opencode_tui::features::events::subscribe(&h.tui, [EventKind::FilesystemChanged], |_, _| {});
    let deleted = json!({
        "id": "evt_deleted", "created": 3, "type": "session.deleted",
        "durable": { "aggregateID": "ses_b", "seq": 1, "version": 1 },
        "location": { "directory": "/project" },
        "data": { "sessionID": "ses_b" },
    });
    let burst = (0..2048).map(|id| {
        json!({
            "id": format!("evt_fs_{id}"), "created": 4, "type": "filesystem.changed",
            "location": { "directory": "/project" }, "data": { "file": format!("src/{id}.rs"), "event": "change" },
        })
    });
    let events: Vec<_> =
        std::iter::once(deleted).chain(burst).map(|event| serde_json::from_value::<V2Event>(event).unwrap()).collect();
    // The UI thread is busy: nothing drains its queue until it is full.
    let proxy = h.app.proxy();
    while proxy.post(|_| {}) != Err(opentui::app::ProxyError::Full) {}
    h.tui.data.apply(events);
    h.wait_tabs(&["ses_a"], Some("ses_a"));
}

#[test]
fn a_closed_busy_tab_stops_the_pulse_ticks() {
    let h = mount(100, json!({}));
    h.open("ses_b");
    h.wait_for("Write the docs");
    // The app at rest, after the startup's one-off timers, its tab write and the reads it prefetched.
    h.settled(&both_tabs());
    let rest = h.app.idle(std::time::Duration::from_secs(8));
    let event = json!({
        "id": "evt_1", "created": 10_000, "type": "session.execution.started",
        "durable": { "aggregateID": "ses_a", "seq": 1, "version": 1 },
        "data": { "sessionID": "ses_a" },
    });
    h.tui.data.apply(vec![serde_json::from_value::<V2Event>(event).unwrap()]);
    h.app.render();
    h.app.advance(std::time::Duration::from_millis(200));
    assert!(h.app.needs_frame(), "a busy tab pulses");
    opencode_tui::tabs::close(&h.tui, Some("ses_a"));
    h.wait_tabs(&["ses_b"], Some("ses_b"));
    let still = h.app.wait_until(WAIT, || {
        h.app.render();
        h.app.advance(std::time::Duration::from_millis(200));
        !h.app.needs_frame()
    });
    assert!(still, "a closed tab still ticks");
    // The same in `App::run`'s loop: once the close's one-off timers have run and its writes and reads have landed,
    // a closed tab costs what the app costs at rest. A pulse wakes the loop every 50 ms (about 160 times in 8 s); a
    // reply that lands late costs a frame or two, so the window is bounded well under a pulse, not at an exact count.
    h.settled(&only_b());
    let closed = h.app.idle(std::time::Duration::from_secs(8));
    assert!(closed.frames <= 4, "{closed:?}, at rest {rest:?}");
    assert!(closed.wakeups <= rest.wakeups + closed.frames, "{closed:?}, at rest {rest:?}");
}

#[test]
fn a_busy_tab_paints_on_its_own_and_stops_when_idle() {
    let execution = |kind: &str, seq: u64| {
        let event = json!({
            "id": format!("evt_{seq}"), "created": 10_000 + seq, "type": format!("session.execution.{kind}"),
            "durable": { "aggregateID": "ses_a", "seq": seq, "version": 1 },
            "data": { "sessionID": "ses_a" },
        });
        serde_json::from_value::<V2Event>(event).unwrap()
    };
    let vertical = json!({ "tabs": { "layout": "vertical" } });
    for (name, config, compact, busy) in [
        ("strip", json!({ "tabs": { "layout": "horizontal" } }), false, 160usize),
        ("rail", vertical.clone(), false, 160),
        ("compact rail", vertical, true, 100),
        ("compact rail, no animations", json!({ "animations": false, "tabs": { "layout": "vertical" } }), true, 0),
        ("compact rail, numbers", json!({ "tabs": { "layout": "vertical", "indicators": "numbers" } }), true, 0),
    ] {
        let h = mount(120, config);
        h.open("ses_b");
        h.wait_for("Write the docs");
        if compact {
            h.app.drag((41, 10), (5, 10));
            assert!(h.app.wait_until(WAIT, || h.tui.frame.rail_width(&h.tui) == 6), "{name}");
        }
        // The first pass takes the startup's one-off timers. Idle, a retry of a read the fixture leaves unanswered
        // may still paint once.
        frames(&h);
        assert!(frames(&h).len() <= 1, "{name}: idle");
        // The app's other timers, which wake `App::run`'s loop without a frame.
        let rest = h.app.idle(std::time::Duration::from_secs(8));
        h.app.advance(std::time::Duration::from_millis(30));
        h.tui.data.apply(vec![execution("started", 1)]);
        if compact && busy > 0 {
            // The change lands before the spinner first paints, so only that paint can ask for the next step.
            assert!(h.app.wait_until(WAIT, || h.tui.tabs.status(&h.tui, "ses_a").busy), "{name}: not busy");
            h.app.wait_until(std::time::Duration::from_millis(300), || false);
            let text = h.app.render().text();
            assert!(text.contains(|glyph| ('⠁'..='⣿').contains(&glyph)), "{name}: no spinner\n{text}");
            h.app.advance(std::time::Duration::from_millis(80));
            assert!(h.app.needs_frame(), "{name}: no step after 80 ms");
        }
        // A frame up to half an interval before a due time runs its tick, so the first may fall just before.
        let busy_frames = frames(&h);
        let range = busy.saturating_sub(1)..=busy + 2;
        assert!(range.contains(&busy_frames.len()), "{name}: busy, {} frames", busy_frames.len());
        if compact {
            let steps = busy_frames.windows(2).all(|pair| (pair[1] - pair[0]) % 80 == 0);
            assert!(steps, "{name}: off the spinner's steps, {busy_frames:?}");
        }
        // The same in `App::run`'s loop, which sleeps until the next timer or frame slot: each paint arms the next
        // tick, and the loop wakes for nothing more than at rest.
        let idle = h.app.idle(std::time::Duration::from_secs(8));
        let busy = busy as u64;
        assert!((busy.saturating_sub(1)..=busy + 2).contains(&idle.frames), "{name}: idle loop, {idle:?}");
        assert!(idle.wakeups <= idle.frames + rest.wakeups, "{name}: idle loop, {idle:?}, at rest {rest:?}");
        if busy > 0 {
            let frames = opencode_ui::motion::SPINNER_FRAMES;
            let glyph = || {
                let text = h.app.text();
                let glyph = text.chars().find(|glyph| ('⠁'..='⣿').contains(glyph));
                glyph.and_then(|glyph| frames.iter().position(|frame| frame.starts_with(glyph)))
            };
            let first = glyph().unwrap_or_else(|| panic!("{name}: no spinner"));
            h.app.advance(opencode_ui::motion::SPINNER_INTERVAL * 5);
            assert_eq!(glyph(), Some((first + 5) % frames.len()), "{name}: a late frame");
            if name.contains("rail") {
                h.app.resize(60, 30);
                h.app.render();
                h.app.advance(opencode_ui::motion::SPINNER_INTERVAL * 3);
                assert_eq!(glyph(), Some(3), "{name}: the strip");
                h.app.resize(120, 30);
                assert_eq!(glyph(), Some(0), "{name}: the rail shown again");
                h.app.resize(60, 30);
                assert_eq!(glyph(), Some(0), "{name}: the strip shown again");
                h.app.resize(120, 30);
            }
        }
        h.app.resize(60, 30);
        h.tui.data.apply(vec![execution("succeeded", 2)]);
        frames(&h);
        assert!(frames(&h).len() <= 1, "{name}: idle again");
        let again = h.app.idle(std::time::Duration::from_secs(8));
        assert!(again.frames <= 1 && again.wakeups <= rest.wakeups + again.frames, "{name}: {again:?}, {rest:?}");
    }
}

// `tabs.select` is `route.navigate`, a reconcile of the route store: the session already shown stays as it is. A
// remount scrolled the transcript to its end for a frame, then back to the row it was read at (a flicker).
#[test]
fn clicking_the_open_tab_leaves_the_transcript_as_it_is() {
    let mut routes = routes();
    let messages: Vec<Value> = (1..=40)
        .rev()
        .map(|n| json!({ "id": format!("msg_{n:02}"), "type": "user", "text": format!("Line {n}"), "time": { "created": n } }))
        .collect();
    let path = "/api/session/ses_a/message";
    routes.insert(0, MemoryRoute::json("GET", path, 200, &json!({ "data": messages, "cursor": {} })));
    let home = opencode_util::temp::tempdir().unwrap();
    let paths = support::home_paths(home.path());
    let config = json!({ "animations": false, "session": { "sidebar": "hide" }, "tabs": { "layout": "vertical" } });
    let deps = Deps {
        config: support::config(support::decode(&config.to_string())),
        roots: support::roots(paths, CHANNEL),
        ..support::deps(Arc::new(Memory::new(routes)))
    };
    let h = support::mount(120, 30, deps);
    h.wait_for("Line 40");
    for _ in 0..5 {
        h.app.scroll(80, 10, false);
    }
    let tab = || {
        let text = h.app.render().text();
        let (row, line) = text.lines().enumerate().find(|(_, line)| line.contains("Fix the parser")).unwrap();
        (line[..line.find("Fix the parser").unwrap()].chars().count() as u16 + 2, row as u16)
    };
    let (x, y) = tab();
    h.app.hover(x, y);
    let before = h.app.render().text();
    assert!(!before.contains("Line 40"), "not scrolled up:\n{before}");

    h.app.click(x, y);
    let mut painted = Vec::new();
    for _ in 0..500 {
        h.app.advance(std::time::Duration::from_millis(1));
        if h.app.needs_frame() {
            painted.push(h.app.render().text());
        }
    }
    painted.push(h.app.render().text());
    let changed = painted.iter().find(|text| **text != before);
    assert!(changed.is_none(), "before:\n{before}\nafter:\n{}", changed.unwrap());
}

/// The frames painted over 8 s without input, one each time the app asks for one, as `App::event_loop` does, in
/// milliseconds from the first. The requests in flight land first: their replies are output, not idle.
fn frames(h: &Tabs) -> Vec<u128> {
    h.app.wait_until(std::time::Duration::from_millis(300), || {
        h.app.render();
        false
    });
    let start = h.app.now();
    (0..8000)
        .filter_map(|_| {
            h.app.advance(std::time::Duration::from_millis(1));
            h.app.needs_frame().then(|| {
                h.app.render();
                h.app.now().duration_since(start).as_millis()
            })
        })
        .collect()
}

#[test]
fn a_split_panel_shows_beside_the_session_and_resizes() {
    let h = mount(140, json!({ "animations": false, "session": { "sidebar": "hide" } }));
    let setup = |setup: &mut abi::Setup| {
        setup.surface(v2::Surface::new("diff", v2::Place::Panel("diff".into()), |cx| {
            let abi::Route::Session { id } = cx.read.route() else { return v2::Node::column(Vec::new()) };
            v2::Node::text(vec![abi::Span::new(format!("panel for {id}"))])
        }));
        Ok(())
    };
    opencode_tui::plugins::host::add(&h.tui, abi::Plugin { id: "test", setup }.into());
    let target = Target { plugin: "test".into(), name: "diff".into(), session: "ses_a".into() };
    h.tui.panels.open(&h.tui, target, Presentation::Panel);
    let screen = h.wait_for("panel for ses_a");
    // The default width is half the panel width (140), so the panel starts at column 70.
    let row = screen.lines().find(|line| line.contains("panel for")).unwrap();
    assert_eq!(row.chars().position(|c| c == 'p'), Some(70), "{screen}");

    h.app.hover(69, 10);
    h.app.drag((69, 10), (89, 10));
    let column = || {
        h.app.text().lines().find(|line| line.contains("panel for")).and_then(|row| row.chars().position(|c| c == 'p'))
    };
    assert!(h.app.wait_until(WAIT, || column() == Some(90)), "{}", h.app.text());
    h.wait_file("layout", |layout| layout["paneWidth"] == 50);
    // A drag to the far edge stops where the session keeps its minimum width.
    h.app.hover(89, 10);
    h.app.drag((89, 10), (1, 10));
    assert!(h.app.wait_until(WAIT, || column().is_some_and(|at| (20..70).contains(&at))), "{}", h.app.text());
    // Without room for both panes the panel takes the whole width.
    h.app.resize(100, 30);
    assert!(h.app.wait_until(WAIT, || column().is_some_and(|at| at < 10)), "{}", h.app.text());

    h.open("ses_b");
    assert!(h.app.wait_until(WAIT, || h.tui.panels.current().is_none()));
}

#[test]
fn tabs_and_layout_are_shared_with_the_typescript_client() {
    let Some(script) = support::oracle("E.12-tabs.ts") else { return };
    let h = mount(120, json!({ "animations": false, "tabs": { "layout": "vertical" } }));
    h.open("ses_b");
    h.wait_file("tabs", |file| file["cwd"][cwd()]["tabs"] == both_tabs());
    h.app.drag((41, 10), (30, 10));
    h.wait_file("layout", |layout| layout["verticalTabsWidth"] == 31);

    let state = h.state.to_string_lossy().into_owned();
    let read = run(&script, &["load", &state, CHANNEL]);
    assert_eq!(read["tabs"]["cwd"][cwd()]["tabs"], both_tabs());
    assert_eq!(read["layout"]["verticalTabsWidth"], 31);

    run(&script, &["move", &state, CHANNEL, &cwd(), "ses_b", "0"]);
    run(&script, &["width", &state, CHANNEL, "50"]);
    let reloaded = h.app.wait_until(WAIT, || h.ids() == ["ses_b", "ses_a"] && h.tui.frame.rail_width(&h.tui) == 50);
    assert!(reloaded, "tabs {:?}, rail {}", h.ids(), h.tui.frame.rail_width(&h.tui));
}

fn run(script: &Path, args: &[&str]) -> Value {
    let mut command = Command::new("bun");
    command
        .current_dir(script.parent().unwrap().parent().unwrap())
        .arg(script)
        .args(args)
        .env("BUN_RUNTIME_TRANSPILER_CACHE_PATH", std::env::temp_dir().join("opencode-rs-e12-bun-cache"));
    support::bun_json(&mut command, None)
}

#[test]
fn a_hovered_tab_scrolls_its_overflowing_title_and_resets_when_left() {
    let title = "Trace the flaky marquee across every terminal";
    let mut routes = routes();
    routes.splice(0..0, support::session_routes(&support::test_session("ses_m", title)));
    let home = opencode_util::temp::tempdir().unwrap();
    let paths = support::home_paths(home.path());
    let config = json!({ "session": { "sidebar": "hide" }, "tabs": { "layout": "vertical" } });
    let deps = Deps {
        config: support::config(support::decode(&config.to_string())),
        roots: support::roots(paths, CHANNEL),
        ..support::deps(Arc::new(Memory::new(routes)))
    };
    let h = support::mount(120, 30, deps);
    h.tui.navigate(support::session_route("ses_m"));
    h.wait_for("Trace the");
    // The rail's row of the tab: the title starts at its text.
    let row = |h: &Harness| {
        let text = h.app.render().text();
        let (y, line) = text
            .lines()
            .enumerate()
            .find(|(_, line)| line.contains("Trace the"))
            .map(|(y, line)| (y, line.to_owned()))
            .unwrap();
        (y as u16, line)
    };
    let (y, resting) = row(&h);
    let x = resting[..resting.find("Trace").unwrap()].chars().count() as u16;
    h.app.hover(x, y);
    // Not before the delay: the hovered title only loses the cell the close mark takes.
    h.app.advance(std::time::Duration::from_millis(500));
    assert!(h.app.render().text().lines().nth(y as usize).unwrap().contains("Trace the"));
    h.app.advance(std::time::Duration::from_millis(100 + 80 * 5));
    let scrolled = h.app.render().text().lines().nth(y as usize).unwrap().to_owned();
    assert!(!scrolled.contains("Trace") && scrolled.contains("the flaky"), "not scrolled:\n{scrolled}");

    h.app.hover(80, 20);
    let left = h.app.render().text().lines().nth(y as usize).unwrap().to_owned();
    assert!(left.contains("Trace the"), "not reset:\n{left}");
    h.app.advance(std::time::Duration::from_millis(1000));
    assert!(h.app.render().text().lines().nth(y as usize).unwrap().contains("Trace the"));
}

#[test]
fn a_reload_keeps_the_rail_width_a_drag_committed() {
    let h = mount(120, json!({ "tabs": { "layout": "vertical" } }));
    h.open("ses_b");
    h.wait_for("Write the docs");
    let storage = h.tui.storage().expect("storage");
    let file = storage.file("layout").expect("layout file");
    let locks = storage.directory().parent().expect("storage root").join("locks");
    // Hold the layout file so the drag's write stays queued, as a reload can find it.
    let lock = opencode_local::lock::acquire(&locks, &file.to_string_lossy(), &Default::default()).expect("lock");
    h.app.drag((41, 10), (5, 10));
    assert!(h.app.wait_until(WAIT, || h.tui.frame.rail_width(&h.tui) == 6), "no compact rail");
    // A reload that reads the layout before the drag's write landed keeps the drag.
    opencode_tui::frame::reload(&h.tui, &storage);
    assert_eq!(h.tui.frame.rail_width(&h.tui), 6, "a reload reset the rail a drag committed");
    lock.release().expect("release");
    h.wait_file("layout", |layout| layout["verticalTabsWidth"] == 6);
    // Once that write has landed, another client's width applies, as the TypeScript client's does.
    storage.update("layout", &json!({}), |value| value["verticalTabsWidth"] = json!(50)).expect("write layout");
    let applied = h.app.wait_until(WAIT, || {
        opencode_tui::frame::reload(&h.tui, &storage);
        h.tui.frame.rail_width(&h.tui) == 50
    });
    assert!(applied, "another client's width did not apply: rail {}", h.tui.frame.rail_width(&h.tui));
}
