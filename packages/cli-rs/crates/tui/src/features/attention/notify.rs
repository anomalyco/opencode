//! Notifications (E.19a, row N01, `attention.ts:35-189`): the attention service plugins call (TS
//! `context.attention.notify`). A request becomes a desktop notification through the terminal when
//! `attention.notifications` is on and its focus rule holds, and its sound plays (E.19b, [`super::sound`]) when
//! `attention.sound` is on and the sound's focus rule holds.
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
    pub sound: super::sound::Player,
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

/// Sends `request` as a terminal notification and plays its sound under the current config and focus.
pub fn notify(tui: &Tui, request: &Request) -> Outcome {
    let destroyed = tui.app.is_quitting();
    let info = tui.settings.info();
    let overrides = info.attention.as_ref().and_then(|attention| attention.sounds.clone()).unwrap_or_default();
    decide(
        &info,
        tui.attention.focus(),
        destroyed,
        request,
        |message, title| tui.app.notify(message, Some(title)),
        |name, volume| tui.attention.sound.play(tui.app.session().context(), name, &overrides, volume),
    )
}

/// `notify` without the terminal: `trigger` sends the notification and says whether the terminal took it; `play`
/// plays a sound at a volume and says whether it plays.
fn decide(
    info: &Info,
    focus: Focus,
    destroyed: bool,
    request: &Request,
    trigger: impl FnOnce(&str, &str) -> bool,
    play: impl FnOnce(AttentionSoundName, f32) -> bool,
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
        && trigger(&message, &normalize_text(request.title.as_deref(), DEFAULT_TITLE, TITLE_LIMIT));
    let requested_sound = request.sound.as_ref().filter(|_| sounds);
    let sound_skip = requested_sound.and_then(|sound| focus::skip(sound.when, focus));
    let volume = config.volume.map_or(0.4, |volume| volume.0);
    let sound = sound_skip.is_none()
        && requested_sound
            .is_some_and(|sound| play(sound.name, super::sound::clamp_volume(sound.volume.unwrap_or(volume))));

    if !notification && !sound {
        if let Some(skip) = notification_skip.filter(|_| requested) {
            return skipped(skip);
        }
        if let Some(skip) = sound_skip {
            return skipped(skip);
        }
    }
    Outcome { ok: notification || sound, notification, sound, skipped: None }
}

