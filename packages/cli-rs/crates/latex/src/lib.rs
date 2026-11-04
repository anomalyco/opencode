//! The LaTeX plugin (P.2, `docs/P.2.md`): `opencode.latex` draws `latex` and `math` Markdown fences as Unicode
//! math in terminal cells, as `packages/latex/src/plugin.ts` does. [`parse`] and [`layout`] port the TypeScript
//! parser and layout; [`renderer`] is the Markdown adapter (`markdown.ts`).

pub mod layout;
pub mod parse;
mod symbols;
#[cfg(test)]
mod tests;

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use opencode_plugin::{Definition, Host};
use opencode_ui::theme::Theme;
use opentui::prelude::*;
use opentui::widget::CodeBlock;

pub use layout::{Layout, Options};
pub use parse::ParseError;

/// The plugin: one renderer for both fence languages, as TS registers.
pub fn plugin<H: Host>() -> Definition<H> {
    Definition::new("opencode.latex", |setup| {
        let render = Rc::new(renderer());
        for language in ["latex", "math"] {
            let render = render.clone();
            setup.code_block(language, move |block, theme| render(block, theme));
        }
    })
}

/// Lays out `source` as display math (TS `renderLatex` in strict mode).
pub fn render(source: &str) -> Result<Layout, ParseError> {
    render_with(source, &Options::default())
}

pub fn render_with(source: &str, options: &Options) -> Result<Layout, ParseError> {
    Ok(layout::layout(&parse::parse(source)?, options))
}

/// The Markdown code-block renderer (TS `createLatexCodeBlockRenderer`): the formula in a horizontally scrolling
/// row, or `None` so Markdown shows the source when it does not parse. While the document streams, a block whose
/// text extends the last formula that rendered keeps showing that formula.
pub fn renderer() -> impl Fn(&CodeBlock<'_>, &Theme) -> Option<AnyWidget> {
    // The source of each formula shown while streaming, by widget ID, so its block can keep it.
    let shown: RefCell<HashMap<u32, String>> = RefCell::default();
    move |block, theme| {
        let layout = render(block.code).ok();
        let previous = block.previous.map(Widget::id);
        let mut shown = shown.borrow_mut();
        let retained = previous
            .and_then(|id| shown.get(&id))
            .is_some_and(|source| block.code.starts_with(source));
        if layout.is_none() && block.streaming && retained {
            return block.previous.cloned();
        }
        if let Some(id) = previous {
            shown.remove(&id);
        }
        let layout = layout?;
        let widget = formula(block.app, &layout, theme);
        if block.streaming {
            shown.insert(widget.id(), block.code.to_owned());
        }
        Some(widget)
    }
}

/// The formula's widget: structure in the muted text color, relations bold, and a row that scrolls sideways instead
/// of wrapping.
fn formula(app: &App, layout: &Layout, theme: &Theme) -> AnyWidget {
    let (text, subdued) = (theme.text.base, theme.text.muted);
    let mut spans: Vec<Span<'static>> = Vec::new();
    for (index, row) in layout.cells.iter().enumerate() {
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
            let mut attributes = Attributes::NONE;
            if style.is_some_and(|style| style.bold)
                || ["=", "<", ">", "≠", "≡", "≤", "≥", "≈"].contains(&char)
            {
                attributes |= Attributes::BOLD;
            }
            if style.is_some_and(|style| style.italic) {
                attributes |= Attributes::ITALIC;
            }
            if style.is_some_and(|style| style.dim) {
                attributes |= Attributes::DIM;
            }
            let style = Style {
                attributes,
                ..Style::new().fg(if structural { subdued } else { text })
            };
            push(&mut spans, char, style);
            // A wide glyph already takes the next cell.
            column += layout::cell_width(char).max(1) as usize;
        }
        if index + 1 < layout.height {
            push(&mut spans, "\n", Style::new().fg(text));
        }
    }
    let content = Text::new(app, spans)
        .width(Length::percent(100.0))
        .min_width(layout.width as f32)
        .height(layout.height as f32)
        .wrap(WrapMode::None)
        .selectable(false)
        .shrink(0.0);
    ScrollBox::new(app)
        .width(Length::percent(100.0))
        .height(layout.height as f32)
        .shrink(0.0)
        .margin_edge(Edge::Top, 1)
        .axes(true, false)
        .scrollbars(false)
        .child(&content)
        .as_any()
}

/// Appends `text` to the last span when the style matches, so a row is a few spans rather than one per cell.
fn push(spans: &mut Vec<Span<'static>>, text: &str, style: Style) {
    if let Some(last) = spans.last_mut().filter(|last| last.style == style) {
        last.content.to_mut().push_str(text);
        return;
    }
    spans.push(Span::styled(text.to_owned(), style));
}
