//! Diff file tree (E.15a): the pure tree of `diff-viewer-file-tree-utils.ts` and the pane of
//! `diff-viewer-file-tree.tsx`.

use std::collections::BTreeSet;
use std::rc::Rc;

use opencode_ui::theme::Theme;
use opencode_ui::theme::tint;
use opentui::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Directory,
    File,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Node {
    pub id: usize,
    pub name: String,
    pub parent: Option<usize>,
    pub children: Vec<usize>,
    pub depth: usize,
    pub kind: Kind,
    pub file: Option<usize>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Tree {
    pub roots: Vec<usize>,
    pub nodes: Vec<Node>,
}

/// One visible row: a file, or a directory with its single-child directory chain collapsed into its name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
    pub id: usize,
    pub depth: usize,
    pub kind: Kind,
    pub name: String,
    pub file: Option<usize>,
}

pub type Expanded = BTreeSet<usize>;

/// `buildFileTree`: directories before files, then by name, then by insertion.
pub fn build<'a>(files: impl IntoIterator<Item = &'a str>) -> Tree {
    let mut tree = Tree::default();
    let mut directories: Vec<(String, usize)> = Vec::new();
    for (file, path) in files.into_iter().enumerate() {
        let segments: Vec<&str> = path.split('/').filter(|segment| !segment.is_empty()).collect();
        let Some((name, parents)) = segments.split_last() else {
            continue;
        };
        let mut parent = None;
        let mut directory = String::new();
        for (depth, segment) in parents.iter().enumerate() {
            if !directory.is_empty() {
                directory.push('/');
            }
            directory.push_str(segment);
            let existing = directories.iter().find(|(path, _)| *path == directory).map(|(_, id)| *id);
            let id = existing.unwrap_or_else(|| {
                let id = add(&mut tree, segment, parent, depth, Kind::Directory, None);
                directories.push((directory.clone(), id));
                id
            });
            parent = Some(id);
        }
        add(&mut tree, name, parent, parents.len(), Kind::File, Some(file));
    }
    let order = |tree: &Tree, ids: &mut Vec<usize>| ids.sort_by(|left, right| compare(tree, *left, *right));
    let mut roots = std::mem::take(&mut tree.roots);
    order(&tree, &mut roots);
    tree.roots = roots;
    for index in 0..tree.nodes.len() {
        let mut children = std::mem::take(&mut tree.nodes[index].children);
        order(&tree, &mut children);
        tree.nodes[index].children = children;
    }
    tree
}

fn add(tree: &mut Tree, name: &str, parent: Option<usize>, depth: usize, kind: Kind, file: Option<usize>) -> usize {
    let id = tree.nodes.len();
    tree.nodes.push(Node { id, name: name.to_owned(), parent, children: Vec::new(), depth, kind, file });
    match parent {
        Some(parent) => tree.nodes[parent].children.push(id),
        None => tree.roots.push(id),
    }
    id
}

fn compare(tree: &Tree, left: usize, right: usize) -> std::cmp::Ordering {
    let (a, b) = (&tree.nodes[left], &tree.nodes[right]);
    (a.kind != Kind::Directory)
        .cmp(&(b.kind != Kind::Directory))
        .then_with(|| a.name.encode_utf16().cmp(b.name.encode_utf16()))
        .then(left.cmp(&right))
}

/// `flattenFileTree`: every row, or with `expanded` only the rows under expanded directories.
pub fn flatten(tree: &Tree, expanded: Option<&Expanded>) -> Vec<Row> {
    fn visit(tree: &Tree, expanded: Option<&Expanded>, id: usize, depth: usize, rows: &mut Vec<Row>) {
        let node = &tree.nodes[id];
        if node.kind == Kind::File {
            rows.push(Row { id, depth, kind: Kind::File, name: node.name.clone(), file: node.file });
            return;
        }
        let mut chain = vec![node];
        while let [only] = chain.last().map_or(&[][..], |last| last.children.as_slice())
            && tree.nodes[*only].kind == Kind::Directory
        {
            chain.push(&tree.nodes[*only]);
        }
        let names: Vec<&str> = chain.iter().map(|node| node.name.as_str()).collect();
        rows.push(Row { id, depth, kind: Kind::Directory, name: names.join("/"), file: node.file });
        if expanded.is_none_or(|expanded| expanded.contains(&id))
            && let Some(last) = chain.last()
        {
            for &child in &last.children {
                visit(tree, expanded, child, depth + 1, rows);
            }
        }
    }
    let mut rows = Vec::new();
    for &root in &tree.roots {
        visit(tree, expanded, root, 0, &mut rows);
    }
    rows
}

