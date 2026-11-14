//! The conformance plugin (Pc): the behavior every golden transcript of `crates/plugin/conformance` was recorded from,
//! with this source linked into the loader's tests, and that a library must show to pass `plugin test --conformance`.
//! `plugin.c` beside this crate is the same plugin in C, on `opencode_plugin.h` alone. A change here is a change of
//! both, and of the transcripts, which the tests write again.
//!
//! - Commands: `conf.toast` toasts "hello"; `conf.store` writes 1 under its storage key `count`, reads it back and
//!   toasts "stored 1"; `conf.send` sends "ping", then "a" and "b" under the key `k`, and toasts "sent"; `conf.wake`
//!   wakes the host, whose wake toasts "woken"; `conf.panic` toasts "before panic" and panics with "boom"; `conf.dup`
//!   makes the next view hold the id `count` twice; `conf.read` toasts "read", the theme mode and whether the host is
//!   interactive; `conf.pad` moves the canvas `pad` to its next version; `conf.down` scrolls `items` by 2 rows,
//!   `conf.step` steps it to the next anchor of `items`, and `conf.where` toasts where it is (P3).
//! - A route surface `conf`: a column `root` of a text `count`, "views N, messages M" (the views run and the messages
//!   arrived, in this instance), and a Markdown node `fixed` of the content "# fixed", memoized: built once a mount and
//!   kept after.
//! - A route surface `pad` (P5): a column `pad-root` of a canvas `pad`, 20 by 1 cells, at the version `conf.pad`
//!   counts. Its draw writes one text at its corner, "draw N CAUSE", in the terminal's colors: the draws run in this
//!   instance, and why the host asked.
//! - A route surface `rows` (P3): a column `rows-root` of a text `where` and a scroll `items`, 3 rows high, of six boxes
//!   `i0` to `i5`, each an anchor of group `items` holding "item N". Its `layout` is told of `items`, and paints
//!   `where` on `#203040` while `items` is scrolled down; its scroll handler toasts "landed ID" where a step landed.
//! - Options that hold `fail-setup` make setup fail with "setup refused", before it registers anything.

use std::cell::Cell;
use std::rc::Rc;

use opencode_plugin_abi::canvas::{List, Style};
use opencode_plugin_abi::{Command, Host, Layout, Setup, Span, ThemeMode, Toast, Variant, Width, v2};

#[derive(Default)]
struct State {
    views: Cell<u32>,
    messages: Cell<u32>,
    dup: Cell<bool>,
    pads: Cell<u64>,
    draws: Cell<u32>,
}

