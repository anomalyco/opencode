//! The prompt footer plugin (E.14, row F02, `feature-plugins/prompt/footer.tsx`), appended to `prompt.footer`:
//!
//! - the running subagents and shells of the session (a click opens the first child), its goal (`goal.rs`),
//!   and its context use and cost, as far as they fit;
//! - otherwise the `agents` and `commands` hints, which read as disabled while the session pane does not own the input;
//! - in shell mode, `esc exit shell mode`.
//!
//! It is a plugin of the one API (O-67). Each mount of a session's footer counts in [`Goals`], which reads the goal.

use opencode_plugin::abi::{self, Changed, Click, Layout, Node, Placement, PromptInput, Render, SlotInput, Span, Wrap};
use opencode_plugin::slot;
use unicode_width::UnicodeWidthStr;

use super::goal::{self, Goal, Goals};
use super::sidebar_context::{self, Last, Usage, money};

use crate::prelude::*;

pub fn plugin() -> abi::Plugin {
    abi::Plugin { id: "opencode.prompt.footer", setup }
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    let goals = Rc::new(Goals::default());
    goals.register(setup);
    let shown = goals.clone();
    let footer: RefCell<Footer> = RefCell::default();
    setup.slot(Placement::append(slot::PROMPT_FOOTER), move |read, input, changed| {
        footer.borrow_mut().render(read, input, changed, &shown)
    });
    setup.on_mount(Placement::append(slot::PROMPT_FOOTER), move |host, input, mounted| {
        if let Some(session) = &input.session_id {
            goals.mounted(host, session, mounted);
        }
    });
    Ok(())
}

/// What the footer last read and showed. One footer renders at a time: a prompt mounts it again when its input
/// changes, and drops the last one right after.
#[derive(Default)]
struct Footer {
    input: Option<SlotInput>,
    /// The session's usage, cost, running subagents and shells.
    last: Option<Last>,
    /// The usage and the cost as the footer prints them.
    status: Rc<[String]>,
    printed: sidebar_context::Model,
    width: u16,
    shown: Option<Model>,
}

