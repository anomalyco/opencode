//! The conformance suite's own tests: the transcripts recorded again from the reference (`drift`), replayed on the
//! host's side, on the library's side against the reference built as a `cdylib` and against the same plugin in C, each
//! also as a later minor of the other; every change of a transcript caught by one side; the version gate; and the
//! protocol machine's rows.
//!
//! `CONFORMANCE_WRITE=1` writes `conformance/transcripts.jsonl` and `conformance/versions.jsonl` again, from
//! `scripts.json` and the version grid here; nothing else writes them.

use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::mem::size_of;
use std::path::Path;
use std::process::Command;
use std::rc::Rc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use opencode_plugin_abi::{ABI_MAJOR, ABI_MINOR, Bytes, HostApi, Owned, PluginApi, V1_MINOR};
use opencode_ui::theme::ThemeMode;
use opentui::prelude::Container;
use serde_json::{Value, json};

use super::*;
use crate::loader::Backend;
use crate::loader::native::{self, Native};
use crate::loader::tests::{TestHost, dynamic, host};
use crate::{Host, Registry, RouteMount};

#[path = "../../examples/conformance/src/conformance.rs"]
mod reference;

const ID: &str = "conformance";
const TARGET: &str = "conformance.so";

fn root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

fn writing() -> bool {
    std::env::var_os("CONFORMANCE_WRITE").is_some_and(|value| value == "1")
}

// The reference, linked.

unsafe extern "C" fn reference_describe(out: *mut Owned) -> i32 {
    // SAFETY: the host passes what `PluginApi::describe` documents.
    unsafe { abi::runtime::describe(ID, "1.0.0", &[], out) }
}

/// The reference's table through the SDK's byte shims, as a library of `major` exports it: 2.0, or 1.x as
/// `export_plugin!(.., requires_minor = 4)` does.
fn reference(major: u32) -> PluginApi {
    PluginApi {
        size: size_of::<PluginApi>(),
        major,
        minor: if major >= 2 { ABI_MINOR } else { V1_MINOR },
        requires_minor: if major >= 2 { 0 } else { 4 },
        create: Some(abi::export_plugin!(@loopback "conformance", reference::setup)),
        call: Some(abi::runtime::call),
        destroy: Some(abi::runtime::destroy),
        free: Some(abi::runtime::free),
        describe: Some(reference_describe),
    }
}

// The libraries.

/// The reference built as a `cdylib`, as ABI 2.0 or with `v1`; built once per test run.
fn rust_library(major: u32) -> Vec<u8> {
    static BUILT: Mutex<Vec<(u32, Vec<u8>)>> = Mutex::new(Vec::new());
    let mut built = BUILT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((_, library)) = built.iter().find(|(known, _)| *known == major) {
        return library.clone();
    }
    let target = root().join(format!("../../target/conformance-plugin-v{major}"));
    let status = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned()))
        .args(["build", "--quiet", "--manifest-path"])
        .arg(root().join("examples/conformance/Cargo.toml"))
        .arg("--target-dir")
        .arg(&target)
        .args(if major >= 2 { &[][..] } else { &["--features", "v1"][..] })
        .status()
        .unwrap();
    assert!(status.success(), "the conformance plugin did not build");
    let name = format!("{}opencode_conformance{}", std::env::consts::DLL_PREFIX, std::env::consts::DLL_SUFFIX);
    let library = std::fs::read(target.join("debug").join(name)).unwrap();
    built.push((major, library.clone()));
    library
}

/// `examples/conformance/plugin.c` built as ABI 2.0 or 1.x, with symbols hidden and every warning an error; `None`
/// without a C compiler, unless `OPENCODE_RS_REQUIRE_CC` asks for one.
#[cfg(unix)]
fn c_library(major: u32) -> Option<Vec<u8>> {
    let dir = opencode_util::temp::tempdir().unwrap();
    let library = dir.path().join("plugin.so");
    let built = Command::new(std::env::var("CC").unwrap_or_else(|_| "cc".to_owned()))
        .args(["-shared", "-fPIC", "-fvisibility=hidden", "-std=c11", "-Wall", "-Wextra", "-Werror", "-pedantic"])
        .args((major < 2).then_some("-DCONFORMANCE_V1"))
        .arg("-I")
        .arg(root().join("../plugin-abi/include"))
        .arg("-o")
        .arg(&library)
        .arg(root().join("examples/conformance/plugin.c"))
        .status();
    let Ok(status) = built else {
        assert!(std::env::var_os("OPENCODE_RS_REQUIRE_CC").is_none(), "OPENCODE_RS_REQUIRE_CC is set, but no cc");
        eprintln!("skipped: no C compiler");
        return None;
    };
    assert!(status.success(), "the C conformance plugin did not build as {major}.x");
    Some(std::fs::read(library).unwrap())
}

/// The table a library's bytes export, from a copy of its own that stays loaded.
fn table(library: &[u8]) -> (*const PluginApi, u32) {
    let dir = opencode_util::temp::tempdir().unwrap();
    let file = dir.path().join(format!("plugin.{}", std::env::consts::DLL_EXTENSION));
    std::fs::write(&file, library).unwrap();
    // SAFETY: a test plugin of this repository.
    let opened = unsafe { opencode_util::dl::Library::open(&file) }.unwrap();
    // SAFETY: both entries have type `EntryFn`.
    let (entry, major) = unsafe { opened.symbol::<abi::EntryFn>(abi::ENTRY) }
        .map(|entry| (entry, 2))
        .or_else(|_| unsafe { opened.symbol::<abi::EntryFn>(abi::ENTRY_V1) }.map(|entry| (entry, 1)))
        .unwrap();
    opened.leak();
    std::mem::forget(dir);
    // SAFETY: the table lives as long as the library.
    (unsafe { entry() }, major)
}

// The script, run by the host.

