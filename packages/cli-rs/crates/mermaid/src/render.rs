//! Source to styled lines (`markdown.ts` `prepareDiagram` and the streaming fallback).

use opentui::prelude::Color;

use crate::core::canvas::{Canvas, TRIM_BOTH};
use crate::core::color::ramp;
use crate::flowchart;
use crate::{Kind, Palette, SyntaxError, detect};

/// One styled run of a diagram row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Run {
    pub text: String,
    pub fg: Option<Color>,
    pub bg: Option<Color>,
    pub attributes: u8,
}

/// A rendered diagram: its rows of runs, top to bottom.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Diagram {
    pub kind: Kind,
    pub lines: Vec<Vec<Run>>,
}

impl Diagram {
    pub fn height(&self) -> usize {
        self.lines.len()
    }
}

enum Failure {
    Syntax(SyntaxError),
    /// Too large for the canvas, or no layout: TS shows the code block.
    Unrenderable,
}

/// TS's default `layoutMaxWidth`.
const LAYOUT_MAX_WIDTH: i32 = 120;

/// What a fence renders as.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Rendered {
    Diagram(Diagram),
    /// Keep the fence as code: not a diagram, or too large to draw.
    Code,
    /// A statement this renderer does not support. The caller shows the previous diagram of the same kind
    /// if it has one, else `prefix`: the lines before the error, when only blank lines follow it (a fence
    /// still streaming in), else the code.
    Syntax { kind: Kind, prefix: Option<Diagram> },
}

/// Renders `source` for a terminal `width` columns wide.
pub fn render(source: &str, width: u16, palette: &Palette) -> Rendered {
    let Some(kind) = detect(source) else {
        return Rendered::Code;
    };
    let max_width = LAYOUT_MAX_WIDTH.min(i32::from(width).max(1));
    let error = match prepare(kind, source, palette, max_width) {
        Ok(diagram) => return Rendered::Diagram(diagram),
        Err(Failure::Unrenderable) => return Rendered::Code,
        Err(Failure::Syntax(error)) => error,
    };
    let lines: Vec<&str> = source.split('\n').collect();
    let trailing = lines.iter().skip(error.line).any(|line| !crate::core::text::js_trim(line).is_empty());
    let prefix = if error.line <= 2 || trailing {
        None
    } else {
        prepare(kind, &lines[..error.line - 1].join("\n"), palette, max_width)
            .ok()
            .filter(|diagram| diagram.height() > 0)
    };
    Rendered::Syntax { kind, prefix }
}

fn prepare(kind: Kind, source: &str, palette: &Palette, max_width: i32) -> Result<Diagram, Failure> {
    let lines = match kind {
        Kind::Flowchart => {
            let diagram = flowchart::parser::parse(source).map_err(Failure::Syntax)?;
            let options = flowchart::layout::Options { compact: true, layout_max_width: Some(max_width) };
            let grid = flowchart::drawing::draw(&diagram, &options).map_err(|_| Failure::Unrenderable)?;
            flowchart_lines(&grid, palette)
        }
        _ => return Err(Failure::Unrenderable),
    };
    Ok(Diagram { kind, lines })
}

fn flowchart_lines(grid: &flowchart::drawing::Grid, palette: &Palette) -> Vec<Vec<Run>> {
    use flowchart::drawing::{FADE_STEPS, Style};
    let node_fades = ramp(FADE_STEPS, palette.box_border, palette.line);
    let database_fades = ramp(FADE_STEPS, palette.box_border, palette.line);
    let fg = |style: Style| match style {
        Style::Node | Style::Database => palette.box_text,
        Style::NodeBorder | Style::DatabaseBorder => palette.box_border,
        Style::Edge => palette.line,
        Style::Label => palette.text,
        Style::Group => palette.group,
        Style::GroupLabel => palette.group_text,
        Style::NodeFade(step) => node_fades[usize::from(step)],
        Style::DatabaseFade(step) => database_fades[usize::from(step)],
    };
    let bg = |style: Style| (style == Style::Label).then_some(palette.label_background);
    runs(grid, |cell| (cell.style, cell.attributes), |style| style.map(fg), |style| style.and_then(bg))
}

fn runs<S: Copy + PartialEq, K: PartialEq>(
    grid: &Canvas<S>,
    key: impl Fn(&crate::core::canvas::Cell<S>) -> K,
    fg: impl Fn(Option<S>) -> Option<Color>,
    bg: impl Fn(Option<S>) -> Option<Color>,
) -> Vec<Vec<Run>> {
    grid.runs(TRIM_BOTH, key)
        .into_iter()
        .map(|row| {
            row.into_iter()
                .map(|(text, cell)| Run { text, fg: fg(cell.style), bg: bg(cell.style), attributes: cell.attributes })
                .collect()
        })
        .collect()
}
