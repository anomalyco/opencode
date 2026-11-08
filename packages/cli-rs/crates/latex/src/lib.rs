//! The LaTeX plugin (P.2, `docs/P.2.md`): `opencode.latex` draws `latex` and `math` Markdown fences as Unicode
//! math in terminal cells, as `packages/latex/src/plugin.ts` does. [`parse`] and [`layout`] port the TypeScript
//! parser and layout; [`plugin`] renders the fences (`markdown.ts`), on the one plugin API (O-67).

pub mod layout;
pub mod parse;
mod symbols;
#[cfg(test)]
mod tests;

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use opencode_plugin_abi::{Fence, Fenced, Line, Plugin, Setup, Span};

pub use layout::{Layout, Options};
pub use parse::ParseError;

/// The plugin, on the one plugin API (O-67).
pub fn plugin() -> Plugin {
    Plugin { id: "opencode.latex", setup }
}

/// One renderer for both fence languages, as TS registers.
fn setup(setup: &mut Setup) -> Result<(), String> {
    let render = Rc::new(renderer());
    for language in ["latex", "math"] {
        let render = render.clone();
        setup.code_block(language, move |_, fence| render(fence));
    }
    Ok(())
}

/// Lays out `source` as display math (TS `renderLatex` in strict mode).
pub fn render(source: &str) -> Result<Layout, ParseError> {
    render_with(source, &Options::default())
}

pub fn render_with(source: &str, options: &Options) -> Result<Layout, ParseError> {
    Ok(layout::layout(&parse::parse(source)?, options))
}

/// The Markdown code-block renderer (TS `createLatexCodeBlockRenderer`): the formula in a horizontally scrolling
/// row, or the code view when it does not parse. While the document streams and the fence is open, a block whose
/// text extends the last formula that rendered keeps showing that formula.
fn renderer() -> impl Fn(&Fence) -> Fenced {
    // The source of each formula shown while streaming, by fence key, so its block can keep it.
    let shown: RefCell<HashMap<u64, String>> = RefCell::default();
    move |fence| {
        let streaming = fence.streaming && !fence.closed;
        let layout = render(&fence.code).ok();
        let mut shown = shown.borrow_mut();
        let retained = shown.get(&fence.key).is_some_and(|source| fence.code.starts_with(source.as_str()));
        if layout.is_none() && streaming && retained {
            return Fenced::Keep;
        }
        shown.remove(&fence.key);
        let Some(layout) = layout else {
            return Fenced::Code;
        };
        if streaming {
            shown.insert(fence.key, fence.code.clone());
        }
        Fenced::Lines { lines: formula(&layout) }
    }
}

/// The formula's rows: structure in the muted text color, relations bold. The host draws them in a row that
/// scrolls sideways instead of wrapping. TS adds a row of top margin; the Rust Markdown already puts a blank row
/// between blocks.
fn formula(layout: &Layout) -> Vec<Line> {
    layout
        .cells
        .iter()
        .map(|row| {
            let mut line = Line::new();
            let mut column = 0;
            while column < row.len() {
                let cell = row[column].as_ref();
                let char = cell.map_or(" ", |cell| cell.text.as_str());
                let style = cell.map(|cell| &cell.style);
                let structural = char.chars().count() == 1
                    && char.chars().next().is_some_and(|c| {
                        "()[]{}|\u{221a}".contains(c)
                            || ('\u{239b}'..='\u{23ad}').contains(&c)
                            || ('\u{2500}'..='\u{257f}').contains(&c)
                    });
                let span = Span {
                    fg: Some(if structural { "text.muted" } else { "text.base" }.into()),
                    bold: style.is_some_and(|style| style.bold)
                        || ["=", "<", ">", "≠", "≡", "≤", "≥", "≈"].contains(&char),
                    italic: style.is_some_and(|style| style.italic),
                    dim: style.is_some_and(|style| style.dim),
                    ..Span::default()
                };
                push(&mut line, char, span);
                // A wide glyph already takes the next cell.
                column += layout::cell_width(char).max(1) as usize;
            }
            line
        })
        .collect()
}

/// Appends `text` to the last span when the style matches, so a row is a few spans rather than one per cell.
fn push(line: &mut Line, text: &str, span: Span) {
    let same =
        |last: &&mut Span| (&last.fg, last.bold, last.italic, last.dim) == (&span.fg, span.bold, span.italic, span.dim);
    if let Some(last) = line.last_mut().filter(same) {
        last.text.push_str(text);
        return;
    }
    line.push(Span { text: text.to_owned(), ..span });
}
