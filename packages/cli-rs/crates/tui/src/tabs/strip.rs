//! The horizontal tab strip (W01, `HorizontalSessionTabs` in `component/session-tabs.tsx:1275-1790`). One
//! [`Custom`] widget paints every cell from the TS formulas; it reads the tabs and the store when it paints.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Weak;

use opencode_api::generated::SessionID;
use opencode_ui::theme::{Theme, tint};
use opentui::input::{MouseButton, MouseEvent, MouseEventKind};
use opentui::prelude::*;
use unicode_width::UnicodeWidthStr;

use super::model::{self, NEW_SESSION_TAB_TITLE, Tab};
use super::pulse::{self, Pulse};
use super::{Attention, Status, Unread};
use crate::app::Tui;

/// The add button, " + ", at the end of the strip.
const ADD_TAB_WIDTH: usize = 3;
/// A long title fades out over its last cells.
pub(super) const FADE_WIDTH: usize = 4;
pub(super) const NEW_TAB: &str = "new";
pub(super) const UNREAD_MARKER: &str = "•";

pub struct Strip {
    tui: Weak<Tui>,
    start: Cell<usize>,
    hovered: Option<String>,
    close_hovered: bool,
    plus_hovered: bool,
    pressed: Option<String>,
    plus_pressed: bool,
    dragged: bool,
    preview: Option<(String, usize)>,
    /// The last painted slots, for hit tests: `(x, width, session)`.
    slots: RefCell<Vec<(usize, usize, String)>>,
    plus: Cell<Option<usize>>,
    pulses: RefCell<HashMap<String, Pulse>>,
}

pub fn new(app: &App, tui: Weak<Tui>) -> Custom<Strip> {
    Custom::new(
        app,
        Strip {
            tui,
            start: Cell::new(0),
            hovered: None,
            close_hovered: false,
            plus_hovered: false,
            pressed: None,
            plus_pressed: false,
            dragged: false,
            preview: None,
            slots: RefCell::default(),
            plus: Cell::new(None),
            pulses: RefCell::default(),
        },
    )
    .height(1)
    .shrink(0.0)
    .z_index(1)
}

/// Clears the hover state when the pointer leaves the strip.
pub fn leave(strip: &Custom<Strip>) {
    strip.update(|strip| {
        strip.hovered = None;
        strip.close_hovered = false;
        strip.plus_hovered = false;
    });
}

/// Whether a pulse under the strip still moves.
pub fn animating(strip: &Custom<Strip>) -> bool {
    strip.with(|strip| strip.pulses.borrow().values().any(Pulse::live))
}

pub fn tick(strip: &Custom<Strip>, delta: std::time::Duration) {
    strip.update(|strip| {
        strip
            .pulses
            .borrow_mut()
            .values_mut()
            .for_each(|pulse| pulse.advance(delta))
    });
}

/// The colors shared by every tab.
pub(super) struct Palette {
    pub unread: Color,
    pub active_number: Color,
    pub idle_number: Color,
}

pub(super) fn feedback(status: &Status, theme: &Theme) -> Option<Color> {
    if status.attention.is_some() {
        return Some(theme.accent().step(200));
    }
    (status.unread == Some(Unread::Error)).then_some(theme.text.feedback.error.base)
}

/// The indicator's glyph (`TabIndicator`'s label) and whether it shows the unread color.
pub(super) fn indicator(
    status: &Status,
    label: &str,
    idle: &str,
    numbers: bool,
    animations: bool,
    now: std::time::Instant,
    epoch: std::time::Instant,
) -> (String, bool) {
    let pending = status.busy || status.attention.is_some();
    let unread = status.unread.is_some() && !pending;
    let text = if numbers {
        label.to_owned()
    } else if status.attention == Some(Attention::Permission) {
        "!".to_owned()
    } else if status.attention == Some(Attention::Question) {
        "?".to_owned()
    } else if status.runs() {
        let frames = opencode_ui::motion::SPINNER_FRAMES;
        let frame = if animations {
            (now.duration_since(epoch).as_millis() / 80) as usize % frames.len()
        } else {
            0
        };
        frames[frame].to_owned()
    } else if label == "+" {
        "+".to_owned()
    } else if status.unread.is_some() {
        UNREAD_MARKER.to_owned()
    } else {
        idle.to_owned()
    };
    (text, unread)
}

