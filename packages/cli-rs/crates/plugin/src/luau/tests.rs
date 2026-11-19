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
fn luau_plugins_are_on_unless_turned_off() {
    let off = |value: Option<&str>| crate::turned_off(value.map(std::ffi::OsStr::new));
    for on in [None, Some(""), Some("1"), Some("yes"), Some("on")] {
        assert!(!off(on), "{on:?}");
    }
    for value in ["0", "false", "FALSE", "off", " Off "] {
        assert!(off(Some(value)), "{value:?}");
    }
    assert_eq!(enabled(), !off(std::env::var(FLAG).ok().as_deref()));
}

#[test]
fn no_vm_is_made_without_a_luau_plugin() {
    let temp = opencode_util::temp::tempdir().unwrap();
    let config = temp.path().join("config");
    fs::create_dir_all(config.join("plugins").join("not-luau")).unwrap();
    fs::write(config.join("plugins").join("not-luau").join("package.json"), "{}").unwrap();
    let (host, registry) = (host(), Registry::define(Vec::new(), []));
    let loader = loader(&config, temp.path());
    let before = vm::made();
    settle(&loader, &host, &registry);
    assert_eq!(vm::made(), before, "a VM without a Luau plugin");
    install("hello", &config.join("plugins").join("hello"));
    settle(&loader, &host, &registry);
    assert_eq!(vm::made(), before + 1);
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

#[test]
fn a_long_pattern_match_is_stopped() {
    let host = host();
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "match" }, function(host)
                -- Three lazy repetitions over 3000 bytes with no match: billions of matcher steps.
                local found = string.rep("a", 3000):find(".-.-.-b")
                host:toast({ variant = "info", message = tostring(found) })
            end)
        end)
    "#;
    let registry = running(&host, define(&sources(init), None).unwrap().0);
    let start = Instant::now();
    keymap(&host).dispatch("match", None);
    let took = start.elapsed();
    host.app.advance(Duration::from_millis(1));
    let error = failure(&registry, "test.luau").expect("the match was stopped");
    assert!(error.contains("CPU") && error.contains("Luau budget"), "{error}");
    assert!(took < Duration::from_millis(1500), "the match held the thread {took:?}");
    assert!(host.toasts.borrow().iter().all(|toast| toast.message != "nil"));
}

/// The CPU time this thread spends in `f`, and what `f` returned.
fn cpu<R>(f: impl FnOnce() -> R) -> (Duration, R) {
    let start = crate::contain::thread_cpu().expect("this OS gives a thread's CPU time");
    let result = f();
    (crate::contain::thread_cpu().unwrap().saturating_sub(start), result)
}

#[test]
fn a_loop_of_expensive_built_ins_is_stopped_within_the_budget() {
    let loops = [
        ("utf8", "local s = string.rep('\\u{e9}', 512 * 1024) local n = 0 while true do n += utf8.len(s) end"),
        (
            "sort",
            "local t = table.create(100000, 0) for i = 1, #t do t[i] = (i * 7919) % 1000003 end \
             while true do table.sort(t) t[1], t[#t] = t[#t], t[1] end",
        ),
        ("rep", "while true do local s = string.rep('a', 4 * 1024 * 1024) end"),
        (
            "pack",
            "local fmt, args = string.rep('i4', 20000), table.create(20000, 7) local n = 0 \
             while true do n += #string.pack(fmt, table.unpack(args)) end",
        ),
    ];
    for (name, body) in loops {
        let host = host();
        let init = format!(
            r#"
            local plugin = require("@opencode/plugin")
            return plugin.define(function(setup)
                setup:command({{ name = "spin" }}, function() {body} end)
            end)
        "#
        );
        let registry = running(&host, define(&sources(&init), None).unwrap().0);
        let (used, _) = cpu(|| keymap(&host).dispatch("spin", None));
        host.app.advance(Duration::from_millis(1));
        let error = failure(&registry, "test.luau").unwrap_or_else(|| panic!("{name} was not stopped"));
        assert!(error.contains("Luau budget"), "{name}: {error}");
        assert!(used <= Duration::from_millis(200), "{name} ran {used:?} of CPU on a 100 ms budget");
    }
}

#[test]
fn a_call_with_cpu_time_left_at_its_deadline_is_read_again_in_time() {
    let compiled = Rc::new(vm::Compiled::new(&sources("return 1"), "test.luau", "init.luau").unwrap());
    let vm = vm::Vm::new(&compiled, Duration::from_millis(20), MEMORY).unwrap();
    vm.start(&compiled).unwrap();
    let pause = vm
        .lua
        .create_function(|_, ()| {
            std::thread::sleep(Duration::from_millis(6));
            Ok(())
        })
        .unwrap();
    let step = vm
        .lua
        .create_function(|_, ()| {
            let (start, mut spun) = (crate::contain::thread_cpu().unwrap(), 0u64);
            while crate::contain::thread_cpu().unwrap().saturating_sub(start) < Duration::from_millis(2) {
                spun = std::hint::black_box(spun + 1);
            }
            Ok(spun)
        })
        .unwrap();
    let spin = vm.lua.load("local pause, step = ... pause() while true do step() end").into_function().unwrap();
    let (used, result) = cpu(|| vm.call(|| spin.call::<()>((pause.clone(), step.clone()))));
    let error = result.unwrap_err();
    assert!(error.contains("Luau budget"), "{error}");
    assert!(used <= Duration::from_millis(60), "ran {used:?} of CPU on a 20 ms limit");
}

#[test]
fn a_call_after_a_panic_or_a_stale_arm_has_its_whole_budget() {
    let compiled = Rc::new(vm::Compiled::new(&sources("return 1"), "test.luau", "init.luau").unwrap());
    let vm = vm::Vm::new(&compiled, Duration::from_millis(50), MEMORY).unwrap();
    vm.start(&compiled).unwrap();
    let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        vm.call(|| -> mlua::Result<()> { std::panic::resume_unwind(Box::new("a host panic")) })
    }));
    assert!(panicked.is_err());
    let spin = vm.lua.load("while true do end").into_function().unwrap();
    let error = vm.call(|| spin.call::<()>(())).unwrap_err();
    assert!(error.contains("Luau budget"), "{error}");
    let short = vm.lua.load("local n = 0 for i = 1, 1e4 do n += i end return n").into_function().unwrap();
    vm.arm_interrupt();
    let before = vm.interrupts();
    assert_eq!(vm.call(|| short.call::<f64>(())), Ok(50_005_000.0));
    assert_eq!(vm.interrupts(), before, "the interrupt ran in a call well within its limit");
}

#[test]
fn an_armed_interrupt_stays_with_its_call_and_its_vm() {
    let compiled = Rc::new(vm::Compiled::new(&sources("return 1"), "test.luau", "init.luau").unwrap());
    // A limit far past the row's own time: only an arm of the interrupt ends a call early.
    let new = || {
        let vm = vm::Vm::new(&compiled, Duration::from_secs(10), MEMORY).unwrap();
        vm.start(&compiled).unwrap();
        vm
    };
    let (one, other) = (new(), new());
    let work = |vm: &vm::Vm| {
        let f = vm.lua.load("local n = 0 for i = 1, 1e5 do n += i end return n").into_function().unwrap();
        vm.call(|| f.call::<f64>(()))
    };
    // Armed outside any call: the next call of either VM runs to its end.
    one.arm_interrupt();
    assert_eq!(work(&other), Ok(5_000_050_000.0));
    assert_eq!(work(&one), Ok(5_000_050_000.0));
    // A refusal the plugin caught stops its call at the next safepoint, long before the budget would; the call after it
    // runs.
    let refused = one
        .lua
        .create_function(|lua, ()| {
            vm::refuse(lua, "refused");
            Ok(())
        })
        .unwrap();
    let caught = one.lua.load("local refuse = ... pcall(refuse) while true do end").into_function().unwrap();
    let start = Instant::now();
    let error = one.call(|| caught.call::<()>(refused.clone())).unwrap_err();
    assert!(error.contains("refused") && !error.contains("CPU"), "{error}");
    assert!(start.elapsed() < Duration::from_secs(5), "the refused call ran {:?}", start.elapsed());
    assert_eq!(work(&one), Ok(5_000_050_000.0));
    assert_eq!(work(&other), Ok(5_000_050_000.0));
}

#[test]
fn a_plugin_that_allocates_past_its_cap_fails() {
    let host = host();
    for keep in ["local keep = {}", "keep = {}"] {
        let init = format!(
            r#"
            local plugin = require("@opencode/plugin")
            local keep = {{}}
            return plugin.define(function(setup)
                setup:command({{ name = "hog" }}, function(host)
                    {keep}
                    for i = 1, 1e9 do keep[i] = string.rep("x", 1024) .. i end
                end)
            end)
        "#
        );
        let registry = running(&host, define_with(&sources(&init), None, 4 << 20).unwrap().0);
        keymap(&host).dispatch("hog", None);
        host.app.advance(Duration::from_millis(1));
        let error = failure(&registry, "test.luau").expect("the hog failed");
        assert_eq!(error, "test.luau: out of memory: an allocation went past its 4 MiB Luau heap cap", "{keep}");
    }
}

/// The test binary's variable that runs [`a_table_move_past_the_array_limit_raises_and_does_not_crash`]'s plugin in the
/// child the row starts.
const CHILD: &str = "OPENCODE_LUAU_TEST_CHILD";

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

/// Runs command `name` of a plugin of `init` and returns how long the call held the thread, with the plugin's failure
/// if it failed and the message of its last toast.
fn timed(init: &str, name: &str) -> (Duration, Option<String>, Option<String>) {
    let host = host();
    let registry = running(&host, define(&sources(init), None).unwrap().0);
    let start = Instant::now();
    keymap(&host).dispatch(name, None);
    let took = start.elapsed();
    host.app.advance(Duration::from_millis(1));
    let toast = host.toasts.borrow().last().map(|toast| toast.message.clone());
    (took, failure(&registry, "test.luau"), toast)
}

#[test]
fn a_long_plain_search_is_linear() {
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "find" }, function(host)
                local haystack = string.rep("a", 1024 * 1024)
                local needle = string.rep("a", 64 * 1024 - 1) .. "b"
                local plain = string.find(haystack, needle, 1, true)
                local bare = string.find(haystack, needle)
                local _, replaced = string.gsub(haystack, needle, "x")
                host:toast({ variant = "info", message = `{plain} {bare} {replaced}` })
            end)
        end)
    "#;
    let (took, failed, toast) = timed(init, "find");
    assert_eq!(failed, None, "took {took:?}");
    assert_eq!(toast.as_deref(), Some("nil nil 0"));
    assert!(took < Duration::from_millis(1500), "the search held the thread {took:?}");
}

