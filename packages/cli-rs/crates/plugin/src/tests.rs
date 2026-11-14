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
    registry: std::cell::RefCell<std::rc::Weak<Registry>>,
}

impl Host for TestHost {
    fn app(&self) -> &App {
        &self.app
    }

    fn theme(&self) -> Theme {
        Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme
    }

    fn keymap(&self) -> &DialogKeymap {
        &self.keymap
    }

    fn slot(&self, parent: &View, path: &str, input: &SlotInput) -> Option<SlotMount> {
        Some(self.registry.borrow().upgrade()?.mount(self, parent, path, input, |_| {}))
    }
}

/// `host` as the registry takes it.
fn dynamic(host: &Rc<TestHost>) -> Rc<dyn Host> {
    host.clone()
}

fn host() -> Rc<TestHost> {
    Rc::new(TestHost {
        app: TestApp::new(40, 6),
        keymap: DialogKeymap::new(Keybinds::defaults(), Options::default()),
        registry: Default::default(),
    })
}

/// A plugin that claims `placements`, each rendering a text of the plugin ID and its index.
fn claiming(id: &str, placements: Vec<Placement>) -> Definition {
    let id = id.to_owned();
    Definition::new(id.clone(), move |cx: &mut Setup<'_>| {
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
        .map(|id| Definition::new(id, |_| {}))
        .to_vec();
    let registry = Registry::define(
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
    registry.activate(&dynamic(&host));
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
    let registry = Registry::define(
        vec![
            claiming("a", vec![Placement::append("home.footer"), Placement::before("home.footer")]),
            claiming("b", vec![Placement::prepend("home.footer"), Placement::after("home.footer")]),
        ],
        [],
    );
    registry.activate(&dynamic(&host));
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
    let registry = Registry::define(
        vec![
            claiming("a", vec![Placement::append("home.footer")]),
            claiming("b", vec![Placement::replace("home.footer")]),
        ],
        [],
    );
    registry.activate(&dynamic(&host));
    let parent = View::new(host.app()).column();
    registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |parent| {
        parent.add(&Text::new(host.app(), "content"));
    });
    host.app().root().add(&parent);
    assert_eq!(host.app.render().text().lines().next().unwrap().trim_end(), "b0");
}

// Expected: as in TS, an external plugin with a built-in's ID replaces the built-in in its place among the claims, a
// second plugin with that ID is refused, and unloading the plugin brings the built-in back in the same place and state.
#[test]
fn an_external_plugin_replaces_a_built_in_of_its_id_in_place() {
    let host = host();
    let footer = || vec![Placement::append("home.footer")];
    let registry =
        Registry::define(vec![claiming("a", footer()), claiming("b", footer()), claiming("c", footer())], []);
    registry.activate(&dynamic(&host));
    let rows = |registry: &Registry| {
        let parent = View::new(host.app()).column();
        let _mount = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
        host.app().root().clear();
        host.app().root().add(&parent);
        let text = host.app.render().text();
        text.lines().map(str::trim_end).filter(|line| !line.is_empty()).map(str::to_owned).collect::<Vec<_>>()
    };
    assert_eq!(rows(&registry), ["a0", "b0", "c0"]);
    let external = |label: &str| {
        let label = label.to_owned();
        Definition::new("b", move |cx: &mut Setup<'_>| {
            let label = label.clone();
            cx.slot(Placement::append("home.footer"), move |host, _| {
                Box::new(View::new(host.app()).child(&Text::new(host.app(), label.clone())))
            });
        })
        .external("b.so", Rc::new(|| None))
    };
    assert!(!registry.id_taken("b", "b.so"));
    assert_eq!(registry.load(&dynamic(&host), external("ext")), None);
    assert_eq!(rows(&registry), ["a0", "ext", "c0"]);
    let entries = registry.entries();
    assert_eq!((entries[1].source, entries[1].target.as_deref()), (Source::External, Some("b.so")));
    assert!(registry.id_taken("b", "other.so"));
    // A rebuild keeps the place too.
    assert_eq!(registry.load(&dynamic(&host), external("ext2")), None);
    assert_eq!(rows(&registry), ["a0", "ext2", "c0"]);
    registry.unload(&dynamic(&host), "b.so");
    assert_eq!(rows(&registry), ["a0", "b0", "c0"]);
    assert_eq!((registry.entries()[1].source, registry.entries()[1].status.clone()), (Source::Builtin, Status::Active));

    // A built-in disabled in config comes back inactive, without the failure of the external plugin that replaced it.
    let registry = Registry::define(vec![claiming("b", footer())], ["-b"]);
    let failing = Definition::fallible("b", |_| Err("external config".to_owned())).external("b.so", Rc::new(|| None));
    assert_eq!(registry.load(&dynamic(&host), failing), None);
    registry.set_active(&dynamic(&host), "b", true);
    assert_eq!(registry.entries()[0].status, Status::Failed("external config".to_owned()));
    registry.unload(&dynamic(&host), "b.so");
    assert_eq!(
        (registry.entries()[0].source, registry.entries()[0].status.clone()),
        (Source::Builtin, Status::Inactive)
    );
}

