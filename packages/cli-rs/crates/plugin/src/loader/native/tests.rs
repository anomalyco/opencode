use std::fs;
use std::path::Path;
use std::rc::Rc;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use opentui::keymap::RunResult;
use opentui::testing::Capture;

use super::*;
#[cfg(unix)]
use crate::loader::tests::cc;
use crate::loader::tests::{TestHost, build_example, dynamic, entry, fence_view, host};
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
    let library = build_example("sample", "opencode_sample_plugin", features);
    built.push((features.to_owned(), library.clone()));
    library
}

/// The sample, loaded from `library` and active in a fresh registry.
fn active(host: &Rc<TestHost>, library: &[u8]) -> Registry {
    let (definition, error) = Native.load(&dynamic(host), library, std::path::Path::new("plugin.so"), None).unwrap();
    assert_eq!(definition.id, "sample");
    let registry = Registry::define(Vec::new(), []);
    registry.load(&dynamic(host), definition.external("sample.so", error));
    registry
}

/// The screen after a transcript-like Markdown view draws `markdown` with the registry's renderers.
fn markdown(host: &Rc<TestHost>, registry: &Registry, text: &str) -> String {
    let view = fence_view(&**host, registry, text);
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

    let parent = View::new(host.app()).column();
    let mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    assert!(!mounted.is_empty());
    host.app().root().clear();
    host.app().root().add(&parent);
    host.app.render();
    let screen = host.app.text();
    assert!(screen.contains("sample plugin v1: home.footer"), "{screen}");
    host.app().root().clear();
    let route = registry.route(&*host, "sample", "hello").unwrap();
    host.app().root().add(&route.root());
    host.app.render();
    let screen = host.app.text();
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

#[test]
fn versions_follow_the_abi_rules() {
    let load = |library: &[u8], options: Option<&str>| {
        Native.load(&dynamic(&host()), library, std::path::Path::new("plugin.so"), options).err()
    };
    // The current build is 2.0.
    let current = build("");
    assert_eq!(Native.inspect(&current).unwrap(), Inspected { major: 2, minor: 0, version: Some("0.1.0".to_owned()) });
    // A plugin built against a newer minor version loads and uses what this host offers.
    let newer = build("minor-newer");
    assert_eq!(Native.inspect(&newer).unwrap().minor, 99);
    let host = crate::loader::tests::host();
    let registry = active(&host, &newer);
    let screen = markdown(&host, &registry, "```sample\nnewer\n```\n");
    assert!(screen.contains("SAMPLE v1 NEWER"), "{screen}");

    // Only a major the host does not serve, a plugin that needs a newer host, or one that needs a feature the host
    // lacks, is refused, with a clear reason.
    assert_eq!(
        load(&build("major-3"), None).unwrap(),
        "plugin ABI 3.0 is not supported: this opencode-native loads ABI 2.x plugins (up to 2.0); rebuild the plugin \
         against opencode-plugin-abi 2"
    );
    assert_eq!(
        load(&build("requires-future"), None).unwrap(),
        "plugin needs host ABI 2.99 or newer, this opencode-native has 2.0; update opencode-native"
    );
    assert_eq!(
        load(&build("requires-feature"), None).unwrap(),
        "plugin requires the feature terminal, which this opencode-native (ABI 2.0) lacks; update opencode-native"
    );
    assert!(load(b"not a library", None).unwrap().starts_with("cannot load the library"));
    // Setup runs on activation, so a setup that fails fails the plugin there.
    let (definition, error) =
        Native.load(&dynamic(&host), &current, std::path::Path::new("plugin.so"), Some("{\"fail\":true}")).unwrap();
    let registry = Registry::define(Vec::new(), []);
    registry.load(&dynamic(&host), definition.external("sample.so", error));
    assert_eq!(status(&registry), Status::Failed("sample setup failed".to_owned()));
}

#[test]
fn setup_runs_on_activation_and_the_instance_is_destroyed_after() {
    let host = host();
    let stored = |key: &str| host.storage.borrow_mut().remove(&format!("plugin.sample.{key}"));
    let (definition, error) =
        Native.load(&dynamic(&host), &build(""), std::path::Path::new("plugin.so"), Some("{\"probe\":true}")).unwrap();
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
}

/// The sample built into a plugins directory `dir`, which a fresh loader loaded into a fresh registry.
fn loaded_sample() -> (opencode_util::temp::TempDir, std::path::PathBuf, Rc<TestHost>, Registry, Loader) {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let dir = config.join("plugins").join("sample");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(entry_file()), build("")).unwrap();
    let host = host();
    let registry = Registry::define(Vec::new(), []);
    let loader = Loader::new(config, root.path().to_path_buf(), Vec::<Configured>::new())
        .with_native(Rc::new(Native) as Rc<dyn Backend>);
    assert!(loader.reconcile(&dynamic(&host), &registry));
    (root, dir, host, registry, loader)
}

#[test]
fn the_loader_reloads_a_rebuilt_library() {
    let (_root, dir, host, registry, loader) = loaded_sample();
    let screen = markdown(&host, &registry, "```sample\nhi\n```\n");
    assert!(screen.contains("SAMPLE v1 HI"), "{screen}");
    fs::write(dir.join(entry_file()), build("v2")).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let screen = markdown(&host, &registry, "```sample\nhi\n```\n");
    assert!(screen.contains("SAMPLE v2 HI"), "{screen}");
    assert_eq!(registry.entries().len(), 1);
}

#[test]
fn a_rebuild_whose_setup_fails_keeps_the_running_version() {
    let (_root, dir, host, registry, loader) = loaded_sample();
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
    fs::write(dir.join(entry_file()), build("major-3")).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let entry = crate::loader::tests::entry(&registry.entries(), &target).clone();
    assert!(entry.active);
    assert!(matches!(&entry.status, Status::Failed(error) if error.ends_with("(previous version still active)")));
}

#[test]
fn a_failed_rebuild_of_a_panicked_plugin_shows_its_own_error() {
    let (_root, dir, host, registry, loader) = loaded_sample();
    host.keymap().dispatch("sample.panic", None);
    host.app.advance(Duration::from_millis(1));
    fs::write(dir.join(entry_file()), build("major-3")).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let entry = entry(&registry.entries(), &dir.to_string_lossy()).clone();
    assert!(!entry.active);
    assert!(
        matches!(&entry.status, Status::Failed(error) if error.contains("ABI 3.0") && !error.contains("previous")),
        "{:?}",
        entry.status
    );
}

