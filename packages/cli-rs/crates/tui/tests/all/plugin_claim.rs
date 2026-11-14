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

use crate::plugin_surface::{CARRIERS, Carrier, builtin};
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
    /// `claim.a` leaves its card's last line out: what the oracle must see.
    static SHORT: Cell<bool> = const { Cell::new(false) };
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
    let mut tree = tree(part);
    if let (true, v2::Node::Box { children, .. }) = (SHORT.get(), &mut tree) {
        children.pop();
    }
    Some(tree)
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
    /// The theme is the dark default.
    dark: bool,
    /// The permission request that waits.
    asked: Option<String>,
}

impl Expected {
    fn new() -> Self {
        Self { a: true, dark: true, ..Self::default() }
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
        // The transcript gives Markdown the text trimmed (`message-parts.tsx:191`), so an open fence's last line ends
        // without the spaces that end the text so far.
        let text: String = CHUNKS[..self.chunks].concat();
        let (_, body) = text.trim().split_once("```probe\n")?;
        let code = body.split_once("```").map_or(body, |(code, _)| code);
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
    /// The toasts [`World::settle`] dismissed, by their titles.
    toasts: RefCell<Vec<String>>,
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
    /// The two claiming plugins on `carrier`.
    fn open(carrier: Carrier) -> Self {
        Self::with(vec![
            builtin(carrier, abi::Plugin { id: "claim.a", setup: plugin_a }),
            builtin(carrier, abi::Plugin { id: "claim.b", setup: plugin_b }),
        ])
    }

    /// A TUI on the session with `builtins`. Each call in its own row: grouping folds rows, and is E.8's.
    fn with(builtins: Vec<opencode_plugin::Builtin>) -> Self {
        Self::configured(builtins, ungrouped(), false)
    }

    /// A TUI on the session with `builtins`, the transcript settings `session`, and image previews on or off.
    fn configured(builtins: Vec<opencode_plugin::Builtin>, session: Session, images: bool) -> Self {
        VIEWS.with_borrow_mut(Vec::clear);
        ARMED.set(None);
        DECLINE.with_borrow_mut(HashSet::clear);
        FIRED.with_borrow_mut(Vec::clear);
        let info = Info {
            animations: Some(false),
            session: Some(Session { image_preview: Some(images), ..session }),
            ..Info::default()
        };
        let session = support::merge(support::session(SESSION, "Claims"), json!({ "agent": "build" }));
        let fake = support::Fake::new(move |seen| match seen.path.as_str() {
            "/api/session" => (200, json!({ "data": [], "cursor": {} })),
            "/api/session/ses_c" => (200, json!({ "data": session })),
            "/api/session/ses_c/message" => (200, json!({ "data": messages(), "cursor": {} })),
            "/api/session/ses_c/permission" | "/api/session/ses_c/inbox" => (200, json!({ "data": [] })),
            _ => support::not_found(),
        });
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
        // A draft in the composer: its placeholder is random, and the frames compare every cell.
        harness.app.type_text("draft");
        // A card fills its cells: a token the theme lacks would paint nothing, and the twin's clear color would show.
        assert!(opencode_plugin::node::theme_color(&harness.tui.page(), "background.raised.base").is_some());
        let world = Self { harness, seq: Cell::new(0), toasts: RefCell::default() };
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
                // Markdown builds a claimed fence again in a new theme: a new mount, claimed afresh.
                if dark != expected.dark {
                    expected.off.remove("fence");
                }
                expected.dark = dark;
            }
            Command::Resize(narrow) => self.harness.app.resize(if narrow { WIDTH - 20 } else { WIDTH }, HEIGHT),
            Command::Wheel(up) => {
                let kind = if up { MouseEventKind::ScrollUp } else { MouseEventKind::ScrollDown };
                self.harness.app.mouse(kind, WIDTH / 2, 10);
            }
            Command::Permission(slot) => match expected.asked.take() {
                Some(id) => self.reply(&id),
                None if expected.calls[slot] != Call::None => {
                    let id = format!("per_{}", self.seq.get());
                    self.ask(&id, SLOTS[slot].0);
                    expected.asked = Some(id);
                }
                None => {}
            },
            _ => {}
        }
        self.settle();
    }

    /// What the plugin manager does to `claim.a`; it mounts the route again, so every part is claimed afresh.
    fn enable(&self, on: bool, expected: &mut Expected) {
        let tui = &self.harness.tui;
        let _ = tui.plugins.toggle(&host(tui), "claim.a", on);
        tui.navigate(tui.route());
        expected.a = on;
        expected.off.clear();
    }

    fn settle(&self) {
        let app = &self.harness.app;
        app.advance(Duration::from_millis(1));
        app.render();
        app.advance(Duration::from_millis(1));
        while let Some(toast) = self.harness.tui.toasts.current() {
            self.toasts.borrow_mut().push(toast.title.unwrap_or(toast.message));
            self.harness.tui.toasts.dismiss();
        }
        app.render();
    }

    fn frame(&self) -> Capture {
        self.harness.app.render()
    }

    /// Whether the composer has the focus.
    fn composing(&self) -> bool {
        let textarea = self.harness.tui.textarea.borrow().clone();
        self.harness.app.focused().map(|widget| widget.id()) == textarea.map(|textarea| textarea.id())
    }

    fn theme(&self) -> Theme {
        self.harness.tui.page()
    }
}

