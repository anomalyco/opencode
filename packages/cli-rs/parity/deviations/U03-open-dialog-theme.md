# U03: an open dialog keeps its theme until it is built again

## TypeScript

Every dialog reads `useTheme().surface("dialog")` reactively (`packages/tui/src/ui/dialog.tsx:44,82`), so a theme
change while a dialog is open restyles the panel and every row in place.

## Rust

A dialog takes its colors from `DialogCx::theme` when it is built (`crates/ui/src/dialog.rs`). The dialogs that
change the theme themselves are built again in the new theme, keeping their filter, selection and scroll: the theme
list (`crates/tui/src/dialogs/theme_list.rs`) and settings (`crates/tui/src/dialogs/settings.rs`, the Theme and
Color mode rows). Any other dialog open while the theme changes from outside it (the terminal switches between
dark and light, or `cli.json` is edited) keeps the theme it opened in, panel included, until it is opened again.
The page behind it takes the new theme at once.

## Reason

Dialog contents are plain widgets colored once, without a reactive theme. Building every open dialog again would
need each of them to rebuild from its state; the two dialogs that change the theme do. Before the r2 review the
panel took the new background under rows in the old colors, which could leave text unreadable
(`reviews/r2-ui.review-carbon.md`, carbon-ui-3); now a dialog is drawn in one theme.
`ui/tests/all/dialogs.rs::a_theme_change_keeps_the_open_dialog_in_one_theme` and
`tui/tests/all/settings.rs::changing_the_color_mode_restyles_the_open_settings_dialog` cover it.
