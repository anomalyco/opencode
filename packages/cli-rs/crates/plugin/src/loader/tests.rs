use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::fs;
use std::hash::{DefaultHasher, Hasher};
use std::path::Path;
use std::rc::Rc;

use opencode_ui::dialog::DialogKeymap;
use opencode_ui::keymap::{Keybinds, Options};
use opencode_ui::theme::{Catalog, Theme, ThemeMode};
use opentui::prelude::*;
use opentui::testing::TestApp;

use opencode_plugin_abi::types::{ModelRef, SessionInfo, SessionMessageInfo};

use super::*;
use crate::{Entry, Source, abi};

/// An event handler of [`Host::on_event`].
type Handler = Rc<dyn Fn(&abi::types::V2Event)>;

/// A host that records what plugins ask of it.
pub(crate) struct TestHost {
    pub app: TestApp,
    keymap: DialogKeymap,
    pub storage: RefCell<HashMap<String, String>>,
    pub toasts: RefCell<Vec<abi::Toast>>,
    pub attention: RefCell<Vec<abi::Attention>>,
    /// The event handlers of [`Host::on_event`], which [`TestHost::emit`] calls.
    pub events: Rc<RefCell<Vec<Handler>>>,
    /// The registry nested slots mount from.
    pub registry: RefCell<std::rc::Weak<crate::Registry>>,
    pub routes: RefCell<Vec<(String, String)>>,
    pub remounts: Cell<usize>,
    /// The mode it reports, whatever the theme's background.
    pub mode: Cell<ThemeMode>,
    /// The messages of its one session, `ses_1`, titled "Sample".
    pub messages: RefCell<Vec<SessionMessageInfo>>,
    /// The fetches sent, with their replies, which [`TestHost::reply`] delivers.
    pub fetches: RefCell<Vec<(abi::Fetch, Reply)>>,
    pub dialogs: RefCell<Vec<(String, abi::Dialog)>>,
    /// What [`abi::Read::interactive`] answers.
    pub interactive: Cell<bool>,
    /// The composer edits applied.
    pub edits: RefCell<Vec<abi::ComposerEdit>>,
    /// The verbs of ABI 1.6 the plugins asked for, as text, in the order the host ran them.
    pub verbs: RefCell<Vec<String>>,
    /// The handlers of [`Host::on_deltas`], which [`TestHost::emit_deltas`] calls.
    pub deltas: Rc<RefCell<Vec<crate::Deltas>>>,
    /// The replies of the programs run in the foreground, which [`TestHost::exit`] delivers.
    pub programs: RefCell<Vec<(Alive, Reply)>>,
    /// The plugins' input (P2): their layers, listeners, pointer capture and pastes.
    pub router: crate::interact::Router,
}

/// Whether a program's plugin is still active.
pub(crate) type Alive = Box<dyn Fn() -> bool>;

/// A fetch's reply.
pub(crate) type Reply = Box<dyn FnOnce(Result<serde_json::Value, String>)>;

/// What [`TestHost`]'s renders read.
struct Fixture<'a> {
    host: &'a TestHost,
    theme: Theme,
}

impl abi::Read for Fixture<'_> {
    fn theme_mode(&self) -> abi::ThemeMode {
        crate::node::Reader::new(&self.theme, self.host.mode.get()).theme_mode()
    }

    fn color(&self, token: &str) -> Option<abi::Rgba> {
        crate::node::theme_color(&self.theme, token)
    }

    fn session(&self, id: &str) -> Option<abi::Session> {
        let info = SessionInfo { title: Some("Sample".to_owned()), ..SessionInfo::default() };
        (id == "ses_1").then_some(abi::Session { info, status: abi::SessionStatus::Idle })
    }

    fn messages(&self, id: &str, visit: &mut dyn FnMut(&[SessionMessageInfo])) {
        match id {
            "ses_1" => visit(&self.host.messages.borrow()),
            _ => visit(&[]),
        }
    }

    fn model(&self) -> Option<ModelRef> {
        Some(ModelRef { id: "big".to_owned(), provider_id: "opencode".into(), variant: None })
    }

    fn interactive(&self) -> bool {
        self.host.interactive.get()
    }

    fn shortcut(&self, name: &str) -> Option<String> {
        (name == "command.palette.show").then(|| "ctrl+p".to_owned())
    }

    fn variants(&self) -> Vec<String> {
        vec!["low".to_owned(), "high".to_owned()]
    }

    fn tabs_enabled(&self) -> bool {
        true
    }

    fn tabs(&self) -> Vec<abi::Tab> {
        let tab = |id: &str, active| abi::Tab { session_id: id.to_owned(), active, ..abi::Tab::default() };
        vec![tab("ses_1", true), tab("ses_2", false)]
    }

    fn keymap_pending(&self) -> Vec<abi::KeymapPending> {
        vec![abi::KeymapPending { key: "ctrl+x".to_owned(), token: Some("leader".to_owned()) }]
    }

    fn keymap_active(&self) -> Vec<abi::KeymapActive> {
        vec![abi::KeymapActive { key: "n".to_owned(), ..abi::KeymapActive::default() }; 3]
    }

    fn keymap_commands(&self) -> Vec<abi::KeymapCommand> {
        vec![abi::KeymapCommand { id: "command.palette.show".to_owned(), ..abi::KeymapCommand::default() }]
    }

    fn shortcuts(&self, name: &str) -> Vec<String> {
        self.shortcut(name).into_iter().chain((name == "command.palette.show").then(|| "f1".to_owned())).collect()
    }

    fn selection(&self) -> Option<String> {
        Some("picked".to_owned())
    }

    fn theme(&self) -> Option<String> {
        Some("opencode".to_owned())
    }

    fn themes(&self) -> Vec<String> {
        vec!["opencode".to_owned(), "nord".to_owned()]
    }

    fn plugins(&self) -> Vec<abi::PluginEntry> {
        let entry = |key: &str, id: &str, target: Option<&str>, origin, status, active| abi::PluginEntry {
            key: key.to_owned(),
            id: id.to_owned(),
            target: target.map(str::to_owned),
            origin,
            status,
            active,
            slow: None,
        };
        vec![
            entry(
                "plugin:opencode.stats",
                "opencode.stats",
                None,
                abi::PluginOrigin::Builtin,
                abi::PluginStatus::Active,
                true,
            ),
            entry(
                "held:/plugins/old",
                "old",
                Some("/plugins/old"),
                abi::PluginOrigin::External,
                abi::PluginStatus::Failed,
                false,
            ),
        ]
    }
}

impl Host for TestHost {
    fn app(&self) -> &App {
        &self.app
    }

    fn router(&self) -> Option<&crate::interact::Router> {
        Some(&self.router)
    }

    fn theme(&self) -> Theme {
        Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme
    }

    fn theme_mode(&self) -> ThemeMode {
        self.mode.get()
    }

    fn keymap(&self) -> &DialogKeymap {
        &self.keymap
    }

    fn storage_read(&self, key: &str) -> Option<String> {
        self.storage.borrow().get(key).cloned()
    }

    fn storage_write(&self, key: &str, json: &str) -> Result<(), String> {
        self.storage.borrow_mut().insert(key.to_owned(), json.to_owned());
        Ok(())
    }

    fn storage_restore(&self, key: &str, json: Option<&str>) {
        let mut storage = self.storage.borrow_mut();
        match json {
            Some(json) => storage.insert(key.to_owned(), json.to_owned()),
            None => storage.remove(key),
        };
    }

    fn toast(&self, toast: &abi::Toast) {
        self.toasts.borrow_mut().push(toast.clone());
    }

    fn attention(&self, attention: &abi::Attention) {
        self.attention.borrow_mut().push(attention.clone());
    }

    fn on_event(&self, _types: &[String], run: Rc<dyn Fn(&abi::types::V2Event)>) -> Option<opentui::keymap::Disposer> {
        self.events.borrow_mut().push(run.clone());
        let events = Rc::downgrade(&self.events);
        Some(opentui::keymap::Disposer::new(move || {
            if let Some(events) = events.upgrade() {
                events.borrow_mut().retain(|known| !Rc::ptr_eq(known, &run));
            }
        }))
    }

    fn slot(&self, parent: &View, path: &str, input: &crate::SlotInput) -> Option<crate::SlotMount> {
        Some(self.registry.borrow().upgrade()?.mount(self, parent, path, input, |_| {}))
    }

    fn open_route(&self, id: &str, name: &str) {
        self.routes.borrow_mut().push((id.to_owned(), name.to_owned()));
    }

    fn remount(&self) {
        self.remounts.set(self.remounts.get() + 1);
    }

    fn dispatch(&self, name: &str, input: Option<&str>) {
        self.keymap.dispatch(name, input);
    }

    fn read(&self, f: &mut dyn FnMut(&dyn abi::Read)) {
        f(&Fixture { host: self, theme: self.theme() });
    }

    fn fetch(&self, fetch: abi::Fetch, reply: Reply) {
        self.fetches.borrow_mut().push((fetch, reply));
    }

    fn dialog(&self, id: &str, _: u64, dialog: abi::Dialog) {
        self.dialogs.borrow_mut().push((id.to_owned(), dialog));
    }

    fn edit_composer(&self, edit: abi::ComposerEdit) {
        self.edits.borrow_mut().push(edit);
    }

    fn set_variant(&self, variant: Option<&str>) {
        self.verb(format!("variant {variant:?}"));
    }

    fn set_model(&self, provider: &str, model: &str) {
        self.verb(format!("model {provider}/{model}"));
    }

    fn tab_allowed(&self, edit: &abi::TabEdit, _staged: &[abi::TabEdit]) -> bool {
        !matches!(edit, abi::TabEdit::Close { session: None })
    }

    fn edit_tab(&self, edit: abi::TabEdit) {
        self.verb(format!("tab {edit:?}"));
    }

    fn clear_selection(&self) {
        self.verb("clear selection".to_owned());
    }

    fn foreground(&self, program: abi::Foreground, alive: Box<dyn Fn() -> bool>, reply: Reply) {
        self.verb(format!("foreground {} {:?}", program.command, program.args));
        self.programs.borrow_mut().push((alive, reply));
    }

    fn set_title(&self, title: &str) {
        self.verb(format!("title {title}"));
    }

    fn set_theme(&self, name: &str) {
        self.verb(format!("theme {name}"));
    }

    fn install_theme(&self, name: &str, theme: serde_json::Value) {
        self.verb(format!("install {name} {theme}"));
    }

    fn on_deltas(&self, run: crate::Deltas) -> Option<opentui::keymap::Disposer> {
        self.deltas.borrow_mut().push(run.clone());
        let deltas = Rc::downgrade(&self.deltas);
        Some(opentui::keymap::Disposer::new(move || {
            if let Some(deltas) = deltas.upgrade() {
                deltas.borrow_mut().retain(|known| !Rc::ptr_eq(known, &run));
            }
        }))
    }
}

impl TestHost {
    /// Calls the event handlers with `event`, as the host's event loop would.
    pub fn emit(&self, event: &abi::types::V2Event) {
        let handlers = self.events.borrow().clone();
        handlers.iter().for_each(|handler| handler(event));
    }

    /// Calls the delta handlers with `events`, as the host does once a change batch.
    pub fn emit_deltas(&self, events: &[abi::types::V2Event]) {
        let handlers = self.deltas.borrow().clone();
        handlers.iter().for_each(|handler| handler(events));
    }

    fn verb(&self, verb: String) {
        self.verbs.borrow_mut().push(verb);
    }

