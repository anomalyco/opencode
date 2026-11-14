//! A plugin that fails on command (synthesis 4.5, P4c). `/fault-<kind>` fails inline in the command handler
//! (`run-command`); `/fault-render-<kind>` makes the next render of its `prompt.footer` line fail (`render-slot`);
//! `/fault-thread-<kind>` fails on a thread of its own, 300 ms later, when no call of the plugin runs. The kinds:
//! `panic`, `hang` (spins), `slow` (150 ms, an overrun), `segv` (`raise(SIGSEGV)` on Unix, a null write elsewhere),
//! `abort`, `stack` (an overflow).
//!
//! The features `b` and `c` build the same plugin as `example.fault.b` and `example.fault.c`, with commands of their
//! own (`Fault B in render: segv`, `/fault-b-segv`) and line `fault plugin b`, so a harness can crash the client with
//! three different plugins.
//!
//! Before it fails it writes the wall clock, in ns since the epoch, to `$FAULT_STAMP`, so a harness can time the
//! recovery from the fault itself.

use std::sync::atomic::{AtomicU8, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use opencode_plugin_abi::{Command, Node, Placement, Render, Setup, Span, export_plugin};

const KINDS: [&str; 6] = ["panic", "hang", "slow", "segv", "abort", "stack"];

/// The prefix of the command names, slashes and titles, and the footer line, of this build.
#[cfg(not(any(feature = "b", feature = "c")))]
const BUILD: (&str, &str, &str) = ("fault", "Fault", "fault plugin");
#[cfg(feature = "b")]
const BUILD: (&str, &str, &str) = ("fault-b", "Fault B", "fault plugin b");
#[cfg(feature = "c")]
const BUILD: (&str, &str, &str) = ("fault-c", "Fault C", "fault plugin c");

/// The fault the next render runs, as an index into `KINDS` plus one; 0 is none.
static ARMED: AtomicU8 = AtomicU8::new(0);

fn stamp() {
    if let Ok(path) = std::env::var("FAULT_STAMP") {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        let _ = std::fs::write(path, now.to_string());
    }
}

#[inline(never)]
fn recurse(depth: u64) -> u64 {
    let pad = [depth; 512];
    std::hint::black_box(&pad);
    if depth == u64::MAX { 0 } else { recurse(depth + 1) + pad[3] }
}

fn fire(kind: &str) {
    stamp();
    match kind {
        "panic" => panic!("fault: {kind}"),
        "hang" => loop {
            std::hint::spin_loop();
        },
        "slow" => std::thread::sleep(Duration::from_millis(150)),
        "segv" => segv(),
        "abort" => std::process::abort(),
        "stack" => {
            std::hint::black_box(recurse(0));
        }
        _ => {}
    }
}

/// A segmentation fault the compiler cannot reason away: the signal itself on Unix. Its default action first: Rust's
/// handler, there for stack overflows, takes a SIGSEGV that is no fault of a guard page as one to let recur, resets
/// the default and returns, and a raised signal does not recur.
#[cfg(unix)]
fn segv() {
    unsafe extern "C" {
        fn signal(signal: i32, handler: usize) -> usize;
        fn raise(signal: i32) -> i32;
    }
    // SAFETY: `signal` with `SIG_DFL` (0) and `raise` take a signal number; SIGSEGV is 11 on Linux and macOS.
    unsafe {
        signal(11, 0);
        raise(11);
    }
}

#[cfg(not(unix))]
fn segv() {
    // SAFETY: none; this is the fault.
    unsafe { std::ptr::write_volatile(std::ptr::null_mut::<u64>(), 1) }
}

fn setup(setup: &mut Setup) -> Result<(), String> {
    let (name, title, line) = BUILD;
    let waker = setup.waker();
    let command = |name: String, title: String, slash: String| Command {
        name,
        title,
        slash: Some(slash),
        palette: true,
        ..Command::default()
    };
    for (index, kind) in KINDS.into_iter().enumerate() {
        setup.command(command(format!("{name}.{kind}"), format!("{title}: {kind}"), format!("{name}-{kind}")), move |_, _| {
            fire(kind)
        });
        let waker = waker.clone();
        setup.command(
            command(format!("{name}.render.{kind}"), format!("{title} in render: {kind}"), format!("{name}-render-{kind}")),
            move |_, _| {
                ARMED.store(index as u8 + 1, Ordering::Relaxed);
                // The line renders again, and fails.
                if let Some(waker) = &waker {
                    waker.wake();
                }
            },
        );
        setup.command(
            command(format!("{name}.thread.{kind}"), format!("{title} on a thread: {kind}"), format!("{name}-thread-{kind}")),
            move |_, _| {
                // Later than the command's return, so the record names no call of the plugin when it fires.
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(300));
                    fire(kind)
                });
            },
        );
    }
    setup.slot(Placement::append("prompt.footer"), move |_, _, _| {
        let armed = ARMED.swap(0, Ordering::Relaxed);
        if armed > 0 {
            fire(KINDS[usize::from(armed) - 1]);
        }
        Render::Show(Node::text([Span::new(line).fg("text.muted")]))
    });
    Ok(())
}

#[cfg(not(any(feature = "b", feature = "c")))]
export_plugin!("example.fault", setup);
#[cfg(feature = "b")]
export_plugin!("example.fault.b", setup);
#[cfg(feature = "c")]
export_plugin!("example.fault.c", setup);
