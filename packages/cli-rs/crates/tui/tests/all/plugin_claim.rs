//! Renderer claims (phase Pr, synthesis 4.11 and 4.14): the real TUI in a `TestApp` on a session whose assistant message
//! streams tool calls and a text with a fence, with two built-ins. `claim.a` claims the `probe` tool and the `probe`
//! fence, and can be made to panic, to overrun (a view of 101 ms on the injected clock) or to return a tree with an id
//! twice; `claim.b` claims the `witness` tool and is the witness. A `read` call is the host's own row. Two properties
//! are checked after every command, each with an oracle that shares no code with the host:
//!
//! - `stream-whole`: every part a claim shows equals, cell for cell, the claim's own tree for the part's content as
//!   the model says it is now, mounted fresh in an app of its own (`node::add`, no reconcile), and every part the model
//!   says a claim draws shows. The model keeps the part's content from the events it sent, not from the host.
//! - `isolation`: a second TUI runs the same commands where `claim.a` never faults. Where the fault fails the plugin
//!   (a panic), the user disables it at that step instead; where it fails one part (an overrun, a refused tree), the
//!   view declines that part from that step on. Every cell outside the composer, and `claim.b`'s own log of its views,
//!   must equal that twin's. The fault comes from `claim.a`'s own log of what it did.

use crate::support::model::{self, Failure, Model, Rng};
use crate::support::{self, Harness};

use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use opencode_api::generated::{SessionMessageAssistantToolState, V2Event};
use opencode_local::cli_config::{Grouping, Info, Session, Verbosity};
use opencode_plugin::abi::claim::{Claim, Part};
use opencode_plugin::abi::{self, v2};
use opencode_plugin::claim::{Shown, ledger, mounted};
use opencode_plugin::node::{self, Act};
use opencode_tui::Deps;
use opencode_tui::plugins::host::host;
use opencode_ui::markdown::CodeBlockRenderers;
use opencode_ui::theme::Theme;
use opentui::input::MouseEventKind;
use opentui::prelude::*;
use opentui::testing::{Capture, TestApp};
use serde_json::{Value, json};

const SESSION: &str = "ses_c";
const WIDTH: u16 = 100;
const HEIGHT: u16 = 60;

/// The tool calls the model streams: their ids and tool names. `probe` is `claim.a`'s, `witness` `claim.b`'s, and
/// `read` the host's.
const SLOTS: [(&str, &str); 4] = [("call_1", "probe"), ("call_2", "probe"), ("call_3", "witness"), ("call_4", "read")];
/// The fence's slot in [`Command::Arm`].
const FENCE: usize = 4;
const TOKENS: [&str; 4] = ["aa ", "bb", " cc", "dd "];
/// The text the assistant streams, a chunk a [`Command::Text`].
const CHUNKS: [&str; 7] = ["Intro.\n\n", "```probe\n", "alpha\n", "beta ", "gamma\n", "```\n", "\nAfter.\n"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fault {
    Panic,
    /// One view of 101 ms on the injected clock.
    Overrun,
    /// Every view of the part returns a tree with an id twice, which the host refuses.
    Bad,
}

thread_local! {
    /// Each view a claim ran, as the plugin logs it: the plugin, the part, and the lines it drew.
    static VIEWS: RefCell<Vec<(char, String, Vec<String>)>> = const { RefCell::new(Vec::new()) };
    /// `claim.a`'s fault and the part it fires on.
    static ARMED: RefCell<Option<(String, Fault)>> = const { RefCell::new(None) };
    /// The parts `claim.a` declines.
    static DECLINE: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
    /// The faults that fired since this was last taken, as `claim.a` logs them.
    static FIRED: RefCell<Vec<(String, Fault)>> = const { RefCell::new(Vec::new()) };
    static CLOCK: RefCell<Option<Rc<Cell<Duration>>>> = const { RefCell::new(None) };
    /// `claim.a`'s next call is its first since setup, which no overrun fails (P4c).
    static COLD: Cell<bool> = const { Cell::new(false) };
    /// The parts `claim.a` returns a refused tree for unless the host asks for a whole tree, and the `full` of each
    /// of its views.
    static ONCE: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
    static FULL: RefCell<Vec<bool>> = const { RefCell::new(Vec::new()) };
}

/// What the plugins call a part: a tool call by its id, and the one fence.
fn key(part: &Part) -> String {
    match part {
        Part::Tool(tool) => tool.tool.id.clone(),
        Part::Fence(_) => "fence".to_owned(),
    }
}

/// The lines a claim draws for `part`: what it read of the part.
fn lines(part: &Part) -> Vec<String> {
    match part {
        Part::Tool(tool) => {
            let (input, progress, error) = match &tool.tool.state {
                SessionMessageAssistantToolState::Streaming(state) => (state.input.clone(), None, None),
                SessionMessageAssistantToolState::Running(state) => {
                    (json!(state.input).to_string(), state.metadata.get("n").map(Value::to_string), None)
                }
                SessionMessageAssistantToolState::Completed(state) => (json!(state.input).to_string(), None, None),
                SessionMessageAssistantToolState::Error(state) => {
                    (json!(state.input).to_string(), None, Some(state.error.message.clone()))
                }
                SessionMessageAssistantToolState::Unknown(_) => (String::new(), None, None),
            };
            let mut lines =
                vec![format!("{} {} {:?}", tool.tool.name, tool.tool.id, tool.state), format!("in {input}")];
            lines.extend(progress.map(|n| format!("progress {n}")));
            lines.extend(error.map(|error| format!("error {error}")));
            lines
        }
        // Not whether it closed: Markdown hands a fence over again only when its code changes, and the closing line
        // changes none (a finding of this phase).
        Part::Fence(fence) => fence.code.lines().map(|line| format!("| {line}")).collect(),
    }
}

/// The claims' tree: a card on the raised background, a line a text, and the output under a finished call.
fn card(lines: &[String], output: Option<v2::Source>) -> v2::Node {
    let mut children: Vec<v2::Node> = lines
        .iter()
        .enumerate()
        .map(|(index, line)| {
            v2::Node::text(vec![abi::Span::new(line.clone())]).fg("text.base").with_id(format!("l{index}"))
        })
        .collect();
    children.extend(output.map(|source| v2::Node::Markdown { id: Some("out".into()), source }));
    v2::Node::column(children).bg("background.raised.base").with_id("card")
}

/// The tree a claim draws for `part`.
fn tree(part: &Part) -> v2::Node {
    let output = match part {
        Part::Tool(tool) if tool.state == abi::claim::State::Completed => Some(tool.output()),
        _ => None,
    };
    card(&lines(part), output)
}

fn view_a(cx: &mut v2::View<'_>, part: &Part) -> Option<v2::Node> {
    let key = key(part);
    VIEWS.with_borrow_mut(|views| views.push(('a', key.clone(), lines(part))));
    FULL.with_borrow_mut(|full| full.push(cx.input.full));
    if DECLINE.with_borrow(|decline| decline.contains(&key)) {
        return None;
    }
    if !cx.input.full && ONCE.with_borrow(|once| once.contains(&key)) {
        return Some(v2::Node::column(vec![v2::Node::Keep { key: "nothing".into() }]));
    }
    let fault = ARMED.with_borrow(|armed| armed.as_ref().filter(|(armed, _)| *armed == key).map(|(_, fault)| *fault));
    let cold = COLD.replace(false);
    if let Some(fault) = fault {
        if !(cold && fault == Fault::Overrun) {
            FIRED.with_borrow_mut(|fired| fired.push((key.clone(), fault)));
        }
        match fault {
            Fault::Panic => {
                ARMED.set(None);
                panic!("claim.a fault on {key}");
            }
            Fault::Overrun => {
                ARMED.set(None);
                CLOCK.with_borrow(|clock| {
                    clock.iter().for_each(|clock| clock.set(clock.get() + Duration::from_millis(101)))
                });
            }
            Fault::Bad => {
                let text = |text: &str| v2::Node::text(vec![abi::Span::new(text)]).with_id("twice");
                return Some(v2::Node::column(vec![text("x"), text("y")]));
            }
        }
    }
    Some(tree(part))
}

fn view_b(_: &mut v2::View<'_>, part: &Part) -> Option<v2::Node> {
    VIEWS.with_borrow_mut(|views| views.push(('b', key(part), lines(part))));
    Some(tree(part))
}

fn plugin_a(setup: &mut abi::Setup) -> Result<(), String> {
    COLD.set(true);
    setup.claim(Claim::tool("probe", view_a));
    setup.claim(Claim::fence("probe", view_a));
    Ok(())
}

fn plugin_b(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("witness", view_b));
    Ok(())
}

