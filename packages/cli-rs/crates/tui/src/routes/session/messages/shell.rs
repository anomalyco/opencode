//! Shell messages (E.6b): `ShellMessage` through `ShellDisplay` and `BlockTool`
//! (`routes/session/index.tsx:2335-2352,2896-2978,2996-3154`). A `!` command on a raised block: the command, its
//! output collapsed to ten lines until a click opens it, and why it failed. While the shell runs, its output is
//! read every second.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::time::Duration;

use opencode_api::client::RequestOptions;
use opencode_api::generated::{
    LocationQueryInput, SessionMessageShell, SessionMessageShellExit, SessionMessageShellStatus,
    ShellID, ShellOutputInput,
};
use opencode_store::Data;
use opencode_ui::motion::Spinner;
use opencode_ui::theme::Theme;
use opentui::prelude::*;
use unicode_width::UnicodeWidthChar;

use super::list::Context;

/// `SHELL_DISPLAY_LIMIT`: the most output kept, from the end.
const LIMIT: usize = 1024 * 1024;
const MAX_LINES: usize = 10;

pub struct Shell(Rc<Inner>);

struct Inner {
    app: App,
    theme: Theme,
    data: Data,
    root: View,
    header: View,
    command: Text,
    output: Text,
    error: Text,
    animations: bool,
    props: RefCell<Option<Props>>,
    /// The header shows a spinner: the command is running.
    spinning: Cell<Option<bool>>,
    expanded: Cell<bool>,
    hover: Cell<bool>,
    expandable: Cell<bool>,
    read: RefCell<Read>,
    this: Weak<Inner>,
}

#[derive(Clone, PartialEq)]
struct Props {
    shell: ShellID,
    command: String,
    running: bool,
    output: Option<String>,
    error: Option<String>,
    /// The shell is still in the location's running shells.
    background: bool,
    location: Option<String>,
    width: usize,
}

/// The output read so far from `GET /api/shell/{id}/output`.
#[derive(Default)]
struct Read {
    output: String,
    truncated: bool,
    cursor: i64,
    loading: bool,
    drain: bool,
    was_running: bool,
    timer: Option<TimerId>,
}

