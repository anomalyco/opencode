//! The keyed reconcile of P1 (synthesis 3.4, 4.14): `reconcile-fresh`, `keep-full`, `no-effects` for a refused tree,
//! and `work` for a revision, for `Keep` and for a theme change.
//!
//! The model adopts a list of trees, theme switches and bad trees into one [`Tree`]. After each command it compares
//! the frame and the hit grid with a twin that mounts the last accepted tree fresh, with every keep written out: a
//! tree of ABI 1.x kinds through `node::add`, the host's mount path that shares no code with the reconcile, and one
//! with a scroll or a diff through a new [`Tree`], which only builds. The model holds the last accepted tree itself,
//! so it decides on its own which tree the contract refuses.

use crate::support::model::{self, Failure, Model, Rng};

use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

use opencode_plugin::abi::{self, v2};
use opencode_plugin::node::{self, Act};
use opencode_plugin::reconcile::{self, Env, Refused, Tree, Work};
use opencode_plugin::{Host, SlotMount};
use opencode_ui::dialog::DialogKeymap;
use opencode_ui::keymap::{Keybinds, Options};
use opencode_ui::theme::{Catalog, Theme, ThemeMode};
use opentui::prelude::*;
use opentui::testing::{Capture, TestApp};

const WIDTH: u16 = 40;
const HEIGHT: u16 = 14;

/// A host with a theme to switch; nothing else.
struct TestHost {
    app: TestApp,
    keymap: DialogKeymap,
    theme: RefCell<Theme>,
}

impl Host for TestHost {
    fn app(&self) -> &App {
        &self.app
    }

    fn theme(&self) -> Theme {
        self.theme.borrow().clone()
    }

    fn keymap(&self) -> &DialogKeymap {
        &self.keymap
    }
}

fn theme(index: usize) -> Theme {
    let (name, mode) =
        [("opencode", ThemeMode::Dark), ("opencode", ThemeMode::Light), ("tokyonight", ThemeMode::Dark)][index % 3];
    Catalog::default().load(name, mode).unwrap().theme
}

fn host(theme_index: usize) -> TestHost {
    TestHost {
        app: TestApp::new(WIDTH, HEIGHT),
        keymap: DialogKeymap::new(Keybinds::defaults(), Options::default()),
        theme: RefCell::new(theme(theme_index)),
    }
}

/// A root that fills the screen, as a slot's column does.
fn root(host: &TestHost) -> View {
    let root = View::new(&host.app).column().width(Length::percent(100.0)).height(Length::percent(100.0));
    host.app.root().add(&root);
    root
}

/// Adopts `nodes` into `tree` in `host`'s theme.
fn apply(host: &TestHost, tree: &mut Tree, parent: &View, nodes: &[v2::Node]) -> Result<(), Refused> {
    apply_acting(host, tree, parent, nodes, Rc::new(|_| {}))
}

/// [`apply`], with clicks running `act`.
fn apply_acting(host: &TestHost, tree: &mut Tree, parent: &View, nodes: &[v2::Node], act: Act) -> Result<(), Refused> {
    let theme = host.theme();
    let slot = |_: &View, _: &str| -> Option<SlotMount> { None };
    let source = |source: &v2::Source| match source {
        v2::Source::Text(text) => Some(Rc::from(text.as_str())),
        _ => None,
    };
    let env = Env { host, theme: &theme, act: &act, slot: &slot, source: &source, content: &|_| false, full: false };
    tree.apply(&env, parent, nodes)
}

/// The node as ABI 1.x has it, when it has only kinds of 1.x; ids are dropped.
fn lower(node: &v2::Node) -> Option<abi::Node> {
    Some(match node {
        v2::Node::Box {
            row,
            gap,
            padding,
            justify,
            align,
            bg,
            layout,
            on_click,
            children,
            border,
            padding_sides,
            wrap,
            overflow,
            ..
        } => abi::Node::Box {
            border: border.clone(),
            padding_sides: *padding_sides,
            wrap: *wrap,
            overflow: *overflow,
            row: *row,
            gap: *gap,
            padding: *padding,
            justify: *justify,
            align: *align,
            bg: bg.clone(),
            layout: *layout,
            on_click: on_click.clone(),
            children: children.iter().map(lower).collect::<Option<_>>()?,
        },
        v2::Node::Text { spans, fg, wrap, truncate, selectable, hover_fg, layout, on_click, .. } => abi::Node::Text {
            spans: spans.clone(),
            fg: fg.clone(),
            wrap: *wrap,
            truncate: *truncate,
            selectable: *selectable,
            hover_fg: hover_fg.clone(),
            layout: *layout,
            on_click: on_click.clone(),
        },
        v2::Node::Spinner { label, .. } => abi::Node::Spinner { label: label.clone() },
        v2::Node::Markdown { source: v2::Source::Text(text), .. } => abi::Node::Markdown { text: text.clone() },
        _ => return None,
    })
}

