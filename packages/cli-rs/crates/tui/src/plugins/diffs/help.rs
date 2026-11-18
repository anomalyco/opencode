//! TypeScript: `feature-plugins/system/diff-viewer.tsx`.

use opencode_plugin::abi::{Dialog, Host, Layout, Node, Panel, PanelSize, Read, Span, Width};

use super::viewer::Viewer;

const SHORTCUT_WIDTH: u16 = 17;
pub const KEY: &str = "help";

/// `diff.help` and a click on the help shortcut (`openHelpDialog`).
pub fn open(host: &dyn Host, viewer: &Viewer) {
    let groups = groups(host, viewer.single, viewer.in_panel(), !viewer.compact());
    let body: Vec<Node> = groups
        .iter()
        .map(|(title, rows)| {
            let rows = rows.iter().map(|(shortcut, label)| {
                Node::row(vec![
                    Node::text([Span::new(shortcut.clone())])
                        .fg("text.base")
                        .layout(Layout::default().width(Width::Cells(SHORTCUT_WIDTH)).shrink(false)),
                    Node::text([Span::new(*label)]).fg("text.muted").layout(Layout::default().grow().min_width(0)),
                ])
                .gap(2)
            });
            let title = Node::text([Span::new(*title).bold()]).fg("text.base");
            Node::column(std::iter::once(title).chain(rows).collect()).layout(Layout::default().shrink(false))
        })
        .collect();
    let rows: usize = groups.iter().map(|(_, rows)| rows.len() + 2).sum();
    let height = (rows as i64 - 1).min(i64::from(host.info().size.1) - 6).max(1);
    host.dialog(Dialog::Panel(
        Panel::new(KEY.to_owned(), vec![Span::new("Diff shortcuts")], Node::column(body).gap(1))
            .size(PanelSize::Medium)
            .centered()
            .close("esc close")
            .height(height as u16),
    ));
}

type Group = (&'static str, Vec<(String, &'static str)>);

fn groups(read: &dyn Read, single: bool, fullscreen: bool, tree: bool) -> Vec<Group> {
    // The first shortcut of each command.
    let first = |ids: &[&str]| ids.iter().filter_map(|id| read.shortcut(id)).collect::<Vec<_>>().join(" / ");
    let all = |id: &str| read.shortcuts(id).join(" / ");
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
