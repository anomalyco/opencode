//! A port of `@mynameistito/opencode-force-input` 1.1.20 (`dist/index.mjs`): `ctrl+enter` (and `ctrl+return`)
//! interrupts the running session and sends the prompt: it runs `session.interrupt` three times, OpenCode's guarded
//! interrupt, then `prompt.submit`. A hint in the prompt footer says what enter does: `⏎ send` while the session is
//! idle, `⏎ steer · ctrl+⏎ interrupt & send` while it runs; none in shell mode, on the home screen, or with the
//! option `"hint": false`.

use opencode_plugin_abi::{
    Command, Host, Layout, Node, Placement, Render, SessionStatus, Setup, Span, Wrap, export_plugin,
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
        let command = Command {
            name: name.to_owned(),
            title: "Force submit prompt".to_owned(),
            group: Some("Prompt".to_owned()),
            keybind: Some(bind.to_owned()),
            ..Command::default()
        };
        setup.command(command, |host, _| force_submit(host));
    }
    setup.slot(Placement::append("prompt.footer.status"), move |read, input, changed| {
        let (Some(prompt), Some(session)) = (input.prompt, input.session_id.as_deref()) else {
            return Render::Hide;
        };
        if !hint || prompt.shell {
            return Render::Hide;
        }
        if !(changed.all || changed.session(session)) {
            return Render::Keep;
        }
        let Some(session) = read.session(session) else {
            return Render::Hide;
        };
        let spans = match session.status {
            SessionStatus::Running => vec![
                Span::new("⏎ "),
                Span::new("steer · ").fg(LABEL),
                Span::new("ctrl+⏎").fg(FORCE),
                Span::new(" interrupt & send").fg(LABEL),
            ],
            SessionStatus::Idle => vec![Span::new("⏎ "), Span::new("send").fg(LABEL)],
        };
        Render::Show(Node::text(spans).fg(KEY).wrap(Wrap::None).layout(Layout::default().shrink(false)))
    });
    Ok(())
}

/// Interrupts the running session and submits the prompt, in this order.
fn force_submit(host: &dyn Host) {
    host.dispatch(INTERRUPT, None);
    host.dispatch(INTERRUPT, None);
    host.dispatch(INTERRUPT, None);
    host.dispatch("prompt.submit", None);
}

export_plugin!("mynameistito.opencode-force-input", setup);