/// The frame of `nodes` mounted fresh in theme `theme_index`: through `node::add` when they lower to ABI 1.x.
fn fresh(nodes: &[v2::Node], theme_index: usize) -> (Capture, Vec<usize>) {
    let host = host(theme_index);
    let parent = root(&host);
    match nodes.iter().map(lower).collect::<Option<Vec<_>>>() {
        Some(lowered) => {
            let act: Act = Rc::new(|_| {});
            let mut hovers = Vec::new();
            let theme = host.theme();
            let markdown = |text: &str| host.markdown(text);
            for node in &lowered {
                node::add(&host.app, &theme, &parent, node, &act, &mut hovers, &markdown, &mut |_, _| {});
            }
            frame(&host)
        }
        None => {
            let mut tree = Tree::default();
            apply(&host, &mut tree, &parent, nodes).expect("a written-out tree is valid");
            frame(&host)
        }
    }
}

/// The frame, and the hit grid as a partition: each cell names the first cell that hits the same widget.
fn frame(host: &TestHost) -> (Capture, Vec<usize>) {
    let capture = host.app.render();
    let hits: Vec<Option<u32>> = (0..HEIGHT)
        .flat_map(|y| (0..WIDTH).map(move |x| (x, y)))
        .map(|(x, y)| host.app.widget_at(x, y).map(|widget| widget.id()))
        .collect();
    let mut first = std::collections::HashMap::new();
    let partition = hits.iter().enumerate().map(|(cell, hit)| *first.entry(*hit).or_insert(cell)).collect();
    (capture, partition)
}

#[derive(Clone, Debug)]
enum Command {
    /// A tree to adopt.
    Tree(Vec<v2::Node>),
    /// A theme switch; the host adopts the last tree again in it.
    Theme(usize),
}

/// Ids a generated tree uses, few so trees share them.
const IDS: [&str; 8] = ["a", "b", "c", "d", "e", "f", "g", "h"];
const TOKENS: [&str; 5] = ["text.muted", "text.base", "background.panel", "background.element", "primary"];

struct Generator<'a> {
    rng: &'a mut Rng,
    ids: Vec<&'static str>,
}

