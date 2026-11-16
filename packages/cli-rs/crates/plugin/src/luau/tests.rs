use std::fs;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::{Duration, Instant};

use opencode_ui::dialog::DialogKeymap;
use opentui::keymap::RunResult;
use opentui::prelude::*;

use super::*;
use crate::loader::approval::{self, Approvals};
use crate::loader::tests::{TestHost, dynamic, entry, host};
use crate::loader::{Backend, Configured, Loader};
use crate::{Host, Registry, SlotInput, Status, abi, slot};

/// The Luau examples, `crates/plugin/examples/luau`.
fn example(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("examples/luau").join(name)
}

/// Copies example `name` into `dir`.
fn install(name: &str, dir: &Path) {
    fs::create_dir_all(dir).unwrap();
    for file in fs::read_dir(example(name)).unwrap() {
        let file = file.unwrap();
        fs::copy(file.path(), dir.join(file.file_name())).unwrap();
    }
}

/// A plugin of `init` with the ID `test.luau`.
fn sources(init: &str) -> Sources {
    Sources::from_files([("plugin.toml", "id = \"test.luau\"\ncontract = \"2.0\""), ("init.luau", init)])
}

/// A registry that runs `definition`, active, on `host`.
fn running(host: &Rc<TestHost>, definition: crate::Definition) -> Rc<Registry> {
    let registry = Rc::new(Registry::define(Vec::new(), []));
    registry.add(definition);
    registry.activate(&dynamic(host));
    registry
}

fn failure(registry: &Registry, id: &str) -> Option<String> {
    let entries = registry.entries();
    let entry = entries.iter().find(|entry| entry.id == id).unwrap_or_else(|| panic!("no {id}: {entries:?}"));
    match &entry.status {
        Status::Failed(error) => Some(error.clone()),
        _ => None,
    }
}