/// What answers the host's calls in a run of a script.
enum Load<'a> {
    /// The reference, linked, through the SDK's byte shims.
    Reference,
    /// A library's bytes, loaded as the host loads one.
    Library(&'a [u8]),
    /// The plugin that answers from a transcript: the host side of the suite.
    Player(&'a Transcript, bool),
}

thread_local! {
    /// The clock the monitor of a run reads.
    static NOW: Cell<Duration> = const { Cell::new(Duration::ZERO) };
}

/// Runs `header`'s script on a fresh host with the plugin `load` gives, and returns what crossed and what showed.
fn run(header: &Header, load: &Load<'_>) -> Vec<Entry> {
    let host = host();
    let registry = Rc::new(Registry::define(Vec::new(), []));
    *host.registry.borrow_mut() = Rc::downgrade(&registry);
    let base = Instant::now();
    registry.monitor().set_clock(move || base + NOW.get());
    let recorder = Rc::new(RefCell::new(Recorder::default()));
    let took = Rc::new(Cell::new(0));
    let (recording, taking) = (recorder.clone(), took.clone());
    watch(
        move |event| {
            // A step's `took` passes on the clock inside the call it runs.
            if matches!(event, Event::Call { .. }) {
                NOW.set(NOW.get() + Duration::from_millis(taking.replace(0)));
            }
            recording.borrow_mut().event(event);
        },
        || {
            let mut route: Option<RouteMount> = None;
            for step in &header.script {
                match step {
                    Step::Load { options } => {
                        let options = (!options.is_empty()).then_some(options.as_str());
                        let loaded = load_plugin(&host, header.library, load, options);
                        match loaded {
                            Ok((definition, error)) => {
                                registry.load(&dynamic(&host), definition.external(TARGET, error));
                            }
                            Err(error) => recorder.borrow_mut().observe(json!({ "refused": error })),
                        }
                    }
                    Step::Command { name, took: ms } => {
                        took.set(*ms);
                        host.keymap().dispatch(name, None);
                        took.set(0);
                    }
                    Step::Open { route: name } => {
                        host.app().root().clear();
                        route = registry.route(&*host, ID, name);
                        if let Some(route) = &route {
                            host.app().root().add(&route.root());
                        }
                        host.app.advance(Duration::from_millis(1));
                        host.app.render();
                    }
                    Step::Close => {
                        host.app().root().clear();
                        route = None;
                    }
                    Step::Advance => host.app.advance(Duration::from_millis(1)),
                    Step::Disable | Step::Enable => {
                        registry.toggle(&dynamic(&host), ID, matches!(step, Step::Enable));
                    }
                    Step::Mode { light } => host.mode.set(if *light { ThemeMode::Light } else { ThemeMode::Dark }),
                    Step::Observe => {
                        let seen = observe(&host, &registry, route.is_some());
                        recorder.borrow_mut().observe(seen);
                    }
                }
            }
            drop(route);
            registry.deactivate_all();
        },
    );
    NOW.set(Duration::ZERO);
    Rc::try_unwrap(recorder).map(RefCell::into_inner).unwrap_or_default().into_entries()
}

fn load_plugin(
    host: &Rc<TestHost>,
    major: u32,
    load: &Load<'_>,
    options: Option<&str>,
) -> Result<(crate::Definition, crate::ErrorFn), String> {
    match load {
        Load::Reference => native::from_api(&dynamic(host), &reference(major), major, options),
        Load::Library(bytes) => Native.load(&dynamic(host), bytes, Path::new("plugin.so"), options),
        Load::Player(transcript, future) => {
            let (api, entry) = player::start(transcript, *future);
            native::from_api(&dynamic(host), api, entry, options)
        }
    }
}

/// What the user sees: the toasts since the last look, the plugin's status in the plugin manager, and the route's
/// lines while one shows.
fn observe(host: &TestHost, registry: &Registry, route: bool) -> Value {
    let toasts: Vec<String> = host
        .toasts
        .borrow_mut()
        .drain(..)
        .map(|toast| format!("{:?}: {}", toast.variant, toast.title.unwrap_or(toast.message)))
        .collect();
    let status = registry.entries().into_iter().find(|entry| entry.target.as_deref() == Some(TARGET));
    let mut seen = json!({ "toasts": toasts, "status": format!("{:?}", status.map(|entry| entry.status)) });
    if route {
        host.app.render();
        let text = host.app.text();
        let lines: Vec<&str> = text.lines().map(str::trim_end).filter(|line| !line.is_empty()).collect();
        seen["screen"] = json!(lines);
    }
    seen
}

/// Records every script from the reference.
fn record() -> Vec<Transcript> {
    scripts()
        .unwrap()
        .into_iter()
        .map(|header| {
            let entries = run(&header, &Load::Reference);
            Transcript { header, entries }
        })
        .collect()
}

// Expected (`drift`): the transcripts are what the reference records now from their scripts, one for each script, so a
// change of the host or the SDK that changes what crosses the C ABI, or what the user sees, changes a transcript; and
// one written by hand fails. `CONFORMANCE_WRITE=1` writes them again.
#[test]
fn the_transcripts_are_what_the_reference_records() {
    let recorded = record();
    if writing() {
        std::fs::write(root().join("conformance/transcripts.jsonl"), write(&recorded)).unwrap();
        return;
    }
    let golden = golden().unwrap();
    let names = |transcripts: &[Transcript]| -> Vec<String> {
        transcripts.iter().map(|transcript| transcript.header.transcript.clone()).collect()
    };
    assert_eq!(names(&golden), names(&recorded), "run with CONFORMANCE_WRITE=1 after changing scripts.json");
    for (golden, recorded) in golden.iter().zip(&recorded) {
        assert_eq!(golden.header, recorded.header, "run with CONFORMANCE_WRITE=1 after changing scripts.json");
        if let Some(diff) = diff(&golden.entries, &recorded.entries) {
            panic!(
                "{}: the reference no longer records the transcript (CONFORMANCE_WRITE=1 writes it again):\n{diff}",
                golden.header.transcript
            );
        }
    }
}

// Expected: the golden file is what `write` writes, so a reader and the writer agree on its format.
#[test]
fn the_transcripts_read_back_as_written() {
    let golden = golden().unwrap();
    assert!(!golden.is_empty());
    assert_eq!(write(&golden), TRANSCRIPTS);
}

/// The transcript as the host must record it when the plugin is of a later minor: its table says minor 1, and its
/// requests to the host that no host knows are left out (the player checks their answer).
fn as_future(transcript: &Transcript) -> Vec<Entry> {
    transcript
        .entries
        .iter()
        .map(|entry| match entry {
            Entry::Open { entry, major, minor, requires_minor, served } => Entry::Open {
                entry: *entry,
                major: *major,
                minor: minor + 1,
                requires_minor: *requires_minor,
                served: *served,
            },
            other => other.clone(),
        })
        .collect()
}

/// `recorded` without the requests of [`player`] that no host knows.
fn known(recorded: Vec<Entry>) -> Vec<Entry> {
    recorded
        .into_iter()
        .filter(
            |entry| !matches!(entry, Entry::Host { request, .. } if request.get("type") == Some(&json!(FUTURE_KIND))),
        )
        .collect()
}

/// The `type` of [`player::FUTURE_HOST_REQUEST`].
const FUTURE_KIND: &str = "x-future-host-request";

/// The host side: the script against the plugin that answers from `transcript`, which must record the transcript.
fn host_side(transcript: &Transcript, future: bool) -> Result<(), String> {
    let recorded = known(run(&transcript.header, &Load::Player(transcript, future)));
    let failure = player::finish();
    let expected = if future { as_future(transcript) } else { transcript.entries.clone() };
    match (diff(&expected, &recorded), failure) {
        (None, None) => Ok(()),
        (diff, failure) => Err(format!("{}\n{}", diff.unwrap_or_default(), failure.unwrap_or_default())),
    }
}

// Expected: the host, given the transcript's answers, sends what the transcript has and shows what it has, also when
// the library is of a later minor: its table is longer and says minor 1, every object it sends carries a field the
// host does not know, and inside each call it asks the host something no host knows, which is answered ERROR and
// changes nothing.
#[test]
fn the_host_replays_every_transcript() {
    for transcript in golden().unwrap() {
        for future in [false, true].into_iter().filter(|future| !future || transcript.header.library >= 2) {
            if let Err(error) = host_side(&transcript, future) {
                panic!("{} (a later library: {future}): {error}", transcript.header.transcript);
            }
        }
    }
}

/// The library side and the host side with a real library: the library replays each transcript of its major, also
/// against a host of a later minor, and the host with it records each.
fn both_sides(name: &str, library: &[u8], major: u32) {
    let (api, entry) = table(library);
    assert_eq!(entry, major, "{name}");
    for transcript in golden().unwrap().iter().filter(|transcript| transcript.header.library == major) {
        for future in [false, true].into_iter().filter(|future| !future || major >= 2) {
            // SAFETY: the library stays loaded.
            if let Err(error) = unsafe { replay(api, transcript, future) } {
                panic!("{name}, {} (a later host: {future}): {error}", transcript.header.transcript);
            }
        }
        let recorded = run(&transcript.header, &Load::Library(library));
        if let Some(diff) = diff(&transcript.entries, &recorded) {
            panic!("{name}, {} through the host: {diff}", transcript.header.transcript);
        }
    }
}

// Expected: the reference built as a `cdylib`, with its own std and allocator, answers and asks what every transcript
// of its major has, as ABI 2.0 and as 1.x, also against a host of a later minor; and the host loading it records each.
#[test]
fn the_reference_library_conforms() {
    for major in [2, 1] {
        both_sides(&format!("the Rust library {major}.x"), &rust_library(major), major);
    }
}

// Expected: the same plugin written in C against `opencode_plugin.h` alone, built with symbols hidden and every
// warning an error, conforms as the Rust library does: the header is proven by a C compiler, field by field.
#[cfg(unix)]
#[test]
fn the_c_library_conforms() {
    for major in [2, 1] {
        let Some(library) = c_library(major) else { return };
        both_sides(&format!("the C library {major}.x"), &library, major);
    }
}

// Expected: the linked reference replays on the library side too, so the side a mutant of a transcript's library half
// fails is checked without a build.
#[test]
fn the_linked_reference_replays_every_transcript() {
    for transcript in golden().unwrap() {
        let api = reference(transcript.header.library);
        for future in [false, true] {
            // SAFETY: the shims are this process's.
            if let Err(error) = unsafe { replay(&api, &transcript, future) } {
                panic!("{} (a later host: {future}): {error}", transcript.header.transcript);
            }
        }
    }
}

// Expected (unknown kinds, synthesis 4.6): a library of a later minor whose view holds a node kind this host does not
// know has the tree refused whole, the kind named in the failure, and nothing after it: the transcript holds as
// recorded up to that view's reply, the user then sees the plugin failed and no tree, and the host calls the library no
// more, not even to destroy it. (The SDK's lowering of a kind to its fallback comes with the first kind of 2.1.)
#[test]
fn a_kind_the_host_does_not_know_is_refused_whole() {
    let mut transcript =
        golden().unwrap().into_iter().find(|transcript| transcript.header.transcript == "surfaces").unwrap();
    let at = transcript
        .entries
        .iter()
        .position(|entry| matches!(entry, Entry::Return { reply, .. } if reply.get("node").is_some()))
        .unwrap();
    let Entry::Return { reply, .. } = &mut transcript.entries[at] else { unreachable!() };
    reply["node"]["children"][1] = json!({ "type": "x-future-kind", "id": "fixed" });
    let recorded = run(&transcript.header, &Load::Player(&transcript, false));
    player::finish();
    assert_eq!(recorded[..=at], transcript.entries[..=at]);
    let rest: Vec<&Entry> = recorded[at + 1..].iter().collect();
    let Some(Entry::Observe { seen }) = rest.first() else { panic!("{rest:?}") };
    let status = seen["status"].as_str().unwrap();
    assert!(status.contains("view returned a bad result") && status.contains("x-future-kind"), "{status}");
    assert_eq!(seen["screen"], json!([]));
    assert!(rest.iter().all(|entry| matches!(entry, Entry::Observe { .. })), "the host called on: {rest:?}");
}

// Expected: `stopped` and `report` are "any thread", so a library may call them on the UI thread inside a call, as a C
// plugin can (the SDK calls them only from its threads). The host answers `stopped` 0 while the plugin is active, and
// a report fails the plugin once, with the report's text, after the call; the transcript holds both crossings.
#[test]
fn a_library_may_ask_stopped_and_report_on_the_ui_thread() {
    let mut transcript =
        golden().unwrap().into_iter().find(|transcript| transcript.header.transcript == "actions").unwrap();
    let at = transcript.entries.iter().position(|entry| matches!(entry, Entry::Call { .. })).unwrap();
    transcript.entries.insert(at + 1, Entry::Stopped { answer: 0 });
    transcript.entries.insert(at + 2, Entry::Report { message: "a thread died".to_owned() });
    let recorded = run(&transcript.header, &Load::Player(&transcript, false));
    player::finish();
    assert_eq!(recorded[..at + 3], transcript.entries[..at + 3]);
    let seen = recorded.iter().find_map(|entry| match entry {
        Entry::Observe { seen } => Some(seen.clone()),
        _ => None,
    });
    let seen = seen.unwrap();
    assert!(seen["status"].as_str().unwrap().contains("a thread died"), "{seen}");
    assert_eq!(
        seen["toasts"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|toast| toast.as_str().unwrap().contains("Plugin failed"))
            .count(),
        1,
        "{seen}"
    );
}

unsafe extern "C" fn answers_ok(_: *mut c_void, _: Bytes, out: *mut Owned) -> i32 {
    // SAFETY: `out` is valid for writes.
    unsafe { *out = Owned::from_vec(b"null".to_vec()) };
    abi::OK
}

// Expected: on the library side a host of a later minor refuses a library that answers a request it cannot know with
// anything but ERROR; the reference answers ERROR.
#[test]
fn a_library_that_takes_an_unknown_request_fails_the_later_host() {
    let api = PluginApi { call: Some(answers_ok), ..reference(2) };
    // SAFETY: the shims are this process's.
    let (library, accepted) = unsafe { (Opened::new(&api).unwrap(), Opened::new(&reference(2)).unwrap()) };
    let instance = std::ptr::dangling_mut::<c_void>();
    let error = future_request(&library, instance).unwrap_err();
    assert!(error.contains("was answered 0, not ERROR"), "{error}");
    // The reference answers ERROR (with no instance here; with one, `the_linked_reference_replays_every_transcript`).
    assert_eq!(future_request(&accepted, std::ptr::null_mut()), Ok(()));
}

/// Which side of the C ABI writes a part of an entry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Side {
    Host,
    Library,
}

