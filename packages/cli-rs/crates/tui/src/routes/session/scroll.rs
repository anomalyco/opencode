//! Scrolling and the scrollbar (E.8): the scroll commands, "Jump to latest", `session.first` and
//! `session.last`, the scrollbar, and the wheel speed (`routes/session/index.tsx:896-1051,1181-1223,
//! 1524-1592`, `util/scroll.ts`). Message navigation is in `navigation.rs`.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::time::{Duration, Instant};

use opencode_local::cli_config::{Grouping, Info, SubmitScroll, Verbosity};
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, TuiCommand};
use opencode_ui::theme::Theme;
use opentui::input::MouseEventKind;
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;
use opentui::widget::{MacOsScroll, ScrollAcceleration};
use serde_json::Value;

use super::messages::list::{ScrollAnchor, Transcript};
use crate::app::Tui;
use crate::dialogs::settings;

/// The scroll and navigation state of one session view.
pub struct Controls(pub(super) Rc<Inner>);

pub(super) struct Inner {
    pub(super) tui: Weak<Tui>,
    pub(super) this: Weak<Inner>,
    pub(super) transcript: Transcript,
    theme: Theme,
    latest: View,
    latest_text: Text,
    latest_hover: Cell<bool>,
    /// Space after the rows, so a message near the end can align to the top (`NAVIGATION_SLACK_ID`).
    slack: View,
    pub(super) slack_height: Cell<f64>,
    /// The message navigation aligned last (`navigationMessage`).
    pub(super) navigation: RefCell<Option<String>>,
    /// `session.first` is loading the history.
    first_jump: Cell<bool>,
    away: Cell<bool>,
    scrollbar: Cell<bool>,
    /// The tab's saved position was restored; until then nothing overwrites it (`restored`).
    restored: Cell<bool>,
    layers: RefCell<Vec<Disposer>>,
}

impl Controls {
    pub fn new(tui: &Tui, transcript: &Transcript) -> Self {
        let app = &tui.app;
        let theme = tui.page();
        let latest_text = Text::new(app, "Jump to latest ↓").fg(theme.text.action.secondary.base);
        let latest = View::new(app)
            .padding_edge(Edge::Left, 1)
            .visible(false)
            .child(&latest_text);
        transcript.status().add(&latest);
        let slack = View::new(app).shrink(0.0).height(0).visible(false);
        transcript.scroll().add(&slack);
        let inner = Rc::new_cyclic(|this| Inner {
            tui: tui.weak(),
            this: this.clone(),
            transcript: transcript.clone(),
            theme,
            latest,
            latest_text,
            latest_hover: Cell::new(false),
            slack,
            slack_height: Cell::new(0.0),
            navigation: RefCell::default(),
            first_jump: Cell::new(false),
            away: Cell::new(false),
            scrollbar: Cell::new(false),
            restored: Cell::new(false),
            layers: RefCell::default(),
        });
        inner.install(tui);
        Self(inner)
    }

    /// The prompt's `onSubmit` (`index.tsx:1650-1652`): back to the newest rows after a send, unless
    /// `session.submit_scroll` is `keep`.
    pub fn follow_submits(&self, prompt: &crate::prompt::editor::Prompt) {
        let weak = Rc::downgrade(&self.0);
        prompt.on_submit(move |tui| {
            let keep = tui
                .settings
                .info()
                .session
                .and_then(|session| session.submit_scroll)
                == Some(SubmitScroll::Keep);
            if let Some(inner) = weak.upgrade().filter(|_| !keep) {
                inner.to_bottom(tui);
            }
        });
    }

    /// Once the session's first sync is done, returns to where the reader left the tab, unless they
    /// moved meanwhile (`restoreScrollPosition`).
    pub fn restore(&self, tui: &Tui) {
        let inner = &self.0;
        if inner.restored.replace(true) || inner.is_away() {
            return;
        }
        let Some(session) = inner.transcript.session() else {
            return;
        };
        let Some(anchor) = tui
            .tabs
            .scroll_anchor(tui, &session.0)
            .filter(|anchor| inner.transcript.mount_around(tui, &anchor.row))
        else {
            return;
        };
        inner.transcript.scroll().sticky(false);
        inner.restore_step(tui, anchor);
    }
}

