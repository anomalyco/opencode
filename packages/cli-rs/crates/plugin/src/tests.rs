use std::cell::Cell;
use std::rc::Rc;

use opencode_ui::keymap::{GLOBAL_MODE, Keybinds, KeymapLayer, Options, TuiCommand};
use opencode_ui::theme::{Catalog, ThemeMode};
use opentui::keymap::RunResult;
use opentui::testing::TestApp;

use super::slot::{self, Kind, Placed, Placement, Resolution};
use super::*;

struct TestHost {
    app: TestApp,
    keymap: DialogKeymap,
    /// The registry nested slots mount from.
    registry: std::cell::RefCell<std::rc::Weak<Registry<TestHost>>>,
}

impl Host for TestHost {
    type Changes = ();

    fn app(&self) -> &App {
        &self.app
    }

    fn theme(&self) -> Theme {
        Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme
    }

    fn keymap(&self) -> &DialogKeymap {
        &self.keymap
    }

    fn slot(&self, parent: &View, path: &str, input: &SlotInput) -> Option<SlotMount<Self>> {
        Some(self.registry.borrow().upgrade()?.mount(self, parent, path, input, |_| {}))
    }
}

fn host() -> Rc<TestHost> {
    Rc::new(TestHost {
        app: TestApp::new(40, 6),
        keymap: DialogKeymap::new(Keybinds::defaults(), Options::default()),
        registry: Default::default(),
    })
}

/// A plugin that claims `placements`, each rendering a text of the plugin ID and its index.
fn claiming(id: &str, placements: Vec<Placement>) -> Definition<TestHost> {
    let id = id.to_owned();
    Definition::new(id.clone(), move |cx: &mut Setup<'_, TestHost>| {
        for (index, placement) in placements.iter().enumerate() {
            let label = format!("{id}{index}");
            cx.slot(placement.clone(), move |host, _| {
                Box::new(View::new(host.app()).child(&Text::new(host.app(), label.clone())))
            });
        }
    })
}

fn placed(build: impl FnOnce(&mut Placed)) -> Placed {
    let mut placed = Placed::default();
    build(&mut placed);
    placed
}

#[test]
fn resolve_places_additive_claims_by_kind_in_enable_order() {
    let claims = [
        Placement::append("home.footer"),
        Placement::before("home.footer"),
        Placement::prepend("home.footer"),
        Placement::after("home.footer"),
        Placement::append("home.footer"),
    ];
    let resolution = slot::resolve(&slot::PATHS, &claims);
    assert_eq!(
        resolution.placed["home.footer"],
        placed(|placed| {
            placed.before = vec![1];
            placed.prepend = vec![2];
            placed.append = vec![0, 4];
            placed.after = vec![3];
        })
    );
    assert!(resolution.suppressed.is_empty() && resolution.degraded.is_empty());
}

#[test]
fn resolve_last_replacement_wins_and_ancestor_beats_descendant() {
    let claims = [
        Placement::replace("prompt.footer"),
        Placement::replace("prompt.footer.status"),
        Placement::replace("prompt.footer"),
    ];
    let resolution = slot::resolve(&slot::PATHS, &claims);
    assert_eq!(resolution.placed["prompt.footer"].replace, Some(2));
    assert!(!resolution.placed.contains_key("prompt.footer.status"));
    assert_eq!(resolution.suppressed, vec![(0, Some(2)), (1, Some(2))]);
}

#[test]
fn resolve_suppresses_claims_inside_a_replaced_boundary_but_keeps_its_siblings() {
    let claims = [
        Placement::append("prompt.footer.status"),
        Placement::append("prompt.footer"),
        Placement::before("prompt.footer"),
        Placement::replace("prompt.footer"),
    ];
    let resolution = slot::resolve(&slot::PATHS, &claims);
    assert_eq!(
        resolution.placed["prompt.footer"],
        placed(|placed| {
            placed.before = vec![2];
            placed.replace = Some(3);
        })
    );
    assert_eq!(resolution.suppressed, vec![(0, Some(3)), (1, Some(3))]);
}

#[test]
fn resolve_degrades_missing_targets_to_the_nearest_ancestor() {
    let claims = [
        Placement::prepend("home.footer.version.left"),
        Placement::replace("home.footer.gone"),
        Placement::after("nowhere.at.all"),
    ];
    let resolution = slot::resolve(&slot::PATHS, &claims);
    assert_eq!(
        resolution,
        Resolution {
            placed: [("home.footer".to_owned(), placed(|placed| placed.append = vec![0]))].into(),
            suppressed: vec![(1, None), (2, None)],
            degraded: vec![(0, "home.footer".to_owned())],
        }
    );
}