pub fn setup(setup: &mut Setup) -> Result<(), String> {
    if setup.options().is_some_and(|options| options.contains("fail-setup")) {
        return Err("setup refused".to_owned());
    }
    let state = Rc::new(State::default());
    let command = |name: &str| Command { name: name.to_owned(), title: name.to_owned(), ..Command::default() };
    setup.storage_key("count");
    setup.command(command("conf.toast"), |host, _| host.toast(Toast::new(Variant::Success, "hello")));
    setup.command(command("conf.store"), |host, _| {
        host.storage_set("count", serde_json::json!(1));
        let stored = host.storage_get("count").map_or("nothing".to_owned(), |value| value.to_string());
        host.toast(Toast::new(Variant::Info, format!("stored {stored}")));
    });
    let (counted, pad) = (state.clone(), state.clone());
    let sender = Rc::new(setup.messages(move |_, _: String| counted.messages.set(counted.messages.get() + 1))?);
    setup.command(command("conf.send"), move |host, _| {
        let _ = sender.send("ping".to_owned());
        let _ = sender.replace("k", "a".to_owned());
        let _ = sender.replace("k", "b".to_owned());
        host.toast(Toast::new(Variant::Info, "sent"));
    });
    let waker = setup.waker();
    setup.command(command("conf.wake"), move |_, _| {
        if let Some(waker) = &waker {
            waker.wake();
        }
    });
    setup.command(command("conf.panic"), |host, _| {
        host.toast(Toast::new(Variant::Info, "before panic"));
        panic!("boom");
    });
    let duplicated = state.clone();
    setup.command(command("conf.dup"), move |_, _| duplicated.dup.set(true));
    setup.command(command("conf.read"), |host, _| {
        let mode = match host.theme_mode() {
            ThemeMode::Dark => "dark",
            ThemeMode::Light => "light",
        };
        host.toast(Toast::new(Variant::Info, format!("read {mode} {}", host.interactive())));
    });
    let padded = state.clone();
    setup.command(command("conf.pad"), move |_, _| padded.pads.set(padded.pads.get() + 1));
    let items = || v2::Target::node("rows", "items");
    setup.command(command("conf.down"), move |host, _| host.scroll(items(), v2::Scroll::By { rows: 2 }));
    setup.command(command("conf.step"), move |host, _| {
        host.scroll(items(), v2::Scroll::Step { group: "items".to_owned(), by: 1, inset: 0 });
    });
    setup.command(command("conf.where"), move |host, _| {
        let place = host.scroll_state(&items());
        let place = place.map_or("nowhere".to_owned(), |state| format!("offset {} of {}", state.offset, state.extent));
        host.toast(Toast::new(Variant::Info, place));
    });
    setup.on_wake(|host| host.toast(Toast::new(Variant::Info, "woken")));
    setup.surface(v2::Surface::new("conf", v2::Place::Route("conf".to_owned()), move |view| {
        state.views.set(state.views.get() + 1);
        let line = format!("views {}, messages {}", state.views.get(), state.messages.get());
        let count = || v2::Node::text(vec![Span::new(line.clone())]).with_id("count");
        let second = match state.dup.get() {
            true => count(),
            false => view.memo("fixed", (), |view| {
                let handle = view.content("# fixed");
                v2::Node::Markdown { id: None, source: v2::Source::Content(handle) }
            }),
        };
        v2::Node::column(vec![count(), second]).with_id("root")
    }));
    let drawn = pad.clone();
    let canvas = v2::Surface::new("pad", v2::Place::Route("pad".to_owned()), move |_| {
        let size = Layout { width: Some(Width::Cells(20)), height: Some(Width::Cells(1)), ..Layout::default() };
        v2::Node::column(vec![v2::Node::canvas("pad").version(pad.pads.get()).layout(size)]).with_id("pad-root")
    });
    setup.surface(canvas.draw(move |draw| {
        drawn.draws.set(drawn.draws.get() + 1);
        let cause = match draw.frame.cause {
            v2::Cause::First => "first",
            v2::Cause::Resized => "resized",
            v2::Cause::Version => "version",
            v2::Cause::Animate => "animate",
        };
        let mut list = List::new();
        list.text(0, 0, &format!("draw {} {cause}", drawn.draws.get()), Style::new());
        Some(list)
    }));
    setup.surface(rows());
    Ok(())
}

/// The surface `rows`: a scroll of anchored items, its `layout` and its scroll handler.
fn rows() -> v2::Surface {
    let surface = v2::Surface::new("rows", v2::Place::Route("rows".to_owned()), |_| {
        let item = |index: usize| {
            v2::Node::column(vec![v2::Node::text(vec![Span::new(format!("item {index}"))])])
                .with_id(format!("i{index}"))
                .anchor("items", "")
        };
        let mut items = v2::Node::scroll((0..6).map(item).collect()).with_id("items");
        if let v2::Node::Scroll { height, .. } = &mut items {
            *height = Some(3);
        }
        v2::Node::column(vec![v2::Node::text(vec![Span::new("where")]).with_id("where"), items]).with_id("rows-root")
    });
    let notify = vec![v2::Notify::Scroll { id: "items".to_owned() }];
    surface
        .layout(notify, |geometry| {
            let down = geometry.scrolls.iter().any(|(id, state)| id == "items" && state.offset > 0);
            let paints = match down {
                true => vec![v2::Paint { node: "where".to_owned(), bg: "#203040".into() }],
                false => Vec::new(),
            };
            v2::LayoutReply { paints, again: false }
        })
        .on_scroll(|host: &dyn Host, event| {
            if let v2::ScrollEvent::Landed { anchor, .. } = event {
                host.toast(Toast::new(Variant::Info, format!("landed {}", anchor.id)));
            }
        })
}
