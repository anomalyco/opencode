//! The sample's sidebar claim, on the one API (ABI 1.4). It reads its session, the session's messages and the
//! selected model, and draws boxes and text. The loader's tests also compile this file into the host and run it in
//! process, so the same claim is proven on both paths.

use opencode_plugin_abi::{Node, Placement, Render, Setup, Span};

pub fn setup(setup: &mut Setup) -> Result<(), String> {
    setup.slot(Placement::append("sidebar.content"), |read, input, changed| {
        let Some(session) = input.session_id.as_deref() else {
            return Render::Hide;
        };
        if !(changed.all || changed.session(session) || changed.list(session)) {
            return Render::Keep;
        }
        let title = read.session(session).and_then(|session| session.info.title).unwrap_or_default();
        let mut count = 0;
        read.messages(session, &mut |messages| count = messages.len());
        let model = read.model().map_or("no model".to_owned(), |model| format!("{}/{}", model.provider_id.0, model.id));
        Render::Show(Node::column(vec![
            Node::text([Span::new(format!("{title}: {count} messages")).bold()]),
            Node::row(vec![Node::text([Span::new(model).fg("text.muted")])]),
        ]))
    });
    Ok(())
}