#[test]
fn a_malformed_table_is_refused_without_reading_it() {
    let refused = |api: *const PluginApi| Library::from_table(api).err().unwrap();
    assert_eq!(refused(std::ptr::null()), "`opencode_plugin_v2` returned no table");
    let short: [usize; 1] = [size_of::<usize>()];
    assert_eq!(refused(short.as_ptr().cast()), "plugin table is 8 bytes, shorter than its version header");
    let bytes = [0u64; 16];
    assert_eq!(refused(bytes.as_ptr().cast::<u8>().wrapping_add(1).cast()), "plugin table is not aligned");
    let null = PluginApi {
        size: size_of::<PluginApi>(),
        major: ABI_MAJOR,
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
    assert_eq!(refused(&api), "plugin table has a null `describe` callback");
    unsafe extern "C" fn describe(_: *mut Owned) -> i32 {
        abi::ERROR
    }
    let api = PluginApi { describe: Some(describe), ..api };
    assert!(Library::from_table(&api).unwrap().destroy.is_none());
    // A table of 1.x, though as long, is refused by its major; one shorter than 2.0's by its size.
    let v1 = PluginApi { major: 1, minor: 6, ..api };
    assert_eq!(
        refused(&v1),
        "plugin ABI 1.6 is not supported: this opencode-native loads ABI 2.x plugins (up to 2.0); rebuild the plugin \
         against opencode-plugin-abi 2"
    );
    let size = std::mem::offset_of!(PluginApi, describe);
    let short = PluginApi { size, ..api };
    assert_eq!(refused(&short), format!("plugin table is {size} bytes, shorter than the ABI 2.0 table"));
}

/// The sample, active with `options`, its home footer claim mounted, after the app's task queue is filled, so the
/// plugin's wakes find it full.
fn woken_into_a_full_queue(host: &Rc<TestHost>, options: &str) -> (Registry, impl Sized) {
    let proxy = host.app().proxy();
    while proxy.post(|_| {}).is_ok() {}
    let (definition, error) =
        Native.load(&dynamic(host), &build(""), std::path::Path::new("plugin.so"), Some(options)).unwrap();
    let registry = Registry::define(Vec::new(), []);
    registry.load(&dynamic(host), definition.external("sample.so", error));
    let parent = View::new(host.app());
    let mounted = registry.mount(&**host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    host.app().root().add(&parent);
    // The one tick wakes the host while the queue is still full.
    std::thread::sleep(Duration::from_millis(300));
    (registry, mounted)
}

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

#[test]
fn setup_reaches_the_host() {
    let host = host();
    host.mode.set(ThemeMode::Light);
    host.storage.borrow_mut().insert("plugin.sample.count".to_owned(), "{\"count\":5}".to_owned());
    let (definition, error) =
        Native.load(&dynamic(&host), &build(""), std::path::Path::new("plugin.so"), Some("{\"probe\":true}")).unwrap();
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
    host.mode.set(ThemeMode::Light);
    assert!(markdown(&host, &library, "```sample-mode\nx\n```\n").contains("sample mode light"));
}

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
fn loopback(host: &Rc<TestHost>, entries: abi::runtime::Loopback) -> Registry {
    let (definition, error) = super::loopback(&dynamic(host), entries).unwrap();
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

#[test]
fn latex_streams_the_same_through_the_c_abi_loopback() {
    let host = host();
    let in_process = Registry::define(vec![opencode_latex::plugin().into()], []);
    in_process.activate(&dynamic(&host));
    let loopback =
        loopback(&host, abi::export_plugin!(@loopback opencode_latex::plugin().id, opencode_latex::plugin().setup));

    // A half-typed command keeps the last formula; an incomplete one draws with `□`; then the whole one.
    let chunks = ["```latex\n\\frac{a_1+b_1}{c_1+d_1}", "+\\fr", "ac{a_", "2}{c_2}"];
    let direct = stream(&host, &in_process, &chunks);
    let text: Vec<String> = direct.iter().map(Capture::text).collect();
    assert_eq!(direct[1], direct[0]);
    assert!(text[0].contains("───") && !text[0].contains("\\frac"), "{}", text[0]);
    assert!(text[2].contains('□') && !text[2].contains("\\fr"), "{}", text[2]);
    assert!(!text[3].contains('□') && !text[3].contains("\\frac"), "{}", text[3]);
    assert_eq!(stream(&host, &loopback, &chunks), direct);
}

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

/// What `featured`'s setup read: `Setup::features`, and `Setup::abi`'s features and its `image-bounds`.
type Featured = (Vec<String>, Vec<String>, bool);

thread_local! {
    static FEATURED: RefCell<Vec<Featured>> = const { RefCell::new(Vec::new()) };
}

fn featured(setup: &mut abi::Setup) -> Result<(), String> {
    let abi = setup.abi();
    let read = (setup.features().to_vec(), abi.features.clone(), abi.has_feature(abi::IMAGE_BOUNDS));
    FEATURED.with_borrow_mut(|seen| seen.push(read));
    Ok(())
}

#[test]
fn a_setup_reads_one_list_of_features_on_both_carriers() {
    let host = host();
    FEATURED.with_borrow_mut(Vec::clear);
    let linked = Registry::define(Vec::new(), []);
    linked.add(abi::Plugin { id: "featured", setup: featured });
    linked.activate(&dynamic(&host));
    let _through = loopback(&host, abi::export_plugin!(@loopback "featured", featured));
    let seen = FEATURED.with_borrow(Vec::clone);
    let features = vec![abi::IMAGE_BOUNDS.to_owned(), abi::FOCUS_INPUT.to_owned(), abi::FENCE_NODE.to_owned()];
    let expected = (features.clone(), features, true);
    assert_eq!(seen, [expected.clone(), expected], "linked, then through the C ABI");
}

fn second(setup: &mut abi::Setup) -> Result<(), String> {
    setup.on_event(&["session.execution.succeeded"], |host, _| {
        host.toast(abi::Toast::new(abi::Variant::Info, "second"))
    });
    Ok(())
}

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

#[test]
fn the_instance_is_destroyed_at_once_while_its_route_is_mounted() {
    let host = host();
    let destroyed = || host.storage.borrow_mut().remove("plugin.sample.destroyed");
    let load = |build: &[u8]| {
        let (definition, error) =
            Native.load(&dynamic(&host), build, std::path::Path::new("plugin.so"), Some("{\"probe\":true}")).unwrap();
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

/// A `long` fence of 3,001 lines.
fn long_fence(setup: &mut abi::Setup) -> Result<(), String> {
    setup.code_block("long", |_, _| {
        let lines = (0..3_001).map(|index| vec![abi::Span::new(format!("line {index}"))]).collect();
        abi::Fenced::Lines { lines, fg: None, drag: false }
    });
    Ok(())
}

#[test]
fn a_fence_past_the_rows_shows_its_placeholder() {
    let host = host();
    let in_process = Registry::define(vec![abi::Plugin { id: "long", setup: long_fence }.into()], []);
    in_process.activate(&dynamic(&host));
    let direct = markdown(&host, &in_process, "```long\nx\n```\n");
    assert!(direct.contains("⋯ too large to build at once") && !direct.contains("line 0"), "{direct}");
    let loopback = loopback(&host, abi::export_plugin!(@loopback "long", long_fence));
    assert_eq!(markdown(&host, &loopback, "```long\nx\n```\n"), direct);
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

#[test]
fn the_sample_fetch_and_panel_act_the_same_in_process_and_through_the_library() {
    let host = host();
    let in_process =
        Rc::new(Registry::define(vec![abi::Plugin { id: "sample", setup: sample_fetch::setup }.into()], []));
    in_process.activate(&dynamic(&host));
    let direct = fetched(&host, &in_process);
    assert_eq!(direct.0, ["sample fetch: none", "sample fetch: /api/sample"]);
    assert_eq!(direct.1, [abi::Fetch::new("GET", "/api/sample")]);
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
    let command = abi::Command::new("x.fetch");
    setup.command(command, |host, _| {
        let _ = host.try_fetch(abi::Fetch::new("GET", "/slow"));
    });
    setup.on_reply(|host, _, _| host.toast(abi::Toast::new(abi::Variant::Info, "reply")));
    Ok(())
}

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

/// A plugin that fetches on `x.fetch` and has three reply handlers, each of which toasts its number and the reply.
fn replying_thrice(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(abi::Command::new("x.fetch"), |host, _| {
        let _ = host.try_fetch(abi::Fetch::new("GET", "/page"));
    });
    for handler in 1..=3 {
        setup.on_reply(move |host, _, result| {
            let message = format!("{handler}: {}", result.map_or_else(|error| error, |value| value.to_string()));
            host.toast(abi::Toast::new(abi::Variant::Info, message));
        });
    }
    Ok(())
}

#[test]
fn every_reply_handler_gets_the_whole_reply_in_process_and_through_the_library() {
    let host = host();
    let registries = [
        Registry::define(vec![abi::Plugin { id: "thrice", setup: replying_thrice }.into()], []),
        loopback(&host, abi::export_plugin!(@loopback "thrice", replying_thrice)),
    ];
    let page =
        serde_json::json!({ "data": [{ "id": "msg_1", "tokens": { "cache": { "read": 2 } } }, null], "cursor": {} });
    for registry in registries {
        registry.activate(&dynamic(&host));
        for reply in [Ok(page.clone()), Err("UnexpectedStatus: 500".to_owned())] {
            host.keymap().dispatch("x.fetch", None);
            host.app.advance(Duration::from_millis(1));
            let (_, deliver) = host.fetches.borrow_mut().remove(0);
            deliver(reply.clone());
            host.app.advance(Duration::from_millis(1));
            let said = reply.map_or_else(|error| error, |value| value.to_string());
            let toasts: Vec<String> = host.toasts.borrow_mut().drain(..).map(|toast| toast.message).collect();
            assert_eq!(toasts, [1, 2, 3].map(|handler| format!("{handler}: {said}")));
        }
        registry.set_active(&dynamic(&host), "thrice", false);
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
    let fetch = abi::Fetch::new("GET", "/api/sample/ses_1");
    assert_eq!(direct.1, [fetch.clone(), fetch]);
    in_process.set_active(&dynamic(&host), "sample", false);
    let library = active(&host, &build("still"));
    assert_eq!(prompted(&host, &library), direct);
}

/// The sample's small reads and verbs, compiled in rather than loaded.
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

/// What the small reads and verbs show and ask for through `registry`: the sample's reads row in `home.footer` as it mounts, once a frame
/// laid it out, after two deltas, and after its verbs command; then the verbs the host ran, the toasts and the dialogs.
type Verbed = (Vec<String>, Vec<String>, Vec<String>, Vec<(String, abi::Dialog)>);

fn verbed(host: &Rc<TestHost>, registry: &Registry) -> Verbed {
    host.app.resize(240, 10);
    let row = |host: &TestHost, parent: &View| {
        host.app.advance(Duration::from_millis(1));
        host.app().root().clear();
        host.app().root().add(parent);
        // One frame: the claim shows what it renders for its size in the frame that lays it out.
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

#[test]
fn the_small_reads_and_verbs_are_the_same_in_process_and_through_the_library() {
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

    let (definition, error) = Native
        .load(&dynamic(&host), &build("still"), std::path::Path::new("plugin.so"), Some(r#"{"reads":true}"#))
        .unwrap();
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
        let _ = host.try_foreground(abi::Foreground { command: "true".into(), ..abi::Foreground::default() });
    };
    setup.command(abi::Command::new("x.run"), move |host, _| run(host));
    setup.command(abi::Command::new("x.boom"), move |host, _| -> () {
        run(host);
        panic!("boom");
    });
    Ok(())
}

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
        let _ = host.try_fetch(abi::Fetch::new("GET", "/api/woken"));
    });
    setup.slot(abi::Placement::append("home.footer"), move |_, _, changed| {
        go.store(true, Ordering::Release);
        abi::Render::Show(abi::Node::text([abi::Span::new(format!("wakes {} {}", runs.get(), changed.woken))]))
    });
    Ok(())
}

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
    let panic = abi::Command::new("keeping.panic");
    setup.command(panic, |_, _| -> () { panic!("keeping command panicked") });
    Ok(())
}

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
    let command = |name: &str| abi::Command::new(name);
    setup.command(command("fetching.fetch"), |host, _| {
        let _ = host.try_fetch(abi::Fetch::new("GET", "/fetched"));
    });
    setup.command(command("fetching.panic"), |_, _| -> () { panic!("fetching panicked") });
    Ok(())
}

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

#[test]
fn a_wake_after_the_activation_ended_posts_nothing() {
    let host = host();
    let wake = Arc::new(crate::activation::Wake::new(Some(host.app().proxy())));
    let mailbox = crate::mailbox::Mailbox::new("test.wake", wake.clone());
    let activation = crate::activation::Activation::new(&dynamic(&host), mailbox);
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
        let _ = host.try_fetch(abi::Fetch::new("GET", "/disposed"));
    });
    setup.on_reply(|host, _, _| host.toast(abi::Toast::new(abi::Variant::Info, "reply")));
    let panic = abi::Command::new("lifecycle.panic");
    setup.command(panic, |_, _| -> () { panic!("lifecycle command panicked") });
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
                unsafe { abi::runtime::describe("lifecycle", "0.1.0", &[], out) }
            }
            let api = sdk_table(create, describe);
            let library = Library::from_table(&api).unwrap();
            let (definition, error) = define(library, None).unwrap();
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

#[test]
fn setup_and_dispose_effects_are_the_same_on_both_paths() {
    let direct = lifecycled(lifecycle, abi::export_plugin!(@loopback_create "lifecycle", lifecycle), false, false);
    assert_eq!((direct.0.status.clone(), direct.0.active), (Status::Active, true));
    assert_eq!((direct.1.as_slice(), direct.2), (["setup", "dispose"].map(String::from).as_slice(), 0));
    let through = lifecycled(lifecycle, abi::export_plugin!(@loopback_create "lifecycle", lifecycle), true, false);
    assert_eq!((through.1, through.2), (direct.1, direct.2));

    let failing = abi::export_plugin!(@loopback_create "lifecycle", lifecycle_failing);
    let direct = lifecycled(lifecycle_failing, failing, false, false);
    assert_eq!((direct.0.status.clone(), direct.0.active), (Status::Failed("lifecycle failed".to_owned()), false));
    assert_eq!((direct.1.as_slice(), direct.2), (["setup", "dispose"].map(String::from).as_slice(), 0));
    let through = lifecycled(lifecycle_failing, failing, true, false);
    assert_eq!(
        (through.0.status, through.0.active, through.1, through.2),
        (direct.0.status, false, direct.1, direct.2)
    );
}

#[test]
fn a_failed_plugin_gets_no_dispose_on_both_paths() {
    for (loopback, panic) in [(false, false), (false, true), (true, false), (true, true)] {
        LIFECYCLE_DISPOSED.set(0);
        let (_, toasts, fetches) =
            lifecycled(lifecycle, abi::export_plugin!(@loopback_create "lifecycle", lifecycle), loopback, panic);
        let calls: Vec<&str> =
            toasts.iter().map(String::as_str).filter(|toast| ["setup", "dispose"].contains(toast)).collect();
        let expected = if panic { (vec!["setup"], 0) } else { (vec!["setup", "dispose"], 1) };
        assert_eq!((calls, LIFECYCLE_DISPOSED.get()), expected, "through the C ABI: {loopback}, panic: {panic}");
        assert_eq!(fetches, 0);
    }
}

#[test]
fn a_failed_setup_runs_the_dispose_callbacks_it_registered() {
    for (options, error, destroyed) in [
        ("{\"probe\":true,\"fail\":true}", "sample setup failed", Some("{\"destroyed\":true}")),
        ("{\"probe\":true,\"panic\":true}", "setup panicked: sample setup panicked", None),
    ] {
        let host = host();
        let (definition, failure) =
            Native.load(&dynamic(&host), &build(""), std::path::Path::new("plugin.so"), Some(options)).unwrap();
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
    let loader =
        Loader::new(config, root.path().to_path_buf(), vec![entry]).with_native(Rc::new(Native) as Rc<dyn Backend>);
    (root, target, registry, loader)
}

const MAJOR_3: &str = "plugin ABI 3.0 is not supported: this opencode-native loads ABI 2.x plugins (up to 2.0); rebuild \
                       the plugin against opencode-plugin-abi 2";

#[test]
fn a_failed_external_setup_is_failed_and_inactive_and_a_reload_error_replaces_it() {
    let host = host();
    let (_root, target, registry, loader) = configured("{\"fail\":true}", &[]);
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let failed = abi::Toast::new(abi::Variant::Error, "Run /plugins to view details.");
    assert_eq!(*host.toasts.borrow(), [failed.clone().title("Plugin failed: sample")]);
    let sample = entry(&registry.entries(), &target).clone();
    assert_eq!((sample.status, sample.active), (Status::Failed("sample setup failed".to_owned()), false));

    fs::write(&target, build("major-3")).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let sample = entry(&registry.entries(), &target).clone();
    assert_eq!((sample.status, sample.active), (Status::Failed(MAJOR_3.to_owned()), false));
    assert_eq!(host.toasts.borrow()[1], failed.clone().title("Plugin failed: sample"));
    // As a `cli.json` directive enables it, a load that fails again lists it failed and says so.
    assert!(registry.set_active(&dynamic(&host), "sample", true));
    let sample = entry(&registry.entries(), &target).clone();
    assert_eq!((sample.status, sample.active), (Status::Failed(MAJOR_3.to_owned()), false));
    assert_eq!(host.toasts.borrow()[2..], [failed.title("Plugin failed: sample")]);
}

#[test]
fn a_failed_load_without_an_id_is_named_by_its_target() {
    let host = host();
    let (_root, target, registry, loader) = configured("{}", &[]);
    fs::write(&target, build("major-3")).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let failed = abi::Toast::new(abi::Variant::Error, "Run /plugins to view details.");
    assert_eq!(*host.toasts.borrow(), [failed.title(format!("Plugin failed: {target}"))]);
}

#[test]
fn a_broken_build_of_an_inactive_plugin_is_failed_and_enabling_it_starts_nothing() {
    let host = host();
    let (_root, target, registry, loader) = configured("{}", &["-sample"]);
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!(entry(&registry.entries(), &target).status, Status::Inactive);
    fs::write(&target, build("major-3")).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let failed = abi::Toast::new(abi::Variant::Error, "Run /plugins to view details.");
    assert_eq!(*host.toasts.borrow(), [failed.title("Plugin failed: sample")]);
    assert_eq!(entry(&registry.entries(), &target).status, Status::Failed(MAJOR_3.to_owned()));
    assert!(registry.set_active(&dynamic(&host), "sample", true));
    let sample = entry(&registry.entries(), &target).clone();
    assert_eq!((sample.status, sample.active), (Status::Failed(MAJOR_3.to_owned()), false));
    let screen = markdown(&host, &registry, "```sample\nstale\n```\n");
    assert!(!screen.contains("SAMPLE"), "{screen}");
}

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

#[test]
fn the_quick_start_plugin_loads_from_a_plugins_directory_and_runs() {
    let temp = opencode_util::temp::tempdir().unwrap();
    let config = temp.path().join("config");
    let dir = config.join("plugins").join("hello");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(entry_file()), build_example("hello", "opencode_hello", "")).unwrap();

    let host = host();
    let registry = Registry::define(Vec::new(), []);
    let loader = Loader::new(config, temp.path().to_path_buf(), Vec::<Configured>::new())
        .with_native(Rc::new(Native) as Rc<dyn Backend>);
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let hello = entry(&registry.entries(), &dir.to_string_lossy()).clone();
    assert_eq!((hello.id.as_str(), hello.status), ("example.hello", Status::Active));
    let (load, setup) = registry.monitor().load("example.hello");
    assert!(load.is_some() && setup.is_some(), "{load:?} {setup:?}");

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

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn the_sample_names_only_system_libraries() {
    let library = build("");
    let names = crate::loader::deps::named(&library).unwrap();
    let system = |name: &crate::loader::deps::Name| matches!(name, crate::loader::deps::Name::Library(text) if text.contains("libc.so") || text.contains("libSystem"));
    assert!(names.iter().any(system), "{names:?}");
    assert_eq!(crate::loader::deps::check(&library, true), Ok(()));
}

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
    let _ = host.try_fetch(abi::Fetch::new("GET", "/leaked"));
    host.dialog(abi::Dialog::Close { key: "leaked".into() });
    // The small verbs.
    host.set_variant(Some("high"));
    host.set_model("opencode", "small");
    host.edit_tab(abi::TabEdit::Focus { session: "ses_1".into() });
    host.clear_selection();
    let _ = host.try_foreground(abi::Foreground { command: "leaked".into(), ..abi::Foreground::default() });
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
    setup.command(abi::Command::new("x.panic"), |host, _| leak(host, "command"));
    let fetch = abi::Command::new("x.fetch");
    setup.command(fetch, |host, _| {
        let _ = host.try_fetch(abi::Fetch::new("GET", "/asked"));
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
    setup.surface(abi::v2::Surface::new("v", abi::v2::Place::Route("v".into()), |_| {
        abi::v2::Node::text(vec![abi::Span::new("a view")])
    }));
    Ok(())
}

thread_local! {
    /// What [`corrupting`] answers in place of the plugin's answer, while it is set.
    static CORRUPT: Cell<Option<&'static [u8]>> = const { Cell::new(None) };
}

/// The SDK's `call`, whose answer becomes the bytes [`CORRUPT`] holds, as a library with a bug would answer.
unsafe extern "C" fn corrupting(instance: *mut c_void, request: Bytes, out: *mut Owned) -> i32 {
    // SAFETY: the loader passes what `PluginApi::call` documents.
    let status = unsafe { abi::runtime::call(instance, request, out) };
    if let (abi::OK, Some(bytes)) = (status, CORRUPT.get()) {
        // SAFETY: `out` holds the shim's answer, which the shims' `free` takes back.
        unsafe { abi::runtime::free(std::ptr::replace(out, Owned::from_vec(bytes.to_vec()))) };
    }
    status
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
        unsafe { abi::runtime::describe("panicky", "0.1.0", &[], out) }
    }
    let api = PluginApi {
        call: Some(corrupting),
        ..sdk_table(abi::export_plugin!(@loopback_create "panicky", panicky), describe)
    };
    let (definition, error) = define(Library::from_table(&api).unwrap(), None).unwrap();
    registry.load(&dynamic(host), definition.external("panicky.so", error));
    registry
}

/// What a host saw of the plugin's effects, without the failure toast: toasts, attention, routes, fetches, dialogs,
/// storage, and the small verbs.
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
            // The wake handlers run as a paint starts.
            let woken = || {
                host.app.render();
                WOKEN.get() > 0
            };
            assert!(host.app.wait_until(Duration::from_secs(10), woken), "no wake");
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
            // Every small verb ran without the panic, so the comparison covers each.
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

/// The `describe` of a plugin without the SDK, which names `$id`.
macro_rules! describe {
    ($id:literal) => {{
        unsafe extern "C" fn describe(out: *mut Owned) -> i32 {
            // SAFETY: the loader passes what `PluginApi::describe` documents.
            unsafe { abi::runtime::describe($id, "0.1.0", &[], out) }
        }
        describe as unsafe extern "C" fn(*mut Owned) -> i32
    }};
}

#[test]
fn a_host_call_from_another_thread_is_refused() {
    let host = host();
    host.mode.set(ThemeMode::Light);
    let api = sdk_table(catching, describe!("threads"));
    let (definition, error) = define(Library::from_table(&api).unwrap(), None).unwrap();
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

// Per thread: each test runs its plugin on its own thread, so tests that run at once share none of them.
thread_local! {
    /// The host table of the last `raw` instance.
    static RAW_HOST: Cell<*mut HostApi> = const { Cell::new(std::ptr::null_mut()) };
    /// How the raw render and command answer: 0 with `hide` or `null`, 1 with a result the host refuses, 2 with `hide`
    /// and no effects asked for.
    static RAW_MODE: Cell<u8> = const { Cell::new(0) };
    /// The statuses the host answered the raw render's requests with.
    static RAW_STATUSES: RefCell<Vec<i32>> = const { RefCell::new(Vec::new()) };
    /// Each command takes 150 ms on [`RAW_NOW`], the clock a test gives the monitor.
    static RAW_LATE: Cell<bool> = const { Cell::new(false) };
    static RAW_NOW: Cell<Duration> = const { Cell::new(Duration::ZERO) };
}

/// A plugin written against the C ABI without the SDK: one slot claim, one command and one storage key.
unsafe extern "C" fn raw_create(host: *const HostApi, _: Bytes, instance: *mut *mut c_void, out: *mut Owned) -> i32 {
    RAW_HOST.set(host.cast_mut());
    let manifest = r#"{"id":"raw","commands":[{"name":"raw.ask","title":"Ask","group":null,"slash":null,"keybind":null,"palette":false}],"fences":[],"slots":[{"kind":"append","path":"home.footer"}],"routes":[],"storage":["k"]}"#;
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
    // A command, which may ask for effects: they apply with a result the host takes, not with one it refuses.
    if request.contains(r#""type":"command""#) {
        if RAW_LATE.get() {
            RAW_NOW.set(RAW_NOW.get() + Duration::from_millis(150));
        }
        let table = Table(RAW_HOST.get());
        table.call(r#"{"type":"toast","variant":"info","message":"from a command"}"#);
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
                    // The small verbs.
                    r#"{"type":"set-variant","variant":"high"}"#,
                    r#"{"type":"set-model","provider":"p","model":"m"}"#,
                    r#"{"type":"tab","edit":{"type":"focus","session":"ses_1"}}"#,
                    r#"{"type":"clear-selection"}"#,
                    r#"{"type":"foreground","command":"true"}"#,
                    r#"{"type":"title","title":"t"}"#,
                    r#"{"type":"set-theme","name":"nord"}"#,
                    r#"{"type":"install-theme","name":"x","theme":{"theme":{}}}"#,
                    // .
                    r#"{"type":"scroll","target":{"type":"node","surface":"s","id":"l"},"verb":{"type":"by","rows":1}}"#,
                ];
                let statuses = asks.iter().map(|ask| table.call(ask).0);
                RAW_STATUSES.with_borrow_mut(|known| known.extend(statuses));
                // A small read is answered.
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

#[test]
fn a_render_that_asks_for_effects_gets_none() {
    let outcome = |mode: u8| {
        RAW_MODE.set(mode);
        RAW_STATUSES.take();
        let host = host();
        let api = PluginApi { call: Some(raw_call), destroy: None, ..sdk_table(raw_create, describe!("raw")) };
        let (definition, error) = define(Library::from_table(&api).unwrap(), None).unwrap();
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
        let (statuses, mut seen) = outcome(mode);
        assert_eq!(statuses, [abi::ERROR; 13], "mode {mode}");
        if mode == 1 {
            assert!(matches!(&seen.4, Status::Failed(error) if error.contains("bad result")), "{:?}", seen.4);
            assert_eq!(seen.1, 1, "one toast says the plugin failed");
            (seen.1, seen.4) = (0, Status::Active);
        }
        assert_eq!(seen, quiet.1, "mode {mode}");
    }
}

thread_local! {
    /// The status the host answered the transcript plugin's scroll with, when its command ran.
    static TX_STATUS: Cell<Option<i32>> = const { Cell::new(None) };
}

/// A plugin without the SDK whose one command scrolls the transcript.
unsafe extern "C" fn tx_create(host: *const HostApi, _: Bytes, instance: *mut *mut c_void, out: *mut Owned) -> i32 {
    RAW_HOST.set(host.cast_mut());
    let manifest = r#"{"id":"tx","commands":[{"name":"tx.scroll","title":"Scroll","group":null,"slash":null,"keybind":null,"palette":false}],"fences":[],"slots":[],"routes":[],"storage":[]}"#;
    // SAFETY: the loader passes valid pointers; the instance pointer is never read.
    unsafe {
        *instance = std::ptr::NonNull::<u8>::dangling().as_ptr().cast();
        *out = Owned::from_vec(manifest.as_bytes().to_vec());
    }
    abi::OK
}

unsafe extern "C" fn tx_call(_: *mut c_void, request: Bytes, out: *mut Owned) -> i32 {
    // SAFETY: the loader passes the request for the call.
    let request = String::from_utf8_lossy(unsafe { request.as_slice() }).into_owned();
    if request.contains(r#""type":"command""#) {
        let scroll = r#"{"type":"scroll","target":{"type":"transcript"},"verb":{"type":"by","rows":1}}"#;
        TX_STATUS.set(Some(Table(RAW_HOST.get()).call(scroll).0));
    }
    // SAFETY: `out` is valid for writes during the call.
    unsafe { *out = Owned::from_vec(b"null".to_vec()) };
    abi::OK
}

#[test]
fn a_librarys_command_may_scroll_the_transcript() {
    let host = host();
    let api = PluginApi { call: Some(tx_call), destroy: None, ..sdk_table(tx_create, describe!("tx")) };
    let (definition, error) = define(Library::from_table(&api).unwrap(), None).unwrap();
    let registry = Registry::define(Vec::new(), []);
    registry.load(&dynamic(&host), definition.external("tx.so", error));
    TX_STATUS.set(None);
    assert!(matches!(host.keymap().dispatch("tx.scroll", None), RunResult::Ok));
    assert_eq!(TX_STATUS.get(), Some(abi::OK));
}

#[test]
fn a_late_refused_result_leaves_no_effects() {
    let outcome = |mode: u8| {
        RAW_MODE.set(mode);
        RAW_LATE.set(true);
        let host = host();
        let api = PluginApi { call: Some(raw_call), destroy: None, ..sdk_table(raw_create, describe!("raw")) };
        let (definition, error) = define(Library::from_table(&api).unwrap(), None).unwrap();
        let registry = Registry::define(Vec::new(), []);
        let base = std::time::Instant::now();
        registry.monitor().set_clock(move || base + RAW_NOW.get());
        registry.load(&dynamic(&host), definition.external("raw.so", error));
        for _ in 0..2 {
            host.toasts.borrow_mut().clear();
            host.keymap().dispatch("raw.ask", None);
            host.app.advance(Duration::from_millis(1));
        }
        RAW_LATE.set(false);
        // The command's own toasts; the failure has its own.
        let toasts: Vec<_> = host
            .toasts
            .borrow()
            .iter()
            .map(|toast| toast.message.clone())
            .filter(|message| message.starts_with("from"))
            .collect();
        let status = registry.entries().into_iter().find(|entry| entry.id == "raw").unwrap().status;
        let cause = match &status {
            Status::Failed(error) if error.starts_with("run-command took 150 ms") => "overrun",
            Status::Failed(error) if error.starts_with("run-command returned a bad result") => "refused",
            _ => "none",
        };
        (toasts, host.storage.borrow().get("plugin.raw.k").cloned(), cause)
    };
    assert_eq!(outcome(0), (vec!["from a command".to_owned()], Some("{\"a\":1}".to_owned()), "overrun"));
    assert_eq!(outcome(1), (Vec::new(), None, "refused"));
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
    let command = |name: &str| abi::Command::new(name).title(name);
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
    let command = abi::Command::new("replacer.panic").title("panic");
    setup.command(command, |_, _| -> () { panic!("replacer fault") });
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
    let command = abi::Command::new("timed.slow").title("slow");
    setup.command(command, |_, _| {
        timed_seen();
        TIMED_NOW.set(TIMED_NOW.get() + Duration::from_millis(150));
    });
    setup.on_dispose(|_| timed_seen());
    Ok(())
}

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

thread_local! {
    static MARKED: RefCell<Vec<bool>> = const { RefCell::new(Vec::new()) };
}

/// A built-in that notes, in each of its calls, whether a panic there would unwind to the host's catch.
fn noting(setup: &mut abi::Setup) -> Result<(), String> {
    MARKED.with_borrow_mut(|caught| caught.push(crate::contain::catching()));
    let command = abi::Command::new("noting.run").title("run");
    setup.command(command, |_, _| MARKED.with_borrow_mut(|caught| caught.push(crate::contain::catching())));
    setup.on_dispose(|_| MARKED.with_borrow_mut(|caught| caught.push(crate::contain::catching())));
    Ok(())
}

#[test]
fn a_builtin_runs_inside_the_catch() {
    for builtin in [crate::Builtin::Plugin, crate::Builtin::Abi] {
        let host = host();
        MARKED.take();
        let registry = Registry::define(Vec::new(), []);
        registry.add(builtin(abi::Plugin { id: "noting", setup: noting }));
        registry.activate(&dynamic(&host));
        host.keymap().dispatch("noting.run", None);
        registry.toggle(&dynamic(&host), "noting", false);
        assert_eq!(MARKED.take(), [true, true, true]);
        assert!(!crate::contain::catching());
    }
}

#[test]
fn a_result_the_host_refuses_has_no_effects() {
    let (quiet, _) = panicky_run("command", ("", false), true);
    let (leaked, _) = panicky_run("command", ("command", false), true);
    assert_ne!(leaked, quiet, "the guard: the command's effects show");
    let bad: [&'static [u8]; 3] = [b"{\"ty", &[0xff, 0x00, 0x13, 0x37], b""];
    for bytes in bad {
        CORRUPT.set(Some(bytes));
        let (refused, (entry, failed, command)) = panicky_run("command", ("command", false), true);
        CORRUPT.set(None);
        assert_eq!(refused, quiet, "{bytes:?}");
        let error = match &entry.status {
            Status::Failed(error) => error.clone(),
            status => panic!("{bytes:?}: {status:?}"),
        };
        assert!(error.starts_with("run-command returned a bad result: "), "{error}");
        assert_eq!((entry.active, failed, command), (true, 1, false), "{bytes:?}");
    }

    // A memo table cannot hold more values than the tree has keyed nodes; a count past it is refused, not booked.
    let host = crate::loader::tests::host();
    let registry = panicking(&host, true);
    CORRUPT.set(Some(br#"{"node":{"type":"text","id":"t","spans":[]},"memo":9223372036854775808}"#));
    // A route's first view runs in the turn's deferred work.
    let route = registry.route(&*host, "panicky", "v");
    host.app.advance(Duration::from_millis(1));
    CORRUPT.set(None);
    drop(route);
    let entry = registry.entries().into_iter().find(|entry| entry.id == "panicky").unwrap();
    assert!(matches!(&entry.status, Status::Failed(error) if error.contains("memo table")), "{:?}", entry.status);

    // A view's content must be numbered after the mount's, as the host numbers it in process.
    let host = crate::loader::tests::host();
    let registry = panicking(&host, true);
    CORRUPT.set(Some(br#"{"node":{"type":"text","spans":[]},"content":[[99,"stray"]]}"#));
    // A route's first view runs in the turn's deferred work.
    let route = registry.route(&*host, "panicky", "v");
    host.app.advance(Duration::from_millis(1));
    CORRUPT.set(None);
    drop(route);
    let entry = registry.entries().into_iter().find(|entry| entry.id == "panicky").unwrap();
    assert!(matches!(&entry.status, Status::Failed(error) if error.contains("content handles")), "{:?}", entry.status);

    let host = crate::loader::tests::host();
    let registry = panicking(&host, true);
    CORRUPT.set(Some(br#"{"node":{"type":"wormhole","depth":7}}"#));
    let route = registry.route(&*host, "panicky", "v");
    host.app.advance(Duration::from_millis(1));
    CORRUPT.set(None);
    let entry = registry.entries().into_iter().find(|entry| entry.id == "panicky").unwrap();
    let named = |error: &str| error.starts_with("view returned a bad result") && error.contains("wormhole");
    assert!(matches!(&entry.status, Status::Failed(error) if named(error)), "{:?}", entry.status);
    host.app().root().clear();
    host.app().root().add(&route.unwrap().root());
    host.app.render();
    assert!(!host.app.text().contains("a view"), "{}", host.app.text());
}

/// The C plugin loaded with `options` into a fresh host and registry.
#[cfg(unix)]
fn c_active(library: &[u8], options: &str) -> (Rc<TestHost>, Registry) {
    let host = host();
    let (definition, error) =
        Native.load(&dynamic(&host), library, std::path::Path::new("plugin.so"), Some(options)).unwrap();
    let registry = Registry::define(Vec::new(), []);
    registry.load(&dynamic(&host), definition.external("c.so", error));
    (host, registry)
}

/// The toasts' messages so far.
#[cfg(unix)]
fn toasts(host: &TestHost) -> Vec<String> {
    host.toasts.borrow().iter().filter(|toast| toast.title.is_none()).map(|toast| toast.message.clone()).collect()
}

/// The route `c` drawn alone, or `None` when the plugin has none.
#[cfg(unix)]
fn c_route(host: &Rc<TestHost>, registry: &Registry) -> Option<String> {
    let route = registry.route(&**host, "example.c", "c")?;
    host.app().root().clear();
    host.app().root().add(&route.root());
    host.app.render();
    Some(host.app.text())
}

#[cfg(unix)]
#[test]
fn a_plugin_written_in_c_against_the_header_runs() {
    let Some(library) = cc("examples/c/plugin.c", &[]) else { return };
    assert_eq!(Native.inspect(&library).unwrap(), Inspected { major: 2, minor: 0, version: Some("0.1.0".to_owned()) });
    let (host, registry) = c_active(&library, "");
    assert_eq!(entry(&registry.entries(), "c.so").status, Status::Active);
    assert!(matches!(host.keymap().dispatch("c.hello", None), RunResult::Ok));
    host.app.advance(Duration::from_millis(1));
    host.app.advance(Duration::from_millis(1));
    assert_eq!(toasts(&host), ["hello from C", "send answered 0"]);
    let screen = c_route(&host, &registry).unwrap();
    assert!(screen.contains("drawn in C, 1 messages"), "{screen}");
}

#[cfg(unix)]
#[test]
fn a_1_x_library_is_refused_by_its_major() {
    let Some(library) = cc("examples/c/plugin.c", &["-DOPENCODE_AS_V1"]) else { return };
    let refused = "plugin ABI 1.x is not supported: this opencode-native loads ABI 2.x plugins (up to 2.0); rebuild \
                   the plugin against opencode-plugin-abi 2";
    assert_eq!(Native.inspect(&library).err().unwrap(), refused);
    let error = Native.load(&dynamic(&host()), &library, std::path::Path::new("plugin.so"), None).err().unwrap();
    assert_eq!(error, refused);
}

#[cfg(unix)]
#[test]
fn a_2_x_library_whose_describe_fails_is_refused() {
    let Some(library) = cc("examples/c/plugin.c", &["-DOPENCODE_BAD_DESCRIBE"]) else { return };
    let error = Native.load(&dynamic(&host()), &library, std::path::Path::new("plugin.so"), None).err().unwrap();
    assert!(error.starts_with("plugin describe failed: "), "{error}");
    assert!(Native.inspect(&library).err().unwrap().starts_with("plugin describe failed: "));
}

#[cfg(unix)]
#[test]
fn a_c_plugin_gets_what_its_answers_ask_for() {
    let Some(library) = cc("examples/c/plugin.c", &[]) else { return };

    let (host, registry) = c_active(&library, "view-toast");
    let screen = c_route(&host, &registry).unwrap();
    host.app.advance(Duration::from_millis(1));
    assert!(screen.contains("drawn in C, 0 messages, toast refused"), "{screen}");
    assert!(toasts(&host).is_empty(), "a view's toast showed");

    let (host, registry) = c_active(&library, "command-true");
    host.keymap().dispatch("c.hello", None);
    host.app.advance(Duration::from_millis(1));
    assert!(toasts(&host).is_empty(), "a refused command's toast showed");
    let status = entry(&registry.entries(), "c.so").status.clone();
    assert!(
        matches!(&status, Status::Failed(error) if error.starts_with("run-command returned a bad result")),
        "{status:?}"
    );

    let (host, registry) = c_active(&library, "command-error");
    host.keymap().dispatch("c.hello", None);
    host.app.advance(Duration::from_millis(1));
    assert_eq!(toasts(&host), ["hello from C", "send answered 0"]);
    let failed = Status::Failed("run-command returned an error: the command failed".to_owned());
    assert_eq!(entry(&registry.entries(), "c.so").status, failed);

    let (host, registry) = c_active(&library, "no-messages");
    host.keymap().dispatch("c.hello", None);
    host.app.advance(Duration::from_millis(1));
    host.app.advance(Duration::from_millis(1));
    assert_eq!(toasts(&host), ["hello from C", format!("send answered {}", abi::CLOSED).as_str()]);
    let screen = c_route(&host, &registry).unwrap();
    assert!(screen.contains("drawn in C, 0 messages"), "{screen}");
}

#[cfg(unix)]
#[test]
fn a_c_plugin_draws_a_canvas() {
    let Some(library) = cc("examples/c/plugin.c", &[]) else { return };
    let run = |options: &str| {
        let (host, registry) = c_active(&library, options);
        // The mount is kept, so the message's view and draw reach it.
        let route = registry.route(&*host, "example.c", "c").unwrap();
        host.app().root().add(&route.root());
        host.app.render();
        let first = host.app.text();
        host.keymap().dispatch("c.hello", None);
        host.app.advance(Duration::from_millis(1));
        host.app.advance(Duration::from_millis(1));
        host.app.render();
        let status = entry(&registry.entries(), "c.so").status.clone();
        (first, host.app.text(), toasts(&host), status)
    };
    let (first, bumped, toasted, status) = run("canvas");
    assert!(first.contains("drawn in C, 0 messages") && first.contains("C draw 1 of m"), "{first}");
    assert!(bumped.contains("drawn in C, 1 messages") && bumped.contains("C draw 2 of m"), "{bumped}");
    assert_eq!((toasted, status), (vec!["hello from C".to_owned(), "send answered 0".to_owned()], Status::Active));
    let (_, kept, _, status) = run("canvas,draw-keep");
    assert!(kept.contains("drawn in C, 1 messages") && kept.contains("C draw 1 of m"), "{kept}");
    assert_eq!(status, Status::Active);
    let (first, _, toasted, status) = run("canvas,draw-toast");
    assert!(first.contains("C draw 1 of m, toast refused"), "{first}");
    assert_eq!((toasted, status), (vec!["hello from C".to_owned(), "send answered 0".to_owned()], Status::Active));
}

#[test]
fn a_library_macos_refuses_says_why() {
    let source = Path::new("/Users/u/plugins/x/plugin.dylib");
    let team = "dlopen(/Users/u/plugins/x/plugin.dylib, 0x0005): code signature in <ABC> '/Users/u/plugins/x/plugin.dylib' \
                not valid for use in process: mapping process and mapped file (non-platform) have different Team IDs";
    let policy = "dlopen(/Users/u/plugins/x/plugin.dylib, 0x0005): code signature in <ABC> \
                  '/Users/u/plugins/x/plugin.dylib' not valid for use in process: library load disallowed by system policy";
    let missing = "dlopen(/Users/u/plugins/x/plugin.dylib, 0x0005): Library not loaded: @rpath/libdep.dylib";
    let rows: [(&str, bool, &[&str], &[&str]); 5] = [
        (team, false, &["library validation", "built from source"], &["xattr", "codesign"]),
        (team, true, &["library validation"], &["xattr", "codesign"]),
        (
            policy,
            true,
            &["quarantine of a download", "xattr -d com.apple.quarantine '/Users/u/plugins/x/plugin.dylib'"],
            &["codesign", "library validation"],
        ),
        (
            policy,
            false,
            &["missing or invalid", "codesign --force --sign - '/Users/u/plugins/x/plugin.dylib'"],
            &["xattr", "library validation"],
        ),
        (missing, true, &[], &["xattr", "codesign", "library validation"]),
    ];
    for (error, quarantined, has, lacks) in rows {
        let explained = explain_refusal(error, true, quarantined, Some(source));
        assert!(explained.starts_with(&format!("cannot load the library: {error}")), "{explained}");
        assert!(has.iter().all(|needle| explained.contains(needle)), "{quarantined} {explained}");
        assert!(lacks.iter().all(|needle| !explained.contains(needle)), "{quarantined} {explained}");
        assert_eq!(
            explain_refusal(error, false, quarantined, Some(source)),
            format!("cannot load the library: {error}")
        );
    }
    assert_eq!(explain_refusal(missing, true, false, Some(source)), format!("cannot load the library: {missing}"));
    // Each of the words alone is enough.
    let alone = [
        ("mapping process and mapped file have different Team IDs", "library validation"),
        ("'x' is a platform binary", "library validation"),
        ("library load disallowed by system policy", "ad hoc"),
        ("code signature in <ABC> 'x' is invalid", "ad hoc"),
        ("not valid for use in process", "ad hoc"),
    ];
    for (error, advice) in alone {
        assert!(explain_refusal(error, true, false, None).contains(advice), "{error}");
    }
}

#[test]
fn the_host_table_states_its_version_and_features() {
    let table = host_table(std::ptr::null_mut());
    assert_eq!((table.major, table.minor, table.size), (2, HOST_MINOR, size_of::<HostApi>()));
    assert!(table.send.is_some() && table.report.is_some() && table.stopped.is_some());
    // SAFETY: the table's features are the host's static list.
    let features: Vec<String> = serde_json::from_slice(unsafe { table.features.as_slice() }).unwrap();
    assert_eq!(features, abi::FEATURES);
}

#[test]
fn a_refused_library_is_named_by_its_file_and_old_copies_are_swept() {
    let dir = opencode_util::temp::tempdir().unwrap();
    let source = dir.path().join("plugin.so");
    std::fs::write(&source, b"not a library").unwrap();
    let error = Library::open(b"not a library", Some((&source, None))).err().unwrap();
    assert!(error.contains(&*source.to_string_lossy()), "{error}");
    // The source's own directory is a temporary one too; the copy's is not named.
    assert_eq!(error.matches(".tmp-").count(), 1, "{error}");

    let base = dir.path().join("opencode-plugins");
    let (old, new) = (base.join("old"), base.join("new"));
    for made in [&old, &new] {
        std::fs::create_dir_all(made).unwrap();
        std::fs::write(made.join("plugin.dll"), b"").unwrap();
    }
    let past = std::time::SystemTime::now() - Duration::from_secs(3600);
    // Windows opens a directory only with backup semantics, and changes its times only with write-attributes access.
    let mut options = std::fs::OpenOptions::new();
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.access_mode(0x100).custom_flags(0x0200_0000);
    }
    #[cfg(not(windows))]
    options.read(true);
    options.open(&old).unwrap().set_modified(past).unwrap();
    sweep(&base, Duration::from_secs(600));
    assert!(!old.exists() && new.exists());
}

#[test]
fn a_refused_manifest_leaves_no_effect() {
    unsafe extern "C" fn describe(out: *mut Owned) -> i32 {
        // SAFETY: the loader passes what `PluginApi::describe` documents.
        unsafe { abi::runtime::describe("other", "0.1.0", &[], out) }
    }
    let host = host();
    host.storage.borrow_mut().insert("plugin.other.k".to_owned(), "{\"kept\":true}".to_owned());
    let before = host.storage.borrow().clone();
    LEAK_AT.set(("setup", false));
    let api = sdk_table(abi::export_plugin!(@loopback_create "panicky", panicky), describe);
    let (definition, error) = define(Library::from_table(&api).unwrap(), None).unwrap();
    let registry = Registry::define(Vec::new(), []);
    registry.load(&dynamic(&host), definition.external("other.so", error));
    host.app.advance(Duration::from_millis(1));
    LEAK_AT.set(("", false));
    let status = entry(&registry.entries(), "other.so").status.clone();
    assert_eq!(status, Status::Failed("setup returned plugin ID panicky, not other".to_owned()));
    assert!(host.toasts.borrow().iter().all(|toast| toast.title.is_some()), "{:?}", host.toasts.borrow());
    assert_eq!(*host.storage.borrow(), before);
    assert!(host.attention.borrow().is_empty() && host.routes.borrow().is_empty() && host.fetches.borrow().is_empty());
}

#[test]
fn a_buffer_the_plugin_cannot_have_written_is_refused_unread() {
    static FREED: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    unsafe extern "C" fn counted(_: Owned) {
        FREED.fetch_add(1, Ordering::SeqCst);
    }
    let mut bytes = *b"abc";
    let ptr = bytes.as_mut_ptr();
    let rows: [(Owned, Result<&[u8], &str>); 5] = [
        (Owned { ptr: std::ptr::null_mut(), len: 0, cap: 0 }, Ok(b"")),
        (Owned { ptr: std::ptr::null_mut(), len: 5, cap: 5 }, Err("a null buffer of 5 bytes")),
        (Owned { ptr, len: 4, cap: 3 }, Err("a buffer of 4 bytes in 3 of room")),
        (Owned { ptr, len: abi::MAX_BUFFER + 1, cap: usize::MAX }, Err("over")),
        (Owned { ptr, len: 3, cap: 3 }, Ok(b"abc")),
    ];
    for (index, (out, expected)) in rows.into_iter().enumerate() {
        // SAFETY: the valid rows describe `bytes`; the others are refused before they are read, as the test checks.
        let got = unsafe { received(out, counted) };
        match expected {
            Ok(expected) => assert_eq!(got.unwrap(), expected),
            Err(needle) => assert!(got.as_ref().unwrap_err().contains(needle), "{got:?}"),
        }
        assert_eq!(FREED.load(Ordering::SeqCst), index + 1, "row {index} was not freed once");
    }
}

thread_local! {
    /// How the C-style setup below answers: 0 its manifest, 1 an error, 2 an error in a buffer it cannot have
    /// written, 3 a panic.
    static SETUP_ANSWER: Cell<u8> = const { Cell::new(0) };
    static SETUP_CREATES: Cell<u32> = const { Cell::new(0) };
    static SETUP_FREED: Cell<u32> = const { Cell::new(0) };
    /// What the C-style `describe` answers.
    static DESCRIBED: Cell<&'static str> = const { Cell::new("") };
}

/// A setup written in C: it asks for a toast, then answers as [`SETUP_ANSWER`] says.
unsafe extern "C" fn c_create(host: *const HostApi, _: Bytes, instance: *mut *mut c_void, out: *mut Owned) -> i32 {
    SETUP_CREATES.set(SETUP_CREATES.get() + 1);
    Table(host).call(r#"{"type":"toast","variant":"info","message":"from setup"}"#);
    let manifest = r#"{"id":"c","commands":[],"fences":[],"slots":[],"routes":[],"storage":[]}"#;
    // SAFETY: the loader passes valid pointers; the instance pointer is never read.
    unsafe {
        let (status, written) = match SETUP_ANSWER.get() {
            0 => {
                *instance = std::ptr::NonNull::<u8>::dangling().as_ptr().cast();
                (abi::OK, Owned::from_vec(manifest.as_bytes().to_vec()))
            }
            1 => (abi::ERROR, Owned::from_vec(b"no".to_vec())),
            2 => (abi::ERROR, Owned { ptr: std::ptr::null_mut(), len: 5, cap: 5 }),
            _ => (abi::PANIC, Owned::from_vec(b"boom".to_vec())),
        };
        *out = written;
        status
    }
}

unsafe extern "C" fn c_describe(out: *mut Owned) -> i32 {
    // SAFETY: `out` is valid for writes.
    unsafe { *out = Owned::from_vec(DESCRIBED.get().as_bytes().to_vec()) };
    abi::OK
}

unsafe extern "C" fn c_call(_: *mut c_void, _: Bytes, out: *mut Owned) -> i32 {
    // SAFETY: `out` is valid for writes.
    unsafe { *out = Owned::from_vec(b"null".to_vec()) };
    abi::OK
}

unsafe extern "C" fn c_free(owned: Owned) {
    SETUP_FREED.set(SETUP_FREED.get() + 1);
    // SAFETY: what the C-style plugin wrote, or a null pointer.
    unsafe { owned.release() };
}

fn c_table(describe: bool) -> PluginApi {
    PluginApi {
        size: size_of::<PluginApi>(),
        major: ABI_MAJOR,
        minor: ABI_MINOR,
        requires_minor: 0,
        create: Some(c_create),
        call: Some(c_call),
        destroy: None,
        free: Some(c_free),
        describe: describe.then_some(c_describe as unsafe extern "C" fn(*mut Owned) -> i32),
    }
}

#[test]
fn a_2x_library_names_its_id_before_any_setup() {
    let host = host();
    for (describe, described, refusal) in [
        (false, "", Some("null `describe`")),
        (
            true,
            r#"{"version":"1"}"#,
            Some("names no ID in `describe`: a plugin describes itself with a nonempty \"id\""),
        ),
        (true, r#"{"id":""}"#, Some("names no ID in `describe`")),
        (true, r#"{"id":"c"}"#, None),
    ] {
        let case = format!("describe {describe} {described}");
        SETUP_ANSWER.set(0);
        SETUP_CREATES.set(0);
        DESCRIBED.set(described);
        let defined = from_api(&dynamic(&host), &c_table(describe), None);
        match refusal {
            Some(needle) => {
                let error = defined.err().unwrap_or_else(|| panic!("{case}: not refused"));
                assert!(error.contains(needle), "{case}: {error}");
            }
            None => assert_eq!(defined.map(|(definition, _)| definition.id), Ok("c".to_owned()), "{case}"),
        }
        assert_eq!(SETUP_CREATES.get(), 0, "{case}: setup ran");
    }
}

#[test]
fn a_setup_whose_error_the_host_refuses_leaves_no_effect() {
    for (answer, shown, failure) in [
        (1, true, "no"),
        (2, false, "setup returned a bad result: a null buffer of 5 bytes"),
        (3, false, "setup panicked: boom"),
    ] {
        let host = host();
        SETUP_ANSWER.set(answer);
        DESCRIBED.set(r#"{"id":"c"}"#);
        let (definition, error) = from_api(&dynamic(&host), &c_table(true), None).unwrap();
        SETUP_FREED.set(0);
        let registry = Registry::define(Vec::new(), []);
        registry.load(&dynamic(&host), definition.external("c.so", error));
        host.app.advance(Duration::from_millis(1));
        let messages: Vec<String> = host.toasts.borrow().iter().map(|toast| toast.message.clone()).collect();
        assert_eq!(messages.iter().any(|message| message == "from setup"), shown, "answer {answer}: {messages:?}");
        assert_eq!(entry(&registry.entries(), "c.so").status, Status::Failed(failure.to_owned()), "answer {answer}");
        assert_eq!(SETUP_FREED.get(), 1, "answer {answer}: not freed once");
    }
}

#[test]
fn the_host_states_the_bounds_of_the_images_it_decodes() {
    let table = host_table(std::ptr::null_mut());
    // SAFETY: the host's static list.
    let features: Vec<String> = serde_json::from_slice(unsafe { table.features.as_slice() }).unwrap();
    assert_eq!(features, [abi::IMAGE_BOUNDS, abi::FOCUS_INPUT, abi::FENCE_NODE]);
    let host = host();
    let mut ctx = Ctx::new(Rc::downgrade(&dynamic(&host)), "bounded", Vec::new());
    let limits = crate::limits::get();
    assert_eq!(
        handle(&mut ctx, HostRequest::ImageBounds),
        Ok(serde_json::json!({ "bytes": limits.image_bytes, "side": limits.image_side }))
    );
}

#[test]
fn a_draw_is_held_to_every_buffer_s_rules_before_the_list_s() {
    thread_local! {
        static FREED: RefCell<Vec<(usize, usize, usize)>> = const { RefCell::new(Vec::new()) };
    }
    unsafe extern "C" fn counted(owned: Owned) {
        FREED.with(|freed| freed.borrow_mut().push((owned.ptr as usize, owned.len, owned.cap)));
    }
    let past = abi::canvas::MAX_BYTES + 10;
    let mut text = vec![b'e'; past];
    let mut list = [abi::canvas::VERSION];
    let (text_ptr, list_ptr) = (text.as_mut_ptr(), list.as_mut_ptr());
    let rows: [(_, _, Result<usize, &str>, _); 6] = [
        (abi::OK, Owned { ptr: list_ptr, len: abi::MAX_BUFFER + 1, cap: abi::MAX_BUFFER + 1 }, Err("over"), None),
        (abi::OK, Owned { ptr: list_ptr, len: past, cap: past }, Ok(0), Some(past)),
        (abi::ERROR, Owned { ptr: text_ptr, len: past, cap: past }, Ok(past), None),
        (abi::PANIC, Owned { ptr: text_ptr, len: past, cap: past }, Ok(past), None),
        (abi::ERROR, Owned { ptr: list_ptr, len: abi::MAX_BUFFER + 1, cap: abi::MAX_BUFFER + 1 }, Err("over"), None),
        (abi::OK, Owned { ptr: std::ptr::null_mut(), len: past, cap: past }, Err("a null buffer"), None),
    ];
    for (index, (status, out, expected, over)) in rows.into_iter().enumerate() {
        let descriptor = (out.ptr as usize, out.len, out.cap);
        FREED.with(|freed| freed.borrow_mut().clear());
        OVER_LIST.set(None);
        // SAFETY: the rows past 256 MiB and the null one are refused before they are read; the list rows read only the
        // first byte, and the text rows `text`'s bytes.
        let got = unsafe { received_list(out, counted, status) };
        match expected {
            Ok(len) => assert_eq!(got.as_ref().map(Vec::len), Ok(len), "row {index}"),
            Err(needle) => assert!(got.as_ref().is_err_and(|error| error.contains(needle)), "row {index}: {got:?}"),
        }
        if expected == Ok(past) {
            assert!(got.unwrap().iter().all(|byte| *byte == b'e'), "row {index}: the text changed");
        }
        assert_eq!(OVER_LIST.take(), over, "row {index}");
        assert_eq!(FREED.with(|freed| freed.borrow().clone()), [descriptor], "row {index} was not freed once");
    }
}

#[test]
fn the_host_refuses_borrowed_bytes_a_plugin_cannot_have_lent() {
    let bytes = *b"{}";
    let bad = [
        (Bytes { ptr: std::ptr::null(), len: 3 }, "a null buffer of 3 bytes"),
        (Bytes { ptr: bytes.as_ptr(), len: abi::MAX_BUFFER + 1 }, "over"),
    ];
    for (borrowed, needle) in bad {
        let mut out = Owned::EMPTY;
        // SAFETY: refused before anything is read, as the test checks; `out` is valid for writes.
        let status = unsafe { host_call(std::ptr::null_mut(), borrowed, &mut out) };
        // SAFETY: `host_call` answered with its own error text in `out`, `len` readable bytes.
        let text = String::from_utf8(unsafe { out.to_vec() }).unwrap();
        // SAFETY: `out` is the host's own buffer, freed once here.
        unsafe { host_free(out) };
        assert_eq!(status, abi::ERROR);
        assert!(text.contains("a bad host request") && text.contains(needle), "{text}");
        // Without a mailbox an intact send is `CLOSED`: the refusal comes first.
        // SAFETY: a null `ctx` is no mailbox; the bad descriptor is refused unread and the empty one reads nothing.
        assert_eq!(unsafe { host_send(std::ptr::null_mut(), Bytes::new(b""), borrowed) }, abi::ERROR);
        // SAFETY: a null `ctx` is no mailbox; the bad descriptor is refused unread and `{}` outlives the call.
        assert_eq!(unsafe { host_send(std::ptr::null_mut(), borrowed, Bytes::new(b"{}")) }, abi::ERROR);
        // SAFETY: a null `ctx` is no mailbox, and the bad descriptor is refused unread.
        unsafe { host_report(std::ptr::null_mut(), borrowed) };
    }
    // SAFETY: a null `ctx` is no mailbox, and both descriptors borrow literals that outlive the call.
    assert_eq!(unsafe { host_send(std::ptr::null_mut(), Bytes::new(b""), Bytes::new(b"{}")) }, abi::CLOSED);
    let mut owned = Owned::from_vec(b"abc".to_vec());
    owned.len = usize::MAX;
    // SAFETY: `ptr` and `cap` are the host's own.
    unsafe { host_free(owned) };
}

/// The C plugin's claim of the call `call_1` as it starts, mounted on `host` and shown: whether it draws, and the
/// screen; `None` when the plugin claims no `c` calls.
#[cfg(unix)]
fn c_claim(host: &Rc<TestHost>, registry: &Registry) -> Option<(bool, String)> {
    let claim = registry.tool_claims().find("c")?;
    let mount = claim.mount(host.app(), "call_1", 40);
    let tool = serde_json::from_value(serde_json::json!({
        "type": "tool", "id": "call_1", "name": "c", "state": { "status": "streaming", "input": "" },
        "time": { "created": 1 },
    }))
    .unwrap();
    let part = abi::claim::Part::Tool(Box::new(abi::claim::ToolPart {
        session: "ses_1".into(),
        message: "msg_1".into(),
        state: abi::claim::State::Pending,
        permission: false,
        tool,
    }));
    let shows = mount.show(part);
    host.app().root().clear();
    host.app().root().add(mount.root());
    host.app.render();
    Some((shows, host.app.text()))
}

#[cfg(unix)]
#[test]
fn a_claim_in_a_c_library_draws_and_keeps_to_the_header() {
    let Some(library) = cc("examples/c/plugin.c", &[]) else { return };
    let (host, registry) = c_active(&library, "");
    let (shows, screen) = c_claim(&host, &registry).unwrap();
    assert!(shows && screen.contains("claimed in C"), "{screen}");

    let (host, registry) = c_active(&library, "claim-toast");
    let (_, screen) = c_claim(&host, &registry).unwrap();
    host.app.advance(Duration::from_millis(1));
    assert!(screen.contains("claimed in C, toast refused"), "{screen}");
    assert!(toasts(&host).is_empty(), "a claim's toast showed");

    for (options, error) in [("claim-memo", "a memo table of 7 values"), ("claim-handle", "content handles")] {
        let (host, registry) = c_active(&library, options);
        let (shows, _) = c_claim(&host, &registry).unwrap();
        let status = entry(&registry.entries(), "c.so").status.clone();
        assert!(!shows && matches!(&status, Status::Failed(failed) if failed.contains(error)), "{options}: {status:?}");
        drop(host);
    }
}