/// What a plugin's `home.footer` claims draw.
fn footer(host: &Rc<TestHost>, registry: &Registry) -> String {
    let parent = View::new(host.app());
    let _mounted = registry.mount(&**host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    host.app().root().clear();
    host.app().root().add(&parent);
    host.app.render();
    host.app.text()
}

fn keymap(host: &TestHost) -> &DialogKeymap {
    host.keymap()
}

/// A loader with Luau on, of the global config directory `config` and the working directory `cwd`.
fn loader(config: &Path, cwd: &Path) -> Loader {
    let native = Rc::new(crate::loader::native::Native) as Rc<dyn Backend>;
    Loader::new(native, config.to_path_buf(), cwd.to_path_buf(), Vec::<Configured>::new()).with_luau()
}

#[test]
fn a_manifest_reads_its_flat_keys() {
    let manifest =
        Manifest::parse("# a comment\nid = \"example.hello\"\nname = \"Hello\"\ncontract = \"2.0\"\n").unwrap();
    assert_eq!(manifest.id, "example.hello");
    assert_eq!(manifest.entry, "init.luau");
    assert!(Manifest::parse("id = \"x\"\ncontract = \"1.0\"").unwrap_err().contains("contract 1.0"));
    assert!(Manifest::parse("id = [\"x\"]").unwrap_err().contains("only `key = \"string\"`"));
    assert!(Manifest::parse("entry = \"../x.luau\"\nid = \"x\"").unwrap_err().contains("not a .luau file"));
}

// Expected (luau-spike 1.5): the quick start in Luau loads from a `plugins` directory, as a native build does, and its
// command and its claim run.
#[test]
fn the_luau_quick_start_loads_from_a_plugins_directory_and_runs() {
    let temp = opencode_util::temp::tempdir().unwrap();
    let config = temp.path().join("config");
    let dir = config.join("plugins").join("hello");
    install("hello", &dir);
    let (host, registry) = (host(), Registry::define(Vec::new(), []));
    let loader = loader(&config, temp.path());
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let hello = entry(&registry.entries(), &dir.to_string_lossy()).clone();
    assert_eq!((hello.id.as_str(), hello.status), ("example.luau-hello", Status::Active));
    assert!(matches!(keymap(&host).dispatch("hello.greet", None), RunResult::Ok));
    host.app.advance(Duration::from_millis(1));
    assert_eq!(*host.toasts.borrow(), [abi::Toast::new(abi::Variant::Success, "Hello from a plugin")]);
    let parent = View::new(host.app());
    let _mounted = registry.mount(&*host, &parent, slot::HOME_FOOTER, &SlotInput::default(), |_| {});
    host.app().root().clear();
    host.app().root().add(&parent);
    host.app.render();
    assert!(host.app.text().contains("hello"), "{}", host.app.text());
    // Without the flag's loader the same directory is a TypeScript target, skipped as one.
    let plain = Loader::new(
        Rc::new(crate::loader::native::Native) as Rc<dyn Backend>,
        config.clone(),
        temp.path().to_path_buf(),
        Vec::new(),
    );
    let other = Registry::define(Vec::new(), []);
    plain.reconcile(&dynamic(&host), &other);
    assert!(matches!(entry(&other.entries(), &dir.to_string_lossy()).status, Status::Skipped(_)));
}

// Expected (luau-spike 1.2): the counter keeps its count in storage, asks before it resets, and its answer acts.
#[test]
fn the_counter_keeps_storage_and_asks_before_it_resets() {
    let host = host();
    let mut files = Vec::new();
    for name in ["plugin.toml", "init.luau", "shout.luau"] {
        files.push((name, fs::read_to_string(example("counter").join(name)).unwrap()));
    }
    let sources = Sources::from_files(files.iter().map(|(name, text)| (*name, text.as_str())));
    let registry = running(&host, define(&sources, None).unwrap().0);
    for _ in 0..2 {
        keymap(&host).dispatch("counter.count", None);
        host.app.advance(Duration::from_millis(1));
    }
    // The plugin's one storage key.
    let count = || host.storage.borrow().values().next().cloned();
    assert_eq!(count().as_deref(), Some(r#"{"value":2}"#));
    keymap(&host).dispatch("counter.reset", None);
    host.app.advance(Duration::from_millis(1));
    let dialogs = host.dialogs.borrow().clone();
    let [(_, abi::Dialog::Confirm(confirm))] = dialogs.as_slice() else { panic!("{dialogs:?}") };
    assert_eq!(confirm.message, "The count is 2.");
    keymap(&host).dispatch("counter.reset.answer", Some("false"));
    host.app.advance(Duration::from_millis(1));
    assert_eq!(count().as_deref(), Some(r#"{"value":2}"#));
    keymap(&host).dispatch("counter.reset.answer", Some("true"));
    host.app.advance(Duration::from_millis(1));
    assert_eq!(count().as_deref(), Some(r#"{"value":0}"#));
    assert_eq!(failure(&registry, "example.luau-counter"), None);
}

// Expected (luau-spike 1.3, O-159): a call that spins is stopped by the interrupt once it used the overrun limit of
// CPU time, the plugin fails with why, and nothing it asked for in that call happens. The UI thread is back at once:
// no 0.5 s notice, no 2 s watchdog.
#[test]
fn a_spinning_plugin_is_failed_on_cpu_time_and_the_thread_is_back_at_once() {
    let host = host();
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "spin" }, function(host)
                host:toast({ variant = "info", message = "before the spin" })
                while true do end
            end)
            setup:command({ name = "caught" }, function(host)
                -- A plugin that catches the budget's error is still stopped.
                while true do pcall(function() while true do end end) end
            end)
        end)
    "#;
    for command in ["spin", "caught"] {
        let registry = running(&host, define(&sources(init), None).unwrap().0);
        let start = Instant::now();
        keymap(&host).dispatch(command, None);
        let took = start.elapsed();
        host.app.advance(Duration::from_millis(1));
        let error = failure(&registry, "test.luau").expect("the spinning plugin failed");
        assert!(error.contains("CPU") && error.contains("Luau budget"), "{error}");
        // Well under the 2 s watchdog, which a native plugin that spins meets; CPU time, not wall time, stopped it.
        assert!(took < Duration::from_millis(1500), "{command} held the thread {took:?}");
        assert!(host.toasts.borrow().iter().all(|toast| toast.message != "before the spin"));
    }
}

// Expected (luau-spike 1.3): a render that spins is stopped the same way, and its claim draws nothing.
#[test]
fn a_spinning_render_is_stopped_and_draws_nothing() {
    let host = host();
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:slot({ path = "home.footer" }, function()
                local n = 0
                while true do n += 1 end
            end)
        end)
    "#;
    let registry = running(&host, define(&sources(init), None).unwrap().0);
    let start = Instant::now();
    let text = footer(&host, &registry);
    assert!(start.elapsed() < Duration::from_millis(1500));
    assert!(failure(&registry, "test.luau").is_some_and(|error| error.contains("Luau budget")));
    assert!(!text.contains("n"), "{text}");
}

// Expected (luau-spike 1.3): a VM's heap is capped; an allocation past it fails the call and the plugin, and the
// process's memory is not touched.
#[test]
fn a_plugin_that_allocates_past_its_cap_fails() {
    let host = host();
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "hog" }, function(host)
                local keep = {}
                for i = 1, 1e9 do keep[i] = string.rep("x", 1024) .. i end
            end)
        end)
    "#;
    let registry = running(&host, define_with(&sources(init), None, 4 << 20).unwrap().0);
    keymap(&host).dispatch("hog", None);
    host.app.advance(Duration::from_millis(1));
    let error = failure(&registry, "test.luau").expect("the hog failed");
    assert!(error.contains("memory"), "{error}");
}

