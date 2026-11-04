//! Notifications (E.19a, row N01, `attention.ts:35-189`): the attention service plugins call (TS
//! `context.attention.notify`). A request becomes a desktop notification through the terminal when
//! `attention.notifications` is on and its focus rule holds; sounds are E.19b's.
//!
//! `app::Tui` holds one [`Attention`]; `app::mount` calls [`install`] once.

use std::cell::{Cell, RefCell};
use std::sync::LazyLock;

use opencode_local::cli_config::{AttentionSoundName, Info};
use regex::Regex;

use super::focus::{self, Focus, Skip, When};
use crate::app::Tui;

const DEFAULT_TITLE: &str = "OpenCode";
const TITLE_LIMIT: usize = 80;
const MESSAGE_LIMIT: usize = 240;

/// The attention state of one TUI: the focus, and the program status records sent.
#[derive(Default)]
pub struct Attention {
    pub(super) focus: Cell<Focus>,
    pub(super) program: RefCell<super::program_status::Sent>,
}

impl Attention {
    pub fn focus(&self) -> Focus {
        self.focus.get()
    }
}

/// One request (`AttentionNotifyOptions`).
#[derive(Clone, Debug, PartialEq)]
pub struct Request {
    pub title: Option<String>,
    pub message: String,
    /// `None` is `notification: false`.
    pub notification: Option<When>,
    /// `None` is `sound: false`.
    pub sound: Option<Sound>,
}

/// The sound a request asks for (`AttentionNotifyOptions.sound`).
#[derive(Clone, Debug, PartialEq)]
pub struct Sound {
    pub name: AttentionSoundName,
    pub when: When,
    /// Overrides `attention.volume`.
    pub volume: Option<f64>,
}

/// What a request did (`AttentionNotifyResult`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    pub ok: bool,
    pub notification: bool,
    pub sound: bool,
    pub skipped: Option<Skip>,
}

pub fn install(tui: &Tui) {
    focus::install(tui);
}

/// Sends `request` as a terminal notification under the current config and focus.
pub fn notify(tui: &Tui, request: &Request) -> Outcome {
    let destroyed = tui.app.is_quitting();
    decide(
        &tui.settings.info(),
        tui.attention.focus(),
        destroyed,
        request,
        |message, title| tui.app.notify(message, Some(title)),
    )
}

/// `notify` without the terminal: `trigger` sends the notification and says whether the terminal took it.
fn decide(
    info: &Info,
    focus: Focus,
    destroyed: bool,
    request: &Request,
    trigger: impl FnOnce(&str, &str) -> bool,
) -> Outcome {
    let config = info.attention.clone().unwrap_or_default();
    let notifications = config.notifications.unwrap_or(false);
    let sounds = config.sound.unwrap_or(false);
    if !notifications && !sounds {
        return skipped(Skip::AttentionDisabled);
    }
    if destroyed {
        return skipped(Skip::RendererDestroyed);
    }
    let message = normalize_text(Some(&request.message), "", MESSAGE_LIMIT);
    if message.is_empty() {
        return skipped(Skip::EmptyMessage);
    }

    let notification_skip = focus::skip(request.notification.unwrap_or(When::Blurred), focus);
    let requested = notifications && request.notification.is_some();
    let notification = requested
        && notification_skip.is_none()
        && trigger(
            &message,
            &normalize_text(request.title.as_deref(), DEFAULT_TITLE, TITLE_LIMIT),
        );
    // E.19b plays the sound; the focus rule already decides what a skipped request reports.
    let sound_skip = request
        .sound
        .as_ref()
        .filter(|_| sounds)
        .and_then(|sound| focus::skip(sound.when, focus));
    let sound = false;

    if !notification && !sound {
        if let Some(skip) = notification_skip.filter(|_| requested) {
            return skipped(skip);
        }
        if let Some(skip) = sound_skip {
            return skipped(skip);
        }
    }
    Outcome {
        ok: notification || sound,
        notification,
        sound,
        skipped: None,
    }
}

fn skipped(reason: Skip) -> Outcome {
    Outcome {
        skipped: Some(reason),
        ..Outcome::default()
    }
}

