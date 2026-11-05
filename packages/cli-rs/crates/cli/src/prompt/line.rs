//! The line editing of Node's `readline` (`kTtyWrite`), which Clack reads `line` and `cursor` from
//! for the text prompts. History is left out: a prompt's line only enters it on Enter.

use std::time::{Duration, Instant};

use super::term::Key;

/// readline's `crlfDelay`: an `\n` this soon after an `\r` is the same line ending.
const CRLF_DELAY: Duration = Duration::from_millis(100);

#[derive(Default)]
pub struct Line {
    chars: Vec<char>,
    /// In characters. Node counts UTF-16 units; they differ only for characters outside the BMP.
    cursor: usize,
    return_at: Option<Instant>,
}

impl Line {
    pub fn text(&self) -> String {
        self.chars.iter().collect()
    }

    pub fn cursor(&self) -> usize {
        self.cursor
    }

    /// `rl.write(text)`: inserts at the cursor.
    pub fn write(&mut self, text: &str) {
        self.insert(text);
    }

    /// `rl.write(null, { ctrl: true, name: "h" })`.
    pub fn delete_left(&mut self) {
        if self.cursor > 0 {
            self.cursor -= 1;
            self.chars.remove(self.cursor);
        }
    }

    pub fn feed(&mut self, char: Option<&str>, key: &Key) {
        let name = key.name.as_deref().unwrap_or("");
        if name == "escape" {
            return;
        }
        if key.ctrl && key.shift {
            match name {
                "backspace" => self.delete_line_left(),
                "delete" => self.chars.truncate(self.cursor),
                _ => {}
            }
            return;
        }
        if key.ctrl {
            match name {
                "h" => self.delete_left(),
                "d" if self.cursor < self.chars.len() => {
                    self.chars.remove(self.cursor);
                }
                "u" => self.delete_line_left(),
                "k" => self.chars.truncate(self.cursor),
                "a" => self.cursor = 0,
                "e" => self.cursor = self.chars.len(),
                "b" => self.cursor = self.cursor.saturating_sub(1),
                "f" => self.cursor = (self.cursor + 1).min(self.chars.len()),
                "w" | "backspace" => self.delete_word_left(),
                "delete" => self.delete_word_right(),
                "left" => self.cursor -= self.word_left(),
                "right" => self.cursor += self.word_right(),
                _ => {}
            }
            return;
        }
        if key.meta {
            match name {
                "b" => self.cursor -= self.word_left(),
                "f" => self.cursor += self.word_right(),
                "d" | "delete" => self.delete_word_right(),
                "backspace" => self.delete_word_left(),
                _ => {}
            }
            return;
        }
        if name != "enter" {
            self.return_at = None;
        }
        match name {
            "return" => {
                self.return_at = Some(Instant::now());
                self.clear();
            }
            "enter" => {
                if self.return_at.is_none_or(|at| at.elapsed() > CRLF_DELAY) {
                    self.clear();
                }
                self.return_at = None;
            }
            "backspace" => self.delete_left(),
            "delete" if self.cursor < self.chars.len() => {
                self.chars.remove(self.cursor);
            }
            "left" => self.cursor = self.cursor.saturating_sub(1),
            "right" => self.cursor = (self.cursor + 1).min(self.chars.len()),
            "home" => self.cursor = 0,
            "end" => self.cursor = self.chars.len(),
            "delete" | "up" | "down" => {}
            _ => {
                if let Some(text) = char.filter(|text| !text.is_empty()) {
                    // Line endings inside the text end the line, as in readline.
                    let mut parts = text.split(['\r', '\n']).peekable();
                    while let Some(part) = parts.next() {
                        self.insert(part);
                        if parts.peek().is_some() {
                            self.clear();
                        }
                    }
                }
            }
        }
    }

    /// `kLine`: the line is done, and readline starts a new one.
    fn clear(&mut self) {
        self.chars.clear();
        self.cursor = 0;
    }