/// `value` with its first scalar changed, depth first; a value with none is replaced.
fn changed(value: &Value) -> Value {
    fn change(value: &mut Value) -> bool {
        match value {
            Value::Null => *value = json!(0),
            Value::Bool(flag) => *flag = !*flag,
            Value::Number(number) => *value = json!(number.as_u64().map_or(1, |number| number + 1)),
            Value::String(text) => text.push('~'),
            Value::Array(items) => return items.iter_mut().any(change),
            Value::Object(object) => return object.values_mut().any(change),
        }
        true
    }
    let mut value = value.clone();
    if !change(&mut value) {
        value = json!(true);
    }
    value
}

/// The changes of `entry` a side must notice, with the side that writes the part changed.
fn mutants(entry: &Entry) -> Vec<(Side, Option<Entry>)> {
    let entry = entry.clone();
    match entry {
        Entry::Open { entry, major, minor, requires_minor, served } => vec![
            (Side::Host, Some(Entry::Open { entry, major, minor, requires_minor, served: served + 1 })),
            (Side::Library, Some(Entry::Open { entry, major, minor: minor + 1, requires_minor, served })),
        ],
        Entry::Describe | Entry::Destroy | Entry::Destroyed => vec![(Side::Host, None)],
        Entry::Create { major, minor, features, options } => vec![
            (
                Side::Host,
                Some(Entry::Create { major, minor: minor + 1, features: features.clone(), options: options.clone() }),
            ),
            (Side::Host, Some(Entry::Create { major, minor, features, options: format!("{options}~") })),
        ],
        Entry::Call { request } => {
            vec![(Side::Host, Some(Entry::Call { request: changed(&request) })), (Side::Host, None)]
        }
        Entry::Return { status, reply } => vec![
            (Side::Library, Some(Entry::Return { status: status + 1, reply: reply.clone() })),
            (Side::Library, Some(Entry::Return { status, reply: changed(&reply) })),
        ],
        Entry::Host { request, status, reply } => vec![
            (Side::Library, Some(Entry::Host { request: changed(&request), status, reply: reply.clone() })),
            (Side::Host, Some(Entry::Host { request: request.clone(), status: status + 1, reply: reply.clone() })),
            (Side::Host, Some(Entry::Host { request, status, reply: changed(&reply) })),
        ],
        Entry::Send { key, message, status } => vec![
            (Side::Library, Some(Entry::Send { key: format!("{key}~"), message: message.clone(), status })),
            (Side::Host, Some(Entry::Send { key, message, status: status + 1 })),
        ],
        Entry::Wake => vec![(Side::Library, None)],
        Entry::Stopped { answer } => vec![(Side::Host, Some(Entry::Stopped { answer: answer ^ 1 }))],
        Entry::ThemeMode { answer } => vec![(Side::Host, Some(Entry::ThemeMode { answer: answer ^ 1 }))],
        Entry::Report { message } => vec![(Side::Library, Some(Entry::Report { message: format!("{message}~") }))],
        Entry::Observe { seen } => {
            vec![(Side::Host, Some(Entry::Observe { seen: changed(&seen) })), (Side::Host, None)]
        }
    }
}

