//! The vertical tab rail (W01, W04, `VerticalSessionTabs` in `component/session-tabs.tsx:542-1273` and
//! `component/session-tabs-rail.tsx`). Two rows per tab (title, project and branch) with a gap row the edge
//! pulses draw into; below 12 columns it is compact: one centered indicator per tab and a search control.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Weak;

use opencode_api::generated::SessionID;
use opencode_store::Location;
use opencode_ui::theme::tint;
use opentui::input::{MouseButton, MouseEvent, MouseEventKind};
use opentui::prelude::*;
use unicode_width::UnicodeWidthStr;

use super::model::{self, NEW_SESSION_TAB_TITLE, Tab};
use super::pulse::{self, Pulse};
use super::strip::{FADE_WIDTH, draw_chars, fade, feedback, indicator, paint_pulse, take_width};
use super::{Status, Unread};
use crate::app::Tui;
use crate::frame::layout::SESSION_TABS_COMPACT_BREAKPOINT;

pub struct Rail {
    tui: Weak<Tui>,
    hovered: Option<String>,
    close_hovered: bool,
    add_hovered: bool,
    search_hovered: bool,
    pressed: Option<String>,
    add_pressed: bool,
    search_pressed: bool,
    dragged: bool,
    preview: Option<(String, usize)>,
    scroll: Cell<usize>,
    /// The last painted rows, for hit tests: `(y, height, session)`; the add row is `None`.
    rows: RefCell<Vec<(i32, i32, Option<String>)>>,
    pulses: RefCell<HashMap<(String, u8), Pulse>>,
}

pub fn new(app: &App, tui: Weak<Tui>) -> Custom<Rail> {
    Custom::new(
        app,
        Rail {
            tui,
            hovered: None,
            close_hovered: false,
            add_hovered: false,
            search_hovered: false,
            pressed: None,
            add_pressed: false,
            search_pressed: false,
            dragged: false,
            preview: None,
            scroll: Cell::new(0),
            rows: RefCell::default(),
            pulses: RefCell::default(),
        },
    )
    .shrink(0.0)
    .height(Length::Percent(100.0))
    .visible(false)
}

pub fn leave(rail: &Custom<Rail>) {
    rail.update(|rail| {
        rail.hovered = None;
        rail.close_hovered = false;
        rail.add_hovered = false;
        rail.search_hovered = false;
    });
}

pub fn animating(rail: &Custom<Rail>) -> bool {
    rail.with(|rail| rail.pulses.borrow().values().any(Pulse::live))
}

pub fn tick(rail: &Custom<Rail>, delta: std::time::Duration) {
    rail.update(|rail| {
        rail.pulses
            .borrow_mut()
            .values_mut()
            .for_each(|pulse| pulse.advance(delta))
    });
}

/// What one tab shows, before it is drawn.
struct Item {
    tab: Tab,
    status: Status,
    title: String,
    detail: String,
    selected: bool,
    glows: bool,
}

impl Rail {
    fn compact(&self, width: u32) -> bool {
        width < u32::from(SESSION_TABS_COMPACT_BREAKPOINT)
    }

    fn stride(&self, compact: bool) -> i32 {
        if compact { 2 } else { 3 }
    }

    /// The first tab row: below the top padding, and in compact mode below the search control and the list's
    /// own padding.
    fn top(&self, compact: bool) -> i32 {
        if compact { 3 } else { 1 }
    }

