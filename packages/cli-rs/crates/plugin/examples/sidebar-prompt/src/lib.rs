//! A port of `opencode-sidebar-prompt` 0.1.6 (`dist/tui.js`): the session's last prompt in the sidebar, delivered or
//! still queued in its inbox, and `/lastprompt` (or a click on "Open full prompt"), which shows the whole prompt in a
//! large centered dialog of its own: a header, the text, and a hint.
//!
//! Options: `previewLength`, the sidebar preview's length in characters (40 to 600, 180 by default). TS counts
//! graphemes (`Intl.Segmenter`); the port counts characters, so a cluster of several (an emoji with a modifier) counts
//! as more than one.

use opencode_plugin_abi::types::{SessionInboxInfo, SessionMessageInfo};
use opencode_plugin_abi::{
    Click, Command, Dialog, Edges, Host, Justify, Layout, Node, Panel, PanelSize, Placement, Read, Render, Route,
    Setup, Span, Toast, Variant, Width, plugin,
};

const OPEN: &str = "sidebar.prompt.open";
/// What the sidebar's link runs, with its session.
const SHOW: &str = "sidebar.prompt.show";
const DIALOG: &str = "sidebar.prompt";

/// TS `lastPrompt`'s result.
struct Prompt {
    text: String,
    created: f64,
    pending: bool,
}

fn setup(setup: &mut Setup) -> Result<(), String> {
    let options: serde_json::Value =
        setup.options().and_then(|text| serde_json::from_str(text).ok()).unwrap_or_default();
    let limit = options
        .get("previewLength")
        .and_then(serde_json::Value::as_f64)
        .filter(|length| length.is_finite())
        .map_or(180, |length| length.trunc().clamp(40.0, 600.0) as usize);
    let open = Command::new(OPEN).title("Show full last prompt").group("Sidebar").palette().slash("lastprompt");
    setup.command(open, |host, _| {
        // TS's command is enabled on a session's route only.
        let Route::Session { id } = host.route() else { return };
        match last_prompt(host, &id) {
            Some(prompt) => show(host, &prompt),
            None => host.toast(Toast::new(Variant::Info, "No prompt submitted in this session.")),
        }
    });
    setup.command(Command::new(SHOW), |host, session| {
        if let Some(prompt) = session.and_then(|session| last_prompt(host, session)) {
            show(host, &prompt);
        }
    });
    setup.command(Command::new(format!("{DIALOG}.close")), |host, _| {
        host.dialog(Dialog::Close { key: DIALOG.to_owned() });
    });
    setup.slot(Placement::append("sidebar.content"), move |read, input, changed| {
        let Some(id) = input.session_id.as_deref() else { return Render::Hide };
        if !(changed.all || changed.list(id) || changed.session(id)) {
            return Render::Keep;
        }
        let mut rows = vec![Node::text([Span::new("Last prompt").bold()]).fg("text.base")];
        match last_prompt(read, id) {
            Some(prompt) => {
                if prompt.pending {
                    rows.push(Node::text([Span::new("Queued")]).fg("text.muted"));
                }
                let preview = preview(&prompt.text, limit);
                let preview = if preview.is_empty() { "[Attachments only]".to_owned() } else { preview };
                rows.push(Node::text([Span::new(preview)]).fg("text.base"));
                rows.push(
                    Node::text([Span::new("Open full prompt · /lastprompt")])
                        .fg("text.action.primary.base")
                        .on_click(Click::command(SHOW).input(id)),
                );
            }
            None => rows.push(Node::text([Span::new("No prompt submitted")]).fg("text.muted")),
        }
        Render::Show(Node::column(rows).layout(Layout::default().margin(Edges::new(1, 0, 0, 0)).shrink(false)))
    });
    Ok(())
}