#[test]
fn contains_needs_a_dot_boundary() {
    assert!(slot::contains("prompt.footer", "prompt.footer.file"));
    assert!(!slot::contains("prompt.footer", "prompt.footer"));
    assert!(!slot::contains("prompt.foot", "prompt.footer"));
}

#[test]
fn selectors_match_as_in_ts() {
    let cases = [
        ("*", "opencode.stats", true),
        ("opencode.stats", "opencode.stats", true),
        ("opencode.sidebar.*", "opencode.sidebar.todo", true),
        ("opencode.sidebar.*", "opencode.stats", false),
        ("opencode.side*", "opencode.sidebar.todo", false),
        ("opencode.stat", "opencode.stats", false),
    ];
    for (selector, id, expected) in cases {
        assert_eq!(matches(selector, id), expected, "{selector} {id}");
    }
}

#[test]
fn config_disables_builtins_and_skips_typescript_plugins() {
    let builtins = ["opencode.home.footer", "opencode.sidebar.todo", "opencode.sidebar.mcp", "opencode.stats"]
        .map(|id| Definition::<TestHost>::new(id, |_| {}))
        .to_vec();
    let registry = Registry::new(
        builtins,
        [
            "-opencode.sidebar.*",
            "opencode.sidebar.mcp",
            "-opencode.stats",
            "opencode.unknown",
            "*",
            "@acme/opencode-tui",
            "./plugins/local",
            "@acme/opencode-tui",
            "-*",
            "opencode.home.footer",
        ],
    );
    let host = host();
    registry.activate(&host);
    let status = |id: &str| {
        registry.entries().into_iter().find(|entry| entry.id == id).map(|entry| (entry.source, entry.status)).unwrap()
    };
    assert_eq!(status("opencode.home.footer"), (Source::Builtin, Status::Active));
    assert_eq!(status("opencode.sidebar.mcp"), (Source::Builtin, Status::Inactive));
    assert_eq!(status("opencode.stats"), (Source::Builtin, Status::Inactive));
    assert_eq!(registry.skipped(), ["@acme/opencode-tui", "./plugins/local"]);
    assert_eq!(status("./plugins/local"), (Source::Configured, Status::Skipped(SKIPPED.to_owned())));
}

#[test]
fn mount_orders_claims_around_the_content() {
    let host = host();
    let registry = Registry::new(
        vec![
            claiming("a", vec![Placement::append("home.footer"), Placement::before("home.footer")]),
            claiming("b", vec![Placement::prepend("home.footer"), Placement::after("home.footer")]),
        ],
        [],
    );
    registry.activate(&host);
    let parent = View::new(host.app()).column();
    let mount = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |parent| {
        parent.add(&Text::new(host.app(), "content"));
    });
    host.app().root().add(&parent);
    let lines: Vec<String> = host.app.render().text().lines().map(|line| line.trim_end().to_owned()).collect();
    assert_eq!(lines, ["a1", "b0", "content", "a0", "b1"]);
    assert!(!mount.is_empty());
}

#[test]
fn a_replacement_drops_the_content_and_inside_claims() {
    let host = host();
    let registry = Registry::new(
        vec![
            claiming("a", vec![Placement::append("home.footer")]),
            claiming("b", vec![Placement::replace("home.footer")]),
        ],
        [],
    );
    registry.activate(&host);
    let parent = View::new(host.app()).column();
    registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |parent| {
        parent.add(&Text::new(host.app(), "content"));
    });
    host.app().root().add(&parent);
    assert_eq!(host.app.render().text().lines().next().unwrap().trim_end(), "b0");
}

