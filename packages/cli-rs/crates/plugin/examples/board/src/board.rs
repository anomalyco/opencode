//! A board of cards on a route of contract 2.0, in a scroll that takes the page below the header. Each card shows a
//! value and a patch by content handle, memoized on its value; the header shows the plugin's own call log: how many
//! views ran, how many cards they built, and how many messages arrived. A meter, a canvas below the header, draws the
//! cards' total as a bar, with the frame it drew for: its version follows the total, and it animates on request,
//! adding up the animation's time. Commands bump a card, toast, panic, animate the meter or make its next draw panic,
//! and start threads: one that floods the mailbox, waiting on `Full`, and one that panics. Keys of the route (P2) bump
//! a card, pass a key on to the plugin's own global layer, set a mode in which the same key bumps another card, and
//! panic; the header lists the keys the handlers heard, each with the mode the handler read. A panel beside a session,
//! `notes`, focuses its pad, reads where the focus is and the pad's place, holds a key and releases it, opens an
//! overlay under its pad, gives its field the focus (`focus-input`), and gives the focus back; a centered select lists
//! the cards a search finds.
//!
//! Its `files` route is P3's: a windowed list of files whose estimates are not their heights, each an anchor of group
//! `file` with its hunks in group `hunk`. Commands bring a file to the top, step between hunks and show a file with
//! `Nearest`; `layout` paints the header from the top file, and the header shows where the last step landed and how
//! many `layout` calls ran.
//! It also claims the calls of a `board` tool and the `board` fences of the transcript (Pr): each part is a card
//! of its own, and a fence's card holds the host's own code view of it (`fence-node`), which follows the fence as it
//! streams.

use std::cell::RefCell;
use std::rc::Rc;

use std::time::Duration;

use opencode_plugin_abi::canvas::{List, Style};
use opencode_plugin_abi::claim::{Claim, Part, State};
use opencode_plugin_abi::interact::{Anchor, Bind, Event, Handled, Interact, Layer, LayerScope, OpenPanel, Overlay};
use opencode_plugin_abi::types::SessionMessageAssistantToolState;
use opencode_plugin_abi::{
    Action, Command, Dialog, Host, Layout, Rgba, Select, SelectOption, SendError, Setup, Span, Toast, Variant, Width,
    v2,
};

pub const CARDS: usize = 6;

#[derive(Default)]
struct Board {
    values: Vec<u32>,
    views: u32,
    built: u32,
    messages: u32,
    /// The meter animates.
    animate: bool,
    /// The animation's time the meter's draws were given.
    elapsed: Duration,
    /// The meter's next draw panics.
    broken: bool,
    keys: Vec<String>,
    /// What the panel's input told its handler (P3's `Input` on P2's events).
    said: Vec<String>,
}

/// The files: how many `layout` calls ran, the header's width the last one was told, and where the last step landed.
#[derive(Default)]
struct Files {
    layouts: u32,
    told: Option<i32>,
    landed: String,
    /// What the last `files.read` read: the offset, the files' anchors and the top file.
    read: String,
}

/// The files of the `files` route.
pub const FILES: usize = 60;