/// One tool call as the model streamed it.
#[derive(Clone, Debug, Default, PartialEq)]
enum Call {
    #[default]
    None,
    Streaming(String),
    Running(String, Option<u8>),
    Completed(String),
    /// Failed, with the input it ran with: none while it streamed.
    Error(Option<String>),
}

/// What the model sent, and what it says each claim shows.
#[derive(Clone, Debug, Default)]
struct Expected {
    calls: [Call; 4],
    /// The text chunks sent.
    chunks: usize,
    /// `claim.a` runs: enabled, and not failed (or, in the twin, not disabled for its failure).
    a: bool,
    /// The parts that show the host's row in place of `claim.a`'s: fallen, or declined in the twin.
    off: HashSet<String>,
}

impl Expected {
    fn new() -> Self {
        Self { a: true, ..Self::default() }
    }

    /// The lines of call `index` and its output, while a claim draws it.
    fn tool(&self, index: usize) -> Option<(Vec<String>, Option<String>)> {
        let (id, name) = SLOTS[index];
        let input = |q: &str| format!("in {}", json!({ "q": q }));
        let head = |state: &str| format!("{name} {id} {state}");
        Some(match &self.calls[index] {
            Call::None => return None,
            Call::Streaming(text) => (vec![head("Pending"), format!("in {text}")], None),
            Call::Running(q, n) => {
                let mut lines = vec![head("Running"), input(q)];
                lines.extend(n.map(|n| format!("progress {n}")));
                (lines, None)
            }
            Call::Completed(q) => (vec![head("Completed"), input(q)], Some(format!("done {id}"))),
            Call::Error(q) => {
                let input = q.as_deref().map_or_else(|| "in {}".to_owned(), input);
                (vec![head("Error"), input, "error boom".into()], None)
            }
        })
    }

    /// The fence's lines, once it opened.
    fn fence(&self) -> Option<Vec<String>> {
        let text: String = CHUNKS[..self.chunks].concat();
        let (_, body) = text.split_once("```probe\n")?;
        let code = body.split_once("```\n").map_or(body, |(code, _)| code);
        // Markdown holds back an open fence with no code yet: the host has no block to hand over.
        (!code.is_empty()).then(|| code.lines().map(|line| format!("| {line}")).collect())
    }

    /// The tree each part a claim draws now shows, by its key.
    fn shown(&self) -> Vec<(String, v2::Node)> {
        let mut shown = Vec::new();
        for (index, (id, name)) in SLOTS.iter().enumerate() {
            let claimed = match *name {
                "probe" => self.a && !self.off.contains(*id),
                "witness" => true,
                _ => false,
            };
            if let (true, Some((lines, output))) = (claimed, self.tool(index)) {
                shown.push((id.to_string(), card(&lines, output.map(v2::Source::Text))));
            }
        }
        if let (true, false, Some(lines)) = (self.a, self.off.contains("fence"), self.fence()) {
            shown.push(("fence".to_owned(), card(&lines, None)));
        }
        shown
    }
}

/// A TUI on the session, with both claims, and the budget's clock injected.
struct World {
    harness: Harness,
    seq: Cell<u64>,
}

fn messages() -> Value {
    json!([
        {
            "id": "msg_2", "type": "assistant", "agent": "build",
            "model": { "providerID": "provider", "id": "model" },
            "time": { "created": 1500 }, "content": [],
        },
        { "id": "msg_1", "type": "user", "text": "Stream it", "time": { "created": 1000 } },
    ])
}

impl World {
    fn open() -> Self {
        Self::with(vec![
            abi::Plugin { id: "claim.a", setup: plugin_a }.into(),
            abi::Plugin { id: "claim.b", setup: plugin_b }.into(),
        ])
    }

