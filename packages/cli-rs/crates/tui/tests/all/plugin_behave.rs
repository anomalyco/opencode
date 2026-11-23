//! Compare plugin scroll commands, sticky headers, and windowed lists with an independently laid-out board. Each
//! input's first frame must already be settled.

use crate::support::{
    self,
    model::{self, Failure, Model, Rng},
};

use std::cell::RefCell;
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::abi::interact::{Event, Handled};
use opencode_plugin::abi::{self, v2};
use opencode_plugin::{behave, reconcile};
use opencode_tui::{Deps, Route};

/// The rows of a card that is not reviewed: its header, then two hunks of three rows with a header row between.
const CARD: i32 = 8;
/// The sticky header's rows, which a step lands below.
const INSET: u16 = 1;

/// The board's model, and what its handlers and views saw.
#[derive(Default)]
struct Board {
    reviewed: Vec<bool>,
    landed: Vec<String>,
    user_scrolls: usize,
    views: usize,
    layouts: usize,
    /// Top card and movement-only flag for each layout callback.
    tops: Vec<(Option<String>, bool)>,
    /// When set, the cards are a windowed list instead of a scroll's children.
    list: bool,
    /// When set, the scroll does not ask for the user's scroll events.
    quiet: bool,
    /// The `file` anchors a read gave, with their rows.
    anchors: Vec<(String, i32)>,
    /// `layout` asks for a view again on every call; the view then shows how many it ran.
    again: bool,
    /// Each view gives the edge another height, so each changes what `layout` is told.
    churn: bool,
    edges: Vec<Option<v2::Rect>>,
    /// A list's items estimate rows that have nothing to do with their heights.
    vary: bool,
    /// The handler moves the transcript on each scroll event: a step that landed, the user's scroll.
    transcript: bool,
}

thread_local! {
    static BOARD: RefCell<Board> = RefCell::default();
}

fn board<T>(f: impl FnOnce(&mut Board) -> T) -> T {
    BOARD.with(|board| f(&mut board.borrow_mut()))
}

fn files() -> v2::Target {
    v2::Target::node("board", "files")
}

fn patch(card: usize) -> String {
    format!(
        "--- a/f{card}\n+++ b/f{card}\n@@ -1,2 +1,2 @@\n c_{card}_0\n-r_{card}_1\n+a_{card}_2\n@@ -20,2 +20,2 @@\n \
         c_{card}_4\n-r_{card}_5\n+a_{card}_6\n"
    )
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command::new(name).scope(abi::Scope::Route("board".into()));
    setup.command(command("board.step"), |host, input| {
        let by = input.and_then(|by| by.parse().ok()).unwrap_or(1);
        host.scroll(files(), v2::Scroll::Step { group: "hunk".into(), by, inset: INSET });
    });
    setup.command(command("board.to"), |host, input| {
        let node = input.unwrap_or_default().to_owned();
        host.scroll(files(), v2::Scroll::To { node, align: v2::ScrollAlign::Start });
    });
    setup.command(command("board.forget"), |host, _| host.scroll(files(), v2::Scroll::Forget));
    setup.command(command("board.near"), |host, input| {
        let node = input.unwrap_or_default().to_owned();
        host.scroll(files(), v2::Scroll::To { node, align: v2::ScrollAlign::Nearest { inset: INSET } });
    });
    setup.command(command("board.page"), |host, input| {
        let percent = input.and_then(|percent| percent.parse().ok()).unwrap_or(100);
        host.scroll(files(), v2::Scroll::Page { percent });
    });
    setup.command(command("board.edge"), |host, input| {
        let edge = if input == Some("bottom") { v2::Edge::Bottom } else { v2::Edge::Top };
        host.scroll(files(), v2::Scroll::Edge { edge });
    });
    // Marks a card reviewed or not, and nothing else: a list keeps the reading position by itself.
    setup.command(command("board.fold"), |_, input| {
        let card: usize = input.and_then(|card| card.parse().ok()).unwrap_or(0);
        board(|board| board.reviewed[card] = !board.reviewed[card]);
    });
    setup.command(command("board.anchors"), |host, _| {
        let anchors = host.anchors(&files(), "file");
        board(|board| board.anchors = anchors.iter().map(|anchor| (anchor.id.clone(), anchor.row)).collect());
    });
    // Marks a card reviewed or not, and keeps the card at the top where it is: read at event time.
    setup.command(command("board.review"), |host, input| {
        let card: usize = input.and_then(|card| card.parse().ok()).unwrap_or(0);
        let current = host.top_anchor(&files(), "file", INSET).map(|anchor| anchor.id);
        board(|board| board.reviewed[card] = !board.reviewed[card]);
        if let Some(node) = current {
            host.scroll(files(), v2::Scroll::To { node, align: v2::ScrollAlign::Keep });
        }
    });
    let surface = v2::Surface::new("board", v2::Place::Route("board".into()), view)
        .layout(vec![v2::Notify::Node { id: "edge".into() }], board_layout)
        .on(|host, event| {
            let rows = match event {
                Event::Scroll { event: v2::ScrollEvent::Landed { anchor, .. } } => {
                    board(|board| board.landed.push(anchor.id.clone()));
                    -1
                }
                Event::Scroll { event: v2::ScrollEvent::UserScroll { .. } } => {
                    board(|board| board.user_scrolls += 1);
                    -2
                }
                _ => return Handled::Pass,
            };
            if board(|board| board.transcript) {
                host.scroll(v2::Target::Transcript, v2::Scroll::By { rows });
            }
            Handled::Pass
        });
    setup.surface(surface);
    Ok(())
}

/// The board's `layout`: it paints the edge from the top card.
fn board_layout(geometry: &v2::Geometry) -> v2::LayoutReply {
    let top = geometry.top("files", "file");
    board(|board| {
        board.layouts += 1;
        board.edges.push(geometry.rect("edge"));
        board.tops.push((top.map(|top| top.id.clone()), geometry.moved_only));
    });
    let reviewed = top.is_some_and(|top| top.variant == "reviewed");
    let reply = v2::LayoutReply::default().paint("edge", if reviewed { "background.raised.high" } else { "text.base" });
    v2::LayoutReply { again: board(|board| board.again), ..reply }
}

/// The board as a scroll of every card, whatever the board's `list`: the eager reference a windowed list must show
/// the same as. Its commands show the board's state and move it to an offset.
fn eager_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command::new(name).scope(abi::Scope::Route("eager".into()));
    setup.command(command("eager.view"), |_, _| {});
    setup.command(command("eager.at"), |host, input| {
        let offset = input.and_then(|offset| offset.parse().ok()).unwrap_or(0);
        host.scroll(v2::Target::node("eager", "files"), v2::Scroll::Offset { offset });
    });
    let surface = v2::Surface::new("eager", v2::Place::Route("eager".into()), |cx| view_as(cx, false))
        .layout(vec![v2::Notify::Node { id: "edge".into() }], board_layout);
    setup.surface(surface);
    Ok(())
}

fn text(text: String) -> v2::Node {
    v2::Node::text(vec![abi::Span::new(text)])
}

/// A card; a wide one's header is in another color, so a resize across 60 columns builds every card again, of the
/// same rows.
fn card(cx: &mut v2::View<'_>, card: usize, reviewed: bool) -> v2::Node {
    let wide = cx.input.width >= 60;
    cx.memo(format!("card-{card}"), (reviewed, wide), |_| {
        let head = v2::Node::row(vec![text(format!("file {card:04}"))])
            .with_id(format!("head-{card}"))
            .bg(if wide { "background.raised.base" } else { "background.raised.high" })
            .sticky(v2::Edge::Top);
        let mut children = vec![head];
        if !reviewed {
            children.push(
                v2::Node::diff(v2::Source::Text(patch(card)))
                    .with_id(format!("diff-{card}"))
                    .view(v2::DiffView::Unified)
                    .hunks("hunk"),
            );
        }
        v2::Node::column(children).anchor("file", if reviewed { "reviewed" } else { "" })
    })
}

fn view(cx: &mut v2::View<'_>) -> v2::Node {
    let list = board(|board| board.list);
    view_as(cx, list)
}

/// The rows a card's item estimates: its height, or, when the board varies them, rows that have nothing to do with
/// it.
fn estimate(index: usize, reviewed: bool, vary: bool) -> u16 {
    match (vary, reviewed) {
        (true, _) => 1 + (index * 7 % 13) as u16,
        (false, true) => 1,
        (false, false) => CARD as u16,
    }
}

fn view_as(cx: &mut v2::View<'_>, list: bool) -> v2::Node {
    let (reviewed, quiet, vary) = board(|board| {
        board.views += 1;
        (board.reviewed.clone(), board.quiet, board.vary)
    });
    let grow = abi::Layout::default().grow();
    let files = if list {
        let items = reviewed
            .iter()
            .enumerate()
            .map(|(index, reviewed)| v2::ListItem::new(card(cx, index, *reviewed), estimate(index, *reviewed, vary)))
            .collect();
        v2::Node::list(items)
    } else {
        v2::Node::scroll(reviewed.iter().enumerate().map(|(index, reviewed)| card(cx, index, *reviewed)).collect())
    };
    let mut files = files.with_id("files").layout(grow).watched("file");
    if let v2::Node::Scroll { user_scroll, .. } | v2::Node::List { user_scroll, .. } = &mut files {
        *user_scroll = !quiet;
    }
    let (views, churn, again) = board(|board| (board.views, board.churn, board.again));
    let edge_height = abi::Layout::default().height(abi::Width::Cells(if churn { 1 + (views % 2) as u16 } else { 1 }));
    // The edge names the width the view heard, so a frame that shows the view of another size than its own differs.
    let width = cx.input.width;
    let edge =
        v2::Node::row(vec![text(if again { format!("edge {views} at {width}") } else { format!("edge at {width}") })])
            .with_id("edge")
            .layout(edge_height);
    v2::Node::column(vec![edge, files]).layout(grow)
}

struct Mounted {
    harness: support::Harness,
    /// First frame when it differs from the settled one.
    unsettled: Option<String>,
}

fn mount(cards: usize, width: u16, height: u16, list: bool) -> Mounted {
    board(|board| {
        *board = Board {
            reviewed: vec![false; cards],
            list,
            quiet: board.quiet,
            again: board.again,
            vary: board.vary,
            transcript: board.transcript,
            ..Board::default()
        }
    });
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.board", setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(width, height, deps);
    harness.tui.navigate(Route::Plugin { id: "test.board".into(), name: "board".into() });
    harness.app.advance(Duration::ZERO);
    let first = harness.app.render();
    let mut mounted = Mounted { harness, unsettled: None };
    if mounted.settle() != first {
        mounted.unsettled = Some(first.text());
    }
    mounted
}

impl Mounted {
    fn dispatch(&self, name: &str, input: Option<String>) {
        let _ = self.harness.tui.keymap.dispatch(name, input.as_deref());
        self.harness.app.advance(Duration::ZERO);
    }

    /// Frames until the app wants no more; the last.
    fn settle(&self) -> opentui::testing::Capture {
        let mut last = self.harness.app.render();
        for _ in 0..12 {
            if !self.harness.app.needs_frame() {
                break;
            }
            last = self.harness.app.render();
        }
        last
    }
}

// The oracle.

/// The board as the model knows it: each card's rows.
struct Rows {
    heights: Vec<i32>,
}

impl Rows {
    fn new(reviewed: &[bool]) -> Self {
        Self { heights: reviewed.iter().map(|reviewed| if *reviewed { 1 } else { CARD }).collect() }
    }

    fn start(&self, card: usize) -> i32 {
        self.heights[..card].iter().sum()
    }

    fn extent(&self) -> i32 {
        self.heights.iter().sum()
    }

    /// The content row of a body token `c_<card>_<line>` (`r_`, `a_`); line 4 to 6 are the second hunk's.
    fn token(&self, card: usize, line: i32) -> i32 {
        // The header, then hunk rows; the second hunk's header row comes before line 4.
        self.start(card) + 1 + line
    }

    /// The first row of each hunk, in content order, with its anchor id.
    fn hunks(&self) -> Vec<(i32, String)> {
        (0..self.heights.len())
            .filter(|card| self.heights[*card] == CARD)
            .flat_map(|card| {
                let start = self.start(card);
                [(start + 1, format!("diff-{card}#0")), (start + 4, format!("diff-{card}#1"))]
            })
            .collect()
    }

    /// The last card that starts at or above `row`.
    fn card_at(&self, row: i32) -> usize {
        (0..self.heights.len()).rev().find(|card| self.start(*card) <= row).unwrap_or(0)
    }
}

/// The offset a frame shows, read off its text: the first viewport row below the sticky header that names its content
/// row. `None` when no row does.
fn offset_shown(screen: &str, rows: &Rows, viewport_top: usize) -> Option<i32> {
    for (index, line) in screen.lines().enumerate().skip(viewport_top + 1) {
        let row = (index - viewport_top) as i32;
        for word in line.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')) {
            let parts: Vec<&str> = word.split('_').collect();
            if let [kind, card, line] = parts[..]
                && matches!(kind, "c" | "r" | "a")
                && let (Ok(card), Ok(line)) = (card.parse::<usize>(), line.parse::<i32>())
                && card < rows.heights.len()
            {
                return Some(rows.token(card, line) - row);
            }
        }
        if let Some(rest) = line.trim().strip_prefix("file ")
            && let Ok(card) = rest.trim().parse::<usize>()
            && card < rows.heights.len()
        {
            return Some(rows.start(card) - row);
        }
    }
    None
}

// The model.

#[derive(Clone, Debug)]
enum Command {
    Wheel {
        down: bool,
        steps: u8,
    },
    Resize {
        width: u16,
        height: u16,
    },
    Step(i32),
    To(usize),
    Review(usize),
    /// A card marked reviewed or not with no verb: a list keeps the reading position by itself.
    Fold(usize),
    Forget,
    /// `To` a node that is not in the tree.
    Gone,
    /// A resize and a step in one batch, with no frame between.
    Batch {
        width: u16,
        height: u16,
        by: i32,
    },
    /// `To` a card with `Nearest`, below the sticky header.
    Near(usize),
    Page(i16),
    Edge {
        bottom: bool,
    },
}

