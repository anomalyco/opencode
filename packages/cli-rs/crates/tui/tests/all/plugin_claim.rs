//! Exercise renderer claims on a streaming transcript. Compare claimed rows with a fresh mount; a
//! failed claim must hand the row back to the host.

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
    /// Injected faults observed by the claim.
    static FIRED: RefCell<Vec<(String, Fault)>> = const { RefCell::new(Vec::new()) };
    static CLOCK: RefCell<Option<Rc<Cell<Duration>>>> = const { RefCell::new(None) };
    /// The first call after setup is exempt from overrun failure.
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
        // A closing delimiter need not change the fence's code.
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
        // Trim the open fence's last line the same way the transcript trims Markdown input.
        let text: String = CHUNKS[..self.chunks].concat();
        let (_, body) = text.trim().split_once("```probe\n")?;
        let code = body.split_once("```").map_or(body, |(code, _)| code);
        // Markdown holds back an open fence with no code yet: the host has no block to hand over.
        (!code.is_empty()).then(|| code.lines().map(|line| format!("| {line}")).collect())
    }

    /// Visible part trees by claim key.
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
            "time": { "created": 1500 }, "content": CONTENT.with_borrow(Clone::clone),
        },
        { "id": "msg_1", "type": "user", "text": "Stream it", "time": { "created": 1000 } },
    ])
}

impl World {
    /// The two claiming plugins on `carrier`.
    fn open() -> Self {
        Self::with(vec![
            abi::Plugin { id: "claim.a", setup: plugin_a }.into(),
            abi::Plugin { id: "claim.b", setup: plugin_b }.into(),
        ])
    }

    /// Disable grouping so each tool call occupies its own transcript row.
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
        let tui = &self.harness.tui;
        tui.data.apply(vec![support::event(SESSION, kind, seq, support::merge(ids, data))]);
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
            Command::Burst(index) => {
                if let Call::Streaming(text) = &mut expected.calls[index] {
                    for token in &TOKENS[..2] {
                        text.push_str(token);
                        self.emit("session.tool.input.delta", support::merge(tool(index), json!({ "delta": token })));
                    }
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
                // The pointer leaves: a row a remount builds again under it is not hovered until the pointer moves.
                self.harness.app.hover(WIDTH + 1, HEIGHT + 1);
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
        tui.navigate((*tui.route()).clone());
        expected.a = on;
        expected.off.clear();
    }

    fn settle(&self) {
        let app = &self.harness.app;
        app.advance(Duration::from_millis(1));
        app.render();
        app.advance(Duration::from_millis(1));
        // A view at a paint may fail its plugin as the frame renders, and its toast comes after, from the effect
        // queue: until none is left.
        for round in 0..4 {
            app.advance(Duration::from_millis(1));
            let mut shown = false;
            while let Some(toast) = self.harness.tui.toasts.current() {
                self.toasts.borrow_mut().push(toast.title.unwrap_or(toast.message));
                self.harness.tui.toasts.dismiss();
                shown = true;
            }
            app.render();
            if round > 0 && !shown {
                break;
            }
        }
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
    /// Two deltas of a slot's input in one frame: the second is viewed at the paint.
    Burst(usize),
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
    #[allow(dead_code)]
    views: Views,
}

/// Views as a plugin logs them: the plugin, the part, and the lines it drew.
type Views = Vec<(char, String, Vec<String>)>;

/// Collapse adjacent identical witness views: a remount revisits every part.
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

/// The model.
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
        let world = World::with(vec![abi::Plugin { id: "claim.b", setup: plugin_b }.into()]);
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

    /// Panics fail the plugin. A time overrun falls back for a linked claim.
    fn fails(&self, fault: Fault) -> bool {
        fault == Fault::Panic
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
                    12..30 => Command::Delta(slot, rng.below(TOKENS.len())),
                    30..34 => Command::Burst(slot),
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
    // A seed costs about 0.6 s debug (two worlds of 40 commands), so 3 keep the model short; deep
    // runs take more.
    model::check(&ClaimModel, 3, 40);
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
    expected.calls[0] = Call::Streaming("wrong input".into());
    assert!(stream_whole(&world, &expected).is_err());
}

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
    assert_eq!(views(), 0, "a streaming revision is viewed as the paint starts");
    world.harness.app.render();
    assert_eq!(views(), 1, "the paint views the newest content once");
    world.harness.app.render();
    assert_eq!(views(), 1, "the paint after views nothing");
    assert_eq!(stream_whole(&world, &expected), Ok(1));
    world.send(&Command::Delta(0, 0), &mut expected);
    world.emit("session.tool.input.delta", json!({ "id": "call_1", "delta": TOKENS[1] }));
    let before = views();
    world.emit("session.tool.called", json!({ "id": "call_1", "input": { "q": "aa aa bb" }, "executed": true }));
    assert_eq!(views(), before + 1, "a phase change waited for the paint");
}

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

#[test]
fn each_claim_draws_with_its_own_view_and_releases_hold() {
    SEEN.with_borrow_mut(Vec::clear);
    let world = World::with(vec![abi::Plugin { id: "claim.two", setup: two_claims }.into()]);
    world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "first" }));
    world.emit("session.tool.input.started", json!({ "id": "call_2", "name": "second" }));
    world.emit("session.tool.input.delta", json!({ "id": "call_2", "delta": "x" }));
    world.emit("session.tool.called", json!({ "id": "call_2", "input": {}, "executed": true }));
    world.settle();
    world.harness.wait_for("2 drew call_2 Running");
    assert!(world.harness.app.text().contains("1 drew call_1"), "{}", world.harness.app.text());
    let content = ledger().content;
    assert_eq!(content, 2, "one handle each part, the released ones gone: {:?}", ledger());
    drop(world);
}

