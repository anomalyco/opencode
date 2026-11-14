use std::fs;
use std::path::Path;
use std::process::Command;
use std::rc::Rc;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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
    // The current build is 1.6; a 1.0 build has the shorter table and still loads and works on this 1.6 host.
    let current = build("");
    assert_eq!(Native.inspect(&current).unwrap(), Inspected { major: 1, minor: 6, version: Some("0.1.0".to_owned()) });
    // A plugin built on the frozen 1.4 crate, from before 1.5, draws its fence and its slot and runs its command.
    let v1_4 = build("abi-1-4");
    assert_eq!(Native.inspect(&v1_4).unwrap(), Inspected { major: 1, minor: 4, version: Some("0.1.0".to_owned()) });
    let fresh = crate::loader::tests::host();
    let registry = active(&fresh, &v1_4);
    let screen = markdown(&fresh, &registry, "```sample\nfour\n```\n");
    assert!(screen.contains("SAMPLE 1.4 FOUR"), "{screen}");
    let parent = View::new(fresh.app());
    let _mounted = registry.mount(&*fresh, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    fresh.app().root().clear();
    fresh.app().root().add(&parent);
    fresh.app.render();
    assert!(fresh.app.text().contains("  sample plugin 1.4: home.footer"), "{}", fresh.app.text());
    assert!(matches!(fresh.keymap().dispatch("sample.hello", None), RunResult::Ok));
    fresh.app.advance(Duration::from_millis(1));
    assert_eq!(*fresh.toasts.borrow(), [abi::Toast::new(abi::Variant::Success, "Hello from sample 1.4")]);
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

    // A plugin that asks for the 1.5 host with `requires_minor = 5` loads here and is refused by a 1.4 host.
    let needs = build("requires-1-5");
    assert!(Library::open(&needs, HOST_MINOR).is_ok());
    assert_eq!(
        Library::open(&needs, 4).err().unwrap(),
        "plugin needs host ABI 1.5 or newer, this opencode-native has 1.4; update opencode-native"
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
        "plugin ABI 2.0 is not supported: this opencode-native loads ABI 1.x plugins (up to 1.6); rebuild the \
         plugin against opencode-plugin-abi 1"
    );
    assert_eq!(
        load(&build("requires-future"), None).unwrap(),
        "plugin needs host ABI 1.99 or newer, this opencode-native has 1.6; update opencode-native"
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
/// storage when the host syncs it again. The pointer starts off the claim: a claim keeps its widgets across a sync,
/// so one under the pointer stays hovered.
fn sidebar(host: &Rc<TestHost>, registry: &Registry) -> Vec<Capture> {
    host.app.hover(59, 9);
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

/// The sample's reads and verbs of ABI 1.6, compiled in rather than loaded.
#[path = "../../../examples/sample/src/reads.rs"]
mod sample_reads;

/// A text delta, as the server streams one.
fn text_delta(delta: &str) -> abi::types::V2Event {
    serde_json::from_value(serde_json::json!({
        "id": "evt_1",
        "created": 1,
        "type": "session.text.delta",
        "data": { "sessionID": "ses_1", "assistantMessageID": "msg_1", "ordinal": 0, "delta": delta },
    }))
    .unwrap()
}

/// What 1.6 shows and asks for through `registry`: the sample's reads row in `home.footer` as it mounts, once a frame
/// laid it out, after two deltas, and after its verbs command; then the verbs the host ran, the toasts and the dialogs.
type Verbed = (Vec<String>, Vec<String>, Vec<String>, Vec<(String, abi::Dialog)>);

fn verbed(host: &Rc<TestHost>, registry: &Registry) -> Verbed {
    host.app.resize(240, 10);
    let row = |host: &TestHost, parent: &View| {
        host.app.advance(Duration::from_millis(1));
        host.app().root().clear();
        host.app().root().add(parent);
        // One frame: the claim shows what it renders for its size in the frame that lays it out (reviews bigboi-3,
        // carbon-2).
        let text = host.app.render().text();
        text.lines().find(|line| line.contains("sample reads:")).unwrap_or_default().trim().to_owned()
    };
    let parent = View::new(host.app()).column();
    let mounted = registry.mount(&**host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    let mut rows = vec![row(host, &parent), row(host, &parent)];
    host.emit_deltas(&[text_delta("a"), text_delta("b")]);
    rows.push(row(host, &parent));
    host.keymap().dispatch("sample.verbs", None);
    host.app.advance(Duration::from_millis(1));
    host.exit();
    rows.push(row(host, &parent));
    drop(mounted);
    let toasts = host.toasts.borrow_mut().drain(..).map(|toast| toast.message).collect();
    let dialogs = host.dialogs.borrow_mut().drain(..).collect();
    (rows, host.verbs.borrow_mut().drain(..).collect(), toasts, dialogs)
}

// Expected: a claim reads its own laid-out size (renders again with `size` once a frame laid it out), the
// variants, the tabs, the keymap, the selection and the themes; it gets the deltas, once a batch; a command's verbs
// run once it returns, in order, those that answer `false` not at all, and a program's exit code comes back as a
// reply. The same in process and from the library, where every read and verb crosses the C ABI.
#[test]
fn the_1_6_reads_and_verbs_are_the_same_in_process_and_through_the_library() {
    let host = host();
    let in_process = Registry::define(vec![abi::Plugin { id: "sample", setup: sample_reads::setup }.into()], []);
    in_process.activate(&dynamic(&host));
    let direct = verbed(&host, &in_process);
    let read = "default low+high, tabs true ses_1*,ses_2, keys ctrl+p,f1 [ctrl+x] 3 1, sel picked, theme opencode of 2";
    assert_eq!(
        direct.0,
        [
            // The frame that first lays the claim out shows it at its size.
            format!("sample reads: 240x1 resized, {read}, deltas 0, exit -"),
            format!("sample reads: 240x1 resized, {read}, deltas 0, exit -"),
            format!("sample reads: 240x1, {read}, deltas 2, exit -"),
            format!("sample reads: 240x1, {read}, deltas 2, exit 0"),
        ]
    );
    assert_eq!(
        direct.1,
        [
            r#"variant Some("high")"#,
            r#"tab Focus { session: "ses_1" }"#,
            "theme nord",
            "model opencode/small",
            "clear selection",
            "title sample title",
            r#"install sample {"theme":{}}"#,
            r#"foreground true ["a"]"#,
        ]
    );
    assert_eq!(direct.2, ["sample verbs: true false true false true false"]);
    let [(_, abi::Dialog::Panel(panel))] = direct.3.as_slice() else { panic!("{:?}", direct.3) };
    assert_eq!(panel.size, abi::PanelSize::XLarge);
    in_process.set_active(&dynamic(&host), "sample", false);

    let (definition, error) = Native.load(&dynamic(&host), &build("still"), Some(r#"{"reads":true}"#)).unwrap();
    let library = Registry::define(Vec::new(), []);
    library.load(&dynamic(&host), definition.external("sample.so", error));
    assert_eq!(status(&library), Status::Active);
    assert_eq!(verbed(&host, &library), direct);
}

thread_local! {
    /// The renders of `flipping`'s claim.
    static FLIPS: Cell<u32> = const { Cell::new(0) };
}

/// A sized claim one row tall at height 2 and two rows tall at any other: each layout changes its height again.
fn flipping(setup: &mut abi::Setup) -> Result<(), String> {
    let at = || abi::Placement::append("home.footer");
    setup.slot(at(), |_, input, _| {
        FLIPS.set(FLIPS.get() + 1);
        let rows = if input.height == 2 { 1 } else { 2 };
        abi::Render::Show(abi::Node::column((0..rows).map(|_| abi::Node::text([abi::Span::new("flip")])).collect()))
    });
    setup.sized(at());
    Ok(())
}

// Expected (reviews bigboi-3, carbon-2): a claim renders for a new size in the frame that laid it out, at most twice
// a frame. One whose size changes with each render does not fail the frame (OpenTUI lays a frame out at most 8 times);
// it renders again after each frame, from a timer, until it settles or goes. On both paths.
#[test]
fn a_claim_that_resizes_itself_renders_twice_a_frame() {
    let host = host();
    let registries = [
        Registry::define(vec![abi::Plugin { id: "flipping", setup: flipping }.into()], []),
        loopback(&host, abi::export_plugin!(@loopback "flipping", flipping)),
    ];
    for registry in registries {
        registry.activate(&dynamic(&host));
        let parent = View::new(host.app()).column();
        let mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
        host.app().root().clear();
        host.app().root().add(&parent);
        for frame in 0..3 {
            let before = FLIPS.get();
            host.app.render();
            assert_eq!(FLIPS.get() - before, 2, "renders in frame {frame}");
            // The timer renders it once more, for the next frame.
            host.app.advance(Duration::ZERO);
            assert_eq!(FLIPS.get() - before, 3, "renders after frame {frame}");
        }
        drop(mounted);
        registry.set_active(&dynamic(&host), "flipping", false);
    }
}

/// A sized claim that shows an empty column below 100 cells, and its width from 100.
fn narrow(setup: &mut abi::Setup) -> Result<(), String> {
    let at = || abi::Placement::append("home.footer");
    setup.slot(at(), |_, input, _| match input.width {
        width if width < 100 => abi::Render::Show(abi::Node::column(Vec::new())),
        width => abi::Render::Show(abi::Node::text([abi::Span::new(format!("wide {width}"))])),
    });
    setup.sized(at());
    Ok(())
}

// Expected (review bigboi-3): a claim that shows nothing while narrow, as an empty column, still has a width, and
// shows its node in the first frame that is wide enough. (A hidden claim has none, as in TS.)
#[test]
fn a_claim_empty_while_narrow_shows_once_wide() {
    let host = host();
    let registry = Registry::define(vec![abi::Plugin { id: "narrow", setup: narrow }.into()], []);
    registry.activate(&dynamic(&host));
    let parent = View::new(host.app()).column();
    let mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    host.app().root().clear();
    host.app().root().add(&parent);
    host.app.resize(80, 10);
    assert!(!host.app.render().text().contains("wide"));
    host.app.resize(120, 10);
    assert!(host.app.render().text().contains("wide 120"), "{}", host.app.text());
    drop(mounted);
    registry.set_active(&dynamic(&host), "narrow", false);
}

/// A command that asks for a program in the foreground, and one that asks and then panics.
fn asking(setup: &mut abi::Setup) -> Result<(), String> {
    let run = |host: &dyn abi::Host| {
        host.foreground(abi::Foreground { command: "true".into(), ..abi::Foreground::default() });
    };
    setup.command(abi::Command { name: "x.run".into(), ..abi::Command::default() }, move |host, _| run(host));
    setup.command(abi::Command { name: "x.boom".into(), ..abi::Command::default() }, move |host, _| {
        run(host);
        panic!("boom");
    });
    Ok(())
}

// Expected (reviews bigboi-4, carbon-1): a program starts only while the plugin that asked for it is active: the host
// checks as it starts, after the turn, so one asked for before a disable, or before another call fails the plugin,
// does not start. On both paths.
#[test]
fn a_program_starts_only_while_its_plugin_is_active() {
    let host = host();
    let registries = [
        Registry::define(vec![abi::Plugin { id: "asking", setup: asking }.into()], []),
        loopback(&host, abi::export_plugin!(@loopback "asking", asking)),
    ];
    for registry in registries {
        registry.activate(&dynamic(&host));
        host.keymap().dispatch("x.run", None);
        host.app.advance(Duration::from_millis(1));
        assert_eq!(host.programs_alive(), [true]);
        registry.set_active(&dynamic(&host), "asking", false);
        assert_eq!(host.programs_alive(), [false]);
        host.exit();

        registry.set_active(&dynamic(&host), "asking", true);
        host.keymap().dispatch("x.run", None);
        host.app.advance(Duration::from_millis(1));
        host.keymap().dispatch("x.boom", None);
        host.app.advance(Duration::from_millis(1));
        assert_eq!(host.programs_alive(), [false], "a failed plugin's program starts");
        host.exit();
        registry.set_active(&dynamic(&host), "asking", false);
        host.toasts.borrow_mut().clear();
    }
}

thread_local! {
    /// The renders of `counted`'s route.
    static ROUTE_RENDERS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// A route that counts its renders.
fn counted(setup: &mut abi::Setup) -> Result<(), String> {
    setup.route("r", |_, _| {
        ROUTE_RENDERS.set(ROUTE_RENDERS.get() + 1);
        abi::Render::Show(abi::Node::text([abi::Span::new("counted route")]))
    });
    Ok(())
}

// Expected: a route renders once as it mounts and is laid out: it has no size of its own to read (1.6 `sized` is for
// slot claims), so its layout renders nothing more. On both paths.
#[test]
fn a_route_renders_once_for_its_layout() {
    let host = host();
    let registries = [
        Registry::define(vec![abi::Plugin { id: "counted", setup: counted }.into()], []),
        loopback(&host, abi::export_plugin!(@loopback "counted", counted)),
    ];
    for registry in registries {
        registry.activate(&dynamic(&host));
        ROUTE_RENDERS.set(0);
        let route = registry.route(&*host, "counted", "r").unwrap();
        host.app().root().clear();
        host.app().root().add(&route.root());
        host.app.render();
        host.app.advance(Duration::from_millis(1));
        host.app.render();
        assert!(host.app.text().contains("counted route"), "{}", host.app.text());
        assert_eq!(ROUTE_RENDERS.get(), 1);
        drop(route);
        registry.set_active(&dynamic(&host), "counted", false);
    }
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

// Expected (review carbon-pt-4): a claim of an in-process plugin that is still mounted after the plugin was disabled
// calls it no more, as one through the C ABI does, whose instance is gone.
#[test]
fn a_claim_mounted_past_a_disable_calls_the_plugin_no_more() {
    let host = host();
    let registry = Registry::define(vec![abi::Plugin { id: "guarded", setup: guarded }.into()], []);
    registry.activate(&dynamic(&host));
    let parent = View::new(host.app());
    let mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    let changed = abi::Changed { all: true, ..abi::Changed::default() };
    let renders = GUARDED_RENDERS.get();
    mounted.sync(&*host, Some(&changed));
    assert!(GUARDED_RENDERS.get() > renders, "a change batch rendered nothing while the plugin ran");
    assert!(registry.set_active(&dynamic(&host), "guarded", false));
    let renders = GUARDED_RENDERS.get();
    mounted.sync(&*host, Some(&changed));
    assert_eq!(GUARDED_RENDERS.get(), renders, "a claim rendered its plugin after the plugin was disposed");
    GUARDED.take();
}

thread_local! {
    /// The waker the `keeping` plugin keeps past its activation, as a thread of it would.
    static KEPT: std::cell::RefCell<Option<abi::Waker>> = const { std::cell::RefCell::new(None) };
}

/// Keeps its waker in [`KEPT`]; its command panics.
fn keeping(setup: &mut abi::Setup) -> Result<(), String> {
    KEPT.set(Some(setup.waker().ok_or("no waker")?));
    let panic = abi::Command { name: "keeping.panic".to_owned(), ..abi::Command::default() };
    setup.command(panic, |_, _| panic!("keeping command panicked"));
    Ok(())
}

// Expected (review carbon-pt-7, mutant A): a failed plugin in process is disposed without its callbacks, and its waker,
// which the plugin keeps, lets go of the host's wake as it is disabled.
#[test]
fn a_failed_plugins_waker_lets_go_of_the_host() {
    let host = host();
    let registry = Registry::define(vec![abi::Plugin { id: "keeping", setup: keeping }.into()], []);
    registry.activate(&dynamic(&host));
    host.keymap().dispatch("keeping.panic", None);
    host.app.advance(Duration::from_millis(1));
    let freed = crate::activation::FREED.get();
    assert!(registry.set_active(&dynamic(&host), "keeping", false));
    host.app.advance(Duration::from_millis(1));
    assert_eq!(crate::activation::FREED.get(), freed + 1, "the kept waker holds the host's wake");
    KEPT.take().unwrap().wake();
}

/// A command that fetches, and one that panics.
fn fetching(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command { name: name.to_owned(), ..abi::Command::default() };
    setup.command(command("fetching.fetch"), |host, _| {
        host.fetch(abi::Fetch { method: "GET".into(), path: "/fetched".into(), ..abi::Fetch::default() });
    });
    setup.command(command("fetching.panic"), |_, _| panic!("fetching panicked"));
    Ok(())
}

// Expected (review carbon-pt-6): a fetch that a call asked for is not sent when a later call in the same turn panics,
// which ends the activation before the effect queue runs; the same in process and through the C ABI.
#[test]
fn a_panic_drops_a_fetch_asked_for_in_the_same_turn() {
    let host = host();
    let registries = [
        Registry::define(vec![abi::Plugin { id: "fetching", setup: fetching }.into()], []),
        loopback(&host, abi::export_plugin!(@loopback "fetching", fetching)),
    ];
    for registry in registries {
        host.fetches.borrow_mut().clear();
        registry.activate(&dynamic(&host));
        host.keymap().dispatch("fetching.fetch", None);
        host.app.advance(Duration::from_millis(1));
        assert_eq!(host.fetches.borrow().len(), 1, "a fetch of a running plugin was not sent");
        host.keymap().dispatch("fetching.fetch", None);
        host.keymap().dispatch("fetching.panic", None);
        host.app.advance(Duration::from_millis(1));
        assert_eq!(host.fetches.borrow().len(), 1, "a fetch was sent after its plugin failed");
        registry.set_active(&dynamic(&host), "fetching", false);
    }
}

// Expected (review carbon-pt-6): a wake from a plugin's thread after its activation ended, by a disposal or a failure,
// posts nothing to the UI thread. A failed C ABI instance is kept, so its own waker is never revoked.
#[test]
fn a_wake_after_the_activation_ended_posts_nothing() {
    let host = host();
    let wake = Arc::new(crate::activation::Wake::new(Some(host.app().proxy())));
    let activation = crate::activation::Activation::new(&dynamic(&host), wake.clone());
    let waker = activation.waker();
    waker.wake();
    assert!(wake.pending(), "a wake of a live activation posted nothing");
    host.app.advance(Duration::from_millis(1));
    activation.dispose();
    waker.wake();
    assert!(!wake.pending(), "a wake after the activation ended posted");
}

thread_local! {
    /// How often a `lifecycle` dispose callback ran, whatever host it ran with.
    static LIFECYCLE_DISPOSED: Cell<usize> = const { Cell::new(0) };
}

/// Toasts as it sets up and as it is disposed, when it also asks for a reply that must not come. Its command panics.
fn lifecycle(setup: &mut abi::Setup) -> Result<(), String> {
    setup.host().toast(abi::Toast::new(abi::Variant::Info, "setup"));
    setup.on_dispose(|host| {
        LIFECYCLE_DISPOSED.set(LIFECYCLE_DISPOSED.get() + 1);
        host.toast(abi::Toast::new(abi::Variant::Info, "dispose"));
        host.fetch(abi::Fetch { method: "GET".into(), path: "/disposed".into(), ..abi::Fetch::default() });
    });
    setup.on_reply(|host, _, _| host.toast(abi::Toast::new(abi::Variant::Info, "reply")));
    let panic = abi::Command { name: "lifecycle.panic".to_owned(), ..abi::Command::default() };
    setup.command(panic, |_, _| panic!("lifecycle command panicked"));
    Ok(())
}

/// [`lifecycle`], then fails.
fn lifecycle_failing(setup: &mut abi::Setup) -> Result<(), String> {
    lifecycle(setup)?;
    Err("lifecycle failed".to_owned())
}

/// `setup` in process, or `create` through the C ABI's byte shims, set up, its command run if `panic` asks, then
/// disabled: its status after setup, and the toasts and fetches of the whole run.
fn lifecycled(
    setup: fn(&mut abi::Setup) -> Result<(), String>,
    create: unsafe extern "C" fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32,
    loopback: bool,
    panic: bool,
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
    if panic {
        host.keymap().dispatch("lifecycle.panic", None);
        host.app.advance(Duration::from_millis(1));
    }
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
    let direct = lifecycled(lifecycle, abi::export_plugin!(@loopback "lifecycle", lifecycle), false, false);
    assert_eq!((direct.0.status.clone(), direct.0.active), (Status::Active, true));
    assert_eq!((direct.1.as_slice(), direct.2), (["setup", "dispose"].map(String::from).as_slice(), 0));
    let through = lifecycled(lifecycle, abi::export_plugin!(@loopback "lifecycle", lifecycle), true, false);
    assert_eq!((through.1, through.2), (direct.1, direct.2));

    let failing = abi::export_plugin!(@loopback "lifecycle", lifecycle_failing);
    let direct = lifecycled(lifecycle_failing, failing, false, false);
    assert_eq!((direct.0.status.clone(), direct.0.active), (Status::Failed("lifecycle failed".to_owned()), false));
    assert_eq!((direct.1.as_slice(), direct.2), (["setup", "dispose"].map(String::from).as_slice(), 0));
    let through = lifecycled(lifecycle_failing, failing, true, false);
    assert_eq!(
        (through.0.status, through.0.active, through.1, through.2),
        (direct.0.status, false, direct.1, direct.2)
    );
}

// Expected (4.14, plugins-pt): a plugin that failed is called no more, so its dispose callback does not run as it is
// disabled, on both paths; the same plugin without the panic does run it.
#[test]
fn a_failed_plugin_gets_no_dispose_on_both_paths() {
    for (loopback, panic) in [(false, false), (false, true), (true, false), (true, true)] {
        LIFECYCLE_DISPOSED.set(0);
        let (_, toasts, fetches) =
            lifecycled(lifecycle, abi::export_plugin!(@loopback "lifecycle", lifecycle), loopback, panic);
        let calls: Vec<&str> =
            toasts.iter().map(String::as_str).filter(|toast| ["setup", "dispose"].contains(toast)).collect();
        let expected = if panic { (vec!["setup"], 0) } else { (vec!["setup", "dispose"], 1) };
        assert_eq!((calls, LIFECYCLE_DISPOSED.get()), expected, "through the C ABI: {loopback}, panic: {panic}");
        assert_eq!(fetches, 0);
    }
}

// Expected (bigboi-1): a setup that fails or panics after it registered a dispose callback runs it while the host is
// still valid, and the plugin is failed and not active. After a failure the sample's `destroyed` is stored; a panic
// has no effects (panic-effects), and the callback ran within the call that panicked, so its write is put back.
#[test]
fn a_failed_setup_runs_the_dispose_callbacks_it_registered() {
    for (options, error, destroyed) in [
        ("{\"probe\":true,\"fail\":true}", "sample setup failed", Some("{\"destroyed\":true}")),
        ("{\"probe\":true,\"panic\":true}", "setup panicked: sample setup panicked", None),
    ] {
        let host = host();
        let (definition, failure) = Native.load(&dynamic(&host), &build(""), Some(options)).unwrap();
        let registry = Registry::define(Vec::new(), []);
        let failed = registry.load(&dynamic(&host), definition.external("sample.so", failure));
        assert_eq!(failed, Some(crate::SetupFailed { error: error.to_owned(), kept: false }));
        assert_eq!(status(&registry), Status::Failed(error.to_owned()));
        assert!(!entry(&registry.entries(), "sample.so").active);
        let stored = host.storage.borrow().get("plugin.sample.destroyed").cloned();
        assert_eq!(stored.as_deref(), destroyed, "{options}");
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

const MAJOR_2: &str = "plugin ABI 2.0 is not supported: this opencode-native loads ABI 1.x plugins (up to 1.6); rebuild \
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
    // As a `cli.json` directive enables it, a load that fails again lists it failed and says so.
    assert!(registry.set_active(&dynamic(&host), "sample", true));
    let sample = entry(&registry.entries(), &target).clone();
    assert_eq!((sample.status, sample.active), (Status::Failed(MAJOR_2.to_owned()), false));
    assert_eq!(host.toasts.borrow()[2..], [failed.title("Plugin failed: sample")]);
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

// Expected (bigboi-3): the sample, a Rust `cdylib`, names only system libraries, so it passes the dependency policy
// for a project's plugin too; the reader finds them, so the check is not empty.
#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn the_sample_names_only_system_libraries() {
    let library = build("");
    let names = crate::loader::deps::named(&library).unwrap();
    let system = |name: &crate::loader::deps::Name| matches!(name, crate::loader::deps::Name::Library(text) if text.contains("libc.so") || text.contains("libSystem"));
    assert!(names.iter().any(system), "{names:?}");
    assert_eq!(crate::loader::deps::check(&library, true), Ok(()));
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
    assert_eq!(inspected.unwrap().minor, abi::ABI_MINOR);
    assert!(!claimed.exists());
}

thread_local! {
    /// The call of `panicky` that asks for effects, whether it then panics, the wakes it ran, and its waker.
    static LEAK_AT: std::cell::Cell<(&'static str, bool)> = const { std::cell::Cell::new(("", false)) };
    static WOKEN: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static PANICKY_WAKER: std::cell::RefCell<Option<abi::Waker>> = const { std::cell::RefCell::new(None) };
}

/// When `at` is the call [`LEAK_AT`] names: writes storage key `k` twice and `m`, which holds nothing, once, and asks
/// for an effect of each kind a test host records, then panics if it should.
fn leak(host: &dyn abi::Host, at: &str) {
    let (leaking, panics) = LEAK_AT.get();
    if leaking != at {
        return;
    }
    let merged = || serde_json::Map::from_iter([("merged".to_owned(), serde_json::Value::Bool(true))]);
    host.storage_set("k", serde_json::json!({ "leaked": at }));
    host.storage_merge("m", merged());
    host.storage_merge("k", merged());
    host.toast(abi::Toast::new(abi::Variant::Info, "leaked"));
    host.attention(abi::Attention { title: None, message: "leaked".into(), notify: None, sound: None });
    host.open_route("r");
    host.fetch(abi::Fetch { method: "GET".into(), path: "/leaked".into(), ..abi::Fetch::default() });
    host.dialog(abi::Dialog::Close { key: "leaked".into() });
    // 1.6
    host.set_variant(Some("high"));
    host.set_model("opencode", "small");
    host.edit_tab(abi::TabEdit::Focus { session: "ses_1".into() });
    host.clear_selection();
    host.foreground(abi::Foreground { command: "leaked".into(), ..abi::Foreground::default() });
    host.set_title("leaked");
    host.set_theme("nord");
    host.install_theme("leaked", serde_json::json!({ "theme": {} }));
    assert!(!panics, "boom");
}

/// Panics in a render, which can ask for nothing, when `at` is the call [`LEAK_AT`] names and it should.
fn render_panic(at: &str) {
    assert!(LEAK_AT.get() != (at, true), "boom");
}

/// A plugin that asks for effects in the call [`LEAK_AT`] names where the call can, then panics if it should.
fn panicky(setup: &mut abi::Setup) -> Result<(), String> {
    setup.storage_key("k");
    setup.storage_key("m");
    // Runs within a setup that panics, so what it asks for goes with the rest.
    setup.on_dispose(|host| {
        if LEAK_AT.get() == ("setup", true) {
            host.toast(abi::Toast::new(abi::Variant::Info, "disposed"));
        }
    });
    leak(setup.host(), "setup");
    PANICKY_WAKER.set(setup.waker());
    setup.command(abi::Command { name: "x.panic".into(), ..abi::Command::default() }, |host, _| leak(host, "command"));
    let fetch = abi::Command { name: "x.fetch".into(), ..abi::Command::default() };
    setup.command(fetch, |host, _| {
        host.fetch(abi::Fetch { method: "GET".into(), path: "/asked".into(), ..abi::Fetch::default() });
    });
    setup.on_reply(|host, _, _| leak(host, "reply"));
    setup.on_event(&["session.execution.succeeded"], |host, _| leak(host, "event"));
    setup.on_deltas(|host, _| leak(host, "deltas"));
    setup.on_wake(|host| {
        WOKEN.set(WOKEN.get() + 1);
        leak(host, "wake");
    });
    setup.slot(abi::Placement::append("home.footer"), |_, _, _| {
        render_panic("render");
        abi::Render::Hide
    });
    setup.on_mount(abi::Placement::append("home.footer"), |host, _, mounted| {
        if mounted {
            leak(host, "mount");
        }
    });
    setup.route("r", |_, _| {
        render_panic("route");
        abi::Render::Hide
    });
    setup.on_route_mount("r", |host, mounted| {
        if mounted {
            leak(host, "route-mount");
        }
    });
    setup.code_block("panicky", |_, _| {
        render_panic("fence");
        abi::Fenced::Code
    });
    Ok(())
}

/// `panicky` active in process, or through the C ABI's byte shims as a library that tells its ID.
fn panicking(host: &Rc<TestHost>, through: bool) -> Rc<Registry> {
    let registry = Rc::new(Registry::define(Vec::new(), []));
    *host.registry.borrow_mut() = Rc::downgrade(&registry);
    if !through {
        registry.add(abi::Plugin { id: "panicky", setup: panicky });
        registry.activate(&dynamic(host));
        return registry;
    }
    unsafe extern "C" fn describe(out: *mut Owned) -> i32 {
        // SAFETY: the loader passes what `PluginApi::describe` documents.
        unsafe { abi::runtime::describe("panicky", "0.1.0", out) }
    }
    let api = PluginApi {
        size: size_of::<PluginApi>(),
        major: ABI_MAJOR,
        minor: ABI_MINOR,
        requires_minor: 4,
        create: Some(abi::export_plugin!(@loopback "panicky", panicky)),
        call: Some(abi::runtime::call),
        destroy: Some(abi::runtime::destroy),
        free: Some(abi::runtime::free),
        describe: Some(describe),
    };
    let (definition, error) = define(&dynamic(host), Library::from_table(&api, HOST_MINOR).unwrap(), None).unwrap();
    registry.load(&dynamic(host), definition.external("panicky.so", error));
    registry
}

/// What a host saw of the plugin's effects, without the failure toast: toasts, attention, routes, fetches, dialogs,
/// storage, and the verbs of 1.6.
type Seen = (Vec<String>, usize, Vec<(String, String)>, Vec<String>, usize, Vec<(String, String)>, Vec<String>);

/// What the host lists of the plugin, how many failure toasts it showed, and whether the plugin's command still runs.
type Listed = (Entry, usize, bool);

/// Runs `panicky` on a fresh host, with storage it wrote before, through entry point `at`, with `leak` as
/// [`LEAK_AT`]: what the host saw of it, and what it lists.
fn panicky_run(at: &'static str, leak: (&'static str, bool), through: bool) -> (Seen, Listed) {
    let host = host();
    host.storage.borrow_mut().insert("plugin.panicky.k".to_owned(), "{\"kept\":true}".to_owned());
    LEAK_AT.set(leak);
    WOKEN.set(0);
    let registry = panicking(&host, through);
    let parent = View::new(host.app()).column();
    let mut mounted = Vec::new();
    match at {
        "command" => drop(host.keymap().dispatch("x.panic", None)),
        "event" => host.emit(&succeeded("ses_1")),
        "deltas" => host.emit_deltas(&[text_delta("a")]),
        "reply" => {
            host.keymap().dispatch("x.fetch", None);
            host.app.advance(Duration::from_millis(1));
            host.reply();
        }
        "wake" => {
            PANICKY_WAKER.take().unwrap().wake();
            assert!(host.app.wait_until(Duration::from_secs(10), || WOKEN.get() > 0), "no wake");
        }
        "render" | "mount" => {
            mounted.push(registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {}));
        }
        "route" | "route-mount" => drop(registry.route(&*host, "panicky", "r")),
        "fence" => drop(markdown(&host, &registry, "```panicky\nx\n```\n")),
        _ => {}
    }
    host.app.advance(Duration::from_millis(1));
    drop(mounted);
    PANICKY_WAKER.take();
    let entry = registry.entries().into_iter().find(|entry| entry.id == "panicky").unwrap();
    // The run is over: what the plugin asks for from here on is not compared.
    LEAK_AT.set(("", false));
    let command = matches!(host.keymap().dispatch("x.panic", None), RunResult::Ok);
    let toasts = host.toasts.borrow();
    let failed = toasts.iter().filter(|toast| toast.title.as_deref() == Some("Plugin failed: panicky")).count();
    let mut storage: Vec<(String, String)> = host.storage.borrow().clone().into_iter().collect();
    storage.sort();
    let seen = (
        toasts.iter().filter(|toast| toast.title.is_none()).map(|toast| toast.message.clone()).collect(),
        host.attention.borrow().len(),
        host.routes.borrow().clone(),
        host.fetches.borrow().iter().map(|(fetch, _)| fetch.path.clone()).collect(),
        host.dialogs.borrow().len(),
        storage,
        host.verbs.borrow().clone(),
    );
    (seen, (entry, failed, command))
}

// Expected (property `ledger`, a 1.6 registration): a plugin's deltas and event handlers are held while it is active
// and gone once it is disabled, or once a call of it panicked (reviews bigboi-6, carbon-8), on both paths, so the
// host keeps no deltas for it and it hears none after.
#[test]
fn a_deltas_handler_goes_with_its_plugin() {
    for (failing, through) in [(false, false), (false, true), (true, false), (true, true)] {
        let case = format!("failing {failing}, through the C ABI: {through}");
        let host = host();
        LEAK_AT.set(("", false));
        let registry = panicking(&host, through);
        let held = || (host.deltas.borrow().len(), host.events.borrow().len());
        assert_eq!(held(), (1, 1), "{case}");
        if failing {
            LEAK_AT.set(("deltas", true));
            host.emit_deltas(&[text_delta("a")]);
            host.app.advance(Duration::from_millis(1));
            LEAK_AT.set(("", false));
            assert!(matches!(registry.entries()[0].status, Status::Failed(_)), "{case}");
        } else {
            registry.set_active(&dynamic(&host), "panicky", false);
        }
        assert_eq!(held(), (0, 0), "{case}");
        host.emit_deltas(&[text_delta("a")]);
    }
}

// Expected (spike SC, property "a call that panics has no effects"): through every entry point and on both paths, a
// call that asks for effects and then panics leaves the host as the same run leaves it when that call does nothing:
// no toast, attention, route, fetch or dialog, and the storage it wrote holds what it held before. The plugin is
// failed with the message the plugin manager lists, and the host says so once; a setup that panics leaves it not
// active, which the loader or the plugin manager tells. The same call without the panic does have effects, where the
// entry point can ask for them, so the comparison is not empty.
#[test]
fn a_call_that_panics_has_no_effects() {
    let calls = [
        ("setup", "setup", true),
        ("command", "run-command", true),
        ("event", "on-event", true),
        ("deltas", "on-deltas", true),
        ("reply", "on-reply", true),
        ("wake", "on-wake", true),
        ("mount", "on-mount", true),
        ("route-mount", "on-route-mount", true),
        ("render", "render-slot", false),
        ("route", "render-route", false),
        ("fence", "render-fence", false),
    ];
    for (at, export, effects) in calls {
        for through in [false, true] {
            let case = format!("{at}, through the C ABI: {through}");
            let (quiet, (entry, failed, command)) = panicky_run(at, ("", false), through);
            assert_eq!((entry.status, failed, command), (Status::Active, 0, true), "{case}");
            let (leaked, _) = panicky_run(at, (at, false), through);
            assert_eq!(leaked != quiet, effects, "{case}: {leaked:?}");
            // Every 1.6 verb ran without the panic, so the comparison covers each.
            assert_eq!(leaked.6.len(), if effects { 8 } else { 0 }, "{case}: {:?}", leaked.6);
            let (panicked, (entry, failed, command)) = panicky_run(at, (at, true), through);
            assert_eq!(panicked, quiet, "{case}");
            assert_eq!(entry.status, Status::Failed(format!("{export} panicked: boom")), "{case}");
            // A failed plugin's commands leave the keymap; it stays active, so it can be disabled.
            let listed = if at == "setup" { (false, 0, false) } else { (true, 1, false) };
            assert_eq!((entry.active, failed, command), listed, "{case}");
        }
    }
}

thread_local! {
    /// The host table the last `catching` instance of this thread got, as a C plugin keeps it.
    static CAUGHT: Cell<*mut HostApi> = const { Cell::new(std::ptr::null_mut()) };
}

unsafe extern "C" fn catching(
    host: *const HostApi,
    options: Bytes,
    instance: *mut *mut c_void,
    out: *mut Owned,
) -> i32 {
    CAUGHT.set(host.cast_mut());
    // SAFETY: the loader passes what `PluginApi::create` documents.
    unsafe { abi::runtime::create("threads", |_| Ok(()), host, options, instance, out) }
}

/// A host table a test hands to another thread, as a C plugin may.
#[derive(Clone, Copy)]
struct Table(*const HostApi);

// SAFETY: the test keeps the instance alive while the thread runs; what the host does with a call is under test.
unsafe impl Send for Table {}

impl Table {
    /// Sends `request` through the table's `call`, and reads `theme_mode`: the status, the text written, the mode.
    fn call(self, request: &str) -> (i32, String, u32) {
        // SAFETY: the instance is alive, and `out` goes back to the host's `free`.
        unsafe {
            let api = &*self.0;
            let mut out = Owned::EMPTY;
            let status = api.call.unwrap()(api.ctx, Bytes::new(request.as_bytes()), &mut out);
            let text = String::from_utf8_lossy(&out.to_vec()).into_owned();
            api.free.unwrap()(out);
            (status, text, api.theme_mode.unwrap()(api.ctx))
        }
    }
}

// Expected (carbon-p0a-2): a C plugin that calls the host's `call` or `theme_mode` from a thread of its own is refused
// with an error, and gets dark, touching nothing of the host; its requests change nothing, and the same requests from
// the UI thread are served. In process a `&dyn Host` cannot reach another thread (the doctest on `abi::Host`).
#[test]
fn a_host_call_from_another_thread_is_refused() {
    let host = host();
    host.mode.set(ThemeMode::Light);
    let api = PluginApi {
        size: size_of::<PluginApi>(),
        major: ABI_MAJOR,
        minor: ABI_MINOR,
        requires_minor: 4,
        create: Some(catching),
        call: Some(abi::runtime::call),
        destroy: Some(abi::runtime::destroy),
        free: Some(abi::runtime::free),
        describe: None,
    };
    let (definition, error) = define(&dynamic(&host), Library::from_table(&api, HOST_MINOR).unwrap(), None).unwrap();
    let registry = Registry::define(Vec::new(), []);
    registry.load(&dynamic(&host), definition.external("threads.so", error));
    let table = Table(CAUGHT.get());
    let toast = |message: &str| format!(r#"{{"type":"toast","variant":"info","message":"{message}"}}"#);
    let edit = r#"{"type":"composer-edit","edit":{"type":"submit"}}"#;
    for request in [toast("from a thread"), edit.to_owned(), r#"{"type":"composer"}"#.to_owned()] {
        let (status, text, mode) = std::thread::spawn(move || table.call(&request)).join().unwrap();
        assert_eq!((status, mode), (abi::ERROR, abi::THEME_DARK), "{text}");
        assert!(text.contains("UI thread"), "{text}");
    }
    let (status, _, mode) = table.call(&toast("from the UI thread"));
    assert_eq!((status, mode), (abi::OK, abi::THEME_LIGHT));
    // Disabling destroys the instance, which applies what it asked for: the UI thread's toast alone.
    assert!(registry.set_active(&dynamic(&host), "threads", false));
    host.app.advance(Duration::from_millis(1));
    let toasts: Vec<_> = host.toasts.borrow().iter().map(|toast| toast.message.clone()).collect();
    assert_eq!(toasts, ["from the UI thread"]);
    assert!(host.edits.borrow().is_empty());
}

// Expected (carbon-5, after P0a's check): each read and verb of 1.6 that a C plugin sends from a thread of its own is
// refused with an error, as every host call is there, and touches nothing; from the UI thread each is served. In
// process a `&dyn Host` or `&dyn Read` cannot reach another thread (the doctests on `abi::Host` and `abi::Read`).
#[test]
fn a_1_6_host_call_from_another_thread_is_refused() {
    let host = host();
    let api = PluginApi {
        size: size_of::<PluginApi>(),
        major: ABI_MAJOR,
        minor: ABI_MINOR,
        requires_minor: 4,
        create: Some(catching),
        call: Some(abi::runtime::call),
        destroy: Some(abi::runtime::destroy),
        free: Some(abi::runtime::free),
        describe: None,
    };
    let load = |registry: &Registry| {
        let (definition, error) =
            define(&dynamic(&host), Library::from_table(&api, HOST_MINOR).unwrap(), None).unwrap();
        registry.load(&dynamic(&host), definition.external("threads.so", error));
        Table(CAUGHT.get())
    };
    let requests = [
        r#"{"type":"variants"}"#,
        r#"{"type":"tabs-enabled"}"#,
        r#"{"type":"tabs"}"#,
        r#"{"type":"keymap-pending"}"#,
        r#"{"type":"keymap-active"}"#,
        r#"{"type":"keymap-commands"}"#,
        r#"{"type":"shortcuts","name":"x"}"#,
        r#"{"type":"selection"}"#,
        r#"{"type":"theme"}"#,
        r#"{"type":"themes"}"#,
        r#"{"type":"set-variant"}"#,
        r#"{"type":"set-model","provider":"p","model":"m"}"#,
        r#"{"type":"tab","edit":{"type":"open","session":"ses_1"}}"#,
        r#"{"type":"clear-selection"}"#,
        r#"{"type":"foreground","command":"true"}"#,
        r#"{"type":"title","title":"t"}"#,
        r#"{"type":"set-theme","name":"opencode"}"#,
        r#"{"type":"install-theme","name":"x","theme":{"theme":{}}}"#,
    ];
    let registry = Registry::define(Vec::new(), []);
    let table = load(&registry);
    for request in requests {
        let (status, text, _) = std::thread::spawn(move || table.call(request)).join().unwrap();
        assert_eq!(status, abi::ERROR, "{request}: {text}");
        assert!(text.contains("UI thread"), "{request}: {text}");
    }
    // Disabling destroys the instance, which applies what it asked for: nothing.
    assert!(registry.set_active(&dynamic(&host), "threads", false));
    host.app.advance(Duration::from_millis(1));
    assert!(host.verbs.borrow().is_empty(), "{:?}", host.verbs.borrow());
    assert!(host.programs.borrow().is_empty());

    // The same from the UI thread: each is served, and its verbs run.
    let registry = Registry::define(Vec::new(), []);
    let table = load(&registry);
    for request in requests {
        let (status, text, _) = table.call(request);
        assert_eq!(status, abi::OK, "{request}: {text}");
    }
    assert!(registry.set_active(&dynamic(&host), "threads", false));
    host.app.advance(Duration::from_millis(1));
    assert!(!host.verbs.borrow().is_empty());
}

// Per thread: each test runs its plugin on its own thread, so tests that run at once share none of them.
thread_local! {
    /// The host table of the last `raw` instance.
    static RAW_HOST: Cell<*mut HostApi> = const { Cell::new(std::ptr::null_mut()) };
    /// How the raw render answers: 0 with `hide`, 1 with a result the host refuses, 2 with `hide` and no effects asked
    /// for.
    static RAW_MODE: Cell<u8> = const { Cell::new(0) };
    /// The statuses the host answered the raw render's requests with.
    static RAW_STATUSES: RefCell<Vec<i32>> = const { RefCell::new(Vec::new()) };
    /// Each fence render takes 150 ms on [`RAW_NOW`], the clock a test gives the monitor.
    static RAW_LATE: Cell<bool> = const { Cell::new(false) };
    static RAW_NOW: Cell<Duration> = const { Cell::new(Duration::ZERO) };
}

/// A plugin written against the C ABI without the SDK: one 1.4 slot claim and one storage key.
unsafe extern "C" fn raw_create(host: *const HostApi, _: Bytes, instance: *mut *mut c_void, out: *mut Owned) -> i32 {
    RAW_HOST.set(host.cast_mut());
    let manifest = r#"{"id":"raw","commands":[],"fences":[],"slots":[{"kind":"append","path":"home.footer","render":true}],"routes":[],"storage":["k"],"render":2}"#;
    // SAFETY: the loader passes valid pointers; the instance pointer is never read.
    unsafe {
        *instance = std::ptr::NonNull::<u8>::dangling().as_ptr().cast();
        *out = Owned::from_vec(manifest.as_bytes().to_vec());
    }
    abi::OK
}

/// Answers a render after asking the host for a submit, a toast, an alert and a storage write, as a faulty binding
/// might; any other request with `null`.
unsafe extern "C" fn raw_call(_: *mut c_void, request: Bytes, out: *mut Owned) -> i32 {
    // SAFETY: the loader passes the request for the call.
    let request = String::from_utf8_lossy(unsafe { request.as_slice() }).into_owned();
    let mode = RAW_MODE.get();
    // A 1.3 fence render, which may ask for effects: they apply with a result the host draws, not with one it refuses.
    if request.contains(r#""type":"fence""#) {
        if RAW_LATE.get() {
            RAW_NOW.set(RAW_NOW.get() + Duration::from_millis(150));
        }
        let table = Table(RAW_HOST.get());
        table.call(r#"{"type":"toast","variant":"info","message":"from a fence"}"#);
        table.call(r#"{"type":"storage-set","key":"k","value":"{\"a\":1}"}"#);
        let answer = if mode == 1 { r#"{"nonsense":1}"# } else { "null" };
        // SAFETY: `out` is valid for writes during the call.
        unsafe { *out = Owned::from_vec(answer.as_bytes().to_vec()) };
        return abi::OK;
    }
    let answer = match request.contains(r#""type":"render""#) {
        true => {
            if mode != 2 {
                let table = Table(RAW_HOST.get());
                let asks = [
                    r#"{"type":"composer-edit","edit":{"type":"submit"}}"#,
                    r#"{"type":"toast","variant":"info","message":"from a render"}"#,
                    r#"{"type":"dialog","dialog":{"type":"alert","title":"T","message":"M"}}"#,
                    r#"{"type":"storage-set","key":"k","value":"{\"a\":1}"}"#,
                    // 1.6 (review bigboi-13).
                    r#"{"type":"set-variant","variant":"high"}"#,
                    r#"{"type":"set-model","provider":"p","model":"m"}"#,
                    r#"{"type":"tab","edit":{"type":"focus","session":"ses_1"}}"#,
                    r#"{"type":"clear-selection"}"#,
                    r#"{"type":"foreground","command":"true"}"#,
                    r#"{"type":"title","title":"t"}"#,
                    r#"{"type":"set-theme","name":"nord"}"#,
                    r#"{"type":"install-theme","name":"x","theme":{"theme":{}}}"#,
                ];
                let statuses = asks.iter().map(|ask| table.call(ask).0);
                RAW_STATUSES.with_borrow_mut(|known| known.extend(statuses));
                // A read of 1.6 is answered.
                assert_eq!(table.call(r#"{"type":"variants"}"#).0, abi::OK);
            }
            if mode == 1 { r#"{"type":"nonsense"}"# } else { r#"{"type":"hide"}"# }
        }
        false => "null",
    };
    // SAFETY: `out` is valid for writes during the call.
    unsafe { *out = Owned::from_vec(answer.as_bytes().to_vec()) };
    abi::OK
}

// Expected (bigboi 8): a render of a plugin without the SDK that asks the host for effects gets an error for each, and
// nothing of them happens, whether its answer is drawn or refused: the host equals one whose render asked for nothing.
#[test]
fn a_render_that_asks_for_effects_gets_none() {
    let outcome = |mode: u8| {
        RAW_MODE.set(mode);
        RAW_STATUSES.take();
        let host = host();
        let api = PluginApi {
            size: size_of::<PluginApi>(),
            major: ABI_MAJOR,
            minor: ABI_MINOR,
            requires_minor: 4,
            create: Some(raw_create),
            call: Some(raw_call),
            destroy: None,
            free: Some(abi::runtime::free),
            describe: None,
        };
        let (definition, error) =
            define(&dynamic(&host), Library::from_table(&api, HOST_MINOR).unwrap(), None).unwrap();
        let registry = Registry::define(Vec::new(), []);
        registry.load(&dynamic(&host), definition.external("raw.so", error));
        let parent = View::new(host.app());
        let _mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
        host.app.advance(Duration::from_millis(1));
        let statuses = RAW_STATUSES.take();
        let seen = (
            host.edits.borrow().len(),
            host.toasts.borrow().len(),
            host.dialogs.borrow().len(),
            host.storage.borrow().get("plugin.raw.k").cloned(),
            entry(&registry.entries(), "raw.so").status.clone(),
            host.verbs.borrow().len() + host.programs.borrow().len(),
        );
        (statuses, seen)
    };
    let quiet = outcome(2);
    assert_eq!(quiet.1, (0, 0, 0, None, Status::Active, 0));
    for mode in [0, 1] {
        let (statuses, seen) = outcome(mode);
        assert_eq!(statuses, [abi::ERROR; 12], "mode {mode}");
        assert_eq!(seen, quiet.1, "mode {mode}");
    }
}

/// The raw plugin as a 1.3 plugin with one fence, `raw`.
unsafe extern "C" fn raw_create_1_3(
    host: *const HostApi,
    _: Bytes,
    instance: *mut *mut c_void,
    out: *mut Owned,
) -> i32 {
    RAW_HOST.set(host.cast_mut());
    let manifest = r#"{"id":"raw","commands":[],"fences":["raw"],"slots":[],"routes":[],"storage":["k"]}"#;
    // SAFETY: the loader passes valid pointers; the instance pointer is never read.
    unsafe {
        *instance = std::ptr::NonNull::<u8>::dangling().as_ptr().cast();
        *out = Owned::from_vec(manifest.as_bytes().to_vec());
    }
    abi::OK
}

// Expected (bigboi 8): a 1.3 fence render may ask for effects; they apply when the host draws its answer, and when it
// refuses the answer nothing of them happens and the storage it wrote is put back.
#[test]
fn a_refused_render_result_leaves_no_effects() {
    let outcome = |mode: u8| {
        RAW_MODE.set(mode);
        let host = host();
        let api = PluginApi {
            size: size_of::<PluginApi>(),
            major: ABI_MAJOR,
            minor: 3,
            requires_minor: 0,
            create: Some(raw_create_1_3),
            call: Some(raw_call),
            destroy: None,
            free: Some(abi::runtime::free),
            describe: None,
        };
        let (definition, error) =
            define(&dynamic(&host), Library::from_table(&api, HOST_MINOR).unwrap(), None).unwrap();
        let registry = Registry::define(Vec::new(), []);
        registry.load(&dynamic(&host), definition.external("raw.so", error));
        markdown(&host, &registry, "```raw\nx\n```\n");
        host.app.advance(Duration::from_millis(1));
        let toasts: Vec<_> = host.toasts.borrow().iter().map(|toast| toast.message.clone()).collect();
        (toasts, host.storage.borrow().get("plugin.raw.k").cloned())
    };
    assert_eq!(outcome(0), (vec!["from a fence".to_owned()], Some("{\"a\":1}".to_owned())));
    assert_eq!(outcome(1), (Vec::new(), None));
}

// Expected (bigboi): a late call's result is checked before its effects apply. A 1.3 fence render that overran and
// returned a result the host refuses asks for nothing that happens, its storage write goes back, and the plugin fails
// by the overrun; with a result the host draws, its effects apply, then it fails. The first render after setup is
// exempt, so the fence renders twice.
#[test]
fn a_late_refused_result_leaves_no_effects() {
    let outcome = |mode: u8| {
        RAW_MODE.set(mode);
        RAW_LATE.set(true);
        let host = host();
        let api = PluginApi {
            size: size_of::<PluginApi>(),
            major: ABI_MAJOR,
            minor: 3,
            requires_minor: 0,
            create: Some(raw_create_1_3),
            call: Some(raw_call),
            destroy: None,
            free: Some(abi::runtime::free),
            describe: None,
        };
        let (definition, error) =
            define(&dynamic(&host), Library::from_table(&api, HOST_MINOR).unwrap(), None).unwrap();
        let registry = Registry::define(Vec::new(), []);
        let base = std::time::Instant::now();
        registry.monitor().set_clock(move || base + RAW_NOW.get());
        registry.load(&dynamic(&host), definition.external("raw.so", error));
        for _ in 0..2 {
            host.toasts.borrow_mut().clear();
            markdown(&host, &registry, "```raw\nx\n```\n");
            host.app.advance(Duration::from_millis(1));
        }
        RAW_LATE.set(false);
        // The fence's own toasts; the failure has its own.
        let toasts: Vec<_> = host
            .toasts
            .borrow()
            .iter()
            .map(|toast| toast.message.clone())
            .filter(|message| message.starts_with("from"))
            .collect();
        let status = registry.entries().into_iter().find(|entry| entry.id == "raw").unwrap().status;
        let late = matches!(&status, Status::Failed(error) if error.starts_with("render-fence took 150 ms"));
        (toasts, host.storage.borrow().get("plugin.raw.k").cloned(), late)
    };
    assert_eq!(outcome(0), (vec!["from a fence".to_owned()], Some("{\"a\":1}".to_owned()), true));
    assert_eq!(outcome(1), (Vec::new(), None, true));
}

/// What the frozen 1.4 host saw: the type of each request it decoded, and `refused` for each it could not.
static OLD_SEEN: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// A 1.4 host's `call`: it decodes each request with the frozen 1.4 types, as a 1.4 host does, answers one it cannot
/// decode with an error, and the rest with `null`.
unsafe extern "C" fn old_host_call(_: *mut c_void, request: Bytes, out: *mut Owned) -> i32 {
    // SAFETY: the plugin passes the request for the call.
    let bytes = unsafe { request.as_slice() };
    let (status, reply, seen) = match serde_json::from_slice::<opencode_plugin_abi_1_4::HostRequest>(bytes) {
        Ok(request) => {
            let json = serde_json::to_value(&request).unwrap();
            (abi::OK, b"null".to_vec(), format!("{} {}", json["type"].as_str().unwrap(), json["message"]))
        }
        Err(error) => (abi::ERROR, error.to_string().into_bytes(), "refused".to_owned()),
    };
    OLD_SEEN.lock().unwrap().push(seen);
    // SAFETY: `out` is valid for writes during the call.
    unsafe { *out = Owned::from_vec(reply) };
    status
}

unsafe extern "C" fn old_host_free(owned: Owned) {
    // SAFETY: `old_host_call` made it with `Owned::from_vec`.
    drop(unsafe { owned.into_vec() });
}

// Expected (bigboi 10): the 1.5 sample library loads on a 1.4 host, which accepts its minimum minor; that host refuses
// its 1.5 requests (a confirm, an alert, a composer edit and read) with an error, decodes its other requests, and draws
// its 1.5 box without the 1.5 properties, which the 1.4 types do not read.
#[test]
fn a_1_5_library_gets_what_a_1_4_host_offers() {
    use opencode_plugin_abi_1_4 as old;
    let library = Library::open(&build("p0a"), 4).unwrap();
    let api = HostApi {
        size: size_of::<HostApi>(),
        major: 1,
        minor: 4,
        ctx: std::ptr::null_mut(),
        call: Some(old_host_call),
        free: Some(old_host_free),
        theme_mode: None,
        wake: None,
    };
    let call = |handle: *mut c_void, request: &old::Request| {
        let json = serde_json::to_vec(request).unwrap();
        let mut out = Owned::EMPTY;
        // SAFETY: `handle` is live, and `out` goes back to the library's `free`.
        unsafe {
            let status = (library.call)(handle, Bytes::new(&json), &mut out);
            let bytes = out.to_vec();
            (library.free)(out);
            (status, bytes)
        }
    };
    let (mut handle, mut out) = (std::ptr::null_mut(), Owned::EMPTY);
    // SAFETY: the pointers are valid for the call, and `api` outlives the instance.
    let (status, manifest) = unsafe {
        let status = (library.create)(&api, Bytes::new(b""), &mut handle, &mut out);
        let bytes = out.to_vec();
        (library.free)(out);
        (status, bytes)
    };
    assert_eq!(status, abi::OK, "{}", String::from_utf8_lossy(&manifest));
    let manifest: old::Manifest = serde_json::from_slice(&manifest).unwrap();
    OLD_SEEN.lock().unwrap().clear();
    for name in ["p0a.confirm", "p0a.alert", "p0a.set", "p0a.read"] {
        let request = old::Request::Command { name: name.to_owned(), input: Some("x".to_owned()) };
        assert_eq!(call(handle, &request).0, abi::OK, "{name}");
    }
    let seen = std::mem::take(&mut *OLD_SEEN.lock().unwrap());
    assert_eq!(seen, ["refused", "refused", "refused", "refused", "toast \"no composer\""]);
    // The probe's box, the last claim of the home footer that renders.
    let claim = manifest.slots.iter().rposition(|claim| claim.render && claim.path == "home.footer").unwrap();
    let request = old::Request::Render { claim, input: old::SlotInput::default(), changed: old::Changed::everything() };
    let (status, render) = call(handle, &request);
    assert_eq!(status, abi::OK);
    let json: serde_json::Value = serde_json::from_slice(&render).unwrap();
    assert!(json["node"]["border"].is_object(), "{json}");
    let old::Render::Show(old::Node::Box { children, .. }) = serde_json::from_value(json).unwrap() else {
        panic!("not a box");
    };
    assert_eq!(children.len(), 2);
    if let Some(destroy) = library.destroy {
        // SAFETY: `handle` came from `create` and is destroyed once.
        unsafe { destroy(handle) };
    }
}

thread_local! {
    /// The injected clock of [`late`]'s monitor.
    static LATE_CLOCK: std::cell::Cell<Duration> = const { std::cell::Cell::new(Duration::ZERO) };
    /// The run record of [`late`]'s monitor, and what it named inside `late.run`.
    static LATE_RECORD: std::cell::RefCell<Option<Arc<crate::contain::Record>>> = const { std::cell::RefCell::new(None) };
    static LATE_SEEN: std::cell::RefCell<Option<(String, &'static str)>> = const { std::cell::RefCell::new(None) };
}

/// A plugin whose `late.run` toasts, then takes 150 ms on the injected clock; `late.ok` takes nothing.
fn late(setup: &mut abi::Setup) -> Result<(), String> {
    let command =
        |name: &str| abi::Command { name: name.to_owned(), title: name.to_owned(), ..abi::Command::default() };
    setup.command(command("late.ok"), |_, _| {});
    setup.command(command("late.run"), |host, _| {
        let seen = LATE_RECORD.with_borrow(|record| {
            let record = record.as_ref()?;
            let running = record.running()?;
            Some((record.named(running.slot)?.id, *crate::contain::record::KINDS.get(usize::from(running.kind))?))
        });
        LATE_SEEN.set(seen);
        host.toast(abi::Toast::new(abi::Variant::Info, "late"));
        LATE_CLOCK.set(LATE_CLOCK.get() + Duration::from_millis(150));
    });
    Ok(())
}

// Expected (synthesis 4.4, 4.14): a call that overruns did return, so what it asked for happens; then an external
// plugin fails with the call and its time, and is told once. For a built-in an overrun is a host bug: it runs on. On
// both paths the call is timed and named in the run record while it runs (`record-balanced`).
#[test]
fn an_overrun_applies_its_effects_then_fails_an_external_plugin_only() {
    for through in [false, true] {
        let host = host();
        let registry = Registry::define(Vec::new(), []);
        let base = std::time::Instant::now();
        registry.monitor().set_clock(move || base + LATE_CLOCK.get());
        let dir = opencode_util::temp::tempdir().unwrap();
        let record = Arc::new(crate::contain::Record::create(dir.path()).unwrap());
        registry.monitor().attach(record.clone()).unwrap();
        LATE_RECORD.set(Some(record));
        LATE_SEEN.set(None);
        match through {
            true => {
                let loaded = loopback_described(&dynamic(&host), abi::export_plugin!(@loopback_described "late", late));
                let (definition, error) = loaded.unwrap();
                registry.load(&dynamic(&host), definition.external("late.so", error));
            }
            false => {
                registry.add(abi::Plugin { id: "late", setup: late });
                registry.activate(&dynamic(&host));
            }
        }
        // The first call after setup is exempt; this one is fast anyway.
        assert!(matches!(host.keymap().dispatch("late.ok", None), RunResult::Ok));
        host.keymap().dispatch("late.run", None);
        host.app.advance(Duration::from_millis(1));
        let toasts: Vec<String> =
            host.toasts.borrow().iter().map(|toast| toast.title.clone().unwrap_or(toast.message.clone())).collect();
        let status = registry.entries().into_iter().find(|entry| entry.id == "late").unwrap().status;
        let expected = match through {
            true => (
                vec!["late".to_owned(), "Plugin failed: late".to_owned()],
                Status::Failed("run-command took 150 ms, over the limit of 100 ms".to_owned()),
            ),
            false => (vec!["late".to_owned()], Status::Active),
        };
        assert_eq!((toasts, status), expected, "through the C ABI: {through}");
        assert_eq!(LATE_SEEN.take(), Some(("late".to_owned(), "run-command")), "through the C ABI: {through}");
        LATE_RECORD.set(None);
    }
}

/// A plugin that replaces `home.footer`, draws `rep` fences and has a route; `replacer.panic` panics.
fn replacer(setup: &mut abi::Setup) -> Result<(), String> {
    let command = abi::Command { name: "replacer.panic".into(), title: "panic".into(), ..abi::Command::default() };
    setup.command(command, |_, _| panic!("replacer fault"));
    setup.slot(abi::Placement::new(abi::SlotKind::Replace, "home.footer"), |_, _, _| {
        abi::Render::Show(abi::Node::text([abi::Span::new("REPLACED")]))
    });
    setup.code_block("rep", |_, _| abi::Fenced::Lines {
        lines: vec![vec![abi::Span::new("PLUGIN FENCE")]],
        fg: None,
        drag: false,
    });
    setup.route("page", |_, _| abi::Render::Show(abi::Node::text([abi::Span::new("PAGE")])));
    Ok(())
}

// Expected (bigboi 10, carbon 5): a plugin that failed while it ran gives way as if the user had disabled it, on both
// paths: its `Replace` claim no longer hides the host's content, its fences fall back to the code view, and its route
// no longer mounts. Before the failure each of them wins.
#[test]
fn a_failed_plugin_gives_way_to_the_host() {
    for through in [false, true] {
        let host = host();
        let registry = Rc::new(Registry::define(Vec::new(), []));
        *host.registry.borrow_mut() = Rc::downgrade(&registry);
        match through {
            true => {
                let loaded =
                    loopback_described(&dynamic(&host), abi::export_plugin!(@loopback_described "replacer", replacer));
                let (definition, error) = loaded.unwrap();
                registry.load(&dynamic(&host), definition.external("replacer.so", error));
            }
            false => {
                registry.add(abi::Plugin { id: "replacer", setup: replacer });
                registry.activate(&dynamic(&host));
            }
        }
        let footer = || {
            let parent = View::new(host.app());
            let _mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |parent| {
                parent.add(&opentui::widget::Text::new(host.app(), "HOST"));
            });
            host.app().root().clear();
            host.app().root().add(&parent);
            host.app.render();
            host.app.text()
        };
        let case = format!("through the C ABI: {through}");
        let screen = footer();
        assert!(screen.contains("REPLACED") && !screen.contains("HOST"), "{case}: {screen}");
        assert!(markdown(&host, &registry, "```rep\nbody\n```\n").contains("PLUGIN FENCE"), "{case}");
        assert!(registry.route(&*host, "replacer", "page").is_some(), "{case}");
        host.keymap().dispatch("replacer.panic", None);
        host.app.advance(Duration::from_millis(1));
        let screen = footer();
        assert!(screen.contains("HOST") && !screen.contains("REPLACED"), "{case}: {screen}");
        let fence = markdown(&host, &registry, "```rep\nbody\n```\n");
        assert!(!fence.contains("PLUGIN FENCE") && fence.contains("body"), "{case}: {fence}");
        assert!(registry.route(&*host, "replacer", "page").is_none(), "{case}");
    }
}

thread_local! {
    /// The clock the monitor of [`a_builtin_is_timed_and_its_overrun_fails_nothing`] reads.
    static TIMED_NOW: std::cell::Cell<Duration> = const { std::cell::Cell::new(Duration::ZERO) };
    /// The record of that test, and the calls its plugin found named in it.
    static TIMED_RECORD: RefCell<Option<Arc<crate::contain::Record>>> = const { RefCell::new(None) };
    static TIMED_SEEN: RefCell<Vec<&'static str>> = const { RefCell::new(Vec::new()) };
}

/// Logs the call the record names.
fn timed_seen() {
    let kind = TIMED_RECORD.with_borrow(|record| {
        let running = record.as_ref()?.running()?;
        crate::contain::record::KINDS.get(usize::from(running.kind)).copied()
    });
    TIMED_SEEN.with_borrow_mut(|seen| seen.push(kind.unwrap_or("nothing")));
}

/// A built-in whose command takes 150 ms on the injected clock.
fn timed(setup: &mut abi::Setup) -> Result<(), String> {
    timed_seen();
    let command = abi::Command { name: "timed.slow".into(), title: "slow".into(), ..abi::Command::default() };
    setup.command(command, |_, _| {
        timed_seen();
        TIMED_NOW.set(TIMED_NOW.get() + Duration::from_millis(150));
    });
    setup.on_dispose(|_| timed_seen());
    Ok(())
}

// Expected (synthesis 4.4; bigboi, carbon 8): a built-in's setup, calls and dispose are timed and named in the
// record; its overrun is a host bug, counted for the performance gate, and fails nothing.
#[test]
fn a_builtin_is_timed_and_its_overrun_fails_nothing() {
    let host = host();
    let dir = opencode_util::temp::tempdir().unwrap();
    let record = Arc::new(crate::contain::Record::create(dir.path()).unwrap());
    TIMED_RECORD.set(Some(record.clone()));
    TIMED_SEEN.take();
    let registry = Registry::define(Vec::new(), []);
    registry.monitor().attach(record).unwrap();
    let base = Instant::now();
    registry.monitor().set_clock(move || base + TIMED_NOW.get());
    registry.add(abi::Plugin { id: "timed", setup: timed });
    registry.activate(&dynamic(&host));
    // The first call after setup is exempt; the second overruns.
    for _ in 0..2 {
        host.keymap().dispatch("timed.slow", None);
    }
    host.app.advance(Duration::from_millis(1));
    assert_eq!(registry.monitor().host_overruns(), 1);
    assert!(registry.monitor().load("timed").1.is_some(), "setup is timed");
    let status = |registry: &Registry| registry.entries().into_iter().find(|entry| entry.id == "timed").unwrap().status;
    assert_eq!(status(&registry), Status::Active);
    registry.toggle(&dynamic(&host), "timed", false);
    assert_eq!(TIMED_SEEN.take(), ["setup", "run-command", "run-command", "dispose"]);
    TIMED_RECORD.set(None);
}
