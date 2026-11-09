//! The sample's server request and live panel, on the one API (ABI 1.4). `sample.fetch` asks the server for
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
        let fetch = Fetch { method: "GET".to_owned(), path: "/api/sample".to_owned(), ..Fetch::default() };
        asked.set(Some(host.fetch(fetch)));
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
        host.dialog(Dialog::Panel(Panel {
            key: "live".to_owned(),
            size: PanelSize::Medium,
            title: vec![Span::new("Sample panel").bold()],
            subtitle: None,
            body: Node::text([Span::new(format!("shown {} times", shown.get()))]),
            actions: vec![PanelAction {
                title: "again".to_owned(),
                key: Some("a".to_owned()),
                color: None,
                close: false,
                action: again.clone(),
            }],
            binds: vec![PanelBind { key: "a".to_owned(), title: "Show again".to_owned(), action: again }],
            bleed: false,
        }));
    });
    Ok(())
}

fn hidden(name: &str) -> Command {
    Command { name: name.to_owned(), ..Command::default() }
}