#[test]
fn a_split_on_a_long_separator_is_linear() {
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "split" }, function(host)
                local text = string.rep("a", 1024 * 1024)
                local parts = text:split(string.rep("a", 64 * 1024 - 1) .. "b")
                host:toast({ variant = "info", message = `{#parts} {#parts[1]}` })
            end)
        end)
    "#;
    let (took, failed, toast) = timed(init, "split");
    assert_eq!(failed, None, "took {took:?}");
    assert_eq!(toast.as_deref(), Some("1 1048576"));
    assert!(took < Duration::from_millis(1500), "the split held the thread {took:?}");
}

#[test]
fn a_one_class_pattern_matches_as_the_general_matcher_does() {
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "scan" }, function(host)
                local bytes = {}
                for byte = 0, 255 do bytes[#bytes + 1] = string.char(byte) end
                local subject = table.concat(bytes) .. "  aa_12 bé\240\159\152\128x " .. table.concat(bytes, "ab")
                local patterns = {
                    "a", ".", "%a", "%d", "%s", "%W", "[%d_]", "[^%s]", "[\240-\247]", "[a-c%]]",
                    "%a+", "%d*", "[ab]-", "a*", "[^%w]+", ".-",
                }
                local differ = {}
                for _, pattern in patterns do
                    local general = "()" .. pattern
                    local scanned, n = string.gsub(subject, pattern, "<%0>")
                    local matched, m = string.gsub(subject, general, "<%0>")
                    local gs, gm = {}, {}
                    for found in string.gmatch(subject, pattern) do gs[#gs + 1] = found end
                    for _, found in string.gmatch(subject, "()(" .. pattern .. ")") do gm[#gm + 1] = found end
                    local fs, fe = string.find(subject, pattern, 40)
                    local ms, me = string.find(subject, general, 40)
                    if scanned ~= matched or n ~= m or table.concat(gs, "|") ~= table.concat(gm, "|") or fs ~= ms or fe ~= me then
                        table.insert(differ, pattern)
                    end
                end
                host:toast({ variant = "info", message = `differ: {table.concat(differ, " ")}` })
            end)
        end)
    "#;
    let (_, failed, toast) = timed(init, "scan");
    assert_eq!(failed, None);
    assert_eq!(toast.as_deref(), Some("differ: "));
}

#[test]
fn format_and_bit32_edge_cases_are_defined() {
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "edges" }, function(host)
                local big, field = 2^64, 2^31 - 1
                local seen = {
                    string.format("%x", big), string.format("%X", math.huge), string.format("%o", 1e300),
                    tostring((select(2, pcall(bit32.extract, 0xff, field)))),
                    tostring((select(2, pcall(bit32.replace, 0, 1, field)))),
                    tostring((select(2, pcall(bit32.extract, 0xff, field, field)))),
                }
                host:toast({ variant = "info", message = table.concat(seen, "\n") })
            end)
        end)
    "#;
    let (_, failed, toast) = timed(init, "edges");
    assert_eq!(failed, None);
    let toast = toast.unwrap();
    let seen: Vec<&str> = toast.lines().collect();
    assert_eq!(seen[..3], ["8000000000000000", "8000000000000000", "1000000000000000000000"], "{toast}");
    for refused in &seen[3..] {
        assert!(refused.contains("trying to access non-existent bits"), "{toast}");
    }
}

#[test]
fn a_move_of_absent_elements_does_not_rehash_each_one() {
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "move" }, function(host)
                local t = {}
                for i = 1, 16383 do t[-i] = 1 end
                table.move(t, 1, 32768, 2^29, t)
                host:toast({ variant = "info", message = `{t[2^29]}` })
            end)
        end)
    "#;
    let (took, failed, toast) = timed(init, "move");
    assert_eq!(failed, None, "took {took:?}");
    assert_eq!(toast.as_deref(), Some("nil"));
    assert!(took < Duration::from_millis(1500), "the move held the thread {took:?}");
}

#[test]
fn a_gsub_over_40_kb_returns_within_the_budget() {
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "gsub" }, function(host)
                local text, count = string.gsub(string.rep("ab", 20000), ".", string.upper)
                host:toast({ variant = "info", message = `{count} {text == string.rep("AB", 20000)}` })
            end)
        end)
    "#;
    let (took, failed, toast) = timed(init, "gsub");
    assert_eq!(failed, None, "took {took:?}");
    assert_eq!(toast.as_deref(), Some("40000 true"));
}

#[test]
fn a_quadratic_pattern_is_stopped_by_the_budget() {
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "match" }, function(host)
                string.find(string.rep("a", 1024 * 1024), ".-b")
                host:toast({ variant = "info", message = "matched" })
            end)
        end)
    "#;
    let (took, failed, toast) = timed(init, "match");
    let failed = failed.expect("the pattern was stopped");
    assert!(failed.contains("Luau budget"), "{failed}");
    assert_ne!(toast.as_deref(), Some("matched"));
    assert!(took < Duration::from_millis(1500), "the pattern held the thread {took:?}");
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

#[test]
fn a_luaurc_that_is_not_json_is_refused() {
    let configs = [
        "print('\\27]0;title\\7'); return { aliases = { util = './util' } }",
        "local t = {}; t.a = t; return t",
        r#"{ "aliases": { "util": "./util" }, }"#,
        r#"[ "aliases" ]"#,
    ];
    for config in configs {
        let sources = Sources::from_files([
            ("plugin.toml", "id = \"test.luau\"\nentry = \"main.luau\""),
            ("main.luau", "return require('@util/x')"),
            ("util/x.luau", "return 1"),
            (".luaurc", config),
        ]);
        let Err(error) = define(&sources, None) else { panic!("{config} was taken") };
        assert!(error.contains("test.luau: .luaurc: a .luaurc is a JSON object"), "{config}: {error}");
    }
}

#[test]
fn a_long_pattern_match_is_stopped_at_the_budget() {
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "match" }, function(host)
                local subject = string.rep("a", 4 * 1024 * 1024 + 255)
                local pattern = "." .. string.rep("a", 4 * 1024 * 1024) .. "b"
                string.find(subject, pattern)
                host:toast({ variant = "info", message = "matched" })
            end)
        end)
    "#;
    let (took, failed, toast) = timed(init, "match");
    let failed = failed.expect("the match was stopped");
    let used: u64 = failed
        .split("used ")
        .nth(1)
        .and_then(|rest| rest.split(' ').next())
        .and_then(|ms| ms.parse().ok())
        .unwrap_or_else(|| panic!("{failed}"));
    println!("luau: carbon's pattern stopped after {used} ms of CPU, {took:?}");
    assert!(failed.contains("Luau budget") && used <= 200, "{failed} after {took:?}");
    assert_ne!(toast.as_deref(), Some("matched"));
}

#[test]
fn one_thread_compiles_a_plugin_and_the_newest_save_wins() {
    let temp = opencode_util::temp::tempdir().unwrap();
    let dir = temp.path().join("big");
    big_plugin(&dir, 300_000);
    let builds = Builds::new(std::sync::Arc::new(|| {}));
    let mut most = 0;
    for key in 1..=8 {
        assert!(builds.built("big", &dir, key, false).is_none());
        most = most.max(builds.threads());
    }
    while builds.running() {
        most = most.max(builds.threads());
        std::thread::sleep(Duration::from_millis(1));
    }
    assert_eq!(most, 1, "threads compiled at once");
    assert!(builds.built("big", &dir, 8, false).is_some_and(|built| built.is_ok()));
}

#[test]
fn a_build_holds_the_files_its_key_names() {
    let temp = opencode_util::temp::tempdir().unwrap();
    let dir = temp.path().join("plugin");
    install("hello", &dir);
    let good = fs::read(dir.join("init.luau")).unwrap();
    let key = crate::pipe::tree::light(&dir).unwrap();
    fs::write(dir.join("init.luau"), "return plugin.define(function(setup) end end").unwrap();
    let builds = Builds::new(std::sync::Arc::new(|| {}));
    assert!(builds.built("hello", &dir, key, true).is_none());
    std::thread::sleep(Duration::from_millis(100));
    fs::write(dir.join("init.luau"), &good).unwrap();
    while builds.running() {
        std::thread::sleep(Duration::from_millis(1));
    }
    let built = builds.built("hello", &dir, key, true).expect("built");
    assert!(built.is_ok(), "{:?}", built.err());
}

#[test]
fn a_build_for_a_plugin_that_went_is_dropped() {
    let temp = opencode_util::temp::tempdir().unwrap();
    let config = temp.path().join("config");
    let dir = config.join("plugins").join("big");
    big_plugin(&dir, (SOURCES as usize - 200) / 2);
    let (host, registry) = (host(), Registry::define(Vec::new(), []));
    let loader = loader(&config, temp.path());
    loader.reconcile(&dynamic(&host), &registry);
    while loader.luau_walking() {
        std::thread::sleep(Duration::from_millis(1));
    }
    loader.reconcile(&dynamic(&host), &registry);
    assert!(loader.luau_walking(), "the compilation runs");
    fs::remove_dir_all(&dir).unwrap();
    settle(&loader, &host, &registry);
    assert!(!loader.luau_ready());
    assert!(registry.entries().iter().all(|entry| entry.target.as_deref() != Some(&*dir.to_string_lossy())));
}

/// What a VM under a heap cap of `cap` bytes fails with once a call, after calls that filled its heap with live data
/// until `free` bytes were left under the cap (the allocator's count, which the latch reads), ran and made nothing.
fn holding(cap: usize, free: usize) -> Result<(), String> {
    let init = r#"
        local keep = nil
        return {
            grow = function() local node = table.create(16); node[1] = keep; keep = node end,
            idle = function() end,
        }
    "#;
    let compiled = Rc::new(vm::Compiled::new(&sources(init), "test.luau", "init.luau").unwrap());
    let vm = vm::Vm::new(&compiled, Duration::from_secs(60), cap).unwrap();
    let mlua::Value::Table(module) = vm.start(&compiled).unwrap() else { panic!("the module returns a table") };
    let (grow, idle): (mlua::Function, mlua::Function) = (module.get("grow").unwrap(), module.get("idle").unwrap());
    while vm.memory() + free < cap {
        vm.call(|| grow.call::<()>(())).unwrap();
    }
    vm.call(|| idle.call::<()>(()))
}

#[test]
fn a_plugin_runs_under_a_small_cap() {
    assert_eq!(holding(1 << 20, 200 << 10), Ok(()));
}

#[test]
fn a_plugin_holding_most_of_its_cap_runs() {
    assert_eq!(holding(4 << 20, 400 << 10), Ok(()));
}

#[test]
fn a_long_error_is_cut_and_escaped() {
    let host = host();
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "fail" }, function(host)
                error("\27]0;title\7" .. string.rep("E", 6 * 1024 * 1024), 0)
            end)
        end)
    "#;
    let registry = running(&host, define(&sources(init), None).unwrap().0);
    keymap(&host).dispatch("fail", None);
    host.app.advance(Duration::from_millis(1));
    let error = failure(&registry, "test.luau").expect("failed");
    assert!(error.len() < 4096 + 100, "{} bytes: {:?}", error.len(), error.get(..200));
    assert!(error.starts_with(r"test.luau: \u{1b}]0;title\u{7}EEE"), "{:?}", error.get(..200));
    assert!(!error.contains('\u{1b}'));
    let (message, frames) = error.split_once("\nstack traceback:\n").unwrap_or((&error, ""));
    let end = message.get(message.len().saturating_sub(60)..);
    assert!(message.ends_with(&format!("... ({} bytes)", 6 * 1024 * 1024 + 10)), "{end:?}");
    assert_eq!(frames, "\tinit.luau:5: in function <init.luau:4>");
}

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

