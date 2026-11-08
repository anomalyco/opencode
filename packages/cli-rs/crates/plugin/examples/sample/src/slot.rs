//! The sample's sidebar claim, on the one API (ABI 1.4). It reads its session, the session's messages and the
//! selected model, and draws boxes and text. A line counts its clicks: it brightens under the pointer, and a click
//! dispatches a hidden command with the session ID as its input, which stores the count; the claim reads it back
//! when the host tells it the storage changed. The loader's tests also compile this file into the host and run it in
//! process, so the same claim is proven on both paths.

use opencode_plugin_abi::{Click, Command, Node, Placement, Render, Setup, Span};
use serde_json::json;

pub fn setup(setup: &mut Setup) -> Result<(), String> {
    setup.storage_key("clicks");
    setup.command(Command { name: "sample.clicked".to_owned(), ..Command::default() }, |host, input| {
        let count = clicks(host) + 1;
        host.storage_set("clicks", json!({ "count": count, "input": input }));
    });
    setup.slot(Placement::append("sidebar.content"), |read, input, changed| {
        let Some(session) = input.session_id.as_deref() else {
            return Render::Hide;
        };
        if !(changed.all || changed.local || changed.session(session) || changed.list(session)) {
            return Render::Keep;
        }
        let title = read.session(session).and_then(|session| session.info.title).unwrap_or_default();
        let mut count = 0;
        read.messages(session, &mut |messages| count = messages.len());
        let model = read.model().map_or("no model".to_owned(), |model| format!("{}/{}", model.provider_id.0, model.id));
        Render::Show(Node::column(vec![
            Node::text([Span::new(format!("{title}: {count} messages")).bold()]),
            Node::row(vec![Node::text([Span::new(model).fg("text.muted")])]),
            Node::text([Span::new(format!("{} clicks", clicks(read)))])
                .fg("text.muted")
                .hover_fg("text.base")
                .on_click(Click::command("sample.clicked", Some(session.to_owned()))),
        ]))
    });
    Ok(())
}

/// The stored `{"count":N}`, else 0.
fn clicks(read: &dyn opencode_plugin_abi::Read) -> u64 {
    read.storage_get("clicks").and_then(|value| value.get("count")?.as_u64()).unwrap_or(0)
}