// Expected: a transcript changed without a change of the host fails the side that writes what changed: for every entry
// of every transcript, each part the host writes changed (or the entry dropped) fails the host side, and each part
// the library writes changed fails the library side, against the linked reference. The unchanged transcripts pass
// both (the tests above).
#[test]
fn a_transcript_changed_without_the_host_fails() {
    let mut lived = Vec::new();
    for transcript in golden().unwrap() {
        let api = reference(transcript.header.library);
        for (at, entry) in transcript.entries.iter().enumerate() {
            for (side, mutant) in mutants(entry) {
                let mut changed = transcript.clone();
                match &mutant {
                    Some(mutant) => changed.entries[at] = mutant.clone(),
                    None => drop(changed.entries.remove(at)),
                }
                let failed = match side {
                    Side::Host => host_side(&changed, false).is_err(),
                    // SAFETY: the shims are this process's.
                    Side::Library => unsafe { replay(&api, &changed, false) }.is_err(),
                };
                if !failed {
                    lived.push(format!("{} entry {at} {side:?}: {mutant:?}", transcript.header.transcript));
                }
            }
        }
    }
    assert!(lived.is_empty(), "changes no side noticed:\n{}", lived.join("\n"));
}

// Expected: what the reference records keeps every rule of the C ABI's machine: the transcripts are themselves runs of
// the protocol, and its rules hold on both carriers' libraries (the model tests run under it too).
#[test]
fn every_transcript_keeps_the_protocol() {
    for header in scripts().unwrap() {
        let ((), broken) = checked(|| drop(run(&header, &Load::Reference)));
        assert_eq!(broken, None, "{}", header.transcript);
    }
}

