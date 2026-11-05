//! The sample native plugin: a command, a code-fence renderer, a slot claim, a route, and a storage key, plus a
//! fence and a command that panic, so the loader's tests can show a panic is caught. The `v2` feature changes
//! what it draws, so a rebuild proves hot reload. Each variant is its own feature, so cargo keeps every build.

use opencode_plugin_abi::{Command, Line, Setup, SlotKind, Span, ThemeMode, Toast, export_plugin};

const VERSION: &str = if cfg!(feature = "v2") { "v2" } else { "v1" };

fn setup(setup: &mut Setup) -> Result<(), String> {
    if setup.options().is_some_and(|options| options.contains("\"fail\":true")) {
        return Err("sample setup failed".to_owned());
    }
    let host = setup.host();
    setup.storage_key("count");
    setup.command(command("sample.hello", "Say hello", Some("hello")), move |_| {
        let count = count(host) + 1;
        if let Err(error) = host.storage_set("count", &format!("{{\"count\":{count}}}")) {
            host.log(opencode_plugin_abi::Level::Warn, &error);
        }
        host.toast(Toast::Success, &format!("Hello from sample {VERSION} ({count})"));
    });
    setup.command(command("sample.open", "Open the sample route", Some("sample")), move |_| host.open_route("hello"));
    setup.command(command("sample.panic", "Panic in the sample plugin", None), |_| panic!("sample command panicked"));
    setup.code_block("sample", |fence| {
        if fence.code.trim().is_empty() {
            return None;
        }
        let lines = fence.code.lines().map(|line| {
            vec![
                Span::new(format!("SAMPLE {VERSION} ")).fg("text.muted"),
                Span::new(line.to_uppercase()).fg("markdown.heading").bold(),
            ]
        });
        Some(lines.collect())
    });
    setup.code_block("sample-panic", |_| panic!("sample fence panicked"));
    setup.code_block("sample-mode", move |_| {
        let mode = match host.theme_mode() {
            Some(ThemeMode::Dark) => "dark",
            Some(ThemeMode::Light) => "light",
            None => "unknown",
        };
        Some(vec![vec![Span::new(format!("sample mode {mode}"))]])
    });
    setup.slot(SlotKind::Append, "home.footer", |_| {
        vec![vec![Span::new(format!("sample plugin {VERSION}: home.footer")).fg("text.muted")]]
    });
    setup.route("hello", move || -> Vec<Line> {
        vec![
            vec![Span::new("Sample route hello").bold()],
            vec![Span::new(format!("said hello {} times", count(host))).fg("text.muted")],
        ]
    });
    Ok(())
}

fn command(name: &str, title: &str, slash: Option<&str>) -> Command {
    Command {
        name: name.to_owned(),
        title: title.to_owned(),
        group: Some("Sample".to_owned()),
        slash: slash.map(str::to_owned),
        keybind: None,
        palette: true,
    }
}

/// The stored `{"count":N}`, else 0.
fn count(host: opencode_plugin_abi::Host) -> u64 {
    host.storage_get("count")
        .and_then(|json| json.chars().filter(char::is_ascii_digit).collect::<String>().parse().ok())
        .unwrap_or(0)
}

#[cfg(not(any(feature = "abi-1-0", feature = "minor-newer", feature = "major-2", feature = "requires-future")))]
export_plugin!("sample", setup);

// Built against ABI 1.0: the shorter table, without `describe`.
#[cfg(feature = "abi-1-0")]
export_plugin!(@v1_0 "sample", setup);

// Built against a minor version newer than any host, without requiring it.
#[cfg(feature = "minor-newer")]
export_plugin!(@version 1, 99, 0, "sample", setup);

#[cfg(feature = "major-2")]
export_plugin!(@version 2, 0, 0, "sample", setup);

// Needs a host minor version no host has yet.
#[cfg(feature = "requires-future")]
export_plugin!(@version 1, 99, 99, "sample", setup);