impl Generator<'_> {
    fn chance(&mut self, percent: usize) -> bool {
        self.rng.below(100) < percent
    }

    fn id(&mut self) -> Option<String> {
        if self.ids.is_empty() || !self.chance(50) {
            return None;
        }
        let index = self.rng.below(self.ids.len());
        Some(self.ids.swap_remove(index).to_owned())
    }

    fn color(&mut self) -> abi::Color {
        abi::Color::from(*self.rng.pick(&TOKENS))
    }

    fn spans(&mut self) -> Vec<abi::Span> {
        (0..1 + self.rng.below(2))
            .map(|_| {
                let mut span = abi::Span::new(format!("{} ", self.rng.pick(&["one", "two", "three", "four"])));
                if self.chance(40) {
                    span = span.fg(self.color());
                }
                span.bold = self.chance(20);
                span
            })
            .collect()
    }

    fn click(&mut self) -> Option<abi::Click> {
        self.chance(20).then(|| abi::Click::command(*self.rng.pick(&["x.one", "x.two"]), None))
    }

    fn node(&mut self, depth: usize) -> v2::Node {
        let kind = if depth >= 3 { 1 + self.rng.below(3) } else { self.rng.below(7) };
        match kind {
            0 | 4 => {
                let children = (0..self.rng.below(4)).map(|_| self.node(depth + 1)).collect();
                v2::Node::Box {
                    id: self.id(),
                    row: self.chance(40),
                    gap: self.rng.below(2) as u16,
                    padding: (self.rng.below(2) as u16, self.rng.below(2) as u16),
                    justify: *self.rng.pick(&[abi::Justify::Start, abi::Justify::End, abi::Justify::Center]),
                    align: *self.rng.pick(&[abi::Align::Stretch, abi::Align::Start, abi::Align::Center]),
                    bg: self.chance(40).then(|| self.color()),
                    layout: self.layout(),
                    on_click: self.click(),
                    children,
                    border: self.chance(25).then(|| std::boxed::Box::new(self.border())),
                    padding_sides: self.chance(20).then(|| self.edges()),
                    wrap: self.chance(15),
                    overflow: if self.chance(15) { abi::Overflow::Hidden } else { abi::Overflow::Visible },
                }
            }
            1 | 2 => v2::Node::Text {
                id: self.id(),
                spans: self.spans(),
                fg: self.chance(50).then(|| self.color()),
                wrap: *self.rng.pick(&[abi::Wrap::Word, abi::Wrap::Char, abi::Wrap::None]),
                truncate: self.chance(20),
                selectable: !self.chance(20),
                hover_fg: self.chance(20).then(|| self.color()),
                layout: self.layout(),
                on_click: self.click(),
            },
            3 => v2::Node::Spinner { id: self.id(), label: (*self.rng.pick(&["wait", "load"])).to_owned() },
            5 => v2::Node::Scroll {
                id: self.id(),
                height: (!self.chance(30)).then(|| 1 + self.rng.below(3) as u16),
                follow: self.chance(20),
                layout: self.layout(),
                children: (0..self.rng.below(4)).map(|_| self.node(depth + 1)).collect(),
            },
            _ => v2::Node::Markdown {
                id: self.id(),
                source: v2::Source::Text((*self.rng.pick(&["**bold** text", "- a\n- b", "plain"])).to_owned()),
            },
        }
    }

    fn border(&mut self) -> abi::Border {
        abi::Border {
            sides: abi::Sides {
                top: self.chance(70),
                right: self.chance(70),
                bottom: self.chance(70),
                left: self.chance(70),
            },
            style: *self.rng.pick(&[abi::BorderStyle::Single, abi::BorderStyle::Rounded, abi::BorderStyle::Double]),
            color: self.chance(60).then(|| self.color()),
            title: self.chance(30).then(|| "title".to_owned()),
            title_align: *self.rng.pick(&[abi::TitleAlign::Left, abi::TitleAlign::Center, abi::TitleAlign::Right]),
        }
    }

    fn edges(&mut self) -> abi::Edges {
        let mut side = || self.rng.below(4) as i16 - 1;
        abi::Edges { top: side(), right: side(), bottom: side(), left: side() }
    }

    fn layout(&mut self) -> abi::Layout {
        let mut layout = abi::Layout::default();
        if self.chance(10) {
            layout.height = Some(if self.chance(50) {
                abi::Width::Cells(1 + self.rng.below(4) as u16)
            } else {
                abi::Width::Percent(25.0 * (1 + self.rng.below(3)) as f32)
            });
        }
        if self.chance(5) {
            layout.min_height = Some(abi::Width::Cells(1 + self.rng.below(3) as u16));
        }
        if self.chance(5) {
            layout.max_height = Some(abi::Width::Cells(1 + self.rng.below(5) as u16));
        }
        if self.chance(10) {
            layout.margin = Some(self.edges());
        }
        if self.chance(15) {
            layout.grow = true;
        }
        if self.chance(15) {
            layout.width = Some(abi::Width::Cells(4 + self.rng.below(12) as u16));
        }
        if self.chance(10) {
            layout.shrink = Some(self.chance(50));
        }
        layout
    }

    /// `tree` changed in one place: a node replaced, removed, added, or two children swapped.
    fn mutate(&mut self, tree: &mut v2::Node) {
        let paths = paths(tree);
        let path = self.rng.pick(&paths).clone();
        let used: HashSet<String> = ids(tree).into_iter().collect();
        self.ids = IDS.iter().copied().filter(|id| !used.contains(*id)).collect();
        let op = self.rng.below(7);
        if op == 5 {
            // A subtree with an id moves to the front of another box, where a keep may name it.
            let moving: Vec<&Vec<usize>> =
                paths.iter().filter(|path| !path.is_empty() && at(tree, path).id().is_some()).collect();
            let targets: Vec<&Vec<usize>> =
                paths.iter().filter(|path| matches!(at(tree, path), v2::Node::Box { .. })).collect();
            if moving.is_empty() || targets.is_empty() {
                return;
            }
            let (from, to) = ((*self.rng.pick(&moving)).clone(), (*self.rng.pick(&targets)).clone());
            if to.starts_with(&from) {
                return;
            }
            let (index, parent) = from.split_last().unwrap();
            let (v2::Node::Box { children, .. } | v2::Node::Scroll { children, .. }) = at(tree, parent) else {
                return;
            };
            let subtree = children.remove(*index);
            // The removal shifts a target that comes after it under the same parent.
            let mut to = to;
            if to.len() > parent.len() && to[..parent.len()] == *parent && to[parent.len()] > *index {
                to[parent.len()] -= 1;
            }
            if let v2::Node::Box { children, .. } = at(tree, &to) {
                children.insert(0, subtree);
            }
            return;
        }
        let node = at(tree, &path);
        match op {
            0 => {
                // The same kind and id, with new properties.
                let id = node.id().map(str::to_owned);
                let mut fresh = self.node(path.len());
                for _ in 0..8 {
                    if std::mem::discriminant(&fresh) == std::mem::discriminant(node) {
                        break;
                    }
                    fresh = self.node(path.len());
                }
                let children = node.children().to_vec();
                if let v2::Node::Box { children: kept, .. } | v2::Node::Scroll { children: kept, .. } = &mut fresh
                    && self.chance(70)
                {
                    *kept = children;
                }
                *node = match id {
                    Some(id) if self.chance(80) => fresh.with_id(id),
                    _ => fresh,
                };
            }
            1 => {
                if let v2::Node::Box { children, .. } | v2::Node::Scroll { children, .. } = node {
                    let child = self.node(path.len() + 1);
                    let at = self.rng.below(children.len() + 1);
                    children.insert(at, child);
                }
            }
            2 => {
                if let v2::Node::Box { children, .. } | v2::Node::Scroll { children, .. } = node
                    && !children.is_empty()
                {
                    let at = self.rng.below(children.len());
                    children.remove(at);
                }
            }
            3 => {
                if let v2::Node::Box { children, .. } | v2::Node::Scroll { children, .. } = node
                    && children.len() > 1
                {
                    let (a, b) = (self.rng.below(children.len()), self.rng.below(children.len()));
                    children.swap(a, b);
                }
            }
            4 => {
                if let v2::Node::Text { spans, fg, .. } = node {
                    match self.chance(50) {
                        true => *spans = self.spans(),
                        false => *fg = self.chance(70).then(|| self.color()),
                    }
                } else if let v2::Node::Box { bg, .. } = node {
                    *bg = Some(self.color());
                }
            }
            _ => *node = self.node(path.len()),
        }
    }
}

