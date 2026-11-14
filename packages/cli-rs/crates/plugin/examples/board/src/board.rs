//! A board of cards on a route of contract 2.0, in a scroll that takes the page below the header. Each card shows a
//! value and a patch by content handle, memoized on its value; the header shows the plugin's own call log: how many
//! views ran, how many cards they built, and how many messages arrived. A meter, a canvas below the header, draws the
//! cards' total as a bar, with the frame it drew for: its version follows the total, and it animates on request,
//! adding up the animation's time. Commands bump a card, toast, panic, animate the meter or make its next draw panic,
//! and start threads: one that floods the mailbox, waiting on `Full`, and one that panics.

use std::cell::RefCell;
use std::rc::Rc;

use std::time::Duration;

use opencode_plugin_abi::canvas::{List, Style};
use opencode_plugin_abi::{Command, Layout, Rgba, SendError, Setup, Span, Toast, Variant, Width, v2};

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
}

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
    let drawn = board.clone();
    let surface = v2::Surface::new("board", v2::Place::Route("board".into()), move |cx| view(&board, cx));
    setup.surface(surface.draw(move |cx| Some(meter(&drawn, cx.frame))));
    Ok(())
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
                    v2::Node::Diff {
                        id: None,
                        content: v2::Source::Content(cx.content(patch)),
                        view: v2::DiffView::Unified,
                        filetype: None,
                    },
                ])
            })
        })
        .collect();
    let header = {
        let mut board = board.borrow_mut();
        board.built += built;
        format!("views {} built {} messages {}", board.views, board.built, board.messages)
    };
    let header = v2::Node::text(vec![Span::new(header)]).with_id("header");
    let total: u32 = values.iter().sum();
    let meter = v2::Node::canvas("meter").version(u64::from(total)).animate(board.borrow().animate).layout(Layout {
        width: Some(Width::Cells(40)),
        height: Some(Width::Cells(2)),
        ..Layout::default()
    });
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
    Command { name: name.to_owned(), title: name.to_owned(), ..Command::default() }
}

fn number(input: Option<&str>) -> usize {
    input.and_then(|input| input.parse().ok()).unwrap_or(0)
}
