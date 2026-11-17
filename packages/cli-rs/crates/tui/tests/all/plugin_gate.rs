//! P1's gate probe on the production route (synthesis 4.14; bigboi's review, 6). Ignored: a release build runs it
//! with `GATE_OUT=<file.jsonl>` and `--ignored plugin_gate::`, and writes JSON lines, one an action or a frame:
//!
//! - `today`: the diff viewer (host code until P6c, the plugin `opencode.diffs` since), from the dispatch that opens it
//!   to its first usable frame, the data load included; then hunk jumps, mark reviewed, view toggles, wheel steps and a
//!   resize. `today-narrow` (P6c) runs it at 48 by 28 cells, resized to 24 columns, over the files of `narrow`.
//! - `route`: the same cards from a linked plugin through `Setup::surface` on its route: open by navigation, the
//!   route's own commands through the keymap, wheel steps over its scroll, and a resize. The view, the host's
//!   dispatch and adoption, and each frame are timed apart, with the reconcile's counts.
//! - `parts`: where an open, a toggle and a resize of the cards go: making the syntax theme, building the patches,
//!   the first frame, the view toggle and the resize, each alone.
//! - `list` (P3): the route's cards as a windowed list, which builds only the cards near the view.
//! - `narrow` (P3, big-boi's review): the list at 48 by 28 cells, resized to 24 columns, of files of 30, 1, 5, 2 and
//!   12 hunks of 25 lines in turn, each estimated at 40 rows: modified cards far taller than their estimates, in a
//!   pane where their lines wrap.
//!
//! `GATE_SIZES` (default `40,410,1000`) sets the files, `GATE_PARTS` the parts. `GATE_VERIFY=off` turns off
//! `TestApp`'s check of each frame, which a terminal app does not run. Native layout rounds are counted per frame;
//! OpenTUI does not time a round apart.

use crate::support;

use std::cell::RefCell;
use std::fmt::Write as _;
use std::io::Write as _;
use std::sync::Arc;
use std::time::{Duration, Instant};

use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_plugin::abi::{self, v2};
use opencode_plugin::reconcile;
use opencode_tui::{Deps, Route};
use opentui::prelude::*;
use serde_json::{Value, json};

const WIDTH: u16 = 200;
const HEIGHT: u16 = 58;
const FRAME_CAP: usize = 60;

fn out() -> std::fs::File {
    let path = std::env::var("GATE_OUT").expect("GATE_OUT");
    std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap()
}

/// Writes `line` to `GATE_OUT`; without it (the negative control) nothing is written.
fn write(line: Value) {
    if std::env::var_os("GATE_OUT").is_some() {
        writeln!(out(), "{line}").unwrap();
    }
}

fn micros(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1e6
}

#[allow(unsafe_code)]
fn rounds(app: &App) -> u32 {
    let session = app.session();
    let mut raw = opentui::sys::ot_scene_stats::default();
    let status = unsafe { opentui::sys::ot_scene_get_stats(session.context().as_raw(), &session.handle(), &mut raw) };
    assert_eq!(status, 0, "ot_scene_get_stats");
    raw.layout_rounds
}

/// A modified file of five hunks of 25 lines, 125 lines in all.
fn patch(file: usize) -> String {
    patch_of(file, 5)
}

/// A modified file of `hunks` hunks of 25 lines.
fn patch_of(file: usize, hunks: usize) -> String {
    let mut patch = format!(
        "diff --git a/src/f{file:04}.rs b/src/f{file:04}.rs\n--- a/src/f{file:04}.rs\n+++ b/src/f{file:04}.rs\n"
    );
    for hunk in 0..hunks {
        let start = 1 + hunk * 40;
        let _ = writeln!(patch, "@@ -{start},17 +{start},17 @@ fn hunk_{hunk}()");
        for line in 0..25 {
            let prefix = match line {
                0..=4 | 21..=24 => ' ',
                5..=12 => '-',
                _ => '+',
            };
            let _ = writeln!(patch, "{prefix}    let value_{file}_{hunk}_{line} = compute({line}, \"text\");");
        }
    }
    patch
}

/// Frames until the app wants no more: each frame's time and layout rounds, and the time to the first frame whose
/// text `usable` takes, from `since`.
fn frames(app: &support::Harness, since: Instant, usable: &dyn Fn(&str) -> bool) -> (Vec<Value>, Option<f64>, String) {
    let mut out = Vec::new();
    let mut first = None;
    let mut text = String::new();
    for _ in 0..FRAME_CAP {
        let started = Instant::now();
        let capture = app.app.render();
        out.push(json!({ "us": micros(started), "rounds": rounds(app.app.app()) }));
        text = capture.text();
        if first.is_none() && usable(&text) {
            first = Some(micros(since));
        }
        if !app.app.needs_frame() {
            break;
        }
    }
    (out, first, text)
}

