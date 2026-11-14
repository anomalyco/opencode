//! The viewer's tree: the header, the cards, the footer and the file tree, from the viewer's state. The cards are a
//! windowed list (P3): only those near the view have widgets, and a card that did not change is kept whole
//! ([`v2::View::memo`]). A card's header sticks to the top of its card, its hunks are anchors a step walks, and the
//! fixed edge above the list takes the color of the card at the top from `layout`.

use opencode_plugin::abi::interact::Interact;
use opencode_plugin::abi::v2::{self, ContentRef, DiffView, Edge, Fit, Geometry, LayoutReply, ListItem, Node, Source};
use opencode_plugin::abi::{Click, Edges, Justify, Layout, Rgba, Span, Width, Wrap};
use opencode_ui::theme::tint;
use opentui::style::Color;

use super::tree;
use super::viewer::{File, Load, Mode, Preview, Viewer, is_image};
use super::{Diffs, EDGE, FILES, HELP, LEAVE, PREVIEW, SOURCE};

/// The root's id: a view that keeps it changes nothing.
const ROOT: &str = "viewer";

/// The viewer of `cx`'s mount, or nothing while it has none.
pub fn view(diffs: &Diffs, cx: &mut v2::View<'_>) -> Node {
    let mut held = diffs.viewer.borrow_mut();
    let Some(viewer) = held.as_mut().filter(|viewer| viewer.surface() == cx.mount.surface) else {
        return Node::column(Vec::new()).with_id(ROOT);
    };
    let changed = &cx.input.changed;
    let woken = changed.woken && !viewer.drawn;
    let unchanged = !(changed.all || changed.local || changed.size || woken);
    if unchanged && !cx.input.full && viewer.contents.mount == cx.mount.generation {
        return Node::Keep { key: ROOT.to_owned() };
    }
    viewer.width = i64::from(cx.input.width);
    viewer.panel = cx.input.panel;
    // A handle names nothing in another mount, or after a refused tree; one of an earlier load is released.
    let contents = &mut viewer.contents;
    if contents.mount != cx.mount.generation || cx.input.full {
        *contents = super::viewer::Contents { mount: cx.mount.generation, load: viewer.loads, ..Default::default() };
    } else if contents.load != viewer.loads {
        for handle in contents.patches.drain().map(|(_, handle)| handle).chain(contents.images.drain().map(|(_, h)| h))
        {
            cx.release(handle);
        }
        contents.load = viewer.loads;
    }
    viewer.drawn = true;
    root(viewer, diffs, cx)
}

fn root(viewer: &mut Viewer, diffs: &Diffs, cx: &mut v2::View<'_>) -> Node {
    let docked = viewer.docked();
    let compact = viewer.compact();
    let surface = if docked { "background.raised.base" } else { "background.base" };
    let show_tree = viewer.show_tree();
    let help = cx.read.shortcut("diff.help");
    let mut children = Vec::new();
    if !show_tree {
        children.push(header(viewer, docked, compact, help.is_some()));
    }
    let message = |text: &str, color: &'static str| {
        Node::column(vec![Node::text([Span::new(text)]).fg(color)])
            .padding_sides(Edges { top: if compact { 1 } else { 2 }, right: 2, bottom: 2, left: 2 })
            .layout(Layout::default().grow())
    };
    let body = match &viewer.load {
        Load::Loading => message("Loading diff…", "text.muted"),
        Load::Failed => {
            let text = if viewer.source_base(&diffs.memory.borrow()).is_none() && viewer.mode.needs_base() {
                "Could not load diff. Choose a base branch from Diff source, or select Uncommitted."
            } else {
                "Could not load diff. Reopen the diff viewer to try again."
            };
            message(text, "text.feedback.error.base")
        }
        Load::Ready { base: None, .. } if viewer.mode == Mode::Committed => message(
            "Committed comparison unavailable without base metadata. Choose a base branch from Diff source.",
            "text.muted",
        ),
        Load::Ready { files, .. } if files.is_empty() => message("No changes to show", "text.muted"),
        Load::Ready { .. } => {
            let mut row = Vec::new();
            if show_tree {
                row.push(
                    Node::column(vec![tree_pane(viewer, cx)])
                        .layout(Layout::default().shrink(false).min_height(Width::Cells(0))),
                );
            }
            row.push(patches(viewer, cx, surface));
            Node::row(row).layout(Layout::default().grow().min_height(Width::Cells(0)))
        }
    };
    children.push(Node::column(vec![body]).layout(Layout::default().grow().min_height(Width::Cells(0))));
    if compact {
        children.push(footer(viewer, cx, docked, help));
    }
    Node::column(children).with_id(ROOT).bg(surface).layout(
        Layout::default()
            .width(Width::Percent(100.0))
            .height(Width::Percent(100.0))
            .min_width_zero()
            .min_height(Width::Cells(0)),
    )
}