struct Behaviors {
    list: bool,
}

/// The eager reference of a run on a list: the same board as a scroll of every card, at the same size and offset.
struct Eager {
    harness: support::Harness,
}

impl Eager {
    fn new(width: u16, height: u16) -> Self {
        let deps = Deps {
            route: Route::Home,
            builtins: vec![abi::Plugin { id: "test.eager", setup: eager_setup }.into()],
            ..support::deps(Arc::new(support::empty()))
        };
        let harness = support::mount_still(width, height, deps);
        harness.tui.navigate(Route::Plugin { id: "test.eager".into(), name: "eager".into() });
        harness.app.advance(Duration::ZERO);
        Self { harness }
    }

    /// Render the eager reference at the same viewport and scroll offset.
    fn at(&self, size: (u16, u16), top: i32) -> opentui::testing::Capture {
        self.harness.app.resize(size.0, size.1);
        for (name, input) in [("eager.view", None), ("eager.at", Some(top.to_string()))] {
            let _ = self.harness.tui.keymap.dispatch(name, input.as_deref());
            self.harness.app.advance(Duration::ZERO);
            settled(&self.harness);
        }
        settled(&self.harness)
    }
}

/// What the oracle knows: the board's marks, the viewport, and the memory of the last step.
struct Oracle {
    reviewed: Vec<bool>,
    viewport: i32,
    /// The anchor the last step landed on, and the offset it left.
    memory: Option<(String, i32)>,
}

impl Oracle {
    fn rows(&self) -> Rows {
        Rows::new(&self.reviewed)
    }

    fn most(&self) -> i32 {
        (self.rows().extent() - self.viewport).max(0)
    }

    /// Where a step of `by` from `top` lands, and the offset it leaves, clamped at `most`; `None` when no anchor is
    /// there.
    /// A step of 0, or one that finds no anchor, moves nothing and keeps the memory of the last that landed.
    fn step(&mut self, top: i32, by: i32, most: i32) -> Option<(String, i32)> {
        if by == 0 {
            return None;
        }
        let hunks = self.rows().hunks();
        let inset = i32::from(INSET);
        let from = self
            .memory
            .as_ref()
            .filter(|(_, left)| *left == top)
            .and_then(|(anchor, _)| hunks.iter().position(|(_, id)| id == anchor));
        let next = match from {
            Some(at) => usize::try_from(at as i32 + by).ok().and_then(|at| hunks.get(at)),
            None if by > 0 => hunks.iter().find(|(row, _)| *row > top + inset),
            None => hunks.iter().rev().find(|(row, _)| *row < top + inset),
        }?;
        let target = (next.0 - inset).clamp(0, most);
        self.memory = Some((next.1.clone(), target));
        Some((next.1.clone(), target))
    }
}

const CARDS: usize = 10;

impl Model for Behaviors {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        (0..steps)
            .map(|_| match rng.below(15) {
                0 | 1 => Command::Wheel { down: rng.below(3) > 0, steps: 1 + rng.below(3) as u8 },
                2 => Command::Resize { width: 40 + rng.below(40) as u16, height: 8 + rng.below(14) as u16 },
                3..=5 => Command::Step(*rng.pick(&[1, 1, -1, 2, -2, 0])),
                6 => Command::To(rng.below(CARDS)),
                7 if self.list => Command::Fold(rng.below(CARDS)),
                7 | 8 => Command::Review(rng.below(CARDS)),
                9 => Command::Forget,
                10 => Command::Gone,
                11 => Command::Batch {
                    width: *rng.pick(&[45, 60, 75]),
                    height: 8 + rng.below(14) as u16,
                    by: *rng.pick(&[1, -1]),
                },
                12 => Command::Near(rng.below(CARDS)),
                13 => Command::Page(*rng.pick(&[100, -100, 50, -50, 1, -1, 250])),
                _ => Command::Edge { bottom: rng.below(2) == 0 },
            })
            .collect()
    }

    fn simplify(&self, command: &Command) -> Vec<Command> {
        match command {
            Command::Step(by) if by.abs() > 1 => vec![Command::Step(by.signum())],
            Command::Wheel { down, steps } if *steps > 1 => vec![Command::Wheel { down: *down, steps: 1 }],
            Command::Batch { by, .. } => vec![Command::Step(*by)],
            _ => Vec::new(),
        }
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        let (width, height) = (60, 16);
        board(|board| board.vary = self.list);
        let board_view = mount(CARDS, width, height, self.list);
        let eager = self.list.then(|| Eager::new(width, height));
        let mut size = (width, height);
        let app = &board_view.harness.app;
        let mut oracle = Oracle { reviewed: vec![false; CARDS], viewport: i32::from(height) - 1, memory: None };
        let mut top = 0;
        let fail = |property: &'static str, site: &'static str, step: usize, detail: String| {
            Some(Failure { property, site, step, detail })
        };
        if let Some(first) = &board_view.unsettled
            && !model::skipped("settled-first")
        {
            return fail("settled-first", "open", 0, format!("the open's first frame:\n{first}"));
        }
        for (step, command) in commands.iter().enumerate() {
            let landed_before = board(|board| board.landed.len());
            // What the oracle expects the offset to be, when it knows; and the anchor a step lands on.
            let mut expected: Option<i32> = None;
            let mut lands: Option<String> = None;
            match command {
                Command::Wheel { down, steps } => {
                    // A wheel at a clamp moves nothing and keeps a step's memory; one that moves ends it below.
                    for _ in 0..*steps {
                        app.scroll(10, 5, *down);
                    }
                }
                Command::Resize { width, height } => {
                    app.resize(*width, *height);
                    size = (*width, *height);
                    oracle.viewport = i32::from(*height) - 1;
                }
                Command::Step(by) => {
                    let most = oracle.most();
                    let landing = oracle.step(top, *by, most);
                    expected = Some(landing.as_ref().map_or(top, |(_, target)| *target));
                    lands = landing.map(|(anchor, _)| anchor);
                    board_view.dispatch("board.step", Some(by.to_string()));
                }
                Command::Batch { width, height, by } => {
                    app.resize(*width, *height);
                    size = (*width, *height);
                    let most = oracle.most();
                    oracle.viewport = i32::from(*height) - 1;
                    // The step resolves against the last settled frame; the solve then clamps it to the new size. A
                    // target at the old end is the end (OpenTUI's scroll to the end follows the end), wherever the
                    // new size puts it.
                    let landing = oracle.step(top, *by, most);
                    let new_most = oracle.most();
                    expected = Some(match &landing {
                        Some((_, target)) if *target >= most && *target > 0 => new_most,
                        Some((_, target)) => (*target).min(new_most),
                        None => top.min(new_most),
                    });
                    lands = landing.map(|(anchor, _)| anchor);
                    board_view.dispatch("board.step", Some(by.to_string()));
                }
                Command::To(card) => {
                    oracle.memory = None;
                    expected = Some(oracle.rows().start(*card).min(oracle.most()));
                    board_view.dispatch("board.to", Some(format!("card-{card}")));
                }
                Command::Review(card) => {
                    oracle.memory = None;
                    let rows = oracle.rows();
                    let current = rows.card_at(top + i32::from(INSET));
                    let at = rows.start(current) - top;
                    oracle.reviewed[*card] = !oracle.reviewed[*card];
                    expected = Some((oracle.rows().start(current) - at).clamp(0, oracle.most()));
                    board_view.dispatch("board.review", Some(card.to_string()));
                }
                Command::Fold(card) => {
                    // The item at the top stays, as many rows into it as it has, where the clamp allows. The view did
                    // not move: a step's memory moves with it, unless the clamp moved the view.
                    let rows = oracle.rows();
                    let current = rows.card_at(top);
                    let within = top - rows.start(current);
                    oracle.reviewed[*card] = !oracle.reviewed[*card];
                    let rows = oracle.rows();
                    let kept = rows.start(current) + within.min(rows.heights[current] - 1);
                    if let Some((_, left)) = &mut oracle.memory
                        && *left == top
                    {
                        *left = kept;
                    }
                    expected = Some(kept.clamp(0, oracle.most()));
                    board_view.dispatch("board.fold", Some(card.to_string()));
                }
                Command::Forget => {
                    oracle.memory = None;
                    expected = Some(top);
                    board_view.dispatch("board.forget", None);
                }
                Command::Gone => {
                    oracle.memory = None;
                    expected = Some(top);
                    board_view.dispatch("board.to", Some("card-999".into()));
                }
                Command::Near(card) => {
                    // `scrollIntoView` with `block: nearest` and a `scroll-padding-top` of the header.
                    oracle.memory = None;
                    let rows = oracle.rows();
                    let (y, height, inset) = (rows.start(*card), rows.heights[*card], i32::from(INSET));
                    // Inside, or over the whole view: no move. Above: its top comes to the view's top, unless it is
                    // taller than the view, when its bottom comes to the bottom. Below: its bottom comes to the
                    // bottom, unless it is taller, when its top comes to the top.
                    let (above, below, room) =
                        (y < top + inset, y + height > top + oracle.viewport, oracle.viewport - inset);
                    let target = match (above, below) {
                        (true, true) | (false, false) => top,
                        (true, false) if height < room => y - inset,
                        (false, true) if height > room => y - inset,
                        _ => y + height - oracle.viewport,
                    };
                    expected = Some(target.clamp(0, oracle.most()));
                    board_view.dispatch("board.near", Some(format!("card-{card}")));
                }
                Command::Page(percent) => {
                    oracle.memory = None;
                    let rows = oracle.viewport * i32::from(*percent) / 100;
                    let rows = if rows == 0 { i32::from(percent.signum()) } else { rows };
                    // A list's page counts the host's rows, which are estimates for items without widgets: the eager
                    // reference checks what it shows.
                    expected = (!self.list).then(|| (top + rows).clamp(0, oracle.most()));
                    board_view.dispatch("board.page", Some(percent.to_string()));
                }
                Command::Edge { bottom } => {
                    oracle.memory = None;
                    expected = Some(if *bottom { oracle.most() } else { 0 });
                    board_view.dispatch("board.edge", Some(if *bottom { "bottom" } else { "top" }.into()));
                }
            }
            let first = app.render();
            let settled = board_view.settle();
            if app.needs_frame() && !model::skipped("settled-first") {
                return fail(
                    "settled-first",
                    "settles",
                    step,
                    format!("work is left after 12 frames:\n{}", settled.text()),
                );
            }
            if !model::skipped("settled-first") && first != settled {
                return fail(
                    "settled-first",
                    "first frame",
                    step,
                    format!("first:\n{}\nsettled:\n{}", first.text(), settled.text()),
                );
            }
            let screen = settled.text();
            let Some(shown) = offset_shown(&screen, &oracle.rows(), 1) else {
                return fail("scroll-keep", "no offset", step, screen);
            };
            top = shown;
            let property =
                if matches!(command, Command::Review(_) | Command::Fold(_)) { "scroll-keep" } else { "scroll-step" };
            if let Some(expected) = expected
                && expected != top
                && !model::skipped(property)
            {
                return fail(property, "offset", step, format!("expected {expected}, shown {top}:\n{screen}"));
            }
            let landed = board(|board| board.landed.get(landed_before).cloned());
            if landed != lands && !model::skipped("scroll-step") {
                return fail("scroll-step", "landed", step, format!("expected {lands:?}, landed {landed:?}"));
            }
            // A windowed list shows every cell as the board of every card does at its offset: rows, sticky header
            // and the edge `layout` painted.
            if let Some(eager) = &eager
                && !model::skipped("eager")
            {
                let reference = eager.at(size, top);
                if reference != settled {
                    let detail = format!("list:\n{}\neager:\n{}", settled.text(), reference.text());
                    return fail("eager", "cells", step, detail);
                }
            }
            if let Some((_, left)) = &oracle.memory
                && *left != top
            {
                // The solve clamped the step: its memory does not hold at this offset, for the oracle as for the
                // host.
                oracle.memory = None;
            }
        }
        None
    }
}

#[test]
fn behaviors_settle_in_the_first_frame_and_verbs_land_where_the_rules_say() {
    model::check(&Behaviors { list: false }, 16, 24);
}

#[test]
fn a_windowed_list_keeps_the_same_rules() {
    model::check(&Behaviors { list: true }, 16, 24);
}

#[test]
fn a_resize_calls_the_view_once() {
    for list in [false, true] {
        let mounted = mount(CARDS, 60, 16, list);
        for (width, height) in [(45, 12), (70, 18)] {
            let views = board(|board| board.views);
            mounted.harness.app.resize(width, height);
            mounted.settle();
            assert_eq!(board(|board| board.views), views + 1, "list {list}: {width}x{height}");
        }
    }
}

#[test]
fn a_wheel_step_and_a_resize_in_one_batch_keep_the_reader() {
    let shown = |frame_between: bool| {
        board(|board| board.vary = true);
        let mounted = mount(CARDS, 60, 16, true);
        let app = &mounted.harness.app;
        // Far enough that the cards above the view have no widgets: the change gives them their estimates.
        for _ in 0..40 {
            app.scroll(10, 5, true);
            mounted.settle();
        }
        app.scroll(10, 5, true);
        if frame_between {
            mounted.settle();
        }
        app.resize(45, 16);
        mounted.settle().text()
    };
    assert_eq!(shown(false), shown(true));
}