    fn items(&self, tui: &Tui) -> Vec<Item> {
        let tabs = tui.tabs.tabs(tui);
        let tabs = match &self.preview {
            Some((session, index)) => model::reorder(&tabs, session, *index).unwrap_or(tabs),
            None => tabs,
        };
        let active = if tui.tabs.new_tab() {
            None
        } else {
            tui.tabs.current(tui)
        };
        let statuses: Vec<Status> = tabs
            .iter()
            .map(|tab| tui.tabs.status(tui, &tab.session_id))
            .collect();
        tui.data.read(|state| {
            tabs.into_iter()
                .zip(statuses)
                .map(|(tab, status)| {
                    let session = state.session(&SessionID(tab.session_id.clone()));
                    let title = session
                        .and_then(|session| session.title.clone())
                        .or_else(|| tab.title.clone())
                        .unwrap_or_else(|| "Untitled session".to_owned());
                    let detail = session.map_or_else(String::new, |session| {
                        let location = Location::from(&session.location);
                        let data = state.location(Some(&location));
                        let project = state.project(&session.project_id);
                        let directory = session.location.directory.0.as_str();
                        let canonical =
                            project.map_or(directory, |project| project.canonical.as_str());
                        let name = if canonical == "/" {
                            crate::dialogs::session_list::basename(directory).to_owned()
                        } else {
                            project
                                .and_then(|project| project.name.clone())
                                .filter(|name| !name.is_empty())
                                .unwrap_or_else(|| {
                                    crate::dialogs::session_list::basename(canonical).to_owned()
                                })
                        };
                        let vcs = data.and_then(|data| data.vcs.as_ref());
                        let worktree = data
                            .and_then(|data| data.info.as_ref())
                            .is_some_and(|info| info.project.directory != info.project.canonical);
                        model::detail(
                            &name,
                            vcs.and_then(|vcs| vcs.branch.current.as_deref()),
                            vcs.and_then(|vcs| vcs.branch.default.as_deref()),
                            worktree,
                        )
                    });
                    let selected = active.as_deref() == Some(tab.session_id.as_str());
                    let glows = status.attention.is_some()
                        || (!selected && !status.busy && status.unread.is_some());
                    Item {
                        tab,
                        status,
                        title,
                        detail,
                        selected,
                        glows,
                    }
                })
                .collect()
        })
    }

    fn row_at(&self, y: i32) -> Option<Option<String>> {
        self.rows
            .borrow()
            .iter()
            .find(|(top, height, _)| y >= *top && y < top + height)
            .map(|(_, _, session)| session.clone())
    }
}

