//! Scroll commands, history loading, and the jump-to-latest hint.

use std::time::Instant;

use opencode_local::cli_config::{Grouping, Info, SubmitScroll, Verbosity};
use opentui::input::MouseEventKind;
use opentui::widget::{MacOsScroll, ScrollAcceleration};

use super::grouping::DEFAULT_VERBOSITY;
use super::messages::list::{ScrollAnchor, Transcript};
use crate::dialogs::settings;
use crate::prelude::*;

pub struct Controls(pub(super) Rc<Inner>);

pub(super) struct Inner {
    pub(super) tui: Weak<Tui>,
    pub(super) this: Weak<Inner>,
    pub(super) transcript: Transcript,
    theme: RefCell<Theme>,
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
    /// Do not overwrite the saved position until restoration finishes.
    restored: Cell<bool>,
    layers: RefCell<Vec<Disposer>>,
    /// The terminal resize handler, which ends message navigation.
    resize: Cell<Option<HandlerId>>,
    /// The settings listener, until the controls drop.
    settings: RefCell<Option<Disposer>>,
}

impl Controls {
    pub fn new(tui: &Tui, transcript: &Transcript) -> Self {
        let app = &tui.app;
        let theme = tui.page();
        let latest_text = Text::new(app, "Jump to latest ↓").fg(theme.text.action.secondary.base);
        let latest = View::new(app).padding_edge(Edge::Left, 1).visible(false).child(&latest_text);
        transcript.status().add(&latest);
        // Visible while empty too, so its place marks the end of the rows.
        let slack = View::new(app).shrink(0.0).height(0);
        transcript.scroll().add(&slack);
        let inner = Rc::new_cyclic(|this| Inner {
            tui: tui.weak(),
            this: this.clone(),
            transcript: transcript.clone(),
            theme: RefCell::new(theme),
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
            resize: Cell::new(None),
            settings: RefCell::default(),
        });
        inner.install(tui);
        Self(inner)
    }

    pub fn restyle(&self, tui: &Tui) {
        *self.0.theme.borrow_mut() = tui.page();
        self.0.paint();
    }

