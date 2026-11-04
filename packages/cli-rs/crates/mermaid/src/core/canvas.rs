//! The character grid diagrams draw into (`core/canvas.ts`).

use super::text;

const MAX_CELLS: i64 = 250_000;

/// The diagram does not fit the cell limit (TS `DiagramCanvasSizeError`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SizeError {
    pub width: i32,
    pub height: i32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cell<S> {
    pub ch: String,
    pub style: Option<S>,
    /// Text attributes (flowchart italics); 0 for none.
    pub attributes: u8,
}

impl<S> Cell<S> {
    fn empty() -> Self {
        Self { ch: " ".to_string(), style: None, attributes: 0 }
    }
}

pub type Merge<S> = fn(&Cell<S>, Cell<S>) -> Cell<S>;

pub struct Canvas<S> {
    pub width: i32,
    pub height: i32,
    cells: Vec<Vec<Cell<S>>>,
    row_ends: Vec<i32>,
    merge: Option<Merge<S>>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Trim {
    pub top: bool,
    pub bottom: bool,
}

pub const TRIM_BOTH: Trim = Trim { top: true, bottom: true };
pub const TRIM_BOTTOM: Trim = Trim { top: false, bottom: true };
pub const TRIM_NONE: Trim = Trim { top: false, bottom: false };

impl<S: Copy + PartialEq> Canvas<S> {
    pub fn new(width: i32, height: i32, merge: Option<Merge<S>>) -> Result<Self, SizeError> {
        if width < 0 || height < 0 || i64::from(width) * i64::from(height) > MAX_CELLS {
            return Err(SizeError { width, height });
        }
        Ok(Self {
            width,
            height,
            cells: (0..height).map(|_| (0..width).map(|_| Cell::empty()).collect()).collect(),
            row_ends: vec![0; height as usize],
            merge,
        })
    }

    pub fn rows(&self) -> &[Vec<Cell<S>>] {
        &self.cells
    }

    pub fn cell(&self, x: i32, y: i32) -> Option<&Cell<S>> {
        if x < 0 || y < 0 {
            return None;
        }
        self.cells.get(y as usize)?.get(x as usize)
    }

    pub fn set(&mut self, x: i32, y: i32, ch: &str, style: Option<S>) {
        self.write(x, y, ch, style, 0, true);
    }

    pub fn set_with(&mut self, x: i32, y: i32, ch: &str, style: Option<S>, attributes: u8) {
        self.write(x, y, ch, style, attributes, true);
    }

    pub fn replace(&mut self, x: i32, y: i32, ch: &str, style: Option<S>) {
        self.write(x, y, ch, style, 0, false);
    }

    fn write(&mut self, x: i32, y: i32, ch: &str, style: Option<S>, attributes: u8, merge: bool) {
        if y < 0 || y >= self.height || x < 0 || x >= self.width {
            return;
        }
        let (ux, uy) = (x as usize, y as usize);
        let incoming = Cell { ch: ch.to_string(), style, attributes };
        let cell = match (merge, self.merge) {
            (true, Some(merge)) => merge(&self.cells[uy][ux], incoming),
            _ => incoming,
        };
        let blank = cell.ch == " ";
        self.cells[uy][ux] = cell;
        if !blank {
            self.row_ends[uy] = self.row_ends[uy].max(x + 1);
        } else if self.row_ends[uy] == x + 1 {
            let mut end = x;
            while end > 0 && self.cells[uy][end as usize - 1].ch == " " {
                end -= 1;
            }
            self.row_ends[uy] = end;
        }
    }

    pub fn text(&mut self, x: i32, y: i32, value: &str, style: Option<S>) {
        self.text_with(x, y, value, style, |_| 0);
    }

    /// Writes `value` from `x`; `attributes` gives each cell's attributes by its column.
    pub fn text_with(&mut self, x: i32, y: i32, value: &str, style: Option<S>, attributes: impl Fn(i32) -> u8) {
        if value.bytes().all(|byte| (0x20..0x7f).contains(&byte)) {
            for (index, byte) in value.bytes().enumerate() {
                let cx = x + index as i32;
                let ch = [byte];
                self.set_with(cx, y, std::str::from_utf8(&ch).unwrap_or(" "), style, attributes(cx));
            }
            return;
        }
        let mut offset = 0;
        for grapheme in text::graphemes(value) {
            let width = text::grapheme_width(grapheme).max(1);
            if x + offset < 0 || x + offset + width > self.width {
                offset += width;
                continue;
            }
            self.set_with(x + offset, y, grapheme, style, attributes(x + offset));
            for continuation in 1..width {
                let cx = x + offset + continuation;
                self.set_with(cx, y, "", style, attributes(cx));
            }
            offset += width;
        }
    }

    fn row_range(&self, trim: Trim) -> (usize, usize) {
        let mut start = 0;
        let mut end = self.cells.len();
        if trim.top {
            while start < end && self.row_ends[start] == 0 {
                start += 1;
            }
        }
        if trim.bottom {
            while end > start && self.row_ends[end - 1] == 0 {
                end -= 1;
            }
        }
        (start, end)
    }

    fn row_text(&self, row: usize) -> String {
        self.cells[row][..self.row_ends[row] as usize].iter().map(|cell| cell.ch.as_str()).collect()
    }

    pub fn to_text(&self, trim: Trim) -> String {
        let (start, end) = self.row_range(trim);
        (start..end).map(|row| self.row_text(row)).collect::<Vec<_>>().join("\n")
    }

    pub fn text_height(&self, trim: Trim) -> i32 {
        let (start, end) = self.row_range(trim);
        (end - start) as i32
    }

    /// The styled runs of each row: cells with equal `key` join one run. A row ends at its last non-blank
    /// cell or after the styled blanks that follow it.
    pub fn runs<K: PartialEq>(&self, trim: Trim, key: impl Fn(&Cell<S>) -> K) -> Vec<Vec<(String, &Cell<S>)>> {
        let (start, end) = self.row_range(trim);
        (start..end)
            .map(|row_index| {
                let row = &self.cells[row_index];
                let mut row_end = self.row_ends[row_index] as usize;
                while row_end < row.len() && row[row_end].style.is_some() {
                    row_end += 1;
                }
                let mut runs: Vec<(String, &Cell<S>)> = Vec::new();
                let mut current: Option<(&Cell<S>, K)> = None;
                let mut text = String::new();
                for cell in &row[..row_end] {
                    let next = key(cell);
                    let same = current.as_ref().is_some_and(|(_, key)| *key == next);
                    if !same {
                        if let Some((first, _)) = current.take()
                            && !text.is_empty()
                        {
                            runs.push((std::mem::take(&mut text), first));
                        }
                        text.clear();
                        current = Some((cell, next));
                    }
                    text.push_str(&cell.ch);
                }
                if let Some((first, _)) = current
                    && !text.is_empty()
                {
                    runs.push((text, first));
                }
                runs
            })
            .collect()
    }
}