pub fn setup(setup: &mut Setup) -> Result<(), String> {
    let board = Rc::new(RefCell::new(Board { values: vec![0; CARDS], ..Board::default() }));
    let into = board.clone();
    // A thread's message adds one to a card.
    let sender = setup.messages(move |_, card: usize| {
        let mut board = into.borrow_mut();
        board.values[card % CARDS] += 1;
        board.messages += 1;
    })?;
    let bumped = board.clone();
    setup.command(command("board.bump"), move |_, input| bumped.borrow_mut().values[number(input) % CARDS] += 1);
    let (spawner, flood) = (setup.spawner(), sender.clone());
    setup.command(command("board.flood"), move |_, input| {
        let (sender, count) = (flood.clone(), number(input));
        let _ = spawner.spawn("flood", move |stop| {
            for index in 0..count {
                let mut card = index % CARDS;
                loop {
                    match sender.send(card) {
                        Ok(()) => break,
                        Err(SendError::Full(back)) if !stop.stopped() => {
                            card = back;
                            std::thread::yield_now();
                        }
                        Err(_) => return,
                    }
                }
            }
        });
    });
    // At most the mailbox's bound, sent at once and never waited on: what arrives does not depend on when the UI drains.
    let spawner = setup.spawner();
    setup.command(command("board.burst"), move |_, input| {
        let (sender, count) = (sender.clone(), number(input));
        let _ = spawner.spawn("burst", move |_| (0..count).for_each(|index| drop(sender.send(index % CARDS))));
    });
    let spawner = setup.spawner();
    setup.command(command("board.thread-panic"), move |_, _| {
        let _ = spawner.spawn("boom", |_| panic!("the board's thread panicked"));
    });
    setup.command(command("board.toast"), |host, _| host.toast(Toast::new(Variant::Info, "the board says hi")));
    setup.command(command("board.panic"), |_, _| panic!("the board's command panicked"));
    let animated = board.clone();
    setup.command(command("board.animate"), move |_, _| {
        let mut board = animated.borrow_mut();
        board.animate = !board.animate;
    });
    // The total changes, so the meter draws, and its draw panics.
    let broken = board.clone();
    setup.command(command("board.draw-panic"), move |_, _| {
        let mut board = broken.borrow_mut();
        board.broken = true;
        board.values[0] += 1;
    });
    notes(setup, &board);
    // The plugin's own layer hears the key the route's handler passes. A global bind takes a key with a modifier: a
    // plain letter is the user's typing in the composer (FT-14).
    let global = board.clone();
    let layer = Layer::default().with_scope(LayerScope::Global).with_keys(vec![Bind::new("alt+h", "help")]);
    setup.layer(layer, move |_, _| {
        global.borrow_mut().keys.push("global".to_owned());
        Handled::Consume
    });
    let (keyed, viewed, drawn) = (board.clone(), board.clone(), board);
    let base = Layer::default().with_keys(vec![
        Bind::new("j", "bump"),
        Bind::new("alt+h", "help"),
        Bind::new("m", "move"),
        Bind::new("p", "panic"),
    ]);
    let moving = Layer::default()
        .with_mode(Some("move".to_owned()))
        .with_keys(vec![Bind::new("j", "shift"), Bind::new("m", "done")]);
    let surface = v2::Surface::new("board", v2::Place::Route("board".into()), move |cx| view(&viewed, cx))
        .draw(move |cx| Some(meter(&drawn, cx.frame)))
        .layers(vec![base, moving])
        .on(move |host, event| {
            let Event::Key(key) = event else { return Handled::Pass };
            let bind = key.bind.clone().unwrap_or_default();
            let heard = host.mode().map_or(bind.clone(), |mode| format!("{bind}@{mode}"));
            let mut board = keyed.borrow_mut();
            board.keys.push(heard);
            match bind.as_str() {
                "bump" => board.values[0] += 1,
                "shift" => board.values[CARDS - 1] += 1,
                "move" => host.set_mode(Some("move")),
                "done" => host.set_mode(None),
                "panic" => panic!("the board's handler panicked"),
                _ => return Handled::Pass,
            }
            Handled::Consume
        });
    setup.surface(surface);
    files(setup);
    setup.claim(Claim::tool("board", claimed));
    setup.claim(Claim::fence("board", fenced));
    Ok(())
}

