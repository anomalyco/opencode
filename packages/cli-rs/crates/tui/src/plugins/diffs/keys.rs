//! The `diff.*` bindings (E.15a): the viewer's commands (`diff-viewer.tsx:588-781`) and the global `diff.open`
//! (`:1311-1361`). Of the 26 `diff.*` keybinds in `config/keybind.ts`, 20 are viewer commands, `diff.open` opens it,
//! and the five deprecated tree keys (`diff.toggle`, `.expand`, `.expand_all`, `.collapse`, `.switch_focus`) are
//! kept for config only and register nothing, as in TS.

use std::rc::{Rc, Weak};

use opencode_ui::dialog::FocusId;
use opencode_ui::keymap::{GLOBAL_MODE, KeymapLayer, Slash, TuiCommand};
use opentui::keymap::Condition;

use super::viewer::Viewer;
use crate::app::Tui;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Close,
    Down,
    Up,
    PageDown,
    PageUp,
    HalfPageDown,
    HalfPageUp,
    First,
    Last,
    NextHunk,
    PreviousHunk,
    NextFile,
    PreviousFile,
    MarkReviewed,
    ToggleFileTree,
    SinglePatch,
    SwitchSource,
    ToggleView,
    ToggleFullscreen,
    Help,
}

/// The viewer's commands in TS order. `app.exit` closes the viewer while it has the input; the specific bindings
/// win over its `ctrl+d`.
pub const COMMANDS: [(&str, &str, Action); 21] = [
    ("diff.close", "Close diff viewer", Action::Close),
    ("diff.down", "Move diff viewer down", Action::Down),
    ("diff.up", "Move diff viewer up", Action::Up),
    ("diff.page.down", "Page diff viewer down", Action::PageDown),
    ("diff.page.up", "Page diff viewer up", Action::PageUp),
    (
        "diff.half_page.down",
        "Scroll down half a page",
        Action::HalfPageDown,
    ),
    (
        "diff.half_page.up",
        "Scroll up half a page",
        Action::HalfPageUp,
    ),
    ("diff.first", "Go to the start of the diff", Action::First),
    ("diff.last", "Go to the end of the diff", Action::Last),
    ("diff.next_hunk", "Jump to next diff hunk", Action::NextHunk),
    (
        "diff.previous_hunk",
        "Jump to previous diff hunk",
        Action::PreviousHunk,
    ),
    ("diff.next_file", "Jump to next diff file", Action::NextFile),
    (
        "diff.previous_file",
        "Jump to previous diff file",
        Action::PreviousFile,
    ),
    (
        "diff.mark_reviewed",
        "Toggle selected diff file reviewed",
        Action::MarkReviewed,
    ),
    (
        "diff.toggle_file_tree",
        "Toggle diff viewer file tree",
        Action::ToggleFileTree,
    ),
    (
        "diff.single_patch",
        "Toggle single patch view",
        Action::SinglePatch,
    ),
    (
        "diff.switch_source",
        "Switch diff viewer source",
        Action::SwitchSource,
    ),
    (
        "diff.toggle_view",
        "Toggle diff viewer split or unified view",
        Action::ToggleView,
    ),
    (
        "diff.toggle_fullscreen",
        "Toggle diff viewer full screen",
        Action::ToggleFullscreen,
    ),
    ("diff.help", "Show more diff viewer shortcuts", Action::Help),
    ("app.exit", "Close diff viewer", Action::Close),
];

/// The viewer's layer: in the base mode, so a dialog takes the keys, and only while `target` (the panel host) has
/// the focus, or while `enabled` holds for the full-screen route.
pub fn layer(
    viewer: &Rc<Viewer>,
    target: Option<FocusId>,
    enabled: Condition,
) -> KeymapLayer<FocusId> {
    let commands = COMMANDS
        .iter()
        .map(|&(id, title, action)| {
            let weak = Rc::downgrade(viewer);
            let command = TuiCommand::new(id, move |_, _| {
                if let Some(viewer) = weak.upgrade() {
                    viewer.run(action);
                }
            })
            .title(title)
            .group("VCS");
            let when = |test: fn(&Viewer) -> bool| {
                let weak: Weak<Viewer> = Rc::downgrade(viewer);
                Condition::when(move || weak.upgrade().is_some_and(|viewer| test(&viewer)))
            };
            match action {
                Action::ToggleFileTree => command.enabled(when(|viewer| !viewer.compact())),
                Action::ToggleFullscreen => command.enabled(when(Viewer::in_panel)),
                _ => command,
            }
        })
        .collect();
    KeymapLayer {
        target,
        enabled,
        priority: 1,
        commands,
        ..KeymapLayer::default()
    }
}

/// `diff.open` (`/diff`, in the palette): toggles the session's panel, or opens the full-screen route elsewhere.
pub fn open_layer(tui: &Rc<Tui>, open: Rc<dyn Fn(&Tui)>) -> KeymapLayer<FocusId> {
    let weak = tui.weak();
    KeymapLayer {
        mode: Some(GLOBAL_MODE.to_owned()),
        commands: vec![
            TuiCommand::new("diff.open", move |_, _| {
                if let Some(tui) = weak.upgrade() {
                    open(&tui);
                }
            })
            .title("Open diff viewer")
            .group("VCS")
            .palette()
            .slash(Slash {
                name: "diff".to_owned(),
                aliases: Vec::new(),
                arguments: false,
            }),
        ],
        ..KeymapLayer::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_diff_keybind_is_a_command_or_deprecated() {
        let deprecated = [
            "diff.toggle",
            "diff.expand",
            "diff.expand_all",
            "diff.collapse",
            "diff.switch_focus",
        ];
        let keybinds: Vec<&str> = opencode_ui::keymap::DEFINITIONS
            .iter()
            .map(|definition| definition.name)
            .filter(|name| name.starts_with("diff."))
            .collect();
        assert_eq!(keybinds.len(), 26);
        for name in keybinds {
            assert!(
                name == "diff.open"
                    || deprecated.contains(&name)
                    || COMMANDS.iter().any(|(id, ..)| *id == name),
                "{name}"
            );
        }
    }
}
