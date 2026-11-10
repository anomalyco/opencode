use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::fs;
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
pub(super) struct TestHost {
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
}

/// A fetch's reply.
pub(super) type Reply = Box<dyn FnOnce(Result<serde_json::Value, String>)>;

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
}

impl Host for TestHost {
    fn app(&self) -> &App {
        &self.app
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

    fn dialog(&self, id: &str, dialog: abi::Dialog) {
        self.dialogs.borrow_mut().push((id.to_owned(), dialog));
    }
}

impl TestHost {
    /// Calls the event handlers with `event`, as the host's event loop would.
    pub fn emit(&self, event: &abi::types::V2Event) {
        let handlers = self.events.borrow().clone();
        handlers.iter().for_each(|handler| handler(event));
    }

    /// Answers every fetch sent so far with `{"name": <its path>}`, as the server would.
    pub fn reply(&self) {
        let fetches = std::mem::take(&mut *self.fetches.borrow_mut());
        for (fetch, reply) in fetches {
            reply(Ok(serde_json::json!({ "name": fetch.path })));
        }
    }
}

pub(super) fn host() -> Rc<TestHost> {
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
    })
}

/// `host` as the registry takes it.
pub(super) fn dynamic(host: &Rc<TestHost>) -> Rc<dyn Host> {
    host.clone()
}

pub(super) fn entry<'a>(entries: &'a [Entry], target: &str) -> &'a Entry {
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
}

impl Backend for Fake {
    fn load(&self, _: &Rc<dyn Host>, library: &[u8], options: Option<&str>) -> Result<(Definition, ErrorFn), String> {
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

#[test]
fn reconcile_loads_reloads_keeps_and_unloads() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let lib_dir = config.join("plugins/fake");
    let ts_dir = config.join("plugins/typescript");
    fs::create_dir_all(&ts_dir).unwrap();
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
    assert_eq!(entry(&entries, &ts_target).status, Status::Skipped(SKIPPED.to_owned()));
    assert_eq!(entry(&entries, "@acme/tui").status, Status::Skipped(SKIPPED.to_owned()));
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
    assert_eq!(entry(&entries, &lib_target).status, Status::Skipped(SKIPPED.to_owned()));
    assert!(!entries.iter().any(|entry| entry.id == "fake2"));
    assert_eq!(fake.active.get(), 1);

    // Deleted directories leave the list, whether they were skipped or loaded.
    fs::remove_dir_all(&lib_dir).unwrap();
    fs::remove_dir_all(&ts_dir).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let entries = registry.entries();
    let gone = |entry: &Entry| entry.target.as_ref().is_some_and(|target| [&lib_target, &ts_target].contains(&target));
    assert!(!entries.iter().any(gone), "{entries:?}");
    assert_eq!(entry(&entries, "@acme/tui").status, Status::Skipped(SKIPPED.to_owned()));
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
    fs::remove_dir_all(config.join("plugins/a")).unwrap();
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
    let target = config.join("plugins/b").to_string_lossy().into_owned();
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
    fs::remove_dir_all(config.join("plugins/a")).unwrap();
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
