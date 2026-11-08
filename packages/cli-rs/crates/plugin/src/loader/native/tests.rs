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
fn active(host: &Rc<TestHost>, library: &[u8]) -> Registry<TestHost> {
    let (definition, error) = Native.load(host, library, None).unwrap();
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
    assert!(matches!(host.keymap().dispatch("sample.hello", None), RunResult::Ok));
    assert!(host.toasts.borrow().is_empty());
    host.app.advance(Duration::from_millis(1));
    assert_eq!(*host.toasts.borrow(), [(Toast::Success, None, "Hello from sample v1 (1)".to_owned())]);
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
        [(Toast::Error, Some("Plugin failed: sample".to_owned()), "Run /plugins to view details.".to_owned())]
    );
    // A failed plugin is not called again: its fences keep the code view, its commands do nothing.
    let screen = markdown(&host, &registry, "```sample\nquiet\n```\n");
    assert!(screen.contains("quiet") && !screen.contains("QUIET"), "{screen}");
    host.keymap().dispatch("sample.hello", None);
    host.app.advance(Duration::from_millis(1));
    assert!(host.storage.borrow().is_empty());

    // Enabling it again starts a fresh instance.
    registry.set_active(&host, "sample", true);
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
    assert!(registry.set_active(&host, "sample", false));
    assert_eq!(status(&registry), Status::Inactive);
    assert!(registry.set_active(&host, "sample", true));
    assert!(matches!(host.keymap().dispatch("sample.hello", None), RunResult::Ok));
}

#[test]
fn versions_follow_the_abi_rules() {
    let load = |library: &[u8], options: Option<&str>| Native.load(&host(), library, options).err();
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
    assert_eq!(*host.toasts.borrow(), [(Toast::Success, None, "Hello from sample 1.3".to_owned())]);

    // A 1.3 host refuses a plugin of this crate, which needs the 1.4 render requests.
    assert_eq!(
        Library::open(&current, 3).err().unwrap(),
        "plugin needs host ABI 1.4 or newer, this opencode-rs has 1.3; update opencode-rs"
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
        "plugin ABI 2.0 is not supported: this opencode-rs loads ABI 1.x plugins (up to 1.4); rebuild the \
         plugin against opencode-plugin-abi 1"
    );
    assert_eq!(
        load(&build("requires-future"), None).unwrap(),
        "plugin needs host ABI 1.99 or newer, this opencode-rs has 1.4; update opencode-rs"
    );
    assert!(load(b"not a library", None).unwrap().starts_with("cannot load the library"));
    // Setup runs on activation, so a setup that fails fails the plugin there.
    let (definition, error) = Native.load(&host, &current, Some("{\"fail\":true}")).unwrap();
    let registry = Registry::new(Vec::new(), []);
    registry.load(&host, definition.external("sample.so", error));
    assert_eq!(status(&registry), Status::Failed("sample setup failed".to_owned()));
}

// Expected: a plugin that `cli.json` disables loads without running its setup. Enabling it runs setup, and
// disabling or unloading it destroys that instance.
#[test]
fn setup_runs_on_activation_and_the_instance_is_destroyed_after() {
    let host = host();
    let stored = |key: &str| host.storage.borrow_mut().remove(&format!("plugin.sample.{key}"));
    let (definition, error) = Native.load(&host, &build(""), Some("{\"probe\":true}")).unwrap();
    assert_eq!(definition.id, "sample");
    let registry = Registry::new(Vec::new(), ["-sample"]);
    registry.load(&host, definition.external("sample.so", error));
    assert_eq!(status(&registry), Status::Inactive);
    host.app.advance(Duration::from_millis(1));
    assert!(host.toasts.borrow().is_empty() && host.storage.borrow().is_empty());

    assert!(registry.set_active(&host, "sample", true));
    assert_eq!(stored("count").as_deref(), Some("{\"count\":1}"));
    assert!(registry.set_active(&host, "sample", false));
    assert_eq!(stored("destroyed").as_deref(), Some("{\"destroyed\":true}"));
    assert!(registry.set_active(&host, "sample", true));
    assert_eq!(stored("destroyed"), None);
    registry.unload("sample.so");
    assert_eq!(stored("destroyed").as_deref(), Some("{\"destroyed\":true}"));
}