    /// A TUI on the session with `builtins`.
    fn with(builtins: Vec<opencode_plugin::Builtin>) -> Self {
        VIEWS.with_borrow_mut(Vec::clear);
        ARMED.set(None);
        DECLINE.with_borrow_mut(HashSet::clear);
        FIRED.with_borrow_mut(Vec::clear);
        let session = support::merge(support::session(SESSION, "Claims"), json!({ "agent": "build" }));
        let fake = support::Fake::new(move |seen| match seen.path.as_str() {
            "/api/session" => (200, json!({ "data": [], "cursor": {} })),
            "/api/session/ses_c" => (200, json!({ "data": session })),
            "/api/session/ses_c/message" => (200, json!({ "data": messages(), "cursor": {} })),
            "/api/session/ses_c/permission" | "/api/session/ses_c/inbox" => (200, json!({ "data": [] })),
            _ => support::not_found(),
        });
        // Each call in its own row: grouping folds rows, and is E.8's.
        let info = Info {
            animations: Some(false),
            session: Some(Session {
                grouping: Some(Grouping::None),
                verbosity: Some(Verbosity::Medium),
                ..Session::default()
            }),
            ..Info::default()
        };
        let deps = Deps {
            config: support::config(info),
            route: support::session_route(SESSION),
            builtins,
            ..support::deps(Arc::new(fake))
        };
        let harness = support::mount(WIDTH, HEIGHT, deps);
        let clock = Rc::new(Cell::new(Duration::ZERO));
        let (base, now) = (Instant::now(), clock.clone());
        harness.tui.plugins.monitor().set_clock(move || base + now.get());
        CLOCK.set(Some(clock));
        harness.wait_for("Stream it");
        // A card fills its cells: a token the theme lacks would paint nothing, and the twin's clear color would show.
        assert!(opencode_plugin::node::theme_color(&harness.tui.page(), "background.raised.base").is_some());
        let world = Self { harness, seq: Cell::new(0) };
        world.settle();
        world
    }

    fn emit(&self, kind: &str, data: Value) {
        let seq = self.seq.get() + 1;
        self.seq.set(seq);
        let ids = json!({ "sessionID": SESSION, "assistantMessageID": "msg_2" });
        let event: V2Event = serde_json::from_value(json!({
            "id": format!("evt_{seq}"), "created": 10_000 + seq, "type": kind,
            "durable": { "aggregateID": SESSION, "seq": seq, "version": 1 },
            "data": support::merge(ids, data),
        }))
        .unwrap();
        let tui = &self.harness.tui;
        tui.data.apply(&[event]);
        assert!(self.harness.app.wait_until(support::WAIT, || tui.synced()), "the views never took the event");
    }

    /// Sends what `command` stands for and updates `expected` as the store applies it. Fault commands are the run's.
    fn send(&self, command: &Command, expected: &mut Expected) {
        let tool = |index: usize| json!({ "id": SLOTS[index].0 });
        match *command {
            Command::Start(index) if expected.calls[index] == Call::None => {
                self.emit("session.tool.input.started", support::merge(tool(index), json!({ "name": SLOTS[index].1 })));
                expected.calls[index] = Call::Streaming(String::new());
            }
            Command::Delta(index, token) => {
                if let Call::Streaming(text) = &mut expected.calls[index] {
                    text.push_str(TOKENS[token]);
                    self.emit(
                        "session.tool.input.delta",
                        support::merge(tool(index), json!({ "delta": TOKENS[token] })),
                    );
                }
            }
            Command::Call(index) => {
                if let Call::Streaming(text) = expected.calls[index].clone() {
                    self.emit(
                        "session.tool.called",
                        support::merge(tool(index), json!({ "input": { "q": text }, "executed": true })),
                    );
                    expected.calls[index] = Call::Running(text, None);
                }
            }
            Command::Progress(index, n) => {
                if let Call::Running(_, progress) = &mut expected.calls[index] {
                    *progress = Some(n);
                    self.emit("session.tool.progress", support::merge(tool(index), json!({ "metadata": { "n": n } })));
                }
            }
            Command::Succeed(index) => {
                if let Call::Running(q, _) = expected.calls[index].clone() {
                    let content = json!([{ "type": "text", "text": format!("done {}", SLOTS[index].0) }]);
                    self.emit(
                        "session.tool.success",
                        support::merge(tool(index), json!({ "content": content, "executed": true })),
                    );
                    expected.calls[index] = Call::Completed(q);
                }
            }
            Command::Fail(index) => {
                let q = match &expected.calls[index] {
                    Call::Streaming(_) => Some(None),
                    Call::Running(q, _) => Some(Some(q.clone())),
                    _ => None,
                };
                if let Some(q) = q {
                    let error = json!({ "type": "unknown", "message": "boom" });
                    self.emit(
                        "session.tool.failed",
                        support::merge(tool(index), json!({ "error": error, "executed": false })),
                    );
                    expected.calls[index] = Call::Error(q);
                }
            }
            Command::Text if expected.chunks < CHUNKS.len() => {
                if expected.chunks == 0 {
                    self.emit("session.text.started", json!({ "ordinal": 0 }));
                }
                self.emit("session.text.delta", json!({ "ordinal": 0, "delta": CHUNKS[expected.chunks] }));
                expected.chunks += 1;
            }
            Command::Enable(on) => self.enable(on, expected),
            Command::Theme(dark) => {
                let tui = &self.harness.tui;
                tui.theme.borrow_mut().set(if dark { "opencode" } else { "tokyonight" });
                tui.theme_changed();
            }
            _ => {}
        }
        self.settle();
    }

    /// What the plugin manager does to `claim.a`; it mounts the route again, so every call is claimed afresh. An enable
    /// of a running plugin sets nothing up again, so the fence revision that fell back stays with the host.
    fn enable(&self, on: bool, expected: &mut Expected) {
        let tui = &self.harness.tui;
        let _ = tui.plugins.toggle(&host(tui), "claim.a", on);
        tui.navigate(tui.route());
        let kept = on && expected.a;
        expected.a = on;
        expected.off.retain(|key| kept && key == "fence");
    }

    fn settle(&self) {
        let app = &self.harness.app;
        app.advance(Duration::from_millis(1));
        app.render();
        app.advance(Duration::from_millis(1));
        while self.harness.tui.toasts.current().is_some() {
            self.harness.tui.toasts.dismiss();
        }
        app.render();
    }

    fn frame(&self) -> Capture {
        self.harness.app.render()
    }