thread_local! {
    /// What the views of the rows below drew, in order.
    static DREW: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    /// What the session's assistant message holds as the TUI opens it.
    static CONTENT: RefCell<Vec<Value>> = const { RefCell::new(Vec::new()) };
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
    fn rules(session: Session, images: bool) -> Self {
        DREW.with_borrow_mut(Vec::clear);
        Self::configured(vec![abi::Plugin { id: "claim.rules", setup: plugin_rules }.into()], session, images)
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

#[test]
fn a_claim_that_reads_the_palette_is_viewed_again_in_a_new_theme() {
    let world = World::rules(ungrouped(), false);
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
    assert_eq!(DREW.with_borrow(|drew| drew[views..].to_vec()), [paint(&base(&world))]);

    DECLINE.with_borrow_mut(|decline| decline.insert("call_1".to_owned()));
    world.switch_theme(true);
    let screen = world.frame().text();
    assert!(!screen.contains("paint call_1"), "a declined tree stays:\n{screen}");
    assert!(screen.contains("✓ paint"), "no host row:\n{screen}");
    DECLINE.with_borrow_mut(HashSet::clear);
    world.switch_theme(false);
    world.draws("call_1", &paint(&base(&world)), Some("done call_1"));

    ARMED.set(Some(("call_1".to_owned(), Fault::Bad)));
    world.switch_theme(true);
    ARMED.set(None);
    let screen = world.frame().text();
    assert!(!screen.contains("paint call_1"), "a refused tree shows:\n{screen}");
    assert!(screen.contains("✓ paint"), "no host row:\n{screen}");
    let views = DREW.with_borrow(Vec::len);
    world.switch_theme(false);
    assert!(!world.frame().text().contains("paint call_1"), "a fallen call came back in its mount");
    assert_eq!(DREW.with_borrow(Vec::len), views, "a fallen call is asked again");
}

impl World {
    /// Applies an event that is not the session's history, as a permission request is, in this frame.
    fn signal(&self, kind: &str, data: Value) {
        let seq = self.seq.get() + 1;
        self.seq.set(seq);
        let event = json!({ "id": format!("evt_{seq}"), "created": 10_000 + seq, "type": kind, "data": data });
        let tui = &self.harness.tui;
        tui.data.apply(vec![serde_json::from_value::<V2Event>(event).unwrap()]);
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

#[test]
fn a_claimed_call_waiting_on_a_permission_is_viewed_with_it() {
    for session in [ungrouped(), grouped()] {
        let world = World::rules(session.clone(), false);
        world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "shell" }));
        world.emit("session.tool.called", json!({ "id": "call_1", "input": {}, "executed": true }));
        world.settle();
        let line = |waits: bool| format!("shell call_1 Running permission {waits} base -");
        let folded = session.verbosity == Some(Verbosity::Low);
        match folded {
            true => assert!(mounted().is_empty(), "{:?}", mounted()),
            false => world.draws("call_1", &line(false), None),
        }
        if !folded {
            world.emit("session.tool.progress", json!({ "id": "call_1", "metadata": { "n": 1 } }));
        }
        let views = DREW.with_borrow(Vec::len);
        world.ask("per_1", "call_1");
        if !folded {
            assert_eq!(DREW.with_borrow(|drew| drew[views..].to_vec()), [line(true)], "it waited");
        }
        world.harness.wait_for("Permission required");
        world.draws("call_1", &line(true), None);
        assert_eq!(DREW.with_borrow(|drew| drew[views..].to_vec()), [line(true)], "{session:?}");
        world.reply("per_1");
        match folded {
            true => assert!(mounted().is_empty(), "it stays outside its group: {:?}", mounted()),
            false => world.draws("call_1", &line(false), None),
        }
    }
}

#[test]
fn a_claimed_call_keeps_its_images_below_the_claim() {
    // A 1x1 PNG.
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
    let shot = |name: &str| json!({ "type": "file", "uri": format!("data:image/png;base64,{png}"), "mime": "image/png", "name": name });
    let shots = [shot("a.png"), shot("b.png"), shot("c.png"), shot("d.png")];
    let line = "probe call_1 Completed permission false base -";
    let world = World::rules(ungrouped(), true);
    // The output by reference names the files after the text (`part_output`).
    let output = "done call_1\na.png\nb.png\nc.png\nd.png";
    world.finished_call("call_1", "probe", &shots);
    world.draws("call_1", line, Some(output));
    let screen = world.frame().text();
    let below = |screen: &str, row: &str| {
        let at = |text: &str| screen.lines().position(|line| line.contains(text));
        matches!((at(row), at("+1 more")), (Some(row), Some(more)) if more > row)
    };
    assert!(below(&screen, line), "no images below the claim's tree:\n{screen}");
    assert_eq!(screen.matches("+1 more").count(), 1, "{screen}");

    DECLINE.with_borrow_mut(|decline| decline.insert("call_2".to_owned()));
    world.finished_call("call_2", "probe", &shots);
    DECLINE.with_borrow_mut(HashSet::clear);
    let screen = world.frame().text();
    let host = screen.lines().skip_while(|row| !row.contains("+1 more")).skip(1).collect::<Vec<_>>().join("\n");
    assert!(below(&host, "✓ probe") && !host.contains("call_2"), "declined:\n{screen}");
    assert_eq!(screen.matches("+1 more").count(), 2, "once each call:\n{screen}");

    let world = World::rules(ungrouped(), false);
    world.finished_call("call_1", "probe", &shots);
    world.draws("call_1", line, Some(output));
    assert!(!world.frame().text().contains("more"), "{}", world.frame().text());
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

#[test]
fn a_kept_memo_that_holds_a_memo_is_valid_on_every_carrier() {
    let world = World::with(vec![abi::Plugin { id: "claim.nest", setup: plugin_nest }.into()]);
    world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "sibling" }));
    world.emit("session.tool.input.started", json!({ "id": "call_2", "name": "nest" }));
    world.settle();
    world.emit("session.tool.input.delta", json!({ "id": "call_2", "delta": "{\"q\":" }));
    world.settle();
    world.emit("session.tool.input.delta", json!({ "id": "call_2", "delta": "1}" }));
    world.settle();
    let screen = world.frame().text();
    assert!(screen.contains("in {\\\"q\\\":1}") && screen.contains("kept"), "{screen}");
    assert!(screen.contains("s drew call_1"), "the plugin failed:\n{screen}");
    assert!(mounted().iter().all(|shown| shown.shows), "{:?}", mounted());
    assert_eq!(ledger().memo_entries, 2, "{:?}", ledger());
}

#[test]
fn a_view_at_the_paint_that_does_not_draw_hands_the_row_back() {
    for fault in [None, Some(Fault::Bad), Some(Fault::Overrun)] {
        let world = World::open();
        let mut expected = Expected::new();
        world.send(&Command::Start(0), &mut expected);
        world.send(&Command::Delta(0, 0), &mut expected);
        COLD.set(false);
        assert!(world.frame().text().contains("probe call_1"), "{fault:?}: no tree before the paint");
        // Two revisions before a paint: both are viewed once, as the paint starts.
        world.emit("session.tool.input.delta", json!({ "id": "call_1", "delta": "x" }));
        match fault {
            None => drop(DECLINE.with_borrow_mut(|decline| decline.insert("call_1".to_owned()))),
            Some(fault) => ARMED.set(Some(("call_1".to_owned(), fault))),
        }
        world.emit("session.tool.input.delta", json!({ "id": "call_1", "delta": "y" }));
        for _ in 0..3 {
            world.settle();
        }
        let screen = world.frame().text();
        assert!(!screen.contains("probe call_1"), "{fault:?}: the tree stayed:\n{screen}");
        assert!(screen.contains("⋯ probe"), "{fault:?}: no host row:\n{screen}");
        assert!(mounted().iter().all(|shown| !shown.shows), "{fault:?}: {:?}", mounted());
    }
}

#[test]
fn a_fence_view_at_the_paint_that_declines_shows_the_host_code() {
    let world = World::open();
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
    assert!(!screen.contains("| "), "the claim's tree stayed:\n{screen}");
    assert!(screen.contains("beta gamma"), "no host code of the newest revision:\n{screen}");
}

