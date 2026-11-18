//! The `diff.*` bindings (E.15a): the viewer's commands (`diff-viewer.tsx:588-781`) and the global `diff.open`
//! (`:1311-1361`). Of the 26 `diff.*` keybinds in `config/keybind.ts`, 20 are viewer commands, `diff.open` opens it,
//! and the five deprecated tree keys (`diff.toggle`, `.expand`, `.expand_all`, `.collapse`, `.switch_focus`) are
//! kept for config only and register nothing, as in TS.
//!
//! The viewer's keys are a layer of its surface (P6c): each bind is the user's keybind of the command's name
//! ([`Bind::command`]), heard by the surface's handler while the panel has the focus or the route shows.

use opencode_plugin::abi::interact::{Bind, Layer, LayerScope};

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
/// win over its `ctrl+d`. Its `ctrl+c` is the host's: no plugin layer takes the reserved chord (P2), and the host
/// closes the plugin's menu, panel or route that has the input on it, as `app.exit` closes the viewer in TS.
pub const COMMANDS: [(&str, &str, Action); 21] = [
    ("diff.close", "Close diff viewer", Action::Close),
    ("diff.down", "Move diff viewer down", Action::Down),
    ("diff.up", "Move diff viewer up", Action::Up),
    ("diff.page.down", "Page diff viewer down", Action::PageDown),
    ("diff.page.up", "Page diff viewer up", Action::PageUp),
    ("diff.half_page.down", "Scroll down half a page", Action::HalfPageDown),
    ("diff.half_page.up", "Scroll up half a page", Action::HalfPageUp),
    ("diff.first", "Go to the start of the diff", Action::First),
    ("diff.last", "Go to the end of the diff", Action::Last),
    ("diff.next_hunk", "Jump to next diff hunk", Action::NextHunk),
    ("diff.previous_hunk", "Jump to previous diff hunk", Action::PreviousHunk),
    ("diff.next_file", "Jump to next diff file", Action::NextFile),
    ("diff.previous_file", "Jump to previous diff file", Action::PreviousFile),
    ("diff.mark_reviewed", "Toggle selected diff file reviewed", Action::MarkReviewed),
    ("diff.toggle_file_tree", "Toggle diff viewer file tree", Action::ToggleFileTree),
    ("diff.single_patch", "Toggle single patch view", Action::SinglePatch),
    ("diff.switch_source", "Switch diff viewer source", Action::SwitchSource),
    ("diff.toggle_view", "Toggle diff viewer split or unified view", Action::ToggleView),
    ("diff.toggle_fullscreen", "Toggle diff viewer full screen", Action::ToggleFullscreen),
    ("diff.help", "Show more diff viewer shortcuts", Action::Help),
    ("app.exit", "Close diff viewer", Action::Close),
];

/// The viewer's layer: in the base mode, so a dialog takes the keys, above the host's layers of its scope.
pub fn layer() -> Layer {
    let keys = COMMANDS.iter().map(|&(name, title, _)| Bind::command(name, name).title(title));
    Layer::default().scope(LayerScope::Surface).priority(1).keys(keys)
}

pub fn action(bind: &str) -> Option<Action> {
    COMMANDS.iter().find(|(name, ..)| *name == bind).map(|&(.., action)| action)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_diff_keybind_is_a_command_or_deprecated() {
        let deprecated = ["diff.toggle", "diff.expand", "diff.expand_all", "diff.collapse", "diff.switch_focus"];
        let keybinds: Vec<&str> = opencode_ui::keymap::DEFINITIONS
            .iter()
            .map(|definition| definition.name)
            .filter(|name| name.starts_with("diff."))
            .collect();
        assert_eq!(keybinds.len(), 26);
        for name in keybinds {
            assert!(
                name == "diff.open" || deprecated.contains(&name) || COMMANDS.iter().any(|(id, ..)| *id == name),
                "{name}"
            );
        }
    }
}
