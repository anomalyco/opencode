//! Diff source dialog (E.15b, row DLG47, `openSwitchDiffDialog` in `feature-plugins/system/diff-viewer.tsx`): the
//! sources the viewer offers, then "Base", which opens the base branch dialog. A host select with no filter; a pick
//! runs `diff.pick_source` with the source's word, or `base`.

use opencode_plugin::abi::{Action, Dialog, Host, Select, SelectOption};

use super::PICK_SOURCE;
use super::viewer::{Memory, Viewer};

/// The width the labels are padded to, so the descriptions line up (`padEnd(11)`).
const LABEL_WIDTH: usize = 11;
/// The value of the "Base" row.
pub const BASE: &str = "base";
/// The source dialog's key, which a pick or the viewer's end closes.
pub const KEY: &str = "source";

/// `diff.switch_source` and a click on the source header (`openSwitchDiffDialog`).
pub fn open(host: &dyn Host, viewer: &Viewer, memory: &Memory) {
    let base = viewer.source_base(memory).map_or_else(|| "Choose…".to_owned(), |base| base.name);
    let options = viewer
        .sources()
        .into_iter()
        .map(|mode| {
            SelectOption::new(format!("{:<LABEL_WIDTH$}", mode.label()), mode.key()).description(mode.description())
        })
        .chain([SelectOption::new(format!("{:<LABEL_WIDTH$}", "Base"), BASE).description(base)])
        .collect();
    let action = Action::command(PICK_SOURCE);
    host.dialog(Dialog::Select(
        Select::new("Diff source", options, action).key(KEY).current(viewer.mode.key()).filterless(),
    ));
}
