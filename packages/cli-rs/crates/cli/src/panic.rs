//! Worker panics go to the log, leaving the renderer in control of the screen. An uncaught UI-thread panic restores
//! the terminal and exits with 101. A panic caught by the plugin host must leave both the app and its terminal
//! running.

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