// Today's viewer.

/// How [`today`] drives the viewer: its built-ins on the C ABI's byte shims (`GATE_CARRIER=abi`), and, for the negative
/// control only, actions that dispatch nothing.
#[derive(Clone, Copy, Default)]
struct Drive {
    abi: bool,
    noop: bool,
}

fn today(count: usize, narrow: bool, drive: Drive) {
    const DIRECTORY: &str = "/project";
    let location =
        json!({ "directory": DIRECTORY, "project": { "id": "proj", "directory": DIRECTORY, "canonical": DIRECTORY } });
    let list = |data: Value| json!({ "location": location, "data": data });
    let patch = |file: usize| if narrow { patch_of(file, [30, 1, 5, 2, 12][file % 5]) } else { patch(file) };
    let diff: Vec<Value> = (0..count)
        .map(|file| {
            json!({ "file": format!("src/f{file:04}.rs"), "patch": patch(file), "additions": 40, "deletions": 40,
                "status": "modified" })
        })
        .collect();
    let part = if narrow { "today-narrow" } else { "today" };
    let (width, height, resized, wheel) = if narrow { (48, 28, 24, (20, 14)) } else { (WIDTH, HEIGHT, 140, (120, 30)) };
    let memory = Memory::new(vec![
        MemoryRoute::json("GET", "/api/location", 200, &location),
        MemoryRoute::json("GET", "/api/agent", 200, &list(json!([]))),
        MemoryRoute::json("GET", "/api/model", 200, &list(json!([]))),
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/vcs/base", 200, &list(Value::Null)),
        MemoryRoute::json("GET", "/api/vcs/diff", 200, &list(Value::Array(diff))),
    ]);
    let config = json!({ "animations": false, "diffs": { "source": "working" } });
    let deps = Deps {
        config: support::config(support::decode(&config.to_string())),
        route: Route::Home,
        events: true,
        abi_builtins: drive.abi,
        ..support::deps(Arc::new(memory.clone()))
    };
    let harness = mount(width, height, deps);
    // A probe of the viewer's work, not of its budget: on a slow runner (Windows CI) its frames pass the 1 ms budget,
    // and the "Plugin is slow" notice would change the screen each action compares. The times it writes stay real.
    harness.tui.plugins.monitor().set_limits(opencode_plugin::contain::Limits {
        frame: Duration::from_secs(1),
        all: Duration::from_secs(1),
        overrun: Duration::from_secs(10),
        ..opencode_plugin::contain::Limits::default()
    });
    harness.wait_for("/project");
    frames(&harness, Instant::now(), &|_| false);
    // The open: the dispatch, the load and the first frame that shows the first file, all timed.
    let started = Instant::now();
    harness.tui.keymap.dispatch("diff.open", None);
    let dispatch_us = micros(started);
    let loaded = harness.app.wait_until(Duration::from_secs(60), || {
        memory.in_flight() == 0 && memory.requests().iter().any(|logged| logged.path == "/api/vcs/diff")
    });
    assert!(loaded, "the diff never loaded");
    let mut usable = None;
    let mut all = Vec::new();
    while usable.is_none() && started.elapsed() < Duration::from_secs(60) {
        let (frames, first, _) = frames(&harness, started, &|text| text.contains("src/f0000.rs"));
        all.extend(frames);
        usable = first;
        if usable.is_none() {
            harness.app.advance(Duration::from_millis(1));
        }
    }
    let usable = usable.expect("the open never showed the first file");
    write(json!({ "part": part, "files": count, "action": "open", "step": 0, "dispatch_us": dispatch_us,
        "usable_us": usable, "frames": all }));
    // Each action is checked after its frames, outside the time: a step that did nothing fails the probe.
    let shown = RefCell::new(harness.app.text());
    // The viewer's own calls (what its frame budget counts) and the host's work for its nodes, apart.
    let monitor = harness.tui.plugins.monitor();
    let spent = || {
        let us = |took: Duration| took.as_secs_f64() * 1e6;
        (us(monitor.calls_time("opencode.diffs")), us(monitor.host_time("opencode.diffs")))
    };
    let action = |name: &str, step: usize, moves: bool, run: &dyn Fn()| {
        let (calls, host) = spent();
        let work = reconcile::work();
        let started = Instant::now();
        if !drive.noop {
            run();
        }
        let dispatch_us = micros(started);
        let (frames, _, text) = frames(&harness, started, &|_| false);
        let ((calls_now, host_now), done) = (spent(), reconcile::work().since(work));
        write(json!({ "part": part, "files": count, "action": name, "step": step, "dispatch_us": dispatch_us,
            "frames": frames, "plugin_us": calls_now - calls, "host_us": host_now - host, "touched": done.touched(),
            "items": done.items, "kept": done.kept }));
        let before = shown.replace(text.clone());
        assert_eq!(
            text != before,
            moves,
            "{part} {count} {name} {step}: the screen {}:\n{text}",
            if moves { "did not change" } else { "changed" }
        );
    };
    let app = &harness.app;
    let key = |key: &'static str| move || app.press(key);
    let theme = |step: usize| {
        let name = if step.is_multiple_of(2) { "tokyonight" } else { "opencode" };
        assert!(harness.tui.theme.borrow_mut().set(name));
        harness.tui.theme_changed();
    };
    // One rebuild again and again, for a profile of it: `GATE_REPEAT=toggle_view:40` (or `mark_reviewed`, `theme`).
    if let Ok(repeat) = std::env::var("GATE_REPEAT") {
        let (name, times) = repeat.split_once(':').expect("GATE_REPEAT is <action>:<times>");
        for step in 0..times.parse().expect("GATE_REPEAT's times") {
            match name {
                "toggle_view" => action(name, step, !narrow, &key("v")),
                "mark_reviewed" => action(name, step, true, &key("m")),
                "theme" => action(name, step, false, &|| theme(step)),
                _ => panic!("GATE_REPEAT names no rebuild: {name}"),
            }
        }
        return;
    }
    for step in 0..5 {
        action("jump_hunk", step, true, &key("]"));
    }
    for step in 0..3 {
        action("mark_reviewed", step, true, &key("m"));
        // In the list of all files a mark toggles the selected file, so the count goes 1, 0, 1.
        let marked = format!("{}/{count}", 1 - step % 2);
        assert!(shown.borrow().contains(&marked), "{part} {count}: mark {step} does not show {marked}");
    }
    // At 48 columns split has no room, so the toggle changes nothing, as in TS.
    for step in 0..2 {
        action("toggle_view", step, !narrow, &key("v"));
    }
    // The palette changes no text: the viewer's surfaces read it, so a switch calls its view.
    for step in 0..2 {
        action("theme", step, false, &|| theme(step));
    }
    for step in 0..30 {
        action("wheel", step, true, &|| harness.app.scroll(wheel.0, wheel.1, true));
    }
    action("resize", 0, true, &|| harness.app.resize(resized, height));
}

