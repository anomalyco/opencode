//! Program status (E.19a, row N03, `context/program-status.ts`, `context/session-tabs.tsx:180-200`): OSC 7501
//! records that mirror the sessions waiting on the user or working. There is one root summary plus one record
//! per pending session among the open tabs and the viewed session. Terminals drop working and blocked records
//! when the process exits, and quitting clears the root.
//!
//! `Tui::sync`, `Tui::navigate`, and the tabs call [`sync`]; `app.exit` calls [`clear`] before the terminal is
//! released. Records are not sent again after a suspend and resume (G.4).

use std::sync::LazyLock;

use indexmap::IndexMap;
use opencode_api::generated::SessionID;
use opentui::native::{ProgramKind, ProgramState, ProgramStatus};
use regex::Regex;
use sha2::{Digest, Sha256};

use crate::app::Tui;
use crate::routes::Route;
use crate::tabs::Attention;

const APP: &str = "opencode";
/// The root record's ID.
const ROOT: &str = "";

/// A session that needs the user or works (`PendingSession`).
#[derive(Clone, Debug, PartialEq)]
pub struct Pending {
    pub id: String,
    pub title: Option<String>,
    pub state: PendingState,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PendingState {
    Working,
    Blocked { kind: ProgramKind, message: String },
}

/// One record as it is sent, owning its text. `Clear` records carry only the ID.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Record {
    pub state: ProgramState,
    pub id: String,
    pub app: Option<&'static str>,
    pub title: Option<String>,
    pub message: Option<String>,
}

impl Record {
    fn clear(id: &str) -> Self {
        Self {
            state: ProgramState::Clear,
            id: id.to_owned(),
            app: None,
            title: None,
            message: None,
        }
    }

    fn status(&self) -> ProgramStatus<'_> {
        ProgramStatus {
            state: self.state,
            id: &self.id,
            app: self.app.unwrap_or_default(),
            title: self.title.as_deref().unwrap_or_default(),
            message: self.message.as_deref().unwrap_or_default(),
            progress: None,
        }
    }
}

/// The records the terminal took, by ID, in the order they were first sent.
pub type Sent = IndexMap<String, Record>;

/// Sends the records that changed since the last sync.
pub fn sync(tui: &Tui) {
    let reports = reports(&pending(tui));
    let mut sent = tui.attention.program.borrow_mut();
    update(&mut sent, &reports, |record| {
        tui.app.set_program_status(record.status())
    });
}

/// Clears the root record, as the TS provider's cleanup does.
pub fn clear(tui: &Tui) {
    let mut sent = tui.attention.program.borrow_mut();
    send(&mut sent, ROOT, Record::clear(ROOT), |record| {
        tui.app.set_program_status(record.status())
    });
}

/// The open tabs, then the viewed session, each once, that wait on the user or work.
fn pending(tui: &Tui) -> Vec<Pending> {
    let viewed = match tui.route() {
        Route::Session { id } if id.0 != "dummy" => tui.tabs.current(tui),
        _ => None,
    };
    let mut ids = tui.tabs.open_ids(tui);
    ids.extend(viewed);
    let mut seen = std::collections::HashSet::new();
    ids.retain(|id| seen.insert(id.clone()));
    ids.into_iter()
        .filter_map(|id| {
            let status = tui.tabs.status(tui, &id);
            let state = match status.attention {
                Some(Attention::Permission) => PendingState::Blocked {
                    kind: ProgramKind::Permission,
                    message: "Permission needs input".to_owned(),
                },
                Some(Attention::Question) => PendingState::Blocked {
                    kind: ProgramKind::Question,
                    message: "Input needs response".to_owned(),
                },
                None if status.busy => PendingState::Working,
                None => return None,
            };
            Some(Pending {
                title: title(tui, &id),
                id,
                state,
            })
        })
        .collect()
}

/// `title` of `session-tabs.tsx` without a persisted title: the store's, else the timestamped fallback.
fn title(tui: &Tui, id: &str) -> Option<String> {
    tui.data.read(|state| {
        let info = state.session(&SessionID(id.to_owned()))?;
        Some(
            info.title
                .clone()
                .unwrap_or_else(|| crate::dialogs::session_list::title(info)),
        )
    })
}

/// `createProgramStatus`'s effect: clears the records of sessions no longer pending, then sends each report that
/// differs from the one sent. `send` says whether the terminal took the record.
fn update(
    sent: &mut Sent,
    reports: &IndexMap<String, Record>,
    mut deliver: impl FnMut(&Record) -> bool,
) {
    let gone: Vec<String> = sent
        .keys()
        .filter(|key| key.as_str() != ROOT && !reports.contains_key(*key))
        .cloned()
        .collect();
    for key in gone {
        send(sent, &key, Record::clear(&key), &mut deliver);
    }
    for (key, record) in reports {
        if sent.get(key) != Some(record) {
            send(sent, key, record.clone(), &mut deliver);
        }
    }
}

