//! The host behaviors of P3 (synthesis 3.5, 4.2, 4.4, 4.14): `settled-first`, `scroll-step`, `scroll-keep`, and
//! `work` for a wheel step.
//!
//! A board plugin shows cards in a scroll: each a sticky header and a patch of two hunks, an anchor of group `file`,
//! its hunks anchors of group `hunk`; above the scroll an edge row that `layout` paints from the top card. Its
//! commands step between hunks, bring a card to the top, and mark a card reviewed (which folds it) keeping the
//! reading position.
//!
//! The oracles share no code with the host. Every content row of the board has a unique token, and the model knows
//! where each card and each hunk starts from its own arithmetic, so the offset a frame shows is read off its text:
//! the first body row below the sticky header names its content row. `scroll-step` replays the step rule (from the
//! last landed anchor while the offset stays, else from the first anchor past the inset) on those rows;
//! `scroll-keep` computes where the card at the top must stay; `settled-first` compares the first frame after each
//! event with the frame once the app wants no more.

use crate::support::{
    self,
    model::{self, Failure, Model, Rng},
};

use std::cell::RefCell;
use std::sync::Arc;
use std::time::Duration;

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
    /// What each `layout` call was told: the top card and whether only offsets moved.
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
    /// The edge's rect each `layout` call was told.
    edges: Vec<Option<v2::Rect>>,
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
    let command =
        |name: &str| abi::Command { name: name.into(), scope: abi::Scope::Route("board".into()), ..Default::default() };
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
        .layout(vec![v2::Notify::Node { id: "edge".into() }], |geometry| {
            let top = geometry.top("files", "file");
            board(|board| {
                board.layouts += 1;
                board.edges.push(geometry.rect("edge"));
                board.tops.push((top.map(|top| top.id.clone()), geometry.moved_only));
            });
            let reviewed = top.is_some_and(|top| top.variant == "reviewed");
            let reply =
                v2::LayoutReply::default().paint("edge", if reviewed { "background.raised.high" } else { "text.base" });
            v2::LayoutReply { again: board(|board| board.again), ..reply }
        })
        .on_scroll(|_, event| match event {
            v2::ScrollEvent::Landed { anchor, .. } => board(|board| board.landed.push(anchor.id.clone())),
            v2::ScrollEvent::UserScroll { .. } => board(|board| board.user_scrolls += 1),
        });
    setup.surface(surface);
    Ok(())
}

fn text(text: String) -> v2::Node {
    v2::Node::text(vec![abi::Span::new(text)])
}

fn card(cx: &mut v2::View<'_>, card: usize, reviewed: bool) -> v2::Node {
    cx.memo(format!("card-{card}"), reviewed, |_| {
        let head = v2::Node::row(vec![text(format!("file {card:04}"))])
            .with_id(format!("head-{card}"))
            .bg("background.raised.base")
            .sticky(v2::Edge::Top);
        let mut children = vec![head];
        if !reviewed {
            children.push(v2::Node::Diff {
                id: Some(format!("diff-{card}")),
                content: v2::Source::Text(patch(card)),
                view: v2::DiffView::Unified,
                filetype: None,
                hunks: Some("hunk".into()),
            });
        }
        v2::Node::column(children).anchor("file", if reviewed { "reviewed" } else { "" })
    })
}

fn view(cx: &mut v2::View<'_>) -> v2::Node {
    let (reviewed, list, quiet) = board(|board| {
        board.views += 1;
        (board.reviewed.clone(), board.list, board.quiet)
    });
    let grow = abi::Layout::default().grow();
    let files = if list {
        let items = reviewed
            .iter()
            .enumerate()
            .map(|(index, reviewed)| v2::ListItem::new(card(cx, index, *reviewed), if *reviewed { 1 } else { 8 }))
            .collect();
        v2::Node::list(items)
    } else {
        v2::Node::scroll(reviewed.iter().enumerate().map(|(index, reviewed)| card(cx, index, *reviewed)).collect())
    };
    let mut files = files.with_id("files").layout(grow).watched("file");
    if let v2::Node::Scroll { user_scroll, .. } | v2::Node::List { user_scroll, .. } = &mut files {
        *user_scroll = !quiet;
    }
    let (views, churn) = board(|board| (board.views, board.churn));
    let edge_height = abi::Layout::default().height(abi::Width::Cells(if churn { 1 + (views % 2) as u16 } else { 1 }));
    let edge =
        v2::Node::row(vec![text(if board(|board| board.again) { format!("edge {views}") } else { "edge".into() })])
            .with_id("edge")
            .layout(edge_height);
    v2::Node::column(vec![edge, files]).layout(grow)
}

