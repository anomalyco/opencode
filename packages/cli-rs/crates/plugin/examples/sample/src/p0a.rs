//! What ABI 1.5 adds (P0a): a confirm and an alert whose answers come back as toasts, the composer's read and
//! edits, and a home footer claim in a styled box. The TUI's tests run this one file linked, through the C ABI's
//! byte shims, and in the sample library (`--features p0a`), so the three carriers run the same source. Every
//! command is hidden: a test or a click dispatches it.

use super::abi::{
    Action, Alert, Border, BorderStyle, Command, ComposerEdit, Confirm, ConfirmLabel, Dialog, Edges, Host, Layout,
    Node, Overflow, Placement, Render, Setup, Sides, Span, TitleAlign, Toast, Variant, Width,
};

pub fn setup(setup: &mut Setup) -> Result<(), String> {
    let hidden = |name: &str| Command { name: name.to_owned(), ..Command::default() };
    setup.command(hidden("p0a.confirm"), |host, _| confirm(host));
    setup.command(hidden("p0a.alert"), |host, _| alert(host));
    setup.command(hidden("p0a.answered"), |host, input| toast(host, format!("answered {}", input.unwrap_or("-"))));
    setup.command(hidden("p0a.closed"), |host, _| toast(host, "alert closed".to_owned()));
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
    // Every effect 1.5 adds, in one call; with the input `panic` the call panics after them, so none may happen.
    setup.command(hidden("p0a.all"), |host, input| {
        host.edit_composer(ComposerEdit::Set { text: "all".to_owned() });
        host.edit_composer(ComposerEdit::Insert { text: " of it".to_owned() });
        host.edit_composer(ComposerEdit::Submit);
        confirm(host);
        alert(host);
        if input == Some("panic") {
            panic!("p0a panicked after its effects");
        }
    });
    setup.slot(Placement::append("home.footer"), |_, _, _| Render::Show(styled()));
    Ok(())
}

fn confirm(host: &dyn Host) {
    host.dialog(Dialog::Confirm(Confirm {
        title: "Delete the draft?".to_owned(),
        message: "It cannot be undone.".to_owned(),
        label: ConfirmLabel { confirm: Some("delete".to_owned()), cancel: None },
        action: Action::Command { name: "p0a.answered".to_owned(), input: None },
    }));
}

fn alert(host: &dyn Host) {
    host.dialog(Dialog::Alert(Alert {
        title: "Heads up".to_owned(),
        message: "The plugin says hello.".to_owned(),
        action: Some(Action::Command { name: "p0a.closed".to_owned(), input: None }),
    }));
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
            Layout { width: Some(Width::Cells(24)), ..Layout::default() }
                .height(Width::Cells(5))
                .max_height(Width::Cells(5))
                .min_height(Width::Cells(3))
                .margin(Edges::new(0, 0, 0, 2)),
        )
}
