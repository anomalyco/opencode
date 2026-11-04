//! Release highlights dialog (E.18b): `packages/tui/src/component/dialog-highlights.tsx`, "What's new in …".
//! `features::highlights` opens it from `/highlights` and once after an update.

use std::rc::Rc;

use opencode_ui::dialog::{
    DIALOG_INSET, DialogOptions, FooterAction, FooterProps, HeaderProps, header, layout,
};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opentui::prelude::*;
use serde::Deserialize;

use crate::app::Tui;

/// One highlight of the release notes (`TuiHighlight`).
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Highlight {
    pub title: String,
    pub body: String,
}

/// `DialogHighlights`, centered, in place of any open dialog.
pub fn show(tui: &Tui, version: &str, items: &[Highlight]) {
    let title = format!("What's new in {version}");
    let items = items.to_vec();
    // The band and the text use the page theme (TS `overlay`), the frame the dialog surface.
    let overlay = tui.page();
    tui.dialogs.replace(
        move |cx| {
            cx.dialogs.set_centered(true);
            let app = &cx.app;
            let (_, height) = app.size();
            let max_height = (i32::from(height) * 6 / 10 - 2).max(6);

            let list = View::new(app)
                .gap(1)
                .padding_x(DIALOG_INSET)
                .bg(overlay.background.raised.high);
            for item in &items {
                let body = Text::new(app, "")
                    .fg(overlay.text.muted)
                    .wrap(WrapMode::Word);
                // Backticks mark code spans, which stand out from the muted description.
                body.set_text(
                    item.body
                        .split('`')
                        .enumerate()
                        .map(|(index, part)| {
                            let color = if index % 2 == 1 {
                                overlay.text.base
                            } else {
                                overlay.text.muted
                            };
                            Span::styled(part.to_owned(), Style::new().fg(color))
                        })
                        .collect::<Vec<_>>(),
                );
                list.add(
                    &View::new(app)
                        .child(
                            &Text::new(app, item.title.clone())
                                .fg(overlay.text.base)
                                .bold(),
                        )
                        .child(&body),
                );
            }
            // `maxHeight` over content that sizes the box: a Rust scroll box takes no height from its content, so
            // it gets the wrapped rows.
            let width = cx
                .dialogs
                .size()
                .width()
                .min(u32::from(cx.width()).saturating_sub(2))
                .saturating_sub(2 * DIALOG_INSET) as usize;
            let rows: usize = items
                .iter()
                .map(|item| 1 + super::error_details::wrapped_lines(&item.body, width))
                .sum::<usize>()
                + items.len().saturating_sub(1);
            let scroll = ScrollBox::new(app)
                .scrollbars(false)
                .height((rows as i32).clamp(0, max_height) as u32);
            scroll.add(&list);
            // The band owns the vertical padding so it stays visible while the highlights scroll.
            let band = View::new(app)
                .margin_edge(Edge::Left, -(DIALOG_INSET as i32))
                .margin_edge(Edge::Right, -(DIALOG_INSET as i32))
                .bg(overlay.background.raised.high)
                .padding_edge(Edge::Top, 1)
                .padding_edge(Edge::Bottom, 1)
                .child(&scroll);

            let dialogs = cx.dialogs.clone();
            let close = move || dialogs.clear();
            let by = |rows: f64| {
                let scroll = scroll.clone();
                move |_: Option<&str>, _: Option<&KeyEvent>| {
                    scroll.scroll_by(0.0, rows);
                }
            };
            let page = f64::from(max_height);
            let (top, bottom) = (scroll.clone(), scroll.clone());
            let mut commands = vec![
                TuiCommand::inline("return", {
                    let close = close.clone();
                    move |_, _| close()
                })
                .title("Close highlights")
                .group("Dialog"),
            ];
            for bind in ["up", "k"] {
                commands.push(
                    TuiCommand::inline(bind, by(-1.0))
                        .title("Scroll up")
                        .group("Dialog"),
                );
            }
            for bind in ["down", "j"] {
                commands.push(
                    TuiCommand::inline(bind, by(1.0))
                        .title("Scroll down")
                        .group("Dialog"),
                );
            }
            commands.extend([
                TuiCommand::inline("pageup", by(-page))
                    .title("Previous page")
                    .group("Dialog"),
                TuiCommand::inline("pagedown", by(page))
                    .title("Next page")
                    .group("Dialog"),
                TuiCommand::inline("home", move |_, _| {
                    top.scroll_to(0.0, 0.0);
                })
                .title("Scroll to top")
                .group("Dialog"),
                TuiCommand::inline("end", move |_, _| {
                    bottom.scroll_to(0.0, f64::MAX);
                })
                .title("Scroll to bottom")
                .group("Dialog"),
            ]);
            cx.layer(KeymapLayer {
                commands,
                ..KeymapLayer::default()
            });

            let mut ok = FooterAction::new("ok").key("enter");
            ok.on_trigger = Some(Rc::new(close));
            layout(
                cx,
                &header(
                    cx,
                    HeaderProps {
                        title: title.clone(),
                        ..HeaderProps::default()
                    },
                ),
                &band,
                Some(FooterProps {
                    primary: vec![ok],
                    ..FooterProps::default()
                }),
            )
        },
        None,
        DialogOptions::default(),
    );
}