/// The host side's plugin: it answers every call from a transcript, and makes the library's requests the transcript
/// has, through the host's own table.
mod player {
    use super::*;

    /// A request to the host that no host knows.
    pub const FUTURE_HOST_REQUEST: &str = r#"{"type":"x-future-host-request"}"#;

    struct Player {
        entries: Vec<Entry>,
        at: usize,
        future: bool,
        host: *const HostApi,
        /// The host's own counters, as the transcript's are relative ([`Normal`]).
        normal: Normal,
        failure: Option<String>,
    }

    thread_local! {
        static PLAYER: RefCell<Option<Player>> = const { RefCell::new(None) };
        /// The table of the running player, which the host reads once.
        static TABLE: RefCell<Option<Box<Later>>> = const { RefCell::new(None) };
    }

    /// The table of a later minor: 2.0's, then an entry 2.0 does not have.
    #[repr(C)]
    struct Later {
        api: PluginApi,
        later: Option<unsafe extern "C" fn()>,
    }

    /// Starts answering from `transcript`: the table the host takes, as its `Open` entry has it, and the entry it is
    /// found through. With `future` it is of a later minor.
    pub fn start(transcript: &Transcript, future: bool) -> (*const PluginApi, u32) {
        let entries = transcript.entries.clone();
        let (entry, major, minor, requires_minor) = entries
            .iter()
            .find_map(|entry| match entry {
                Entry::Open { entry, major, minor, requires_minor, .. } => {
                    Some((*entry, *major, *minor, *requires_minor))
                }
                _ => None,
            })
            .unwrap_or((ABI_MAJOR, ABI_MAJOR, ABI_MINOR, 0));
        let later = Box::new(Later {
            api: PluginApi {
                size: if future { size_of::<Later>() } else { size_of::<PluginApi>() },
                major,
                minor: if future { minor + 1 } else { minor },
                requires_minor,
                create: Some(create),
                call: Some(call),
                destroy: Some(destroy),
                free: Some(free),
                describe: Some(describe),
            },
            later: None,
        });
        let api: *const PluginApi = &later.api;
        TABLE.set(Some(later));
        let player =
            Player { entries, at: 0, future, host: std::ptr::null(), normal: Normal::default(), failure: None };
        PLAYER.set(Some(player));
        (api, entry)
    }

    /// Ends the player; what went wrong on its side, such as a request no host knows that was not refused.
    pub fn finish() -> Option<String> {
        TABLE.set(None);
        PLAYER.take().and_then(|player| player.failure)
    }

    fn with<R>(f: impl FnOnce(&mut Player) -> R) -> Option<R> {
        PLAYER.with_borrow_mut(|player| player.as_mut().map(f))
    }

    impl Player {
        fn fail(&mut self, failure: String) {
            self.failure.get_or_insert(format!("player at entry {}: {failure}", self.at));
        }

        /// The next entry that is the library's to answer: not what the user saw, nor the host's verdict on its table.
        fn next(&mut self) -> Option<Entry> {
            while let Some(entry) = self.entries.get(self.at) {
                self.at += 1;
                if !matches!(entry, Entry::Observe { .. } | Entry::Open { .. }) {
                    return Some(entry.clone());
                }
            }
            None
        }

        /// The next entry, when it is one the library makes inside a call.
        fn nested(&mut self) -> Option<Entry> {
            let entry = self.entries.get(self.at).filter(|entry| entry.nested()).cloned();
            if entry.is_some() {
                self.at += 1;
            }
            entry
        }
    }

    /// `value` with a field no host knows, when it is an object.
    fn later(value: &Value, future: bool) -> Value {
        let mut value = value.clone();
        if let (true, Value::Object(object)) = (future, &mut value) {
            object.insert(FUTURE_FIELD.to_owned(), Value::Bool(true));
        }
        value
    }

    /// Makes the library's requests of the transcript, up to its `Return` or `Destroyed`, which it returns.
    fn nested() -> Option<Entry> {
        loop {
            let (entry, host, future) = with(|player| (player.nested(), player.host, player.future))?;
            let Some(entry) = entry else {
                if future {
                    future_request(host);
                }
                return with(Player::next).flatten();
            };
            // SAFETY: the host's table, valid while the instance lives; every call is the host's UI thread's.
            unsafe {
                let api = &*host;
                match entry {
                    Entry::Host { request, .. } => {
                        let bytes = serde_json::to_vec(&later(&request, future)).unwrap_or_default();
                        let mut out = Owned::EMPTY;
                        (api.call?)(api.ctx, Bytes::new(&bytes), &mut out);
                        (api.free?)(out);
                    }
                    Entry::Send { key, message, .. } => {
                        let message = serde_json::to_vec(&message).unwrap_or_default();
                        (api.send?)(api.ctx, Bytes::new(key.as_bytes()), Bytes::new(&message));
                    }
                    Entry::Wake => (api.wake?)(api.ctx),
                    Entry::Stopped { .. } => {
                        let _ = (api.stopped?)(api.ctx);
                    }
                    Entry::ThemeMode { .. } => {
                        let _ = (api.theme_mode?)(api.ctx);
                    }
                    Entry::Report { message } => (api.report?)(api.ctx, Bytes::new(message.as_bytes())),
                    _ => {}
                }
            }
        }
    }