    /// The composer's cells: its placeholder is random.
    fn mask(&self) -> Option<(u32, u32, u32, u32)> {
        let textarea = self.harness.tui.textarea.borrow().clone()?;
        let rect = textarea.rect();
        Some((rect.screen_x as u32, rect.screen_y as u32, rect.width as u32, rect.height as u32))
    }

    fn theme(&self) -> Theme {
        self.harness.tui.page()
    }
}

/// `node` mounted fresh, `width` by `height`, in `theme`: ABI 1.x nodes through `node::add`, the host's mount path
/// for plugin claims of 1.x, and Markdown as `opencode_ui` draws it. No reconcile.
fn fresh(node: &v2::Node, width: u16, height: u16, theme: &Theme) -> Capture {
    let app = TestApp::new(width, height);
    let parent = View::new(&app).column().width(Length::percent(100.0));
    app.root().add(&parent);
    let act: Act = Rc::new(|_| {});
    let syntax = opencode_ui::code::syntax_theme(theme);
    let markdown = |text: &str| {
        opencode_ui::markdown::view(&app, theme, &syntax, &CodeBlockRenderers::default(), true, false)
            .set_markdown(text)
            .as_any()
    };
    let mut hovers = Vec::new();
    node::add(&app, theme, &parent, &lower(node), &act, &mut hovers, &markdown, &mut |_, _| {});
    app.render()
}

/// The node as ABI 1.x has it: ids go.
fn lower(node: &v2::Node) -> abi::Node {
    match node {
        v2::Node::Box {
            row,
            gap,
            padding,
            justify,
            align,
            bg,
            layout,
            on_click,
            children,
            border,
            padding_sides,
            wrap,
            overflow,
            ..
        } => abi::Node::Box {
            row: *row,
            gap: *gap,
            padding: *padding,
            justify: *justify,
            align: *align,
            bg: bg.clone(),
            layout: *layout,
            on_click: on_click.clone(),
            children: children.iter().map(lower).collect(),
            border: border.clone(),
            padding_sides: *padding_sides,
            wrap: *wrap,
            overflow: *overflow,
        },
        v2::Node::Text { spans, fg, wrap, truncate, selectable, hover_fg, layout, on_click, .. } => abi::Node::Text {
            spans: spans.clone(),
            fg: fg.clone(),
            wrap: *wrap,
            truncate: *truncate,
            selectable: *selectable,
            hover_fg: hover_fg.clone(),
            layout: *layout,
            on_click: on_click.clone(),
        },
        v2::Node::Markdown { source: v2::Source::Text(text), .. } => abi::Node::Markdown { text: text.clone() },
        other => panic!("the claims draw no {other:?}"),
    }
}

/// Where `shown` differs from the fresh mount of `node`, if it does.
fn region_diff(frame: &Capture, shown: &Shown, node: &v2::Node, theme: &Theme) -> Option<String> {
    let rect = shown.rect;
    let (x0, y0, width, height) = (rect.screen_x as u32, rect.screen_y as u32, rect.width as u32, rect.height as u32);
    if width == 0 || height == 0 || y0 + height > frame.height || x0 + width > frame.width {
        return Some(format!("{} is not on screen whole: {rect:?}", shown.id.key));
    }
    let twin = fresh(node, width as u16, height as u16, theme);
    let row = |capture: &Capture, x: u32, y: u32| -> String {
        (x..x + width).filter_map(|x| capture.cell(x, y)).map(|cell| cell.symbol.as_str()).collect()
    };
    // A blank cell paints no foreground, so its foreground is not compared: a text written in place to spans that end in
    // a space paints that cell's foreground white where a fresh mount paints `text.base` (a finding of this phase,
    // in the reconcile's text writes or in OpenTUI, not in the claims).
    let same = |a: Option<&opentui::testing::Cell>, b: Option<&opentui::testing::Cell>| match (a, b) {
        (Some(a), Some(b)) if a.symbol == " " && a.attributes.is_empty() => {
            (&a.symbol, a.bg, a.attributes) == (&b.symbol, b.bg, b.attributes)
        }
        _ => a == b,
    };
    (0..height).find_map(|y| {
        let x = (0..width).find(|&x| !same(frame.cell(x0 + x, y0 + y), twin.cell(x, y)))?;
        Some(format!(
            "{} row {y}:\n  shown {:?}\n  fresh {:?}\n  first cell {x}: {:?} against {:?}",
            shown.id.key,
            row(frame, x0, y0 + y),
            row(&twin, 0, y),
            frame.cell(x0 + x, y0 + y),
            twin.cell(x, y)
        ))
    })
}

/// `stream-whole` after a step: each part a claim shows equals the claim's tree for the content the model says it
/// has, mounted fresh, and every part the model says a claim draws shows. Returns the parts compared.
fn stream_whole(world: &World, expected: &Expected) -> Result<usize, (&'static str, String)> {
    let frame = world.frame();
    let theme = world.theme();
    let shown: Vec<Shown> = mounted().into_iter().filter(|shown| shown.shows).collect();
    let wanted = expected.shown();
    let part =
        |shown: &Shown| if shown.id.key.starts_with("fence-") { "fence".to_owned() } else { shown.id.key.clone() };
    for shown in &shown {
        let Some((_, node)) = wanted.iter().find(|(key, _)| *key == part(shown)) else {
            return Err(("shown", format!("{} shows, and the model says the host's row does", shown.id.key)));
        };
        if let Some(diff) = region_diff(&frame, shown, node, &theme) {
            return Err(("fresh", format!("{diff}\nscreen:\n{}", frame.text())));
        }
    }
    if let Some((key, _)) = wanted.iter().find(|(key, _)| !shown.iter().any(|shown| part(shown) == *key)) {
        return Err(("missing", format!("the model says a claim draws {key}; nothing shows it:\n{}", frame.text())));
    }
    // Where the host's row shows a part, no claim's tree of it does, also one no mount says shows.
    let screen = frame.text();
    let host = SLOTS
        .iter()
        .enumerate()
        .filter(|(index, (id, name))| {
            *name == "probe" && expected.calls[*index] != Call::None && !wanted.iter().any(|(key, _)| key == id)
        })
        .map(|(_, (id, name))| format!("{name} {id} "))
        .chain(
            expected.fence().filter(|_| !wanted.iter().any(|(key, _)| key == "fence")).map(|lines| lines[0].clone()),
        );
    if let Some(drawn) = host.into_iter().find(|drawn| screen.contains(drawn.as_str())) {
        return Err(("host", format!("the host's row shows that part, and {drawn:?} is on screen:\n{screen}")));
    }
    Ok(shown.len())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    Start(usize),
    Delta(usize, usize),
    Call(usize),
    Progress(usize, u8),
    Succeed(usize),
    Fail(usize),
    /// The next chunk of the assistant's text.
    Text,
    /// `claim.a` faults so on its next view of slot `usize`: a call, or the fence.
    Arm(Fault, usize),
    /// The user enables or disables `claim.a`.
    Enable(bool),
    /// A theme switch: the dark default, or another theme.
    Theme(bool),
}

