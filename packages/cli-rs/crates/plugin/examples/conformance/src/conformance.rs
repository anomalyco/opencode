//! Reference plugin for ABI transcript recording and replay. Keep its behavior in sync with the C implementation in
//! `plugin.c`.

use std::cell::Cell;
use std::rc::Rc;

use opencode_plugin_abi::canvas::{List, Style};
use opencode_plugin_abi::interact::{
    self, Anchor, Bind, Edge, Handled, Interact, LayerScope, OpenPanel, Overlay, PointerKind,
};
use opencode_plugin_abi::{
    Action, Alert, Command, Confirm, Dialog, Host, Layout, PanelSize, Prompt, Select, SelectOption, Setup, Span,
    ThemeMode, Toast, Variant, Width, claim, v2,
};

#[derive(Default)]
struct State {
    views: Cell<u32>,
    messages: Cell<u32>,
    dup: Cell<bool>,
    /// The next view of `conf` holds a fence node.
    fenced: Cell<bool>,
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
    let command = |name: &str| Command::new(name).title(name);
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
    setup.command(command("conf.panic"), |host, _| -> () {
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
        host.focus("field");
        let field = host.focused().node.unwrap_or_else(|| "none".to_owned());
        host.blur();
        host.open_panel(OpenPanel::new("rows"));
        host.close_panel("rows");
        let anchor = Anchor::Edge(Edge::Top);
        host.overlay(Overlay::new("rows", anchor, 10, 3));
        host.close_overlay("rows");
        let mode = mode.unwrap_or_else(|| "none".to_owned());
        host.toast(Toast::new(Variant::Info, format!("ui {} {} {mode} {field}", focused.surface, rect.is_some())));
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
    let layer = interact::Layer::default()
        .scope(LayerScope::Global)
        .keys(vec![Bind::new("ctrl+g", "conf"), Bind::new("ctrl+o", "pass")])
        .paste();
    setup.layer(layer, handle);
    setup.search("conf.find", |_, query, options| {
        options.iter().filter(|option| option.title.contains(query)).map(|option| option.value.clone()).collect()
    });
    setup.claim(claim::Claim::fence("conf-fence", |view, part| match part {
        claim::Part::Fence(fence) => {
            let label = v2::Node::text(vec![Span::new(format!("fence {}", fence.language))]);
            let code =
                view.or(v2::Node::fence(), |_| v2::Node::text(vec![Span::new(format!("fenced {}", fence.code))]));
            Some(v2::Node::column(vec![label, code]).with_id("fence"))
        }
        _ => None,
    }));
    setup.claim(claim::Claim::fence("conf-fences", |_, _| {
        let label = v2::Node::text(vec![Span::new("fences")]);
        Some(v2::Node::column(vec![label, v2::Node::fence(), v2::Node::fence()]).with_id("fences"))
    }));
    // On a host without `focus-input` the field takes the focus from the user's click alone: the plugin says so.
    setup.command(command("conf.field"), |host, _| match host.abi().has_feature(opencode_plugin_abi::FOCUS_INPUT) {
        true => host.focus("field"),
        false => host.toast(Toast::new(Variant::Info, "field needs a click")),
    });
    let fencing = state.clone();
    setup.command(command("conf.fence"), move |_, _| fencing.fenced.set(true));
    setup.command(command("conf.dialogs"), |host, _| {
        let action = Action::command("conf.toast");
        let option = SelectOption::new("one", "1");
        let select = Select::new("pick", vec![option], action.clone()).size(PanelSize::XLarge);
        host.dialog(Dialog::Select(select.centered()));
        let alert = Alert::new("told", "said").size(PanelSize::XLarge).centered();
        host.dialog(Dialog::Alert(alert));
        host.dialog(Dialog::Confirm(Confirm::new("asked", "sure?", action).centered()));
    });
    let claims = state.clone();
    setup.claim(claim::Claim::tool("conf-tool", move |view, _| {
        claims.claimed.set(claims.claimed.get() + 1);
        let handle = view.content(format!("claimed {}", claims.claimed.get()));
        Some(v2::Node::markdown(v2::Source::Content(handle)).with_id("claim"))
    }));
    setup.on_wake(|host| host.toast(Toast::new(Variant::Info, "woken")));
    setup.command(command("conf.plugins"), |host, _| plugins(host, "plugins"));
    setup.command(command("conf.facts").slash("conf-facts").aliases(["cf".to_owned()]), |host, _| {
        let locale = host.info().locale.unwrap_or_default();
        let (offset, measure) = (host.utc_offset(0), host.measure("ab日"));
        let facts = format!("facts {locale} {offset} {} {}", measure.cells, measure.graphemes);
        host.toast(Toast::new(Variant::Info, facts));
        let ask = Prompt::new("name", Action::command("conf.toast")).value("conf").description("described");
        host.dialog(Dialog::Prompt(ask));
    });
    setup.on_plugins(|host| plugins(host, "plugins changed"));
    let shown = state.clone();
    setup.surface(v2::Surface::new("conf", v2::Place::Route("conf".to_owned()), move |view| {
        state.views.set(state.views.get() + 1);
        let line = format!("views {}, messages {}", state.views.get(), state.messages.get());
        let count = || v2::Node::text(vec![Span::new(line.clone())]).with_id("count");
        let second = match (state.dup.get(), state.fenced.get()) {
            (true, _) => count(),
            (_, true) => v2::Node::fence(),
            _ => view.memo("fixed", (), |view| {
                let handle = view.content("# fixed");
                v2::Node::markdown(v2::Source::Content(handle))
            }),
        };
        v2::Node::column(vec![count(), second]).with_id("root")
    }));
    let drawn = pad.clone();
    let canvas = v2::Surface::new("pad", v2::Place::Route("pad".to_owned()), move |_| {
        let size = Layout::default().width(Width::Cells(20)).height(Width::Cells(1));
        v2::Node::column(vec![v2::Node::canvas("pad").version(pad.pads.get()).layout(size)]).with_id("pad-root")
    });
    setup.surface(canvas.draw(move |draw| {
        drawn.draws.set(drawn.draws.get() + 1);
        // `first`, `resized`, `version` or `animate`, and a cause a later host adds by its own name.
        let cause = format!("{:?}", draw.frame.cause).to_lowercase();
        let mut list = List::new();
        list.text(0, 0, &format!("draw {} {cause}", drawn.draws.get()), Style::new());
        Some(list)
    }));
    setup.surface(rows());
    setup.surface(kept(shown));
    Ok(())
}

fn kept(state: Rc<State>) -> v2::Surface {
    v2::Surface::new("kept", v2::Place::Route("kept".to_owned()), move |view| {
        let bumps = state.bumps.get();
        if !view.input.changed.all && state.shown.get() == Some(bumps) {
            return v2::Node::keep("kept-root");
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
            .interact(Interact::default().pointer());
        let where_ = v2::Node::text(vec![Span::new("where")]).with_id("where");
        let field = v2::Node::input("").with_id("field");
        v2::Node::column(vec![where_, button, items, field]).with_id("rows-root")
    });
    let notify = vec![v2::Notify::Scroll { id: "items".to_owned() }];
    surface
        .layout(notify, |geometry| {
            let down = geometry.scrolls.iter().any(|(id, state)| id == "items" && state.offset > 0);
            let paints = match down {
                true => vec![v2::Paint::new("where", "#203040")],
                false => Vec::new(),
            };
            paints.into_iter().fold(v2::LayoutReply::default(), |reply, paint| reply.paint(paint.node, paint.bg))
        })
        .on(handle)
}

/// The handler of `rows` and of the layer of setup.
fn handle(host: &dyn Host, event: &interact::Event) -> Handled {
    let (said, handled) = match event {
        interact::Event::Key(key) if key.bind.as_deref() == Some("conf") => ("key conf".to_owned(), Handled::Consume),
        interact::Event::Paste { text, .. } => (format!("paste {text}"), Handled::Consume),
        interact::Event::Pointer(pointer) if pointer.kind == PointerKind::Down => {
            (format!("pressed {}", pointer.node), Handled::Consume)
        }
        interact::Event::Scroll { event: v2::ScrollEvent::Landed { anchor, .. }, .. } => {
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

fn plugins(host: &dyn Host, said: &str) {
    let list = host.plugins();
    let key = list.first().map_or("", |entry| entry.key.as_str());
    host.toast(Toast::new(Variant::Info, format!("{said} {} {key}", list.len())));
}
