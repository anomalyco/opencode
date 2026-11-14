//! The linked twin of `twin/tui.ts`, for `carrier-equal` on the pipe (P7): a board of cards on a route of contract 2.0,
//! each a value and a patch by content handle, memoized on its value, below a header with their total. Commands bump a
//! card, toast, and fail. The two are two programs; each is checked against the other's frames, and neither shares code
//! with the host.

use std::cell::RefCell;
use std::rc::Rc;

use opencode_plugin_abi::{Command, Layout, Setup, Span, Toast, Variant, v2};

pub const ID: &str = "example.twin";
pub const CARDS: usize = 6;

pub fn setup(setup: &mut Setup) -> Result<(), String> {
    let values = Rc::new(RefCell::new(vec![0u32; CARDS]));
    let bumped = values.clone();
    setup.command(command("twin.bump"), move |_, input| {
        let card = input.and_then(|input| input.parse::<usize>().ok()).unwrap_or(0) % CARDS;
        bumped.borrow_mut()[card] += 1;
    });
    setup.command(command("twin.toast"), |host, _| host.toast(Toast::new(Variant::Info, "the twin says hi")));
    setup.command(command("twin.throw"), |_, _| panic!("the twin's command threw"));
    let viewed = values.clone();
    let surface = v2::Surface::new("twin", v2::Place::Route("twin".into()), move |cx| view(&viewed.borrow(), cx));
    setup.surface(surface);
    Ok(())
}

fn view(values: &[u32], cx: &mut v2::View<'_>) -> v2::Node {
    let cards = values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            cx.memo(format!("card-{index}"), *value, |cx| {
                let patch = format!("@@ -1 +1 @@\n-card {index}\n+card {index} is {value}\n");
                v2::Node::column(vec![
                    v2::Node::text(vec![Span::new(format!("card {index}: {value}"))]).fg("text.muted"),
                    v2::Node::Diff {
                        id: None,
                        content: v2::Source::Content(cx.content(patch)),
                        view: v2::DiffView::Unified,
                        filetype: None,
                        hunks: None,
                        wrap: Default::default(),
                        padding: 0,
                    },
                ])
            })
        })
        .collect();
    let total: u32 = values.iter().sum();
    // The width it was built for: a revision built for another size shows (review bigboi-7).
    let header = v2::Node::text(vec![Span::new(format!("twin {total} · {}", cx.input.width))]).with_id("header");
    let cards = v2::Node::scroll(cards).with_id("cards").layout(Layout::default().grow());
    v2::Node::column(vec![header, cards]).with_id("twin").layout(Layout::default().grow())
}

fn command(name: &str) -> Command {
    Command { name: name.to_owned(), title: name.to_owned(), ..Command::default() }
}