// The plugin's route.

/// The plugin's model: the files' patches, the reviewed marks, the selection, the view, and the content handles of
/// its mount.
#[derive(Default)]
struct Gate {
    patches: Vec<String>,
    reviewed: Vec<bool>,
    selected: usize,
    split: bool,
    handles: Vec<Option<v2::ContentRef>>,
    generation: u64,
    view_us: f64,
    widths: Vec<u16>,
    /// P3: the cards are a windowed list, not a scroll's children.
    list: bool,
    /// The narrow gate's cards: estimated at 40 rows.
    narrow: bool,
}

thread_local! {
    static GATE: RefCell<Gate> = RefCell::default();
}

fn gate<T>(f: impl FnOnce(&mut Gate) -> T) -> T {
    GATE.with(|gate| f(&mut gate.borrow_mut()))
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command::new(name).scope(abi::Scope::Route("diff".into()));
    setup.command(command("gate.mark"), |_, _| {
        gate(|gate| {
            let selected = gate.selected;
            gate.reviewed[selected] = true;
            gate.selected = selected + 1;
        });
    });
    setup.command(command("gate.toggle"), |_, _| gate(|gate| gate.split = !gate.split));
    setup.surface(v2::Surface::new("diff", v2::Place::Route("diff".into()), view));
    Ok(())
}