/// `node` mounted fresh, `width` by `height`, in `theme`: ABI 1.x nodes through `node::add`, the host's mount path
/// for plugin claims of 1.x, and Markdown as `opencode_ui` draws it. No reconcile. Also the rows it takes.
fn fresh(node: &v2::Node, width: u16, height: u16, theme: &Theme) -> (Capture, u32) {
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
    let capture = app.render();
    (capture, parent.rect().height as u32)
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

/// Where `shown` differs from the fresh mount of `node` at its width, with room to grow: in its height, or a cell.
fn region_diff(frame: &Capture, shown: &Shown, node: &v2::Node, theme: &Theme) -> Option<String> {
    let rect = shown.rect;
    let (x0, y0, width, height) = (rect.screen_x as u32, rect.screen_y as u32, rect.width as u32, rect.height as u32);
    if width == 0 || height == 0 || y0 + height > frame.height || x0 + width > frame.width {
        return Some(format!("{} is not on screen whole: {rect:?}", shown.id.key));
    }
    let (twin, rows) = fresh(node, width as u16, HEIGHT, theme);
    if rows != height {
        return Some(format!("{} takes {height} rows, and a fresh mount {rows}", shown.id.key));
    }
    let row = |capture: &Capture, x: u32, y: u32| -> String {
        (x..x + width).filter_map(|x| capture.cell(x, y)).map(|cell| cell.symbol.as_str()).collect()
    };
    // Every cell, a blank one's foreground too: a space a text draws takes the text's color, a cell past its end none.
    (0..height).find_map(|y| {
        let x = (0..width).find(|&x| frame.cell(x0 + x, y0 + y) != twin.cell(x, y))?;
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
    /// The terminal narrows, or takes its width back.
    Resize(bool),
    /// A wheel step over the transcript, up or down.
    Wheel(bool),
    /// A permission request for a slot's call, or the answer to the one that waits.
    Permission(usize),
}

/// What a step left: the frame, its composer, `claim.b`'s views, and every view each plugin logged.
struct Step {
    frame: Capture,
    /// The composer has the focus.
    composing: bool,
    /// The model says `claim.a` draws a part.
    a_draws: bool,
    witness: Vec<(String, Vec<String>)>,
    views: Views,
}

/// Views as a plugin logs them: the plugin, the part, and the lines it drew.
type Views = Vec<(char, String, Vec<String>)>;

/// The views logged since the last call, and those of `claim.b` with runs of one view as one: a remount views every
/// part again.
fn witness() -> (Vec<(String, Vec<String>)>, Views) {
    let views = VIEWS.with_borrow_mut(std::mem::take);
    let seen = views.iter().filter(|(plugin, _, _)| *plugin == 'b').map(|(_, key, lines)| (key.clone(), lines.clone()));
    (seen.collect(), views)
}

/// The first row where `a` and `b` differ outside the composer.
fn frame_diff(a: &Step, b: &Step) -> Option<String> {
    (0..a.frame.height).find_map(|y| {
        let differs = (0..a.frame.width).any(|x| a.frame.cell(x, y) != b.frame.cell(x, y));
        let line = |frame: &Capture| frame.text().lines().nth(y as usize).unwrap_or_default().to_owned();
        differs.then(|| format!("row {y}:\n  fault {:?}\n  twin  {:?}", line(&a.frame), line(&b.frame)))
    })
}

/// The model on one carrier.
pub struct ClaimModel {
    carrier: Carrier,
}

/// The faults `claim.a`'s log says fired, a list a step.
type Fired = Vec<Vec<(String, Fault)>>;

impl ClaimModel {
    /// Runs `commands` in the world with faults, or in the twin that takes `fired`'s faults its own way. Returns each
    /// step, the faults that fired at each step, and the first `stream-whole` failure.
    fn world(&self, commands: &[Command], fired: Option<&Fired>) -> (Vec<Step>, Fired, Option<Failure>) {
        let world = World::open(self.carrier);
        let mut expected = Expected::new();
        let (mut steps, mut log, mut failure) = (Vec::new(), Vec::new(), None);
        VIEWS.with_borrow_mut(Vec::clear);
        for (step, command) in commands.iter().enumerate() {
            let twin = fired.map(|fired| fired[step].as_slice()).unwrap_or_default();
            // A remount claims every part afresh, and a new theme the fence, which Markdown builds again.
            if let (true, Command::Enable(_)) = (fired.is_some(), command) {
                DECLINE.with_borrow_mut(HashSet::clear);
            }
            if let (true, Command::Theme(dark)) = (fired.is_some(), command)
                && *dark != expected.dark
            {
                DECLINE.with_borrow_mut(|decline| decline.remove("fence"));
            }
            // The twin declines a part from the step its fault fell back on, before that step's view.
            for (key, fault) in twin {
                if !self.fails(*fault) {
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
            if twin.iter().any(|(_, fault)| self.fails(*fault)) {
                world.enable(false, &mut expected);
                world.settle();
            }
            // What the plugin's own log says happened: a panic fails it, another fault fails one part.
            for (key, fault) in faults.iter().chain(twin) {
                match self.fails(*fault) {
                    true => expected.a = false,
                    false => drop(expected.off.insert(key.clone())),
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
            let (witness, views) = witness();
            let a_draws = expected
                .shown()
                .iter()
                .any(|(key, _)| key == "fence" || SLOTS.iter().any(|(id, name)| id == key && *name == "probe"));
            steps.push(Step { frame: world.frame(), composing: world.composing(), a_draws, witness, views });
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

impl ClaimModel {
    /// Runs `commands` in a TUI with `claim.b` alone: the host's rows of every part `claim.a` would claim.
    fn bare(&self, commands: &[Command]) -> Vec<Step> {
        let world = World::with(vec![builtin(self.carrier, abi::Plugin { id: "claim.b", setup: plugin_b })]);
        let mut expected = Expected::new();
        commands
            .iter()
            .map(|command| {
                world.send(command, &mut expected);
                let (witness, views) = witness();
                Step { frame: world.frame(), composing: world.composing(), a_draws: false, witness, views }
            })
            .collect()
    }

    /// Whether `fault` fails the plugin, rather than the part: a panic on every carrier, and an overrun of a library,
    /// which P4c fails as an external plugin's (an overrun in process is a counted host bug).
    fn fails(&self, fault: Fault) -> bool {
        fault == Fault::Panic || (fault == Fault::Overrun && self.carrier == Carrier::Abi)
    }
}

impl Model for ClaimModel {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        (0..steps)
            .map(|_| {
                let slot = rng.below(SLOTS.len());
                match rng.below(110) {
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
                    96..100 => Command::Theme(rng.below(2) == 0),
                    100..103 => Command::Resize(rng.below(2) == 0),
                    103..105 => Command::Wheel(rng.below(2) == 0),
                    _ => Command::Permission(slot),
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
        // Where no part of `claim.a` draws, the host's rows equal a TUI's that never had `claim.a`.
        if !model::skipped("host") {
            let bare = self.bare(commands);
            let host = faulty.iter().zip(&bare).enumerate().find_map(|(step, (faulty, bare))| {
                let diff = frame_diff(faulty, bare).filter(|_| !faulty.a_draws)?;
                Some(Failure { property: "host", site: "cells", step, detail: diff })
            });
            if host.is_some() {
                return host;
            }
        }
        if model::skipped("isolation") {
            return None;
        }
        faulty.iter().zip(&twin).enumerate().find_map(|(step, (faulty, twin))| {
            if let Some(diff) = frame_diff(faulty, twin) {
                return Some(Failure { property: "isolation", site: "cells", step, detail: diff });
            }
            if faulty.composing != twin.composing {
                let detail =
                    format!("the composer has the focus: {}, in the twin {}", faulty.composing, twin.composing);
                return Some(Failure { property: "isolation", site: "focus", step, detail });
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
    // A seed costs about 0.6 s debug (two worlds of 40 commands), so 3 on each carrier keep the model near 3 s; deep
    // runs take more.
    for carrier in CARRIERS {
        model::check(&ClaimModel { carrier }, 3, 40);
    }
}

/// `carrier-equal` for claims (P4, synthesis 4.14): one plugin source, linked and through the byte shims of the C ABI,
/// given the same commands, shows equal frames, and each plugin logs the same views and the same faults. An overrun
/// fails a library and only the part in process (P4c), so these commands arm no overrun.
pub struct ClaimCarriers;

impl Model for ClaimCarriers {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        let commands = ClaimModel { carrier: Carrier::Linked }.generate(rng, steps);
        commands
            .into_iter()
            .map(|command| match command {
                Command::Arm(Fault::Overrun, slot) => Command::Arm(Fault::Bad, slot),
                command => command,
            })
            .collect()
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        let (linked, linked_fired, failure) = ClaimModel { carrier: Carrier::Linked }.world(commands, None);
        if failure.is_some() {
            return failure;
        }
        let (carried, carried_fired, failure) = ClaimModel { carrier: Carrier::Abi }.world(commands, None);
        if let Some(failure) = failure {
            return Some(Failure { site: "abi", ..failure });
        }
        if model::skipped("carrier-equal") {
            return None;
        }
        let steps = linked.iter().zip(&carried).zip(linked_fired.iter().zip(&carried_fired)).enumerate();
        steps.into_iter().find_map(|(step, ((linked, carried), (linked_fired, carried_fired)))| {
            let failure = |site, detail| Some(Failure { property: "carrier-equal", site, step, detail });
            if let Some(diff) = frame_diff(linked, carried) {
                return failure("cells", diff.replace("fault", "linked").replace("twin ", "abi   "));
            }
            if linked.views != carried.views {
                return failure("views", format!("linked\n  {:?}\nabi\n  {:?}", linked.views, carried.views));
            }
            (linked_fired != carried_fired)
                .then(|| failure("faults", format!("linked {linked_fired:?}, abi {carried_fired:?}")))
                .flatten()
        })
    }

    fn simplify(&self, command: &Command) -> Vec<Command> {
        ClaimModel { carrier: Carrier::Linked }.simplify(command)
    }
}

#[test]
fn a_claim_is_equal_linked_and_through_the_c_abi() {
    model::check(&ClaimCarriers, 3, 40);
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
    CARRIERS.into_iter().for_each(each_revision_of_a_claimed_part_equals_a_fresh_mount_on);
}

fn each_revision_of_a_claimed_part_equals_a_fresh_mount_on(carrier: Carrier) {
    let mut commands = whole_stream(&[]);
    commands.insert(10, Command::Theme(false));
    assert_eq!(ClaimModel { carrier }.run(&commands), None);
    let world = World::open(carrier);
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
    CARRIERS.into_iter().for_each(a_fault_in_a_claim_falls_back_for_what_it_claims_alone_on);
}

fn a_fault_in_a_claim_falls_back_for_what_it_claims_alone_on(carrier: Carrier) {
    for (fault, slot) in
        [(Fault::Panic, 0), (Fault::Overrun, 1), (Fault::Bad, 0), (Fault::Overrun, FENCE), (Fault::Bad, FENCE)]
    {
        let mut commands = whole_stream(&[Command::Arm(fault, slot)]);
        // Mid stream, so the fallback lands between revisions.
        let at = commands.iter().position(|command| *command == Command::Call(slot)).unwrap_or(26);
        commands.insert(at, Command::Arm(fault, slot));
        let (_, fired, _) = ClaimModel { carrier }.world(&commands, None);
        assert!(fired.iter().flatten().any(|(_, fired)| *fired == fault), "{fault:?} on {slot} never fired");
        assert_eq!(ClaimModel { carrier }.run(&commands), None, "{fault:?} on slot {slot}");
    }
}

// Expected: the oracles can fail. A part whose content the model has one token short of differs from the fresh mount,
// and a twin that never disables the panicking plugin differs from the faulty world.
#[test]
fn the_oracles_can_fail() {
    CARRIERS.into_iter().for_each(the_oracles_can_fail_on);
}

fn the_oracles_can_fail_on(carrier: Carrier) {
    let world = World::open(carrier);
    let mut expected = Expected::new();
    for command in [Command::Start(0), Command::Delta(0, 0), Command::Delta(0, 1)] {
        world.send(&command, &mut expected);
    }
    assert_eq!(stream_whole(&world, &expected), Ok(1));
    expected.calls[0] = Call::Streaming(TOKENS[0].to_owned());
    assert!(matches!(stream_whole(&world, &expected), Err(("fresh", _))));
    // A part that lost its last line is not the tree the model says, however its own rows compare.
    expected.calls[0] = Call::Streaming(TOKENS[..2].concat());
    SHORT.set(true);
    world.send(&Command::Delta(0, 2), &mut expected);
    SHORT.set(false);
    assert!(matches!(stream_whole(&world, &expected), Err(("fresh", _))), "a short part passed");
    world.send(&Command::Delta(0, 3), &mut expected);
    assert_eq!(stream_whole(&world, &expected), Ok(1));
    drop(world);

    let commands = whole_stream(&[Command::Arm(Fault::Panic, 0)]);
    let (faulty, fired, _) = ClaimModel { carrier }.world(&commands, None);
    let (twin, _, _) = ClaimModel { carrier }.world(&commands, Some(&vec![Vec::new(); fired.len()]));
    assert!(faulty.iter().zip(&twin).any(|(faulty, twin)| frame_diff(faulty, twin).is_some()));

    // Where `claim.a` draws, its frames are not the host's: the comparison with the TUI without it can fail.
    let commands = whole_stream(&[]);
    let (clean, _, _) = ClaimModel { carrier }.world(&commands, None);
    let bare = ClaimModel { carrier }.bare(&commands);
    assert!(clean.iter().zip(&bare).any(|(clean, bare)| clean.a_draws && frame_diff(clean, bare).is_some()));
}

// Expected: a part streaming several revisions in one frame gets one view at once and one at the next paint, with the
// newest content; the frame between keeps the last tree.
#[test]
fn a_streaming_part_gets_one_view_a_frame() {
    CARRIERS.into_iter().for_each(a_streaming_part_gets_one_view_a_frame_on);
}

fn a_streaming_part_gets_one_view_a_frame_on(carrier: Carrier) {
    let world = World::open(carrier);
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
    CARRIERS.into_iter().for_each(a_declined_part_shows_the_host_row_on);
}

fn a_declined_part_shows_the_host_row_on(carrier: Carrier) {
    let world = World::open(carrier);
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
    CARRIERS.into_iter().for_each(a_streaming_fence_keeps_its_mount_on);
}

fn a_streaming_fence_keeps_its_mount_on(carrier: Carrier) {
    let world = World::open(carrier);
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
    CARRIERS.into_iter().for_each(leaving_the_session_frees_every_claimed_part_on);
}

fn leaving_the_session_frees_every_claimed_part_on(carrier: Carrier) {
    let world = World::open(carrier);
    let mut expected = Expected::new();
    for command in whole_stream(&[]) {
        world.send(&command, &mut expected);
    }
    assert_eq!(ledger().mounts, 4);
    // Each claimed part is a mount of its own generation (4.2), which a library keeps its memo table by.
    let generations: HashSet<u64> = mounted().iter().map(|shown| shown.id.generation).collect();
    assert_eq!(generations.len(), 4, "{:?}", mounted());
    let before = opencode_plugin::loader::native::crossed();
    world.harness.tui.navigate(opencode_tui::Route::Home);
    world.settle();
    let ledger = ledger();
    assert_eq!((ledger.mounts, ledger.content, ledger.memo_entries), (0, 0, 0), "{ledger:?}");
    assert!(mounted().is_empty());
    // A library hears that each part's mount ended, once, and nothing else crosses.
    let unmounts = opencode_plugin::loader::native::crossed().since(before).calls;
    assert_eq!(unmounts, if carrier == Carrier::Abi { 4 } else { 0 }, "{carrier:?}");
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
        let world = World { harness, seq: Cell::new(0), toasts: RefCell::default() };
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
    CARRIERS.into_iter().for_each(a_tree_refused_once_is_asked_again_whole_on);
}

fn a_tree_refused_once_is_asked_again_whole_on(carrier: Carrier) {
    let world = World::open(carrier);
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
    CARRIERS.into_iter().for_each(the_last_claim_of_a_tool_draws_it_with_its_content_at_its_width_on);
}

fn the_last_claim_of_a_tool_draws_it_with_its_content_at_its_width_on(carrier: Carrier) {
    SEEN.with_borrow_mut(Vec::clear);
    let world = World::with(vec![
        builtin(carrier, abi::Plugin { id: "claim.first", setup: shell_first }),
        builtin(carrier, abi::Plugin { id: "claim.last", setup: shell_last }),
    ]);
    let before = opencode_plugin::loader::native::crossed();
    world.emit("session.tool.input.started", json!({ "id": "call_9", "name": "bash" }));
    world.settle();
    world.harness.wait_for("l drew call_9");
    // The view and its content cross the C ABI on that carrier, and nothing crosses linked.
    let crossed = opencode_plugin::loader::native::crossed().since(before);
    match carrier {
        Carrier::Linked => assert_eq!(crossed.calls, 0, "{crossed:?}"),
        // A claim that does not declare the palette is sent none: a request stays small.
        Carrier::Abi => assert!(crossed.calls >= 1 && crossed.received > 13 && crossed.sent < 2048, "{crossed:?}"),
    }
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

/// Two claims of one plugin, each with a view of its own; the second gives the host one handle and releases the one
/// it gave before, so the part holds one.
fn two_claims(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("first", probe('1')));
    let last = Rc::new(Cell::new(None));
    setup.claim(Claim::tool("second", move |cx, part| {
        SEEN.with_borrow_mut(|seen| seen.push(('2', cx.input.width)));
        if let Some(handle) = last.take() {
            cx.release(handle);
        }
        let Part::Tool(tool) = part else { return None };
        let handle = cx.content(format!("2 drew {} {:?}", key(part), tool.state).into_bytes());
        last.set(Some(handle));
        Some(v2::Node::Markdown { id: Some("text".into()), source: v2::Source::Content(handle) })
    }));
    Ok(())
}

// Expected: each claim of a plugin draws with its own view, on both carriers, and a view that releases what it gave
// before leaves the part holding one handle.
#[test]
fn each_claim_draws_with_its_own_view_and_releases_hold() {
    for carrier in CARRIERS {
        SEEN.with_borrow_mut(Vec::clear);
        let world = World::with(vec![builtin(carrier, abi::Plugin { id: "claim.two", setup: two_claims })]);
        world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "first" }));
        world.emit("session.tool.input.started", json!({ "id": "call_2", "name": "second" }));
        world.emit("session.tool.input.delta", json!({ "id": "call_2", "delta": "x" }));
        world.emit("session.tool.called", json!({ "id": "call_2", "input": {}, "executed": true }));
        world.settle();
        world.harness.wait_for("2 drew call_2 Running");
        assert!(world.harness.app.text().contains("1 drew call_1"), "{carrier:?}:\n{}", world.harness.app.text());
        let content = ledger().content;
        assert_eq!(content, 2, "{carrier:?}: one handle each part, the released ones gone: {:?}", ledger());
        drop(world);
    }
}

// Claims among the transcript's other rules (O-115): groups, a theme change, a permission, images.

thread_local! {
    /// What the views of the rows below drew, in order.
    static DREW: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

/// A part's id, its state, whether a permission request waits on it, and the palette's `text.base` when the claim
/// reads the palette: the one line [`rules_view`] draws.
fn rule_line(cx: &v2::View<'_>, part: &Part) -> Option<String> {
    let Part::Tool(tool) = part else { return None };
    let base =
        cx.input.palette.get("text.base").map_or("-".to_owned(), |c| format!("{:02x}{:02x}{:02x}", c.r, c.g, c.b));
    Some(format!("{} {} {:?} permission {} base {base}", tool.tool.name, tool.tool.id, tool.state, tool.permission))
}

/// Draws [`rule_line`] in `text.base`, and the call's output once it finished. Declines what [`DECLINE`] names, and
/// returns a refused tree for the part [`ARMED`] names with [`Fault::Bad`].
fn rules_view(cx: &mut v2::View<'_>, part: &Part) -> Option<v2::Node> {
    let line = rule_line(cx, part)?;
    DREW.with_borrow_mut(|drew| drew.push(line.clone()));
    let key = key(part);
    if DECLINE.with_borrow(|decline| decline.contains(&key)) {
        return None;
    }
    if ARMED.with_borrow(|armed| armed.as_ref().is_some_and(|armed| *armed == (key.clone(), Fault::Bad))) {
        let text = |text: &str| v2::Node::text(vec![abi::Span::new(text)]).with_id("twice");
        return Some(v2::Node::column(vec![text("x"), text("y")]));
    }
    if ARMED.with_borrow(|armed| armed.as_ref().is_some_and(|armed| *armed == (key.clone(), Fault::Panic))) {
        ARMED.set(None);
        panic!("claim.rules fault on {key}");
    }
    let output = match part {
        Part::Tool(tool) if tool.state == abi::claim::State::Completed => Some(tool.output()),
        _ => None,
    };
    Some(card(&[line], output))
}

/// Claims `probe` and `shell` calls, and `paint` calls with the palette.
fn plugin_rules(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("probe", rules_view));
    setup.claim(Claim::tool("shell", rules_view));
    setup.claim(Claim::tool("paint", rules_view).palette());
    Ok(())
}

impl World {
    /// `plugin_rules` on `carrier`, with the transcript settings `session` and image previews on or off.
    fn rules(carrier: Carrier, session: Session, images: bool) -> Self {
        DREW.with_borrow_mut(Vec::clear);
        Self::configured(
            vec![builtin(carrier, abi::Plugin { id: "claim.rules", setup: plugin_rules })],
            session,
            images,
        )
    }

    /// Clicks the first cell of the first `text` on screen, a second after the last click so none is a double click.
    fn click(&self, text: &str) {
        let app = &self.harness.app;
        app.advance(Duration::from_secs(1));
        let screen = app.text();
        let (y, line) = screen.lines().enumerate().find(|(_, line)| line.contains(text)).unwrap_or_else(|| {
            panic!("no {text:?} on screen:\n{screen}");
        });
        let x = line[..line.find(text).unwrap()].chars().count();
        app.click(x as u16, y as u16);
        self.settle();
    }

    /// A call of `name` that streams its input, runs and finishes with the text `done {id}` and `files`.
    fn finished_call(&self, id: &str, name: &str, files: &[Value]) {
        self.emit("session.tool.input.started", json!({ "id": id, "name": name }));
        self.emit("session.tool.input.delta", json!({ "id": id, "delta": "{}" }));
        self.emit("session.tool.called", json!({ "id": id, "input": {}, "executed": true }));
        let mut content = vec![json!({ "type": "text", "text": format!("done {id}") })];
        content.extend(files.iter().cloned());
        self.emit("session.tool.success", json!({ "id": id, "content": content, "executed": true }));
        self.settle();
    }

    /// The mount of call `id`, if the call is claimed and mounted.
    fn mount_of(&self, id: &str) -> Option<Shown> {
        mounted().into_iter().find(|shown| shown.id.key == id)
    }

    /// Asserts the claim's tree shows call `id` and equals `line` (and `output`) mounted fresh.
    fn draws(&self, id: &str, line: &str, output: Option<&str>) {
        let frame = self.frame();
        let shown = self.mount_of(id).filter(|shown| shown.shows);
        let shown = shown.unwrap_or_else(|| panic!("the claim does not draw {id}:\n{}", frame.text()));
        let node = card(&[line.to_owned()], output.map(|text| v2::Source::Text(text.into())));
        if let Some(diff) = region_diff(&frame, &shown, &node, &self.theme()) {
            panic!("{diff}\nscreen:\n{}", frame.text());
        }
    }
}

/// Each call in its own row: no exploration group, and no activity group, which low verbosity makes.
fn ungrouped() -> Session {
    Session { grouping: Some(Grouping::None), verbosity: Some(Verbosity::Medium), ..Session::default() }
}

/// The default transcript settings: grouping on, low verbosity.
fn grouped() -> Session {
    Session { verbosity: Some(Verbosity::Low), ..Session::default() }
}

// Expected (E.8 with 4.11): with grouping on, a claimed call in a folded group is not mounted and its view is not
// called; unfolded, the claim draws it as it draws a call outside a group. The fallback rules hold inside the group:
// a declined revision shows the host's row; a tree refused twice leaves the call to the host for the rest of its
// mount, which folding the group ends, so unfolded again the claim draws it afresh; a panic fails the plugin and every
// call in the group shows the host's row.
#[test]
fn a_claimed_call_in_a_group_draws_while_the_group_is_open() {
    for carrier in CARRIERS {
        let world = World::rules(carrier, grouped(), false);
        world.finished_call("call_1", "probe", &[]);
        world.finished_call("call_2", "probe", &[]);
        let screen = world.frame().text();
        assert!(!screen.contains("probe call_1"), "{carrier:?}: a folded group shows its calls:\n{screen}");
        assert!(mounted().is_empty() && DREW.with_borrow(Vec::is_empty), "{carrier:?}: {:?}", mounted());
        let line = |id: &str, state: &str| format!("probe {id} {state} permission false base -");
        world.click(" tools");
        world.draws("call_1", &line("call_1", "Completed"), Some("done call_1"));
        world.draws("call_2", &line("call_2", "Completed"), Some("done call_2"));
        assert_eq!(DREW.with_borrow(Vec::len), 2, "{carrier:?}: one view a call");

        // A call that streams into the open group: declined, the host's row; accepted, the claim's.
        DECLINE.with_borrow_mut(|decline| decline.insert("call_3".to_owned()));
        world.emit("session.tool.input.started", json!({ "id": "call_3", "name": "probe" }));
        world.settle();
        let screen = world.frame().text();
        assert!(screen.contains("⋯ probe") && !screen.contains("probe call_3"), "{carrier:?}:\n{screen}");
        DECLINE.with_borrow_mut(HashSet::clear);
        world.emit("session.tool.called", json!({ "id": "call_3", "input": {}, "executed": true }));
        world.settle();
        world.draws("call_3", &line("call_3", "Running"), None);

        // Refused twice: the host's row for the rest of the mount; folding the group ends the mount.
        ARMED.set(Some(("call_3".to_owned(), Fault::Bad)));
        world.emit("session.tool.progress", json!({ "id": "call_3", "metadata": { "n": 1 } }));
        world.settle();
        let screen = world.frame().text();
        assert!(!screen.contains("probe call_3"), "{carrier:?}: the refused tree shows:\n{screen}");
        assert_eq!(world.mount_of("call_3").map(|shown| shown.shows), Some(false), "{carrier:?}");
        ARMED.set(None);
        world.emit("session.tool.progress", json!({ "id": "call_3", "metadata": { "n": 2 } }));
        world.settle();
        assert!(!world.frame().text().contains("probe call_3"), "{carrier:?}: a fallen call came back in its mount");
        let generation = world.mount_of("call_3").map(|shown| shown.id.generation);
        let before = opencode_plugin::loader::native::crossed();
        world.click(" tools");
        let screen = world.frame().text();
        assert!(mounted().is_empty() && !screen.contains("probe call_"), "{carrier:?}: {:?}\n{screen}", mounted());
        let ledger = ledger();
        assert_eq!((ledger.mounts, ledger.content, ledger.memo_entries), (0, 0, 0), "{carrier:?}: {ledger:?}");
        let unmounts = opencode_plugin::loader::native::crossed().since(before).calls;
        assert_eq!(unmounts, if carrier == Carrier::Abi { 3 } else { 0 }, "{carrier:?}: a library hears each fold");
        world.click(" tools");
        world.draws("call_3", &line("call_3", "Running"), None);
        assert_ne!(world.mount_of("call_3").map(|shown| shown.id.generation), generation, "{carrier:?}");

        // A panic fails the plugin: every call in the open group shows the host's row.
        ARMED.set(Some(("call_3".to_owned(), Fault::Panic)));
        world.emit("session.tool.progress", json!({ "id": "call_3", "metadata": { "n": 3 } }));
        world.settle();
        let screen = world.frame().text();
        assert!(mounted().is_empty() && !screen.contains("probe call_"), "{carrier:?}: {:?}\n{screen}", mounted());
        assert!(screen.contains("− "), "{carrier:?}: the group stays open:\n{screen}");
        assert_eq!(screen.matches("probe").count(), 3, "{carrier:?}: three host rows:\n{screen}");
    }
}

impl World {
    /// Switches to the dark default theme or another one, as the theme dialog does.
    fn switch_theme(&self, dark: bool) {
        let tui = &self.harness.tui;
        tui.theme.borrow_mut().set(if dark { "opencode" } else { "tokyonight" });
        tui.theme_changed();
        self.settle();
    }
}

/// The page theme's `text.base` as [`rule_line`] writes it.
fn base(world: &World) -> String {
    let color = world.theme().text.base;
    format!("{:02x}{:02x}{:02x}", color.r, color.g, color.b)
}

// Expected (4.2 with 4.11): a theme change views a claim that reads the palette again, with the new palette, and
// restyles one that does not in place, with no view, nor a view of a revision it declined. A view the new theme declines, or a tree refused twice, shows the
// host's row in place of the claim's, as any other revision would.
#[test]
fn a_claim_that_reads_the_palette_is_viewed_again_in_a_new_theme() {
    for carrier in CARRIERS {
        let world = World::rules(carrier, ungrouped(), false);
        world.finished_call("call_1", "paint", &[]);
        world.finished_call("call_2", "probe", &[]);
        // A claim that does not read the palette is not asked again about a revision it declined.
        DECLINE.with_borrow_mut(|decline| decline.insert("call_3".to_owned()));
        world.finished_call("call_3", "probe", &[]);
        DECLINE.with_borrow_mut(HashSet::clear);
        let paint = |base: &str| format!("paint call_1 Completed permission false base {base}");
        let probe = "probe call_2 Completed permission false base -";
        world.draws("call_1", &paint(&base(&world)), Some("done call_1"));
        let dark = base(&world);
        let views = DREW.with_borrow(Vec::len);
        world.switch_theme(false);
        assert_ne!(base(&world), dark);
        world.draws("call_1", &paint(&base(&world)), Some("done call_1"));
        // The probe's tree takes the new theme with no view.
        world.draws("call_2", probe, Some("done call_2"));
        assert_eq!(DREW.with_borrow(|drew| drew[views..].to_vec()), [paint(&base(&world))], "{carrier:?}");

        DECLINE.with_borrow_mut(|decline| decline.insert("call_1".to_owned()));
        world.switch_theme(true);
        let screen = world.frame().text();
        assert!(!screen.contains("paint call_1"), "{carrier:?}: a declined tree stays:\n{screen}");
        assert!(screen.contains("✓ paint"), "{carrier:?}: no host row:\n{screen}");
        DECLINE.with_borrow_mut(HashSet::clear);
        world.switch_theme(false);
        world.draws("call_1", &paint(&base(&world)), Some("done call_1"));

        ARMED.set(Some(("call_1".to_owned(), Fault::Bad)));
        world.switch_theme(true);
        ARMED.set(None);
        let screen = world.frame().text();
        assert!(!screen.contains("paint call_1"), "{carrier:?}: a refused tree shows:\n{screen}");
        assert!(screen.contains("✓ paint"), "{carrier:?}: no host row:\n{screen}");
        let views = DREW.with_borrow(Vec::len);
        world.switch_theme(false);
        assert!(!world.frame().text().contains("paint call_1"), "{carrier:?}: a fallen call came back in its mount");
        assert_eq!(DREW.with_borrow(Vec::len), views, "{carrier:?}: a fallen call is asked again");
    }
}

impl World {
    /// Applies an event that is not the session's history, as a permission request is, in this frame.
    fn signal(&self, kind: &str, data: Value) {
        let seq = self.seq.get() + 1;
        self.seq.set(seq);
        let event = json!({ "id": format!("evt_{seq}"), "created": 10_000 + seq, "type": kind, "data": data });
        let tui = &self.harness.tui;
        tui.data.apply(&[serde_json::from_value::<V2Event>(event).unwrap()]);
        assert!(self.harness.app.wait_until(support::WAIT, || tui.synced()), "the views never took the event");
    }

    /// A permission request `id` for call `call`.
    fn ask(&self, id: &str, call: &str) {
        let source = json!({ "type": "tool", "messageID": "msg_2", "id": call });
        let request =
            json!({ "id": id, "sessionID": SESSION, "action": "shell", "resources": ["*"], "source": source });
        self.signal("permission.asked", request);
    }

    fn reply(&self, id: &str) {
        self.signal("permission.replied", json!({ "sessionID": SESSION, "requestID": id, "reply": "once" }));
        self.settle();
    }
}

// Expected (4.11: "waiting for permission"): the claim is told when the session's first permission request waits on its
// call, at once and with one view, also in a frame that viewed the call already (it is a phase), and told again when
// the request is answered. With grouping on, a call that waits
// shows below its folded group, as the host's row does (`PendingEntries`), drawn by the claim; answered, it folds back.
#[test]
fn a_claimed_call_waiting_on_a_permission_is_viewed_with_it() {
    for carrier in CARRIERS {
        for session in [ungrouped(), grouped()] {
            let world = World::rules(carrier, session.clone(), false);
            world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "shell" }));
            world.emit("session.tool.called", json!({ "id": "call_1", "input": {}, "executed": true }));
            world.settle();
            let line = |waits: bool| format!("shell call_1 Running permission {waits} base -");
            let folded = session.verbosity == Some(Verbosity::Low);
            match folded {
                true => assert!(mounted().is_empty(), "{carrier:?}: {:?}", mounted()),
                false => world.draws("call_1", &line(false), None),
            }
            if !folded {
                world.emit("session.tool.progress", json!({ "id": "call_1", "metadata": { "n": 1 } }));
            }
            let views = DREW.with_borrow(Vec::len);
            world.ask("per_1", "call_1");
            if !folded {
                assert_eq!(DREW.with_borrow(|drew| drew[views..].to_vec()), [line(true)], "{carrier:?}: it waited");
            }
            world.harness.wait_for("Permission required");
            world.draws("call_1", &line(true), None);
            assert_eq!(DREW.with_borrow(|drew| drew[views..].to_vec()), [line(true)], "{carrier:?} {session:?}");
            world.reply("per_1");
            match folded {
                true => assert!(mounted().is_empty(), "{carrier:?}: it stays outside its group: {:?}", mounted()),
                false => world.draws("call_1", &line(false), None),
            }
        }
    }
}

// Expected (E.6b with 4.11): the images a call returned are the host's, below the row that draws the call: the claim's
// tree while it shows, the host's row when the claim declines, and once either way. Previews off, none show.
#[test]
fn a_claimed_call_keeps_its_images_below_the_claim() {
    // A 1x1 PNG.
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
    let shot = |name: &str| json!({ "type": "file", "uri": format!("data:image/png;base64,{png}"), "mime": "image/png", "name": name });
    let shots = [shot("a.png"), shot("b.png"), shot("c.png"), shot("d.png")];
    let line = "probe call_1 Completed permission false base -";
    for carrier in CARRIERS {
        let world = World::rules(carrier, ungrouped(), true);
        // The output by reference names the files after the text (`part_output`).
        let output = "done call_1\na.png\nb.png\nc.png\nd.png";
        world.finished_call("call_1", "probe", &shots);
        world.draws("call_1", line, Some(output));
        let screen = world.frame().text();
        let below = |screen: &str, row: &str| {
            let at = |text: &str| screen.lines().position(|line| line.contains(text));
            matches!((at(row), at("+1 more")), (Some(row), Some(more)) if more > row)
        };
        assert!(below(&screen, line), "{carrier:?}: no images below the claim's tree:\n{screen}");
        assert_eq!(screen.matches("+1 more").count(), 1, "{carrier:?}:\n{screen}");

        DECLINE.with_borrow_mut(|decline| decline.insert("call_2".to_owned()));
        world.finished_call("call_2", "probe", &shots);
        DECLINE.with_borrow_mut(HashSet::clear);
        let screen = world.frame().text();
        let host = screen.lines().skip_while(|row| !row.contains("+1 more")).skip(1).collect::<Vec<_>>().join("\n");
        assert!(below(&host, "✓ probe") && !host.contains("call_2"), "{carrier:?}: declined:\n{screen}");
        assert_eq!(screen.matches("+1 more").count(), 2, "{carrier:?}: once each call:\n{screen}");

        let world = World::rules(carrier, ungrouped(), false);
        world.finished_call("call_1", "probe", &shots);
        world.draws("call_1", line, Some(output));
        assert!(!world.frame().text().contains("more"), "{carrier:?}:\n{}", world.frame().text());
    }
}

/// Claims `nest` calls with a card whose body is a memo holding a memo, and `sibling` calls with [`probe`].
fn plugin_nest(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("nest", |cx, part| {
        let Part::Tool(tool) = part else { return None };
        let head = v2::Node::text(vec![abi::Span::new(format!("nest {} {:?}", tool.tool.id, lines(part)))]);
        let body = cx.memo("outer", 1u8, |cx| {
            v2::Node::column(vec![cx.memo("inner", 2u8, |_| v2::Node::text(vec![abi::Span::new("kept")]))])
        });
        // No other node has an id: the keyed nodes the tree sends are fewer than the values the table holds.
        Some(v2::Node::column(vec![head, body]))
    }));
    setup.claim(Claim::tool("sibling", probe('s')));
    Ok(())
}

// Expected (4.2, P4's memo check): a view that keeps a memoized subtree holding another memo is valid on both
// carriers: the library's table holds both values, and the tree the host resolves holds both keys. The plugin stays
// active, and the ledger books both values.
#[test]
fn a_kept_memo_that_holds_a_memo_is_valid_on_every_carrier() {
    for carrier in CARRIERS {
        let world = World::with(vec![builtin(carrier, abi::Plugin { id: "claim.nest", setup: plugin_nest })]);
        world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "sibling" }));
        world.emit("session.tool.input.started", json!({ "id": "call_2", "name": "nest" }));
        world.settle();
        world.emit("session.tool.input.delta", json!({ "id": "call_2", "delta": "{\"q\":" }));
        world.settle();
        world.emit("session.tool.input.delta", json!({ "id": "call_2", "delta": "1}" }));
        world.settle();
        let screen = world.frame().text();
        assert!(screen.contains("in {\\\"q\\\":1}") && screen.contains("kept"), "{carrier:?}:\n{screen}");
        assert!(screen.contains("s drew call_1"), "{carrier:?}: the plugin failed:\n{screen}");
        assert!(mounted().iter().all(|shown| shown.shows), "{carrier:?}: {:?}", mounted());
        assert_eq!(ledger().memo_entries, 2, "{carrier:?}: {:?}", ledger());
    }
}

// Expected (4.11, review finding H2): a view held back for the paint that declines, or whose tree is refused twice, or
// that overruns, hands the part to the host's row at that paint, with no event after it: the claim's tree does not
// stay up. On the C ABI an overrun fails the plugin, so every part shows the host's row.
#[test]
fn a_view_at_the_paint_that_does_not_draw_hands_the_row_back() {
    for carrier in CARRIERS {
        for fault in [None, Some(Fault::Bad), Some(Fault::Overrun)] {
            let world = World::open(carrier);
            let mut expected = Expected::new();
            world.send(&Command::Start(0), &mut expected);
            world.send(&Command::Delta(0, 0), &mut expected);
            COLD.set(false);
            // Two revisions in one frame: the first is viewed at once, the second at the paint.
            world.emit("session.tool.input.delta", json!({ "id": "call_1", "delta": "x" }));
            match fault {
                None => drop(DECLINE.with_borrow_mut(|decline| decline.insert("call_1".to_owned()))),
                Some(fault) => ARMED.set(Some(("call_1".to_owned(), fault))),
            }
            world.emit("session.tool.input.delta", json!({ "id": "call_1", "delta": "y" }));
            assert!(world.frame().text().contains("probe call_1"), "{carrier:?} {fault:?}: no tree before the paint");
            for _ in 0..3 {
                world.settle();
            }
            let screen = world.frame().text();
            assert!(!screen.contains("probe call_1"), "{carrier:?} {fault:?}: the tree stayed:\n{screen}");
            assert!(screen.contains("⋯ probe"), "{carrier:?} {fault:?}: no host row:\n{screen}");
            assert!(mounted().iter().all(|shown| !shown.shows), "{carrier:?} {fault:?}: {:?}", mounted());
        }
    }
}

// Expected (4.11, review finding H2 for fences): a fence whose view at the paint declines shows the host's code view
// of its newest code at that paint, in the block the claim had.
#[test]
fn a_fence_view_at_the_paint_that_declines_shows_the_host_code() {
    for carrier in CARRIERS {
        let world = World::open(carrier);
        let mut expected = Expected::new();
        for _ in 0..3 {
            world.send(&Command::Text, &mut expected);
        }
        world.harness.wait_for("| alpha");
        world.emit("session.text.delta", json!({ "ordinal": 0, "delta": "beta " }));
        DECLINE.with_borrow_mut(|decline| decline.insert("fence".to_owned()));
        world.emit("session.text.delta", json!({ "ordinal": 0, "delta": "gamma\n" }));
        for _ in 0..3 {
            world.settle();
        }
        let screen = world.frame().text();
        assert!(!screen.contains("| "), "{carrier:?}: the claim's tree stayed:\n{screen}");
        assert!(screen.contains("beta gamma"), "{carrier:?}: no host code of the newest revision:\n{screen}");
    }
}

// Expected (4.11, review finding M7): a part gets at most one view a frame while it streams, also while its claim
// declines it and the host's row shows it; the view at the paint that accepts takes the row back in that paint.
#[test]
fn a_declined_part_gets_one_view_a_frame_and_the_paint_takes_it_back() {
    for carrier in CARRIERS {
        let world = World::open(carrier);
        let mut expected = Expected::new();
        DECLINE.with_borrow_mut(|decline| decline.insert("call_1".to_owned()));
        world.send(&Command::Start(0), &mut expected);
        VIEWS.with_borrow_mut(Vec::clear);
        let views = || VIEWS.with_borrow(|views| views.iter().filter(|(plugin, _, _)| *plugin == 'a').count());
        for delta in TOKENS {
            world.emit("session.tool.input.delta", json!({ "id": "call_1", "delta": delta }));
        }
        assert_eq!(views(), 1, "{carrier:?}: the first revision of the frame is viewed, the rest wait");
        assert!(world.frame().text().contains("⋯ probe"), "{carrier:?}");
        DECLINE.with_borrow_mut(HashSet::clear);
        world.harness.app.render();
        world.harness.app.render();
        assert_eq!(views(), 2, "{carrier:?}: the paint views the newest revision once");
        let screen = world.frame().text();
        assert!(screen.contains("probe call_1 Pending") && !screen.contains("⋯ probe"), "{carrier:?}:\n{screen}");
    }
}

thread_local! {
    /// The fence views `claim.twice` refuses still, from its first.
    static REFUSE: Cell<usize> = const { Cell::new(0) };
}

/// Claims `probe` fences; refuses the tree of its first [`REFUSE`] views, and draws the code in a card after.
fn plugin_twice(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::fence("probe", |_, part| {
        let refused = REFUSE.with(|refuse| refuse.replace(refuse.get().saturating_sub(1)) > 0);
        let text = |text: &str| v2::Node::text(vec![abi::Span::new(text)]).with_id("twice");
        match refused {
            true => Some(v2::Node::column(vec![text("x"), text("y")])),
            false => Some(card(&lines(part), None)),
        }
    }));
    Ok(())
}

// Expected (4.11, review finding H3): a fence that falls back leaves another fence of the same text claimed: the
// fallback is the block's, not the text's.
#[test]
fn a_fence_that_falls_back_leaves_one_of_the_same_text_claimed() {
    for carrier in CARRIERS {
        let world = World::with(vec![builtin(carrier, abi::Plugin { id: "claim.twice", setup: plugin_twice })]);
        // The first fence's first view is whole, so its refusal falls it back at once.
        REFUSE.set(1);
        world.emit("session.text.started", json!({ "ordinal": 0 }));
        let text = "```probe\nsame\n```\n\nBetween.\n\n```probe\nsame\n```\n\nAfter.\n";
        world.emit("session.text.delta", json!({ "ordinal": 0, "delta": text }));
        world.settle();
        let screen = world.frame().text();
        assert_eq!(screen.matches("| same").count(), 1, "{carrier:?}: one fence claimed:\n{screen}");
        assert_eq!(screen.matches("same").count(), 2, "{carrier:?}: the other the host's:\n{screen}");
        let (shows, fallen) = mounted().iter().fold((0, 0), |(shows, fallen), shown| match shown.shows {
            true => (shows + 1, fallen),
            false => (shows, fallen + 1),
        });
        assert_eq!((shows, fallen), (1, 1), "{carrier:?}: {:?}", mounted());
    }
}

/// Claims `memo` calls with one memoized line, and declines what [`DECLINE`] names.
fn plugin_memo(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("memo", |cx, part| {
        let key = key(part);
        if DECLINE.with_borrow(|decline| decline.contains(&key)) {
            return None;
        }
        Some(cx.memo("line", key.clone(), |_| v2::Node::text(vec![abi::Span::new(format!("memo {key}"))])))
    }));
    Ok(())
}

// Expected (`ledger`, review finding M9): a declined part keeps its memo values, in the host's table and in a
// library's alike, and the ledger counts them until the mount ends; the registry of live parts holds none that went,
// without a reader pruning it.
#[test]
fn the_ledger_counts_what_a_declined_part_keeps_and_what_went() {
    for carrier in CARRIERS {
        let world = World::with(vec![builtin(carrier, abi::Plugin { id: "claim.memo", setup: plugin_memo })]);
        for index in 0..30 {
            world.emit("session.tool.input.started", json!({ "id": format!("call_{index}"), "name": "memo" }));
        }
        world.settle();
        world.harness.wait_for("memo call_29");
        assert_eq!(ledger().memo_entries, 30, "{carrier:?}: {:?}", ledger());
        DECLINE.with_borrow_mut(|decline| decline.insert("call_0".to_owned()));
        world.emit("session.tool.input.delta", json!({ "id": "call_0", "delta": "x" }));
        world.settle();
        assert!(!world.frame().text().contains("memo call_0"), "{carrier:?}");
        assert_eq!(ledger().memo_entries, 30, "{carrier:?}: the declined part's value went: {:?}", ledger());
        world.harness.tui.navigate(opencode_tui::Route::Home);
        world.settle();
        assert_eq!((ledger().mounts, ledger().memo_entries), (0, 0), "{carrier:?}");
        assert_eq!(opencode_plugin::claim::registered(), 0, "{carrier:?}: the registry keeps parts that went");
        DECLINE.with_borrow_mut(HashSet::clear);
    }
}

thread_local! {
    /// What `claim.label`'s views saw of each call: its id, the content items and the bytes of metadata.
    static RESULTS: RefCell<Vec<(String, usize, usize)>> = const { RefCell::new(Vec::new()) };
}

/// Claims `label` calls with a one-line label of the call's state, and logs what each view saw of the result.
fn plugin_label(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("label", |_, part| {
        let Part::Tool(tool) = part else { return None };
        let (content, metadata) = match &tool.tool.state {
            SessionMessageAssistantToolState::Running(state) => (0, json!(state.metadata).to_string().len()),
            SessionMessageAssistantToolState::Completed(state) => {
                (state.content.len(), state.metadata.as_ref().map_or(0, |metadata| json!(metadata).to_string().len()))
            }
            _ => (0, 0),
        };
        RESULTS.with_borrow_mut(|results| results.push((tool.tool.id.clone(), content, metadata)));
        Some(v2::Node::text(vec![abi::Span::new(format!("label {} {:?}", tool.tool.id, tool.state))]))
    }));
    Ok(())
}

// Expected (synthesis 4.2: output by reference; review finding H4): what a call returned stays with the host. A
// claim's view of a call that returned 100 KB and an image gets the call without them, and through the C ABI its
// request stays under 4 KB, also when a resize views it again; metadata over 4 KB is left out, and less is sent.
#[test]
fn a_claimed_call_sends_its_view_no_result() {
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
    let line = format!("{}\n", "word ".repeat(16));
    let text = line.repeat(102_400 / line.len());
    for carrier in CARRIERS {
        RESULTS.with_borrow_mut(Vec::clear);
        let world = World::with(vec![builtin(carrier, abi::Plugin { id: "claim.label", setup: plugin_label })]);
        world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "label" }));
        world.emit("session.tool.called", json!({ "id": "call_1", "input": {}, "executed": true }));
        world.emit("session.tool.progress", json!({ "id": "call_1", "metadata": { "n": 1 } }));
        world.settle();
        world.emit("session.tool.progress", json!({ "id": "call_1", "metadata": { "log": "x".repeat(10_000) } }));
        world.settle();
        let content = json!([
            { "type": "text", "text": text },
            { "type": "file", "uri": format!("data:image/png;base64,{png}"), "mime": "image/png", "name": "a.png" },
        ]);
        let before = opencode_plugin::loader::native::crossed();
        world.emit("session.tool.success", json!({ "id": "call_1", "content": content, "executed": true }));
        world.settle();
        world.harness.wait_for("label call_1 Completed");
        let finished = opencode_plugin::loader::native::crossed().since(before);
        let before = opencode_plugin::loader::native::crossed();
        world.harness.app.resize(WIDTH - 10, HEIGHT);
        world.settle();
        world.settle();
        let resized = opencode_plugin::loader::native::crossed().since(before);
        if carrier == Carrier::Abi {
            assert!(finished.calls >= 1 && finished.sent < 4096, "{finished:?}");
            assert!(resized.calls >= 1 && resized.sent < 4096, "{resized:?}");
        }
        let results = RESULTS.with_borrow(Vec::clone);
        let progress: Vec<usize> = results.iter().map(|(_, _, metadata)| *metadata).collect();
        assert!(
            progress.contains(&json!({ "n": 1 }).to_string().len()),
            "{carrier:?}: small metadata goes: {results:?}"
        );
        assert!(progress.iter().all(|bytes| *bytes <= 4096), "{carrier:?}: {results:?}");
        assert!(results.iter().all(|(_, content, _)| *content == 0), "{carrier:?}: a view saw the result: {results:?}");
    }
}

