//! Pane resizing (W04, W05): `ui/pane-resize.ts` and `ui/pane-resize-handle.tsx`. A 2-cell handle over a pane
//! boundary; a press starts a resize, drags move it, and the release commits the size. A second press within
//! 300 ms of a click that did not move resets the default.

use std::cell::Cell;
use std::rc::{Rc, Weak};
use std::time::{Duration, Instant};

use opencode_ui::bind;
use opentui::input::{MouseButton, MouseEvent, MouseEventKind};
use opentui::prelude::*;

use crate::app::Tui;

const DOUBLE_CLICK: Duration = Duration::from_millis(300);

type Size = Box<dyn Fn(&Tui) -> u16>;
type Clamp = Box<dyn Fn(&Tui, i64) -> u16>;
type FromMouse = Box<dyn Fn(&Tui, u16) -> i64>;
type Commit = Box<dyn Fn(&Tui, u16)>;

/// What a resize measures: each pane gives its own rules (`createPaneResize` options).
pub struct Rules {
    pub default: Size,
    pub clamp: Clamp,
    /// The size a pointer at screen column `x` asks for.
    pub from_mouse: FromMouse,
    pub commit: Commit,
}

/// The size of one pane boundary.
pub struct PaneResize {
    rules: Rules,
    /// The size the store holds (`options.value`); `None` is the default, which can depend on the room.
    preferred: Cell<Option<u16>>,
    requested: Cell<Option<u16>>,
    resizing: Cell<bool>,
    moved: Cell<bool>,
    last_click: Cell<Option<Instant>>,
}

impl PaneResize {
    pub fn new(rules: Rules) -> Rc<Self> {
        Rc::new(Self {
            rules,
            preferred: Cell::new(None),
            requested: Cell::new(None),
            resizing: Cell::new(false),
            moved: Cell::new(false),
            last_click: Cell::new(None),
        })
    }

    /// The stored size changed; it applies unless a resize is under way.
    pub fn set_value(&self, value: Option<u16>) {
        if !self.resizing.get() {
            self.requested.set(value);
            self.preferred.set(value);
        }
    }

    /// `size`: the preferred size, clamped to the room there is now.
    pub fn size(&self, tui: &Tui) -> u16 {
        let preferred = self.preferred.get().unwrap_or_else(|| (self.rules.default)(tui));
        (self.rules.clamp)(tui, i64::from(preferred))
    }

    pub fn resizing(&self) -> bool {
        self.resizing.get()
    }

    fn commit(&self, tui: &Tui, value: i64) {
        let next = (self.rules.clamp)(tui, value);
        self.preferred.set(Some(next));
        if self.requested.get().unwrap_or_else(|| (self.rules.default)(tui)) == next {
            return;
        }
        self.requested.set(Some(next));
        (self.rules.commit)(tui, next);
    }

    fn down(&self, tui: &Tui, now: Instant) {
        if self.last_click.take().is_some_and(|click| now.duration_since(click) < DOUBLE_CLICK) {
            self.resizing.set(false);
            self.commit(tui, i64::from((self.rules.default)(tui)));
            return;
        }
        self.moved.set(false);
        self.resizing.set(true);
    }

    fn drag(&self, tui: &Tui, x: u16) {
        if !self.resizing.get() {
            return;
        }
        self.moved.set(true);
        self.last_click.set(None);
        self.preferred.set(Some((self.rules.clamp)(tui, (self.rules.from_mouse)(tui, x))));
    }

    fn finish(&self, tui: &Tui, x: u16, now: Instant) {
        if !self.resizing.replace(false) {
            return;
        }
        let moved = self.moved.get();
        let next = if moved { (self.rules.from_mouse)(tui, x) } else { i64::from(self.size(tui)) };
        self.last_click.set((!moved).then_some(now));
        self.commit(tui, next);
    }
}

/// The handle (`PaneResizeHandle`): 2 cells wide, its highlight on the left or right cell.
pub struct Handle {
    tui: Weak<Tui>,
    resize: Rc<PaneResize>,
    right: bool,
    hovered: bool,
}

pub fn handle(app: &App, tui: Weak<Tui>, resize: Rc<PaneResize>, right: bool) -> Custom<Handle> {
    let handle = Custom::new(app, Handle { tui, resize, right, hovered: false })
        .absolute()
        .position(Edge::Top, 0)
        .width(2)
        .height(Length::Percent(100.0))
        .z_index(10)
        .mouse_pointer(MousePointer::EW_RESIZE);
    let weak = handle.clone();
    handle.on_hover(move |_, hovered| weak.update(|handle| handle.hovered = hovered))
}

impl Component for Handle {
    fn paint(&self, painter: &mut Painter<'_>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        if self.hovered || self.resize.resizing() {
            let color = tui.page().background.raised.high;
            painter.fill(i32::from(self.right), 0, 1, painter.height(), color);
        }
    }

    fn mouse(&mut self, cx: &mut Cx<'_>, event: &MouseEvent, _local: (i32, i32)) -> bool {
        let Some(tui) = self.tui.upgrade() else {
            return false;
        };
        let now = cx.now();
        match event.kind {
            MouseEventKind::Down(MouseButton::Left) => self.resize.down(&tui, now),
            MouseEventKind::Drag(MouseButton::Left) => self.resize.drag(&tui, event.x),
            MouseEventKind::Up(MouseButton::Left) => self.resize.finish(&tui, event.x, now),
            _ => return false,
        }
        let weak = self.tui.clone();
        cx.defer(bind!(weak, |tui, _| super::refresh(&tui)));
        true
    }
}

#[cfg(test)]
mod tests {
    use super::super::layout;

    #[test]
    fn tab_rail_width_keeps_the_session_minimum() {
        assert_eq!(layout::clamp_tabs_width(42, 120), 42);
        assert_eq!(layout::clamp_tabs_width(100, 200), 72);
        assert_eq!(layout::clamp_tabs_width(60, 90), 46);
        assert_eq!(layout::clamp_tabs_width(1, 120), 5);
        assert!(layout::tabs_fit_vertically(106, 42));
        assert!(!layout::tabs_fit_vertically(105, 42));
    }

    #[test]
    fn session_pane_width_keeps_an_even_split_when_tight() {
        assert_eq!(layout::clamp_pane_width(10, 120), 24);
        assert_eq!(layout::clamp_pane_width(100, 120), 76);
        assert_eq!(layout::clamp_pane_width(80, 100), 56);
        assert_eq!(layout::clamp_pane_width(5, 30), 15);
    }
}