impl Shell {
    pub fn new(cx: &Context<'_>) -> Self {
        let theme = cx.theme;
        let raised = theme.background.raised.base;
        let command = Text::new(cx.app, "").fg(theme.text.base);
        let header = View::new(cx.app).column();
        let output = Text::new(cx.app, "").fg(theme.text.muted).visible(false);
        let body = View::new(cx.app)
            .column()
            .gap(1)
            .child(&header)
            .child(&output);
        let error = Text::new(cx.app, "")
            .fg(theme.text.feedback.error.base)
            .visible(false);
        // `BlockTool`: a `┃` in the page color on the raised surface.
        let root = View::new(cx.app)
            .column()
            .shrink(0.0)
            .gap(1)
            .padding_edge(Edge::Top, 1)
            .padding_edge(Edge::Bottom, 1)
            .padding_edge(Edge::Left, 2)
            .border(BorderStyle::Heavy)
            .border_sides(Sides::LEFT)
            .border_color(theme.background.base)
            .bg(raised)
            .child(&body)
            .child(&error);
        let inner = Rc::new_cyclic(|this| Inner {
            app: cx.app.clone(),
            theme: theme.clone(),
            data: cx.tui.data.clone(),
            root,
            header,
            command,
            output,
            error,
            animations: cx.animations,
            props: RefCell::default(),
            spinning: Cell::new(None),
            expanded: Cell::new(false),
            hover: Cell::new(false),
            expandable: Cell::new(false),
            read: RefCell::default(),
            this: this.clone(),
        });
        let weak = Rc::downgrade(&inner);
        inner.root.on_hover(move |_, hovered| {
            let Some(inner) = weak.upgrade() else { return };
            inner.hover.set(hovered);
            inner.paint_background();
        });
        let weak = Rc::downgrade(&inner);
        inner.root.on_click(move |_, _| {
            let Some(inner) = weak.upgrade() else { return };
            if !inner.expandable.get() {
                return;
            }
            let expanded = !inner.expanded.get();
            inner.expanded.set(expanded);
            if expanded {
                let background = inner
                    .props
                    .borrow()
                    .as_ref()
                    .is_some_and(|props| props.background);
                inner.load(!background);
            }
            inner.render();
        });
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    pub fn update(&self, cx: &Context<'_>, message: &SessionMessageShell) {
        let error = match &message.status {
            SessionMessageShellStatus::Killed => Some("Command cancelled".to_owned()),
            SessionMessageShellStatus::Timeout => Some("Command timed out".to_owned()),
            _ => match &message.exit {
                Some(SessionMessageShellExit::Number(code)) if *code != 0.0 => {
                    Some(format!("Command exited with code {code}"))
                }
                Some(SessionMessageShellExit::String(code)) => {
                    Some(format!("Command exited with code {code}"))
                }
                _ => None,
            },
        };
        let shell = cx.state.shell(&message.shell_id);
        let props = Props {
            shell: message.shell_id.clone(),
            command: message.command.clone(),
            running: message.status == SessionMessageShellStatus::Running,
            output: message.output.as_ref().map(|output| output.output.clone()),
            error,
            background: shell.is_some(),
            // A session can move while its shell still runs in the original location.
            location: shell
                .map(|shell| shell.location.directory.clone())
                .or_else(|| cx.directory.map(str::to_owned)),
            width: cx.content_width(),
        };
        if self.0.props.borrow().as_ref() == Some(&props) {
            return;
        }
        let background = props.background;
        *self.0.props.borrow_mut() = Some(props);
        self.0.poll(background);
        self.0.render();
    }
}

impl Drop for Shell {
    fn drop(&mut self) {
        if let Some(timer) = self.0.read.borrow_mut().timer.take() {
            self.0.app.cancel_timer(timer);
        }
    }
}

impl Inner {
    /// Reads output every second while the shell runs, and everything left once it stops.
    fn poll(&self, running: bool) {
        let mut read = self.read.borrow_mut();
        if !running {
            if let Some(timer) = read.timer.take() {
                self.app.cancel_timer(timer);
            }
            let drain = std::mem::take(&mut read.was_running);
            drop(read);
            if drain {
                self.load(true);
            }
            return;
        }
        read.was_running = true;
        if read.timer.is_some() {
            return;
        }
        let weak = self.this.clone();
        read.timer = Some(self.app.set_interval(Duration::from_secs(1), move |_| {
            if let Some(inner) = weak.upgrade() {
                inner.load(false);
            }
        }));
        drop(read);
        self.load(false);
    }

    /// `loadBackgroundOutput`: one page, or with `drain` every page up to the last `LIMIT` bytes.
    fn load(&self, drain: bool) {
        let Some(props) = self.props.borrow().clone() else {
            return;
        };
        if !props.running && props.output.is_some() {
            return;
        }
        let mut read = self.read.borrow_mut();
        if read.loading {
            read.drain |= drain;
            return;
        }
        read.loading = true;
        let cursor = read.cursor;
        drop(read);
        let client = self.data.client().clone();
        let weak = self.this.clone();
        self.app.spawn(
            async move {
                client
                    .shell_output(
                        &ShellOutputInput {
                            id: props.shell.clone(),
                            location: props.location.map(|directory| LocationQueryInput {
                                directory: Some(directory),
                            }),
                            cursor: Some(cursor),
                            limit: Some(LIMIT as i64),
                        },
                        &RequestOptions::default(),
                    )
                    .await
            },
            move |_, response| {
                let Some(inner) = weak.upgrade() else { return };
                let mut read = inner.read.borrow_mut();
                read.loading = false;
                let mut again = std::mem::take(&mut read.drain);
                if let Ok(response) = response {
                    let page = response.data;
                    if !page.output.is_empty() {
                        let mut next = strip_ansi(&format!("{}{}", read.output, page.output));
                        if next.len() > LIMIT {
                            read.truncated = true;
                            let mut start = next.len() - LIMIT;
                            while !next.is_char_boundary(start) {
                                start += 1;
                            }
                            next.drain(..start);
                        }
                        read.output = next;
                    }
                    if page.cursor > read.cursor {
                        read.cursor = page.cursor;
                        if drain && read.cursor < page.size {
                            let tail = read.cursor.max(page.size - LIMIT as i64);
                            if tail > read.cursor {
                                read.cursor = tail;
                                read.truncated = true;
                            }
                            again = true;
                        }
                    }
                }
                drop(read);
                inner.render();
                if again {
                    inner.load(true);
                }
            },
        );
    }