struct Mounted {
    harness: support::Harness,
    /// The open's first frame, when it was not the settled one.
    unsettled: Option<String>,
}

fn mount(cards: usize, width: u16, height: u16, list: bool) -> Mounted {
    board(|board| {
        *board =
            Board { reviewed: vec![false; cards], list, quiet: board.quiet, again: board.again, ..Board::default() }
    });
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.board", setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(width, height, deps);
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
    Forget,
    /// `To` a node that is not in the tree.
    Gone,
    /// A resize and a step in one batch, with no frame between.
    Batch {
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
    fn step(&mut self, top: i32, by: i32, most: i32) -> Option<(String, i32)> {
        let hunks = self.rows().hunks();
        let inset = i32::from(INSET);
        let from = self
            .memory
            .take()
            .filter(|(_, left)| *left == top)
            .and_then(|(anchor, _)| hunks.iter().position(|(_, id)| *id == anchor));
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
                3..=5 => Command::Step(*rng.pick(&[1, 1, -1, 2, -2])),
                6 => Command::To(rng.below(CARDS)),
                7 | 8 => Command::Review(rng.below(CARDS)),
                9 => Command::Forget,
                10 => Command::Gone,
                11 => Command::Batch { height: 8 + rng.below(14) as u16, by: *rng.pick(&[1, -1]) },
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
        let board_view = mount(CARDS, width, height, self.list);
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
                    for _ in 0..*steps {
                        app.scroll(10, 5, *down);
                    }
                    oracle.memory = None;
                }
                Command::Resize { width, height } => {
                    app.resize(*width, *height);
                    oracle.viewport = i32::from(*height) - 1;
                }
                Command::Step(by) => {
                    let most = oracle.most();
                    let landing = oracle.step(top, *by, most);
                    expected = Some(landing.as_ref().map_or(top, |(_, target)| *target));
                    lands = landing.map(|(anchor, _)| anchor);
                    board_view.dispatch("board.step", Some(by.to_string()));
                }
                Command::Batch { height, by } => {
                    app.resize(width, *height);
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
                    expected = Some((top + rows).clamp(0, oracle.most()));
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
            let property = if matches!(command, Command::Review(_)) { "scroll-keep" } else { "scroll-step" };
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

// Expected (`settled-first`, `scroll-step`, `scroll-keep`; synthesis 4.14): over any sequence of wheel steps, resizes,
// hunk steps, jumps, folds that keep the reading position, forgets and verbs for a node that left, the first frame
// after each event is the settled one, a step lands where the step rule puts it (from the anchor it last landed on
// while the offset stays, also at a clamped end) and reports that anchor, and a fold keeps the card at the top where
// it was on screen where the clamp allows.
#[test]
fn behaviors_settle_in_the_first_frame_and_verbs_land_where_the_rules_say() {
    model::check(&Behaviors { list: false }, 16, 24);
}

// Expected: the same properties hold when the cards are a windowed list, whose items off screen have no widgets.
#[test]
fn a_windowed_list_keeps_the_same_rules() {
    model::check(&Behaviors { list: true }, 16, 24);
}

// Expected (the deep runs' rows, on both kinds): a step that reaches the end, in a batch with a resize, ends at the end
// of the new size (seed 17, 2,000 seeds); a step's memory ends once the offset moves, also when it comes back to the
// offset the step left (seed 7225, 10,000 seeds).
#[test]
fn the_deep_runs_rows_hold() {
    let rows = [
        vec![Command::Resize { width: 70, height: 17 }, Command::To(9), Command::Batch { height: 16, by: 1 }],
        vec![
            Command::To(8),
            Command::Resize { width: 52, height: 18 },
            Command::Batch { height: 12, by: 1 },
            Command::Resize { width: 78, height: 18 },
            Command::Step(1),
        ],
        // Seed 35 (2,000 seeds, O-115): `Nearest` for a card taller than the view below the header shows its top.
        vec![Command::Batch { height: 8, by: 1 }, Command::Near(3)],
    ];
    for list in [false, true] {
        for row in &rows {
            assert_eq!(Behaviors { list }.run(row), None, "list {list}: {row:?}");
        }
    }
}

// Expected (`scroll-step`, `Nearest`; `scrollIntoView` with `block: nearest`): under a view of 7 rows and a header of
// one, an 8-row card that covers the view stays; one above the top with its end inside, taller than the view, brings
// its end to the bottom.
#[test]
fn nearest_keeps_a_card_that_covers_the_view_and_aligns_a_tall_one_by_its_end() {
    let rows = [
        vec![Command::Resize { width: 60, height: 8 }, Command::To(2), Command::Near(2)],
        vec![Command::Resize { width: 60, height: 8 }, Command::To(2), Command::Page(50), Command::Near(2)],
    ];
    for list in [false, true] {
        for row in &rows {
            assert_eq!(Behaviors { list }.run(row), None, "list {list}: {row:?}");
        }
    }
}

// Fixed rows.

// Expected (synthesis 3.5, 4.4): the board's first frame shows the first card, its sticky header, and the edge
// `layout` painted; a step lands on the next hunk below the header in the frame of the key, and reports where it
// landed before the next event.
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
    // From the top, the first hunk past the inset is card 0's second hunk, at row 4: offset 3.
    assert_eq!(offset_shown(&screen, &rows, 1), Some(3), "{screen}");
    assert_eq!(board(|board| board.landed.clone()), ["diff-0#1"]);
    assert_eq!(first, board_view.settle(), "the step's first frame was not settled");
}

// Expected (synthesis 4.2, 4.4 step 5): `layout` hears the scroll's top card when it changes and not otherwise; a
// frame that only scrolls says `moved_only`, a fold does not; its paint shows in the frame of the event.
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
    // Folding the top card keeps it on top, now reviewed: the edge takes the reviewed color in that frame.
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

// Expected (`work`, synthesis 4.14): a wheel step calls at most one `layout`, touches no widget of a scroll's tree, and
// runs the behaviors once; a list mounts the items that come near the view, in one more round. A scroll that asks for the user's scroll events hears one a step,
// a handler, which one view of keeps follows (P1's rule: a view runs after the plugin's own handlers); one that does
// not runs no plugin code but `layout`. The counts are equal at 40 and at 410 cards.
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

// Expected (synthesis 3.4, P1's gate): a list of a thousand cards builds the few near the view; a jump to a card far
// below mounts it in the frame of the key, and a step goes on from there.
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

// Expected (`scroll-step`): `Forget` ends a step's memory, as new content asks; a verb for a node that has left the
// tree moves nothing and is dropped.
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
    let command =
        |name: &str| abi::Command { name: name.into(), scope: abi::Scope::Route("kinds".into()), ..Default::default() };
    setup.command(command("kinds.changed"), |_, input| kinds(|kinds| kinds.changes.push(input.unwrap_or("").into())));
    setup.command(command("kinds.submit"), |_, input| kinds(|kinds| kinds.submits.push(input.unwrap_or("").into())));
    setup.command(command("kinds.value"), |_, input| kinds(|kinds| kinds.value = input.unwrap_or("").into()));
    setup.command(command("kinds.code"), |_, input| kinds(|kinds| kinds.code = input.unwrap_or("").into()));
    setup.command(command("kinds.image"), |_, input| {
        kinds(|kinds| kinds.image = if input == Some("png") { PNG.to_vec() } else { b"junk".to_vec() })
    });
    setup.surface(v2::Surface::new("kinds", v2::Place::Route("kinds".into()), |cx| {
        let (value, code, image) = kinds(|kinds| (kinds.value.clone(), kinds.code.clone(), kinds.image.clone()));
        let image = cx.content(image);
        let input = v2::Node::Input {
            id: Some("name".into()),
            value,
            placeholder: "name".into(),
            lines: None,
            on_change: Some("kinds.changed".into()),
            on_submit: Some("kinds.submit".into()),
            layout: abi::Layout::default(),
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
    }));
    Ok(())
}

fn mount_kinds() -> support::Harness {
    kinds(|kinds| *kinds = Kinds { code: "fn main() {}".into(), image: PNG.to_vec(), ..Kinds::default() });
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.kinds", setup: kinds_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(60, 14, deps);
    harness.tui.navigate(Route::Plugin { id: "test.kinds".into(), name: "kinds".into() });
    harness.app.advance(Duration::ZERO);
    harness.app.render();
    harness
}

fn dispatch(harness: &support::Harness, name: &str, input: &str) {
    let _ = harness.tui.keymap.dispatch(name, Some(input));
    harness.app.advance(Duration::ZERO);
}

// Expected (synthesis 4.2, 4.13 rank 4): an input's text and cursor are the host's: typing runs its change command
// with the text, enter its submit command; a value the tree changes replaces the text, and a revision that keeps the
// value keeps what the user typed.
#[test]
fn an_input_runs_its_commands_and_keeps_what_the_user_typed() {
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
    // A revision that leaves the value as it was keeps the typed text.
    dispatch(&harness, "kinds.code", "fn other() {}");
    assert!(harness.app.render().text().contains("abc"), "the typed text went");
    dispatch(&harness, "kinds.value", "xyz");
    let screen = harness.app.render().text();
    assert!(screen.contains("xyz") && !screen.contains("abc"), "{screen}");
}

// Expected (synthesis 4.13 rank 12, 16): code shows with the host's grammars and line numbers and changes in place; an
// image decodes from content, and bytes that do not decode leave it empty without failing the plugin.
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

// Expected (synthesis 4.2, S1b's open drag): a split's first child is as wide as the user drags the column after it,
// within the minimum each side keeps, and keeps that width across a revision.
#[test]
fn a_split_follows_the_drag_and_keeps_its_width() {
    let harness = mount_kinds();
    let screen = harness.app.render().text();
    let (left, row) = support::at(&screen, "LEFT").expect("the split shows");
    let (right, _) = support::at(&screen, "RIGHT").unwrap();
    assert_eq!(right - left, 20, "{screen}");
    // The press lands on the handle over the boundary, not on the text beside it: the drag selects nothing (TS's
    // `PaneResizeHandle`).
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
    let command = |name: &str| abi::Command { name: name.into(), ..Default::default() };
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
    Ok(())
}

// Expected (decision 8, review big-boi 6): the transcript takes `By`, `Offset` and `Edge` from a handler of the user's
// input, and reads back what it publishes; a `Step` on it, a verb from a wake and one from a command the plugin
// dispatched itself are dropped.
#[test]
fn the_transcript_takes_three_verbs_from_a_handler_only() {
    let verbs: std::rc::Rc<RefCell<Vec<v2::Scroll>>> = std::rc::Rc::default();
    let recorded = verbs.clone();
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.transcript", setup: transcript_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(60, 14, deps);
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
    harness.app.advance(Duration::from_millis(5));
    assert_eq!(*verbs.borrow(), [v2::Scroll::By { rows: -3 }]);
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
        content: &|_| false,
        image: &|_| None,
        full: false,
        draw: None,
    };
    tree.apply(&env, &host.app.root(), nodes)
}

// Expected (synthesis 3.4, P3's list): an item is the unit of reconcile. Every item needs an id; a keep inside an
// item names a node of that item, and one outside a list names nothing inside it. Each such tree is refused whole.
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
    let command =
        |name: &str| abi::Command { name: name.into(), scope: abi::Scope::Route("big".into()), ..Default::default() };
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
        let diff = v2::Node::Diff {
            id: Some("big".into()),
            content: v2::Source::Text(patch),
            view: v2::DiffView::Unified,
            filetype: None,
            hunks: Some("hunk".into()),
        };
        v2::Node::column(vec![v2::Node::scroll(vec![diff]).with_id("files").layout(abi::Layout::default().grow())])
            .layout(abi::Layout::default().grow())
    }));
    Ok(())
}