/// The source header above the cards when the tree is hidden; a full screen without the tree has the help's `?` at
/// its right end.
fn header(viewer: &Viewer, docked: bool, compact: bool, help: bool) -> Node {
    let mut switch = vec![
        Node::text([Span::new(viewer.mode.label()).bold()])
            .fg("text.action.secondary.base")
            .wrap(Wrap::None)
            .layout(Layout::default().shrink(false)),
    ];
    if let Some(detail) = viewer.source_detail() {
        switch.push(
            Node::text([Span::new(format!(" · {detail}"))])
                .fg("text.muted")
                .wrap(Wrap::None)
                .truncate()
                .layout(Layout::default().grow().min_width_zero()),
        );
    }
    let files = viewer.files();
    let reviewed = files.iter().filter(|file| viewer.reviewed.contains(&file.file)).count();
    let shortcut = !compact && help;
    let mut row = vec![
        Node::row(switch).layout(Layout::default().grow().min_width_zero()).on_click(Click::command(SOURCE, None)),
        Node::text([Span::new(format!("{reviewed}/{}", files.len()))])
            .fg("text.muted")
            .wrap(Wrap::None)
            .layout(Layout::default().shrink(false)),
    ];
    // The `?` sits in the header's last cell, where its right padding is.
    if shortcut {
        row.push(
            Node::column(vec![
                Node::text([Span::new("?")]).fg("text.base").wrap(Wrap::None).on_click(Click::command(HELP, None)),
            ])
            .layout(Layout::default().width(Width::Cells(1)).height(Width::Cells(1)).shrink(false)),
        );
    }
    let right = match (compact, shortcut) {
        (true, _) => 1,
        (false, true) => 0,
        (false, false) => 2,
    };
    Node::row(row)
        .gap(1)
        .padding_sides(Edges { top: i16::from(docked), right, bottom: 0, left: 2 })
        .layout(Layout::default().shrink(false).height(Width::Cells(if docked { 2 } else { 1 })))
}

/// The fixed top edge and the cards.
fn patches(viewer: &mut Viewer, cx: &mut v2::View<'_>, surface: &'static str) -> Node {
    let inset = viewer.inset();
    let margin = Edges { left: inset as i16, right: inset as i16, ..Edges::default() };
    let edge = Node::column(Vec::new())
        .with_id(EDGE)
        .bg("diff.background.context")
        .layout(Layout::default().height(Width::Cells(1)).shrink(false).margin(margin));
    let shape = Shape {
        load: viewer.loads,
        view: viewer.view(cx.read),
        compact: viewer.compact(),
        inset,
        pane: viewer.pane_width(),
        mode: viewer.mode,
        surface,
        image_height: (cx.read.info().size.1 / 4).clamp(3, 8),
    };
    let visible = viewer.visible(cx.read);
    // The files and the handles are apart, so a card's build gives content while it reads its file.
    let Viewer { load, contents, reviewed, previews, .. } = viewer;
    let files: &[File] = match load {
        Load::Ready { files, .. } => files,
        _ => &[],
    };
    let items = visible
        .into_iter()
        .enumerate()
        .filter_map(|(index, file)| {
            let entry = files.get(file)?;
            let card = Card {
                shape: shape.clone(),
                gap: index > 0,
                reviewed: reviewed.contains(&entry.file),
                preview: previews.get(&entry.file).cloned(),
            };
            let estimate = estimate(entry, &card);
            let node = cx.memo(format!("f:{}", entry.file), card.clone(), |cx| build(cx, contents, file, entry, &card));
            Some(ListItem::new(node, estimate))
        })
        .collect();
    let list =
        Node::list(items).with_id(FILES).watched("file").layout(Layout::default().grow().min_height(Width::Cells(0)));
    Node::column(vec![edge, list]).layout(Layout::default().grow().min_width_zero().min_height(Width::Cells(0)))
}