#[test]
fn a_declined_part_gets_one_view_a_frame_and_the_paint_takes_it_back() {
    let world = World::open();
    let mut expected = Expected::new();
    DECLINE.with_borrow_mut(|decline| decline.insert("call_1".to_owned()));
    world.send(&Command::Start(0), &mut expected);
    assert!(world.frame().text().contains("⋯ probe"));
    VIEWS.with_borrow_mut(Vec::clear);
    let views = || VIEWS.with_borrow(|views| views.iter().filter(|(plugin, _, _)| *plugin == 'a').count());
    for delta in TOKENS {
        world.emit("session.tool.input.delta", json!({ "id": "call_1", "delta": delta }));
    }
    assert_eq!(views(), 0, "a streaming revision is viewed as the paint starts");
    DECLINE.with_borrow_mut(HashSet::clear);
    let screen = world.harness.app.render().text();
    assert_eq!(views(), 1, "the paint views the newest revision once");
    assert!(screen.contains("probe call_1 Pending") && !screen.contains("⋯ probe"), "{screen}");
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

#[test]
fn a_fence_that_falls_back_leaves_one_of_the_same_text_claimed() {
    let world = World::with(vec![abi::Plugin { id: "claim.twice", setup: plugin_twice }.into()]);
    // The first fence's first view is whole, so its refusal falls it back at once.
    REFUSE.set(1);
    world.emit("session.text.started", json!({ "ordinal": 0 }));
    let text = "```probe\nsame\n```\n\nBetween.\n\n```probe\nsame\n```\n\nAfter.\n";
    world.emit("session.text.delta", json!({ "ordinal": 0, "delta": text }));
    world.settle();
    let screen = world.frame().text();
    assert_eq!(screen.matches("| same").count(), 1, "one fence claimed:\n{screen}");
    assert_eq!(screen.matches("same").count(), 2, "the other the host's:\n{screen}");
    let (shows, fallen) = mounted().iter().fold((0, 0), |(shows, fallen), shown| match shown.shows {
        true => (shows + 1, fallen),
        false => (shows, fallen + 1),
    });
    assert_eq!((shows, fallen), (1, 1), "{:?}", mounted());
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

#[test]
fn the_ledger_counts_what_a_declined_part_keeps_and_what_went() {
    let world = World::with(vec![abi::Plugin { id: "claim.memo", setup: plugin_memo }.into()]);
    for index in 0..30 {
        world.emit("session.tool.input.started", json!({ "id": format!("call_{index}"), "name": "memo" }));
    }
    world.settle();
    world.harness.wait_for("memo call_29");
    assert_eq!(ledger().memo_entries, 30, "{:?}", ledger());
    DECLINE.with_borrow_mut(|decline| decline.insert("call_0".to_owned()));
    world.emit("session.tool.input.delta", json!({ "id": "call_0", "delta": "x" }));
    world.settle();
    assert!(!world.frame().text().contains("memo call_0"));
    assert_eq!(ledger().memo_entries, 30, "the declined part's value went: {:?}", ledger());
    world.harness.tui.navigate(opencode_tui::Route::Home);
    world.settle();
    assert_eq!((ledger().mounts, ledger().memo_entries), (0, 0));
    assert_eq!(opencode_plugin::claim::registered(), 0, "the registry keeps parts that went");
    DECLINE.with_borrow_mut(HashSet::clear);
}

thread_local! {
    /// What `claim.label`'s views saw of each call: its id, the content items and the bytes of metadata.
    static RESULTS: RefCell<Vec<(String, usize, usize)>> = const { RefCell::new(Vec::new()) };
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

#[test]
fn a_part_is_viewed_again_at_a_new_width_and_gets_no_height() {
    INPUTS.with_borrow_mut(Vec::clear);
    NARROW.set(90);
    let world = World::with(vec![abi::Plugin { id: "claim.narrow", setup: plugin_narrow }.into()]);
    world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "narrow" }));
    world.emit("session.text.started", json!({ "ordinal": 0 }));
    world.emit("session.text.delta", json!({ "ordinal": 0, "delta": "```narrow\nfits\n```\n\nAfter.\n" }));
    world.settle();
    let screen = world.frame().text();
    assert!(!screen.contains("narrow call_1") && screen.contains("fits"), "drew wide:\n{screen}");
    world.harness.app.resize(WIDTH - 20, HEIGHT);
    for _ in 0..3 {
        world.settle();
    }
    let screen = world.frame().text();
    assert!(screen.contains("narrow call_1 at"), "the call was not asked again:\n{screen}");
    assert!(screen.contains("narrow fence at"), "the fence was not asked again:\n{screen}");
    // Wide again, the claim declines both, which shows the host's rows at that paint.
    world.harness.app.resize(WIDTH, HEIGHT);
    for _ in 0..3 {
        world.settle();
    }
    let screen = world.frame().text();
    assert!(!screen.contains("narrow call_1") && !screen.contains("narrow fence"), "{screen}");
    assert!(screen.contains("fits"), "no host code:\n{screen}");
    world.harness.app.resize(WIDTH - 20, HEIGHT);
    for _ in 0..3 {
        world.settle();
    }
    world.harness.app.resize(WIDTH - 20, HEIGHT - 9);
    world.settle();
    assert!(INPUTS.with_borrow(|inputs| inputs.iter().all(|(_, height)| *height == 0)));
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

#[test]
fn a_part_that_falls_back_above_the_reader_leaves_the_reader_in_place() {
    let world = World::with(vec![abi::Plugin { id: "claim.tall", setup: plugin_tall }.into()]);
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
    assert!(!before.iter().any(|row| row.starts_with("call_0:")), "call_0 is on screen: {before:?}");
    ARMED.set(Some(("call_0".to_owned(), Fault::Bad)));
    world.emit("session.tool.progress", json!({ "id": "call_0", "metadata": { "n": 1 } }));
    world.settle();
    ARMED.set(None);
    assert!(world.mount_of("call_0").is_some_and(|shown| !shown.shows), "call_0 did not fall back");
    let after = rows(world.frame().text());
    assert_eq!(after, before, "the reader moved");
    // A part below the reader's rows changes nothing above it.
    assert!(!before.iter().any(|row| row.starts_with("call_8:")), "call_8 is on screen: {before:?}");
    ARMED.set(Some(("call_8".to_owned(), Fault::Bad)));
    world.emit("session.tool.progress", json!({ "id": "call_8", "metadata": { "n": 1 } }));
    world.settle();
    ARMED.set(None);
    assert!(world.mount_of("call_8").is_some_and(|shown| !shown.shows), "call_8 did not fall back");
    assert_eq!(rows(world.frame().text()), before, "a part below moved the reader");

    // At the tail, the transcript stays at its bottom.
    let world = World::with(vec![abi::Plugin { id: "claim.tall", setup: plugin_tall }.into()]);
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
    assert_eq!(screen.last().map(String::as_str), Some("call_8:11"), "left the tail: {screen:?}");
}

#[test]
fn an_overrun_falls_back_in_process() {
    let world = World::open();
    let mut expected = Expected::new();
    for slot in [0, 1, 2] {
        world.send(&Command::Start(slot), &mut expected);
    }
    COLD.set(false);
    ARMED.set(Some(("call_1".to_owned(), Fault::Overrun)));
    world.send(&Command::Delta(0, 0), &mut expected);
    let status = world.harness.tui.plugins.entries().into_iter().find(|entry| entry.id == "claim.a").unwrap().status;
    let screen = world.frame().text();
    let failed = world.toasts.borrow().iter().any(|toast| toast == "Plugin failed: claim.a");
    assert!(!screen.contains("probe call_1") && screen.contains("witness call_3"), "{screen}");
    assert_eq!(status, opencode_plugin::Status::Active);
    assert_eq!(world.harness.tui.plugins.monitor().host_overruns(), 1);
    assert!(screen.contains("probe call_2") && !failed, "{screen}");
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

#[test]
fn a_claimed_fence_learns_it_closed_once_markdown_decides_it() {
    FLAGS.with_borrow_mut(Vec::clear);
    let world = World::with(vec![abi::Plugin { id: "claim.closed", setup: plugin_closed }.into()]);
    let last = || FLAGS.with_borrow(|flags| flags.last().copied());
    world.emit("session.text.started", json!({ "ordinal": 0 }));
    world.emit("session.text.delta", json!({ "ordinal": 0, "delta": "```probe\nx\n" }));
    world.settle();
    assert_eq!(last(), Some((true, false)));
    world.emit("session.text.delta", json!({ "ordinal": 0, "delta": "```\n" }));
    world.settle();
    assert_eq!(last(), Some((true, false)), "a closing line that ends the text is pending");
    world.emit("session.text.delta", json!({ "ordinal": 0, "delta": "\nAfter.\n" }));
    world.settle();
    assert_eq!(last(), Some((true, true)), "text after the closing line decides it");
    let tokens = json!({ "input": 1, "output": 1, "reasoning": 0, "cache": { "read": 0, "write": 0 } });
    world.emit("session.step.ended", json!({ "finish": "stop", "cost": 0, "tokens": tokens }));
    world.settle();
    assert_eq!(last(), Some((false, true)), "the message completed");
}

/// A plugin that renders its own fence syntax must not recursively reclaim it.
fn plugin_nested(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::fence("probe", |_, part| {
        let Part::Fence(fence) = part else { return None };
        let source = v2::Source::Text(format!("nested\n\n```probe\n{}\n```\n", fence.code));
        Some(v2::Node::column(vec![v2::Node::Markdown { id: Some("text".into()), source }]))
    }));
    Ok(())
}

#[test]
fn a_fence_in_a_claimed_part_is_not_claimed_again() {
    let world = World::with(vec![abi::Plugin { id: "claim.nested", setup: plugin_nested }.into()]);
    world.emit("session.text.started", json!({ "ordinal": 0 }));
    world.emit("session.text.delta", json!({ "ordinal": 0, "delta": "```probe\ncode\n```\n\nAfter.\n" }));
    world.settle();
    let screen = world.frame().text();
    assert_eq!(screen.matches("nested").count(), 1, "{screen}");
    assert_eq!(screen.matches("code").count(), 1, "{screen}");
    assert_eq!(mounted().len(), 1, "{:?}", mounted());
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

#[test]
fn a_declined_part_keeps_its_content_and_a_bad_tree_gets_one_view() {
    DREW.with_borrow_mut(Vec::clear);
    let world = World::with(vec![abi::Plugin { id: "claim.cache", setup: plugin_cache }.into()]);
    world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "cache" }));
    world.settle();
    world.harness.wait_for("cached body");
    world.emit("session.tool.called", json!({ "id": "call_1", "input": {}, "executed": true }));
    world.settle();
    assert!(!world.frame().text().contains("cached body"), "declined, the tree stays");
    assert_eq!(ledger().content, 1, "the declined part's handle went: {:?}", ledger());
    let done = json!([{ "type": "text", "text": "done" }]);
    world.emit("session.tool.success", json!({ "id": "call_1", "content": done, "executed": true }));
    world.settle();
    let screen = world.frame().text();
    assert!(screen.contains("cached body"), "the handle is gone:\n{screen}");
    assert!(world.mount_of("call_1").is_some_and(|shown| shown.shows));

    // A duplicate id is the plugin's error: one view, and the part falls back.
    let world = World::rules(ungrouped(), false);
    world.emit("session.tool.input.started", json!({ "id": "call_2", "name": "probe" }));
    world.settle();
    ARMED.set(Some(("call_2".to_owned(), Fault::Bad)));
    let views = DREW.with_borrow(Vec::len);
    world.emit("session.tool.called", json!({ "id": "call_2", "input": {}, "executed": true }));
    world.settle();
    ARMED.set(None);
    assert_eq!(DREW.with_borrow(Vec::len) - views, 1, "a bad tree was asked again");
    assert!(world.mount_of("call_2").is_some_and(|shown| !shown.shows));
    let views = DREW.with_borrow(Vec::len);
    ARMED.set(Some(("call_3".to_owned(), Fault::Bad)));
    world.emit("session.tool.input.started", json!({ "id": "call_3", "name": "probe" }));
    world.settle();
    ARMED.set(None);
    assert_eq!(DREW.with_borrow(Vec::len) - views, 1, "a first, whole view was asked again");
}