#[test]
fn deactivation_undoes_every_registration() {
    let host = host();
    let disposed = Rc::new(Cell::new(0));
    let ran = Rc::new(Cell::new(0));
    let plugin = {
        let disposed = disposed.clone();
        let ran = ran.clone();
        Definition::new("test.plugin", move |cx: &mut Setup<'_, TestHost>| {
            assert_eq!(cx.storage_key("state"), "plugin.test.plugin.state");
            let ran = ran.clone();
            cx.layer(KeymapLayer {
                mode: Some(GLOBAL_MODE.to_owned()),
                commands: vec![TuiCommand::new("test.run", move |_, _| ran.set(ran.get() + 1))],
                ..KeymapLayer::default()
            });
            cx.slot(Placement::append(slot::SIDEBAR_CONTENT), |host, _| Box::new(View::new(host.app())));
            cx.route("page", |host| Box::new(View::new(host.app())));
            cx.code_block("math", |_, _| None);
            let disposed = disposed.clone();
            cx.on_dispose(move || disposed.set(disposed.get() + 1));
        })
    };
    let registry = Registry::new(vec![], []);
    registry.add(plugin);
    registry.activate(&host);
    assert!(matches!(host.keymap.dispatch("test.run", None), RunResult::Ok));
    assert_eq!(ran.get(), 1);
    assert!(registry.route(&*host, "test.plugin", "page").is_some());
    assert!(registry.route(&*host, "test.plugin", "other").is_none());
    let mounted = |registry: &Registry<TestHost>| {
        let parent = View::new(host.app());
        !registry.mount(&*host, &parent, slot::SIDEBAR_CONTENT, &SlotInput::default(), |_| {}).is_empty()
    };
    assert!(mounted(&registry));

    assert!(registry.set_active(&host, "test.plugin", false));
    assert_eq!(disposed.get(), 1);
    assert!(!matches!(host.keymap.dispatch("test.run", None), RunResult::Ok));
    assert!(registry.route(&*host, "test.plugin", "page").is_none());
    assert!(!mounted(&registry));
    assert_eq!(registry.entries()[0].status, Status::Inactive);

    // Reactivation runs setup again.
    assert!(registry.set_active(&host, "test.plugin", true));
    assert!(matches!(host.keymap.dispatch("test.run", None), RunResult::Ok));
    assert_eq!(ran.get(), 2);
    assert!(!registry.set_active(&host, "missing", true));
}

#[test]
fn code_blocks_follow_activation_order() {
    let host = host();
    let languages = Rc::new(std::cell::RefCell::new(Vec::new()));
    let renderer = |id: &'static str| {
        let languages = languages.clone();
        Definition::new(id, move |cx: &mut Setup<'_, TestHost>| {
            let languages = languages.clone();
            cx.code_block("math", move |block, _| {
                languages.borrow_mut().push((id, block.code.trim().to_owned()));
                None
            });
        })
    };
    let registry = Registry::new(vec![renderer("first"), renderer("second")], []);
    registry.activate(&host);
    // Toggling `first` makes it the last enabled, so it wins.
    registry.set_active(&host, "first", false);
    registry.set_active(&host, "first", true);
    let markdown = opencode_ui::markdown::view(
        host.app(),
        &host.theme(),
        &opencode_ui::code::syntax_theme(&host.theme()),
        &registry.code_blocks(&host.theme()),
        true,
        false,
    );
    markdown.set_markdown("```math\nx^2\n```\n");
    host.app().root().add(&markdown);
    host.app.render();
    assert_eq!(languages.borrow().first(), Some(&("first", "x^2".to_owned())));
}

#[test]
fn placement_constructors_name_their_kind() {
    assert_eq!(Placement::before("app").kind, Kind::Before);
    assert_eq!(Placement::after("app").kind, Kind::After);
    assert_eq!(Placement::replace("app").kind, Kind::Replace);
}

/// A plugin whose one claim at `placement` renders what `render` returns.
fn rendering(id: &str, placement: Placement, render: impl Fn() -> abi::Render + 'static) -> Definition<TestHost> {
    let render: node::SlotRender<TestHost> = Rc::new(move |_, _, _| render());
    Definition::new(id, move |cx: &mut Setup<'_, TestHost>| cx.claim(placement.clone(), render.clone()))
}

/// The rows the app draws, without trailing blanks.
fn rows(host: &TestHost) -> Vec<String> {
    host.app.render().text().lines().map(|line| line.trim_end().to_owned()).collect()
}

// Expected: a claim's root node is a flex item of the slot's parent, as in TS's `<Slot>` fragment: in a row slot a
// growing root fills the row (carbon's probe 2, `home.footer.status`), and a shrinking root that may go below its
// content's width gives up room as `prompt.footer` does (`prompt/footer.tsx:72`).
#[test]
fn a_claim_root_grows_in_a_row_slot() {
    use abi::{Layout, Node, Render, Span};
    let host = host();
    let grow = rendering("grow", Placement::append(slot::HOME_FOOTER), || {
        let spacer = Node::column(Vec::new()).layout(Layout::default().grow());
        Render::Show(
            Node::row(vec![Node::text([Span::new("L")]), spacer, Node::text([Span::new("R")])])
                .layout(Layout::default().grow()),
        )
    });
    let registry = Registry::new(vec![grow], []);
    registry.activate(&host);
    let parent = View::new(host.app()).row().width(30);
    let _mount = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |parent| {
        parent.add(&Text::new(host.app(), "content").shrink(0.0));
    });
    host.app().root().add(&parent);
    assert_eq!(rows(&host)[0], format!("contentL{}R", " ".repeat(21)));
}

