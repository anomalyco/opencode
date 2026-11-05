//! The P-COMP cell fixture format, shared with `parity/lib/cells.ts`, which documents it. Parsing accepts what
//! the TypeScript writer emits, and [`Fixture::to_json`] writes the same bytes for the same cells.

use opentui::native::{Capture, Cell};
use opentui::style::{Attributes, Color, Intent};
use serde::Deserialize;
use std::collections::HashMap;
use std::fmt::Write;
use std::path::Path;

/// A grid of cells, row-major, `width * height` long.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fixture {
    pub width: u32,
    pub height: u32,
    pub cells: Vec<Cell>,
}

#[derive(Deserialize)]
struct Raw {
    width: u32,
    height: u32,
    rows: Vec<Row>,
    styles: Vec<String>,
    runs: Vec<Vec<(usize, u32)>>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Row {
    Text(String),
    Cells(Vec<String>),
}

impl Fixture {
    pub fn load(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        let text = std::fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))?;
        Self::parse(&text).map_err(|error| format!("{}: {error}", path.display()))
    }

    pub fn parse(text: &str) -> Result<Self, String> {
        let raw: Raw = serde_json::from_str(text).map_err(|error| error.to_string())?;
        let styles = raw.styles.iter().map(|style| parse_style(style)).collect::<Result<Vec<_>, _>>()?;
        if raw.rows.len() != raw.height as usize || raw.runs.len() != raw.height as usize {
            return Err(format!(
                "expected {} rows and runs, found {} and {}",
                raw.height,
                raw.rows.len(),
                raw.runs.len()
            ));
        }
        let mut cells = Vec::with_capacity(raw.width as usize * raw.height as usize);
        for (y, (row, runs)) in raw.rows.into_iter().zip(raw.runs).enumerate() {
            let symbols = match row {
                Row::Text(text) => text.chars().map(String::from).collect(),
                Row::Cells(symbols) => symbols,
            };
            let run_width: u32 = runs.iter().map(|run| run.1).sum();
            if symbols.len() != raw.width as usize || run_width != raw.width {
                return Err(format!(
                    "row {y}: {} symbols and {run_width} styled cells, expected {}",
                    symbols.len(),
                    raw.width
                ));
            }
            let mut symbols = symbols.into_iter();
            for (style, count) in runs {
                let (fg, bg, attributes) = *styles.get(style).ok_or_else(|| format!("row {y}: no style {style}"))?;
                for symbol in symbols.by_ref().take(count as usize) {
                    cells.push(Cell { symbol, fg, bg, attributes });
                }
            }
        }
        Ok(Self { width: raw.width, height: raw.height, cells })
    }

    pub fn from_capture(capture: &Capture) -> Self {
        Self { width: capture.width, height: capture.height, cells: capture.cells.clone() }
    }

    /// The cell at column `x` and row `y`, or `None` outside the grid.
    pub fn cell(&self, x: u32, y: u32) -> Option<&Cell> {
        if x >= self.width || y >= self.height {
            return None;
        }
        self.cells.get(y as usize * self.width as usize + x as usize)
    }

    pub fn cell_mut(&mut self, x: u32, y: u32) -> Option<&mut Cell> {
        if x >= self.width || y >= self.height {
            return None;
        }
        self.cells.get_mut(y as usize * self.width as usize + x as usize)
    }

    pub(crate) fn row(&self, y: u32) -> &[Cell] {
        let start = y as usize * self.width as usize;
        &self.cells[start..start + self.width as usize]
    }

    /// The fixture as the TypeScript writer formats it.
    pub fn to_json(&self) -> String {
        let mut styles: Vec<String> = Vec::new();
        let mut index: HashMap<String, usize> = HashMap::new();
        let mut rows = Vec::new();
        let mut runs = Vec::new();
        for y in 0..self.height {
            let cells = self.row(y);
            let row: Vec<&str> = cells.iter().map(|cell| cell.symbol.as_str()).collect();
            rows.push(if row.iter().all(|symbol| symbol.chars().count() == 1) {
                json(&row.concat())
            } else {
                json(&row)
            });
            let mut line: Vec<(usize, u32)> = Vec::new();
            for cell in cells {
                let key = format_style(cell);
                let style = *index.entry(key.clone()).or_insert_with(|| {
                    styles.push(key);
                    styles.len() - 1
                });
                match line.last_mut() {
                    Some(last) if last.0 == style => last.1 += 1,
                    _ => line.push((style, 1)),
                }
            }
            runs.push(json(&line));
        }
        let lines = |rows: &[String]| rows.iter().map(|row| format!("    {row}")).collect::<Vec<_>>().join(",\n");
        let styles = if styles.is_empty() {
            "[]".to_owned()
        } else {
            format!(
                "[\n{}\n  ]",
                styles.iter().map(|style| format!("    {}", json(style))).collect::<Vec<_>>().join(",\n")
            )
        };
        let mut out = String::new();
        let _ = write!(
            out,
            "{{\n  \"width\": {},\n  \"height\": {},\n  \"rows\": [\n{}\n  ],\n  \"styles\": {styles},\n  \"runs\": [\n{}\n  ]\n}}\n",
            self.width,
            self.height,
            lines(&rows),
            lines(&runs),
        );
        out
    }
}

