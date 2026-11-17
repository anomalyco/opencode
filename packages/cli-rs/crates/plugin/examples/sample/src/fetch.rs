//! The sample's server request and live panel, on the one API. `sample.fetch` asks the server for
//! `/api/sample` through the host; the reply comes back to `on_reply`, and the sample's `home.footer` claim shows it.
//! `sample.panel` shows a panel, and shows it again with its key while it is open, so the host changes it in place. The
//! loader's tests also compile this file into the host and run it in process, so both paths are proven the same.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use opencode_plugin_abi::{
    Action, Command, Dialog, Fetch, Node, Panel, PanelAction, PanelBind, PanelSize, Placement, Render, RequestId,
    Setup, Span,
};

pub fn setup(setup: &mut Setup) -> Result<(), String> {
    let request: Rc<Cell<Option<RequestId>>> = Rc::default();
    let reply = Rc::new(RefCell::new("none".to_owned()));
    let asked = request.clone();
    setup.command(hidden("sample.fetch"), move |host, _| {
        let fetch = Fetch::default().with_method("GET".to_owned()).with_path("/api/sample".to_owned());
        asked.set(host.try_fetch(fetch).ok());
    });
    let answered = reply.clone();
    setup.on_reply(move |_, id, result| {
        if request.get() != Some(id) {
            return;
        }
        *answered.borrow_mut() = match result {
            Ok(value) => value.get("name").and_then(|name| name.as_str()).unwrap_or("?").to_owned(),
            Err(error) => format!("failed: {error}"),
        };
    });
    setup.slot(Placement::append("home.footer"), move |_, _, _| {
        Render::Show(Node::text([Span::new(format!("sample fetch: {}", reply.borrow()))]))
    });
    let shown = Rc::new(Cell::new(0u64));
    setup.command(hidden("sample.panel"), move |host, _| {
        shown.set(shown.get() + 1);
        let again = Action::Command { name: "sample.panel".to_owned(), input: None };
        host.dialog(Dialog::Panel(
            Panel::new(
                "live".to_owned(),
                vec![Span::new("Sample panel").bold()],
                Node::text([Span::new(format!("shown {} times", shown.get()))]),
            )
            .with_size(PanelSize::Medium)
            .with_actions(vec![PanelAction::new("again", again.clone()).with_key(Some("a".to_owned()))])
            .with_binds(vec![PanelBind::new("a", "Show again", again)])
            .with_centered(true),
        ));
    });
    Ok(())
}

fn hidden(name: &str) -> Command {
    Command::default().with_name(name.to_owned())
}
