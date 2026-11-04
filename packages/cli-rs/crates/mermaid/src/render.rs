//! Source to styled lines (`markdown.ts` `prepareDiagram` and the streaming fallback).

use opentui::prelude::Color;

use crate::core::canvas::{Canvas, TRIM_BOTH, TRIM_BOTTOM, TRIM_NONE, Trim};
use crate::core::color::{blend, ramp, rgb};
use crate::{Kind, Palette, SyntaxError, detect};
use crate::{flowchart, gantt, gitgraph, sequence, state, timeline};

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
    Syntax {
        kind: Kind,
        prefix: Option<Diagram>,
    },
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
    let trailing = lines
        .iter()
        .skip(error.line)
        .any(|line| !crate::core::text::js_trim(line).is_empty());
    let prefix = if error.line <= 2 || trailing {
        None
    } else {
        prepare(
            kind,
            &lines[..error.line - 1].join("\n"),
            palette,
            max_width,
        )
        .ok()
        .filter(|diagram| diagram.height() > 0)
    };
    Rendered::Syntax { kind, prefix }
}

fn prepare(
    kind: Kind,
    source: &str,
    palette: &Palette,
    max_width: i32,
) -> Result<Diagram, Failure> {
    let lines = match kind {
        Kind::Flowchart => {
            let diagram = flowchart::parser::parse(source).map_err(Failure::Syntax)?;
            let options = flowchart::layout::Options {
                compact: true,
                layout_max_width: Some(max_width),
            };
            let grid =
                flowchart::drawing::draw(&diagram, &options).map_err(|_| Failure::Unrenderable)?;
            flowchart_lines(&grid, palette)
        }
        Kind::Sequence => {
            let diagram = sequence::parser::parse(source).map_err(Failure::Syntax)?;
            let grid =
                sequence::drawing::draw(&diagram, true).map_err(|_| Failure::Unrenderable)?;
            sequence_lines(&grid, palette)
        }
        Kind::Gantt => {
            let diagram = gantt::parse(source).map_err(Failure::Syntax)?;
            let grid = gantt::draw(&diagram, max_width).map_err(|_| Failure::Unrenderable)?;
            gantt_lines(&grid, palette)
        }
        Kind::GitGraph => {
            let diagram = gitgraph::parse(source).map_err(Failure::Syntax)?;
            let grid = gitgraph::draw(&diagram).map_err(|_| Failure::Unrenderable)?;
            gitgraph_lines(&grid, palette)
        }
        Kind::State => {
            let diagram = state::parser::parse(source).map_err(Failure::Syntax)?;
            let grid = state::drawing::draw(&diagram, Some(max_width))
                .map_err(|_| Failure::Unrenderable)?;
            state_lines(&grid, palette)
        }
        Kind::Timeline => {
            let diagram = timeline::parse(source).map_err(Failure::Syntax)?;
            let grid = timeline::draw(&diagram).map_err(|_| Failure::Unrenderable)?;
            timeline_lines(&grid, palette)
        }
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
    runs(
        grid,
        TRIM_BOTH,
        |cell| (cell.style, cell.attributes),
        |style| style.map(fg),
        |style| style.and_then(bg),
    )
}

fn sequence_lines(grid: &sequence::drawing::Grid, palette: &Palette) -> Vec<Vec<Run>> {
    use sequence::drawing::Style;
    let participant = palette.primary;
    let lifeline = palette.muted;
    let request_fades = ramp(5, lifeline, palette.request);
    let response_fades = ramp(5, lifeline, palette.response);
    let lifeline_ramp = ramp(3, participant, lifeline);
    let fg = |style: Style| match style {
        Style::Participant => participant,
        Style::Lifeline => lifeline,
        Style::Group => palette.secondary,
        Style::Request => palette.request,
        Style::Response => palette.response,
        Style::RequestFade(step) => request_fades[usize::from(step)],
        Style::ResponseFade(step) => response_fades[usize::from(step)],
        Style::LifelineRamp(step) => lifeline_ramp[usize::from(step)],
        Style::Fragment | Style::FragmentLabel => palette.secondary,
        Style::Note | Style::NoteBadge => palette.note,
    };
    let bg = |style: Style| match style {
        Style::Note | Style::NoteBadge => Some(palette.note_background),
        Style::FragmentLabel => Some(palette.background),
        _ => None,
    };
    runs(
        grid,
        TRIM_NONE,
        |cell| cell.style,
        |style| style.map(fg),
        |style| style.and_then(bg),
    )
}

fn gantt_lines(grid: &gantt::Grid, palette: &Palette) -> Vec<Vec<Run>> {
    use gantt::Style;
    let fg = |style: Style| match style {
        Style::Title => palette.text,
        Style::Axis | Style::Done => palette.muted,
        Style::Section => palette.secondary,
        Style::Task | Style::Active => palette.primary,
        Style::Critical => palette.warning,
        Style::Milestone => rgb(198, 160, 246),
        Style::TrackFaint => blend(palette.muted, palette.background, 0.72),
    };
    runs(
        grid,
        TRIM_BOTTOM,
        |cell| cell.style,
        |style| style.map(fg),
        |_| None,
    )
}

fn gitgraph_lines(grid: &gitgraph::Grid, palette: &Palette) -> Vec<Vec<Run>> {
    use gitgraph::Style;
    let fg = |style: Style| match style {
        Style::Branch(_) => palette.muted,
        Style::Commit => palette.primary,
        Style::Merge => palette.secondary,
        Style::Highlight | Style::Reverse => palette.warning,
        Style::Label => palette.text,
    };
    runs(
        grid,
        TRIM_BOTTOM,
        |cell| cell.style,
        |style| style.map(fg),
        |_| None,
    )
}

fn timeline_lines(grid: &timeline::Grid, palette: &Palette) -> Vec<Vec<Run>> {
    use timeline::Style;
    const FADES: [f64; 3] = [0.5, 0.67, 0.83];
    let (section, period, spine) = (palette.secondary, palette.warning, palette.muted);
    let fg = |style: Style| match style {
        Style::Title => palette.text,
        Style::Section => section,
        Style::Period => period,
        Style::Spine => spine,
        Style::Event => palette.primary,
        Style::SectionFade(step) => blend(section, spine, FADES[usize::from(step)]),
        Style::PeriodFade(step) => blend(period, spine, FADES[usize::from(step)]),
    };
    runs(
        grid,
        TRIM_BOTTOM,
        |cell| cell.style,
        |style| style.map(fg),
        |_| None,
    )
}

fn state_lines(grid: &state::drawing::Grid, palette: &Palette) -> Vec<Vec<Run>> {
    use state::drawing::Style;
    let note_ramp = ramp(3, palette.note_connector, palette.note_border);
    let departure_ramp = ramp(3, palette.box_border, palette.line);
    let fg = |style: Style| match style {
        Style::State => palette.box_text,
        Style::StateBorder => palette.box_border,
        Style::Composite => palette.group,
        Style::CompositeLabel => palette.group_text,
        Style::Transition => palette.line,
        Style::Label => palette.text,
        Style::NoteBorder => palette.note_border,
        Style::NoteText => palette.note_text,
        Style::NoteConnector => palette.note_connector,
        Style::Start | Style::End | Style::Choice => palette.marker,
        Style::NoteRamp(step) => note_ramp[usize::from(step)],
        Style::DepartureRamp(step) => departure_ramp[usize::from(step)],
    };
    let bg = |style: Style| (style == Style::Label).then_some(palette.label_background);
    runs(
        grid,
        TRIM_BOTH,
        |cell| cell.style,
        |style| style.map(fg),
        |style| style.and_then(bg),
    )
}

fn runs<S: Copy + PartialEq, K: PartialEq>(
    grid: &Canvas<S>,
    trim: Trim,
    key: impl Fn(&crate::core::canvas::Cell<S>) -> K,
    fg: impl Fn(Option<S>) -> Option<Color>,
    bg: impl Fn(Option<S>) -> Option<Color>,
) -> Vec<Vec<Run>> {
    grid.runs(trim, key)
        .into_iter()
        .map(|row| {
            row.into_iter()
                .map(|(text, cell)| Run {
                    text,
                    fg: fg(cell.style),
                    bg: bg(cell.style),
                    attributes: cell.attributes,
                })
                .collect()
        })
        .collect()
}
