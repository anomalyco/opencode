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
        .layout(Vec::new(), |geometry| {
            let top = geometry.top("files", "file");
            board(|board| {
                board.layouts += 1;
                board.tops.push((top.map(|top| top.id.clone()), geometry.moved_only));
            });
            let reviewed = top.is_some_and(|top| top.variant == "reviewed");
            v2::LayoutReply::default().paint("edge", if reviewed { "background.raised.high" } else { "text.base" })
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
    let edge = v2::Node::row(vec![text("edge".into())]).with_id("edge");
    v2::Node::column(vec![edge, files]).layout(grow)
}

struct Mounted {
    harness: support::Harness,
    /// The open's first frame, when it was not the settled one.
    unsettled: Option<String>,
}

fn mount(cards: usize, width: u16, height: u16, list: bool) -> Mounted {
    board(|board| *board = Board { reviewed: vec![false; cards], list, quiet: board.quiet, ..Board::default() });
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

    /// Where a step of `by` from `top` lands, and the offset it leaves; `None` when no anchor is there.
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
            .map(|_| match rng.below(12) {
                0 | 1 => Command::Wheel { down: rng.below(3) > 0, steps: 1 + rng.below(3) as u8 },
                2 => Command::Resize { width: 40 + rng.below(40) as u16, height: 8 + rng.below(14) as u16 },
                3..=5 => Command::Step(*rng.pick(&[1, 1, -1, 2, -2])),
                6 => Command::To(rng.below(CARDS)),
                7 | 8 => Command::Review(rng.below(CARDS)),
                9 => Command::Forget,
                10 => Command::Gone,
                _ => Command::Batch { height: 8 + rng.below(14) as u16, by: *rng.pick(&[1, -1]) },
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
                    // The step resolves against the last settled frame; the solve then clamps to the new size.
                    let landing = oracle.step(top, *by, most);
                    expected = Some(landing.as_ref().map_or(top, |(_, target)| *target).min(oracle.most()));
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
    harness.app.drag((left + 20, row), (left + 32, row));
    let screen = harness.app.render().text();
    assert_eq!(support::at(&screen, "RIGHT").map(|(x, _)| x - left), Some(32), "{screen}");
    harness.app.drag((left + 32, row), (left + 1, row));
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
    setup.command(command("tx.wake"), |_, _| {
        WAKER.with(|waker| waker.borrow().as_ref().map(|waker| waker.wake()));
    });
    // A wake is not the user's input: a verb from it would fight the wheel.
    setup.on_wake(|host| host.scroll(v2::Target::Transcript, v2::Scroll::By { rows: 9 }));
    Ok(())
}

// Expected (decision 8): the transcript takes `By`, `Offset` and `Edge` from a handler, and reads back what it
// publishes; a `Step` on it and a verb from a wake are dropped.
#[test]
fn the_transcript_takes_three_verbs_from_a_handler_only() {
    let verbs: std::rc::Rc<RefCell<Vec<v2::Scroll>>> = std::rc::Rc::default();
    let recorded = verbs.clone();
    let _published = behave::publish_transcript(behave::Published {
        read: std::rc::Rc::new(|| v2::TranscriptView { offset: 7, viewport: 10, extent: 40, ..Default::default() }),
        scroll: std::rc::Rc::new(move |verb| recorded.borrow_mut().push(verb.clone())),
    });
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.transcript", setup: transcript_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(60, 14, deps);
    harness.app.render();
    for name in ["tx.by", "tx.step", "tx.wake"] {
        let _ = harness.tui.keymap.dispatch(name, None);
        harness.app.advance(Duration::from_millis(1));
        harness.app.render();
    }
    harness.app.advance(Duration::from_millis(5));
    assert_eq!(*verbs.borrow(), [v2::Scroll::By { rows: -3 }]);
    assert_eq!(READ.with(|read| read.borrow().clone()), [7]);
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
        bytes: &|_| None,
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
    let host = Plain {
        app: opentui::testing::TestApp::new(40, 10),
        keymap: opencode_ui::dialog::DialogKeymap::new(
            opencode_ui::keymap::Keybinds::defaults(),
            opencode_ui::keymap::Options::default(),
        ),
        theme: opencode_ui::theme::Catalog::default()
            .load("opencode", opencode_ui::theme::ThemeMode::Dark)
            .unwrap()
            .theme,
    };
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