/// The directories to expand so `file` shows (`fileTreeFileSelection`).
pub fn parents_of(tree: &Tree, file: usize) -> Option<Expanded> {
    let node = tree.nodes.iter().find(|node| node.kind == Kind::File && node.file == Some(file))?;
    Some(std::iter::successors(node.parent, |&parent| tree.nodes[parent].parent).collect())
}

/// `orderedPatchFileIndexes`: the files in tree order.
pub fn ordered_files(rows: &[Row]) -> Vec<usize> {
    rows.iter().filter_map(|row| row.file).collect()
}

/// `movePatchFileIndex`: `offset` files from `current` in `files`, clamped; the first when `current` is not there.
pub fn move_file(files: &[usize], current: Option<usize>, offset: i64) -> Option<usize> {
    let first = *files.first()?;
    let Some(index) = current.and_then(|current| files.iter().position(|&file| file == current)) else {
        return Some(first);
    };
    let last = files.len() as i64 - 1;
    Some(files[(index as i64 + offset).clamp(0, last) as usize])
}

/// `allExpandedFileTreeDirectories`.
pub fn all_expanded(tree: &Tree) -> Expanded {
    tree.nodes.iter().filter(|node| node.kind == Kind::Directory).map(|node| node.id).collect()
}

/// `toggleFileTreeDirectory`.
pub fn toggle(tree: &Tree, expanded: &Expanded, selected: usize) -> Expanded {
    let mut next = expanded.clone();
    if tree.nodes.get(selected).is_some_and(|node| node.kind == Kind::Directory) && !next.remove(&selected) {
        next.insert(selected);
    }
    next
}

/// Collapsed chains drop whole leading segments: "a/b/c/d" narrows to "…/c/d" (`truncateDirectoryChain`).
pub fn truncate_directory_chain(name: &str, max: i64) -> String {
    if width(name) <= max {
        return name.to_owned();
    }
    let mut kept: Vec<&str> = Vec::new();
    let mut used = width("…/");
    for segment in name.rsplit('/') {
        let next = width(segment) + i64::from(!kept.is_empty());
        if used + next > max {
            break;
        }
        kept.insert(0, segment);
        used += next;
    }
    if kept.is_empty() {
        return crate::dialogs::open::truncate_file_path(name, max);
    }
    format!("…/{}", kept.join("/"))
}

pub(crate) fn width(text: &str) -> i64 {
    unicode_width::UnicodeWidthStr::width(text) as i64
}

/// One file of the pane: its path and status letter.
pub struct Item<'a> {
    pub file: &'a str,
    pub status: Status,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Added,
    Deleted,
    Modified,
    Unknown,
}

/// What the pane shows.
pub struct Pane<'a> {
    pub width: u16,
    pub files: &'a [Item<'a>],
    pub selected: Option<usize>,
    pub reviewed: &'a dyn Fn(usize) -> bool,
    pub expanded: &'a Expanded,
    pub source: &'a str,
    pub detail: Option<&'a str>,
    pub help: Option<String>,
}

/// What a row click does.
pub type OnRow = Rc<dyn Fn(&Row)>;
/// What a right-click on a file row does, with the file and the cell (`onFileContextMenu`).
pub type OnMenu = Rc<dyn Fn(usize, u16, u16)>;

