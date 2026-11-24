//! Records a headless app as a drive timeline. TS records the bytes its renderer writes; a headless opentui-rust app
//! writes none, so each presented frame that differs from the last is written as a full repaint.

use base64::Engine;
use opentui::native::Capture;
use opentui::style::{Attributes, Color};
use serde_json::json;
use std::fmt::Write as _;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

/// A timeline being written, from the app's start until `ui.recording.finish`.
pub struct Recorder {
    path: PathBuf,
    file: Option<BufWriter<File>>,
    start: Instant,
    last: Option<Capture>,
}

impl Recorder {
    /// Creates the timeline at `path` and writes its header for a `cols` by `rows` screen.
    pub fn create(path: &Path, cols: u16, rows: u16) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = BufWriter::new(File::create(path)?);
        let header = json!({ "type": "header", "version": 1, "cols": cols, "rows": rows, "encoding": "base64" });
        writeln!(file, "{header}")?;
        Ok(Self { path: path.to_owned(), file: Some(file), start: Instant::now(), last: None })
    }

    /// Writes `frame`, after a resize record when its size changed. A frame equal to the last one writes nothing,
    /// and a failed write ends the recording.
    pub fn frame(&mut self, frame: &Capture) {
        if self.file.is_none() || self.last.as_ref() == Some(frame) {
            return;
        }
        let at_ms = u64::try_from(self.start.elapsed().as_millis()).unwrap_or(u64::MAX);
        let resized = self.last.as_ref().is_some_and(|last| (last.width, last.height) != (frame.width, frame.height));
        let data = base64::engine::general_purpose::STANDARD.encode(repaint(frame));
        let file = self.file.as_mut().expect("checked above");
        let written = (|| {
            if resized {
                let resize = json!({ "type": "resize", "at_ms": at_ms, "cols": frame.width, "rows": frame.height });
                writeln!(file, "{resize}")?;
            }
            writeln!(file, "{}", json!({ "type": "output", "at_ms": at_ms, "data": data }))
        })();
        if let Err(error) = written {
            log::warn!("drive recording stopped: {}: {error}", self.path.display());
            self.file = None;
        }
        self.last = Some(frame.clone());
    }

    /// Flushes and closes the timeline, and returns its path. Later frames are not recorded; finishing again returns
    /// the path.
    pub fn finish(&mut self) -> Result<String, String> {
        if let Some(mut file) = self.file.take() {
            file.flush().map_err(|error| format!("Failed to finish UI recording: {error}"))?;
        }
        Ok(self.path.to_string_lossy().into_owned())
    }
}

/// The terminal output that paints `frame` over the whole screen. The cursor stays hidden: a frame has none.
fn repaint(frame: &Capture) -> Vec<u8> {
    let mut out = String::from("\x1b[?25l\x1b[0m");
    let width = frame.width.max(1) as usize;
    for (y, row) in frame.cells.chunks(width).take(frame.height as usize).enumerate() {
        let _ = write!(out, "\x1b[{};1H", y + 1);
        let mut style = None;
        for cell in row {
            let current = (cell.fg, cell.bg, cell.attributes);
            if style != Some(current) {
                sgr(&mut out, cell.fg, cell.bg, cell.attributes);
                style = Some(current);
            }
            // The trailing cells of a wide grapheme are empty: the grapheme already took their columns.
            out.push_str(&cell.symbol);
        }
    }
    out.push_str("\x1b[0m");
    out.into_bytes()
}

fn sgr(out: &mut String, fg: Color, bg: Color, attributes: Attributes) {
    out.push_str("\x1b[0");
    for (attribute, code) in [
        (Attributes::BOLD, 1),
        (Attributes::DIM, 2),
        (Attributes::ITALIC, 3),
        (Attributes::UNDERLINE, 4),
        (Attributes::BLINK, 5),
        (Attributes::INVERSE, 7),
        (Attributes::HIDDEN, 8),
        (Attributes::STRIKETHROUGH, 9),
    ] {
        if !attributes.is_empty() && attributes.contains(attribute) {
            let _ = write!(out, ";{code}");
        }
    }
    // A transparent color shows the terminal's default.
    for (color, rgb, default) in [(fg, 38, 39), (bg, 48, 49)] {
        let _ = if color.a == 0 {
            write!(out, ";{default}")
        } else {
            write!(out, ";{rgb};2;{};{};{}", color.r, color.g, color.b)
        };
    }
    out.push('m');
}

#[cfg(test)]
mod tests {
    use super::*;
    use opentui::native::Cell;

    fn cell(symbol: &str, fg: Color, attributes: Attributes) -> Cell {
        Cell { symbol: symbol.into(), fg, bg: Color::rgba(0, 0, 0, 0), attributes }
    }

    /// The header comes first; equal frames write once; a new size writes a resize record before the frame; nothing
    /// is written after finish, which returns the path each time.
    #[test]
    fn frames_become_a_timeline() {
        let directory = opencode_util::temp::tempdir().unwrap();
        let path = directory.path().join("media").join("recording.jsonl");
        let mut recorder = Recorder::create(&path, 2, 1).unwrap();
        let red = Color::rgb(255, 0, 0);
        let frame = Capture {
            width: 2,
            height: 1,
            cells: vec![cell("界", red, Attributes::BOLD), cell("", red, Attributes::BOLD)],
        };
        recorder.frame(&frame);
        recorder.frame(&frame);
        let wide = Capture {
            width: 3,
            height: 1,
            cells: [frame.cells.clone(), vec![cell("x", red, Attributes::NONE)]].concat(),
        };
        recorder.frame(&wide);
        assert_eq!(recorder.finish().unwrap(), path.to_string_lossy());
        recorder.frame(&frame);
        assert_eq!(recorder.finish().unwrap(), path.to_string_lossy());

        let lines: Vec<serde_json::Value> =
            std::fs::read_to_string(&path).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        let kinds: Vec<&str> = lines.iter().map(|line| line["type"].as_str().unwrap()).collect();
        assert_eq!(kinds, ["header", "output", "resize", "output"]);
        assert_eq!(lines[0], json!({ "type": "header", "version": 1, "cols": 2, "rows": 1, "encoding": "base64" }));
        assert_eq!((lines[2]["cols"].as_u64(), lines[2]["rows"].as_u64()), (Some(3), Some(1)));
        let decode = |line: &serde_json::Value| {
            let data = base64::engine::general_purpose::STANDARD.decode(line["data"].as_str().unwrap()).unwrap();
            String::from_utf8(data).unwrap()
        };
        assert_eq!(decode(&lines[1]), "\x1b[?25l\x1b[0m\x1b[1;1H\x1b[0;1;38;2;255;0;0;49m界\x1b[0m");
        assert_eq!(
            decode(&lines[3]),
            "\x1b[?25l\x1b[0m\x1b[1;1H\x1b[0;1;38;2;255;0;0;49m界\x1b[0;38;2;255;0;0;49mx\x1b[0m"
        );
    }
}
