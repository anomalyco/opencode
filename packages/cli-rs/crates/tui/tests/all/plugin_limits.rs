//! Limits on host work (synthesis 4.2, 4.14 `limits`; phase Pl), in the real TUI, linked and through the C ABI's byte
//! shims.
//!
//! The test plugin `test.limits` has a route whose view returns the row's tree; `test.sibling` shows a few rows in the
//! `app` slot below every route, a surface beside it. Each row shows a tree at a limit and one past it. The oracle is
//! a twin: the same TUI with every limit lifted ([`support::unlimited`]) showing the tree the contract says, written
//! here: at a limit the tree itself, past it the tree with the one node that crosses replaced by its placeholder, a
//! muted row that says why. The frames are compared cell by cell, with their styles, the whole screen, so the
//! sibling's rows are in it. Beside the frames: the placeholders, parses and decodes the host's counters saw, and what
//! the host holds for the plugin, against counts the test makes from the tree.

use crate::plugin_surface::{CARRIERS, Carrier, builtin};
use crate::support::{self, Harness};

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use opencode_plugin::abi::{self, v2};
use opencode_plugin::limits::{self, Limits};
use opencode_plugin::reconcile;
use opencode_tui::{Deps, Route};

const ID: &str = "test.limits";
const SIBLING: &str = "test.sibling";

/// What a view returns, given the view to give content through.
type Subject = Rc<dyn Fn(&mut v2::View) -> v2::Node>;

thread_local! {
    static SUBJECT: RefCell<Subject> = RefCell::new(Rc::new(|_| v2::Node::text(vec![abi::Span::new("empty")])));
    static BESIDE: RefCell<Subject> = RefCell::new(Rc::new(|_| v2::Node::text(vec![abi::Span::new("sibling")])));
    /// The route's views, as the plugin counts them.
    static VIEWS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    setup.surface(v2::Surface::new("tree", v2::Place::Route("tree".into()), |cx| {
        VIEWS.with(|views| views.set(views.get() + 1));
        let subject = SUBJECT.with(|subject| subject.borrow().clone());
        subject(cx)
    }));
    // Its waker draws its mounts again, for the rows that change the tree in one mount.
    WAKE_ROUTE.with(|waker| *waker.borrow_mut() = setup.waker());
    // P2's surfaces show the same tree: a panel and an overlay, which its commands open and close.
    let view = |cx: &mut v2::View<'_>| {
        let subject = SUBJECT.with(|subject| subject.borrow().clone());
        subject(cx)
    };
    setup.surface(v2::Surface::new("side", v2::Place::Panel("side".into()), view));
    setup.surface(v2::Surface::new("pop", v2::Place::Overlay("pop".into()), view));
    let command = |name: &str| abi::Command { name: name.to_owned(), ..abi::Command::default() };
    setup.command(command("limits.panel"), |host, _| {
        host.open_panel(abi::interact::OpenPanel { surface: "side".into(), session: None, fullscreen: true });
    });
    setup.command(command("limits.overlay"), |host, _| {
        let anchor = abi::interact::Anchor::Point { x: 0, y: 0 };
        host.overlay(abi::interact::Overlay { surface: "pop".into(), anchor, width: 60, height: 28 });
    });
    setup.command(command("limits.close"), |host, _| {
        host.close_panel("side");
        host.close_overlay("pop");
    });
    setup.command(command("limits.anchors"), |host, _| {
        let anchors = host.anchors(&v2::Target::node("tree", "l"), "h");
        ANCHORS.with(|seen| *seen.borrow_mut() = anchors.into_iter().map(|anchor| anchor.id).collect());
    });
    Ok(())
}

