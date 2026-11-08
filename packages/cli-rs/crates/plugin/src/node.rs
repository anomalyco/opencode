//! What a plugin of the one API (O-67) returns, turned into widgets, on both paths: fences ([`Fenced`]) with the keys
//! the host mints for them, and rows ([`Line`]).

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::{Rc, Weak};
use std::sync::atomic::{AtomicU64, Ordering};

use opencode_plugin_abi::{self as abi, Fence, Fenced, Line};
use opencode_ui::theme::Theme;
use opentui::prelude::*;
use opentui::style::Color;
use opentui::widget::CodeBlock;

use crate::{CodeBlockRender, Host};

/// One fence registration's keys, by the ID of the widget that shows the block. A key moves to the widget that
/// replaces its block's widget, so it stays the same while the block streams.
#[derive(Default)]
pub struct Fences {
    keys: RefCell<HashMap<u32, u64>>,
}

impl Fences {
    /// Renders `block` through `render`, which gets the block with its key.
    pub fn render(
        &self,
        block: &CodeBlock<'_>,
        theme: &Theme,
        render: impl FnOnce(Fence) -> Fenced,
    ) -> Option<AnyWidget> {
        // Keys are unique across registrations, so a plugin that renders several languages keeps one map.
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let previous = block.previous.map(Widget::id);
        let key = previous
            .and_then(|id| self.keys.borrow_mut().remove(&id))
            .unwrap_or_else(|| NEXT.fetch_add(1, Ordering::Relaxed));
        let fence = Fence {
            language: block.language.to_owned(),
            info: block.info.to_owned(),
            code: block.code.to_owned(),
            streaming: block.streaming,
            closed: block.closed,
            key,
        };
        let widget = match render(fence) {
            Fenced::Code => return None,
            Fenced::Keep => block.previous?.clone(),
            Fenced::Lines { lines } => lines_widget(block.app, theme, &lines, true),
        };
        self.keys.borrow_mut().insert(widget.id(), key);
        Some(widget)
    }
}

/// The code-block render of fence render `render` run in process, reading through `host`.
pub fn code_block<H: Host>(host: Weak<H>, render: abi::FenceFn) -> CodeBlockRender {
    let fences = Fences::default();
    Rc::new(move |block, theme| fences.render(block, theme, |fence| render(&Reader(host.clone()), &fence)))
}

/// The host as a render reads it in process.
struct Reader<H>(Weak<H>);

impl<H: Host> abi::Read for Reader<H> {
    fn theme_mode(&self) -> abi::ThemeMode {
        match self.0.upgrade().map(|host| host.theme_mode()) {
            Some(ThemeMode::Light) => abi::ThemeMode::Light,
            _ => abi::ThemeMode::Dark,
        }
    }
}

/// Rows of spans as one no-wrap text. A fence scrolls sideways.
pub(crate) fn lines_widget(app: &App, theme: &Theme, lines: &[Line], scroll: bool) -> AnyWidget {
    let width = lines
        .iter()
        .map(|line| line.iter().map(|span| unicode_width::UnicodeWidthStr::width(span.text.as_str())).sum::<usize>())
        .max()
        .unwrap_or(0);
    let height = lines.len().max(1) as f32;
    let mut spans: Vec<Span<'static>> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if index > 0 {
            spans.push(Span::styled("\n", Style::new().fg(theme.text.base)));
        }
        spans.extend(line.iter().map(|span| {
            let mut attributes = Attributes::NONE;
            for (set, attribute) in [
                (span.bold, Attributes::BOLD),
                (span.italic, Attributes::ITALIC),
                (span.underline, Attributes::UNDERLINE),
                (span.dim, Attributes::DIM),
            ] {
                if set {
                    attributes |= attribute;
                }
            }
            let fg = color(theme, span.fg.as_ref()).unwrap_or(theme.text.base);
            let mut style = Style::new().fg(fg);
            if let Some(bg) = color(theme, span.bg.as_ref()) {
                style = style.bg(bg);
            }
            Span::styled(span.text.clone(), Style { attributes, ..style })
        }));
    }
    let text = Text::new(app, spans)
        .width(Length::percent(100.0))
        .min_width(width as f32)
        .height(height)
        .wrap(WrapMode::None)
        .selectable(false)
        .shrink(0.0);
    if !scroll {
        return text.as_any();
    }
    ScrollBox::new(app)
        .width(Length::percent(100.0))
        .height(height)
        .shrink(0.0)
        .axes(true, false)
        .scrollbars(false)
        .child(&text)
        .as_any()
}

/// A theme token path, or `#rrggbb`.
fn color(theme: &Theme, value: Option<&abi::Color>) -> Option<Color> {
    let value = value?.as_str();
    if let Some(hex) = value.strip_prefix('#').filter(|hex| hex.len() == 6) {
        let channel = |index: usize| u8::from_str_radix(&hex[index..index + 2], 16).ok();
        return Some(Color::rgb(channel(0)?, channel(2)?, channel(4)?));
    }
    theme.get(value).copied()
}