fn json(value: &(impl serde::Serialize + ?Sized)) -> String {
    serde_json::to_string(value).expect("fixture values serialize")
}

fn format_style(cell: &Cell) -> String {
    format!("{} {} {}", format_color(cell.fg), format_color(cell.bg), cell.attributes.bits())
}

pub(crate) fn format_color(color: Color) -> String {
    let rgba = format!("#{:02x}{:02x}{:02x}{:02x}", color.r, color.g, color.b, color.a);
    match color.intent() {
        Intent::Rgb => rgba,
        Intent::Indexed(slot) => format!("{rgba}@{slot}"),
        Intent::Default => format!("{rgba}@default"),
    }
}

fn parse_style(style: &str) -> Result<(Color, Color, Attributes), String> {
    let mut parts = style.split(' ');
    let (Some(fg), Some(bg), Some(attributes), None) = (parts.next(), parts.next(), parts.next(), parts.next()) else {
        return Err(format!("style {style:?}: expected \"fg bg attributes\""));
    };
    let attributes = attributes.parse::<u8>().map_err(|_| format!("style {style:?}: bad attributes"))?;
    Ok((parse_color(fg)?, parse_color(bg)?, Attributes::from_bits(attributes)))
}

// Builds the native color words so the snapshot of a palette or default color is kept as written.
fn parse_color(text: &str) -> Result<Color, String> {
    let error = || format!("color {text:?}: expected #rrggbbaa, #rrggbbaa@<slot>, or #rrggbbaa@default");
    let (rgba, intent) = text.split_once('@').map_or((text, None), |(rgba, intent)| (rgba, Some(intent)));
    let digits = rgba.strip_prefix('#').filter(|digits| digits.len() == 8).ok_or_else(error)?;
    let value = u32::from_str_radix(digits, 16).map_err(|_| error())?;
    let [r, g, b, a] = value.to_be_bytes().map(u16::from);
    let shift = opentui::sys::OT_COLOR_META_SHIFT;
    let (slot, intent) = match intent {
        None => (0, opentui::sys::OT_COLOR_RGB),
        Some("default") => (0, opentui::sys::OT_COLOR_DEFAULT),
        Some(slot) => (slot.parse::<u8>().map_err(|_| error())?, opentui::sys::OT_COLOR_INDEXED),
    };
    Ok(Color::from_raw([r | (u16::from(slot) << shift), g | ((intent as u16) << shift), b, a]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colors_round_trip_every_intent() {
        for color in [Color::rgba(1, 2, 3, 4), Color::indexed(3), Color::indexed(200), Color::DEFAULT_BACKGROUND] {
            assert_eq!(parse_color(&format_color(color)), Ok(color));
        }
        assert!(parse_color("#123456").is_err());
        assert!(parse_color("#12345678@x").is_err());
    }

    #[test]
    fn parse_rejects_rows_of_the_wrong_width() {
        let text =
            r##"{"width": 2, "height": 1, "rows": ["abc"], "styles": ["#00000000 #00000000 0"], "runs": [[[0, 2]]]}"##;
        assert!(Fixture::parse(text).unwrap_err().contains("row 0"));
    }
}
