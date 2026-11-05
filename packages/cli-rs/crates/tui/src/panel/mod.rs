//! Plugin side panels (W07): the state of `context/panel.tsx` and the host of `component/panel-host.tsx`.
//!
//! A plugin opens a panel for a session with [`Panels::open`]; the session frame shows it beside the session,
//! or over the whole screen when the room is too small to split or the plugin asks for it. The host is a
//! raised, focusable box that the plugin fills through the builder it registered with [`Panels::register`]
//! (P.1 connects the `session.panel` slot to it; E.15a's diff viewer is the first user).

use std::any::Any;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use opentui::prelude::*;

use crate::app::Tui;
use crate::frame::layout::SESSION_PANEL_SPLIT_MIN_WIDTH;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Presentation {
    #[default]
    Panel,
    Fullscreen,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Target {
    pub plugin: String,
    pub name: String,
    pub session: String,
}

/// What a panel builder gets: the panel, and how it shows now.
pub struct Input<'a> {
    pub target: &'a Target,
    pub width: u16,
    pub presentation: Presentation,
    pub focused: bool,
}

/// Builds a panel's content into the host's root, and returns what the host keeps alive while it shows the panel.
pub type Builder = Rc<dyn Fn(&Tui, &View, &Input<'_>) -> Box<dyn Any>>;

#[derive(Default)]
pub struct Panels {
    current: RefCell<Option<Target>>,
    requested: Cell<Presentation>,
    width: Cell<i64>,
    builders: RefCell<HashMap<(String, String), Builder>>,
}

impl Panels {
    pub fn current(&self) -> Option<Target> {
        self.current.borrow().clone()
    }

    pub fn width(&self) -> i64 {
        self.width.get()
    }

    pub fn set_width(&self, width: i64) {
        self.width.set(width);
    }

    pub fn can_split(&self) -> bool {
        self.width.get() >= SESSION_PANEL_SPLIT_MIN_WIDTH
    }

    pub fn presentation(&self) -> Presentation {
        if self.can_split() { self.requested.get() } else { Presentation::Fullscreen }
    }

    /// Registers the builder of `plugin`'s panel `name`.
    pub fn register(&self, plugin: &str, name: &str, builder: Builder) {
        self.builders.borrow_mut().insert((plugin.to_owned(), name.to_owned()), builder);
    }

    pub fn open(&self, tui: &Tui, target: Target, presentation: Presentation) {
        self.requested.set(presentation);
        if self.current.borrow().as_ref() != Some(&target) {
            *self.current.borrow_mut() = Some(target);
        }
        crate::frame::refresh(tui);
    }

    pub fn close(&self, tui: &Tui) {
        if self.current.borrow_mut().take().is_some() {
            crate::frame::refresh(tui);
        }
    }

    /// Closes `plugin`'s panel, when it is open.
    pub fn release(&self, tui: &Tui, plugin: &str) {
        if self.current.borrow().as_ref().is_some_and(|target| target.plugin == plugin) {
            self.close(tui);
        }
    }

    pub fn toggle_fullscreen(&self, tui: &Tui) {
        if !self.can_split() {
            return;
        }
        self.requested.set(match self.requested.get() {
            Presentation::Panel => Presentation::Fullscreen,
            Presentation::Fullscreen => Presentation::Panel,
        });
        crate::frame::refresh(tui);
    }

    fn builder(&self, target: &Target) -> Option<Builder> {
        self.builders.borrow().get(&(target.plugin.clone(), target.name.clone())).cloned()
    }
}

/// The host of the open panel: a focusable box on the raised surface when split, the page when full screen.
pub struct Host {
    pub root: View,
    target: Target,
    _content: Option<Box<dyn Any>>,
}

impl Host {
    pub fn new(tui: &Tui, target: Target, input_width: u16, focused: bool) -> Self {
        let presentation = tui.panels.presentation();
        let theme = tui.page();
        let root =
            View::new(&tui.app).column().grow(1.0).min_width(0).min_height(0).focusable(true).bg(match presentation {
                Presentation::Panel => theme.background.raised.base,
                Presentation::Fullscreen => theme.background.base,
            });
        let content = tui
            .panels
            .builder(&target)
            .map(|builder| builder(tui, &root, &Input { target: &target, width: input_width, presentation, focused }));
        Self { root, target, _content: content }
    }

    pub fn target(&self) -> &Target {
        &self.target
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panels_split_only_with_room_for_both_panes() {
        let panels = Panels::default();
        panels.requested.set(Presentation::Panel);
        panels.set_width(107);
        assert_eq!(panels.presentation(), Presentation::Fullscreen);
        panels.set_width(108);
        assert_eq!(panels.presentation(), Presentation::Panel);
    }
}
