//! Renders host reads in the footer and reports the results of host commands.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use opencode_plugin_abi::{
    Command, Dialog, Foreground, Node, Panel, PanelSize, Placement, Render, Setup, Span, TabEdit, Toast, Variant,
};
use serde_json::json;

pub fn setup(setup: &mut Setup) -> Result<(), String> {
    let deltas = Rc::new(Cell::new(0usize));
    let counted = deltas.clone();
    setup.on_deltas(move |_, events| counted.set(counted.get() + events.len()));
    // The foreground program's request and what its reply said.
    let program = Rc::new(Cell::new(None));
    let exited = Rc::new(RefCell::new(String::from("-")));
    let (asked, told) = (program.clone(), exited.clone());
    setup.on_reply(move |_, id, result| {
        if asked.get() == Some(id) {
            *told.borrow_mut() = match result {
                Ok(value) => value["code"].to_string(),
                Err(error) => error,
            };
        }
    });
    setup.command(Command::new("sample.verbs").title("Sample verbs"), move |host, _| {
        let answers = [
            host.set_variant(Some("high")),
            host.set_variant(Some("none")),
            host.edit_tab(TabEdit::Focus { session: "ses_1".to_owned() }),
            host.edit_tab(TabEdit::Close { session: None }),
            host.set_theme("nord"),
            host.set_theme("none"),
        ];
        host.set_model("opencode", "small");
        host.clear_selection();
        host.set_title("sample title");
        host.install_theme("sample", json!({ "theme": {} }));
        program.set(host.try_foreground(Foreground::new("true").args(vec!["a".to_owned()])).ok());
        let answers: Vec<String> = answers.iter().map(bool::to_string).collect();
        host.toast(Toast::new(Variant::Info, format!("sample verbs: {}", answers.join(" "))));
        host.dialog(Dialog::Panel(
            Panel::new(
                "wide".to_owned(),
                vec![Span::new("Wide")],
                Node::text([Span::new("docs").link("https://opencode.ai/docs")]),
            )
            .size(PanelSize::XLarge),
        ));
    });
    setup.slot(Placement::append("home.footer"), move |read, input, changed| {
        let tabs: Vec<String> =
            read.tabs().iter().map(|tab| format!("{}{}", tab.session_id, if tab.active { "*" } else { "" })).collect();
        let pending = read.keymap_pending().iter().map(|key| key.key.clone()).collect::<Vec<_>>().join(" ");
        let text = format!(
            "sample reads: {}x{}{}, {} {}, tabs {} {}, keys {} [{}] {} {}, sel {}, theme {} of {}, deltas {}, exit {}",
            input.width,
            input.height,
            if changed.size { " resized" } else { "" },
            read.model().and_then(|model| model.variant).unwrap_or_else(|| "default".to_owned()),
            read.variants().join("+"),
            read.tabs_enabled(),
            tabs.join(","),
            read.shortcuts("command.palette.show").join(","),
            pending,
            read.keymap_active().len(),
            read.keymap_commands().len(),
            read.selection().unwrap_or_else(|| "-".to_owned()),
            read.theme().unwrap_or_default(),
            read.themes().len(),
            deltas.get(),
            exited.borrow(),
        );
        Render::Show(Node::text([Span::new(text).link("https://opencode.ai")]))
    });
    setup.sized(Placement::append("home.footer"));
    Ok(())
}
