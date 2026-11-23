//! A canvas's display list: what a plugin draws into a [`crate::v2::Node::Canvas`], which the host keeps and replays
//! on every frame it paints until the plugin presents another. The plugin owns the cells inside the canvas; the host
//! owns its rectangle, its clip and the clock.
//!
//! A list is bytes, the same on every carrier: a version byte, then records. A record is its operation (one byte), the
//! length of its payload (`u32`, little-endian) and the payload, so a reader skips an operation it does not know.
//! Coordinates are cells relative to the canvas's top-left corner; drawing outside it is cut off. The operations
//! mirror OpenTUI's `Painter`, and name no OpenTUI handle:
//!
//! | op | payload |
//! | --- | --- |
//! | 1 fill | `x: i16, y: i16, width: u16, height: u16, color` |
//! | 2 text | `x: i16, y: i16, style`, then the text in UTF-8 |
//! | 3 cell | `x: i16, y: i16, style, char: u32` |
//! | 4 cells | `x: i16, y: i16, width: u16`, then each cell's `style, char: u32`, in rows of `width` |
//! | 5 rect | `x: i16, y: i16, width: u16, height: u16, border: u8, color, background` (alpha 0: no fill) |
//! | 6 clip | `x: i16, y: i16, width: u16, height: u16`: drawing until its `pop` is cut to the rectangle |
//! | 7 pop | nothing |
//!
//! A color is `r, g, b, a` bytes. A style is `flags: u8` (1 a foreground, 2 a background), `attributes: u8` (bold 1,
//! dim 2, italic 4, underline 8, inverse 16, strikethrough 32), then the foreground and the background colors, each
//! written whether it is set or not. A `border` is a [`BorderStyle`]: 0 single, 1 double, 2 rounded, 3 heavy.
//!
//! The host checks a list whole before it keeps it ([`check`]): one it cannot read is refused, and one over a limit
//! ([`MAX_BYTES`], [`MAX_OPS`] with a run of cells counting one a cell, [`MAX_TEXT_BYTES`] a text, [`MAX_CLIPS`] open)
//! is not drawn; the canvas then shows a placeholder. The host bounds what lists cost it beyond this, by the size
//! they are drawn at, and for each plugin and in total.
//!
//! A cell, alone or in a run, takes a character one column wide; the host draws one of another width as U+FFFD. Text
//! that is wider, or combined, is drawn with `text`, which takes the columns its characters need.

use crate::{BorderStyle, Rgba};

/// The version a list starts with.
pub const VERSION: u8 = 1;
/// The most bytes a list may have. A full screen of 200 x 60 cells is 168,006 bytes as one `cells` record.
pub const MAX_BYTES: usize = 1 << 20;
/// The most operations a list may have, a run of cells counting one a cell: what one list may ask the renderer to
/// record.
pub const MAX_OPS: usize = 1 << 16;
/// The most clips a list may have open at once.
pub const MAX_CLIPS: usize = 32;
/// The most bytes one text may have: OpenTUI's renderer records no longer text (`OT_BUFFER_TEXT_BYTES_MAX`), and a
/// text past it would fail the whole frame, not the canvas.
pub const MAX_TEXT_BYTES: usize = 1 << 16;

const FILL: u8 = 1;
const TEXT: u8 = 2;
const CELL: u8 = 3;
const CELLS: u8 = 4;
const RECT: u8 = 5;
const CLIP: u8 = 6;
const POP: u8 = 7;

/// A style's bytes.
const STYLE: usize = 10;
/// A cell's bytes in a `cells` record: its style and its character.
const CELL_BYTES: usize = STYLE + 4;

/// How a cell is drawn. Without a foreground the terminal's own is used; without a background the cell keeps the one
/// drawn under it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Style {
    pub fg: Option<Rgba>,
    pub bg: Option<Rgba>,
    pub bold: bool,
    pub dim: bool,
    pub italic: bool,
    pub underline: bool,
    pub inverse: bool,
    pub strikethrough: bool,
}

impl Style {
    pub const fn new() -> Self {
        Self {
            fg: None,
            bg: None,
            bold: false,
            dim: false,
            italic: false,
            underline: false,
            inverse: false,
            strikethrough: false,
        }
    }