thread_local! {
    /// The width below which `claim.narrow` draws, and the inputs its views got: width and height.
    static NARROW: Cell<u16> = const { Cell::new(0) };
    static INPUTS: RefCell<Vec<(u16, u16)>> = const { RefCell::new(Vec::new()) };
}

/// Claims `narrow` calls and `narrow` fences while the part is narrower than [`NARROW`], and declines wider ones.
fn plugin_narrow(setup: &mut abi::Setup) -> Result<(), String> {
    let view = |cx: &mut v2::View<'_>, part: &Part| {
        INPUTS.with_borrow_mut(|inputs| inputs.push((cx.input.width, cx.input.height)));
        (cx.input.width < NARROW.get())
            .then(|| v2::Node::text(vec![abi::Span::new(format!("narrow {} at {}", key(part), cx.input.width))]))
    };
    setup.claim(Claim::tool("narrow", view));
    setup.claim(Claim::fence("narrow", view));
    Ok(())
}

// Expected (4.2 with 4.11, review finding M8): a claim's view sees the inputs it can read as they are now. A part the
// claim declined at one width is asked again at another, for a call and a fence alike, and the claim draws it when it
// accepts; a part has no height of its own, so a resize of the terminal's height leaves nothing stale.
#[test]
fn a_part_is_viewed_again_at_a_new_width_and_gets_no_height() {
    for carrier in CARRIERS {
        INPUTS.with_borrow_mut(Vec::clear);
        NARROW.set(90);
        let world = World::with(vec![builtin(carrier, abi::Plugin { id: "claim.narrow", setup: plugin_narrow })]);
        world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "narrow" }));
        world.emit("session.text.started", json!({ "ordinal": 0 }));
        world.emit("session.text.delta", json!({ "ordinal": 0, "delta": "```narrow\nfits\n```\n\nAfter.\n" }));
        world.settle();
        let screen = world.frame().text();
        assert!(!screen.contains("narrow call_1") && screen.contains("fits"), "{carrier:?}: drew wide:\n{screen}");
        world.harness.app.resize(WIDTH - 20, HEIGHT);
        for _ in 0..3 {
            world.settle();
        }
        let screen = world.frame().text();
        assert!(screen.contains("narrow call_1 at"), "{carrier:?}: the call was not asked again:\n{screen}");
        assert!(screen.contains("narrow fence at"), "{carrier:?}: the fence was not asked again:\n{screen}");
        world.harness.app.resize(WIDTH - 20, HEIGHT - 9);
        world.settle();
        assert!(INPUTS.with_borrow(|inputs| inputs.iter().all(|(_, height)| *height == 0)), "{carrier:?}");
    }
}

