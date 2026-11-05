//! The permission footer (`footer.permission.tsx`, `permission.shared.ts`): the request with Allow once, Always
//! allow, and Reject; a confirmation before Always allow; a message field for Reject.

use opencode_api::generated::{PermissionReply, PermissionRequest};
use opencode_ui::permission::{Presentation, always_lines, presentation};
use opentui::prelude::*;
use serde_json::Value;
use unicode_width::UnicodeWidthStr;

use super::scroll::Scroller;
use crate::theme::{FooterTheme, mono_prefix};

/// `PermissionStage`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Permission,
    Always,
    Reject,
}

/// `PermissionOption`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Choice {
    Once,
    Always,
    Reject,
    Confirm,
    Cancel,
}

impl Choice {
    /// `permissionOptionLabel`.
    pub fn label(self) -> &'static str {
        match self {
            Self::Once => "Allow once",
            Self::Always => "Always allow",
            Self::Reject => "Reject",
            Self::Confirm => "Confirm",
            Self::Cancel => "Cancel",
        }
    }
}

/// `PermissionBodyState`.
#[derive(Clone, Debug, PartialEq)]
pub struct State {
    pub request: String,
    pub stage: Stage,
    pub selected: Choice,
    pub message: String,
    pub submitting: bool,
}

/// A reply to send (`PermissionReply`).
#[derive(Clone, Debug, PartialEq)]
pub struct Reply {
    pub decision: PermissionReply,
    pub message: Option<String>,
}

impl State {
    /// `createPermissionBodyState`.
    pub fn new(request: &str) -> Self {
        Self {
            request: request.to_owned(),
            stage: Stage::Permission,
            selected: Choice::Once,
            message: String::new(),
            submitting: false,
        }
    }

    /// `permissionOptions`, less Always allow when the request saves nothing.
    pub fn choices(&self, saves: bool) -> Vec<Choice> {
        match self.stage {
            Stage::Permission if saves => vec![Choice::Once, Choice::Always, Choice::Reject],
            Stage::Permission => vec![Choice::Once, Choice::Reject],
            Stage::Always => vec![Choice::Confirm, Choice::Cancel],
            Stage::Reject => Vec::new(),
        }
    }

    /// `permissionShift`.
    pub fn shift(&mut self, forward: bool, choices: &[Choice]) {
        if choices.is_empty() {
            return;
        }
        let index = choices
            .iter()
            .position(|choice| *choice == self.selected)
            .unwrap_or(0);
        let len = choices.len();
        self.selected = choices[(index + if forward { 1 } else { len - 1 }) % len];
    }

    /// `permissionRun`: a stage change, or the reply to send.
    pub fn run(&mut self, choice: Choice) -> Option<Reply> {
        if self.submitting {
            return None;
        }
        match (self.stage, choice) {
            (Stage::Permission, Choice::Always) => {
                self.stage = Stage::Always;
                self.selected = Choice::Confirm;
                None
            }
            (Stage::Permission, Choice::Reject) => {
                self.stage = Stage::Reject;
                self.selected = Choice::Reject;
                None
            }
            (Stage::Permission, _) => Some(reply(PermissionReply::Once, "")),
            (Stage::Always, Choice::Cancel) => {
                self.stage = Stage::Permission;
                self.selected = Choice::Always;
                None
            }
            (Stage::Always, _) => Some(reply(PermissionReply::Always, "")),
            (Stage::Reject, _) => None,
        }
    }

    /// `permissionReject`.
    pub fn reject(&self) -> Option<Reply> {
        (!self.submitting).then(|| reply(PermissionReply::Reject, &self.message))
    }

    /// `permissionCancel`.
    pub fn cancel(&mut self) {
        self.stage = Stage::Permission;
        self.selected = Choice::Reject;
    }

    /// `permissionEscape`.
    pub fn escape(&mut self) {
        if self.stage == Stage::Always {
            self.stage = Stage::Permission;
            self.selected = Choice::Always;
            return;
        }
        self.stage = Stage::Reject;
        self.selected = Choice::Reject;
    }
}

fn reply(decision: PermissionReply, message: &str) -> Reply {
    let message = message.trim();
    Reply {
        decision,
        message: (!message.is_empty()).then(|| message.to_owned()),
    }
}