#[test]
fn the_loader_reloads_a_rebuilt_library() {
    let root = opencode_util::temp::tempdir().unwrap();
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

// Expected: a rebuild whose setup fails, while the old build is active, is destroyed; the old build keeps running and
// the plugin reads as failed with "(previous version still active)", as in TS.
#[test]
fn a_rebuild_whose_setup_fails_keeps_the_running_version() {
    let root = opencode_util::temp::tempdir().unwrap();
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
    fs::write(dir.join(entry_file()), build("setup-fails")).unwrap();
    assert!(loader.reconcile(&host, &registry));
    let target = dir.to_string_lossy().into_owned();
    let entry = entry(&registry.entries(), &target).clone();
    assert!(entry.active);
    assert_eq!(entry.status, Status::Failed("sample setup failed (previous version still active)".to_owned()));
    let screen = markdown(&host, &registry, "```sample\nstill\n```\n");
    assert!(screen.contains("SAMPLE v1 STILL"), "{screen}");
    assert!(matches!(host.keymap().dispatch("sample.hello", None), RunResult::Ok));
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
    let (definition, error) = Native.load(&host, &build(""), Some("{\"tick_ms\":5}")).unwrap();
    let registry = Registry::new(Vec::new(), []);
    registry.load(&host, definition.external("sample.so", error));
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
fn woken_into_a_full_queue(host: &Rc<TestHost>, options: &str) -> (Registry<TestHost>, impl Sized) {
    let proxy = host.app().proxy();
    while proxy.post(|_| {}).is_ok() {}
    let (definition, error) = Native.load(host, &build(""), Some(options)).unwrap();
    let registry = Registry::new(Vec::new(), []);
    registry.load(host, definition.external("sample.so", error));
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
    assert!(registry.set_active(&host, "sample", false));
    host.app.wait_until(Duration::from_millis(100), || false);
    assert_eq!(status(&registry), Status::Inactive);
    assert!(host.toasts.borrow().is_empty());
    assert!(registry.set_active(&host, "sample", true));
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
    let (definition, error) = Native.load(&host, &build(""), Some("{\"probe\":true}")).unwrap();
    let registry = Registry::new(Vec::new(), []);
    registry.load(&host, definition.external("sample.so", error));
    assert_eq!(status(&registry), Status::Active);
    host.app.advance(Duration::from_millis(1));
    assert_eq!(*host.toasts.borrow(), [(Toast::Info, None, "sample setup: count 5, light, stored".to_owned())]);
    assert_eq!(host.storage.borrow().get("plugin.sample.count").map(String::as_str), Some("{\"count\":6}"));
}

/// The version text of the sample's fences compiled into this test.
const VERSION: &str = "v1";

/// The sample's fences, compiled in rather than loaded.
#[path = "../../../examples/sample/src/fence.rs"]
mod sample_fence;

// Expected: the sample's fences, compiled into the host and run in process, draw what the same source draws from the
// library through the C ABI.
#[test]
fn the_sample_fence_draws_the_same_in_process_and_through_the_library() {
    let host = host();
    let plugin = abi::Plugin { id: "sample", setup: sample_fence::setup };
    let in_process = Registry::new(vec![plugin.into()], []);
    in_process.activate(&host);
    let library = active(&host, &build(""));
    let text = "```sample\nhello\n```\n\n```sample-mode\nx\n```\n";
    let direct = markdown(&host, &in_process, text);
    assert!(direct.contains("SAMPLE v1 HELLO") && direct.contains("sample mode dark"), "{direct}");
    assert_eq!(markdown(&host, &library, text), direct);
}

/// Streams `chunks` into one Markdown view with the registry's renderers, returning the screen after each.
fn stream(host: &Rc<TestHost>, registry: &Registry<TestHost>, chunks: &[&str]) -> Vec<String> {
    let theme = host.theme();
    let syntax = opencode_ui::code::syntax_theme(&theme);
    let view = opencode_ui::markdown::view(host.app(), &theme, &syntax, &registry.code_blocks(&theme), true, true);
    host.app().root().clear();
    host.app().root().add(&view);
    chunks
        .iter()
        .map(|chunk| {
            view.append(chunk);
            host.app.render();
            host.app.text()
        })
        .collect()
}

unsafe extern "C" fn latex_create(
    host: *const HostApi,
    options: Bytes,
    instance: *mut *mut c_void,
    out: *mut Owned,
) -> i32 {
    let plugin = opencode_latex::plugin();
    // SAFETY: the loader passes what `PluginApi::create` documents.
    unsafe { abi::runtime::create(plugin.id, plugin.setup, host, options, instance, out) }
}

// Expected: the LaTeX built-in, wired through the byte shims of the C ABI (`Loopback`), keeps its formula across
// a chunk that does not parse, as it does in process, with the host's fence keys crossing the wire.
#[test]
fn latex_streams_the_same_through_the_c_abi_loopback() {
    let host = host();
    let in_process = Registry::new(vec![opencode_latex::plugin().into()], []);
    in_process.activate(&host);
    let api = PluginApi {
        size: size_of::<PluginApi>(),
        major: ABI_MAJOR,
        minor: ABI_MINOR,
        requires_minor: 4,
        create: Some(latex_create),
        call: Some(abi::runtime::call),
        destroy: Some(abi::runtime::destroy),
        free: Some(abi::runtime::free),
        describe: None,
    };
    // The shims silence the process's panic hook, as a plugin's own; this test binary keeps its own.
    let hook = std::panic::take_hook();
    let (definition, error) = define(&host, Library::from_table(&api, HOST_MINOR).unwrap(), None).unwrap();
    let loopback = Registry::new(Vec::new(), []);
    loopback.load(&host, definition.external("latex.so", error));
    std::panic::set_hook(hook);
    assert_eq!(entry(&loopback.entries(), "latex.so").status, Status::Active);

    let chunks = ["```latex\n\\frac{a_1+b_1}{c_1+d_1}", "+\\frac{a_", "2+b_2}{c_2+d_2}"];
    let direct = stream(&host, &in_process, &chunks);
    assert_eq!(direct[1], direct[0]);
    assert!(direct[0].contains("───") && !direct[0].contains("\\frac"), "{}", direct[0]);
    assert!(direct[2] != direct[0] && !direct[2].contains("\\frac"), "{}", direct[2]);
    assert_eq!(stream(&host, &loopback, &chunks), direct);
}