// Expected (D3): an external plugin keeps its place among the claims when it is rebuilt and when it is disabled and
// enabled again, as `docs/P.4.md` and TS have it; so does a built-in that is enabled again.
#[test]
fn a_plugin_keeps_its_place_across_a_reload_and_a_toggle() {
    let host = host();
    let footer = || vec![Placement::append("home.footer")];
    let registry = Registry::define(vec![claiming("a", footer())], []);
    registry.activate(&dynamic(&host));
    let external = |id: &str, target: &str| claiming(id, footer()).external(target, Rc::new(|| None));
    registry.load(&dynamic(&host), external("b", "b.so"));
    registry.load(&dynamic(&host), external("c", "c.so"));
    let rows = || {
        let parent = View::new(host.app()).column();
        let _mount = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
        host.app().root().clear();
        host.app().root().add(&parent);
        let text = host.app.render().text();
        text.lines().map(str::trim_end).filter(|line| !line.is_empty()).map(str::to_owned).collect::<Vec<_>>()
    };
    assert_eq!(rows(), ["a0", "b0", "c0"]);
    registry.load(&dynamic(&host), external("b", "b.so"));
    assert_eq!(rows(), ["a0", "b0", "c0"], "a rebuild moved its claims");
    for id in ["b", "a"] {
        registry.set_active(&dynamic(&host), id, false);
        registry.set_active(&dynamic(&host), id, true);
        assert_eq!(rows(), ["a0", "b0", "c0"], "toggling {id} moved its claims");
    }
}