    /// [`FUTURE_HOST_REQUEST`] to the host, which must answer it `ERROR`.
    fn future_request(host: *const HostApi) {
        // SAFETY: as in `nested`.
        let status = unsafe {
            let api = &*host;
            let mut out = Owned::EMPTY;
            let status = api.call.map(|call| call(api.ctx, Bytes::new(FUTURE_HOST_REQUEST.as_bytes()), &mut out));
            if let Some(free) = api.free {
                free(out);
            }
            status
        };
        if status != Some(abi::ERROR) {
            with(|player| player.fail(format!("a request no host knows was answered {status:?}, not ERROR")));
        }
    }

    /// Writes the transcript's reply into `out`.
    fn answer(entry: Option<Entry>, kind: Kind, out: *mut Owned) -> i32 {
        let Some(Entry::Return { status, reply }) = entry else {
            with(|player| player.fail(format!("the host made a call where the transcript has {entry:?}")));
            // SAFETY: `out` is valid for writes.
            unsafe { *out = Owned::from_vec(b"not in the transcript".to_vec()) };
            return abi::ERROR;
        };
        let bytes = match (status, &reply) {
            (abi::OK, Value::Object(object)) if kind == Kind::Draw => {
                let hex = object.get("list").and_then(Value::as_str).unwrap_or_default();
                (0..hex.len() / 2).filter_map(|at| u8::from_str_radix(&hex[2 * at..2 * at + 2], 16).ok()).collect()
            }
            (abi::OK, reply) => {
                let mut reply = with(|player| later(reply, player.future)).unwrap_or_default();
                if kind == Kind::View {
                    with(|player| player.normal.reply(&mut reply, true));
                }
                match reply.get("bytes").and_then(Value::as_str) {
                    Some(text) => text.as_bytes().to_vec(),
                    None => serde_json::to_vec(&reply).unwrap_or_default(),
                }
            }
            (_, reply) => reply.as_str().unwrap_or_default().as_bytes().to_vec(),
        };
        // SAFETY: `out` is valid for writes.
        unsafe { *out = Owned::from_vec(bytes) };
        status
    }

    unsafe extern "C" fn describe(out: *mut Owned) -> i32 {
        let entry = with(Player::next).flatten();
        if entry != Some(Entry::Describe) {
            with(|player| player.fail(format!("the host called describe where the transcript has {entry:?}")));
        }
        answer(with(Player::next).flatten(), Kind::Describe, out)
    }

    unsafe extern "C" fn create(host: *const HostApi, _: Bytes, instance: *mut *mut c_void, out: *mut Owned) -> i32 {
        let entry = with(|player| {
            player.host = host;
            player.next()
        })
        .flatten();
        if !matches!(entry, Some(Entry::Create { .. })) {
            with(|player| player.fail(format!("the host called create where the transcript has {entry:?}")));
        }
        let status = answer(nested(), Kind::Manifest, out);
        if status == abi::OK {
            // SAFETY: `instance` is valid for writes; the player keeps no state of its own an instance names.
            unsafe { *instance = std::ptr::dangling_mut::<u8>().cast() };
        }
        status
    }

    unsafe extern "C" fn call(_: *mut c_void, request: Bytes, out: *mut Owned) -> i32 {
        // SAFETY: the host passes bytes valid for the call.
        let mut request: Value = serde_json::from_slice(unsafe { request.as_slice() }).unwrap_or_default();
        let kind = Kind::of(&request);
        let entry = with(|player| {
            player.normal.request(&mut request);
            player.next()
        })
        .flatten();
        if !matches!(entry, Some(Entry::Call { .. })) {
            with(|player| player.fail(format!("the host sent {request} where the transcript has {entry:?}")));
        }
        answer(nested(), kind, out)
    }

    unsafe extern "C" fn destroy(_: *mut c_void) {
        let entry = with(Player::next).flatten();
        if entry != Some(Entry::Destroy) {
            with(|player| player.fail(format!("the host called destroy where the transcript has {entry:?}")));
        }
        let end = nested();
        if end != Some(Entry::Destroyed) {
            with(|player| player.fail(format!("destroy ended at {end:?}")));
        }
    }

    unsafe extern "C" fn free(owned: Owned) {
        // SAFETY: made with `Owned::from_vec` above.
        drop(unsafe { owned.into_vec() });
    }
}

// The version gate.

/// A table of the version grid: the entry it is found through and its header, its size, and what its `describe`
/// answers.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
struct Row {
    entry: u32,
    major: u32,
    minor: u32,
    requires_minor: u32,
    /// `full`, `1.0` (the core alone, without `describe`), or `short` (shorter than the header).
    size: String,
    /// What `describe` answers: `null` for none, else the metadata's JSON or `"ERROR"`.
    describe: Value,
    /// What the host makes of it: `{"served": minor, "metadata": ..}` or `{"refused": why}`.
    verdict: Value,
}

thread_local! {
    static DESCRIBED: RefCell<Value> = const { RefCell::new(Value::Null) };
}

unsafe extern "C" fn grid_describe(out: *mut Owned) -> i32 {
    let answer = DESCRIBED.with_borrow(Value::clone);
    let (status, bytes) = match answer {
        Value::String(text) if text == "ERROR" => (abi::ERROR, b"no metadata".to_vec()),
        Value::String(text) => (abi::OK, text.into_bytes()),
        value => (abi::OK, serde_json::to_vec(&value).unwrap_or_default()),
    };
    // SAFETY: `out` is valid for writes.
    unsafe { *out = Owned::from_vec(bytes) };
    status
}

unsafe extern "C" fn grid_free(owned: Owned) {
    // SAFETY: made with `Owned::from_vec`.
    drop(unsafe { owned.into_vec() });
}

