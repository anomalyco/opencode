//! The `opencode.merman` plugin (`plugin.ts`, `createMermaidCodeBlockRenderer`) and its diagram widget
//! (`StaticDiagramRenderable`).

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use opencode_plugin::{Definition, Host};
use opentui::input::{MouseButton, MouseEventKind};
use opentui::prelude::{App, Attributes, Color, Length, Span, Style, Text, Widget, WrapMode};
use opentui::widget::{AnyWidget, CodeBlock, Content};
use unicode_width::UnicodeWidthStr;

use crate::{Diagram, Kind, Palette, Rendered, render};

pub const ID: &str = "opencode.merman";

pub fn plugin<H: Host>() -> Definition<H> {
    Definition::new(ID, |setup| {
        let renderer = Rc::new(Renderer::default());
        setup.code_block("mermaid", move |block, theme| renderer.render(block, &Palette::from_theme(theme)));
    })
}

/// The `mermaid` code-block renderer. It remembers the kind each diagram widget shows, so a fence whose newest
/// text does not parse keeps its last diagram of the same kind while it streams.
#[derive(Default)]
pub struct Renderer {
    kinds: RefCell<HashMap<u32, Kind>>,
}

impl Renderer {
    pub fn render(&self, block: &CodeBlock<'_>, palette: &Palette) -> Option<AnyWidget> {
        let previous = block.previous.map(|widget| (widget.clone(), self.kinds.borrow_mut().remove(&widget.id())));
        let diagram = match render(block.code, block.app.size().0, palette) {
            Rendered::Diagram(diagram) => diagram,
            Rendered::Code => return None,
            Rendered::Syntax { kind, prefix } => {
                if let Some((widget, Some(previous))) = previous
                    && previous == kind
                {
                    self.kinds.borrow_mut().insert(widget.id(), kind);
                    return Some(widget);
                }
                prefix?
            }
        };
        let widget = widget(block.app, &diagram).as_any();
        self.kinds.borrow_mut().insert(widget.id(), diagram.kind);
        Some(widget)
    }
}

/// TS `StaticDiagramRenderable`: full width, the diagram's height, no wrap, not selectable. TS also sets one row
/// of top margin, which Core's Markdown uses as the gap before the block; the Rust Markdown widget puts that gap
/// between blocks itself, so a margin here would double it.
pub fn widget(app: &App, diagram: &Diagram) -> Text {
    let mut spans: Vec<Span<'static>> = Vec::new();
    for (index, line) in diagram.lines.iter().enumerate() {
        if index > 0 {
            spans.push(Span::raw("\n"));
        }
        for run in line {
            let mut style = Style::new().add(Attributes::from_bits(run.attributes));
            if let Some(fg) = run.fg {
                style = style.fg(fg);
            }
            if let Some(bg) = run.bg {
                style = style.bg(bg);
            }
            spans.push(Span::styled(run.text.clone(), style));
        }
    }
    let content_width = diagram
        .lines
        .iter()
        .map(|line| line.iter().map(|run| UnicodeWidthStr::width(run.text.as_str())).sum::<usize>())
        .max()
        .unwrap_or(0) as f64;
    let text = Text::new(app, Content(spans))
        // TS `TextRenderable`'s default fg, which unstyled cells (blank interiors, run gaps) keep.
        .fg(Color::rgb(255, 255, 255))
        .wrap(WrapMode::None)
        .selectable(false)
        .width(Length::percent(100.0))
        .height(diagram.height() as u16);
    // A left drag scrolls a diagram wider than the transcript sideways; horizontal wheel events stop here.
    let drag: Rc<Cell<Option<u16>>> = Rc::default();
    let scroll = Rc::new(Cell::new(0.0));
    let this = text.clone();
    text.on_mouse(move |cx, event| match event.kind {
        MouseEventKind::Down(MouseButton::Left) => {
            cx.app().clear_selection();
            drag.set(Some(event.x));
            cx.prevent_default();
            cx.stop_propagation();
        }
        MouseEventKind::Drag(MouseButton::Left) => {
            cx.prevent_default();
            cx.stop_propagation();
            let Some(start) = drag.get() else {
                return;
            };
            drag.set(Some(event.x));
            let dx = f64::from(event.x) - f64::from(start);
            let max = (content_width - f64::from(this.rect().width)).max(0.0);
            let next = (scroll.get() - dx).clamp(0.0, max);
            if next != scroll.get() {
                scroll.set(next);
                this.scroll_to(next, 0.0);
            }
        }
        MouseEventKind::Up(MouseButton::Left) => {
            drag.set(None);
            cx.prevent_default();
            cx.stop_propagation();
        }
        MouseEventKind::ScrollLeft | MouseEventKind::ScrollRight => {
            cx.prevent_default();
            cx.stop_propagation();
        }
        _ => {}
    })
}