    pub const fn fg(self, color: Rgba) -> Self {
        Self { fg: Some(color), ..self }
    }

    pub const fn bg(self, color: Rgba) -> Self {
        Self { bg: Some(color), ..self }
    }

    pub const fn bold(self) -> Self {
        Self { bold: true, ..self }
    }

    pub const fn dim(self) -> Self {
        Self { dim: true, ..self }
    }

    pub const fn italic(self) -> Self {
        Self { italic: true, ..self }
    }

    pub const fn underline(self) -> Self {
        Self { underline: true, ..self }
    }

    pub const fn inverse(self) -> Self {
        Self { inverse: true, ..self }
    }

    pub const fn strikethrough(self) -> Self {
        Self { strikethrough: true, ..self }
    }

    fn attributes(&self) -> u8 {
        [self.bold, self.dim, self.italic, self.underline, self.inverse, self.strikethrough]
            .iter()
            .enumerate()
            .fold(0, |bits, (index, on)| bits | (u8::from(*on) << index))
    }

    fn write(&self, out: &mut Vec<u8>) {
        out.push(u8::from(self.fg.is_some()) | u8::from(self.bg.is_some()) << 1);
        out.push(self.attributes());
        for color in [self.fg, self.bg] {
            color_bytes(color.unwrap_or(Rgba::new(0, 0, 0, 0)), out);
        }
    }

    fn read(bytes: &[u8]) -> Self {
        let (flags, bits) = (bytes[0], bytes[1]);
        let on = |index: u8| bits & (1 << index) != 0;
        Self {
            fg: (flags & 1 != 0).then(|| color(&bytes[2..6])),
            bg: (flags & 2 != 0).then(|| color(&bytes[6..10])),
            bold: on(0),
            dim: on(1),
            italic: on(2),
            underline: on(3),
            inverse: on(4),
            strikethrough: on(5),
        }
    }
}

/// One operation of a list, as [`ops`] reads it.
#[derive(Clone, Copy, Debug, PartialEq)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Op<'a> {
    Fill { x: i16, y: i16, width: u16, height: u16, color: Rgba },
    Text { x: i16, y: i16, style: Style, text: &'a str },
    Cell { x: i16, y: i16, style: Style, char: char },
    Cells { x: i16, y: i16, width: u16, cells: Cells<'a> },
    Rect { x: i16, y: i16, width: u16, height: u16, border: BorderStyle, color: Rgba, background: Option<Rgba> },
    Clip { x: i16, y: i16, width: u16, height: u16 },
    Pop,
}

/// The cells of a `cells` record, in rows of its width.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cells<'a>(&'a [u8]);

impl<'a> Cells<'a> {
    pub fn len(&self) -> usize {
        self.0.len() / CELL_BYTES
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Each cell's style and character; a character the list could not hold reads as a space.
    pub fn iter(&self) -> impl Iterator<Item = (Style, char)> + 'a {
        let (cells, _) = self.0.as_chunks::<CELL_BYTES>();
        cells.iter().map(|cell| (Style::read(cell), char_at(&cell[STYLE..]).unwrap_or(' ')))
    }
}

/// Why a list is not drawn.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Error {
    /// The bytes are not a list: the host refuses it whole.
    Malformed(String),
    /// A list over a limit: the canvas shows a placeholder.
    Over(Limit),
}

/// The limit a list is over.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Limit {
    /// Its bytes, of [`MAX_BYTES`].
    Bytes(usize),
    /// Its operations, of [`MAX_OPS`].
    Ops(usize),
    /// One text's bytes, of [`MAX_TEXT_BYTES`].
    Text(usize),
    /// Clips open at once, of [`MAX_CLIPS`].
    Clips,
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Malformed(why) => write!(f, "a canvas list the host cannot read: {why}"),
            Error::Over(Limit::Bytes(bytes)) => write!(f, "a canvas list of {bytes} bytes, of {MAX_BYTES}"),
            Error::Over(Limit::Ops(ops)) => write!(f, "a canvas list of {ops} operations, of {MAX_OPS}"),
            Error::Over(Limit::Text(bytes)) => write!(f, "a canvas text of {bytes} bytes, of {MAX_TEXT_BYTES}"),
            Error::Over(Limit::Clips) => write!(f, "a canvas list with more than {MAX_CLIPS} clips open"),
        }
    }
}

