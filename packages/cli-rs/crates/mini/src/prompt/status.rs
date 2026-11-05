//! The status row under the composer (`footerStatuslinePolicy` in `footer.width.ts`): required groups first, then
//! optional information stage by stage while it fits the width.

use std::collections::BTreeMap;

use unicode_width::UnicodeWidthStr;

use super::menu::take_width;

/// The groups in the order they show.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Id {
    Spinner,
    Status,
    Escape,
    Queued,
    Subagents,
    Background,
    Agent,
    Model,
    Context,
    Provider,
    Cost,
    Menu,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    Text,
    Muted,
    Agent,
    Status,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Group {
    pub id: Id,
    pub parts: Vec<(String, Tone)>,
}

/// A key and what it does (`FooterAction`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Action {
    pub key: String,
    pub label: String,
    pub expanded: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct Input {
    pub width: usize,
    pub mono: bool,
    /// The status text and its wider form.
    pub status: Option<(String, Option<String>)>,
    pub escape: Option<Action>,
    /// `queued`, `subagents`, and `background` hints.
    pub work: Vec<(Id, Action)>,
    /// The model's name and variant.
    pub model: Option<(String, Option<String>)>,
    pub agent: Option<String>,
    /// The compact and full context usage.
    pub context: Option<(String, String)>,
    pub cost: Option<String>,
    pub provider: Option<String>,
    pub menu: Option<Action>,
    pub spinner: Option<String>,
}

/// `footerStatuslinePolicy`: the groups that fit, in display order.
pub fn policy(input: &Input) -> Vec<Group> {
    let group = |id, text: &str, tone| Group {
        id,
        parts: vec![(text.to_owned(), tone)],
    };
    let action = |id, value: &Action, expanded: bool| Group {
        id,
        parts: vec![
            (value.key.clone(), Tone::Text),
            (
                format!(
                    " {}",
                    if expanded {
                        value.expanded.as_ref().unwrap_or(&value.label)
                    } else {
                        &value.label
                    }
                ),
                Tone::Muted,
            ),
        ],
    };
    let identity = |cells: usize| {
        let (name, variant) = input.model.as_ref()?;
        let ellipsis = if input.mono { "..." } else { "…" };
        let text = if name.width() > cells.saturating_add(ellipsis.width()) {
            take_width(name, cells).trim_end().to_owned() + ellipsis
        } else {
            name.clone()
        };
        let variant = variant
            .as_ref()
            .map(|variant| format!(" [{variant}]"))
            .unwrap_or_default();
        Some(group(Id::Model, &format!("{text}{variant}"), Tone::Text))
    };
    let mut selected = BTreeMap::new();
    if let Some(spinner) = &input.spinner {
        selected.insert(Id::Spinner, group(Id::Spinner, spinner, Tone::Text));
    }
    if let Some((status, _)) = input.status.as_ref().filter(|(text, _)| !text.is_empty()) {
        selected.insert(Id::Status, group(Id::Status, status, Tone::Status));
    }
    if let Some(escape) = &input.escape {
        selected.insert(Id::Escape, action(Id::Escape, escape, false));
    }
    let fits = |selected: &BTreeMap<Id, Group>| {
        let text = text(selected.values(), input.mono);
        text.width() <= input.width && !text.contains('\n')
    };
    // Required controls may wrap. Optional information never crowds that fallback.
    if !fits(&selected) {
        return selected.into_values().collect();
    }
    let stages = input
        .work
        .iter()
        .map(|(id, item)| Some(action(*id, item, false)))
        .chain([
            identity(8),
            input
                .agent
                .as_ref()
                .map(|agent| group(Id::Agent, agent, Tone::Agent)),
            input
                .context
                .as_ref()
                .map(|(compact, _)| group(Id::Context, compact, Tone::Muted)),
            identity(24),
            input
                .context
                .as_ref()
                .map(|(_, full)| group(Id::Context, full, Tone::Muted)),
            input
                .cost
                .as_ref()
                .map(|cost| group(Id::Cost, cost, Tone::Muted)),
            input
                .provider
                .as_ref()
                .map(|provider| group(Id::Provider, provider, Tone::Muted)),
            input
                .menu
                .as_ref()
                .map(|menu| action(Id::Menu, menu, false)),
            identity(usize::MAX),
        ])
        .chain(
            input
                .work
                .iter()
                .filter(|(_, item)| item.expanded.is_some())
                .map(|(id, item)| Some(action(*id, item, true))),
        )
        .chain([input
            .status
            .as_ref()
            .and_then(|(_, expanded)| expanded.as_ref())
            .map(|expanded| group(Id::Status, expanded, Tone::Status))])
        .flatten();
    // Each stage keeps the earlier ones. Stop at the first that does not fit: backfilling shorter, later groups
    // would make resizing unstable.
    for stage in stages {
        let mut next = selected.clone();
        next.insert(stage.id, stage);
        if !fits(&next) {
            break;
        }
        selected = next;
    }
    selected.into_values().collect()
}

