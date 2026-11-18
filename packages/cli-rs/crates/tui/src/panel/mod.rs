//! Plugin side panels (W07): the state of `context/panel.tsx` and the host of `component/panel-host.tsx`.
//!
//! A plugin opens a panel for a session with [`Panels::open`]; the session frame shows it beside the session,
//! or over the whole screen when the room is too small to split or the plugin asks for it. The host is a
//! raised, focusable box that the plugin's panel surface (P2) fills; E.15a's diff viewer is the first user.

use crate::frame::layout::SESSION_PANEL_SPLIT_MIN_WIDTH;
use crate::prelude::*;

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

#[derive(Default)]
pub struct Panels {
    current: RefCell<Option<Target>>,
    requested: Cell<Presentation>,
    width: Cell<i64>,
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
            tui.app.defer(bind!(tui, |tui, _| {
                if tui.app.focused().is_none() {
                    opencode_plugin::Host::focus_composer(&*tui);
                }
            }));
        }
    }

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
}

pub struct Host {
    pub root: View,
    target: Target,
    content: Option<opencode_plugin::PanelMount>,
}

impl Host {
    pub fn new(tui: &Tui, target: Target) -> Self {
        let root = View::new(&tui.app).column().grow(1.0).min_width(0).min_height(0).focusable(true);
        paint(tui, &root);
        let content = tui.plugins.panel(tui, &target.plugin, &target.name, &root);
        Self { root, target, content }
    }

    /// Takes the page theme in place: the plugin's panel surface keeps its mount and state. False without one.
    pub fn restyle(&self, tui: &Tui) -> bool {
        let Some(mount) = &self.content else { return false };
        paint(tui, &self.root);
        mount.restyle(tui)
    }

    pub fn target(&self) -> &Target {
        &self.target
    }
}

fn paint(tui: &Tui, root: &View) {
    let theme = tui.page();
    root.bg(match tui.panels.presentation() {
        Presentation::Panel => theme.background.raised.base,
        Presentation::Fullscreen => theme.background.base,
    });
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