#[test]
fn deactivation_undoes_every_registration() {
    let host = host();
    let disposed = Rc::new(Cell::new(0));
    let ran = Rc::new(Cell::new(0));
    let plugin = {
        let disposed = disposed.clone();
        let ran = ran.clone();
        Definition::new("test.plugin", move |cx: &mut Setup<'_>| {
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
    let registry = Registry::define(vec![], []);
    registry.add(plugin);
    registry.activate(&dynamic(&host));
    assert!(matches!(host.keymap.dispatch("test.run", None), RunResult::Ok));
    assert_eq!(ran.get(), 1);
    assert!(registry.route(&*host, "test.plugin", "page").is_some());
    assert!(registry.route(&*host, "test.plugin", "other").is_none());
    let mounted = |registry: &Registry| {
        let parent = View::new(host.app());
        !registry.mount(&*host, &parent, slot::SIDEBAR_CONTENT, &SlotInput::default(), |_| {}).is_empty()
    };
    assert!(mounted(&registry));

    assert!(registry.set_active(&dynamic(&host), "test.plugin", false));
    assert_eq!(disposed.get(), 1);
    assert!(!matches!(host.keymap.dispatch("test.run", None), RunResult::Ok));
    assert!(registry.route(&*host, "test.plugin", "page").is_none());
    assert!(!mounted(&registry));
    assert_eq!(registry.entries()[0].status, Status::Inactive);

    // Reactivation runs setup again.
    assert!(registry.set_active(&dynamic(&host), "test.plugin", true));
    assert!(matches!(host.keymap.dispatch("test.run", None), RunResult::Ok));
    assert_eq!(ran.get(), 2);
    assert!(!registry.set_active(&dynamic(&host), "missing", true));
}

#[test]
fn code_blocks_follow_activation_order() {
    let host = host();
    let languages = Rc::new(std::cell::RefCell::new(Vec::new()));
    let renderer = |id: &'static str| {
        let languages = languages.clone();
        Definition::new(id, move |cx: &mut Setup<'_>| {
            let languages = languages.clone();
            cx.code_block("math", move |block, _| {
                languages.borrow_mut().push((id, block.code.trim().to_owned()));
                None
            });
        })
    };
    let registry = Registry::define(vec![renderer("first"), renderer("second")], []);
    registry.activate(&dynamic(&host));
    // The plugin later in order wins; toggling `first` keeps its place, as TS's registrations keep theirs.
    registry.set_active(&dynamic(&host), "first", false);
    registry.set_active(&dynamic(&host), "first", true);
    let markdown = opencode_ui::markdown::view(
        host.app(),
        &host.theme(),
        &opencode_ui::code::syntax_theme(&host.theme()),
        &registry.code_blocks({
            let theme = host.theme();
            Rc::new(move || theme.clone())
        }),
        true,
        false,
    );
    markdown.set_markdown("```math\nx^2\n```\n");
    host.app().root().add(&markdown);
    host.app.render();
    assert_eq!(languages.borrow().first(), Some(&("second", "x^2".to_owned())));
}

#[test]
fn code_blocks_draw_in_the_theme_of_the_render() {
    let host = host();
    let seen = Rc::new(std::cell::RefCell::new(Vec::new()));
    let registry = Registry::define(
        vec![Definition::new("math", {
            let seen = seen.clone();
            move |cx: &mut Setup<'_>| {
                let seen = seen.clone();
                cx.code_block("math", move |_, theme| {
                    seen.borrow_mut().push(theme.background.base);
                    None
                });
            }
        })],
        [],
    );
    registry.activate(&dynamic(&host));
    let light = Catalog::default().load("opencode", ThemeMode::Light).unwrap().theme;
    let current = Rc::new(std::cell::RefCell::new(host.theme()));
    let renderers = registry.code_blocks({
        let current = current.clone();
        Rc::new(move || current.borrow().clone())
    });
    let markdown = opencode_ui::markdown::view(
        host.app(),
        &host.theme(),
        &opencode_ui::code::syntax_theme(&host.theme()),
        &renderers,
        true,
        false,
    );
    markdown.set_markdown("```math\nx^2\n```\n");
    host.app().root().add(&markdown);
    host.app.render();
    // The renderers are made once; a later render reads the theme that is current then.
    *current.borrow_mut() = light.clone();
    markdown.set_markdown("```math\nx^3\n```\n");
    host.app.render();
    assert_eq!(*seen.borrow().first().unwrap(), host.theme().background.base);
    assert_eq!(*seen.borrow().last().unwrap(), light.background.base);
}

#[test]
fn placement_constructors_name_their_kind() {
    assert_eq!(Placement::before("app").kind, Kind::Before);
    assert_eq!(Placement::after("app").kind, Kind::After);
    assert_eq!(Placement::replace("app").kind, Kind::Replace);
}

