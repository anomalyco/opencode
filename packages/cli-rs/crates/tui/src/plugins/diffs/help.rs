//! Diff shortcuts dialog (E.15b, row DLG48, `DiffViewerHelpDialog` in `feature-plugins/system/diff-viewer.tsx`):
//! the viewer's keys in three groups, centered, read from the keymap when it opens.

use opencode_ui::dialog::{DialogOptions, DialogSize, HeaderProps, header, layout};
use opentui::prelude::*;

use super::viewer::Viewer;
use crate::app::Tui;

/// The width of the shortcut column.
const SHORTCUT_WIDTH: u16 = 17;

/// `diff.help` and a click on the help shortcut (`openHelpDialog`).
pub fn open(viewer: &Viewer) {
    let Some(tui) = viewer.tui() else { return };
    let groups = groups(&tui, viewer.single(), viewer.in_panel(), !viewer.compact());
    tui.dialogs.replace(
        move |cx| {
            let app = &cx.app;
            let theme = &cx.theme;
            let head = header(
                cx,
                HeaderProps {
                    title: "Diff shortcuts".to_owned(),
                    close_label: Some("esc close".to_owned()),
                    ..HeaderProps::default()
                },
            );
            let content = View::new(app).column().gap(1);
            for (title, rows) in &groups {
                let group =
                    View::new(app).column().shrink(0.0).child(&Text::new(app, *title).fg(theme.text.base).bold());
                for (shortcut, label) in rows {
                    group.add(
                        &View::new(app)
                            .row()
                            .gap(2)
                            .child(
                                &Text::new(app, shortcut.as_str())
                                    .fg(theme.text.base)
                                    .width(SHORTCUT_WIDTH)
                                    .shrink(0.0),
                            )
                            .child(&Text::new(app, *label).fg(theme.text.muted).grow(1.0).min_width(0)),
                    );
                }
                content.add(&group);
            }
            let rows: usize = groups.iter().map(|(_, rows)| rows.len() + 2).sum();
            let height = (rows as i64 - 1).min(i64::from(app.size().1) - 6).max(1);
            let scroll = ScrollBox::new(app).scrollbars(false).height(height as u32);
            scroll.add(&content);
            cx.focus(&scroll);
            layout(cx, &head, &scroll, None)
        },
        None,
        DialogOptions::new(DialogSize::Medium),
    );
    tui.dialogs.set_centered(true);
}

type Group = (&'static str, Vec<(String, &'static str)>);

/// The rows of each group, with the shortcuts as they are bound now; a command with none says `unbound`.
fn groups(tui: &Tui, single: bool, fullscreen: bool, tree: bool) -> Vec<Group> {
    let keymap = &tui.keymap;
    // The first shortcut of each command.
    let first = |ids: &[&str]| ids.iter().filter_map(|id| keymap.shortcut(id)).collect::<Vec<_>>().join(" / ");
    // Every shortcut of one command.
    let all = |id: &str| keymap.shortcuts(id).join(" / ");
    let row = |shortcut: String, label: &'static str| {
        let shortcut = if shortcut.is_empty() { "unbound".to_owned() } else { shortcut };
        (shortcut, label)
    };
    let mut view = vec![
        row(first(&["diff.toggle_view"]), "Split / unified"),
        row(first(&["diff.single_patch"]), "All files / single file"),
    ];
    if tree {
        view.push(row(first(&["diff.toggle_file_tree"]), "Show / hide file tree"));
    }
    view.push(row(first(&["diff.switch_source"]), "Switch diff source"));
    if fullscreen {
        view.push(row(first(&["diff.toggle_fullscreen"]), "Full screen / split view"));
    }
    view.push(row(all("diff.close"), "Close diff viewer"));
    vec![
        (
            "Review",
            vec![
                row(all("diff.next_file"), "Next file"),
                row(all("diff.previous_file"), "Previous file"),
                row(
                    first(&["diff.mark_reviewed"]),
                    if single { "Review + next / reopen" } else { "Review + collapse / reopen" },
                ),
                row(first(&["diff.next_hunk", "diff.previous_hunk"]), "Next / previous change"),
                row("right-click".to_owned(), "File menu (heading or tree)"),
            ],
        ),
        (
            "Scroll",
            vec![
                row(first(&["diff.down", "diff.up"]), "Down / up"),
                row(first(&["diff.half_page.down", "diff.half_page.up"]), "Half page down / up"),
                row(first(&["diff.page.down", "diff.page.up"]), "Page down / up"),
                row(first(&["diff.first", "diff.last"]), "First / last"),
            ],
        ),
        ("View", view),
    ]
}