/// Claims `tall` calls with twelve lines, `{id}:{line}`; refuses the tree of what [`ARMED`] names with [`Fault::Bad`].
fn plugin_tall(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("tall", |_, part| {
        let key = key(part);
        if ARMED.with_borrow(|armed| armed.as_ref().is_some_and(|armed| *armed == (key.clone(), Fault::Bad))) {
            let text = |text: &str| v2::Node::text(vec![abi::Span::new(text)]).with_id("twice");
            return Some(v2::Node::column(vec![text("x"), text("y")]));
        }
        let lines = (0..12).map(|line| v2::Node::text(vec![abi::Span::new(format!("{key}:{line}"))])).collect();
        Some(v2::Node::column(lines))
    }));
    Ok(())
}

// Expected (review finding H5): a claimed call above the reader that falls back to the host's shorter row, away from
// the tail, leaves the reader's rows where they were on screen; at the tail the transcript stays at the tail.
#[test]
fn a_part_that_falls_back_above_the_reader_leaves_the_reader_in_place() {
    for carrier in CARRIERS {
        let world = World::with(vec![builtin(carrier, abi::Plugin { id: "claim.tall", setup: plugin_tall })]);
        world.harness.app.resize(WIDTH, 30);
        for index in 0..9 {
            world.emit("session.tool.input.started", json!({ "id": format!("call_{index}"), "name": "tall" }));
            world.emit("session.tool.called", json!({ "id": format!("call_{index}"), "input": {}, "executed": true }));
        }
        world.settle();
        for _ in 0..4 {
            world.harness.app.mouse(MouseEventKind::ScrollUp, WIDTH / 2, 10);
            world.settle();
        }
        let rows = |screen: String| -> Vec<String> {
            screen.lines().map(str::trim).filter(|line| line.starts_with("call_")).map(str::to_owned).collect()
        };
        let before = rows(world.frame().text());
        assert!(!before.iter().any(|row| row.starts_with("call_0:")), "{carrier:?}: call_0 is on screen: {before:?}");
        ARMED.set(Some(("call_0".to_owned(), Fault::Bad)));
        world.emit("session.tool.progress", json!({ "id": "call_0", "metadata": { "n": 1 } }));
        world.settle();
        ARMED.set(None);
        assert!(world.mount_of("call_0").is_some_and(|shown| !shown.shows), "{carrier:?}: call_0 did not fall back");
        let after = rows(world.frame().text());
        assert_eq!(after, before, "{carrier:?}: the reader moved");
        // A part below the reader's rows changes nothing above it.
        assert!(!before.iter().any(|row| row.starts_with("call_8:")), "{carrier:?}: call_8 is on screen: {before:?}");
        ARMED.set(Some(("call_8".to_owned(), Fault::Bad)));
        world.emit("session.tool.progress", json!({ "id": "call_8", "metadata": { "n": 1 } }));
        world.settle();
        ARMED.set(None);
        assert!(world.mount_of("call_8").is_some_and(|shown| !shown.shows), "{carrier:?}: call_8 did not fall back");
        assert_eq!(rows(world.frame().text()), before, "{carrier:?}: a part below moved the reader");

        // At the tail, the transcript stays at its bottom.
        let world = World::with(vec![builtin(carrier, abi::Plugin { id: "claim.tall", setup: plugin_tall })]);
        world.harness.app.resize(WIDTH, 30);
        for index in 0..9 {
            world.emit("session.tool.input.started", json!({ "id": format!("call_{index}"), "name": "tall" }));
            world.emit("session.tool.called", json!({ "id": format!("call_{index}"), "input": {}, "executed": true }));
        }
        world.settle();
        ARMED.set(Some(("call_0".to_owned(), Fault::Bad)));
        world.emit("session.tool.progress", json!({ "id": "call_0", "metadata": { "n": 1 } }));
        world.settle();
        ARMED.set(None);
        let screen = rows(world.frame().text());
        assert_eq!(screen.last().map(String::as_str), Some("call_8:11"), "{carrier:?}: left the tail: {screen:?}");
    }
}