#[test]
fn a_claim_root_shrinks_in_a_row_slot() {
    use abi::{Layout, Node, Render, Span};
    let host = host();
    let shrink = rendering("shrink", Placement::append(slot::PROMPT_FOOTER), || {
        Render::Show(
            Node::text([Span::new("abcdefghijklmnop")])
                .wrap(abi::Wrap::None)
                .truncate()
                .layout(Layout::default().shrink(true).min_width_zero()),
        )
    });
    let registry = Registry::new(vec![shrink], []);
    registry.activate(&host);
    let parent = View::new(host.app()).row().width(20);
    let _mount = registry.mount(&*host, &parent, slot::PROMPT_FOOTER, &SlotInput::default(), |parent| {
        parent.add(&Text::new(host.app(), "0123456789").shrink(0.0));
    });
    host.app().root().add(&parent);
    let row = &rows(&host)[0];
    assert!(row.starts_with("0123456789abc") && row.chars().count() <= 20, "{row:?}");
}

// Expected: a replaced node frees its widgets, a hoverable, clickable text among them, so the click action, which
// holds the host weakly, is dropped each time (bigboi's probe: ten replacements leave the count where it was).
#[test]
fn a_replaced_hover_text_drops_its_handlers() {
    use abi::{Click, Node, Render, Span};
    let host = host();
    let count = Rc::new(Cell::new(0));
    let counter = count.clone();
    let text = rendering("hover", Placement::append(slot::SIDEBAR_CONTENT), move || {
        counter.set(counter.get() + 1);
        Render::Show(
            Node::text([Span::new(format!("hover {}", counter.get()))])
                .hover_fg("text.muted")
                .on_click(Click::command("test.run", None)),
        )
    });
    let registry = Registry::new(vec![text], []);
    registry.activate(&host);
    let parent = View::new(host.app()).column();
    let mount = registry.mount(&*host, &parent, slot::SIDEBAR_CONTENT, &SlotInput::default(), |_| {});
    host.app().root().add(&parent);
    host.app.render();
    let weak = Rc::weak_count(&host);
    for _ in 0..10 {
        mount.sync(&host, &());
    }
    assert_eq!(rows(&host)[0], "hover 11");
    assert_eq!(Rc::weak_count(&host), weak);
}

// Expected: a claim on a child slot its parent did not mount, because the parent's plugin is off or hides, is
// appended to the parent (TS `survivingAncestor`), and moves back inside once the child slot mounts again.
#[test]
fn a_claim_on_an_unmounted_child_slot_degrades_to_its_parent() {
    use abi::{Node, Render, Span};
    let host = host();
    let hidden = Rc::new(Cell::new(false));
    let hide = hidden.clone();
    let footer = rendering("footer", Placement::append(slot::HOME_FOOTER), move || match hide.get() {
        true => Render::Hide,
        false => {
            Render::Show(Node::row(vec![Node::text([Span::new("footer ")]), Node::slot(slot::HOME_FOOTER_STATUS)]))
        }
    });
    let status = rendering("status", Placement::append(slot::HOME_FOOTER_STATUS), || {
        Render::Show(Node::text([Span::new("status")]))
    });
    let registry = Rc::new(Registry::new(vec![footer, status], []));
    *host.registry.borrow_mut() = Rc::downgrade(&registry);
    registry.activate(&host);
    let mount = |registry: &Registry<TestHost>| {
        let parent = View::new(host.app()).column();
        host.app().root().clear();
        host.app().root().add(&parent);
        registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |parent| {
            parent.add(&Text::new(host.app(), "content"));
        })
    };
    let mounted = mount(&registry);
    assert_eq!(rows(&host)[..2], ["content", "footer status"]);

    hidden.set(true);
    mounted.sync(&host, &());
    assert_eq!(rows(&host)[..2], ["content", "status"]);
    hidden.set(false);
    mounted.sync(&host, &());
    assert_eq!(rows(&host)[..3], ["content", "footer status", ""]);
    drop(mounted);

    registry.set_active(&host, "footer", false);
    let _mounted = mount(&registry);
    assert_eq!(rows(&host)[..2], ["content", "status"]);
}