// Expected (synthesis 3.5, review F7): a patch that adds a file of more than 3,000 lines mounts its chunks near the
// view after the solve, so a jump to its end or its middle shows those lines in the frame of the key.
#[test]
fn a_large_added_file_mounts_its_chunks_near_the_view() {
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.big", setup: big_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(60, 14, deps);
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

// Expected (synthesis 4.4 step 5): `layout` may ask for a view again; the view runs in the same frame and the frame
// shows it. Then `layout` is called again only when something it was told about changed.
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

// Expected (synthesis 4.4 step 5): `layout` gets at most two deliveries a frame. A third waits for the next frame and
// is not lost: there it is told that frame's geometry, the edge as the last view laid it out.
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
    /// Card 0 holds an input `in0`.
    input: bool,
    /// `layout` paints card 0 in this token.
    paint: Option<String>,
    /// Card 0's own background.
    card_bg: Option<String>,
    /// Card 0 hides what overflows it, which builds its box again and moves nothing.
    card_hidden: bool,
    /// Each card is a split row of `L{i}` and `RIGHT{i}`, the first 10 wide.
    split: bool,
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
    let command =
        |name: &str| abi::Command { name: name.into(), scope: abi::Scope::Route("probe".into()), ..Default::default() };
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
        .on_scroll(|host, event| {
            let read = host.scroll_state(&probe_target());
            seen(|seen| {
                seen.events.push(event.clone());
                seen.reads.push(read);
            });
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
        lines.push(v2::Node::Diff {
            id: Some(format!("{prefix}d{index}")),
            content: v2::Source::Text(hunky(index, hunks, size)),
            view: v2::DiffView::Unified,
            filetype: None,
            hunks: Some("h".into()),
        });
    }
    if shape.input && index == 0 {
        lines.push(v2::Node::input("").with_id(format!("{prefix}in0")));
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
            *notify_top = shape.twin.then(|| "g".to_owned());
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
    let harness = support::mount(width, height, deps);
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

// Expected (review carbon-1): two apps on one thread each resolve their own mounts; a verb from a handler in one
// moves that app's scroll, not the newest mount of the same surface in the other.
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
    second.dispatch("board.step", Some("1".into()));
    let frame = second.harness.app.render();
    assert_eq!(offset_shown(&frame.text(), &rows, 1), Some(3), "{}", frame.text());
    assert_eq!(frame, second.settle(), "the second app's frame was not settled");
    // The first app's mount goes; the second still resolves.
    drop(first);
    second.dispatch("board.step", Some("1".into()));
    let frame = second.harness.app.render();
    assert_eq!(frame, second.settle(), "the second app lost its hook");
}

// Expected (review big-boi 10): a verb belongs to the mount whose handler asked for it. When that mount closes
// before the verb applies, it is dropped; the surface opened again does not take it.
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

// Expected (review big-boi 1): `layout` is told the geometry of the frame it runs in; the first frame of a route's
// surface tells it the node's real width, with no later frame needed.
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

// Expected (review big-boi 4, carbon-2): `layout` that asks for a view again, each changing what it was told, gets
// every stage without another event: a delivery past a frame's cap comes in the next frame. No frame solves more
// than the rounds OpenTUI allows.
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

// Expected (review big-boi 5): a step that finds no anchor moves nothing and keeps the memory of the last step that
// landed, so the next step goes on from there.
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

// Expected (review carbon-3): a step of zero moves nothing and reports nothing.
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

// Expected (review big-boi 8, carbon-3): `layout` hears where each `To` ended, also one that ends in a round another
// change extends and one already where it goes.
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

// Expected (review big-boi 8): a group's anchors changing their variant in place is a change `layout` hears.
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

// Expected (review big-boi 8): what `layout` is told is compared in a stable order: views that change nothing it
// named call it no more, whatever order the host keeps two scrolls in.
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

// Expected (review carbon-7): a sticky node's rect is compared at its place in the content, not where its translate
// pins it: wheel steps over its card leave it where it is, and the steps past it only move it.
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

// Expected (review big-boi 9, carbon-7): `UserScroll` follows the scroll's current `user_scroll`, comes after the
// move (a read in the handler sees the new offset), and only for a move: a wheel at the top or a key at the end
// says nothing. The scroll's keys are the user's moves too.
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

// Expected (review big-boi 4): when a frame's rounds run out before the behaviors settle, the work goes on in the
// next frame, with no event: a jump into a list whose items are far taller than their estimates ends at its target.
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

// Expected (review big-boi 2): a list holds the reading position by itself. When an item above the top grows and its
// estimate follows, the card at the top stays there in the first frame.
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

// Expected (review big-boi 2): a narrower list keeps the card the reader looked at at the top, whatever the items
// above it measure at the new width.
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

// Expected (review big-boi 2, carbon-4): an estimate of 0 is taken as a row: the list opens at its first card and
// builds the few near the view.
#[test]
fn an_estimate_of_zero_is_a_row() {
    let before = reconcile::work();
    let harness = probe(Shape { cards: vec![(1, 0); 120], list: true, ..Shape::default() }, 40, 12);
    assert!(top_line(&harness).starts_with("r0000.0"), "{}", harness.app.render().text());
    let built = reconcile::work().since(before).created;
    assert!(built < 120, "the open built {built} widgets");
}

// Expected (review big-boi 3, carbon-4): a list whose layout changes keeps its items, also those the view keeps
// whole, their widgets, and the reading position.
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

// Expected (review carbon-4): the verbs and reads of a list in a row move and tell its horizontal offset.
#[test]
fn a_list_in_a_row_scrolls_sideways() {
    let harness = probe(Shape { cards: cards(30, 1), list: true, row: true, ..Shape::default() }, 40, 6);
    harness.app.render();
    dispatch(&harness, "p.at", "70");
    assert!(top_line(&harness).starts_with("r0010.0"), "{}", harness.app.render().text());
}

// Expected (review carbon-4): OpenTUI lays out in `f32`, exact for whole rows up to 2^24: a list whose estimates add
// up to more is refused, rather than a window that never settles failing the frame.
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

// Expected (review big-boi 5): a step reaches the hunks of items without widgets: past a file whose one hunk is
// taller than the window, to the next file's, and back.
#[test]
fn a_step_reaches_hunks_of_items_without_widgets() {
    let cards = vec![(1, 10); 10];
    let hunks = vec![(1, 250), (3, 5), (2, 5), (1, 5), (2, 5), (2, 5), (2, 5), (2, 5), (2, 5), (2, 5)];
    let harness = probe(Shape { cards, list: true, hunks, ..Shape::default() }, 60, 60);
    harness.app.render();
    for by in ["1", "1", "1", "1", "-1", "-1", "-1"] {
        dispatch(&harness, "p.hstep", by);
        let first = harness.app.render();
        assert_eq!(first, settled(&harness), "a step's first frame was not settled");
    }
    assert_eq!(landed(), ["d1#0", "d1#1", "d1#2", "d2#0", "d1#2", "d1#1", "d1#0"]);
    let screen = harness.app.render().text();
    assert!(screen.lines().nth(1).is_some_and(|line| line.contains("h1.0.0")), "{screen}");
}

// Expected (review big-boi 5): an anchor inside an item, under a box of its own, is an anchor while the item has no
// widgets.
#[test]
fn an_anchor_inside_an_item_stands_for_it_without_widgets() {
    let harness = probe(Shape { cards: cards(1000, 2), list: true, wrapped: true, ..Shape::default() }, 40, 12);
    harness.app.render();
    dispatch(&harness, "p.anchors", "");
    let anchors = seen(|seen| seen.anchors.clone());
    assert_eq!(anchors.len(), 1000);
    assert!(anchors.iter().enumerate().all(|(card, id)| *id == format!("c{card}")));
}

/// The probe, as a harness the theme helpers take.
struct Probed {
    harness: support::Harness,
}

support::deref_harness!(Probed);

// Expected (review big-boi 11, carbon-5): what `layout` painted is the mount's: a theme change paints it in the new
// theme, with no `layout` call, as a fresh mount in that theme does.
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

// Expected (review big-boi 11, carbon-5): a box built again keeps the paint `layout` gave it; a box whose own
// background changes takes it, and the paint goes.
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
}

// Expected (review big-boi 11): what the user typed into an input stays when its item leaves the window and comes back.
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
            v2::Node::Diff {
                id: Some("big".into()),
                content: v2::Source::Text(format!("--- /dev/null\n+++ b/big.txt\n@@ -0,0 +1,5000 @@\n{lines}")),
                view: v2::DiffView::Unified,
                filetype: None,
                hunks: None,
            }
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
    let harness = support::mount(60, height, deps);
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

// Expected (review carbon-5, synthesis 4.14 `work`): a theme change restyles a large added file in place: no widget
// built or dropped, no parse; as it does a file the view keeps whole, which shows as a fresh mount in the new theme
// does.
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

// Expected (review carbon-5): outside a scroll a large added file shows every line.
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
    let harness = support::mount(width, 8, deps);
    harness.tui.navigate(Route::Plugin { id: "test.split".into(), name: "split".into() });
    harness.app.advance(Duration::ZERO);
    harness
}

