//! The sample's code fences, on the one API (ABI 1.4). The loader's tests also compile this file into the host and
//! run it in process, so the same fence is proven on both paths. `super::VERSION` is the build's version text.

use opencode_plugin_abi::{Color, Fenced, Rgba, Setup, Span, ThemeMode};

pub fn setup(setup: &mut Setup) -> Result<(), String> {
    setup.code_block("sample", |_, fence| {
        if fence.code.trim().is_empty() {
            return Fenced::Code;
        }
        let lines = fence.code.lines().map(|line| {
            vec![
                Span::new(format!("SAMPLE {} ", super::VERSION)).fg("text.muted"),
                Span::new(line.to_uppercase()).fg("markdown.heading").bold(),
            ]
        });
        Fenced::Lines { lines: lines.collect(), fg: None, drag: false }
    });
    setup.code_block("sample-panic", |_, _| panic!("sample fence panicked"));
    setup.code_block("sample-mode", |host, _| {
        let mode = match host.theme_mode() {
            ThemeMode::Dark => "dark",
            ThemeMode::Light => "light",
        };
        Fenced::Lines { lines: vec![vec![Span::new(format!("sample mode {mode}"))]], fg: None, drag: false }
    });
    // A theme scale step read back as a color, a translucent background, a default fg, and drag scrolling.
    setup.code_block("sample-color", |host, fence| {
        let accent = host.color("categorical.3.300").map_or(Color::from("text.muted"), Color::Rgba);
        let line = vec![
            Span::new("accent ").fg(accent),
            Span { bg: Some(Rgba::new(255, 255, 255, 20).into()), ..Span::new(fence.code.trim().to_owned()) },
        ];
        Fenced::Lines { lines: vec![line], fg: Some(Rgba::new(255, 255, 255, 255).into()), drag: true }
    });
    Ok(())
}
