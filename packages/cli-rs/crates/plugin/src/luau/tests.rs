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
    Loader::new(native, config.to_path_buf(), cwd.to_path_buf(), Vec::<Configured>::new()).with_luau(|| {})
}

/// Reconciles until a reconcile after a finished walk changes nothing and leaves no compiled build waiting, as the host
/// does on each walk's wake: whether anything changed. A Luau plugin's files are walked, staged and compiled on threads
/// of their own.
fn settle(loader: &Loader, host: &Rc<TestHost>, registry: &Registry) -> bool {
    let mut changed = false;
    for round in 0..200 {
        let now = loader.reconcile(&dynamic(host), registry);
        changed |= now;
        while loader.luau_walking() {
            std::thread::sleep(Duration::from_millis(1));
        }
        if round > 0 && !now && !loader.luau_ready() {
            return changed;
        }
    }
    panic!("the loader never settled")
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
    // Before the first walk of its files ended it is starting; no file was hashed on this thread.
    let hashed = approval::hashed();
    assert!(loader.reconcile(&dynamic(&host), &registry));
    assert_eq!(entry(&registry.entries(), &dir.to_string_lossy()).status, Status::Skipped(STARTING.to_owned()));
    assert!(settle(&loader, &host, &registry));
    assert_eq!(approval::hashed(), hashed);
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

/// The test binary's variable that runs [`a_table_move_past_the_array_limit_raises_and_does_not_crash`]'s plugin in the
/// child the row starts.
const CHILD: &str = "OPENCODE_LUAU_TEST_CHILD";

// Expected (luau-safety A, safety-audit #1): Luau's own conformance line, which crashed the process on 740's default
// flags, is an error that fails the plugin. The plugin runs in a child process, so a crash fails this row and not the
// whole test binary.
#[test]
fn a_table_move_past_the_array_limit_raises_and_does_not_crash() {
    let name = "a_table_move_past_the_array_limit_raises_and_does_not_crash";
    if std::env::var_os(CHILD).is_none() {
        let test = format!("{}::{name}", module_path!().split_once("::").unwrap().1);
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([test.as_str(), "--exact", "--nocapture", "--test-threads=1"])
            .env(CHILD, "1")
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(output.status.success(), "the child ended with {}:\n{stdout}\n{stderr}", output.status);
        assert!(stdout.contains("1 passed"), "the child ran no row:\n{stdout}");
        return;
    }
    let host = host();
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "move" }, function(host)
                table.move({}, 1, 2147483647, 1, {[-2147483648] = 1})
                host:toast({ variant = "info", message = "moved" })
            end)
        end)
    "#;
    let registry = running(&host, define(&sources(init), None).unwrap().0);
    keymap(&host).dispatch("move", None);
    host.app.advance(Duration::from_millis(1));
    let error = failure(&registry, "test.luau").expect("the move failed");
    assert!(error.contains("table overflow"), "{error}");
    assert!(host.toasts.borrow().iter().all(|toast| toast.message != "moved"));
}

// Expected (luau-safety A, safety-audit #2): a sparse `table.move` over 2^31 indices returns at once, where 740's
// default flags walked every index for about 20 s of CPU with no safepoint, past the 2 s watchdog.
#[test]
fn a_sparse_table_move_returns_at_once() {
    let host = host();
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "move" }, function(host)
                local ok, moved = pcall(table.move, {}, 0, 2^31 - 2, 2^35, {})
                host:toast({ variant = "info", message = `{ok} {next(moved)}` })
            end)
        end)
    "#;
    let registry = running(&host, define(&sources(init), None).unwrap().0);
    let start = Instant::now();
    keymap(&host).dispatch("move", None);
    let took = start.elapsed();
    host.app.advance(Duration::from_millis(1));
    assert_eq!(failure(&registry, "test.luau"), None);
    assert!(took < Duration::from_millis(1500), "the move held the thread {took:?}");
    let message = host.toasts.borrow().last().unwrap().message.clone();
    assert_eq!(message, "true nil", "the move returns its empty destination");
}

/// A plugin in `dir` whose `init.luau` holds a table literal of `items` numbers: about `2 * items` bytes.
fn big_plugin(dir: &Path, items: usize) {
    fs::create_dir_all(dir).unwrap();
    fs::write(dir.join(MANIFEST), "id = \"test.big\"\n").unwrap();
    let init = format!(
        "local plugin = require('@opencode/plugin')\nlocal big = {{{}}}\nreturn plugin.define(function(setup) end)\n",
        "1,".repeat(items)
    );
    fs::write(dir.join("init.luau"), init).unwrap();
}