fn send(sent: &mut Sent, key: &str, record: Record, deliver: impl FnOnce(&Record) -> bool) {
    if !deliver(&record) {
        return;
    }
    if record.state == ProgramState::Clear {
        sent.shift_remove(key);
        return;
    }
    sent.insert(key.to_owned(), record);
}

/// `programStatusReports`: the root summary, then one record per session.
pub fn reports(sessions: &[Pending]) -> IndexMap<String, Record> {
    std::iter::once((ROOT.to_owned(), root(sessions)))
        .chain(sessions.iter().map(|session| {
            let id = record_id(&session.id);
            let record = record(session, &id);
            (id, record)
        }))
        .collect()
}

fn root(sessions: &[Pending]) -> Record {
    let blocked: Vec<&Pending> = sessions
        .iter()
        .filter(|session| matches!(session.state, PendingState::Blocked { .. }))
        .collect();
    let working = sessions.len() - blocked.len();
    let summary = |state, message: String| Record {
        state,
        id: ROOT.to_owned(),
        app: Some(APP),
        title: None,
        message: Some(message),
    };
    match (blocked.as_slice(), working) {
        ([one], _) => record(one, ROOT),
        ([first, ..], _) => {
            let kind = |session: &Pending| match session.state {
                PendingState::Blocked { kind, .. } => Some(kind),
                PendingState::Working => None,
            };
            let same = blocked.iter().all(|session| kind(session) == kind(first));
            summary(
                ProgramState::Blocked(kind(first).filter(|_| same)),
                format!("{} sessions need input", blocked.len()),
            )
        }
        ([], 1) => record(&sessions[0], ROOT),
        ([], 0) => Record {
            state: ProgramState::Idle,
            id: ROOT.to_owned(),
            app: Some(APP),
            title: None,
            message: None,
        },
        ([], count) => summary(ProgramState::Working, format!("{count} sessions working")),
    }
}

fn record(session: &Pending, id: &str) -> Record {
    let (state, message) = match &session.state {
        PendingState::Working => (ProgramState::Working, None),
        PendingState::Blocked { kind, message } => (
            ProgramState::Blocked(Some(*kind)),
            clip(Some(message), 2048),
        ),
    };
    Record {
        state,
        id: id.to_owned(),
        app: Some(APP),
        title: clip(session.title.as_deref(), 192),
        message,
    }
}

