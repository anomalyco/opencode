//! Renders to the available width and reports the diagram's measured height.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use opencode_plugin_abi::{Color, Fenced, Plugin, Rgba, Setup, Span};

use crate::flowchart::drawing::{bold, italic};
use crate::{Diagram, Kind, Palette, Rendered, render};

pub const ID: &str = "opencode.merman";

pub fn plugin() -> Plugin {
    Plugin { id: ID, setup }
}

/// The `mermaid` fence render. It remembers the kind each block shows, by fence key, so a fence whose newest text
/// does not parse keeps its last diagram of the same kind while it streams, and forgets it once the block goes.
fn setup(setup: &mut Setup) -> Result<(), String> {
    register(setup, Rc::default());
    Ok(())
}

fn register(setup: &mut Setup, kinds: Rc<RefCell<HashMap<u64, Kind>>>) {
    let forget = kinds.clone();
    setup.on_fence_gone(move |key| {
        forget.borrow_mut().remove(&key);
    });
    setup.code_block_draws("mermaid", |code, width| {
        const NEUTRAL: Rgba = Rgba::new(0, 0, 0, 255);
        const PALETTE: Palette = Palette {
            text: NEUTRAL,
            primary: NEUTRAL,
            secondary: NEUTRAL,
            muted: NEUTRAL,
            warning: NEUTRAL,
            background: NEUTRAL,
            request: NEUTRAL,
            response: NEUTRAL,
            note: NEUTRAL,
            note_background: NEUTRAL,
            box_text: NEUTRAL,
            box_border: NEUTRAL,
            line: NEUTRAL,
            label_background: NEUTRAL,
            group: NEUTRAL,
            group_text: NEUTRAL,
            marker: NEUTRAL,
            note_border: NEUTRAL,
            note_text: NEUTRAL,
            note_connector: NEUTRAL,
        };
        matches!(render(code, width, &PALETTE), Rendered::Diagram(_) | Rendered::Syntax { prefix: Some(_), .. })
    });
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
                let Some(prefix) = prefix else { return Fenced::Code };
                prefix
            }
        };
        kinds.insert(fence.key, diagram.kind);
        fenced(&diagram)
    });
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
                    bold: run.attributes & bold() != 0,
                    ..Span::new(run.text.clone())
                })
                .collect()
        })
        .collect();
    // TS `TextRenderable`'s default fg, which unstyled cells (blank interiors, run gaps) keep.
    Fenced::Lines { lines, fg: Some(Color::Rgba(Rgba::new(255, 255, 255, 255))), drag: true }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opencode_plugin::node::{Fences, Reader};
    use opencode_ui::markdown::CodeBlockRenderers;
    use opencode_ui::theme::{Catalog, ThemeMode};
    use opentui::prelude::*;
    use opentui::testing::TestApp;

    #[test]
    fn removed_diagrams_leave_no_kinds() {
        let app = TestApp::new(80, 200);
        let theme = Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme;
        let kinds: Rc<RefCell<HashMap<u64, Kind>>> = Rc::default();
        let mut registered = opencode_plugin_abi::Registered::new(ID, None);
        register(&mut registered.setup(), kinds.clone());
        let registered = Rc::new(registered);
        let gone = registered.clone();
        let fences = Fences::new(Some(Rc::new(move |key| gone.fence_gone().iter().for_each(|run| run(key)))));
        let (render, reader_theme) = (registered.fences()[0].1.clone(), theme.clone());
        let mut renderers = CodeBlockRenderers::default();
        renderers.register(
            "mermaid",
            Rc::new(move |block| {
                fences
                    .render(block, &reader_theme, |fence| render(&Reader::new(&reader_theme, ThemeMode::Dark), &fence))
            }),
        );
        let syntax = opencode_ui::code::syntax_theme(&theme);
        let view = opencode_ui::markdown::view(&app, &theme, &syntax, &renderers, true, false);
        app.root().add(&view);
        let diagrams =
            (0..5).map(|at| format!("```mermaid\nflowchart LR\n  A{at} --> B{at}\n```\n")).collect::<String>();
        view.set_markdown(&diagrams);
        app.render();
        assert_eq!(kinds.borrow().len(), 5);
        app.root().clear();
        drop(view);
        app.render();
        assert!(kinds.borrow().is_empty(), "{:?}", kinds.borrow());
    }
}