thread_local! {
    static BUMPS: Cell<u32> = const { Cell::new(0) };
}

/// Claims `bump` calls with a card that shows how often its command ran, and runs the command on a click.
fn plugin_bump(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(abi::Command::new("claim.bump"), |_, _| {
        BUMPS.set(BUMPS.get() + 1);
    });
    setup.claim(Claim::tool("bump", |_, part| {
        let text = format!("{} bumped {}", key(part), BUMPS.get());
        Some(v2::Node::text(vec![abi::Span::new(text)]).with_id("bump").on_click(abi::Click::command("claim.bump")))
    }));
    Ok(())
}

#[test]
fn a_claimed_part_draws_again_after_its_plugin_runs_a_command() {
    BUMPS.set(0);
    let world = World::with(vec![abi::Plugin { id: "claim.bump", setup: plugin_bump }.into()]);
    world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "bump" }));
    world.settle();
    let screen = world.harness.wait_for("call_1 bumped 0");
    let y = screen.lines().position(|line| line.contains("call_1 bumped")).unwrap() as u16;
    world.harness.app.click(4, y);
    world.settle();
    world.settle();
    assert_eq!(BUMPS.get(), 1, "the click ran no command");
    assert!(world.frame().text().contains("call_1 bumped 1"), "{}", world.frame().text());
    world.harness.tui.keymap.dispatch("claim.bump", None);
    world.settle();
    world.settle();
    assert!(world.frame().text().contains("call_1 bumped 2"), "{}", world.frame().text());
}

fn bash_claim(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("bash", probe('b')));
    Ok(())
}

#[test]
fn a_claim_of_a_tool_takes_its_calls_by_either_name() {
    let world = World::with(vec![abi::Plugin { id: "claim.bash", setup: bash_claim }.into()]);
    world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "shell" }));
    world.emit("session.tool.input.started", json!({ "id": "call_2", "name": "bash" }));
    world.settle();
    let screen = world.frame().text();
    assert!(screen.contains("b drew call_1") && screen.contains("b drew call_2"), "{screen}");
}

#[test]
fn a_fence_is_viewed_first_at_its_own_width() {
    INPUTS.with_borrow_mut(Vec::clear);
    NARROW.set(u16::MAX);
    let world = World::with(vec![abi::Plugin { id: "claim.narrow", setup: plugin_narrow }.into()]);
    world.emit("session.text.started", json!({ "ordinal": 0 }));
    world.emit("session.text.delta", json!({ "ordinal": 0, "delta": "```narrow\nfits\n```\n\nAfter.\n" }));
    world.settle();
    world.settle();
    let width = mounted().first().map(|shown| shown.rect.width as u16);
    let inputs = INPUTS.with_borrow(Vec::clone);
    assert_eq!(inputs.iter().map(|(width, _)| Some(*width)).collect::<Vec<_>>(), [width]);
}