/// `fadeTitleColor`.
pub(super) fn fade(
    color: Color,
    background: Color,
    index: usize,
    length: usize,
    leading: f64,
) -> Color {
    let step = |position: f64| {
        if position <= 0.0 {
            0.0
        } else {
            0.2 + 0.72 * ((position - 1.0) / (FADE_WIDTH as f64 - 1.0).max(1.0))
        }
    };
    let start = if index < FADE_WIDTH {
        (FADE_WIDTH - index) as f64
    } else {
        0.0
    };
    let end = index as f64 - (length as f64 - FADE_WIDTH as f64) + 1.0;
    let opacity = (step(start) * leading).max(step(end));
    if opacity == 0.0 {
        color
    } else {
        tint(color, background, opacity)
    }
}

/// `Locale.takeWidth` over characters.
pub(super) fn take_width(text: &str, width: usize) -> Vec<char> {
    let mut used = 0;
    text.chars()
        .take_while(|character| {
            let next = character.to_string().width();
            if used + next > width {
                return false;
            }
            used += next;
            true
        })
        .collect()
}

/// Draws a pulse row from `x`: half blocks for an edge, else a blank on the default foreground, as the TS
/// renderable sets its cells.
pub(super) fn paint_pulse(
    painter: &mut Painter<'_>,
    x: i32,
    y: i32,
    cells: Option<Vec<(Option<char>, Color, Color)>>,
) {
    for (column, (glyph, fg, bg)) in cells.into_iter().flatten().enumerate() {
        let (glyph, fg) = glyph.map_or((' ', Color::DEFAULT_FOREGROUND), |glyph| (glyph, fg));
        painter.cell(x + column as i32, y, glyph, Style::new().fg(fg).bg(bg));
    }
}

/// Draws `characters` from `x` with one color per character.
pub(super) fn draw_chars(
    painter: &mut Painter<'_>,
    x: i32,
    y: i32,
    characters: &[char],
    style: impl Fn(usize) -> Style,
) {
    let mut column = x;
    for (index, character) in characters.iter().enumerate() {
        painter.text(column, y, &character.to_string(), style(index));
        column += character.to_string().width() as i32;
    }
}

impl Strip {
    fn items(&self, tui: &Tui) -> (Vec<Tab>, bool) {
        let tabs = tui.tabs.tabs(tui);
        let ordered = match &self.preview {
            Some((session, index)) => model::reorder(&tabs, session, *index).unwrap_or(tabs),
            None => tabs,
        };
        let new_tab = tui.tabs.new_tab();
        let mut items = ordered;
        if new_tab {
            items.push(Tab::new(NEW_TAB, Some(NEW_SESSION_TAB_TITLE.to_owned())));
        }
        (items, new_tab)
    }

    fn slot_at(&self, x: i32) -> Option<String> {
        self.slots
            .borrow()
            .iter()
            .find(|(start, width, _)| x >= *start as i32 && x < (start + width) as i32)
            .map(|(_, _, session)| session.clone())
    }
}