// Expected (luau-safety 2, safety-audit #7): a big plugin is read and compiled on a thread of its own: the reconcile
// that finds it returns with the plugin starting while the compilation runs, and a later one makes it active.
#[test]
fn a_big_plugin_compiles_off_the_ui_thread() {
    let temp = opencode_util::temp::tempdir().unwrap();
    let config = temp.path().join("config");
    let dir = config.join("plugins").join("big");
    big_plugin(&dir, (SOURCES as usize - 200) / 2);
    let (host, registry) = (host(), Registry::define(Vec::new(), []));
    let loader = loader(&config, temp.path());
    loader.reconcile(&dynamic(&host), &registry);
    // The walk of its files: until it ends, nothing compiles.
    while loader.luau_walking() {
        std::thread::sleep(Duration::from_millis(1));
    }
    let start = Instant::now();
    loader.reconcile(&dynamic(&host), &registry);
    let reconciled = start.elapsed();
    assert_eq!(entry(&registry.entries(), &dir.to_string_lossy()).status, Status::Skipped(STARTING.to_owned()));
    assert!(loader.luau_walking(), "the compilation runs after the reconcile returned");
    while loader.luau_walking() {
        std::thread::sleep(Duration::from_millis(1));
    }
    println!("luau: a reconcile {reconciled:?} beside a compilation of {:?}", start.elapsed());
    settle(&loader, &host, &registry);
    let big = entry(&registry.entries(), &dir.to_string_lossy()).clone();
    assert_eq!((big.id.as_str(), big.status), ("test.big", Status::Active));
}

// Expected (luau-safety 2, safety-audit #7): a plugin whose sources pass the limit is refused, with why, before
// anything of it compiles.
#[test]
fn a_plugin_past_the_source_limit_is_refused() {
    let temp = opencode_util::temp::tempdir().unwrap();
    let config = temp.path().join("config");
    let dir = config.join("plugins").join("big");
    big_plugin(&dir, SOURCES as usize / 2 + 1);
    let (host, registry) = (host(), Registry::define(Vec::new(), []));
    let loader = loader(&config, temp.path());
    settle(&loader, &host, &registry);
    let entries = registry.entries();
    let Status::Failed(error) = &entry(&entries, &dir.to_string_lossy()).status else { panic!("{entries:?}") };
    assert!(error.contains("sources larger than 1 MiB"), "{error}");
}

// Expected (luau-safety 1, safety-audit #5): `print` writes to the client's log, never to the terminal under the TUI:
// one line naming the plugin, with escape sequences escaped and at most 4 KiB of what it printed.
#[test]
fn print_writes_one_escaped_line_to_the_log() {
    let logged = crate::loader::tests::logged();
    let host = host();
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "print" }, function(host)
                print("\27]0;title\7\27[2J", 1, nil, true)
                print(string.rep("x", 16 * 1024 * 1024))
            end)
        end)
    "#;
    let sources = Sources::from_files([("plugin.toml", "id = \"test.print\""), ("init.luau", init)]);
    let registry = running(&host, define(&sources, None).unwrap().0);
    keymap(&host).dispatch("print", None);
    host.app.advance(Duration::from_millis(1));
    assert_eq!(failure(&registry, "test.print"), None);
    let printed: Vec<String> =
        logged.lock().unwrap().iter().filter(|line| line.starts_with("plugin test.print ")).cloned().collect();
    let [escaped, cut] = printed.as_slice() else { panic!("{printed:?}") };
    assert_eq!(escaped, r"plugin test.print printed: \u{1b}]0;title\u{7}\u{1b}[2J\t1\tnil\ttrue");
    assert_eq!(*cut, format!("plugin test.print printed: {}... ({} bytes, cut at 4096)", "x".repeat(4096), 16 << 20));
}

