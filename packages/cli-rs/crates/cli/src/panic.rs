//! The panic hook while the TUI runs (rs-ms1-accept problem 2).
//!
//! The default hook prints over the TUI's screen, which scrolls it out of step with the renderer.
//! This one logs every panic, with its backtrace, to the CLI's log file (`telemetry`) instead. A panic
//! on another thread leaves the TUI running: tokio ends only the panicking task, and the event loop
//! reconnects. A panic on the UI thread ends the app: opentui's hook, which `App::new` installs around
//! this one, restores the terminal first, then this hook prints a short note to stderr and exits with
//! 101, the code of an unhandled Rust panic. A plugin's panic that its catch stops is not one: the TUI
//! wraps both hooks with `opencode_plugin::contain::filter_panics`, and this hook also lets it unwind.

use std::backtrace::Backtrace;

/// Installs the hook. Call it on the UI thread before the TUI's `App` is created.
pub fn install() {
    let ui = std::thread::current().id();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let backtrace = Backtrace::force_capture().to_string();
        log::error!(
            thread = thread.name().unwrap_or("<unnamed>"),
            backtrace = backtrace.as_str();
            "panic {info}"
        );
        if thread.id() != ui || opencode_plugin::contain::catching() {
            return;
        }
        match crate::telemetry::file() {
            Some(path) => eprintln!("opencode-native {info}\nThe backtrace is in {}", path.display()),
            None => eprintln!("opencode-native {info}\n{backtrace}"),
        }
        crate::telemetry::flush();
        std::process::exit(101);
    }));
}

#[cfg(test)]
mod tests {
    /// Set in the process the row starts: what panics there.
    const PROBE: &str = "OPENCODE_PANIC_PROBE";

    // Expected (P4's finding): a plugin's panic on the UI thread that the plugin host catches leaves the client
    // running. Neither the terminal's hook (a stand-in here, which prints `restored` and calls this one, as OpenTUI's
    // does) nor this hook, which exits 101, takes it for the end of the app. A panic outside plugin code still restores
    // the terminal and exits 101. Each runs in a process of its own (this test binary again): the hooks are the
    // process's.
    #[test]
    fn a_caught_plugin_panic_leaves_the_client_running() {
        if let Ok(mode) = std::env::var(PROBE) {
            super::install();
            let previous = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                eprintln!("restored");
                previous(info);
            }));
            opencode_plugin::contain::filter_panics();
            if mode == "plugin" {
                assert!(opencode_plugin::contain::catch(|| panic!("a built-in's bug")).is_err());
                println!("alive");
                std::process::exit(0);
            }
            panic!("a host bug");
        }
        let probe = |mode: &str| {
            std::process::Command::new(std::env::current_exe().unwrap())
                .args(["panic::tests::a_caught_plugin_panic_leaves_the_client_running", "--exact", "--nocapture"])
                .arg("--test-threads=1")
                .env(PROBE, mode)
                .output()
                .unwrap()
        };
        let plugin = probe("plugin");
        let (out, err) = (String::from_utf8_lossy(&plugin.stdout), String::from_utf8_lossy(&plugin.stderr));
        assert_eq!(plugin.status.code(), Some(0), "{out}\n{err}");
        assert!(out.contains("alive") && !err.contains("restored"), "{out}\n{err}");
        let host = probe("host");
        assert_eq!(host.status.code(), Some(101));
        assert!(String::from_utf8_lossy(&host.stderr).contains("restored"));
    }
}
