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
//!   `conf.step` steps it to the next anchor of `items`, and `conf.where` toasts where it is (P3); `conf.ui` makes
//!   each verb and read of P2 once (focus, the focus read, a rect, a mode and its read, releasing held keys, a blur,
//!   a panel and an overlay opened and closed) and toasts what the reads answered; `conf.bump` changes what `kept`
//!   shows; `conf.message` reads message `msg_1` of session `ses_a` and toasts "message ID", or "message none" (P6a);
//!   `conf.plugins` reads the plugin list and toasts "plugins N KEY", its length and its first entry's key (P6b).
//! - It hears that the plugin list changed (P6b), and toasts "plugins changed N KEY" from the list read then.
//! - A route surface `conf`: a column `root` of a text `count`, "views N, messages M" (the views run and the messages
//!   arrived, in this instance), and a Markdown node `fixed` of the content "# fixed", memoized: built once a mount and
//!   kept after.
//! - A route surface `pad` (P5): a column `pad-root` of a canvas `pad`, 20 by 1 cells, at the version `conf.pad`
//!   counts. Its draw writes one text at its corner, "draw N CAUSE", in the terminal's colors: the draws run in this
//!   instance, and why the host asked.
//! - A route surface `rows` (P3): a column `rows-root` of a text `where` and a scroll `items`, 3 rows high, of six boxes
//!   `i0` to `i5`, each an anchor of group `items` holding "item N". Its `layout` is told of `items`, and paints
//!   `where` on `#203040` while `items` is scrolled down. Between `where` and `items`, a box `button` that takes the
//!   pointer (P2) holds "press".
//! - A route surface `kept` (P6a) that hears its mounts begin and end: a column `kept-root` of a text `kept`, "kept N"
//!   (the bumps), and a hidden box `hidden`. A view told nothing changed (not `all`) while N is what it last showed
//!   keeps its root.
//! - One handler of input (P2), for `rows`, `kept` and a key layer of setup (`ctrl+g` as `conf`, `ctrl+o` as `pass`,
//!   everywhere, with pastes): it toasts "key conf", "paste TEXT", "pressed NODE" (a press, not a release),
//!   "landed ID" (where a step landed) and "mount begins" or "mount ends", and consumes the first three; everything
//!   else passes on.
//! - A renderer claim (Pr) of the calls of tool `conf-tool`: Markdown of the content "claimed N", given anew in each
//!   view, N the views it ran; and one of the fences of language `conf-fence`: "fenced CODE".
//! - A search `conf.find` (P2): the values of the options whose title holds the query, in their order.
//! - Options that hold `fail-setup` make setup fail with "setup refused", before it registers anything.

use std::cell::Cell;
use std::rc::Rc;

use opencode_plugin_abi::canvas::{List, Style};
use opencode_plugin_abi::interact::{
    self, Anchor, Bind, Edge, Handled, Interact, LayerScope, OpenPanel, Overlay, PointerKind,
};
use opencode_plugin_abi::{Command, Host, Layout, Setup, Span, ThemeMode, Toast, Variant, Width, claim, v2};

