//! The `opencode.merman` plugin (`plugin.ts`) and its diagram widget (`StaticDiagramRenderable`).

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use opencode_plugin::{Definition, Host};
use opentui::prelude::{App, Attributes, Edge, Length, Span, Style, Text, Widget, WrapMode};
use opentui::widget::{AnyWidget, CodeBlock, Content};

use crate::{Diagram, Kind, Palette, Rendered, render};

pub const ID: &str = "opencode.merman";

pub fn plugin<H: Host>() -> Definition<H> {
    Definition::new(ID, |setup| {
        // The kind each diagram widget shows, for the last-good fallback while a fence streams.
        let kinds: Rc<RefCell<HashMap<u32, Kind>>> = Rc::default();
        setup.code_block("mermaid", move |block, theme| render_block(block, &Palette::from_theme(theme), &kinds));
    })
}

fn render_block(block: &CodeBlock<'_>, palette: &Palette, kinds: &RefCell<HashMap<u32, Kind>>) -> Option<AnyWidget> {
    let previous = block.previous.map(|widget| (widget.clone(), kinds.borrow_mut().remove(&widget.id())));
    let (diagram, kind) = match render(block.code, block.app.size().0, palette) {
        Rendered::Diagram(diagram) => {
            let kind = diagram.kind;
            (diagram, kind)
        }
        Rendered::Code => return None,
        Rendered::Syntax { kind, prefix } => {
            if let Some((widget, Some(previous))) = previous
                && previous == kind
            {
                kinds.borrow_mut().insert(widget.id(), kind);
                return Some(widget);
            }
            (prefix?, kind)
        }
    };
    let widget = widget(block.app, &diagram).as_any();
    kinds.borrow_mut().insert(widget.id(), kind);
    Some(widget)
}

/// TS `StaticDiagramRenderable`: full width, the diagram's height, no wrap, not selectable, one row above.
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
    Text::new(app, Content(spans))
        .wrap(WrapMode::None)
        .selectable(false)
        .width(Length::percent(100.0))
        .height(diagram.height() as u16)
        .margin_edge(Edge::Top, 1)
}
