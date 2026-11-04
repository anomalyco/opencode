//! Diff source dialog (E.15b).

use super::viewer::Viewer;

/// `diff.switch_source` and a click on the source header (`openSwitchDiffDialog`). E.15b shows the dialog; it
/// switches with [`Viewer::switch_source`] and reads [`Viewer::sources`], [`Viewer::mode`], and
/// [`Viewer::source_base`].
pub fn open(_viewer: &Viewer) {}
