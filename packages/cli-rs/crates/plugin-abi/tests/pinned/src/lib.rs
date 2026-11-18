//! An author's plugin, pinned to the source of the 2.0 SDK (big-boi 14, carbon-4). `tests/sdk.rs` builds it as an
//! outside crate against this SDK, and against what a later 2.x adds (the SDK's `next` feature: a node kind and an
//! event kind more). Do not edit it to follow the SDK: a change this crate would need is a break of the 2.x source
//! promise (`README.md`, "Source compatibility within 2.x").
//!
//! A route whose every mount keeps a pad of its own. A key counts in the mount it is pressed in, an edit keeps that
//! mount's draft, the layout tells the mount its width, a note is content the view gives the host and releases when
//! it changes, a worker thread ticks through the mailbox, a mount's end drops its pad, and an event of a kind a later
//! host sends is followed rather than refused.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::time::Duration;

use opencode_plugin_abi::interact::{Bind, Event, Handled, Layer};
use opencode_plugin_abi::v2::{self, ContentRef, LayoutReply, Node, Notify, Place, Source, Surface};
use opencode_plugin_abi::{Command, Host, Layout, Setup, Span, Toast, Variant, plugin};

/// What one mount shows.
#[derive(Default)]
struct Pad {
    draft: String,
    keys: u32,
    width: i32,
    /// The note the host holds for the mount, with the text it was given from.
    note: Option<(String, ContentRef)>,
}

#[derive(Default)]
struct Model {
    /// Each mount's pad, by its generation: two mounts of the route with the same tree keep their own.
    pads: BTreeMap<u64, Pad>,
    ticks: u64,
    /// Events of a kind this plugin does not know.
    later: u32,
}

thread_local! {
    static MODEL: RefCell<Model> = RefCell::default();
}

fn model<T>(f: impl FnOnce(&mut Model) -> T) -> T {
    MODEL.with(|model| f(&mut model.borrow_mut()))
}

fn setup(setup: &mut Setup) -> Result<(), String> {
    let ticks = setup.messages(|_: &dyn Host, tick: u64| model(|model| model.ticks = tick))?;
    setup.spawner().spawn("ticker", move |stop| {
        let mut tick = 0;
        while !stop.stopped() && ticks.replace("tick", tick).is_ok() {
            tick += 1;
            std::thread::sleep(Duration::from_millis(250));
        }
    })?;
    let abi = setup.abi();
    let version = Command::new("pinned.version").palette();
    setup.command(version, move |host, _| {
        let later = model(|model| model.later);
        host.toast(Toast::new(Variant::Info, format!("ABI {}.{}, {later} later events", abi.major, abi.minor)));
    });
    let surface = Surface::new("pad", Place::Route("pad".to_owned()), view)
        .layers(vec![Layer::default().keys(vec![Bind::new("k", "count")])])
        .layout(vec![Notify::Node { id: "say".to_owned() }], |geometry| {
            if let (Some(mount), Some(rect)) = (&geometry.mount, geometry.rect("say")) {
                model(|model| model.pads.entry(mount.generation).or_default().width = rect.width);
            }
            LayoutReply::default()
        })
        .mounts()
        .on(handle);
    setup.surface(surface);
    Ok(())
}

fn view(cx: &mut v2::View<'_>) -> Node {
    let generation = cx.mount.generation;
    let (draft, keys, width, ticks, note) = model(|model| {
        let ticks = model.ticks;
        let pad = model.pads.entry(generation).or_default();
        (pad.draft.clone(), pad.keys, pad.width, ticks, pad.note.clone())
    });
    // The note is content the host holds for the mount: a new text gives new content and releases the old.
    let text = format!("{keys} keys in this pad");
    let note = match note {
        Some((shown, handle)) if shown == text => handle,
        old => {
            if let Some((_, handle)) = old {
                cx.release(handle);
            }
            let handle = cx.content(text.clone());
            model(|model| model.pads.entry(generation).or_default().note = Some((text, handle)));
            handle
        }
    };
    Node::column(vec![
        Node::input(draft).with_id("say").placeholder("say something"),
        Node::markdown(Source::Content(note)).with_id("note"),
        Node::text(vec![Span::new(format!("width {width}, tick {ticks}"))]).with_id("status"),
    ])
    .layout(Layout::default().grow())
    .with_id("pad")
}

fn handle(host: &dyn Host, event: &Event) -> Handled {
    let mount = host.mount();
    let pad = |f: &dyn Fn(&mut Pad)| {
        if let Some(mount) = &mount {
            model(|model| f(model.pads.entry(mount.generation).or_default()));
        }
    };
    match event {
        Event::Key(key) if key.bind.as_deref() == Some("count") => {
            pad(&|pad| pad.keys += 1);
            Handled::Consume
        }
        Event::Change { text, .. } => {
            pad(&|pad| pad.draft = text.clone());
            Handled::Pass
        }
        Event::Mount { mount, mounted: false, .. } => {
            model(|model| model.pads.remove(&mount.generation));
            Handled::Pass
        }
        // A kind of event a later host sends: followed, and passed on.
        _ => {
            model(|model| model.later += 1);
            Handled::Pass
        }
    }
}

plugin!(id = "example.pinned", setup);
