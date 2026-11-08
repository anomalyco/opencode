//! The sidebar's context section (E.14, row F04, `feature-plugins/sidebar/context.tsx`): the tokens of the last
//! reply, the share of the model's context they use, and the session's cost. It is a plugin of the one API (O-67).
//! [`SessionUsage`] and [`money`] also serve the prompt footer.

use std::cell::{Cell, RefCell};

use opencode_api::generated::{ModelInfo, SessionID, SessionMessageCompaction, SessionMessageInfo};
use opencode_plugin::abi::{self, Changed, Node, Placement, Render, Span};
use opencode_plugin::slot;
use opencode_store::{Changes, Location, MessageExt, State};

use crate::routes::session::sidebar::location_changed;

pub fn plugin() -> abi::Plugin {
    abi::Plugin { id: "opencode.sidebar.context", setup }
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    let last: RefCell<Option<Last>> = RefCell::default();
    setup.slot(Placement::append(slot::SIDEBAR_CONTENT), move |read, input, changed| {
        let Some(session) = input.session_id.as_deref() else {
            return Render::Hide;
        };
        let mut last = last.borrow_mut();
        let fresh = changed.all || last.as_ref().is_none_or(|last| last.session != session);
        let last = match &mut *last {
            Some(last) if !fresh => last,
            last => last.insert(Last { session: session.to_owned(), ..Last::default() }),
        };
        let model = last.update(read, changed, fresh);
        if !fresh && last.shown == Some(model) {
            return Render::Keep;
        }
        last.shown = Some(model);
        model.map_or(Render::Hide, |model| Render::Show(view(model)))
    });
    Ok(())
}

/// What the section shows: the usage and the cost, or nothing.
type Model = Option<(Option<Usage>, f64)>;

/// What the section last read for its session. It reads the session again only when its info or status changed,
/// the models when its location changed, and the messages when their list changed or a message changed in place from
/// the one the last usage came from on.
#[derive(Default)]
struct Last {
    session: String,
    location: Option<abi::LocationRef>,
    boundary: Option<String>,
    models: Option<Vec<ModelInfo>>,
    usage: Option<Usage>,
    from: usize,
    cost: f64,
    /// The IDs of the session's family at the last cost read.
    family: Vec<String>,
    shown: Option<Model>,
}

impl Last {
    fn update(&mut self, read: &dyn abi::Read, changed: &Changed, fresh: bool) -> Model {
        let info = fresh || changed.session(&self.session);
        if info {
            let session = read.session(&self.session).map(|session| session.info);
            self.location = session
                .as_ref()
                .map(|info| abi::LocationRef { directory: info.location.directory.0.clone(), workspace: None });
            self.boundary = session.and_then(|info| info.revert).map(|revert| revert.message_id.0);
        }
        // The cost of a root counts its family's: its members, and a session whose parent is one of them.
        let family = |id: &String| *id == self.session || self.family.contains(id);
        if fresh
            || changed.sessions.iter().any(|id| {
                family(id)
                    || read
                        .session(id)
                        .and_then(|session| session.info.parent_id)
                        .is_some_and(|parent| family(&parent.0))
            })
        {
            let family = read.family(&self.session);
            self.family = family.members.into_iter().map(|member| member.id).collect();
            self.cost = family.cost;
        }
        let models = info || self.location.as_ref().is_some_and(|location| changed.location(location));
        if models {
            self.models = self.location.as_ref().and_then(|location| read.models(Some(location)));
        }
        let mut stale = models || changed.list(&self.session);
        if !stale && changed.messages.iter().any(|(session, _)| *session == self.session) {
            read.messages(&self.session, &mut |messages| {
                stale = messages.get(self.from..).unwrap_or_default().iter().any(|message| {
                    changed.messages.iter().any(|(session, id)| *session == self.session && id == message.id())
                });
            });
        }
        if stale {
            (self.usage, self.from) = match self.location {
                Some(_) => {
                    let mut found = (None, 0);
                    read.messages(&self.session, &mut |messages| {
                        found = usage(messages, self.models.as_deref(), self.boundary.as_deref());
                    });
                    found
                }
                None => (None, 0),
            };
        }
        (self.usage.is_some() || self.cost > 0.0).then_some((self.usage, self.cost))
    }
}

fn view((usage, cost): (Option<Usage>, f64)) -> Node {
    let muted = |text: String| Node::text([Span::new(text).fg("text.muted")]);
    let mut children = vec![Node::text([Span::new("Context").fg("text.base").bold()])];
    if let Some(usage) = usage {
        children.push(muted(format!("{} tokens", grouped(usage.tokens))));
        if let Some(percent) = usage.percent {
            children.push(muted(format!("{percent}% used")));
        }
    }
    if cost > 0.0 {
        children.push(muted(format!("{} spent", money(cost))));
    }
    Node::column(children)
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

    /// Session `ses_a`, whose family has `ses_b`; `ses_new` is a new child of `ses_b`. Counts the family reads.
    struct Store {
        families: Cell<usize>,
    }

    impl abi::Read for Store {
        fn theme_mode(&self) -> abi::ThemeMode {
            abi::ThemeMode::Dark
        }

        fn color(&self, _token: &str) -> Option<abi::Rgba> {
            None
        }

        fn session(&self, id: &str) -> Option<abi::Session> {
            let parent = match id {
                "ses_a" => None,
                "ses_b" => Some("ses_a"),
                "ses_new" => Some("ses_b"),
                _ => None,
            };
            let info = serde_json::from_value(serde_json::json!({
                "id": id, "parentID": parent, "title": id, "projectID": "project", "cost": 0,
                "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
                "time": { "created": 1, "updated": 1 }, "location": { "directory": "/project" },
            }))
            .unwrap();
            Some(abi::Session { info, status: abi::SessionStatus::Idle })
        }

        fn family(&self, _id: &str) -> abi::Family {
            self.families.set(self.families.get() + 1);
            let member = |id: &str| abi::Member {
                id: id.to_owned(),
                parent: None,
                status: abi::SessionStatus::Idle,
                updated: 1.0,
            };
            abi::Family { members: vec![member("ses_a"), member("ses_b")], cost: 1.0 }
        }
    }

    // Expected: the cost reads the family again on a change of a member or of a new child of one, and not on a change
    // of a session outside it.
    #[test]
    fn the_cost_skips_sessions_outside_the_family() {
        let store = Store { families: Cell::new(0) };
        let mut last = Last { session: "ses_a".to_owned(), ..Last::default() };
        last.update(&store, &Changed::everything(), true);
        assert_eq!(store.families.get(), 1);
        let changed = |id: &str| Changed { sessions: vec![id.to_owned()], ..Changed::default() };
        last.update(&store, &changed("ses_other"), false);
        assert_eq!(store.families.get(), 1);
        last.update(&store, &changed("ses_b"), false);
        assert_eq!(store.families.get(), 2);
        last.update(&store, &changed("ses_new"), false);
        assert_eq!(store.families.get(), 3);
    }
}