// Expected (luau-spike 1.4): no file system, no process, no `require` outside the plugin, no `loadstring`, frozen
// globals; one plugin's VM shares nothing with another's.
#[test]
fn the_sandbox_holds_a_plugin_to_its_own_files() {
    let host = host();
    let init = r#"
        local plugin = require("@opencode/plugin")
        local function refused(f) local ok, error = pcall(f) return (if ok then "allowed" else tostring(error)) end
        return plugin.define(function(setup)
            setup:command({ name = "probe" }, function(host)
                local seen = {
                    io = tostring(io),
                    execute = tostring(os.execute),
                    getenv = tostring(os.getenv),
                    loadstring = tostring(loadstring),
                    dofile = tostring(dofile),
                    up = refused(function() return require("../escape") end),
                    climb = refused(function() return require("./../escape") end),
                    absolute = refused(function() return require("/etc/passwd") end),
                    fs = refused(function() return require("fs") end),
                    global = refused(function() string.upper = nil end),
                    mine = require("./mine").value,
                }
                local keys = {}
                for key, value in seen do table.insert(keys, `{key}={value}`) end
                table.sort(keys)
                host:toast({ variant = "info", message = table.concat(keys, "\n") })
            end)
        end)
    "#;
    let mut sources = sources(init);
    sources.files.insert("mine.luau".into(), b"return { value = 'own' }".to_vec());
    let registry = running(&host, define(&sources, None).unwrap().0);
    keymap(&host).dispatch("probe", None);
    host.app.advance(Duration::from_millis(1));
    assert_eq!(failure(&registry, "test.luau"), None);
    let message = host.toasts.borrow().last().unwrap().message.clone();
    let seen: std::collections::BTreeMap<&str, &str> =
        message.lines().filter_map(|line| line.split_once('=')).collect();
    assert_eq!(seen["io"], "nil");
    assert_eq!(seen["execute"], "nil");
    assert_eq!(seen["getenv"], "nil");
    assert_eq!(seen["loadstring"], "nil");
    assert_eq!(seen["dofile"], "nil");
    assert!(seen["up"].contains("its own modules"), "{message}");
    assert!(seen["climb"].contains("no module outside the plugin"), "{message}");
    assert!(seen["absolute"].contains("its own modules"), "{message}");
    assert!(seen["fs"].contains("its own modules"), "{message}");
    assert!(seen["global"].contains("readonly"), "{message}");
    assert_eq!(seen["mine"], "own");
}

// Expected (luau-spike 1.2): a render may read and ask for nothing; an effect from it fails the plugin with why.
#[test]
fn a_render_that_asks_for_an_effect_fails() {
    let host = host();
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:slot({ path = "home.footer" }, function(read)
                read:toast({ variant = "info", message = "from a render" })
            end)
        end)
    "#;
    let registry = running(&host, define(&sources(init), None).unwrap().0);
    footer(&host, &registry);
    let error = failure(&registry, "test.luau").expect("failed");
    assert!(error.contains("attempt to call") || error.contains("nil"), "{error}");
    // The host object refuses it too, by name.
    let init = r#"
        local plugin = require("@opencode/plugin")
        local held
        return plugin.define(function(setup)
            held = setup.host
            setup:slot({ path = "home.footer" }, function()
                held:toast({ variant = "info", message = "from a render" })
            end)
        end)
    "#;
    let registry = running(&host, define(&sources(init), None).unwrap().0);
    footer(&host, &registry);
    let error = failure(&registry, "test.luau").expect("failed");
    assert!(error.contains("a render or a view may read, and ask for nothing"), "{error}");
    assert!(host.toasts.borrow().iter().all(|toast| toast.message != "from a render"));
}

