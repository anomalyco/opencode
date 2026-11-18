//! Diff commands and key bindings for route and docked views.

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

/// Viewer-specific bindings take precedence over exit while the viewer owns input.
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
