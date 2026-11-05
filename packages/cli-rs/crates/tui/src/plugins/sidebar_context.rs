//! The sidebar's context section (E.14, row F04, `feature-plugins/sidebar/context.tsx`): the tokens of the last
//! reply, the share of the model's context they use, and the session's cost. [`SessionUsage`] and [`money`]
//! also serve the prompt footer.

use std::cell::Cell;

use opencode_api::generated::{ModelInfo, SessionID, SessionMessageCompaction, SessionMessageInfo};
use opencode_plugin::{Definition, Placement, slot};
use opencode_store::{Catalog, Changes, Location, MessageExt, State};
use opentui::prelude::*;

use crate::app::Tui;
use crate::routes::session::sidebar::{Section, location_changed, sync_catalogs};

pub fn plugin() -> Definition<Tui> {
    Definition::new("opencode.sidebar.context", |cx| {
        cx.slot(Placement::append(slot::SIDEBAR_CONTENT), |tui, input| {
            let session = SessionID(input.session_id.clone().unwrap_or_default());
            let cache = SessionUsage::default();
            Box::new(Section::new(
                tui,
                Some(session.clone()),
                move |tui, changes| model(tui, &session, &cache, changes),
                view,
            ))
        });
    })
}

fn model(tui: &Tui, session: &SessionID, cache: &SessionUsage, changes: &Changes) -> Option<(Option<Usage>, f64)> {
    sync_catalogs(tui, session, &[Catalog::Model]);
    let (usage, cost) = tui.data.read(|state| (cache.read(state, changes, session), state.cost(session)));
    (usage.is_some() || cost > 0.0).then_some((usage, cost))
}

fn view(tui: &Tui, (usage, cost): &(Option<Usage>, f64)) -> View {
    let theme = tui.page();
    let app = &tui.app;
    let root = View::new(app).child(&Text::new(app, "Context").fg(theme.text.base).bold());
    if let Some(usage) = usage {
        root.add(&Text::new(app, format!("{} tokens", grouped(usage.tokens))).fg(theme.text.muted));
        if let Some(percent) = usage.percent {
            root.add(&Text::new(app, format!("{percent}% used")).fg(theme.text.muted));
        }
    }
    if *cost > 0.0 {
        root.add(&Text::new(app, format!("{} spent", money(*cost))).fg(theme.text.muted));
    }
    root
}

/// The context use of the last reply with tokens (`contextUsage`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Usage {
    pub tokens: f64,
    pub percent: Option<i64>,
}

/// [`usage`] of a session's messages against the models of its location, before its revert boundary. It reads
/// the messages again only when the session, its status, its message list or its location changed, or a message
/// changed in place from the one the last usage came from on.
#[derive(Default)]
pub struct SessionUsage(Cell<Option<(Option<Usage>, usize)>>);

impl SessionUsage {
    pub fn read(&self, state: &State, changes: &Changes, session: &SessionID) -> Option<Usage> {
        let info = state.session(session)?;
        let messages = state.messages(session);
        let stale = |from: usize| {
            changes.session(session)
                || changes.status(session)
                || changes.messages(session)
                || location_changed(changes, &info.location)
                || changes.message.get(session).is_some_and(|changed| {
                    messages.get(from..).unwrap_or_default().iter().any(|message| changed.contains(message.id()))
                })
        };
        if let Some((usage, from)) = self.0.get()
            && !stale(from)
        {
            return usage;
        }
        let models = state.location(Some(&Location::from(&info.location))).and_then(|data| data.model.as_deref());
        let boundary = info.revert.as_ref().map(|revert| revert.message_id.0.as_str());
        let (usage, from) = usage(messages, models, boundary);
        self.0.set(Some((usage, from)));
        usage
    }
}

/// `contextUsage`: the last assistant message with tokens after the last completed compaction and before
/// `boundary`, and the index of the first message a change in place could change it from.
pub fn usage(
    messages: &[SessionMessageInfo],
    models: Option<&[ModelInfo]>,
    boundary: Option<&str>,
) -> (Option<Usage>, usize) {
    let end = match boundary {
        Some(boundary) => match messages.iter().position(|message| message.id() == boundary) {
            Some(end) => end,
            None => return (None, 0),
        },
        None => messages.len(),
    };
    let start = messages[..end]
        .iter()
        .rposition(|message| matches!(message, SessionMessageInfo::Compaction(SessionMessageCompaction::Completed(_))))
        .map_or(0, |index| index + 1);
    let found = messages[start..end].iter().enumerate().rev().find_map(|(index, message)| match message {
        SessionMessageInfo::Assistant(message) => Some((start + index, &message.model, message.tokens.as_ref()?)),
        _ => None,
    });
    let Some((index, model, tokens)) = found else {
        return (None, start);
    };
    let total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
    if total <= 0.0 {
        return (None, index);
    }
    let context = models
        .unwrap_or_default()
        .iter()
        .find(|item| item.provider_id == model.provider_id && item.id == model.id)
        .map(|model| model.limit.context)
        .filter(|context| *context > 0);
    let percent = context.map(|context| (total / context as f64 * 100.0).round() as i64);
    (Some(Usage { tokens: total, percent }), index)
}

/// `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })`: `$1,234.56`.
pub fn money(value: f64) -> String {
    let cents = (value.abs() * 100.0).round() as u64;
    let sign = if value < 0.0 { "-" } else { "" };
    format!("{sign}${}.{:02}", grouped((cents / 100) as f64), cents % 100)
}

/// `toLocaleString()` of a whole number: `12,345`.
pub fn grouped(value: f64) -> String {
    let digits = format!("{}", value.round() as i64);
    let (sign, digits) = digits.split_at(usize::from(digits.starts_with('-')));
    let mut out = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            out.push(',');
        }
        out.push(digit);
    }
    format!("{sign}{out}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_like_intl() {
        assert_eq!(money(0.0), "$0.00");
        assert_eq!(money(1234.567), "$1,234.57");
        assert_eq!(money(0.005), "$0.01");
        assert_eq!(grouped(999.0), "999");
        assert_eq!(grouped(12345.0), "12,345");
        assert_eq!(grouped(1234567.0), "1,234,567");
    }
}