#[test]
fn a_plugin_that_catches_running_out_of_memory_fails() {
    for catch in
        ["pcall(fill)", "xpcall(fill, function(fault) return fault end)", "coroutine.resume(coroutine.create(fill))"]
    {
        let host = host();
        let init = format!(
            r#"
            local plugin = require("@opencode/plugin")
            local keep = nil
            -- Live data up to the cap and no garbage: each node is one allocation that the next one holds.
            local function fill() while true do local node = table.create(64); node[1] = keep; keep = node end end
            return plugin.define(function(setup)
                setup:command({{ name = "drop" }}, function(host)
                    {catch}
                    keep = nil
                end)
                setup:command({{ name = "keep" }}, function(host)
                    {catch}
                end)
            end)
        "#
        );
        let registry = running(&host, define_with(&sources(&init), None, 4 << 20).unwrap().0);
        keymap(&host).dispatch("drop", None);
        host.app.advance(Duration::from_millis(1));
        assert_eq!(failure(&registry, "test.luau"), None, "{catch}");
        keymap(&host).dispatch("keep", None);
        host.app.advance(Duration::from_millis(1));
        let error = failure(&registry, "test.luau").unwrap_or_else(|| panic!("{catch}: the plugin at its cap ran on"));
        assert!(error.contains("out of memory") && error.contains("of its 4 MiB heap"), "{catch}: {error}");
    }
}

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
                    integer = tostring(integer),
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
    // Luau 740's 64-bit `integer` library, which 747 removed: no plugin comes to depend on it.
    assert_eq!(seen["integer"], "nil");
    assert!(seen["up"].contains("could not get parent of requiring context"), "{message}");
    assert!(seen["climb"].contains("could not get parent of requiring context"), "{message}");
    assert!(seen["absolute"].contains("must start with a valid prefix"), "{message}");
    assert!(seen["fs"].contains("must start with a valid prefix"), "{message}");
    assert!(seen["global"].contains("readonly"), "{message}");
    assert_eq!(seen["mine"], "own");
}

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

#[test]
fn a_value_past_the_conversion_bounds_is_refused_at_once() {
    let host = host();
    let shared = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:slot({ path = "home.footer" }, function()
                local leaf = { text = "leaf", bold = true }
                return plugin.show(plugin.column({ plugin.text({ leaf, leaf }), plugin.text({ leaf }) }))
            end)
        end)
    "#;
    let registry = running(&host, define(&sources(shared), None).unwrap().0);
    assert!(footer(&host, &registry).contains("leafleaf"));
    assert_eq!(failure(&registry, "test.luau"), None);

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
    // CPU time, which the machine's load does not stretch: a debug build reads the parts the bound allows in a tenth
    // of it, where the DAG's 2^30 leaves would never end.
    let (used, text) = cpu(|| footer(&host, &registry));
    assert!(used < Duration::from_millis(500), "{used:?}");
    let error = failure(&registry, "test.luau").expect("refused");
    assert!(error.contains("the plugin's value is refused: its tables take more than 5120000 slots"), "{error}");
    assert!(!text.contains("leaf"));

    let caught = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "big" }, function(host)
                local spans = {}
                for i = 1, 50 do spans[i] = { text = "x" } end
                -- Stored as JSON: every part of it is read, and charged.
                pcall(function() host:storageSet("big", spans) end)
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

#[test]
fn a_sparse_table_is_counted_before_its_gaps_are_filled() {
    let host = host();
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:storageKey("items")
            setup:command({ name = "sparse" }, function(host)
                local sparse = table.create(100000)
                sparse[100000] = "x"
                host:storageSet("items", sparse)
            end)
            setup:command({ name = "sequence" }, function(host)
                local sequence = {}
                for slot = 15, 1, -1 do sequence[slot] = "x" end
                host:storageSet("items", sequence)
            end)
        end)
    "#;
    // 16 parts a node: the sequence and its 15 items are exactly 16 parts.
    let limits = crate::limits::Limits { nodes: 1, ..crate::limits::Limits::default() };
    let _restore = crate::limits::set(limits);
    let registry = running(&host, define(&sources(init), None).unwrap().0);
    keymap(&host).dispatch("sequence", None);
    host.app.advance(Duration::from_millis(1));
    assert_eq!(failure(&registry, "test.luau"), None);
    let stored = host.storage.borrow().values().next().cloned().unwrap();
    assert_eq!(stored, serde_json::to_string(&["x"; 15]).unwrap());
    keymap(&host).dispatch("sparse", None);
    host.app.advance(Duration::from_millis(1));
    let error = failure(&registry, "test.luau").expect("refused");
    assert!(error.contains("more than 16 parts"), "{error}");
}

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

#[test]
fn a_luau_error_call_names_the_plugin_the_file_and_the_line() {
    let init = PROBE.replace("util.width(nil)", "error(\"boom\")");
    let error = failed_probe(&init, &[("lib/util.luau", "return {}")]);
    assert!(error.starts_with("test.luau: init.luau:6: boom"), "{error}");
}

#[test]
fn a_luau_syntax_error_names_the_plugin_the_file_and_the_line() {
    let error = define(&sources("local plugin = require(\"@opencode/plugin\")\n\nlocal = 1\n"), None).err().unwrap();
    assert!(error.starts_with("test.luau: init.luau:3: "), "{error}");
    assert!(!error.contains("syntax error"), "{error}");
}

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

#[test]
fn a_json_value_crosses_into_luau_and_back() {
    let lua = mlua::Lua::new();
    let value = serde_json::json!({
        "a": [1, null, "x", { "b": null, "c": 2.5 }], "d": { "e": [] }, "é ü": true, "n": null, "s": "ß\u{0}t",
    });
    let back = |value: &mlua::Value| decode::Decode::new().decode::<serde_json::Value>(&lua, value).unwrap();
    let crossed = json::luau(&lua, &value).unwrap();
    let expected =
        serde_json::json!({ "a": [1, null, "x", { "c": 2.5 }], "d": { "e": [] }, "é ü": true, "s": "ß\u{0}t" });
    assert_eq!(back(&crossed), expected);
    let mut deep = serde_json::json!("leaf");
    for _ in 0..500 {
        deep = serde_json::json!([deep]);
    }
    let crossed = json::luau(&lua, &deep).unwrap();
    let depth = lua.load("local v, n = ..., 0 while type(v) == 'table' do v, n = v[1], n + 1 end return n, v");
    assert_eq!(depth.call::<(u32, String)>(crossed).unwrap(), (500, "leaf".to_owned()));
}

/// The tables `source` returns, each read by the decoder as a `T` and as before, through JSON and serde: the results
/// are equal, and so are the refusals' messages; a table decoded is charged what its JSON is. Returns which of them
/// decoded (`+`) and which were refused (`-`).
fn decodes_as_serde<T>(source: &str) -> String
where
    T: serde::de::DeserializeOwned + PartialEq + std::fmt::Debug + 'static,
{
    let lua = mlua::Lua::new();
    let tables: Vec<mlua::Value> = lua.load(source).call(()).unwrap();
    let mut decoded = String::new();
    for (at, table) in tables.iter().enumerate() {
        let (mut by_hand, mut by_json) = (decode::Decode::new(), decode::Decode::new());
        let direct = by_hand.decode::<T>(&lua, table).map_err(|error| error.to_string());
        let json = by_json.decode::<serde_json::Value>(&lua, table).unwrap();
        let serde = serde_json::from_value::<T>(json.clone()).map_err(|error| error.to_string());
        assert_eq!(direct, serde, "table {} ({json})", at + 1);
        if direct.is_ok() {
            assert_eq!(by_hand.charged(), by_json.charged(), "the charges of table {} ({json})", at + 1);
        }
        decoded.push(if direct.is_ok() { '+' } else { '-' });
        eprintln!("table {}: {direct:?}", at + 1);
    }
    decoded
}

#[test]
fn a_node_tree_decodes_as_serde_reads_it() {
    let renders = r##"
        local click = { action = { type = "command", name = "x" }, on = "up" }
        local span = { text = "a", fg = "text.muted", bg = "#010203ff", bold = true, italic = true, underline = true,
            dim = true, strikethrough = true, link = "https://x" }
        local text = { type = "text", spans = { span, { text = "b", fg = "#abcdef" } }, fg = "#abcdef", wrap = "char",
            truncate = true, selectable = false, hover_fg = "accent", layout = { grow = true }, on_click = click }
        local box = { type = "box", row = true, gap = 2, padding = { 1, 2 }, justify = "space-between", align = "center",
            bg = "#11223344", layout = { grow = true }, on_click = click, border = { title = "t" },
            padding_sides = { top = 1, left = -1 }, wrap = true, overflow = "hidden", children = {
                text, { type = "slot", path = "home.footer.x" }, { type = "markdown", text = "**m**" },
                { type = "spinner", label = "l" }, { type = "box" }, { type = "text", spans = {} },
            } }
        return {
            { type = "show", node = box }, { type = "keep" }, { type = "hide" },
            { type = "show", node = { type = "text", spans = { { text = "c" } }, id = "unknown key" } },
            { type = "show", node = { type = "text", spans = {},
                on_click = { action = { type = "command", name = "x", input = "v" }, on = "down" } } },
            { type = "show", node = { type = "text", spans = {}, on_click = { action = { type = "nope" }, on = "up" } } },
            { type = "show", node = { type = "text", spans = {}, on_click = { action = { type = "command", name = "x" } } } },
            { type = "show", node = { type = "text", spans = {}, on_click = { action = click.action, on = "sideways" } } },
            { type = "show", node = { type = "nope" } },
            { type = "show", node = { type = "text" } },
            { type = "show", node = { type = "box", gap = "x" } },
            { type = "show", node = { type = "box", gap = 70000 } },
            { type = "show", node = { type = "text", spans = { { text = 1 } } } },
            { type = "show", node = { type = "text", spans = { { text = "a", fg = 5 } } } },
            { type = "show", node = { type = "text", spans = { { fg = "x" } } } },
            { type = "show", node = { type = "box", children = { { type = "box", children = { { type = "x" } } } } } },
            { type = "show", node = { type = "box", children = { a = 1 } } },
            { type = "show" }, { type = "keep", node = box }, { type = "wat" }, { node = box }, "show", 5,
        }
    "##;
    assert_eq!(decodes_as_serde::<abi::Render>(renders), "+++++------------------");
    let surfaces = r##"
        return {
            { type = "box", id = "b", row = true, gap = 1, visible = false, bg = "text.base", children = {
                { type = "text", id = "t", spans = { { text = "x", bold = true } }, hover_events = true },
                { type = "box", focusable = true, id = "f" },
                { type = "spinner", label = "s" },
            } },
            { type = "text", spans = {} },
            { type = "box", children = { { type = "text", spans = { { text = 1 } } } } },
            { type = "text", spans = { { text = "x" } }, hover_events = "yes" },
        }
    "##;
    assert_eq!(decodes_as_serde::<abi::v2::Node>(surfaces), "++--");
}