// Expected (synthesis 4.4 and P4c, review policy on decisions 4 and 14): the one rule that differs by carrier. An
// overrun of a claim's view in process is a counted host bug: that part falls back, the plugin stays active and its
// other part keeps its tree, with no toast. As a library the plugin fails, as an external plugin does: every part it
// claimed shows the host's row, with the `Plugin failed` toast. The other plugin's claim draws on, on both.
#[test]
fn an_overrun_falls_back_in_process_and_fails_a_library() {
    for carrier in CARRIERS {
        let world = World::open(carrier);
        let mut expected = Expected::new();
        for slot in [0, 1, 2] {
            world.send(&Command::Start(slot), &mut expected);
        }
        COLD.set(false);
        ARMED.set(Some(("call_1".to_owned(), Fault::Overrun)));
        world.send(&Command::Delta(0, 0), &mut expected);
        let status =
            world.harness.tui.plugins.entries().into_iter().find(|entry| entry.id == "claim.a").unwrap().status;
        let screen = world.frame().text();
        let failed = world.toasts.borrow().iter().any(|toast| toast == "Plugin failed: claim.a");
        assert!(!screen.contains("probe call_1") && screen.contains("witness call_3"), "{carrier:?}:\n{screen}");
        match carrier {
            Carrier::Linked => {
                assert_eq!(status, opencode_plugin::Status::Active, "{carrier:?}");
                assert_eq!(world.harness.tui.plugins.monitor().host_overruns(), 1, "{carrier:?}");
                assert!(screen.contains("probe call_2") && !failed, "{carrier:?}:\n{screen}");
            }
            Carrier::Abi => {
                assert!(matches!(status, opencode_plugin::Status::Failed(_)), "{carrier:?}: {status:?}");
                assert!(!screen.contains("probe call_2") && failed, "{carrier:?}:\n{screen}");
            }
        }
    }
}