impl Component for Strip {
    fn paint(&self, painter: &mut Painter<'_>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let theme = tui.page();
        let animations = opencode_ui::motion::enabled(tui.config().info.animations);
        let numbers = matches!(
            tui.config().tabs.indicators,
            opencode_local::cli_config::TabsIndicators::Numbers
        );
        let (items, new_tab) = self.items(&tui);
        let active = if new_tab {
            Some(NEW_TAB.to_owned())
        } else {
            tui.tabs.current(&tui)
        };
        let show_plus = !new_tab;
        let width = painter.width() as i64;
        let ids: Vec<&str> = items.iter().map(|tab| tab.session_id.as_str()).collect();
        let layout = model::layout(
            &ids,
            active.as_deref(),
            width - if show_plus { ADD_TAB_WIDTH as i64 } else { 0 },
            self.start.get(),
        );
        self.start.set(layout.start);
        let palette = Palette {
            unread: theme.accent().step(200),
            active_number: theme.interactive().step(200),
            idle_number: tint(theme.text.formfield.base, theme.background.base, 0.55),
        };
        let statuses: Vec<Status> = items[layout.visible()]
            .iter()
            .map(|tab| {
                if tab.session_id == NEW_TAB {
                    Status::default()
                } else {
                    tui.tabs.status(&tui, &tab.session_id)
                }
            })
            .collect();
        let titles: Vec<String> = tui.data.read(|state| {
            items[layout.visible()]
                .iter()
                .map(|tab| {
                    state
                        .session(&SessionID(tab.session_id.clone()))
                        .and_then(|session| session.title.clone())
                        .or_else(|| tab.title.clone())
                        .unwrap_or_else(|| "Untitled session".to_owned())
                })
                .collect()
        });

        let mut x = 0usize;
        if layout.before > 0 {
            painter.text(
                0,
                0,
                &format!("‹{}", layout.before),
                Style::new().fg(theme.text.muted),
            );
            x += model::overflow_width(layout.before);
        }
        let number_width = items.len().to_string().len().max(2);
        let mut slots = Vec::new();
        let mut pulses = self.pulses.borrow_mut();
        let now = tui.app.now();
        for (offset, tab) in items[layout.visible()].iter().enumerate() {
            let index = layout.start + offset;
            let tab_width = layout.widths[offset].max(1);
            let status = statuses[offset];
            let session = tab.session_id.as_str();
            let selected = active.as_deref() == Some(session);
            let hovered = self.hovered.as_deref() == Some(session);
            let dragged = self.dragged && self.pressed.as_deref() == Some(session);
            let selection = f64::from(u8::from(selected));
            let activity = f64::from(u8::from(status.complete()));
            let lifted = (hovered || dragged) && !selected;
            let base = if lifted {
                theme.background.action.primary.hovered
            } else {
                theme.background.base
            };
            let background = tint(
                base,
                theme.decrease(&theme.background.raised.base, 1),
                if dragged { 1.0 } else { selection },
            );
            let feedback = feedback(&status, &theme);
            let glow_level = if selected && status.attention.is_some() {
                0.7
            } else {
                1.0
            };
            let glow_color = tint(background, feedback.unwrap_or(palette.unread), glow_level);
            let glows = status.attention.is_some()
                || (!selected && !status.busy && status.unread.is_some());
            let left = x as i32;
            painter.fill(left, 0, tab_width as u32, 1, background);

            let input = pulse::Input {
                active: status.runs(),
                prompt_pulse: status.prompt_pulse,
                complete: status.complete() && status.attention.is_none(),
                glow: glows,
            };
            let pulse = pulses
                .entry(session.to_owned())
                .and_modify(|pulse| pulse.set(input))
                .or_insert_with(|| Pulse::new(animations, input));
            let colors = pulse::Colors {
                background,
                color: tint(background, theme.text.base, 0.45),
                glow: glow_color,
                flash: tint(background, theme.text.base, 0.65),
                completion: palette.unread,
                glow_tail: pulse::GLOW_TAIL,
                flash_tail: None,
            };
            let sweep = pulse.level(tab_width);
            paint_pulse(
                painter,
                left,
                0,
                pulse::paint(pulse, &colors, None, tab_width),
            );

            let foreground = if hovered {
                theme.text.base
            } else {
                tint(theme.text.muted, theme.text.base, selection)
            };
            let runs = status.runs();
            let number = {
                let base = if hovered && !selected {
                    foreground
                } else {
                    tint(
                        palette.idle_number,
                        tint(theme.text.base, background, 0.25),
                        selection,
                    )
                };
                let color = if runs {
                    palette.active_number
                } else {
                    feedback.unwrap_or_else(|| tint(base, palette.unread, activity))
                };
                tint(color, theme.text.base, 0.15 * sweep)
            };
            let bold = selected || dragged;
            let label = if session == NEW_TAB {
                "+".to_owned()
            } else {
                (index + 1).to_string()
            };
            let (glyph, unread) = indicator(
                &status,
                &label,
                "",
                numbers,
                animations,
                now,
                tui.tabs.epoch(),
            );
            let indicator_color = if numbers || selected {
                number
            } else if unread {
                feedback.unwrap_or(palette.unread)
            } else {
                number
            };
            let glyph_width = glyph.width();
            let mut style = Style::new().fg(indicator_color);
            if bold {
                style = style.bold();
            }
            painter.text(
                left + number_width as i32 - glyph_width as i32,
                0,
                &glyph,
                style,
            );

            let resting = tab_width.saturating_sub(1 + number_width).max(1);
            let available = if hovered {
                resting.saturating_sub(2).max(1)
            } else {
                resting
            };
            let title = &titles[offset];
            let visible = take_width(title, available);
            let fades = title.width() > available && available > FADE_WIDTH;
            let length = visible.len();
            draw_chars(
                painter,
                left + number_width as i32 + 1,
                0,
                &visible,
                |character| {
                    let color = if glows {
                        tint(
                            foreground,
                            glow_color,
                            0.12 * pulse::unread_glow_intensity(
                                1 + number_width + character,
                                tab_width,
                            ),
                        )
                    } else {
                        foreground
                    };
                    let color = if fades {
                        fade(color, background, character, length, 0.0)
                    } else {
                        color
                    };
                    let style = Style::new().fg(color);
                    if bold { style.bold() } else { style }
                },
            );
            if hovered && tab_width >= 2 {
                let color = if self.close_hovered {
                    theme.text.base
                } else {
                    tint(theme.text.muted, theme.text.base, 0.6)
                };
                painter.text(left + tab_width as i32 - 2, 0, "✕", Style::new().fg(color));
            }
            slots.push((x, tab_width, session.to_owned()));
            x += tab_width;
        }
        drop(pulses);
        if layout.after > 0 {
            painter.text(
                x as i32,
                0,
                &format!(" {}›", layout.after),
                Style::new().fg(theme.text.muted),
            );
            x += model::overflow_width(layout.after);
        }
        self.plus.set(None);
        if show_plus {
            let style = if self.plus_hovered {
                Style::new()
                    .fg(theme.text.base)
                    .bg(theme.background.action.primary.hovered)
            } else {
                // A transparent background blends an alpha muted token as the TS `<text>` does.
                Style::new().fg(theme.text.muted).bg(Color::TRANSPARENT)
            };
            painter.text(x as i32, 0, " + ", style);
            self.plus.set(Some(x));
        }
        *self.slots.borrow_mut() = slots;
    }