/// The paths of every node of `tree`, by child index.
fn paths(tree: &v2::Node) -> Vec<Vec<usize>> {
    let mut out = vec![Vec::new()];
    for (index, child) in tree.children().iter().enumerate() {
        out.extend(paths(child).into_iter().map(|mut path| {
            path.insert(0, index);
            path
        }));
    }
    out
}

fn at<'a>(tree: &'a mut v2::Node, path: &[usize]) -> &'a mut v2::Node {
    match path.split_first() {
        None => tree,
        Some((first, rest)) => match tree {
            v2::Node::Box { children, .. } | v2::Node::Scroll { children, .. } => at(&mut children[*first], rest),
            _ => unreachable!("a path names children"),
        },
    }
}

fn ids(node: &v2::Node) -> Vec<String> {
    let mut out: Vec<String> = node.id().map(str::to_owned).into_iter().collect();
    node.children().iter().for_each(|child| out.extend(ids(child)));
    out
}

fn find<'a>(nodes: &'a [v2::Node], id: &str) -> Option<&'a v2::Node> {
    nodes.iter().find_map(|node| if node.id() == Some(id) { Some(node) } else { find(node.children(), id) })
}

/// `nodes` with each subtree equal to the one of its id in `last` written as a keep, by chance.
fn keep_some(rng: &mut Rng, nodes: &[v2::Node], last: &[v2::Node]) -> Vec<v2::Node> {
    nodes
        .iter()
        .map(|node| match node.id() {
            Some(id) if find(last, id) == Some(node) && rng.below(100) < 60 => v2::Node::Keep { key: id.to_owned() },
            _ => match node {
                v2::Node::Box { children, .. } | v2::Node::Scroll { children, .. } => {
                    let mut node = node.clone();
                    let kept = keep_some(rng, children, last);
                    if let v2::Node::Box { children, .. } | v2::Node::Scroll { children, .. } = &mut node {
                        *children = kept;
                    }
                    node
                }
                _ => node.clone(),
            },
        })
        .collect()
}

/// `nodes` with every keep written out from `last`; `None` when a keep names nothing there.
fn expand(nodes: &[v2::Node], last: &[v2::Node]) -> Option<Vec<v2::Node>> {
    nodes
        .iter()
        .map(|node| match node {
            v2::Node::Keep { key } => find(last, key).cloned(),
            v2::Node::Box { children, .. } | v2::Node::Scroll { children, .. } => {
                let mut node = node.clone();
                let expanded = expand(children, last)?;
                if let v2::Node::Box { children, .. } | v2::Node::Scroll { children, .. } = &mut node {
                    *children = expanded;
                }
                Some(node)
            }
            _ => Some(node.clone()),
        })
        .collect()
}

/// Whether the contract takes `nodes` after `last`: no id twice once the keeps are written out, and every keep names
/// a subtree of `last`. The model's own rule, apart from the host's.
fn valid(nodes: &[v2::Node], last: &[v2::Node]) -> bool {
    let Some(expanded) = expand(nodes, last) else { return false };
    let all: Vec<String> = expanded.iter().flat_map(ids).collect();
    let keeps = count_keeps(nodes);
    all.len() == all.iter().collect::<HashSet<_>>().len() && keeps.len() == keeps.iter().collect::<HashSet<_>>().len()
}

fn count_keeps(nodes: &[v2::Node]) -> Vec<String> {
    nodes
        .iter()
        .flat_map(|node| match node {
            v2::Node::Keep { key } => vec![key.clone()],
            _ => count_keeps(node.children()),
        })
        .collect()
}

struct Reconcile;

