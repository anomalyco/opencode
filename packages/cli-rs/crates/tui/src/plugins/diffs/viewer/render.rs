//! Rendering: the header, the cards, the footer, and the file tree, rebuilt from the viewer state.

use std::rc::Rc;

use base64::Engine;
use opencode_ui::bind;
use opencode_ui::theme::Theme;
use opentui::native::ImageFit;
use opentui::prelude::*;
use opentui::style::Attributes;
use opentui::widget::{DiffView, ImageView};

use super::{Card, File, Load, Mode, Parts, Place, Preview, Viewer, is_image};
use crate::app::Tui;
use crate::plugins::diffs::hunks;
use crate::plugins::diffs::keys::Action;
use crate::plugins::diffs::tree;

impl Viewer {
    /// Rebuilds what changed: everything when the cards change, else the tree.
    pub(super) fn refresh(&self) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let key = self.render_key(&tui);
        let same = self.parts.borrow().key.as_ref() == Some(&key);
        if same {
            self.render_tree(&tui);
            self.passes();
            return;
        }
        self.render(&tui);
        self.parts.borrow_mut().key = Some(key);
        self.passes();
    }

    pub(super) fn render_key(&self, tui: &Tui) -> String {
        let state = self.state.borrow();
        let load = match &state.load {
            Load::Loading => "loading".to_owned(),
            Load::Failed => "failed".to_owned(),
            Load::Ready { files, .. } => files.len().to_string(),
        };
        let (generation, width) = (state.generation, state.width);
        let reviewed: Vec<String> = state.reviewed.iter().cloned().collect();
        drop(state);
        format!(
            "{generation}|{load}|{width}|{:?}|{reviewed:?}|{:?}|{}|{}|{}",
            self.visible(),
            self.view(),
            self.compact(),
            self.show_tree(),
            self.focused(tui),
        )
    }

    pub(super) fn render(&self, tui: &Tui) {
        let app = &tui.app;
        let theme = tui.page();
        let previous = self.scroll().map(|scroll| scroll.scroll_position().1);
        self.root.clear();
        *self.parts.borrow_mut() = Parts::default();
        let docked = self.docked();
        let compact = self.compact();
        let surface = if docked { theme.background.raised.base } else { theme.background.base };
        self.root.bg(surface);
        let show_tree = self.show_tree();
        let help = tui.keymap.shortcut("diff.help");
        if !show_tree {
            self.root.add(&self.header(app, &theme, docked, compact));
        }
        let body = View::new(app).column().grow(1.0).basis(Length::Auto).min_height(0);
        self.root.add(&body);
        let message = |text: &str, color: Color| {
            View::new(app)
                .grow(1.0)
                .basis(Length::Auto)
                .padding(2)
                .padding_edge(Edge::Top, if compact { 1 } else { 2 })
                .child(&Text::new(app, text).fg(color))
        };
        let (load, mode) = {
            let state = self.state.borrow();
            (state.load.clone(), state.mode)
        };
        match &load {
            Load::Loading => body.add(&message("Loading diff…", theme.text.muted)),
            Load::Failed => {
                let text = if self.source_base().is_none() && mode.needs_base() {
                    "Could not load diff. Choose a base branch from Diff source, or select Uncommitted."
                } else {
                    "Could not load diff. Reopen the diff viewer to try again."
                };
                body.add(&message(text, theme.text.feedback.error.base))
            }
            Load::Ready { base: None, .. } if mode == Mode::Committed => body.add(&message(
                "Committed comparison unavailable without base metadata. Choose a base branch from Diff source.",
                theme.text.muted,
            )),
            Load::Ready { files, .. } if files.is_empty() => body.add(&message("No changes to show", theme.text.muted)),
            Load::Ready { files, .. } => {
                let row = View::new(app).row().grow(1.0).basis(Length::Auto).min_height(0);
                if show_tree {
                    let slot = View::new(app).shrink(0.0).min_height(0);
                    row.add(&slot);
                    self.parts.borrow_mut().tree = Some(slot);
                }
                row.add(&self.patches(tui, &theme, files, surface, previous));
                body.add(&row)
            }
        };
        if compact {
            self.root.add(&self.footer(tui, &theme, docked, help.clone()));
        }
        if !show_tree && !compact && help.is_some() {
            let shortcut = Text::new(app, "?").fg(theme.text.base).wrap(WrapMode::None);
            let weak = self.this.clone();
            shortcut.mouse_pointer(MousePointer::POINTER).on_click(move |cx, _| {
                cx.stop_propagation();
                if let Some(viewer) = weak.upgrade() {
                    crate::plugins::diffs::help::open(&viewer);
                }
            });
            self.root.add(
                &View::new(app)
                    .absolute()
                    .position(Edge::Top, 0)
                    .position(Edge::Right, 0)
                    .width(1)
                    .height(1)
                    .child(&shortcut),
            );
        }
        self.render_tree(tui);
        app.request_redraw();
    }

    /// The source header above the cards when the tree is hidden.
    pub(super) fn header(&self, app: &App, theme: &Theme, docked: bool, compact: bool) -> View {
        let mode = self.mode();
        let switch = View::new(app).row().grow(1.0).basis(Length::Auto).min_width(0).child(
            &Text::new(app, mode.label()).fg(theme.text.action.secondary.base).bold().wrap(WrapMode::None).shrink(0.0),
        );
        if let Some(detail) = self.source_detail() {
            switch.add(
                &Text::new(app, format!(" · {detail}"))
                    .fg(theme.text.muted)
                    .wrap(WrapMode::None)
                    .truncate(true)
                    .grow(1.0)
                    .basis(Length::Auto)
                    .min_width(0),
            );
        }
        let weak = self.this.clone();
        switch.mouse_pointer(MousePointer::POINTER).on_click(move |cx, _| {
            cx.stop_propagation();
            if let Some(viewer) = weak.upgrade() {
                crate::plugins::diffs::sources::open(&viewer);
            }
        });
        let files = self.files();
        let reviewed = (0..files.len()).filter(|&file| self.is_reviewed(file)).count();
        View::new(app)
            .row()
            .gap(1)
            .shrink(0.0)
            .padding_edge(Edge::Left, 2)
            .padding_edge(Edge::Right, if compact { 1 } else { 2 })
            .padding_edge(Edge::Top, u16::from(docked))
            .height(if docked { 2 } else { 1 })
            .child(&switch)
            .child(
                &Text::new(app, format!("{reviewed}/{}", files.len()))
                    .fg(theme.text.muted)
                    .wrap(WrapMode::None)
                    .shrink(0.0),
            )
    }

    /// The fixed top edge and the scrolled cards.
    pub(super) fn patches(
        &self,
        tui: &Tui,
        theme: &Theme,
        files: &[File],
        surface: Color,
        previous: Option<f64>,
    ) -> View {
        let app = &tui.app;
        let inset = self.inset();
        let compact = self.compact();
        let top_edge = View::new(app)
            .height(1)
            .shrink(0.0)
            .margin_edge(Edge::Left, inset)
            .margin_edge(Edge::Right, inset)
            .bg(theme.diff.background.context);
        let scroll = ScrollBox::new(app).scrollbars(false).grow(1.0).basis(Length::Auto).min_height(0).focusable(false);
        let weak = self.this.clone();
        scroll.on_mouse(move |_, event| {
            if matches!(event.kind, MouseEventKind::ScrollUp | MouseEventKind::ScrollDown)
                && let Some(viewer) = weak.upgrade()
            {
                viewer.clear_patch_selection();
                viewer.passes();
            }
        });
        let syntax = opencode_ui::code::syntax_theme(theme);
        let view = self.view();
        let mode = self.mode();
        let pane_width = self.patch_pane_width();
        let mut cards = Vec::new();
        for (index, file) in self.visible().into_iter().enumerate() {
            let Some(entry) = files.get(file) else {
                continue;
            };
            let reviewed = self.state.borrow().reviewed.contains(&entry.file);
            let background = if reviewed { theme.background.raised.high } else { theme.diff.background.context };
            let image = is_image(&entry.file);
            let node = View::new(app).column().shrink(0.0);
            if index > 0 {
                node.add(&card_gap(app, theme, '▄', background, surface, inset));
            }
            let counts = if image {
                6
            } else {
                entry.additions.to_string().len() as i64 + entry.deletions.to_string().len() as i64 + 5
            } + if reviewed { 2 } else { 0 };
            let path = crate::dialogs::open::truncate_file_path(&entry.file, (pane_width - counts - 2).max(1));
            let split = path.rfind('/').map_or(0, |at| at + 1);
            let line = View::new(app)
                .row()
                .gap(1)
                .height(1)
                .shrink(0.0)
                .padding_edge(Edge::Left, if compact { 2 } else { 1 })
                .padding_edge(Edge::Right, 1)
                .child(
                    &View::new(app).grow(1.0).basis(Length::Auto).min_width(0).child(
                        &Text::new(
                            app,
                            vec![
                                path[..split].to_owned().fg(theme.text.muted),
                                path[split..].to_owned().fg(if reviewed { theme.text.muted } else { theme.text.base }),
                            ],
                        )
                        .fg(theme.text.muted)
                        .wrap(WrapMode::None)
                        .truncate(true),
                    ),
                );
            if reviewed {
                line.add(&Text::new(app, "✓").fg(theme.text.muted).shrink(0.0));
            }
            if image {
                line.add(&Text::new(app, "Image").fg(theme.text.muted));
            } else {
                let count = |text: String, color: Color| {
                    Text::new(app, text).fg(if reviewed { theme.text.muted } else { color }).shrink(0.0)
                };
                line.add(&count(format!("+{}", entry.additions), theme.diff.text.added));
                line.add(&count(format!("-{}", entry.deletions), theme.diff.text.removed));
            }
            let weak = self.this.clone();
            line.on_mouse(move |cx, event| {
                if event.kind == MouseEventKind::Down(MouseButton::Right)
                    && let Some(viewer) = weak.upgrade()
                {
                    cx.prevent_default();
                    cx.stop_propagation();
                    viewer.open_menu(file, event.x, event.y);
                }
            });
            let card = View::new(app)
                .column()
                .shrink(0.0)
                .margin_edge(Edge::Left, inset)
                .margin_edge(Edge::Right, inset)
                .bg(background);
            node.add(&card);
            let mut rows = Vec::new();
            let header = if reviewed {
                // The reviewed card is its title; a half-row of the page closes it.
                card.add(&line);
                node.add(&card_gap(app, theme, '▀', background, surface, inset));
                None
            } else {
                let header = View::new(app)
                    .column()
                    .height(hunks::FILE_HEADER_HEIGHT as u16)
                    .shrink(0.0)
                    .z_index(1)
                    .bg(background)
                    .child(&line);
                card.add(&header);
                card.add(&self.body(tui, theme, &syntax, entry, mode, view, compact, image, &mut rows));
                Some(header)
            };
            cards.push(Card { file, reviewed, node: node.clone(), card, header, hunks: rows });
            scroll.add(&node);
        }
        if let Some(previous) = previous {
            scroll.scroll_to(0.0, previous);
        }
        {
            let mut parts = self.parts.borrow_mut();
            parts.scroll = Some(scroll.clone());
            parts.top_edge = Some(top_edge.clone());
            parts.cards = cards;
        }
        View::new(app).column().grow(1.0).basis(Length::Auto).min_width(0).min_height(0).child(&top_edge).child(&scroll)
    }

    /// A card's body: its patch, or a line that says why there is none.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn body(
        &self,
        tui: &Tui,
        theme: &Theme,
        syntax: &opentui::syntax::SyntaxTheme,
        entry: &File,
        mode: Mode,
        view: DiffView,
        compact: bool,
        image: bool,
        rows: &mut Vec<AnyWidget>,
    ) -> View {
        let app = &tui.app;
        if image && mode != Mode::Committed && entry.status != tree::Status::Deleted {
            return self.image(tui, theme, &entry.file);
        }
        if !image && !entry.patch.is_empty() {
            let view = if entry.status == tree::Status::Modified { view } else { DiffView::Unified };
            let diff = opencode_ui::diff::view(
                app,
                theme,
                syntax,
                &entry.patch,
                view,
                opentui::syntax::filetype_for_path(&entry.file),
                WrapMode::Char,
                u32::from(compact),
            );
            // The first diff, then each later hunk's `@@` row.
            rows.extend(
                diff.children()
                    .into_iter()
                    .enumerate()
                    .filter(|(index, _)| *index == 0 || index % 2 == 1)
                    .map(|(_, row)| row),
            );
            return diff;
        }
        let text = match () {
            _ if mode == Mode::Committed && image => {
                "Committed image preview unavailable. The working-tree image is not shown."
            }
            _ if entry.status == tree::Status::Deleted && image => {
                "Deleted image. The previous revision is not available for preview."
            }
            _ => "No patch available for this file.",
        };
        View::new(app)
            .width(Length::percent(100.0))
            .shrink(0.0)
            .padding_edge(Edge::Left, if compact { 2 } else { 1 })
            .padding_edge(Edge::Right, 1)
            .padding_edge(Edge::Bottom, 1)
            .child(&Text::new(app, text).fg(theme.text.muted))
    }

    /// `DiffViewerImage`: the working-tree image, read with `file.read` once per file list. A click opens it in
    /// the image preview dialog.
    pub(super) fn image(&self, tui: &Tui, theme: &Theme, file: &str) -> View {
        let app = &tui.app;
        let height = (app.size().1 / 4).clamp(3, 8);
        let slot = View::new(app).column().height(height + 2).shrink(0.0).gap(1);
        let cached = self.previews.borrow().get(file).cloned();
        let preview = cached.unwrap_or_else(|| {
            self.read_image(tui, file);
            Preview::Loading
        });
        fill_image(tui, theme, &slot, file, height, &preview);
        self.parts.borrow_mut().images.push((file.to_owned(), slot.clone()));
        View::new(app)
            .column()
            .width(Length::percent(100.0))
            .shrink(0.0)
            .gap(1)
            .padding_edge(Edge::Left, 1)
            .padding_edge(Edge::Right, 1)
            .padding_edge(Edge::Bottom, 1)
            .child(&Text::new(app, "Working tree preview").fg(theme.text.muted))
            .child(&slot)
    }

    /// The footer of the compact layout: how to leave, and the shortcuts.
    pub(super) fn footer(&self, tui: &Tui, theme: &Theme, docked: bool, help: Option<String>) -> View {
        let app = &tui.app;
        let focused = self.focused(tui);
        let surface = theme.background.raised.base;
        let footer = View::new(app).column().shrink(0.0).bg(theme.background.base);
        if docked {
            footer.add(
                &View::new(app)
                    .height(1)
                    .shrink(0.0)
                    .border_sides(Sides::BOTTOM)
                    .border_chars(Some(border_chars('▀')))
                    .border_color(surface)
                    .bg(theme.background.base),
            );
        }
        let (command, label) = if docked { ("pane.focus.left", " focus prompt") } else { ("diff.close", " close") };
        let shortcut = tui.keymap.shortcut(command).unwrap_or_default();
        let leave =
            Text::new(app, vec![shortcut.into(), if focused { label.fg(theme.text.muted) } else { label.into() }])
                .fg(if focused { theme.background.action.primary.focused } else { theme.text.action.primary.disabled })
                .attributes(if focused { Attributes::default() } else { Attributes::DIM })
                .wrap(WrapMode::None)
                .truncate(true)
                .grow(1.0)
                .basis(Length::Auto)
                .min_width(0);
        let weak = self.this.clone();
        leave.mouse_pointer(MousePointer::POINTER).on_click(bind!(weak, |viewer, _, _| {
            if !viewer.docked() {
                viewer.run(Action::Close);
                return;
            }
            if let (Some(tui), Place::Panel { host, .. }) = (viewer.tui.upgrade(), &viewer.place) {
                tui.app.focus(host);
            }
        }));
        let row = View::new(app)
            .row()
            .height(1)
            .shrink(0.0)
            .padding_edge(Edge::Left, 2)
            .padding_edge(Edge::Right, 1)
            .child(&leave);
        if let Some(help) = help {
            let muted = !focused;
            let text = Text::new(
                app,
                vec![help.into(), if muted { " see all".into() } else { " see all".fg(theme.text.muted) }],
            )
            .fg(if muted { theme.text.action.primary.disabled } else { theme.text.base })
            .attributes(if muted { Attributes::DIM } else { Attributes::default() })
            .wrap(WrapMode::None)
            .shrink(0.0);
            let weak = self.this.clone();
            text.mouse_pointer(MousePointer::POINTER).on_click(move |cx, _| {
                cx.stop_propagation();
                if let Some(viewer) = weak.upgrade() {
                    crate::plugins::diffs::help::open(&viewer);
                }
            });
            row.add(&View::new(app).shrink(0.0).child(&text));
        }
        footer.add(&row);
        if docked {
            footer.add(&View::new(app).height(1).shrink(0.0));
        }
        footer
    }

    /// Rebuilds the tree pane in its slot.
    pub(super) fn render_tree(&self, tui: &Tui) {
        let Some(slot) = self.parts.borrow().tree.clone() else {
            return;
        };
        slot.clear();
        let theme = tui.page();
        let files = self.files();
        let items: Vec<tree::Item<'_>> =
            files.iter().map(|file| tree::Item { file: &file.file, status: file.status }).collect();
        let (tree, expanded, selected, reviewed) = {
            let state = self.state.borrow();
            (state.tree.clone(), state.expanded.clone(), state.selected, state.reviewed.clone())
        };
        let selected = selected.or_else(|| self.single().then(|| self.visible().first().copied()).flatten());
        let detail = self.source_detail();
        let is_reviewed = |file: usize| files.get(file).is_some_and(|file| reviewed.contains(&file.file));
        let weak = self.this.clone();
        let on_row: tree::OnRow = Rc::new(bind!(weak, |viewer, row| {
            match row.file {
                Some(file) => {
                    viewer.state.borrow_mut().selected_hunk = None;
                    viewer.scroll_to_file(Some(file));
                    if viewer.single() {
                        viewer.scroll_to(0);
                    }
                }
                None => {
                    {
                        let mut state = viewer.state.borrow_mut();
                        state.expanded = tree::toggle(&state.tree, &state.expanded, row.id);
                    }
                    viewer.refresh();
                }
            }
        }));
        let weak = self.this.clone();
        let on_source = Rc::new(bind!(weak, |viewer| crate::plugins::diffs::sources::open(&viewer)));
        let weak = self.this.clone();
        let on_menu: tree::OnMenu = Rc::new(bind!(weak, |viewer, file, x, y| viewer.open_menu(file, x, y)));
        let pane = tree::pane(
            &tui.app,
            &theme,
            &tree::Pane {
                width: self.tree_width() as u16,
                files: &items,
                selected,
                reviewed: &is_reviewed,
                expanded: &expanded,
                source: self.mode().label(),
                detail: detail.as_deref(),
                help: tui.keymap.shortcut("diff.help"),
            },
            &tree,
            on_row,
            on_source,
            on_menu,
        );
        slot.add(&pane);
    }
}