/// A plugin whose one claim at `placement` renders what `render` returns.
fn rendering(id: &str, placement: Placement, render: impl Fn() -> abi::Render + 'static) -> Definition {
    let render: node::SlotRender = Rc::new(move |_, _, _| render());
    Definition::new(id, move |cx: &mut Setup<'_>| {
        let activation = crate::activation::Activation::new(cx.host(), Arc::new(crate::activation::Wake::new(None)));
        cx.claim(placement.clone(), render.clone(), None, false, &activation);
    })
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
    let registry = Registry::define(vec![grow], []);
    registry.activate(&dynamic(&host));
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
    let registry = Registry::define(vec![shrink], []);
    registry.activate(&dynamic(&host));
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
    let registry = Registry::define(vec![text], []);
    registry.activate(&dynamic(&host));
    let parent = View::new(host.app()).column();
    let mount = registry.mount(&*host, &parent, slot::SIDEBAR_CONTENT, &SlotInput::default(), |_| {});
    host.app().root().add(&parent);
    host.app.render();
    let weak = Rc::weak_count(&host);
    for _ in 0..10 {
        mount.sync(&*host, Some(&abi::Changed::everything()));
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
    let registry = Rc::new(Registry::define(vec![footer, status], []));
    *host.registry.borrow_mut() = Rc::downgrade(&registry);
    registry.activate(&dynamic(&host));
    let mount = |registry: &Registry| {
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
    mounted.sync(&*host, Some(&abi::Changed::everything()));
    assert_eq!(rows(&host)[..2], ["content", "status"]);
    hidden.set(false);
    mounted.sync(&*host, Some(&abi::Changed::everything()));
    assert_eq!(rows(&host)[..3], ["content", "footer status", ""]);
    drop(mounted);

    registry.set_active(&dynamic(&host), "footer", false);
    let _mounted = mount(&registry);
    assert_eq!(rows(&host)[..2], ["content", "status"]);
}

// Expected: a parent claim that shows or hides its nested slot outside a change batch, on a wake or on the
// invalidation after one of its handlers, moves the child slot's claim at once: the next frame shows it exactly once,
// inside the parent claim or degraded after it.
#[test]
fn a_claim_on_a_child_slot_moves_when_a_wake_or_an_invalidation_redraws_its_parent() {
    use abi::{Node, Render, Span};
    let host = host();
    let hidden = Rc::new(Cell::new(false));
    let hide = hidden.clone();
    let render: node::SlotRender = Rc::new(move |_, _, _| match hide.get() {
        true => Render::Hide,
        false => {
            Render::Show(Node::row(vec![Node::text([Span::new("footer ")]), Node::slot(slot::HOME_FOOTER_STATUS)]))
        }
    });
    let activation = Rc::new(std::cell::RefCell::new(None));
    let footer = {
        let activation = activation.clone();
        Definition::new("footer", move |cx: &mut Setup<'_>| {
            let wake = Arc::new(crate::activation::Wake::new(None));
            let created = crate::activation::Activation::new(cx.host(), wake);
            cx.claim(Placement::append(slot::HOME_FOOTER), render.clone(), None, false, &created);
            *activation.borrow_mut() = Some(created);
        })
    };
    let status = rendering("status", Placement::append(slot::HOME_FOOTER_STATUS), || {
        Render::Show(Node::text([Span::new("status")]))
    });
    let registry = Rc::new(Registry::define(vec![footer, status], []));
    *host.registry.borrow_mut() = Rc::downgrade(&registry);
    registry.activate(&dynamic(&host));
    let parent = View::new(host.app()).column();
    host.app().root().add(&parent);
    let _mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |parent| {
        parent.add(&Text::new(host.app(), "content"));
    });
    let activation = activation.borrow().clone().unwrap();
    let shown = |host: &TestHost| rows(host).into_iter().filter(|row| !row.is_empty()).collect::<Vec<_>>();
    assert_eq!(shown(&host), ["content", "footer status"]);

    hidden.set(true);
    activation.redraw();
    assert_eq!(shown(&host), ["content", "status"]);
    hidden.set(false);
    activation.redraw();
    assert_eq!(shown(&host), ["content", "footer status"]);

    hidden.set(true);
    activation.invalidate();
    assert_eq!(shown(&host), ["content", "status"]);
    hidden.set(false);
    activation.invalidate();
    assert_eq!(shown(&host), ["content", "footer status"]);
}