/// What a step left: the frame, its composer, and `claim.b`'s views.
struct Step {
    frame: Capture,
    mask: Option<(u32, u32, u32, u32)>,
    witness: Vec<(String, Vec<String>)>,
}

/// The views of `claim.b` since the last call, runs of one view as one: a remount views every part again.
fn witness() -> Vec<(String, Vec<String>)> {
    let mut seen: Vec<(String, Vec<String>)> = Vec::new();
    for (plugin, key, lines) in VIEWS.with_borrow_mut(std::mem::take) {
        if plugin == 'b' && seen.last() != Some(&(key.clone(), lines.clone())) {
            seen.push((key, lines));
        }
    }
    seen
}

/// The first row where `a` and `b` differ outside the composer.
fn frame_diff(a: &Step, b: &Step) -> Option<String> {
    let masked = |x: u32, y: u32| {
        [a.mask, b.mask].into_iter().flatten().any(|(mx, my, mw, mh)| x >= mx && x < mx + mw && y >= my && y < my + mh)
    };
    (0..a.frame.height).find_map(|y| {
        let differs = (0..a.frame.width).any(|x| !masked(x, y) && a.frame.cell(x, y) != b.frame.cell(x, y));
        let line = |frame: &Capture| frame.text().lines().nth(y as usize).unwrap_or_default().to_owned();
        differs.then(|| format!("row {y}:\n  fault {:?}\n  twin  {:?}", line(&a.frame), line(&b.frame)))
    })
}

pub struct ClaimModel;

/// The faults `claim.a`'s log says fired, a list a step.
type Fired = Vec<Vec<(String, Fault)>>;

impl ClaimModel {
    /// Runs `commands` in the world with faults, or in the twin that takes `fired`'s faults its own way. Returns each
    /// step, the faults that fired at each step, and the first `stream-whole` failure.
    fn world(&self, commands: &[Command], fired: Option<&Fired>) -> (Vec<Step>, Fired, Option<Failure>) {
        let world = World::open();
        let mut expected = Expected::new();
        let (mut steps, mut log, mut failure) = (Vec::new(), Vec::new(), None);
        VIEWS.with_borrow_mut(Vec::clear);
        for (step, command) in commands.iter().enumerate() {
            let twin = fired.map(|fired| fired[step].as_slice()).unwrap_or_default();
            if let (true, Command::Enable(on)) = (fired.is_some(), command) {
                let kept = *on && expected.a;
                DECLINE.with_borrow_mut(|decline| decline.retain(|key| kept && key == "fence"));
            }
            // A fence that fell back is claimed afresh at its next revision: Markdown keeps no handle to it.
            if *command == Command::Text && expected.chunks < CHUNKS.len() {
                let next = Expected { chunks: expected.chunks + 1, ..expected.clone() };
                if next.fence().is_some() && next.fence() != expected.fence() {
                    expected.off.remove("fence");
                    DECLINE.with_borrow_mut(|decline| decline.remove("fence"));
                }
            }
            // The twin declines a part from the step its fault fell back on, before that step's view.
            for (key, fault) in twin {
                if *fault != Fault::Panic {
                    DECLINE.with_borrow_mut(|decline| decline.insert(key.clone()));
                }
            }
            if let (None, Command::Arm(fault, slot)) = (fired, command) {
                let key = if *slot == FENCE { "fence".to_owned() } else { SLOTS[*slot].0.to_owned() };
                ARMED.set(Some((key, *fault)));
            }
            world.send(command, &mut expected);
            let mut faults = FIRED.with_borrow_mut(std::mem::take);
            faults.dedup();
            if twin.iter().any(|(_, fault)| *fault == Fault::Panic) {
                world.enable(false, &mut expected);
                world.settle();
            }
            // What the plugin's own log says happened: a panic fails it, another fault fails one part.
            for (key, fault) in faults.iter().chain(twin) {
                match fault {
                    Fault::Panic => expected.a = false,
                    _ => drop(expected.off.insert(key.clone())),
                }
            }
            if failure.is_none()
                && !model::skipped("stream-whole")
                && let Err((site, detail)) = stream_whole(&world, &expected)
            {
                failure = Some(Failure { property: "stream-whole", site, step, detail });
            }
            let ledger = ledger();
            if failure.is_none() && !model::skipped("ledger") && ledger.mounts != mounted().len() as i64 {
                let detail = format!("{} mounts booked, {} live", ledger.mounts, mounted().len());
                failure = Some(Failure { property: "ledger", site: "live", step, detail });
            }
            steps.push(Step { frame: world.frame(), mask: world.mask(), witness: witness() });
            log.push(faults);
        }
        drop(world);
        let ledger = ledger();
        if failure.is_none()
            && !model::skipped("ledger")
            && (ledger.mounts, ledger.content, ledger.memo_entries) != (0, 0, 0)
        {
            let detail = format!("{ledger:?} after the TUI went");
            failure = Some(Failure { property: "ledger", site: "end", step: commands.len(), detail });
        }
        (steps, log, failure)
    }
}