/// What a card shows, beside its file: a card whose shape did not change is kept.
#[derive(Clone, Debug, PartialEq)]
struct Shape {
    load: u64,
    view: DiffView,
    compact: bool,
    inset: u16,
    pane: i64,
    mode: Mode,
    surface: &'static str,
    image_height: u16,
}

#[derive(Clone, Debug, PartialEq)]
struct Card {
    shape: Shape,
    gap: bool,
    reviewed: bool,
    preview: Option<Preview>,
}

/// The rows the host assumes a card takes until it is laid out: its header and a row a patch line.
fn estimate(entry: &File, card: &Card) -> u16 {
    let body = if is_image(&entry.file) { card.shape.image_height + 4 } else { entry.patch.lines().count() as u16 };
    let body = if card.reviewed { 2 } else { body.saturating_add(super::viewer::FILE_HEADER_HEIGHT) };
    body.saturating_add(u16::from(card.gap)).max(1)
}

fn build(
    cx: &mut v2::View<'_>,
    contents: &mut super::viewer::Contents,
    file: usize,
    entry: &File,
    card: &Card,
) -> Node {
    let shape = &card.shape;
    let background = if card.reviewed { "background.raised.high" } else { "diff.background.context" };
    let image = is_image(&entry.file);
    let path = &entry.file;
    let mut children = Vec::new();
    if card.gap {
        children.push(card_gap('▄', background, shape.surface, shape.inset, shape.pane));
    }
    let counts =
        if image { 6 } else { entry.additions.to_string().len() as i64 + entry.deletions.to_string().len() as i64 + 5 }
            + if card.reviewed { 2 } else { 0 };
    let shown = crate::dialogs::open::truncate_file_path(path, (shape.pane - counts - 2).max(1));
    let split = shown.rfind('/').map_or(0, |at| at + 1);
    let mut line = vec![
        Node::column(vec![
            Node::text([
                Span::new(&shown[..split]).fg("text.muted"),
                Span::new(&shown[split..]).fg(if card.reviewed { "text.muted" } else { "text.base" }),
            ])
            .fg("text.muted")
            .wrap(Wrap::None)
            .truncate(),
        ])
        .layout(Layout::default().grow().min_width_zero()),
    ];
    if card.reviewed {
        line.push(Node::text([Span::new("✓")]).fg("text.muted").layout(Layout::default().shrink(false)));
    }
    if image {
        line.push(Node::text([Span::new("Image")]).fg("text.muted"));
    } else {
        let count = |text: String, color: &'static str| {
            Node::text([Span::new(text)])
                .fg(if card.reviewed { "text.muted" } else { color })
                .layout(Layout::default().shrink(false))
        };
        line.push(count(format!("+{}", entry.additions), "diff.text.added"));
        line.push(count(format!("-{}", entry.deletions), "diff.text.removed"));
    }
    // A press of the right button on it opens the file menu (the surface's handler).
    let line = Node::row(line)
        .with_id(format!("h:{path}"))
        .gap(1)
        .padding_sides(Edges { left: if shape.compact { 2 } else { 1 }, right: 1, ..Edges::default() })
        .interact(Interact { pointer: true, ..Interact::default() })
        .layout(Layout::default().height(Width::Cells(1)).shrink(false));
    let margin = Edges { left: shape.inset as i16, right: shape.inset as i16, ..Edges::default() };
    let card_layout = Layout::default().shrink(false).margin(margin);
    if card.reviewed {
        // The reviewed card is its title; a half-row of the page closes it.
        children.push(Node::column(vec![line]).with_id(format!("c:{path}")).bg(background).layout(card_layout));
        children.push(card_gap('▀', background, shape.surface, shape.inset, shape.pane));
    } else {
        let header = Node::column(vec![line])
            .bg(background)
            .sticky(Edge::Top)
            .layout(Layout::default().height(Width::Cells(super::viewer::FILE_HEADER_HEIGHT)).shrink(false));
        let body = body(cx, contents, file, entry, card);
        children.push(Node::column(vec![header, body]).with_id(format!("c:{path}")).bg(background).layout(card_layout));
    }
    Node::column(children)
        .anchor("file", if card.reviewed { "reviewed" } else { "" })
        .layout(Layout::default().shrink(false))
}