impl Model for Reconcile {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        let mut tree = Generator { rng: &mut *rng, ids: IDS.to_vec() }.node(0);
        let mut last: Vec<v2::Node> = Vec::new();
        let mut commands = Vec::with_capacity(steps);
        for _ in 0..steps {
            let roll = rng.below(100);
            let command = if roll < 10 {
                Command::Theme(rng.below(3))
            } else if roll < 18 {
                // A bad tree: a keep of an id nothing holds, or an id twice.
                let mut bad = tree.clone();
                if let v2::Node::Box { children, .. } | v2::Node::Scroll { children, .. } = &mut bad {
                    children.push(v2::Node::Keep { key: "zz".into() });
                } else {
                    bad = v2::Node::column(vec![bad.clone().with_id("a"), v2::Node::text(vec![]).with_id("a")]);
                }
                Command::Tree(vec![bad])
            } else {
                if roll < 25 {
                    tree = Generator { rng: &mut *rng, ids: IDS.to_vec() }.node(0);
                } else if roll < 90 {
                    Generator { rng: &mut *rng, ids: Vec::new() }.mutate(&mut tree);
                }
                let nodes = keep_some(rng, std::slice::from_ref(&tree), &last);
                last = vec![tree.clone()];
                Command::Tree(nodes)
            };
            commands.push(command);
        }
        commands
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        let mut theme_index = 0;
        let host = host(theme_index);
        let parent = root(&host);
        let mut tree = Tree::default();
        // The last accepted tree, keeps written out, and as it came, which a theme switch adopts again as a surface
        // does.
        let mut last: Vec<v2::Node> = Vec::new();
        let mut adopted: Vec<v2::Node> = Vec::new();
        for (step, command) in commands.iter().enumerate() {
            let fail = |property, detail: String| Some(Failure { property, site: property, step, detail });
            let before = host.app.render();
            match command {
                Command::Theme(index) => {
                    theme_index = *index;
                    *host.theme.borrow_mut() = theme(theme_index);
                    if !last.is_empty() {
                        let work = reconcile::work();
                        if let Err(refused) = apply(&host, &mut tree, &parent, &adopted) {
                            return fail("reconcile-fresh", format!("the last tree again was refused: {refused}"));
                        }
                        let done = reconcile::work().since(work);
                        // The host's Markdown takes its theme as it is built, the one widget a theme rebuilds.
                        let markdown = last.iter().map(markdowns).sum::<u64>();
                        if done.created > markdown || done.removed > markdown || done.parses > 0 {
                            return fail("work", format!("a theme change rebuilt widgets: {done:?}"));
                        }
                    }
                }
                Command::Tree(nodes) => {
                    let expected = valid(nodes, &last);
                    match (apply(&host, &mut tree, &parent, nodes), expected) {
                        (Ok(()), true) => {
                            last = expand(nodes, &last).unwrap();
                            adopted = nodes.clone();
                        }
                        (Err(_), false) => {
                            // no-effects: a refused tree leaves the frame as it was.
                            if host.app.render() != before {
                                return fail("no-effects", "a refused tree changed the frame".into());
                            }
                            continue;
                        }
                        (got, _) => {
                            return fail("keep-full", format!("the model expected valid={expected}, got {got:?}"));
                        }
                    }
                }
            }
            if last.is_empty() {
                continue;
            }
            let (capture, hits) = frame(&host);
            let (want, want_hits) = fresh(&last, theme_index);
            if capture != want {
                let cell = capture.cells.iter().zip(&want.cells).position(|(got, want)| got != want);
                let cells = cell.map(|cell| {
                    (cell % usize::from(WIDTH), cell / usize::from(WIDTH), &capture.cells[cell], &want.cells[cell])
                });
                return fail(
                    "reconcile-fresh",
                    format!(
                        "frame differs from a fresh mount, first at {cells:?}\ngot:\n{}\nfresh:\n{}\nJSON {}",
                        capture.text(),
                        want.text(),
                        serde_json::to_string(
                            &commands[..=step]
                                .iter()
                                .filter_map(|command| match command {
                                    Command::Tree(nodes) => Some(nodes),
                                    Command::Theme(_) => None,
                                })
                                .collect::<Vec<_>>()
                        )
                        .unwrap()
                    ),
                );
            }
            if hits != want_hits {
                return fail("reconcile-fresh", "the hit grid differs from a fresh mount".into());
            }
        }
        None
    }

    fn simplify(&self, command: &Command) -> Vec<Command> {
        match command {
            Command::Theme(index) if *index > 0 => vec![Command::Theme(0)],
            _ => Vec::new(),
        }
    }
}

fn markdowns(node: &v2::Node) -> u64 {
    u64::from(matches!(node, v2::Node::Markdown { .. })) + node.children().iter().map(markdowns).sum::<u64>()
}

// Expected: any sequence of trees, keeps, refused trees and theme switches leaves the frame and the hit grid a fresh
// mount of the last accepted tree has; a refused tree changes nothing; a theme change builds no widget.
#[test]
fn reconciled_trees_equal_fresh_mounts() {
    model::check(&Reconcile, 24, 48);
}

// Expected: the oracles see a difference: a twin of another tree differs, and a keep that the model writes out from
// the wrong tree is refused by the model's own rule.
#[test]
fn the_oracles_can_fail() {
    let a = vec![v2::Node::text(vec![abi::Span::new("one")]).with_id("a")];
    let b = vec![v2::Node::text(vec![abi::Span::new("two")]).with_id("a")];
    assert_ne!(fresh(&a, 0).0, fresh(&b, 0).0);
    assert_ne!(fresh(&a, 0).0, fresh(&a, 1).0, "the themes paint differently");
    assert!(!valid(&[v2::Node::Keep { key: "b".into() }], &a));
    assert!(valid(&[v2::Node::Keep { key: "a".into() }], &a));
}