#[test]
fn the_deep_runs_rows_hold() {
    use Command::{Fold, Near, Page, Review, Step, To};
    let resize = |width, height| Command::Resize { width, height };
    let batch = |width, height, by| Command::Batch { width, height, by };
    let up = |steps| Command::Wheel { down: false, steps };
    let down = |steps| Command::Wheel { down: true, steps };
    const BOTTOM: Command = Command::Edge { bottom: true };
    let both: &[&[Command]] = &[
        &[resize(70, 17), To(9), batch(70, 16, 1)],
        &[To(8), resize(52, 18), batch(52, 12, 1), resize(78, 18), Step(1)],
        &[batch(60, 8, 1), Near(3)],
        &[resize(53, 14), BOTTOM, Step(1), resize(78, 12), Step(-1)],
        &[BOTTOM, Step(1), down(1), Step(1)],
        &[resize(60, 8), To(2), Near(2)],
        &[resize(60, 8), To(2), Page(50), Near(2)],
    ];
    // Virtualized lists must also preserve the offset when the measured and estimated item heights differ.
    let lists: &[&[Command]] = &[
        &[BOTTOM, Step(1), Fold(0), Step(1)],
        &[Near(8), resize(59, 14), Review(8), Fold(9), Step(1), Fold(4), up(1), Step(-2)],
        &[To(8), Step(1), Fold(1), Step(1)],
        &[Review(7), BOTTOM, resize(64, 17), Near(7)],
        &[Review(8), BOTTOM, Step(-1), Review(3), Step(-1), resize(78, 21), Step(-2)],
        &[Review(5), resize(70, 14), Fold(9), Near(9), Review(7)],
        &[resize(75, 12), Near(8), Review(5), Fold(6)],
        &[Review(8), To(6), resize(40, 17), down(3), Fold(9)],
        &[To(5), Step(1), Fold(3), Step(-2)],
        &[To(8), Review(4), resize(40, 21), Step(-1)],
        &[Review(5), Step(1), down(1), Page(250)],
        &[Review(1), BOTTOM, resize(67, 18), Review(3), To(4)],
        &[resize(77, 18), Review(4), resize(59, 13), BOTTOM, batch(59, 18, -1), Step(1)],
        &[BOTTOM, Review(5), Step(-1), Step(-1), Step(-2)],
        &[resize(71, 17), Review(0), BOTTOM, Step(1), batch(45, 9, -1), Step(1)],
        &[Near(9), batch(45, 19, 1), batch(60, 11, 1), Step(1), Step(1)],
        &[Fold(2), To(4), batch(45, 8, -1), Near(4)],
        &[To(7), down(3), Step(1), Step(1), Step(2), batch(75, 8, 1), batch(45, 21, 1)],
        &[BOTTOM, resize(58, 11), Page(250), batch(60, 11, 1), Step(-2)],
    ];
    for list in [false, true] {
        for row in both.iter().chain(if list { lists } else { &[] }) {
            assert_eq!(Behaviors { list }.run(row), None, "list {list}: {row:?}");
        }
    }
}

// Fixed rows.

#[test]
fn a_step_lands_below_the_sticky_header_in_its_own_frame() {
    let board_view = mount(6, 60, 16, false);
    let screen = board_view.harness.app.render().text();
    assert!(screen.contains("file 0000"), "the first frame shows no card:\n{screen}");
    let rows = Rows::new(&[false; 6]);
    assert_eq!(offset_shown(&screen, &rows, 1), Some(0), "{screen}");
    board_view.dispatch("board.step", Some("1".into()));
    let first = board_view.harness.app.render();
    let screen = first.text();
    assert_eq!(offset_shown(&screen, &rows, 1), Some(3), "{screen}");
    assert_eq!(board(|board| board.landed.clone()), ["diff-0#1"]);
    assert_eq!(first, board_view.settle(), "the step's first frame was not settled");
}

#[test]
fn layout_hears_the_top_card_and_paints_the_edge_in_the_same_frame() {
    let board_view = mount(6, 60, 16, false);
    let app = &board_view.harness.app;
    assert_eq!(board(|board| board.tops.clone()), [(Some("card-0".to_owned()), false)]);
    let edge = |capture: &opentui::testing::Capture| capture.cell(0, 0).map(|cell| cell.bg);
    let base = edge(&app.render());
    // Wheel steps inside card 0 move nothing `layout` named.
    let mut steps = 0;
    while board(|board| board.layouts) == 1 && steps < 10 {
        app.scroll(10, 5, true);
        let first = app.render();
        assert_eq!(first, board_view.settle(), "a wheel step's first frame was not settled");
        steps += 1;
    }
    assert!(steps > 1, "the first wheel step left card 0");
    assert_eq!(board(|board| board.tops.last().cloned()), Some((Some("card-1".to_owned()), true)));
    board_view.dispatch("board.review", Some("1".into()));
    let first = app.render();
    assert_eq!(board(|board| board.tops.last().cloned()), Some((Some("card-1".to_owned()), false)));
    assert_ne!(edge(&first), base, "the edge kept its color");
    assert_eq!(first, board_view.settle());
    board_view.dispatch("board.review", Some("1".into()));
    assert_eq!(edge(&app.render()), base, "the edge did not take its color back");
}

/// What each of six wheel steps down cost: views, `layout` calls, widgets touched, scroll events, behavior rounds.
fn wheel_work(cards: usize, list: bool, quiet: bool) -> Vec<(usize, usize, u64, usize, u64)> {
    // Lift the row budget here to measure scrolling work independently of admission limits.
    let _limits = crate::support::unlimited();
    board(|board| board.quiet = quiet);
    let board_view = mount(cards, 60, 16, list);
    let app = &board_view.harness.app;
    (0..6)
        .map(|_| {
            let (views, layouts, scrolls) = board(|board| (board.views, board.layouts, board.user_scrolls));
            let (work, counts) = (reconcile::work(), behave::counts());
            app.scroll(10, 5, true);
            app.advance(Duration::ZERO);
            board_view.settle();
            let touched = reconcile::work().since(work).touched();
            let rounds = behave::counts().since(counts).resolves;
            board(|board| (board.views - views, board.layouts - layouts, touched, board.user_scrolls - scrolls, rounds))
        })
        .collect()
}

#[test]
fn a_wheel_step_does_the_same_work_at_any_size() {
    for (list, quiet) in [(false, false), (false, true), (true, false), (true, true)] {
        let small = wheel_work(40, list, quiet);
        let calls = usize::from(!quiet);
        for (views, layouts, touched, scrolls, rounds) in &small {
            assert_eq!((*views, *scrolls), (calls, calls), "list {list}, quiet {quiet}: {small:?}");
            assert!(*layouts <= 1, "list {list}: {small:?}");
            assert!(list || *touched == 0, "list {list}: {small:?}");
            // One round, and one more when the step moves the list's window.
            assert!(*rounds <= 1 + u64::from(list), "list {list}: {small:?}");
        }
        assert_eq!(wheel_work(410, list, quiet), small, "list {list}, quiet {quiet}");
    }
}

#[test]
fn a_list_of_a_thousand_builds_what_shows() {
    let before = reconcile::work();
    let board_view = mount(1000, 60, 16, true);
    let built = reconcile::work().since(before).created;
    assert!(built < 80, "the open built {built} widgets");
    let rows = Rows::new(&[false; 1000]);
    // Every card is an anchor, those without widgets at the rows the host assumes for them.
    board_view.dispatch("board.anchors", None);
    let anchors = board(|board| board.anchors.clone());
    assert_eq!(anchors.len(), 1000);
    assert!(
        anchors.iter().enumerate().all(|(card, (id, row))| *id == format!("card-{card}") && *row == rows.start(card))
    );
    board_view.dispatch("board.to", Some("card-700".into()));
    let first = board_view.harness.app.render();
    assert_eq!(offset_shown(&first.text(), &rows, 1), Some(rows.start(700)), "{}", first.text());
    assert_eq!(first, board_view.settle());
    board_view.dispatch("board.step", Some("1".into()));
    assert_eq!(board(|board| board.landed.last().cloned()), Some("diff-700#1".to_owned()));
    let first = board_view.harness.app.render();
    assert_eq!(offset_shown(&first.text(), &rows, 1), Some(rows.start(700) + 3), "{}", first.text());
    let mounted = reconcile::work().since(before);
    assert!(mounted.created < 200, "{mounted:?}");
    // `Nearest` to a card far below moves to the rows the host assumes for it, which mounts it, and a round confirms:
    // three rounds, no more.
    let counts = behave::counts();
    board_view.dispatch("board.near", Some("card-900".into()));
    let first = board_view.harness.app.render();
    assert!(behave::counts().since(counts).resolves <= 3, "rounds");
    assert_eq!(offset_shown(&first.text(), &rows, 1), Some(rows.start(900) + 8 - 15), "{}", first.text());
}

#[test]
fn forget_ends_the_step_memory() {
    // Three cards of 8 rows under 11: the offset clamps at 13, so card 2's hunks (rows 17 and 20) all land there.
    let board_view = mount(3, 60, 12, false);
    board_view.dispatch("board.to", Some("card-2".into()));
    board_view.settle();
    for by in ["1", "1", "-1"] {
        board_view.dispatch("board.step", Some(by.into()));
        board_view.settle();
    }
    // Without memory a step back starts from the offset: the last hunk above `top + inset`, card 1's second.
    board_view.dispatch("board.forget", None);
    board_view.dispatch("board.step", Some("-1".into()));
    board_view.settle();
    assert_eq!(board(|board| board.landed.clone()), ["diff-2#0", "diff-2#1", "diff-2#0", "diff-1#1"]);
    let rows = Rows::new(&[false; 3]);
    let screen = board_view.harness.app.render().text();
    assert_eq!(offset_shown(&screen, &rows, 1), Some(11), "{screen}");
    board_view.dispatch("board.to", Some("card-404".into()));
    let first = board_view.harness.app.render();
    assert_eq!(first, board_view.settle());
    assert_eq!(offset_shown(&first.text(), &rows, 1), Some(11), "a verb for a node that left moved the cards");
}

// The node kinds.

#[derive(Default)]
struct Kinds {
    value: String,
    code: String,
    image: Vec<u8>,
    changes: Vec<String>,
    submits: Vec<String>,
}

thread_local! {
    static KINDS: RefCell<Kinds> = RefCell::default();
}

fn kinds<T>(f: impl FnOnce(&mut Kinds) -> T) -> T {
    KINDS.with(|kinds| f(&mut kinds.borrow_mut()))
}

/// A 1x1 PNG.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49,
    0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d,
    0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

fn kinds_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command::new(name).scope(abi::Scope::Route("kinds".into()));
    setup.command(command("kinds.value"), |_, input| kinds(|kinds| kinds.value = input.unwrap_or("").into()));
    setup.command(command("kinds.code"), |_, input| kinds(|kinds| kinds.code = input.unwrap_or("").into()));
    setup.command(command("kinds.image"), |_, input| {
        kinds(|kinds| kinds.image = if input == Some("png") { PNG.to_vec() } else { b"junk".to_vec() })
    });
    let surface = v2::Surface::new("kinds", v2::Place::Route("kinds".into()), |cx| {
        let (value, code, image) = kinds(|kinds| (kinds.value.clone(), kinds.code.clone(), kinds.image.clone()));
        let image = cx.content(image);
        let input = v2::Node::Input {
            id: Some("name".into()),
            value,
            placeholder: "name".into(),
            lines: None,
            layout: abi::Layout::default(),
            seen: None,
        };
        let mut split = v2::Node::row(vec![text("LEFT".into()), text("RIGHT".into())]).with_id("split");
        if let v2::Node::Box { split, .. } = &mut split {
            *split = Some(v2::Split { at: 20, min: 5 });
        }
        v2::Node::column(vec![
            input,
            v2::Node::Code {
                id: Some("code".into()),
                content: v2::Source::Text(code),
                filetype: Some("rust".into()),
                numbers: true,
                layout: abi::Layout::default(),
            },
            v2::Node::Image {
                id: Some("image".into()),
                content: v2::Source::Content(image),
                fit: v2::Fit::Contain,
                layout: abi::Layout::default().width(abi::Width::Cells(4)).height(abi::Width::Cells(2)),
            },
            split,
        ])
        .layout(abi::Layout::default().grow())
    })
    .on(|_, event| {
        match event {
            Event::Change { text, .. } => kinds(|kinds| kinds.changes.push(text.clone())),
            Event::Submit { text, .. } => kinds(|kinds| kinds.submits.push(text.clone())),
            _ => {}
        }
        Handled::Pass
    });
    setup.surface(surface);
    Ok(())
}

fn mount_kinds() -> support::Harness {
    kinds(|kinds| *kinds = Kinds { code: "fn main() {}".into(), image: PNG.to_vec(), ..Kinds::default() });
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.kinds", setup: kinds_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(60, 14, deps);
    harness.tui.navigate(Route::Plugin { id: "test.kinds".into(), name: "kinds".into() });
    harness.app.advance(Duration::ZERO);
    harness.app.render();
    harness
}

fn dispatch(harness: &support::Harness, name: &str, input: &str) {
    let _ = harness.tui.keymap.dispatch(name, Some(input));
    harness.app.advance(Duration::ZERO);
}

#[test]
fn an_input_tells_its_handler_and_keeps_what_the_user_typed() {
    let harness = mount_kinds();
    let screen = harness.app.render().text();
    let (x, y) = support::at(&screen, "name").expect("the input's placeholder shows");
    harness.app.click(x, y);
    harness.app.type_text("abc");
    harness.app.advance(Duration::ZERO);
    assert_eq!(kinds(|kinds| kinds.changes.last().cloned()), Some("abc".into()));
    harness.app.press("enter");
    harness.app.advance(Duration::ZERO);
    assert_eq!(kinds(|kinds| kinds.submits.clone()), ["abc"]);
    dispatch(&harness, "kinds.code", "fn other() {}");
    assert!(harness.app.render().text().contains("abc"), "the typed text went");
    dispatch(&harness, "kinds.value", "xyz");
    let screen = harness.app.render().text();
    assert!(screen.contains("xyz") && !screen.contains("abc"), "{screen}");
}

#[test]
fn code_and_images_show_and_change_in_place() {
    let harness = mount_kinds();
    let screen = harness.app.render().text();
    assert!(screen.contains("1 fn main() {}") || screen.contains("1  fn main() {}"), "{screen}");
    let before = reconcile::work();
    dispatch(&harness, "kinds.code", "fn other() {}");
    let done = reconcile::work().since(before);
    assert!(harness.app.render().text().contains("fn other() {}"));
    assert_eq!((done.created, done.removed), (0, 0), "{done:?}");
    dispatch(&harness, "kinds.image", "junk");
    let screen = harness.app.render().text();
    assert!(screen.contains("fn other() {}"), "the plugin failed on a bad image:\n{screen}");
    let before = reconcile::work();
    dispatch(&harness, "kinds.image", "png");
    harness.app.render();
    assert_eq!(reconcile::work().since(before).created, 0, "an image built again");
}