    fn mouse(&mut self, cx: &mut Cx<'_>, event: &MouseEvent, local: (i32, i32)) -> bool {
        let x = local.0;
        let on_plus = self
            .plus
            .get()
            .is_some_and(|plus| x >= plus as i32 && x < (plus + ADD_TAB_WIDTH) as i32);
        let slot = self.slot_at(x);
        let close = |session: &str, slots: &[(usize, usize, String)]| {
            slots
                .iter()
                .find(|(_, _, id)| id == session)
                .is_some_and(|(start, width, _)| x == (start + width) as i32 - 2)
        };
        let weak = self.tui.clone();
        let defer = |cx: &mut Cx<'_>, run: Box<dyn FnOnce(&Tui)>| {
            let weak = weak.clone();
            cx.defer(move |_| {
                if let Some(tui) = weak.upgrade() {
                    run(&tui);
                }
            });
        };
        match event.kind {
            MouseEventKind::Moved => {
                self.hovered = slot.clone();
                self.close_hovered = slot
                    .as_deref()
                    .is_some_and(|session| close(session, &self.slots.borrow()));
                self.plus_hovered = on_plus;
                true
            }
            MouseEventKind::Down(MouseButton::Middle) => {
                let Some(session) = slot else { return false };
                self.pressed = None;
                defer(
                    cx,
                    Box::new(move |tui| {
                        super::close(tui, (session != NEW_TAB).then_some(session.as_str()))
                    }),
                );
                true
            }
            MouseEventKind::Down(MouseButton::Left) => {
                self.dragged = false;
                self.plus_pressed = on_plus;
                self.pressed = slot.clone();
                if slot.is_some() {
                    self.hovered = slot;
                }
                true
            }
            MouseEventKind::Drag(MouseButton::Left) => {
                let Some(source) = self.pressed.clone().filter(|source| source != NEW_TAB) else {
                    return false;
                };
                self.dragged = true;
                let Some(tui) = self.tui.upgrade() else {
                    return false;
                };
                let tabs = tui.tabs.tabs(&tui);
                let target = self
                    .slots
                    .borrow()
                    .iter()
                    .position(|(start, width, _)| x < (start + width) as i32)
                    .unwrap_or(self.slots.borrow().len().saturating_sub(1))
                    + self.start.get();
                let target = target.min(tabs.len().saturating_sub(1));
                let from = tabs.iter().position(|tab| tab.session_id == source);
                if from != Some(target) {
                    self.preview = Some((source, target));
                }
                true
            }
            MouseEventKind::Up(MouseButton::Left) => {
                let plus = std::mem::take(&mut self.plus_pressed) && on_plus;
                let source = self.pressed.take();
                let dragged = std::mem::take(&mut self.dragged);
                let preview = self.preview.take();
                if plus {
                    defer(cx, Box::new(super::add));
                    return true;
                }
                let Some(source) = source else { return false };
                let closing = !dragged
                    && self.hovered.as_deref() == Some(source.as_str())
                    && close(&source, &self.slots.borrow());
                defer(
                    cx,
                    Box::new(move |tui| {
                        if closing {
                            super::close(tui, (source != NEW_TAB).then_some(source.as_str()));
                            return;
                        }
                        if let Some((session, index)) =
                            preview.filter(|(session, _)| *session == source)
                        {
                            super::reorder(tui, &session, index);
                        }
                        if source != NEW_TAB {
                            super::select(tui, &source);
                        }
                    }),
                );
                true
            }
            _ => false,
        }
    }
}