/// The grid: each major the host serves, one below and one above, through either entry; minors at, below and above
/// the host's; a `requires_minor` the host has and one it lacks; a table cut short; and `describe` answers that are
/// fine, that fail, that the host cannot read, that require a feature it lacks, and that carry a field it does not know.
fn grid() -> Vec<Row> {
    let mut rows = Vec::new();
    let row = |entry, major, minor, requires_minor, size: &str, describe: Value| Row {
        entry,
        major,
        minor,
        requires_minor,
        size: size.to_owned(),
        describe,
        verdict: Value::Null,
    };
    let fine = json!({ "version": "1.0.0", "id": "grid" });
    for entry in [1, 2] {
        for major in [0, 1, 2, 3] {
            let minors = match major {
                1 => vec![0, V1_MINOR, V1_MINOR + 1],
                2 => vec![0, ABI_MINOR + 1],
                _ => vec![0],
            };
            for minor in minors {
                let served = if major == 2 { ABI_MINOR } else { V1_MINOR };
                for requires in [0, served, served + 1] {
                    rows.push(row(entry, major, minor, requires, "full", fine.clone()));
                }
            }
        }
    }
    for (entry, major) in [(1, 1), (2, 2)] {
        rows.push(row(entry, major, 0, 0, "1.0", Value::Null));
        rows.push(row(entry, major, 0, 0, "short", Value::Null));
        rows.push(row(entry, major, 0, 0, "full", Value::Null));
        rows.push(row(entry, major, 0, 0, "full", json!("ERROR")));
        rows.push(row(entry, major, 0, 0, "full", json!("{\"version\":2}")));
        rows.push(row(entry, major, 0, 0, "full", json!({ "id": "grid", "requires": ["terminal"] })));
        rows.push(row(entry, major, 0, 0, "full", json!({ "id": "grid", "x-future": [1, 2] })));
    }
    rows
}

/// What the host makes of `row`.
fn verdict(row: &Row) -> Value {
    unsafe extern "C" fn create(_: *const HostApi, _: Bytes, _: *mut *mut c_void, _: *mut Owned) -> i32 {
        abi::ERROR
    }
    unsafe extern "C" fn call(_: *mut c_void, _: Bytes, _: *mut Owned) -> i32 {
        abi::ERROR
    }
    let size = match row.size.as_str() {
        "1.0" => size_of::<abi::PluginApiV1_0>(),
        "short" => std::mem::offset_of!(abi::PluginApiV1_0, requires_minor),
        _ => size_of::<PluginApi>(),
    };
    let api = PluginApi {
        size,
        major: row.major,
        minor: row.minor,
        requires_minor: row.requires_minor,
        create: Some(create),
        call: Some(call),
        destroy: None,
        free: Some(grid_free),
        describe: (!row.describe.is_null()).then_some(grid_describe as unsafe extern "C" fn(*mut Owned) -> i32),
    };
    DESCRIBED.set(row.describe.clone());
    match native::gate(&api, row.entry) {
        Ok((served, metadata)) => json!({ "served": served, "metadata": metadata }),
        Err(error) => json!({ "refused": error }),
    }
}

/// The rule, written from the header and not from the loader: whether the host takes `row`, and the minor it serves.
fn rule(row: &Row) -> Option<u32> {
    let served = match row.major {
        1 => V1_MINOR,
        2 => ABI_MINOR,
        _ => return None,
    };
    let header = row.size != "short";
    let described = match (row.major, &row.describe) {
        (_, Value::Null) | (1, _) => true,
        (_, Value::String(text)) => serde_json::from_str::<abi::Metadata>(text).is_ok(),
        (_, value) => serde_json::from_value::<abi::Metadata>(value.clone())
            .is_ok_and(|metadata| metadata.requires.iter().all(|feature| abi::FEATURES.contains(&feature.as_str()))),
    };
    // A table cut to the 1.0 core has no `describe`, which the host then does not call.
    let described = described || row.size == "1.0";
    (row.entry == row.major && header && row.requires_minor <= served && described).then_some(served)
}

// Expected: the version gate is exact. Each table of the grid is taken, with the minor of its major the host serves, or
// refused, with the words of the golden rows, and the verdict follows the rule of the header: the entry names the
// major, the major is one the host serves, the table covers its header, `requires_minor` is at most the minor served,
// and a 2.x `describe` answers metadata the host reads and requires no feature it lacks. A minor above the host's is
// taken; a field the host does not know is ignored. `CONFORMANCE_WRITE=1` writes the rows again.
#[test]
fn the_version_gate_is_exact() {
    let rows: Vec<Row> = grid().into_iter().map(|row| Row { verdict: verdict(&row), ..row }).collect();
    for row in &rows {
        let served = row.verdict.get("served").and_then(Value::as_u64).map(|served| served as u32);
        assert_eq!(served, rule(row), "{row:?}");
    }
    let text: String = rows.iter().map(|row| serde_json::to_string(row).unwrap() + "\n").collect();
    let file = root().join("conformance/versions.jsonl");
    if writing() {
        std::fs::write(file, text).unwrap();
        return;
    }
    assert_eq!(std::fs::read_to_string(file).unwrap(), text, "CONFORMANCE_WRITE=1 writes the rows again");
}

// The protocol machine.

/// The events of a 2.0 instance numbered 1, created with `manifest`.
fn created(protocol: &mut Protocol, manifest: &str) {
    let create = Event::Create { instance: 1, major: 2, minor: 0, features: b"[]", options: b"" };
    protocol.event(&create);
    protocol.event(&Event::Return { status: abi::OK, reply: Ok(manifest.as_bytes()) });
}

const MANIFEST: &str = r#"{"id":"p","commands":[],"fences":[],"slots":[],"routes":[],"storage":[],"messages":true,"surfaces":[{"name":"s","place":{"type":"route","name":"s"}}]}"#;