thread_local! {
    /// The flags `claim.closed`'s fence views got: streaming, closed.
    static FLAGS: RefCell<Vec<(bool, bool)>> = const { RefCell::new(Vec::new()) };
}

/// Claims `probe` fences and logs the flags each view got.
fn plugin_closed(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::fence("probe", |_, part| {
        let Part::Fence(fence) = part else { return None };
        FLAGS.with_borrow_mut(|flags| flags.push((fence.streaming, fence.closed)));
        Some(card(&lines(part), None))
    }));
    Ok(())
}

// Expected (review policy on fence closure): a claimed fence learns that it closed once Markdown decides the closing
// line. The transcript gives Markdown the text trimmed (`message-parts.tsx:191`), so a closing line at the end of the
// text so far is pending: the fence is open until more text follows it, and closed, no longer streaming, once the
// message completes.
#[test]
fn a_claimed_fence_learns_it_closed_once_markdown_decides_it() {
    for carrier in CARRIERS {
        FLAGS.with_borrow_mut(Vec::clear);
        let world = World::with(vec![builtin(carrier, abi::Plugin { id: "claim.closed", setup: plugin_closed })]);
        let last = || FLAGS.with_borrow(|flags| flags.last().copied());
        world.emit("session.text.started", json!({ "ordinal": 0 }));
        world.emit("session.text.delta", json!({ "ordinal": 0, "delta": "```probe\nx\n" }));
        world.settle();
        assert_eq!(last(), Some((true, false)), "{carrier:?}");
        world.emit("session.text.delta", json!({ "ordinal": 0, "delta": "```\n" }));
        world.settle();
        assert_eq!(last(), Some((true, false)), "{carrier:?}: a closing line that ends the text is pending");
        world.emit("session.text.delta", json!({ "ordinal": 0, "delta": "\nAfter.\n" }));
        world.settle();
        assert_eq!(last(), Some((true, true)), "{carrier:?}: text after the closing line decides it");
        let tokens = json!({ "input": 1, "output": 1, "reasoning": 0, "cache": { "read": 0, "write": 0 } });
        world.emit("session.step.ended", json!({ "finish": "stop", "cost": 0, "tokens": tokens }));
        world.settle();
        assert_eq!(last(), Some((false, true)), "{carrier:?}: the message completed");
    }
}