impl Model for ClaimModel {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        (0..steps)
            .map(|_| {
                let slot = rng.below(SLOTS.len());
                match rng.below(100) {
                    0..12 => Command::Start(slot),
                    12..34 => Command::Delta(slot, rng.below(TOKENS.len())),
                    34..44 => Command::Call(slot),
                    44..54 => Command::Progress(slot, rng.below(5) as u8),
                    54..62 => Command::Succeed(slot),
                    62..66 => Command::Fail(slot),
                    66..80 => Command::Text,
                    80..90 => {
                        let fault = *rng.pick(&[Fault::Panic, Fault::Overrun, Fault::Bad]);
                        Command::Arm(fault, *rng.pick(&[0, 1, FENCE]))
                    }
                    90..96 => Command::Enable(rng.below(3) != 0),
                    _ => Command::Theme(rng.below(2) == 0),
                }
            })
            .collect()
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        let (faulty, fired, failure) = self.world(commands, None);
        if failure.is_some() {
            return failure;
        }
        let (twin, _, failure) = self.world(commands, Some(&fired));
        if let Some(failure) = failure {
            return Some(Failure { site: "twin", ..failure });
        }
        if model::skipped("isolation") {
            return None;
        }
        faulty.iter().zip(&twin).enumerate().find_map(|(step, (faulty, twin))| {
            if let Some(diff) = frame_diff(faulty, twin) {
                return Some(Failure { property: "isolation", site: "cells", step, detail: diff });
            }
            (faulty.witness != twin.witness).then(|| Failure {
                property: "isolation",
                site: "witness",
                step,
                detail: format!("claim.b viewed\n  {:?}\nand in the twin\n  {:?}", faulty.witness, twin.witness),
            })
        })
    }

    fn simplify(&self, command: &Command) -> Vec<Command> {
        match command {
            Command::Delta(slot, token) if *token > 0 => vec![Command::Delta(*slot, 0)],
            Command::Progress(slot, n) if *n > 0 => vec![Command::Progress(*slot, 0)],
            Command::Theme(false) => vec![Command::Theme(true)],
            _ => Vec::new(),
        }
    }
}

#[test]
fn claimed_parts_stream_into_what_a_fresh_mount_draws() {
    model::check(&ClaimModel, 12, 40);
}

/// The commands that stream every call and the fence to their end, with `faults` before them.
fn whole_stream(faults: &[Command]) -> Vec<Command> {
    let mut commands = faults.to_vec();
    for slot in 0..SLOTS.len() {
        commands.extend([Command::Start(slot), Command::Delta(slot, 0), Command::Delta(slot, 1), Command::Call(slot)]);
        commands.extend([Command::Progress(slot, 1), Command::Progress(slot, 2), Command::Succeed(slot)]);
    }
    commands.extend(CHUNKS.iter().map(|_| Command::Text));
    commands
}

// Expected (`stream-whole`): every call and the fence, streamed revision by revision, show what the claim draws for
// their content mounted fresh, also across a theme switch, and the `read` call shows the host's own row.
#[test]
fn each_revision_of_a_claimed_part_equals_a_fresh_mount() {
    let mut commands = whole_stream(&[]);
    commands.insert(10, Command::Theme(false));
    assert_eq!(ClaimModel.run(&commands), None);
    let world = World::open();
    let mut expected = Expected::new();
    for command in &commands {
        world.send(command, &mut expected);
    }
    let screen = world.frame().text();
    for shows in ["probe call_1 Completed", "witness call_3 Completed", "done call_2", "| beta gamma", "After."] {
        assert!(screen.contains(shows), "{shows:?} is not on screen:\n{screen}");
    }
    assert!(!screen.contains("read call_4"), "a claim drew the host's read call:\n{screen}");
    assert_eq!(stream_whole(&world, &expected), Ok(4));
}

// Expected (`isolation`): a panic in one claim's view fails its plugin, and its parts show the host's rows as when the
// user disabled it; an overrun, and a tree refused twice, show the host's row for that part alone. The other plugin's
// parts and every other cell stay as in the twin, and each fault fired.
#[test]
fn a_fault_in_a_claim_falls_back_for_what_it_claims_alone() {
    for (fault, slot) in
        [(Fault::Panic, 0), (Fault::Overrun, 1), (Fault::Bad, 0), (Fault::Overrun, FENCE), (Fault::Bad, FENCE)]
    {
        let mut commands = whole_stream(&[Command::Arm(fault, slot)]);
        // Mid stream, so the fallback lands between revisions.
        let at = commands.iter().position(|command| *command == Command::Call(slot)).unwrap_or(26);
        commands.insert(at, Command::Arm(fault, slot));
        let (_, fired, _) = ClaimModel.world(&commands, None);
        assert!(fired.iter().flatten().any(|(_, fired)| *fired == fault), "{fault:?} on {slot} never fired");
        assert_eq!(ClaimModel.run(&commands), None, "{fault:?} on slot {slot}");
    }
}

// Expected: the oracles can fail. A part whose content the model has one token short of differs from the fresh mount,
// and a twin that never disables the panicking plugin differs from the faulty world.
#[test]
fn the_oracles_can_fail() {
    let world = World::open();
    let mut expected = Expected::new();
    for command in [Command::Start(0), Command::Delta(0, 0), Command::Delta(0, 1)] {
        world.send(&command, &mut expected);
    }
    assert_eq!(stream_whole(&world, &expected), Ok(1));
    expected.calls[0] = Call::Streaming(TOKENS[0].to_owned());
    assert!(matches!(stream_whole(&world, &expected), Err(("fresh", _))));
    drop(world);

    let commands = whole_stream(&[Command::Arm(Fault::Panic, 0)]);
    let (faulty, fired, _) = ClaimModel.world(&commands, None);
    let (twin, _, _) = ClaimModel.world(&commands, Some(&vec![Vec::new(); fired.len()]));
    assert!(faulty.iter().zip(&twin).any(|(faulty, twin)| frame_diff(faulty, twin).is_some()));
}