/// What a list holds, once [`check`] read it whole.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Checked {
    pub ops: usize,
}

/// Reads `bytes` whole: the operations it holds, or why the host does not draw it. Operations of a kind this version
/// does not know count and are skipped.
pub fn check(bytes: &[u8]) -> Result<Checked, Error> {
    // Bytes that are no list are malformed whatever their length.
    if bytes.first() != Some(&VERSION) {
        let _ = records(bytes)?;
    }
    if bytes.len() > MAX_BYTES {
        return Err(Error::Over(Limit::Bytes(bytes.len())));
    }
    let (mut count, mut clips) = (0, 0usize);
    // The list is read whole, so one that is malformed is refused as such also past a limit.
    let mut over = None;
    for op in records(bytes)? {
        let (kind, payload) = op?;
        let op = decode(kind, payload)?;
        count += match op {
            Some(Op::Cells { cells, .. }) => cells.len().max(1),
            _ => 1,
        };
        if count > MAX_OPS {
            over = over.or(Some(Limit::Ops(count)));
        }
        match op {
            Some(Op::Text { text, .. }) if text.len() > MAX_TEXT_BYTES => over = over.or(Some(Limit::Text(text.len()))),
            Some(Op::Clip { .. }) => {
                clips += 1;
                if clips > MAX_CLIPS {
                    over = over.or(Some(Limit::Clips));
                }
            }
            Some(Op::Pop) => {
                clips = clips.checked_sub(1).ok_or_else(|| Error::Malformed("a pop without a clip".into()))?;
            }
            _ => {}
        }
    }
    match over {
        Some(limit) => Err(Error::Over(limit)),
        None => Ok(Checked { ops: count }),
    }
}

/// The operations of a list [`check`] took, in order, without the ones this version does not know. A record it cannot
/// read ends them.
pub fn ops(bytes: &[u8]) -> impl Iterator<Item = Op<'_>> {
    records(bytes)
        .into_iter()
        .flatten()
        .map_while(|record| record.ok())
        .filter_map(|(kind, payload)| decode(kind, payload).ok().flatten())
}

/// Each record's operation and payload, after the version.
fn records(bytes: &[u8]) -> Result<impl Iterator<Item = Result<(u8, &[u8]), Error>>, Error> {
    match bytes.first() {
        Some(&VERSION) => {}
        Some(version) => return Err(Error::Malformed(format!("version {version}"))),
        None => return Err(Error::Malformed("no version".into())),
    }
    let mut rest = &bytes[1..];
    Ok(std::iter::from_fn(move || {
        if rest.is_empty() {
            return None;
        }
        if rest.len() < 5 {
            rest = &[];
            return Some(Err(Error::Malformed("a record cut short".into())));
        }
        let length = u32::from_le_bytes([rest[1], rest[2], rest[3], rest[4]]) as usize;
        let Some(payload) = rest.get(5..5usize.saturating_add(length)) else {
            rest = &[];
            return Some(Err(Error::Malformed("a record longer than the list".into())));
        };
        let kind = rest[0];
        rest = &rest[5 + length..];
        Some(Ok((kind, payload)))
    }))
}