    /// Starts every program asked for so far whose plugin is still active, as the TUI does once the turn is done, and
    /// ends it with exit code 0; one whose plugin is gone gets that error.
    pub fn exit(&self) {
        let programs = std::mem::take(&mut *self.programs.borrow_mut());
        for (alive, reply) in programs {
            reply(if alive() { Ok(serde_json::json!({ "code": 0 })) } else { Err("gone".to_owned()) });
        }
    }

    /// Whether each program asked for so far would start now, its plugin still active.
    pub fn programs_alive(&self) -> Vec<bool> {
        self.programs.borrow().iter().map(|(alive, _)| alive()).collect()
    }

    /// Answers every fetch sent so far with `{"name": <its path>}`, as the server would.
    pub fn reply(&self) {
        let fetches = std::mem::take(&mut *self.fetches.borrow_mut());
        for (fetch, reply) in fetches {
            reply(Ok(serde_json::json!({ "name": fetch.path })));
        }
    }
}

pub(crate) fn host() -> Rc<TestHost> {
    Rc::new(TestHost {
        app: TestApp::new(60, 10),
        keymap: DialogKeymap::new(Keybinds::defaults(), Options::default()),
        storage: RefCell::default(),
        toasts: RefCell::default(),
        attention: RefCell::default(),
        events: Rc::default(),
        registry: RefCell::default(),
        routes: RefCell::default(),
        remounts: Cell::new(0),
        mode: Cell::new(ThemeMode::Dark),
        messages: RefCell::default(),
        fetches: RefCell::default(),
        dialogs: RefCell::default(),
        interactive: Cell::new(true),
        edits: RefCell::default(),
        verbs: RefCell::default(),
        deltas: Rc::default(),
        programs: RefCell::default(),
        router: crate::interact::Router::default(),
    })
}

/// Routes the app's keys to `host`'s keymap before any widget, as the TUI does (`route_keys`).
pub(crate) fn route_keys(host: &Rc<TestHost>) {
    let weak = Rc::downgrade(host);
    host.app.on_key_capture(move |cx, key| {
        let Some(host) = weak.upgrade() else { return };
        host.router.prune();
        let result = host.keymap().handle_key(key);
        if result.prevent_default {
            cx.prevent_default();
        }
        if result.handled || result.stop_propagation {
            cx.stop_propagation();
        }
    });
}

/// `host` as the registry takes it.
pub(crate) fn dynamic(host: &Rc<TestHost>) -> Rc<dyn Host> {
    host.clone()
}

pub(crate) fn entry<'a>(entries: &'a [Entry], target: &str) -> &'a Entry {
    entries
        .iter()
        .find(|entry| entry.target.as_deref() == Some(target))
        .unwrap_or_else(|| panic!("no entry for {target}: {entries:?}"))
}

/// A backend whose builds are text: `id=<id>` loads a plugin with a `fake` fence that draws nothing, anything
/// else fails with that text.
#[derive(Default)]
struct Fake {
    loads: Cell<usize>,
    /// Active instances: setup adds one, deactivation removes it.
    active: Rc<Cell<i32>>,
    /// The options of each load.
    options: RefCell<Vec<Option<String>>>,
    /// Runs as a load starts, to change the disk in the middle of a reconcile.
    during: RefCell<Option<Box<dyn Fn()>>>,
}

impl Backend for Fake {
    fn load(
        &self,
        _: &Rc<dyn Host>,
        library: &[u8],
        _: &Path,
        options: Option<&str>,
    ) -> Result<(Definition, ErrorFn), String> {
        if let Some(during) = self.during.borrow().as_ref() {
            during();
        }
        self.loads.set(self.loads.get() + 1);
        let text = String::from_utf8_lossy(library).into_owned();
        let id = text.strip_prefix("id=").ok_or(text.clone())?.trim().to_owned();
        self.options.borrow_mut().push(options.map(str::to_owned));
        let active = self.active.clone();
        let definition = Definition::new(id, move |setup| {
            active.set(active.get() + 1);
            let active = active.clone();
            setup.on_dispose(move || active.set(active.get() - 1));
            setup.code_block("fake", |_, _| None);
        });
        Ok((definition, Rc::new(|| None)))
    }
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

#[test]
fn plugin_directories_follow_the_project_root_down_to_cwd() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let project = root.path().join("repo");
    let cwd = project.join("a/b");
    fs::create_dir_all(project.join(".git")).unwrap();
    fs::create_dir_all(cwd.join(".opencode")).unwrap();
    // Above the project root: not searched.
    fs::create_dir_all(root.path().join(".opencode")).unwrap();
    assert_eq!(
        plugin_directories(&config, &cwd),
        [
            config.join("plugins"),
            // The project's own `.opencode` is searched even when missing; `a/.opencode` is not there.
            project.join(".opencode/plugins"),
            cwd.join(".opencode/plugins"),
        ]
    );
}

#[test]
fn discover_lists_subdirectories_by_name() {
    let root = opencode_util::temp::tempdir().unwrap();
    let plugins = root.path().join("plugins");
    for name in ["beta", "Alpha", "gamma"] {
        fs::create_dir_all(plugins.join(name)).unwrap();
    }
    write(&plugins.join(entry_file()), "");
    assert_eq!(
        discover(&[plugins.clone(), root.path().join("missing")]),
        [plugins.join("Alpha"), plugins.join("beta"), plugins.join("gamma")]
    );
}

#[cfg(unix)]
#[test]
fn local_source_resolves_paths_and_urls_but_not_packages() {
    let dir = Path::new("/home/me/.config/opencode");
    assert_eq!(local_source("./plugins/x", dir), Some(dir.join("plugins/x")));
    assert_eq!(local_source("../x.wasm", dir), Some("/home/me/.config/x.wasm".into()));
    assert_eq!(local_source("/abs/x", dir), Some("/abs/x".into()));
    assert_eq!(local_source("file:///abs/y.wasm", dir), Some("/abs/y.wasm".into()));
    assert_eq!(local_source("@acme/opencode-tui", dir), None);
    // Expected (r2 review, bigboi-ui-8 and carbon-ui-8): a file URL means what `fileURLToPath(new URL(spec))` says.
    assert_eq!(local_source("file:///a/My%20Plugin", dir), Some("/a/My Plugin".into()));
    assert_eq!(local_source("file://localhost/a/b", dir), Some("/a/b".into()));
    assert_eq!(local_source("file:///a/b/../c", dir), Some("/a/c".into()));
}

// The same on Windows, where TS `path.isAbsolute` takes a rooted path without a drive, which resolves on the
// directory's drive, and `fileURLToPath` wants a drive or a host.
#[cfg(windows)]
#[test]
fn local_source_resolves_paths_and_urls_but_not_packages() {
    let dir = Path::new(r"C:\Users\me\.config\opencode");
    assert_eq!(local_source("./plugins/x", dir), Some(r"C:\Users\me\.config\opencode\plugins\x".into()));
    assert_eq!(local_source("../x.wasm", dir), Some(r"C:\Users\me\.config\x.wasm".into()));
    assert_eq!(local_source("/abs/x", dir), Some(r"C:\abs\x".into()));
    assert_eq!(local_source(r"\abs\x", dir), Some(r"C:\abs\x".into()));
    assert_eq!(local_source(r"D:\abs\x", dir), Some(r"D:\abs\x".into()));
    assert_eq!(local_source("C:x", dir), None);
    assert_eq!(local_source("file:///D:/abs/y.wasm", dir), Some(r"D:\abs\y.wasm".into()));
    assert_eq!(local_source("@acme/opencode-tui", dir), None);
    assert_eq!(local_source("file:///D:/a/My%20Plugin", dir), Some(r"D:\a\My Plugin".into()));
    assert_eq!(local_source("file:///D:/a/b/../c", dir), Some(r"D:\a\c".into()));
}

#[test]
fn reconcile_loads_reloads_keeps_and_unloads() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let lib_dir = config.join("plugins").join("fake");
    let ts_dir = config.join("plugins").join("typescript");
    write(&ts_dir.join("package.json"), r#"{ "name": "@acme/typescript-tui" }"#);
    write(&lib_dir.join(entry_file()), "id=fake");
    let file = root.path().join(format!("extra.{}", std::env::consts::DLL_EXTENSION));
    write(&file, "id=extra");
    let host = host();
    let registry = Registry::define(Vec::new(), [file.to_str().unwrap(), "@acme/tui"]);
    let fake = Rc::new(Fake::default());
    let configured = registry.skipped().into_iter().map(|target| Configured { target, options: None }).collect();
    let loader = Loader::new(fake.clone() as Rc<dyn Backend>, config.clone(), root.path().to_path_buf(), configured);
    let lib_target = lib_dir.to_string_lossy().into_owned();
    let file_target = file.to_string_lossy().into_owned();
    let ts_target = ts_dir.to_string_lossy().into_owned();

    assert!(loader.reconcile(&dynamic(&host), &registry));
    let entries = registry.entries();
    assert_eq!(entry(&entries, &lib_target).id, "fake");
    assert_eq!(entry(&entries, &lib_target).source, Source::External);
    assert_eq!(entry(&entries, &lib_target).status, Status::Active);
    assert_eq!(entry(&entries, &file_target).id, "extra");
    // Skipped with why and how to load it, and named by its package rather than its path (FT-10, FT-15).
    assert_eq!(entry(&entries, &ts_target).status, Status::Skipped(SKIPPED_JS_OFF.to_owned()));
    assert_eq!(entry(&entries, &ts_target).id, "@acme/typescript-tui");
    assert_eq!(entry(&entries, "@acme/tui").status, Status::Skipped(SKIPPED_JS_OFF.to_owned()));
    assert_eq!(fake.active.get(), 2);
    assert_eq!(host.remounts.get(), 1);
    assert!(loader.watch_dirs().contains(&lib_dir));

    // Nothing changed: no load, no remount.
    assert!(!loader.reconcile(&dynamic(&host), &registry));
    assert_eq!(fake.loads.get(), 2);

    // A broken build keeps the running version and says so.
    write(&lib_dir.join(entry_file()), "boom");
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let entries = registry.entries();
    assert_eq!(entry(&entries, &lib_target).status, Status::Failed("boom (previous version still active)".to_owned()));
    assert_eq!(fake.active.get(), 2);
    // The same broken build is not retried.
    assert!(!loader.reconcile(&dynamic(&host), &registry));
    assert_eq!(fake.loads.get(), 3);
    // The running version can be disabled, and enabling it starts it afresh without the stale failure.
    assert!(entry(&registry.entries(), &lib_target).active);
    assert!(registry.set_active(&dynamic(&host), "fake", false));
    assert_eq!(entry(&registry.entries(), &lib_target).status, Status::Inactive);
    assert!(registry.set_active(&dynamic(&host), "fake", true));
    assert_eq!(entry(&registry.entries(), &lib_target).status, Status::Active);
    assert_eq!(fake.active.get(), 2);

    // A fixed build replaces it in place, under its new ID.
    write(&lib_dir.join(entry_file()), "id=fake2");
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let entries = registry.entries();
    assert_eq!(entry(&entries, &lib_target).id, "fake2");
    assert_eq!(entry(&entries, &lib_target).status, Status::Active);
    assert_eq!(
        entries
            .iter()
            .filter(|entry| entry.source == Source::External)
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        ["fake2", "extra"]
    );

    // A removed build unloads; the directory is a TypeScript plugin now.
    fs::remove_file(lib_dir.join(entry_file())).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let entries = registry.entries();
    assert_eq!(entry(&entries, &lib_target).status, Status::Skipped(SKIPPED_JS_OFF.to_owned()));
    assert!(!entries.iter().any(|entry| entry.id == "fake2"));
    assert_eq!(fake.active.get(), 1);

    // Deleted directories leave the list, whether they were skipped or loaded.
    fs::remove_dir_all(&lib_dir).unwrap();
    fs::remove_dir_all(&ts_dir).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let entries = registry.entries();
    let gone = |entry: &Entry| entry.target.as_ref().is_some_and(|target| [&lib_target, &ts_target].contains(&target));
    assert!(!entries.iter().any(gone), "{entries:?}");
    assert_eq!(entry(&entries, "@acme/tui").status, Status::Skipped(SKIPPED_JS_OFF.to_owned()));
}