/// Claims `given` calls: gives the host content and releases it in the same view, then draws a line.
fn plugin_given(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("given", |cx, part| {
        let handle = cx.content(b"given and gone".to_vec());
        cx.release(handle);
        Some(v2::Node::text(vec![abi::Span::new(format!("given {}", key(part)))]))
    }));
    Ok(())
}

#[test]
fn a_claim_keeps_no_content_it_released_and_is_not_asked_of_an_unknown_state() {
    CONTENT.set(vec![json!({
        "type": "tool", "id": "call_9", "name": "given", "time": { "created": 1600 },
        "state": { "status": "paused", "input": {} },
    })]);
    let world = World::with(vec![abi::Plugin { id: "claim.given", setup: plugin_given }.into()]);
    CONTENT.set(Vec::new());
    assert!(!world.frame().text().contains("given call_9"), "{}", world.frame().text());
    assert!(mounted().iter().all(|shown| !shown.shows), "{:?}", mounted());
    world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "given" }));
    world.settle();
    world.harness.wait_for("given call_1");
    assert_eq!((ledger().content, ledger().content_bytes), (0, 0), "{:?}", ledger());
}

thread_local! {
    /// What `claim.keeper`'s next views return, in order: a tree, a keep of an id the host never held, or nothing.
    static KEEPER: RefCell<Vec<&'static str>> = const { RefCell::new(Vec::new()) };
}

/// Claims `keeper` calls with a memoized card, or what [`KEEPER`] says next.
fn plugin_keeper(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("keeper", |cx, part| {
        let next = KEEPER.with_borrow_mut(|plan| (!plan.is_empty()).then(|| plan.remove(0))).unwrap_or("tree");
        DREW.with_borrow_mut(|drew| drew.push(format!("{next} full {}", cx.input.full)));
        let card = cx.memo("card", 1u8, |_| v2::Node::text(vec![abi::Span::new(format!("keeper {}", key(part)))]));
        match next {
            "keep" => Some(v2::Node::column(vec![card, v2::Node::Keep { key: "never".into() }])),
            "decline" => None,
            _ => Some(v2::Node::column(vec![card])),
        }
    }));
    Ok(())
}

#[test]
fn a_refused_keep_is_asked_once_whole_and_a_decline_after_it_stays_within_bounds() {
    DREW.with_borrow_mut(Vec::clear);
    let world = World::with(vec![abi::Plugin { id: "claim.keeper", setup: plugin_keeper }.into()]);
    KEEPER.set(vec!["keep"]);
    world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "keeper" }));
    world.settle();
    assert_eq!(DREW.with_borrow(Vec::clone), ["keep full true"], "a whole view was asked again");
    assert!(world.mount_of("call_1").is_some_and(|shown| !shown.shows));
    // The host's own table forgets a refused view.
    assert_eq!(ledger().memo_entries, 0, "{:?}", ledger());

    DREW.with_borrow_mut(Vec::clear);
    world.emit("session.tool.input.started", json!({ "id": "call_2", "name": "keeper" }));
    world.settle();
    KEEPER.set(vec!["keep", "decline"]);
    world.emit("session.tool.input.delta", json!({ "id": "call_2", "delta": "x" }));
    world.settle();
    let drew = DREW.with_borrow(Vec::clone);
    assert_eq!(drew, ["tree full true", "keep full false", "decline full true"]);
    let status = world.harness.tui.plugins.entries().into_iter().find(|entry| entry.id == "claim.keeper");
    assert_eq!(status.map(|entry| entry.status), Some(opencode_plugin::Status::Active));
    assert!(world.frame().text().contains("⋯ keeper"), "{}", world.frame().text());
}

#[test]
fn a_resize_views_a_claimed_part_once() {
    INPUTS.with_borrow_mut(Vec::clear);
    NARROW.set(u16::MAX);
    let world = World::with(vec![abi::Plugin { id: "claim.narrow", setup: plugin_narrow }.into()]);
    world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "narrow" }));
    world.emit("session.text.started", json!({ "ordinal": 0 }));
    world.emit("session.text.delta", json!({ "ordinal": 0, "delta": "```narrow\nfits\n```\n\nAfter.\n" }));
    world.settle();
    world.settle();
    let before = INPUTS.with_borrow(Vec::len);
    world.harness.app.resize(WIDTH - 20, HEIGHT);
    for _ in 0..3 {
        world.settle();
    }
    let views = INPUTS.with_borrow(|inputs| inputs[before..].to_vec());
    assert_eq!(views.len(), 2, "{views:?}");
}

#[test]
fn a_theme_change_views_a_claimed_fence_once() {
    let world = World::open();
    let mut expected = Expected::new();
    for command in [Command::Start(0), Command::Text, Command::Text, Command::Text] {
        world.send(&command, &mut expected);
    }
    let views = ledger().views;
    let before = mounted().iter().filter(|shown| shown.id.key.starts_with("fence-")).count();
    let generations = mounted().len();
    world.send(&Command::Theme(false), &mut expected);
    assert_eq!(ledger().views - views, 1, "claim views for one theme change");
    let after: Vec<_> = mounted().into_iter().filter(|shown| shown.id.key.starts_with("fence-")).collect();
    assert_eq!((before, after.len(), generations), (1, 1, 2), "{after:?}");
    assert_eq!(stream_whole(&world, &expected), Ok(2));
}

#[test]
fn an_overrun_at_a_theme_change_falls_the_fence_back() {
    let commands =
        [Command::Text, Command::Text, Command::Text, Command::Arm(Fault::Overrun, FENCE), Command::Theme(false)];
    assert_eq!(ClaimModel.run(&commands), None);
}

fn plugin_code(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::fence("probe", |_, part| {
        let Part::Fence(fence) = part else { return None };
        Some(v2::Node::Code {
            id: Some("code".into()),
            content: v2::Source::Text(fence.code.clone()),
            filetype: Some("rust".into()),
            numbers: true,
            layout: abi::Layout::default(),
        })
    }));
    Ok(())
}

#[test]
fn a_fence_claim_draws_its_code_in_p3s_code_view() {
    let world = World::with(vec![abi::Plugin { id: "claim.code", setup: plugin_code }.into()]);
    world.emit("session.text.started", json!({ "ordinal": 0 }));
    world.emit("session.text.delta", json!({ "ordinal": 0, "delta": "```probe\nlet a = 1;\n" }));
    world.settle();
    let screen = world.frame().text();
    let numbered = |screen: &str, n: usize, text: &str| {
        screen.lines().any(|line| line.trim_start().starts_with(&n.to_string()) && line.contains(text))
    };
    assert!(numbered(&screen, 1, "let a = 1;"), "no numbered code:\n{screen}");
    world.emit("session.text.delta", json!({ "ordinal": 0, "delta": "let b = 2;\n```\n\nAfter.\n" }));
    world.settle();
    let screen = world.frame().text();
    assert!(numbered(&screen, 2, "let b = 2;") && screen.contains("After."), "{screen}");
    assert!(!screen.contains("```"), "the host's view shows:\n{screen}");
    assert_eq!(mounted().iter().filter(|shown| shown.shows).count(), 1, "{:?}", mounted());
}