    /// Follow a submission to the newest rows unless `session.submit_scroll` is `keep`.
    pub fn follow_submits(&self, prompt: &crate::prompt::editor::Prompt) {
        let weak = Rc::downgrade(&self.0);
        prompt.on_submit(move |tui| {
            let keep =
                tui.settings.info().session.and_then(|session| session.submit_scroll) == Some(SubmitScroll::Keep);
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
        let Some(session) = inner.transcript.session() else { return };
        let Some(anchor) =
            tui.tabs.scroll_anchor(tui, &session.0).filter(|anchor| inner.transcript.mount_around(tui, &anchor.row))
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
            if let Some(id) = self.resize.take() {
                tui.app.remove_handler(id);
            }
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
        *self.settings.borrow_mut() = Some(tui.settings.subscribe(bind!(weak, |inner, tui| {
            inner.configure(&tui.settings.info());
            inner.register(tui);
        })));
        let weak = self.this.clone();
        self.latest.mouse_pointer(MousePointer::POINTER).on_click(bind!(weak, |inner, _, _| {
            let Some(tui) = inner.tui.upgrade() else { return };
            inner.to_bottom(&tui);
        }));
        let weak = self.this.clone();
        self.latest.on_hover(bind!(weak, |inner, _, hovered| {
            inner.latest_hover.set(hovered);
            inner.paint();
        }));
        // The wheel and the content's growth move the view; the label follows after they settle.
        let weak = self.this.clone();
        self.transcript.scroll().on_mouse(move |cx, event| {
            if !matches!(event.kind, MouseEventKind::ScrollUp | MouseEventKind::ScrollDown) {
                return;
            }
            let Some(inner) = weak.upgrade() else { return };
            if inner.first_jump.get() {
                inner.clear_navigation();
            }
            cx.set_timeout(Duration::ZERO, bind!(weak, |inner, _| inner.update_away()));
        });
        self.transcript.scroll().content_view().on_resize(bind!(self.this, |inner, _, _| inner.update_away()));
        // A resize ends message navigation and drops its slack; the hint follows once the new size is laid out.
        self.resize.set(Some(tui.app.on_resize(bind!(self.this, |inner, cx, _, _| {
            inner.clear_navigation();
            after_layout(cx.app(), bind!(inner.this, |inner| inner.update_away()));
        }))));
        let weak = self.this.clone();
        self.transcript.publish(
            tui,
            Rc::new(move |verb| {
                if let Some(inner) = weak.upgrade() {
                    inner.plugin_scroll(verb);
                }
            }),
        );
        self.register(tui);
    }

    /// A plugin's verb on the published transcript (`Viewport::Transcript`), along the wheel's path in the direction
    /// it asks for, also at an edge: `session.first`'s jump ends, the window reveals rows or follows, the hint and the
    /// tab's anchor follow, and the plugins told about the transcript hear of the move. `Edge::Bottom` is the tail, as
    /// "Jump to latest" goes.
    fn plugin_scroll(&self, verb: &opencode_plugin::abi::v2::Scroll) {
        use opencode_plugin::abi::v2::{Edge, Scroll};
        let Some(tui) = self.tui.upgrade() else { return };
        let scroll = self.transcript.scroll();
        let (_, top) = scroll.scroll_position();
        let up = match verb {
            Scroll::By { rows } => {
                scroll.scroll_by(0.0, f64::from(*rows));
                *rows < 0
            }
            Scroll::Offset { offset } => {
                scroll.scroll_to(0.0, f64::from(*offset));
                f64::from(*offset) < top
            }
            Scroll::Edge { edge: Edge::Top } => {
                scroll.scroll_to(0.0, 0.0);
                true
            }
            Scroll::Edge { edge: Edge::Bottom } => {
                self.to_bottom(&tui);
                opencode_plugin::behave::transcript_moved(&tui.app);
                return;
            }
            _ => return,
        };
        if self.first_jump.get() {
            self.clear_navigation();
        }
        if !(up && self.transcript.reveal_older(&tui) || !up && self.transcript.reveal_newer(&tui)) {
            self.transcript.follow(&tui, !up);
        }
        self.update_away();
        opencode_plugin::behave::transcript_moved(&tui.app);
    }

    /// "Jump to latest" and the scrollbar in the theme.
    fn paint(&self) {
        let theme = self.theme.borrow();
        let action = &theme.text.action.secondary;
        self.latest_text.fg(if self.latest_hover.get() { action.hovered } else { action.base });
        self.transcript.scroll().scrollbar_colors(theme.border.base, theme.decrease(&theme.background.raised.base, 1));
    }

    fn configure(&self, info: &Info) {
        let session = info.session.as_ref();
        let scrollbar = session.and_then(|session| session.scrollbar).unwrap_or(false);
        self.scrollbar.set(scrollbar);
        let scroll = self.transcript.scroll();
        scroll.scrollbars(scrollbar);
        self.paint();
        let padding = u16::from(scrollbar);
        scroll.content_view().padding_edge(Edge::Right, padding);
        scroll.wrapper_view().padding_edge(Edge::Right, padding);
        let speed = info.scroll.as_ref();
        if speed.and_then(|scroll| scroll.acceleration) == Some(true) {
            scroll.scroll_acceleration(MacOsScroll::default());
        } else {
            let speed = speed.and_then(|scroll| scroll.speed).map_or(3.0, |speed| speed.0);
            scroll.scroll_acceleration(Speed(speed));
        }
    }

    /// Register scroll commands with their focus and mode restrictions.
    pub(super) fn register(&self, tui: &Tui) {
        dispose(tui, std::mem::take(&mut *self.layers.borrow_mut()));
        let command = |id: &str, title: &str, run: fn(&Inner, &Tui)| {
            TuiCommand::new(
                id,
                bind!(self.this, |inner, _, _| {
                    let Some(tui) = inner.tui.upgrade() else { return };
                    run(&inner, &tui);
                    tui.dialogs.clear();
                }),
            )
            .title(title)
            .group("Session")
            .bind(Bind::Off)
        };
        let info = tui.settings.info();
        let session = info.session.unwrap_or_default();
        let grouping = session.grouping != Some(Grouping::None);
        let verbosity = session.verbosity.unwrap_or(DEFAULT_VERBOSITY);
        let commands = vec![
            command("session.page.up", "Page up", |inner, tui| inner.move_by(tui, -inner.height() / 2.0)),
            command("session.page.down", "Page down", |inner, tui| inner.move_by(tui, inner.height() / 2.0)),
            command("session.line.up", "Line up", |inner, tui| inner.move_by(tui, -1.0)),
            command("session.line.down", "Line down", |inner, tui| inner.move_by(tui, 1.0)),
            command("session.half.page.up", "Half page up", |inner, tui| inner.move_by(tui, -inner.height() / 4.0)),
            command("session.half.page.down", "Half page down", |inner, tui| inner.move_by(tui, inner.height() / 4.0)),
            command("session.first", "First message", Inner::first),
            command("session.last", "Last message", Inner::to_bottom),
            command("session.toggle.scrollbar", "Toggle session scrollbar", |inner, tui| {
                let next = !inner.scrollbar.get();
                set(tui, "scrollbar", Value::Bool(next));
            }),
            command(
                "session.toggle.exploration_grouping",
                if grouping { "Show tool calls individually" } else { "Group related tool calls" },
                |_, tui| {
                    let grouping =
                        tui.settings.info().session.and_then(|session| session.grouping) != Some(Grouping::None);
                    set(tui, "grouping", Value::from(if grouping { "none" } else { "auto" }));
                },
            ),
            command(
                "session.verbosity.cycle",
                &format!("Verbosity: {}", opencode_ui::locale::titlecase(verbosity.as_str())),
                |_, tui| {
                    let current =
                        tui.settings.info().session.and_then(|session| session.verbosity).unwrap_or(DEFAULT_VERBOSITY);
                    let next = match current {
                        Verbosity::Low => "medium",
                        Verbosity::Medium => "high",
                        Verbosity::High => "low",
                    };
                    set(tui, "verbosity", Value::from(next));
                },
            )
            .palette(),
            command("session.messages_last_user", "Jump to last user message", Inner::last_user),
            command("session.message.next", "Next message", |inner, tui| inner.to_message(tui, true, false)),
            command("session.message.previous", "Previous message", |inner, tui| inner.to_message(tui, false, false)),
            command("session.message.user.next", "Next user message", |inner, tui| inner.to_message(tui, true, true)),
            command("session.message.user.previous", "Previous user message", |inner, tui| {
                inner.to_message(tui, false, true)
            }),
        ];
        let unfocused = {
            let app = tui.app.clone();
            let textarea = tui.textarea.clone();
            Condition::when(move || {
                textarea
                    .borrow()
                    .as_ref()
                    .is_none_or(|textarea| app.focused().is_none_or(|widget| widget.id() != textarea.id()))
            })
        };
        let layers = [
            KeymapLayer::global(commands).bindings([
                "session.page.up",
                "session.page.down",
                "session.line.up",
                "session.line.down",
                "session.half.page.up",
                "session.half.page.down",
            ]),
            // In composer mode (a subagent session's open composer has no prompt), so Home and End still jump.
            KeymapLayer::default()
                .mode(crate::composer::MODE)
                .enabled(unfocused)
                .bindings(["session.first", "session.last"]),
            KeymapLayer::default().bindings([
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
        ];
        for layer in layers {
            match tui.keymap.layer(layer) {
                Ok(disposer) => self.layers.borrow_mut().push(disposer),
                Err(error) => log::error!("session scroll keymap layer: {error}"),
            }
        }
    }

    pub(super) fn height(&self) -> f64 {
        f64::from(self.transcript.scroll().rect().height)
    }

    /// The height of what the slack follows. The content fills the viewport at least, so its own height can count
    /// rows that are not there.
    pub(super) fn rows_height(&self) -> f64 {
        let top = self.transcript.scroll().content_view().rect().screen_y;
        self.slack.rect().screen_y - top
    }

    /// `moveTranscript`: scrolls by `delta` rows. Near the top, older rows mount first and the move
    /// follows once they are laid out.
    fn move_by(&self, tui: &Tui, delta: f64) {
        self.clear_navigation();
        let scroll = self.transcript.scroll().clone();
        if delta < 0.0 && self.transcript.reveal_older(tui) || delta > 0.0 && self.transcript.reveal_newer(tui) {
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
        self.transcript.load_all(
            tui,
            bind!(weak, |inner, tui, result| {
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
                after_layout(
                    &tui.app,
                    bind!(inner.this, |inner| {
                        if !inner.first_jump.get() {
                            return;
                        }
                        inner.transcript.scroll().scroll_to(0.0, 0.0);
                        inner.end_first_jump();
                    }),
                );
            }),
        );
    }

    fn end_first_jump(&self) {
        self.first_jump.set(false);
        self.transcript.hint().visible(false);
        self.update_away();
    }

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
        after_layout(
            &tui.app,
            bind!(self.this, |inner| {
                let Some(tui) = inner.tui.upgrade() else { return };
                let Some(y) = inner.transcript.row_y(&anchor.row) else {
                    inner.to_bottom(&tui);
                    return;
                };
                let target = y - anchor.screen_y;
                let content = f64::from(inner.transcript.scroll().content_view().rect().height);
                let viewport = inner.height();
                if target > (content - viewport).max(0.0) {
                    if !inner.transcript.mount_newer(&tui) {
                        inner.set_slack(super::navigation::slack(target, viewport, inner.rows_height()));
                    }
                    inner.restore_step(&tui, anchor);
                    return;
                }
                inner.transcript.scroll().scroll_to(0.0, target);
                inner.update_away();
            }),
        );
    }

    /// `saveScrollAnchor`: the tab keeps the reader's row while they are away from the bottom.
    fn save_anchor(&self, tui: &Tui, away: bool) {
        if !self.restored.get() {
            return;
        }
        let Some(session) = self.transcript.session() else { return };
        let anchor = away.then(|| self.transcript.anchor()).flatten();
        tui.tabs.set_scroll_anchor(tui, &session.0, anchor);
    }

    pub(super) fn clear_navigation(&self) {
        if self.first_jump.replace(false) {
            self.transcript.hint().visible(false);
        }
        self.navigation.replace(None);
        self.set_slack(0.0);
    }

    pub(super) fn set_slack(&self, height: f64) {
        self.slack_height.set(height);
        self.slack.height(height.max(0.0) as u16);
        let navigating = self.navigation.borrow().is_some() || height > 0.0;
        self.transcript.navigating(navigating);
        self.transcript.scroll().sticky(!navigating);
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

fn set(tui: &Tui, key: &'static str, value: Value) {
    settings::update(tui, move |root| settings::set_path(root, &["session", key], value));
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

struct Speed(f64);

impl ScrollAcceleration for Speed {
    fn tick(&mut self, _now: Instant) -> f64 {
        self.0
    }

    fn reset(&mut self) {}
}