#[test]
fn each_refusal_of_the_decoder_names_its_cause() {
    let lua = mlua::Lua::new();
    let refused = |source: &str| -> Vec<String> {
        let value: mlua::Value = lua.load(source).call(()).unwrap();
        let as_json = decode::Decode::new().decode::<serde_json::Value>(&lua, &value);
        let as_render = decode::Decode::new().decode::<abi::Render>(&lua, &value);
        [as_json.map(drop), as_render.map(drop)]
            .into_iter()
            .map(|refusal| match refusal {
                Err(decode::Refused::Bound(why)) => format!("bound: {why}"),
                Err(decode::Refused::Value(why)) => format!("value: {why}"),
                Ok(()) => "decoded".to_owned(),
            })
            .collect()
    };
    let node = |inner: &str| format!("return {{ type = 'show', node = {{ type = 'text', spans = {{ {inner} }} }} }}");
    // Boxes in boxes: each is two tables deep, so 70 of them pass the 128 a value may nest.
    let boxes = format!("{}{{ type = 'box' }}{}", "{ type = 'box', children = { ".repeat(70), " } }".repeat(70));
    let deep = format!("return {{ type = 'show', node = {boxes} }}");
    assert_eq!(refused(&deep), ["bound: its tables nest more than 128 deep"; 2]);
    let cases = [
        (node("{ text = '\\255' }"), "value: a string that is not UTF-8"),
        (node("{ text = 'x', ['\\255'] = 1 }"), "value: a key that is not UTF-8"),
        (node("{ text = print }"), "value: a function cannot cross to the host"),
        (node("{ text = 'x', [true] = 1 }"), "value: a key of type value"),
        (node("{ text = 0/0 }"), "value: NaN is not a finite number"),
    ];
    for (source, why) in cases {
        assert_eq!(refused(&source), [why; 2], "{source}");
    }
    let text = crate::limits::Limits { plugin_content: 8, ..crate::limits::Limits::default() };
    let restore = crate::limits::set(text);
    assert_eq!(refused(&node("{ text = 'more than 8' }")), ["bound: its text is more than 8 bytes"; 2]);
    drop(restore);
    let _restore = crate::limits::set(crate::limits::Limits { nodes: 1, ..crate::limits::Limits::default() });
    let parts = format!(
        "return {{ type = 'show', node = {{ type = 'box', children = {{ {} }} }} }}",
        "{ type = 'box' }, ".repeat(20)
    );
    assert_eq!(refused(&parts), ["bound: it holds more than 16 parts"; 2]);
}

/// The plugin of `body`, a command `check` that toasts what it finds, run once on a fresh host: its toasts, and why it
/// failed if it did.
fn checked(body: &str) -> (Vec<String>, Option<String>) {
    let host = host();
    let init = format!(
        r#"
        local plugin = require("@opencode/plugin")
        local json = plugin.json
        return plugin.define(function(setup)
            setup:command({{ name = "check" }}, function(host)
                local function say(message: string) host:toast({{ variant = "info", message = message }}) end
                {body}
            end)
        end)
    "#
    );
    let registry = running(&host, define(&sources(&init), None).unwrap().0);
    keymap(&host).dispatch("check", None);
    host.app.advance(Duration::from_millis(1));
    let toasts = host.toasts.borrow().iter().map(|toast| toast.message.clone()).collect();
    (toasts, failure(&registry, "test.luau"))
}

#[test]
fn plugin_json_reads_and_writes_json_as_the_host_does() {
    let (toasts, failed) = checked(
        r#"
        local value, err = json.decode('{"a":"\\u00e9\\n\\"q\\" \\ud83d\\ude00","b":[1,null,{}],"c":null,"d":[],"e":1.5}')
        assert(err == nil, err)
        assert(value.a == "é\n\"q\" 😀", value.a)
        assert(value.b[1] == 1 and value.b[2] == json.null and #value.b == 3 and value.c == nil and value.e == 1.5)
        assert(json.isArray(value.b) and json.isArray(value.d) and not json.isArray(value.b[3]) and not json.isArray(value))
        local nulls = json.decode('{"c":null,"l":[null]}', { null = true })
        assert(nulls.c == json.null and nulls.l[1] == json.null)
        assert(json.decode("null", { null = true }) == json.null and json.decode("null") == nil)
        local bad, why = json.decode("{")
        assert(bad == nil and why:find("EOF"), why)
        say(json.encode(value))
        say(json.encode({ empty = {}, object = json.object({}), array = json.array({}), keys = json.object({ "x" }),
            list = { 1, json.null, "\u{1}" }, mixed = { 1, k = 2 } }))
        local ok, failure = pcall(json.encode, { f = print })
        assert(not ok and tostring(failure):find("a function cannot cross"), tostring(failure))
        local rows = { { k = 2, n = "a" }, { k = 1, n = "b" }, { k = 2, n = "c" }, { k = 1, n = "d" }, { k = 0, n = "e" } }
        assert(plugin.sort(rows, function(x, y) return x.k < y.k end) == rows)
        local names = {}
        for index, row in rows do names[index] = row.n end
        assert(table.concat(names) == "ebdac", table.concat(names))
        local many = {}
        for index = 1, 100 do many[index] = { k = index % 3, n = index } end
        plugin.sort(many, function(x, y) return x.k < y.k end)
        for index = 2, 100 do
            local a, b = many[index - 1], many[index]
            assert(a.k < b.k or (a.k == b.k and a.n < b.n), `{index}`)
        end
        assert(table.concat(plugin.sort({ 3, 1, 2 })) == "123" and #plugin.sort({}) == 0)
        say("ok")
    "#,
    );
    assert_eq!(failed, None);
    let json = |text: &str| serde_json::from_str::<serde_json::Value>(text).unwrap();
    assert_eq!(json(&toasts[0]), serde_json::json!({ "a": "é\n\"q\" 😀", "b": [1, null, {}], "d": [], "e": 1.5 }));
    let written = serde_json::json!({
        "empty": [], "object": {}, "array": [], "keys": { "1": "x" }, "list": [1, null, "\u{1}"], "mixed": { "1": 1, "k": 2 },
    });
    assert_eq!(json(&toasts[1]), written);
    assert_eq!(toasts[2], "ok");
}

#[test]
fn plugin_json_holds_to_the_bounds() {
    let text = crate::limits::Limits { plugin_content: 64, ..crate::limits::Limits::default() };
    let restore = crate::limits::set(text);
    let (toasts, failed) = checked(
        r#"
        local _, text = json.decode('"' .. string.rep("x", 70) .. '"')
        assert(text == "its text is more than 64 bytes", text)
        say("text")
    "#,
    );
    assert_eq!(toasts.first().map(String::as_str), Some("text"), "{failed:?}");
    drop(restore);
    let parts = crate::limits::Limits { nodes: 1, ..crate::limits::Limits::default() };
    let restore = crate::limits::set(parts);
    let (toasts, failed) = checked(
        r#"
        local _, deep = json.decode(string.rep("[", 200) .. string.rep("]", 200))
        assert(deep == "recursion limit exceeded at line 1 column 128", deep)
        local _, parts = json.decode("[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17]")
        assert(parts == "it holds more than 16 parts", parts)
        say("bounds")
    "#,
    );
    assert_eq!(toasts.first().map(String::as_str), Some("bounds"), "{failed:?}");
    drop(restore);
    // A failed call's effects do not apply: neither toast shows.
    let (toasts, failed) = checked(
        r#"
        local nested = {}
        for _ = 1, 200 do nested = { nested } end
        say("before the refusal")
        pcall(json.encode, nested)
        say("after the refusal")
    "#,
    );
    assert!(
        failed.is_some_and(|error| error.contains("the plugin's value is refused: its tables nest more than 128 deep"))
    );
    assert!(toasts.iter().all(|toast| !toast.ends_with("the refusal")), "{toasts:?}");
}

#[test]
fn an_empty_object_and_an_empty_array_cross_as_themselves() {
    let host = host();
    let init = r#"
        local plugin = require("@opencode/plugin")
        local json = plugin.json
        return plugin.define(function(setup)
            setup:command({ name = "send" }, function(host)
                local body = { tags = json.object({}), list = {}, nested = { json.object({}), json.array({}) } }
                local reply = host:fetch({ method = "POST", path = "/x", body = body })
                local kinds = `{json.isArray(reply.tags)} {json.isArray(reply.list)} {json.isArray(reply)}`
                host:toast({ variant = "info", message = `{kinds} {json.encode(reply)}` })
            end)
        end)
    "#;
    let registry = running(&host, define(&sources(init), None).unwrap().0);
    keymap(&host).dispatch("send", None);
    host.app.advance(Duration::from_millis(1));
    let fetches = std::mem::take(&mut *host.fetches.borrow_mut());
    let [(fetch, reply)] = <[_; 1]>::try_from(fetches).unwrap_or_else(|_| panic!("one fetch"));
    assert_eq!(fetch.body, Some(serde_json::json!({ "tags": {}, "list": [], "nested": [{}, []] })));
    reply(Ok(serde_json::json!({ "tags": {}, "list": [] })));
    host.app.advance(Duration::from_millis(1));
    assert_eq!(failure(&registry, "test.luau"), None);
    let toast = host.toasts.borrow().last().map(|toast| toast.message.clone()).unwrap_or_default();
    let (kinds, written) = toast.split_at(toast.find('{').unwrap_or(0));
    assert_eq!(kinds, "false true false ");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(written).unwrap(),
        serde_json::json!({ "tags": {}, "list": [] })
    );
}

/// Builds `node` in Luau with `build` (which sets the local `node`), and renders it in the footer: the plugin's
/// failure, if any, and the CPU time the render took.
fn render_built(build: &str) -> (Option<String>, Duration) {
    let host = host();
    let init = format!(
        r#"
        local plugin = require("@opencode/plugin")
        local node
        {build}
        return plugin.define(function(setup)
            setup:slot({{ path = "home.footer" }}, function()
                return plugin.show(node)
            end)
        end)
    "#
    );
    let registry = running(&host, define(&sources(&init), None).unwrap().0);
    let (used, _) = cpu(|| footer(&host, &registry));
    (failure(&registry, "test.luau"), used)
}

/// The trees of the work bound's rows: a DAG of 20 levels, a 1M-slot sparse table shared 1,000 times, and a binary tree
/// of 16 levels whose every box the hand decoder gives up after its children, for a key serde ignores.
const DAG: &str = r#"
    node = { type = "text", spans = { { text = "leaf" } } }
    for _ = 1, 20 do node = { type = "box", children = { node, node } } end
"#;
const SPARSE: &str = r#"
    -- One child in a 1M-slot array part: a walk of it scans every slot. 16 MiB, under the VM's cap.
    local sparse = table.create(1048576)
    sparse[1] = { type = "text", spans = {} }
    node = { type = "box", children = table.create(1000, { type = "box", children = sparse }) }
"#;
const LATE: &str = r#"
    -- A key the hand decoder does not know, which Luau walks after `children`: it gives up only once the children are
    -- read, and serde reads them again.
    local late
    for _, name in { "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s" } do
        local probe, seen = { type = "box", children = {}, [name] = true }, false
        for key in probe do
            if key == "children" then seen = true elseif key == name and seen then late = name end
        end
        if late then break end
    end
    assert(late, "no key walked after children")
    node = { type = "text", spans = { { text = "leaf" } } }
    for _ = 1, 16 do node = { type = "box", children = { node, node }, [late] = true } end
"#;

#[test]
fn a_decode_that_walks_its_tables_again_and_again_is_refused() {
    for (name, build) in [("dag", DAG), ("sparse", SPARSE), ("late", LATE)] {
        let (failed, _) = render_built(build);
        let bound = "the plugin's value is refused: its tables take more than 5120000 slots to read";
        assert!(failed.as_ref().is_some_and(|error| error.contains(bound)), "{name}: {failed:?}");
    }
    // The same sparse table, as a value of any type: serde's walks count too.
    let (_, failed) = checked(
        r#"
        local sparse = table.create(1048576)
        sparse[1] = 1
        host:storageSet("k", table.create(1000, sparse))
    "#,
    );
    assert!(failed.is_some_and(|error| error.contains("slots to read")));
    let lua = mlua::Lua::new();
    let heavy = lua.load(
        r#"
        local rows = {}
        for i = 1, 200 do
            rows[i] = { type = "text", spans = { { text = "row ", fg = "text.muted" }, { text = tostring(i), bold = true } } }
        end
        return { type = "show", node = { type = "box", row = false, children = rows } }
    "#,
    );
    let heavy: mlua::Value = heavy.call(()).unwrap();
    let mut decode = decode::Decode::new();
    assert!(decode.decode::<abi::Render>(&lua, &heavy).is_ok());
    assert!(decode.walked() * 100 < 5_120_000, "the output-heavy render walked {} slots", decode.walked());
}

#[test]
fn a_tables_slots_are_read_from_its_header() {
    let lua = mlua::Lua::new();
    let tables: Vec<mlua::Table> = lua
        .load("return { table.create(1000), { a = 1, b = 2, c = 3 }, {}, { 1, 2, 3, x = 1 }, table.create(7, 0) }")
        .call(())
        .unwrap();
    let slots: Vec<u64> = tables.iter().map(|table| decode::slots(&lua, table)).collect();
    assert_eq!(slots, [1001, 4, 1, 4, 8]);
}

#[test]
fn each_kept_color_token_is_a_theme_token() {
    let theme =
        opencode_ui::theme::Catalog::default().load("opencode", opencode_ui::theme::ThemeMode::Dark).unwrap().theme;
    let unknown: Vec<_> = decode::TOKENS.iter().filter(|token| theme.get(token).is_none()).collect();
    assert!(unknown.is_empty(), "{unknown:?}");
}

#[test]
fn a_reused_input_list_holds_only_the_running_calls_items() {
    let init = r#"
        local plugin = require("@opencode/plugin")
        local sessions, messages = {}, {}
        local function pairs(list)
            local out = {}
            for i, pair in list do out[i] = `{pair[1]}/{pair[2]}` end
            return table.concat(out, ",")
        end
        return plugin.define(function(setup)
            setup:slot({ path = "home.footer" }, function(_read, _input, changed)
                sessions = changed.sessions or sessions
                messages = changed.messages or messages
                local now = if changed.sessions then table.concat(changed.sessions, ",") else "nil"
                local text = `{now} {table.concat(sessions, ",")} {#sessions} {pairs(messages)} {#messages}`
                    .. `{if changed["local"] then " local" else ""}`
                return plugin.show(plugin.text(text))
            end)
        end)
    "#;
    let mut registered = abi::Registered::new("test.luau", None);
    let compiled = Rc::new(vm::Compiled::new(&sources(init), "test.luau", "init.luau").unwrap());
    let _plugin = bind::setup(&compiled, &mut registered.setup(), Duration::from_millis(100), MEMORY, None).unwrap();
    let (_, _, render) = registered.renders().next().unwrap();
    let shown = |sessions: &[&str], messages: &[(&str, &str)], local: bool| {
        let changed = abi::Changed {
            local,
            sessions: sessions.iter().map(|id| id.to_string()).collect(),
            messages: messages.iter().map(|(session, message)| (session.to_string(), message.to_string())).collect(),
            ..abi::Changed::default()
        };
        match render(&Nop, &abi::SlotInput::default(), &changed) {
            abi::Render::Show(abi::Node::Text { spans, .. }) => spans[0].text.clone(),
            other => panic!("{other:?}"),
        }
    };
    assert_eq!(shown(&["a", "b", "c"], &[("a", "1"), ("b", "2")], false), "a,b,c a,b,c 3 a/1,b/2 2");
    assert_eq!(shown(&["a", "c"], &[("a", "1"), ("b", "3")], false), "a,c a,c 2 a/1,b/3 2");
    // Back to items an earlier call had at those slots: what the tables hold is the last call's, not that one's.
    assert_eq!(shown(&["a", "b"], &[("a", "1"), ("b", "2")], false), "a,b a,b 2 a/1,b/2 2");
    assert_eq!(shown(&["c", "a", "d"], &[("b", "3")], false), "c,a,d c,a,d 3 b/3 1");
    // Emptied: `nil` in `changed`, and the kept tables are empty.
    assert_eq!(shown(&[], &[], false), "nil  0  0");
    assert_eq!(shown(&["d"], &[("d", "4")], false), "d d 1 d/4 1");
    assert_eq!(shown(&["d"], &[("d", "4")], true), "d d 1 d/4 1 local");
    assert_eq!(shown(&["d", "e"], &[("d", "4")], true), "d,e d,e 2 d/4 1 local");
}

/// A host that reads nothing, does nothing, and takes every fetch without answering it.
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
        Ok(abi::RequestId(1))
    }
    fn dialog(&self, _: abi::Dialog) {}
    fn copy(&self, _: &str, _: Option<abi::Action>) {}
}

