//! The sample's home claims and event handler, on the one API (ABI 1.4). When a session's run succeeds, it shows a
//! toast about that session, which the host offers to open, and counts it. Its `home.footer` claim draws once and
//! nests the `home.footer.status` slot, where its other claim shows the count; the host keeps rendering that nested
//! claim while the outer one keeps what it shows. The loader's tests also compile this file into the host and run it
//! in process, so the same claims are proven on both paths.

use std::cell::Cell;
use std::rc::Rc;

use opencode_plugin_abi::types::V2Event;
use opencode_plugin_abi::{Node, Placement, Render, Setup, Span, Toast, Variant};

pub fn setup(setup: &mut Setup) -> Result<(), String> {
    let done = Rc::new(Cell::new(0u64));
    let counted = done.clone();
    setup.on_event(&["session.execution.succeeded"], move |host, event| {
        let V2Event::SessionExecutionSucceeded(event) = event else { return };
        counted.set(counted.get() + 1);
        let session = event.data.session_id.0.clone();
        host.toast(Toast::new(Variant::Info, format!("sample: {session} is done")).session(session));
    });
    setup.slot(Placement::append("home.footer"), |_, _, changed| match changed.all {
        true => Render::Show(
            Node::row(vec![Node::text([Span::new("sample home:")]), Node::slot("home.footer.status")]).gap(1),
        ),
        false => Render::Keep,
    });
    setup.slot(Placement::append("home.footer.status"), move |_, _, _| {
        Render::Show(Node::text([Span::new(format!("{} done", done.get())).fg("text.muted")]))
    });
    Ok(())
}