// Expected: a replaced diagram that scrolls on a drag frees its widgets and the drag handler with them: ten
// replacements leave the handlers' hold on a shared value where it was.
#[test]
fn a_replaced_drag_text_drops_its_handlers() {
    use abi::Span;
    let host = host();
    let parent = View::new(host.app()).column();
    host.app().root().add(&parent);
    let held = Rc::new(());
    let start = Rc::strong_count(&held);
    for index in 0..10 {
        let lines = vec![vec![Span::new(format!("diagram {index} {}", "-".repeat(60)))]];
        let widget = node::lines_widget(host.app(), &host.theme(), &lines, None, node::Scroll::Drag);
        parent.clear();
        parent.add(&widget);
        host.app.render();
        // The text under the drag lives as long as this handler.
        let held = held.clone();
        host.app().widget_at(1, 0).unwrap().on_mouse(move |_, _| {
            let _ = &held;
        });
        host.app.drag((10, 0), (2, 0));
        assert!(rows(&host)[0].starts_with(&format!("{index} -")), "{:?}", rows(&host)[0]);
    }
    parent.clear();
    host.app.render();
    assert_eq!(Rc::strong_count(&held), start);
}

// Expected (r2 review, carbon-ui-6): as TS `context.tsx` restores the fallback, an external plugin whose setup fails
// leaves the active built-in it would replace running, and its target reports the failure with "(previous version
// still active)". A build that sets up replaces the built-in.
#[test]
fn a_failed_external_plugin_keeps_the_built_in_it_would_replace() {
    let host = host();
    let registry = Registry::define(vec![claiming("b", vec![Placement::append("home.footer")])], []);
    registry.activate(&dynamic(&host));
    let failing = Definition::fallible("b", |_| Err("ext setup failed".to_owned())).external("b.so", Rc::new(|| None));
    assert_eq!(
        registry.load(&dynamic(&host), failing),
        Some(SetupFailed { error: "ext setup failed".into(), kept: false })
    );
    let entries = registry.entries();
    assert_eq!((entries[0].source, entries[0].status.clone()), (Source::Builtin, Status::Active));
    assert_eq!(
        (entries[1].target.as_deref(), entries[1].status.clone()),
        (Some("b.so"), Status::Failed("ext setup failed (previous version still active)".to_owned()))
    );
    let working = claiming("b", vec![Placement::append("home.footer")]).external("b.so", Rc::new(|| None));
    assert_eq!(registry.load(&dynamic(&host), working), None);
    let entries = registry.entries();
    assert_eq!(entries.len(), 1);
    assert_eq!((entries[0].source, entries[0].status.clone()), (Source::External, Status::Active));
}

