use std::fs;
use std::path::Path;
use std::process::Command;
use std::rc::Rc;
use std::sync::Mutex;
use std::time::Duration;

use opentui::keymap::RunResult;

use super::*;
use crate::loader::tests::{TestHost, entry, host};
use crate::loader::{Configured, Loader, entry_file};
use crate::{Registry, SlotInput, Status, slot};

/// The sample plugin built with `features`, built once per test run. Builds share one target directory, so the
/// lock keeps a build and its read together.
pub(crate) fn build(features: &str) -> Vec<u8> {
    static BUILT: Mutex<Vec<(String, Vec<u8>)>> = Mutex::new(Vec::new());
    let mut built = BUILT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((_, library)) = built.iter().find(|(known, _)| known == features) {
        return library.clone();
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let target = root.join("../../target/sample-plugin");
    let status = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned()))
        .args(["build", "--quiet", "--manifest-path"])
        .arg(root.join("examples/sample/Cargo.toml"))
        .arg("--target-dir")
        .arg(&target)
        .args(["--features", features])
        .status()
        .unwrap();
    assert!(status.success(), "the sample plugin did not build");
    let name = format!(
        "{}opencode_sample_plugin{}",
        std::env::consts::DLL_PREFIX,
        std::env::consts::DLL_SUFFIX
    );
    let library = fs::read(target.join("debug").join(name)).unwrap();
    built.push((features.to_owned(), library.clone()));
    library
}

/// The sample, loaded from `library` and active in a fresh registry.
fn active(host: &Rc<TestHost>, library: &[u8]) -> Registry<TestHost> {
    let (definition, error) = Backend::<TestHost>::load(&Native, library, None).unwrap();
    assert_eq!(definition.id, "sample");
    let registry = Registry::new(Vec::new(), []);
    registry.load(host, definition.external("sample.so", error));
    registry
}

/// The screen after a transcript-like Markdown view draws `markdown` with the registry's renderers.
fn markdown(host: &Rc<TestHost>, registry: &Registry<TestHost>, text: &str) -> String {
    let view = opencode_ui::markdown::view(
        host.app(),
        &host.theme(),
        &opencode_ui::code::syntax_theme(&host.theme()),
        &registry.code_blocks(&host.theme()),
        true,
        false,
    );
    view.set_markdown(text);
    host.app().root().clear();
    host.app().root().add(&view);
    host.app.render();
    host.app.text()
}

fn status(registry: &Registry<TestHost>) -> Status {
    entry(&registry.entries(), "sample.so").status.clone()
}

#[test]
fn the_sample_registers_a_command_a_fence_a_slot_and_a_route() {
    let host = host();
    let registry = active(&host, &build(""));
    assert_eq!(status(&registry), Status::Active);

    let screen = markdown(&host, &registry, "```sample\nhello\nworld\n```\n");
    assert!(screen.contains("SAMPLE v1 HELLO"), "{screen}");
    assert!(screen.contains("SAMPLE v1 WORLD"), "{screen}");

    // The command writes its storage key and toasts once the current event is done.
    assert!(matches!(
        host.keymap().dispatch("sample.hello", None),
        RunResult::Ok
    ));
    assert!(host.toasts.borrow().is_empty());
    host.app.advance(Duration::from_millis(1));
    assert_eq!(
        *host.toasts.borrow(),
        [(Toast::Success, None, "Hello from sample v1 (1)".to_owned())]
    );
    assert_eq!(
        host.storage
            .borrow()
            .get("plugin.sample.count")
            .map(String::as_str),
        Some("{\"count\":1}")
    );
    assert!(matches!(
        host.keymap().dispatch("sample.open", None),
        RunResult::Ok
    ));
    host.app.advance(Duration::from_millis(1));
    assert_eq!(
        *host.routes.borrow(),
        [("sample".to_owned(), "hello".to_owned())]
    );

    let parent = View::new(host.app());
    let mounted = registry.mount(
        &*host,
        &parent,
        slot::HOME_FOOTER,
        &SlotInput::default(),
        |_| {},
    );
    assert!(!mounted.is_empty());
    host.app().root().clear();
    host.app().root().add(&parent);
    let route = registry.route(&*host, "sample", "hello").unwrap();
    host.app().root().add(&route.root());
    host.app.render();
    let screen = host.app.text();
    assert!(screen.contains("sample plugin v1: home.footer"), "{screen}");
    assert!(screen.contains("Sample route hello"), "{screen}");
    assert!(screen.contains("said hello 1 times"), "{screen}");
}