#[test]
fn a_split_follows_the_drag_and_keeps_its_width() {
    let harness = mount_kinds();
    let screen = harness.app.render().text();
    let (left, row) = support::at(&screen, "LEFT").expect("the split shows");
    let (right, _) = support::at(&screen, "RIGHT").unwrap();
    assert_eq!(right - left, 20, "{screen}");
    // Press the handle rather than its neighboring text so selection does not intercept the drag.
    harness.app.drag((left + 20, row), (left + 32, row));
    let screen = harness.app.render().text();
    assert_eq!(support::at(&screen, "RIGHT").map(|(x, _)| x - left), Some(32), "{screen}");
    let selected = || harness.app.app().selected_text().filter(|text| !text.is_empty());
    assert_eq!(selected(), None, "the split's drag selected text");
    // The handle's bar, the last column of the first child, lights while the pointer is over the handle.
    let bar = |capture: &opentui::testing::Capture| capture.cell(u32::from(left + 31), u32::from(row)).map(|c| c.bg);
    harness.app.hover(left + 50, row);
    let dark = bar(&harness.app.render());
    harness.app.hover(left + 32, row);
    let lit = bar(&harness.app.render());
    assert_ne!(lit, dark, "the handle's bar did not light");
    harness.app.hover(left + 50, row);
    assert_eq!(bar(&harness.app.render()), dark, "the handle's bar stayed lit");
    // A selection the user made stays through a drag of the handle, which prevents the press's default.
    harness.app.drag((left, row), (left + 3, row));
    assert_eq!(selected().as_deref(), Some("LEFT"));
    harness.app.drag((left + 32, row), (left + 30, row));
    assert_eq!(selected().as_deref(), Some("LEFT"), "the handle's press ended the selection");
    let screen = harness.app.render().text();
    assert_eq!(support::at(&screen, "RIGHT").map(|(x, _)| x - left), Some(30), "{screen}");
    harness.app.drag((left + 30, row), (left + 1, row));
    let screen = harness.app.render().text();
    assert_eq!(support::at(&screen, "RIGHT").map(|(x, _)| x - left), Some(5), "the minimum went:\n{screen}");
    dispatch(&harness, "kinds.code", "fn moved() {}");
    let screen = harness.app.render().text();
    assert_eq!(support::at(&screen, "RIGHT").map(|(x, _)| x - left), Some(5), "a revision reset it:\n{screen}");
}

// The published transcript.

thread_local! {
    static WAKER: RefCell<Option<abi::Waker>> = const { RefCell::new(None) };
    static READ: RefCell<Vec<i32>> = const { RefCell::new(Vec::new()) };
}

fn transcript_setup(setup: &mut abi::Setup) -> Result<(), String> {
    WAKER.with(|waker| *waker.borrow_mut() = setup.waker());
    let command = |name: &str| abi::Command::new(name);
    setup.command(command("tx.by"), |host, _| {
        READ.with(|read| read.borrow_mut().extend(host.transcript().map(|view| view.offset)));
        host.scroll(v2::Target::Transcript, v2::Scroll::By { rows: -3 });
    });
    setup.command(command("tx.step"), |host, _| {
        host.scroll(v2::Target::Transcript, v2::Scroll::Step { group: "x".into(), by: 1, inset: 0 })
    });
    // A command the plugin runs itself is not the user's input, nor is the result of its own verb.
    setup.command(command("tx.relay"), |host, _| host.dispatch("tx.by", None));
    setup.command(command("tx.wake"), |_, _| {
        WAKER.with(|waker| waker.borrow().as_ref().map(|waker| waker.wake()));
    });
    // A wake is not the user's input: a verb from it would fight the wheel.
    setup.on_wake(|host| host.scroll(v2::Target::Transcript, v2::Scroll::By { rows: 9 }));
    // Use a modifier because the composer owns unmodified printable keys.
    let layer = abi::interact::Layer::default()
        .scope(abi::interact::LayerScope::Global)
        .keys(vec![abi::interact::Bind::new("alt+z", "up")]);
    setup.layer(layer, |host, _| {
        host.scroll(v2::Target::Transcript, v2::Scroll::By { rows: -4 });
        Handled::Consume
    });
    Ok(())
}

#[test]
fn the_transcript_takes_three_verbs_from_a_handler_only() {
    let verbs: std::rc::Rc<RefCell<Vec<v2::Scroll>>> = std::rc::Rc::default();
    let recorded = verbs.clone();
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.transcript", setup: transcript_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(60, 14, deps);
    let _published = behave::publish_transcript(
        harness.app.app(),
        behave::Published {
            read: std::rc::Rc::new(|| v2::TranscriptView { offset: 7, viewport: 10, extent: 40, ..Default::default() }),
            scroll: std::rc::Rc::new(move |verb| recorded.borrow_mut().push(verb.clone())),
        },
    );
    harness.app.render();
    for name in ["tx.by", "tx.step", "tx.wake", "tx.relay"] {
        let _ = harness.tui.keymap.dispatch(name, None);
        harness.app.advance(Duration::from_millis(1));
        harness.app.render();
    }
    harness.app.press("alt+z");
    harness.app.advance(Duration::from_millis(5));
    assert_eq!(*verbs.borrow(), [v2::Scroll::By { rows: -3 }, v2::Scroll::By { rows: -4 }]);
    // A read answers any call.
    assert_eq!(READ.with(|read| read.borrow().clone()), [7, 7]);
}

// A list's refusals.

/// A host with a theme and nothing else, for adopting trees straight into a [`reconcile::Tree`].
struct Plain {
    app: opentui::testing::TestApp,
    keymap: opencode_ui::dialog::DialogKeymap,
    theme: opencode_ui::theme::Theme,
}

impl opencode_plugin::Host for Plain {
    fn app(&self) -> &opentui::prelude::App {
        &self.app
    }

    fn theme(&self) -> opencode_ui::theme::Theme {
        self.theme.clone()
    }

    fn keymap(&self) -> &opencode_ui::dialog::DialogKeymap {
        &self.keymap
    }
}

fn plain() -> Plain {
    Plain {
        app: opentui::testing::TestApp::new(40, 10),
        keymap: opencode_ui::dialog::DialogKeymap::new(
            opencode_ui::keymap::Keybinds::defaults(),
            opencode_ui::keymap::Options::default(),
        ),
        theme: opencode_ui::theme::Catalog::default()
            .load("opencode", opencode_ui::theme::ThemeMode::Dark)
            .unwrap()
            .theme,
    }
}

fn adopt(host: &Plain, tree: &mut reconcile::Tree, nodes: &[v2::Node]) -> Result<(), reconcile::Refused> {
    let act: opencode_plugin::node::Act = std::rc::Rc::new(|_| {});
    let slot = |_: &opentui::prelude::View, _: &str| None;
    let source = |source: &v2::Source| match source {
        v2::Source::Text(text) => Some(std::rc::Rc::from(text.as_str())),
        _ => None,
    };
    let env = reconcile::Env {
        host,
        theme: &host.theme,
        act: &act,
        slot: &slot,
        source: &source,
        measure: &|source| match source {
            v2::Source::Text(text) => opencode_plugin::reconcile::measure(text),
            _ => opencode_plugin::reconcile::Measure::default(),
        },
        content: &|_| false,
        dropped: &|_| false,
        image: &|_| opencode_plugin::image::Picture::Pending,
        full: false,
        draw: None,
        owner: None,
        plugin: None,
        item: false,
        fence: None,
    };
    tree.apply(&env, &host.app.root(), nodes)
}

#[test]
fn a_list_refuses_what_crosses_its_items() {
    use reconcile::Refused;
    let host = plain();
    let item = |key: &str, children: Vec<v2::Node>| v2::ListItem::new(v2::Node::column(children).with_id(key), 1);
    let keep = |key: &str| v2::Node::Keep { key: key.into() };
    let list = |items: Vec<v2::ListItem>| v2::Node::list(items).with_id("l");
    let first = || item("a", vec![text("x".into()).with_id("a.x")]);
    let mut tree = reconcile::Tree::default();
    adopt(&host, &mut tree, &[list(vec![first(), item("b", vec![])])]).unwrap();
    let refused = [
        (list(vec![v2::ListItem::new(text("bare".into()), 1)]), Refused::Unkeyed),
        (list(vec![first(), item("b", vec![keep("a.x")])]), Refused::Unknown("a.x".into())),
        (v2::Node::column(vec![list(vec![first(), item("b", vec![])]), keep("b")]), Refused::Unknown("b".into())),
        (v2::Node::column(vec![list(vec![first()]), keep("a.x")]), Refused::Unknown("a.x".into())),
    ];
    for (tree_of, why) in refused {
        assert_eq!(adopt(&host, &mut tree, &[tree_of]), Err(why));
    }
    // A keep of an item whole, and one inside the item that held it, are taken.
    adopt(&host, &mut tree, &[list(vec![v2::ListItem::new(keep("a"), 1), item("b", vec![])])]).unwrap();
    adopt(&host, &mut tree, &[list(vec![item("a", vec![keep("a.x")]), item("b", vec![])])]).unwrap();
}

// A large added file.

fn big_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command::new(name).scope(abi::Scope::Route("big".into()));
    let target = || v2::Target::node("big", "files");
    setup
        .command(command("big.end"), move |host, _| host.scroll(target(), v2::Scroll::Edge { edge: v2::Edge::Bottom }));
    setup.command(command("big.at"), move |host, input| {
        let offset = input.and_then(|offset| offset.parse().ok()).unwrap_or(0);
        host.scroll(target(), v2::Scroll::Offset { offset });
    });
    setup.surface(v2::Surface::new("big", v2::Place::Route("big".into()), |_| {
        let lines: String = (0..5000).map(|line| format!("+line_{line}\n")).collect();
        let patch = format!("--- /dev/null\n+++ b/big.txt\n@@ -0,0 +1,5000 @@\n{lines}");
        let diff = v2::Node::diff(v2::Source::Text(patch)).with_id("big").view(v2::DiffView::Unified).hunks("hunk");
        v2::Node::column(vec![v2::Node::scroll(vec![diff]).with_id("files").layout(abi::Layout::default().grow())])
            .layout(abi::Layout::default().grow())
    }));
    Ok(())
}

#[test]
fn a_large_added_file_mounts_its_chunks_near_the_view() {
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.big", setup: big_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(60, 14, deps);
    harness.tui.navigate(Route::Plugin { id: "test.big".into(), name: "big".into() });
    harness.app.advance(Duration::ZERO);
    assert!(harness.app.render().text().contains("line_0"));
    for (command, input, line) in [("big.end", None, "line_4999"), ("big.at", Some("2500"), "line_2505")] {
        let _ = harness.tui.keymap.dispatch(command, input);
        harness.app.advance(Duration::ZERO);
        let first = harness.app.render();
        assert!(first.text().contains(line), "{command} does not show {line}:\n{}", first.text());
        assert!(!harness.app.needs_frame() || harness.app.render() == first, "{command}'s first frame was not settled");
    }
}

#[test]
fn layout_may_ask_for_a_view_again() {
    board(|board| board.again = true);
    let board_view = mount(3, 60, 12, false);
    let app = &board_view.harness.app;
    let (views, layouts) = board(|board| (board.views, board.layouts));
    // A fold changes the top card's variant: the handler's view, one delivery, and the view it asks for.
    board_view.dispatch("board.review", Some("0".into()));
    let first = app.render();
    let (ran, laid) = board(|board| (board.views - views, board.layouts - layouts));
    assert_eq!((ran, laid), (2, 1));
    assert!(first.text().contains(&format!("edge {}", views + 2)), "{}", first.text());
    assert_eq!(first, board_view.settle());
}

#[test]
fn a_layout_past_the_cap_waits_for_the_next_frame() {
    let board_view = mount(3, 60, 12, false);
    let app = &board_view.harness.app;
    // Each delivery asks for a view, and each view gives the edge another height: a delivery a round, forever.
    board(|board| {
        board.again = true;
        board.churn = true;
    });
    let before = board(|board| board.layouts);
    board_view.dispatch("board.review", Some("0".into()));
    app.render();
    assert_eq!(board(|board| board.layouts) - before, 2, "deliveries in the frame of the event");
    assert!(app.needs_frame(), "the third delivery asked for no frame");
    // The plugin stops asking; the owed delivery comes in the next frame with what is laid out then.
    board(|board| board.again = false);
    let first = app.render();
    assert_eq!(board(|board| board.layouts) - before, 3, "the third delivery was lost");
    let views = board(|board| board.views);
    let told = board(|board| board.edges.last().copied().flatten()).expect("the edge's rect");
    assert_eq!(told.height, 1 + (views % 2) as i32, "the delivery was told an old rect");
    assert_eq!(first, board_view.settle());
}

// A probe whose shape each test sets: a column of an optional strip and a scroll or list `s` of cards `c{i}`, each
// an anchor of group `g` with its lines `r{i:04}.{j}`.

#[derive(Clone, Default)]
struct Shape {
    /// Each card's lines and the estimate it gives.
    cards: Vec<(u16, u16)>,
    list: bool,
    /// The list's width in cells, when set.
    width: Option<u16>,
    /// Lines long enough to wrap in a narrow terminal.
    wrap: bool,
    /// Each card is held with a memo, so a later view keeps it.
    memo: bool,
    user_scroll: bool,
    variant: String,
    notify: Vec<v2::Notify>,
    /// Three scrolls, `s`, `t` and `u`, each told about its top anchor.
    twin: bool,
    /// Each card's first line is a sticky header `h{i}`.
    sticky: bool,
    /// A strip `strip` above, its width growing with the stage; `layout` asks for a view until the stage is this.
    again_until: Option<usize>,
    /// The list lays its items out in a row.
    row: bool,
    /// Each card is a header and a patch `d{i}` of this many hunks of this many lines, its hunks of group `h`.
    hunks: Vec<(u16, u16)>,
    /// Each card is inside a box `w{i}` without an anchor.
    wrapped: bool,
    /// Card 0 holds an input `in0`, of this value.
    input: bool,
    input_value: String,
    /// `layout` paints card 0 in this token.
    paint: Option<String>,
    /// Card 0's own background.
    card_bg: Option<String>,
    /// Card 0 hides what overflows it, which builds its box again and moves nothing.
    card_hidden: bool,
    /// Each card is a split row of `L{i}` and `RIGHT{i}`, the first 10 wide.
    split: bool,
    /// Scroll `s` tells `layout` its top anchor of group `g`.
    top: bool,
    /// `layout` panics.
    panic_layout: bool,
    /// This card is a focusable box inside a hidden one.
    hidden: Option<usize>,
}