impl Drop for Inner {
    fn drop(&mut self) {
        if let Some(tui) = self.tui.upgrade() {
            self.save_anchor(&tui, self.is_away());
            dispose(&tui, std::mem::take(&mut *self.layers.borrow_mut()));
        }
    }
}

/// Unregisters `layers`. A command may drop the view while the keymap runs it, so they go afterwards.
fn dispose(tui: &Tui, layers: Vec<Disposer>) {
    tui.app.defer(move |_| drop(layers));
}

impl Inner {
    fn install(&self, tui: &Tui) {
        self.configure(&tui.settings.info());
        let weak = self.this.clone();
        tui.settings.on_change(move |tui| {
            let Some(inner) = weak.upgrade() else { return };
            inner.configure(&tui.settings.info());
            inner.register(tui);
        });
        let weak = self.this.clone();
        self.latest.on_click(move |_, _| {
            let Some(inner) = weak.upgrade() else { return };
            let Some(tui) = inner.tui.upgrade() else {
                return;
            };
            inner.to_bottom(&tui);
        });
        let weak = self.this.clone();
        self.latest.on_hover(move |_, hovered| {
            let Some(inner) = weak.upgrade() else { return };
            inner.latest_hover.set(hovered);
            let action = &inner.theme.text.action.secondary;
            inner
                .latest_text
                .fg(if hovered { action.hovered } else { action.base });
        });
        // The wheel and the content's growth move the view; the label follows after they settle.
        let weak = self.this.clone();
        self.transcript.scroll().on_mouse(move |cx, event| {
            if !matches!(
                event.kind,
                MouseEventKind::ScrollUp | MouseEventKind::ScrollDown
            ) {
                return;
            }
            let Some(inner) = weak.upgrade() else { return };
            if inner.first_jump.get() {
                inner.clear_navigation();
            }
            let weak = weak.clone();
            cx.set_timeout(Duration::ZERO, move |_| {
                if let Some(inner) = weak.upgrade() {
                    inner.update_away();
                }
            });
        });
        let weak = self.this.clone();
        self.transcript
            .scroll()
            .content_view()
            .on_resize(move |_, _| {
                if let Some(inner) = weak.upgrade() {
                    inner.update_away();
                }
            });
        self.register(tui);
    }

    /// `session.scrollbar` and the `scroll` section.
    fn configure(&self, info: &Info) {
        let session = info.session.as_ref();
        let scrollbar = session
            .and_then(|session| session.scrollbar)
            .unwrap_or(false);
        self.scrollbar.set(scrollbar);
        let scroll = self.transcript.scroll();
        scroll.scrollbars(scrollbar);
        scroll.scrollbar_colors(
            self.theme.border.base,
            self.theme.decrease(&self.theme.background.raised.base, 1),
        );
        // The viewport's and the bar's one-cell paddings (`viewportOptions`, `verticalScrollbarOptions`).
        // The wrapper's resizes the viewport, which shows or hides the bar right away.
        let padding = u16::from(scrollbar);
        scroll.content_view().padding_edge(Edge::Right, padding);
        scroll.wrapper_view().padding_edge(Edge::Right, padding);
        let speed = info.scroll.as_ref();
        if speed.and_then(|scroll| scroll.acceleration) == Some(true) {
            scroll.scroll_acceleration(MacOsScroll::default());
        } else {
            let speed = speed
                .and_then(|scroll| scroll.speed)
                .map_or(3.0, |speed| speed.0);
            scroll.scroll_acceleration(Speed(speed));
        }
    }

