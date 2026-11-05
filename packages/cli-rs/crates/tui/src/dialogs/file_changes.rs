//! File changes dialog (E.11b, row DLG25): `component/dialog-workspace-file-changes.tsx`.
//!
//! Lists a worktree's changed files (status letter, path, `+added -removed`) under a question. With the new
//! designs the confirm key answers yes and Escape cancels; there is no yes/no toggle.

use std::cell::Cell;
use std::rc::Rc;

use opencode_api::generated::{FileDiffInfoStatus, VcsFileStatus};
use opencode_ui::dialog::{
    DIALOG_INSET, DialogOptions, DialogSize, FooterAction, FooterProps, HeaderProps, header, layout,
};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opentui::prelude::*;
use unicode_width::UnicodeWidthStr;

use crate::app::Tui;

/// `WorkspaceFileChangesChoice`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Choice {
    No,
    Yes,
}

/// The texts `DialogWorkspaceFileChanges.show` takes.
#[derive(Clone, Default)]
pub struct Texts {
    pub title: Option<String>,
    pub message: Option<String>,
    /// The footer action for yes: its title and key; `confirm` and `enter` by default.
    pub confirm: Option<(String, String)>,
}

/// `DialogWorkspaceFileChanges.show`: `on_choice` gets the choice, or `None` when the dialog closes
/// without one.
pub fn show(tui: &Tui, files: Vec<VcsFileStatus>, texts: Texts, on_choice: Rc<dyn Fn(Option<Choice>)>) {
    let done = Rc::new(Cell::new(false));
    let resolve = {
        let done = done.clone();
        Rc::new(move |choice: Option<Choice>| {
            if !done.replace(true) {
                on_choice(choice);
            }
        })
    };
    let page = tui.page();
    let pick = resolve.clone();
    tui.dialogs.replace(
        move |cx| {
            let app = &cx.app;
            let theme = &cx.theme;
            let (title, key) = texts.confirm.clone().unwrap_or_else(|| ("confirm".into(), "enter".into()));
            let choose = |choice: Choice| {
                let (pick, dialogs) = (pick.clone(), cx.dialogs.clone());
                move || {
                    pick(Some(choice));
                    dialogs.clear();
                }
            };
            // Escape needs nothing here: the dialog closes on it, which resolves as a cancel.
            let yes = choose(Choice::Yes);
            cx.layer(KeymapLayer::new(vec![
                TuiCommand::inline(if key == "enter" { "return" } else { key.as_str() }, move |_, _| yes())
                    .title(title.clone())
                    .group("Dialog"),
            ]));
            let width = u32::from(app.size().0).saturating_sub(2).min(DialogSize::Medium.width());
            let counts = files.iter().map(|file| count_text(file).width() + 2).max().unwrap_or(0);
            let name_width = (width as i64 - DIALOG_INSET as i64 * 2 - 2 - counts.max(7) as i64).max(2);
            let list = ScrollBox::new(app).scrollbars(false).height(files.len().min(8) as u32);
            for file in &files {
                list.add(&file_row(app, &page, file, name_width));
            }
            let body = View::new(app)
                .gap(1)
                .child(
                    &Text::new(
                        app,
                        texts
                            .message
                            .clone()
                            .unwrap_or_else(|| "Do you want to move these changes with the session?".into()),
                    )
                    .fg(theme.text.muted)
                    .wrap(WrapMode::Word),
                )
                // `DialogBleed`: the list runs to the dialog's edges.
                .child(
                    &View::new(app)
                        .margin_edge(Edge::Left, -(DIALOG_INSET as i32))
                        .margin_edge(Edge::Right, -(DIALOG_INSET as i32))
                        .bg(page.background.raised.high)
                        .child(&list),
                );
            layout(
                cx,
                &header(
                    cx,
                    HeaderProps {
                        title: texts.title.clone().unwrap_or_else(|| "File Changes Found".into()),
                        ..HeaderProps::default()
                    },
                ),
                &body,
                Some(FooterProps {
                    primary: vec![
                        FooterAction::new("cancel").key("esc").on_trigger(choose(Choice::No)),
                        FooterAction::new(title).key(key).on_trigger(choose(Choice::Yes)),
                    ],
                    ..FooterProps::default()
                }),
            )
        },
        Some(Box::new(move || resolve(None))),
        DialogOptions::default(),
    );
}

/// `statusLabel`.
pub fn status_label(status: &FileDiffInfoStatus) -> &'static str {
    match status {
        FileDiffInfoStatus::Added => "A",
        FileDiffInfoStatus::Deleted => "D",
        _ => "M",
    }
}

/// `+added -removed`, each only when non-zero.
fn count_text(file: &VcsFileStatus) -> String {
    let added = if file.additions != 0 { format!("+{}", file.additions) } else { String::new() };
    let removed = if file.deletions != 0 { format!(" -{}", file.deletions) } else { String::new() };
    added + &removed
}

fn file_row(app: &App, page: &opencode_ui::theme::Theme, file: &VcsFileStatus, name_width: i64) -> View {
    let path = crate::dialogs::open::truncate_file_path(&file.file, name_width);
    // TS leaves the space in the default foreground.
    let mut counts = vec![" ".fg(Color::rgb(255, 255, 255))];
    if file.additions != 0 {
        counts.push(format!("+{}", file.additions).fg(page.diff.text.added));
    }
    if file.deletions != 0 {
        counts.push(format!(" -{}", file.deletions).fg(page.diff.text.removed));
    }
    View::new(app)
        .row()
        .justify(Justify::SpaceBetween)
        .padding_x(DIALOG_INSET)
        .child(
            &View::new(app)
                .row()
                .min_width(0)
                .shrink(1.0)
                .child(
                    &View::new(app)
                        .width(2)
                        .shrink(0.0)
                        .child(&Text::new(app, status_label(&file.status)).fg(page.text.muted)),
                )
                .child(&Text::new(app, path).fg(page.text.muted).wrap(WrapMode::None).truncate(true)),
        )
        .child(
            &View::new(app).row().gap(1).min_width(7).shrink(0.0).justify(Justify::End).child(&Text::new(app, counts)),
        )
}