impl Component for Rail {
    fn paint(&self, painter: &mut Painter<'_>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let theme = tui.page();
        let width = painter.width();
        let height = painter.height() as i32;
        let compact = self.compact(width);
        let animations = opencode_ui::motion::enabled(tui.config.info.animations);
        let numbers = matches!(
            tui.config.tabs.indicators,
            opencode_local::cli_config::TabsIndicators::Numbers
        );
        let background = theme.background.raised.base;
        let selected_bg = theme.background.action.primary.selected;
        let hovered_bg = theme.background.raised.high;
        let unread_color = theme.accent().step(200);
        let active_number = theme.interactive().step(200);
        let idle_number = tint(theme.text.formfield.base, background, 0.55);
        let blend = |color: Color| tint(background, color, f64::from(color.a) / 255.0);
        let highlight = blend(hovered_bg);
        painter.fill(0, 0, width, height as u32, background);

        let items = self.items(&tui);
        let new_tab = tui.tabs.new_tab();
        let stride = self.stride(compact);
        let top = self.top(compact);
        // Keep the active row in view, as the TS rail scrolls to it after layout.
        let viewport = (height - top).max(1);
        let active_index = if new_tab {
            Some(items.len())
        } else {
            items.iter().position(|item| item.selected)
        };
        if let Some(index) = active_index {
            let row = index as i32 * stride;
            let rows = if compact {
                3
            } else if new_tab {
                1
            } else {
                2
            };
            let scroll = self.scroll.get() as i32;
            if row < scroll {
                self.scroll.set(row as usize);
            } else if row + rows > scroll + viewport {
                self.scroll.set((row + rows - viewport).max(0) as usize);
            }
        }
        let offset = top - self.scroll.get() as i32;
        let number_width = items.len().to_string().len().max(2);
        let prefix = number_width + 1;
        let highlighted = |session: Option<&str>| {
            session.is_some_and(|session| {
                items
                    .iter()
                    .any(|item| item.tab.session_id == session && item.selected)
                    || self.hovered.as_deref() == Some(session)
                    || (self.dragged && self.pressed.as_deref() == Some(session))
            })
        };
        let add_highlighted = new_tab || self.add_hovered;
        let mut rows = Vec::new();
        let mut pulses = self.pulses.borrow_mut();
        let now = tui.app.now();

        if compact {
            let below = items
                .get(self.scroll.get() / stride as usize)
                .map_or(add_highlighted, |item| {
                    highlighted(Some(&item.tab.session_id))
                });
            let control = if self.search_hovered {
                hovered_bg
            } else {
                background
            };
            painter.text(
                0,
                0,
                &"▄".repeat(width as usize),
                Style::new()
                    .fg(if self.search_hovered {
                        highlight
                    } else {
                        background
                    })
                    .bg(background),
            );
            painter.fill(0, 1, width, 1, control);
            painter.text(
                (width as i32 - 1) / 2,
                1,
                "⌕",
                Style::new().fg(theme.text.action.secondary.base),
            );
            let glyph = if self.search_hovered {
                "▀"
            } else if below {
                "▄"
            } else {
                " "
            };
            let bg = if self.search_hovered && below {
                highlight
            } else {
                background
            };
            painter.text(
                0,
                2,
                &glyph.repeat(width as usize),
                Style::new().fg(highlight).bg(bg),
            );
        }

        for (index, item) in items.iter().enumerate() {
            let y = offset + index as i32 * stride;
            let session = item.tab.session_id.as_str();
            let hovered = self.hovered.as_deref() == Some(session);
            let dragged = self.dragged && self.pressed.as_deref() == Some(session);
            let status = item.status;
            let tab_bg = if item.selected && !compact {
                selected_bg
            } else if (compact && item.selected) || hovered || dragged {
                hovered_bg
            } else {
                background
            };
            let pulse_bg = blend(tab_bg);
            let feedback = feedback(&status, &theme);
            let glow_hue = feedback.unwrap_or(unread_color);
            let glow_level = if item.selected && status.attention.is_some() {
                0.7
            } else {
                1.0
            };
            let foreground = if hovered || item.selected {
                theme.text.base
            } else {
                theme.text.muted
            };
            let runs = status.runs();
            let number_glow = f64::from(u8::from(
                status.attention.is_some()
                    || status.unread == Some(Unread::Error)
                    || status.complete(),
            ));
            let number = {
                let base = if hovered && !item.selected {
                    foreground
                } else {
                    tint(
                        idle_number,
                        tint(theme.text.base, pulse_bg, 0.25),
                        f64::from(u8::from(item.selected)),
                    )
                };
                let color = feedback.unwrap_or_else(|| tint(base, glow_hue, number_glow));
                if runs { active_number } else { color }
            };
            let label = (index + 1).to_string();
            let glyph_text = |idle: &str| {
                indicator(
                    &status,
                    &label,
                    idle,
                    numbers,
                    animations,
                    now,
                    tui.tabs.epoch(),
                )
            };
            let unread = glyph_text("").1;
            rows.push((y, if compact { 1 } else { 2 }, Some(session.to_owned())));
            if compact {
                if highlighted(Some(session)) {
                    let above = if highlighted(
                        index
                            .checked_sub(1)
                            .and_then(|before| items.get(before))
                            .map(|item| item.tab.session_id.as_str()),
                    ) {
                        highlight
                    } else {
                        background
                    };
                    let next = if index + 1 == items.len() {
                        add_highlighted
                    } else {
                        highlighted(
                            items
                                .get(index + 1)
                                .map(|item| item.tab.session_id.as_str()),
                        )
                    };
                    painter.text(
                        0,
                        y - 1,
                        &"▄".repeat(width as usize),
                        Style::new().fg(pulse_bg).bg(above),
                    );
                    painter.text(
                        0,
                        y + 1,
                        &"▀".repeat(width as usize),
                        Style::new()
                            .fg(pulse_bg)
                            .bg(if next { highlight } else { background }),
                    );
                }
                painter.fill(0, y, width, 1, pulse_bg);
                let idle = item
                    .title
                    .trim_start()
                    .chars()
                    .next()
                    .map_or("U".to_owned(), String::from);
                let (glyph, _) = glyph_text(&idle);
                let color = if item.selected {
                    theme.text.base
                } else if numbers {
                    number
                } else {
                    feedback.unwrap_or(if runs { active_number } else { foreground })
                };
                let mut style = Style::new().fg(color);
                if item.selected {
                    style = style.bold();
                }
                painter.text((width as i32 - glyph.width() as i32) / 2, y, &glyph, style);
                continue;
            }

            let input = |glow: bool| pulse::Input {
                active: runs,
                prompt_pulse: status.prompt_pulse,
                complete: status.complete() && status.attention.is_none(),
                glow,
            };
            let mut voice = |slot: u8, input: pulse::Input| {
                pulses
                    .entry((session.to_owned(), slot))
                    .and_modify(|pulse| pulse.set(input))
                    .or_insert_with(|| Pulse::new(animations, input))
                    .clone()
            };
            let colors = |color: Color,
                          glow: Color,
                          flash: Color,
                          completion: Color,
                          glow_tail: usize,
                          bg: Color| pulse::Colors {
                background: bg,
                color,
                glow,
                flash,
                completion,
                glow_tail,
                flash_tail: Some(8),
            };
            // The separator above: this tab's lower half, the previous tab's upper half.
            let previous = index.checked_sub(1).and_then(|before| items.get(before));
            let previous_status = previous.map_or_else(Status::default, |item| item.status);
            let previous_glows = previous.is_some_and(|item| item.glows);
            let previous_hue = super::strip::feedback(&previous_status, &theme).unwrap_or(unread_color);
            let previous_level = if previous.is_some_and(|item| item.selected)
                && previous_status.attention.is_some()
            {
                0.7
            } else {
                1.0
            };
            let lower = colors(
                tint(background, theme.text.base, 0.05),
                tint(background, glow_hue, 0.12 * glow_level),
                tint(background, theme.text.base, 0.22),
                tint(background, glow_hue, 0.12 * glow_level),
                8,
                background,
            );
            let upper = colors(
                tint(background, theme.text.base, 0.04),
                tint(background, previous_hue, 0.1 * previous_level),
                tint(background, theme.text.base, 0.18),
                tint(background, previous_hue, 0.1 * previous_level),
                5,
                background,
            );
            let inner = voice(0, input(item.glows));
            let outer = voice(
                1,
                pulse::Input {
                    active: previous_status.runs(),
                    prompt_pulse: previous_status.prompt_pulse,
                    complete: previous_status.complete() && previous_status.attention.is_none(),
                    glow: previous_glows,
                },
            );
            paint_cells(
                painter,
                y - 1,
                pulse::paint(&inner, &lower, Some((&outer, &upper, true)), width as usize),
            );
            if index + 1 == items.len() {
                let below = colors(
                    tint(background, theme.text.base, 0.04),
                    tint(background, glow_hue, 0.1 * glow_level),
                    tint(background, theme.text.base, 0.18),
                    tint(background, glow_hue, 0.1 * glow_level),
                    8,
                    background,
                );
                let quiet = colors(
                    tint(background, theme.text.base, 0.006),
                    background,
                    tint(background, theme.text.base, 0.18),
                    background,
                    5,
                    background,
                );
                let inner = voice(2, input(item.glows));
                let outer = voice(3, pulse::Input::default());
                paint_cells(
                    painter,
                    y + 2,
                    pulse::paint(
                        &inner,
                        &below,
                        Some((&outer, &quiet, false)),
                        width as usize,
                    ),
                );
            }

            // The title row.
            painter.fill(0, y, width, 2, pulse_bg);
            let glow_color = tint(pulse_bg, glow_hue, 0.45 * glow_level);
            let title_pulse = voice(4, input(item.glows));
            let title_colors = pulse::Colors {
                flash_tail: Some(8),
                ..colors(
                    tint(pulse_bg, theme.text.base, 0.25),
                    glow_color,
                    tint(pulse_bg, theme.text.base, 0.7),
                    glow_color,
                    pulse::GLOW_TAIL,
                    pulse_bg,
                )
            };
            paint_cells(
                painter,
                y,
                pulse::paint(&title_pulse, &title_colors, None, width as usize),
            );
            let sweep = title_pulse.level(width as usize);
            let number = if sweep == 0.0 {
                number
            } else {
                tint(number, theme.text.base, 0.35 * sweep)
            };
            let (glyph, _) = glyph_text("");
            let indicator_color = if numbers || item.selected {
                number
            } else if unread {
                feedback.unwrap_or(unread_color)
            } else {
                number
            };
            let mut style = Style::new().fg(indicator_color);
            if item.selected {
                style = style.bold();
            }
            painter.text(number_width as i32 - glyph.width() as i32, y, &glyph, style);
            let resting = (width as usize).saturating_sub(prefix + 1).max(1);
            let title_width = if hovered {
                resting.saturating_sub(1).max(1)
            } else {
                resting
            };
            let visible = take_width(&item.title, title_width);
            let fades = item.title.width() > title_width && title_width > FADE_WIDTH;
            let length = visible.len();
            let glow_text = f64::from(u8::from(item.glows));
            draw_chars(painter, prefix as i32, y, &visible, |character| {
                let color = if glow_text == 0.0 {
                    foreground
                } else {
                    tint(
                        foreground,
                        glow_color,
                        0.12 * pulse::unread_glow_intensity(
                            1 + number_width + character,
                            width as usize,
                        ) * glow_text,
                    )
                };
                let color = if fades {
                    fade(color, pulse_bg, character, length, 0.0)
                } else {
                    color
                };
                let style = Style::new().fg(color);
                if item.selected { style.bold() } else { style }
            });
            if hovered {
                let color = if self.close_hovered {
                    theme.text.base
                } else {
                    theme.text.muted
                };
                painter.text(width as i32 - 2, y, "✕", Style::new().fg(color));
            }

            // The detail row: project and branch.
            let detail_glow = tint(pulse_bg, glow_hue, 0.25 * glow_level);
            let detail_pulse = voice(5, input(item.glows));
            let detail_colors = colors(
                tint(pulse_bg, theme.text.base, 0.13),
                detail_glow,
                tint(pulse_bg, theme.text.base, 0.42),
                detail_glow,
                10,
                pulse_bg,
            );
            paint_cells(
                painter,
                y + 1,
                pulse::paint(&detail_pulse, &detail_colors, None, width as usize),
            );
            let detail_color = tint(theme.text.muted, pulse_bg, 0.35);
            let visible = take_width(&item.detail, title_width);
            let fades = item.detail.width() > title_width && title_width > FADE_WIDTH;
            let length = visible.len();
            draw_chars(painter, prefix as i32, y + 1, &visible, |character| {
                Style::new().fg(if fades {
                    fade(detail_color, pulse_bg, character, length, 0.0)
                } else {
                    detail_color
                })
            });
        }
        drop(pulses);

        // One slot, two states: a muted "+ New session" that becomes the active new-session tab.
        let y = offset + items.len() as i32 * stride;
        let bg = if new_tab && !compact {
            selected_bg
        } else if self.add_hovered || (compact && new_tab) {
            hovered_bg
        } else {
            background
        };
        if compact && add_highlighted {
            let above = if highlighted(items.last().map(|item| item.tab.session_id.as_str())) {
                highlight
            } else {
                background
            };
            painter.text(
                0,
                y - 1,
                &"▄".repeat(width as usize),
                Style::new().fg(highlight).bg(above),
            );
            painter.text(
                0,
                y + 1,
                &"▀".repeat(width as usize),
                Style::new().fg(highlight).bg(background),
            );
        }
        painter.fill(0, y, width, 1, blend(bg));
        let strong = new_tab || self.add_hovered;
        let style = |color: Color| {
            let style = Style::new().fg(color);
            if new_tab { style.bold() } else { style }
        };
        if compact {
            painter.text(
                (width as i32 - 1) / 2,
                y,
                "+",
                style(if strong { theme.text.base } else { idle_number }),
            );
        } else {
            painter.text(
                1,
                y,
                "+",
                style(if strong { theme.text.base } else { idle_number }),
            );
            painter.text(
                3,
                y,
                NEW_SESSION_TAB_TITLE,
                style(if strong {
                    theme.text.base
                } else {
                    theme.text.muted
                }),
            );
            if new_tab && self.add_hovered {
                painter.text(width as i32 - 2, y, "×", Style::new().fg(theme.text.muted));
            }
        }
        rows.push((y, 1, None));
        *self.rows.borrow_mut() = rows;
    }

