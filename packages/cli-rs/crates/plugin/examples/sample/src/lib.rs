//! The sample native plugin: a command, a code-fence renderer, a slot claim, a route, and a storage key, plus a
//! fence and a command that panic, so the loader's tests can show a panic is caught. A thread of its own counts
//! ticks and wakes the host, so the slot updates itself. The `v2` feature changes
//! what it draws, so a rebuild proves hot reload. Each variant is its own feature, so cargo keeps every build.
//!
//! The fences ([`fence`]), the sidebar claim ([`slot`]), the home claims with their event handler ([`home`]), a
//! server request with a live panel ([`fetch`]), and a prompt footer claim whose mounts fetch ([`prompt`]) are on
//! the one API of ABI 1.4; with the `reads` option, the small reads and verbs of ABI 1.6 ([`reads`]). The slot rows
//! and the route are still the 1.3 surface. Callbacks reach the host only
//! through the host they are called with. The `abi-1-3` feature builds [`v1_3`] instead: a plugin written against ABI
//! 1.3, on a frozen copy of that crate; `abi-1-0-wire` exports it with the 1.0 table. The `abi-1-4` feature builds
//! [`v1_4`], a plugin written against ABI 1.4 on a frozen copy of that crate.

#![cfg_attr(any(feature = "abi-1-3", feature = "abi-1-4"), allow(dead_code, unused_imports))]

/// The `witness` feature's static constructor: the platform loader runs it as it maps the library.
#[cfg(feature = "witness")]
mod witness {
    #[used]
    #[cfg_attr(any(target_os = "linux", target_os = "android", target_os = "freebsd"), unsafe(link_section = ".init_array"))]
    #[cfg_attr(target_vendor = "apple", unsafe(link_section = "__DATA,__mod_init_func"))]
    #[cfg_attr(windows, unsafe(link_section = ".CRT$XCU"))]
    static INIT: extern "C" fn() = init;

    extern "C" fn init() {
        let path = std::env::temp_dir().join(format!("opencode-sample-witness-{}", std::process::id()));
        let file = std::fs::OpenOptions::new().create(true).append(true).open(path);
        let _ = file.and_then(|mut file| std::io::Write::write_all(&mut file, b"mapped\n"));
    }
}

mod fence;
mod fetch;
mod home;
#[cfg(feature = "p0a")]
mod p0a;
mod prompt;
mod reads;
mod slot;
#[cfg(feature = "abi-1-3")]
mod v1_3;
#[cfg(feature = "abi-1-4")]
mod v1_4;

use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread::JoinHandle;
use std::time::Duration;

use opencode_plugin_abi::{
    Command, Line, Node, Placement, Read, Render, Setup, SlotKind, Span, ThemeMode, Toast, Variant, Waker,
    export_plugin,
};
use serde_json::json;

#[cfg(feature = "p0a")]
use opencode_plugin_abi as abi;

const VERSION: &str = if cfg!(feature = "v2") { "v2" } else { "v1" };

fn setup(setup: &mut Setup) -> Result<(), String> {
    let has = |setup: &Setup, option: &str| setup.options().is_some_and(|options| options.contains(option));
    setup.storage_key("count");
    // Setup itself uses the host: storage, the theme mode, and a toast. Disposal writes `destroyed`, also when setup
    // fails after.
    if has(setup, "\"probe\":true") {
        setup.storage_key("destroyed");
        setup.on_dispose(|host| host.storage_set("destroyed", json!({ "destroyed": true })));
        let host = setup.host();
        let count = count(host);
        let mode = if host.theme_mode() == ThemeMode::Light { "light" } else { "dark" };
        host.storage_set("count", json!({ "count": count + 1 }));
        host.toast(Toast::new(Variant::Info, format!("sample setup: count {count}, {mode}, stored")));
    }
    if cfg!(feature = "setup-fails") || has(setup, "\"fail\":true") {
        return Err("sample setup failed".to_owned());
    }
    if has(setup, "\"panic\":true") {
        panic!("sample setup panicked");
    }
    // Hellos said by this instance, which the slot and the route show once the host draws them again.
    let hellos = Rc::new(Cell::new(0u64));
    let said = hellos.clone();
    setup.command(command("sample.hello", "Say hello", Some("hello")), move |host, _| {
        said.set(said.get() + 1);
        let count = count(host) + 1;
        host.storage_set("count", json!({ "count": count }));
        host.toast(Toast::new(Variant::Success, format!("Hello from sample {VERSION} ({count})")));
    });
    setup.command(command("sample.open", "Open the sample route", Some("sample")), |host, _| host.open_route("hello"));
    setup
        .command(command("sample.panic", "Panic in the sample plugin", None), |_, _| panic!("sample command panicked"));
    fence::setup(setup)?;
    slot::setup(setup)?;
    home::setup(setup)?;
    fetch::setup(setup)?;
    prompt::setup(setup)?;
    #[cfg(feature = "p0a")]
    p0a::setup(setup)?;
    if has(setup, "\"reads\":true") {
        reads::setup(setup)?;
    }
    if cfg!(feature = "pty") {
        pty(setup);
    }
    if cfg!(feature = "app") {
        setup.slot(Placement::append("app"), |_, _, _| {
            Render::Show(Node::text([Span::new("sample app: under the route")]))
        });
    }
    // Ticks every `tick_ms` (a second by default), `ticks` times (no limit by default), on a host that offers a
    // waker (ABI 1.3).
    let option = |name: &str| {
        setup
            .options()
            .and_then(|options| options.split(&format!("\"{name}\":")).nth(1))
            .and_then(|rest| rest.chars().take_while(char::is_ascii_digit).collect::<String>().parse().ok())
    };
    let (tick, limit) = (option("tick_ms").unwrap_or(1000), option("ticks").unwrap_or(u64::MAX));
    let ticks = Arc::new(AtomicU64::new(0));
    let ticker = setup
        .waker()
        .filter(|_| !cfg!(feature = "still"))
        .map(|waker| Ticker::start(waker, Duration::from_millis(tick), limit, ticks.clone()));
    let shown = hellos.clone();
    setup.slot_lines(SlotKind::Append, "home.footer", move |_| {
        let _ = &ticker;
        let (hellos, ticks) = (shown.get(), ticks.load(Ordering::Relaxed));
        let text = format!("sample plugin {VERSION}: home.footer, {hellos} hellos, {ticks} ticks");
        vec![vec![Span::new(text).fg("text.muted")]]
    });
    setup.route_lines("hello", move || -> Vec<Line> {
        vec![
            vec![Span::new("Sample route hello").bold()],
            vec![Span::new(format!("said hello {} times", hellos.get())).fg("text.muted")],
        ]
    });
    Ok(())
}

