//! The `opencode.merman` plugin (`plugin.ts`, `createMermaidCodeBlockRenderer`), on the one plugin API (O-67). The
//! host draws its rows as TS `StaticDiagramRenderable` does: full width, the diagram's height, no wrap, not
//! selectable, in a white default foreground, scrolled sideways by a left drag.

use std::cell::RefCell;
use std::collections::HashMap;

use opencode_plugin_abi::{Color, Fenced, Plugin, Rgba, Setup, Span};

use crate::flowchart::drawing::italic;
use crate::{Diagram, Kind, Palette, Rendered, render};

pub const ID: &str = "opencode.merman";

/// The plugin, on the one plugin API (O-67).
pub fn plugin() -> Plugin {
    Plugin { id: ID, setup }
}

/// The `mermaid` fence render. It remembers the kind each block shows, by fence key, so a fence whose newest text
/// does not parse keeps its last diagram of the same kind while it streams.
fn setup(setup: &mut Setup) -> Result<(), String> {
    let kinds: RefCell<HashMap<u64, Kind>> = RefCell::default();
    setup.code_block("mermaid", move |read, fence| {
        let mut kinds = kinds.borrow_mut();
        let previous = kinds.remove(&fence.key);
        let diagram = match render(&fence.code, fence.width, &Palette::read(read)) {
            Rendered::Diagram(diagram) => diagram,
            Rendered::Code => return Fenced::Code,
            Rendered::Syntax { kind, prefix } => {
                if previous == Some(kind) {
                    kinds.insert(fence.key, kind);
                    return Fenced::Keep;
                }
                let Some(prefix) = prefix else {
                    return Fenced::Code;
                };
                prefix
            }
        };
        kinds.insert(fence.key, diagram.kind);
        fenced(&diagram)
    });
    Ok(())
}

/// A diagram's rows as the host draws them. TS sets one row of top margin, which Core's Markdown uses as the gap
/// before the block; the Rust Markdown puts that gap between blocks itself.
pub fn fenced(diagram: &Diagram) -> Fenced {
    let lines = diagram
        .lines
        .iter()
        .map(|line| {
            line.iter()
                .map(|run| Span {
                    fg: run.fg.map(Color::Rgba),
                    bg: run.bg.map(Color::Rgba),
                    italic: run.attributes & italic() != 0,
                    ..Span::new(run.text.clone())
                })
                .collect()
        })
        .collect();
    // TS `TextRenderable`'s default fg, which unstyled cells (blank interiors, run gaps) keep.
    Fenced::Lines { lines, fg: Some(Color::Rgba(Rgba::new(255, 255, 255, 255))), drag: true }
}
