use std::fs;
use std::path::Path;
use std::process::Command;
use std::rc::Rc;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use opentui::keymap::RunResult;
use opentui::testing::Capture;

use super::*;
use crate::loader::tests::{TestHost, dynamic, entry, host};
use crate::loader::{Configured, Loader, entry_file};
use crate::{Entry, Registry, SlotInput, Status, slot};

/// The sample plugin built with `features`, built once per test run. Builds share one target directory, so the
/// lock keeps a build and its read together.
pub(crate) fn build(features: &str) -> Vec<u8> {
    static BUILT: Mutex<Vec<(String, Vec<u8>)>> = Mutex::new(Vec::new());
    let mut built = BUILT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
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
    let name = format!("{}opencode_sample_plugin{}", std::env::consts::DLL_PREFIX, std::env::consts::DLL_SUFFIX);
    let library = fs::read(target.join("debug").join(name)).unwrap();
    built.push((features.to_owned(), library.clone()));
    library
}

/// The sample, loaded from `library` and active in a fresh registry.
fn active(host: &Rc<TestHost>, library: &[u8]) -> Registry {
    let (definition, error) = Native.load(&dynamic(host), library, None).unwrap();
    assert_eq!(definition.id, "sample");
    let registry = Registry::define(Vec::new(), []);
    registry.load(&dynamic(host), definition.external("sample.so", error));
    registry
}

/// The screen after a transcript-like Markdown view draws `markdown` with the registry's renderers.
fn markdown(host: &Rc<TestHost>, registry: &Registry, text: &str) -> String {
    let view = opencode_ui::markdown::view(
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
    view.set_markdown(text);
    host.app().root().clear();
    host.app().root().add(&view);
    host.app.render();
    host.app.text()
}

fn status(registry: &Registry) -> Status {
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
    assert!(matches!(host.keymap().dispatch("sample.hello", None), RunResult::Ok));
    assert!(host.toasts.borrow().is_empty());
    host.app.advance(Duration::from_millis(1));
    assert_eq!(*host.toasts.borrow(), [abi::Toast::new(abi::Variant::Success, "Hello from sample v1 (1)")]);
    assert_eq!(host.storage.borrow().get("plugin.sample.count").map(String::as_str), Some("{\"count\":1}"));
    assert!(matches!(host.keymap().dispatch("sample.open", None), RunResult::Ok));
    host.app.advance(Duration::from_millis(1));
    assert_eq!(*host.routes.borrow(), [("sample".to_owned(), "hello".to_owned())]);

    let parent = View::new(host.app());
    let mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
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
    assert_eq!(status(&registry), Status::Failed("render-fence panicked: sample fence panicked".to_owned()));
    host.app.advance(Duration::from_millis(1));
    assert_eq!(
        *host.toasts.borrow(),
        [abi::Toast::new(abi::Variant::Error, "Run /plugins to view details.").title("Plugin failed: sample")]
    );
    // A failed plugin is not called again: its fences keep the code view, its commands do nothing.
    let screen = markdown(&host, &registry, "```sample\nquiet\n```\n");
    assert!(screen.contains("quiet") && !screen.contains("QUIET"), "{screen}");
    host.keymap().dispatch("sample.hello", None);
    host.app.advance(Duration::from_millis(1));
    assert!(host.storage.borrow().is_empty());

    // Enabling it again starts a fresh instance.
    registry.set_active(&dynamic(&host), "sample", true);
    assert_eq!(status(&registry), Status::Active);
    let screen = markdown(&host, &registry, "```sample\nback\n```\n");
    assert!(screen.contains("SAMPLE v1 BACK"), "{screen}");
}

// Expected: a plugin reads the host's theme mode (ABI 1.2), which follows the host, not the page background.
#[test]
fn a_plugin_reads_the_theme_mode() {
    let host = host();
    let registry = active(&host, &build(""));
    let screen = markdown(&host, &registry, "```sample-mode\nx\n```\n");
    assert!(screen.contains("sample mode dark"), "{screen}");
    host.mode.set(ThemeMode::Light);
    let screen = markdown(&host, &registry, "```sample-mode\nx\n```\n");
    assert!(screen.contains("sample mode light"), "{screen}");
}

#[test]
fn a_panicking_command_fails_the_plugin() {
    let host = host();
    let registry = active(&host, &build(""));
    assert!(matches!(host.keymap().dispatch("sample.panic", None), RunResult::Ok));
    assert_eq!(status(&registry), Status::Failed("run-command panicked: sample command panicked".to_owned()));
    // Its commands leave the keymap once the key is handled; it stays active, so it can be disabled.
    host.app.advance(Duration::from_millis(1));
    assert!(matches!(host.keymap().dispatch("sample.hello", None), RunResult::NotFound));
    assert!(entry(&registry.entries(), "sample.so").active);
    assert!(registry.set_active(&dynamic(&host), "sample", false));
    assert_eq!(status(&registry), Status::Inactive);
    assert!(registry.set_active(&dynamic(&host), "sample", true));
    assert!(matches!(host.keymap().dispatch("sample.hello", None), RunResult::Ok));
}

#[test]
fn versions_follow_the_abi_rules() {
    let load = |library: &[u8], options: Option<&str>| Native.load(&dynamic(&host()), library, options).err();
    // The current build is 1.4; a 1.0 build has the shorter table and still loads and works on this 1.4 host.
    let current = build("");
    assert_eq!(Native.inspect(&current).unwrap(), Inspected { major: 1, minor: 4, version: Some("0.1.0".to_owned()) });
    let old = build("abi-1-0");
    assert_eq!(Native.inspect(&old).unwrap(), Inspected { major: 1, minor: 0, version: None });
    let host = host();
    let registry = active(&host, &old);
    let screen = markdown(&host, &registry, "```sample\nold\n```\n");
    assert!(screen.contains("SAMPLE v1 OLD"), "{screen}");

    // A plugin built on the frozen 1.3 crate gets the 1.3 requests and draws its rows, its slot and its route.
    let v1_3 = build("abi-1-3");
    assert_eq!(Native.inspect(&v1_3).unwrap(), Inspected { major: 1, minor: 3, version: Some("0.1.0".to_owned()) });
    // A fresh host, so the commands of the plugins above are not in its keymap.
    let host = crate::loader::tests::host();
    let registry = active(&host, &v1_3);
    let screen = markdown(&host, &registry, "```sample\nold\n```\n\n```sample-mode\nx\n```\n");
    assert!(screen.contains("SAMPLE 1.3 OLD") && screen.contains("sample mode dark, streaming false"), "{screen}");
    let parent = View::new(host.app());
    let _mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    host.app().root().clear();
    host.app().root().add(&parent);
    host.app().root().add(&registry.route(&*host, "sample", "hello").unwrap().root());
    host.app.render();
    let screen = host.app.text();
    assert!(screen.contains("sample plugin 1.3: home.footer") && screen.contains("Sample route hello"), "{screen}");
    assert!(matches!(host.keymap().dispatch("sample.hello", None), RunResult::Ok));
    host.app.advance(Duration::from_millis(1));
    assert_eq!(*host.toasts.borrow(), [abi::Toast::new(abi::Variant::Success, "Hello from sample 1.3")]);

    // The same 1.3 plugin behind the 1.0 table, which has no `describe`, draws the same.
    let legacy = build("abi-1-0-wire");
    assert_eq!(Native.inspect(&legacy).unwrap(), Inspected { major: 1, minor: 0, version: None });
    let host = crate::loader::tests::host();
    let registry = active(&host, &legacy);
    let screen = markdown(&host, &registry, "```sample\nold\n```\n");
    assert!(screen.contains("SAMPLE 1.3 OLD"), "{screen}");
    let parent = View::new(host.app());
    let _mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    host.app().root().clear();
    host.app().root().add(&parent);
    host.app.render();
    assert!(host.app.text().contains("sample plugin 1.3: home.footer"), "{}", host.app.text());

    // A 1.3 host refuses a plugin of this crate, which needs the 1.4 render requests.
    assert_eq!(
        Library::open(&current, 3).err().unwrap(),
        "plugin needs host ABI 1.4 or newer, this opencode-native has 1.3; update opencode-native"
    );

    // A plugin built against a newer minor version loads and uses what this host offers.
    let newer = build("minor-newer");
    assert_eq!(Native.inspect(&newer).unwrap().minor, 99);
    let registry = active(&host, &newer);
    let screen = markdown(&host, &registry, "```sample\nnewer\n```\n");
    assert!(screen.contains("SAMPLE v1 NEWER"), "{screen}");

    // Only a major mismatch, or a plugin that needs a newer host, is refused, with a clear reason.
    assert_eq!(
        load(&build("major-2"), None).unwrap(),
        "plugin ABI 2.0 is not supported: this opencode-native loads ABI 1.x plugins (up to 1.4); rebuild the \
         plugin against opencode-plugin-abi 1"
    );
    assert_eq!(
        load(&build("requires-future"), None).unwrap(),
        "plugin needs host ABI 1.99 or newer, this opencode-native has 1.4; update opencode-native"
    );
    assert!(load(b"not a library", None).unwrap().starts_with("cannot load the library"));
    // Setup runs on activation, so a setup that fails fails the plugin there.
    let (definition, error) = Native.load(&dynamic(&host), &current, Some("{\"fail\":true}")).unwrap();
    let registry = Registry::define(Vec::new(), []);
    registry.load(&dynamic(&host), definition.external("sample.so", error));
    assert_eq!(status(&registry), Status::Failed("sample setup failed".to_owned()));
}

// Expected: a plugin that `cli.json` disables loads without running its setup. Enabling it runs setup, and
// disabling or unloading it destroys that instance.
#[test]
fn setup_runs_on_activation_and_the_instance_is_destroyed_after() {
    let host = host();
    let stored = |key: &str| host.storage.borrow_mut().remove(&format!("plugin.sample.{key}"));
    let (definition, error) = Native.load(&dynamic(&host), &build(""), Some("{\"probe\":true}")).unwrap();
    assert_eq!(definition.id, "sample");
    let registry = Registry::define(Vec::new(), ["-sample"]);
    registry.load(&dynamic(&host), definition.external("sample.so", error));
    assert_eq!(status(&registry), Status::Inactive);
    host.app.advance(Duration::from_millis(1));
    assert!(host.toasts.borrow().is_empty() && host.storage.borrow().is_empty());

    assert!(registry.set_active(&dynamic(&host), "sample", true));
    assert_eq!(stored("count").as_deref(), Some("{\"count\":1}"));
    assert!(registry.set_active(&dynamic(&host), "sample", false));
    assert_eq!(stored("destroyed").as_deref(), Some("{\"destroyed\":true}"));
    assert!(registry.set_active(&dynamic(&host), "sample", true));
    assert_eq!(stored("destroyed"), None);
    registry.unload(&dynamic(&host), "sample.so");
    assert_eq!(stored("destroyed").as_deref(), Some("{\"destroyed\":true}"));

    // Expected (bigboi-6): a build without `describe` runs setup once to tell its ID; that instance's disposal
    // stores nothing.
    let (definition, _) = Native.load(&dynamic(&host), &build("abi-1-0"), Some("{\"probe\":true}")).unwrap();
    assert_eq!(definition.id, "sample");
    host.app.advance(Duration::from_millis(1));
    assert_eq!(stored("destroyed"), None);
}

#[test]
fn the_loader_reloads_a_rebuilt_library() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let dir = config.join("plugins").join("sample");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(entry_file()), build("")).unwrap();
    let host = host();
    let registry = Registry::define(Vec::new(), []);
    let loader =
        Loader::new(Rc::new(Native) as Rc<dyn Backend>, config, root.path().to_path_buf(), Vec::<Configured>::new());
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let screen = markdown(&host, &registry, "```sample\nhi\n```\n");
    assert!(screen.contains("SAMPLE v1 HI"), "{screen}");
    fs::write(dir.join(entry_file()), build("v2")).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let screen = markdown(&host, &registry, "```sample\nhi\n```\n");
    assert!(screen.contains("SAMPLE v2 HI"), "{screen}");
    assert_eq!(registry.entries().len(), 1);
}