/// `examples/hello`'s Rust source: a command and a footer claim.
fn hello(setup: &mut abi::Setup) -> Result<(), String> {
    let command = abi::Command::new("hello.greet").title("Say hello").palette();
    setup.command(command, |host, _| host.toast(abi::Toast::new(abi::Variant::Success, "Hello from a plugin")));
    setup.slot(abi::Placement::append("home.footer"), |_, _, _| {
        let text = abi::Node::text([abi::Span::new("hello").fg("text.muted")]);
        abi::Render::Show(text.on_click(abi::Click::command("hello.greet")))
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
        let ran = each(rounds, || {
            let _ = command(&Nop, None);
        });
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
    for name in ["hello", "counter"] {
        let sources = Sources::read(&example(name)).unwrap();
        println!("idle VM {name}: {} bytes", idle_memory(&sources).unwrap());
    }
    let start = Instant::now();
    let sources = Sources::read(&example("counter")).unwrap();
    let _ = define(&sources, None).unwrap();
    println!("compile counter: {:?}", start.elapsed());
}

/// A VM under the carrier's cap that keeps about `mib` MiB of strings, then makes 2M small tables of garbage in one
/// call with no budget to speak of: the live bytes after a full collection, and how the garbage call ended. The
/// collector runs at the fixed goal `goal` (Luau's single goal, the goal by heap size unset), or at the pace
/// [`vm::Vm::new`] sets.
fn churn(goal: Option<i32>, mib: usize) -> (usize, Result<(), String>) {
    let init = r#"
        local keep = {}
        return {
            build = function(mib) for i = 1, mib * 1024 do keep[i] = string.rep("x", 1000) .. i end end,
            churn = function() for i = 1, 2000000 do local t = { i } end end,
        }
    "#;
    let compiled = Rc::new(vm::Compiled::new(&sources(init), "test.luau", "init.luau").unwrap());
    let vm = vm::Vm::new(&compiled, Duration::from_secs(600), MEMORY).unwrap();
    if let Some(goal) = goal {
        vm.lua.gc_set_mode(mlua::state::GcMode::Incremental(mlua::state::GcIncParams::default().goal(goal)));
        // SAFETY: `lua_gc` only sets the collector's parameters: a threshold of 0 unsets the goal by heap size.
        #[allow(unsafe_code)]
        unsafe {
            vm.lua
                .exec_raw::<()>((), |state| {
                    mlua::ffi::lua_gc(state, 12, 0);
                })
                .unwrap();
        }
    }
    let mlua::Value::Table(module) = vm.start(&compiled).unwrap() else { panic!("the module returns a table") };
    let (build, garbage): (mlua::Function, mlua::Function) =
        (module.get("build").unwrap(), module.get("churn").unwrap());
    vm.call(|| build.call::<()>(mib)).unwrap();
    vm.lua.gc_collect().unwrap();
    (vm.memory(), vm.call(|| garbage.call::<()>(())))
}

#[test]
fn a_plugin_with_most_of_its_cap_live_can_make_garbage() {
    let (live, churned) = churn(None, MIB_HELD);
    assert!(live > 22 << 20, "{live} bytes live");
    assert_eq!(churned, Ok(()));
}

/// The MiB of strings [`a_plugin_with_most_of_its_cap_live_can_make_garbage`] keeps: about 23 MiB live with the table
/// that holds them.
const MIB_HELD: usize = 21;

// The effective heap cap, printed (luau-safety 4, safety-audit #10): the most live data with which a plugin that makes
// garbage still runs, at Luau's default goal, at `luau-safety`'s fixed 125, and at the carrier's pace. Run with
// `--ignored --nocapture`.
#[test]
#[ignore]
fn measure_the_effective_heap_cap() {
    for goal in [Some(200), Some(125), None] {
        for mib in 10..=30 {
            let start = Instant::now();
            let (live, churned) = churn(goal, mib);
            println!("goal {goal:?}: {live} bytes live, {:?}: {churned:?}", start.elapsed());
            if churned.is_err() {
                break;
            }
        }
    }
}

#[test]
fn a_luau_plugin_reads_the_features_and_centers_its_dialogs() {
    let host = host();
    let registry = tasking(
        &host,
        r#"
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
"#,
    );
    host.keymap().dispatch("luau.features", None);
    host.keymap().dispatch("luau.dialogs", None);
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

#[test]
fn a_luau_plugin_reads_the_host_facts_and_fills_its_prompt() {
    let host = host();
    let registry = tasking(
        &host,
        r#"
    setup:command({ name = "luau.facts", slash = "luau-facts", aliases = { "lf" } }, function(host)
        local measure = host:measure("ab日")
        host:toast({ variant = "info", message = `{host:info().locale} {host:utcOffset(0)} {measure.cells} {measure.graphemes}` })
        host:dialog({ type = "prompt", title = "name", value = "luau", description = "described",
            action = plugin.command("luau.facts") })
    end)
"#,
    );
    host.keymap().dispatch("luau.facts", None);
    host.app.advance(Duration::from_millis(1));
    assert_eq!(said(&host), ["nb-NO 3600 4 3"]);
    let dialogs: Vec<abi::Dialog> = host.dialogs.borrow().iter().map(|(_, dialog)| dialog.clone()).collect();
    let [abi::Dialog::Prompt(prompt)] = dialogs.as_slice() else { panic!("{dialogs:?}") };
    assert_eq!((prompt.value.as_deref(), prompt.description.as_deref()), (Some("luau"), Some("described")));
    assert_eq!(failure(&registry, "test.luau"), None);
}

#[test]
fn a_luau_command_starts_disabled_and_one_declines() {
    use opentui::keymap::RunResult;
    let host = host();
    let registry = tasking(
        &host,
        r#"
    setup:command({ name = "luau.gated", enabled = false }, function(host) host:toast({ variant = "info", message = "gated" }) end)
    setup:command({ name = "luau.gate" }, function(host, input) host:setEnabled("luau.gated", input == "on") end)
    setup:command({ name = "luau.pass" }, function() return "pass" end)
    setup:command({ name = "luau.other" }, function() return "consume" end)
"#,
    );
    let dispatch = |name: &str, input: Option<&str>| {
        let result = host.keymap().dispatch(name, input);
        host.app.advance(Duration::from_millis(1));
        result
    };
    assert_eq!(dispatch("luau.gated", None), RunResult::Disabled);
    assert_eq!(dispatch("luau.gate", Some("on")), RunResult::Ok);
    assert_eq!(dispatch("luau.gated", None), RunResult::Ok);
    assert_eq!((dispatch("luau.pass", None), dispatch("luau.other", None)), (RunResult::Rejected, RunResult::Ok));
    assert_eq!(dispatch("luau.gate", Some("off")), RunResult::Ok);
    assert_eq!(dispatch("luau.gated", None), RunResult::Disabled);
    assert_eq!(said(&host), ["gated"]);
    assert_eq!(failure(&registry, "test.luau"), None);
}

/// The messages of the toasts `host` showed.
fn said(host: &TestHost) -> Vec<String> {
    host.toasts.borrow().iter().map(|toast| toast.message.clone()).collect()
}

/// Answers the fetch `host` got first with `reply`, as the server would.
fn answer(host: &TestHost, reply: Result<serde_json::Value, String>) {
    host.app.advance(Duration::from_millis(1));
    let (_, deliver) = host.fetches.borrow_mut().remove(0);
    deliver(reply);
    host.app.advance(Duration::from_millis(1));
}

/// The dialog a task showed last, and the command its close runs, with its input.
fn asked(host: &TestHost) -> (abi::Dialog, (String, Option<String>)) {
    let dialogs = host.dialogs.borrow();
    let Some((_, abi::Dialog::Dismissable { dialog, dismissed })) = dialogs.last() else { panic!("{dialogs:?}") };
    let abi::Action::Command { name, input } = dismissed.clone();
    ((**dialog).clone(), (name, input))
}

/// The command `dialog`'s answer runs.
fn answers(dialog: &abi::Dialog) -> String {
    let action = match dialog {
        abi::Dialog::Confirm(confirm) => &confirm.action,
        abi::Dialog::Select(select) => &select.action,
        abi::Dialog::Prompt(prompt) => &prompt.action,
        other => panic!("{other:?} has no answer"),
    };
    let abi::Action::Command { name, .. } = action;
    name.clone()
}

/// Runs command `name` of `host`'s keymap with `input`, and the frame after it.
fn run(host: &TestHost, name: &str, input: Option<&str>) {
    host.keymap().dispatch(name, input);
    host.app.advance(Duration::from_millis(1));
}

fn reloadable<'a>(host: &'a Rc<TestHost>, init: &'a str) -> (Rc<Registry>, impl Fn() + 'a) {
    let registry = Rc::new(Registry::define(Vec::new(), []));
    let target = registry.clone();
    let reload = move || {
        let (definition, error) = define(&sources(init), None).unwrap();
        target.load(&dynamic(host), definition.external("/plugins/test", error));
    };
    reload();
    registry.activate(&dynamic(host));
    (registry, reload)
}

/// A plugin `test.luau` whose setup body is `body`, active on `host`.
fn tasking(host: &Rc<TestHost>, body: &str) -> Rc<Registry> {
    let init =
        format!("local plugin = require(\"@opencode/plugin\")\nreturn plugin.define(function(setup)\n{body}\nend)\n");
    running(host, define(&sources(&init), None).unwrap().0)
}

#[test]
fn a_task_parks_on_a_fetch_and_goes_on_in_its_reply() {
    let host = host();
    let registry = tasking(
        &host,
        r#"
        plugin.spawn(function()
            local value = setup.host:fetch({ method = "GET", path = "/setup" })
            setup.host:toast({ variant = "info", message = "setup " .. value.name })
        end)
        setup:command({ name = "go" }, function(host)
            host:toast({ variant = "info", message = "asked" })
            local value, err = host:fetch({ method = "GET", path = "/one" })
            host:toast({ variant = "info", message = value.name .. " " .. tostring(err) })
            local again, failure = host:fetch({ method = "GET", path = "/two" })
            host:toast({ variant = "info", message = tostring(again) .. " " .. failure })
        end)
        "#,
    );
    answer(&host, Ok(serde_json::json!({ "name": "/setup" })));
    run(&host, "go", None);
    assert_eq!(said(&host), ["setup /setup", "asked"]);
    answer(&host, Ok(serde_json::json!({ "name": "/one" })));
    assert_eq!(said(&host)[2..], ["/one nil"]);
    answer(&host, Err("UnexpectedStatus: 404".to_owned()));
    assert_eq!(said(&host)[3..], ["nil UnexpectedStatus: 404"]);
    assert!(host.fetches.borrow().is_empty());
    assert_eq!(failure(&registry, "test.luau"), None);
}

#[test]
fn a_dialog_answers_its_task_and_an_escape_gives_nil() {
    let host = host();
    let registry = tasking(
        &host,
        r#"
        local function say(host, text) host:toast({ variant = "info", message = text }) end
        setup:command({ name = "ask" }, function(host)
            say(host, "confirm " .. tostring(host:confirm({ title = "Sure?", message = "Really", label = { confirm = "Yes", cancel = "No" } })))
            say(host, "prompt " .. tostring(host:prompt({ title = "Name", placeholder = "a name" })))
            host:alert({ title = "Told", message = "said" })
            say(host, "alerted")
        end)
        setup:command({ name = "pick" }, function(host)
            say(host, "pick " .. tostring(host:select({ title = "Pick", key = "rich", options = { { title = "One", value = "1" } } })))
        end)
        "#,
    );
    run(&host, "ask", None);
    let (dialog, closed) = asked(&host);
    let answer = answers(&dialog);
    let abi::Dialog::Confirm(confirm) = dialog else { panic!("{dialog:?}") };
    assert_eq!((confirm.title.as_str(), confirm.message.as_str()), ("Sure?", "Really"));
    // The host runs the answer, then the close.
    run(&host, &answer, Some("true"));
    run(&host, &closed.0, closed.1.as_deref());
    assert_eq!(said(&host), ["confirm true"]);
    let (dialog, closed) = asked(&host);
    assert!(matches!(dialog, abi::Dialog::Prompt(ref prompt) if prompt.title == "Name"), "{dialog:?}");
    run(&host, &closed.0, closed.1.as_deref());
    assert_eq!(said(&host)[1..], ["prompt nil"]);
    let (dialog, closed) = asked(&host);
    assert!(matches!(dialog, abi::Dialog::Alert(_)), "{dialog:?}");
    run(&host, &closed.0, closed.1.as_deref());
    assert_eq!(said(&host)[2..], ["alerted"]);
    // A select replaced by a confirm: the select's close answers its task `nil`, and the confirm's answer is its own.
    run(&host, "pick", None);
    let (pick, replaced) = asked(&host);
    assert!(matches!(pick, abi::Dialog::Select(select) if select.key.is_none()));
    run(&host, "ask", None);
    let (dialog, closed) = asked(&host);
    run(&host, &replaced.0, replaced.1.as_deref());
    assert_eq!(said(&host)[3..], ["pick nil"]);
    run(&host, &answers(&dialog), Some("false"));
    run(&host, &closed.0, closed.1.as_deref());
    assert_eq!(said(&host)[4..], ["confirm false"]);
    assert_eq!(failure(&registry, "test.luau"), None);
}

#[test]
fn the_guides_luau_wait_runs_as_written() {
    let guide = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/plugins.md")).unwrap();
    let body = guide
        .split("```lua\n")
        .find(|block| block.starts_with("setup:command({ name = \"x.clear\""))
        .and_then(|block| block.split("```").next())
        .expect("the guide's Luau wait");
    let host = host();
    let registry = tasking(&host, body);
    let ask = |confirmed: &str| {
        run(&host, "x.clear", None);
        let (dialog, closed) = asked(&host);
        assert!(matches!(dialog, abi::Dialog::Confirm(ref confirm) if confirm.title == "Clear?"), "{dialog:?}");
        run(&host, &answers(&dialog), Some(confirmed));
        run(&host, &closed.0, closed.1.as_deref());
    };
    ask("false");
    assert!(host.fetches.borrow().is_empty(), "a confirm that was not confirmed sent the request");
    ask("true");
    answer(&host, Err("UnexpectedStatus: 404".to_owned()));
    let (dialog, closed) = asked(&host);
    assert!(matches!(dialog, abi::Dialog::Alert(ref alert) if alert.message == "UnexpectedStatus: 404"), "{dialog:?}");
    run(&host, &closed.0, closed.1.as_deref());
    assert!(said(&host).is_empty(), "{:?}", said(&host));
    ask("true");
    answer(&host, Ok(serde_json::Value::Null));
    assert_eq!(said(&host), ["Cleared"]);
    assert_eq!(failure(&registry, "test.luau"), None);
}

#[test]
fn plugin_all_waits_for_each_of_its_tasks() {
    let host = host();
    let registry = tasking(
        &host,
        r#"
        local function get(host, path)
            return function() return host:fetch({ method = "GET", path = path }) end
        end
        setup:command({ name = "all" }, function(host)
            local values, err = plugin.all({ get(host, "/a"), get(host, "/b"), function() return 3 end })
            local text = if values then values[1].name .. values[2].name .. values[3] else "failed " .. err
            host:toast({ variant = "info", message = text })
        end)
        "#,
    );
    run(&host, "all", None);
    assert_eq!(host.fetches.borrow().len(), 2);
    host.reply();
    host.app.advance(Duration::from_millis(1));
    assert_eq!(said(&host), ["/a/b3"]);
    run(&host, "all", None);
    answer(&host, Err("Transport: down".to_owned()));
    assert!(said(&host).len() == 1, "{:?}", said(&host));
    answer(&host, Ok(serde_json::json!({ "name": "/b" })));
    assert_eq!(said(&host)[1..], ["failed Transport: down"]);
    assert_eq!(failure(&registry, "test.luau"), None);
}

#[test]
fn typed_calls_check_field_names_and_return_data() {
    let host = host();
    let registry = tasking(
        &host,
        r#"
        setup:command({ name = "call" }, function(host)
            local items, err = plugin.client.session.inbox.list({ sessionID = "ses 1" })
            local _, misspelled = plugin.client.session.inbox.list({ sesionID = "ses_1" })
            local _, unknown = plugin.client.session.nothing({ sessionID = "ses_1" })
            local created = plugin.client.session.create({})
            host:toast({ variant = "info", message = `{if items then #items else err} | {misspelled} | {unknown} | {created.id}` })
        end)
        "#,
    );
    run(&host, "call", None);
    answer(&host, Ok(serde_json::json!({ "data": [{ "id": "a" }, { "id": "b" }] })));
    let (method, path, body) = {
        let fetches = host.fetches.borrow();
        let fetch = &fetches[0].0;
        (fetch.method.clone(), fetch.path.clone(), fetch.body.clone())
    };
    assert_eq!((method.as_str(), path.as_str(), body), ("POST", "/api/session", Some(serde_json::json!({}))));
    answer(&host, Ok(serde_json::json!({ "data": { "id": "ses_new" } })));
    assert_eq!(
        said(&host),
        ["2 | session.inbox.list: no field sesionID | plugin.client has no operation session.nothing | ses_new"]
    );
    assert_eq!(failure(&registry, "test.luau"), None);
}

#[test]
fn every_operation_is_one_request_in_luau_rust_and_the_generated_client() {
    let samples: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(include_str!("client-samples.json")).unwrap();
    let names: std::collections::BTreeSet<&str> = client::names().collect();
    assert_eq!(names, samples.keys().map(String::as_str).collect(), "the table and the samples name other operations");
    // Query pairs by key, each key's values in their order: an object's keys come in another order from a Luau table.
    let sorted = |mut pairs: Vec<(String, String)>| {
        pairs.sort_by(|a, b| a.0.cmp(&b.0));
        pairs
    };
    let mut refused = Vec::new();
    for (name, input) in &samples {
        let rust = opencode_api_types::client::probe(name, input).unwrap_or_else(|| panic!("the client has no {name}"));
        let luau = client::request(name, input).map(|(fetch, _)| fetch);
        let Ok(rust) = rust else {
            assert!(luau.is_err(), "{name}: Rust has no request for it, Luau sends {luau:?}");
            refused.push(name.as_str());
            continue;
        };
        assert!(rust.error.is_none(), "{name}: {:?}", rust.error);
        let sdk = abi::call::fetch_of(&rust);
        match (sdk, luau) {
            (Ok(sdk), Ok(luau)) => {
                let generated = (rust.method.to_owned(), rust.path.clone(), sorted(rust.query.clone()));
                let generated_body = match &rust.body {
                    Some(opencode_api_types::call::Body::Json(value)) => Some(value.clone()),
                    _ => None,
                };
                for (column, fetch) in [("Rust", &sdk), ("Luau", &luau)] {
                    let request = (fetch.method.clone(), fetch.path.clone(), sorted(fetch.query.clone()));
                    assert_eq!(request, generated, "{name}: {column}'s request is not the generated client's");
                    assert_eq!(fetch.body, generated_body, "{name}: {column}'s body is not the generated client's");
                }
                assert_eq!(sdk.bytes, luau.bytes, "{name}");
            }
            (Err(_), Err(_)) => refused.push(name.as_str()),
            (sdk, luau) => panic!("{name}: Rust {sdk:?}, Luau {luau:?}"),
        }
    }
    // 169 operations; the plugin paths refuse the two streams of events, the byte upload and the three that take a
    // ticket header.
    assert_eq!((samples.len(), refused.len()), (169, 6), "refused: {refused:?}");
}

#[test]
fn an_error_in_the_lazy_prelude_names_it_and_its_line() {
    let host = host();
    let registry = tasking(&host, r#"setup:command({ name = "bad" }, function() plugin.text("x", 5) end)"#);
    run(&host, "bad", None);
    let error = failure(&registry, "test.luau").expect("the plugin failed");
    let named = error.split_once("@opencode/plugin:").map(|(_, rest)| rest.split(':').next().unwrap_or_default());
    assert!(named.is_some_and(|line| line.parse::<u32>().is_ok()), "{error}");
}

#[test]
fn host_makes_a_binding_at_its_first_lookup_and_keeps_it() {
    let host = host();
    let body = r#"setup:command({ name = "look" }, function(host)
        assert(rawget(host, "toast") == nil, "toast was made before its lookup")
        local toast = host.toast
        assert(type(toast) == "function" and rawget(host, "toast") == toast, "toast was not kept")
        assert(host.nothing == nil and host.call == nil and host.timer == nil, "a name with no binding has one")
        assert(host.owner == nil and host.setOwner == nil, "owner or setOwner came back")
        error("looked")
    end)"#;
    let registry = tasking(&host, body);
    run(&host, "look", None);
    let error = failure(&registry, "test.luau").expect("the command ran to its end");
    assert!(error.contains("looked"), "{error}");
}

#[test]
fn a_wait_outside_a_task_is_refused() {
    let host = host();
    let registry = tasking(
        &host,
        r#"
        local host = setup.host
        setup:slot({ path = "home.footer" }, function()
            host:confirm({ title = "no", message = "no" })
            return plugin.show(plugin.text("drawn"))
        end)
        "#,
    );
    let text = footer(&host, &registry);
    let error = failure(&registry, "test.luau").expect("the render failed");
    assert!(error.contains("init.luau:6: host:confirm waits, and only a task can"), "{error}");
    assert!(!text.contains("drawn"), "{text}");
    let failed = define(&sources(
        "local plugin = require(\"@opencode/plugin\")\nreturn plugin.define(function(setup)\n    setup.host:fetch({ method = \"GET\", path = \"/x\" })\nend)\n",
    ), None)
    .unwrap()
    .0;
    let registry = running(&host, failed);
    let error = failure(&registry, "test.luau").expect("setup failed");
    assert!(error.contains("init.luau:3: host:fetch waits"), "{error}");
}

#[test]
fn the_cpu_budget_holds_for_each_stretch_of_a_task() {
    let host = host();
    let body = r#"
        local function spin(seconds) local start = os.clock() while os.clock() - start < seconds do end end
        setup:command({ name = "twice" }, function(host)
            spin(0.06)
            host:fetch({ method = "GET", path = "/x" })
            spin(0.06)
            host:toast({ variant = "info", message = "both" })
        end)
        setup:command({ name = "spin" }, function(host)
            host:fetch({ method = "GET", path = "/x" })
            host:toast({ variant = "info", message = "spun" })
            while true do end
        end)
        setup:command({ name = "raise" }, function(host)
            host:fetch({ method = "GET", path = "/x" })
            error("after the reply")
        end)
    "#;
    let registry = tasking(&host, body);
    run(&host, "twice", None);
    host.reply();
    host.app.advance(Duration::from_millis(1));
    assert_eq!(said(&host), ["both"]);
    assert_eq!(failure(&registry, "test.luau"), None);
    run(&host, "spin", None);
    host.reply();
    host.app.advance(Duration::from_millis(1));
    let error = failure(&registry, "test.luau").expect("the spin was stopped");
    assert!(error.contains("Luau budget"), "{error}");
    assert!(!said(&host).contains(&"spun".to_owned()), "{:?}", said(&host));
    let registry = tasking(&host, body);
    run(&host, "raise", None);
    host.reply();
    host.app.advance(Duration::from_millis(1));
    let error = failure(&registry, "test.luau").expect("the error failed the plugin");
    assert!(error.contains("init.luau:") && error.contains("after the reply"), "{error}");
}

#[test]
fn a_parked_task_is_dropped_with_its_activation() {
    let host = host();
    let init = r#"local plugin = require("@opencode/plugin")
return plugin.define(function(setup)
    setup:command({ name = "wait" }, function(host)
        host:fetch({ method = "GET", path = "/x" })
        host:toast({ variant = "info", message = "resumed" })
    end)
    setup:command({ name = "ask" }, function(host)
        host:confirm({ title = "t", message = "m" })
        host:toast({ variant = "info", message = "answered" })
    end)
end)
"#;
    let (registry, reload) = reloadable(&host, init);
    run(&host, "wait", None);
    // A reload: the new build sets up, the old one stops.
    reload();
    host.reply();
    host.app.advance(Duration::from_millis(1));
    assert!(said(&host).is_empty(), "{:?}", said(&host));
    // The new activation's own task goes on.
    run(&host, "wait", None);
    host.reply();
    host.app.advance(Duration::from_millis(1));
    assert_eq!(said(&host), ["resumed"]);
    // Disabled while a fetch and a dialog wait.
    run(&host, "wait", None);
    run(&host, "ask", None);
    let (dialog, closed) = asked(&host);
    assert!(registry.set_active(&dynamic(&host), "test.luau", false));
    host.reply();
    run(&host, &answers(&dialog), Some("true"));
    run(&host, &closed.0, closed.1.as_deref());
    assert_eq!(said(&host), ["resumed"]);
    assert_eq!(failure(&registry, "test.luau"), None);
}

#[test]
fn a_parked_tasks_mount_input_is_its_own() {
    let host = host();
    let registry = tasking(
        &host,
        r#"
        setup:slot({ path = "home.footer" }, function() return plugin.show(plugin.text("x")) end)
        setup:onMount({ path = "home.footer" }, function(host, input, mounted)
            if not mounted then return end
            host:fetch({ method = "GET", path = "/x" })
            host:toast({ variant = "info", message = tostring(input.session_id) })
        end)
        "#,
    );
    let parent = View::new(host.app());
    let input = |id: &str| SlotInput { session_id: Some(id.to_owned()), ..SlotInput::default() };
    let _first = registry.mount(&*host, &parent, slot::HOME_FOOTER, &input("ses_a"), |_| {});
    let _second = registry.mount(&*host, &parent, slot::HOME_FOOTER, &input("ses_b"), |_| {});
    host.app.advance(Duration::from_millis(1));
    host.reply();
    host.app.advance(Duration::from_millis(1));
    assert_eq!(said(&host), ["ses_a", "ses_b"]);
    assert_eq!(failure(&registry, "test.luau"), None);
}

#[test]
fn a_plugin_parks_at_most_256_tasks() {
    let host = host();
    let registry = tasking(
        &host,
        r#"
        setup:command({ name = "many" }, function(host, input)
            for _ = 1, tonumber(input) :: number do
                plugin.spawn(function() host:fetch({ method = "GET", path = "/x" }) end)
            end
        end)
        "#,
    );
    run(&host, "many", Some("256"));
    assert_eq!((host.fetches.borrow().len(), failure(&registry, "test.luau")), (256, None));
    // Tasks that went on no longer count.
    host.reply();
    host.app.advance(Duration::from_millis(1));
    run(&host, "many", Some("256"));
    assert_eq!((host.fetches.borrow().len(), failure(&registry, "test.luau")), (256, None));
    run(&host, "many", Some("1"));
    let error = failure(&registry, "test.luau").expect("the 257th wait failed");
    assert!(error.contains("host:fetch: more than 256 tasks of the plugin wait"), "{error}");
}

#[test]
fn a_key_handler_that_waits_takes_its_key() {
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:layer({ scope = "global", keys = { { key = "x", name = "wait" }, { key = "y", name = "pass" } } }, function(host, event)
                if event.bind == "wait" then
                    host:fetch({ method = "GET", path = "/x" })
                end
                return "pass"
            end)
        end)
    "#;
    let mut registered = abi::Registered::new("test.luau", None);
    let compiled = Rc::new(vm::Compiled::new(&sources(init), "test.luau", "init.luau").unwrap());
    let _plugin = bind::setup(&compiled, &mut registered.setup(), Duration::from_millis(100), MEMORY, None).unwrap();
    let handler = registered.layers()[0].1.clone();
    let key = |bind: &str| -> abi::interact::Event {
        serde_json::from_value(serde_json::json!({ "type": "key", "key": "x", "bind": bind })).unwrap()
    };
    assert_eq!(handler(&Nop, &key("wait")), abi::interact::Handled::Consume);
    assert_eq!(handler(&Nop, &key("pass")), abi::interact::Handled::Pass);
}

#[test]
fn a_wait_where_a_task_cannot_pause_raises_and_leaves_nothing_behind() {
    let init = r#"
        local plugin = require("@opencode/plugin")
        local shared = require("@self/shared")
        return plugin.define(function(setup)
            local function say(host, text) host:toast({ variant = "info", message = text }) end
            local function leak(host) host:fetch({ method = "GET", path = "/leaked" }) end
            setup:command({ name = "corrupt" }, function(host, kind)
                local ok, err
                if kind == "sort" then
                    ok, err = pcall(table.sort, { 2, 1 }, function(a, b) leak(host) return a < b end)
                elseif kind == "gsub" then
                    ok, err = pcall(string.gsub, "a", "a", function() leak(host) return "b" end)
                elseif kind == "tostring" then
                    ok, err = pcall(tostring, setmetatable({}, { __tostring = function() leak(host) return "x" end }))
                elseif kind == "xpcall" then
                    -- Luau's `xpcall` lets a task pause: the wait is a real one.
                    ok, err = xpcall(function() return host:fetch({ method = "GET", path = "/xpcall" }).name end, debug.traceback)
                else
                    shared.host = host
                    ok, err = pcall(require, "@self/waits")
                end
                say(host, `{kind} {tostring(ok)} {tostring(err)}`)
            end)
            setup:command({ name = "victim" }, function(host)
                local answer = host:confirm({ title = "Delete all?", message = "Sure?" })
                say(host, `victim_got={type(answer)}:{tostring(answer)}`)
            end)
        end)
    "#;
    let waits =
        "local shared = require(\"./shared\")\nshared.host:fetch({ method = \"GET\", path = \"/leaked\" })\nreturn {}";
    let sources = Sources::from_files([
        ("plugin.toml", "id = \"test.luau\"\ncontract = \"2.0\""),
        ("init.luau", init),
        ("shared.luau", "return {}"),
        ("waits.luau", waits),
    ]);
    for kind in ["sort", "gsub", "tostring", "require"] {
        let host = host();
        let registry = running(&host, define(&sources, None).unwrap().0);
        run(&host, "corrupt", Some(kind));
        let said_first = said(&host);
        assert!(
            said_first.len() == 1 && said_first[0].contains("cannot wait here"),
            "{kind}: {said_first:?}, fetches {}",
            host.fetches.borrow().len()
        );
        run(&host, "victim", None);
        // Nothing was asked for: no reply can reach the victim.
        assert!(host.fetches.borrow().is_empty(), "{kind}: a request was sent");
        let (dialog, closed) = asked(&host);
        run(&host, &answers(&dialog), Some("false"));
        run(&host, &closed.0, closed.1.as_deref());
        assert_eq!(said(&host)[1..], ["victim_got=boolean:false"], "{kind}");
        assert_eq!(failure(&registry, "test.luau"), None, "{kind}");
    }
    // In `xpcall` the task waits, and its reply reaches it, not a task that asked after it.
    let host = host();
    let registry = running(&host, define(&sources, None).unwrap().0);
    run(&host, "corrupt", Some("xpcall"));
    run(&host, "victim", None);
    answer(&host, Ok(serde_json::json!({ "name": "/xpcall" })));
    assert_eq!(said(&host), ["xpcall true /xpcall"]);
    let (dialog, closed) = asked(&host);
    run(&host, &answers(&dialog), Some("true"));
    run(&host, &closed.0, closed.1.as_deref());
    assert_eq!(said(&host)[1..], ["victim_got=boolean:true"]);
    assert_eq!(failure(&registry, "test.luau"), None);
}

#[test]
fn a_task_that_yields_by_itself_fails() {
    let host = host();
    let registry = tasking(&host, r#"setup:command({ name = "stray" }, function() coroutine.yield("stray") end)"#);
    run(&host, "stray", None);
    let error = failure(&registry, "test.luau").expect("the stray yield failed the plugin");
    assert!(error.contains("coroutine.yield in a task"), "{error}");
}

#[test]
fn an_answer_after_eight_replacements_reaches_its_own_dialog() {
    let host = host();
    let registry = tasking(
        &host,
        r#"
        setup:command({ name = "ask" }, function(host)
            for at = 1, 9 do
                plugin.spawn(function()
                    local answer = host:prompt({ title = `prompt {at}` })
                    host:toast({ variant = "info", message = `{at} {tostring(answer)}` })
                end)
            end
        end)
        "#,
    );
    run(&host, "ask", None);
    let dialog = |at: usize| match &host.dialogs.borrow()[at] {
        (_, abi::Dialog::Dismissable { dialog, .. }) => answers(dialog),
        other => panic!("{other:?}"),
    };
    let (first, ninth) = (dialog(0), dialog(8));
    let first_closed = match &host.dialogs.borrow()[0].1 {
        abi::Dialog::Dismissable { dismissed, .. } => dismissed.clone(),
        other => panic!("{other:?}"),
    };
    assert_ne!(first, ninth, "the ninth prompt took the first one's answer command");
    run(&host, &first, Some("first"));
    let abi::Action::Command { name, input } = first_closed;
    run(&host, &name, input.as_deref());
    assert_eq!(said(&host), ["1 first"]);
    run(&host, &ninth, Some("ninth"));
    assert_eq!(said(&host), ["1 first", "9 ninth"]);
    assert_eq!(failure(&registry, "test.luau"), None);
}

#[test]
fn plugin_sleep_waits_on_the_hosts_clock_and_every_ticks_until_false() {
    let host = host();
    let registry = tasking(
        &host,
        r#"
        local function say(host, text) host:toast({ variant = "info", message = text }) end
        setup:command({ name = "nap" }, function(host)
            say(host, "slept " .. tostring(plugin.sleep(100)))
            say(host, "short " .. tostring(plugin.sleep(1)))
        end)
        local ticks = 0
        plugin.every(1000, function(host)
            ticks += 1
            say(host, "tick " .. ticks)
            return ticks < 2
        end)
        "#,
    );
    run(&host, "nap", None);
    host.app.advance(Duration::from_millis(98));
    assert!(said(&host).is_empty(), "{:?}", said(&host));
    host.app.advance(Duration::from_millis(1));
    assert_eq!(said(&host), ["slept true"]);
    host.app.advance(Duration::from_millis(19));
    assert_eq!(said(&host), ["slept true"], "a sleep under 20 ms waited less");
    host.app.advance(Duration::from_millis(1));
    assert_eq!(said(&host), ["slept true", "short true"]);
    host.app.advance(Duration::from_millis(5000));
    assert_eq!(said(&host)[2..], ["tick 1", "tick 2"], "every ticked past its `false`");
    assert_eq!(failure(&registry, "test.luau"), None);
}

#[test]
fn a_plugin_waits_on_at_most_32_timers_which_end_with_it() {
    let host = host();
    let init = r#"local plugin = require("@opencode/plugin")
return plugin.define(function(setup)
    setup:command({ name = "many" }, function(host)
        local slept, refused = 0, nil
        for _ = 1, 33 do
            plugin.spawn(function()
                local ok, err = plugin.sleep(1000)
                if ok then
                    slept += 1
                    if slept == 32 then host:toast({ variant = "info", message = "slept 32" }) end
                else
                    host:toast({ variant = "info", message = err })
                end
            end)
        end
    end)
end)
"#;
    let (registry, reload) = reloadable(&host, init);
    run(&host, "many", None);
    assert_eq!(said(&host), ["more than 32 timers of the plugin wait"]);
    host.app.advance(Duration::from_millis(1000));
    assert_eq!(said(&host)[1..], ["slept 32"]);
    run(&host, "many", None);
    assert_eq!(said(&host)[2..], ["more than 32 timers of the plugin wait"], "the fired timers kept their places");
    // A reload: the new build has its own 32 places, and the old timers wake nothing.
    reload();
    run(&host, "many", None);
    assert_eq!(said(&host)[3..], ["more than 32 timers of the plugin wait"]);
    host.app.advance(Duration::from_millis(1000));
    assert_eq!(said(&host)[4..], ["slept 32"], "the old activation's sleeps returned");
    run(&host, "many", None);
    assert!(registry.set_active(&dynamic(&host), "test.luau", false));
    host.app.advance(Duration::from_millis(1000));
    assert_eq!(said(&host).len(), 6, "a disabled plugin's sleeps returned: {:?}", said(&host));
}

#[test]
fn plugin_sleep_keeps_a_part_of_a_millisecond_and_waits_for_ever_on_math_huge() {
    let host = host();
    let registry = tasking(
        &host,
        r#"
        setup:command({ name = "nap" }, function(host)
            plugin.spawn(function()
                plugin.sleep(math.huge)
                host:toast({ variant = "info", message = "huge" })
            end)
            plugin.sleep(20.9)
            host:toast({ variant = "info", message = "fraction" })
        end)
        "#,
    );
    // `run` lets 1 ms pass after the command.
    run(&host, "nap", None);
    host.app.advance(Duration::from_millis(18));
    assert!(said(&host).is_empty(), "{:?}", said(&host));
    host.app.advance(Duration::from_millis(1));
    assert!(said(&host).is_empty(), "20.9 ms was over at 20 ms: {:?}", said(&host));
    host.app.advance(Duration::from_millis(1));
    assert_eq!(said(&host), ["fraction"]);
    host.app.advance(Duration::from_secs(3600));
    assert_eq!(said(&host), ["fraction"], "math.huge woke");
    assert_eq!(failure(&registry, "test.luau"), None);
}