#[derive(Default)]
struct Seen {
    geometries: Vec<v2::Geometry>,
    events: Vec<v2::ScrollEvent>,
    /// The scroll state each event's handler read.
    reads: Vec<Option<v2::ScrollState>>,
    stage: usize,
    views: usize,
    /// The anchors of group `g` a read gave.
    anchors: Vec<String>,
}

thread_local! {
    static SHAPE: RefCell<Shape> = RefCell::default();
    static SEEN: RefCell<Seen> = RefCell::default();
}

fn shape<T>(f: impl FnOnce(&mut Shape) -> T) -> T {
    SHAPE.with(|shape| f(&mut shape.borrow_mut()))
}

fn seen<T>(f: impl FnOnce(&mut Seen) -> T) -> T {
    SEEN.with(|seen| f(&mut seen.borrow_mut()))
}

fn probe_target() -> v2::Target {
    v2::Target::node("probe", "s")
}

fn probe_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command::new(name).scope(abi::Scope::Route("probe".into()));
    let input = |input: Option<&str>| input.unwrap_or_default().to_owned();
    setup.command(command("p.go"), move |host, node| {
        host.scroll(probe_target(), v2::Scroll::To { node: input(node), align: v2::ScrollAlign::Start });
    });
    setup.command(command("p.at"), move |host, offset| {
        host.scroll(probe_target(), v2::Scroll::Offset { offset: input(offset).parse().unwrap() });
    });
    setup.command(command("p.step"), move |host, by| {
        host.scroll(probe_target(), v2::Scroll::Step { group: "g".into(), by: input(by).parse().unwrap(), inset: 1 });
    });
    setup.command(command("p.end"), |host, _| host.scroll(probe_target(), v2::Scroll::Edge { edge: v2::Edge::Bottom }));
    setup.command(command("p.hstep"), move |host, by| {
        host.scroll(probe_target(), v2::Scroll::Step { group: "h".into(), by: input(by).parse().unwrap(), inset: 1 });
    });
    setup.command(command("p.anchors"), |host, _| {
        let anchors = host.anchors(&probe_target(), "g");
        seen(|seen| seen.anchors = anchors.into_iter().map(|anchor| anchor.id).collect());
    });
    // Runs a view, which reads the shape.
    setup.command(command("p.view"), |_, _| {});
    let notify = shape(|shape| shape.notify.clone());
    let surface = v2::Surface::new("probe", v2::Place::Route("probe".into()), probe_view)
        .layout(notify, |geometry| {
            assert!(!shape(|shape| shape.panic_layout), "layout fault");
            let again = shape(|shape| shape.again_until).is_some_and(|until| seen(|seen| seen.stage) < until);
            seen(|seen| {
                seen.geometries.push(geometry.clone());
                if again {
                    seen.stage += 1;
                }
            });
            let reply = match shape(|shape| shape.paint.clone()) {
                Some(token) => v2::LayoutReply::default().paint("c0", token),
                None => v2::LayoutReply::default(),
            };
            v2::LayoutReply { again, ..reply }
        })
        .on(|host, event| {
            if let Event::Scroll { event } = event {
                let read = host.scroll_state(&probe_target());
                seen(|seen| {
                    seen.events.push(event.clone());
                    seen.reads.push(read);
                });
            }
            Handled::Pass
        });
    setup.surface(surface);
    Ok(())
}

/// Card `index` of scroll `scroll`; the ids of scroll `s`'s have no prefix.
fn probe_card(scroll: &str, index: usize, rows: u16, shape: &Shape) -> v2::Node {
    let prefix = if scroll == "s" { "" } else { scroll };
    let line = |row: u16| {
        let text = if shape.wrap { format!("r{index:04}.{row} this line wraps") } else { format!("r{index:04}.{row}") };
        let node = self::text(text).with_id(format!("{prefix}r{index}.{row}"));
        match (row, shape.sticky) {
            (0, true) => v2::Node::row(vec![node]).with_id(format!("{prefix}h{index}")).sticky(v2::Edge::Top),
            _ => node,
        }
    };
    let mut lines: Vec<v2::Node> = (0..rows).map(line).collect();
    if let Some(&(hunks, size)) = shape.hunks.get(index) {
        lines.push(
            v2::Node::diff(v2::Source::Text(hunky(index, hunks, size)))
                .with_id(format!("{prefix}d{index}"))
                .view(v2::DiffView::Unified)
                .hunks("h"),
        );
    }
    if shape.input && index == 0 {
        lines.push(v2::Node::input(&shape.input_value).with_id(format!("{prefix}in0")));
    }
    if shape.split {
        let mut row = v2::Node::row(vec![text(format!("L{index}")), text(format!("RIGHT{index}"))]);
        if let v2::Node::Box { split, .. } = &mut row {
            *split = Some(v2::Split { at: 10, min: 3 });
        }
        return row.with_id(format!("{prefix}c{index}")).anchor("g", "");
    }
    let mut card = v2::Node::column(lines).with_id(format!("{prefix}c{index}")).anchor("g", shape.variant.clone());
    if let (0, Some(bg)) = (index, &shape.card_bg) {
        card = card.bg(bg.clone());
    }
    if let (0, true, v2::Node::Box { overflow, .. }) = (index, shape.card_hidden, &mut card) {
        *overflow = abi::Overflow::Hidden;
    }
    if shape.hidden == Some(index) {
        if let v2::Node::Box { interact, .. } = &mut card {
            interact.focusable = true;
        }
        return v2::Node::column(vec![card]).with_id(format!("{prefix}x{index}")).visible(false);
    }
    match shape.wrapped {
        true => v2::Node::column(vec![card]).with_id(format!("{prefix}w{index}")),
        false => card,
    }
}

/// A patch of card `card`: `hunks` hunks of `size` added lines `h{card}.{hunk}.{line}`.
fn hunky(card: usize, hunks: u16, size: u16) -> String {
    let mut patch = format!("--- a/f{card}\n+++ b/f{card}\n");
    for hunk in 0..hunks {
        let start = u32::from(hunk) * 1000 + 1;
        patch.push_str(&format!("@@ -{start},0 +{start},{size} @@\n"));
        for line in 0..size {
            patch.push_str(&format!("+h{card}.{hunk}.{line}\n"));
        }
    }
    patch
}

fn probe_view(cx: &mut v2::View<'_>) -> v2::Node {
    let shape = shape(|shape| shape.clone());
    let stage = seen(|seen| {
        seen.views += 1;
        seen.stage
    });
    let grow = abi::Layout::default().grow();
    let scroll = |id: &str, cx: &mut v2::View<'_>| {
        let cards: Vec<v2::Node> = shape
            .cards
            .iter()
            .enumerate()
            .map(|(index, (rows, _))| match shape.memo {
                true => cx.memo(format!("{id}{index}"), (*rows, shape.variant.clone()), |_| {
                    probe_card(id, index, *rows, &shape)
                }),
                false => probe_card(id, index, *rows, &shape),
            })
            .collect();
        let layout = match shape.width {
            Some(width) => grow.width(abi::Width::Cells(width)),
            None => grow,
        };
        let mut node = match shape.list {
            true => v2::Node::list(
                cards
                    .into_iter()
                    .zip(&shape.cards)
                    .map(|(card, (_, estimate))| v2::ListItem::new(card, *estimate))
                    .collect(),
            ),
            false => v2::Node::scroll(cards),
        };
        if let v2::Node::List { row, .. } = &mut node {
            *row = shape.row;
        }
        let mut node = node.with_id(id).layout(layout);
        if let v2::Node::Scroll { user_scroll, notify_top, .. } | v2::Node::List { user_scroll, notify_top, .. } =
            &mut node
        {
            *user_scroll = shape.user_scroll;
            *notify_top = (shape.twin || shape.top).then(|| "g".to_owned());
        }
        node
    };
    let mut children = Vec::new();
    if shape.again_until.is_some() {
        let width = abi::Layout::default().width(abi::Width::Cells(10 + stage as u16));
        children.push(v2::Node::row(vec![text(format!("stage {stage}"))]).with_id("strip").layout(width));
    }
    // No cards: a text alone.
    if shape.cards.is_empty() {
        children.push(text("geometry".into()).with_id("txt"));
    }
    let scrolls: &[&str] = match (shape.cards.is_empty(), shape.twin) {
        (true, _) => &[],
        (false, false) => &["s"],
        (false, true) => &["s", "t", "u"],
    };
    for id in scrolls {
        children.push(scroll(id, cx));
    }
    v2::Node::column(children).layout(grow)
}

/// Mounts the probe in `shape` on a `width` by `height` terminal, after its first frame.
fn probe(new: Shape, width: u16, height: u16) -> support::Harness {
    shape(|shape| *shape = new);
    seen(|seen| *seen = Seen::default());
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.probe", setup: probe_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(width, height, deps);
    harness.tui.navigate(Route::Plugin { id: "test.probe".into(), name: "probe".into() });
    harness.app.advance(Duration::ZERO);
    harness
}

/// The first line of the next frame.
fn top_line(harness: &support::Harness) -> String {
    harness.app.render().text().lines().next().unwrap_or_default().trim_end().to_owned()
}

/// Frames until the app wants no more, at most 12; the last.
fn settled(harness: &support::Harness) -> opentui::testing::Capture {
    let mut last = harness.app.render();
    for _ in 0..12 {
        if !harness.app.needs_frame() {
            break;
        }
        last = harness.app.render();
    }
    last
}

fn landed() -> Vec<String> {
    seen(|seen| {
        seen.events
            .iter()
            .filter_map(|event| match event {
                v2::ScrollEvent::Landed { anchor, .. } => Some(anchor.id.clone()),
                v2::ScrollEvent::UserScroll { .. } => None,
            })
            .collect()
    })
}

fn cards(count: usize, rows: u16) -> Vec<(u16, u16)> {
    vec![(rows, rows); count]
}

#[test]
fn two_apps_on_a_thread_each_resolve_their_own_mounts() {
    let first = mount(6, 60, 16, false);
    let second = mount(6, 60, 16, false);
    let rows = Rows::new(&[false; 6]);
    first.dispatch("board.step", Some("1".into()));
    let frame = first.harness.app.render();
    assert_eq!(offset_shown(&frame.text(), &rows, 1), Some(3), "{}", frame.text());
    assert_eq!(frame, first.settle(), "the first app's frame was not settled");
    let frame = second.harness.app.render();
    assert_eq!(offset_shown(&frame.text(), &rows, 1), Some(0), "the second app moved:\n{}", frame.text());
    let stepped = first.settle();
    second.dispatch("board.step", Some("1".into()));
    let counts = behave::counts();
    let frame = second.harness.app.render();
    // The second app's own frame runs the behaviors, with its own hook.
    assert!(behave::counts().since(counts).resolves > 0, "the second app's frame ran no behaviors");
    assert_eq!(offset_shown(&frame.text(), &rows, 1), Some(3), "{}", frame.text());
    assert_eq!(frame, second.settle(), "the second app's frame was not settled");
    assert_eq!(frame, stepped, "the second app's frame differs from the first's");
    // The first app's mount goes; the second still resolves.
    drop(first);
    second.dispatch("board.step", Some("1".into()));
    let frame = second.harness.app.render();
    assert_eq!(frame, second.settle(), "the second app lost its hook");
}

#[test]
fn a_verb_of_a_closed_mount_is_dropped() {
    let board_view = mount(6, 60, 16, false);
    let tui = &board_view.harness.tui;
    let _ = tui.keymap.dispatch("board.to", Some("card-3"));
    tui.navigate(Route::Home);
    tui.navigate(Route::Plugin { id: "test.board".into(), name: "board".into() });
    board_view.harness.app.advance(Duration::ZERO);
    let screen = board_view.settle().text();
    assert_eq!(offset_shown(&screen, &Rows::new(&[false; 6]), 1), Some(0), "{screen}");
}

#[test]
fn layout_hears_the_first_frames_geometry() {
    let notify = vec![v2::Notify::Node { id: "txt".into() }];
    let harness = probe(Shape { notify, ..Shape::default() }, 48, 14);
    assert!(top_line(&harness).starts_with("geometry"));
    settled(&harness);
    let widths: Vec<i32> = seen(|seen| {
        seen.geometries.iter().filter_map(|geometry| geometry.rect("txt")).map(|rect| rect.width).collect()
    });
    assert!(!widths.is_empty() && widths.iter().all(|width| *width == 48), "told {widths:?}");
    assert!(!harness.app.needs_frame());
}

#[test]
fn a_layout_asking_again_finishes_without_another_event() {
    let notify = vec![v2::Notify::Node { id: "strip".into() }];
    let harness = probe(Shape { cards: cards(1, 1), notify, again_until: Some(4), ..Shape::default() }, 48, 14);
    let mut most = 0;
    for _ in 0..12 {
        let counts = behave::counts();
        harness.app.render();
        most = most.max(behave::counts().since(counts).resolves);
        if !harness.app.needs_frame() {
            break;
        }
    }
    assert!(top_line(&harness).starts_with("stage 4"), "{}", harness.app.render().text());
    let told = seen(|seen| seen.geometries.last().and_then(|geometry| geometry.rect("strip")));
    assert_eq!(told.map(|rect| rect.width), Some(14), "the last delivery was told an old rect");
    assert!(most <= u64::from(behave::ROUNDS), "a frame ran {most} rounds");
}

#[test]
fn a_failed_step_keeps_the_memory_of_the_last() {
    let harness = probe(Shape { cards: cards(24, 1), ..Shape::default() }, 40, 14);
    harness.app.render();
    for (name, input) in [("p.end", ""), ("p.step", "1"), ("p.step", "20"), ("p.step", "-1")] {
        dispatch(&harness, name, input);
        settled(&harness);
    }
    assert_eq!(landed(), ["c12", "c11"]);
}

