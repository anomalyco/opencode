//! Diff file menu (E.15b).

use super::viewer::Viewer;

/// A right-click on a file's header (`openFileMenu`), at cell `x`, `y`. E.15b shows the menu; it toggles the mark
/// with [`Viewer::toggle_reviewed`] and reads [`Viewer::is_reviewed`].
pub fn open(_viewer: &Viewer, _file: usize, _x: u16, _y: u16) {}
