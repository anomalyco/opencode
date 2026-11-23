use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use opencode_ui::dialog::DialogKeymap;
use opencode_ui::keymap::{Keybinds, Options};
use opencode_ui::theme::{Catalog, Theme, ThemeMode};
use opentui::prelude::*;
use opentui::testing::TestApp;

use opencode_plugin_abi::types::{ModelRef, SessionInfo, SessionMessageInfo};

use super::*;
use crate::{Entry, abi};

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
    /// The small verbs the plugins asked for, as text, in the order the host ran them.
    pub verbs: RefCell<Vec<String>>,
    /// The handlers of [`Host::on_deltas`], which [`TestHost::emit_deltas`] calls.
    pub deltas: Rc<RefCell<Vec<crate::Deltas>>>,
    /// The replies of the programs run in the foreground, which [`TestHost::exit`] delivers.
    pub programs: RefCell<Vec<(Alive, Reply)>>,
    /// The plugins' input: their layers, listeners, pointer capture and pastes.
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

    // Fixed facts, so a transcript that reads them is the same on any machine: an hour east of UTC, a locale, and the
    // host's own measure, which reads no environment.
    fn info(&self) -> abi::Info {
        abi::Info { locale: Some("nb-NO".to_owned()), ..abi::Info::default() }
    }

    fn utc_offset(&self, _at: i64) -> i32 {
        3_600
    }

    fn measure(&self, text: &str) -> abi::Measure {
        crate::facts::measure(&self.host.app, text)
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

    fn on_event(
        &self,
        _: crate::EventKinds,
        run: Rc<dyn Fn(&abi::types::V2Event)>,
    ) -> Option<opentui::keymap::Disposer> {
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
    fn verb(&self, verb: String) {
        self.verbs.borrow_mut().push(verb);
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
    // `\` is no separator here: `..\x` names a package, which the cache refuses.
    assert_eq!(local_source(r"..\x", dir), None);
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
    // Windows' own relative forms, which climb no further than a `/` form does.
    assert_eq!(local_source(r".\plugins\x", dir), Some(r"C:\Users\me\.config\opencode\plugins\x".into()));
    assert_eq!(local_source(r"..\..\..\x", dir), Some(r"C:\Users\x".into()));
    assert_eq!(local_source("/abs/x", dir), Some(r"C:\abs\x".into()));
    assert_eq!(local_source(r"\abs\x", dir), Some(r"C:\abs\x".into()));
    assert_eq!(local_source(r"D:\abs\x", dir), Some(r"D:\abs\x".into()));
    assert_eq!(local_source("C:x", dir), None);
    assert_eq!(local_source("file:///D:/abs/y.wasm", dir), Some(r"D:\abs\y.wasm".into()));
    assert_eq!(local_source("@acme/opencode-tui", dir), None);
    assert_eq!(local_source("file:///D:/a/My%20Plugin", dir), Some(r"D:\a\My Plugin".into()));
    assert_eq!(local_source("file:///D:/a/b/../c", dir), Some(r"D:\a\c".into()));
    // Expected (win11-runs D2): a verbatim spelling names the same directory, handed on without its prefix.
    assert_eq!(local_source(r"\\?\D:\abs\x", dir), Some(r"D:\abs\x".into()));
    assert_eq!(local_source(r"\\?\D:\abs\x\..\y", dir), Some(r"D:\abs\y".into()));
    assert_eq!(local_source(r"\\?\UNC\server\share\x", dir), Some(r"\\server\share\x".into()));
}

#[test]
fn a_verbatim_path_is_handed_on_plain() {
    for (path, plain_path) in [
        (r"\\?\C:\w11\deep\plug", r"C:\w11\deep\plug"),
        (r"\\?\UNC\server\share\plug", r"\\server\share\plug"),
        (r"C:\w11\deep\plug", r"C:\w11\deep\plug"),
        ("/home/me/plug", "/home/me/plug"),
    ] {
        assert_eq!(super::plain(PathBuf::from(path)), PathBuf::from(plain_path), "{path}");
    }
}

#[test]
fn watch_dirs_cover_a_plugins_directory_made_later() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let project = root.path().join("repo");
    let cwd = project.join("a");
    fs::create_dir_all(project.join(".git")).unwrap();
    fs::create_dir_all(&cwd).unwrap();
    let loader = Loader::new(config, cwd.clone(), Vec::new());
    let dirs = loader.watch_dirs();
    assert!(dirs.contains(&cwd) && dirs.contains(&project), "{dirs:?}");
    fs::create_dir_all(cwd.join(".opencode")).unwrap();
    assert!(loader.watch_dirs().contains(&cwd.join(".opencode")));
    fs::create_dir_all(cwd.join(".opencode/plugins")).unwrap();
    let dirs = loader.watch_dirs();
    assert!(dirs.contains(&cwd.join(".opencode/plugins")) && !dirs.contains(&cwd), "{dirs:?}");
}

/// The records of level info and above logged in this process, once this was first called.
pub(crate) fn logged() -> &'static std::sync::Mutex<Vec<String>> {
    struct Capture(std::sync::Mutex<Vec<String>>);
    impl log::Log for Capture {
        fn enabled(&self, metadata: &log::Metadata) -> bool {
            metadata.level() <= log::Level::Info
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
        log::set_max_level(log::LevelFilter::Info);
        capture
    });
    &capture.0
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

    fn loader(&self, configured: Vec<Configured>) -> Loader {
        Loader::new(self.config(), self.repo(), configured).with_approvals(self.approvals())
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

/// Whether this process is root, which reads and writes whatever the modes say.
#[cfg(unix)]
fn root() -> bool {
    std::fs::metadata("/proc/self").is_ok_and(|metadata| std::os::unix::fs::MetadataExt::uid(&metadata) == 0)
}

/// An artifact at `path` with `sha256`, for the store's tests.
fn artifact(path: &std::path::Path, sha256: &str) -> approval::Artifact {
    let target = path.parent().unwrap().to_path_buf();
    approval::Artifact { target, path: path.to_path_buf(), sha256: sha256.into() }
}

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

#[test]
fn a_verbatim_spelling_is_the_same_place() {
    let project = Project::new();
    let approvals = project.approvals();
    let plain = std::path::Path::new(r"C:\p\.opencode\plugins\x\plugin.dll");
    let verbatim = std::path::Path::new(r"\\?\C:\p\.opencode\plugins\x\plugin.dll");
    let other = std::path::Path::new(r"C:\q\.opencode\plugins\x\plugin.dll");
    approvals.decide(&artifact(plain, "aa"), approval::Decision::Approved).unwrap();
    assert_eq!(approvals.decision(&artifact(verbatim, "aa")), Some(approval::Decision::Approved));
    assert_eq!(approvals.decision(&artifact(other, "aa")), None);
    approvals.decide(&artifact(verbatim, "aa"), approval::Decision::Declined).unwrap();
    assert_eq!(approvals.decision(&artifact(plain, "aa")), Some(approval::Decision::Declined));
}

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
    assert_eq!(artifact.path, std::fs::canonicalize(&dir).unwrap());
    std::fs::write(dir.join("tui.ts"), "export default {}\n").unwrap();
    assert_eq!(hash(), first, "a save that changed nothing changed the hash");
    // A hidden file is a module the plugin may import.
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

#[cfg(feature = "ts")]
#[test]
fn a_typescript_plugins_subdirectories_are_watched() {
    let project = Project::new();
    let dir = project.repo().join(".opencode/plugins/js");
    write(&dir.join("tui.ts"), "export default {}\n");
    write(&dir.join("src/deep/a.ts"), "export const a = 1\n");
    write(&dir.join("node_modules/dep/index.js"), "\n");
    let host = host();
    let scripts = crate::pipe::Scripts::new(crate::pipe::Config::new("bun".into()), &dynamic(&host));
    let loader = project.loader(Vec::new()).with_scripts(scripts);
    let watched = loader.watch_dirs();
    assert!(watched.contains(&dir.join("src")) && watched.contains(&dir.join("src/deep")), "{watched:?}");
    assert!(!watched.iter().any(|watched| watched.starts_with(dir.join("node_modules"))), "{watched:?}");
}

#[cfg(unix)]
#[test]
fn a_project_typescript_plugin_named_through_a_link_is_listed_once() {
    let project = Project::new();
    let dir = project.repo().join(".opencode/plugins/js");
    write(&dir.join("tui.ts"), "export default {}\n");
    let link = project.root.path().join("link");
    std::os::unix::fs::symlink(&dir, &link).unwrap();
    let configured = vec![Configured { target: link.to_string_lossy().into_owned(), options: None }];
    let targets = project.loader(configured).targets();
    let named: Vec<(&str, bool)> = targets.iter().map(|target| (target.target.as_str(), target.project)).collect();
    assert_eq!(named, [(link.to_str().unwrap(), false)]);
}

#[cfg(feature = "ts")]
#[test]
fn a_package_resolves_once_in_the_npm_cache_and_is_not_watched() {
    let project = Project::new();
    // A package resolves to its real path: the temporary directory's may be an 8.3 name (GitHub's Windows runner).
    fs::create_dir_all(project.root.path().join("cache")).unwrap();
    let cache = real(&project.root.path().join("cache")).unwrap();
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
    let off = project.loader(configured.clone()).with_npm(cache.clone());
    let parts = || {
        vec![
            ServerPart::Package { spec: "@s/part".into(), id: None },
            ServerPart::Package { spec: "not-cached@1".into(), id: None },
        ]
    };
    off.set_server(parts(), vec!["@s/part".into()]);
    assert_eq!(off.targets().into_iter().map(|target| target.local).collect::<Vec<_>>(), [None]);
    let host = host();
    let scripts = crate::pipe::Scripts::new(crate::pipe::Config::new("bun".into()), &dynamic(&host));
    let loader = project.loader(configured).with_npm(cache.clone()).with_scripts(scripts);
    loader.set_server(parts(), vec!["@s/part".into()]);
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

#[cfg(feature = "ts")]
#[test]
fn only_the_users_own_configuration_vouches_for_a_server_part() {
    let project = Project::new();
    let cache = project.root.path().join("cache");
    for spec in ["user-pkg@1.0.0", "cli-pkg@2.0.0", "project-pkg@1.0.0", "versioned@2.0.0"] {
        let name = spec.split('@').next().unwrap();
        write(
            &cache.join("npm").join(spec).join("5").join("node_modules").join(name).join("tui.ts"),
            "export default {}\n",
        );
    }
    let global = project.config().join("plugins").join("mine");
    write(&global.join("tui.ts"), "export default {}\n");
    let named = project.root.path().join("dev").join("named");
    write(&named.join("tui.ts"), "export default {}\n");
    let other = project.root.path().join("dev").join("other");
    write(&other.join("tui.ts"), "export default {}\n");
    let host = host();
    let scripts = crate::pipe::Scripts::new(crate::pipe::Config::new("bun".into()), &dynamic(&host));
    let configured = vec![Configured { target: "cli-pkg@2.0.0".into(), options: None }];
    let loader = project.loader(configured).with_npm(cache).with_scripts(scripts);
    let package = |spec: &str| ServerPart::Package { spec: spec.into(), id: None };
    let local = |path: &Path| ServerPart::Local { path: path.to_string_lossy().into_owned(), id: None };
    let parts = vec![
        package("user-pkg@1.0.0"),
        package("project-pkg@1.0.0"),
        package("cli-pkg@2.0.0"),
        package("versioned@2.0.0"),
        local(&global),
        local(&named),
        local(&other),
    ];
    let user = vec!["user-pkg@1.0.0".into(), "versioned@1.0.0".into(), named.to_string_lossy().into_owned()];
    loader.set_server(parts, user);
    let held: Vec<(String, bool)> =
        loader.targets().into_iter().map(|target| (target.target, target.project)).collect();
    let path = |path: &Path| path.to_string_lossy().into_owned();
    assert_eq!(
        held,
        [
            (path(&global), false),
            ("user-pkg@1.0.0".to_owned(), false),
            ("project-pkg@1.0.0".to_owned(), true),
            ("versioned@2.0.0".to_owned(), true),
            (path(&named), false),
            (path(&other), true),
            // `cli.json`'s own, in its place: the server's part for the same package is left out (recheck-2).
            ("cli-pkg@2.0.0".to_owned(), false),
        ]
    );
}

/// The loader on the JS host, with the npm cache under `project`, holding `specs` (each `name@version`).
#[cfg(feature = "ts")]
fn server_loader(project: &Project, configured: Vec<Configured>, specs: &[&str]) -> Loader {
    let cache = project.root.path().join("cache");
    for spec in specs {
        let name = spec.rsplit_once('@').map_or(*spec, |(name, _)| name);
        write(
            &cache.join("npm").join(spec).join("5").join("node_modules").join(name).join("tui.ts"),
            "export default {}\n",
        );
    }
    let scripts = crate::pipe::Scripts::new(crate::pipe::Config::new("bun".into()), &dynamic(&host()));
    project.loader(configured).with_npm(cache).with_scripts(scripts)
}

/// Whether each target needs approval, by target.
#[cfg(feature = "ts")]
#[cfg(unix)]
fn approvals(loader: &Loader) -> Vec<(String, bool)> {
    loader.targets().into_iter().map(|target| (target.target, target.project)).collect()
}

#[cfg(feature = "ts")]
#[cfg(unix)]
#[test]
fn only_a_direct_child_of_a_global_plugins_directory_is_vouched_for() {
    let project = Project::new();
    let legit = project.global();
    write(&legit.join("tui.ts"), "export default {}\n");
    let subdep = legit.join("node_modules").join("subdep");
    write(&subdep.join("tui.ts"), "export default {}\n");
    let elsewhere = project.root.path().join("dev").join("linked");
    write(&elsewhere.join("tui.ts"), "export default {}\n");
    let linked = project.config().join("plugins").join("linked");
    std::os::unix::fs::symlink(&elsewhere, &linked).unwrap();
    let removed = project.config().join("plugins").join("removed");
    write(&removed.join("tui.ts"), "export default {}\n");
    let loader = server_loader(&project, Vec::new(), &[]);
    let path = |path: &Path| path.to_string_lossy().into_owned();
    let parts = [&subdep, &linked, &removed].map(|dir| ServerPart::Local { path: path(dir), id: None });
    loader.set_server(parts.to_vec(), vec![format!("-{}", path(&removed))]);
    let held = approvals(&loader);
    let of = |dir: &Path| held.iter().find(|(target, _)| *target == path(dir)).map(|(_, project)| *project);
    assert_eq!(of(&subdep), Some(true), "{held:?}");
    // The discovered plugins themselves are global; the server's parts for them are those targets.
    assert_eq!(of(&linked), Some(false), "{held:?}");
    assert_eq!(of(&legit), Some(false), "{held:?}");
    let direct = loader.vouched(&[], &path(&linked), real(&linked).as_deref(), None);
    let deep = loader.vouched(&[], &path(&subdep), real(&subdep).as_deref(), None);
    let gone = loader.vouched(&[format!("-{}", path(&removed))], &path(&removed), real(&removed).as_deref(), None);
    assert_eq!((direct, deep, gone), (true, false, false));
}

#[cfg(feature = "ts")]
#[cfg(unix)]
#[test]
fn a_server_part_and_a_cli_json_entry_for_one_directory_are_one_target() {
    let project = Project::new();
    let dir = project.root.path().join("dev").join("part");
    write(&dir.join("tui.ts"), "export default {}\n");
    let link = project.root.path().join("link");
    std::os::unix::fs::symlink(&dir, &link).unwrap();
    let options = Some(r#"{"from":"cli"}"#.to_owned());
    let entry = Configured { target: link.to_string_lossy().into_owned(), options: options.clone() };
    let loader = server_loader(&project, vec![entry], &[]);
    let user = vec![link.to_string_lossy().into_owned()];
    for reported in [&link, &dir] {
        loader.set_server(
            vec![ServerPart::Local { path: reported.to_string_lossy().into_owned(), id: None }],
            user.clone(),
        );
        let targets: Vec<_> =
            loader.targets().into_iter().map(|target| (target.target, target.options, target.project)).collect();
        assert_eq!(targets, [(link.to_string_lossy().into_owned(), options.clone(), false)], "{reported:?}");
    }
}

#[test]
fn a_real_path_has_no_verbatim_prefix() {
    for (path, plain_path) in [
        (r"\\?\C:\Users\runneradmin\p", r"C:\Users\runneradmin\p"),
        (r"\\?\UNC\srv\share\p", r"\\srv\share\p"),
        (r"C:\Users\p", r"C:\Users\p"),
        ("/home/me/p", "/home/me/p"),
    ] {
        assert_eq!(plain(PathBuf::from(path)), PathBuf::from(plain_path), "{path}");
    }
}

#[cfg(feature = "ts")]
#[cfg(windows)]
#[test]
fn windows_paths_reach_the_js_host_without_a_verbatim_prefix() {
    let project = Project::new();
    let loader = server_loader(&project, Vec::new(), &["pkg@1.0.0"]);
    let dir = project.root.path().join("dev").join("part");
    write(&dir.join("tui.ts"), "export default {}\n");
    let parts = vec![
        ServerPart::Package { spec: "pkg@1.0.0".into(), id: None },
        ServerPart::Local { path: dir.to_string_lossy().into_owned(), id: None },
    ];
    loader.set_server(parts, Vec::new());
    for target in loader.targets() {
        let local = target.local.unwrap().to_string_lossy().into_owned();
        assert!(!local.starts_with(r"\\?\"), "{local}");
    }
}

#[cfg(feature = "ts")]
#[test]
fn a_typescript_plugin_without_bun_says_bun_is_missing() {
    let project = Project::new();
    write(&project.global().join("tui.ts"), "export default {}\n");
    let target = project.global().to_string_lossy().into_owned();
    let host = host();
    let config = crate::pipe::Config {
        find: Some(crate::pipe::Find(Rc::new(|| None))),
        ..crate::pipe::Config::new(Default::default())
    };
    let scripts = crate::pipe::Scripts::new(config, &dynamic(&host));
    for (scripts, reason) in [(Some(scripts), crate::SKIPPED_NO_BUN), (None, crate::SKIPPED_JS_OFF)] {
        let registry = Registry::define(Vec::new(), []);
        let loader = project.loader(Vec::new());
        let loader = match scripts {
            Some(scripts) => loader.with_scripts(scripts),
            None => loader,
        };
        loader.reconcile(&dynamic(&host), &registry);
        assert_eq!(entry(&registry.entries(), &target).status, Status::Skipped(reason.to_owned()));
    }
}

#[cfg(not(feature = "ts"))]
#[test]
fn a_build_without_ts_says_it_has_no_typescript_plugin_support() {
    let project = Project::new();
    write(&project.global().join("tui.ts"), "export default {}\n");
    let native = project.plugin("native", "id=native");
    let configured = vec![Configured { target: "tui-pkg@1.0.0".into(), options: None }];
    let (host, registry) = (host(), Registry::define(Vec::new(), []));
    project.loader(configured).reconcile(&dynamic(&host), &registry);
    let skipped = Status::Skipped(crate::SKIPPED_NO_TS.to_owned());
    assert_eq!(entry(&registry.entries(), &project.global().to_string_lossy()).status, skipped);
    assert_eq!(entry(&registry.entries(), "tui-pkg@1.0.0").status, skipped);
    assert_eq!(entry(&registry.entries(), &native).status, Status::Skipped(crate::SKIPPED_NATIVE.to_owned()));
}

#[cfg(not(luau))]
#[test]
fn a_build_without_luau_says_it_has_no_luau_plugin_support() {
    let project = Project::new();
    write(&project.global().join("plugin.toml"), "id = \"hello\"\n");
    let native = project.plugin("native", "id=native");
    let (host, registry) = (host(), Registry::define(Vec::new(), []));
    project.loader(Vec::new()).reconcile(&dynamic(&host), &registry);
    let skipped = Status::Skipped(crate::SKIPPED_NO_LUAU.to_owned());
    assert_eq!(entry(&registry.entries(), &project.global().to_string_lossy()).status, skipped);
    assert_eq!(entry(&registry.entries(), &native).status, Status::Skipped(crate::SKIPPED_NATIVE.to_owned()));
}

#[test]
fn a_native_library_is_skipped_and_never_asked_about() {
    let project = Project::new();
    let native = project.plugin("native", "id=native");
    write(&project.global().join(entry_file()), "id=global");
    let global = project.global().to_string_lossy().into_owned();
    let configured = vec![Configured { target: "./elsewhere/plugin.so".into(), options: None }];
    let (host, registry) = (host(), Registry::define(Vec::new(), []));
    let loader = project.loader(configured);
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let skipped = Status::Skipped(crate::SKIPPED_NATIVE.to_owned());
    assert_eq!(entry(&registry.entries(), &native).status, skipped, "a project's build is not asked about");
    assert_eq!(entry(&registry.entries(), &global).status, skipped);
    assert!(asked(&host).is_empty() && loader.held(&native).is_none());
    assert!(matches!(loader.found(&native), Some(Found::Refused(error)) if error.contains(crate::SKIPPED_NATIVE)));
    assert!(!loader.reconcile(&dynamic(&host), &registry), "a second reconcile changes nothing");
}

/// `text` as the transcript draws Markdown: in the host's theme, with the registry's fence renderers.
pub(crate) fn fence_view(host: &dyn Host, registry: &crate::Registry, text: &str) -> opentui::widget::Markdown {
    let theme = host.theme();
    let syntax = opencode_ui::code::syntax_theme(&theme);
    let renderers = registry.code_blocks({
        let theme = theme.clone();
        Rc::new(move || theme.clone())
    });
    opencode_ui::markdown::view(host.app(), &theme, &syntax, &renderers, true, false).set_markdown(text)
}