thread_local! {
    /// The anchors of group `h` in the route's list `l`, as `limits.anchors` last asked for them.
    static ANCHORS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

thread_local! {
    /// The sibling's waker: a wake draws its surface again.
    static WAKER: RefCell<Option<abi::Waker>> = const { RefCell::new(None) };
}

fn sibling(setup: &mut abi::Setup) -> Result<(), String> {
    setup.surface(v2::Surface::new("beside", v2::Place::Slot(abi::Placement::append("app")), |cx| {
        let beside = BESIDE.with(|beside| beside.borrow().clone());
        beside(cx)
    }));
    WAKER.with(|waker| *waker.borrow_mut() = setup.waker());
    Ok(())
}

fn open(carrier: Carrier) -> Harness {
    let deps = Deps {
        route: Route::Home,
        builtins: vec![
            builtin(carrier, abi::Plugin { id: ID, setup }),
            builtin(carrier, abi::Plugin { id: SIBLING, setup: sibling }),
        ],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(100, 30, deps);
    settle(&harness);
    harness
}

fn settle(harness: &Harness) {
    harness.app.advance(Duration::from_millis(1));
    harness.app.render();
    harness.app.advance(Duration::from_millis(1));
}

/// Opens the route afresh on `subject`: a new mount, whose first view returns it.
fn show(harness: &Harness, subject: Subject) -> opentui::native::Capture {
    SUBJECT.with(|slot| *slot.borrow_mut() = subject);
    harness.tui.navigate(Route::Home);
    settle(harness);
    harness.tui.navigate(Route::Plugin { id: ID.to_owned(), name: "tree".to_owned() });
    settle(harness);
    harness.app.render()
}

fn text(text: &str) -> v2::Node {
    v2::Node::text(vec![abi::Span::new(text)])
}

/// A head row, `middle`, and a foot row.
fn framed(middle: v2::Node) -> v2::Node {
    v2::Node::column(vec![text("head"), middle, text("foot")])
}

/// The placeholder the contract puts in place of a node over a limit: one muted row that says why, under its id.
fn placeholder(id: Option<&str>, why: &str) -> v2::Node {
    let mut node = text(&format!("⋯ {why}"));
    if let v2::Node::Text { id: own, fg, selectable, .. } = &mut node {
        *own = id.map(str::to_owned);
        *fg = Some(abi::Color::from("text.muted"));
        *selectable = false;
    }
    node
}

/// A patch of one hunk that changes `lines` lines.
fn modified(lines: usize) -> String {
    let mut patch = format!("--- a/f.rs\n+++ b/f.rs\n@@ -1,{lines} +1,{lines} @@\n");
    for line in 0..lines {
        patch.push_str(&format!(" line {line}\n"));
    }
    patch
}

/// A patch of `hunks` hunks of one changed line each.
fn hunks(hunks: usize) -> String {
    let mut patch = "--- a/f.rs\n+++ b/f.rs\n".to_owned();
    for hunk in 0..hunks {
        let at = hunk * 10 + 1;
        patch.push_str(&format!("@@ -{at} +{at} @@\n-old {hunk}\n+new {hunk}\n"));
    }
    patch
}

fn source(text: String) -> v2::Source {
    v2::Source::Text(text)
}

/// The limits of the rows: small, so a tree at each of them is quick to build; any limit holds the same way.
fn small() -> Limits {
    Limits {
        nodes: 40,
        rows: 100,
        text: 200,
        hunks: 3,
        image_bytes: 4096,
        image_side: 16,
        plugin_nodes: 1000,
        all_nodes: 2000,
        plugin_content: 300,
        all_content: 1000,
        plugin_images: 16 * 16 * 4,
        all_images: 1 << 20,
        frame_rows: u64::MAX,
    }
}

/// A row: its limits, the tree the view returns, the tree the contract says shows, and what the host counts.
struct Row {
    name: &'static str,
    limits: Limits,
    subject: Subject,
    shows: Subject,
    placeholders: u64,
    /// The patches parsed and the code highlighted, as the subject opens.
    parses: u64,
    /// The nodes the host holds for the plugin.
    nodes: u64,
    /// The content bytes it holds for the plugin.
    content: u64,
}

fn subject(f: impl Fn(&mut v2::View) -> v2::Node + 'static) -> Subject {
    Rc::new(f)
}

fn rows() -> Vec<Row> {
    let texts = |count: usize| v2::Node::column((0..count).map(|index| text(&format!("t{index}"))).collect());
    let mut texts_over = (0..37).map(|index| text(&format!("t{index}"))).collect::<Vec<_>>();
    texts_over.push(placeholder(None, "too many nodes"));
    let line = |bytes: usize| text(&"x".repeat(bytes));
    let code_at_limit = 4 + 2 * 47 + rust_lines(47).len() as u64 / 1024;
    vec![
        // Nodes: a column, a head, a box of 36 texts and a foot are 40.
        Row {
            name: "nodes at the limit",
            limits: small(),
            subject: subject(move |_| framed(texts(36))),
            shows: subject(move |_| framed(texts(36))),
            placeholders: 0,
            parses: 0,
            nodes: 40,
            content: 0,
        },
        // One more: the box fits whole and the foot crosses.
        Row {
            name: "nodes one over",
            limits: small(),
            subject: subject(move |_| framed(texts(37))),
            shows: subject(move |_| {
                v2::Node::column(vec![text("head"), texts(37), placeholder(None, "too many nodes")])
            }),
            placeholders: 1,
            parses: 0,
            nodes: 40,
            content: 0,
        },
        // Many more: the box is opened and its 38th text crosses, standing for the texts after it; the foot crosses
        // too, in its own run of siblings.
        Row {
            name: "nodes far over",
            limits: small(),
            subject: subject(move |_| framed(texts(60))),
            shows: {
                let texts_over = texts_over.clone();
                subject(move |_| {
                    v2::Node::column(vec![
                        text("head"),
                        v2::Node::column(texts_over.clone()),
                        placeholder(None, "too many nodes"),
                    ])
                })
            },
            placeholders: 2,
            parses: 0,
            nodes: 40,
            content: 0,
        },
        // Rows: the column, the head, the foot and the patch itself are 4, its 66 lines (63 and 3 of headers) 66, and
        // its hunk 30: 100.
        Row {
            name: "rows at the limit",
            limits: Limits { text: 1 << 20, ..small() },
            subject: subject(|_| framed(v2::Node::diff(source(modified(63))))),
            shows: subject(|_| framed(v2::Node::diff(source(modified(63))))),
            placeholders: 0,
            parses: 1,
            nodes: 4,
            content: 0,
        },
        Row {
            name: "rows over",
            limits: Limits { text: 1 << 20, ..small() },
            subject: subject(|_| framed(v2::Node::diff(source(modified(80))))),
            shows: subject(|_| framed(placeholder(None, "too large to build at once"))),
            placeholders: 1,
            parses: 0,
            nodes: 3,
            content: 0,
        },
        Row {
            name: "text at the limit",
            limits: small(),
            subject: subject(move |_| framed(line(200))),
            shows: subject(move |_| framed(line(200))),
            placeholders: 0,
            parses: 0,
            nodes: 4,
            content: 0,
        },
        Row {
            name: "text over",
            limits: small(),
            subject: subject(move |_| framed(line(201).with_id("long"))),
            shows: subject(|_| framed(placeholder(Some("long"), "too large: 201 bytes"))),
            placeholders: 1,
            parses: 0,
            nodes: 4,
            content: 0,
        },
        Row {
            name: "hunks at the limit",
            limits: Limits { rows: 10_000, ..small() },
            subject: subject(|_| framed(v2::Node::diff(source(hunks(3))))),
            shows: subject(|_| framed(v2::Node::diff(source(hunks(3))))),
            placeholders: 0,
            parses: 1,
            nodes: 4,
            content: 0,
        },
        Row {
            name: "hunks over",
            limits: Limits { rows: 10_000, ..small() },
            subject: subject(|_| framed(v2::Node::diff(source(hunks(4))))),
            shows: subject(|_| framed(placeholder(None, "too large: 4 hunks"))),
            placeholders: 1,
            parses: 0,
            nodes: 4,
            content: 0,
        },
        // Content: 300 bytes is the plugin's share; one byte more is not kept, and its node is a placeholder.
        Row {
            name: "content at the limit",
            limits: Limits { text: 1 << 20, ..small() },
            subject: subject(|cx| {
                let handle = given(cx, || "y".repeat(300).into_bytes());
                framed(code(v2::Source::Content(handle)))
            }),
            shows: subject(|_| framed(code(source("y".repeat(300))))),
            placeholders: 0,
            parses: 1,
            nodes: 4,
            content: 300,
        },
        Row {
            name: "content over",
            limits: Limits { text: 1 << 20, ..small() },
            subject: subject(|cx| {
                let handle = given(cx, || "y".repeat(301).into_bytes());
                framed(code(v2::Source::Content(handle)))
            }),
            shows: subject(|_| framed(placeholder(None, "its content is past what the plugin may hold"))),
            placeholders: 1,
            parses: 0,
            nodes: 4,
            content: 0,
        },
        // Code: a line is two rows, and a KiB of its text one. The column, the head, the foot and the code itself are
        // 4, and 47 lines 94 and a row a KiB: the limit; 48 lines are past it.
        Row {
            name: "code at the limit",
            limits: Limits { text: 1 << 20, rows: code_at_limit, ..small() },
            subject: subject(|_| framed(code(source(rust_lines(47))))),
            shows: subject(|_| framed(code(source(rust_lines(47))))),
            placeholders: 0,
            parses: 1,
            nodes: 4,
            content: 0,
        },
        Row {
            name: "code over",
            limits: Limits { text: 1 << 20, rows: code_at_limit, ..small() },
            subject: subject(|_| framed(code(source(rust_lines(49))))),
            shows: subject(|_| framed(placeholder(None, "too large to build at once"))),
            placeholders: 1,
            parses: 0,
            nodes: 3,
            content: 0,
        },
        // A list's item data builds no rows: 50 items and 50 texts after them are 54 rows, 104 nodes.
        Row {
            name: "list data builds no rows",
            limits: Limits { nodes: 1_000, ..small() },
            subject: subject(move |_| {
                let items = (0..50)
                    .map(|index| v2::ListItem {
                        node: text(&format!("i{index}")).with_id(format!("i{index}")),
                        estimate: 1,
                    })
                    .collect();
                v2::Node::column(vec![text("head"), v2::Node::list(items).with_id("list"), texts(50)])
            }),
            shows: subject(move |_| {
                let items = (0..50)
                    .map(|index| v2::ListItem {
                        node: text(&format!("i{index}")).with_id(format!("i{index}")),
                        estimate: 1,
                    })
                    .collect();
                v2::Node::column(vec![text("head"), v2::Node::list(items).with_id("list"), texts(50)])
            }),
            placeholders: 0,
            parses: 0,
            nodes: 104,
            content: 0,
        },
    ]
}

thread_local! {
    /// The content the route's mount was given, by its generation: a plugin keeps its handle.
    static GIVEN: RefCell<Option<(u64, v2::ContentRef)>> = const { RefCell::new(None) };
}

/// The handle of `bytes`, given once a mount.
fn given(cx: &mut v2::View, bytes: impl FnOnce() -> Vec<u8>) -> v2::ContentRef {
    let generation = cx.mount.generation;
    if let Some((mount, handle)) = GIVEN.with(|given| *given.borrow())
        && mount == generation
    {
        return handle;
    }
    let handle = cx.content(bytes());
    GIVEN.with(|given| *given.borrow_mut() = Some((generation, handle)));
    handle
}

fn code(content: v2::Source) -> v2::Node {
    v2::Node::Code { id: None, content, filetype: None, numbers: false, layout: abi::Layout::default() }
}

// Expected (`limits`, 4.2): a tree at each limit shows as it is; one past it shows the one node that crosses as its
// placeholder and the rest of the tree, and the sibling surface, as they are. The host builds and parses nothing of
// what a placeholder stands for, and holds what it shows. On both carriers.
#[test]
fn a_tree_at_each_limit_shows_and_one_over_shows_its_placeholder() {
    for carrier in CARRIERS {
        let harness = open(carrier);
        for row in rows() {
            let (frame, work, held, views) = {
                let _limits = limits::set(row.limits);
                let (before, views) = (reconcile::work(), VIEWS.with(std::cell::Cell::get));
                let frame = show(&harness, row.subject.clone());
                (frame, reconcile::work().since(before), limits::held(ID), VIEWS.with(std::cell::Cell::get) - views)
            };
            let twin = {
                let _limits = support::unlimited();
                show(&harness, row.shows.clone())
            };
            let name = format!("{carrier:?}, {}", row.name);
            assert!(frame.cells == twin.cells, "{name}: not the twin's frame\n{}\n---\n{}", frame.text(), twin.text());
            // Each view's tree is a revision, which adopts its placeholders; a patch or code is parsed once.
            assert_eq!(work.placeholders, row.placeholders * views, "{name}: placeholders in {views} views");
            assert_eq!(work.parses, row.parses, "{name}: parses");
            assert_eq!((held.nodes, held.content), (row.nodes, row.content), "{name}: held");
        }
        // Nothing is held once the route is gone.
        harness.tui.navigate(Route::Home);
        settle(&harness);
        assert_eq!(limits::held(ID), limits::Held::default(), "{carrier:?}: held after the route closed");
    }
}

// Expected (`limits`, 4.2): a list over the tree's nodes is opened and its items admitted in turn: the one that crosses
// is a placeholder under its key and stands for the items after it, which are not the list's; on both carriers.
#[test]
fn a_list_over_its_nodes_keeps_the_items_that_fit() {
    let item =
        |index: usize| v2::ListItem { node: text(&format!("item {index}")).with_id(format!("i{index}")), estimate: 1 };
    let list = |items: Vec<v2::ListItem>| v2::Node::list(items).with_id("list");
    for carrier in CARRIERS {
        let harness = open(carrier);
        let (frame, held) = {
            let _limits = limits::set(small());
            let frame = show(&harness, subject(move |_| framed(list((0..60).map(item).collect()))));
            (frame, limits::held(ID))
        };
        let twin = {
            let _limits = support::unlimited();
            show(
                &harness,
                subject(move |_| {
                    let mut items: Vec<v2::ListItem> = (0..37).map(item).collect();
                    items.push(v2::ListItem { node: placeholder(Some("i37"), "too many nodes"), estimate: 1 });
                    v2::Node::column(vec![text("head"), list(items), placeholder(None, "too many nodes")])
                }),
            )
        };
        assert!(frame.cells == twin.cells, "{carrier:?}: not the twin's frame\n{}\n---\n{}", frame.text(), twin.text());
        assert_eq!(held.nodes, 40, "{carrier:?}");
    }
}

// Expected (`limits`, 4.2: "per plugin and in total"): a plugin holds at most its own share of nodes, and all plugins
// together at most the total: a second plugin cannot spend what the first left. The share it has is the least of its
// own and what the other plugins left of the total; on both carriers.
#[test]
fn a_plugin_spends_its_own_share_of_what_all_plugins_may_hold() {
    let texts = |count: usize| v2::Node::column((0..count).map(|index| text(&format!("t{index}"))).collect());
    for carrier in CARRIERS {
        let harness = open(carrier);
        // The host's own plugins hold nodes too: all plugins may hold 14 beside what they hold on the page.
        let others = || limits::total().nodes - limits::held(ID).nodes - limits::held(SIBLING).nodes;
        let shares = |others: u64| Limits { nodes: 100, plugin_nodes: 10, all_nodes: others + 14, ..small() };
        for (beside, admitted) in [(1, 9), (6, 6)] {
            // The sibling's next view is a column of `beside` texts; its waker draws it, with the route closed.
            harness.tui.navigate(Route::Home);
            settle(&harness);
            let _limits = limits::set(shares(others()));
            BESIDE.with(|slot| *slot.borrow_mut() = subject(move |_| texts(beside)));
            WAKER.with(|waker| waker.borrow().as_ref().expect("the sibling's waker").wake());
            settle(&harness);
            let screen = harness.app.render().text();
            assert_eq!(
                limits::held(SIBLING).nodes,
                beside as u64 + 1,
                "{carrier:?}: the sibling holds its column\n{screen}"
            );
            // On the route, beside what the host's own plugins hold there.
            show(&harness, subject(|_| text("route")));
            let on_route = others();
            let _limits = limits::set(shares(on_route));
            let frame = show(&harness, subject(move |_| texts(12)));
            let held = (limits::held(ID).nodes, limits::total().nodes - on_route);
            let twin = {
                let _unlimited = support::unlimited();
                show(
                    &harness,
                    subject(move |_| {
                        let mut kept: Vec<v2::Node> = (0..admitted).map(|index| text(&format!("t{index}"))).collect();
                        kept.push(placeholder(None, "too many nodes"));
                        v2::Node::column(kept)
                    }),
                )
            };
            let (shown, wanted) = (frame.text(), twin.text());
            assert!(frame.cells == twin.cells, "{carrier:?}, {beside}: not the twin's frame\n{shown}\n---\n{wanted}");
            let own = admitted as u64 + 1;
            assert_eq!(held, (own, own + beside as u64 + 1), "{carrier:?}, {beside}: held by the plugin and by all");
        }
    }
}

/// A PNG of `width` by `height` pixels of `pixel`, stored without compression.
fn png(width: u32, height: u32, pixel: impl Fn(u32, u32) -> [u8; 4]) -> Vec<u8> {
    fn chunk(out: &mut Vec<u8>, kind: &[u8], data: &[u8]) {
        out.extend((data.len() as u32).to_be_bytes());
        let mut checked = kind.to_vec();
        checked.extend(data);
        let mut crc = !0u32;
        for byte in &checked {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = if crc & 1 != 0 { (crc >> 1) ^ 0xedb8_8320 } else { crc >> 1 };
            }
        }
        out.extend(&checked);
        out.extend((!crc).to_be_bytes());
    }
    let mut raw = Vec::new();
    for y in 0..height {
        raw.push(0);
        for x in 0..width {
            raw.extend(pixel(x, y));
        }
    }
    let mut zlib = vec![0x78, 0x01];
    let blocks: Vec<&[u8]> = raw.chunks(65_535).collect();
    for (index, block) in blocks.iter().enumerate() {
        zlib.push(u8::from(index + 1 == blocks.len()));
        let length = block.len() as u16;
        zlib.extend(length.to_le_bytes());
        zlib.extend((!length).to_le_bytes());
        zlib.extend(*block);
    }
    let (mut a, mut b) = (1u32, 0u32);
    for byte in &raw {
        a = (a + u32::from(*byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    zlib.extend(((b << 16) | a).to_be_bytes());
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let header: Vec<u8> = [width.to_be_bytes(), height.to_be_bytes()].concat();
    chunk(&mut out, b"IHDR", &[header, vec![8, 6, 0, 0, 0]].concat());
    chunk(&mut out, b"IDAT", &zlib);
    chunk(&mut out, b"IEND", &[]);
    out
}

/// An image node 16 cells wide and 8 high.
fn image(content: v2::Source) -> v2::Node {
    let size = |cells| Some(abi::Width::Cells(cells));
    let layout = abi::Layout { width: size(16), height: size(8), ..abi::Layout::default() };
    v2::Node::Image { id: None, content, fit: v2::Fit::Contain, layout }
}

/// An image of the content `bytes`, given once a mount, over a foot row.
fn picture(bytes: Vec<u8>) -> Subject {
    let bytes = Rc::new(bytes);
    subject(move |cx| {
        let bytes = bytes.clone();
        let content = v2::Source::Content(given(cx, move || (*bytes).clone()));
        v2::Node::column(vec![image(content), text("foot")])
    })
}

/// The cells OpenTUI draws for `bytes` decoded in the frame, in an image view of 16 by 8 cells at the top left.
fn drawn_in_the_frame(bytes: &[u8]) -> Vec<opentui::native::Cell> {
    use opentui::prelude::*;
    let app = opentui::testing::TestApp::new(16, 8);
    let view = opentui::widget::ImageView::new(&app).load(bytes).unwrap().width(16).height(8);
    app.root().add(&view);
    app.render().cells
}

/// The cells of `frame` at the top left, 16 by 8.
fn corner(frame: &opentui::native::Capture) -> Vec<opentui::native::Cell> {
    (0..8).flat_map(|y| (0..16).map(move |x| (x, y))).map(|(x, y)| frame.cell(x, y).unwrap().clone()).collect()
}

// Expected (`limits`, 4.2): an image is admitted by its header and decodes on a worker, and the host only copies its
// pixels in: once the worker is done, the frame shows what OpenTUI draws for the same bytes decoded in the frame. One
// past the pixels of an image, or past the decoded bytes its plugin may hold, shows the placeholder, the rest of the
// tree as it is, and is never decoded; on both carriers.
#[test]
fn images_decode_on_a_worker_within_their_limits() {
    let gradient = |x: u32, y: u32| [(x * 15) as u8, (y * 15) as u8, ((x + y) * 7) as u8, 255];
    for carrier in CARRIERS {
        let harness = open(carrier);
        let base = Limits { plugin_content: 1 << 20, all_content: 1 << 20, ..small() };
        let _limits = limits::set(base);
        let bytes = png(16, 16, gradient);
        let expected = drawn_in_the_frame(&bytes);
        let before = reconcile::work();
        show(&harness, picture(bytes));
        let decoded = harness.app.wait_until(Duration::from_secs(10), || corner(&harness.app.render()) == expected);
        assert!(decoded, "{carrier:?}: the image never showed as OpenTUI draws it\n{}", harness.app.render().text());
        assert_eq!(reconcile::work().since(before).parses, 1, "{carrier:?}: one decode");
        assert_eq!(limits::held(ID).images, 16 * 16 * 4, "{carrier:?}: the decoded bytes are held");
        // Two images of 16 by 16 are twice what the plugin may hold decoded: the second is over.
        let (first, second) = (Rc::new(png(16, 16, gradient)), Rc::new(png(16, 16, |x, y| gradient(y, x))));
        let two = subject(move |cx| {
            let (first, second) = (first.clone(), second.clone());
            let one = given(cx, move || (*first).clone());
            let other = cx.content((*second).clone());
            v2::Node::column(vec![image(v2::Source::Content(one)), image(v2::Source::Content(other)), text("foot")])
        });
        // One pixel row past the side of an image, a row of 17 pixels (review bigboi 9), and one byte past an
        // image's encoded bytes, each with room in the plugin's share; two images past its share.
        let roomy = Limits { plugin_images: 1 << 20, ..base };
        let encoded = png(16, 16, gradient);
        let one_short = Limits { image_bytes: encoded.len() as u64 - 1, ..roomy };
        let cases = [
            ("pixels", picture(png(16, 17, gradient)), 0, roomy),
            ("a row", picture(png(17, 1, gradient)), 0, roomy),
            ("bytes", picture(encoded), 0, one_short),
            ("share", two, 1, base),
        ];
        for (name, subject, decodes, case) in cases {
            let _limits = limits::set(case);
            let before = reconcile::work();
            let frame = show(&harness, subject);
            let text = frame.text();
            let lines: Vec<&str> = text.lines().map(str::trim).collect();
            assert!(lines.contains(&"⋯ image too large"), "{carrier:?}, {name}: no placeholder\n{text}");
            assert!(lines.contains(&"foot"), "{carrier:?}, {name}: the rest of the tree is gone\n{text}");
            assert_eq!(reconcile::work().since(before).parses, decodes, "{carrier:?}, {name}: decodes");
        }
        harness.tui.navigate(Route::Home);
        settle(&harness);
        // A job holds what it reserved until it ends.
        assert!(harness.app.wait_until(Duration::from_secs(10), || opencode_plugin::image::jobs(ID) == 0));
        assert_eq!(limits::held(ID).images, 0, "{carrier:?}: decoded bytes held after the route closed");
    }
}

/// The median of `samples`, in milliseconds.
fn median(mut samples: Vec<Duration>) -> f64 {
    samples.sort_unstable();
    samples[samples.len() / 2].as_secs_f64() * 1e3
}

/// Rust-like lines to highlight.
fn rust_lines(lines: usize) -> String {
    (0..lines).map(|line| format!("    let value_{line} = compute({line}, \"text\") + {line};\n")).collect()
}

/// A patch of `lines` lines in hunks of ten: three context lines, two removed, two added, three context.
fn realistic(lines: usize) -> String {
    let mut patch = "--- a/f.rs\n+++ b/f.rs\n".to_owned();
    for hunk in 0..lines.div_ceil(10) {
        let at = hunk * 20 + 1;
        patch.push_str(&format!("@@ -{at},8 +{at},8 @@\n"));
        for line in 0..3 {
            patch.push_str(&format!("     let a_{hunk}_{line} = {line};\n"));
        }
        patch
            .push_str(&format!("-    old_{hunk}(1);\n-    old_{hunk}(2);\n+    new_{hunk}(1);\n+    new_{hunk}(2);\n"));
        for line in 0..3 {
            patch.push_str(&format!("     let b_{hunk}_{line} = {line};\n"));
        }
    }
    patch
}

// The measurements Pl's limits are set from (`steps/plugins-pl.md`): what the host's UI thread spends on a plugin's
// tree as it opens (its host time) and on the first frame that shows it, for trees of texts, patches, code and
// Markdown, a list's item data, and images decoded in the frame against on a worker. Release, TestApp 200x58 with its
// frame check off, five runs a size, medians:
// `cargo test --release -p opencode-tui --test all plugin_limits::probe -- --ignored --nocapture`.
#[test]
#[ignore]
fn probe() {
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: ID, setup }.into(), abi::Plugin { id: SIBLING, setup: sibling }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(200, 58, deps);
    harness.app.set_verify(false);
    settle(&harness);
    let _limits = support::unlimited();
    let monitor = harness.tui.plugins.monitor().clone();
    let route = Route::Plugin { id: ID.to_owned(), name: "tree".to_owned() };
    let measure = |kind: &str, size: usize, subject: Subject| {
        let (mut hosts, mut frames) = (Vec::new(), Vec::new());
        for _ in 0..5 {
            SUBJECT.with(|slot| *slot.borrow_mut() = subject.clone());
            harness.tui.navigate(Route::Home);
            settle(&harness);
            let host = monitor.host_time(ID);
            harness.tui.navigate(route.clone());
            // The route's first view runs in the turn's deferred work, and the host adopts its tree.
            harness.app.advance(Duration::ZERO);
            hosts.push(monitor.host_time(ID) - host);
            let begun = Instant::now();
            harness.app.present().unwrap();
            frames.push(begun.elapsed());
        }
        println!("probe {kind} {size} host {:.2} frame {:.2}", median(hosts), median(frames));
    };
    // `PROBE=texts,hunks` runs those parts alone.
    let parts = std::env::var("PROBE").unwrap_or_default();
    let want = |part: &str| parts.is_empty() || parts.split(',').any(|known| known == part);
    if want("long") {
        for kib in [64, 256, 1_024] {
            let line = "word ".repeat(kib * 1024 / 5);
            measure("one text, KiB", kib, subject(move |_| text(&line)));
        }
    }
    if want("hunks") {
        for count in [100, 200, 400, 800] {
            let patch = hunks(count);
            measure("diff hunks", count, subject(move |_| v2::Node::diff(source(patch.clone()))));
        }
    }
    if !want("rest") {
        return;
    }
    for count in [1_000, 2_000, 4_000, 8_000, 16_000] {
        let rows: Vec<v2::Node> = (0..count).map(|index| text(&format!("row {index}"))).collect();
        measure("texts", count, subject(move |_| v2::Node::column(rows.clone())));
    }
    for count in [1_000, 2_000, 4_000] {
        let boxes: Vec<v2::Node> =
            (0..count / 2).map(|index| v2::Node::row(vec![text(&format!("row {index}"))])).collect();
        measure("boxed texts", count, subject(move |_| v2::Node::column(boxes.clone())));
    }
    for lines in [500, 1_000, 2_000, 4_000, 8_000] {
        let patch = realistic(lines);
        let diff = move || v2::Node::Diff {
            id: None,
            content: source(patch.clone()),
            view: v2::DiffView::Unified,
            filetype: Some("rust".into()),
            hunks: None,
        };
        measure("diff", lines, subject(move |_| diff()));
    }
    for lines in [1_000, 2_000, 4_000, 8_000] {
        let code = rust_lines(lines);
        measure(
            "code",
            lines,
            subject(move |_| v2::Node::Code {
                id: None,
                content: source(code.clone()),
                filetype: Some("rust".into()),
                numbers: true,
                layout: abi::Layout::default(),
            }),
        );
    }
    for lines in [1_000, 2_000, 4_000] {
        let markdown: String =
            (0..lines).map(|line| format!("Paragraph {line} with *some* `code` in it.\n\n")).collect();
        measure("markdown", lines, subject(move |_| v2::Node::Markdown { id: None, source: source(markdown.clone()) }));
    }
    for items in [5_000, 10_000, 20_000, 40_000] {
        let list: Vec<v2::ListItem> = (0..items)
            .map(|index| v2::ListItem {
                node: v2::Node::row(vec![text(&format!("item {index}"))]).with_id(format!("i{index}")),
                estimate: 1,
            })
            .collect();
        measure("list nodes", items * 2, subject(move |_| v2::Node::list(list.clone()).with_id("list")));
    }
    for side in [256u32, 512, 1_024, 2_048, 4_096] {
        let bytes = png(side, side, |x, y| [(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8, 255]);
        let mut frame = Vec::new();
        for _ in 0..3 {
            let begun = Instant::now();
            let image = opentui::native::Image::decode(harness.app.session().context(), &bytes).unwrap();
            frame.push(begun.elapsed());
            drop(image);
        }
        let expected = drawn_in_the_frame(&bytes);
        let (mut hosts, mut walls) = (Vec::new(), Vec::new());
        for _ in 0..3 {
            harness.tui.navigate(Route::Home);
            settle(&harness);
            let host = monitor.host_time(ID);
            let begun = Instant::now();
            show(&harness, picture(bytes.clone()));
            let ready = harness.app.wait_until(Duration::from_secs(60), || corner(&harness.app.render()) == expected);
            assert!(ready, "{side}: never decoded");
            walls.push(begun.elapsed());
            hosts.push(monitor.host_time(ID) - host);
        }
        println!(
            "probe image {side} decode-in-frame {:.2} worker-to-shown {:.2} host {:.2} bytes {}",
            median(frame),
            median(walls),
            median(hosts),
            bytes.len()
        );
    }
}

/// Opens P2's surface `command` afresh on `subject`, on Home: a new mount, whose first view returns it.
fn show_in(harness: &Harness, command: &str, subject: Subject) -> opentui::native::Capture {
    SUBJECT.with(|slot| *slot.borrow_mut() = subject);
    harness.tui.keymap.dispatch("limits.close", None);
    settle(harness);
    harness.tui.keymap.dispatch(command, None);
    settle(harness);
    harness.app.render()
}

// Expected (`limits`, P2's surfaces): a panel's and an overlay's trees are held to the limits a route's is: one past
// a limit shows the node that crosses as its placeholder and the rest as it is, and the host holds what it shows; on
// both carriers.
#[test]
fn panels_and_overlays_are_held_to_the_limits() {
    let texts = |count: usize| v2::Node::column((0..count).map(|index| text(&format!("t{index}"))).collect());
    for carrier in CARRIERS {
        // A panel opens beside a session that shows.
        let deps = Deps {
            builtins: vec![
                builtin(carrier, abi::Plugin { id: ID, setup }),
                builtin(carrier, abi::Plugin { id: SIBLING, setup: sibling }),
            ],
            ..support::deps(Arc::new(support::Fake::new(|seen| support::base(seen, support::DIRECTORY))))
        };
        let harness = support::mount(100, 30, deps);
        settle(&harness);
        for command in ["limits.panel", "limits.overlay"] {
            let (frame, held) = {
                let _limits = limits::set(Limits { nodes: 12, ..small() });
                let frame = show_in(&harness, command, subject(move |_| framed(texts(9))));
                (frame, limits::held(ID).nodes)
            };
            let twin = {
                let _limits = support::unlimited();
                let shows = move |_: &mut v2::View<'_>| {
                    v2::Node::column(vec![text("head"), texts(9), placeholder(None, "too many nodes")])
                };
                show_in(&harness, command, subject(shows))
            };
            let (shown, wanted) = (frame.text(), twin.text());
            assert!(frame.cells == twin.cells, "{carrier:?}, {command}: not the twin's frame\n{shown}\n---\n{wanted}");
            assert!(shown.contains("⋯ too many nodes"), "{carrier:?}, {command}: no placeholder\n{shown}");
            assert_eq!(held, 12, "{carrier:?}, {command}: held");
        }
        harness.tui.keymap.dispatch("limits.close", None);
        settle(&harness);
        assert_eq!(limits::held(ID).nodes, 0, "{carrier:?}: held once they closed");
    }
}

/// A tree at the client's limits ([`Limits::default`]) with `extra` texts more: a column of a chain of 62 boxes around
/// a text (64 layout levels, the deepest a tree may nest), a list of 8,500 items of a box and a text, then 2,935 texts
/// and the extra ones. So it builds 3,000 rows at once and holds 20,000 nodes, and an extra text is the last to cross.
fn at_the_limits(extra: usize) -> v2::Node {
    let mut chain = text("deepest");
    for _ in 0..62 {
        chain = v2::Node::column(vec![chain]);
    }
    let items = (0..8_500)
        .map(|index| v2::ListItem {
            node: v2::Node::row(vec![text(&format!("item {index}"))]).with_id(format!("i{index}")),
            estimate: 1,
        })
        .collect();
    let mut children = vec![chain, v2::Node::list(items).with_id("list")];
    children.extend((0..2_935 + extra).map(|index| text(&format!("t{index}"))));
    v2::Node::column(children)
}

// Expected (`limits`, 4.2): a tree at every limit of the client at once (its rows, its nodes and its depth) is
// adopted whole and its frame renders: no plugin tree reaches OpenTUI's layout limits. One text more shows that text's
// placeholder, and nothing else changes; on the linked carrier, on a thread with the UI thread's stack.
#[test]
fn a_tree_at_the_clients_limits_renders() {
    let run = std::thread::Builder::new().stack_size(8 << 20).spawn(|| {
        let harness = open(Carrier::Linked);
        let before = reconcile::work();
        let tree = Rc::new(at_the_limits(0));
        show(&harness, subject(move |_| (*tree).clone()));
        assert!(harness.app.try_render().is_ok(), "the frame at the limits failed");
        assert_eq!(reconcile::work().since(before).placeholders, 0, "a placeholder at the limits");
        assert_eq!(limits::held(ID).nodes, 20_000);
        let over = Rc::new(at_the_limits(1));
        show(&harness, subject(move |_| (*over).clone()));
        let frame = caught_up(&harness);
        // The placeholder costs nothing.
        assert_eq!(limits::held(ID).nodes, 20_000, "held past the limits");
        let twin = {
            let _limits = support::unlimited();
            let mut expected = at_the_limits(0);
            if let v2::Node::Box { children, .. } = &mut expected {
                children.push(placeholder(None, "too large to build at once"));
            }
            let expected = Rc::new(expected);
            show(&harness, subject(move |_| (*expected).clone()))
        };
        assert!(frame.cells == twin.cells, "not the twin's frame\n{}\n---\n{}", frame.text(), twin.text());
    });
    run.unwrap().join().unwrap();
}

/// Paints frames until no revision or list item waits for a frame's rows, and returns the last.
fn caught_up(harness: &Harness) -> opentui::native::Capture {
    for _ in 0..100 {
        let before = reconcile::work().deferred;
        let frame = harness.app.render();
        if reconcile::work().deferred == before && !harness.app.needs_frame() {
            return frame;
        }
    }
    panic!("the host never caught up with the frames' rows");
}

thread_local! {
    /// The test plugin's waker: a wake draws its mounts again.
    static WAKE_ROUTE: RefCell<Option<abi::Waker>> = const { RefCell::new(None) };
    /// Which tree the rows that draw a mount again show: the first, then the second.
    static PHASE: std::cell::Cell<u8> = const { std::cell::Cell::new(0) };
}

/// Draws the route's mount again in its next phase.
fn next_phase(harness: &Harness) {
    PHASE.with(|phase| phase.set(1));
    WAKE_ROUTE.with(|waker| waker.borrow().as_ref().expect("the plugin's waker").wake());
    settle(harness);
}

// Expected (`limits`, 4.2): a kept subtree counts the nodes it keeps, so a revision that keeps 31 nodes and adds 16
// crosses the tree's 40 inside what it adds; and content the plugin releases is given back to its share at once,
// while the mount lives. On both carriers.
#[test]
fn a_keep_counts_what_it_keeps_and_a_release_gives_content_back() {
    let texts = |count: usize| v2::Node::column((0..count).map(|index| text(&format!("t{index}"))).collect());
    for carrier in CARRIERS {
        let harness = open(carrier);
        let (frame, held) = {
            let _limits = limits::set(Limits { text: 1 << 20, ..small() });
            PHASE.with(|phase| phase.set(0));
            show(
                &harness,
                subject(move |_| match PHASE.with(std::cell::Cell::get) {
                    0 => v2::Node::column(vec![texts(30).with_id("k")]),
                    _ => v2::Node::column(vec![v2::Node::Keep { key: "k".into() }, texts(15)]),
                }),
            );
            next_phase(&harness);
            (harness.app.render(), limits::held(ID).nodes)
        };
        let twin = {
            let _limits = support::unlimited();
            show(
                &harness,
                subject(move |_| {
                    let mut added: Vec<v2::Node> = (0..7).map(|index| text(&format!("t{index}"))).collect();
                    added.push(placeholder(None, "too many nodes"));
                    v2::Node::column(vec![texts(30).with_id("k"), v2::Node::column(added)])
                }),
            )
        };
        let (shown, wanted) = (frame.text(), twin.text());
        assert!(frame.cells == twin.cells, "{carrier:?}: not the twin's frame\n{shown}\n---\n{wanted}");
        assert_eq!(held, 40, "{carrier:?}: held with the keep");
        // A release.
        let _limits = limits::set(Limits { text: 1 << 20, ..small() });
        PHASE.with(|phase| phase.set(0));
        show(
            &harness,
            subject(|cx| {
                let handle = given(cx, || vec![b'x'; 100]);
                match PHASE.with(std::cell::Cell::get) {
                    0 => framed(code(v2::Source::Content(handle))),
                    _ => {
                        cx.release(handle);
                        framed(text("released"))
                    }
                }
            }),
        );
        assert_eq!(limits::held(ID).content, 100, "{carrier:?}: content held");
        next_phase(&harness);
        assert!(harness.app.render().text().contains("released"), "{carrier:?}: the second phase did not draw");
        assert_eq!(limits::held(ID).content, 0, "{carrier:?}: content held after its release");
    }
}

// Expected (fixed row; review bigboi 2): measuring a tree reads no text past one node's limit, and each content
// handle's bytes once a mount, however many nodes name it and however many revisions show them; on both carriers.
#[test]
fn a_measure_reads_each_handle_once_and_nothing_past_the_text_limit() {
    let many = |source: v2::Source| v2::Node::column((0..64).map(|_| code(source.clone())).collect());
    for carrier in CARRIERS {
        let harness = open(carrier);
        let _limits = limits::set(Limits {
            nodes: 1_000,
            rows: 10_000,
            text: 1_000,
            plugin_content: 1 << 20,
            all_content: 1 << 20,
            ..small()
        });
        // Over the limit, by a handle and inline: nothing is read.
        let before = reconcile::work();
        show(&harness, subject(move |cx| many(v2::Source::Content(given(cx, || vec![b'x'; 1_001])))));
        show(&harness, subject(move |_| many(source("x".repeat(1_001)))));
        assert_eq!(reconcile::work().since(before).scanned, 0, "{carrier:?}: read past the limit");
        // Within it: one handle's 1,000 bytes are read once in the mount, through its views and another revision.
        let before = reconcile::work();
        PHASE.with(|phase| phase.set(0));
        show(&harness, subject(move |cx| many(v2::Source::Content(given(cx, || b"fn f() {}\n".repeat(100))))));
        next_phase(&harness);
        assert_eq!(reconcile::work().since(before).scanned, 1_000, "{carrier:?}: read more than once");
    }
}

/// A patch that adds a file of `lines` lines; `valid: false` makes its last line context, so it adds no whole file.
fn added(lines: usize, valid: bool) -> String {
    let mut patch = format!("--- /dev/null\n+++ b/f.rs\n@@ -0,0 +1,{lines} @@\n");
    for line in 0..lines {
        let sign = if valid || line + 1 < lines { '+' } else { ' ' };
        patch.push_str(&format!("{sign}line {line}\n"));
    }
    patch
}

// Expected (fixed row; review bigboi 6): a patch is charged as the renderer draws it. An added file of more than 3,000
// lines is drawn in chunks and fits the default 3,000 rows; one of 2,999 or 3,000 lines, and one whose header names
// more lines than it adds, are drawn whole and are past them. The twin, with the limits lifted, draws each as the
// contract says: the chunks, or the placeholder. On both carriers.
#[test]
fn a_patch_is_charged_as_the_renderer_draws_it() {
    let patch = |text: String| v2::Node::Diff {
        id: None,
        content: source(text),
        view: v2::DiffView::Unified,
        filetype: None,
        hunks: None,
    };
    for carrier in CARRIERS {
        let harness = open(carrier);
        for (lines, valid, fits) in
            [(2_999, true, false), (3_000, true, false), (3_001, true, true), (3_001, false, false)]
        {
            let text = added(lines, valid);
            let frame = {
                let _limits = limits::set(Limits { text: 1 << 20, ..Limits::default() });
                let text = text.clone();
                show(&harness, subject(move |_| framed(patch(text.clone()))))
            };
            let twin = {
                let _limits = support::unlimited();
                match fits {
                    true => show(&harness, subject(move |_| framed(patch(text.clone())))),
                    false => show(&harness, subject(|_| framed(placeholder(None, "too large to build at once")))),
                }
            };
            let name = format!("{carrier:?}, {lines} lines, valid {valid}");
            assert!(frame.cells == twin.cells, "{name}: not the twin's frame\n{}\n---\n{}", frame.text(), twin.text());
        }
    }
}

// Expected (fixed row; review bigboi 9): an image's job holds the decoded bytes it reserved until it is done: a mount
// closed while its worker waits gives nothing back, so a mount opened then has no room for another image; once the
// worker ends, the plugin holds nothing. A decode that fails gives back what it reserved, so the next image, on
// another handle, decodes and shows as OpenTUI draws it. On both carriers.
#[test]
fn an_image_job_holds_its_bytes_until_it_is_done() {
    let gradient = |x: u32, y: u32| [(x * 15) as u8, (y * 15) as u8, ((x + y) * 7) as u8, 255];
    for carrier in CARRIERS {
        let harness = open(carrier);
        let _limits = limits::set(Limits { plugin_content: 1 << 20, all_content: 1 << 20, ..small() });
        let hold = opencode_plugin::image::hold(ID);
        show(&harness, picture(png(16, 16, gradient)));
        assert_eq!((opencode_plugin::image::jobs(ID), limits::held(ID).images), (1, 1024), "{carrier:?}: a job");
        harness.tui.navigate(Route::Home);
        settle(&harness);
        assert_eq!((opencode_plugin::image::jobs(ID), limits::held(ID).images), (1, 1024), "{carrier:?}: closed");
        let before = reconcile::work();
        let frame = show(&harness, picture(png(16, 16, |x, y| gradient(y, x))));
        assert!(frame.text().contains("⋯ image too large"), "{carrier:?}: another image had room\n{}", frame.text());
        assert_eq!(reconcile::work().since(before).parses, 0, "{carrier:?}: another decode");
        drop(hold);
        let done = harness.app.wait_until(Duration::from_secs(10), || opencode_plugin::image::jobs(ID) == 0);
        assert!(done, "{carrier:?}: the job never ended");
        harness.tui.navigate(Route::Home);
        settle(&harness);
        assert_eq!(limits::held(ID).images, 0, "{carrier:?}: held after the job ended");
        // A PNG cut short decodes to nothing; the next, on another handle, has the room it gave back.
        let mut cut = png(16, 16, gradient);
        cut.truncate(cut.len() - 40);
        let good = png(16, 16, |x, y| gradient(y, x));
        let expected = drawn_in_the_frame(&good);
        let (cut, good) = (Rc::new(cut), Rc::new(good));
        PHASE.with(|phase| phase.set(0));
        show(
            &harness,
            subject(move |cx| {
                let bytes = if PHASE.with(std::cell::Cell::get) == 0 { cut.clone() } else { good.clone() };
                v2::Node::column(vec![image(v2::Source::Content(cx.content((*bytes).clone()))), text("foot")])
            }),
        );
        let failed = harness.app.wait_until(Duration::from_secs(10), || opencode_plugin::image::jobs(ID) == 0);
        assert!(failed && limits::held(ID).images == 0, "{carrier:?}: a failed decode kept its bytes");
        next_phase(&harness);
        let shown = harness.app.wait_until(Duration::from_secs(10), || corner(&harness.app.render()) == expected);
        assert!(shown, "{carrier:?}: the next image never showed\n{}", harness.app.render().text());
    }
}

// Expected (fixed row; review bigboi 5): a mount keeps the tree it adopted, not the one it was offered: a text of
// 1 MiB past a 64-byte limit leaves the host holding what a tree of only its placeholder leaves, within 64 KiB, by
// the Rust heap the UI thread still holds; on both carriers.
#[test]
fn a_mount_keeps_no_text_a_limit_refused() {
    for carrier in CARRIERS {
        let harness = open(carrier);
        let _limits = limits::set(Limits { text: 64, ..small() });
        let kept = |subject: Subject| {
            harness.tui.navigate(Route::Home);
            settle(&harness);
            let heap = support::heap::measure();
            show(&harness, subject);
            heap.kept()
        };
        let over = kept(subject(|_| framed(text(&"x".repeat(1 << 20)))));
        let alone = kept(subject(|_| framed(placeholder(None, "too large: 1048576 bytes"))));
        assert!(over - alone < 64 << 10, "{carrier:?}: kept {over} bytes, {alone} for the placeholder alone");
    }
}

// Expected (fixed row; review bigboi 5): a node that was a placeholder past the tree's nodes, kept by a later revision
// in which it would fit, is asked for again and shows; the twin draws the tree the plugin then gives. On both
// carriers.
#[test]
fn a_kept_placeholder_that_fits_now_is_asked_for_again() {
    let open_file = || text("Open file").with_id("open");
    for carrier in CARRIERS {
        let harness = open(carrier);
        let frame = {
            let _limits = limits::set(Limits { nodes: 4, ..small() });
            PHASE.with(|phase| phase.set(0));
            show(
                &harness,
                subject(move |cx| match (PHASE.with(std::cell::Cell::get), cx.input.full) {
                    (0, _) => v2::Node::column(vec![text("a"), text("b"), text("c"), open_file()]),
                    (_, true) => v2::Node::column(vec![open_file()]),
                    (_, false) => v2::Node::column(vec![v2::Node::Keep { key: "open".into() }]),
                }),
            );
            let before = harness.app.render();
            assert!(before.text().contains("⋯ too many nodes"), "{carrier:?}: no placeholder\n{}", before.text());
            next_phase(&harness);
            harness.app.render()
        };
        let twin = {
            let _limits = support::unlimited();
            show(&harness, subject(move |_| v2::Node::column(vec![open_file()])))
        };
        assert!(frame.cells == twin.cells, "{carrier:?}: not the twin's frame\n{}\n---\n{}", frame.text(), twin.text());
    }
}

/// Shows `phases` in the route, the first now and each next by a wake, under `limits`, and returns the last frame and
/// the views and placeholders the revisions after the first took.
fn revisions(harness: &Harness, limits: Limits, phases: Subject) -> (opentui::native::Capture, u64, u64) {
    let _limits = limits::set(limits);
    PHASE.with(|phase| phase.set(0));
    show(harness, phases);
    let (views, before) = (VIEWS.with(std::cell::Cell::get), reconcile::work());
    next_phase(harness);
    let frame = harness.app.render();
    (frame, VIEWS.with(std::cell::Cell::get) - views, reconcile::work().since(before).placeholders)
}

fn phase() -> u8 {
    PHASE.with(std::cell::Cell::get)
}

/// `lines` lines of code under `id`: two rows a line, and one for the node.
fn code_lines(id: &str, lines: usize) -> v2::Node {
    code(source(rust_lines(lines))).with_id(id)
}

// Expected (fixed rows; review carbon 1): a keep is admitted as the subtree it stands for. Keeps of nodes a placeholder
// stood for, or that were in its run, which still do not fit, show the one placeholder of their run and ask for no
// whole tree; a keep counts the rows its subtree built; a keep of a node opened to admit its children asks for it again
// once it fits whole. Each against the twin, with every limit lifted, drawing the tree the contract says; on both
// carriers.
#[test]
fn a_keep_is_admitted_as_the_subtree_it_stands_for() {
    let keyed = |count: usize| (0..count).map(|index| text(&format!("m{index}")).with_id(format!("m{index}")));
    for carrier in CARRIERS {
        let harness = open(carrier);
        let twin = |subject: Subject| {
            let _limits = support::unlimited();
            show(&harness, subject)
        };
        let same = |name: &str, frame: &opentui::native::Capture, twin: opentui::native::Capture| {
            assert!(frame.cells == twin.cells, "{carrier:?}, {name}\n{}\n---\n{}", frame.text(), twin.text());
        };
        // Seven keyed rows in room for six nodes: m4 is the placeholder, m5 and m6 its run. A revision that keeps all
        // seven under a new head keeps that shape, in one view and with one placeholder.
        let (frame, views, placeholders) = revisions(
            &harness,
            Limits { nodes: 6, ..small() },
            subject(move |_| match phase() {
                0 => v2::Node::column([text("h0")].into_iter().chain(keyed(7)).collect()),
                _ => v2::Node::column(
                    [text("h1")]
                        .into_iter()
                        .chain((0..7).map(|index| v2::Node::Keep { key: format!("m{index}") }))
                        .collect(),
                ),
            }),
        );
        let mut shown: Vec<v2::Node> = [text("h1")].into_iter().chain(keyed(4)).collect();
        shown.push(placeholder(Some("m4"), "too many nodes"));
        same("absorbed keeps", &frame, twin(subject(move |_| v2::Node::column(shown.clone()))));
        assert_eq!((views, placeholders), (1, 1), "{carrier:?}: absorbed keeps, views and placeholders");
        // A placeholder past the rows, kept beside a node that is past them too: one placeholder.
        let (frame, _, placeholders) = revisions(
            &harness,
            Limits { text: 1 << 20, ..small() },
            subject(move |_| match phase() {
                0 => v2::Node::column(vec![code_lines("f", 30), code_lines("b", 30), text("c")]),
                _ => {
                    v2::Node::column(vec![code_lines("f", 20), v2::Node::Keep { key: "b".into() }, code_lines("z", 30)])
                }
            }),
        );
        let shown =
            || v2::Node::column(vec![code_lines("f", 20), placeholder(Some("b"), "too large to build at once")]);
        same("kept placeholder", &frame, twin(subject(move |_| shown())));
        assert_eq!(placeholders, 1, "{carrier:?}: kept placeholder, placeholders");
        // A keep counts its rows: the code beside it is past them.
        let (frame, ..) = revisions(
            &harness,
            Limits { text: 1 << 20, ..small() },
            subject(move |_| match phase() {
                0 => v2::Node::column(vec![code_lines("k", 30)]),
                _ => v2::Node::column(vec![v2::Node::Keep { key: "k".into() }, code_lines("z", 30)]),
            }),
        );
        let shown =
            || v2::Node::column(vec![code_lines("k", 30), placeholder(Some("z"), "too large to build at once")]);
        same("kept rows", &frame, twin(subject(move |_| shown())));
        // A box opened in room for five nodes, kept once there is room for it whole: asked for again, and whole.
        let outer = move || v2::Node::column(keyed(6).collect()).with_id("outer");
        let phases = subject(move |cx| match (phase(), cx.input.full) {
            (0, _) | (_, true) => v2::Node::column(vec![outer()]),
            _ => v2::Node::column(vec![v2::Node::Keep { key: "outer".into() }]),
        });
        {
            let _limits = limits::set(Limits { nodes: 5, ..small() });
            PHASE.with(|phase| phase.set(0));
            show(&harness, phases);
        }
        let frame = {
            let _limits = limits::set(small());
            next_phase(&harness);
            harness.app.render()
        };
        same("opened box", &frame, twin(subject(move |_| v2::Node::column(vec![outer()]))));
    }
}

// Expected (fixed row; review bigboi 3): the rows trees build in a frame are shared by every plugin. A route and a
// sibling's surface whose revisions build 23 rows each, both woken before one paint, in a frame of 30 rows: the paint
// adopts one, and the next paint the other; the screen then equals the twin's, which builds both at once. On both
// carriers.
#[test]
fn two_plugins_share_the_rows_of_a_frame() {
    let both = |phase: u8| [code_lines("r", 10), text(&format!("route {phase}"))];
    for carrier in CARRIERS {
        let harness = open(carrier);
        let limits = Limits { text: 1 << 20, frame_rows: 30, ..small() };
        PHASE.with(|phase| phase.set(0));
        BESIDE.with(|beside| {
            *beside.borrow_mut() = subject(move |_| {
                let phase = PHASE.with(std::cell::Cell::get);
                v2::Node::column(vec![code_lines("s", 10), text(&format!("beside {phase}"))])
            })
        });
        let (first, second) = {
            let _limits = limits::set(limits);
            show(&harness, subject(move |_| v2::Node::column(both(phase()).to_vec())));
            caught_up(&harness);
            PHASE.with(|phase| phase.set(1));
            WAKE_ROUTE.with(|waker| waker.borrow().as_ref().unwrap().wake());
            WAKER.with(|waker| waker.borrow().as_ref().unwrap().wake());
            let before = reconcile::work();
            let first = harness.app.render().text();
            let deferred = reconcile::work().since(before).deferred;
            assert_eq!(deferred, 1, "{carrier:?}: revisions left for the next frame");
            (first, caught_up(&harness))
        };
        assert!(first.contains("route 1") != first.contains("beside 1"), "{carrier:?}: one revision a frame\n{first}");
        let twin = {
            let _limits = support::unlimited();
            show(&harness, subject(move |_| v2::Node::column(both(1).to_vec())))
        };
        let name = format!("{carrier:?}");
        assert!(second.cells == twin.cells, "{name}: not the twin's frame\n{}\n---\n{}", second.text(), twin.text());
        BESIDE.with(|beside| *beside.borrow_mut() = subject(|_| text("sibling")));
    }
}

// Expected (fixed row; review carbon 2.1): a list's items share the rows of the frame: ten items of 61 rows each in a
// list that lays them out in a row, in a frame of 100 rows, mount two at most in the paint that shows the list; once
// they are all mounted the screen equals the twin's, which mounts them at once. On both carriers.
#[test]
fn a_lists_items_share_the_rows_of_a_frame() {
    let tabs = || {
        let items = (0..10).map(|index| v2::ListItem::new(code_lines(&format!("i{index}"), 30), 1)).collect();
        let mut list = v2::Node::list(items).with_id("tabs");
        if let v2::Node::List { row, .. } = &mut list {
            *row = true;
        }
        v2::Node::column(vec![list])
    };
    for carrier in CARRIERS {
        let harness = open(carrier);
        let (first, frame) = {
            let _limits = limits::set(Limits { text: 1 << 20, frame_rows: 100, ..small() });
            PHASE.with(|phase| phase.set(0));
            show(&harness, subject(move |_| if phase() == 0 { text("none") } else { tabs() }));
            let before = reconcile::work();
            PHASE.with(|phase| phase.set(1));
            WAKE_ROUTE.with(|waker| waker.borrow().as_ref().unwrap().wake());
            harness.app.render();
            let first = reconcile::work().since(before).parses;
            (first, caught_up(&harness))
        };
        assert!(first <= 2, "{carrier:?}: {first} items parsed in the paint that showed the list");
        let twin = {
            let _limits = support::unlimited();
            show(&harness, subject(move |_| tabs()))
        };
        assert!(frame.cells == twin.cells, "{carrier:?}: not the twin's frame\n{}\n---\n{}", frame.text(), twin.text());
    }
}

/// Paints and presents frames until no revision or list item waits for a frame's rows; the time of each, from the
/// wakes and input it handles through the present.
fn paints(harness: &Harness) -> Vec<Duration> {
    let mut times = Vec::new();
    for _ in 0..100 {
        let before = reconcile::work().deferred;
        let begun = Instant::now();
        harness.app.present().unwrap();
        times.push(begun.elapsed());
        if reconcile::work().deferred == before && !harness.app.needs_frame() {
            break;
        }
    }
    times
}

fn worst(times: &[Duration]) -> f64 {
    times.iter().max().map_or(0.0, |time| time.as_secs_f64() * 1000.0)
}

// The probe of the frame's rows (review bigboi 3), in release with `--ignored --nocapture`; `steps/plugins-pl.md`
// records its output. TestApp at 200x60, its frame check off, the client's limits: a route and a sibling's surface
// each revise 1,400 lines of Rust (2,801 rows) with a comment that changes, both woken before one paint; the route's
// first mount of that tree; and wheel steps through a list of 200 items of 30 lines each. Each paint is timed from the
// wakes and input it handles through the present.
#[test]
#[ignore = "a probe: run it alone, in release"]
fn frame_probe() {
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: ID, setup }.into(), abi::Plugin { id: SIBLING, setup: sibling }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(200, 60, deps);
    harness.app.set_verify(false);
    settle(&harness);
    let tree = |name: &str| {
        let comment = format!("// {name} revision {}\n", PHASE.with(std::cell::Cell::get));
        let content = source(comment + &rust_lines(1_400));
        v2::Node::Code {
            id: None,
            content,
            filetype: Some("rust".into()),
            numbers: false,
            layout: abi::Layout::default(),
        }
    };
    // A revision of both, at each frame's rows.
    for frame_rows in [3_000, u64::MAX] {
        let _limits = limits::set(Limits { frame_rows, ..Limits::default() });
        PHASE.with(|phase| phase.set(0));
        BESIDE.with(|beside| *beside.borrow_mut() = subject(move |_| tree("beside")));
        show(&harness, subject(move |_| tree("route")));
        caught_up(&harness);
        let mut all = Vec::new();
        for revision in 1..=8 {
            PHASE.with(|phase| phase.set(revision));
            WAKE_ROUTE.with(|waker| waker.borrow().as_ref().unwrap().wake());
            WAKER.with(|waker| waker.borrow().as_ref().unwrap().wake());
            let times = paints(&harness);
            println!("probe revision frame_rows {frame_rows} paints {} worst {:.2}", times.len(), worst(&times));
            all.extend(times);
        }
        let mut sorted = all.clone();
        sorted.sort();
        println!("probe revisions frame_rows {frame_rows} median {:.2} worst {:.2}", median(all), worst(&sorted));
        BESIDE.with(|beside| *beside.borrow_mut() = subject(|_| text("sibling")));
    }
    // A first mount at the rows of a tree.
    for _ in 0..3 {
        harness.tui.navigate(Route::Home);
        caught_up(&harness);
        SUBJECT.with(|slot| *slot.borrow_mut() = subject(move |_| tree("route")));
        harness.tui.navigate(Route::Plugin { id: ID.to_owned(), name: "tree".to_owned() });
        let times = paints(&harness);
        println!("probe first mount paints {} worst {:.2}", times.len(), worst(&times));
    }
    // Wheel steps through a list of heavy items.
    let items = || {
        let items = (0..200).map(|index| v2::ListItem::new(code_lines(&format!("i{index}"), 30), 31)).collect();
        v2::Node::list(items).with_id("list").layout(abi::Layout::default().height(abi::Width::Cells(58)))
    };
    show(&harness, subject(move |_| v2::Node::column(vec![items()])));
    caught_up(&harness);
    let mut steps = Vec::new();
    for _ in 0..40 {
        let wheel = opentui::prelude::MouseEvent {
            kind: opentui::prelude::MouseEventKind::ScrollDown,
            x: 10,
            y: 10,
            modifiers: opentui::prelude::Modifiers::NONE,
        };
        harness.app.app().dispatch(opentui::prelude::Event::Mouse(wheel));
        steps.extend(paints(&harness));
    }
    let mut sorted = steps.clone();
    sorted.sort();
    println!("probe wheel paints {} median {:.2} worst {:.2}", steps.len(), median(steps), worst(&sorted));
}

// Expected (fixed row; review carbon 2.2): a list's items that are not mounted give the hunks of their patches as
// anchors only within one node's limits: twenty patches of 3 hunks give 60, and of 5 hunks, past the 3 of a patch,
// none, as they are placeholders once mounted. On both carriers.
#[test]
fn a_lists_anchors_respect_the_limits_of_a_patch() {
    let list = |count: usize| {
        let items = (0..20)
            .map(|index| {
                let diff = v2::Node::Diff {
                    id: Some(format!("d{index}")),
                    content: source(hunks(count)),
                    view: v2::DiffView::Unified,
                    filetype: None,
                    hunks: Some("h".into()),
                };
                v2::ListItem::new(diff, 1)
            })
            .collect();
        v2::Node::column(vec![
            v2::Node::list(items).with_id("l").layout(abi::Layout::default().height(abi::Width::Cells(3))),
        ])
    };
    for carrier in CARRIERS {
        let harness = open(carrier);
        let _limits = limits::set(Limits { nodes: 1_000, rows: 1_000, text: 1 << 20, ..small() });
        for (count, anchors) in [(3, 60), (5, 0)] {
            show(&harness, subject(move |_| list(count)));
            caught_up(&harness);
            let _ = harness.tui.keymap.dispatch("limits.anchors", None);
            let seen = ANCHORS.with(|seen| seen.borrow().len());
            assert_eq!(seen, anchors, "{carrier:?}: anchors of patches of {count} hunks");
        }
    }
}

// Expected (fixed row; review carbon 2.3): a node's text costs a row a KiB, however its lines break: one line of
// 100 KiB is past the 100 rows of a tree and shows its placeholder, and one of 90 KiB shows; against the twin. On both
// carriers.
#[test]
fn a_long_line_costs_its_rows() {
    for carrier in CARRIERS {
        let harness = open(carrier);
        for (bytes, fits) in [(90 << 10, true), (100 << 10, false)] {
            let frame = {
                let _limits = limits::set(Limits { text: 1 << 20, ..small() });
                show(&harness, subject(move |_| v2::Node::column(vec![text(&"x".repeat(bytes))])))
            };
            let twin = {
                let _limits = support::unlimited();
                match fits {
                    true => show(&harness, subject(move |_| v2::Node::column(vec![text(&"x".repeat(bytes))]))),
                    false => show(
                        &harness,
                        subject(|_| v2::Node::column(vec![placeholder(None, "too large to build at once")])),
                    ),
                }
            };
            let name = format!("{carrier:?}, {bytes} bytes");
            assert!(frame.cells == twin.cells, "{name}: not the twin's frame\n{}\n---\n{}", frame.text(), twin.text());
        }
    }
}