/// Claims `probe` fences with Markdown that holds the fence's code in another `probe` fence: unbounded, were a fence
/// in a claimed part's Markdown claimed again.
fn plugin_nested(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::fence("probe", |_, part| {
        let Part::Fence(fence) = part else { return None };
        let source = v2::Source::Text(format!("nested\n\n```probe\n{}\n```\n", fence.code));
        Some(v2::Node::column(vec![v2::Node::Markdown { id: Some("text".into()), source }]))
    }));
    Ok(())
}

// Expected (review finding carbon-2): a fence in the Markdown of a claimed part is not claimed again: Markdown draws it
// as code, so a claim whose tree holds its own fence draws once and the TUI lives.
#[test]
fn a_fence_in_a_claimed_part_is_not_claimed_again() {
    for carrier in CARRIERS {
        let world = World::with(vec![builtin(carrier, abi::Plugin { id: "claim.nested", setup: plugin_nested })]);
        world.emit("session.text.started", json!({ "ordinal": 0 }));
        world.emit("session.text.delta", json!({ "ordinal": 0, "delta": "```probe\ncode\n```\n\nAfter.\n" }));
        world.settle();
        let screen = world.frame().text();
        assert_eq!(screen.matches("nested").count(), 1, "{carrier:?}:\n{screen}");
        assert_eq!(screen.matches("code").count(), 1, "{carrier:?}:\n{screen}");
        assert_eq!(mounted().len(), 1, "{carrier:?}: {:?}", mounted());
    }
}

