//! The revert banner (E.6b): `RevertMessage` (`routes/session/index.tsx:1562-1567,2253-2333`). After `/undo` the
//! transcript ends with how many messages were reverted, the files it changed back, and how to restore them; a click
//! clears the revert.

use opencode_api::generated::{
    FileDiffInfo, FileDiffInfoStatus, SessionID, SessionMessageInfo, SessionRevertClearInput,
};
use opencode_ui::bind;
use opencode_ui::theme::Theme;
use opentui::prelude::*;
use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use unicode_width::UnicodeWidthStr;

use crate::app::Tui;
use crate::dialogs::open::truncate_file_path;

pub struct Banner(Rc<Inner>);

struct Inner {
    app: App,
    theme: Theme,
    tui: Weak<Tui>,
    root: View,
    body: View,
    rendered: RefCell<Option<Props>>,
    session: RefCell<Option<SessionID>>,
    hover: Cell<bool>,
}

#[derive(Clone, PartialEq)]
struct Props {
    count: usize,
    files: Vec<FileDiffInfo>,
    redo: Option<String>,
    width: usize,
}

impl Banner {
    pub fn new(tui: &Tui, theme: &Theme) -> Self {
        let app = &tui.app;
        let raised = theme.background.raised.base;
        let body = View::new(app)
            .column()
            .padding_edge(Edge::Top, 1)
            .padding_edge(Edge::Bottom, 1)
            .padding_edge(Edge::Left, 2)
            .bg(raised);
        let root = View::new(app)
            .column()
            .shrink(0.0)
            .margin_edge(Edge::Top, 1)
            .border(BorderStyle::Heavy)
            .border_sides(Sides::LEFT)
            .border_color(raised)
            .visible(false)
            .child(&body);
        let inner = Rc::new(Inner {
            app: app.clone(),
            theme: theme.clone(),
            tui: tui.weak(),
            root,
            body,
            rendered: RefCell::default(),
            session: RefCell::default(),
            hover: Cell::new(false),
        });
        inner.root.on_hover(bind!(inner, |inner, _, hovered| {
            inner.hover.set(hovered);
            let raised = inner.theme.background.raised.base;
            inner.body.bg(if hovered { inner.theme.decrease(&raised, 1) } else { raised });
        }));
        inner.root.mouse_pointer(MousePointer::POINTER).on_click(bind!(inner, |inner, _, _| inner.clear()));
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    /// `messages` is the whole list; the banner counts the user messages from the boundary on.
    pub fn update(
        &self,
        tui: &Tui,
        session: &SessionID,
        revert: Option<(&str, &[FileDiffInfo])>,
        messages: &[SessionMessageInfo],
        redo: Option<String>,
    ) {
        *self.0.session.borrow_mut() = Some(session.clone());
        let Some((boundary, files)) = revert else {
            self.0.root.visible(false);
            *self.0.rendered.borrow_mut() = None;
            return;
        };
        let count = messages
            .iter()
            .position(|message| opencode_store::MessageExt::id(message) == boundary)
            .map_or(0, |start| {
                messages[start..].iter().filter(|message| matches!(message, SessionMessageInfo::User(_))).count()
            });
        let props =
            Props { count, files: files.to_vec(), redo, width: usize::from(tui.app.size().0).saturating_sub(4) };
        self.0.root.visible(true);
        if self.0.rendered.borrow().as_ref() == Some(&props) {
            return;
        }
        self.0.render(&props);
        *self.0.rendered.borrow_mut() = Some(props);
    }
}

impl Inner {
    fn render(&self, props: &Props) {
        let app = &self.app;
        let theme = &self.theme;
        let muted = theme.text.muted;
        self.body.clear();
        let plural = if props.count == 1 { "" } else { "s" };
        self.body.add(&Text::new(app, format!("{} message{plural} reverted", props.count)).fg(muted));
        if !props.files.is_empty() {
            let list = View::new(app).column().padding_edge(Edge::Top, 1).padding_edge(Edge::Bottom, 1);
            for file in &props.files {
                let added = (file.additions > 0).then(|| format!("+{}", file.additions));
                let removed = (file.deletions > 0).then(|| format!("-{}", file.deletions));
                let max = props.width as i64
                    - 5
                    - added.as_ref().map_or(0, |text| text.width() as i64 + 1)
                    - removed.as_ref().map_or(0, |text| text.width() as i64 + 1);
                let path = truncate_file_path(&file.file, max.max(2));
                let row = View::new(app)
                    .row()
                    .gap(1)
                    .shrink(0.0)
                    .child(&Text::new(app, status_label(&file.status)).fg(muted))
                    .child(&Text::new(app, path).fg(theme.text.base).wrap(WrapMode::None));
                if let Some(added) = added {
                    row.add(&Text::new(app, added).fg(theme.diff.text.added));
                }
                if let Some(removed) = removed {
                    row.add(&Text::new(app, removed).fg(theme.diff.text.removed));
                }
                list.add(&row);
            }
            self.body.add(&list);
        }
        let mut restore = Vec::new();
        if let Some(key) = &props.redo {
            restore.push(Span::styled(key.clone(), Style::new().fg(theme.text.base)));
        }
        restore.push(Span::styled(" or /redo to restore", Style::new().fg(muted)));
        self.body.add(&Text::new(app, restore).fg(muted));
    }

    /// `DELETE /api/session/{id}/revert`; a failure shows as a toast.
    fn clear(&self) {
        let (Some(tui), Some(session)) = (self.tui.upgrade(), self.session.borrow().clone()) else {
            return;
        };
        let client = tui.data.client().clone();
        let weak = self.tui.clone();
        self.app.spawn(
            async move { client.session_revert_clear(&SessionRevertClearInput { session_id: session }).await },
            move |_, result| {
                if let (Err(error), Some(tui)) = (result, weak.upgrade()) {
                    tui.toasts.error(error.to_string());
                }
            },
        );
    }
}

/// `statusLabel`.
fn status_label(status: &FileDiffInfoStatus) -> &'static str {
    match status {
        FileDiffInfoStatus::Added => "A",
        FileDiffInfoStatus::Deleted => "D",
        _ => "M",
    }
}