/// A card's body: its patch, its image, or a line that says why there is none.
fn body(cx: &mut v2::View<'_>, contents: &mut super::viewer::Contents, file: usize, entry: &File, card: &Card) -> Node {
    let shape = &card.shape;
    let image = is_image(&entry.file);
    if image && shape.mode != Mode::Committed && entry.status != tree::Status::Deleted {
        return image_body(cx, contents, entry, card);
    }
    if !image && !entry.patch.is_empty() {
        let handle = *contents.patches.entry(file).or_insert_with(|| cx.content(entry.patch.clone()));
        let view = if entry.status == tree::Status::Modified { shape.view } else { DiffView::Unified };
        return Node::Diff {
            id: Some(format!("d:{}", entry.file)),
            content: Source::Content(handle),
            view,
            filetype: opentui::syntax::filetype_for_path(&entry.file).map(str::to_owned),
            hunks: Some("hunk".to_owned()),
            wrap: Wrap::Char,
            padding: u16::from(shape.compact),
        };
    }
    let text = match () {
        _ if shape.mode == Mode::Committed && image => {
            "Committed image preview unavailable. The working-tree image is not shown."
        }
        _ if entry.status == tree::Status::Deleted && image => {
            "Deleted image. The previous revision is not available for preview."
        }
        _ => "No patch available for this file.",
    };
    Node::column(vec![Node::text([Span::new(text)]).fg("text.muted")])
        .padding_sides(Edges { left: if shape.compact { 2 } else { 1 }, right: 1, bottom: 1, ..Edges::default() })
        .layout(Layout::default().width(Width::Percent(100.0)).shrink(false))
}

/// `DiffViewerImage`: the working-tree image, its size and "Click to enlarge"; a click opens the image preview.
fn image_body(cx: &mut v2::View<'_>, contents: &mut super::viewer::Contents, entry: &File, card: &Card) -> Node {
    let height = card.shape.image_height;
    let line = |text: &str, color: &'static str| Node::text([Span::new(text)]).fg(color);
    let slot = match &card.preview {
        None | Some(Preview::Loading) => vec![line("Loading image…", "text.muted")],
        Some(Preview::Failed) => vec![line("Could not load image", "text.feedback.error.base")],
        Some(Preview::Ready(bytes)) => match opencode_plugin::abi::image_size(bytes) {
            None => vec![line("Could not decode image", "text.feedback.error.base")],
            Some((width, tall)) => {
                let handle: ContentRef =
                    *contents.images.entry(entry.file.clone()).or_insert_with(|| cx.content(bytes.to_vec()));
                let open = Click::command(PREVIEW, Some(entry.file.clone()));
                let picture = Node::Image {
                    id: Some(format!("i:{}", entry.file)),
                    content: Source::Content(handle),
                    fit: Fit::Contain,
                    layout: Layout::default().width(Width::Percent(100.0)).height(Width::Percent(100.0)),
                };
                vec![
                    Node::column(vec![picture])
                        .on_click(open.clone())
                        .layout(Layout::default().width(Width::Percent(100.0)).height(Width::Cells(height))),
                    Node::row(vec![
                        line(&format!("{width} x {tall}"), "text.muted"),
                        line("Click to enlarge", "text.action.secondary.base").on_click(open),
                    ])
                    .justify(Justify::SpaceBetween),
                ]
            }
        },
    };
    Node::column(vec![
        line("Working tree preview", "text.muted"),
        Node::column(slot).gap(1).layout(Layout::default().height(Width::Cells(height + 2)).shrink(false)),
    ])
    .gap(1)
    .padding_sides(Edges { left: 1, right: 1, bottom: 1, ..Edges::default() })
    .layout(Layout::default().width(Width::Percent(100.0)).shrink(false))
}

/// A half-row of page between cards: the card's color over its width, the pane's surface over the insets (`CardGap`).
fn card_gap(glyph: char, card: &'static str, surface: &'static str, inset: u16, width: i64) -> Node {
    let fixed = |cells: u16| Layout::default().width(Width::Cells(cells)).height(Width::Cells(1)).shrink(false);
    let mut row = Vec::new();
    // A zero-width inset still claims a cell, which would notch flush cards.
    if inset > 0 {
        row.push(half(glyph, surface, inset, fixed(inset)));
    }
    let grows = Layout::default().height(Width::Cells(1)).shrink(false).grow().min_width_zero();
    row.push(half(glyph, card, width.max(0) as u16, grows));
    if inset > 0 {
        row.push(half(glyph, surface, inset, fixed(inset)));
    }
    Node::row(row).layout(Layout::default().height(Width::Cells(1)).shrink(false))
}

