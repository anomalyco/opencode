//! Model usage dialog (E.16): `DialogUsageModel` in `component/usage.tsx`, every limit on one model, the one
//! setting what's left marked.

use std::rc::Rc;

use opencode_api::generated::ModelInfo;
use opencode_ui::dialog::{DialogOptions, HeaderProps, header, layout};
use opentui::prelude::*;

use crate::dialogs::model::Local;
use crate::dialogs::usage::{Level, format_dollars, format_reset, level, limit_scope};

pub fn show(local: &Rc<Local>, model: ModelInfo) {
    let weak = Rc::downgrade(local);
    local.dialogs.replace(
        move |cx| {
            let app = &cx.app;
            let theme = &cx.theme;
            let Some(local) = weak.upgrade() else {
                return View::new(app);
            };
            let title = Text::new(
                app,
                vec![
                    "Usage › ".fg(theme.text.muted),
                    model.name.clone().fg(theme.text.base),
                ],
            )
            .fg(theme.text.base);
            let head = header(
                cx,
                HeaderProps {
                    title_view: Some(title.as_any()),
                    ..HeaderProps::default()
                },
            );
            let Some(usage) = local.model_usage(&model) else {
                let body = Text::new(app, format!("No limits apply to {}.", model.name))
                    .fg(theme.text.muted);
                return layout(cx, &head, &body, None);
            };
            let short = matches!(level(&usage, &model), Level::Out | Level::Reached);
            let workspace = local.usage().flatten().and_then(|info| info.workspace.name);
            let summary = View::new(app)
                .child(
                    &Text::new(app, format!("{} remaining", format_dollars(usage.left)))
                        .fg(if short {
                            theme.text.feedback.error.base
                        } else {
                            theme.text.base
                        })
                        .bold(),
                )
                .child(
                    &Text::new(app, format!("Resets {}", format_reset(usage.resets_at)))
                        .fg(theme.text.muted),
                );
            let limits = View::new(app).child(&Text::new(app, "Limits").fg(theme.text.muted));
            for (index, item) in usage.limits.iter().enumerate() {
                let marker = if index > 0 {
                    theme.text.muted
                } else if usage.reached {
                    theme.text.feedback.error.base
                } else {
                    theme.text.feedback.warning.base
                };
                let used = format!(
                    "{} used of {}",
                    format_dollars(item.spent),
                    format_dollars(item.budget.limit)
                );
                let marker = if index == 0 { "• " } else { "- " }.fg(marker);
                let line =
                    Text::new(app, vec![marker, used.fg(theme.text.base)]).fg(theme.text.base);
                let scope = View::new(app).padding_edge(Edge::Left, 2).child(
                    &Text::new(app, limit_scope(&item.budget, workspace.as_deref()))
                        .fg(theme.text.muted)
                        .wrap(WrapMode::Word),
                );
                limits.add(&View::new(app).child(&line).child(&scope));
            }
            let body = View::new(app).gap(1).child(&summary).child(&limits);
            layout(cx, &head, &body, None)
        },
        None,
        DialogOptions::default(),
    );
}
