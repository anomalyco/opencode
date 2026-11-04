//! Debug dialog (E.18a): `packages/tui/src/component/dialog-debug.tsx`.
//!
//! The facts to paste into a bug report, one per row, and a copy action (Enter, `c` under `new-designs`) that
//! puts them on the clipboard. Rows are not click-to-copy, so a mouse selection still copies a single value.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use opencode_ui::dialog::{
    DialogOptions, DialogSize, FooterAction, FooterProps, HeaderProps, footer, header, layout,
};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::prelude::*;

use crate::app::Tui;
use crate::routes::Route;

/// Like the TypeScript client, a build without `OPENCODE_VERSION` reports `local`.
pub const VERSION: &str = match option_env!("OPENCODE_VERSION") {
    Some(version) => version,
    None => "local",
};

/// The footer drawing, reached weakly from the footer's own action.
type Hook = RefCell<Option<Weak<dyn Fn()>>>;

/// The rows, in order.
pub fn entries(tui: &Tui) -> Vec<(&'static str, String)> {
    let channel = opencode_local::channel::Channels::from_env().channel;
    let session = match tui.route() {
        Route::Session { id } => id.0,
        _ => "n/a".to_owned(),
    };
    vec![
        ("Version", format!("{VERSION} ({channel})")),
        (
            "Date",
            chrono::Utc::now()
                .format("%Y-%m-%dT%H:%M:%S%.3fZ")
                .to_string(),
        ),
        ("OS", describe_os()),
        (
            "Terminal",
            describe_terminal(|name| std::env::var(name).ok()),
        ),
        ("Session ID", session),
        // The current model is E.16's (`local.model.current()`).
        ("Model", "n/a".to_owned()),
    ]
}

/// `DialogDebug`, in place of any open dialog.
pub fn show(tui: &Tui) {
    let rows = entries(tui);
    let weak = tui.weak();
    tui.dialogs.replace(
        move |cx| {
            let theme = &cx.theme;
            let body = View::new(&cx.app);
            for (label, value) in &rows {
                body.add(
                    &View::new(&cx.app)
                        .row()
                        .gap(1)
                        .child(
                            &Text::new(&cx.app, format!("{label:<10}"))
                                .fg(theme.text.muted)
                                .shrink(0.0),
                        )
                        .child(
                            &Text::new(&cx.app, value.clone())
                                .fg(theme.text.base)
                                .wrap(WrapMode::Word),
                        ),
                );
            }
            let text = rows
                .iter()
                .map(|(label, value)| format!("{label}: {value}"))
                .collect::<Vec<_>>()
                .join("\n");
            let slot = View::new(&cx.app);
            let copied = Rc::new(Cell::new(false));
            // Draws the footer; after a copy the action reads `✓ copied` in the success color.
            let hook: Rc<Hook> = Rc::default();
            let draw: Rc<dyn Fn()> = {
                let (cx, slot, copied) = (Rc::downgrade(cx), slot.clone(), copied.clone());
                let run = {
                    let (weak, copied, text) = (weak.clone(), copied.clone(), text.clone());
                    let hook = hook.clone();
                    Rc::new(move || {
                        copy(&weak, &copied, &text);
                        redraw(&weak, &hook);
                    })
                };
                Rc::new(move || {
                    let Some(cx) = cx.upgrade() else { return };
                    let mut action =
                        FooterAction::new(if copied.get() { "✓ copied" } else { "copy" })
                            .key(if cx.new_designs { "c" } else { "enter" });
                    action.on_trigger = Some(run.clone());
                    if copied.get() {
                        action.color = Some(cx.theme.text.feedback.success.base);
                    }
                    let mut props = FooterProps {
                        primary: vec![action],
                        ..FooterProps::default()
                    };
                    if !cx.new_designs {
                        props.children = vec![
                            Text::new(&cx.app, "Share this when reporting an issue.")
                                .fg(cx.theme.text.muted)
                                .as_any(),
                        ];
                    }
                    slot.clear();
                    slot.add(&footer(&cx, props));
                })
            };
            draw();
            *hook.borrow_mut() = Some(Rc::downgrade(&draw));
            {
                let (weak, copied, text) = (weak.clone(), copied.clone(), text);
                cx.layer(KeymapLayer {
                    commands: vec![
                        TuiCommand::inline(
                            if cx.new_designs { "c" } else { "return" },
                            move |_, _| {
                                copy(&weak, &copied, &text);
                                // The layer owns the footer drawing.
                                draw();
                            },
                        )
                        .title("Copy debug info")
                        .group("Dialog"),
                    ],
                    ..KeymapLayer::default()
                });
            }
            let root = layout(
                cx,
                &header(
                    cx,
                    HeaderProps {
                        title: "Debug".into(),
                        description: Some("Share this when reporting an issue".into()),
                        ..HeaderProps::default()
                    },
                ),
                &body,
                None,
                None,
            );
            root.add(&slot);
            root
        },
        None,
        DialogOptions {
            size: DialogSize::Large,
            ..DialogOptions::default()
        },
    );
}