// Expected (luau-spike 1.5): a syntax error is the build's, before any setup; a reload that fails keeps the running
// version; a fixed one replaces it.
#[test]
fn a_luau_build_reloads_and_a_broken_one_keeps_the_running_version() {
    let temp = opencode_util::temp::tempdir().unwrap();
    let config = temp.path().join("config");
    let dir = config.join("plugins").join("hello");
    install("hello", &dir);
    let (host, registry) = (host(), Registry::define(Vec::new(), []));
    let loader = loader(&config, temp.path());
    loader.reconcile(&dynamic(&host), &registry);
    assert!(!loader.reconcile(&dynamic(&host), &registry), "nothing changed");
    assert!(loader.watch_dirs().contains(&dir));
    let target = dir.to_string_lossy().into_owned();
    fs::write(dir.join("init.luau"), "return plugin.define(function(setup) end").unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    let status = entry(&registry.entries(), &target).status.clone();
    let Status::Failed(error) = status else { panic!("{status:?}") };
    assert!(error.starts_with("init.luau:") && error.ends_with("(previous version still active)"), "{error}");
    assert!(footer(&host, &registry).contains("hello"));
    let fixed = fs::read_to_string(example("hello").join("init.luau")).unwrap().replace("\"hello\", {", "\"hi\", {");
    fs::write(dir.join("init.luau"), fixed).unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!(entry(&registry.entries(), &target).status, Status::Active);
    let text = footer(&host, &registry);
    assert!(text.contains("hi") && !text.contains("hello"), "{text}");
}

// Expected (luau-spike 1.5, O-146): a project's Luau plugin waits for the user's approval of its directory, by the
// artifact a TypeScript plugin has; once approved it runs from the staged copy, and a save after the approval holds it
// back again.
#[test]
fn a_project_luau_plugin_waits_for_an_approval_of_its_directory() {
    let temp = opencode_util::temp::tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(repo.join(".git")).unwrap();
    let dir = repo.join(".opencode").join("plugins").join("hello");
    install("hello", &dir);
    let target = dir.to_string_lossy().into_owned();
    let approvals = Approvals::open(temp.path().join("state").join(approval::FILE), &repo);
    let loader = loader(&temp.path().join("config"), &repo).with_approvals(approvals);
    let (host, registry) = (host(), Registry::define(Vec::new(), []));
    let status = || entry(&registry.entries(), &target).status.clone();
    loader.reconcile(&dynamic(&host), &registry);
    assert_eq!(status(), Status::Pending);
    assert!(!footer(&host, &registry).contains("hello"), "nothing of a pending plugin runs");
    let shown = loader.held(&target).and_then(Result::ok).expect("held for approval");
    assert!(shown.script, "the artifact a TypeScript plugin has");
    assert_eq!(Ok(shown.clone()), approval::Artifact::tree(&dir));
    let now = loader.found(&target).map(crate::loader::Found::identify);
    assert_eq!(loader.decide(&target, &shown, approval::Decision::Approved, now), Ok(true));
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!(status(), Status::Active);
    assert!(footer(&host, &registry).contains("hello"));
    // A save after the approval: held back, and what ran stops.
    fs::write(dir.join("init.luau"), "error('not approved')").unwrap();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!(status(), Status::Pending);
}

/// A host that reads nothing and does nothing, for the call measures.
struct Nop;

impl abi::Read for Nop {
    fn theme_mode(&self) -> abi::ThemeMode {
        abi::ThemeMode::Dark
    }

    fn color(&self, _: &str) -> Option<abi::Rgba> {
        None
    }
}