/// A title over a scroll of cards, each a header row and the file's patch by content handle, memoized on what it
/// shows. The patches go to the host once a mount.
fn view(cx: &mut v2::View<'_>) -> v2::Node {
    let started = Instant::now();
    let (files, reviewed, selected, split, list) = gate(|gate| {
        if gate.generation != cx.mount.generation || cx.input.full {
            gate.generation = cx.mount.generation;
            gate.handles = vec![None; gate.patches.len()];
        }
        gate.widths.push(cx.input.width);
        (gate.patches.len(), gate.reviewed.clone(), gate.selected, gate.split, gate.list)
    });
    let cards = (0..files)
        .map(|file| {
            let (reviewed, selected) = (reviewed[file], selected == file);
            cx.memo(format!("card-{file}"), (reviewed, selected, split), |cx| {
                let handle = match gate(|gate| gate.handles[file]) {
                    Some(handle) => handle,
                    None => {
                        let handle = cx.content(gate(|gate| gate.patches[file].clone()));
                        gate(|gate| gate.handles[file] = Some(handle));
                        handle
                    }
                };
                let head = v2::Node::row(vec![
                    v2::Node::text(vec![abi::Span::new(format!("src/f{file:04}.rs"))]),
                    v2::Node::text(vec![abi::Span::new(if reviewed { " reviewed" } else { " +40 -40" })])
                        .fg("text.muted"),
                ])
                .bg(if selected { "background.raised.high" } else { "background.raised.base" });
                let body = v2::Node::diff(v2::Source::Content(handle))
                    .view(if split { v2::DiffView::Split } else { v2::DiffView::Unified })
                    .filetype("rust");
                v2::Node::column(vec![head, body])
            })
        })
        .collect::<Vec<_>>();
    // A card is its header and 125 patch rows with four hunk headers between; a narrow gate's are estimated at 40.
    let estimate = if gate(|gate| gate.narrow) { 40 } else { 130 };
    let scroll = match list {
        true => v2::Node::list(cards.into_iter().map(|card| v2::ListItem::new(card, estimate)).collect()),
        false => v2::Node::scroll(cards),
    };
    let scroll = scroll.with_id("files").layout(abi::Layout::default().grow());
    let node = v2::Node::column(vec![v2::Node::text(vec![abi::Span::new("gate diff")]), scroll])
        .layout(abi::Layout::default().grow());
    gate(|gate| gate.view_us += micros(started));
    node
}

fn route(count: usize, list: bool, narrow: bool) {
    let part = match (narrow, list) {
        (true, _) => "narrow",
        (false, true) => "list",
        (false, false) => "route",
    };
    let patches = match narrow {
        true => (0..count).map(|file| patch_of(file, [30, 1, 5, 2, 12][file % 5])).collect(),
        false => (0..count).map(patch).collect(),
    };
    gate(|gate| *gate = Gate { patches, reviewed: vec![false; count], list, narrow, ..Gate::default() });
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.gate", setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let (width, height, resized, wheel) = match narrow {
        true => (48, 28, 24, (20, 14)),
        false => (WIDTH, HEIGHT, 140, (120, 30)),
    };
    let harness = mount(width, height, deps);
    frames(&harness, Instant::now(), &|_| false);
    let action = |name: &str, step: usize, usable: &dyn Fn(&str) -> bool, run: &dyn Fn()| -> String {
        gate(|gate| gate.view_us = 0.0);
        let work = reconcile::work();
        let started = Instant::now();
        run();
        // The host's own work: the dispatch, what it deferred, the view and the adoption.
        harness.app.advance(Duration::ZERO);
        let host_us = micros(started);
        let (frames, usable_us, text) = frames(&harness, started, usable);
        let done = reconcile::work().since(work);
        let view_us = gate(|gate| gate.view_us);
        write(json!({ "part": part, "files": count, "action": name, "step": step, "host_us": host_us,
            "view_us": view_us, "usable_us": usable_us, "frames": frames, "created": done.created,
            "removed": done.removed, "set": done.set, "moved": done.moved, "kept": done.kept, "parses": done.parses }));
        text
    };
    let open = Route::Plugin { id: "test.gate".into(), name: "diff".into() };
    let screen =
        action("open", 0, &|text| text.contains("src/f0000.rs +40 -40"), &|| harness.tui.navigate(open.clone()));
    assert!(screen.contains("src/f0000.rs +40 -40"), "the open frame shows no card:\n{screen}");
    for step in 0..3 {
        let screen = action("mark_reviewed", step, &|_| true, &|| {
            let _ = harness.tui.keymap.dispatch("gate.mark", None);
        });
        // Only the first card is on the screen; it shows its mark.
        assert!(screen.contains("src/f0000.rs reviewed"), "mark {step} does not show:\n{screen}");
    }
    for step in 0..2 {
        action("toggle_view", step, &|_| true, &|| {
            let _ = harness.tui.keymap.dispatch("gate.toggle", None);
        });
    }
    let top = |screen: &str| screen.lines().nth(1).unwrap_or_default().to_owned();
    let before = top(&harness.app.render().text());
    for step in 0..30 {
        action("wheel", step, &|_| true, &|| harness.app.scroll(wheel.0, wheel.1, true));
    }
    assert_ne!(top(&harness.app.render().text()), before, "the wheel did not scroll the cards");
    action("resize", 0, &|_| true, &|| harness.app.resize(resized, height));
    let width = gate(|gate| gate.widths.last().copied());
    assert_eq!(width, Some(resized), "the view did not get the new width");
}