    fn render(&self) {
        let Some(props) = self.props.borrow().clone() else {
            return;
        };
        let theme = &self.theme;
        let running = props.running || props.background;
        let expanded = self.expanded.get();
        let output = {
            let read = self.read.borrow();
            match (&props.output, props.running) {
                (Some(output), false) => strip_ansi(output.trim()),
                (output, _) => {
                    let current = if read.output.is_empty() {
                        output.as_deref().unwrap_or_default()
                    } else {
                        read.output.as_str()
                    };
                    let text = strip_ansi(current.trim());
                    if read.truncated {
                        format!("[earlier output omitted]\n{text}")
                    } else {
                        text
                    }
                }
            }
        };
        let width = props.width;
        let max_chars = MAX_LINES * 20.max(width.saturating_sub(6 + if running { 2 } else { 0 }));
        let input = format!("{}{}", if running { "" } else { "$ " }, props.command);
        let collapsed = collapse_shell_output(&input, &output, MAX_LINES, max_chars);
        let (input, output) = if expanded {
            (input, output)
        } else {
            (collapsed.input, collapsed.output)
        };
        // A shell message always has an ID, so its output can always open.
        self.expandable.set(true);
        self.paint_background();

        if self.spinning.replace(Some(running)) != Some(running) {
            self.header.clear();
            if running {
                let row = View::new(&self.app)
                    .row()
                    .gap(1)
                    .child(
                        &Spinner::new(&self.app)
                            .color(theme.text.base)
                            .animations(self.animations),
                    )
                    .child(&self.command.clone().grow(1.0).min_width(0));
                self.header.add(&row);
            } else {
                self.header.add(&self.command);
            }
        }
        self.command.wrap(if expanded {
            WrapMode::Word
        } else {
            WrapMode::Char
        });
        if expanded {
            self.command.max_height(Length::Undefined);
        } else {
            self.command.max_height(2);
        }
        self.command.set_text(input);
        self.output.visible(!output.is_empty());
        self.output.set_text(output);
        self.error.visible(props.error.is_some());
        if let Some(error) = &props.error {
            self.error.set_text(strip_ansi(error));
        }
    }