    /// The session's scroll and navigation commands, in TS's three layers (`index.tsx:1446-1459`):
    /// the scroll keys in every mode, `session.first` and `session.last` also while no editor has
    /// focus, and the rest in the base mode.
    pub(super) fn register(&self, tui: &Tui) {
        dispose(tui, std::mem::take(&mut *self.layers.borrow_mut()));
        let command = |id: &str, title: &str, run: fn(&Inner, &Tui)| {
            let weak = self.this.clone();
            TuiCommand::new(id, move |_, _| {
                let Some(inner) = weak.upgrade() else { return };
                let Some(tui) = inner.tui.upgrade() else {
                    return;
                };
                run(&inner, &tui);
                tui.dialogs.clear();
            })
            .title(title)
            .group("Session")
            .bind(Bind::Off)
        };
        let info = tui.settings.info();
        let session = info.session.unwrap_or_default();
        let grouping = session.grouping != Some(Grouping::None);
        let verbosity = session.verbosity.unwrap_or(Verbosity::Medium);
        let commands = vec![
            command("session.page.up", "Page up", |inner, tui| {
                inner.move_by(tui, -inner.height() / 2.0)
            }),
            command("session.page.down", "Page down", |inner, tui| {
                inner.move_by(tui, inner.height() / 2.0)
            }),
            command("session.line.up", "Line up", |inner, tui| {
                inner.move_by(tui, -1.0)
            }),
            command("session.line.down", "Line down", |inner, tui| {
                inner.move_by(tui, 1.0)
            }),
            command("session.half.page.up", "Half page up", |inner, tui| {
                inner.move_by(tui, -inner.height() / 4.0)
            }),
            command("session.half.page.down", "Half page down", |inner, tui| {
                inner.move_by(tui, inner.height() / 4.0)
            }),
            command("session.first", "First message", Inner::first),
            command("session.last", "Last message", Inner::to_bottom),
            command(
                "session.toggle.scrollbar",
                "Toggle session scrollbar",
                |inner, tui| {
                    let next = !inner.scrollbar.get();
                    set(tui, "scrollbar", Value::Bool(next));
                },
            ),
            command(
                "session.toggle.exploration_grouping",
                if grouping {
                    "Show tool calls individually"
                } else {
                    "Group related tool calls"
                },
                |_, tui| {
                    let grouping = tui
                        .settings
                        .info()
                        .session
                        .and_then(|session| session.grouping)
                        != Some(Grouping::None);
                    set(
                        tui,
                        "grouping",
                        Value::from(if grouping { "none" } else { "auto" }),
                    );
                },
            ),
            command(
                "session.verbosity.cycle",
                &format!("Verbosity: {}", titlecase(verbosity.as_str())),
                |_, tui| {
                    let current = tui
                        .settings
                        .info()
                        .session
                        .and_then(|session| session.verbosity)
                        .unwrap_or(Verbosity::Medium);
                    let next = match current {
                        Verbosity::Low => "medium",
                        Verbosity::Medium => "high",
                        Verbosity::High => "low",
                    };
                    set(tui, "verbosity", Value::from(next));
                },
            )
            .palette(),
            command(
                "session.messages_last_user",
                "Jump to last user message",
                Inner::last_user,
            ),
            command("session.message.next", "Next message", |inner, tui| {
                inner.to_message(tui, true, false)
            }),
            command(
                "session.message.previous",
                "Previous message",
                |inner, tui| inner.to_message(tui, false, false),
            ),
            command(
                "session.message.user.next",
                "Next user message",
                |inner, tui| inner.to_message(tui, true, true),
            ),
            command(
                "session.message.user.previous",
                "Previous user message",
                |inner, tui| inner.to_message(tui, false, true),
            ),
        ];
        let names = |names: &[&str]| names.iter().map(|name| (*name).to_owned()).collect();
        let unfocused = {
            let app = tui.app.clone();
            let textarea = tui.textarea.clone();
            Condition::when(move || {
                textarea.borrow().as_ref().is_none_or(|textarea| {
                    app.focused()
                        .is_none_or(|widget| widget.id() != textarea.id())
                })
            })
        };
        let layers = [
            KeymapLayer {
                mode: Some(GLOBAL_MODE.to_owned()),
                commands,
                bindings: names(&[
                    "session.page.up",
                    "session.page.down",
                    "session.line.up",
                    "session.line.down",
                    "session.half.page.up",
                    "session.half.page.down",
                ]),
                ..KeymapLayer::default()
            },
            KeymapLayer {
                enabled: unfocused,
                bindings: names(&["session.first", "session.last"]),
                ..KeymapLayer::default()
            },
            KeymapLayer {
                bindings: names(&[
                    "session.first",
                    "session.last",
                    "session.toggle.scrollbar",
                    "session.toggle.exploration_grouping",
                    "session.verbosity.cycle",
                    "session.messages_last_user",
                    "session.message.next",
                    "session.message.previous",
                    "session.message.user.next",
                    "session.message.user.previous",
                ]),
                ..KeymapLayer::default()
            },
        ];
        for layer in layers {
            match tui.keymap.layer(layer) {
                Ok(disposer) => self.layers.borrow_mut().push(disposer),
                Err(error) => log::error!("session scroll keymap layer: {error}"),
            }
        }
    }