/// TS `lastPrompt`: the newest of the session's user messages and of its inbox's user prompts not delivered yet; on a
/// tie, the later one listed.
fn last_prompt(read: &dyn Read, session: &str) -> Option<Prompt> {
    let mut prompts = Vec::new();
    let mut delivered = Vec::new();
    read.messages(session, &mut |messages| {
        for message in messages {
            if let SessionMessageInfo::User(user) = message {
                delivered.push(user.id.0.clone());
                prompts.push(Prompt { text: user.text.clone(), created: user.time.created, pending: false });
            }
        }
    });
    for item in read.pending(session) {
        if let SessionInboxInfo::User(user) = item
            && !delivered.contains(&user.id.0)
        {
            prompts.push(Prompt { text: user.payload.text, created: user.time.created, pending: true });
        }
    }
    prompts.into_iter().reduce(|latest, prompt| if prompt.created >= latest.created { prompt } else { latest })
}

/// TS `openPrompt`: the whole prompt in a large centered dialog, as the plugin draws it (`FullPromptDialog`).
fn show(host: &dyn Host, prompt: &Prompt) {
    let text = display_text(&prompt.text);
    let text = if text.is_empty() { "[No prompt text: attachments only]".to_owned() } else { text };
    let height = host.info().size.1.saturating_sub(4).clamp(6, 30);
    let header = Node::row(vec![
        Node::text([Span::new("Last prompt").bold()]).fg("text.base"),
        Node::text([Span::new("Esc · Close")]).fg("text.muted").on_click(Click::command(format!("{DIALOG}.close"))),
    ])
    .justify(Justify::SpaceBetween)
    .gap(1)
    .layout(Layout::default().shrink(false));
    // TS's `<scrollbox>`: a panel's body has no scroll of its own, so long text is cut at the dialog's height.
    let scroll = Node::column(vec![Node::text([Span::new(text)]).fg("text.base")])
        .layout(Layout::default().grow().shrink(true).min_height(Width::Cells(1)));
    let hint =
        Node::text([Span::new("↑ ↓ / PgUp PgDown · Scroll")]).fg("text.muted").layout(Layout::default().shrink(false));
    let body = Node::column(vec![header, scroll, hint])
        .gap(1)
        .padding(1, 1)
        .layout(Layout::default().height(Width::Cells(height)));
    let panel = Panel::new(DIALOG, Vec::new(), body).size(PanelSize::Large).centered().bare();
    host.dialog(Dialog::Panel(panel));
}

/// TS `displayText`: line ends as `\n`, without terminal escapes (OSC and CSI) or other control characters.
fn display_text(text: &str) -> String {
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut shown = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            // OSC: up to BEL or ST (`ESC \`).
            '\x1b' if chars.peek() == Some(&']') => {
                chars.next();
                while let Some(c) = chars.next() {
                    if c == '\x07' || (c == '\x1b' && chars.next_if_eq(&'\\').is_some()) {
                        break;
                    }
                }
            }
            // CSI: parameters, intermediates, then a final byte.
            '\x1b' if chars.peek() == Some(&'[') => {
                chars.next();
                while chars.next_if(|c| ('0'..='?').contains(c)).is_some() {}
                while chars.next_if(|c| (' '..='/').contains(c)).is_some() {}
                chars.next_if(|c| ('@'..='~').contains(c));
            }
            '\x00'..='\x08' | '\x0b'..='\x1f' | '\x7f'..='\u{9f}' => {}
            c => shown.push(c),
        }
    }
    shown
}

/// TS `promptPreview`: the text on one line, cut to `limit` characters with `…`.
fn preview(text: &str, limit: usize) -> String {
    let compact = display_text(text).split_whitespace().collect::<Vec<_>>().join(" ");
    match compact.chars().count() > limit {
        true => compact.chars().take(limit - 1).chain(['…']).collect(),
        false => compact,
    }
}

plugin!(id = "sidebar.prompt", setup);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_text_drops_escapes_and_controls() {
        let text = "a\r\nb\x1b]0;title\x07c\x1b[1;31md\x1b]8;;x\x1b\\e\x01f\u{9b}";
        assert_eq!(display_text(text), "a\nbcdef");
    }

    #[test]
    fn preview_collapses_space_and_cuts_at_the_limit() {
        assert_eq!(preview("  one\n two\tthree ", 40), "one two three");
        let long = "x".repeat(45);
        assert_eq!(preview(&long, 40), format!("{}…", "x".repeat(39)));
        assert_eq!(preview(&"x".repeat(40), 40), "x".repeat(40));
    }
}