thread_local! {
    static FENCED: Cell<Fenced> = const { Cell::new(Fenced::Card) };
    static FENCED_VIEWS: Cell<u32> = const { Cell::new(0) };
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Fenced {
    Alone,
    Card,
    Code,
    Declined,
    Twice,
}

/// Claims `probe` fences and the calls of the `probe` tool as [`FENCED`] says; a call's tree is a fence node, which only
/// a fence claim's tree may hold. The card is memoized on the fence's info, so its views after the first keep it.
fn plugin_fenced(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::fence("probe", |cx, part| {
        let Part::Fence(fence) = part else { return None };
        FENCED_VIEWS.set(FENCED_VIEWS.get() + 1);
        match FENCED.get() {
            Fenced::Alone => Some(v2::Node::fence()),
            Fenced::Card => Some(cx.memo("card", fence.info.clone(), |_| {
                let label = v2::Node::text(vec![abi::Span::new(format!("| {}", fence.info))]);
                v2::Node::column(vec![label, v2::Node::fence().bg("background.raised.base")])
            })),
            Fenced::Code => Some(v2::Node::code(v2::Source::Text(fence.code.clone()))),
            Fenced::Declined => None,
            Fenced::Twice => Some(v2::Node::column(vec![v2::Node::fence(), v2::Node::fence()])),
        }
    }));
    setup.claim(Claim::tool("probe", |_, _| Some(v2::Node::fence())));
    Ok(())
}

/// A world of `claim.fenced` on `carrier` that shows the Markdown `text` as an answer, and its frame.
fn fenced(how: Fenced, text: &str) -> (World, Capture) {
    FENCED.set(how);
    FENCED_VIEWS.set(0);
    let world = World::with(vec![abi::Plugin { id: "claim.fenced", setup: plugin_fenced }.into()]);
    world.emit("session.text.started", json!({ "ordinal": 0 }));
    world.emit("session.text.delta", json!({ "ordinal": 0, "delta": text }));
    world.settle();
    let frame = world.frame();
    (world, frame)
}

#[test]
fn a_fence_node_alone_draws_as_the_host_code_view() {
    let text = "```probe\nlet a = 1;\nlet b = 2;\n```\n\nAfter.\n";
    let (_world, declined) = fenced(Fenced::Declined, text);
    let (_world, alone) = fenced(Fenced::Alone, text);
    assert!(alone.text().contains("let b = 2;"), "{}", alone.text());
    assert_eq!(mounted().iter().filter(|shown| shown.shows).count(), 1, "{:?}", mounted());
    assert!(alone.cells == declined.cells, "the fence node is not the host's view:\n{}", alone.text());
}

#[test]
fn a_fence_node_keeps_a_fence_in_its_code() {
    for text in [
        "````probe\nbefore\n```\n# NOT A HEADING\n````\n\nAfter.\n",
        "~~~probe\nbefore\n```\n# NOT A HEADING\n~~~\n\nAfter.\n",
    ] {
        let bare = World::with(Vec::new());
        bare.emit("session.text.started", json!({ "ordinal": 0 }));
        bare.emit("session.text.delta", json!({ "ordinal": 0, "delta": text }));
        bare.settle();
        let bare = bare.frame();
        assert!(bare.text().contains("# NOT A HEADING"), "{text:?}: the host's own view:\n{}", bare.text());
        for how in [Fenced::Alone, Fenced::Declined] {
            let (_world, frame) = fenced(how, text);
            assert!(frame.cells == bare.cells, "{how:?} {text:?}:\n{}", frame.text());
        }
    }
}

#[test]
fn a_fence_node_follows_the_stream() {
    let (world, frame) = fenced(Fenced::Card, "```probe\nalpha\n");
    assert!(frame.text().contains("| probe") && frame.text().contains("alpha"), "{}", frame.text());
    for delta in ["beta\n", "gamma\n", "```\n\nAfter.\n"] {
        world.emit("session.text.delta", json!({ "ordinal": 0, "delta": delta }));
        world.settle();
        let screen = world.frame().text();
        assert!(screen.contains("| probe"), "the card went:\n{screen}");
        assert!(!screen.contains("```"), "the host's row shows:\n{screen}");
    }
    let screen = world.frame().text();
    assert!(screen.contains("beta") && screen.contains("gamma") && screen.contains("After."), "{screen}");
    assert_eq!(mounted().iter().filter(|shown| shown.shows).count(), 1, "{:?}", mounted());
}

#[test]
fn a_fence_nodes_code_is_on_its_background() {
    let text = "```probe\nlet a = 1;\n```\n\nAfter.\n";
    let bg_of = |frame: &Capture| {
        let screen = frame.text();
        let (y, line) = screen.lines().enumerate().find(|(_, line)| line.contains("let a")).expect("the code shows");
        let x = line[..line.find("let a").unwrap()].chars().count();
        frame.cell(x as u32, y as u32).unwrap().bg
    };
    let (world, card) = fenced(Fenced::Card, text);
    let raised = opencode_plugin::node::theme_color(&world.harness.tui.page(), "background.raised.base").unwrap();
    let bg = bg_of(&card);
    assert_eq!((bg.r, bg.g, bg.b), (raised.r, raised.g, raised.b), "the code is not on the card's");
    let (world, declined) = fenced(Fenced::Declined, text);
    let page = world.harness.tui.page().background.base;
    assert_eq!(bg_of(&declined), page, "the host's row is not on the transcript's background");
}

#[test]
fn a_long_fence_in_a_card_draws_whole() {
    let code: String = (0..2_000).map(|line| format!("line {line}\n")).collect();
    let text = format!("```probe\n{code}```\n");
    let (_world, frame) = fenced(Fenced::Card, &text);
    // The transcript follows the answer's end: the fence's last line shows, under the claim's card.
    let screen = frame.text();
    assert!(screen.contains("line 1999") && !screen.contains("⋯"), "{screen}");
    assert_eq!(mounted().iter().filter(|shown| shown.shows).count(), 1, "{:?}", mounted());
    let (_world, frame) = fenced(Fenced::Code, &text);
    assert!(frame.text().contains("⋯"), "the control drew whole:\n{}", frame.text());
}

#[test]
fn a_fence_node_where_it_may_not_be_shows_the_host_row() {
    let (world, frame) = fenced(Fenced::Twice, "```probe\nonce\n```\n");
    assert_eq!(frame.text().matches("once").count(), 1, "{}", frame.text());
    world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "probe" }));
    world.settle();
    let screen = world.frame().text();
    assert!(screen.contains("⋯ probe"), "no host row for the call:\n{screen}");
    assert!(mounted().iter().all(|shown| !shown.shows), "{:?}", mounted());
    let status = world.harness.tui.plugins.entries().into_iter().find(|entry| entry.id == "claim.fenced");
    assert_eq!(status.map(|entry| entry.status), Some(opencode_plugin::Status::Active));
}

const SHARE: &str = "claim.share";
const RIVAL: &str = "claim.rival";
const PICS: &str = "claim.pics";