    /// The scroll box's height (`scroll.height`).
    fn height(&self) -> f64 {
        f64::from(self.transcript.scroll().rect().height)
    }

    /// `moveTranscript`: scrolls by `delta` rows. Near the top, older rows mount first and the move
    /// follows once they are laid out.
    fn move_by(&self, tui: &Tui, delta: f64) {
        self.clear_navigation();
        let scroll = self.transcript.scroll().clone();
        if delta < 0.0 && self.transcript.reveal_older(tui)
            || delta > 0.0 && self.transcript.reveal_newer(tui)
        {
            let weak = self.this.clone();
            after_layout(&tui.app, move || {
                scroll.scroll_by(0.0, delta);
                if let Some(inner) = weak.upgrade() {
                    inner.update_away();
                }
            });
            return;
        }
        scroll.scroll_by(0.0, delta);
        self.transcript.follow(tui, delta > 0.0);
        self.update_away();
    }

    /// `session.first`: loads every older page, mounts the oldest rows, and scrolls to the top. The
    /// history hint shows meanwhile.
    fn first(&self, tui: &Tui) {
        if self.first_jump.get() {
            return;
        }
        self.clear_navigation();
        self.first_jump.set(true);
        self.transcript.hint().visible(true);
        self.update_away();
        let weak = self.this.clone();
        self.transcript.load_all(tui, move |tui, result| {
            let Some(inner) = weak.upgrade() else { return };
            if !inner.first_jump.get() {
                return;
            }
            if let Err(error) = result {
                inner.end_first_jump();
                tui.toasts.error(error);
                return;
            }
            inner.transcript.mount_head(tui);
            let scroll = inner.transcript.scroll();
            scroll.sticky(false);
            scroll.scroll_to(0.0, 0.0);
            let weak = inner.this.clone();
            after_layout(&tui.app, move || {
                let Some(inner) = weak.upgrade() else { return };
                if !inner.first_jump.get() {
                    return;
                }
                inner.transcript.scroll().scroll_to(0.0, 0.0);
                inner.end_first_jump();
            });
        });
    }

    fn end_first_jump(&self) {
        self.first_jump.set(false);
        self.transcript.hint().visible(false);
        self.update_away();
    }

    /// `toBottom`: the tail again, following the bottom.
    pub(super) fn to_bottom(&self, tui: &Tui) {
        self.clear_navigation();
        self.transcript.to_tail(tui);
        self.away.set(false);
        self.latest.visible(false);
        self.save_anchor(tui, false);
    }

