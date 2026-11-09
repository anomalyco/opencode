//! The sample's prompt footer claim, on the one API (ABI 1.4). Each mount of it fetches `/api/sample/<session>` from
//! its `on_mount`, and the claim shows the mounts alive, the reply, whether the session pane owns the input (on or off),
//! and the key of `command.palette.show`. The loader's tests also compile this file into the host and run it in process, so both
//! paths are proven the same.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use opencode_plugin_abi::{Fetch, Node, Placement, Render, RequestId, Setup, Span};

pub fn setup(setup: &mut Setup) -> Result<(), String> {
    let mounts = Rc::new(Cell::new(0usize));
    let asked: Rc<RefCell<HashMap<RequestId, String>>> = Rc::default();
    let replies: Rc<RefCell<HashMap<String, String>>> = Rc::default();
    let (alive, shown) = (mounts.clone(), replies.clone());
    setup.slot(Placement::append("prompt.footer"), move |read, input, _| {
        let session = input.session_id.as_deref().unwrap_or("none");
        let reply = shown.borrow().get(session).cloned().unwrap_or_else(|| "waiting".to_owned());
        let interactive = if read.interactive() { "on" } else { "off" };
        let key = read.shortcut("command.palette.show").unwrap_or_else(|| "no key".to_owned());
        let text = format!("sample prompt: {} mounts, {reply}, {interactive}, {key}", alive.get());
        Render::Show(Node::text([Span::new(text)]))
    });
    let fetched = asked.clone();
    setup.on_mount(Placement::append("prompt.footer"), move |host, input, mounted| {
        if !mounted {
            mounts.set(mounts.get() - 1);
            return;
        }
        mounts.set(mounts.get() + 1);
        let session = input.session_id.clone().unwrap_or_default();
        let fetch = Fetch { method: "GET".to_owned(), path: format!("/api/sample/{session}"), ..Fetch::default() };
        fetched.borrow_mut().insert(host.fetch(fetch), session);
    });
    setup.on_reply(move |_, id, result| {
        let Some(session) = asked.borrow_mut().remove(&id) else { return };
        let reply = match result {
            Ok(value) => value.get("name").and_then(|name| name.as_str()).unwrap_or("?").to_owned(),
            Err(error) => format!("failed: {error}"),
        };
        replies.borrow_mut().insert(session, reply);
    });
    Ok(())
}