impl abi::Host for Nop {
    fn storage_set(&self, _: &str, _: serde_json::Value) {}
    fn dispatch(&self, _: &str, _: Option<&str>) {}
    fn toast(&self, _: abi::Toast) {}
    fn attention(&self, _: abi::Attention) {}
    fn open_route(&self, _: &str) {}
    fn navigate(&self, _: abi::Route) {}
    #[allow(deprecated)]
    fn fetch(&self, _: abi::Fetch) -> abi::RequestId {
        abi::RequestId(0)
    }
    fn dialog(&self, _: abi::Dialog) {}
    fn copy(&self, _: &str, _: Option<abi::Action>) {}
}

/// `examples/hello`'s Rust source: a command and a footer claim.
fn hello(setup: &mut abi::Setup) -> Result<(), String> {
    let command = abi::Command::default()
        .with_name("hello.greet".to_owned())
        .with_title("Say hello".to_owned())
        .with_palette(true);
    setup.command(command, |host, _| host.toast(abi::Toast::new(abi::Variant::Success, "Hello from a plugin")));
    setup.slot(abi::Placement::append("home.footer"), |_, _, _| {
        let text = abi::Node::text([abi::Span::new("hello").fg("text.muted")]);
        abi::Render::Show(text.on_click(abi::Click::command("hello.greet", None)))
    });
    Ok(())
}

/// The mean time of `f` over `rounds`, after a warm-up.
fn each(rounds: u32, mut f: impl FnMut()) -> Duration {
    (0..rounds / 10).for_each(|_| f());
    let start = Instant::now();
    (0..rounds).for_each(|_| f());
    start.elapsed() / rounds
}

// The spike's carrier measure, printed: one render of the quick start's claim and one run of its command, linked, as
// the C ABI carries it (the request and the answer through JSON both ways, without the FFI call, which costs
// nanoseconds), and in Luau. Run with `--release --ignored --nocapture`.
#[test]
#[ignore]
fn measure_one_call_on_each_carrier() {
    let (input, changed) = (abi::SlotInput::default(), abi::Changed::everything());
    let mut linked = abi::Registered::new("example.hello", None);
    hello(&mut linked.setup()).unwrap();
    let mut luau = abi::Registered::new("example.luau-hello", None);
    let compiled = Rc::new(vm::Compiled::new(&Sources::read(&example("hello")).unwrap(), "init.luau").unwrap());
    let _plugin = bind::setup(&compiled, &mut luau.setup(), Duration::from_millis(100), MEMORY, None).unwrap();
    let rounds = 200_000;
    for (name, registered) in [("linked", &linked), ("luau", &luau)] {
        let (_, _, render) = registered.renders().next().unwrap();
        let (_, command) = registered.commands().next().unwrap();
        let rendered = each(rounds, || drop(std::hint::black_box(render(&Nop, &input, &changed))));
        let ran = each(rounds, || command(&Nop, None));
        println!("{name}: render {rendered:?}, command {ran:?}");
    }
    // The C ABI's work on top of the linked call: the request to JSON and back, and the answer to JSON and back.
    let (_, _, render) = linked.renders().next().unwrap();
    let request = abi::Request::Render { claim: 0, input: input.clone(), changed: changed.clone() };
    let carried = each(rounds, || {
        let bytes = serde_json::to_vec(&request).unwrap();
        let abi::Request::Render { input, changed, .. } = serde_json::from_slice(&bytes).unwrap() else { panic!() };
        let answer = serde_json::to_vec(&render(&Nop, &input, &changed)).unwrap();
        drop(std::hint::black_box(serde_json::from_slice::<abi::Render>(&answer).unwrap()));
    });
    println!("c-abi: render {carried:?}");
    // What arming the Luau budget reads each call: the thread's CPU time, a system call on Linux.
    let cpu = each(rounds, || {
        std::hint::black_box(crate::contain::thread_cpu());
    });
    println!("thread_cpu: {cpu:?}");
}

// The spike's memory measure, printed: what an idle VM of each example holds once its setup ran, and what compiling
// the counter costs. Run with `--release --ignored --nocapture`.
#[test]
#[ignore]
fn measure_idle_memory_and_compile() {
    for name in ["hello", "counter", "force-input"] {
        let sources = Sources::read(&example(name)).unwrap();
        println!("idle VM {name}: {} bytes", idle_memory(&sources).unwrap());
    }
    let start = Instant::now();
    let sources = Sources::read(&example("counter")).unwrap();
    let _ = define(&sources, None).unwrap();
    println!("compile counter: {:?}", start.elapsed());
}
