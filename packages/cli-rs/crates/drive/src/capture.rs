//! `ui.capture` and `ui.matches` from captured cells, as `actions.ts` reads Core's render buffer.

use opentui::native::Capture;
use serde_json::{Value, json};

/// A `Frontend.CapturedFrame`: each row's cells grouped into spans of equal colors and attributes, as Core's
/// `getSpanLines` groups them. A span's width counts its cells, including the trailing cells of wide graphemes.
pub fn frame(capture: &Capture) -> Value {
    let width = capture.width as usize;
    let lines: Vec<Value> = capture
        .cells
        .chunks(width.max(1))
        .take(capture.height as usize)
        .map(|row| {
            let mut spans: Vec<Span> = Vec::new();
            for cell in row {
                let fg = rgba(cell.fg);
                let bg = rgba(cell.bg);
                let attributes = cell.attributes.bits();
                match spans.last_mut() {
                    Some(span) if span.fg == fg && span.bg == bg && span.attributes == attributes => {
                        span.text.push_str(&cell.symbol);
                        span.width += 1;
                    }
                    _ => spans.push(Span { text: cell.symbol.clone(), fg, bg, attributes, width: 1 }),
                }
            }
            json!({ "spans": spans.into_iter().map(Span::json).collect::<Vec<_>>() })
        })
        .collect();
    json!({
        "cols": capture.width,
        "rows": capture.height,
        "cursor": [0, 0],
        "lines": lines,
        "images": [],
    })
}

/// Whether the frame's text contains `text`. Rows are joined without line breaks, as Core's `getRealCharBytes`
/// returns them, so a match may run across a row's end.
pub fn matches(capture: &Capture, text: &str) -> bool {
    capture.cells.iter().map(|cell| cell.symbol.as_str()).collect::<String>().contains(text)
}

struct Span {
    text: String,
    fg: [u8; 4],
    bg: [u8; 4],
    attributes: u8,
    width: u32,
}

impl Span {
    fn json(self) -> Value {
        json!({ "text": self.text, "fg": self.fg, "bg": self.bg, "attributes": self.attributes, "width": self.width })
    }
}

fn rgba(color: opentui::style::Color) -> [u8; 4] {
    [color.r, color.g, color.b, color.a]
}

#[cfg(test)]
mod tests {
    use super::*;
    use opentui::native::Cell;
    use opentui::style::{Attributes, Color};

    fn cell(symbol: &str, fg: Color, attributes: Attributes) -> Cell {
        Cell { symbol: symbol.into(), fg, bg: Color::rgb(0, 0, 0), attributes }
    }

    #[test]
    fn rows_group_into_spans() {
        let white = Color::rgb(255, 255, 255);
        let red = Color::rgb(255, 0, 0);
        let capture = Capture {
            width: 4,
            height: 2,
            cells: vec![
                cell("a", white, Attributes::NONE),
                cell("b", white, Attributes::NONE),
                cell("c", white, Attributes::BOLD),
                cell("d", red, Attributes::BOLD),
                cell("世", white, Attributes::NONE),
                cell("", white, Attributes::NONE),
                cell("x", white, Attributes::NONE),
                cell(" ", white, Attributes::NONE),
            ],
        };
        let frame = frame(&capture);
        assert_eq!(frame["cols"], 4);
        assert_eq!(frame["cursor"], json!([0, 0]));
        assert_eq!(
            frame["lines"][0]["spans"],
            json!([
                { "text": "ab", "fg": [255, 255, 255, 255], "bg": [0, 0, 0, 255], "attributes": 0, "width": 2 },
                { "text": "c", "fg": [255, 255, 255, 255], "bg": [0, 0, 0, 255], "attributes": 1, "width": 1 },
                { "text": "d", "fg": [255, 0, 0, 255], "bg": [0, 0, 0, 255], "attributes": 1, "width": 1 },
            ])
        );
        assert_eq!(frame["lines"][1]["spans"][0]["text"], "世x ");
        assert_eq!(frame["lines"][1]["spans"][0]["width"], 4);
        assert!(matches(&capture, "abcd世x"));
        assert!(!matches(&capture, "abcd\n"));
    }
}