/// The operation of a record; `None` for a kind this version does not know.
fn decode(kind: u8, payload: &[u8]) -> Result<Option<Op<'_>>, Error> {
    let exact = |length: usize| match payload.len() == length {
        true => Ok(()),
        false => Err(Error::Malformed(format!("operation {kind} of {} bytes, not {length}", payload.len()))),
    };
    let at = |index: usize| i16::from_le_bytes([payload[index], payload[index + 1]]);
    let size = |index: usize| u16::from_le_bytes([payload[index], payload[index + 1]]);
    Ok(Some(match kind {
        FILL => {
            exact(12)?;
            Op::Fill { x: at(0), y: at(2), width: size(4), height: size(6), color: color(&payload[8..12]) }
        }
        TEXT => {
            if payload.len() < 4 + STYLE {
                return Err(Error::Malformed("a text record cut short".into()));
            }
            let text = std::str::from_utf8(&payload[4 + STYLE..])
                .map_err(|_| Error::Malformed("a text that is not UTF-8".into()))?;
            Op::Text { x: at(0), y: at(2), style: Style::read(&payload[4..]), text }
        }
        CELL => {
            exact(4 + STYLE + 4)?;
            let char = char_at(&payload[4 + STYLE..]).ok_or_else(|| Error::Malformed("not a character".into()))?;
            Op::Cell { x: at(0), y: at(2), style: Style::read(&payload[4..]), char }
        }
        CELLS => {
            if payload.len() < 6 || !(payload.len() - 6).is_multiple_of(CELL_BYTES) {
                return Err(Error::Malformed("a cells record of a partial cell".into()));
            }
            let cells = &payload[6..];
            if !cells.is_empty() && size(4) == 0 {
                return Err(Error::Malformed("cells in rows of no width".into()));
            }
            if cells.as_chunks::<CELL_BYTES>().0.iter().any(|cell| char_at(&cell[STYLE..]).is_none()) {
                return Err(Error::Malformed("not a character".into()));
            }
            Op::Cells { x: at(0), y: at(2), width: size(4), cells: Cells(cells) }
        }
        RECT => {
            exact(17)?;
            let border = match payload[8] {
                0 => BorderStyle::Single,
                1 => BorderStyle::Double,
                2 => BorderStyle::Rounded,
                3 => BorderStyle::Heavy,
                other => return Err(Error::Malformed(format!("border {other}"))),
            };
            let background = color(&payload[13..17]);
            Op::Rect {
                x: at(0),
                y: at(2),
                width: size(4),
                height: size(6),
                border,
                color: color(&payload[9..13]),
                background: (background.a > 0).then_some(background),
            }
        }
        CLIP => {
            exact(8)?;
            Op::Clip { x: at(0), y: at(2), width: size(4), height: size(6) }
        }
        POP => {
            exact(0)?;
            Op::Pop
        }
        _ => return Ok(None),
    }))
}

fn color(bytes: &[u8]) -> Rgba {
    Rgba::new(bytes[0], bytes[1], bytes[2], bytes[3])
}

fn color_bytes(color: Rgba, out: &mut Vec<u8>) {
    out.extend_from_slice(&[color.r, color.g, color.b, color.a]);
}