// Expected (luau-safety 3, safety-audit #11): a plugin that runs out of memory inside `pcall` and keeps its heap at the
// cap is failed when the call returns, as the budget fails one that catches its error; one that let the garbage go
// keeps running.
#[test]
fn a_plugin_that_catches_running_out_of_memory_fails() {
    let host = host();
    let init = r#"
        local plugin = require("@opencode/plugin")
        local keep = {}
        local function fill() while true do table.insert(keep, string.rep("x", 1024) .. #keep) end end
        return plugin.define(function(setup)
            setup:command({ name = "drop" }, function(host)
                pcall(fill)
                keep = {}
            end)
            setup:command({ name = "keep" }, function(host)
                pcall(fill)
            end)
        end)
    "#;
    let registry = running(&host, define_with(&sources(init), None, 4 << 20).unwrap().0);
    keymap(&host).dispatch("drop", None);
    host.app.advance(Duration::from_millis(1));
    assert_eq!(failure(&registry, "test.luau"), None);
    keymap(&host).dispatch("keep", None);
    host.app.advance(Duration::from_millis(1));
    let error = failure(&registry, "test.luau").expect("the plugin at its cap failed");
    assert!(error.contains("out of memory") && error.contains("of its 4 MiB heap"), "{error}");
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
                    mine = require("@self/mine").value,
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
    assert!(seen["up"].contains("could not get parent of requiring context"), "{message}");
    assert!(seen["climb"].contains("could not get parent of requiring context"), "{message}");
    assert!(seen["absolute"].contains("must start with a valid prefix"), "{message}");
    assert!(seen["fs"].contains("must start with a valid prefix"), "{message}");
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
    assert!(settle(&loader, &host, &registry));
    assert!(!settle(&loader, &host, &registry), "nothing changed");
    assert!(loader.watch_dirs().contains(&dir));
    let target = dir.to_string_lossy().into_owned();
    fs::write(dir.join("init.luau"), "return plugin.define(function(setup) end").unwrap();
    assert!(settle(&loader, &host, &registry));
    let status = entry(&registry.entries(), &target).status.clone();
    let Status::Failed(error) = status else { panic!("{status:?}") };
    assert!(
        error.starts_with("example.luau-hello: init.luau:1: ") && error.ends_with("(previous version still active)"),
        "{error}"
    );
    assert!(footer(&host, &registry).contains("hello"));
    let fixed = fs::read_to_string(example("hello").join("init.luau")).unwrap().replace("\"hello\", {", "\"hi\", {");
    fs::write(dir.join("init.luau"), fixed).unwrap();
    assert!(settle(&loader, &host, &registry));
    assert_eq!(entry(&registry.entries(), &target).status, Status::Active);
    let text = footer(&host, &registry);
    assert!(text.contains("hi") && !text.contains("hello"), "{text}");
}

// Expected (luau-spike 1.5, O-146, review luau-2 and luau-3): a project's Luau plugin waits for the user's approval of
// its directory as a Luau plugin; once approved it runs from the staged copy, and a save after the approval holds it
// back again. The approval is the Luau carrier's: a TypeScript plugin in the same directory is not approved by it. The
// UI thread hashes and copies none of its files.
#[test]
fn a_project_luau_plugin_waits_for_an_approval_of_its_directory() {
    let temp = opencode_util::temp::tempdir().unwrap();
    let repo = temp.path().join("repo");
    fs::create_dir_all(repo.join(".git")).unwrap();
    let dir = repo.join(".opencode").join("plugins").join("hello");
    install("hello", &dir);
    fs::write(dir.join("tui.ts"), "export default { id: 'unsandboxed', setup() {} }").unwrap();
    let target = dir.to_string_lossy().into_owned();
    let store = temp.path().join("state").join(approval::FILE);
    let loader = loader(&temp.path().join("config"), &repo).with_approvals(Approvals::open(store.clone(), &repo));
    let (host, registry) = (host(), Registry::define(Vec::new(), []));
    let status = || entry(&registry.entries(), &target).status.clone();
    // Every reconcile measured: what this thread hashes in them, a walk or a copy on the UI thread, stays 0.
    let unhashed = |settled: &dyn Fn() -> bool| {
        let before = approval::hashed();
        let changed = settled();
        assert_eq!(approval::hashed(), before, "the UI thread hashed or copied a plugin's files");
        changed
    };
    unhashed(&|| settle(&loader, &host, &registry));
    assert_eq!(status(), Status::Pending);
    assert!(!footer(&host, &registry).contains("hello"), "nothing of a pending plugin runs");
    let shown = loader.held(&target).and_then(Result::ok).expect("held for approval");
    let tree = approval::Artifact::tree(&dir).unwrap();
    assert!(approves(&shown) && shown != tree && tree_of(&shown) == tree, "{shown:?}");
    // The host checks the disk off the UI thread (`Found::walks`); this thread stands in for that thread.
    let found = loader.found(&target).unwrap();
    assert!(found.walks());
    assert_eq!(loader.decide(&target, &shown, approval::Decision::Approved, Some(found.identify())), Ok(true));
    assert!(unhashed(&|| settle(&loader, &host, &registry)));
    assert_eq!(status(), Status::Active);
    assert!(footer(&host, &registry).contains("hello"));
    // A TypeScript plugin of the directory is asked about on its own: the Luau approval names its carrier.
    let decisions = Approvals::open(store, &repo);
    assert_eq!(decisions.decision(&shown), Some(approval::Decision::Approved));
    assert_eq!(decisions.decision(&tree), None);
    // A save after the approval: held back, and what ran stops.
    fs::write(dir.join("init.luau"), "error('not approved')").unwrap();
    assert!(unhashed(&|| settle(&loader, &host, &registry)));
    assert_eq!(status(), Status::Pending);
}

// Expected (review luau-1): a Luau build the crash list names is held as a library is, and listed failed with why.
#[test]
fn a_luau_build_the_crash_list_names_is_held() {
    let temp = opencode_util::temp::tempdir().unwrap();
    let config = temp.path().join("config");
    let dir = config.join("plugins").join("hello");
    install("hello", &dir);
    let target = dir.to_string_lossy().into_owned();
    let host = host();
    let first = Registry::define(Vec::new(), []);
    settle(&loader(&config, temp.path()), &host, &first);
    let digest = first.with_target(&target, |plugin| plugin.definition.digest.clone()).flatten().unwrap();
    let registry = Registry::define(Vec::new(), []);
    let reason = "crashed the client in run-command and is disabled".to_owned();
    let crashed =
        crate::Crashed { id: "example.luau-hello".into(), target: target.clone(), digest, reason: reason.clone() };
    registry.set_crashed(vec![crashed], |_| Ok(()));
    settle(&loader(&config, temp.path()), &host, &registry);
    assert_eq!(entry(&registry.entries(), &target).status, Status::Failed(reason));
    assert!(!footer(&host, &registry).contains("hello"));
}

// Expected (review luau-1): a small DAG of shared tables, which the decoder would expand on the Rust heap with no
// safepoint of the budget's, is refused at once and fails the plugin with why; so is a value past the limits it is
// charged against, and a refusal the plugin catches still fails the call.
#[test]
fn a_value_past_the_conversion_bounds_is_refused_at_once() {
    let host = host();
    let dag = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:slot({ path = "home.footer" }, function()
                local node = { type = "text", spans = { { text = "leaf" } } }
                for _ = 1, 30 do node = { type = "box", children = { node, node } } end
                return plugin.show(node)
            end)
        end)
    "#;
    let registry = running(&host, define(&sources(dag), None).unwrap().0);
    let start = Instant::now();
    let text = footer(&host, &registry);
    assert!(start.elapsed() < Duration::from_millis(500), "{:?}", start.elapsed());
    let error = failure(&registry, "test.luau").expect("refused");
    assert!(error.contains("a table appears twice"), "{error}");
    assert!(!text.contains("leaf"));

    let caught = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "big" }, function(host)
                local spans = {}
                for i = 1, 50 do spans[i] = { text = "x" } end
                pcall(function() host:toast({ variant = "info", message = "big", title = spans }) end)
                host:toast({ variant = "info", message = "after the refusal" })
            end)
        end)
    "#;
    let limits = crate::limits::Limits { nodes: 2, ..crate::limits::Limits::default() };
    let _restore = crate::limits::set(limits);
    let registry = running(&host, define(&sources(caught), None).unwrap().0);
    keymap(&host).dispatch("big", None);
    host.app.advance(Duration::from_millis(1));
    let error = failure(&registry, "test.luau").expect("refused");
    assert!(error.contains("more than 32 parts"), "{error}");
    assert!(host.toasts.borrow().iter().all(|toast| toast.message != "after the refusal"));
}