/// A card list in the shape of the diff viewer's: a column of `files` cards, each a header row and a body text.
fn cards(files: usize, reviewed: &[usize], keep: bool) -> Vec<v2::Node> {
    let cards = (0..files)
        .map(|file| {
            let key = format!("card-{file}");
            if keep && !reviewed.contains(&file) {
                return v2::Node::Keep { key };
            }
            let done = reviewed.contains(&file);
            v2::Node::column(vec![
                v2::Node::row(vec![
                    v2::Node::text(vec![abi::Span::new(format!("src/f{file:03}.rs"))]),
                    v2::Node::text(vec![abi::Span::new(if done { "reviewed" } else { "+3 -2" })]).fg("text.muted"),
                ])
                .bg(if done { "background.element" } else { "background.panel" }),
                v2::Node::text(vec![abi::Span::new(format!("fn f{file}() {{ body }}"))]),
            ])
            .with_id(key)
        })
        .collect();
    vec![v2::Node::column(cards).with_id("cards")]
}

/// The work of marking file 1 reviewed, at `files` cards, after a tree where none is; with keeps or without.
fn mark_reviewed(files: usize, keep: bool) -> Work {
    let host = host(0);
    let parent = root(&host);
    let mut tree = Tree::default();
    apply(&host, &mut tree, &parent, &cards(files, &[], false)).unwrap();
    let before = reconcile::work();
    apply(&host, &mut tree, &parent, &cards(files, &[1], keep)).unwrap();
    reconcile::work().since(before)
}

// Expected (`work`, a revision): marking one card reviewed writes that card's widgets and nothing else, the same at 40
// and at 410 cards, with or without keeps; with keeps, the other cards are adopted whole and nothing is compared.
#[test]
fn a_revision_touches_what_changed_at_any_size() {
    for keep in [false, true] {
        let small = mark_reviewed(40, keep);
        let large = mark_reviewed(410, keep);
        assert_eq!(small, Work { kept: if keep { 39 } else { 0 }, ..small }, "{small:?}");
        assert_eq!((small.created, small.removed, small.set, small.moved), (0, 0, 2, 0), "{small:?}");
        assert_eq!(
            (large.created, large.removed, large.set, large.moved),
            (small.created, small.removed, small.set, small.moved)
        );
        assert_eq!(large.kept, if keep { 409 } else { 0 });
    }
}

// Expected (`work`, `Keep`): a subtree under a keep costs nothing inside it. A card added after the kept ones builds
// that card and moves nothing; one added before them moves each kept card once, since OpenTUI paints siblings in the
// order they were attached and the kept ones must paint after it.
#[test]
fn a_kept_subtree_is_not_touched() {
    for (at, moved) in [(20, 0), (0, 20)] {
        let host = host(0);
        let parent = root(&host);
        let mut tree = Tree::default();
        apply(&host, &mut tree, &parent, &cards(20, &[], false)).unwrap();
        let before = reconcile::work();
        let mut shifted = cards(20, &[], true);
        if let v2::Node::Box { children, .. } = &mut shifted[0] {
            children.insert(at, v2::Node::text(vec![abi::Span::new("new")]));
        }
        apply(&host, &mut tree, &parent, &shifted).unwrap();
        let done = reconcile::work().since(before);
        assert_eq!(done, Work { created: 1, kept: 20, moved, ..Work::default() }, "{done:?}");
        assert_eq!(host.app.render(), fresh(&expand(&shifted, &cards(20, &[], false)).unwrap(), 0).0);
    }
}

// Expected (`work`, a theme change): a theme switch adopts the same tree with no widget built or removed and no patch
// parsed; the colors it names by token change in place, and the frame equals a fresh mount in the new theme.
#[test]
fn a_theme_change_rebuilds_nothing() {
    let host = host(0);
    let parent = root(&host);
    let mut tree = Tree::default();
    let mut nodes = cards(6, &[2], false);
    if let v2::Node::Box { children, .. } = &mut nodes[0] {
        children.push(v2::Node::Diff {
            id: Some("diff".into()),
            content: v2::Source::Text("@@ -1,2 +1,2 @@\n-a\n+b\n c\n".into()),
            view: v2::DiffView::Unified,
            filetype: Some("rust".into()),
        });
        children.push(v2::Node::Spinner { id: None, label: "wait".into() });
    }
    apply(&host, &mut tree, &parent, &nodes).unwrap();
    let dark = host.app.render();
    *host.theme.borrow_mut() = theme(1);
    let before = reconcile::work();
    apply(&host, &mut tree, &parent, &nodes).unwrap();
    let done = reconcile::work().since(before);
    assert_eq!((done.created, done.removed, done.parses, done.moved), (0, 0, 0, 0), "{done:?}");
    assert!(done.set > 0, "{done:?}");
    let light = host.app.render();
    assert_ne!(light, dark);
    assert_eq!(light, fresh(&nodes, 1).0);
}