#[test]
fn a_step_of_zero_moves_nothing() {
    let harness = probe(Shape { cards: cards(24, 1), ..Shape::default() }, 40, 14);
    harness.app.render();
    dispatch(&harness, "p.at", "5");
    let before = settled(&harness);
    dispatch(&harness, "p.step", "0");
    assert_eq!(settled(&harness), before);
    assert_eq!(landed(), Vec::<String>::new());
}

#[test]
fn layout_hears_where_each_to_ended() {
    let mut cards = cards(100, 3);
    cards[50] = (120, 3);
    let notify = vec![v2::Notify::Scroll { id: "s".into() }];
    let harness = probe(Shape { cards, list: true, notify, ..Shape::default() }, 40, 12);
    harness.app.render();
    let reached =
        || seen(|seen| seen.geometries.iter().flat_map(|geometry| geometry.reached.clone()).collect::<Vec<_>>());
    dispatch(&harness, "p.go", "r50.0");
    let frame = harness.app.render();
    assert!(frame.text().starts_with("r0050.0"), "{}", frame.text());
    let offset = seen(|seen| seen.geometries.last().and_then(|geometry| geometry.scroll("s"))).unwrap().offset;
    assert_eq!(reached(), [("s".to_owned(), offset)]);
    dispatch(&harness, "p.go", "r50.0");
    harness.app.render();
    assert_eq!(reached(), [("s".to_owned(), offset), ("s".to_owned(), offset)], "a `To` already there");
}

#[test]
fn layout_hears_an_anchors_variant() {
    let notify = vec![v2::Notify::Group { scroll: "s".into(), group: "g".into() }];
    let harness = probe(Shape { cards: cards(10, 2), notify, ..Shape::default() }, 40, 10);
    harness.app.render();
    let before = seen(|seen| seen.geometries.len());
    shape(|shape| shape.variant = "marked".into());
    dispatch(&harness, "p.view", "");
    harness.app.render();
    let variants = seen(|seen| {
        seen.geometries[before..]
            .iter()
            .flat_map(|geometry| geometry.groups.iter())
            .flat_map(|(_, _, anchors)| anchors.iter().map(|anchor| anchor.variant.clone()))
            .collect::<Vec<_>>()
    });
    assert!(!variants.is_empty() && variants.iter().all(|variant| variant == "marked"), "{variants:?}");
}

#[test]
fn views_that_change_nothing_named_call_no_layout() {
    let harness = probe(Shape { cards: cards(10, 2), twin: true, ..Shape::default() }, 40, 30);
    harness.app.render();
    let (before, views) = seen(|seen| (seen.geometries.len(), seen.views));
    for _ in 0..12 {
        dispatch(&harness, "p.view", "");
        harness.app.render();
    }
    assert_eq!(seen(|seen| seen.views) - views, 12, "the views did not run");
    assert_eq!(seen(|seen| seen.geometries.len()), before);
}

#[test]
fn a_sticky_nodes_pin_is_a_move_only() {
    let notify = vec![v2::Notify::Node { id: "h0".into() }];
    let harness = probe(Shape { cards: cards(4, 12), sticky: true, notify, ..Shape::default() }, 40, 8);
    harness.app.render();
    let before = seen(|seen| seen.geometries.len());
    for _ in 0..16 {
        harness.app.scroll(4, 4, true);
        harness.app.render();
    }
    let moved: Vec<bool> = seen(|seen| seen.geometries[before..].iter().map(|geometry| geometry.moved_only).collect());
    assert!(!moved.is_empty() && moved.iter().all(|moved| *moved), "{moved:?}");
}

#[test]
fn user_scroll_follows_the_tree_and_the_move() {
    let user =
        || seen(|seen| seen.events.iter().filter(|event| matches!(event, v2::ScrollEvent::UserScroll { .. })).count());
    let harness = probe(Shape { cards: cards(30, 1), ..Shape::default() }, 40, 10);
    harness.app.render();
    harness.app.scroll(4, 4, true);
    harness.app.advance(Duration::ZERO);
    harness.app.render();
    assert_eq!(user(), 0, "a scroll without `user_scroll`");
    shape(|shape| shape.user_scroll = true);
    dispatch(&harness, "p.view", "");
    harness.app.render();
    harness.app.scroll(4, 4, true);
    harness.app.advance(Duration::ZERO);
    harness.app.render();
    assert_eq!(user(), 1, "`user_scroll` turned on");
    let read = seen(|seen| seen.reads.last().copied().flatten()).map(|state| state.offset);
    assert!(read.is_some_and(|offset| offset > 0), "the handler read the offset before the move: {read:?}");
    dispatch(&harness, "p.at", "0");
    settled(&harness);
    harness.app.scroll(4, 4, false);
    harness.app.advance(Duration::ZERO);
    harness.app.render();
    assert_eq!(user(), 1, "a wheel at the top");
    // The scroll's keys, once it has the focus.
    harness.app.click(2, 2);
    harness.app.press("pagedown");
    harness.app.advance(Duration::ZERO);
    harness.app.render();
    assert_eq!(user(), 2, "a key that scrolled");
    shape(|shape| shape.user_scroll = false);
    dispatch(&harness, "p.view", "");
    harness.app.scroll(4, 4, true);
    harness.app.advance(Duration::ZERO);
    harness.app.render();
    assert_eq!(user(), 2, "`user_scroll` turned off");
}

#[test]
fn behaviors_past_the_rounds_finish_in_the_next_frame() {
    let harness = probe(Shape { cards: vec![(30, 1); 300], list: true, ..Shape::default() }, 40, 12);
    harness.app.render();
    dispatch(&harness, "p.go", "c250");
    let mut most = 0;
    for _ in 0..12 {
        let counts = behave::counts();
        harness.app.render();
        most = most.max(behave::counts().since(counts).resolves);
        if !harness.app.needs_frame() {
            break;
        }
    }
    assert!(top_line(&harness).starts_with("r0250.0"), "{}", harness.app.render().text());
    assert!(most <= u64::from(behave::ROUNDS), "a frame ran {most} rounds");
}

#[test]
fn a_jump_past_the_rounds_while_layout_asks_again_keeps_the_frames_bounds() {
    // The jump alone settles in the last round, which asks for the view; with a resize the rounds run out first.
    for (go, width) in [(250, None), (350, Some(30)), (700, Some(30))] {
        let cards: Vec<(u16, u16)> = (0..1000).map(|i| if i % 3 == 0 { (40, 2) } else { (2, 40) }).collect();
        let notify = vec![
            v2::Notify::Scroll { id: "s".into() },
            v2::Notify::Group { scroll: "s".into(), group: "g".into() },
            v2::Notify::Node { id: "strip".into() },
        ];
        let harness = probe(Shape { cards, list: true, notify, again_until: Some(1), ..Shape::default() }, 40, 50);
        settled(&harness);
        shape(|shape| shape.again_until = Some(2));
        let before = seen(|seen| seen.geometries.len());
        dispatch(&harness, "p.go", &format!("c{go}"));
        if let Some(width) = width {
            harness.app.resize(width, 50 - (go % 7) as u16);
        }
        let mut frames = Vec::new();
        while frames.len() < 40 {
            let counts = behave::counts();
            harness.app.render();
            let ran = behave::counts().since(counts);
            frames.push((ran.resolves, ran.layouts));
            assert!(ran.resolves <= u64::from(behave::ROUNDS), "c{go}: frames {frames:?}");
            assert!(ran.layouts <= u64::from(behave::DELIVERIES), "c{go}: frames {frames:?}");
            if !harness.app.needs_frame() {
                break;
            }
        }
        assert_eq!(frames[0].0, u64::from(behave::ROUNDS), "c{go}: the rounds did not run out: {frames:?}");
        let text = harness.app.render().text();
        let lines: Vec<&str> = text.lines().map(str::trim_end).collect();
        assert_eq!(lines[0], "stage 2", "c{go}: frames {frames:?}\n{text}");
        assert!(lines[1].starts_with(&format!("r0{go}.0")), "c{go}: frames {frames:?}\n{text}");
        // Once for the jump, settled, and once for the view it asked for, which moved only the strip.
        let told: Vec<_> = seen(|seen| {
            seen.geometries[before..]
                .iter()
                .map(|geometry| (geometry.scrolls.clone(), geometry.groups.clone()))
                .collect()
        });
        assert_eq!(told.len(), 2, "c{go}: frames {frames:?}");
        assert!(told[0] == told[1], "c{go}: `layout` was told what had not settled: {frames:?}");
    }
}

#[test]
fn a_list_keeps_the_card_at_the_top_when_one_above_grows() {
    let harness = probe(Shape { cards: cards(40, 2), list: true, ..Shape::default() }, 44, 12);
    harness.app.render();
    dispatch(&harness, "p.at", "12");
    assert!(top_line(&harness).starts_with("r0006.0"));
    shape(|shape| shape.cards[2] = (8, 8));
    dispatch(&harness, "p.view", "");
    assert!(top_line(&harness).starts_with("r0006.0"), "{}", harness.app.render().text());
}

#[test]
fn a_narrower_list_keeps_the_card_at_the_top() {
    let cards: Vec<(u16, u16)> = (0..180).map(|card| (1 + (card % 3) as u16, 3)).collect();
    let harness = probe(Shape { cards, list: true, wrap: true, ..Shape::default() }, 24, 12);
    harness.app.render();
    for card in (0..90).step_by(3) {
        dispatch(&harness, "p.go", &format!("c{card}"));
        harness.app.render();
    }
    dispatch(&harness, "p.go", "c87");
    assert!(top_line(&harness).starts_with("r0087.0"));
    harness.app.resize(14, 12);
    let first = top_line(&harness);
    assert!(first.starts_with("r0087"), "{}", harness.app.render().text());
    assert_eq!(top_line(&harness), first);
}

#[test]
fn an_offset_into_a_short_item_goes_its_rows_on() {
    let harness = probe(Shape { cards: vec![(2, 10); 100], list: true, ..Shape::default() }, 40, 12);
    settled(&harness);
    dispatch(&harness, "p.at", "300");
    let first = harness.app.render();
    assert_eq!(first.text().lines().next(), Some("r0042.0"), "{}", first.text());
    assert_eq!(first, settled(&harness));
}

#[test]
fn an_estimate_of_zero_is_a_row() {
    let before = reconcile::work();
    let harness = probe(Shape { cards: vec![(1, 0); 120], list: true, ..Shape::default() }, 40, 12);
    assert!(top_line(&harness).starts_with("r0000.0"), "{}", harness.app.render().text());
    let built = reconcile::work().since(before).created;
    assert!(built < 120, "the open built {built} widgets");
}

#[test]
fn a_list_whose_layout_changes_keeps_its_items() {
    let harness = probe(Shape { cards: cards(40, 2), list: true, memo: true, ..Shape::default() }, 44, 12);
    harness.app.render();
    dispatch(&harness, "p.at", "20");
    assert!(top_line(&harness).starts_with("r0010.0"));
    let before = reconcile::work();
    shape(|shape| shape.width = Some(26));
    dispatch(&harness, "p.view", "");
    let screen = harness.app.render().text();
    assert!(screen.starts_with("r0010.0") && screen.contains("r0011.1"), "{screen}");
    let done = reconcile::work().since(before);
    assert!(done.created < 4, "the items were built again: {done:?}");
}

#[test]
fn a_list_in_a_row_scrolls_sideways() {
    let harness = probe(Shape { cards: cards(30, 1), list: true, row: true, ..Shape::default() }, 40, 6);
    harness.app.render();
    dispatch(&harness, "p.at", "70");
    assert!(top_line(&harness).starts_with("r0010.0"), "{}", harness.app.render().text());
}

// Whole rows above 2^24 cannot be represented exactly by the layout engine's `f32` coordinates.
#[test]
fn a_list_past_two_to_the_twenty_four_rows_is_refused() {
    use reconcile::Refused;
    let host = plain();
    let item = |index: usize, estimate: u16| {
        v2::ListItem::new(text(format!("r{index}")).with_id(format!("c{index}")), estimate)
    };
    let list = |count: usize, estimate: u16| {
        v2::Node::list((0..count).map(|index| item(index, estimate)).collect()).with_id("l")
    };
    let mut tree = reconcile::Tree::default();
    assert_eq!(adopt(&host, &mut tree, &[list(300, u16::MAX)]), Err(Refused::Rows));
    adopt(&host, &mut tree, &[list(256, u16::MAX)]).unwrap();
}

#[test]
fn a_step_reaches_hunks_of_items_without_widgets() {
    let cards = vec![(1, 10); 10];
    let hunks = vec![(1, 250), (3, 5), (2, 5), (1, 5), (2, 5), (2, 5), (2, 5), (2, 5), (2, 5), (2, 5)];
    let harness = probe(Shape { cards, list: true, hunks, ..Shape::default() }, 60, 60);
    harness.app.render();
    // Each step puts its hunk's first row at the inset, in an item that had no widgets too.
    let rows = ["h1.0.0", "@@ -1001", "@@ -2001", "h2.0.0", "@@ -2001", "@@ -1001", "h1.0.0"];
    for (by, row) in ["1", "1", "1", "1", "-1", "-1", "-1"].into_iter().zip(rows) {
        dispatch(&harness, "p.hstep", by);
        let first = harness.app.render();
        assert_eq!(first, settled(&harness), "a step's first frame was not settled");
        let screen = first.text();
        assert!(screen.lines().nth(1).is_some_and(|line| line.contains(row)), "{row}:\n{screen}");
    }
    assert_eq!(landed(), ["d1#0", "d1#1", "d1#2", "d2#0", "d1#2", "d1#1", "d1#0"]);
    let screen = harness.app.render().text();
    assert!(screen.lines().nth(1).is_some_and(|line| line.contains("h1.0.0")), "{screen}");
}

#[test]
fn an_anchor_inside_an_item_stands_for_it_without_widgets() {
    let harness = probe(Shape { cards: cards(1000, 2), list: true, wrapped: true, ..Shape::default() }, 40, 12);
    harness.app.render();
    dispatch(&harness, "p.anchors", "");
    let anchors = seen(|seen| seen.anchors.clone());
    assert_eq!(anchors.len(), 1000);
    assert!(anchors.iter().enumerate().all(|(card, id)| *id == format!("c{card}")));
}