    fn mouse(&mut self, cx: &mut Cx<'_>, event: &MouseEvent, local: (i32, i32)) -> bool {
        let Some(tui) = self.tui.upgrade() else {
            return false;
        };
        let (x, y) = local;
        let width = tui.frame.rail_width(&tui);
        let compact = self.compact(u32::from(width));
        let row = self.row_at(y);
        let on_close = x == i32::from(width) - 2;
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
                self.search_hovered = compact && y == 1;
                self.hovered = row.clone().flatten();
                self.add_hovered = row.as_ref().is_some_and(Option::is_none);
                self.close_hovered = self.hovered.is_some() && on_close;
                true
            }
            MouseEventKind::ScrollUp | MouseEventKind::ScrollDown => {
                let step = if matches!(event.kind, MouseEventKind::ScrollUp) {
                    -1
                } else {
                    1
                };
                self.scroll
                    .set((self.scroll.get() as i32 + step).max(0) as usize);
                true
            }
            MouseEventKind::Down(MouseButton::Middle) => {
                let Some(Some(session)) = row else {
                    return false;
                };
                defer(cx, Box::new(move |tui| super::close(tui, Some(&session))));
                true
            }
            MouseEventKind::Down(MouseButton::Left) => {
                self.dragged = false;
                self.search_pressed = compact && y == 1;
                self.add_pressed = row.as_ref().is_some_and(Option::is_none);
                self.pressed = row.flatten();
                if self.pressed.is_some() {
                    self.hovered = self.pressed.clone();
                }
                true
            }
            MouseEventKind::Drag(MouseButton::Left) => {
                let Some(source) = self.pressed.clone() else {
                    return false;
                };
                self.dragged = true;
                let count = tui.tabs.tabs(&tui).len();
                let stride = self.stride(compact);
                let index = (y - self.top(compact) + self.scroll.get() as i32).div_euclid(stride);
                let target = index.clamp(0, count.saturating_sub(1) as i32) as usize;
                let from = tui
                    .tabs
                    .tabs(&tui)
                    .iter()
                    .position(|tab| tab.session_id == source);
                if from != Some(target) {
                    self.preview = Some((source, target));
                }
                true
            }
            MouseEventKind::Up(MouseButton::Left) => {
                if std::mem::take(&mut self.search_pressed) && compact && y == 1 {
                    defer(cx, Box::new(crate::dialogs::session_list::show));
                    return true;
                }
                if std::mem::take(&mut self.add_pressed)
                    && row.as_ref().is_some_and(Option::is_none)
                {
                    let close = !compact && on_close && tui.tabs.new_tab();
                    defer(
                        cx,
                        Box::new(move |tui| {
                            if close {
                                super::close(tui, None);
                            } else if !tui.tabs.new_tab() {
                                super::add(tui);
                            }
                        }),
                    );
                    return true;
                }
                let Some(source) = self.pressed.take() else {
                    return false;
                };
                let dragged = std::mem::take(&mut self.dragged);
                let preview = self.preview.take();
                let closing = !dragged
                    && !compact
                    && on_close
                    && self.hovered.as_deref() == Some(source.as_str());
                defer(
                    cx,
                    Box::new(move |tui| {
                        if closing {
                            super::close(tui, Some(&source));
                            return;
                        }
                        if let Some((session, index)) =
                            preview.filter(|(session, _)| *session == source)
                        {
                            super::reorder(tui, &session, index);
                        }
                        super::select(tui, &source);
                    }),
                );
                true
            }
            _ => false,
        }
    }
}

/// Draws a pulse row across the rail.
fn paint_cells(painter: &mut Painter<'_>, y: i32, cells: Option<Vec<(Option<char>, Color, Color)>>) {
    paint_pulse(painter, 0, y, cells);
}