fn char_at(bytes: &[u8]) -> Option<char> {
    char::from_u32(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

/// The SDK's builder of a list: each call appends one operation.
///
/// ```
/// use opencode_plugin_abi::Rgba;
/// use opencode_plugin_abi::canvas::{List, Style};
///
/// let mut list = List::new();
/// list.fill(0, 0, 10, 1, Rgba::new(0, 0, 80, 255)).text(1, 0, "score 120", Style::new().fg(Rgba::new(255, 255, 255, 255)));
/// assert!(opencode_plugin_abi::canvas::check(list.as_bytes()).is_ok());
/// ```
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct List {
    bytes: Vec<u8>,
}

impl Default for List {
    fn default() -> Self {
        Self::new()
    }
}

impl List {
    pub fn new() -> Self {
        Self { bytes: vec![VERSION] }
    }

    /// A list of `bytes` as they are, for a plugin that writes the format itself; the host checks it.
    pub fn from_bytes(bytes: Vec<u8>) -> Self {
        Self { bytes }
    }

    pub fn fill(&mut self, x: i16, y: i16, width: u16, height: u16, color: Rgba) -> &mut Self {
        self.record(FILL, |out| {
            rect_bytes(x, y, width, height, out);
            color_bytes(color, out);
        })
    }

    /// One row of text from `(x, y)`; what does not fit is cut off.
    pub fn text(&mut self, x: i16, y: i16, text: &str, style: Style) -> &mut Self {
        self.record(TEXT, |out| {
            point_bytes(x, y, out);
            style.write(out);
            out.extend_from_slice(text.as_bytes());
        })
    }

    pub fn cell(&mut self, x: i16, y: i16, char: char, style: Style) -> &mut Self {
        self.record(CELL, |out| {
            point_bytes(x, y, out);
            style.write(out);
            out.extend_from_slice(&u32::from(char).to_le_bytes());
        })
    }

    /// `cells` from `(x, y)` in rows of `width`: a grid of characters in one record, as a game board or a plot is.
    pub fn cells(&mut self, x: i16, y: i16, width: u16, cells: impl IntoIterator<Item = (char, Style)>) -> &mut Self {
        self.record(CELLS, |out| {
            point_bytes(x, y, out);
            out.extend_from_slice(&width.to_le_bytes());
            for (char, style) in cells {
                style.write(out);
                out.extend_from_slice(&u32::from(char).to_le_bytes());
            }
        })
    }

    /// A rectangle with a border of `border` in `color`, filled with `background` when it has one.
    #[allow(clippy::too_many_arguments)]
    pub fn rect(
        &mut self,
        x: i16,
        y: i16,
        width: u16,
        height: u16,
        border: BorderStyle,
        color: Rgba,
        background: Option<Rgba>,
    ) -> &mut Self {
        self.record(RECT, |out| {
            rect_bytes(x, y, width, height, out);
            out.push(match border {
                BorderStyle::Single => 0,
                BorderStyle::Double => 1,
                BorderStyle::Rounded => 2,
                BorderStyle::Heavy => 3,
            });
            color_bytes(color, out);
            color_bytes(background.unwrap_or(Rgba::new(0, 0, 0, 0)), out);
        })
    }

    /// Cuts what is drawn until the matching [`List::pop`] to a rectangle, inside any clip open already.
    pub fn clip(&mut self, x: i16, y: i16, width: u16, height: u16) -> &mut Self {
        self.record(CLIP, |out| rect_bytes(x, y, width, height, out))
    }

    pub fn pop(&mut self) -> &mut Self {
        self.record(POP, |_| {})
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }

    fn record(&mut self, kind: u8, write: impl FnOnce(&mut Vec<u8>)) -> &mut Self {
        self.bytes.push(kind);
        let at = self.bytes.len();
        self.bytes.extend_from_slice(&[0; 4]);
        write(&mut self.bytes);
        // A record over 4 GiB could not be framed; no list of one is drawn anyway.
        let length = u32::try_from(self.bytes.len() - at - 4).expect("a canvas record under 4 GiB");
        self.bytes[at..at + 4].copy_from_slice(&length.to_le_bytes());
        self
    }
}

fn point_bytes(x: i16, y: i16, out: &mut Vec<u8>) {
    out.extend_from_slice(&x.to_le_bytes());
    out.extend_from_slice(&y.to_le_bytes());
}

fn rect_bytes(x: i16, y: i16, width: u16, height: u16, out: &mut Vec<u8>) {
    point_bytes(x, y, out);
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: Rgba = Rgba::new(255, 0, 0, 255);
    const BLUE: Rgba = Rgba::new(0, 0, 255, 128);

    #[test]
    fn a_list_is_the_bytes_of_its_table() {
        let style = Style { fg: Some(RED), bold: true, underline: true, ..Style::new() };
        let mut list = List::new();
        list.fill(-1, 2, 3, 4, BLUE).text(5, 6, "é", style).clip(0, 0, 9, 9).pop();
        #[rustfmt::skip]
        let expected: Vec<u8> = vec![
            1,
            1, 12, 0, 0, 0, 0xff, 0xff, 2, 0, 3, 0, 4, 0, 0, 0, 255, 128,
            2, 16, 0, 0, 0, 5, 0, 6, 0, 1, 0b1001, 255, 0, 0, 255, 0, 0, 0, 0, 0xc3, 0xa9,
            6, 8, 0, 0, 0, 0, 0, 0, 0, 9, 0, 9, 0,
            7, 0, 0, 0, 0,
        ];
        assert_eq!(list.as_bytes(), expected);
        assert_eq!(check(&expected), Ok(Checked { ops: 4 }));
        let read: Vec<Op<'_>> = ops(&expected).collect();
        assert_eq!(
            read,
            [
                Op::Fill { x: -1, y: 2, width: 3, height: 4, color: BLUE },
                Op::Text { x: 5, y: 6, style, text: "é" },
                Op::Clip { x: 0, y: 0, width: 9, height: 9 },
                Op::Pop,
            ]
        );
    }

    #[test]
    fn every_operation_reads_back() {
        let lit = Style::new().bg(BLUE).fg(RED);
        let mut list = List::new();
        list.cell(1, 1, '█', lit)
            .cells(0, 2, 2, [('a', lit), ('b', Style::new()), ('c', lit.bold())])
            .rect(0, 0, 5, 3, BorderStyle::Rounded, RED, None)
            .rect(0, 0, 5, 3, BorderStyle::Heavy, RED, Some(BLUE));
        let read: Vec<Op<'_>> = ops(list.as_bytes()).collect();
        assert_eq!(read[0], Op::Cell { x: 1, y: 1, style: lit, char: '█' });
        let Op::Cells { width: 2, cells, .. } = read[1] else { panic!("{:?}", read[1]) };
        assert_eq!(cells.iter().collect::<Vec<_>>(), [(lit, 'a'), (Style::new(), 'b'), (lit.bold(), 'c')]);
        assert!(matches!(read[2], Op::Rect { border: BorderStyle::Rounded, background: None, .. }));
        assert!(matches!(read[3], Op::Rect { border: BorderStyle::Heavy, background: Some(BLUE), .. }));
        assert_eq!((cells.len(), cells.is_empty()), (3, false));
        let plain = Style::new();
        for style in
            [plain.bold(), plain.dim(), plain.italic(), plain.underline(), plain.inverse(), plain.strikethrough()]
        {
            let mut list = List::new();
            list.cell(0, 0, 'x', style).cells(0, 0, 1, []);
            let read: Vec<Op<'_>> = ops(list.as_bytes()).collect();
            assert_eq!(read[0], Op::Cell { x: 0, y: 0, style, char: 'x' });
            let Op::Cells { cells, .. } = read[1] else { panic!() };
            assert_eq!((cells.len(), cells.is_empty()), (0, true));
        }
        assert_eq!(check(list.as_bytes()), Ok(Checked { ops: 6 }), "a run of three cells counts three");
    }

    #[test]
    fn an_unknown_operation_is_skipped() {
        let mut bytes = vec![VERSION, 99, 3, 0, 0, 0, 1, 2, 3];
        bytes.extend_from_slice(&List::new().pop().as_bytes()[1..]);
        let mut clipped = List::new();
        clipped.clip(0, 0, 1, 1);
        bytes.splice(1..1, clipped.as_bytes()[1..].iter().copied());
        assert_eq!(check(&bytes), Ok(Checked { ops: 3 }));
        assert_eq!(ops(&bytes).count(), 2);
    }

    #[test]
    fn a_list_the_host_cannot_read_is_refused() {
        let good = List::new().fill(0, 0, 1, 1, RED).clone().into_bytes();
        let malformed = |bytes: &[u8]| matches!(check(bytes), Err(Error::Malformed(_)));
        assert!(malformed(&[]));
        assert!(malformed(&[2]));
        // Bytes that are no list are malformed also past the byte limit: the plugin fails, it is not a placeholder.
        assert!(malformed(&vec![0; MAX_BYTES + 1]));
        assert!(malformed(&good[..good.len() - 1]));
        assert!(malformed(&[&good[..], &[1, 0, 0]].concat()));
        assert!(malformed(&[1, 1, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        let mut text = List::new().text(0, 0, "a", Style::new()).clone().into_bytes();
        *text.last_mut().unwrap() = 0xff;
        assert!(malformed(&text));
        let mut cell = List::new().cell(0, 0, 'a', Style::new()).clone().into_bytes();
        let end = cell.len();
        cell[end - 4..].copy_from_slice(&0xd800u32.to_le_bytes());
        assert!(malformed(&cell));
        let mut run = List::new().cells(0, 0, 2, [('a', Style::new()), ('b', Style::new())]).clone().into_bytes();
        let end = run.len();
        run[end - 4..].copy_from_slice(&0x11_0000u32.to_le_bytes());
        assert!(malformed(&run));
        let mut cells = List::new().cells(0, 0, 1, [('a', Style::new())]).clone().into_bytes();
        cells.push(0);
        cells[2] += 1;
        assert!(malformed(&cells));
        assert!(malformed(List::new().cells(0, 0, 0, [('a', Style::new())]).as_bytes()));
        assert!(!malformed(List::new().cells(0, 0, 0, []).as_bytes()));
        let mut rect = List::new().rect(0, 0, 1, 1, BorderStyle::Single, RED, None).clone().into_bytes();
        rect[14] = 4;
        assert!(malformed(&rect));
        assert!(malformed(List::new().pop().as_bytes()));
    }

    #[test]
    fn a_list_over_a_limit_is_not_drawn() {
        let over = |list: &List| match check(list.as_bytes()) {
            Err(Error::Over(limit)) => Some(limit),
            other => {
                assert!(other.is_ok(), "{other:?}");
                None
            }
        };
        let mut list = List::new();
        for _ in 0..MAX_OPS {
            list.pop_free();
        }
        assert_eq!(check(list.as_bytes()), Ok(Checked { ops: MAX_OPS }));
        list.pop_free();
        assert_eq!(over(&list), Some(Limit::Ops(MAX_OPS + 1)));

        // A run of cells counts one an entry.
        let run = |cells: usize| List::new().cells(0, 0, 200, (0..cells).map(|_| ('x', Style::new()))).clone();
        assert_eq!(check(run(MAX_OPS).as_bytes()), Ok(Checked { ops: MAX_OPS }));
        assert_eq!(over(&run(MAX_OPS + 1)), Some(Limit::Ops(MAX_OPS + 1)));

        // One text the renderer can record, and one byte more.
        let text = |bytes: usize| List::new().text(0, 0, &"x".repeat(bytes), Style::new()).clone();
        assert_eq!(over(&text(MAX_TEXT_BYTES)), None);
        assert_eq!(over(&text(MAX_TEXT_BYTES + 1)), Some(Limit::Text(MAX_TEXT_BYTES + 1)));

        // A list of exactly the most bytes, of texts each within their bound, and one byte more.
        let record = 5 + 4 + STYLE;
        let mut full = List::new();
        while full.as_bytes().len() + record + MAX_TEXT_BYTES < MAX_BYTES {
            full.text(0, 0, &"x".repeat(MAX_TEXT_BYTES), Style::new());
        }
        let rest = MAX_BYTES - full.as_bytes().len() - record;
        full.text(0, 0, &"x".repeat(rest), Style::new());
        assert_eq!(full.as_bytes().len(), MAX_BYTES);
        assert_eq!(over(&full), None);
        let mut longer = List::from_bytes(full.as_bytes()[..full.as_bytes().len() - rest - record].to_vec());
        longer.text(0, 0, &"x".repeat(rest + 1), Style::new());
        assert_eq!(over(&longer), Some(Limit::Bytes(MAX_BYTES + 1)));

        // Clips nested to the bound, and one more: a resource limit, not a malformed list.
        let mut deep = List::new();
        for _ in 0..MAX_CLIPS {
            deep.clip(0, 0, 1, 1);
        }
        assert_eq!(over(&deep), None);
        assert_eq!(over(deep.clip(0, 0, 1, 1)), Some(Limit::Clips));

        // Each says what it is over.
        let said: Vec<String> = [Limit::Bytes(9), Limit::Ops(8), Limit::Text(7), Limit::Clips]
            .map(|limit| Error::Over(limit).to_string())
            .into();
        assert_eq!(
            said,
            [
                format!("a canvas list of 9 bytes, of {MAX_BYTES}"),
                format!("a canvas list of 8 operations, of {MAX_OPS}"),
                format!("a canvas text of 7 bytes, of {MAX_TEXT_BYTES}"),
                format!("a canvas list with more than {MAX_CLIPS} clips open"),
            ]
        );

        // A list over a limit that is malformed too is refused as malformed.
        let mut both = run(MAX_OPS + 1);
        both.pop();
        assert!(matches!(check(both.as_bytes()), Err(Error::Malformed(_))));
    }

    impl List {
        /// An unknown operation with no payload: the smallest record.
        fn pop_free(&mut self) -> &mut Self {
            self.record(200, |_| {})
        }
    }
}