/// The `files` route and its commands.
fn files(setup: &mut Setup) {
    let target = || v2::Target::node("files", "list");
    let route = |name: &str| command(name).with_scope(opencode_plugin_abi::Scope::Route("files".into()));
    setup.command(route("files.to"), move |host, input| {
        let node = format!("f{}", number(input));
        host.scroll(target(), v2::Scroll::To { node, align: v2::ScrollAlign::Start });
    });
    setup.command(route("files.near"), move |host, input| {
        let node = format!("f{}", number(input));
        host.scroll(target(), v2::Scroll::To { node, align: v2::ScrollAlign::Nearest { inset: 1 } });
    });
    setup.command(route("files.step"), move |host, input| {
        let by = input.and_then(|input| input.parse().ok()).unwrap_or(1);
        host.scroll(target(), v2::Scroll::Step { group: "hunk".into(), by, inset: 1 });
    });
    let files = Rc::new(RefCell::new(Files::default()));
    let (shown, laid, landed, read) = (files.clone(), files.clone(), files.clone(), files);
    setup.command(route("files.read"), move |host, _| {
        let offset = host.scroll_state(&target()).map_or(-1, |state| i64::from(state.offset));
        let anchors = host.anchors(&target(), "file").len();
        let top = host.top_anchor(&target(), "file", 1).map(|top| top.id).unwrap_or_default();
        read.borrow_mut().read = format!("at {offset} of {anchors} top {top}");
    });
    let surface = v2::Surface::new("files", v2::Place::Route("files".into()), move |_| files_view(&shown.borrow()))
        .layout(vec![v2::Notify::Node { id: "head".into() }], move |geometry| {
            let told = geometry.rect("head").map(|rect| rect.width);
            let mut laid = laid.borrow_mut();
            laid.layouts += 1;
            laid.told = told;
            let top = geometry.top("list", "file").map(|top| top.id.clone()).unwrap_or_default();
            let odd = top.trim_start_matches('f').parse::<usize>().is_ok_and(|file| file % 2 == 1);
            v2::LayoutReply::default()
                .paint("head", if odd { "background.raised.high" } else { "background.raised.base" })
        })
        .on(move |_, event| {
            if let Event::Scroll { event: v2::ScrollEvent::Landed { anchor, .. }, .. } = event {
                landed.borrow_mut().landed = anchor.id.clone();
            }
            Handled::Pass
        });
    setup.surface(surface);
}

/// The files: a header, and a list of each file's name and patch, estimated at 5 rows whatever it has.
fn files_view(files: &Files) -> v2::Node {
    let told = files.told.map_or("-".to_owned(), |width| width.to_string());
    let header = format!("landed {} layouts {} told {told} {}", files.landed, files.layouts, files.read);
    let head = v2::Node::row(vec![v2::Node::text(vec![Span::new(header)])]).with_id("head");
    let items = (0..FILES)
        .map(|file| {
            let mut patch = format!("--- a/f{file}\n+++ b/f{file}\n");
            for hunk in 0..1 + file % 4 {
                patch.push_str(&format!(
                    "@@ -{0},1 +{0},2 @@\n f{file} h{hunk}\n+f{file} h{hunk} added\n",
                    1 + hunk * 10
                ));
            }
            let diff = v2::Node::diff(v2::Source::Text(patch))
                .with_id(format!("d{file}"))
                .with_view(v2::DiffView::Unified)
                .with_hunks(Some("hunk".into()));
            let name = v2::Node::text(vec![Span::new(format!("file {file}"))]);
            let node = v2::Node::column(vec![name, diff]).with_id(format!("f{file}")).anchor("file", "");
            v2::ListItem::new(node, 5)
        })
        .collect();
    let mut list = v2::Node::list(items).with_id("list").layout(Layout::default().grow());
    if let v2::Node::List { notify_top, .. } = &mut list {
        *notify_top = Some("file".into());
    }
    v2::Node::column(vec![head, list]).layout(Layout::default().grow())
}