    fn paint_background(&self) {
        let raised = self.theme.background.raised.base;
        self.root.bg(if self.hover.get() && self.expandable.get() {
            self.theme.decrease(&raised, 1)
        } else {
            raised
        });
    }
}

pub struct Collapsed {
    pub input: String,
    pub output: String,
    pub overflow: bool,
}

/// `collapseShellOutput`: the command in at most two lines, then the output's tail in what is left.
pub fn collapse_shell_output(
    input: &str,
    output: &str,
    max_lines: usize,
    max_chars: usize,
) -> Collapsed {
    if input.is_empty() {
        let overflow = collapse_tool_output(output, max_lines, max_chars).1;
        return Collapsed {
            input: String::new(),
            output: if overflow {
                collapse_tail(output, max_lines, max_chars)
            } else {
                output.to_owned()
            },
            overflow,
        };
    }
    let line_chars = (max_chars / max_lines.max(1)).max(1);
    let (command, command_overflow, command_lines) =
        collapse_command(input, max_lines.min(2), line_chars);
    if output.is_empty() {
        return Collapsed {
            input: command,
            output: String::new(),
            overflow: command_overflow,
        };
    }
    let lines = max_lines.saturating_sub(command_lines + 1).max(1);
    let chars = max_chars.saturating_sub(command.chars().count() + 2).max(1);
    let overflow = collapse_tool_output(output, lines, chars).1;
    Collapsed {
        input: command,
        output: if overflow {
            collapse_tail(output, lines, chars)
        } else {
            output.to_owned()
        },
        overflow: command_overflow || overflow,
    }
}

/// `collapseToolOutput`: the first `max_lines` lines and `max_chars` characters, and whether it cut.
fn collapse_tool_output(output: &str, max_lines: usize, max_chars: usize) -> (String, bool) {
    let lines: Vec<&str> = output.split('\n').collect();
    if lines.len() <= max_lines && output.chars().count() <= max_chars {
        return (output.to_owned(), false);
    }
    let mut visible: Vec<String> = lines
        .iter()
        .take(max_lines)
        .map(|line| (*line).to_owned())
        .collect();
    if lines.len() > max_lines
        && let Some(last) = visible.last_mut()
    {
        last.push('…');
    }
    let preview = visible.join("\n");
    if preview.chars().count() > max_chars {
        let cut: String = preview.chars().take(max_chars.saturating_sub(1)).collect();
        return (format!("{cut}…"), true);
    }
    (preview, true)
}

fn collapse_command(input: &str, max_lines: usize, line_width: usize) -> (String, bool, usize) {
    let mut visible: Vec<char> = Vec::new();
    let mut lines = 1;
    let mut width = 0;
    let mut overflow = false;
    for character in input.chars() {
        if character == '\n' {
            if lines >= max_lines {
                overflow = true;
                break;
            }
            visible.push(character);
            lines += 1;
            width = 0;
            continue;
        }
        let next = character.width().unwrap_or(0);
        if width + next > line_width {
            if lines >= max_lines {
                overflow = true;
                break;
            }
            lines += 1;
            width = 0;
        }
        visible.push(character);
        width += next;
    }
    if !overflow {
        return (input.to_owned(), false, lines);
    }
    if width >= line_width {
        visible.pop();
    }
    let mut text: String = visible.into_iter().collect();
    text.push('…');
    (text, true, lines)
}

/// `collapseTail`: `(N earlier lines)` and the last lines that fit.
fn collapse_tail(output: &str, max_lines: usize, max_chars: usize) -> String {
    let lines: Vec<&str> = output.split('\n').collect();
    if lines.len() <= max_lines && output.chars().count() <= max_chars {
        return output.to_owned();
    }
    let count = lines
        .len()
        .saturating_sub(max_lines.saturating_sub(1))
        .max(1);
    let label = format!(
        "({count} earlier {})",
        if count == 1 { "line" } else { "lines" }
    );
    if max_lines <= 1 {
        return label;
    }
    let preview: Vec<char> = lines[lines.len() - (max_lines - 1).min(lines.len())..]
        .join("\n")
        .chars()
        .collect();
    let available = max_chars as isize - label.chars().count() as isize - 1;
    if available <= 0 {
        return label;
    }
    let tail: String = preview[preview.len().saturating_sub(available as usize)..]
        .iter()
        .collect();
    format!("{label}\n{tail}")
}

/// Drops ANSI escape sequences: CSI (`ESC [ … final`), OSC (`ESC ] … BEL` or `ESC \`), and two-byte escapes.
pub fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(character) = chars.next() {
        if character != '\u{1b}' && character != '\u{9b}' {
            out.push(character);
            continue;
        }
        let csi = character == '\u{9b}' || chars.next_if_eq(&'[').is_some();
        if csi {
            for next in chars.by_ref() {
                if ('\u{40}'..='\u{7e}').contains(&next) {
                    break;
                }
            }
            continue;
        }
        if chars.next_if_eq(&']').is_some() {
            while let Some(next) = chars.next() {
                if next == '\u{7}' {
                    break;
                }
                if next == '\u{1b}' && chars.next_if_eq(&'\\').is_some() {
                    break;
                }
            }
            continue;
        }
        chars.next();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_output_stays_whole() {
        let collapsed = collapse_shell_output("$ ls", "a\nb", 10, 400);
        assert_eq!(collapsed.input, "$ ls");
        assert_eq!(collapsed.output, "a\nb");
        assert!(!collapsed.overflow);
    }

    #[test]
    fn long_output_keeps_its_tail_behind_a_count() {
        let output: Vec<String> = (1..=20).map(|line| format!("line {line}")).collect();
        let collapsed = collapse_shell_output("$ seq", &output.join("\n"), 10, 400);
        assert!(collapsed.overflow);
        // The command takes one line and a gap, so eight lines are left: a label and seven lines.
        assert_eq!(
            collapsed.output,
            "(13 earlier lines)\nline 14\nline 15\nline 16\nline 17\nline 18\nline 19\nline 20"
        );
    }

    #[test]
    fn a_long_command_cuts_at_two_lines() {
        let collapsed = collapse_shell_output(&"x".repeat(100), "", 10, 200);
        assert!(collapsed.overflow);
        assert_eq!(collapsed.input, format!("{}…", "x".repeat(39)));
    }

    #[test]
    fn strip_ansi_drops_escapes() {
        assert_eq!(strip_ansi("\u{1b}[1;31mred\u{1b}[0m ok"), "red ok");
        assert_eq!(strip_ansi("\u{1b}]0;title\u{7}text"), "text");
    }
}