/// `recordID`: record IDs must be 1 to 32 bytes of `[A-Za-z0-9_.+-]`, but session IDs only need a `ses` prefix.
fn record_id(id: &str) -> String {
    let valid = (1..=32).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.+-".contains(&byte));
    if valid {
        return id.to_owned();
    }
    let hex: String = Sha256::digest(id.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("ses_{}", &hex[..16])
}

/// `clip`: records reject control characters and oversized fields, so the text becomes one line within `bytes`,
/// cut with an ellipsis.
fn clip(input: Option<&str>, bytes: usize) -> Option<String> {
    static CONTROLS: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"[\x00-\x1f\x7f-\x{9f}]+").unwrap());
    // JavaScript's `\s`.
    static SPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\s\x{feff}]+").unwrap());
    let text = CONTROLS.replace_all(input.unwrap_or_default(), " ");
    let text = SPACE.replace_all(&text, " ");
    let text = text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    if text.is_empty() {
        return None;
    }
    if text.len() <= bytes {
        return Some(text.to_owned());
    }
    // Leave room for the 3-byte ellipsis and drop a character the byte cut split.
    let cut = (0..=bytes - 3)
        .rev()
        .find(|&index| text.is_char_boundary(index))
        .unwrap_or(0);
    Some(format!("{}…", text[..cut].trim_end_matches('\u{fffd}')))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn working(id: &str, title: &str) -> Pending {
        Pending {
            id: id.to_owned(),
            title: Some(title.to_owned()),
            state: PendingState::Working,
        }
    }

    fn blocked(id: &str, kind: ProgramKind) -> Pending {
        Pending {
            id: id.to_owned(),
            title: None,
            state: PendingState::Blocked {
                kind,
                message: "Permission needs input".to_owned(),
            },
        }
    }

    fn summary(sessions: &[Pending]) -> (ProgramState, Option<String>, Option<String>) {
        let root = reports(sessions).shift_remove(ROOT).unwrap();
        assert_eq!(root.id, ROOT);
        (root.state, root.title, root.message)
    }

    #[test]
    fn the_root_summarizes_the_pending_sessions() {
        let need = |count| Some(format!("{count} sessions need input"));
        let permission = ProgramState::Blocked(Some(ProgramKind::Permission));
        let table = [
            (vec![], (ProgramState::Idle, None, None)),
            (
                vec![working("ses_a", "A")],
                (ProgramState::Working, Some("A".to_owned()), None),
            ),
            (
                vec![working("ses_a", "A"), working("ses_b", "B")],
                (
                    ProgramState::Working,
                    None,
                    Some("2 sessions working".to_owned()),
                ),
            ),
            (
                vec![
                    working("ses_a", "A"),
                    blocked("ses_b", ProgramKind::Permission),
                ],
                (permission, None, Some("Permission needs input".to_owned())),
            ),
            (
                vec![
                    blocked("ses_a", ProgramKind::Permission),
                    blocked("ses_b", ProgramKind::Permission),
                ],
                (permission, None, need(2)),
            ),
            (
                vec![
                    blocked("ses_a", ProgramKind::Permission),
                    blocked("ses_b", ProgramKind::Question),
                    working("ses_c", "C"),
                ],
                (ProgramState::Blocked(None), None, need(2)),
            ),
        ];
        for (sessions, expected) in table {
            assert_eq!(summary(&sessions), expected, "{sessions:?}");
        }
    }

    #[test]
    fn each_session_has_its_own_record() {
        let all = reports(&[
            working("ses_a", "A"),
            blocked("bad id", ProgramKind::Question),
        ]);
        let keys: Vec<&str> = all.keys().map(String::as_str).collect();
        assert_eq!(keys, ["", "ses_a", "ses_4b2d2ff66c98b2a1"]);
        assert_eq!(all["ses_a"].state, ProgramState::Working);
        assert_eq!(all["ses_a"].app, Some(APP));
        assert_eq!(all[2].id, "ses_4b2d2ff66c98b2a1");
        assert_eq!(all[2].message.as_deref(), Some("Permission needs input"));
    }

    #[test]
    fn only_changes_are_sent_and_gone_sessions_are_cleared() {
        let mut sent = Sent::new();
        let mut log = Vec::new();
        let mut step = |sent: &mut Sent, sessions: &[Pending], accept: bool| {
            update(sent, &reports(sessions), |record| {
                log.push((record.state, record.id.clone()));
                accept
            });
        };
        step(&mut sent, &[working("ses_a", "A")], true);
        step(&mut sent, &[working("ses_a", "A")], true);
        step(
            &mut sent,
            &[blocked("ses_a", ProgramKind::Permission)],
            true,
        );
        step(&mut sent, &[], true);
        // A terminal that did not take a record gets it again next time.
        step(&mut sent, &[working("ses_b", "B")], false);
        step(&mut sent, &[working("ses_b", "B")], true);
        let blocked = ProgramState::Blocked(Some(ProgramKind::Permission));
        let id = |id: &str| id.to_owned();
        assert_eq!(
            log,
            [
                (ProgramState::Working, id("")),
                (ProgramState::Working, id("ses_a")),
                (blocked, id("")),
                (blocked, id("ses_a")),
                (ProgramState::Clear, id("ses_a")),
                (ProgramState::Idle, id("")),
                (ProgramState::Working, id("")),
                (ProgramState::Working, id("ses_b")),
                (ProgramState::Working, id("")),
                (ProgramState::Working, id("ses_b")),
            ]
        );
    }

    #[test]
    fn ids_are_kept_when_valid() {
        let long = "s".repeat(33);
        let table = [
            (
                "ses_01JABCDEFGHJKMNPQRSTVWXYZ0",
                "ses_01JABCDEFGHJKMNPQRSTVWXYZ0",
            ),
            ("a.b+c-d_e", "a.b+c-d_e"),
            ("", "ses_e3b0c44298fc1c14"),
            ("bad id", "ses_4b2d2ff66c98b2a1"),
            (long.as_str(), "ses_92e184bdc693d19f"),
        ];
        for (input, expected) in table {
            assert_eq!(record_id(input), expected, "{input:?}");
        }
    }

    #[test]
    fn text_is_one_line_within_the_byte_limit() {
        assert_eq!(clip(None, 10), None);
        assert_eq!(clip(Some(" \n\t "), 10), None);
        assert_eq!(
            clip(Some("a\x1b[31m\n\nb\u{a0} c"), 20).as_deref(),
            Some("a [31m b c")
        );
        assert_eq!(clip(Some("abcdefghij"), 10).as_deref(), Some("abcdefghij"));
        assert_eq!(clip(Some("abcdefghijk"), 10).as_deref(), Some("abcdefg…"));
        // "é" is two bytes: the cut at byte 6 splits the third one.
        assert_eq!(clip(Some("aéééééé"), 9).as_deref(), Some("aéé…"));
    }
}
