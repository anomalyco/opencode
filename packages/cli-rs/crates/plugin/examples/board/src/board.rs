//! A board of cards on a route of contract 2.0, in a scroll that takes the page below the header. Each card shows a
//! value and a patch by content handle, memoized on its value; the header shows the plugin's own call log: how many views ran, how many cards they built, and how many
//! messages arrived. Commands bump a card, toast, panic, and start threads: one that floods the mailbox, waiting on
//! `Full`, and one that panics.

use std::cell::RefCell;
use std::rc::Rc;

use opencode_plugin_abi::{Command, Layout, SendError, Setup, Span, Toast, Variant, v2};

pub const CARDS: usize = 6;

#[derive(Default)]
struct Board {
    values: Vec<u32>,
    views: u32,
    built: u32,
    messages: u32,
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
    setup.surface(v2::Surface::new("board", v2::Place::Route("board".into()), move |cx| view(&board, cx)));
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
    let cards = v2::Node::scroll(cards).with_id("cards").layout(Layout::default().grow());
    v2::Node::column(vec![header, cards]).with_id("board").layout(Layout::default().grow())
}

fn command(name: &str) -> Command {
    Command { name: name.to_owned(), title: name.to_owned(), ..Command::default() }
}

fn number(input: Option<&str>) -> usize {
    input.and_then(|input| input.parse().ok()).unwrap_or(0)
}
