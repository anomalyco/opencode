//! The LaTeX plugin (P.2, `docs/P.2.md`): `opencode.latex` draws `latex` and `math` Markdown fences as Unicode
//! math in terminal cells, as `packages/latex/src/plugin.ts` does, and inline Markdown math on one row, which TS
//! does not. [`parse`] and [`layout`] port the TypeScript parser and layout with opentui-tex's fixes; [`inline`]
//! writes math on one row; [`plugin`] renders both (`markdown.ts`), on the one plugin API (O-67).

pub mod inline;
pub mod layout;
pub mod parse;
mod symbols;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tex_rows;

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

/// One renderer for both fence languages, as TS registers, and the inline math renderer.
fn setup(setup: &mut Setup) -> Result<(), String> {
    register(setup, Rc::default());
    Ok(())
}

fn register(setup: &mut Setup, shown: Shown) {
    let forget = shown.clone();
    setup.on_fence_gone(move |key| {
        forget.borrow_mut().remove(&key);
    });
    let render = Rc::new(renderer(shown));
    for language in ["latex", "math"] {
        let render = render.clone();
        setup.code_block(language, move |_, fence| render(fence));
    }
    setup.inline_math(|_, tex| inline_line(tex));
}

/// Inline math's row in the styles of display math, without colors so it takes the text's; `None` when the TeX
/// does not parse, so the TeX shows as typed.
pub fn inline_line(tex: &str) -> Option<Line> {
    formula(&inline::render(tex).ok()?, true).into_iter().next()
}

/// Lays out `source` as display math (TS `renderLatex` in strict mode).
pub fn render(source: &str) -> Result<Layout, ParseError> {
    render_with(source, &Options::default())
}

pub fn render_with(source: &str, options: &Options) -> Result<Layout, ParseError> {
    layout::layout(&parse::parse(source)?, options).ok_or_else(|| ParseError {
        message: format!("LaTeX layout exceeds the {}-cell limit", layout::MAX_CELLS),
        position: 0,
    })
}

/// The source of each formula shown while streaming, by fence key, so its block can keep it.
type Shown = Rc<RefCell<HashMap<u64, String>>>;

/// The Markdown code-block renderer (TS `createLatexCodeBlockRenderer`): the formula in a horizontally scrolling
/// row, or the code view when it does not parse. While the document streams and the fence is open, a block whose
/// text extends the last formula that rendered keeps showing that formula.
fn renderer(shown: Shown) -> impl Fn(&Fence) -> Fenced {
    move |fence| {
        let streaming = fence.streaming && !fence.closed;
        let layout = render(&fence.code).ok();
        let mut shown = shown.borrow_mut();
        let retained = shown.get(&fence.key).is_some_and(|source| fence.code.starts_with(source.as_str()));
        if layout.is_none() && streaming && retained {
            return Fenced::Keep;
        }
        shown.remove(&fence.key);
        let Some(layout) = layout else { return Fenced::Code };
        if streaming {
            shown.insert(fence.key, fence.code.clone());
        }
        Fenced::Lines { lines: formula(&layout, false), fg: None, drag: false }
    }
}

/// The formula's rows: structure in the muted text color, relations bold. The host draws them in a row that
/// scrolls sideways instead of wrapping. TS adds a row of top margin; the Rust Markdown already puts a blank row
/// between blocks. `inline` rows have no colors, so they take the text's.
fn formula(layout: &Layout, inline: bool) -> Vec<Line> {
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
                    fg: (!inline).then(|| if structural { "text.muted" } else { "text.base" }.into()),
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