/// Claims `cache` calls: gives the host its text once, as content, and names that handle in every later view; declines
/// a running call.
fn plugin_cache(setup: &mut abi::Setup) -> Result<(), String> {
    let cached = Rc::new(RefCell::new(std::collections::HashMap::new()));
    setup.claim(Claim::tool("cache", move |cx, part| {
        let Part::Tool(tool) = part else { return None };
        DREW.with_borrow_mut(|drew| drew.push(format!("{:?}", tool.state)));
        if tool.state == abi::claim::State::Running {
            return None;
        }
        let generation = cx.mount.generation;
        let handle = *cached.borrow_mut().entry(generation).or_insert_with(|| cx.content(b"cached body".to_vec()));
        Some(v2::Node::column(vec![v2::Node::Markdown {
            id: Some("body".into()),
            source: v2::Source::Content(handle),
        }]))
    }));
    Ok(())
}

// Expected (4.2: a handle lives until the mount ends or the plugin releases it; review finding carbon-6): a part the
// claim declined keeps the content its views gave, so a later view may name it again; the ledger counts it until the
// mount ends. A tree refused for anything but a keep the host does not hold falls back with no second view.
#[test]
fn a_declined_part_keeps_its_content_and_a_bad_tree_gets_one_view() {
    for carrier in CARRIERS {
        DREW.with_borrow_mut(Vec::clear);
        let world = World::with(vec![builtin(carrier, abi::Plugin { id: "claim.cache", setup: plugin_cache })]);
        world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "cache" }));
        world.settle();
        world.harness.wait_for("cached body");
        world.emit("session.tool.called", json!({ "id": "call_1", "input": {}, "executed": true }));
        world.settle();
        assert!(!world.frame().text().contains("cached body"), "{carrier:?}: declined, the tree stays");
        assert_eq!(ledger().content, 1, "{carrier:?}: the declined part's handle went: {:?}", ledger());
        let done = json!([{ "type": "text", "text": "done" }]);
        world.emit("session.tool.success", json!({ "id": "call_1", "content": done, "executed": true }));
        world.settle();
        let screen = world.frame().text();
        assert!(screen.contains("cached body"), "{carrier:?}: the handle is gone:\n{screen}");
        assert!(world.mount_of("call_1").is_some_and(|shown| shown.shows), "{carrier:?}");

        // A duplicate id is the plugin's error: one view, and the part falls back.
        let world = World::rules(carrier, ungrouped(), false);
        world.emit("session.tool.input.started", json!({ "id": "call_2", "name": "probe" }));
        world.settle();
        ARMED.set(Some(("call_2".to_owned(), Fault::Bad)));
        let views = DREW.with_borrow(Vec::len);
        world.emit("session.tool.called", json!({ "id": "call_2", "input": {}, "executed": true }));
        world.settle();
        ARMED.set(None);
        assert_eq!(DREW.with_borrow(Vec::len) - views, 1, "{carrier:?}: a bad tree was asked again");
        assert!(world.mount_of("call_2").is_some_and(|shown| !shown.shows), "{carrier:?}");
        let views = DREW.with_borrow(Vec::len);
        ARMED.set(Some(("call_3".to_owned(), Fault::Bad)));
        world.emit("session.tool.input.started", json!({ "id": "call_3", "name": "probe" }));
        world.settle();
        ARMED.set(None);
        assert_eq!(DREW.with_borrow(Vec::len) - views, 1, "{carrier:?}: a first, whole view was asked again");
    }
}

thread_local! {
    static BUMPS: Cell<u32> = const { Cell::new(0) };
}

/// Claims `bump` calls with a card that shows how often its command ran, and runs the command on a click.
fn plugin_bump(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(abi::Command { name: "claim.bump".into(), ..abi::Command::default() }, |_, _| {
        BUMPS.set(BUMPS.get() + 1);
    });
    setup.claim(Claim::tool("bump", |_, part| {
        let text = format!("{} bumped {}", key(part), BUMPS.get());
        Some(
            v2::Node::text(vec![abi::Span::new(text)])
                .with_id("bump")
                .on_click(abi::Click::command("claim.bump", None)),
        )
    }));
    Ok(())
}

// Expected (synthesis 4.4: a handler of the plugin ran, so what it changed shows; review finding carbon-4): a claimed
// part is drawn again after its plugin's command runs, from a click on the part or from the keymap, on both carriers.
#[test]
fn a_claimed_part_draws_again_after_its_plugin_runs_a_command() {
    for carrier in CARRIERS {
        BUMPS.set(0);
        let world = World::with(vec![builtin(carrier, abi::Plugin { id: "claim.bump", setup: plugin_bump })]);
        world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "bump" }));
        world.settle();
        let screen = world.harness.wait_for("call_1 bumped 0");
        let y = screen.lines().position(|line| line.contains("call_1 bumped")).unwrap() as u16;
        world.harness.app.click(4, y);
        world.settle();
        world.settle();
        assert_eq!(BUMPS.get(), 1, "{carrier:?}: the click ran no command");
        assert!(world.frame().text().contains("call_1 bumped 1"), "{carrier:?}:\n{}", world.frame().text());
        world.harness.tui.keymap.dispatch("claim.bump", None);
        world.settle();
        world.settle();
        assert!(world.frame().text().contains("call_1 bumped 2"), "{carrier:?}:\n{}", world.frame().text());
    }
}
