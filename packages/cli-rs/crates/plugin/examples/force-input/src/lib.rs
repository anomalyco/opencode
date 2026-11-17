//! A port of `@mynameistito/opencode-force-input` 1.1.20 (`dist/index.mjs`): `ctrl+enter` (and `ctrl+return`)
//! interrupts the running session and sends the prompt: it runs `session.interrupt` three times, OpenCode's guarded
//! interrupt, then `prompt.submit`. A hint says what enter does: `⏎ send` while the session is idle, `⏎ steer · ctrl+⏎
//! interrupt & send` while it runs; none in shell mode, on the home screen, or with the option `"hint": false`. As TS's,
//! it is claimed in the prompt footer and lifted two rows, into the right of the composer's own info row.

use opencode_plugin_abi::{
    Absolute, Command, Host, Layout, Node, Placement, Render, SessionStatus, Setup, Span, Wrap, export_plugin,
};

const INTERRUPT: &str = "session.interrupt";
/// The keys terminals send for Ctrl+Enter, each bound by a command of its own.
const BINDS: [(&str, &str); 2] =
    [("ctrl+return", "oc-ctrl-enter.force-submit.return"), ("ctrl+enter", "oc-ctrl-enter.force-submit.enter")];

/// TS `resolveHintColors` on the current theme: the force action, the key, and the label.
const FORCE: &str = "text.action.primary.base";
const KEY: &str = "text.base";
const LABEL: &str = "text.muted";

fn setup(setup: &mut Setup) -> Result<(), String> {
    // Only an explicit `false` hides the hint.
    let hint = setup
        .options()
        .and_then(|options| serde_json::from_str::<serde_json::Value>(options).ok())
        .is_none_or(|options| options.get("hint") != Some(&serde_json::Value::Bool(false)));
    for (bind, name) in BINDS {
        let command = Command::default()
            .with_name(name.to_owned())
            .with_title("Force submit prompt".to_owned())
            .with_group(Some("Prompt".to_owned()))
            .with_keybind(Some(bind.to_owned()));
        setup.command(command, |host, _| force_submit(host));
    }
    setup.slot(Placement::append("prompt.footer.status"), move |read, input, changed| {
        let (Some(prompt), Some(session)) = (input.prompt, input.session_id.as_deref()) else { return Render::Hide };
        if !hint || prompt.shell {
            return Render::Hide;
        }
        if !(changed.all || changed.session(session)) {
            return Render::Keep;
        }
        let Some(session) = read.session(session) else { return Render::Hide };
        let spans = match session.status {
            SessionStatus::Running => vec![
                Span::new("⏎ "),
                Span::new("steer · ").fg(LABEL),
                Span::new("ctrl+⏎").fg(FORCE),
                Span::new(" interrupt & send").fg(LABEL),
            ],
            // Idle, and a status a later host adds.
            _ => vec![Span::new("⏎ "), Span::new("send").fg(LABEL)],
        };
        // TS's box at `right: 2, top: -2` of the footer row: one row up is the composer's border, two rows up its info
        // row. TS's slot is a fragment, so the box sits in the footer row; the claim's own box fills that row for it.
        let hint = Node::column(vec![Node::text(spans).fg(KEY).wrap(Wrap::None)]).layout(absolute(-2, 2, 1, false));
        Render::Show(Node::column(vec![hint]).layout(absolute(0, 0, 0, true)))
    });
    Ok(())
}

/// A layout out of the flow, `top` and `right` cells from its parent's edges and painted at `z`; filling the parent when
/// `fill`. The SDK has no setter of it, so it is set field by field.
fn absolute(top: i16, right: i16, z: i32, fill: bool) -> Layout {
    let mut at = Absolute::default();
    (at.top, at.right, at.z) = (Some(top), Some(right), z);
    if fill {
        (at.bottom, at.left) = (Some(0), Some(0));
    }
    let mut layout = Layout::default();
    if !fill {
        layout = layout.shrink(false);
    }
    layout.absolute = Some(at);
    layout
}

/// Interrupts the running session and submits the prompt, in this order.
fn force_submit(host: &dyn Host) {
    host.dispatch(INTERRUPT, None);
    host.dispatch(INTERRUPT, None);
    host.dispatch(INTERRUPT, None);
    host.dispatch("prompt.submit", None);
}

export_plugin!("mynameistito.opencode-force-input", setup);