thread_local! {
    /// The handle each part's last view gave, which its next view releases.
    static GAVE: RefCell<std::collections::HashMap<String, v2::ContentRef>> = RefCell::default();
    /// The views of `claim.pics`, which number the pictures they give.
    static PICTURES: Cell<u32> = const { Cell::new(0) };
}

/// A view that gives 1,000 bytes of content and shows them under a line naming the part, and releases what the part's
/// last view gave.
fn giving(plugin: char) -> impl Fn(&mut v2::View<'_>, &Part) -> Option<v2::Node> {
    move |cx, part| {
        let key = key(part);
        if let Some(handle) = GAVE.with_borrow_mut(|gave| gave.remove(&key)) {
            cx.release(handle);
        }
        let handle = cx.content("x".repeat(1_000).into_bytes());
        GAVE.with_borrow_mut(|gave| gave.insert(key.clone(), handle));
        Some(v2::Node::column(vec![
            v2::Node::text(vec![abi::Span::new(format!("{plugin} holds {key}"))]),
            v2::Node::Markdown { id: Some("body".into()), source: v2::Source::Content(handle) },
        ]))
    }
}

/// Claims `share` calls with [`giving`], and shows 1,000 bytes of content of its own in the `app` slot.
fn plugin_share(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("share", giving('s')));
    setup.surface(v2::Surface::new("beside", v2::Place::Slot(abi::Placement::append("app")), |cx| {
        if let Some(handle) = GAVE.with_borrow_mut(|gave| gave.remove("own")) {
            cx.release(handle);
        }
        let handle = cx.content("y".repeat(1_000).into_bytes());
        GAVE.with_borrow_mut(|gave| gave.insert("own".to_owned(), handle));
        // The content is held whether a node shows it or not; one line keeps the transcript in view.
        v2::Node::text(vec![abi::Span::new("own")])
    }));
    Ok(())
}

fn plugin_rival(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("rival", giving('r')));
    Ok(())
}

#[test]
fn a_claimed_part_holds_its_plugins_share_beside_its_surface_and_the_total() {
    GAVE.with_borrow_mut(std::collections::HashMap::clear);
    let world = World::with(vec![
        abi::Plugin { id: SHARE, setup: plugin_share }.into(),
        abi::Plugin { id: RIVAL, setup: plugin_rival }.into(),
    ]);
    let surface = opencode_plugin::limits::held(SHARE);
    assert_eq!(surface.content, 1_000, "the surface's own content");
    // The plugin may hold its surface's and two parts'; all plugins one more part.
    let total = opencode_plugin::limits::total().content;
    // Each read of the monitor's clock moves it on: the host's work for a part takes time.
    let tick = Rc::new(Cell::new(Duration::ZERO));
    let (base, now) = (Instant::now(), tick.clone());
    world.harness.tui.plugins.monitor().set_clock(move || {
        now.set(now.get() + Duration::from_micros(10));
        base + now.get()
    });
    let _limits = opencode_plugin::limits::set(opencode_plugin::limits::Limits {
        plugin_content: 3_000,
        all_content: total + 3_000,
        ..opencode_plugin::limits::Limits::default()
    });
    for (id, name) in [("call_1", "share"), ("call_2", "share"), ("call_3", "share")] {
        world.emit("session.tool.input.started", json!({ "id": id, "name": name }));
    }
    for (id, name) in [("call_4", "rival"), ("call_5", "rival")] {
        world.emit("session.tool.input.started", json!({ "id": id, "name": name }));
    }
    world.settle();
    let screen = world.frame().text();
    for id in ["call_1", "call_2", "call_3"] {
        assert!(screen.contains(&format!("s holds {id}")), "{id} is not drawn:\n{screen}");
    }
    assert!(screen.contains("r holds call_4") && screen.contains("r holds call_5"), "{screen}");
    assert_eq!(
        screen.matches("⋯ its content is past what the plugin may hold").count(),
        2,
        "the third part past its plugin's share, the rival's second past the total:\n{screen}"
    );
    assert!(mounted().iter().all(|shown| shown.shows), "a part fell back: {:?}", mounted());
    let (share, rival) = (opencode_plugin::limits::held(SHARE), opencode_plugin::limits::held(RIVAL));
    assert_eq!((share.content, rival.content), (3_000, 1_000), "{share:?} {rival:?}");
    assert!(share.nodes > surface.nodes && rival.nodes > 0, "nodes {surface:?} {share:?} {rival:?}");
    assert!(opencode_plugin::limits::total().content <= total + 3_000, "past the total");
    assert_eq!(ledger().content, 3, "the content the parts hold: {:?}", ledger());
    // The rival has claims alone, and no image: its host time is its parts' adoptions.
    let host = world.harness.tui.plugins.monitor().host_time(RIVAL);
    assert!(host > Duration::ZERO, "no host time for the rival's parts");
    world.harness.tui.navigate(opencode_tui::Route::Home);
    world.settle();
    let left = (opencode_plugin::limits::held(SHARE), opencode_plugin::limits::held(RIVAL));
    assert_eq!(left.0.content, 1_000, "held once the session left: {left:?}");
    assert_eq!(left.1, opencode_plugin::limits::Held::default(), "held once the session left");
}

/// Claims `pics` calls with a 16x16 picture of a color of its own each view, given as content, and releases the one
/// its last view gave.
fn plugin_pics(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("pics", |cx, part| {
        let key = key(part);
        if let Some(handle) = GAVE.with_borrow_mut(|gave| gave.remove(&key)) {
            cx.release(handle);
        }
        let shade = PICTURES.replace(PICTURES.get() + 1) as u8;
        let handle = cx.content(crate::plugin_limits::png(16, 16, |_, _| [shade, 0, 0, 255]));
        GAVE.with_borrow_mut(|gave| gave.insert(key.clone(), handle));
        let size = |cells| Some(abi::Width::Cells(cells));
        let layout = abi::Layout { width: size(16), height: size(8), ..abi::Layout::default() };
        let image = v2::Node::Image { id: None, content: v2::Source::Content(handle), fit: v2::Fit::Contain, layout };
        Some(v2::Node::column(vec![v2::Node::text(vec![abi::Span::new(format!("pics {key}"))]), image]))
    }));
    Ok(())
}

#[test]
fn a_claimed_part_that_replaces_its_picture_holds_only_the_one_it_shows() {
    GAVE.with_borrow_mut(std::collections::HashMap::clear);
    let world = World::with(vec![abi::Plugin { id: PICS, setup: plugin_pics }.into()]);
    // Each read of the monitor's clock moves it on: the host's work for the part takes time.
    let tick = Rc::new(Cell::new(Duration::ZERO));
    let (base, now) = (Instant::now(), tick.clone());
    world.harness.tui.plugins.monitor().set_clock(move || {
        now.set(now.get() + Duration::from_micros(10));
        base + now.get()
    });
    let app = &world.harness.app;
    let done = || app.wait_until(Duration::from_secs(10), || opencode_plugin::image::jobs(PICS) == 0);
    world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "pics" }));
    world.settle();
    for delta in ["{", "\"q\"", ":", "1", "}"] {
        world.emit("session.tool.input.delta", json!({ "id": "call_1", "delta": delta }));
        world.settle();
        assert!(done(), "a decode never ended");
        world.settle();
        let held = (opencode_plugin::surface::pictures(PICS), opencode_plugin::limits::held(PICS).images);
        assert_eq!(held, (1, 16 * 16 * 4), "after {delta:?}");
    }
    assert!(PICTURES.get() >= 6, "the part was viewed {} times", PICTURES.get());
    assert!(world.frame().text().contains("pics call_1"), "{}", world.frame().text());
    let host = world.harness.tui.plugins.monitor().host_time(PICS);
    assert!(host > Duration::ZERO, "no host time for the part");
    world.harness.tui.navigate(opencode_tui::Route::Home);
    world.settle();
    assert!(done());
    let held = (opencode_plugin::surface::pictures(PICS), opencode_plugin::limits::held(PICS));
    assert_eq!(held, (0, opencode_plugin::limits::Held::default()), "held once the part went");
}