    /// One step of `restoreScrollPosition` after a layout: puts the anchor's row back at its distance
    /// from the top, mounting newer rows or adding slack below them while the target is past the end.
    fn restore_step(&self, tui: &Tui, anchor: ScrollAnchor) {
        let weak = self.this.clone();
        after_layout(&tui.app, move || {
            let Some(inner) = weak.upgrade() else { return };
            let Some(tui) = inner.tui.upgrade() else {
                return;
            };
            let Some(y) = inner.transcript.row_y(&anchor.row) else {
                inner.to_bottom(&tui);
                return;
            };
            let target = y - anchor.screen_y;
            let content = f64::from(inner.transcript.scroll().content_view().rect().height);
            let viewport = inner.height();
            if target > (content - viewport).max(0.0) {
                if !inner.transcript.mount_newer(&tui) {
                    let current = inner.slack_height.get();
                    inner.set_slack(super::navigation::slack(target, viewport, content, current));
                }
                inner.restore_step(&tui, anchor);
                return;
            }
            inner.transcript.scroll().scroll_to(0.0, target);
            inner.update_away();
        });
    }

    /// `saveScrollAnchor`: the tab keeps the reader's row while they are away from the bottom.
    fn save_anchor(&self, tui: &Tui, away: bool) {
        if !self.restored.get() {
            return;
        }
        let Some(session) = self.transcript.session() else {
            return;
        };
        let anchor = away.then(|| self.transcript.anchor()).flatten();
        tui.tabs.set_scroll_anchor(tui, &session.0, anchor);
    }

    /// `clearMessageNavigation`.
    pub(super) fn clear_navigation(&self) {
        if self.first_jump.replace(false) {
            self.transcript.hint().visible(false);
        }
        self.navigation.replace(None);
        self.set_slack(0.0);
    }

    pub(super) fn set_slack(&self, height: f64) {
        self.slack_height.set(height);
        self.slack.visible(height > 0.0);
        self.slack.height(height.max(0.0) as u16);
        self.transcript
            .scroll()
            .sticky(self.navigation.borrow().is_none() && height <= 0.0);
    }

    /// `updateAwayFromBottom`: shows "Jump to latest" while the reader is away from the bottom.
    pub(super) fn update_away(&self) {
        let away = self.is_away();
        self.away.set(away);
        self.latest.visible(away && !self.first_jump.get());
        if !away {
            self.transcript.scroll().sticky(true);
        }
        if let Some(tui) = self.tui.upgrade() {
            self.save_anchor(&tui, away);
        }
    }

    /// `isAwayFromBottom`.
    fn is_away(&self) -> bool {
        let scroll = self.transcript.scroll();
        let (_, top) = scroll.scroll_position();
        let content = f64::from(scroll.content_view().rect().height);
        let bottom = (content - self.height()).max(0.0);
        self.navigation.borrow().is_some()
            || self.slack_height.get() > 0.0
            || self.first_jump.get()
            || !self.transcript.at_end()
            || top < bottom.floor()
    }
}

/// Writes `session.<key>` to `cli.json`; the settings listener applies it.
fn set(tui: &Tui, key: &'static str, value: Value) {
    settings::update(tui, move |root| {
        settings::set_path(root, &["session", key], value)
    });
}

fn titlecase(text: &str) -> String {
    let mut chars = text.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}

/// Runs `continuation` once the next frame is laid out (`scroll.afterLayout`): the first step runs
/// before that frame, the second before the one after it.
pub(super) fn after_layout(app: &App, continuation: impl FnOnce() + 'static) {
    let mut continuation = Some(continuation);
    let mut first = true;
    app.animate(move |_, _| {
        if std::mem::take(&mut first) {
            return true;
        }
        if let Some(continuation) = continuation.take() {
            continuation();
        }
        false
    });
}

/// `CustomSpeedScroll`: the same distance for every wheel step (`scroll.speed`, 3 by default).
struct Speed(f64);

impl ScrollAcceleration for Speed {
    fn tick(&mut self, _now: Instant) -> f64 {
        self.0
    }

    fn reset(&mut self) {}
}