/// The panel `notes`, its overlay `menu`, and the select of cards with its search.
fn notes(setup: &mut Setup, board: &Rc<RefCell<Board>>) {
    setup.command(command("board.notes"), |host, _| {
        host.open_panel(OpenPanel::new("notes"));
    });
    setup.command(command("board.unnotes"), |host, _| host.close_panel("notes"));
    // The panel's field takes the focus from the plugin, as from a click (`focus-input`).
    setup.command(command("board.say"), |host, _| host.focus("say"));
    setup.search("cards", |_, query, options| {
        options.iter().filter(|option| option.title.contains(query)).map(|option| option.value.clone()).collect()
    });
    setup.command(command("board.pick"), |host, _| {
        let options = (0..CARDS).map(|card| SelectOption::new(format!("card {card}"), card.to_string())).collect();
        let action = Action::Command { name: "board.bump".into(), input: None };
        let select = Select::new("Cards", options, action).with_search(Some("cards".into())).with_centered(true);
        host.dialog(Dialog::Select(select));
    });
    let keys = vec![
        Bind::new("f", "focus"),
        Bind::new("w", "where"),
        Bind::new("r", "rect"),
        Bind::new("k", "hold").with_hold(true),
        Bind::new("v", "menu"),
        Bind::new("b", "blur"),
    ];
    let (heard, viewed, said) = (board.clone(), board.clone(), board.clone());
    let surface = v2::Surface::new("notes", v2::Place::Panel("notes".into()), move |cx| {
        let panel = cx.input.panel.unwrap_or_default();
        let (keys, said) = (viewed.borrow().keys.join(" "), viewed.borrow().said.join(" "));
        let pad = v2::Node::column(vec![v2::Node::text(vec![Span::new("pad")])])
            .with_id("pad")
            .interact(Interact::default().with_focusable(true));
        v2::Node::column(vec![
            v2::Node::text(vec![Span::new(format!(
                "notes focused={} at {}",
                panel.focused,
                cx.read.focused().node.unwrap_or_default()
            ))]),
            v2::Node::text(vec![Span::new(format!("heard {keys}"))]),
            pad,
            v2::Node::text(vec![Span::new(format!("said {said}"))]),
            v2::Node::input("").with_id("say").placeholder("say"),
        ])
    })
    .layers(vec![Layer::default().with_keys(keys)])
    .on(move |host, event| {
        let heard = |text: String| heard.borrow_mut().keys.push(text);
        match event {
            Event::Key(key) => match key.bind.as_deref().unwrap_or_default() {
                "focus" => host.focus("pad"),
                "where" => heard(format!("where:{}", host.focused().node.unwrap_or_default())),
                "rect" => heard(
                    host.rect("pad").map_or("rect:-".to_owned(), |rect| format!("rect:{}x{}", rect.width, rect.height)),
                ),
                "hold" => {
                    heard("hold".to_owned());
                    host.release_keys();
                }
                "menu" => host.overlay(Overlay::new("menu", Anchor::Node { node: "pad".into() }, 12, 2)),
                "blur" => host.blur(),
                _ => return Handled::Pass,
            },
            Event::Closed { surface, .. } => heard(format!("closed:{surface}")),
            Event::Change { text, .. } => said.borrow_mut().said.push(format!("c:{text}")),
            Event::Submit { text, .. } => said.borrow_mut().said.push(format!("s:{text}")),
            _ => return Handled::Pass,
        }
        Handled::Consume
    });
    setup.surface(surface);
    let shut = Layer::default().with_keys(vec![Bind::new("x", "shut")]);
    let menu =
        v2::Surface::new("menu", v2::Place::Overlay("menu".into()), |_| v2::Node::text(vec![Span::new("MENU here")]))
            .layers(vec![shut])
            .on(|host: &dyn Host, event| match event {
                Event::Key(_) => {
                    host.close_overlay("menu");
                    Handled::Consume
                }
                _ => Handled::Pass,
            });
    setup.surface(menu);
}

/// A claimed fence as a card: its info over the host's own code view of it, memoized on the info alone, as the host
/// keeps the code current; for a host without `fence-node`, the code as Markdown content, memoized on it too.
fn fenced(cx: &mut v2::View<'_>, part: &Part) -> Option<v2::Node> {
    let Part::Fence(fence) = part else { return None };
    let title = format!("fence {}", fence.info);
    let lowered = !cx.read.abi().has_feature(opencode_plugin_abi::FENCE_NODE);
    let code = if lowered { fence.code.clone() } else { String::new() };
    Some(cx.memo("part", (title.clone(), code.clone()), |cx| {
        let shown = cx.or(v2::Node::fence().bg("background.raised.base"), |cx| {
            v2::Node::markdown(v2::Source::Content(cx.content(code)))
        });
        v2::Node::column(vec![v2::Node::text(vec![Span::new(title)]).fg("text.muted"), shown])
            .bg("background.raised.base")
    }))
}