    fn insert(&mut self, text: &str) {
        let chars: Vec<char> = text.chars().collect();
        let count = chars.len();
        self.chars.splice(self.cursor..self.cursor, chars);
        self.cursor += count;
    }

    fn delete_line_left(&mut self) {
        self.chars.drain(..self.cursor);
        self.cursor = 0;
    }

    /// The length of `/^\s*(?:[^\w\s]+|\w+)?/` on the reversed text before the cursor.
    fn word_left(&self) -> usize {
        let before: Vec<char> = self.chars[..self.cursor].iter().rev().copied().collect();
        let spaces = before.iter().take_while(|char| char.is_whitespace()).count();
        let rest = &before[spaces..];
        let word = match rest.first() {
            Some(first) if is_word(*first) => rest.iter().take_while(|char| is_word(**char)).count(),
            Some(_) => rest.iter().take_while(|char| !is_word(**char) && !char.is_whitespace()).count(),
            None => 0,
        };
        spaces + word
    }

    /// The length of `/^(?:\s+|[^\w\s]+|\w+)\s*/` on the text after the cursor.
    fn word_right(&self) -> usize {
        let after = &self.chars[self.cursor..];
        let Some(first) = after.first() else { return 0 };
        let class = |char: &char| (char.is_whitespace(), is_word(*char));
        let head = after.iter().take_while(|char| class(char) == class(first)).count();
        head + after[head..].iter().take_while(|char| char.is_whitespace()).count()
    }

    fn delete_word_left(&mut self) {
        let count = self.word_left();
        self.chars.drain(self.cursor - count..self.cursor);
        self.cursor -= count;
    }

    /// `kDeleteWordRight` uses `/^(?:\s+|\W+|\w+)\s*/`, where `\W` also takes whitespace.
    fn delete_word_right(&mut self) {
        let after = &self.chars[self.cursor..];
        let Some(first) = after.first() else { return };
        let head = if first.is_whitespace() {
            after.iter().take_while(|char| char.is_whitespace()).count()
        } else if is_word(*first) {
            after.iter().take_while(|char| is_word(**char)).count()
        } else {
            after.iter().take_while(|char| !is_word(**char)).count()
        };
        let count = head + after[head..].iter().take_while(|char| char.is_whitespace()).count();
        self.chars.drain(self.cursor..self.cursor + count);
    }
}

/// JavaScript's `\w`.
fn is_word(char: char) -> bool {
    char.is_ascii_alphanumeric() || char == '_'
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(name: &str, ctrl: bool, meta: bool) -> Key {
        Key { name: Some(name.to_string()), ctrl, meta, ..Key::default() }
    }

    fn typed(line: &mut Line, text: &str) {
        for char in text.chars() {
            let char = char.to_string();
            line.feed(Some(&char), &Key { sequence: char.clone(), ..Key::default() });
        }
    }

    #[test]
    fn edits_like_readline() {
        let mut line = Line::default();
        typed(&mut line, "hello big world");
        line.feed(None, &key("w", true, false));
        assert_eq!((line.text().as_str(), line.cursor()), ("hello big ", 10));
        line.feed(None, &key("b", false, true));
        assert_eq!(line.cursor(), 6);
        line.feed(None, &key("d", false, true));
        assert_eq!(line.text(), "hello ");
        line.feed(None, &key("a", true, false));
        typed(&mut line, ">");
        assert_eq!((line.text().as_str(), line.cursor()), (">hello ", 1));
        line.feed(None, &key("k", true, false));
        assert_eq!(line.text(), ">");
        line.feed(Some("\r"), &key("return", false, false));
        assert_eq!(line.text(), "");
        // The `\n` of a CRLF does not end another line; a later one would.
        line.feed(Some("\n"), &key("enter", false, false));
        typed(&mut line, "a-b");
        line.feed(None, &key("left", true, false));
        assert_eq!(line.cursor(), 2);
    }
}