/// The pane (`DiffViewerFileTree`, tree layout): the source header, the rows, and the help footer.
pub fn pane(
    app: &App,
    theme: &Theme,
    input: &Pane<'_>,
    tree: &Tree,
    on_row: OnRow,
    on_source: Rc<dyn Fn()>,
    on_menu: OnMenu,
) -> View {
    let surface = theme.background.raised.base;
    let faint = tint(theme.text.muted, surface, 0.45);
    let rail = tint(theme.text.muted, surface, 0.7);
    let content_width = (i64::from(input.width) - 6).max(0);
    let reviewed_count = (0..input.files.len()).filter(|&file| (input.reviewed)(file)).count();

    let label =
        Text::new(app, input.source).fg(theme.text.action.secondary.base).bold().wrap(WrapMode::None).shrink(0.0);
    let switch = View::new(app).row().grow(1.0).basis(Length::Auto).min_width(0).child(&label);
    if let Some(detail) = input.detail {
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
    switch.on_click(move |cx, _| {
        cx.stop_propagation();
        on_source();
    });
    let header = View::new(app).row().height(1).shrink(0.0).margin_edge(Edge::Bottom, 1).gap(1).child(&switch).child(
        &Text::new(app, format!("{reviewed_count}/{}", input.files.len()))
            .fg(theme.text.muted)
            .wrap(WrapMode::None)
            .shrink(0.0),
    );

    let rows = View::new(app).column().shrink(0.0);
    for row in flatten(tree, Some(input.expanded)) {
        let selected = row.file.is_some() && row.file == input.selected;
        let reviewed = row.file.is_some_and(|file| (input.reviewed)(file));
        let foreground = match () {
            _ if row.kind == Kind::Directory => theme.text.muted,
            _ if selected => theme.text.action.primary.selected,
            _ if reviewed => theme.text.muted,
            _ => theme.text.base,
        };
        let marker = match row.kind {
            Kind::File => "≡ ",
            Kind::Directory if input.expanded.contains(&row.id) => "▾ ",
            Kind::Directory => "▸ ",
        };
        let depth = (row.depth as i64).min(((content_width - 3) / 2).max(0)).max(0);
        let indent = "│ ".repeat(depth as usize);
        let name_width = content_width - width(&indent) - width(marker);
        let name = match row.kind {
            Kind::Directory => truncate_directory_chain(&row.name, name_width),
            Kind::File => crate::dialogs::open::truncate_file_path(&row.name, name_width),
        };
        let item = row.file.and_then(|file| input.files.get(file));
        let (status, status_color) = match item.map(|item| item.status) {
            None => ("", theme.text.muted),
            Some(_) if reviewed => ("✓", theme.text.muted),
            Some(Status::Modified) => ("M", theme.text.muted),
            Some(Status::Added) => ("A", theme.diff.text.added),
            Some(Status::Deleted) => ("D", theme.diff.text.removed),
            Some(Status::Unknown) => ("?", theme.text.muted),
        };
        let name = Text::new(app, name).fg(foreground).wrap(WrapMode::None).truncate(true);
        if selected {
            name.bold();
        }
        let line = View::new(app)
            .row()
            .height(1)
            .child(&Text::new(app, vec![indent.fg(rail), marker.fg(faint)]).wrap(WrapMode::None).shrink(0.0))
            .child(&View::new(app).grow(1.0).basis(Length::Auto).min_width(0).margin_edge(Edge::Right, 1).child(&name))
            .child(&Text::new(app, status).fg(status_color).wrap(WrapMode::None).width(1).shrink(0.0));
        let base = surface;
        let hover = theme.background.raised.high;
        let container =
            View::new(app).column().width(Length::percent(100.0)).height(1).shrink(0.0).bg(base).child(&line);
        let hovered = container.clone();
        container.on_hover(move |cx, over| {
            hovered.bg(if over { hover } else { base });
            cx.request_redraw();
        });
        if let Some(file) = row.file {
            let on_menu = on_menu.clone();
            container.on_mouse(move |cx, event| {
                if event.kind == MouseEventKind::Down(MouseButton::Right) {
                    cx.prevent_default();
                    cx.stop_propagation();
                    on_menu(file, event.x, event.y);
                }
            });
        }
        let on_row = on_row.clone();
        container.on_click(move |cx, _| {
            cx.stop_propagation();
            on_row(&row);
        });
        rows.add(&container);
    }
    let scroll = ScrollBox::new(app).scrollbars(false).grow(1.0).basis(Length::Auto).min_height(0).focusable(false);
    scroll.add(&rows);

    let body = View::new(app)
        .column()
        .grow(1.0)
        .basis(Length::Auto)
        .min_width(0)
        .min_height(0)
        .padding_edge(Edge::Bottom, 1)
        .padding_edge(Edge::Left, 2)
        .padding_edge(Edge::Right, 2)
        .bg(surface)
        .child(&header)
        .child(&scroll);
    if let Some(help) = &input.help {
        body.add(&View::new(app).shrink(0.0).padding_edge(Edge::Top, 1).padding_edge(Edge::Bottom, 1).child(
            &Text::new(app, vec![help.clone().fg(theme.text.base), " help".fg(theme.text.muted)]).wrap(WrapMode::None),
        ));
    }
    View::new(app)
        .column()
        .width(input.width)
        .height(Length::percent(100.0))
        .min_width(0)
        .min_height(0)
        .shrink(0.0)
        .child(&View::new(app).height(1).shrink(0.0).bg(surface))
        .child(&body)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FILES: [&str; 5] = ["README.md", "src/b.ts", "src/lexer/token.ts", "docs/deep/one/a.md", "src/a.ts"];

    #[test]
    fn trees_sort_directories_first_and_collapse_chains() {
        let tree = build(FILES);
        let rows = flatten(&tree, None);
        let rows: Vec<(usize, &str, Option<usize>)> =
            rows.iter().map(|row| (row.depth, row.name.as_str(), row.file)).collect();
        assert_eq!(
            rows,
            [
                (0, "docs/deep/one", None),
                (1, "a.md", Some(3)),
                (0, "src", None),
                (1, "lexer", None),
                (2, "token.ts", Some(2)),
                (1, "a.ts", Some(4)),
                (1, "b.ts", Some(1)),
                (0, "README.md", Some(0)),
            ]
        );
        assert_eq!(ordered_files(&flatten(&tree, None)), [3, 2, 4, 1, 0]);
    }

    #[test]
    fn collapsed_directories_hide_their_files() {
        let tree = build(FILES);
        let src = flatten(&tree, None).iter().find(|row| row.name == "src").unwrap().id;
        let expanded = toggle(&tree, &all_expanded(&tree), src);
        let names: Vec<String> = flatten(&tree, Some(&expanded)).into_iter().map(|row| row.name).collect();
        assert_eq!(names, ["docs/deep/one", "a.md", "src", "README.md"]);
        assert!(toggle(&tree, &expanded, src).contains(&src));
        let token = parents_of(&tree, 2).unwrap();
        assert!(token.contains(&src) && token.len() == 2);
        // A file is not a directory to toggle.
        let file = flatten(&tree, None).iter().find(|row| row.file == Some(0)).unwrap().id;
        assert_eq!(toggle(&tree, &expanded, file), expanded);
    }

    #[test]
    fn file_moves_clamp_and_start_at_the_first() {
        let files = [3, 2, 4];
        assert_eq!(move_file(&files, None, 1), Some(3));
        assert_eq!(move_file(&files, Some(9), -1), Some(3));
        assert_eq!(move_file(&files, Some(3), 1), Some(2));
        assert_eq!(move_file(&files, Some(4), 1), Some(4));
        assert_eq!(move_file(&files, Some(3), -1), Some(3));
        assert_eq!(move_file(&[], Some(3), 1), None);
    }

    #[test]
    fn directory_chains_drop_leading_segments() {
        assert_eq!(truncate_directory_chain("a/b/c/d", 20), "a/b/c/d");
        assert_eq!(truncate_directory_chain("alpha/beta/gamma/delta", 14), "…/gamma/delta");
        assert_eq!(truncate_directory_chain("alpha/beta/gamma/delta", 8), "…/delta");
    }
}