// Expected (`no-effects`, a refused tree): a tree with an id twice, or a keep of an id the host does not hold, is
// refused whole: no widget is built, written or removed, and the frame stays.
#[test]
fn a_refused_tree_changes_nothing() {
    let host = host(0);
    let parent = root(&host);
    let mut tree = Tree::default();
    let nodes = cards(4, &[], false);
    apply(&host, &mut tree, &parent, &nodes).unwrap();
    let frame = host.app.render();
    let before = reconcile::work();
    let mut twice = cards(4, &[1], false);
    if let v2::Node::Box { children, .. } = &mut twice[0] {
        children.push(v2::Node::text(vec![]).with_id("card-0"));
    }
    assert_eq!(apply(&host, &mut tree, &parent, &twice), Err(Refused::Duplicate("card-0".into())));
    let unknown = vec![v2::Node::column(vec![v2::Node::Keep { key: "card-9".into() }])];
    assert_eq!(apply(&host, &mut tree, &parent, &unknown), Err(Refused::Unknown("card-9".into())));
    // A keep of a card and a node with an id inside that card.
    let inside =
        vec![v2::Node::column(vec![v2::Node::Keep { key: "cards".into() }, v2::Node::text(vec![]).with_id("card-1")])];
    assert_eq!(apply(&host, &mut tree, &parent, &inside), Err(Refused::Duplicate("card-1".into())));
    // A keep of a card inside a kept list.
    let nested =
        vec![v2::Node::column(vec![v2::Node::Keep { key: "cards".into() }, v2::Node::Keep { key: "card-1".into() }])];
    assert_eq!(apply(&host, &mut tree, &parent, &nested), Err(Refused::Duplicate("card-1".into())));
    assert_eq!(reconcile::work().since(before), Work::default());
    assert_eq!(host.app.render(), frame);
    // The guard: the same change without the fault differs.
    apply(&host, &mut tree, &parent, &cards(4, &[1], false)).unwrap();
    assert_ne!(host.app.render(), frame);
}

/// A column of a title and a scroll that grows, of `rows` rows; row `changed` says so.
fn scrolling(id: &str, rows: usize, changed: Option<usize>) -> Vec<v2::Node> {
    let lines = (0..rows)
        .map(|row| {
            let text = if changed == Some(row) { format!("row {row} changed") } else { format!("row {row}") };
            v2::Node::text(vec![abi::Span::new(text)])
        })
        .collect();
    let scroll = v2::Node::scroll(lines).with_id(id).layout(abi::Layout::default().grow());
    vec![
        v2::Node::column(vec![v2::Node::text(vec![abi::Span::new("title")]), scroll])
            .layout(abi::Layout::default().grow()),
    ]
}

// Expected: a scroll that grows takes the room its parent leaves, not its content's height, and the host scrolls
// it: the wheel moves it, a revision of its rows keeps its offset, and a scroll under a new id starts at the top.
#[test]
fn the_host_scrolls_a_scroll_and_keeps_its_offset_by_id() {
    let host = host(0);
    let parent = root(&host);
    let mut tree = Tree::default();
    apply(&host, &mut tree, &parent, &scrolling("list", 40, None)).unwrap();
    let screen = host.app.render().text();
    let rows: Vec<&str> = screen.lines().filter(|line| line.starts_with("row ")).collect();
    assert_eq!(rows.len(), usize::from(HEIGHT) - 1, "{screen}");
    for _ in 0..3 {
        host.app.scroll(2, 5, true);
    }
    let top = |host: &TestHost| host.app.render().text().lines().nth(1).unwrap().trim_end().to_owned();
    let scrolled = top(&host);
    assert_ne!(scrolled, "row 0", "the wheel moves the scroll");
    apply(&host, &mut tree, &parent, &scrolling("list", 40, Some(30))).unwrap();
    assert_eq!(top(&host), scrolled, "a revision keeps the offset");
    apply(&host, &mut tree, &parent, &scrolling("other", 40, Some(30))).unwrap();
    assert_eq!(top(&host), "row 0", "a new id starts at the top");
}

// Expected: a click that changes to another click runs the new one, on a box and on a text, with their widgets kept.
#[test]
fn a_changed_click_runs_the_new_action() {
    let host = host(0);
    let parent = root(&host);
    let mut tree = Tree::default();
    let ran: Rc<RefCell<Vec<String>>> = Rc::default();
    let act: Act = {
        let ran = ran.clone();
        Rc::new(move |action| {
            let abi::Action::Command { name, .. } = action;
            ran.borrow_mut().push(name.clone());
        })
    };
    let nodes = |name: &str| {
        let click = abi::Click::command(name, None);
        vec![v2::Node::column(vec![
            v2::Node::row(vec![v2::Node::text(vec![abi::Span::new("box")])]).on_click(click.clone()),
            v2::Node::text(vec![abi::Span::new("text")]).on_click(click),
        ])]
    };
    for name in ["x.first", "x.second"] {
        apply_acting(&host, &mut tree, &parent, &nodes(name), act.clone()).unwrap();
        host.app.render();
        host.app.click(1, 0);
        host.app.click(1, 1);
        host.app.advance(std::time::Duration::from_millis(1));
    }
    assert_eq!(*ran.borrow(), ["x.first", "x.first", "x.second", "x.second"]);
}