// Expected (bigboi 7, carbon-p0a-3): a claim drawn again with another root layout draws as that layout mounted fresh:
// the heights, minimum, maximum and margins of an earlier node do not stay on the slot's root, also across a hidden
// render; and a percent height is of the slot's parent once, the box painted on all of it.
#[test]
fn a_claim_root_takes_each_layout_as_mounted_fresh() {
    use abi::{Edges, Layout, Node, Render, Span, Width};
    let boxed = |layout: Layout| Node::column(vec![Node::text([Span::new("x")])]).bg("#ff0000").layout(layout);
    let tall = |layout: Layout| Node::column(vec![Node::text([Span::new("x")]); 5]).bg("#ff0000").layout(layout);
    let renders = [
        Render::Show(boxed(Layout::default().height(Width::Cells(4)).margin(Edges::new(0, 0, 0, 7)))),
        Render::Show(boxed(Layout::default())),
        Render::Hide,
        Render::Show(boxed(Layout::default().height(Width::Percent(50.0)).margin(Edges::new(1, 0, 0, 0)))),
        Render::Show(boxed(Layout::default().min_height(Width::Cells(3)).margin(Edges::new(0, 2, 0, 0)))),
        Render::Show(boxed(Layout::default().max_height(Width::Cells(1)))),
        Render::Show(tall(Layout::default().max_height(Width::Cells(2)))),
        Render::Show(tall(Layout::default().max_height(Width::Percent(50.0)))),
        Render::Show(tall(Layout::default().max_height(Width::Cells(2)).shrink(false))),
    ];
    // The cells of a 6-row column slot that shows `shown`, which the claim's render reads.
    let mounted = |shown: &Rc<std::cell::RefCell<Render>>| {
        let host = host();
        let read = shown.clone();
        let claim = rendering("sized", Placement::prepend(slot::SIDEBAR_CONTENT), move || read.borrow().clone());
        let registry = Registry::define(vec![claim], []);
        registry.activate(&dynamic(&host));
        let parent = View::new(host.app()).column().height(6).width(20);
        // The slot's own content comes after the claim, where the claim's height moves it.
        let mount = registry.mount(&*host, &parent, slot::SIDEBAR_CONTENT, &SlotInput::default(), |parent| {
            parent.add(&Text::new(host.app(), "after").shrink(0.0));
        });
        host.app().root().add(&parent);
        (host, mount)
    };
    let live = Rc::new(std::cell::RefCell::new(renders[0].clone()));
    let (host, mount) = mounted(&live);
    for render in &renders {
        *live.borrow_mut() = render.clone();
        mount.sync(&*host, Some(&abi::Changed::everything()));
        let (fresh, _mount) = mounted(&Rc::new(std::cell::RefCell::new(render.clone())));
        assert!(host.app.render().cells == fresh.app.render().cells, "{render:?}");
    }
    // The painted rows: 4 from the top; 50% of the 6 rows after a one-row margin; at least 3; at most 1; five rows of
    // content cut to at most 2, to at most 50%, and to at most 2 although the node does not shrink.
    for (index, painted) in [
        (0, vec![0, 1, 2, 3]),
        (3, vec![1, 2, 3]),
        (4, vec![0, 1, 2]),
        (5, vec![0]),
        (6, vec![0, 1]),
        (7, vec![0, 1, 2]),
        (8, vec![0, 1]),
    ] {
        *live.borrow_mut() = renders[index].clone();
        mount.sync(&*host, Some(&abi::Changed::everything()));
        let capture = host.app.render();
        let red = |y: u32| (0..20).any(|x| capture.cell(x, y).is_some_and(|cell| cell.bg == Color::rgb(255, 0, 0)));
        assert_eq!((0..6).filter(|y| red(*y)).collect::<Vec<_>>(), painted, "{index}");
    }
}

thread_local! {
    /// Whether `test.fails`' view panics.
    static PANICS: Cell<bool> = const { Cell::new(false) };
}

// Expected (`ledger`): a 2.0 surface whose plugin fails shows nothing and holds no content or memo from then on, also
// on a host that does not mount its route again, as this one: the mount itself goes when its slot does.
#[test]
fn a_failed_surface_drops_what_it_held() {
    use abi::v2;
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.surface(v2::Surface::new("fails", v2::Place::Slot(abi::Placement::append(slot::HOME_FOOTER)), |cx| {
            let body = cx.memo("body", 1, |cx| {
                let handle = cx.content("held bytes");
                v2::Node::Markdown { id: None, source: v2::Source::Content(handle) }
            });
            assert!(!PANICS.get(), "the view panics");
            v2::Node::column(vec![body])
        }));
        Ok(())
    }
    PANICS.set(false);
    let host = host();
    let registry = Registry::define(vec![abi::Plugin { id: "test.fails", setup }.into()], []);
    registry.activate(&dynamic(&host));
    let parent = View::new(host.app()).column().width(30);
    let mount = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    host.app().root().add(&parent);
    assert!(rows(&host).iter().any(|row| row.contains("held bytes")));
    assert_eq!(surface::ledger(), surface::Ledger { mounts: 1, content: 1, content_bytes: 10, memo_entries: 1 });
    PANICS.set(true);
    mount.sync(&*host, Some(&abi::Changed::default()));
    assert!(!rows(&host).iter().any(|row| row.contains("held bytes")));
    assert_eq!(surface::ledger(), surface::Ledger { mounts: 1, ..surface::Ledger::default() });
    drop(mount);
    assert_eq!(surface::ledger(), surface::Ledger::default());
}