// Expected (review carbon-6): a split's first child takes `at` in the split's first frame: on a route, and in a list
// item that mounts as the list scrolls to it, with no view after.
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

// Expected (review big-boi 12, carbon-6): a split wider than its room keeps the second child and the handle inside
// it, and takes the width it wants back once there is room; a split that is not a row is refused.
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
    let command =
        |name: &str| abi::Command { name: name.into(), scope: abi::Scope::Route("input".into()), ..Default::default() };
    setup.command(command("in.view"), |_, _| {});
    setup.surface(v2::Surface::new("input", v2::Place::Route("input".into()), |_| {
        let (width, many) = INPUT_SHAPE.get();
        let input = v2::Node::Input {
            id: Some("name".into()),
            value: String::new(),
            placeholder: "name".into(),
            lines: many.then_some(3),
            on_change: None,
            on_submit: None,
            layout: abi::Layout::default().width(abi::Width::Cells(width)),
        };
        v2::Node::column(vec![input]).layout(abi::Layout::default().grow())
    }));
    Ok(())
}

// Expected (review big-boi 11): an input built again for a new layout or for many lines keeps what the user typed,
// and the focus, so typing goes on.
#[test]
fn an_input_built_again_keeps_the_draft_and_the_focus() {
    INPUT_SHAPE.set((30, false));
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.input", setup: input_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(60, 10, deps);
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

// Expected (review carbon-8, big-boi limits): nodes that show the same content share one decode, and an image whose
// header names more than the host decodes is never decoded; the decodes count as `work`.
#[test]
fn images_of_one_content_decode_once() {
    IMAGES.set(None);
    let before = reconcile::work();
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.images", setup: images_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(40, 12, deps);
    harness.tui.navigate(Route::Plugin { id: "test.images".into(), name: "images".into() });
    harness.app.advance(Duration::ZERO);
    harness.app.render();
    assert_eq!(reconcile::work().since(before).parses, 1);
}

// Expected (review big-boi 11, carbon-4): an image of a tool call's output is refused, as its text is no image; a
// list's items are walked for their sources.
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

// Expected (review big-boi 8): a published transcript's count of messages above its rows is part of what `layout` is
// told: a change of it alone calls it.
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