// Expected: a scroll with no height that does not grow is no taller than its parent, so the wheel scrolls it.
#[test]
fn a_scroll_without_a_height_fits_its_parent() {
    let host = host(0);
    let parent = root(&host);
    let mut tree = Tree::default();
    let lines = (0..40).map(|row| v2::Node::text(vec![abi::Span::new(format!("row {row}"))])).collect();
    apply(&host, &mut tree, &parent, &[v2::Node::scroll(lines)]).unwrap();
    assert!(host.app.render().text().starts_with("row 0"));
    host.app.scroll(2, 5, true);
    assert!(!host.app.render().text().starts_with("row 0"), "the wheel moved nothing");
}

// Expected: a text under the pointer that is written in place keeps its pointer color, as a kept element stays
// hovered.
#[test]
fn a_hovered_text_written_in_place_stays_hovered() {
    let host = host(0);
    let parent = root(&host);
    let mut tree = Tree::default();
    let text = |words: &str| vec![v2::Node::text(vec![abi::Span::new(words)]).fg("text.muted")];
    let hovered = |words: &str| {
        let mut nodes = text(words);
        if let v2::Node::Text { hover_fg, .. } = &mut nodes[0] {
            *hover_fg = Some("text.base".into());
        }
        nodes
    };
    apply(&host, &mut tree, &parent, &hovered("first")).unwrap();
    host.app.render();
    host.app.hover(1, 0);
    let over = host.app.render().cells[1].fg;
    apply(&host, &mut tree, &parent, &hovered("second")).unwrap();
    assert_eq!(host.app.render().cells[1].fg, over);
    assert_ne!(over, host.theme().text.muted, "the pointer changed nothing");
}

// Expected (`no-effects`): a tree that shows content the mount does not hold is refused, and changes nothing.
#[test]
fn a_tree_with_unknown_content_is_refused() {
    let host = host(0);
    let parent = root(&host);
    let mut tree = Tree::default();
    apply(&host, &mut tree, &parent, &cards(2, &[], false)).unwrap();
    let frame = host.app.render();
    let diff = v2::Node::Diff {
        id: None,
        content: v2::Source::Content(v2::ContentRef(7)),
        view: v2::DiffView::Unified,
        filetype: None,
    };
    assert_eq!(
        apply(&host, &mut tree, &parent, &[v2::Node::column(vec![diff])]),
        Err(Refused::Content(v2::ContentRef(7)))
    );
    assert_eq!(host.app.render(), frame);
}

/// `levels` scrolls, each inside the last.
fn nested_scrolls(levels: usize) -> v2::Node {
    (0..levels).fold(v2::Node::text(vec![abi::Span::new("deep")]), |inner, level| v2::Node::Scroll {
        id: Some(format!("s{level}")),
        height: Some(3),
        follow: false,
        layout: abi::Layout::default(),
        children: vec![inner],
    })
}

// Expected (`no-effects`, a tree the layout cannot take): a tree that nests past the bound, in one revision or by
// keeps that each wrap the last, or a size in percent that is not finite, is refused; nothing changes and the TUI
// keeps painting. Without the bound OpenTUI refuses the node and the app ends.
#[test]
fn a_tree_the_layout_cannot_take_is_refused() {
    let host = host(0);
    let parent = root(&host);
    let mut tree = Tree::default();
    apply(&host, &mut tree, &parent, &[nested_scrolls(4)]).unwrap();
    let frame = host.app.render();
    assert_eq!(apply(&host, &mut tree, &parent, &[nested_scrolls(64)]), Err(Refused::Deep));
    assert_eq!(host.app.render(), frame);
    for percent in [f32::INFINITY, f32::NAN, -5.0] {
        let wide = v2::Node::text(vec![abi::Span::new("x")])
            .layout(abi::Layout { width: Some(abi::Width::Percent(percent)), ..abi::Layout::default() });
        assert_eq!(apply(&host, &mut tree, &parent, &[v2::Node::column(vec![wide])]), Err(Refused::Number));
        assert_eq!(host.app.render(), frame);
    }
    // Two nodes a revision, each a box around a keep of the last: the tree grows one level each time.
    let mut tree = Tree::default();
    apply(&host, &mut tree, &parent, &[v2::Node::column(vec![]).with_id("r0")]).unwrap();
    let mut refused = None;
    for level in 1..200 {
        let wrap =
            v2::Node::column(vec![v2::Node::Keep { key: format!("r{}", level - 1) }]).with_id(format!("r{level}"));
        if let Err(error) = apply(&host, &mut tree, &parent, &[wrap]) {
            refused = Some((level, error));
            break;
        }
        host.app.render();
    }
    assert_eq!(refused, Some((usize::from(reconcile::MAX_DEPTH), Refused::Deep)));
    host.app.render();
}