#[test]
fn a_panicking_fence_fails_the_plugin_and_falls_back_to_the_code() {
    let host = host();
    let registry = active(&host, &build(""));
    let screen = markdown(&host, &registry, "```sample-panic\nboom\n```\n");
    assert!(screen.contains("boom"), "{screen}");
    assert_eq!(
        status(&registry),
        Status::Failed("render-fence panicked: sample fence panicked".to_owned())
    );
    host.app.advance(Duration::from_millis(1));
    assert_eq!(
        *host.toasts.borrow(),
        [(
            Toast::Error,
            Some("Plugin failed: sample".to_owned()),
            "Run /plugins to view details.".to_owned()
        )]
    );
    // A failed plugin is not called again: its fences keep the code view, its commands do nothing.
    let screen = markdown(&host, &registry, "```sample\nquiet\n```\n");
    assert!(
        screen.contains("quiet") && !screen.contains("QUIET"),
        "{screen}"
    );
    host.keymap().dispatch("sample.hello", None);
    host.app.advance(Duration::from_millis(1));
    assert!(host.storage.borrow().is_empty());

    // Enabling it again starts a fresh instance.
    registry.set_active(&host, "sample", true);
    assert_eq!(status(&registry), Status::Active);
    let screen = markdown(&host, &registry, "```sample\nback\n```\n");
    assert!(screen.contains("SAMPLE v1 BACK"), "{screen}");
}

#[test]
fn a_panicking_command_fails_the_plugin() {
    let host = host();
    let registry = active(&host, &build(""));
    assert!(matches!(
        host.keymap().dispatch("sample.panic", None),
        RunResult::Ok
    ));
    assert_eq!(
        status(&registry),
        Status::Failed("run-command panicked: sample command panicked".to_owned())
    );
}

#[test]
fn versions_follow_the_abi_rules() {
    let load = |library: &[u8], options: Option<&str>| {
        Backend::<TestHost>::load(&Native, library, options).err()
    };
    // The current build has the 1.1 entry; a 1.0 build has the shorter table and still loads and works.
    let current = build("");
    assert_eq!(
        Native.inspect(&current).unwrap(),
        Inspected {
            major: 1,
            minor: 1,
            version: Some("0.1.0".to_owned()),
        }
    );
    let old = build("abi-1-0");
    assert_eq!(
        Native.inspect(&old).unwrap(),
        Inspected {
            major: 1,
            minor: 0,
            version: None,
        }
    );
    let host = host();
    let registry = active(&host, &old);
    let screen = markdown(&host, &registry, "```sample\nold\n```\n");
    assert!(screen.contains("SAMPLE v1 OLD"), "{screen}");

    // A plugin built against a newer minor version loads and uses what this host offers.
    let newer = build("minor-newer");
    assert_eq!(Native.inspect(&newer).unwrap().minor, 99);
    let registry = active(&host, &newer);
    let screen = markdown(&host, &registry, "```sample\nnewer\n```\n");
    assert!(screen.contains("SAMPLE v1 NEWER"), "{screen}");

    // Only a major mismatch, or a plugin that needs a newer host, is refused, with a clear reason.
    assert_eq!(
        load(&build("major-2"), None).unwrap(),
        "plugin ABI 2.0 is not supported: this opencode-rs loads ABI 1.x plugins (up to 1.1); rebuild the \
         plugin against opencode-plugin-abi 1"
    );
    assert_eq!(
        load(&build("requires-future"), None).unwrap(),
        "plugin needs host ABI 1.99 or newer, this opencode-rs has 1.1; update opencode-rs"
    );
    assert_eq!(
        load(&current, Some("{\"fail\":true}")).unwrap(),
        "sample setup failed"
    );
    assert!(
        load(b"not a library", None)
            .unwrap()
            .starts_with("cannot load the library")
    );
}

#[test]
fn the_loader_reloads_a_rebuilt_library() {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config");
    let dir = config.join("plugins/sample");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(entry_file()), build("")).unwrap();
    let host = host();
    let registry = Registry::<TestHost>::new(Vec::new(), []);
    let loader = Loader::new(
        Rc::new(Native) as Rc<dyn Backend<TestHost>>,
        config,
        root.path().to_path_buf(),
        Vec::<Configured>::new(),
    );
    assert!(loader.reconcile(&host, &registry));
    let screen = markdown(&host, &registry, "```sample\nhi\n```\n");
    assert!(screen.contains("SAMPLE v1 HI"), "{screen}");
    fs::write(dir.join(entry_file()), build("v2")).unwrap();
    assert!(loader.reconcile(&host, &registry));
    let screen = markdown(&host, &registry, "```sample\nhi\n```\n");
    assert!(screen.contains("SAMPLE v2 HI"), "{screen}");
    assert_eq!(registry.entries().len(), 1);
}