/// The commands of the P-PTY scenarios `P.0b/*`: `/p0btitle` sets the title (`parity/plugins/title/tui.ts` in TS),
/// `/p0blong` sets one of 6009 bytes,
/// `/p0brun <shell command>` runs `sh -c <command>` in the foreground, twice with `/p0btwice`, and toasts how each
/// ended and sets it as the title.
fn pty(setup: &mut Setup) {
    let title = Command { slash: Some("p0btitle".to_owned()), ..command("p0b.title", "Set the title", None) };
    setup.command(title, |host, _| host.set_title("p0b title"));
    let long = Command { slash: Some("p0blong".to_owned()), ..command("p0b.long", "Set a long title", None) };
    setup.command(long, |host, _| host.set_title(&format!("p0b long {}", "é".repeat(3000))));
    let asked = Rc::new(std::cell::RefCell::new(Vec::new()));
    for (name, times) in [("p0brun", 1), ("p0btwice", 2)] {
        let run = Command {
            slash: Some(name.to_owned()),
            arguments: true,
            ..command(&format!("p0b.{name}"), "Run a program", None)
        };
        let asked = asked.clone();
        setup.command(run, move |host, input| {
            for _ in 0..times {
                let args = vec!["-c".to_owned(), input.unwrap_or_default().to_owned()];
                let program = opencode_plugin_abi::Foreground { command: "sh".to_owned(), args, cwd: None };
                asked.borrow_mut().push(host.foreground(program));
            }
        });
    }
    setup.on_reply(move |host, id, result| {
        if asked.borrow().contains(&id) {
            let text = match result {
                Ok(value) => format!("p0b exit {value}"),
                Err(error) => format!("p0b error {error}"),
            };
            // Also as the title: a terminal's title log keeps each reply, where a later toast replaces an earlier one.
            host.set_title(&text);
            host.toast(Toast::new(Variant::Info, text));
        }
    });
}

fn command(name: &str, title: &str, slash: Option<&str>) -> Command {
    Command {
        name: name.to_owned(),
        title: title.to_owned(),
        group: Some("Sample".to_owned()),
        slash: slash.map(str::to_owned),
        keybind: None,
        palette: true,
        ..Command::default()
    }
}

/// Counts ticks on its own thread and wakes the host after each. Dropping it, when the host destroys the instance,
/// stops and joins the thread, so no wake comes after.
struct Ticker {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Ticker {
    fn start(waker: Waker, every: Duration, limit: u64, ticks: Arc<AtomicU64>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let thread = std::thread::spawn(move || {
            for _ in 0..limit {
                std::thread::park_timeout(every);
                if stopped.load(Ordering::Acquire) {
                    return;
                }
                ticks.fetch_add(1, Ordering::Relaxed);
                waker.wake();
            }
        });
        Self { stop, thread: Some(thread) }
    }
}

impl Drop for Ticker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            thread.thread().unpark();
            let _ = thread.join();
        }
    }
}

/// The stored `{"count":N}`, else 0.
fn count(host: &dyn Read) -> u64 {
    host.storage_get("count").and_then(|value| value.get("count")?.as_u64()).unwrap_or(0)
}

#[cfg(not(any(
    feature = "abi-1-0",
    feature = "abi-1-4",
    feature = "abi-1-3",
    feature = "requires-1-5",
    feature = "minor-newer",
    feature = "major-2",
    feature = "requires-future"
)))]
export_plugin!("sample", setup);

// Built against ABI 1.0: the shorter table, without `describe`.
#[cfg(feature = "abi-1-0")]
export_plugin!(@v1_0 "sample", setup);

// Needs the 1.5 host, as a plugin built around the composer asks.
#[cfg(feature = "requires-1-5")]
export_plugin!("sample", setup, requires_minor = 5);

// Built against a minor version newer than any host, without requiring it.
#[cfg(feature = "minor-newer")]
export_plugin!(@version 1, 99, 0, "sample", setup);

#[cfg(feature = "major-2")]
export_plugin!(@version 2, 0, 0, "sample", setup);

// Needs a host minor version no host has yet.
#[cfg(feature = "requires-future")]
export_plugin!(@version 1, 99, 99, "sample", setup);