// Expected: a rebuild whose setup fails, while the old build is active, is destroyed; the old build keeps running and
// the plugin reads as failed with "(previous version still active)", as in TS.
#[test]
fn a_rebuild_whose_setup_fails_keeps_the_running_version() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let dir = config.join("plugins").join("sample");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(entry_file()), build("")).unwrap();
    let host = host();
    let registry = Registry::define(Vec::new(), []);
    let loader =
        Loader::new(Rc::new(Native) as Rc<dyn Backend>, config, root.path().to_path_buf(), Vec::<Configured>::new());
    assert!(loader.reconcile(&dynamic(&host), &registry));
    fs::write(dir.join(entry_file()), build("setup-fails")).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let target = dir.to_string_lossy().into_owned();
    let entry = entry(&registry.entries(), &target).clone();
    assert!(entry.active);
    assert_eq!(entry.status, Status::Failed("sample setup failed (previous version still active)".to_owned()));
    let screen = markdown(&host, &registry, "```sample\nstill\n```\n");
    assert!(screen.contains("SAMPLE v1 STILL"), "{screen}");
    assert!(matches!(host.keymap().dispatch("sample.hello", None), RunResult::Ok));
    // A second failed rebuild keeps it running too.
    fs::write(dir.join(entry_file()), build("major-2")).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let entry = crate::loader::tests::entry(&registry.entries(), &target).clone();
    assert!(entry.active);
    assert!(matches!(&entry.status, Status::Failed(error) if error.ends_with("(previous version still active)")));
}

// Expected (carbon-3): a failed rebuild of a plugin that panicked shows the rebuild's error, not the old panic, and the
// dead instance is not kept as the running version.
#[test]
fn a_failed_rebuild_of_a_panicked_plugin_shows_its_own_error() {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let dir = config.join("plugins").join("sample");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(entry_file()), build("")).unwrap();
    let host = host();
    let registry = Registry::define(Vec::new(), []);
    let loader =
        Loader::new(Rc::new(Native) as Rc<dyn Backend>, config, root.path().to_path_buf(), Vec::<Configured>::new());
    assert!(loader.reconcile(&dynamic(&host), &registry));
    host.keymap().dispatch("sample.panic", None);
    host.app.advance(Duration::from_millis(1));
    fs::write(dir.join(entry_file()), build("major-2")).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let entry = entry(&registry.entries(), &dir.to_string_lossy()).clone();
    assert!(!entry.active);
    assert!(
        matches!(&entry.status, Status::Failed(error) if error.contains("ABI 2.0") && !error.contains("previous")),
        "{:?}",
        entry.status
    );
}

// Expected: a table from a C plugin is refused, without reading past its declared size or through a null or
// misaligned pointer, when it is too short for its header, misaligned, or leaves a required callback null. A null
// `destroy` is allowed.
#[test]
fn a_malformed_table_is_refused_without_reading_it() {
    let refused = |api: *const PluginApi| Library::from_table(api, HOST_MINOR).err().unwrap();
    assert_eq!(refused(std::ptr::null()), "`opencode_plugin_v1` returned no table");
    let short: [usize; 1] = [size_of::<usize>()];
    assert_eq!(refused(short.as_ptr().cast()), "plugin table is 8 bytes, shorter than its version header");
    let bytes = [0u64; 16];
    assert_eq!(refused(bytes.as_ptr().cast::<u8>().wrapping_add(1).cast()), "plugin table is not aligned");
    let null = PluginApi {
        size: size_of::<PluginApiV1_0>(),
        major: 1,
        minor: 0,
        requires_minor: 0,
        create: None,
        call: None,
        destroy: None,
        free: None,
        describe: None,
    };
    assert_eq!(refused(&null), "plugin table has a null `create` callback");
    unsafe extern "C" fn create(_: *const HostApi, _: Bytes, _: *mut *mut c_void, _: *mut Owned) -> i32 {
        abi::ERROR
    }
    let api = PluginApi { create: Some(create), ..null };
    assert_eq!(refused(&api), "plugin table has a null `call` callback");
    let api = PluginApi { call: Some(abi::runtime::call), ..api };
    assert_eq!(refused(&api), "plugin table has a null `free` callback");
    let api = PluginApi { free: Some(abi::runtime::free), ..api };
    let library = Library::from_table(&api, HOST_MINOR).unwrap();
    assert!(library.destroy.is_none() && library.describe.is_none());
}

// Expected: a plugin's own thread wakes the host (ABI 1.3), which asks its mounted claim for its rows again without a
// change batch, and the claim shows what the thread counted.
#[test]
fn a_wake_from_a_plugin_thread_draws_its_claims_again() {
    let host = host();
    let (definition, error) = Native.load(&dynamic(&host), &build(""), Some("{\"tick_ms\":5}")).unwrap();
    let registry = Registry::define(Vec::new(), []);
    registry.load(&dynamic(&host), definition.external("sample.so", error));
    let parent = View::new(host.app());
    let _mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    host.app().root().add(&parent);
    let ticked = host.app.wait_until(Duration::from_secs(10), || {
        host.app.render();
        let screen = host.app.text();
        screen.contains(" ticks") && !screen.contains(" 0 ticks")
    });
    assert!(ticked, "{}", host.app.text());
}

