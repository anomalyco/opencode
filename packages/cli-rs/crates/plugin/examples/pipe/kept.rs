//! The linked twin of `kept/tui.ts`, for `carrier-equal` of the built-ins' contract (P6a) on the pipe: a route that
//! hears its mounts begin and end, keeps its root while what it shows is the same, holds a box it can hide, and shows
//! what a read of one message gives. The two are two programs; neither shares code with the host.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use opencode_plugin_abi::interact::{Event, Handled};
use opencode_plugin_abi::{Command, Setup, Span, v2};

pub const ID: &str = "example.kept";

#[derive(Default)]
struct State {
    bumps: Cell<u32>,
    hidden: Cell<bool>,
    begun: Cell<u32>,
    ended: Cell<u32>,
    /// What the last view that built showed.
    shown: RefCell<Option<String>>,
}

pub fn setup(setup: &mut Setup) -> Result<(), String> {
    let state = Rc::new(State::default());
    let bumped = state.clone();
    setup.command(command("kept.bump"), move |_, _| bumped.bumps.set(bumped.bumps.get() + 1));
    let hidden = state.clone();
    setup.command(command("kept.hide"), move |_, _| hidden.hidden.set(!hidden.hidden.get()));
    // Changes nothing: the view after it keeps its root, and its memo with it.
    setup.command(command("kept.same"), |_, _| {});
    let heard = state.clone();
    let surface = v2::Surface::new("kept", v2::Place::Route("kept".into()), move |cx| {
        let mut message = None;
        cx.read.message("ses_a", "msg_1", &mut |found| message = found.map(|found| found.id().to_owned()));
        let line = format!(
            "kept {} · begun {} · ended {} · message {}",
            state.bumps.get(),
            state.begun.get(),
            state.ended.get(),
            message.as_deref().unwrap_or("none")
        );
        let now = format!("{line} {}", state.hidden.get());
        if !cx.input.full && state.shown.borrow().as_deref() == Some(now.as_str()) {
            return v2::Node::Keep { key: "kept-root".into() };
        }
        *state.shown.borrow_mut() = Some(now);
        let extra = v2::Node::column(vec![v2::Node::text(vec![Span::new("extra")])])
            .with_id("extra")
            .visible(!state.hidden.get());
        let below = cx.memo("below", 0, |_| v2::Node::text(vec![Span::new("below")]));
        v2::Node::column(vec![v2::Node::text(vec![Span::new(line)]).with_id("kept"), extra, below]).with_id("kept-root")
    })
    .mounts()
    .on(move |_, event| {
        if let Event::Mount { mounted, .. } = event {
            let count = if *mounted { &heard.begun } else { &heard.ended };
            count.set(count.get() + 1);
        }
        Handled::Pass
    });
    setup.surface(surface);
    Ok(())
}

fn command(name: &str) -> Command {
    Command::default().with_name(name.to_owned()).with_title(name.to_owned())
}