/// A request and its tool call's input and metadata once it stopped streaming (`MiniPermissionRequest`).
#[derive(Clone, Debug, PartialEq)]
pub struct Request {
    pub info: PermissionRequest,
    pub input: Value,
    pub metadata: Value,
}

/// What the body shows of a request (`permissionInfo`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Info {
    pub icon: String,
    pub title: String,
    pub lines: Vec<String>,
    pub diff: Option<String>,
    pub patch: Option<String>,
}

/// `permissionInfo`: the presentation, flattened to ASCII lines in mono.
pub fn info(request: &Request, format_path: &dyn Fn(&str) -> String, mono: bool) -> Info {
    let info: Presentation = presentation(
        &request.info.action,
        &request.info.resources,
        request.info.metadata.as_ref(),
        &request.input,
        &request.metadata,
        format_path,
    );
    if !mono {
        return Info {
            icon: info.icon.to_owned(),
            title: info.title,
            lines: info.lines,
            diff: info.diff,
            patch: info.patch,
        };
    }
    Info {
        icon: mono_prefix(info.icon, true),
        title: info.title,
        lines: info
            .diff
            .or(info.patch)
            .into_iter()
            .chain(info.lines.iter().map(|line| mono_prefix(line, true)))
            .collect(),
        diff: None,
        patch: None,
    }
}

/// Everything the body draws from.
pub struct Body<'a> {
    pub request: &'a Request,
    pub state: &'a State,
    pub info: &'a Info,
    pub theme: &'a FooterTheme,
    pub mono: bool,
    pub width: u16,
    pub height: u16,
}

/// What the body hands back: the scroll box to page, and the reject field to focus.
pub struct Painted {
    pub scroll: Option<Scroller>,
    pub field: Option<Textarea>,
}