// Where the cards' time goes.

fn parts(count: usize) {
    let app = opentui::testing::TestApp::new(WIDTH, HEIGHT);
    let theme =
        opencode_ui::theme::Catalog::default().load("opencode", opencode_ui::theme::ThemeMode::Dark).unwrap().theme;
    let patches: Vec<String> = (0..count).map(patch).collect();
    let started = Instant::now();
    for _ in 0..count {
        drop(opencode_ui::code::syntax_theme(&theme));
    }
    let syntax_each_us = micros(started);
    let syntax = opencode_ui::code::syntax_theme(&theme);
    let started = Instant::now();
    let built: Vec<_> = patches
        .iter()
        .map(|patch| {
            opencode_ui::diff::Patch::new(
                &app,
                &theme,
                &syntax,
                patch,
                opentui::widget::DiffView::Unified,
                Some("rust"),
                WrapMode::Word,
                0,
            )
        })
        .collect();
    let build_us = micros(started);
    let scroll = ScrollBox::new(&app).scrollbars(false).grow(1.0);
    for patch in &built {
        scroll.add(patch.view());
    }
    app.root().add(&scroll);
    let timed_frame = || {
        let started = Instant::now();
        app.render();
        (micros(started), rounds(&app))
    };
    let first = timed_frame();
    let started = Instant::now();
    built.iter().for_each(|patch| patch.set_view(opentui::widget::DiffView::Split));
    let toggle_us = micros(started);
    let toggle_frame = timed_frame();
    app.resize(140, HEIGHT);
    let resize_frame = timed_frame();
    write(json!({ "part": "parts", "files": count, "syntax_each_us": syntax_each_us, "build_us": build_us,
        "first_frame_us": first.0, "first_rounds": first.1, "toggle_us": toggle_us, "toggle_frame_us": toggle_frame.0,
        "resize_frame_us": resize_frame.0, "resize_rounds": resize_frame.1 }));
}

/// [`support::mount`], with `TestApp`'s check of each frame as `GATE_VERIFY` says.
fn mount(width: u16, height: u16, deps: Deps) -> support::Harness {
    let harness = support::mount(width, height, deps);
    harness.app.set_verify(std::env::var("GATE_VERIFY").as_deref() != Ok("off"));
    harness
}

#[test]
#[ignore = "P1's gate probe; a release build runs it with GATE_OUT"]
fn gate_probe() {
    // The route part opens 410 and 1,000 cards in one scroll, past the rows the host builds at once (Pl): the gate
    // measures what such a tree costs, so it lifts the limits.
    let _limits = crate::support::unlimited();
    let sizes: Vec<usize> = std::env::var("GATE_SIZES")
        .unwrap_or_else(|_| "40,410,1000".into())
        .split(',')
        .map(|size| size.parse().unwrap())
        .collect();
    let parts_wanted = std::env::var("GATE_PARTS").unwrap_or_else(|_| "today,route,parts".into());
    let drive = Drive { abi: std::env::var("GATE_CARRIER").is_ok_and(|carrier| carrier == "abi"), noop: false };
    let wanted = |part: &str| parts_wanted.split(',').any(|wanted| wanted == part);
    for &size in &sizes {
        if wanted("route") {
            route(size, false, false);
        }
        if wanted("list") {
            route(size, true, false);
        }
        if wanted("narrow") {
            route(size, true, true);
        }
        if wanted("today") {
            today(size, false, drive);
        }
        if wanted("today-narrow") {
            today(size, true, drive);
        }
        if wanted("parts") {
            parts(size);
        }
    }
}

// Expected (big-boi's review of P6c): the probe checks what each action did, so a driver whose actions dispatch nothing
// fails it instead of timing nothing.
#[test]
#[should_panic(expected = "jump_hunk 0: the screen did not change")]
fn the_gate_fails_actions_that_do_nothing() {
    today(8, false, Drive { abi: false, noop: true });
}

// Expected: the probe's checks hold for the real viewer, on both carriers, at a size a debug build runs.
#[test]
fn the_gate_drives_the_viewer_on_both_carriers() {
    for abi in [false, true] {
        today(40, false, Drive { abi, noop: false });
        today(40, true, Drive { abi, noop: false });
    }
}