#[derive(Default)]
struct State {
    views: Cell<u32>,
    messages: Cell<u32>,
    dup: Cell<bool>,
    pads: Cell<u64>,
    draws: Cell<u32>,
    claimed: Cell<u32>,
    bumps: Cell<u32>,
    /// The bumps `kept` showed last.
    shown: Cell<Option<u32>>,
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
    setup.command(command("conf.ui"), |host, _| {
        host.focus("i2");
        let focused = host.focused();
        let rect = host.rect("where");
        host.set_mode(Some("nav"));
        let mode = host.mode();
        host.release_keys();
        host.blur();
        host.open_panel(OpenPanel { surface: "rows".to_owned(), session: None, fullscreen: false });
        host.close_panel("rows");
        let anchor = Anchor::Edge(Edge::Top);
        host.overlay(Overlay { surface: "rows".to_owned(), anchor, width: 10, height: 3 });
        host.close_overlay("rows");
        let mode = mode.unwrap_or_else(|| "none".to_owned());
        host.toast(Toast::new(Variant::Info, format!("ui {} {} {mode}", focused.surface, rect.is_some())));
    });
    let bumped = state.clone();
    setup.command(command("conf.bump"), move |_, _| bumped.bumps.set(bumped.bumps.get() + 1));
    setup.command(command("conf.message"), |host, _| {
        let mut said = "message none".to_owned();
        host.message("ses_a", "msg_1", &mut |message| {
            if let Some(message) = message {
                said = format!("message {}", message.id());
            }
        });
        host.toast(Toast::new(Variant::Info, said));
    });
    let layer = interact::Layer {
        scope: LayerScope::Global,
        keys: vec![Bind::new("ctrl+g", "conf"), Bind::new("ctrl+o", "pass")],
        paste: true,
        ..interact::Layer::default()
    };
    setup.layer(layer, handle);
    setup.search("conf.find", |_, query, options| {
        options.iter().filter(|option| option.title.contains(query)).map(|option| option.value.clone()).collect()
    });
    setup.claim(claim::Claim::fence("conf-fence", |_, part| match part {
        claim::Part::Fence(fence) => {
            Some(v2::Node::text(vec![Span::new(format!("fenced {}", fence.code))]).with_id("fence"))
        }
        claim::Part::Tool(_) => None,
    }));
    let claims = state.clone();
    setup.claim(claim::Claim::tool("conf-tool", move |view, _| {
        claims.claimed.set(claims.claimed.get() + 1);
        let handle = view.content(format!("claimed {}", claims.claimed.get()));
        Some(v2::Node::Markdown { id: Some("claim".to_owned()), source: v2::Source::Content(handle) })
    }));
    setup.on_wake(|host| host.toast(Toast::new(Variant::Info, "woken")));
    setup.command(command("conf.plugins"), |host, _| plugins(host, "plugins"));
    setup.on_plugins(|host| plugins(host, "plugins changed"));
    let shown = state.clone();
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
    setup.surface(kept(shown));
    Ok(())
}

/// The surface `kept` (P6a): it keeps its root while what it shows is the same, and hears its mounts.
fn kept(state: Rc<State>) -> v2::Surface {
    v2::Surface::new("kept", v2::Place::Route("kept".to_owned()), move |view| {
        let bumps = state.bumps.get();
        if !view.input.changed.all && state.shown.get() == Some(bumps) {
            return v2::Node::Keep { key: "kept-root".to_owned() };
        }
        state.shown.set(Some(bumps));
        let shown = v2::Node::text(vec![Span::new(format!("kept {bumps}"))]).with_id("kept");
        let hidden = v2::Node::column(vec![v2::Node::text(vec![Span::new("hidden")])]).with_id("hidden").visible(false);
        v2::Node::column(vec![shown, hidden]).with_id("kept-root")
    })
    .mounts()
    .on(handle)
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
        let button = v2::Node::column(vec![v2::Node::text(vec![Span::new("press")])])
            .with_id("button")
            .interact(Interact { pointer: true, ..Interact::default() });
        let where_ = v2::Node::text(vec![Span::new("where")]).with_id("where");
        v2::Node::column(vec![where_, button, items]).with_id("rows-root")
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
        .on(handle)
}

/// The handler of `rows` and of the layer of setup.
fn handle(host: &dyn Host, event: &interact::Event) -> Handled {
    let (said, handled) = match event {
        interact::Event::Key(key) if key.bind.as_deref() == Some("conf") => ("key conf".to_owned(), Handled::Consume),
        interact::Event::Paste { text } => (format!("paste {text}"), Handled::Consume),
        interact::Event::Pointer(pointer) if pointer.kind == PointerKind::Down => {
            (format!("pressed {}", pointer.node), Handled::Consume)
        }
        interact::Event::Scroll { event: v2::ScrollEvent::Landed { anchor, .. } } => {
            (format!("landed {}", anchor.id), Handled::Pass)
        }
        interact::Event::Mount { mounted, .. } => {
            (format!("mount {}", if *mounted { "begins" } else { "ends" }), Handled::Pass)
        }
        _ => return Handled::Pass,
    };
    host.toast(Toast::new(Variant::Info, said));
    handled
}

/// `conf.plugins` and a change of the plugin list (P6b): what the list holds, said as `said N KEY`.
fn plugins(host: &dyn Host, said: &str) {
    let list = host.plugins();
    let key = list.first().map_or("", |entry| entry.key.as_str());
    host.toast(Toast::new(Variant::Info, format!("{said} {} {key}", list.len())));
}