fn skipped(reason: Skip) -> Outcome {
    Outcome { skipped: Some(reason), ..Outcome::default() }
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
            sound: sound.map(|when| Sound { name: AttentionSoundName::Done, when, volume: None }),
        }
    }

    /// The outcome and the notification sent, if any.
    fn run(info: &Info, focus: Focus, request: &Request) -> (Outcome, Option<(String, String)>) {
        let (outcome, sent, _) = run_with_sound(info, focus, request);
        (outcome, sent)
    }

    /// The outcome, the notification sent, and the sound played, if any. The engine takes every sound.
    #[allow(clippy::type_complexity)]
    fn run_with_sound(
        info: &Info,
        focus: Focus,
        request: &Request,
    ) -> (Outcome, Option<(String, String)>, Option<(AttentionSoundName, f32)>) {
        let (mut sent, mut played) = (None, None);
        let outcome = decide(
            info,
            focus,
            false,
            request,
            |message, title| {
                sent = Some((message.to_owned(), title.to_owned()));
                true
            },
            |name, volume| {
                played = Some((name, volume));
                true
            },
        );
        (outcome, sent, played)
    }

    #[test]
    fn notifications_follow_the_config_and_the_focus() {
        let blurred = request(Some(When::Blurred), Some(When::Always));
        let sent = Some(("Session done".to_owned(), "Demo session".to_owned()));
        let done = Some((AttentionSoundName::Done, 0.4));
        let notified = Outcome { ok: true, notification: true, ..Outcome::default() };
        let sounded = Outcome { ok: true, sound: true, ..Outcome::default() };
        let both = Outcome { ok: true, notification: true, sound: true, skipped: None };
        let table = [
            (info(false, false), Focus::Blurred, skipped(Skip::AttentionDisabled), None, None),
            (info(true, false), Focus::Blurred, notified, sent.clone(), None),
            (info(true, false), Focus::Focused, skipped(Skip::Focused), None, None),
            (info(true, false), Focus::Unknown, skipped(Skip::FocusUnknown), None, None),
            // The sound's rule is `always`: it plays whatever the focus.
            (info(false, true), Focus::Focused, sounded, None, done),
            (info(true, true), Focus::Focused, sounded, None, done),
            (info(true, true), Focus::Blurred, both, sent, done),
        ];
        for (info, focus, outcome, notification, sound) in table {
            assert_eq!(run_with_sound(&info, focus, &blurred), (outcome, notification, sound), "{focus:?}");
        }
    }

    #[test]
    fn requests_choose_their_own_rules() {
        let on = info(true, true);
        assert_eq!(
            run(&on, Focus::Focused, &request(None, None)),
            (Outcome::default(), None),
            "notification: false and sound: false send nothing and skip nothing"
        );
        assert_eq!(
            run(&on, Focus::Blurred, &request(None, Some(When::Focused))).0,
            skipped(Skip::Blurred),
            "the sound's rule reports when no notification was asked for"
        );
        assert!(run(&on, Focus::Focused, &request(Some(When::Focused), None)).0.notification);
        assert!(run(&on, Focus::Unknown, &request(Some(When::Always), None)).0.notification);
        let mut empty = request(Some(When::Always), None);
        empty.message = " \x1b[31m\n ".to_owned();
        assert_eq!(run(&on, Focus::Focused, &empty).0, skipped(Skip::EmptyMessage));
        let destroyed = decide(&on, Focus::Blurred, true, &request(Some(When::Always), None), |_, _| true, |_, _| true);
        assert_eq!(destroyed, skipped(Skip::RendererDestroyed));
        let refused =
            decide(&on, Focus::Blurred, false, &request(Some(When::Blurred), None), |_, _| false, |_, _| true);
        assert_eq!(refused, Outcome::default(), "a terminal without notifications");
    }

    #[test]
    fn sounds_follow_their_name_rule_and_volume() {
        let on = info(false, true);
        let sound = |name, when, volume| Request {
            sound: Some(Sound { name, when, volume }),
            ..request(Some(When::Blurred), None)
        };
        let table = [
            (sound(AttentionSoundName::Permission, When::Always, None), Some((AttentionSoundName::Permission, 0.4))),
            (sound(AttentionSoundName::Error, When::Always, Some(0.9)), Some((AttentionSoundName::Error, 0.9))),
            (sound(AttentionSoundName::Question, When::Always, Some(7.0)), Some((AttentionSoundName::Question, 1.0))),
            (sound(AttentionSoundName::Default, When::Always, Some(-1.0)), Some((AttentionSoundName::Default, 0.0))),
            (sound(AttentionSoundName::SubagentDone, When::Blurred, None), None),
        ];
        for (request, played) in table {
            assert_eq!(run_with_sound(&on, Focus::Focused, &request).2, played, "{:?}", request.sound);
        }
        let blurred = run_with_sound(&on, Focus::Focused, &sound(AttentionSoundName::Done, When::Blurred, None));
        assert_eq!(blurred.0, skipped(Skip::Focused), "the sound's rule held it back");
        let mut volume = info(false, true);
        volume.attention.as_mut().unwrap().volume = Some(opencode_local::cli_config::Bounded(0.7));
        let played = run_with_sound(&volume, Focus::Focused, &sound(AttentionSoundName::Done, When::Always, None)).2;
        assert_eq!(played, Some((AttentionSoundName::Done, 0.7)), "attention.volume");
        let failed = decide(
            &on,
            Focus::Focused,
            false,
            &sound(AttentionSoundName::Done, When::Always, None),
            |_, _| true,
            |_, _| false,
        );
        assert_eq!(failed, Outcome::default(), "no engine, no sound, no skip");
    }

    #[test]
    fn text_is_one_clean_line_within_the_limit() {
        let table = [
            ("\x1b[1mBold\x1b[0m text", "", 240, "Bold text"),
            ("one  \r\n\t two\nthree", "", 240, "one two three"),
            ("bell\x07 and\x7f\u{85} c1", "", 240, "bell and c1"),
            ("\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\", "", 240, "link"),
            ("   ", "OpenCode", 80, "OpenCode"),
            ("ééééé", "", 3, "ééé"),
        ];
        for (input, fallback, limit, expected) in table {
            assert_eq!(normalize_text(Some(input), fallback, limit), expected, "{input:?}");
        }
        assert_eq!(normalize_text(None, "OpenCode", 80), "OpenCode");
    }
}
