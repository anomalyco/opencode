//! Pane sizes (`ui/layout.ts`).

pub const SESSION_SIDEBAR_WIDTH: u16 = 42;
pub const SESSION_TABS_COMPACT_WIDTH: i64 = 5;
pub const SESSION_TABS_COMPACT_BREAKPOINT: u16 = 12;
pub const SESSION_SIDEBAR_MAX_WIDTH: i64 = 72;
const SESSION_CONTENT_MIN_WIDTH: i64 = 44;
const SESSION_CONTENT_PREFERRED_WIDTH: i64 = 64;
/// A docked panel fits when the session keeps its preferred width beside a minimum-width pane.
pub const SESSION_PANEL_SPLIT_MIN_WIDTH: i64 = SESSION_CONTENT_PREFERRED_WIDTH + SESSION_CONTENT_MIN_WIDTH;

/// `sessionTabsFitVertically`.
pub fn tabs_fit_vertically(total: i64, width: u16) -> bool {
    total >= i64::from(width) + SESSION_CONTENT_PREFERRED_WIDTH
}

/// `clampSessionTabsWidth`.
pub fn clamp_tabs_width(width: i64, total: i64) -> u16 {
    SESSION_TABS_COMPACT_WIDTH.max(width.min(SESSION_SIDEBAR_MAX_WIDTH).min(total - SESSION_CONTENT_MIN_WIDTH)) as u16
}

/// `clampSessionPaneWidth`: keeps an even split when both pane minimums do not fit.
pub fn clamp_pane_width(width: i64, total: i64) -> u16 {
    let half = (total / 2).max(1);
    24.min(half).max(width.min(half.max(total - SESSION_CONTENT_MIN_WIDTH))).max(0) as u16
}