/// `RunPermissionBody`.
pub fn paint(app: &App, root: &View, body: &Body<'_>) -> Painted {
    let theme = body.theme;
    let width = body.width;
    let compact = width < 56 || body.height < 12;
    let stage = body.state.stage;
    let busy = body.state.submitting;
    let saves = body
        .request
        .info
        .save
        .as_ref()
        .is_some_and(|save| !save.is_empty());
    let choices = body.state.choices(saves);
    root.clear();
    root.bg(theme.surface);
    let title = match stage {
        Stage::Always => "Always allow",
        Stage::Reject if width < 24 => "Reject",
        Stage::Reject => "Reject permission",
        Stage::Permission if width < 24 => "Permission",
        Stage::Permission => "Permission required",
    };
    let (pad_left, pad_right, pad_y, gap) = if compact { (0, 0, 0, 0) } else { (2, 3, 1, 1) };
    let header = View::new(app)
        .column()
        .shrink(0.0)
        .padding_edge(Edge::Left, pad_left)
        .padding_edge(Edge::Right, pad_right)
        .padding_edge(Edge::Top, pad_y)
        .padding_edge(Edge::Bottom, pad_y)
        .gap(gap)
        .child(
            &Text::new(
                app,
                vec![
                    (if body.mono { "! " } else { "△ " }).fg(theme.permission),
                    title.fg(theme.text),
                ],
            )
            .height(1)
            .wrap(WrapMode::None)
            .truncate(true),
        );
    if !compact && stage == Stage::Reject {
        header.add(&Text::new(app, "Tell OpenCode what to do differently").fg(theme.muted));
    }
    root.add(&header);
    let waiting = || {
        Text::new(
            app,
            if compact {
                "Waiting…"
            } else {
                "Waiting for permission event…"
            },
        )
        .fg(theme.running)
        .height(1)
        .wrap(WrapMode::None)
        .truncate(true)
        .shrink(0.0)
    };

    if stage == Stage::Reject {
        let wide = width >= 80;
        let field = Textarea::new(app)
            .wrap(WrapMode::Word)
            .width(Length::percent(100.0))
            .min_height(1)
            .max_height(3)
            .placeholder("Tell OpenCode what to do differently")
            .placeholder_color(theme.muted)
            .colors(theme.formfield_text, theme.surface)
            .focused_colors(theme.formfield_focused_text, theme.formfield_focused_bg)
            .cursor_color(theme.formfield_focused_text);
        field.set_text(&body.state.message);
        let holder = View::new(app)
            .grow(1.0)
            .shrink(1.0)
            .basis(Length::Auto)
            .min_width(0)
            .child(&field);
        if !wide {
            holder.width(Length::percent(100.0));
        }
        let controls = View::new(app)
            .direction(if wide {
                FlexDirection::Row
            } else {
                FlexDirection::Column
            })
            .align_items(if wide { Align::Center } else { Align::Stretch })
            .justify(Justify::SpaceBetween)
            .bg(theme.line)
            .padding_edge(Edge::Left, pad_left)
            .padding_edge(Edge::Right, pad_right)
            .padding_edge(Edge::Top, pad_y)
            .padding_edge(Edge::Bottom, pad_y)
            .gap(gap)
            .shrink(0.0)
            .child(&holder);
        if busy {
            controls.add(&waiting());
        } else {
            let hint = |key: &str, label: &str| {
                Text::new(
                    app,
                    vec![
                        format!("{key} ").fg(theme.text),
                        label.to_owned().fg(theme.muted),
                    ],
                )
                .height(1)
                .wrap(WrapMode::None)
                .shrink(0.0)
            };
            controls.add(
                &View::new(app)
                    .row()
                    .flex_wrap(Wrap::Wrap)
                    .column_gap(if compact { 1 } else { 2 })
                    .shrink(0.0)
                    .child(&hint("enter", if compact { "reject" } else { "confirm" }))
                    .child(&hint("esc", if compact { "back" } else { "cancel" })),
            );
        }
        root.add(
            &View::new(app)
                .column()
                .width(Length::percent(100.0))
                .grow(1.0)
                .basis(Length::Auto)
                .min_height(0)
                .justify(Justify::End)
                .child(&controls),
        );
        return Painted {
            scroll: None,
            field: Some(field),
        };
    }

    let (frame, scroller) = Scroller::new(app, theme, !body.mono, true);
    frame.grow(1.0).basis(Length::Auto);
    let scroll = &scroller.scroll;
    scroll
        .content_view()
        .padding_edge(Edge::Left, if compact { 0 } else { 1 })
        .padding_edge(Edge::Right, if body.mono { 0 } else { 1 });
    let content = View::new(app)
        .column()
        .width(Length::percent(100.0))
        .shrink(0.0)
        .gap(gap);
    let line = |text: String, color: Color| {
        Text::new(app, text)
            .fg(color)
            .wrap(WrapMode::Word)
            .width(Length::percent(100.0))
            .shrink(0.0)
    };
    if stage == Stage::Permission {
        let info = body.info;
        content.add(
            &View::new(app)
                .width(Length::percent(100.0))
                .padding_edge(Edge::Left, if compact { 0 } else { 1 })
                .shrink(0.0)
                .child(
                    &Text::new(
                        app,
                        vec![
                            format!("{} ", info.icon).fg(theme.muted),
                            info.title.clone().fg(theme.text),
                        ],
                    )
                    .wrap(WrapMode::Word)
                    .width(Length::percent(100.0)),
                ),
        );
        // M.4 draws diffs; until then the diff and the patch show as text.
        if let Some(diff) = &info.diff {
            content.add(&line(diff.clone(), theme.text));
        } else if let Some(patch) = &info.patch {
            content.add(&line(patch.clone(), theme.muted));
        } else if info.lines.is_empty() {
            content.add(&line("No diff provided".to_owned(), theme.muted));
        } else {
            let lines = View::new(app)
                .column()
                .width(Length::percent(100.0))
                .shrink(0.0)
                .gap(gap);
            for text in &info.lines {
                lines.add(&line(text.clone(), theme.text));
            }
            content.add(&lines);
        }
    } else {
        let save = body.request.info.save.as_deref().unwrap_or_default();
        for text in always_lines(&body.request.info.action, save) {
            content.add(&line(text, theme.text));
        }
    }
    scroll.add(&content);
    root.add(
        &View::new(app)
            .column()
            .width(Length::percent(100.0))
            .grow(1.0)
            .basis(Length::Auto)
            .min_height(0)
            .padding_edge(Edge::Left, if compact { 0 } else { 1 })
            .padding_edge(Edge::Right, if compact { 0 } else { 3 })
            .padding_edge(Edge::Bottom, pad_y)
            .child(&frame),
    );

    let narrow = compact && width < 56;
    let hint_text = if narrow {
        "pgup/pgdn scroll".to_owned()
    } else {
        format!(
            "{} select  enter confirm  esc {}",
            if body.mono { "left/right" } else { "⇆" },
            if stage == Stage::Always {
                "cancel"
            } else {
                "reject"
            }
        )
    };
    let controls_width = choices
        .iter()
        .map(|choice| choice.label().width() + 3)
        .sum::<usize>()
        .saturating_sub(1);
    let inline = controls_width + hint_text.width()
        < usize::from(width).saturating_sub(if compact { 0 } else { 5 });
    let buttons = View::new(app)
        .row()
        .flex_wrap(Wrap::Wrap)
        .column_gap(1)
        .shrink(0.0);
    if inline {
        buttons.width(controls_width as u32);
    } else {
        buttons.width(Length::percent(100.0));
    }
    for choice in &choices {
        let selected = *choice == body.state.selected;
        let mut label = choice.label().fg(if selected {
            theme.action_focused_text
        } else {
            theme.action_secondary_text
        });
        if selected && body.mono {
            label = label.inverse();
        }
        buttons.add(
            &View::new(app)
                .width((choice.label().width() + 2) as u32)
                .height(1)
                .shrink(0.0)
                .padding_x(1)
                .bg(if selected {
                    theme.action_focused_bg
                } else {
                    Color::TRANSPARENT
                })
                .child(&Text::new(app, vec![label]).wrap(WrapMode::None)),
        );
    }
    let controls = View::new(app)
        .direction(if inline {
            FlexDirection::Row
        } else {
            FlexDirection::Column
        })
        .justify(Justify::SpaceBetween)
        .width(Length::percent(100.0))
        .gap(gap)
        .padding_edge(Edge::Left, pad_left)
        .padding_edge(Edge::Right, pad_right)
        .padding_edge(Edge::Top, pad_y)
        .padding_edge(Edge::Bottom, pad_y)
        .shrink(0.0)
        .bg(theme.pane)
        .child(&buttons);
    if busy {
        controls.add(&waiting());
    } else {
        let spans = if narrow {
            vec!["pgup/pgdn".fg(theme.text), " scroll".fg(theme.muted)]
        } else {
            vec![
                (if body.mono { "left/right" } else { "⇆" }).fg(theme.text),
                " select  ".fg(theme.muted),
                "enter".fg(theme.text),
                " confirm  ".fg(theme.muted),
                "esc".fg(theme.text),
                (if stage == Stage::Always {
                    " cancel"
                } else {
                    " reject"
                })
                .fg(theme.muted),
            ]
        };
        controls.add(
            &Text::new(app, spans)
                .height(1)
                .wrap(WrapMode::None)
                .shrink(0.0),
        );
    }
    root.add(&controls);
    Painted {
        scroll: Some(scroller),
        field: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_stages_follow_permission_shared() {
        let mut state = State::new("per_1");
        let choices = state.choices(true);
        assert_eq!(choices, vec![Choice::Once, Choice::Always, Choice::Reject]);
        state.shift(false, &choices);
        assert_eq!(state.selected, Choice::Reject);
        state.shift(true, &choices);
        assert_eq!(state.selected, Choice::Once);
        assert_eq!(
            state.clone().run(Choice::Once).unwrap().decision,
            PermissionReply::Once
        );

        assert_eq!(state.run(Choice::Always), None);
        assert_eq!(
            (state.stage, state.selected),
            (Stage::Always, Choice::Confirm)
        );
        state.escape();
        assert_eq!(
            (state.stage, state.selected),
            (Stage::Permission, Choice::Always)
        );
        state.run(Choice::Always);
        assert_eq!(
            state.run(Choice::Confirm).unwrap().decision,
            PermissionReply::Always
        );
        assert_eq!(state.run(Choice::Cancel), None);
        assert_eq!(state.stage, Stage::Permission);

        state.escape();
        assert_eq!(
            (state.stage, state.selected),
            (Stage::Reject, Choice::Reject)
        );
        state.message = "  use rg  ".into();
        assert_eq!(
            state.reject(),
            Some(Reply {
                decision: PermissionReply::Reject,
                message: Some("use rg".into())
            })
        );
        state.cancel();
        assert_eq!(
            (state.stage, state.selected),
            (Stage::Permission, Choice::Reject)
        );
        state.submitting = true;
        assert_eq!(state.reject(), None);
        assert_eq!(state.run(Choice::Once), None);
        assert_eq!(
            State::new("per_2").choices(false),
            vec![Choice::Once, Choice::Reject]
        );
    }
}