#[test]
fn a_build_that_never_loaded_is_failed_and_ids_stay_unique() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    write(&config.join(format!("plugins/a/{}", entry_file())), "id=same");
    write(&config.join(format!("plugins/b/{}", entry_file())), "id=same");
    write(&config.join(format!("plugins/c/{}", entry_file())), "not a library");
    let host = host();
    let registry = Registry::define(Vec::new(), []);
    let loader =
        Loader::new(Rc::new(Fake::default()) as Rc<dyn Backend>, config.clone(), root.path().to_path_buf(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    let entries = registry.entries();
    let target = |name: &str| config.join("plugins").join(name).to_string_lossy().into_owned();
    assert_eq!(entry(&entries, &target("a")).status, Status::Active);
    assert_eq!(entry(&entries, &target("b")).status, Status::Failed("plugin ID same is already registered".to_owned()));
    assert_eq!(entry(&entries, &target("c")).status, Status::Failed("not a library".to_owned()));
    assert_eq!(entry(&entries, &target("c")).source, Source::Configured);
}

// Expected (D5): a build refused for a taken ID loads once the plugin that had the ID is removed.
#[test]
fn a_build_refused_for_a_taken_id_loads_once_the_id_is_free() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    write(&config.join(format!("plugins/a/{}", entry_file())), "id=same");
    write(&config.join(format!("plugins/b/{}", entry_file())), "id=same");
    let host = host();
    let registry = Registry::define(Vec::new(), []);
    let loader =
        Loader::new(Rc::new(Fake::default()) as Rc<dyn Backend>, config.clone(), root.path().to_path_buf(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    let target = |name: &str| config.join("plugins").join(name).to_string_lossy().into_owned();
    assert_eq!(
        entry(&registry.entries(), &target("b")).status,
        Status::Failed("plugin ID same is already registered".to_owned())
    );
    fs::remove_dir_all(config.join("plugins").join("a")).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let entries = registry.entries();
    assert_eq!(
        (entry(&entries, &target("b")).status.clone(), entry(&entries, &target("b")).id.as_str()),
        (Status::Active, "same")
    );
}

// Expected (bigboi-4): a rebuild refused for a taken ID, while its previous build keeps running, loads once the owner of
// the ID is removed.
#[test]
fn a_running_plugin_takes_the_id_it_waited_for_once_the_owner_is_removed() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let file = |name: &str| config.join(format!("plugins/{name}/{}", entry_file()));
    write(&file("a"), "id=x");
    write(&file("b"), "id=y");
    let host = host();
    let registry = Registry::define(Vec::new(), []);
    let loader =
        Loader::new(Rc::new(Fake::default()) as Rc<dyn Backend>, config.clone(), root.path().to_path_buf(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    write(&file("b"), "id=x");
    loader.reconcile(&dynamic(&host), &registry);
    let target = config.join("plugins").join("b").to_string_lossy().into_owned();
    let b = || {
        let entries = registry.entries();
        let b = entry(&entries, &target);
        (b.id.clone(), b.status.clone())
    };
    assert_eq!(
        b(),
        (
            "y".to_owned(),
            Status::Failed("plugin ID x is already registered (previous version still active)".to_owned())
        )
    );
    fs::remove_dir_all(config.join("plugins").join("a")).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!(b(), ("x".to_owned(), Status::Active));
}

// Expected (bigboi-4): a build refused for a taken ID loads once the owner's rebuild takes another ID.
#[test]
fn a_refused_build_loads_once_the_owner_takes_another_id() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let file = |name: &str| config.join(format!("plugins/{name}/{}", entry_file()));
    write(&file("a"), "id=x");
    write(&file("b"), "id=x");
    let host = host();
    let registry = Registry::define(Vec::new(), []);
    let loader =
        Loader::new(Rc::new(Fake::default()) as Rc<dyn Backend>, config.clone(), root.path().to_path_buf(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    write(&file("a"), "id=other");
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let entries = registry.entries();
    let status = |name: &str| {
        let target = config.join("plugins").join(name).to_string_lossy().into_owned();
        let entry = entry(&entries, &target);
        (entry.id.clone(), entry.status.clone())
    };
    assert_eq!(status("a"), ("other".to_owned(), Status::Active));
    assert_eq!(status("b"), ("x".to_owned(), Status::Active));
}

#[cfg(target_os = "linux")]
const ONE: &str = "./one.so";
#[cfg(target_os = "macos")]
const ONE: &str = "./one.dylib";
#[cfg(windows)]
const ONE: &str = "./one.dll";

#[test]
fn directives_after_an_entry_disable_an_external_plugin() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    write(&config.join(format!("one.{}", std::env::consts::DLL_EXTENSION)), "id=one");
    write(&config.join(format!("plugins/two/{}", entry_file())), "id=two");
    let host = host();
    let registry = Registry::define(Vec::new(), ["-one", ONE, "-two", "-*", "two"]);
    let loader = Loader::new(
        Rc::new(Fake::default()) as Rc<dyn Backend>,
        config.clone(),
        root.path().to_path_buf(),
        vec![Configured { target: ONE.to_owned(), options: None }],
    );
    loader.reconcile(&dynamic(&host), &registry);
    let entries = registry.entries();
    let status = |id: &str| entries.iter().find(|entry| entry.id == id).unwrap().status.clone();
    // `-one` comes before its entry, `-*` after it; `two` is discovered, so every directive applies.
    assert_eq!(status("one"), Status::Inactive);
    assert_eq!(status("two"), Status::Active);
}

// Expected: while `<cwd>/.opencode/plugins` is missing, the directory it would be made in is watched, even when
// `<cwd>/.opencode` is missing too and `cwd` is below the project root.
#[test]
fn watch_dirs_cover_a_plugins_directory_made_later() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let project = root.path().join("repo");
    let cwd = project.join("a");
    fs::create_dir_all(project.join(".git")).unwrap();
    fs::create_dir_all(&cwd).unwrap();
    let loader = Loader::new(Rc::new(Fake::default()), config, cwd.clone(), Vec::new());
    let dirs = loader.watch_dirs();
    assert!(dirs.contains(&cwd) && dirs.contains(&project), "{dirs:?}");
    fs::create_dir_all(cwd.join(".opencode")).unwrap();
    assert!(loader.watch_dirs().contains(&cwd.join(".opencode")));
    fs::create_dir_all(cwd.join(".opencode/plugins")).unwrap();
    let dirs = loader.watch_dirs();
    assert!(dirs.contains(&cwd.join(".opencode/plugins")) && !dirs.contains(&cwd), "{dirs:?}");
}

/// The warnings logged in this process.
fn warnings() -> &'static std::sync::Mutex<Vec<String>> {
    struct Capture(std::sync::Mutex<Vec<String>>);
    impl log::Log for Capture {
        fn enabled(&self, metadata: &log::Metadata) -> bool {
            metadata.level() <= log::Level::Warn
        }
        fn log(&self, record: &log::Record) {
            if self.enabled(record.metadata()) {
                self.0.lock().unwrap().push(record.args().to_string());
            }
        }
        fn flush(&self) {}
    }
    static CAPTURE: std::sync::OnceLock<&'static Capture> = std::sync::OnceLock::new();
    let capture = CAPTURE.get_or_init(|| {
        let capture: &'static Capture = Box::leak(Box::new(Capture(std::sync::Mutex::default())));
        let _ = log::set_logger(capture);
        log::set_max_level(log::LevelFilter::Warn);
        capture
    });
    &capture.0
}

// Expected (D6): a configured native library is not logged as a skipped TypeScript plugin; a TypeScript target is.
#[test]
fn only_a_target_without_a_native_build_is_logged_as_skipped() {
    let warnings = warnings();
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let file = config.join(format!("native.{}", std::env::consts::DLL_EXTENSION));
    write(&file, "id=native");
    let (native, typescript) = (file.to_string_lossy().into_owned(), format!("{}/typescript.ts", config.display()));
    let registry = Registry::define(Vec::new(), [native.as_str(), typescript.as_str()]);
    let configured = registry.skipped().into_iter().map(|target| Configured { target, options: None }).collect();
    let loader =
        Loader::new(Rc::new(Fake::default()) as Rc<dyn Backend>, config, root.path().to_path_buf(), configured);
    loader.reconcile(&dynamic(&host()), &registry);
    let skipped: Vec<String> = warnings
        .lock()
        .unwrap()
        .iter()
        .filter(|line| line.contains(&*root.path().to_string_lossy()))
        .cloned()
        .collect();
    assert_eq!(skipped, [format!("plugin {typescript} skipped: {SKIPPED}")]);
}

// Expected (r2 review, bigboi-ui-5): changed `plugins` entries apply while running, as TS reconciles on
// `config.data.plugins`: changed options load the build again with them, a removed entry unloads, and the directives
// enable and disable plugins again.
#[test]
fn changed_plugin_entries_reconcile_while_running() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let file = root.path().join(format!("extra.{}", std::env::consts::DLL_EXTENSION));
    write(&file, "id=extra");
    let target = file.to_string_lossy().into_owned();
    let host = host();
    let registry = Registry::define(vec![Definition::new("b", |_| {})], [target.as_str()]);
    registry.activate(&dynamic(&host));
    let fake = Rc::new(Fake::default());
    let configured = registry.skipped().into_iter().map(|target| Configured { target, options: None }).collect();
    let loader = Loader::new(fake.clone() as Rc<dyn Backend>, config, root.path().to_path_buf(), configured);
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!(fake.active.get(), 1);
    let status = |id: &str| registry.entries().into_iter().find(|entry| entry.id == id).map(|entry| entry.status);

    let options = Some(r#"{"a":1}"#.to_owned());
    assert_eq!(registry.set_targets(&dynamic(&host), [target.as_str()]), std::slice::from_ref(&target));
    loader.set_configured(vec![Configured { target: target.clone(), options: options.clone() }]);
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!(fake.options.borrow().last(), Some(&options));
    assert_eq!((fake.active.get(), status("extra")), (1, Some(Status::Active)));

    assert!(registry.set_targets(&dynamic(&host), ["-b"]).is_empty());
    loader.set_configured(Vec::new());
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!((fake.active.get(), status("extra")), (0, None));
    assert_eq!(status("b"), Some(Status::Inactive));

    registry.set_targets(&dynamic(&host), []);
    assert_eq!(status("b"), Some(Status::Active));
}

/// A project `repo` (with `.git`) as the working directory, and the global config directory beside it.
struct Project {
    root: opencode_util::temp::TempDir,
}

impl Project {
    fn new() -> Self {
        let root = opencode_util::temp::tempdir().unwrap();
        fs::create_dir_all(root.path().join("repo/.git")).unwrap();
        Self { root }
    }

    fn config(&self) -> std::path::PathBuf {
        self.root.path().join("config")
    }

    fn repo(&self) -> std::path::PathBuf {
        self.root.path().join("repo")
    }

    fn store(&self) -> std::path::PathBuf {
        self.root.path().join("state").join(approval::FILE)
    }

    /// The project's plugins directory, one component at a time: a target is the path the loader finds, so on Windows
    /// its separators are all `\`.
    fn plugins(&self) -> std::path::PathBuf {
        self.repo().join(".opencode").join("plugins")
    }

    /// The global plugin `global`'s directory.
    fn global(&self) -> std::path::PathBuf {
        self.config().join("plugins").join("global")
    }

    /// Writes the build of the project plugin `name` and returns its target.
    fn plugin(&self, name: &str, text: &str) -> String {
        let dir = self.plugins().join(name);
        write(&dir.join(entry_file()), text);
        dir.to_string_lossy().into_owned()
    }

    /// The decisions of one client, in the store this project's clients share.
    fn approvals(&self) -> approval::Approvals {
        let approvals = approval::Approvals::open(self.store(), &self.repo());
        assert_eq!(approvals.unsaved(), None);
        approvals
    }

    fn loader(&self, backend: Rc<dyn Backend>, configured: Vec<Configured>) -> Loader {
        Loader::new(backend, self.config(), self.repo(), configured).with_approvals(self.approvals())
    }
}

fn asked(host: &TestHost) -> Vec<String> {
    host.toasts
        .borrow()
        .iter()
        .filter_map(|toast| toast.title.clone())
        .filter(|title| title.contains("approval"))
        .collect()
}

/// The user's answer on the build of `target` the loader holds back now, as the plugin manager gives it.
fn answer(loader: &Loader, target: &str, decision: approval::Decision) -> bool {
    let shown = loader.held(target).and_then(Result::ok).expect("a build is held back");
    loader.decide(target, &shown, decision).unwrap()
}

fn library(target: &str) -> std::path::PathBuf {
    std::path::Path::new(target).join(entry_file())
}

// Expected (rich-plugins 3.9, O-125): a build in a project's `.opencode/plugins` is not opened until the user approves
// it, and it is listed pending; the host asks once a build. The approval names the place and the bytes: it lasts across
// clients, and a changed library is pending again, which stops the running build.
#[test]
fn a_project_plugin_waits_for_an_approval_of_its_artifact() {
    let project = Project::new();
    write(&project.config().join(format!("plugins/global/{}", entry_file())), "id=global");
    let target = project.plugin("proj", "id=proj");
    let (host, registry, fake) = (host(), Registry::define(Vec::new(), []), Rc::new(Fake::default()));
    let loader = project.loader(fake.clone(), Vec::new());
    let status = || entry(&registry.entries(), &target).status.clone();

    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!((status(), fake.loads.get(), fake.active.get()), (Status::Pending, 1, 1));
    assert_eq!(asked(&host), [format!("Plugin needs approval: {target}")]);
    assert!(!loader.reconcile(&dynamic(&host), &registry));
    assert_eq!(asked(&host).len(), 1);

    assert_eq!(loader.held("elsewhere"), None);
    assert!(answer(&loader, &target, approval::Decision::Approved));
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!((status(), fake.loads.get(), fake.active.get()), (Status::Active, 2, 2));
    assert_eq!(loader.held(&target), None);
    let fresh = project.loader(Rc::new(Fake::default()), Vec::new());
    let other = Registry::define(Vec::new(), []);
    fresh.reconcile(&dynamic(&host), &other);
    assert_eq!(entry(&other.entries(), &target).status, Status::Active);

    // The library is replaced after the approval: it stops, and the host asks again.
    write(&library(&target), "id=proj2");
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!((status(), fake.loads.get(), fake.active.get()), (Status::Pending, 2, 1));
    assert_eq!(asked(&host).len(), 2);

    // A declined build is listed so and not asked about again, also by another client.
    assert!(answer(&loader, &target, approval::Decision::Declined));
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!(status(), Status::Declined);
    let fresh = project.loader(Rc::new(Fake::default()), Vec::new());
    fresh.reconcile(&dynamic(&host), &Registry::define(Vec::new(), []));
    assert_eq!((asked(&host).len(), fake.loads.get()), (2, 2));

    // The same bytes in another plugin directory are another artifact.
    let copy = project.plugin("copy", "id=proj2");
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!(entry(&registry.entries(), &copy).status, Status::Pending);

    // A removed project plugin leaves the list, and is asked about again when it comes back; so is a removed library.
    let before = asked(&host).len();
    fs::remove_dir_all(&copy).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert!(!registry.entries().iter().any(|entry| entry.target.as_deref() == Some(&*copy)));
    project.plugin("copy", "id=copy");
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(asked(&host).len(), before + 1);
    fs::remove_file(library(&copy)).unwrap();
    loader.reconcile(&dynamic(&host), &registry);
    project.plugin("copy", "id=copy");
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(asked(&host).len(), before + 2);
}

// Expected (bigboi-1, carbon-1): an answer names the build the user was shown. When the library is replaced while the
// question is open and the watcher reconciles first, neither answer records anything, and the new build is asked
// about; the build shown is not approved by it either.
#[test]
fn an_answer_records_nothing_for_a_build_replaced_while_it_was_asked() {
    for decision in [approval::Decision::Approved, approval::Decision::Declined] {
        let project = Project::new();
        let target = project.plugin("proj", "id=a");
        let (host, registry, fake) = (host(), Registry::define(Vec::new(), []), Rc::new(Fake::default()));
        let loader = project.loader(fake.clone(), Vec::new());
        loader.reconcile(&dynamic(&host), &registry);
        let shown = loader.held(&target).unwrap().unwrap();
        write(&library(&target), "id=b");
        loader.reconcile(&dynamic(&host), &registry);
        assert_eq!(asked(&host).len(), 2);
        assert_eq!(loader.decide(&target, &shown, decision), Ok(false));
        loader.reconcile(&dynamic(&host), &registry);
        assert_eq!(entry(&registry.entries(), &target).status, Status::Pending, "{decision:?}");
        // The build shown comes back: nothing was recorded for it.
        write(&library(&target), "id=a");
        loader.reconcile(&dynamic(&host), &registry);
        assert_eq!((entry(&registry.entries(), &target).status.clone(), fake.loads.get()), (Status::Pending, 0));
        assert!(!project.store().exists());
    }
}

// Expected (final review big-boi 9): when the library is replaced while the question is open and the answer comes
// before the watcher's reconcile, neither answer saves anything, for the build shown or the new one; the reconcile
// after asks about the new build, and the build shown, when it comes back, is still pending.
#[test]
fn an_answer_before_the_watcher_saves_nothing_for_a_changed_build() {
    for decision in [approval::Decision::Approved, approval::Decision::Declined] {
        let project = Project::new();
        let target = project.plugin("proj", "id=a");
        let (host, registry, fake) = (host(), Registry::define(Vec::new(), []), Rc::new(Fake::default()));
        let loader = project.loader(fake.clone(), Vec::new());
        loader.reconcile(&dynamic(&host), &registry);
        let shown = loader.held(&target).unwrap().unwrap();
        write(&library(&target), "id=b");
        assert_eq!(loader.decide(&target, &shown, decision), Ok(false), "{decision:?}");
        assert!(!project.store().exists(), "{decision:?}: a decision was saved");
        loader.reconcile(&dynamic(&host), &registry);
        assert_eq!(entry(&registry.entries(), &target).status, Status::Pending, "{decision:?}");
        assert_eq!(asked(&host).len(), 2, "{decision:?}: the new build is asked about");
        write(&library(&target), "id=a");
        loader.reconcile(&dynamic(&host), &registry);
        assert_eq!((entry(&registry.entries(), &target).status.clone(), fake.loads.get()), (Status::Pending, 0));
        // The same build unchanged is saved, as before.
        let again = loader.held(&target).unwrap().unwrap();
        assert_eq!(loader.decide(&target, &again, decision), Ok(true), "{decision:?}");
        assert!(project.store().exists(), "{decision:?}");
    }
}

// Expected (bigboi-1): a directory link retargeted while the question is open is another build too.
#[cfg(unix)]
#[test]
fn an_answer_records_nothing_for_a_directory_retargeted_while_it_was_asked() {
    let project = Project::new();
    let (a, b) = (project.root.path().join("a"), project.root.path().join("b"));
    write(&a.join(entry_file()), "id=a");
    write(&b.join(entry_file()), "id=a");
    let plugins = project.plugins();
    fs::create_dir_all(&plugins).unwrap();
    std::os::unix::fs::symlink(&a, plugins.join("p")).unwrap();
    let target = plugins.join("p").to_string_lossy().into_owned();
    let (host, registry) = (host(), Registry::define(Vec::new(), []));
    let loader = project.loader(Rc::new(Fake::default()), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    let shown = loader.held(&target).unwrap().unwrap();
    fs::remove_file(plugins.join("p")).unwrap();
    std::os::unix::fs::symlink(&b, plugins.join("p")).unwrap();
    loader.reconcile(&dynamic(&host), &registry);
    assert_ne!(loader.held(&target).unwrap().unwrap().path, shown.path);
    assert_eq!(loader.decide(&target, &shown, approval::Decision::Approved), Ok(false));
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(entry(&registry.entries(), &target).status, Status::Pending);
}

// Expected (bigboi-3): a build that names a dependency the project would supply is refused before the backend opens
// it, also once approved; a build that names only system libraries loads.
#[test]
fn a_build_that_names_a_project_dependency_is_refused_before_it_opens() {
    let project = Project::new();
    let target = project.plugin("proj", "id=proj");
    fs::create_dir_all(project.global()).unwrap();
    let elf = deps::elf64(&["libc.so.6"], Some("lib"));
    fs::write(project.config().join(format!("plugins/global/{}", entry_file())), elf).unwrap();
    let (host, registry, fake) = (host(), Registry::define(Vec::new(), []), Rc::new(Fake::default()));
    let loader = project.loader(fake.clone(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    let global = project.global().to_string_lossy().into_owned();
    let Status::Failed(error) = entry(&registry.entries(), &global).status.clone() else { panic!() };
    assert!(error.contains("current directory"), "{error}");
    assert_eq!(fake.loads.get(), 0);
    // The approved project build names an absolute path outside the system's libraries.
    fs::write(library(&target), deps::elf64(&["/opt/libx.so"], None)).unwrap();
    loader.reconcile(&dynamic(&host), &registry);
    assert!(answer(&loader, &target, approval::Decision::Approved));
    loader.reconcile(&dynamic(&host), &registry);
    let Status::Failed(error) = entry(&registry.entries(), &target).status.clone() else { panic!() };
    assert!(error.contains("outside the system"), "{error}");
    assert_eq!(fake.loads.get(), 0);
}

// Expected (final review big-boi 11): under a crash guard, a build whose identity the run record cannot hold is not
// opened, with an error that says what to do; a build at a short path beside it loads.
#[test]
fn a_build_the_crash_record_cannot_name_is_not_opened() {
    let project = Project::new();
    let deep = ["a", "b", "c"].iter().fold(project.root.path().to_path_buf(), |path, part| path.join(part.repeat(200)));
    write(&deep.join(entry_file()), "id=deep");
    write(&project.config().join(format!("plugins/short/{}", entry_file())), "id=short");
    let (host, registry, fake) = (host(), Registry::define(Vec::new(), []), Rc::new(Fake::default()));
    let dir = opencode_util::temp::tempdir().unwrap();
    registry.monitor().attach(std::sync::Arc::new(crate::contain::Record::create(dir.path()).unwrap())).unwrap();
    let target = deep.to_string_lossy().into_owned();
    let loader = project.loader(fake.clone(), vec![Configured { target: target.clone(), options: None }]);
    loader.reconcile(&dynamic(&host), &registry);
    let Status::Failed(error) = entry(&registry.entries(), &target).status.clone() else { panic!() };
    assert!(error.contains("crash guard cannot name this build"), "{error}");
    let short = project.config().join("plugins").join("short").to_string_lossy().into_owned();
    assert_eq!(entry(&registry.entries(), &short).status, Status::Active);
    assert_eq!(fake.loads.get(), 1, "the deep build was opened");
}

// Expected (final re-review big-boi 11): a build whose ID is too long for the run record, at a short path, is named
// there by its target and digest, so it loads; removed and restored with the same bytes, it is the same build and
// loads again, also while the record keeps its slot from before.
#[test]
fn the_same_build_with_a_long_id_loads_again_after_it_comes_back() {
    let project = Project::new();
    let library = project.config().join(format!("plugins/long/{}", entry_file()));
    let id = format!("id={}", "x".repeat(crate::contain::record::NAME_BYTES));
    write(&library, &id);
    let (host, registry, fake) = (host(), Registry::define(Vec::new(), []), Rc::new(Fake::default()));
    let dir = opencode_util::temp::tempdir().unwrap();
    registry.monitor().attach(std::sync::Arc::new(crate::contain::Record::create(dir.path()).unwrap())).unwrap();
    let target = project.config().join("plugins").join("long").to_string_lossy().into_owned();
    let loader = project.loader(fake.clone(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(entry(&registry.entries(), &target).status, Status::Active, "the first load");
    // Its activation names its slot with its ID, as a native or linked setup does (`Setup::artifact`); the record
    // cannot hold it beside the target, and keeps the build's target and digest.
    let long = crate::contain::Artifact::external(&id["id=".len()..], &target, &build_of(&id));
    registry.monitor().slot(&long);
    fs::remove_file(&library).unwrap();
    loader.reconcile(&dynamic(&host), &registry);
    write(&library, &id);
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(entry(&registry.entries(), &target).status, Status::Active, "the same bytes again");
    assert_eq!(fake.loads.get(), 2);
}

// Expected (final re-review big-boi 3, on every platform): a build whose quarantine the system cannot read is not
// opened: a global one fails with the reason the user sees in the manager, and an approved project one is held back,
// also once approved; with the attribute readable again, each loads.
#[test]
fn a_build_whose_quarantine_cannot_be_read_is_not_opened() {
    let project = Project::new();
    write(&project.config().join(format!("plugins/global/{}", entry_file())), "id=global");
    let (host, registry, fake) = (host(), Registry::define(Vec::new(), []), Rc::new(Fake::default()));
    let loader = project.loader(fake.clone(), Vec::new());
    let global = project.global().to_string_lossy().into_owned();
    quarantine::fail_next_read(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
    loader.reconcile(&dynamic(&host), &registry);
    let Status::Failed(error) = entry(&registry.entries(), &global).status.clone() else { panic!() };
    assert!(error.contains("cannot read its quarantine"), "{error}");
    assert_eq!(fake.loads.get(), 0, "the global build was opened");
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(entry(&registry.entries(), &global).status, Status::Active, "readable again");
    // A project's build: approved, then its attribute cannot be read.
    let project = Project::new();
    let target = project.plugin("proj", "id=proj");
    let (registry, fake) = (Registry::define(Vec::new(), []), Rc::new(Fake::default()));
    let loader = project.loader(fake.clone(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    assert!(answer(&loader, &target, approval::Decision::Approved));
    quarantine::fail_next_read(std::io::Error::other("an I/O error"));
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(entry(&registry.entries(), &target).status, Status::Pending, "an approved build whose quarantine fails");
    assert_eq!(fake.loads.get(), 0, "the project build was opened");
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(entry(&registry.entries(), &target).status, Status::Active);
}

// Expected: an approved build that fails is told again when it comes back after a spell as pending, as a new failure.
#[test]
fn a_failure_after_a_pending_spell_is_told_again() {
    let project = Project::new();
    let target = project.plugin("proj", "boom");
    let (host, registry) = (host(), Registry::define(Vec::new(), []));
    let loader = project.loader(Rc::new(Fake::default()), Vec::new());
    let failed = || {
        let title = format!("Plugin failed: {target}");
        host.toasts.borrow().iter().filter(|toast| toast.title.as_deref() == Some(&*title)).count()
    };
    loader.reconcile(&dynamic(&host), &registry);
    assert!(answer(&loader, &target, approval::Decision::Approved));
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(failed(), 1);
    write(&library(&target), "id=proj");
    loader.reconcile(&dynamic(&host), &registry);
    write(&library(&target), "boom");
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!((failed(), entry(&registry.entries(), &target).status.clone()), (2, Status::Failed("boom".to_owned())));
}

// Expected (3.9, carbon-1): an approval names the plugin directory and the library's real path. Another plugin
// directory that links to the approved library (another project's) is asked about on its own, and so is the same
// directory once it links to another file with the same bytes.
#[cfg(unix)]
#[test]
fn an_approval_names_its_directory_and_the_real_path() {
    let project = Project::new();
    let real = project.root.path().join("real");
    write(&real.join(entry_file()), "id=real");
    let plugins = project.plugins();
    fs::create_dir_all(&plugins).unwrap();
    std::os::unix::fs::symlink(&real, plugins.join("a")).unwrap();
    let (host, registry) = (host(), Registry::define(Vec::new(), []));
    let loader = project.loader(Rc::new(Fake::default()), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    let a = plugins.join("a").to_string_lossy().into_owned();
    assert_eq!(loader.held(&a).unwrap().unwrap().path, fs::canonicalize(real.join(entry_file())).unwrap());
    assert!(answer(&loader, &a, approval::Decision::Approved));
    std::os::unix::fs::symlink(&real, plugins.join("b")).unwrap();
    loader.reconcile(&dynamic(&host), &registry);
    let b = plugins.join("b").to_string_lossy().into_owned();
    assert_eq!(entry(&registry.entries(), &a).status, Status::Active);
    assert_eq!(entry(&registry.entries(), &b).status, Status::Pending);
    let copy = project.root.path().join("copy");
    write(&copy.join(entry_file()), "id=real");
    fs::remove_file(plugins.join("a")).unwrap();
    std::os::unix::fs::symlink(&copy, plugins.join("a")).unwrap();
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(entry(&registry.entries(), &a).status, Status::Pending);
}

// Expected (3.9, carbon-4, bigboi-6): a `cli.json` entry that names a project's plugin needs no approval, however it
// names it: the directory, the library itself, or a link to either. The plugin is listed once.
#[test]
fn a_project_plugin_named_in_cli_json_needs_no_approval() {
    let project = Project::new();
    let target = project.plugin("proj", "id=proj");
    // A link to the directory, where links can be made without privileges.
    let link = project.root.path().join("link");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&target, &link).unwrap();
    let linked = link.exists().then(|| link.to_string_lossy().into_owned());
    let spellings = [target.clone(), library(&target).to_string_lossy().into_owned()].into_iter().chain(linked);
    for spelling in spellings {
        let (host, registry) = (host(), Registry::define(Vec::new(), [spelling.as_str()]));
        let configured = registry.skipped().into_iter().map(|target| Configured { target, options: None }).collect();
        let loader = project.loader(Rc::new(Fake::default()), configured);
        loader.reconcile(&dynamic(&host), &registry);
        let entries = registry.entries();
        assert_eq!(entry(&entries, &spelling).status, Status::Active, "{spelling}");
        assert_eq!(entries.len(), 1, "{spelling}: {entries:?}");
        assert!(asked(&host).is_empty(), "{spelling}");
    }
}

// Expected (3.9): a pending plugin claims nothing, so a pending build with a built-in's ID does not replace the
// built-in, and does not take an ID another plugin then cannot have.
#[test]
fn a_pending_plugin_replaces_no_built_in_and_takes_no_id() {
    let project = Project::new();
    let target = project.plugin("proj", "id=b");
    write(&project.config().join(format!("plugins/global/{}", entry_file())), "id=proj");
    let host = host();
    let registry = Registry::define(vec![Definition::new("b", |_| {})], []);
    registry.activate(&dynamic(&host));
    let loader = project.loader(Rc::new(Fake::default()), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    let entries = registry.entries();
    assert_eq!(
        (entries[0].id.as_str(), entries[0].source, &entries[0].status),
        ("b", Source::Builtin, &Status::Active)
    );
    assert_eq!(entry(&entries, &target).status, Status::Pending);
    assert!(entries.iter().any(|entry| entry.id == "proj" && entry.status == Status::Active), "{entries:?}");
}

/// Whether this process is root, which reads and writes whatever the modes say.
#[cfg(unix)]
fn root() -> bool {
    std::fs::metadata("/proc/self").is_ok_and(|metadata| std::os::unix::fs::MetadataExt::uid(&metadata) == 0)
}

// Expected (bigboi-8, carbon-5): an approved, running project plugin whose library cannot be read any more stops, and
// is pending without a question or a failure report; an unapproved one that cannot be read is quiet too, and offers
// nothing to approve.
#[cfg(unix)]
#[test]
fn a_project_plugin_that_cannot_be_read_stops_quietly() {
    if root() {
        return;
    }
    use std::os::unix::fs::PermissionsExt;
    let project = Project::new();
    let target = project.plugin("proj", "id=proj");
    let (host, registry, fake) = (host(), Registry::define(Vec::new(), []), Rc::new(Fake::default()));
    let loader = project.loader(fake.clone(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    assert!(answer(&loader, &target, approval::Decision::Approved));
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(fake.active.get(), 1);
    fs::set_permissions(library(&target), fs::Permissions::from_mode(0o000)).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!((entry(&registry.entries(), &target).status.clone(), fake.active.get()), (Status::Pending, 0));
    assert!(loader.held(&target).unwrap().is_err());
    let titles: Vec<_> = host.toasts.borrow().iter().filter_map(|toast| toast.title.clone()).collect();
    assert_eq!(titles, [format!("Plugin needs approval: {target}")]);
    let unread = project.plugin("unread", "id=unread");
    fs::set_permissions(library(&unread), fs::Permissions::from_mode(0o000)).unwrap();
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(entry(&registry.entries(), &unread).status, Status::Pending);
    assert_eq!(host.toasts.borrow().len(), 1);
}

// Expected (carbon-5): a library over the limit is refused before it is read: a project's is held back with the reason,
// and another is failed.
#[test]
fn a_library_over_the_limit_is_not_read() {
    let project = Project::new();
    let target = project.plugin("proj", "");
    fs::File::options().write(true).open(library(&target)).unwrap().set_len(approval::LIMIT + 1).unwrap();
    let global = project.global();
    write(&global.join(entry_file()), "");
    fs::File::options().write(true).open(global.join(entry_file())).unwrap().set_len(approval::LIMIT + 1).unwrap();
    let (host, registry, fake) = (host(), Registry::define(Vec::new(), []), Rc::new(Fake::default()));
    let loader = project.loader(fake.clone(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    assert!(loader.held(&target).unwrap().unwrap_err().contains("larger than 512 MiB"));
    let Status::Failed(error) = entry(&registry.entries(), &global.to_string_lossy()).status.clone() else { panic!() };
    assert!(error.contains("larger than 512 MiB"), "{error}");
    assert_eq!(fake.loads.get(), 0);
}

// Expected (bigboi-8): a project plugin whose library goes between the reconcile's first look and its own turn stops
// in that reconcile.
#[test]
fn a_project_library_gone_in_the_middle_of_a_reconcile_stops_its_plugin() {
    let project = Project::new();
    let target = project.plugin("b", "id=b");
    let (host, registry, fake) = (host(), Registry::define(Vec::new(), []), Rc::new(Fake::default()));
    let loader = project.loader(fake.clone(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    assert!(answer(&loader, &target, approval::Decision::Approved));
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(fake.active.get(), 1);
    // A plugin reconciled first removes it as it loads, after the reconcile's first look found it.
    let first = project.plugin("a", "id=a");
    loader.reconcile(&dynamic(&host), &registry);
    assert!(answer(&loader, &first, approval::Decision::Approved));
    let gone = library(&target);
    *fake.during.borrow_mut() = Some(Box::new(move || drop(fs::remove_file(&gone))));
    loader.reconcile(&dynamic(&host), &registry);
    assert!(!library(&target).exists());
    assert!(!registry.entries().iter().any(|entry| entry.id == "b"), "{:?}", registry.entries());
    assert_eq!(fake.active.get(), 1);
}

/// An artifact at `path` with `sha256`, for the store's tests.
fn artifact(path: &std::path::Path, sha256: &str) -> approval::Artifact {
    let target = path.parent().unwrap().to_path_buf();
    approval::Artifact { target, path: path.to_path_buf(), sha256: sha256.into(), script: false }
}

// Expected (bigboi-4, carbon-3): two clients that decide at once on different plugins lose nothing: each update reads,
// changes and replaces the store under its lock.
#[test]
fn concurrent_clients_keep_each_others_decisions() {
    let project = Project::new();
    let store = project.store();
    let repo = project.repo();
    let threads: Vec<_> = (0..2)
        .map(|client| {
            let (store, repo) = (store.clone(), repo.clone());
            std::thread::spawn(move || {
                let approvals = approval::Approvals::open(store, &repo);
                for index in 0..40 {
                    let path = std::path::PathBuf::from(format!("/c{client}/p{index}/plugin.so"));
                    // A busy store says so, and the user answers again.
                    while let Err(error) = approvals.decide(&artifact(&path, "aa"), approval::Decision::Approved) {
                        assert!(error.contains("another opencode holds it"), "{error}");
                    }
                }
            })
        })
        .collect();
    threads.into_iter().for_each(|thread| thread.join().unwrap());
    let approvals = project.approvals();
    for (client, index) in (0..2).flat_map(|client| (0..40).map(move |index| (client, index))) {
        let path = std::path::PathBuf::from(format!("/c{client}/p{index}/plugin.so"));
        assert_eq!(approvals.decision(&artifact(&path, "aa")), Some(approval::Decision::Approved), "{path:?}");
    }
    let left: Vec<_> = fs::read_dir(store.parent().unwrap())
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".tmp"))
        .collect();
    assert!(left.is_empty(), "{left:?}");
}

// Expected (bigboi-4): a decision another client replaced stays replaced when this client saves another one.
#[test]
fn a_replaced_decision_stays_replaced() {
    let project = Project::new();
    let (one, two) = (project.approvals(), project.approvals());
    let path = std::path::Path::new("/p/plugin.so");
    one.decide(&artifact(path, "aa"), approval::Decision::Approved).unwrap();
    two.decide(&artifact(path, "bb"), approval::Decision::Declined).unwrap();
    one.decide(&artifact(std::path::Path::new("/q/plugin.so"), "cc"), approval::Decision::Approved).unwrap();
    assert_eq!(one.decision(&artifact(path, "aa")), None);
    assert_eq!(one.decision(&artifact(path, "bb")), Some(approval::Decision::Declined));
    // Opposite answers for one artifact: the last one saved holds.
    two.decide(&artifact(path, "bb"), approval::Decision::Approved).unwrap();
    assert_eq!(one.decision(&artifact(path, "bb")), Some(approval::Decision::Approved));
}

// Expected (bigboi-7, carbon-3): a path that is not Unicode is kept exactly, with either answer, and the other
// decisions stay; the store is private to the user.
#[cfg(unix)]
#[test]
fn a_path_that_is_not_unicode_is_kept_with_the_others() {
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::PermissionsExt;
    let project = Project::new();
    let approvals = project.approvals();
    let other = artifact(std::path::Path::new("/other/plugin.so"), "aa");
    approvals.decide(&other, approval::Decision::Approved).unwrap();
    let odd = std::path::Path::new(std::ffi::OsStr::from_bytes(b"/odd\xff/plugin.so"));
    let close = std::path::Path::new(std::ffi::OsStr::from_bytes(b"/odd\xfe/plugin.so"));
    for decision in [approval::Decision::Declined, approval::Decision::Approved] {
        approvals.decide(&artifact(odd, "bb"), decision).unwrap();
        assert_eq!(project.approvals().decision(&artifact(odd, "bb")), Some(decision));
        assert_eq!(project.approvals().decision(&artifact(close, "bb")), None);
        assert_eq!(project.approvals().decision(&other), Some(approval::Decision::Approved));
    }
    assert_eq!(fs::metadata(project.store()).unwrap().permissions().mode() & 0o777, 0o600);
}

// Expected (bigboi-7, carbon-3): a store that cannot be written or read keeps what it holds, says why, and approves
// nothing; a store that others could write, or a link, is not trusted.
#[cfg(unix)]
#[test]
fn a_store_that_fails_keeps_what_it_holds_and_approves_nothing() {
    if root() {
        return;
    }
    use std::os::unix::fs::PermissionsExt;
    let project = Project::new();
    let approvals = project.approvals();
    let kept = artifact(std::path::Path::new("/kept/plugin.so"), "aa");
    approvals.decide(&kept, approval::Decision::Approved).unwrap();
    let before = fs::read(project.store()).unwrap();
    let state = project.store().parent().unwrap().to_path_buf();
    fs::set_permissions(&state, fs::Permissions::from_mode(0o500)).unwrap();
    let new = artifact(std::path::Path::new("/new/plugin.so"), "bb");
    assert!(approvals.decide(&new, approval::Decision::Approved).is_err());
    fs::set_permissions(&state, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!((fs::read(project.store()).unwrap(), approvals.decision(&new)), (before.clone(), None));
    // Not a list: nothing is approved, and nothing is written over it.
    fs::write(project.store(), "not json").unwrap();
    assert_eq!(approvals.decision(&kept), None);
    assert!(approvals.decide(&new, approval::Decision::Declined).is_err());
    assert_eq!(fs::read(project.store()).unwrap(), b"not json");
    // Writable by others, or a link: not trusted.
    fs::write(project.store(), &before).unwrap();
    assert_eq!(approvals.decision(&kept), Some(approval::Decision::Approved));
    fs::set_permissions(project.store(), fs::Permissions::from_mode(0o666)).unwrap();
    assert_eq!(approvals.decision(&kept), None);
    fs::set_permissions(project.store(), fs::Permissions::from_mode(0o600)).unwrap();
    let elsewhere = project.root.path().join("elsewhere.json");
    fs::rename(project.store(), &elsewhere).unwrap();
    std::os::unix::fs::symlink(&elsewhere, project.store()).unwrap();
    assert_eq!(approvals.decision(&kept), None);
}

// Expected (bigboi-2): decisions are not saved where the project could reach them, nor in a relative or shared state
// directory; they last as long as the client then, and the reason is given.
#[test]
fn a_store_the_project_could_reach_is_not_used() {
    let project = Project::new();
    let inside = approval::Approvals::open(project.repo().join("state").join(approval::FILE), &project.repo());
    assert!(inside.unsaved().unwrap().contains("inside the project"), "{:?}", inside.unsaved());
    let relative = approval::Approvals::open(std::path::PathBuf::from("state").join(approval::FILE), &project.repo());
    assert!(relative.unsaved().unwrap().contains("not an absolute path"), "{:?}", relative.unsaved());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let shared = project.root.path().join("shared");
        fs::create_dir_all(&shared).unwrap();
        fs::set_permissions(&shared, fs::Permissions::from_mode(0o777)).unwrap();
        let open = approval::Approvals::open(shared.join(approval::FILE), &project.repo());
        assert!(open.unsaved().unwrap().contains("other users can write it"), "{:?}", open.unsaved());
    }
    // In memory, a decision still holds for this client.
    let shown = artifact(std::path::Path::new("/p/plugin.so"), "aa");
    inside.decide(&shown, approval::Decision::Approved).unwrap();
    assert_eq!(inside.decision(&shown), Some(approval::Decision::Approved));
    assert!(!project.repo().join("state").join(approval::FILE).exists());
    assert_eq!(project.approvals().unsaved(), None);
}

// Expected (bigboi-1, bigboi-5): what is loaded is what was hashed. A library rewritten in place between the hash and
// the read is refused; the same bytes read again pass.
#[test]
fn bytes_changed_after_the_hash_are_refused() {
    let project = Project::new();
    let target = project.plugin("proj", "id=a");
    let (artifact, mut handle) = approval::Artifact::open(std::path::Path::new(&target), &library(&target)).unwrap();
    assert_eq!(artifact.bytes(&mut handle).unwrap(), b"id=a");
    let mut file = fs::OpenOptions::new().write(true).open(library(&target)).unwrap();
    std::io::Write::write_all(&mut file, b"id=b").unwrap();
    assert!(artifact.bytes(&mut handle).unwrap_err().contains("changed since it was hashed"));
}

// Expected (carbon-3): an entry a newer client wrote, which this one cannot read, stays when this one saves.
#[test]
fn an_entry_this_client_cannot_read_stays() {
    let project = Project::new();
    let approvals = project.approvals();
    fs::write(project.store(), r#"[{"future": 1}]"#).unwrap();
    approvals.decide(&artifact(std::path::Path::new("/p/plugin.so"), "aa"), approval::Decision::Approved).unwrap();
    let stored: serde_json::Value = serde_json::from_slice(&fs::read(project.store()).unwrap()).unwrap();
    assert_eq!(stored[0], serde_json::json!({ "future": 1 }), "{stored}");
    assert_eq!(stored.as_array().unwrap().len(), 2);
}

// Expected (bigboi-2, carbon-3): a store that is not a regular file, such as a FIFO, is not opened, so nothing waits on
// it; a temporary file another client left does not stop a save; the state directory made is private.
#[cfg(unix)]
#[test]
fn the_store_is_a_private_regular_file() {
    use std::os::unix::fs::PermissionsExt;
    let project = Project::new();
    let approvals = project.approvals();
    let state = project.store().parent().unwrap().to_path_buf();
    assert_eq!(fs::metadata(&state).unwrap().permissions().mode() & 0o777, 0o700);
    let made = std::process::Command::new("mkfifo").arg(project.store()).status().unwrap();
    assert!(made.success());
    let shown = artifact(std::path::Path::new("/p/plugin.so"), "aa");
    assert_eq!(approvals.decision(&shown), None);
    assert!(approvals.decide(&shown, approval::Decision::Approved).is_err());
    fs::remove_file(project.store()).unwrap();
    fs::write(state.join(format!(".{}.tmp", approval::FILE)), "left").unwrap();
    approvals.decide(&shown, approval::Decision::Approved).unwrap();
    assert_eq!(approvals.decision(&shown), Some(approval::Decision::Approved));
}

// Expected (bigboi-5): a library whose name leads to another file by the time its hash is done is not identified, so
// nothing is held for approval under the wrong path.
#[cfg(unix)]
#[test]
fn a_link_retargeted_while_it_is_hashed_is_not_identified() {
    let project = Project::new();
    let (a, b) = (project.root.path().join("a"), project.root.path().join("b"));
    write(&a.join(entry_file()), "id=a");
    write(&b.join(entry_file()), "id=a");
    let plugins = project.plugins();
    fs::create_dir_all(&plugins).unwrap();
    std::os::unix::fs::symlink(&a, plugins.join("p")).unwrap();
    let link = plugins.join("p");
    let swap = link.clone();
    approval::AFTER_HASH.set(Some(Box::new(move || {
        fs::remove_file(&swap).unwrap();
        std::os::unix::fs::symlink(&b, &swap).unwrap();
    })));
    let opened = approval::Artifact::open(&link, &link.join(entry_file()));
    approval::AFTER_HASH.set(None);
    assert!(opened.unwrap_err().contains("changed while it was read"));
}

// Expected (bigboi-1): an approved build rewritten in place between its hash and its read is not loaded, and is held
// back without a build to approve until it is read again.
#[test]
fn an_approved_build_rewritten_while_it_loads_is_held_back() {
    let project = Project::new();
    let target = project.plugin("proj", "id=a");
    let (host, registry, fake) = (host(), Registry::define(Vec::new(), []), Rc::new(Fake::default()));
    let loader = project.loader(fake.clone(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    assert!(answer(&loader, &target, approval::Decision::Approved));
    let file = library(&target);
    approval::AFTER_HASH.set(Some(Box::new(move || {
        let mut handle = fs::OpenOptions::new().write(true).open(&file).unwrap();
        std::io::Write::write_all(&mut handle, b"id=b").unwrap();
    })));
    loader.reconcile(&dynamic(&host), &registry);
    approval::AFTER_HASH.set(None);
    assert_eq!((entry(&registry.entries(), &target).status.clone(), fake.loads.get()), (Status::Pending, 0));
    assert!(loader.held(&target).unwrap().unwrap_err().contains("changed since it was hashed"));
}

// Expected (bigboi-4): another client approves a new build of a plugin this client runs; once the library changes, this
// client loads the new build without asking, as the decision allows.
#[test]
fn a_build_another_client_approved_replaces_the_running_one() {
    let project = Project::new();
    let target = project.plugin("proj", "id=a");
    let (host, registry, fake) = (host(), Registry::define(Vec::new(), []), Rc::new(Fake::default()));
    let loader = project.loader(fake.clone(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    assert!(answer(&loader, &target, approval::Decision::Approved));
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(entry(&registry.entries(), &target).id, "a");
    // The other client sees the new build first, and approves it.
    write(&library(&target), "id=b");
    let other = project.loader(Rc::new(Fake::default()), Vec::new());
    other.reconcile(&dynamic(&host), &Registry::define(Vec::new(), []));
    assert!(answer(&other, &target, approval::Decision::Approved));
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(entry(&registry.entries(), &target).id, "b");
    assert_eq!(fake.loads.get(), 2);
}

// Expected (bigboi-4): a save waits for a lock another client holds briefly, and succeeds once it is free.
#[test]
fn a_save_waits_for_a_lock_held_briefly() {
    let project = Project::new();
    let approvals = project.approvals();
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(project.store().with_file_name(format!("{}.lock", approval::FILE)))
        .unwrap();
    lock.lock().unwrap();
    let holder = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(100));
        drop(lock);
    });
    approvals.decide(&artifact(std::path::Path::new("/p/plugin.so"), "aa"), approval::Decision::Approved).unwrap();
    holder.join().unwrap();
}

// Expected (TS `mergePluginTargets`): a `cli.json` entry that names a global plugin's library is another target, as in
// TS; only a project's plugin is replaced by the entry that names it (carbon-4).
#[test]
fn a_cli_json_entry_for_a_global_library_is_another_target() {
    let project = Project::new();
    let global = project.global();
    write(&global.join(entry_file()), "id=global");
    let file = global.join(entry_file()).to_string_lossy().into_owned();
    let (host, registry) = (host(), Registry::define(Vec::new(), [file.as_str()]));
    let configured = registry.skipped().into_iter().map(|target| Configured { target, options: None }).collect();
    let loader = project.loader(Rc::new(Fake::default()), configured);
    loader.reconcile(&dynamic(&host), &registry);
    let entries = registry.entries();
    assert_eq!(entry(&entries, &global.to_string_lossy()).status, Status::Active);
    assert_eq!(entry(&entries, &file).status, Status::Failed("plugin ID global is already registered".to_owned()));
}

/// The digest the loader gives a build of `text` without options.
fn build_of(text: &str) -> String {
    let mut hasher = DefaultHasher::new();
    hasher.write(text.as_bytes());
    hasher.write(b"");
    format!("{:016x}", hasher.finish())
}

// Expected (synthesis 4.5; bigboi 1, 3): a build that crashed the client is never opened again: no load, no setup;
// the manager lists it failed with the reason. A reload of the same build and an unrelated `cli.json` edit leave it
// held; the user's enable lets it load and ends the entry; another build at the target loads and ends it too.
#[test]
fn a_crashed_build_is_never_opened_until_enabled_or_rebuilt() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let dir = config.join("plugins").join("fake");
    write(&dir.join(entry_file()), "id=fake");
    let target = dir.to_string_lossy().into_owned();
    let reason = "crashed the client in `render-slot` and is disabled";
    let crashed = crate::Crashed {
        id: "fake".to_owned(),
        target: target.clone(),
        digest: build_of("id=fake"),
        reason: reason.to_owned(),
    };
    let start = |crashed: Vec<crate::Crashed>| {
        let (host, fake) = (host(), Rc::new(Fake::default()));
        let registry = Registry::define(Vec::new(), []);
        let forgotten: Rc<RefCell<Vec<crate::Crashed>>> = Rc::default();
        let seen = forgotten.clone();
        registry.set_crashed(crashed, move |entry| {
            seen.borrow_mut().push(entry.clone());
            Ok(())
        });
        let loader =
            Loader::new(fake.clone() as Rc<dyn Backend>, config.clone(), root.path().to_path_buf(), Vec::new());
        (host, fake, registry, loader, forgotten)
    };
    let listed = |registry: &Registry| entry(&registry.entries(), &target).clone();

    let (host, fake, registry, loader, forgotten) = start(vec![crashed.clone()]);
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!((fake.loads.get(), fake.active.get()), (0, 0));
    assert_eq!((listed(&registry).id.as_str(), listed(&registry).status), ("fake", Status::Failed(reason.to_owned())));
    assert!(!loader.reconcile(&dynamic(&host), &registry));
    registry.set_targets(&dynamic(&host), ["other"]);
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(fake.loads.get(), 0, "a list edit does not let it run");
    assert_eq!(registry.toggle(&dynamic(&host), "fake", true), Some(Ok(())));
    assert_eq!(*forgotten.borrow(), std::slice::from_ref(&crashed));
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!((listed(&registry).status, fake.loads.get(), fake.active.get()), (Status::Active, 1, 1));

    // A new client: another build at the target is not the one that crashed.
    let (host, fake, registry, loader, forgotten) = start(vec![crashed.clone()]);
    write(&dir.join(entry_file()), "id=fake\n");
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!((listed(&registry).status, fake.loads.get()), (Status::Active, 1));
    assert_eq!(*forgotten.borrow(), [crashed]);
    assert!(registry.crashed().is_empty());
}

// Expected (review bigboi-3, P6b): a held build that shares its ID with a loaded built-in is named by its own key: its
// release leaves the built-in running and opens the build, where a toggle by the ID reaches the built-in. A release
// the crash list cannot record does not happen, and says why (the review's inherited finding).
#[test]
fn a_held_build_is_released_by_its_key_and_only_once_recorded() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let dir = config.join("plugins").join("fake");
    write(&dir.join(entry_file()), "id=fake");
    let target = dir.to_string_lossy().into_owned();
    let crashed = crate::Crashed {
        id: "builtin".to_owned(),
        target: target.clone(),
        digest: build_of("id=fake"),
        reason: "crashed the client in `run-command` and is disabled".to_owned(),
    };
    let (host, fake) = (host(), Rc::new(Fake::default()));
    let registry = Registry::define(vec![Definition::new("builtin", |_| {})], []);
    registry.activate(&dynamic(&host));
    let refuse = Rc::new(Cell::new(true));
    let refused = refuse.clone();
    registry
        .set_crashed(vec![crashed], move |_| if refused.get() { Err("the disk is full".to_owned()) } else { Ok(()) });
    let loader = Loader::new(fake.clone() as Rc<dyn Backend>, config.clone(), root.path().to_path_buf(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    let entries = registry.entries();
    let keys: Vec<(&str, &str)> = entries.iter().map(|entry| (entry.key.as_str(), entry.id.as_str())).collect();
    let held = Entry::held_key(&target);
    assert_eq!(keys, [("plugin:builtin", "builtin"), (held.as_str(), "builtin")]);
    let error = registry.toggle_entry(&dynamic(&host), &held, true).unwrap().unwrap_err();
    assert!(error.contains("the disk is full"), "{error}");
    assert!(registry.held(&target));
    refuse.set(false);
    assert_eq!(registry.toggle_entry(&dynamic(&host), &held, true), Some(Ok(())));
    assert!(!registry.held(&target) && registry.crashed().is_empty());
    let builtin = registry.entries().into_iter().find(|entry| entry.key == "plugin:builtin").unwrap();
    assert_eq!((builtin.status, builtin.active), (Status::Active, true));
    assert_eq!(registry.toggle_entry(&dynamic(&host), "target:nothing", true), None);
    assert_eq!(registry.toggle_entry(&dynamic(&host), &held, false), None);
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(fake.loads.get(), 1);
}

// Expected (synthesis 4.5; bigboi 1, 3): after a second crash that named no plugin, no external library is opened,
// not even to learn its ID: each is listed inactive by its target, the built-ins run, a rebuild or a list edit opens
// nothing, and the user enables them one at a time.
#[test]
fn safe_mode_opens_no_external_library() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    for name in ["one", "two"] {
        write(&config.join("plugins").join(name).join(entry_file()), &format!("id={name}"));
    }
    let target = |name: &str| config.join("plugins").join(name).to_string_lossy().into_owned();
    let (host, fake) = (host(), Rc::new(Fake::default()));
    let builtin = Definition::new("builtin", |_| {});
    let registry = Registry::define(vec![builtin], []);
    registry.activate(&dynamic(&host));
    registry.set_safe();
    let loader = Loader::new(fake.clone() as Rc<dyn Backend>, config.clone(), root.path().to_path_buf(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    let status = |name: &str| entry(&registry.entries(), &target(name)).status.clone();
    assert_eq!((status("one"), status("two"), fake.loads.get()), (Status::Inactive, Status::Inactive, 0));
    let builtin = registry.entries().into_iter().find(|entry| entry.id == "builtin").unwrap();
    assert_eq!(builtin.status, Status::Active);
    write(&config.join("plugins").join("one").join(entry_file()), "id=one\n");
    registry.set_targets(&dynamic(&host), ["x"]);
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(fake.loads.get(), 0);
    assert_eq!(registry.toggle(&dynamic(&host), &target("one"), true), Some(Ok(())));
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!((status("two"), fake.loads.get(), fake.active.get()), (Status::Inactive, 1, 1));
    let one = registry.entries().into_iter().find(|entry| entry.id == "one").unwrap();
    assert_eq!(one.status, Status::Active);
}

// Expected (bigboi 2): a client no parent guards opens no external library; the manager says to restart, and enabling
// it there is refused, since no restart could follow a crash.
#[test]
fn an_unsupervised_client_opens_no_external_library() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    write(&config.join("plugins").join("one").join(entry_file()), "id=one");
    let target = config.join("plugins").join("one").to_string_lossy().into_owned();
    let (host, fake) = (host(), Rc::new(Fake::default()));
    let registry = Registry::define(Vec::new(), []);
    registry.set_unsupervised("restart opencode-native to run it");
    let loader = Loader::new(fake.clone() as Rc<dyn Backend>, config, root.path().to_path_buf(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    let listed = entry(&registry.entries(), &target).clone();
    assert_eq!(
        (listed.status, listed.source, fake.loads.get()),
        (Status::Skipped("restart opencode-native to run it".into()), Source::Configured, 0)
    );
    assert_eq!(
        registry.toggle(&dynamic(&host), &target, true),
        Some(Err("restart opencode-native to run it".to_owned()))
    );
}

// Expected: the client runs under a parent only when a native build is among the targets: a discovered directory
// with one, or a configured local library; a directory without one, or a package, is none.
#[test]
fn a_native_build_among_the_targets_wants_a_parent() {
    let root = opencode_util::temp::tempdir().unwrap();
    let (config, cwd) = (root.path().join("config"), root.path().join("work"));
    fs::create_dir_all(config.join("plugins").join("empty")).unwrap();
    fs::create_dir_all(&cwd).unwrap();
    assert!(!has_native_build(&config, &cwd, &["@acme/tui"]));
    let library = root.path().join(format!("extra.{}", std::env::consts::DLL_EXTENSION));
    write(&library, "id=extra");
    assert!(has_native_build(&config, &cwd, &[library.to_str().unwrap()]));
    assert!(!has_native_build(&config, &cwd, &[]));
    write(&cwd.join(".opencode/plugins/local").join(entry_file()), "id=local");
    assert!(has_native_build(&config, &cwd, &[]));
}

// Expected (P4c on Pa): one gate decides whether a library opens, and a held target is listed once. In a new client, a
// project build the user approved and that then crashed the client is held as crashed, not opened, in one row; a new
// build of it waits for approval, in one row, pending, and is not opened either. In safe mode, a pending build the user
// approves is held in one row, inactive, not also pending.
#[test]
fn a_crashed_project_build_is_held_in_one_row() {
    let project = Project::new();
    let target = project.plugin("proj", "id=proj");
    let (host, registry, fake) = (host(), Registry::define(Vec::new(), []), Rc::new(Fake::default()));
    let loader = project.loader(fake.clone(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    let shown = loader.held(&target).and_then(Result::ok).expect("a build is held back");
    assert!(answer(&loader, &target, approval::Decision::Approved));
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(entry(&registry.entries(), &target).status, Status::Active);

    let reason = "crashed the client in `render-slot` and is disabled";
    let crashed = crate::Crashed {
        id: "proj".to_owned(),
        target: target.clone(),
        digest: build_of(&shown.sha256),
        reason: reason.to_owned(),
    };
    let (registry, fake) = (Registry::define(Vec::new(), []), Rc::new(Fake::default()));
    registry.set_crashed(vec![crashed], |_| Ok(()));
    let loader = project.loader(fake.clone(), Vec::new());
    let rows = |registry: &Registry| -> Vec<Status> {
        let entries = registry.entries();
        entries
            .into_iter()
            .filter(|entry| entry.target.as_deref() == Some(target.as_str()))
            .map(|entry| entry.status)
            .collect()
    };
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!((rows(&registry), fake.loads.get()), (vec![Status::Failed(reason.to_owned())], 0));
    write(&library(&target), "id=proj2");
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!((rows(&registry), fake.loads.get()), (vec![Status::Pending], 0));

    let (registry, fake) = (Registry::define(Vec::new(), []), Rc::new(Fake::default()));
    registry.set_safe();
    let loader = project.loader(fake.clone(), Vec::new());
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(rows(&registry), [Status::Pending]);
    assert!(answer(&loader, &target, approval::Decision::Approved));
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!((rows(&registry), fake.loads.get()), (vec![Status::Inactive], 0));
}

// Expected (the artifact of a project's TypeScript plugin, P7): its hash follows what its files hold and where they are,
// and a dependency's size; a save that changes nothing, a hidden file, and another time on a file of its own do not
// change it. A file that is not a directory is no such artifact.
#[test]
fn a_typescript_plugins_artifact_is_its_files() {
    let root = opencode_util::temp::tempdir().unwrap();
    let dir = root.path().join("probe");
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::create_dir_all(dir.join("node_modules/dep")).unwrap();
    std::fs::write(dir.join("tui.ts"), "export default {}\n").unwrap();
    std::fs::write(dir.join("src/a.ts"), "export const a = 1\n").unwrap();
    std::fs::write(dir.join("node_modules/dep/index.js"), "module.exports = 1\n").unwrap();
    let hash = || approval::Artifact::tree(&dir).unwrap().sha256;
    let first = hash();
    let artifact = approval::Artifact::tree(&dir).unwrap();
    assert!(artifact.script);
    assert_eq!(artifact.path, std::fs::canonicalize(&dir).unwrap());
    std::fs::write(dir.join("tui.ts"), "export default {}\n").unwrap();
    assert_eq!(hash(), first, "a save that changed nothing changed the hash");
    // A hidden file is a module the plugin may import (review carbon-1).
    std::fs::write(dir.join(".payload.ts"), "export const a = 1\n").unwrap();
    assert_ne!(hash(), first, "a hidden file kept the hash");
    std::fs::remove_file(dir.join(".payload.ts")).unwrap();
    std::fs::write(dir.join("src/a.ts"), "export const a = 2\n").unwrap();
    let changed = hash();
    assert_ne!(changed, first, "a changed file kept the hash");
    std::fs::rename(dir.join("src/a.ts"), dir.join("src/b.ts")).unwrap();
    assert_ne!(hash(), changed, "a moved file kept the hash");
    let moved = hash();
    std::fs::write(dir.join("node_modules/dep/index.js"), "module.exports = 2\n").unwrap();
    assert_ne!(hash(), moved, "a dependency changed in place, at its size, kept the hash");
    assert!(approval::Artifact::tree(&dir.join("tui.ts")).is_err());
}

// Expected (bigboi P8-1): a TypeScript plugin's approved files are staged as a copy named by their hash, made of the
// bytes it hashed: the copy's own hash is the approved one, a save after the approval is refused rather than copied,
// and a copy made before is used again.
#[test]
fn a_typescript_plugin_is_staged_only_as_it_was_approved() {
    let root = opencode_util::temp::tempdir().unwrap();
    let (dir, staging) = (root.path().join("probe"), root.path().join("staged"));
    std::fs::create_dir_all(dir.join("node_modules/dep")).unwrap();
    std::fs::write(dir.join("tui.ts"), "export default {}\n").unwrap();
    std::fs::write(dir.join("node_modules/dep/index.js"), "module.exports = 1\n").unwrap();
    let approved = approval::Artifact::tree(&dir).unwrap();
    let staged = approved.stage(&staging).unwrap();
    assert_eq!(staged, staging.join(&approved.sha256));
    assert_eq!(approval::Artifact::tree(&staged).unwrap().sha256, approved.sha256);
    assert_eq!(std::fs::read_to_string(staged.join("node_modules/dep/index.js")).unwrap(), "module.exports = 1\n");
    assert_eq!(approved.stage(&staging).unwrap(), staged);
    std::fs::write(dir.join("tui.ts"), "export default { saved: true }\n").unwrap();
    std::fs::remove_dir_all(&staged).unwrap();
    let refused = approved.stage(&staging).unwrap_err();
    assert!(refused.contains("changed since it was approved"), "{refused}");
    assert_eq!(std::fs::read_dir(&staging).unwrap().count(), 0, "a refused copy was left");
}

// Expected (carbon-2): a TypeScript plugin's subdirectories are watched, so a save of a module in one reloads it; its
// dependencies are not, as an install touches the directory itself.
#[test]
fn a_typescript_plugins_subdirectories_are_watched() {
    let project = Project::new();
    let dir = project.repo().join(".opencode/plugins/js");
    write(&dir.join("tui.ts"), "export default {}\n");
    write(&dir.join("src/deep/a.ts"), "export const a = 1\n");
    write(&dir.join("node_modules/dep/index.js"), "\n");
    let host = host();
    let scripts = crate::pipe::Scripts::new(crate::pipe::Config::new("bun".into()), &dynamic(&host));
    let loader = project.loader(Rc::new(Fake::default()), Vec::new()).with_scripts(scripts);
    let watched = loader.watch_dirs();
    assert!(watched.contains(&dir.join("src")) && watched.contains(&dir.join("src/deep")), "{watched:?}");
    assert!(!watched.iter().any(|watched| watched.starts_with(dir.join("node_modules"))), "{watched:?}");
}

// Expected (carbon-1): a `cli.json` entry that names a project's TypeScript plugin through a link replaces it, as one
// that names a library does: it is listed once, and needs no approval.
#[cfg(unix)]
#[test]
fn a_project_typescript_plugin_named_through_a_link_is_listed_once() {
    let project = Project::new();
    let dir = project.repo().join(".opencode/plugins/js");
    write(&dir.join("tui.ts"), "export default {}\n");
    let link = project.root.path().join("link");
    std::os::unix::fs::symlink(&dir, &link).unwrap();
    let configured = vec![Configured { target: link.to_string_lossy().into_owned(), options: None }];
    let targets = project.loader(Rc::new(Fake::default()), configured).targets();
    let named: Vec<(&str, bool)> = targets.iter().map(|target| (target.target.as_str(), target.project)).collect();
    assert_eq!(named, [(link.to_str().unwrap(), false)]);
}

// Expected (TS `context.tsx:663-665`, `Npm.resolve`, js-npm): with the JS host, a `cli.json` entry and a server
// plugin's TUI part that name an npm package resolve in the package cache, need no approval, and keep the generation
// they resolved to while they are targets, as TS resolves a loaded package once a session; a package is not watched.
// A server part the cache does not hold is left out, as TS leaves out an optional target. Without the JS host neither
// resolves, and server parts are not targets.
#[test]
fn a_package_resolves_once_in_the_npm_cache_and_is_not_watched() {
    let project = Project::new();
    let cache = project.root.path().join("cache");
    let install = |key: &str, generation: &str, name: &str| {
        let dir = cache.join("npm").join(key).join(generation).join("node_modules").join(name);
        write(
            &dir.join("package.json"),
            &format!(r#"{{ "name": "{name}", "exports": {{ "./tui": "./lib/tui.js" }} }}"#),
        );
        write(&dir.join("lib/tui.js"), "export default {}\n");
        dir
    };
    let first = install("tui-pkg@1.0.0", "10", "tui-pkg");
    let part = install("@s/part@latest", "3", "@s/part");
    let configured = vec![Configured { target: "tui-pkg@1.0.0".into(), options: None }];
    let off = project.loader(Rc::new(Fake::default()), configured.clone()).with_npm(cache.clone());
    off.set_server(vec!["@s/part".into(), "not-cached@1".into()]);
    assert_eq!(off.targets().into_iter().map(|target| target.local).collect::<Vec<_>>(), [None]);
    let host = host();
    let scripts = crate::pipe::Scripts::new(crate::pipe::Config::new("bun".into()), &dynamic(&host));
    let loader = project.loader(Rc::new(Fake::default()), configured).with_npm(cache.clone()).with_scripts(scripts);
    loader.set_server(vec!["@s/part".into(), "not-cached@1".into()]);
    let resolved = |loader: &Loader| {
        loader.targets().into_iter().map(|target| (target.target, target.local, target.project)).collect::<Vec<_>>()
    };
    let expected = vec![
        ("@s/part".to_owned(), Some(part.clone()), false),
        ("tui-pkg@1.0.0".to_owned(), Some(first.clone()), false),
    ];
    assert_eq!(resolved(&loader), expected);
    install("tui-pkg@1.0.0", "11", "tui-pkg");
    assert_eq!(resolved(&loader), expected, "a later install moved the package");
    let watched = loader.watch_dirs();
    assert!(!watched.iter().any(|dir| dir.starts_with(&cache)), "{watched:?}");
}