// Expected: a part streaming several revisions in one frame gets one view at once and one at the next paint, with the
// newest content; the frame between keeps the last tree.
#[test]
fn a_streaming_part_gets_one_view_a_frame() {
    let world = World::open();
    let mut expected = Expected::new();
    world.send(&Command::Start(0), &mut expected);
    VIEWS.with_borrow_mut(Vec::clear);
    let views = || VIEWS.with_borrow(|views| views.iter().filter(|(plugin, _, _)| *plugin == 'a').count());
    for delta in TOKENS {
        if let Call::Streaming(text) = &mut expected.calls[0] {
            text.push_str(delta);
        }
        world.emit("session.tool.input.delta", json!({ "id": "call_1", "delta": delta }));
    }
    assert_eq!(views(), 1, "the first revision of the frame is viewed at once, the rest wait");
    world.harness.app.render();
    assert_eq!(views(), 1, "the paint of the frame that viewed does not view again");
    world.harness.app.render();
    assert_eq!(views(), 2, "the next paint views the newest content once");
    assert_eq!(stream_whole(&world, &expected), Ok(1));
    // A revision that changes the phase is viewed at once, also in a frame that viewed the part already.
    world.send(&Command::Delta(0, 0), &mut expected);
    world.emit("session.tool.input.delta", json!({ "id": "call_1", "delta": TOKENS[1] }));
    let before = views();
    world.emit("session.tool.called", json!({ "id": "call_1", "input": { "q": "aa aa bb" }, "executed": true }));
    assert_eq!(views(), before + 1, "a phase change waited for the paint");
}

// Expected: a part the claim declines shows the host's own row, and a later revision the claim takes shows its tree.
#[test]
fn a_declined_part_shows_the_host_row() {
    let world = World::open();
    let mut expected = Expected::new();
    DECLINE.with_borrow_mut(|decline| decline.insert("call_1".to_owned()));
    world.send(&Command::Start(0), &mut expected);
    world.send(&Command::Delta(0, 0), &mut expected);
    let screen = world.frame().text();
    assert!(!screen.contains("probe call_1"), "{screen}");
    assert!(mounted().iter().all(|shown| !shown.shows));
    assert!(screen.contains("⋯ probe"), "the host's row does not show:\n{screen}");
    DECLINE.with_borrow_mut(HashSet::clear);
    world.send(&Command::Call(0), &mut expected);
    assert_eq!(stream_whole(&world, &expected), Ok(1));
    let screen = world.frame().text();
    assert!(!screen.contains("⋯ probe"), "the host's row stayed beside the claim's tree:\n{screen}");
    // Declined again: the host's row comes back, built again, and the claim's tree goes.
    DECLINE.with_borrow_mut(|decline| decline.insert("call_1".to_owned()));
    expected.off.insert("call_1".to_owned());
    world.send(&Command::Progress(0, 1), &mut expected);
    let screen = world.frame().text();
    assert!(screen.contains("⋯ probe"), "the host's row is not back:\n{screen}");
    assert_eq!(stream_whole(&world, &expected), Ok(0));
    DECLINE.with_borrow_mut(HashSet::clear);
}

// Expected: a fence keeps its mount while it streams: Markdown hands its widget back, and the claim finds its mount
// through it.
#[test]
fn a_streaming_fence_keeps_its_mount() {
    let world = World::open();
    let mut expected = Expected::new();
    let mut generations = Vec::new();
    for _ in 0..5 {
        world.send(&Command::Text, &mut expected);
        generations
            .extend(mounted().into_iter().filter(|shown| shown.id.key.starts_with("fence-")).map(|shown| shown.id));
    }
    assert_eq!(generations.len(), 3, "{generations:?}");
    assert!(generations.windows(2).all(|pair| pair[0] == pair[1]), "{generations:?}");
}

// Expected (`ledger`): a part that leaves the transcript forgets its tree: leaving the session frees every claimed
// part, with its content and memo values.
#[test]
fn leaving_the_session_frees_every_claimed_part() {
    let world = World::open();
    let mut expected = Expected::new();
    for command in whole_stream(&[]) {
        world.send(&command, &mut expected);
    }
    assert_eq!(ledger().mounts, 4);
    world.harness.tui.navigate(opencode_tui::Route::Home);
    world.settle();
    let ledger = ledger();
    assert_eq!((ledger.mounts, ledger.content, ledger.memo_entries), (0, 0, 0), "{ledger:?}");
    assert!(mounted().is_empty());
}

/// One line for a `probe` call, as the host's own row draws one: what the cost probe's claim draws.
fn slim(_: &mut v2::View<'_>, part: &Part) -> Option<v2::Node> {
    let Part::Tool(tool) = part else { return None };
    let q = match &tool.tool.state {
        SessionMessageAssistantToolState::Completed(state) => state.input.get("q").cloned().unwrap_or_default(),
        _ => Value::Null,
    };
    Some(v2::Node::text(vec![abi::Span::new(format!("✓ probe [q={q}]"))]).fg("text.muted").with_id("row"))
}

fn plugin_slim(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("probe", slim));
    Ok(())
}

/// Median and 90th percentile of `samples`, in milliseconds.
fn spread(mut samples: Vec<Duration>) -> String {
    samples.sort();
    let at = |q: f64| samples[((samples.len() - 1) as f64 * q) as usize].as_secs_f64() * 1000.0;
    format!("{:.3} ms p50, {:.3} ms p90 ({} samples)", at(0.5), at(0.9), samples.len())
}