/// The sample, active with `options`, its home footer claim mounted, after the app's task queue is filled, so the
/// plugin's wakes find it full.
fn woken_into_a_full_queue(host: &Rc<TestHost>, options: &str) -> (Registry, impl Sized) {
    let proxy = host.app().proxy();
    while proxy.post(|_| {}).is_ok() {}
    let (definition, error) = Native.load(&dynamic(host), &build(""), Some(options)).unwrap();
    let registry = Registry::define(Vec::new(), []);
    registry.load(&dynamic(host), definition.external("sample.so", error));
    let parent = View::new(host.app());
    let mounted = registry.mount(&**host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    host.app().root().add(&parent);
    // The one tick wakes the host while the queue is still full.
    std::thread::sleep(Duration::from_millis(300));
    (registry, mounted)
}

// Expected: a wake that finds the app's task queue full is delivered once the queue has room, so a plugin that wakes
// the host once, for one result, still shows it.
#[test]
fn a_wake_into_a_full_queue_draws_once_the_queue_has_room() {
    let host = host();
    let (_registry, _mounted) = woken_into_a_full_queue(&host, "{\"tick_ms\":50,\"ticks\":1}");
    let drawn = host.app.wait_until(Duration::from_secs(5), || {
        host.app.render();
        host.app.text().contains(" 1 ticks")
    });
    assert!(drawn, "{}", host.app.text());
}

// Expected: a wake the host delivers after the plugin is disabled finds no instance and does nothing; enabling the
// plugin again starts an instance that draws.
#[test]
fn a_wake_after_deactivation_does_nothing() {
    let host = host();
    let (registry, mounted) = woken_into_a_full_queue(&host, "{\"tick_ms\":50,\"ticks\":1}");
    drop(mounted);
    host.app().root().clear();
    assert!(registry.set_active(&dynamic(&host), "sample", false));
    host.app.wait_until(Duration::from_millis(100), || false);
    assert_eq!(status(&registry), Status::Inactive);
    assert!(host.toasts.borrow().is_empty());
    assert!(registry.set_active(&dynamic(&host), "sample", true));
    let screen = markdown(&host, &registry, "```sample\nagain\n```\n");
    assert!(screen.contains("SAMPLE v1 AGAIN"), "{screen}");
}

// Expected: setup runs against the live host, under its ID: it reads and writes a storage key it declared, reads
// the theme mode, and its toast shows once the plugin is active.
#[test]
fn setup_reaches_the_host() {
    let host = host();
    host.mode.set(ThemeMode::Light);
    host.storage.borrow_mut().insert("plugin.sample.count".to_owned(), "{\"count\":5}".to_owned());
    let (definition, error) = Native.load(&dynamic(&host), &build(""), Some("{\"probe\":true}")).unwrap();
    let registry = Registry::define(Vec::new(), []);
    registry.load(&dynamic(&host), definition.external("sample.so", error));
    assert_eq!(status(&registry), Status::Active);
    host.app.advance(Duration::from_millis(1));
    assert_eq!(*host.toasts.borrow(), [abi::Toast::new(abi::Variant::Info, "sample setup: count 5, light, stored")]);
    assert_eq!(host.storage.borrow().get("plugin.sample.count").map(String::as_str), Some("{\"count\":6}"));
}

/// The version text of the sample's fences compiled into this test.
const VERSION: &str = "v1";

/// The sample's fences, compiled in rather than loaded.
#[path = "../../../examples/sample/src/fence.rs"]
mod sample_fence;

// Expected: the sample's fences, compiled into the host and run in process, draw the same cells, colors included, as
// the same source draws from the library through the C ABI.
#[test]
fn the_sample_fence_draws_the_same_in_process_and_through_the_library() {
    let host = host();
    let plugin = abi::Plugin { id: "sample", setup: sample_fence::setup };
    let in_process = Registry::define(vec![plugin.into()], []);
    in_process.activate(&dynamic(&host));
    let library = active(&host, &build(""));
    let text = "```sample\nhello\n```\n\n```sample-mode\nx\n```\n\n```sample-color\nlabel\n```\n";
    let direct = markdown(&host, &in_process, text);
    assert!(direct.contains("SAMPLE v1 HELLO") && direct.contains("sample mode dark"), "{direct}");
    assert!(direct.contains("accent label"), "{direct}");
    let cells = host.app.render();
    assert_eq!(markdown(&host, &library, text), direct);
    assert_eq!(host.app.render(), cells);
}

// Expected (bigboi notes): a plugin hears, in process and through the library, of each fence key the host no longer
// shows, once the Markdown that drew its blocks is gone.
#[test]
fn a_plugin_hears_of_the_fences_that_go_on_both_paths() {
    let host = host();
    let plugin = abi::Plugin { id: "sample", setup: sample_fence::setup };
    let in_process = Registry::define(vec![plugin.into()], []);
    in_process.activate(&dynamic(&host));
    let library = active(&host, &build(""));
    for registry in [&in_process, &library] {
        markdown(&host, registry, "```sample\na\n```\n\n```sample\nb\n```\n\n```sample\nc\n```\n");
        host.app().root().clear();
        host.app.advance(Duration::from_millis(1));
        let screen = markdown(&host, registry, "```sample-gone\nx\n```\n");
        assert!(screen.contains("sample gone 3"), "{screen}");
    }
}

// Expected: a fence that falls back to the code view and streams on there tells the plugin its key went once, not
// once per delta, in process and through the library.
#[test]
fn a_fence_that_stays_in_the_code_view_goes_once_on_both_paths() {
    let host = host();
    let plugin = abi::Plugin { id: "sample", setup: sample_fence::setup };
    let in_process = Registry::define(vec![plugin.into()], []);
    in_process.activate(&dynamic(&host));
    let library = active(&host, &build(""));
    for registry in [&in_process, &library] {
        let mut chunks = vec!["```sample\nx", "~"];
        chunks.extend(std::iter::repeat_n("y", 50));
        let frames = stream(&host, registry, &chunks);
        assert!(frames[0].text().contains("SAMPLE v1 X"), "{}", frames[0].text());
        assert!(!frames[2].text().contains("SAMPLE"), "{}", frames[2].text());
        host.app().root().clear();
        host.app.advance(Duration::from_millis(1));
        let screen = markdown(&host, registry, "```sample-gone\nx\n```\n");
        assert!(screen.contains("sample gone 1"), "{screen}");
    }
}

/// Streams `chunks` into one Markdown view with the registry's renderers, returning the frame after each.
fn stream(host: &Rc<TestHost>, registry: &Registry, chunks: &[&str]) -> Vec<Capture> {
    let theme = host.theme();
    let syntax = opencode_ui::code::syntax_theme(&theme);
    let view = opencode_ui::markdown::view(
        host.app(),
        &theme,
        &syntax,
        &registry.code_blocks({
            let theme = theme.clone();
            Rc::new(move || theme.clone())
        }),
        true,
        true,
    );
    host.app().root().clear();
    host.app().root().add(&view);
    chunks
        .iter()
        .map(|chunk| {
            view.append(chunk);
            host.app.render()
        })
        .collect()
}

/// A built-in whose `create` is `create`, wired through the byte shims of the C ABI (`Loopback`) and active.
fn loopback(
    host: &Rc<TestHost>,
    create: unsafe extern "C" fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32,
) -> Registry {
    let (definition, error) = super::loopback(&dynamic(host), create).unwrap();
    let loopback = Registry::define(Vec::new(), []);
    loopback.load(&dynamic(host), definition.external("loopback.so", error));
    assert_eq!(entry(&loopback.entries(), "loopback.so").status, Status::Active);
    loopback
}

/// The sample's sidebar claim, compiled in rather than loaded.
#[path = "../../../examples/sample/src/slot.rs"]
mod sample_slot;

/// The frames of `registry`'s `sidebar.content` claims for `ses_1`: as mounted, after a message arrives and the host
/// syncs them, with the pointer over the click count, and after two clicks on it, which the claim reads back from
/// storage when the host syncs it again.
fn sidebar(host: &Rc<TestHost>, registry: &Registry) -> Vec<Capture> {
    host.messages.borrow_mut().clear();
    host.storage.borrow_mut().clear();
    let parent = View::new(host.app()).column();
    let input = SlotInput { session_id: Some("ses_1".to_owned()), ..SlotInput::default() };
    let mounted = registry.mount(&**host, &parent, slot::SIDEBAR_CONTENT, &input, |_| {});
    host.app().root().clear();
    host.app().root().add(&parent);
    let first = host.app.render();
    host.messages.borrow_mut().push(abi::types::SessionMessageInfo::Unknown(serde_json::json!({ "type": "x" })));
    mounted.sync(&**host, Some(&abi::Changed::everything()));
    let synced = host.app.render();
    host.app.hover(2, 2);
    let hovered = host.app.render();
    for _ in 0..2 {
        host.app.click(2, 2);
        host.app.advance(Duration::from_millis(1));
    }
    mounted.sync(&**host, Some(&abi::Changed::everything()));
    vec![first, synced, hovered, host.app.render()]
}

// Expected: the sample's sidebar claim, compiled into the host and run in process, draws the same cells as the same
// source draws from the library, where its reads cross the C ABI as requests. Its click count brightens under the
// pointer, and each click dispatches the sample's hidden command with the session as its input, which stores the
// count the claim then shows.
#[test]
fn the_sample_slot_draws_the_same_in_process_and_through_the_library() {
    let host = host();
    let plugin = abi::Plugin { id: "sample", setup: sample_slot::setup };
    let in_process = Registry::define(vec![plugin.into()], []);
    in_process.activate(&dynamic(&host));
    let direct = sidebar(&host, &in_process);
    let text: Vec<String> = direct.iter().map(Capture::text).collect();
    assert!(text[0].contains("Sample: 0 messages") && text[0].contains("opencode/big"), "{}", text[0]);
    assert!(text[1].contains("Sample: 1 messages") && text[1].contains("0 clicks"), "{}", text[1]);
    assert_ne!(direct[2], direct[1], "the hover changes no cell");
    assert!(text[3].contains("2 clicks"), "{}", text[3]);
    let stored = host.storage.borrow().get("plugin.sample.clicks").cloned();
    assert_eq!(stored.as_deref(), Some(r#"{"count":2,"input":"ses_1"}"#));
    // Its hidden command leaves the keymap with it, so the library's runs the clicks.
    in_process.set_active(&dynamic(&host), "sample", false);
    let library = active(&host, &build("still"));
    assert_eq!(sidebar(&host, &library), direct);
    assert_eq!(host.storage.borrow().get("plugin.sample.clicks").cloned(), stored);
}

// Expected: the LaTeX built-in, wired through the byte shims of the C ABI (`Loopback`), keeps its formula across
// a chunk that does not parse, as it does in process, with the host's fence keys crossing the wire.
#[test]
fn latex_streams_the_same_through_the_c_abi_loopback() {
    let host = host();
    let in_process = Registry::define(vec![opencode_latex::plugin().into()], []);
    in_process.activate(&dynamic(&host));
    let loopback =
        loopback(&host, abi::export_plugin!(@loopback opencode_latex::plugin().id, opencode_latex::plugin().setup));

    let chunks = ["```latex\n\\frac{a_1+b_1}{c_1+d_1}", "+\\frac{a_", "2+b_2}{c_2+d_2}"];
    let direct = stream(&host, &in_process, &chunks);
    let text: Vec<String> = direct.iter().map(Capture::text).collect();
    assert_eq!(direct[1], direct[0]);
    assert!(text[0].contains("───") && !text[0].contains("\\frac"), "{}", text[0]);
    assert!(direct[2] != direct[0] && !text[2].contains("\\frac"), "{}", text[2]);
    assert_eq!(stream(&host, &loopback, &chunks), direct);
}

// Expected: the Mermaid built-in through the C ABI loopback draws the same cells as in process, colors included:
// its theme colors, translucent label backgrounds and white default fg, and the diagram it keeps by fence key while
// a statement it does not support streams in.
#[test]
fn mermaid_streams_the_same_through_the_c_abi_loopback() {
    let host = host();
    let in_process = Registry::define(vec![opencode_mermaid::plugin().into()], []);
    in_process.activate(&dynamic(&host));
    let loopback =
        loopback(&host, abi::export_plugin!(@loopback opencode_mermaid::plugin().id, opencode_mermaid::plugin().setup));

    let chunks = ["```mermaid\nflowchart LR\n  A -->|go| B", "\n  B --> C", "\n  C((cir"];
    let direct = stream(&host, &in_process, &chunks);
    let text: Vec<String> = direct.iter().map(Capture::text).collect();
    assert!(text[0].contains("go") && !text[0].contains("flowchart"), "{}", text[0]);
    assert!(direct[1] != direct[0] && !text[1].contains("flowchart"), "{}", text[1]);
    assert_eq!(direct[2], direct[1]);
    assert_eq!(stream(&host, &loopback, &chunks), direct);
}

/// The sample's home claims and event handler, compiled in rather than loaded.
#[path = "../../../examples/sample/src/home.rs"]
mod sample_home;

fn succeeded(session: &str) -> abi::types::V2Event {
    serde_json::from_value(serde_json::json!({
        "id": "evt_1", "created": 1, "type": "session.execution.succeeded",
        "durable": { "aggregateID": session, "seq": 1, "version": 1 }, "data": { "sessionID": session },
    }))
    .unwrap()
}

/// The sample's home row as `registry` mounts `home.footer`, before and after a session's run succeeds, with the
/// toasts the event showed.
fn home(host: &Rc<TestHost>, registry: &Rc<Registry>) -> (Vec<String>, Vec<abi::Toast>) {
    host.toasts.borrow_mut().clear();
    *host.registry.borrow_mut() = Rc::downgrade(registry);
    let parent = View::new(host.app()).column();
    let mounted = registry.mount(&**host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    host.app().root().clear();
    host.app().root().add(&parent);
    let row = |host: &TestHost| {
        host.app.render();
        host.app.text().lines().find(|line| line.contains("sample home:")).unwrap_or_default().trim_end().to_owned()
    };
    let mut rows = vec![row(host)];
    // Signals only: no change batch reaches the slot, but the handler changed what the status claim shows.
    host.emit(&succeeded("ses_1"));
    host.emit(&succeeded("ses_2"));
    host.app.advance(Duration::from_millis(1));
    rows.push(row(host));
    drop(mounted);
    (rows, host.toasts.borrow().clone())
}

// Expected: the sample's event handler gets the event it asked for and shows a toast about its session, and its home
// claim's nested `home.footer.status` slot keeps the sample's status claim mounted, which renders again after the
// handler without a change batch, the same in process and from the library, where the event crosses the C ABI as JSON.
#[test]
fn the_sample_home_and_event_act_the_same_in_process_and_through_the_library() {
    let host = host();
    let plugin = abi::Plugin { id: "sample", setup: sample_home::setup };
    let in_process = Rc::new(Registry::define(vec![plugin.into()], []));
    in_process.activate(&dynamic(&host));
    let direct = home(&host, &in_process);
    assert_eq!(direct.0, ["sample home: 0 done", "sample home: 2 done"]);
    let toast = |id: &str| abi::Toast::new(abi::Variant::Info, format!("sample: {id} is done")).session(id);
    assert_eq!(direct.1, [toast("ses_1"), toast("ses_2")]);
    in_process.set_active(&dynamic(&host), "sample", false);
    let library = Rc::new(active(&host, &build("still")));
    assert_eq!(home(&host, &library), direct);
}

fn nesting(setup: &mut abi::Setup) -> Result<(), String> {
    let paths = ["sidebar.content", "home.footer", "home.footer.nope", "home", "home.footer.status"];
    setup.slot(abi::Placement::append("home.footer"), move |_, _, _| {
        abi::Render::Show(abi::Node::row(paths.iter().map(|path| abi::Node::slot(*path)).collect()))
    });
    for path in ["sidebar.content", "home.footer.status"] {
        setup.slot(abi::Placement::append(path), move |_, _, _| {
            abi::Render::Show(abi::Node::text([abi::Span::new(format!("[{path}]"))]))
        });
    }
    Ok(())
}

// Expected: a claim shows only published slots inside its own; a slot outside it, itself, an ancestor, or a path the
// host does not publish draws nothing.
#[test]
fn a_nested_slot_must_be_a_published_slot_inside_the_claims_own() {
    let host = host();
    let registry = Rc::new(Registry::define(vec![abi::Plugin { id: "nesting", setup: nesting }.into()], []));
    registry.activate(&dynamic(&host));
    *host.registry.borrow_mut() = Rc::downgrade(&registry);
    let parent = View::new(host.app()).column();
    let _mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    host.app().root().add(&parent);
    host.app.render();
    let screen = host.app.text();
    assert!(screen.contains("[home.footer.status]"), "{screen}");
    assert!(!screen.contains("[sidebar.content]"), "{screen}");
    assert_eq!(screen.matches('[').count(), 1, "{screen}");
}

fn first(setup: &mut abi::Setup) -> Result<(), String> {
    setup
        .on_event(&["session.execution.succeeded"], |host, _| host.toast(abi::Toast::new(abi::Variant::Info, "first")));
    Ok(())
}

fn second(setup: &mut abi::Setup) -> Result<(), String> {
    setup.on_event(&["session.execution.succeeded"], |host, _| {
        host.toast(abi::Toast::new(abi::Variant::Info, "second"))
    });
    Ok(())
}

// Expected: the effects of a plugin over the C ABI and of one in process share one queue, so they run in the order the
// handlers ran, which is the order the plugins subscribed in.
#[test]
fn effects_of_both_paths_run_in_call_order() {
    let host = host();
    let _native = loopback(&host, abi::export_plugin!(@loopback "first", first));
    let direct = Registry::define(vec![abi::Plugin { id: "second", setup: second }.into()], []);
    direct.activate(&dynamic(&host));
    host.emit(&succeeded("ses_1"));
    host.app.advance(Duration::from_millis(1));
    let toasts: Vec<String> = host.toasts.borrow().iter().map(|toast| toast.message.clone()).collect();
    assert_eq!(toasts, ["first", "second"]);
}

// Expected: deactivating, reloading or unloading a plugin destroys its instance at once, also while a route of it is
// mounted, which then draws nothing; the replacement's setup ran before, and the old instance runs no more.
#[test]
fn the_instance_is_destroyed_at_once_while_its_route_is_mounted() {
    let host = host();
    let destroyed = || host.storage.borrow_mut().remove("plugin.sample.destroyed");
    let load = |build: &[u8]| {
        let (definition, error) = Native.load(&dynamic(&host), build, Some("{\"probe\":true}")).unwrap();
        definition.external("sample.so", error)
    };
    let registry = Registry::define(Vec::new(), []);
    registry.load(&dynamic(&host), load(&build("")));
    let route = registry.route(&*host, "sample", "hello").unwrap();
    assert!(registry.set_active(&dynamic(&host), "sample", false));
    assert_eq!(destroyed().as_deref(), Some("{\"destroyed\":true}"));

    assert!(registry.set_active(&dynamic(&host), "sample", true));
    let route = (route, registry.route(&*host, "sample", "hello").unwrap());
    host.storage.borrow_mut().remove("plugin.sample.count");
    registry.load(&dynamic(&host), load(&build("v2")));
    // The rebuild's setup stored its count, then the old instance was destroyed.
    assert_eq!(destroyed().as_deref(), Some("{\"destroyed\":true}"));
    assert_eq!(host.storage.borrow().get("plugin.sample.count").map(String::as_str), Some("{\"count\":1}"));
    route.1.sync(&*host, Some(&abi::Changed::everything()));
    host.app().root().clear();
    host.app().root().add(&route.1.root());
    host.app.render();
    assert!(!host.app.text().contains("Sample route hello"), "{}", host.app.text());

    let _route = registry.route(&*host, "sample", "hello").unwrap();
    registry.unload(&dynamic(&host), "sample.so");
    assert_eq!(destroyed().as_deref(), Some("{\"destroyed\":true}"));
}

// Expected: a command that panics fails the plugin, and its slot claims, of 1.3 rows and of the one API, draw empty
// once the key is handled, with a toast that says so.
#[test]
fn a_panic_clears_the_plugins_claims() {
    let host = host();
    let registry = Rc::new(active(&host, &build("still")));
    *host.registry.borrow_mut() = Rc::downgrade(&registry);
    let parent = View::new(host.app()).column();
    let _mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    host.app().root().add(&parent);
    host.app.render();
    let screen = host.app.text();
    assert!(screen.contains("sample plugin v1: home.footer") && screen.contains("sample home: 0 done"), "{screen}");
    host.keymap().dispatch("sample.panic", None);
    host.app.advance(Duration::from_millis(1));
    host.app.render();
    let screen = host.app.text();
    assert!(!screen.contains("sample plugin") && !screen.contains("sample home"), "{screen}");
    let failed = abi::Toast::new(abi::Variant::Error, "Run /plugins to view details.").title("Plugin failed: sample");
    assert_eq!(*host.toasts.borrow(), [failed]);
}

/// A `ts` fence that shows the language it gets and the model it reads.
fn fenced(setup: &mut abi::Setup) -> Result<(), String> {
    setup.code_block("ts", |read, fence| {
        let model = read.model().map_or("missing".to_owned(), |model| model.id);
        let text = format!("custom {} {model}", fence.language);
        abi::Fenced::Lines { lines: vec![vec![abi::Span::new(text)]], fg: None, drag: false }
    });
    Ok(())
}

// Expected: a fence registered as `ts`, which the host knows as `typescript`, reaches its render through the C ABI as
// in process, sees the same language, and reads the same host.
#[test]
fn a_fence_reads_and_renders_the_same_in_process_and_through_the_c_abi() {
    let host = host();
    let in_process = Registry::define(vec![abi::Plugin { id: "fenced", setup: fenced }.into()], []);
    in_process.activate(&dynamic(&host));
    let direct = markdown(&host, &in_process, "```ts\nlet a = 1\n```\n");
    assert!(direct.contains("custom typescript big"), "{direct}");
    let loopback = loopback(&host, abi::export_plugin!(@loopback "fenced", fenced));
    assert_eq!(markdown(&host, &loopback, "```ts\nlet a = 1\n```\n"), direct);
}

/// A claim that shows the ticks of a thread of its own, which wakes the host after each; disposal stops the thread.
fn ticking(setup: &mut abi::Setup) -> Result<(), String> {
    use std::sync::atomic::{AtomicBool, AtomicU64};
    let waker = setup.waker().ok_or("no waker")?;
    let (ticks, stop) = (Arc::new(AtomicU64::new(0)), Arc::new(AtomicBool::new(false)));
    let thread = {
        let (ticks, stop) = (ticks.clone(), stop.clone());
        std::thread::spawn(move || {
            while ticks.load(Ordering::Relaxed) < 3 && !stop.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(5));
                ticks.fetch_add(1, Ordering::Relaxed);
                waker.wake();
            }
        })
    };
    setup.on_dispose(move |_| {
        stop.store(true, Ordering::Relaxed);
        let _ = thread.join();
    });
    setup.slot(abi::Placement::append("home.footer"), move |_, _, _| {
        abi::Render::Show(abi::Node::text([abi::Span::new(format!("ticks {}", ticks.load(Ordering::Relaxed)))]))
    });
    Ok(())
}

// Expected: a plugin in process gets a waker too; a wake from its thread renders its claim again.
#[test]
fn a_wake_from_an_in_process_plugin_thread_draws_its_claims_again() {
    let host = host();
    let registry = Registry::define(vec![abi::Plugin { id: "ticking", setup: ticking }.into()], []);
    registry.activate(&dynamic(&host));
    let parent = View::new(host.app());
    let _mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    host.app().root().add(&parent);
    let ticked = host.app.wait_until(Duration::from_secs(10), || {
        host.app.render();
        host.app.text().contains("ticks 3")
    });
    assert!(ticked, "{}", host.app.text());
    assert!(registry.set_active(&dynamic(&host), "ticking", false));
}

/// The sample's server request and live panel, compiled in rather than loaded.
#[path = "../../../examples/sample/src/fetch.rs"]
mod sample_fetch;

/// The sample's fetch row before and after the reply, the fetches it sent, and the panels it showed, as `registry` has
/// them.
fn fetched(host: &Rc<TestHost>, registry: &Rc<Registry>) -> (Vec<String>, Vec<abi::Fetch>, Vec<abi::Dialog>) {
    host.dialogs.borrow_mut().clear();
    *host.registry.borrow_mut() = Rc::downgrade(registry);
    let parent = View::new(host.app()).column();
    let mounted = registry.mount(&**host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    host.app().root().clear();
    host.app().root().add(&parent);
    let row = |host: &TestHost| {
        host.app.render();
        host.app.text().lines().find(|line| line.contains("sample fetch:")).unwrap_or_default().trim_end().to_owned()
    };
    let mut rows = vec![row(host)];
    host.keymap().dispatch("sample.fetch", None);
    host.app.advance(Duration::from_millis(1));
    let fetches = host.fetches.borrow().iter().map(|(fetch, _)| fetch.clone()).collect();
    host.reply();
    host.app.advance(Duration::from_millis(1));
    rows.push(row(host));
    host.keymap().dispatch("sample.panel", None);
    host.keymap().dispatch("sample.panel", None);
    host.app.advance(Duration::from_millis(1));
    drop(mounted);
    let dialogs =
        host.dialogs.borrow().iter().map(|(id, dialog)| (assert_eq!(id, "sample"), dialog.clone()).1).collect();
    (rows, fetches, dialogs)
}

// Expected: the sample's fetch goes to the host, and its reply reaches `on_reply`, whose claim renders it without a
// change batch; its panel is shown again with its key and a new body; the same in process and from the library.
#[test]
fn the_sample_fetch_and_panel_act_the_same_in_process_and_through_the_library() {
    let host = host();
    let in_process =
        Rc::new(Registry::define(vec![abi::Plugin { id: "sample", setup: sample_fetch::setup }.into()], []));
    in_process.activate(&dynamic(&host));
    let direct = fetched(&host, &in_process);
    assert_eq!(direct.0, ["sample fetch: none", "sample fetch: /api/sample"]);
    assert_eq!(direct.1, [abi::Fetch { method: "GET".into(), path: "/api/sample".into(), ..abi::Fetch::default() }]);
    let bodies: Vec<_> = direct
        .2
        .iter()
        .map(|dialog| match dialog {
            abi::Dialog::Panel(panel) => (panel.key.clone(), panel.body.clone()),
            _ => unreachable!(),
        })
        .collect();
    let body = |count: u64| abi::Node::text([abi::Span::new(format!("shown {count} times"))]);
    assert_eq!(bodies, [("live".to_owned(), body(1)), ("live".to_owned(), body(2))]);
    in_process.set_active(&dynamic(&host), "sample", false);
    let library = Rc::new(active(&host, &build("still")));
    assert_eq!(fetched(&host, &library), direct);
}

/// A plugin that fetches on `x.fetch` and toasts each reply, with a claim that keeps it mounted.
fn replying(setup: &mut abi::Setup) -> Result<(), String> {
    setup.slot(abi::Placement::append("home.footer"), |_, _, _| abi::Render::Hide);
    let command = abi::Command { name: "x.fetch".into(), ..abi::Command::default() };
    setup.command(command, |host, _| {
        host.fetch(abi::Fetch { method: "GET".into(), path: "/slow".into(), ..abi::Fetch::default() });
    });
    setup.on_reply(|host, _, _| host.toast(abi::Toast::new(abi::Variant::Info, "reply")));
    Ok(())
}

// Expected: a reply that arrives after its plugin was disabled reaches nothing, in process and over the C ABI, also while
// a claim of it is still mounted, while a reply to an active plugin does.
#[test]
fn a_slow_reply_across_a_disable_delivers_nothing() {
    let host = host();
    let registries = [
        Registry::define(vec![abi::Plugin { id: "replying", setup: replying }.into()], []),
        loopback(&host, abi::export_plugin!(@loopback "replying", replying)),
    ];
    for registry in registries {
        registry.activate(&dynamic(&host));
        host.keymap().dispatch("x.fetch", None);
        host.app.advance(Duration::from_millis(1));
        host.reply();
        host.app.advance(Duration::from_millis(1));
        assert_eq!(host.toasts.borrow_mut().drain(..).count(), 1);
        host.keymap().dispatch("x.fetch", None);
        host.app.advance(Duration::from_millis(1));
        assert_eq!(host.fetches.borrow().len(), 1);
        let parent = View::new(host.app()).column();
        let _mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
        registry.set_active(&dynamic(&host), "replying", false);
        host.reply();
        host.app.advance(Duration::from_millis(1));
        assert!(host.toasts.borrow().is_empty(), "{:?}", host.toasts.borrow());
    }
}

/// The sample's prompt footer claim, compiled in rather than loaded.
#[path = "../../../examples/sample/src/prompt.rs"]
mod sample_prompt;

/// The sample's prompt row as `registry` mounts `prompt.footer` for `ses_1`: as mounted, after its fetch is answered,
/// once the session pane lost the input, and as mounted again beside the first mount and then alone; with the fetches.
fn prompted(host: &Rc<TestHost>, registry: &Registry) -> (Vec<String>, Vec<abi::Fetch>) {
    host.interactive.set(true);
    let input = SlotInput {
        session_id: Some("ses_1".to_owned()),
        prompt: Some(slot::PromptFooter { shell: false, show_details: true }),
        ..SlotInput::default()
    };
    let row = |host: &TestHost, parent: &View| {
        host.app().root().clear();
        host.app().root().add(parent);
        host.app.advance(Duration::from_millis(1));
        host.app.render();
        host.app.text().lines().find(|line| line.contains("sample prompt:")).unwrap_or_default().trim_end().to_owned()
    };
    let mut fetches = Vec::new();
    let mut take = |host: &TestHost| fetches.extend(host.fetches.borrow().iter().map(|(fetch, _)| fetch.clone()));
    let parent = View::new(host.app()).column();
    let first = registry.mount(&**host, &parent, "prompt.footer", &input, |_| {});
    let mut rows = vec![row(host, &parent)];
    take(host);
    host.reply();
    rows.push(row(host, &parent));
    host.interactive.set(false);
    first.sync(&**host, Some(&abi::Changed::everything()));
    rows.push(row(host, &parent));
    // A remount mounts the next before the last goes.
    let again = View::new(host.app()).column();
    let second = registry.mount(&**host, &again, "prompt.footer", &input, |_| {});
    rows.push(row(host, &again));
    drop(first);
    second.sync(&**host, Some(&abi::Changed::everything()));
    rows.push(row(host, &again));
    take(host);
    host.reply();
    drop(second);
    (rows, fetches)
}

// Expected: each mount of the sample's prompt claim runs its `on_mount`, which fetches, and an unmount runs it again;
// the claim reads whether the session pane owns the input and a command's key; the same in process and from the
// library, where the mounts cross the C ABI as requests.
#[test]
fn the_sample_prompt_mounts_fetch_and_read_the_same_in_process_and_through_the_library() {
    let host = host();
    let in_process = Registry::define(vec![abi::Plugin { id: "sample", setup: sample_prompt::setup }.into()], []);
    in_process.activate(&dynamic(&host));
    let direct = prompted(&host, &in_process);
    assert_eq!(
        direct.0,
        [
            "sample prompt: 1 mounts, waiting, on, ctrl+p",
            "sample prompt: 1 mounts, /api/sample/ses_1, on, ctrl+p",
            "sample prompt: 1 mounts, /api/sample/ses_1, off, ctrl+p",
            "sample prompt: 2 mounts, /api/sample/ses_1, off, ctrl+p",
            "sample prompt: 1 mounts, /api/sample/ses_1, off, ctrl+p",
        ]
    );
    let fetch = abi::Fetch { method: "GET".into(), path: "/api/sample/ses_1".into(), ..abi::Fetch::default() };
    assert_eq!(direct.1, [fetch.clone(), fetch]);
    in_process.set_active(&dynamic(&host), "sample", false);
    let library = active(&host, &build("still"));
    assert_eq!(prompted(&host, &library), direct);
}

/// A thread that wakes the host once its claim drew, a wake handler that counts the wakes it ran for and fetches each time, and
/// a claim that shows the count.
fn waking(setup: &mut abi::Setup) -> Result<(), String> {
    use std::sync::atomic::AtomicBool;
    let waker = setup.waker().ok_or("no waker")?;
    let (go, stop) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicBool::new(false)));
    let thread = {
        let (go, stop) = (go.clone(), stop.clone());
        std::thread::spawn(move || {
            while !go.load(Ordering::Acquire) && !stop.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(1));
            }
            waker.wake();
        })
    };
    setup.on_dispose(move |_| {
        stop.store(true, Ordering::Release);
        let _ = thread.join();
    });
    let runs = Rc::new(std::cell::Cell::new(0));
    let ran = runs.clone();
    setup.on_wake(move |host| {
        ran.set(ran.get() + 1);
        host.fetch(abi::Fetch { method: "GET".into(), path: "/api/woken".into(), ..abi::Fetch::default() });
    });
    setup.slot(abi::Placement::append("home.footer"), move |_, _, changed| {
        go.store(true, Ordering::Release);
        abi::Render::Show(abi::Node::text([abi::Span::new(format!("wakes {} {}", runs.get(), changed.woken))]))
    });
    Ok(())
}