/// `normalizeText`: escape sequences and control characters removed, line breaks as one space, trimmed, at most
/// `limit` characters, else `fallback`.
fn normalize_text(input: Option<&str>, fallback: &str, limit: usize) -> String {
    static ANSI: LazyLock<Regex> = LazyLock::new(|| {
        // `ansi-regex` 6.3, which `strip-ansi` uses.
        Regex::new(concat!(
            r"\x1b\][^\x07\x1b\x{9c}]*(?:\x07|\x1b\\|\x{9c})",
            r"|[\x1b\x{9b}][\[\]()#;?]*(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]",
        ))
        .unwrap()
    });
    static BREAKS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[ \t]*[\r\n]+[ \t]*").unwrap());
    static CONTROLS: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"[\x00-\x09\x0b\x0c\x0e-\x1f\x7f-\x{9f}]").unwrap());
    let text = ANSI.replace_all(input.unwrap_or_default(), "");
    let text = BREAKS.replace_all(&text, " ");
    let text = CONTROLS.replace_all(&text, "");
    let text = text.trim();
    let text = if text.is_empty() { fallback } else { text };
    text.chars().take(limit).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(notifications: bool, sound: bool) -> Info {
        Info {
            attention: Some(opencode_local::cli_config::Attention {
                notifications: Some(notifications),
                sound: Some(sound),
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    fn request(notification: Option<When>, sound: Option<When>) -> Request {
        Request {
            title: Some("Demo session".to_owned()),
            message: "Session done".to_owned(),
            notification,
            sound: sound.map(|when| Sound {
                name: AttentionSoundName::Done,
                when,
                volume: None,
            }),
        }
    }

    /// The outcome and the notification sent, if any.
    fn run(info: &Info, focus: Focus, request: &Request) -> (Outcome, Option<(String, String)>) {
        let mut sent = None;
        let outcome = decide(info, focus, false, request, |message, title| {
            sent = Some((message.to_owned(), title.to_owned()));
            true
        });
        (outcome, sent)
    }

    #[test]
    fn notifications_follow_the_config_and_the_focus() {
        let blurred = request(Some(When::Blurred), Some(When::Always));
        let sent = Some(("Session done".to_owned(), "Demo session".to_owned()));
        let ok = Outcome {
            ok: true,
            notification: true,
            ..Outcome::default()
        };
        let table = [
            (
                info(false, false),
                Focus::Blurred,
                skipped(Skip::AttentionDisabled),
                None,
            ),
            (info(true, false), Focus::Blurred, ok, sent.clone()),
            (
                info(true, false),
                Focus::Focused,
                skipped(Skip::Focused),
                None,
            ),
            (
                info(true, false),
                Focus::Unknown,
                skipped(Skip::FocusUnknown),
                None,
            ),
            // Sounds on but not played yet (E.19b): `always` holds, so nothing reports a skip.
            (info(false, true), Focus::Focused, Outcome::default(), None),
            (info(true, true), Focus::Blurred, ok, sent),
        ];
        for (info, focus, outcome, notification) in table {
            assert_eq!(
                run(&info, focus, &blurred),
                (outcome, notification),
                "{focus:?}"
            );
        }
    }

    #[test]
    fn requests_choose_their_own_rules() {
        let on = info(true, true);
        assert_eq!(
            run(&on, Focus::Focused, &request(None, Some(When::Always))),
            (Outcome::default(), None),
            "notification: false sends nothing and skips nothing"
        );
        assert_eq!(
            run(&on, Focus::Blurred, &request(None, Some(When::Focused))).0,
            skipped(Skip::Blurred),
            "the sound's rule reports when no notification was asked for"
        );
        assert!(
            run(&on, Focus::Focused, &request(Some(When::Focused), None))
                .0
                .notification
        );
        assert!(
            run(&on, Focus::Unknown, &request(Some(When::Always), None))
                .0
                .notification
        );
        let mut empty = request(Some(When::Always), None);
        empty.message = " \x1b[31m\n ".to_owned();
        assert_eq!(
            run(&on, Focus::Focused, &empty).0,
            skipped(Skip::EmptyMessage)
        );
        let destroyed = decide(
            &on,
            Focus::Blurred,
            true,
            &request(Some(When::Always), None),
            |_, _| true,
        );
        assert_eq!(destroyed, skipped(Skip::RendererDestroyed));
        let refused = decide(
            &on,
            Focus::Blurred,
            false,
            &request(Some(When::Blurred), None),
            |_, _| false,
        );
        assert_eq!(
            refused,
            Outcome::default(),
            "a terminal without notifications"
        );
    }

    #[test]
    fn text_is_one_clean_line_within_the_limit() {
        let table = [
            ("\x1b[1mBold\x1b[0m text", "", 240, "Bold text"),
            ("one  \r\n\t two\nthree", "", 240, "one two three"),
            ("bell\x07 and\x7f\u{85} c1", "", 240, "bell and c1"),
            (
                "\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\",
                "",
                240,
                "link",
            ),
            ("   ", "OpenCode", 80, "OpenCode"),
            ("ééééé", "", 3, "ééé"),
        ];
        for (input, fallback, limit, expected) in table {
            assert_eq!(
                normalize_text(Some(input), fallback, limit),
                expected,
                "{input:?}"
            );
        }
        assert_eq!(normalize_text(None, "OpenCode", 80), "OpenCode");
    }
}