thread_local! {
    /// Each view of a `coalesce` part, as the plugin logs it: the bumps it saw and the input it drew.
    static COALESCED: RefCell<Vec<(u32, String)>> = const { RefCell::new(Vec::new()) };
    /// `claim.coalesce` declines its parts.
    static DECLINES: Cell<bool> = const { Cell::new(false) };
}

/// Claims `coalesce` calls with a line of how often its command ran and the input so far, which it logs.
fn plugin_coalesce(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(abi::Command::new("claim.coalesce"), |_, _| BUMPS.set(BUMPS.get() + 1));
    setup.claim(Claim::tool("coalesce", |_, part| {
        let input = lines(part).get(1).cloned().unwrap_or_default();
        COALESCED.with_borrow_mut(|log| log.push((BUMPS.get(), input.clone())));
        if DECLINES.get() {
            return None;
        }
        Some(v2::Node::text(vec![abi::Span::new(format!("coalesced {} {input}", BUMPS.get()))]))
    }));
    Ok(())
}

#[test]
fn a_revision_and_a_handler_in_one_frame_give_a_part_one_view() {
    BUMPS.set(0);
    DECLINES.set(false);
    let world = World::with(vec![abi::Plugin { id: "claim.coalesce", setup: plugin_coalesce }.into()]);
    world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "coalesce" }));
    world.settle();
    world.harness.wait_for("coalesced 0");
    let mut typed = String::new();
    for (handler_first, refuse) in [(false, false), (false, true), (true, false), (true, true)] {
        COALESCED.with_borrow_mut(Vec::clear);
        let views = || COALESCED.with_borrow(Vec::len);
        world.harness.app.advance(Duration::from_millis(20));
        let delta = ["a", "b", "c", "d"][typed.len()];
        typed.push_str(delta);
        let revise = || world.emit("session.tool.input.delta", json!({ "id": "call_1", "delta": delta }));
        let handle = || {
            DECLINES.set(refuse);
            world.harness.tui.keymap.dispatch("claim.coalesce", None);
            // The effect queue drains the handler's redraw before anything else comes.
            world.harness.app.advance(Duration::ZERO);
        };
        match handler_first {
            false => {
                revise();
                handle();
            }
            true => {
                handle();
                revise();
            }
        }
        let order = if handler_first { "handler first" } else { "revision first" };
        assert_eq!(views(), 0, "{order}: a view before the paint");
        let first = world.harness.app.render();
        let log = COALESCED.with_borrow(Clone::clone);
        let input = format!("in {typed}");
        assert_eq!(log, [(BUMPS.get(), input.clone())], "{order}: one view at the first paint, of the newest");
        let drawn = format!("coalesced {} {input}", BUMPS.get());
        assert_eq!(first.text().contains(&drawn), !refuse, "{order}: the first paint:\n{}", first.text());
        world.harness.app.render();
        assert_eq!(views(), 1, "{order}: the paint after viewed again");
        assert_eq!(mounted().iter().any(|shown| shown.shows), !refuse, "{order}: {:?}", mounted());
    }
}

thread_local! {
    /// What a claim view's `&dyn Read` helper read as its mount, beside the view's own mount.
    static READ_MOUNTS: RefCell<Vec<(Option<v2::MountId>, v2::MountId)>> = const { RefCell::new(Vec::new()) };
}

/// The mount a helper that only has the host's reads finds.
fn read_mount(read: &dyn abi::Read) -> Option<v2::MountId> {
    read.mount()
}

fn mount_reader(setup: &mut abi::Setup) -> Result<(), String> {
    setup.claim(Claim::tool("shell", |cx, part| {
        READ_MOUNTS.with_borrow_mut(|seen| seen.push((read_mount(cx.read), cx.mount.clone())));
        Some(v2::Node::text(vec![abi::Span::new(format!("read {}", key(part)))]))
    }));
    Ok(())
}

#[test]
fn a_claim_view_reads_its_part_s_mount_on_both_carriers() {
    READ_MOUNTS.with_borrow_mut(Vec::clear);
    let world = World::with(vec![abi::Plugin { id: "claim.mount", setup: mount_reader }.into()]);
    world.emit("session.tool.input.started", json!({ "id": "call_7", "name": "bash" }));
    world.settle();
    world.harness.wait_for("read call_7");
    let seen = READ_MOUNTS.with_borrow(Vec::clone);
    assert!(!seen.is_empty(), "no view ran");
    for (read, mount) in seen {
        assert_eq!(read.as_ref(), Some(&mount));
    }
}

thread_local! {
    /// `claim.wake`'s waker, and the state its view draws.
    static WAKE: RefCell<Option<abi::Waker>> = const { RefCell::new(None) };
    static WOKEN: Cell<u32> = const { Cell::new(0) };
    /// The state each view of a `woke` part drew.
    static WOKE_VIEWS: RefCell<Vec<u32>> = const { RefCell::new(Vec::new()) };
}

/// Claims `woke` calls with a line of [`WOKEN`]; its waker draws its parts again.
fn plugin_wake(setup: &mut abi::Setup) -> Result<(), String> {
    WAKE.set(setup.waker());
    setup.claim(Claim::tool("woke", |_, _| {
        WOKE_VIEWS.with_borrow_mut(|views| views.push(WOKEN.get()));
        Some(v2::Node::text(vec![abi::Span::new(format!("woke {}", WOKEN.get()))]))
    }));
    Ok(())
}

#[test]
fn a_wake_drained_at_the_paint_shows_in_that_paint() {
    WOKEN.set(0);
    let world = World::with(vec![abi::Plugin { id: "claim.wake", setup: plugin_wake }.into()]);
    world.emit("session.tool.input.started", json!({ "id": "call_1", "name": "woke" }));
    world.settle();
    world.harness.wait_for("woke 0");
    WOKE_VIEWS.with_borrow_mut(Vec::clear);
    WOKEN.set(1);
    WAKE.with_borrow(|waker| waker.as_ref().expect("the plugin's waker").wake());
    world.harness.app.advance(Duration::from_millis(1));
    let first = world.harness.app.render().text();
    assert!(first.contains("woke 1"), "the first paint after the wake:\n{first}");
    assert_eq!(WOKE_VIEWS.with_borrow(Clone::clone), [1]);
    world.harness.app.render();
    assert_eq!(WOKE_VIEWS.with_borrow(Vec::len), 1, "the paint after viewed again");
}