#[test]
fn a_hidden_card_is_no_anchor() {
    for list in [false, true] {
        let harness = probe(Shape { cards: cards(4, 3), list, hidden: Some(1), ..Shape::default() }, 40, 12);
        harness.app.render();
        dispatch(&harness, "p.anchors", "");
        assert_eq!(seen(|seen| seen.anchors.clone()), ["c0", "c2", "c3"], "list {list}");
        dispatch(&harness, "p.step", "1");
        settled(&harness);
        assert_eq!(landed(), ["c2"], "list {list}");
    }
}

/// The probe, as a harness the theme helpers take.
struct Probed {
    harness: support::Harness,
}

support::deref_harness!(Probed);

#[test]
fn a_layout_paint_takes_the_new_theme() {
    let notify = vec![v2::Notify::Scroll { id: "s".into() }];
    let paint = Some("background.raised.high".to_owned());
    let harness = probe(Shape { cards: cards(4, 2), notify, paint, ..Shape::default() }, 40, 10);
    harness.app.render();
    let layouts = seen(|seen| seen.geometries.len());
    switch_theme(&harness);
    let bg = harness.app.render().cell(0, 0).map(|cell| cell.bg);
    assert_eq!(bg, Some(harness.tui.page().background.raised.high));
    assert_eq!(seen(|seen| seen.geometries.len()), layouts);
    let open = || {
        let notify = vec![v2::Notify::Scroll { id: "s".into() }];
        let paint = Some("background.raised.high".to_owned());
        Probed { harness: probe(Shape { cards: cards(4, 2), notify, paint, ..Shape::default() }, 40, 10) }
    };
    support::assert_restyles_in_place(open, |_| {}, |screen| screen.contains("r0000.0"));
}

#[test]
fn a_boxs_own_background_ends_a_paint() {
    let notify = vec![v2::Notify::Scroll { id: "s".into() }];
    let paint = Some("background.raised.high".to_owned());
    let harness = probe(Shape { cards: cards(4, 2), notify, paint, ..Shape::default() }, 40, 10);
    let bg = |harness: &support::Harness| harness.app.render().cell(0, 0).map(|cell| cell.bg);
    let painted = bg(&harness);
    assert_eq!(painted, Some(harness.tui.page().background.raised.high));
    shape(|shape| shape.card_hidden = true);
    dispatch(&harness, "p.view", "");
    assert_eq!(bg(&harness), painted, "the box built again lost its paint");
    shape(|shape| {
        shape.paint = None;
        shape.card_bg = Some("background.raised.base".into());
    });
    dispatch(&harness, "p.view", "");
    assert_eq!(bg(&harness), Some(harness.tui.page().background.raised.base));
    // The paint is gone: a new theme shows the box's own background.
    switch_theme(&harness);
    assert_eq!(bg(&harness), Some(harness.tui.page().background.raised.base), "a new theme brought the paint back");
}

#[test]
fn a_draft_stays_through_its_items_eviction() {
    let harness = probe(Shape { cards: cards(200, 2), list: true, input: true, ..Shape::default() }, 40, 12);
    harness.app.render();
    harness.app.click(1, 2);
    harness.app.type_text("draft");
    harness.app.advance(Duration::ZERO);
    assert!(harness.app.render().text().contains("draft"));
    dispatch(&harness, "p.go", "c150");
    settled(&harness);
    dispatch(&harness, "p.go", "c0");
    let screen = settled(&harness).text();
    assert!(screen.contains("draft"), "{screen}");
}

#[test]
fn a_draft_goes_once_its_input_changes_or_goes_out_of_the_window() {
    for change in ["value", "input"] {
        let harness = probe(Shape { cards: cards(200, 2), list: true, input: true, ..Shape::default() }, 40, 12);
        harness.app.render();
        harness.app.click(1, 2);
        harness.app.type_text("draft");
        harness.app.advance(Duration::ZERO);
        assert!(harness.app.render().text().contains("draft"), "{change}");
        dispatch(&harness, "p.go", "c150");
        settled(&harness);
        match change {
            "value" => {
                shape(|shape| shape.input_value = "server".into());
                dispatch(&harness, "p.view", "");
            }
            _ => {
                shape(|shape| shape.input = false);
                dispatch(&harness, "p.view", "");
                shape(|shape| shape.input = true);
                dispatch(&harness, "p.view", "");
            }
        }
        dispatch(&harness, "p.go", "c0");
        let screen = settled(&harness).text();
        assert!(!screen.contains("draft"), "{change}: a stale draft came back:\n{screen}");
        assert_eq!(screen.contains("server"), change == "value", "{change}:\n{screen}");
        shape(|shape| shape.input_value.clear());
    }
}

// A large added file, kept or outside a scroll.

thread_local! {
    /// The big file is held with a memo, so later views keep it.
    static BIG_KEPT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    /// The big file is in a column, not a scroll.
    static BIG_BARE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

fn big_more_setup(setup: &mut abi::Setup) -> Result<(), String> {
    setup.surface(v2::Surface::new("big", v2::Place::Route("big".into()), |cx| {
        let diff = || {
            let lines: String = (0..5000).map(|line| format!("+line_{line}\n")).collect();
            v2::Node::diff(v2::Source::Text(format!("--- /dev/null\n+++ b/big.txt\n@@ -0,0 +1,5000 @@\n{lines}")))
                .with_id("big")
                .view(v2::DiffView::Unified)
        };
        let diff = if BIG_KEPT.get() { cx.memo("big", (), |_| diff()) } else { diff() };
        let grow = abi::Layout::default().grow();
        match BIG_BARE.get() {
            true => v2::Node::column(vec![diff]).layout(grow),
            false => v2::Node::column(vec![v2::Node::scroll(vec![diff]).with_id("files").layout(grow)]).layout(grow),
        }
    }));
    Ok(())
}

struct Big {
    harness: support::Harness,
}

support::deref_harness!(Big);

fn big(kept: bool, bare: bool, height: u16) -> Big {
    BIG_KEPT.set(kept);
    BIG_BARE.set(bare);
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.big", setup: big_more_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(60, height, deps);
    harness.tui.navigate(Route::Plugin { id: "test.big".into(), name: "big".into() });
    harness.app.advance(Duration::ZERO);
    harness.app.render();
    Big { harness }
}

fn switch_theme(harness: &support::Harness) {
    assert!(harness.tui.theme.borrow_mut().set("tokyonight"));
    harness.tui.theme_changed();
    harness.app.advance(Duration::from_millis(1));
}

#[test]
fn a_large_added_file_takes_a_theme_in_place() {
    for kept in [false, true] {
        let mounted = big(kept, false, 14);
        let before = reconcile::work();
        switch_theme(&mounted);
        let done = reconcile::work().since(before);
        assert_eq!((done.created, done.removed, done.parses), (0, 0, 0), "kept {kept}: {done:?}");
    }
    support::assert_restyles_in_place(|| big(true, false, 14), |_| {}, |screen| screen.contains("line_0"));
}

#[test]
fn a_large_added_file_outside_a_scroll_shows_every_line() {
    let mounted = big(false, true, 400);
    let screen = mounted.app.render().text();
    assert!(screen.contains("line_300"), "{screen}");
}

// The split's room, and the input's draft across a rebuild.

thread_local! {
    /// The split's `at`.
    static SPLIT_AT: std::cell::Cell<u16> = const { std::cell::Cell::new(10) };
    /// The split is the item of a list, which nothing reconciles again.
    static SPLIT_LISTED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

fn split_setup(setup: &mut abi::Setup) -> Result<(), String> {
    setup.surface(v2::Surface::new("split", v2::Place::Route("split".into()), |_| {
        let mut row = v2::Node::row(vec![text("LEFT".into()), text("RIGHT longer text".into())]).with_id("split");
        if let v2::Node::Box { split, .. } = &mut row {
            *split = Some(v2::Split { at: SPLIT_AT.get(), min: 3 });
        }
        match SPLIT_LISTED.get() {
            true => v2::Node::list(vec![v2::ListItem::new(row, 1)])
                .with_id("list")
                .layout(abi::Layout::default().grow().width(abi::Width::Percent(100.0))),
            false => row,
        }
    }));
    Ok(())
}

fn split(at: u16, width: u16, listed: bool) -> support::Harness {
    SPLIT_AT.set(at);
    SPLIT_LISTED.set(listed);
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.split", setup: split_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(width, 8, deps);
    harness.tui.navigate(Route::Plugin { id: "test.split".into(), name: "split".into() });
    harness.app.advance(Duration::ZERO);
    harness
}

#[test]
fn a_split_takes_its_width_in_its_first_frame() {
    let harness = split(10, 48, false);
    let screen = harness.app.render().text();
    assert_eq!(support::at(&screen, "RIGHT").map(|(x, _)| x), Some(10), "{screen}");
    drop(harness);
    let harness = probe(Shape { cards: cards(100, 1), list: true, split: true, ..Shape::default() }, 40, 10);
    harness.app.render();
    let views = seen(|seen| seen.views);
    let _ = harness.tui.keymap.dispatch("p.go", Some("c60"));
    harness.app.advance(Duration::ZERO);
    let screen = harness.app.render().text();
    assert_eq!(seen(|seen| seen.views), views + 1, "the jump's handler ran one view");
    assert_eq!(support::at(&screen, "RIGHT60").map(|(x, _)| x), Some(10), "{screen}");
}

#[test]
fn a_split_fits_its_room() {
    let harness = split(50, 40, false);
    harness.app.render();
    let screen = settled(&harness).text();
    assert_eq!(support::at(&screen, "RIG").map(|(x, _)| x), Some(36), "{screen}");
    harness.app.resize(80, 8);
    let screen = settled(&harness).text();
    assert_eq!(support::at(&screen, "RIG").map(|(x, _)| x), Some(50), "{screen}");
    let mut column = v2::Node::column(vec![text("a".into())]).with_id("s");
    if let v2::Node::Box { split, .. } = &mut column {
        *split = Some(v2::Split { at: 10, min: 3 });
    }
    let (host, mut tree) = (plain(), reconcile::Tree::default());
    assert_eq!(adopt(&host, &mut tree, &[column]), Err(reconcile::Refused::Split));
}

thread_local! {
    /// The input's width, and whether it is a field of many lines.
    static INPUT_SHAPE: std::cell::Cell<(u16, bool)> = const { std::cell::Cell::new((30, false)) };
}

fn input_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command::new(name).scope(abi::Scope::Route("input".into()));
    setup.command(command("in.view"), |_, _| {});
    setup.surface(v2::Surface::new("input", v2::Place::Route("input".into()), |_| {
        let (width, many) = INPUT_SHAPE.get();
        let input = v2::Node::Input {
            id: Some("name".into()),
            value: String::new(),
            placeholder: "name".into(),
            lines: many.then_some(3),
            layout: abi::Layout::default().width(abi::Width::Cells(width)),
            seen: None,
        };
        v2::Node::column(vec![input]).layout(abi::Layout::default().grow())
    }));
    Ok(())
}

#[test]
fn an_input_built_again_keeps_the_draft_and_the_focus() {
    INPUT_SHAPE.set((30, false));
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.input", setup: input_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(60, 10, deps);
    harness.tui.navigate(Route::Plugin { id: "test.input".into(), name: "input".into() });
    harness.app.advance(Duration::ZERO);
    let screen = harness.app.render().text();
    let (x, y) = support::at(&screen, "name").expect("the input shows");
    harness.app.click(x, y);
    harness.app.type_text("abc");
    for shape in [(20, false), (20, true)] {
        INPUT_SHAPE.set(shape);
        dispatch(&harness, "in.view", "");
        harness.app.render();
    }
    harness.app.type_text("d");
    harness.app.advance(Duration::ZERO);
    let screen = harness.app.render().text();
    assert!(screen.contains("abcd"), "{screen}");
}

// Images.

thread_local! {
    /// The content handles the images plugin gave, which its later views name again.
    static IMAGES: std::cell::Cell<Option<(v2::ContentRef, v2::ContentRef)>> = const { std::cell::Cell::new(None) };
}

fn images_setup(setup: &mut abi::Setup) -> Result<(), String> {
    setup.surface(v2::Surface::new("images", v2::Place::Route("images".into()), |cx| {
        let (png, huge) = match IMAGES.get() {
            Some(handles) => handles,
            None => {
                let handles = (cx.content(PNG.to_vec()), cx.content(huge_png()));
                IMAGES.set(Some(handles));
                handles
            }
        };
        let image = |id: &str, content| v2::Node::Image {
            id: Some(id.into()),
            content: v2::Source::Content(content),
            fit: v2::Fit::Contain,
            layout: abi::Layout::default().width(abi::Width::Cells(4)).height(abi::Width::Cells(2)),
        };
        v2::Node::column(vec![image("a", png), image("b", png), image("c", png), image("d", huge)])
    }));
    Ok(())
}

/// A PNG header that names 20,000 by 20,000 pixels, with nothing after it.
fn huge_png() -> Vec<u8> {
    let mut bytes = PNG[..16].to_vec();
    bytes.extend(20_000u32.to_be_bytes());
    bytes.extend(20_000u32.to_be_bytes());
    bytes
}

#[test]
fn images_of_one_content_decode_once() {
    IMAGES.set(None);
    let before = reconcile::work();
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.images", setup: images_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(40, 12, deps);
    harness.tui.navigate(Route::Plugin { id: "test.images".into(), name: "images".into() });
    harness.app.advance(Duration::ZERO);
    harness.app.render();
    assert_eq!(reconcile::work().since(before).parses, 1);
}

#[test]
fn a_tree_refuses_an_image_of_output_and_walks_its_lists_for_sources() {
    let (host, mut tree) = (plain(), reconcile::Tree::default());
    let image = v2::Node::Image {
        id: None,
        content: v2::Source::PartOutput(v2::PartRef { session: "s".into(), part: "p".into() }),
        fit: v2::Fit::Contain,
        layout: abi::Layout::default(),
    };
    assert_eq!(adopt(&host, &mut tree, &[image]), Err(reconcile::Refused::Output));
    let markdown = v2::Node::Markdown { id: Some("m".into()), source: v2::Source::Text("# x".into()) };
    let list = v2::Node::list(vec![v2::ListItem::new(v2::Node::column(vec![markdown]).with_id("i"), 1)]).with_id("l");
    adopt(&host, &mut tree, &[list]).unwrap();
    let mut sources = Vec::new();
    tree.each_source(&mut |source| sources.push(source.clone()));
    assert_eq!(sources, [v2::Source::Text("# x".into())]);
}

#[test]
fn layout_hears_the_messages_above_the_transcript() {
    let notify = vec![v2::Notify::Transcript];
    let harness = probe(Shape { cards: cards(2, 1), notify, ..Shape::default() }, 40, 10);
    let above = std::rc::Rc::new(std::cell::Cell::new(4u32));
    let read = above.clone();
    let _published = behave::publish_transcript(
        harness.app.app(),
        behave::Published {
            read: std::rc::Rc::new(move || v2::TranscriptView {
                offset: 0,
                viewport: 10,
                extent: 40,
                above: read.get(),
                ..Default::default()
            }),
            scroll: std::rc::Rc::new(|_| {}),
        },
    );
    behave::transcript_moved(harness.app.app());
    harness.app.render();
    above.set(9);
    behave::transcript_moved(harness.app.app());
    harness.app.render();
    let told =
        seen(|seen| seen.geometries.last().and_then(|geometry| geometry.transcript.as_ref().map(|view| view.above)));
    assert_eq!(told, Some(9));
}

#[test]
fn a_quiet_key_costs_nothing_and_a_wheel_step_the_same_at_any_size() {
    let work = |count: usize| {
        let harness = probe(Shape { cards: cards(count, 2), list: true, top: true, ..Shape::default() }, 40, 12);
        harness.app.render();
        dispatch(&harness, "p.at", &(count as i32).to_string());
        settled(&harness);
        let before = behave::counts();
        for _ in 0..10 {
            harness.app.press("f11");
            harness.app.render();
        }
        let keys = behave::counts().since(before);
        let before = behave::counts();
        for _ in 0..10 {
            harness.app.scroll(4, 4, false);
            settled(&harness);
        }
        (keys, behave::counts().since(before))
    };
    let ((small_keys, small_wheel), (large_keys, large_wheel)) = (work(410), work(4000));
    for keys in [small_keys, large_keys] {
        assert_eq!((keys.arms, keys.resolves, keys.visits), (0, 0, 0), "a quiet key: {keys:?}");
    }
    assert!(small_wheel.resolves > 0, "the wheel ran no behaviors: {small_wheel:?}");
    assert_eq!(small_wheel.visits, large_wheel.visits, "{small_wheel:?} {large_wheel:?}");
}

#[test]
fn a_panicking_layout_fails_its_plugin_and_leaves_the_behaviors() {
    let notify = vec![v2::Notify::Scroll { id: "s".into() }];
    let harness = probe(Shape { cards: cards(30, 1), notify, ..Shape::default() }, 40, 10);
    settled(&harness);
    shape(|shape| shape.panic_layout = true);
    harness.app.scroll(4, 4, true);
    harness.app.advance(Duration::ZERO);
    settled(&harness);
    let status =
        harness.tui.plugins.entries().into_iter().find(|entry| entry.id == "test.probe").map(|entry| entry.status);
    assert!(matches!(status, Some(opencode_plugin::Status::Failed(_))), "{status:?}");
    let (before, layouts) = (behave::counts(), seen(|seen| seen.geometries.len()));
    for _ in 0..5 {
        harness.app.press("f11");
        harness.app.scroll(4, 4, true);
        harness.app.advance(Duration::ZERO);
        settled(&harness);
    }
    let after = behave::counts().since(before);
    assert_eq!((after.resolves, seen(|seen| seen.geometries.len())), (0, layouts), "{after:?}");
}

#[test]
fn the_hook_stays_the_roots_last_child() {
    use opentui::prelude::*;
    let harness = probe(Shape { cards: cards(30, 1), list: true, ..Shape::default() }, 40, 10);
    settled(&harness);
    let before = behave::counts();
    let app = harness.app.app();
    let hook = app.root().children().last().map(|last| last.id());
    let late = View::new(app).absolute().width(1).height(1);
    opencode_ui::root::add(app, &late);
    for _ in 0..3 {
        harness.app.press("f11");
        harness.app.scroll(4, 4, true);
        dispatch(&harness, "p.at", "5");
        settled(&harness);
    }
    assert_eq!(app.root().children().last().map(|last| last.id()), hook, "a root child went in after the hook");
    let counts = behave::counts().since(before);
    assert!(counts.arms > 3, "{counts:?}");
    assert_eq!(counts.placed, 0, "the hook was put in its root again");
}

#[test]
fn a_handler_moves_the_transcript_for_the_users_scroll_only() {
    board(|board| board.transcript = true);
    let board_view = mount(6, 60, 16, false);
    let verbs: std::rc::Rc<RefCell<Vec<v2::Scroll>>> = std::rc::Rc::default();
    let recorded = verbs.clone();
    let _published = behave::publish_transcript(
        board_view.harness.app.app(),
        behave::Published {
            read: std::rc::Rc::new(|| v2::TranscriptView { offset: 7, viewport: 10, extent: 40, ..Default::default() }),
            scroll: std::rc::Rc::new(move |verb| recorded.borrow_mut().push(verb.clone())),
        },
    );
    board_view.dispatch("board.step", Some("1".into()));
    board_view.settle();
    assert!(board(|board| !board.landed.is_empty()), "the step landed nowhere");
    assert_eq!(*verbs.borrow(), [], "a landed step's handler moved the transcript");
    board_view.harness.app.scroll(10, 5, true);
    board_view.harness.app.advance(Duration::ZERO);
    board_view.settle();
    assert!(board(|board| board.user_scrolls > 0), "the wheel was not the user's scroll");
    assert_eq!(*verbs.borrow(), [v2::Scroll::By { rows: -2 }]);
}

thread_local! {
    /// What the `two` route's handler read: each user's scroll's offset, as the mount whose scroll moved reads it.
    static TWICE: RefCell<Vec<i64>> = RefCell::default();
}

/// A route of a list and an input; an input's submit brings row `r<text>` of its own mount's list to the top, and the
/// user's scroll reads its own list's offset.
fn twice_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let target = || v2::Target::node("two", "list");
    let surface = v2::Surface::new("two", v2::Place::Route("two".into()), |_| {
        let rows = (0..40).map(|row| text(format!("r{row}")).with_id(format!("r{row}"))).collect();
        let mut list = v2::Node::scroll(rows).with_id("list").layout(abi::Layout::default().grow());
        if let v2::Node::Scroll { user_scroll, .. } = &mut list {
            *user_scroll = true;
        }
        let input = v2::Node::Input {
            id: Some("say".into()),
            value: String::new(),
            placeholder: "say".into(),
            lines: None,
            layout: abi::Layout::default(),
            seen: None,
        };
        v2::Node::column(vec![input, list]).layout(abi::Layout::default().grow())
    })
    .on(move |host, event| {
        match event {
            Event::Submit { text, .. } => {
                host.scroll(target(), v2::Scroll::To { node: format!("r{text}"), align: v2::ScrollAlign::Start })
            }
            Event::Scroll { event: v2::ScrollEvent::UserScroll { .. } } => {
                let offset = host.scroll_state(&target()).map_or(-1, |state| i64::from(state.offset));
                TWICE.with(|twice| twice.borrow_mut().push(offset));
            }
            _ => {}
        }
        Handled::Pass
    });
    setup.surface(surface);
    Ok(())
}