/// A claimed call as a card: a title, and what the call holds as content, memoized on both. A finished call shows its
/// output by reference; a call that failed is left to the host's row.
fn claimed(cx: &mut v2::View<'_>, part: &Part) -> Option<v2::Node> {
    // A kind of part a later host claims is left to the host's row.
    let Part::Tool(tool) = part else { return None };
    let body = match &tool.tool.state {
        SessionMessageAssistantToolState::Streaming(state) => state.input.clone(),
        SessionMessageAssistantToolState::Running(state) => format!("{:?}", state.input),
        SessionMessageAssistantToolState::Completed(state) => format!("{:?}", state.input),
        _ => return None,
    };
    let output = (tool.state == State::Completed).then(|| tool.output());
    let title = format!("{} {} {:?}", tool.tool.name, tool.tool.id, tool.state);
    Some(cx.memo("part", (title.clone(), body.clone(), output.clone()), |cx| {
        let mut children = vec![
            v2::Node::text(vec![Span::new(title)]).fg("text.muted"),
            v2::Node::markdown(v2::Source::Content(cx.content(body))),
        ];
        children.extend(output.map(v2::Node::markdown));
        v2::Node::column(children).bg("background.raised.base")
    }))
}

fn view(board: &RefCell<Board>, cx: &mut v2::View<'_>) -> v2::Node {
    let values = {
        let mut board = board.borrow_mut();
        board.views += 1;
        board.values.clone()
    };
    let mut built = 0;
    let cards: Vec<v2::Node> = values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            cx.memo(format!("card-{index}"), *value, |cx| {
                built += 1;
                let patch = format!("@@ -1 +1 @@\n-card {index}\n+card {index} is {value}\n");
                v2::Node::column(vec![
                    v2::Node::text(vec![Span::new(format!("card {index}: {value}"))]).fg("text.muted"),
                    v2::Node::diff(v2::Source::Content(cx.content(patch))).with_view(v2::DiffView::Unified),
                ])
            })
        })
        .collect();
    let header = {
        let mut board = board.borrow_mut();
        board.built += built;
        let keys = match board.keys.is_empty() {
            true => String::new(),
            false => format!(" keys {}", board.keys.join(" ")),
        };
        format!("views {} built {} messages {}{keys}", board.views, board.built, board.messages)
    };
    let header = v2::Node::text(vec![Span::new(header)]).with_id("header");
    let total: u32 = values.iter().sum();
    let meter = v2::Node::canvas("meter")
        .version(u64::from(total))
        .animate(board.borrow().animate)
        .layout(Layout::default().width(Width::Cells(40)).height(Width::Cells(2)));
    let cards = v2::Node::scroll(cards).with_id("cards").layout(Layout::default().grow());
    v2::Node::column(vec![header, meter, cards]).with_id("board").layout(Layout::default().grow())
}

/// The meter's list for `frame`: a bar of the cards' total, and what it drew for.
fn meter(board: &RefCell<Board>, frame: v2::Frame) -> List {
    let mut board = board.borrow_mut();
    if board.broken {
        panic!("the board's draw panicked");
    }
    board.elapsed += frame.dt;
    let total: u32 = board.values.iter().sum();
    let mut list = List::new();
    list.fill(0, 0, (total as u16).min(frame.width), 1, Rgba::new(80, 160, 240, 255));
    let text = format!("{}x{} {:?} {} ms", frame.width, frame.height, frame.cause, board.elapsed.as_millis());
    list.text(0, 1, &text, Style::new().fg(Rgba::new(230, 230, 230, 255)));
    list
}

fn command(name: &str) -> Command {
    Command::default().with_name(name.to_owned()).with_title(name.to_owned())
}

fn number(input: Option<&str>) -> usize {
    input.and_then(|input| input.parse().ok()).unwrap_or(0)
}