/// The groups as one line: the spinner is followed by a space, the rest by the separator.
pub fn text<'a>(groups: impl IntoIterator<Item = &'a Group>, mono: bool) -> String {
    let separator = if mono { " - " } else { " · " };
    let mut out = String::new();
    let mut previous = None;
    for group in groups {
        match previous {
            None => {}
            Some(Id::Spinner) => out.push(' '),
            Some(_) => out.push_str(separator),
        }
        for (text, _) in &group.parts {
            out.push_str(text);
        }
        previous = Some(group.id);
    }
    out
}

/// `monoShortcut`: arrows as words.
pub fn mono_shortcut(value: &str, mono: bool) -> String {
    if !mono {
        return value.to_owned();
    }
    value
        .replace('→', "right")
        .replace('←', "left")
        .replace('↑', "up")
        .replace('↓', "down")
}

/// `formatContextUsage`: `Locale.number` of the tokens, then the percent.
pub fn context_usage(tokens: u64, percent: Option<u64>) -> String {
    let value = match tokens {
        999_950.. => format!("{:.1}M", tokens as f64 / 1_000_000.0),
        1000.. => format!("{:.1}K", tokens as f64 / 1000.0),
        _ => tokens.to_string(),
    };
    match percent {
        Some(percent) => format!("{value} ({percent}%)"),
        None => value,
    }
}

/// `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })`.
pub fn money(value: f64) -> String {
    let cents = (value.abs() * 100.0).round() as u64;
    let dollars = (cents / 100).to_string();
    let grouped = dollars
        .as_bytes()
        .rchunks(3)
        .rev()
        .map(|chunk| std::str::from_utf8(chunk).unwrap_or_default())
        .collect::<Vec<_>>()
        .join(",");
    let sign = if value < 0.0 && cents > 0 { "-" } else { "" };
    format!("{sign}${grouped}.{:02}", cents % 100)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(input: &Input) -> String {
        text(&policy(input), input.mono)
    }

    fn action(key: &str, label: &str, expanded: Option<&str>) -> Action {
        Action {
            key: key.into(),
            label: label.into(),
            expanded: expanded.map(str::to_owned),
        }
    }

    fn running(width: usize, queued: bool) -> Input {
        Input {
            width,
            status: Some(("esc stop".into(), Some("esc interrupt".into()))),
            work: if queued {
                vec![(Id::Queued, action("ctrl+x q", "2 pending", None))]
            } else {
                Vec::new()
            },
            model: Some(("model".into(), None)),
            agent: Some("build".into()),
            provider: Some("demo".into()),
            menu: Some(action("ctrl+p", "menu", None)),
            spinner: Some("▪".into()),
            ..Input::default()
        }
    }

    #[test]
    fn stages_fill_the_width_in_order() {
        // The lines TS mini shows at 60 columns (`parity/scenarios/M.2/queue.pty.ts`).
        assert_eq!(
            line(&running(60, false)),
            "▪ esc interrupt · build · model · demo · ctrl+p menu"
        );
        assert_eq!(
            line(&running(60, true)),
            "▪ esc stop · ctrl+x q 2 pending · build · model · demo"
        );
        // Narrower: the model shortens to eight cells first, and nothing after a stage that does not fit.
        let narrow = Input {
            model: Some(("claude-sonnet-4-5".into(), Some("high".into()))),
            ..running(40, false)
        };
        assert_eq!(line(&narrow), "▪ esc stop · build · claude-s… [high]");
        // Required groups that do not fit stay whole.
        assert_eq!(line(&running(4, false)), "▪ esc stop");
        let shell = Input {
            width: 60,
            mono: true,
            status: Some(("Shell".into(), None)),
            escape: Some(action("esc", "normal", None)),
            ..Input::default()
        };
        assert_eq!(line(&shell), "Shell - esc normal");
    }

    #[test]
    fn usage_and_cost_follow_locale() {
        assert_eq!(context_usage(950, None), "950");
        assert_eq!(context_usage(12_345, Some(6)), "12.3K (6%)");
        assert_eq!(context_usage(999_950, None), "1.0M");
        assert_eq!(money(0.5), "$0.50");
        assert_eq!(money(1234.567), "$1,234.57");
    }
}