// Expected (review luau-4): a cycle of `require` is an error naming it; a module is one however it is reached
// (`@self/x` from the root, `../x` from `lib`), loaded once; and a link out of the plugin directory is refused, where
// one inside it is read.
#[test]
fn require_loads_each_module_once_and_names_a_cycle() {
    let host = host();
    let init = r#"
        local plugin = require("@opencode/plugin")
        local one, two = require("@self/x"), require("@self/lib/again")
        local ok, cycle = pcall(require, "@self/a")
        return plugin.define(function(setup)
            setup:command({ name = "probe" }, function(host)
                host:toast({ variant = "info", message = `{one == two} {one.loads} {tostring(cycle)}` })
            end)
        end)
    "#;
    let mut sources = sources(init);
    for (path, text) in [
        ("x/init.luau", "return { loads = 1 }"),
        ("lib/again.luau", "return require('../x')"),
        ("a.luau", "return require('./b')"),
        ("b.luau", "return require('./a')"),
    ] {
        sources.files.insert(path.into(), text.as_bytes().to_vec());
    }
    let registry = running(&host, define(&sources, None).unwrap().0);
    keymap(&host).dispatch("probe", None);
    host.app.advance(Duration::from_millis(1));
    assert_eq!(failure(&registry, "test.luau"), None);
    let message = host.toasts.borrow().last().unwrap().message.clone();
    assert!(message.starts_with("true 1 "), "{message}");
    assert!(message.contains("require cycle: init -> a -> b -> a"), "{message}");
}

#[cfg(unix)]
#[test]
fn a_link_out_of_the_plugin_directory_is_refused() {
    let temp = opencode_util::temp::tempdir().unwrap();
    let dir = temp.path().join("plugin");
    install("hello", &dir);
    fs::write(temp.path().join("outside.luau"), "return 1").unwrap();
    std::os::unix::fs::symlink(dir.join("init.luau"), dir.join("inside.luau")).unwrap();
    assert!(Sources::read(&dir).is_ok(), "a link inside the directory is read");
    std::os::unix::fs::symlink(temp.path().join("outside.luau"), dir.join("outside.luau")).unwrap();
    let error = Sources::read(&dir).unwrap_err();
    assert!(error.contains("a link out of the plugin directory"), "{error}");
}