/// Whether `events` after a 2.0 instance with [`MANIFEST`] break a rule.
fn breaks(events: &[Event<'_>]) -> bool {
    let mut protocol = Protocol::default();
    created(&mut protocol, MANIFEST);
    assert_eq!(protocol.broken(), None);
    events.iter().for_each(|event| protocol.event(event));
    protocol.broken().is_some()
}

// Expected: the protocol machine takes a run that keeps the header's rules, and refuses each kind of break: a call
// inside a call, a host request outside one, a request of 2.0 to a 1.x library, a message to a plugin without a
// handler, a view of a surface it does not have or of a mount that ended, a call after a panic or a 2.x error or a
// handler reply that is not `null`, a destroy of a failed instance or twice, a render granted an effect, the host
// panicking, and a request no contract names.
#[test]
fn the_protocol_machine_refuses_what_the_header_forbids() {
    let call = |request: &'static str| Event::Call { instance: 1, request: request.as_bytes() };
    let ok = |reply: &'static str| Event::Return { status: abi::OK, reply: Ok(reply.as_bytes()) };
    let view = r#"{"type":"view","surface":0,"mount":{"surface":"s","key":"","generation":7},"input":{"width":1,"height":1,"palette":{"mode":"dark","colors":{}}},"next":0}"#;
    let tree = r#"{"node":{"type":"text","spans":[]}}"#;
    let unmount = r#"{"type":"unmount","mount":{"surface":"s","key":"","generation":7}}"#;
    let command = r#"{"type":"command","name":"x","input":null}"#;
    let toast =
        Event::Host { request: br#"{"type":"toast","variant":"info","message":"m"}"#, status: abi::OK, reply: b"null" };
    let refused = Event::Host {
        request: br#"{"type":"toast","variant":"info","message":"m"}"#,
        status: abi::ERROR,
        reply: b"no",
    };

    // A run that keeps every rule.
    let fine = [call(command), toast, ok("null"), call(view), refused, ok(tree), call(unmount), ok("null")];
    assert!(!breaks(&fine));
    assert!(!breaks(&[Event::Destroy { instance: 1 }, Event::Destroyed]));

    let rows: Vec<(&str, Vec<Event<'_>>)> = vec![
        ("a call inside a call", vec![call(command), call(command)]),
        (
            "a host request outside a call",
            vec![Event::Host { request: br#"{"type":"route"}"#, status: abi::OK, reply: b"null" }],
        ),
        ("theme_mode outside a call", vec![Event::ThemeMode { answer: 0 }]),
        (
            "a view of a surface it lacks",
            vec![call(
                r#"{"type":"view","surface":3,"mount":{"surface":"s","key":"","generation":1},"input":{"width":1,"height":1,"palette":{"mode":"dark","colors":{}}},"next":0}"#,
            )],
        ),
        (
            "a draw of a surface without one",
            vec![call(
                r#"{"type":"draw","surface":0,"mount":{"surface":"s","key":"","generation":1},"canvas":"c","frame":{"width":1,"height":1,"cause":"first","dt":{"secs":0,"nanos":0}}}"#,
            )],
        ),
        ("a view of a mount that ended", vec![call(unmount), ok("null"), call(view)]),
        (
            "a call after a panic",
            vec![call(command), Event::Return { status: abi::PANIC, reply: Ok(b"boom") }, call(command)],
        ),
        (
            "a call after a 2.x error",
            vec![call(command), Event::Return { status: abi::ERROR, reply: Ok(b"no") }, call(command)],
        ),
        ("a call after a handler's reply that is not null", vec![call(command), ok("true"), call(command)]),
        (
            "a call after a buffer refused unread",
            vec![call(command), Event::Return { status: abi::OK, reply: Err("a null buffer") }, call(command)],
        ),
        (
            "a destroy of a failed instance",
            vec![
                call(command),
                Event::Return { status: abi::PANIC, reply: Ok(b"boom") },
                Event::Destroy { instance: 1 },
            ],
        ),
        ("a call after destroy", vec![Event::Destroy { instance: 1 }, Event::Destroyed, call(command)]),
        ("a render granted an effect", vec![call(view), toast, ok(tree)]),
        (
            "the host panicking",
            vec![call(command), Event::Host { request: br#"{"type":"route"}"#, status: abi::PANIC, reply: b"boom" }],
        ),
        ("a request no contract names", vec![call(r#"{"type":"teleport"}"#)]),
        (
            "a host request no contract names, answered",
            vec![call(command), Event::Host { request: br#"{"type":"teleport"}"#, status: abi::OK, reply: b"null" }],
        ),
        ("a call into an instance never created", vec![Event::Call { instance: 9, request: command.as_bytes() }]),
    ];
    for (name, events) in rows {
        assert!(breaks(&events), "not refused: {name}");
    }

    // A 1.x instance gets nothing of 2.0, and a plugin without a message handler no message.
    let mut protocol = Protocol::default();
    protocol.event(&Event::Create { instance: 2, major: 1, minor: 6, features: b"", options: b"" });
    protocol.event(&Event::Return { status: abi::OK, reply: Ok(MANIFEST.as_bytes()) });
    protocol.event(&Event::Call { instance: 2, request: view.as_bytes() });
    assert!(protocol.broken().is_some(), "a 1.x library got a view");
    let mut protocol = Protocol::default();
    created(&mut protocol, r#"{"id":"p","commands":[],"fences":[],"slots":[],"routes":[],"storage":[]}"#);
    protocol.event(&Event::Call { instance: 1, request: br#"{"type":"message","message":"1"}"# });
    assert!(protocol.broken().is_some(), "a plugin without a handler got a message");
    // A create that failed is never destroyed; one whose manifest the host refused is.
    let mut protocol = Protocol::default();
    protocol.event(&Event::Create { instance: 3, major: 2, minor: 0, features: b"[]", options: b"" });
    protocol.event(&Event::Return { status: abi::ERROR, reply: Ok(b"no") });
    protocol.event(&Event::Destroy { instance: 3 });
    assert!(protocol.broken().is_some(), "a failed create was destroyed");
    let mut protocol = Protocol::default();
    protocol.event(&Event::Create { instance: 4, major: 2, minor: 0, features: b"[]", options: b"" });
    protocol.event(&Event::Return { status: abi::OK, reply: Ok(b"{}") });
    protocol.event(&Event::Destroy { instance: 4 });
    protocol.event(&Event::Destroyed);
    assert_eq!(protocol.broken(), None);
}