/// Pr's measure: a session of 120 turns, each a prompt and an answer with three finished `probe` calls, scrolled by
/// the wheel and with a call streaming at its end, once with a claim of `probe` that draws one line as the host's
/// row does, and once with the host's own rows. Release only:
/// `cargo test --release -p opencode-tui --test all plugin_claim::a_long -- --ignored --nocapture`.
#[test]
#[ignore]
fn a_long_transcript_of_claimed_calls_against_the_host_rows() {
    let turns = 120;
    let mut messages = Vec::new();
    for turn in 0..turns {
        let calls: Vec<Value> = (0..3)
            .map(|call| {
                json!({
                    "type": "tool", "id": format!("call_{turn}_{call}"), "name": "probe",
                    "time": { "created": 1, "completed": 2 },
                    "state": { "status": "completed", "input": { "q": format!("{turn}.{call}") },
                        "content": [{ "type": "text", "text": "done" }] },
                })
            })
            .collect();
        messages.push(json!({ "id": format!("msg_{turn:04}_1"), "type": "user", "text": format!("turn {turn}"),
            "time": { "created": 1000 + turn * 10 } }));
        messages.push(json!({
            "id": format!("msg_{turn:04}_2"), "type": "assistant", "agent": "build",
            "model": { "providerID": "provider", "id": "model" }, "finish": "stop",
            "time": { "created": 1005 + turn * 10, "completed": 1006 + turn * 10 }, "content": calls,
        }));
    }
    messages.push(json!({
        "id": "msg_2", "type": "assistant", "agent": "build", "model": { "providerID": "provider", "id": "model" },
        "time": { "created": 99_000 }, "content": [],
    }));
    messages.reverse();
    let messages = Value::Array(messages);
    for claimed in [false, true, false, true, false, true] {
        let session = support::merge(support::session(SESSION, "Claims"), json!({ "agent": "build" }));
        let page = messages.clone();
        let fake = support::Fake::new(move |seen| match seen.path.as_str() {
            "/api/session" => (200, json!({ "data": [], "cursor": {} })),
            "/api/session/ses_c" => (200, json!({ "data": session })),
            "/api/session/ses_c/message" => (200, json!({ "data": page, "cursor": {} })),
            "/api/session/ses_c/permission" | "/api/session/ses_c/inbox" => (200, json!({ "data": [] })),
            _ => support::not_found(),
        });
        let info = Info {
            animations: Some(false),
            session: Some(Session {
                grouping: Some(Grouping::None),
                verbosity: Some(Verbosity::Medium),
                ..Session::default()
            }),
            ..Info::default()
        };
        let builtins =
            if claimed { vec![abi::Plugin { id: "claim.slim", setup: plugin_slim }.into()] } else { Vec::new() };
        let deps = Deps {
            config: support::config(info),
            route: support::session_route(SESSION),
            builtins,
            ..support::deps(Arc::new(fake))
        };
        let harness = support::mount(WIDTH, 40, deps);
        harness.wait_for(&format!("turn {}", turns - 1));
        let world = World { harness, seq: Cell::new(0) };
        world.settle();
        let (app, tui) = (&world.harness.app, &world.harness.tui);
        let views = ledger().views;
        let mut open = Vec::new();
        for _ in 0..9 {
            let start = Instant::now();
            tui.navigate(tui.route());
            app.render();
            open.push(start.elapsed());
        }
        let (mut wheel, mut top) = (Vec::new(), 0);
        for step in 0..400 {
            let kind = if step < 200 { MouseEventKind::ScrollUp } else { MouseEventKind::ScrollDown };
            let start = Instant::now();
            app.mouse(kind, WIDTH / 2, 10);
            app.render();
            wheel.push(start.elapsed());
            if step == 199 {
                top = mounted().len();
            }
        }
        let shown = app.text().matches("✓ probe").count();
        world.emit("session.tool.input.started", json!({ "id": "call_live", "name": "probe" }));
        world.settle();
        let before = ledger().views;
        let mut stream = Vec::new();
        for _ in 0..100 {
            let start = Instant::now();
            world.emit("session.tool.input.delta", json!({ "id": "call_live", "delta": "x" }));
            app.render();
            stream.push(start.elapsed());
        }
        println!(
            "{}: {} claimed mounts, {top} after 200 steps up, {shown} rows on screen; remount {}; wheel {}; streaming \
             delta {}; views {} while open and scrolled, {} for 100 deltas",
            if claimed { "claimed" } else { "host rows" },
            ledger().mounts,
            spread(open),
            spread(wheel),
            spread(stream),
            before - views,
            ledger().views - before,
        );
    }
}

// Expected: a tree refused once is asked for again whole, in the same revision, and the part keeps its claim.
#[test]
fn a_tree_refused_once_is_asked_again_whole() {
    let world = World::open();
    let mut expected = Expected::new();
    world.send(&Command::Start(0), &mut expected);
    ONCE.with_borrow_mut(|once| once.insert("call_1".to_owned()));
    FULL.with_borrow_mut(Vec::clear);
    world.send(&Command::Delta(0, 0), &mut expected);
    assert_eq!(FULL.with_borrow(Vec::clone), [false, true], "a refusal asks once more, for a whole tree");
    assert_eq!(stream_whole(&world, &expected), Ok(1));
    ONCE.with_borrow_mut(HashSet::clear);
}

thread_local! {
    /// What the probes of the rows below saw: the plugin that viewed, and the width it was given.
    static SEEN: RefCell<Vec<(char, u16)>> = const { RefCell::new(Vec::new()) };
}

fn probe(plugin: char) -> impl Fn(&mut v2::View<'_>, &Part) -> Option<v2::Node> {
    move |cx, part| {
        SEEN.with_borrow_mut(|seen| seen.push((plugin, cx.input.width)));
        let text = format!("{plugin} drew {}", key(part));
        // The text goes to the host once, as content, and shows through its handle.
        let handle = cx.content(text.into_bytes());
        Some(v2::Node::column(vec![v2::Node::Markdown {
            id: Some("text".into()),
            source: v2::Source::Content(handle),
        }]))
    }
}

fn shell_first(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("shell", probe('f')));
    Ok(())
}

fn shell_last(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("shell", probe('l')));
    Ok(())
}

// Expected: a claim of a tool takes its calls by the name the host gives the tool too (`bash` is the shell), the plugin
// last in activation order wins, the content a view gives shows through its handle and goes with the part, and a part
// laid out at another width is viewed again with it.
#[test]
fn the_last_claim_of_a_tool_draws_it_with_its_content_at_its_width() {
    SEEN.with_borrow_mut(Vec::clear);
    let world = World::with(vec![
        abi::Plugin { id: "claim.first", setup: shell_first }.into(),
        abi::Plugin { id: "claim.last", setup: shell_last }.into(),
    ]);
    world.emit("session.tool.input.started", json!({ "id": "call_9", "name": "bash" }));
    world.settle();
    world.harness.wait_for("l drew call_9");
    assert!(
        SEEN.with_borrow(|seen| seen.iter().all(|(plugin, _)| *plugin == 'l')),
        "{:?}",
        SEEN.with_borrow(Vec::clone)
    );
    let content = ledger().content;
    assert_eq!(content, 1, "{:?}", ledger());
    let width = SEEN.with_borrow(|seen| seen.last().map(|(_, width)| *width)).unwrap();
    world.harness.app.resize(WIDTH - 20, HEIGHT);
    world.settle();
    world.settle();
    let resized = SEEN.with_borrow(|seen| seen.last().map(|(_, width)| *width)).unwrap();
    assert_eq!(resized, width - 20, "the view saw {width} columns, then {resized}");
    world.harness.tui.navigate(opencode_tui::Route::Home);
    world.settle();
    assert_eq!((ledger().mounts, ledger().content, ledger().content_bytes), (0, 0, 0));
}
