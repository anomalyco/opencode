//! Dialogs, composer edits and a styled footer exercised through the linked and native carriers.

use super::abi::{
    Action, Alert, Border, BorderStyle, Command, ComposerEdit, Confirm, Dialog, Edges, Host, Layout, Node, Overflow,
    Placement, Read, Render, Setup, Sides, Span, TitleAlign, Toast, Variant, Waker, Width,
};

pub fn setup(setup: &mut Setup) -> Result<(), String> {
    setup.storage_key("log");
    let activation = {
        let host = setup.host();
        let started = log(host).iter().filter(|entry| entry.starts_with("setup ")).count() + 1;
        append(host, format!("setup {started}"));
        started
    };
    let hidden = |name: &str| Command::new(name);
    setup.command(hidden("p0a.confirm"), |host, _| confirm(host));
    setup.command(hidden("p0a.alert"), |host, _| alert(host, "p0a.closed"));
    // An alert whose action is another plugin's command.
    setup.command(hidden("p0a.alert-foreign"), |host, _| alert(host, "witness.ran"));
    setup.command(hidden("p0a.answered"), move |host, input| {
        append(host, format!("answered {} @{activation}", input.unwrap_or("-")));
        toast(host, format!("answered {}", input.unwrap_or("-")));
    });
    setup.command(hidden("p0a.closed"), move |host, _| {
        append(host, format!("closed @{activation}"));
        toast(host, "alert closed".to_owned());
    });
    // Disposal: two callbacks that log, around one that queues a set, a submit and an alert and then panics, once
    // `p0a.teardown` armed it. Disposers run last first.
    setup.command(hidden("p0a.teardown"), |host, _| append(host, "teardown armed".to_owned()));
    setup.on_dispose(move |host| append(host, format!("disposed first @{activation}")));
    setup.on_dispose(|host| {
        // Armed in this activation: after its own `setup` entry.
        let log = log(host);
        let armed = log.iter().rposition(|entry| entry == "teardown armed");
        if armed > log.iter().rposition(|entry| entry.starts_with("setup ")) {
            host.edit_composer(ComposerEdit::Set { text: "teardown edit".to_owned() });
            host.edit_composer(ComposerEdit::Submit);
            alert(host, "p0a.closed");
            append(host, "teardown wrote".to_owned());
            panic!("p0a's disposer panicked");
        }
    });
    setup.on_dispose(move |host| append(host, format!("disposed last @{activation}")));
    setup.command(hidden("p0a.read"), |host, _| {
        let read = match host.composer() {
            Some(composer) => {
                format!("composer {:?} at {}, focused {}", composer.text, composer.cursor, composer.focused)
            }
            None => "no composer".to_owned(),
        };
        toast(host, read);
    });
    setup.command(hidden("p0a.set"), |host, input| {
        host.edit_composer(ComposerEdit::Set { text: input.unwrap_or_default().to_owned() });
    });
    setup.command(hidden("p0a.insert"), |host, input| {
        host.edit_composer(ComposerEdit::Insert { text: input.unwrap_or_default().to_owned() });
    });
    setup.command(hidden("p0a.submit"), |host, _| host.edit_composer(ComposerEdit::Submit));
    setup.command(hidden("p0a.send"), |host, input| {
        host.edit_composer(ComposerEdit::Set { text: input.unwrap_or_default().to_owned() });
        host.edit_composer(ComposerEdit::Submit);
    });
    // The panic branch must discard every requested effect.
    setup.command(hidden("p0a.all"), |host, input| {
        host.edit_composer(ComposerEdit::Set { text: "all".to_owned() });
        host.edit_composer(ComposerEdit::Insert { text: " of it".to_owned() });
        host.edit_composer(ComposerEdit::Submit);
        alert(host, "p0a.closed");
        confirm(host);
        if input == Some("panic") {
            panic!("p0a panicked after its effects");
        }
    });
    // A file change of `src/set.rs` sets the composer, and one of `src/read.rs` logs what the composer holds.
    setup.on_event(&["filesystem.changed"], |host, event| {
        let event = serde_json::to_value(event).unwrap_or_default();
        match event["data"]["file"].as_str() {
            Some("src/set.rs") => host.edit_composer(ComposerEdit::Set { text: "from an event".to_owned() }),
            Some("src/read.rs") => {
                append(host, format!("read {}", host.composer().map(|it| it.text).unwrap_or_default()))
            }
            _ => {}
        }
    });
    // A wake logs what the composer holds; `p0a.wake` wakes the host as the plugin's own thread would.
    let waker = setup.waker();
    setup.command(hidden("p0a.wake"), move |_, _| waker.iter().for_each(Waker::wake));
    setup.on_wake(|host| append(host, format!("woke {}", host.composer().map(|it| it.text).unwrap_or_default())));
    setup.slot(Placement::append("home.footer"), |_, _, _| Render::Show(styled()));
    Ok(())
}

fn confirm(host: &dyn Host) {
    let action = Action::command("p0a.answered");
    host.dialog(Dialog::Confirm(
        Confirm::new("Delete the draft?", "It cannot be undone.", action).labels("delete", "keep"),
    ));
}

fn alert(host: &dyn Host, then: &str) {
    let action = Action::command(then);
    host.dialog(Dialog::Alert(Alert::new("Heads up", "The plugin says hello.").action(action)));
}

/// The probe's log.
pub fn log(host: &dyn Read) -> Vec<String> {
    let log = host.storage_get("log").and_then(|log| serde_json::from_value(log).ok());
    log.unwrap_or_default()
}

fn append(host: &dyn Host, entry: String) {
    let mut log = log(host);
    log.push(entry);
    host.storage_set("log", serde_json::json!(log));
}

fn toast(host: &dyn Host, message: String) {
    host.toast(Toast::new(Variant::Info, message));
}

/// A rounded box with a centered title and a left rule inside it, padded per side, with a margin, a fixed height and
/// wrapping children.
pub fn styled() -> Node {
    let rule = Node::row(vec![Node::text([Span::new("ruled")])])
        .border(Border::new().sides(Sides { left: true, ..Sides::NONE }).style(BorderStyle::Heavy).color("text.muted"))
        .padding_sides(Edges::new(0, 0, 0, 1));
    let chips = ["alpha", "beta", "gamma", "delta"].map(|chip| Node::text([Span::new(chip)]));
    Node::column(vec![rule, Node::row(chips.to_vec()).gap(1).flex_wrap()])
        .border(
            Border::new().style(BorderStyle::Rounded).color("border.base").title("p0a").title_align(TitleAlign::Center),
        )
        .padding_sides(Edges::new(0, 1, 0, 2))
        .overflow(Overflow::Hidden)
        .layout(
            Layout::default()
                .width(Width::Cells(24))
                .height(Width::Cells(5))
                .max_height(Width::Cells(5))
                .min_height(Width::Cells(3))
                .margin(Edges::new(0, 0, 0, 2)),
        )
}
