//! Renders fenced LaTeX and inline math as Unicode terminal cells.

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

use opencode_plugin_abi::{Color, Fence, Fenced, Line, Plugin, Rgba, Setup, Span};

pub use layout::{Layout, Options};
pub use parse::{Mode, ParseError};

/// Maximum input length in UTF-8 bytes.
pub const MAX_SOURCE_BYTES: usize = 4096;

/// Registers the fenced and inline math renderers.
pub fn plugin() -> Plugin {
    Plugin { id: "opencode.latex", setup }
}

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

/// Renders a single row, inheriting the surrounding color except for `\textcolor`. Returns `None` on invalid TeX.
pub fn inline_line(tex: &str) -> Option<Line> {
    formula(&inline::render(tex).ok()?, true).into_iter().next()
}

/// Lays out display math in strict mode.
pub fn render(source: &str) -> Result<Layout, ParseError> {
    render_with(source, &Options::default())
}

pub fn render_with(source: &str, options: &Options) -> Result<Layout, ParseError> {
    render_mode(source, options, Mode::default())
}

/// Lays out a formula in `mode`. Empty, oversized and invisible formulas are errors.
pub fn render_mode(source: &str, options: &Options, mode: Mode) -> Result<Layout, ParseError> {
    check_source(source)?;
    let layout = layout::layout(&parse::parse_with(source, mode)?, options)
        .ok_or_else(|| fail(format!("LaTeX layout exceeds the {}-cell limit", layout::BLOCK_CELLS)))?;
    if layout.cells.iter().flatten().flatten().all(|cell| cell.text.trim().is_empty()) {
        return Err(fail("LaTeX formula draws nothing".into()));
    }
    Ok(layout)
}

fn check_source(source: &str) -> Result<(), ParseError> {
    if source.is_empty() || source.len() > MAX_SOURCE_BYTES {
        return Err(fail(format!("LaTeX source must be between 1 and {MAX_SOURCE_BYTES} UTF-8 bytes")));
    }
    Ok(())
}

fn fail(message: String) -> ParseError {
    ParseError { message, position: 0 }
}

type Shown = Rc<RefCell<HashMap<u64, String>>>;

/// An open fence keeps its last good render while more of the same formula arrives.
fn renderer(shown: Shown) -> impl Fn(&Fence) -> Fenced {
    move |fence| {
        let streaming = fence.streaming && !fence.closed;
        let incomplete = Mode { incomplete: true, ..Mode::default() };
        let layout = render(&fence.code)
            .or_else(
                |error| if streaming { render_mode(&fence.code, &Options::default(), incomplete) } else { Err(error) },
            )
            .ok();
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

/// Inline spans inherit the surrounding text color.
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
                let named = style.and_then(|style| color(style.color.as_deref()?));
                let theme = (!inline).then(|| if structural { "text.muted" } else { "text.base" }.into());
                let span = Span {
                    fg: named.or(theme),
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

fn push(line: &mut Line, text: &str, span: Span) {
    let same =
        |last: &&mut Span| (&last.fg, last.bold, last.italic, last.dim) == (&span.fg, span.bold, span.italic, span.dim);
    if let Some(last) = line.last_mut().filter(same) {
        last.text.push_str(text);
        return;
    }
    line.push(Span { text: text.to_owned(), ..span });
}

/// The color `\textcolor` names: `#rgb`, `#rrggbb`, or one of xcolor's base colors.
fn color(name: &str) -> Option<Color> {
    let name = name.trim();
    if let Some(hex) = name.strip_prefix('#') {
        let digits: Vec<u8> = hex.chars().map(|c| c.to_digit(16).map(|d| d as u8)).collect::<Option<_>>()?;
        let [r, g, b] = match digits[..] {
            [r, g, b] => [r * 17, g * 17, b * 17],
            [r1, r2, g1, g2, b1, b2] => [r1 * 16 + r2, g1 * 16 + g2, b1 * 16 + b2],
            _ => return None,
        };
        return Some(Color::Rgba(Rgba::new(r, g, b, 255)));
    }
    let [r, g, b] = match name.to_ascii_lowercase().as_str() {
        "red" => [255, 0, 0],
        "green" => [0, 255, 0],
        "blue" => [0, 0, 255],
        "cyan" => [0, 255, 255],
        "magenta" => [255, 0, 255],
        "yellow" => [255, 255, 0],
        "black" => [0, 0, 0],
        "white" => [255, 255, 255],
        "gray" | "grey" => [128, 128, 128],
        "darkgray" => [64, 64, 64],
        "lightgray" => [191, 191, 191],
        "brown" => [191, 128, 64],
        "lime" => [191, 255, 0],
        "olive" => [128, 128, 0],
        "orange" => [255, 128, 0],
        "pink" => [255, 191, 191],
        "purple" => [191, 0, 64],
        "teal" => [0, 128, 128],
        "violet" => [128, 0, 128],
        _ => return None,
    };
    Some(Color::Rgba(Rgba::new(r, g, b, 255)))
}
