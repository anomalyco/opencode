//! Reads capture and match results from rendered cells.

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
