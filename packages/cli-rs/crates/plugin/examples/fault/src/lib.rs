//! A plugin that fails on command (synthesis 4.5, P4c). `/fault-<kind>` fails inline in the command handler
//! (`run-command`); `/fault-render-<kind>` makes the next render of its `prompt.footer` line fail (`render-slot`);
//! `/fault-thread-<kind>` fails on a thread of its own. The kinds: `panic`, `hang` (spins), `slow` (150 ms, an
//! overrun), `segv` (a null write), `abort`, `stack` (an overflow).
//!
//! Before it fails it writes the wall clock, in ns since the epoch, to `$FAULT_STAMP`, so a harness can time the
//! recovery from the fault itself.

use std::sync::atomic::{AtomicU8, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use opencode_plugin_abi::{Command, Node, Placement, Render, Setup, Span, export_plugin};

const KINDS: [&str; 6] = ["panic", "hang", "slow", "segv", "abort", "stack"];

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
        // SAFETY: none; this is the fault.
        "segv" => unsafe { std::ptr::write_volatile(std::ptr::null_mut::<u64>(), 1) },
        "abort" => std::process::abort(),
        "stack" => {
            std::hint::black_box(recurse(0));
        }
        _ => {}
    }
}

fn setup(setup: &mut Setup) -> Result<(), String> {
    let waker = setup.waker();
    let command = |name: String, title: String, slash: String| Command {
        name,
        title,
        slash: Some(slash),
        palette: true,
        ..Command::default()
    };
    for (index, kind) in KINDS.into_iter().enumerate() {
        setup.command(command(format!("fault.{kind}"), format!("Fault: {kind}"), format!("fault-{kind}")), move |_, _| {
            fire(kind)
        });
        let waker = waker.clone();
        setup.command(
            command(format!("fault.render.{kind}"), format!("Fault in render: {kind}"), format!("fault-render-{kind}")),
            move |_, _| {
                ARMED.store(index as u8 + 1, Ordering::Relaxed);
                // The line renders again, and fails.
                if let Some(waker) = &waker {
                    waker.wake();
                }
            },
        );
        setup.command(
            command(format!("fault.thread.{kind}"), format!("Fault on a thread: {kind}"), format!("fault-thread-{kind}")),
            move |_, _| {
                std::thread::spawn(move || fire(kind));
            },
        );
    }
    setup.slot(Placement::append("prompt.footer"), |_, _, _| {
        let armed = ARMED.swap(0, Ordering::Relaxed);
        if armed > 0 {
            fire(KINDS[usize::from(armed) - 1]);
        }
        Render::Show(Node::text([Span::new("fault plugin").fg("text.muted")]))
    });
    Ok(())
}

export_plugin!("example.fault", setup);