/// A half-row of page between cards: the card's color over its width, the pane's surface over the insets
/// (`CardGap`).
fn card_gap(app: &App, theme: &Theme, glyph: char, card: Color, surface: Color, inset: u16) -> View {
    let side = if glyph == '▄' { Sides::TOP } else { Sides::BOTTOM };
    let half = |color: Color| {
        View::new(app)
            .height(1)
            .shrink(0.0)
            .border_sides(side)
            .border_chars(Some(border_chars(glyph)))
            .border_color(color)
            .bg(theme.background.base)
    };
    let row = View::new(app).row().height(1).shrink(0.0);
    // A zero-width inset still claims a cell, which would notch flush cards.
    if inset > 0 {
        row.add(&half(surface).width(inset));
    }
    row.add(&half(card).grow(1.0).basis(Length::Auto));
    if inset > 0 {
        row.add(&half(surface).width(inset));
    }
    row
}

/// Border characters that draw `horizontal` on the top and bottom sides only (`EmptyBorder`).
fn border_chars(horizontal: char) -> [char; 11] {
    let mut chars = [' '; 11];
    chars[4] = horizontal;
    chars
}

/// The body of an image card: a loading or error line, or the image with its size and "Click to enlarge".
pub(super) fn fill_image(tui: &Tui, theme: &Theme, slot: &View, file: &str, height: u16, preview: &Preview) {
    let app = &tui.app;
    slot.clear();
    let line = |text: &str, color: Color| Text::new(app, text).fg(color);
    let error = |text: &str| {
        slot.add(&line(text, theme.text.feedback.error.base));
    };
    let bytes = match preview {
        Preview::Loading => {
            slot.add(&line("Loading image…", theme.text.muted));
            return;
        }
        Preview::Failed => return error("Could not load image"),
        Preview::Ready(bytes) => bytes.clone(),
    };
    let decoded = opentui::native::Image::decode(app.session().context(), &bytes)
        .and_then(|image| image.info().map(|info| (image, info)));
    let Ok((image, info)) = decoded else {
        return error("Could not decode image");
    };
    let open = {
        let (tui, file) = (tui.weak(), file.to_owned());
        move |cx: &mut Cx<'_>, event: &MouseEvent| {
            if event.kind != MouseEventKind::Up(MouseButton::Left) {
                return;
            }
            cx.stop_propagation();
            let Some(tui) = tui.upgrade() else { return };
            let uri = format!(
                "data:application/octet-stream;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes.as_slice())
            );
            crate::dialogs::image_preview::show(&tui, vec![(uri, Some(file.clone()))], 0);
        }
    };
    let picture = View::new(app).width(Length::percent(100.0)).height(height).child(
        &ImageView::new(app)
            .image(Some(image))
            .fit(ImageFit::Contain)
            .width(Length::percent(100.0))
            .height(Length::percent(100.0)),
    );
    picture.mouse_pointer(MousePointer::POINTER).on_mouse(open.clone());
    let enlarge = Text::new(app, "Click to enlarge").fg(theme.text.action.secondary.base);
    enlarge.mouse_pointer(MousePointer::POINTER).on_mouse(open);
    slot.add(&picture);
    slot.add(
        &View::new(app)
            .row()
            .justify(Justify::SpaceBetween)
            .child(&line(&format!("{} x {}", info.width, info.height), theme.text.muted))
            .child(&enlarge),
    );
}