/// One row of `cells` of `glyph` in `color` on the page, cut to its box (TS `EmptyBorder`'s one side).
fn half(glyph: char, color: &'static str, cells: u16, layout: Layout) -> Node {
    let glyphs: String = std::iter::repeat_n(glyph, usize::from(cells)).collect();
    Node::column(vec![Node::text([Span::new(glyphs)]).fg(color).wrap(Wrap::None).unselectable()])
        .bg("background.base")
        .clip()
        .layout(layout)
}

/// The footer of the compact layout: how to leave, and the shortcuts.
fn footer(viewer: &Viewer, cx: &v2::View<'_>, docked: bool, help: Option<String>) -> Node {
    let focused = viewer.focused();
    let mut children = Vec::new();
    if docked {
        let line = Layout::default().height(Width::Cells(1)).shrink(false);
        children.push(half('▀', "background.raised.base", viewer.width.max(0) as u16, line));
    }
    let (command, label) = if docked { ("pane.focus.left", " focus prompt") } else { ("diff.close", " close") };
    let shortcut = cx.read.shortcut(command).unwrap_or_default();
    let dim = |span: Span| Span { dim: !focused, ..span };
    let label = if focused { Span::new(label).fg("text.muted") } else { Span::new(label) };
    let leave = Node::text([dim(Span::new(shortcut)), dim(label)])
        .fg(if focused { "background.action.primary.focused" } else { "text.action.primary.disabled" })
        .wrap(Wrap::None)
        .truncate()
        .on_click(Click::command(LEAVE, None))
        .layout(Layout::default().grow().min_width_zero());
    let mut row = vec![leave];
    if let Some(help) = help {
        let muted = !focused;
        let see = if muted { Span::new(" see all") } else { Span::new(" see all").fg("text.muted") };
        let text = Node::text([Span { dim: muted, ..Span::new(help) }, Span { dim: muted, ..see }])
            .fg(if muted { "text.action.primary.disabled" } else { "text.base" })
            .wrap(Wrap::None)
            .on_click(Click::command(HELP, None))
            .layout(Layout::default().shrink(false));
        row.push(Node::column(vec![text]).layout(Layout::default().shrink(false)));
    }
    children.push(
        Node::row(row)
            .padding_sides(Edges { left: 2, right: 1, ..Edges::default() })
            .layout(Layout::default().height(Width::Cells(1)).shrink(false)),
    );
    if docked {
        children.push(Node::column(Vec::new()).layout(Layout::default().height(Width::Cells(1)).shrink(false)));
    }
    Node::column(children).bg("background.base").layout(Layout::default().shrink(false))
}

/// The tree pane, in the surface's palette.
fn tree_pane(viewer: &Viewer, cx: &mut v2::View<'_>) -> Node {
    let palette = &cx.input.palette;
    let color = |token: &str| {
        palette.get(token).map_or(Color::rgb(0, 0, 0), |rgba| Color::rgba(rgba.r, rgba.g, rgba.b, rgba.a))
    };
    let (muted, surface) = (color("text.muted"), color("background.raised.base"));
    let rgba = |color: Color| Rgba::new(color.r, color.g, color.b, color.a);
    let items: Vec<tree::Item<'_>> =
        viewer.files().iter().map(|file| tree::Item { file: &file.file, status: file.status }).collect();
    let detail = viewer.source_detail();
    let reviewed = |file: usize| viewer.is_reviewed(file);
    tree::pane(
        &tree::Pane {
            width: viewer.tree_width() as u16,
            files: &items,
            selected: viewer.tree_selected(cx.read),
            reviewed: &reviewed,
            expanded: &viewer.expanded,
            source: viewer.mode.label(),
            detail: detail.as_deref(),
            help: cx.read.shortcut("diff.help"),
            faint: rgba(tint(muted, surface, 0.45)),
            rail: rgba(tint(muted, surface, 0.7)),
        },
        &viewer.tree,
        cx,
    )
}

/// The fixed top edge takes the reviewed color of the card at the top, in the frame that shows it.
pub fn layout(geometry: &Geometry) -> LayoutReply {
    let reviewed = geometry.top(FILES, "file").is_some_and(|anchor| anchor.variant == "reviewed");
    LayoutReply::default().paint(EDGE, if reviewed { "background.raised.high" } else { "diff.background.context" })
}