/// Redraws the footer after the current event, since a footer action runs inside the footer it replaces.
fn redraw(tui: &Weak<Tui>, hook: &Hook) {
    let (Some(tui), Some(draw)) = (
        tui.upgrade(),
        hook.borrow().as_ref().and_then(Weak::upgrade),
    ) else {
        return;
    };
    tui.app.defer(move |_| draw());
}

fn copy(tui: &Weak<Tui>, copied: &Cell<bool>, text: &str) {
    let Some(tui) = tui.upgrade() else { return };
    if !tui.app.copy_to_clipboard(text) {
        tui.toasts.error("Failed to copy to clipboard");
        return;
    }
    copied.set(true);
    tui.toasts.show(ToastOptions::new(
        Variant::Info,
        "Debug info copied to clipboard",
    ));
}

/// `describeOS`: `Linux 6.1.0 (x64)`, with Node's names for the platform and architecture.
pub fn describe_os() -> String {
    let name = match std::env::consts::OS {
        "macos" => "macOS",
        "windows" => "Windows",
        "linux" => "Linux",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "ia32",
        other => other,
    };
    format!("{name} {} ({arch})", release())
}

/// `os.release()`: the kernel release, from `/proc` on Linux, else `uname -r`.
fn release() -> String {
    std::fs::read_to_string("/proc/sys/kernel/osrelease")
        .ok()
        .or_else(|| {
            let output = std::process::Command::new("uname")
                .arg("-r")
                .output()
                .ok()?;
            String::from_utf8(output.stdout).ok()
        })
        .map(|text| text.trim().to_owned())
        .unwrap_or_default()
}

/// `describeTerminal`: the program and version, and the multiplexer.
pub fn describe_terminal(var: impl Fn(&str) -> Option<String>) -> String {
    let set = |name: &str| var(name).filter(|value| !value.is_empty());
    let program = set("TERM_PROGRAM")
        .or_else(|| set("TERM"))
        .unwrap_or_else(|| "unknown".to_owned());
    let version = set("TERM_PROGRAM_VERSION").map_or_else(String::new, |v| format!(" {v}"));
    let multiplexer = if set("TMUX").is_some() {
        " in tmux"
    } else if set("STY").is_some() {
        " in screen"
    } else {
        ""
    };
    format!("{program}{version}{multiplexer}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describe_terminal_matches_typescript() {
        let vars = |pairs: &'static [(&'static str, &'static str)]| {
            move |name: &str| {
                pairs
                    .iter()
                    .find(|(key, _)| *key == name)
                    .map(|(_, value)| (*value).to_owned())
            }
        };
        assert_eq!(describe_terminal(vars(&[])), "unknown");
        assert_eq!(describe_terminal(vars(&[("TERM", "xterm")])), "xterm");
        assert_eq!(
            describe_terminal(vars(&[
                ("TERM_PROGRAM", "ghostty"),
                ("TERM_PROGRAM_VERSION", "1.2"),
                ("TMUX", "/tmp/tmux"),
            ])),
            "ghostty 1.2 in tmux"
        );
        assert_eq!(
            describe_terminal(vars(&[("TERM", "screen"), ("STY", "1.pts")])),
            "screen in screen"
        );
    }
}