/// The first row of each mount's list on screen: the left mount's, then the right one's.
fn tops(screen: &str) -> (String, String) {
    let top = |half: usize| {
        screen
            .lines()
            .filter_map(|line| {
                line.chars().skip(half * 40).take(40).collect::<String>().split_whitespace().next().map(str::to_owned)
            })
            .find(|word| word.starts_with('r') && word[1..].parse::<u32>().is_ok())
            .unwrap_or_default()
    };
    (top(0), top(1))
}

#[test]
fn an_event_acts_on_the_mount_it_came_from() {
    use opentui::prelude::*;
    TWICE.with(|twice| twice.borrow_mut().clear());
    let deps = Deps {
        route: Route::Home,
        builtins: vec![opencode_plugin::abi::Plugin { id: "test.twice", setup: twice_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(80, 16, deps);
    harness.app.advance(Duration::ZERO);
    let host = opencode_tui::plugins::host::host(&harness.tui);
    let app = harness.app.app();
    let frame = View::new(app).row().absolute().z_index(3000).width(80).height(12);
    let mounts: Vec<_> = (0..2)
        .map(|_| {
            let mount = harness.tui.plugins.route(&*host, "test.twice", "two").expect("the route mounts");
            let cell = View::new(app).column().width(40).height(12);
            cell.add(&mount.root());
            frame.add(&cell);
            mount
        })
        .collect();
    opencode_ui::root::add(app, &frame);
    let settle = || {
        for _ in 0..3 {
            harness.app.advance(Duration::from_millis(1));
            harness.app.render();
        }
        harness.app.render().text()
    };
    assert_eq!(tops(&settle()), ("r0".into(), "r0".into()));
    // Submit in the left mount, then in the right one.
    for (x, row, expected) in [(1, "5", ("r5", "r0")), (41, "9", ("r5", "r9"))] {
        harness.app.click(x, 0);
        harness.app.type_text(row);
        harness.app.press("enter");
        let screen = settle();
        assert_eq!(tops(&screen), (expected.0.into(), expected.1.into()), "{screen}");
    }
    // The user's scroll of the left list reads the left list's offset.
    harness.app.scroll(10, 6, true);
    settle();
    let read = TWICE.with(|twice| twice.borrow().clone());
    assert!(!read.is_empty() && read.iter().all(|offset| (5..9).contains(offset)), "read {read:?}");
    drop(mounts);
}

thread_local! {
    /// The model of `test.keyed`: each mount's draft, by the mount's generation, as the plugin keeps it.
    static DRAFTS: RefCell<std::collections::BTreeMap<u64, String>> = RefCell::default();
    /// The mounts `test.keyed`'s `layout` heard of.
    static LAID: RefCell<std::collections::BTreeSet<u64>> = RefCell::default();
}

/// A route of one input and the draft it shows, kept per mount: the handler finds the mount's draft by
/// `Read::mount`, the layout by `Geometry::mount`, and a mount's end drops its draft.
fn keyed_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let surface = v2::Surface::new("keyed", v2::Place::Route("keyed".into()), |cx| {
        let draft = DRAFTS.with(|drafts| drafts.borrow().get(&cx.mount.generation).cloned()).unwrap_or_default();
        let shown = text(format!("draft[{draft}]")).with_id("shown");
        v2::Node::column(vec![v2::Node::input(draft).with_id("say"), shown]).layout(abi::Layout::default().grow())
    })
    .mounts()
    .layout(vec![v2::Notify::Node { id: "say".into() }], |geometry| {
        if let Some(mount) = &geometry.mount {
            LAID.with(|laid| laid.borrow_mut().insert(mount.generation));
        }
        v2::LayoutReply::default()
    })
    .on(|host, event| {
        match (event, host.mount()) {
            (Event::Change { text, .. }, Some(mount)) => {
                DRAFTS.with(|drafts| drafts.borrow_mut().insert(mount.generation, text.clone()));
            }
            (Event::Mount { mount, mounted: false, .. }, _) => {
                DRAFTS.with(|drafts| drafts.borrow_mut().remove(&mount.generation));
            }
            _ => {}
        }
        Handled::Pass
    });
    setup.surface(surface);
    Ok(())
}

#[test]
fn a_handler_and_a_layout_name_the_mount_they_are_for() {
    use opentui::prelude::*;
    DRAFTS.with(|drafts| drafts.borrow_mut().clear());
    LAID.with(|laid| laid.borrow_mut().clear());
    let deps = Deps {
        route: Route::Home,
        builtins: vec![opencode_plugin::abi::Plugin { id: "test.keyed", setup: keyed_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount_still(80, 16, deps);
    harness.app.advance(Duration::ZERO);
    let host = opencode_tui::plugins::host::host(&harness.tui);
    let app = harness.app.app();
    let frame = View::new(app).row().absolute().z_index(3000).width(80).height(12);
    let cells: Vec<View> = (0..2).map(|_| View::new(app).column().width(40).height(12)).collect();
    cells.iter().for_each(|cell| {
        frame.add(cell);
    });
    let open = |cell: &View| {
        let mount = harness.tui.plugins.route(&*host, "test.keyed", "keyed").expect("the route mounts");
        cell.add(&mount.root());
        mount
    };
    let mut mounts: Vec<_> = cells.iter().map(open).collect();
    opencode_ui::root::add(app, &frame);
    let settle = || {
        for _ in 0..3 {
            harness.app.advance(Duration::from_millis(1));
            harness.app.render();
        }
        harness.app.render().text()
    };
    let drafts = || DRAFTS.with(|drafts| drafts.borrow().values().cloned().collect::<Vec<_>>());
    settle();
    for (x, typed) in [(1, "a"), (41, "b")] {
        harness.app.click(x, 0);
        harness.app.type_text(typed);
        settle();
    }
    let screen = settle();
    assert_eq!(drafts(), ["a", "b"], "the model\n{screen}");
    assert!(screen.contains("draft[a]") && screen.contains("draft[b]"), "{screen}");
    assert_eq!(LAID.with(|laid| laid.borrow().len()), 2, "the layout named one mount for both");
    // The left mount closes, and opens again as a new mount, which types its own draft.
    let closed = mounts.remove(0);
    closed.root().detach();
    drop(closed);
    settle();
    assert_eq!(drafts(), ["b"], "the closed mount kept its model");
    mounts.insert(0, open(&cells[0]));
    settle();
    harness.app.click(1, 0);
    harness.app.type_text("c");
    let screen = settle();
    assert_eq!(drafts(), ["b", "c"], "the model\n{screen}");
    assert!(screen.contains("draft[c]") && screen.contains("draft[b]"), "{screen}");
    drop(mounts);
}