/// What the footer shows; it renders again only when this changes.
#[derive(Clone, Debug, PartialEq)]
struct Model {
    prompt: PromptInput,
    width: u16,
    subagents: usize,
    shells: usize,
    goal: Option<Rc<Goal>>,
    status: Rc<[String]>,
    keys: Keys,
    /// The session pane owns the input; the hints read as disabled while a right pane has it.
    interactive: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
struct Keys {
    child: Option<String>,
    agents: String,
    commands: Option<String>,
}

impl Footer {
    fn render(&mut self, read: &dyn abi::Read, input: &SlotInput, changed: &Changed, goals: &Goals) -> Render {
        let fresh = changed.all || self.input.as_ref() != Some(input);
        if fresh {
            *self = Footer { input: Some(input.clone()), width: read.info().size.0, ..Footer::default() };
        } else if changed.size {
            self.width = read.info().size.0;
        }
        if let Some(session) = &input.session_id {
            let last = self.last.get_or_insert_with(|| Last::new(session));
            let printed = last.update(read, changed, fresh);
            if fresh || printed != self.printed {
                self.status = printed
                    .map(|(usage, cost)| {
                        [usage.map(format_usage), (cost > 0.0).then(|| money(cost))].into_iter().flatten().collect()
                    })
                    .unwrap_or_default();
                self.printed = printed;
            }
        }
        let last = self.last.as_ref();
        let live = last.is_some_and(|last| last.running + last.shells > 0);
        let model = Model {
            prompt: input.prompt.unwrap_or(PromptInput { shell: false, show_details: true }),
            width: self.width,
            subagents: last.map_or(0, |last| last.running),
            shells: last.map_or(0, |last| last.shells),
            goal: input.session_id.as_deref().and_then(|session| goals.goal(session)),
            status: self.status.clone(),
            // A key read costs, and the footer reads them with each change batch; the first child's only while one
            // runs.
            keys: Keys {
                child: live.then(|| read.shortcut("session.child.first")).flatten(),
                agents: read.shortcut("agent.cycle").unwrap_or_default(),
                commands: read.shortcut("command.palette.show"),
            },
            interactive: read.interactive(),
        };
        if !fresh && self.shown.as_ref() == Some(&model) {
            return Render::Keep;
        }
        let node = view(&model, input.session_id.as_deref().unwrap_or_default());
        self.shown = Some(model);
        Render::Show(node)
    }
}

fn view(model: &Model, session: &str) -> Node {
    let text = |spans: Vec<Span>| Node::text(spans).wrap(Wrap::None).layout(Layout::default().shrink(false));
    let root =
        |shrink: bool, children| Node::row(children).gap(2).layout(Layout::default().shrink(shrink).min_width_zero());
    if model.prompt.shell {
        let label = if model.width < 44 { "shell" } else { "exit shell mode" };
        let hint = Node::text([Span::new("esc ").fg("text.base"), Span::new(label).fg("text.muted")])
            .layout(Layout::default().shrink(false));
        return root(false, vec![hint]);
    }
    let plural =
        |count: usize, what: &str| (count > 0).then(|| format!("{count} {what}{}", if count == 1 { "" } else { "s" }));
    let live: Vec<String> =
        [plural(model.subagents, "subagent"), plural(model.shells, "shell")].into_iter().flatten().collect();
    let (usage, shortcuts) = match model.status.is_empty() {
        true => (false, model.width >= 44),
        false => layout(
            i64::from(model.width) - 8,
            &model.status,
            model.keys.commands.as_ref().map(|key| format!("{key} commands")).as_slice(),
        ),
    };
    let details = model.prompt.show_details;
    let hint = |key: &str, label: &str| match model.interactive {
        true => text(vec![Span::new(format!("{key} ")).fg("text.base"), Span::new(label).fg("text.muted")]),
        false => {
            let span = Span { dim: true, ..Span::new(format!("{key} {label}")).fg("text.action.primary.disabled") };
            text(vec![span])
        }
    };
    let busy = model.goal.is_some() || !live.is_empty() || !model.status.is_empty();
    let mut children = Vec::new();
    let shrink = !busy || !(details && usage);
    if busy {
        let mut status = Vec::new();
        if !live.is_empty() {
            let mut spans: Vec<Span> =
                model.keys.child.iter().map(|key| Span::new(format!("{key} ")).fg("text.base")).collect();
            spans.push(Span::new(live.join(" · ")));
            let tab = if model.subagents > 0 { "subagents" } else { "shell" };
            status.push(
                text(spans)
                    .fg("text.muted")
                    .hover_fg("text.base")
                    .on_click(Click::command("session.child.first", Some(tab.to_owned()))),
            );
        }
        if let Some(goal) = &model.goal {
            if !live.is_empty() {
                status.push(text(vec![Span::new(" · ").fg("text.muted")]));
            }
            status.push(goal::status(session, goal));
        }
        if details && usage {
            let lead = if !live.is_empty() || model.goal.is_some() { " · " } else { "" };
            status.push(text(vec![Span::new(format!("{lead}{}", model.status.join(" · "))).fg("text.muted")]));
        }
        children.push(Node::row(status).layout(Layout::default().shrink(shrink).min_width_zero()));
    } else if details && shortcuts {
        children.push(hint(&model.keys.agents, "agents"));
    }
    if details && shortcuts {
        children.push(hint(model.keys.commands.as_deref().unwrap_or_default(), "commands"));
    }
    root(busy && shrink, children)
}

/// `formatContextUsage`: `12.3K (45%)`.
fn format_usage(usage: Usage) -> String {
    let value = crate::routes::session::messages::compaction::number(usage.tokens);
    match usage.percent {
        Some(percent) => format!("{value} ({percent}%)"),
        None => value,
    }
}

/// `promptFooterLayout`: whether the usage and the shortcuts fit beside the location, which keeps at most 28
/// columns or half the width.
fn layout(width: i64, usage: &[String], shortcuts: &[String]) -> (bool, bool) {
    let width = width.max(0);
    let usage = usage.join(" · ");
    let shortcuts = shortcuts.join(" · ");
    let available = (width - (width / 2).min(28)).max(0) as usize;
    let fits = |text: &str| text.width() <= available;
    if !usage.is_empty() && !shortcuts.is_empty() && fits(&format!("{usage} · {shortcuts}")) {
        return (true, true);
    }
    if !usage.is_empty() && fits(&usage) {
        return (true, false);
    }
    if usage.is_empty() && !shortcuts.is_empty() && fits(&shortcuts) {
        return (false, true);
    }
    (false, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_like_prompt_footer_layout() {
        let usage = ["12.3K (4%)".to_owned(), "$0.12".to_owned()];
        let commands = ["ctrl+p commands".to_owned()];
        // 92 wide keeps 28 for the location: 64 left.
        assert_eq!(layout(92, &usage, &commands), (true, true));
        // 40 wide keeps 20: 20 left, enough for the usage only.
        assert_eq!(layout(40, &usage, &commands), (true, false));
        assert_eq!(layout(20, &usage, &commands), (false, false));
        assert_eq!(layout(40, &[], &commands), (false, true));
        assert_eq!(format_usage(Usage { tokens: 12_345.0, percent: Some(4) }), "12.3K (4%)");
        assert_eq!(format_usage(Usage { tokens: 800.0, percent: None }), "800");
    }
}