// Expected: a wake from the plugin's thread runs its wake handler on the UI thread, whose effects go out, and then its
// claim renders again with `woken`; the same in process and through the C ABI's byte shims (`Loopback`).
#[test]
fn a_wake_runs_the_wake_handlers_then_renders_on_both_paths() {
    let host = host();
    let registries = [
        Registry::define(vec![abi::Plugin { id: "waking", setup: waking }.into()], []),
        loopback(&host, abi::export_plugin!(@loopback "waking", waking)),
    ];
    for registry in registries {
        host.fetches.borrow_mut().clear();
        registry.activate(&dynamic(&host));
        let parent = View::new(host.app());
        let _mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
        host.app().root().clear();
        host.app().root().add(&parent);
        let woken = host.app.wait_until(Duration::from_secs(10), || {
            host.app.render();
            host.app.text().contains("wakes 1 true")
        });
        assert!(woken, "{}", host.app.text());
        let paths: Vec<String> = host.fetches.borrow().iter().map(|(fetch, _)| fetch.path.clone()).collect();
        assert_eq!(paths, ["/api/woken"]);
        drop(_mounted);
        registry.set_active(&dynamic(&host), "waking", false);
    }
}

thread_local! {
    /// The waker the `guarded` plugin got, and the wakes freed on this thread as its guard dropped.
    static GUARDED: std::cell::RefCell<Option<abi::Waker>> = const { std::cell::RefCell::new(None) };
    static FREED_AT_GUARD: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
    static GUARDED_RENDERS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// What `guarded`'s dispose callback holds: a waker, as a plugin thread's join guard does.
struct Guard(#[allow(dead_code)] abi::Waker);

impl Drop for Guard {
    fn drop(&mut self) {
        FREED_AT_GUARD.set(Some(crate::activation::FREED.get()));
    }
}

/// Keeps its waker in a dispose callback and in [`GUARDED`], and counts the renders of its claim.
fn guarded(setup: &mut abi::Setup) -> Result<(), String> {
    let waker = setup.waker().ok_or("no waker")?;
    GUARDED.set(Some(waker.clone()));
    let guard = Guard(waker);
    setup.on_dispose(move |_| drop(guard));
    setup.slot(abi::Placement::append("home.footer"), |_, _, _| {
        GUARDED_RENDERS.set(GUARDED_RENDERS.get() + 1);
        abi::Render::Show(abi::Node::text([abi::Span::new("guarded")]))
    });
    Ok(())
}

// Expected (carbon-1): a waker that a plugin keeps past its registry, here in a dispose callback that never runs, keeps
// its target alive, and a wake after the plugin was disabled does nothing, also while a claim of it is still mounted.
#[test]
fn a_waker_never_outlives_its_target_and_a_late_wake_does_nothing() {
    let host = host();
    let registry = Registry::define(vec![abi::Plugin { id: "guarded", setup: guarded }.into()], []);
    registry.activate(&dynamic(&host));
    let freed = crate::activation::FREED.get();
    drop(registry);
    assert_eq!(FREED_AT_GUARD.take(), Some(freed), "the wake was freed before the guard that holds the waker");
    GUARDED.take().unwrap().wake();

    let registry = Registry::define(vec![abi::Plugin { id: "guarded", setup: guarded }.into()], []);
    registry.activate(&dynamic(&host));
    let parent = View::new(host.app());
    let _mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    let renders = GUARDED_RENDERS.get();
    assert!(registry.set_active(&dynamic(&host), "guarded", false));
    GUARDED.take().unwrap().wake();
    host.app.wait_until(Duration::from_millis(50), || false);
    assert_eq!(GUARDED_RENDERS.get(), renders, "a wake after the plugin was disposed rendered it again");
}

/// Toasts as it sets up and as it is disposed, when it also asks for a reply that must not come.
fn lifecycle(setup: &mut abi::Setup) -> Result<(), String> {
    setup.host().toast(abi::Toast::new(abi::Variant::Info, "setup"));
    setup.on_dispose(|host| {
        host.toast(abi::Toast::new(abi::Variant::Info, "dispose"));
        host.fetch(abi::Fetch { method: "GET".into(), path: "/disposed".into(), ..abi::Fetch::default() });
    });
    setup.on_reply(|host, _, _| host.toast(abi::Toast::new(abi::Variant::Info, "reply")));
    Ok(())
}

/// [`lifecycle`], then fails.
fn lifecycle_failing(setup: &mut abi::Setup) -> Result<(), String> {
    lifecycle(setup)?;
    Err("lifecycle failed".to_owned())
}

/// `setup` in process, or `create` through the C ABI's byte shims, set up, then disabled: its status after setup, and
/// the toasts and fetches of the whole run.
fn lifecycled(
    setup: fn(&mut abi::Setup) -> Result<(), String>,
    create: unsafe extern "C" fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32,
    loopback: bool,
) -> (Entry, Vec<String>, usize) {
    let host = host();
    let registry = Registry::define(Vec::new(), []);
    match loopback {
        true => {
            // As a library of this crate, which tells its ID, so its setup runs on activation only.
            unsafe extern "C" fn describe(out: *mut Owned) -> i32 {
                // SAFETY: the loader passes what `PluginApi::describe` documents.
                unsafe { abi::runtime::describe("lifecycle", "0.1.0", out) }
            }
            let api = PluginApi {
                size: size_of::<PluginApi>(),
                major: ABI_MAJOR,
                minor: ABI_MINOR,
                requires_minor: 4,
                create: Some(create),
                call: Some(abi::runtime::call),
                destroy: Some(abi::runtime::destroy),
                free: Some(abi::runtime::free),
                describe: Some(describe),
            };
            let library = Library::from_table(&api, HOST_MINOR).unwrap();
            let (definition, error) = define(&dynamic(&host), library, None).unwrap();
            registry.load(&dynamic(&host), definition.external("lifecycle.so", error));
        }
        false => {
            registry.add(abi::Plugin { id: "lifecycle", setup });
            registry.activate(&dynamic(&host));
        }
    }
    let entry = registry.entries().into_iter().find(|entry| entry.id == "lifecycle").unwrap();
    registry.set_active(&dynamic(&host), "lifecycle", false);
    host.app.advance(Duration::from_millis(1));
    host.reply();
    host.app.advance(Duration::from_millis(1));
    let toasts = host.toasts.borrow().iter().map(|toast| toast.message.clone()).collect();
    (entry, toasts, host.fetches.borrow().len())
}

// Expected (bigboi-5): a toast in setup and one in a dispose callback both show, in that order, the same in process and
// through the C ABI; the dispose callback's fetch is never sent. A setup that fails after it registered the callback
// runs it as it fails, leaves the plugin failed and not active, and acts the same on both paths.
#[test]
fn setup_and_dispose_effects_are_the_same_on_both_paths() {
    let direct = lifecycled(lifecycle, abi::export_plugin!(@loopback "lifecycle", lifecycle), false);
    assert_eq!((direct.0.status.clone(), direct.0.active), (Status::Active, true));
    assert_eq!((direct.1.as_slice(), direct.2), (["setup", "dispose"].map(String::from).as_slice(), 0));
    let through = lifecycled(lifecycle, abi::export_plugin!(@loopback "lifecycle", lifecycle), true);
    assert_eq!((through.1, through.2), (direct.1, direct.2));

    let direct = lifecycled(lifecycle_failing, abi::export_plugin!(@loopback "lifecycle", lifecycle_failing), false);
    assert_eq!((direct.0.status.clone(), direct.0.active), (Status::Failed("lifecycle failed".to_owned()), false));
    assert_eq!((direct.1.as_slice(), direct.2), (["setup", "dispose"].map(String::from).as_slice(), 0));
    let through = lifecycled(lifecycle_failing, abi::export_plugin!(@loopback "lifecycle", lifecycle_failing), true);
    assert_eq!(
        (through.0.status, through.0.active, through.1, through.2),
        (direct.0.status, false, direct.1, direct.2)
    );
}

// Expected (bigboi-1): a setup that fails or panics after it registered a dispose callback runs it while the host is
// still valid, so the sample's `destroyed` is stored, and the plugin is failed and not active.
#[test]
fn a_failed_setup_runs_the_dispose_callbacks_it_registered() {
    for (options, error) in [
        ("{\"probe\":true,\"fail\":true}", "sample setup failed"),
        ("{\"probe\":true,\"panic\":true}", "setup panicked: sample setup panicked"),
    ] {
        let host = host();
        let (definition, failure) = Native.load(&dynamic(&host), &build(""), Some(options)).unwrap();
        let registry = Registry::define(Vec::new(), []);
        let failed = registry.load(&dynamic(&host), definition.external("sample.so", failure));
        assert_eq!(failed, Some(crate::SetupFailed { error: error.to_owned(), kept: false }));
        assert_eq!(status(&registry), Status::Failed(error.to_owned()));
        assert!(!entry(&registry.entries(), "sample.so").active);
        let stored = host.storage.borrow().get("plugin.sample.destroyed").cloned();
        assert_eq!(stored.as_deref(), Some("{\"destroyed\":true}"), "{options}");
    }
}

/// A loader of the sample at `<config>/sample.so` with `options`, under `directives`.
fn configured(options: &str, directives: &[&str]) -> (opencode_util::temp::TempDir, String, Registry, Loader) {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    fs::create_dir_all(&config).unwrap();
    let file = config.join(format!("sample.{}", std::env::consts::DLL_EXTENSION));
    fs::write(&file, build("")).unwrap();
    let target = file.to_string_lossy().into_owned();
    let registry = Registry::define(Vec::new(), [target.as_str()].into_iter().chain(directives.iter().copied()));
    let entry = Configured { target: target.clone(), options: Some(options.to_owned()) };
    let loader = Loader::new(Rc::new(Native) as Rc<dyn Backend>, config, root.path().to_path_buf(), vec![entry]);
    (root, target, registry, loader)
}

const MAJOR_2: &str = "plugin ABI 2.0 is not supported: this opencode-native loads ABI 1.x plugins (up to 1.4); rebuild \
                       the plugin against opencode-plugin-abi 1";

// Expected (carbon-2): an external plugin whose setup fails says so in a toast that opens the plugin manager, as a
// load failure does, and is failed and not active, so the manager offers to enable it; a broken rebuild then replaces
// the error, and enabling it fails again rather than start the old build.
#[test]
fn a_failed_external_setup_is_failed_and_inactive_and_a_reload_error_replaces_it() {
    let host = host();
    let (_root, target, registry, loader) = configured("{\"fail\":true}", &[]);
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let failed = abi::Toast::new(abi::Variant::Error, "Run /plugins to view details.");
    assert_eq!(*host.toasts.borrow(), [failed.clone().title("Plugin failed: sample")]);
    let sample = entry(&registry.entries(), &target).clone();
    assert_eq!((sample.status, sample.active), (Status::Failed("sample setup failed".to_owned()), false));

    fs::write(&target, build("major-2")).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let sample = entry(&registry.entries(), &target).clone();
    assert_eq!((sample.status, sample.active), (Status::Failed(MAJOR_2.to_owned()), false));
    assert_eq!(host.toasts.borrow()[1], failed.clone().title("Plugin failed: sample"));
    assert!(registry.set_active(&dynamic(&host), "sample", true));
    let sample = entry(&registry.entries(), &target).clone();
    assert_eq!((sample.status, sample.active), (Status::Failed(MAJOR_2.to_owned()), false));
}

// Expected (plugin-live R2-3): a build that never described an ID is named by its target in the failure toast.
#[test]
fn a_failed_load_without_an_id_is_named_by_its_target() {
    let host = host();
    let (_root, target, registry, loader) = configured("{}", &[]);
    fs::write(&target, build("major-2")).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let failed = abi::Toast::new(abi::Variant::Error, "Run /plugins to view details.");
    assert_eq!(*host.toasts.borrow(), [failed.title(format!("Plugin failed: {target}"))]);
}

// Expected (carbon-2): a broken build of a plugin that `cli.json` disabled is listed as failed with its error, not as
// inactive, with a toast; enabling it in the plugin manager fails too and starts nothing of the build it replaced.
#[test]
fn a_broken_build_of_an_inactive_plugin_is_failed_and_enabling_it_starts_nothing() {
    let host = host();
    let (_root, target, registry, loader) = configured("{}", &["-sample"]);
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!(entry(&registry.entries(), &target).status, Status::Inactive);
    fs::write(&target, build("major-2")).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let failed = abi::Toast::new(abi::Variant::Error, "Run /plugins to view details.");
    assert_eq!(*host.toasts.borrow(), [failed.title("Plugin failed: sample")]);
    assert_eq!(entry(&registry.entries(), &target).status, Status::Failed(MAJOR_2.to_owned()));
    assert!(registry.set_active(&dynamic(&host), "sample", true));
    let sample = entry(&registry.entries(), &target).clone();
    assert_eq!((sample.status, sample.active), (Status::Failed(MAJOR_2.to_owned()), false));
    let screen = markdown(&host, &registry, "```sample\nstale\n```\n");
    assert!(!screen.contains("SAMPLE"), "{screen}");
}

// Expected: deactivating every plugin, as the host exits, runs each one's dispose callbacks while the host is alive,
// in process and through the C ABI.
#[test]
fn deactivating_all_disposes_every_active_plugin() {
    let host = host();
    let registry = Registry::define(vec![abi::Plugin { id: "lifecycle", setup: lifecycle }.into()], []);
    registry.activate(&dynamic(&host));
    let (definition, error) = super::loopback(&dynamic(&host), abi::export_plugin!(@loopback "first", first)).unwrap();
    registry.load(&dynamic(&host), definition.external("first.so", error));
    registry.deactivate_all();
    host.app.advance(Duration::from_millis(1));
    let toasts: Vec<String> = host.toasts.borrow().iter().map(|toast| toast.message.clone()).collect();
    assert_eq!(toasts, ["setup", "dispose"]);
    assert!(registry.entries().iter().all(|entry| !entry.active), "{:?}", registry.entries());
}

// Expected: the quick start of `crates/plugin-abi/README.md` (`examples/hello`) works as it says: installed as
// `<config>/plugins/hello/plugin.so`, it is active, `hello.greet` toasts, and its claim draws in `home.footer`.
#[test]
fn the_quick_start_plugin_loads_from_a_plugins_directory_and_runs() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let target = root.join("../../target/sample-plugin");
    let status = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned()))
        .args(["build", "--quiet", "--manifest-path"])
        .arg(root.join("examples/hello/Cargo.toml"))
        .arg("--target-dir")
        .arg(&target)
        .status()
        .unwrap();
    assert!(status.success(), "the quick start plugin did not build");
    let name = format!("{}opencode_hello{}", std::env::consts::DLL_PREFIX, std::env::consts::DLL_SUFFIX);
    let temp = opencode_util::temp::tempdir().unwrap();
    let config = temp.path().join("config");
    let dir = config.join("plugins").join("hello");
    fs::create_dir_all(&dir).unwrap();
    fs::copy(target.join("debug").join(name), dir.join(entry_file())).unwrap();

    let host = host();
    let registry = Registry::define(Vec::new(), []);
    let loader =
        Loader::new(Rc::new(Native) as Rc<dyn Backend>, config, temp.path().to_path_buf(), Vec::<Configured>::new());
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let hello = entry(&registry.entries(), &dir.to_string_lossy()).clone();
    assert_eq!((hello.id.as_str(), hello.status), ("example.hello", Status::Active));

    assert!(matches!(host.keymap().dispatch("hello.greet", None), RunResult::Ok));
    host.app.advance(Duration::from_millis(1));
    assert_eq!(*host.toasts.borrow(), [abi::Toast::new(abi::Variant::Success, "Hello from a plugin")]);
    let parent = View::new(host.app());
    let _mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    host.app().root().clear();
    host.app().root().add(&parent);
    host.app.render();
    assert!(host.app.text().contains("hello"), "{}", host.app.text());
}

// Expected (r2 review, bigboi-ui-1 and carbon-ui-2): a library is staged in a directory this process creates
// itself, not at a name another user can claim first, and nothing is left behind.
#[test]
fn a_library_is_staged_in_a_directory_only_this_process_owns() {
    let library = build("");
    let claimed = std::env::temp_dir().join(format!("opencode-rs-plugins-{}", std::process::id()));
    fs::write(&claimed, "").unwrap();
    let inspected = Native.inspect(&library);
    fs::remove_file(&claimed).unwrap();
    assert_eq!(inspected.unwrap().minor, 4);
    assert!(!claimed.exists());
}
