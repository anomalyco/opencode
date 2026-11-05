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

use super::*;
use crate::{Entry, Source, Toast};

/// A host that records what plugins ask of it.
pub(super) struct TestHost {
    pub app: TestApp,
    keymap: DialogKeymap,
    pub storage: RefCell<HashMap<String, String>>,
    pub toasts: RefCell<Vec<(Toast, Option<String>, String)>>,
    pub routes: RefCell<Vec<(String, String)>>,
    pub remounts: Cell<usize>,
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

    fn storage_read(&self, key: &str) -> Option<String> {
        self.storage.borrow().get(key).cloned()
    }

    fn storage_write(&self, key: &str, json: &str) -> Result<(), String> {
        self.storage.borrow_mut().insert(key.to_owned(), json.to_owned());
        Ok(())
    }

    fn toast(&self, variant: Toast, title: Option<&str>, message: &str) {
        let title = title.map(str::to_owned);
        self.toasts.borrow_mut().push((variant, title, message.to_owned()));
    }

    fn open_route(&self, id: &str, name: &str) {
        self.routes.borrow_mut().push((id.to_owned(), name.to_owned()));
    }

    fn remount(&self) {
        self.remounts.set(self.remounts.get() + 1);
    }
}

pub(super) fn host() -> Rc<TestHost> {
    Rc::new(TestHost {
        app: TestApp::new(60, 10),
        keymap: DialogKeymap::new(Keybinds::defaults(), Options::default()),
        storage: RefCell::default(),
        toasts: RefCell::default(),
        routes: RefCell::default(),
        remounts: Cell::new(0),
    })
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
}

impl Backend<TestHost> for Fake {
    fn load(&self, library: &[u8], options: Option<&str>) -> Result<(Definition<TestHost>, ErrorFn), String> {
        self.loads.set(self.loads.get() + 1);
        let text = String::from_utf8_lossy(library).into_owned();
        let id = text.strip_prefix("id=").ok_or(text.clone())?.trim().to_owned();
        assert_eq!(options, None);
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
    let root = tempfile::tempdir().unwrap();
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
    let root = tempfile::tempdir().unwrap();
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
}

#[test]
fn reconcile_loads_reloads_keeps_and_unloads() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config");
    let lib_dir = config.join("plugins/fake");
    let ts_dir = config.join("plugins/typescript");
    fs::create_dir_all(&ts_dir).unwrap();
    write(&lib_dir.join(entry_file()), "id=fake");
    let file = root.path().join(format!("extra.{}", std::env::consts::DLL_EXTENSION));
    write(&file, "id=extra");
    let host = host();
    let registry = Registry::<TestHost>::new(Vec::new(), [file.to_str().unwrap(), "@acme/tui"]);
    let fake = Rc::new(Fake::default());
    let configured = registry.skipped().into_iter().map(|target| Configured { target, options: None }).collect();
    let loader =
        Loader::new(fake.clone() as Rc<dyn Backend<TestHost>>, config.clone(), root.path().to_path_buf(), configured);
    let lib_target = lib_dir.to_string_lossy().into_owned();
    let file_target = file.to_string_lossy().into_owned();
    let ts_target = ts_dir.to_string_lossy().into_owned();

    assert!(loader.reconcile(&host, &registry));
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
    assert!(!loader.reconcile(&host, &registry));
    assert_eq!(fake.loads.get(), 2);

    // A broken build keeps the running version and says so.
    write(&lib_dir.join(entry_file()), "boom");
    assert!(loader.reconcile(&host, &registry));
    let entries = registry.entries();
    assert_eq!(entry(&entries, &lib_target).status, Status::Failed("boom (previous version still active)".to_owned()));
    assert_eq!(fake.active.get(), 2);
    // The same broken build is not retried.
    assert!(!loader.reconcile(&host, &registry));
    assert_eq!(fake.loads.get(), 3);

    // A fixed build replaces it in place, under its new ID.
    write(&lib_dir.join(entry_file()), "id=fake2");
    assert!(loader.reconcile(&host, &registry));
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
    assert!(loader.reconcile(&host, &registry));
    let entries = registry.entries();
    assert_eq!(entry(&entries, &lib_target).status, Status::Skipped(SKIPPED.to_owned()));
    assert!(!entries.iter().any(|entry| entry.id == "fake2"));
    assert_eq!(fake.active.get(), 1);
}

#[test]
fn a_build_that_never_loaded_is_failed_and_ids_stay_unique() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config");
    write(&config.join(format!("plugins/a/{}", entry_file())), "id=same");
    write(&config.join(format!("plugins/b/{}", entry_file())), "id=same");
    write(&config.join(format!("plugins/c/{}", entry_file())), "not a library");
    let host = host();
    let registry = Registry::<TestHost>::new(Vec::new(), []);
    let loader = Loader::new(
        Rc::new(Fake::default()) as Rc<dyn Backend<TestHost>>,
        config.clone(),
        root.path().to_path_buf(),
        Vec::new(),
    );
    loader.reconcile(&host, &registry);
    let entries = registry.entries();
    let target = |name: &str| config.join("plugins").join(name).to_string_lossy().into_owned();
    assert_eq!(entry(&entries, &target("a")).status, Status::Active);
    assert_eq!(entry(&entries, &target("b")).status, Status::Failed("plugin ID same is already registered".to_owned()));
    assert_eq!(entry(&entries, &target("c")).status, Status::Failed("not a library".to_owned()));
    assert_eq!(entry(&entries, &target("c")).source, Source::Configured);
}

#[cfg(target_os = "linux")]
const ONE: &str = "./one.so";
#[cfg(target_os = "macos")]
const ONE: &str = "./one.dylib";
#[cfg(windows)]
const ONE: &str = "./one.dll";

#[test]
fn directives_after_an_entry_disable_an_external_plugin() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config");
    write(&config.join(format!("one.{}", std::env::consts::DLL_EXTENSION)), "id=one");
    write(&config.join(format!("plugins/two/{}", entry_file())), "id=two");
    let host = host();
    let registry = Registry::<TestHost>::new(Vec::new(), ["-one", ONE, "-two", "-*", "two"]);
    let loader = Loader::new(
        Rc::new(Fake::default()) as Rc<dyn Backend<TestHost>>,
        config.clone(),
        root.path().to_path_buf(),
        vec![Configured { target: ONE.to_owned(), options: None }],
    );
    loader.reconcile(&host, &registry);
    let entries = registry.entries();
    let status = |id: &str| entries.iter().find(|entry| entry.id == id).unwrap().status.clone();
    // `-one` comes before its entry, `-*` after it; `two` is discovered, so every directive applies.
    assert_eq!(status("one"), Status::Inactive);
    assert_eq!(status("two"), Status::Active);
}