// Expected (better-audit 2): `require` follows Luau's require-by-string as luau-analyze does, over the files read at
// load: `./x` is beside the requiring module (so outside the plugin from `init.luau`), `@self/x` inside it, a nested
// module's `./b` is its own directory's, nothing past the plugin's root is reached, a `.luaurc` inside the plugin
// names aliases for the modules under it, and `@opencode` stays the host's and `@self` the module's whatever that
// `.luaurc` says. The plugin's
// directory is gone before it starts, and a module required at call time still loads: nothing reads the disk.
#[test]
fn require_resolves_by_luaus_rules_within_the_plugin_and_reads_no_file_after_load() {
    let temp = opencode_util::temp::tempdir().unwrap();
    let dir = temp.path().join("plugin");
    let init = r#"
        local plugin = require("@opencode/plugin")
        local function try(path: string)
            local ok, value = pcall(require, path)
            return if ok then tostring(value) else `refused: {value}`
        end
        local seen = {
            self = try("@self/a"),
            beside = try("./a"),
            nested = try("@self/lib/one"),
            relative = try("@self/lib/sibling"),
            past = try("@self/lib/up"),
            alias = try("@self/aliased"),
            host = try("@self/host"),
            module = plugin.contract,
        }
        return plugin.define(function(setup)
            setup:command({ name = "probe" }, function(host)
                seen.late = try("@self/late")
                local keys = {}
                for key, value in seen do table.insert(keys, `{key}={value}`) end
                table.sort(keys)
                host:toast({ variant = "info", message = table.concat(keys, "\n") })
            end)
        end)
    "#;
    for (path, text) in [
        ("plugin.toml", "id = \"test.luau\"\ncontract = \"2.0\""),
        ("init.luau", init),
        ("a.luau", "return 'a'"),
        ("two.luau", "return 'the root two'"),
        ("lib/one.luau", "return 'lib/one sees ' .. require('./two')"),
        ("lib/two.luau", "return 'lib/two'"),
        ("lib/sibling.luau", "return 'lib/sibling sees ' .. require('../a')"),
        ("lib/up.luau", "return require('../../escape')"),
        (
            "aliased.luau",
            "return require('@util/x') .. ' ' .. require('@self/a') .. ' ' .. require('@opencode/plugin').contract",
        ),
        // A root module other than `init.luau`, which the root `.luaurc` covers (Luau reads none for `init.luau`).
        ("host.luau", "return require('@opencode/other')"),
        ("aliased/a.luau", "return 'aliased/a'"),
        ("util/x.luau", "return 'util/x'"),
        ("fake/plugin.luau", "return { contract = 'fake' }"),
        ("fake/other.luau", "return 'fake/other'"),
        ("fake/a.luau", "return 'fake/a'"),
        ("late.luau", "return 'late'"),
        (".luaurc", r#"{ "aliases": { "util": "./util", "opencode": "./fake", "self": "./fake" } }"#),
    ] {
        fs::create_dir_all(dir.join(path).parent().unwrap()).unwrap();
        fs::write(dir.join(path), text).unwrap();
    }
    fs::write(temp.path().join("escape.luau"), "return 'escaped'").unwrap();
    let sources = Sources::read(&dir).unwrap();
    let definition = define(&sources, None).unwrap().0;
    fs::remove_dir_all(&dir).unwrap();
    let host = host();
    let registry = running(&host, definition);
    keymap(&host).dispatch("probe", None);
    host.app.advance(Duration::from_millis(1));
    assert_eq!(failure(&registry, "test.luau"), None);
    let message = host.toasts.borrow().last().unwrap().message.clone();
    let seen: std::collections::BTreeMap<&str, &str> =
        message.lines().filter_map(|line| line.split_once('=')).collect();
    assert_eq!(seen["self"], "a", "{message}");
    assert!(seen["beside"].contains("could not get parent of requiring context"), "{message}");
    assert_eq!(seen["nested"], "lib/one sees lib/two", "{message}");
    assert_eq!(seen["relative"], "lib/sibling sees a", "{message}");
    assert!(seen["past"].contains("could not get parent of component"), "{message}");
    assert_eq!(seen["alias"], "util/x aliased/a 2.0", "{message}");
    assert!(seen["host"].contains("refused") && !seen["host"].contains("fake"), "{message}");
    assert_eq!(seen["module"], "2.0", "{message}");
    assert_eq!(seen["late"], "late", "{message}");
}

/// What plugin `test.luau` fails with once its command `probe` ran, with `init` and the extra `files`.
fn failed_probe(init: &str, files: &[(&str, &str)]) -> String {
    let host = host();
    let mut sources = sources(init);
    for (path, text) in files {
        sources.files.insert((*path).into(), text.as_bytes().to_vec());
    }
    let registry = running(&host, define(&sources, None).unwrap().0);
    keymap(&host).dispatch("probe", None);
    host.app.advance(Duration::from_millis(1));
    failure(&registry, "test.luau").expect("the probe failed the plugin")
}

const PROBE: &str = r#"
    local plugin = require("@opencode/plugin")
    local util = require("@self/lib/util")
    return plugin.define(function(setup)
        setup:command({ name = "probe" }, function(host)
            util.width(nil)
        end)
    end)
"#;

// Expected (better-audit 2): a runtime error reads `<plugin id>: <file>.luau:<line>: <message>`, with no `runtime
// error:` prefix, and its traceback keeps the plugin's own frames only: no `[C]`, mlua `require` or host frames.
#[test]
fn a_luau_runtime_error_names_the_plugin_the_file_and_the_line() {
    let util = "local util = {}\nfunction util.width(node)\n    return #node.text\nend\nreturn util";
    let error = failed_probe(PROBE, &[("lib/util.luau", util)]);
    assert!(error.starts_with("test.luau: lib/util.luau:3: attempt to index nil with 'text'\n"), "{error}");
    let traceback = error.split_once("\nstack traceback:\n").map(|(_, frames)| frames).unwrap_or_default();
    assert!(traceback.starts_with("\tlib/util.luau:3: in function 'width'\n\tinit.luau:6:"), "{error}");
    for noise in ["runtime error", "[C]", "__mlua_require", "@opencode/plugin", "panicked"] {
        assert!(!error.contains(noise), "{noise}: {error}");
    }
}

// Expected (better-audit 2): `error("...")` reads the same way, at the line that raised it.
#[test]
fn a_luau_error_call_names_the_plugin_the_file_and_the_line() {
    let init = PROBE.replace("util.width(nil)", "error(\"boom\")");
    let error = failed_probe(&init, &[("lib/util.luau", "return {}")]);
    assert!(error.starts_with("test.luau: init.luau:6: boom"), "{error}");
}

// Expected (better-audit 2): a syntax error reads `<plugin id>: <file>.luau:<line>: <message>`, not
// `init.luau: syntax error: 3: ...`.
#[test]
fn a_luau_syntax_error_names_the_plugin_the_file_and_the_line() {
    let error = define(&sources("local plugin = require(\"@opencode/plugin\")\n\nlocal = 1\n"), None).err().unwrap();
    assert!(error.starts_with("test.luau: init.luau:3: "), "{error}");
    assert!(!error.contains("syntax error"), "{error}");
}

// Expected (call cost): the tables a render's input and `Changed` come in are reused from call to call, so each call
// sees its own values and nothing of the one before, also through a table the plugin kept, and the plugin cannot
// write into them.
#[test]
fn a_reused_input_table_shows_each_call_its_own_values() {
    let init = r#"
        local plugin = require("@opencode/plugin")
        local kept
        return plugin.define(function(setup)
            setup:slot({ path = "home.footer" }, function(_read, input, changed)
                local before = if kept then tostring(kept.session_id) else "none"
                kept = input
                local writes = pcall(function() input.extra = 1 end) or pcall(function() changed.all = true end)
                local sessions = if changed.sessions then table.concat(changed.sessions, ",") else "nil"
                local messages = if changed.messages then changed.messages[1][2] else "nil"
                local text = `{tostring(input.session_id)} {tostring(input.prompt and input.prompt.shell)} {sessions} `
                    .. `{messages} {tostring(changed["local"])} {tostring(changed.all)} {before} {tostring(writes)}`
                return plugin.show(plugin.text(text))
            end)
        end)
    "#;
    let mut registered = abi::Registered::new("test.luau", None);
    let compiled = Rc::new(vm::Compiled::new(&sources(init), "test.luau", "init.luau").unwrap());
    let _plugin = bind::setup(&compiled, &mut registered.setup(), Duration::from_millis(100), MEMORY, None).unwrap();
    let (_, _, render) = registered.renders().next().unwrap();
    let shown = |input: &abi::SlotInput, changed: &abi::Changed| match render(&Nop, input, changed) {
        abi::Render::Show(abi::Node::Text { spans, .. }) => spans[0].text.clone(),
        other => panic!("{other:?}"),
    };
    let full = abi::SlotInput {
        session_id: Some("ses_1".into()),
        prompt: Some(abi::PromptInput { shell: true, show_details: false }),
        ..abi::SlotInput::default()
    };
    let mut changed = abi::Changed::everything();
    changed.sessions = vec!["ses_1".into(), "ses_2".into()];
    changed.messages = vec![("ses_1".into(), "msg_1".into())];
    assert_eq!(shown(&full, &changed), "ses_1 true ses_1,ses_2 msg_1 nil true none false");
    let local = abi::Changed { local: true, ..abi::Changed::default() };
    assert_eq!(shown(&abi::SlotInput::default(), &local), "nil nil nil nil true nil nil false");
    changed.sessions = vec!["ses_3".into()];
    assert_eq!(shown(&full, &changed), "ses_1 true ses_3 msg_1 nil true ses_1 false");
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
    fn try_fetch(&self, _: abi::Fetch) -> Result<abi::RequestId, String> {
        Err("no server".to_owned())
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
    let compiled =
        Rc::new(vm::Compiled::new(&Sources::read(&example("hello")).unwrap(), "test.luau", "init.luau").unwrap());
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
    // The Luau render as the host makes it, timed by the budget's monitor, which reads the thread's CPU time too.
    let monitor = crate::contain::Monitor::new(crate::contain::Limits::default());
    let slot = monitor.slot(&crate::contain::Artifact::builtin("example.luau-hello"));
    let (_, _, render) = luau.renders().next().unwrap();
    let monitored = each(rounds, || {
        drop(std::hint::black_box(monitor.call(slot, "render-slot", || render(&Nop, &input, &changed))))
    });
    println!("luau: render under the monitor {monitored:?}");
    // What arming the Luau budget reads each call: the thread's CPU time, a system call on Linux.
    let cpu = each(rounds, || {
        std::hint::black_box(crate::contain::thread_cpu());
    });
    println!("thread_cpu: {cpu:?}");
    parts_of_a_render();
    heavy_calls();
}

/// What a small render's time goes to: a call that returns `KEEP` (the call, its input and its `Changed`), one that
/// returns a node it built once (and its decode), and the quick start's (which builds the node each time).
fn parts_of_a_render() {
    let init = r#"
        local plugin = require("@opencode/plugin")
        local node = plugin.show(plugin.text({ plugin.span("hello", { fg = "text.muted" }) }, { on_click = plugin.click("hello.greet") }))
        return plugin.define(function(setup)
            setup:slot({ path = "home.footer" }, function() return plugin.KEEP end)
            setup:slot({ path = "home.footer" }, function() return node end)
            setup:slot({ path = "home.footer" }, function()
                return plugin.show(plugin.text({ plugin.span("hello", { fg = "text.muted" }) }, { on_click = plugin.click("hello.greet") }))
            end)
            setup:slot({ path = "home.footer" }, function()
                plugin.show(plugin.text({ plugin.span("hello", { fg = "text.muted" }) }, { on_click = plugin.click("hello.greet") }))
                return plugin.KEEP
            end)
        end)
    "#;
    let mut registered = abi::Registered::new("test.luau", None);
    let compiled = Rc::new(vm::Compiled::new(&sources(init), "test.luau", "init.luau").unwrap());
    let _plugin = bind::setup(&compiled, &mut registered.setup(), Duration::from_millis(100), MEMORY, None).unwrap();
    let (input, changed) = (abi::SlotInput::default(), abi::Changed::everything());
    let names = ["keep", "kept node", "built node", "built, keep"];
    for ((_, _, render), name) in registered.renders().zip(names) {
        let took = each(100_000, || drop(std::hint::black_box(render(&Nop, &input, &changed))));
        println!("render parts, {name}: {took:?}");
    }
}

/// The heavy claims' Luau: the first reads a large `Changed` and keeps its node, the second draws 200 rows.
const HEAVY: &str = r#"
    local plugin = require("@opencode/plugin")
    return plugin.define(function(setup)
        setup:slot({ path = "home.footer" }, function(_read, input, changed)
            local sessions = changed.sessions or {}
            return if #sessions > 0 and input.session_id then plugin.KEEP else plugin.HIDE
        end)
        setup:slot({ path = "sidebar.content" }, function()
            local rows = {}
            for i = 1, 200 do
                rows[i] = plugin.text({ plugin.span("row ", { fg = "text.muted" }), plugin.span(tostring(i), { bold = true }) })
            end
            return plugin.show(plugin.column(rows))
        end)
    end)
"#;

/// The heavy claims in Rust, linked.
fn heavy(setup: &mut abi::Setup) -> Result<(), String> {
    setup.slot(abi::Placement::append("home.footer"), |_, input, changed| {
        match !changed.sessions.is_empty() && input.session_id.is_some() {
            true => abi::Render::Keep,
            false => abi::Render::Hide,
        }
    });
    setup.slot(abi::Placement::append("sidebar.content"), |_, _, _| {
        let rows = (1..=200)
            .map(|i| abi::Node::text([abi::Span::new("row ").fg("text.muted"), abi::Span::new(i.to_string()).bold()]))
            .collect();
        abi::Render::Show(abi::Node::column(rows))
    });
    Ok(())
}

/// One input-heavy call (a render handed a `Changed` of 200 sessions, 200 lists and 200 messages) and one
/// output-heavy call (a render that returns 200 rows of two spans), on each carrier.
fn heavy_calls() {
    let ids: Vec<String> = (0..200).map(|i| format!("ses_{i:04}")).collect();
    let changed = abi::Changed {
        sessions: ids.clone(),
        lists: ids.clone(),
        messages: ids.iter().map(|id| (id.clone(), format!("msg_{id}"))).collect(),
        ..abi::Changed::default()
    };
    let input = abi::SlotInput {
        session_id: Some("ses_0001".into()),
        prompt: Some(abi::PromptInput { shell: false, show_details: true }),
        ..abi::SlotInput::default()
    };
    let mut linked = abi::Registered::new("test.heavy", None);
    heavy(&mut linked.setup()).unwrap();
    let mut luau = abi::Registered::new("test.luau", None);
    let compiled = Rc::new(vm::Compiled::new(&sources(HEAVY), "test.luau", "init.luau").unwrap());
    let _plugin = bind::setup(&compiled, &mut luau.setup(), Duration::from_millis(100), MEMORY, None).unwrap();
    let rounds = 20_000;
    let plain = abi::SlotInput::default();
    let little = abi::Changed::everything();
    for (name, registered) in [("linked", &linked), ("luau", &luau)] {
        let mut renders = registered.renders().map(|(_, _, render)| render);
        let (reads, draws) = (renders.next().unwrap(), renders.next().unwrap());
        // Two `Changed` in turn, so no call is handed what the one before was.
        let mut other = changed.clone();
        other.sessions.reverse();
        let mut turn = false;
        let mut next = || {
            turn = !turn;
            if turn { &changed } else { &other }
        };
        let read = each(rounds, || drop(std::hint::black_box(reads(&Nop, &input, next()))));
        let drawn = each(rounds / 10, || drop(std::hint::black_box(draws(&Nop, &plain, &little))));
        println!("{name}: input-heavy {read:?}, output-heavy {drawn:?}");
    }
    let mut renders = linked.renders().map(|(_, _, render)| render);
    let (reads, draws) = (renders.next().unwrap(), renders.next().unwrap());
    let carried = |render: &abi::RenderFn, input: &abi::SlotInput, changed: &abi::Changed| {
        let request = abi::Request::Render { claim: 0, input: input.clone(), changed: changed.clone() };
        let bytes = serde_json::to_vec(&request).unwrap();
        let abi::Request::Render { input, changed, .. } = serde_json::from_slice(&bytes).unwrap() else { panic!() };
        let answer = serde_json::to_vec(&render(&Nop, &input, &changed)).unwrap();
        drop(std::hint::black_box(serde_json::from_slice::<abi::Render>(&answer).unwrap()));
    };
    let read = each(rounds, || carried(reads, &input, &changed));
    let drawn = each(rounds / 10, || carried(draws, &plain, &little));
    println!("c-abi: input-heavy {read:?}, output-heavy {drawn:?}");
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

// Expected (contract 2.x additions on the Luau carrier): a Luau plugin reads the host's version and features, and asks
// for one by the prelude's name; it shows a centered select, and an alert and a confirm with their size and centering,
// which reach the host as the contract's dialogs.
#[test]
fn a_luau_plugin_reads_the_features_and_centers_its_dialogs() {
    let host = host();
    let init = r#"local plugin = require("@opencode/plugin")
return plugin.define(function(setup)
    setup:command({ name = "luau.features" }, function(host)
        local abi = host:abi()
        local said = abi.major .. "." .. abi.minor .. " " .. table.concat(abi.features, ",") .. " "
            .. tostring(host:hasFeature(plugin.FOCUS_INPUT)) .. " " .. tostring(host:hasFeature(plugin.FENCE_NODE))
            .. " " .. tostring(host:hasFeature("fence-nodes"))
        host:toast({ variant = "info", message = said })
    end)
    setup:command({ name = "luau.dialogs" }, function(host)
        local action = plugin.command("luau.features")
        host:dialog({ type = "select", title = "pick", options = { { title = "one", value = "1" } }, action = action,
            centered = true })
        host:dialog({ type = "alert", title = "told", message = "said", size = "xlarge", centered = true })
        host:dialog({ type = "confirm", title = "asked", message = "sure?", action = action, size = "large",
            centered = true })
    end)
end)
"#;
    let registry = running(&host, define(&sources(init), None).unwrap().0);
    keymap(&host).dispatch("luau.features", None);
    keymap(&host).dispatch("luau.dialogs", None);
    host.app.advance(Duration::from_millis(1));
    let features = abi::FEATURES.join(",");
    let toasts: Vec<String> = host.toasts.borrow().iter().map(|toast| toast.message.clone()).collect();
    assert_eq!(toasts, [format!("2.0 {features} true true false")]);
    let dialogs: Vec<abi::Dialog> = host.dialogs.borrow().iter().map(|(_, dialog)| dialog.clone()).collect();
    let [abi::Dialog::Select(select), abi::Dialog::Alert(alert), abi::Dialog::Confirm(confirm)] = dialogs.as_slice()
    else {
        panic!("{dialogs:?}")
    };
    assert!(select.centered && alert.centered && confirm.centered, "{dialogs:?}");
    assert_eq!((alert.size, confirm.size), (Some(abi::PanelSize::XLarge), Some(abi::PanelSize::Large)));
    assert_eq!(failure(&registry, "test.luau"), None);
}
