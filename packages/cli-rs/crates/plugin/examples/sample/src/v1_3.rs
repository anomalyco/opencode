//! A plugin written against ABI 1.3 and built on the frozen 1.3 crate: the sample as it was, with a fence, a slot, a
//! route and a command. Never port it to the new API; it proves that a 1.3 plugin keeps loading and rendering.

use abi_1_3::{Command, Line, Setup, SlotKind, Span, ThemeMode, Toast, export_plugin};

fn setup(setup: &mut Setup) -> Result<(), String> {
    let host = setup.host();
    setup.storage_key("count");
    setup.command(
        Command {
            name: "sample.hello".to_owned(),
            title: "Say hello".to_owned(),
            group: Some("Sample".to_owned()),
            slash: Some("hello".to_owned()),
            keybind: None,
            palette: true,
        },
        move |_| {
            let _ = host.storage_set("count", "{\"count\":1}");
            host.toast(Toast::Success, "Hello from sample 1.3");
        },
    );
    setup.code_block("sample", |fence| {
        if fence.code.trim().is_empty() {
            return None;
        }
        let lines = fence.code.lines().map(|line| {
            vec![
                Span::new("SAMPLE 1.3 ").fg("text.muted"),
                Span::new(line.to_uppercase()).fg("markdown.heading").bold(),
            ]
        });
        Some(lines.collect())
    });
    setup.code_block("sample-mode", move |fence| {
        let mode = match host.theme_mode() {
            Some(ThemeMode::Dark) => "dark",
            Some(ThemeMode::Light) => "light",
            None => "unknown",
        };
        Some(vec![vec![Span::new(format!("sample mode {mode}, streaming {}", fence.streaming))]])
    });
    setup.slot(SlotKind::Append, "home.footer", |_| vec![vec![Span::new("sample plugin 1.3: home.footer")]]);
    setup.route("hello", || -> Vec<Line> { vec![vec![Span::new("Sample route hello").bold()]] });
    Ok(())
}

export_plugin!("sample", setup);
