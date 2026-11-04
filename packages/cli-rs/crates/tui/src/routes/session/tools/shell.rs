//! The shell tool (E.7a): `Shell` and `ShellDisplay` (`routes/session/index.tsx:2980-3154`), with
//! `collapseShellOutput` (`util/collapse-tool-output.ts`).
//!
//! A V2 shell names its shell in the metadata, and its output comes from `GET /api/shell/{id}/output`:
//! every second while the store lists the shell as running, once more when it exits, and on expand.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::time::Duration;

use opencode_api::client::RequestOptions;
use opencode_api::generated::{LocationQueryInput, ShellID, ShellOutputInput};
use opencode_ui::motion::Spinner;
use opencode_ui::theme::Theme;
use opentui::prelude::*;
use unicode_width::UnicodeWidthChar;

use super::dispatch::{
    Block, BlockTool, Header, Props, Status, content_width, format_path, status_badge, strip_ansi,
};
use crate::app::Tui;
use crate::routes::session::messages::list::Context;

/// `SHELL_DISPLAY_LIMIT`: the most output kept, in characters, and read per request.
const LIMIT: usize = 1024 * 1024;
/// Lines of command and output a collapsed block shows.
const MAX_LINES: usize = 10;

pub struct Shell(Rc<Inner>);

struct Inner {
    tui: Weak<Tui>,
    app: App,
    theme: Theme,
    animations: bool,
    block: BlockTool,
    body: View,
    call: RefCell<Option<Call>>,
    expanded: Cell<bool>,
    /// Output read from the server, already stripped and capped at [`LIMIT`].
    output: RefCell<String>,
    truncated: Cell<bool>,
    cursor: Cell<i64>,
    loading: Cell<bool>,
    drain_requested: Cell<bool>,
    was_running: Cell<bool>,
    /// The store lists the shell as running; read where the store is not held.
    listed: Cell<bool>,
    interval: Cell<Option<TimerId>>,
    painted: RefCell<Option<Paint>>,
}

/// The call's inputs, as `ShellDisplay` gets them.
#[derive(Clone, PartialEq)]
struct Call {
    shell: Option<String>,
    command: Option<String>,
    workdir: String,
    status: Status,
    /// Completed, but the command still runs in the background.
    background: bool,
    /// The output of a call without a shell ID.
    output: Option<String>,
    permission: bool,
    error: Option<String>,
    width: i64,
    /// Where the shell runs, for the output requests.
    directory: Option<String>,
}

/// What the block shows, to skip unchanged repaints.
#[derive(PartialEq)]
struct Paint {
    command: bool,
    running: bool,
    streaming: bool,
    expanded: bool,
    input: String,
    output: String,
    background: bool,
    color: Color,
}

impl Shell {
    pub fn new(cx: &Context<'_>) -> Self {
        let block = BlockTool::new(cx);
        let body = View::new(cx.app).column().gap(1);
        block.children().add(&body);
        block.show_children(true);
        let inner = Rc::new(Inner {
            tui: cx.tui.weak(),
            app: cx.app.clone(),
            theme: cx.theme.clone(),
            animations: cx.animations,
            block,
            body,
            call: RefCell::default(),
            expanded: Cell::new(false),
            output: RefCell::default(),
            truncated: Cell::new(false),
            cursor: Cell::new(0),
            loading: Cell::new(false),
            drain_requested: Cell::new(false),
            was_running: Cell::new(false),
            listed: Cell::new(false),
            interval: Cell::new(None),
            painted: RefCell::default(),
        });
        let weak = Rc::downgrade(&inner);
        inner.block.on_click(move || {
            let Some(inner) = weak.upgrade() else { return };
            let expanded = !inner.expanded.get();
            inner.expanded.set(expanded);
            inner.refresh();
            if expanded {
                inner.load(!inner.background_running());
            }
            inner.watch();
            inner.paint();
        });
        Self(inner)
    }

    pub fn root(&self) -> &View {
        self.0.block.root()
    }

    pub fn update(&self, cx: &Context<'_>, props: &Props<'_>) {
        let shell = props
            .metadata
            .get("shellID")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned);
        let status = props.status();
        // A session can move while its shell still runs in the original location.
        let directory = shell
            .as_ref()
            .and_then(|id| {
                cx.state
                    .shell(&ShellID(id.clone()))
                    .map(|shell| shell.location.directory.clone())
            })
            .or(cx.directory.map(str::to_owned));
        let call = Call {
            output: if shell.is_some() {
                None
            } else {
                props.output.clone()
            },
            shell,
            command: props.input_str("command").map(str::to_owned),
            workdir: format_path(cx, props.input_str("workdir")),
            status,
            background: status == Status::Completed
                && props
                    .metadata
                    .get("status")
                    .and_then(serde_json::Value::as_str)
                    == Some("running"),
            permission: props.permission,
            error: props.error().map(str::to_owned),
            width: content_width(cx),
            directory,
        };
        self.0.listed.set(
            call.shell
                .as_ref()
                .is_some_and(|id| cx.state.shell(&ShellID(id.clone())).is_some()),
        );
        *self.0.call.borrow_mut() = Some(call);
        self.0.watch();
        self.0.paint();
    }
}

impl Drop for Shell {
    fn drop(&mut self) {
        self.0.stop();
    }
}

impl Inner {
    /// The store lists the call's shell as running (`backgroundRunning`).
    fn background_running(&self) -> bool {
        self.listed.get()
    }

    /// Reads [`Self::listed`] again, outside a render (timers and clicks).
    fn refresh(&self) {
        let Some(id) = self
            .call
            .borrow()
            .as_ref()
            .and_then(|call| call.shell.clone())
        else {
            return;
        };
        let listed = self
            .tui
            .upgrade()
            .is_some_and(|tui| tui.data.read(|state| state.shell(&ShellID(id)).is_some()));
        self.listed.set(listed);
    }

    /// The polling effect: read the output every second while the shell runs (a background one only
    /// while expanded), and drain it once when the shell stops.
    fn watch(self: &Rc<Self>) {
        if !self.background_running() {
            self.stop();
            if self.was_running.replace(false) {
                self.load(true);
            }
            return;
        }
        self.was_running.set(true);
        let background = self
            .call
            .borrow()
            .as_ref()
            .is_some_and(|call| call.background);
        if background && !self.expanded.get() {
            self.stop();
            return;
        }
        if self.interval.get().is_some() {
            return;
        }
        self.load(false);
        let weak = Rc::downgrade(self);
        let timer = self.app.set_interval(Duration::from_secs(1), move |_| {
            let Some(inner) = weak.upgrade() else { return };
            inner.refresh();
            if inner.background_running() {
                inner.load(false);
                return;
            }
            inner.watch();
            inner.paint();
        });
        self.interval.set(Some(timer));
    }

    fn stop(&self) {
        if let Some(timer) = self.interval.take() {
            self.app.cancel_timer(timer);
        }
    }

    /// `loadBackgroundOutput`: reads from the cursor; `drain` keeps reading to the end, skipping to
    /// the last [`LIMIT`] characters.
    fn load(self: &Rc<Self>, drain: bool) {
        let call = self.call.borrow().clone();
        let Some(call) = call else { return };
        if call.status == Status::Completed && call.output.is_some() {
            return;
        }
        let Some(id) = call.shell else { return };
        if self.loading.get() {
            if drain {
                self.drain_requested.set(true);
            }
            return;
        }
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        self.loading.set(true);
        let client = tui.data.client().clone();
        let start = self.cursor.get();
        let location = call.directory.map(|directory| LocationQueryInput {
            directory: Some(directory),
        });
        let weak = Rc::downgrade(self);
        tui.app.spawn(
            async move {
                let mut chunks = Vec::new();
                let mut cursor = start;
                let mut skipped = false;
                loop {
                    let input = ShellOutputInput {
                        id: ShellID(id.clone()),
                        location: location.clone(),
                        cursor: Some(cursor),
                        limit: Some(LIMIT as i64),
                    };
                    let Ok(response) = client
                        .shell_output(&input, &RequestOptions::default())
                        .await
                    else {
                        break;
                    };
                    let data = response.data;
                    if !data.output.is_empty() {
                        chunks.push(data.output);
                    }
                    if data.cursor <= cursor {
                        break;
                    }
                    cursor = data.cursor;
                    if !drain || cursor >= data.size {
                        break;
                    }
                    let tail = cursor.max(data.size - LIMIT as i64);
                    if tail > cursor {
                        cursor = tail;
                        skipped = true;
                    }
                }
                (chunks, cursor, skipped)
            },
            move |_, (chunks, cursor, skipped)| {
                let Some(inner) = weak.upgrade() else { return };
                for chunk in chunks {
                    let next = strip_ansi(&format!("{}{chunk}", inner.output.borrow()));
                    let count = next.chars().count();
                    let next = if count > LIMIT {
                        inner.truncated.set(true);
                        next.chars().skip(count - LIMIT).collect()
                    } else {
                        next
                    };
                    *inner.output.borrow_mut() = next;
                }
                if skipped {
                    inner.truncated.set(true);
                }
                inner.cursor.set(cursor);
                inner.loading.set(false);
                if inner.drain_requested.replace(false) {
                    inner.load(true);
                }
                inner.paint();
            },
        );
    }

    fn paint(&self) {
        let call = self.call.borrow();
        let Some(call) = call.as_ref() else { return };
        let theme = &self.theme;
        let expanded = self.expanded.get();
        let running = call.status == Status::Running || self.background_running();
        let output = self.output_text(call, expanded);
        let max_chars = MAX_LINES * (call.width - 6 - if running { 2 } else { 0 }).max(20) as usize;
        let prefix = if !call.workdir.is_empty() && call.workdir != "." {
            format!("cd {} && ", call.workdir)
        } else {
            String::new()
        };
        let input = match &call.command {
            Some(command) if !command.is_empty() => {
                format!("{}{prefix}{command}", if running { "" } else { "$ " })
            }
            _ => String::new(),
        };
        let collapsed = collapse_shell_output(&input, &output, MAX_LINES, max_chars);
        self.block.set(Block {
            header: Header::None,
            spinner: false,
            permission: call.permission,
            error: call.error.clone(),
            clickable: call.shell.is_some() || collapsed.overflow,
            width: call.width,
        });
        let paint = Paint {
            command: call
                .command
                .as_deref()
                .is_some_and(|command| !command.is_empty()),
            running,
            streaming: call.status == Status::Streaming,
            expanded,
            input: if expanded { input } else { collapsed.input },
            output: if expanded { output } else { collapsed.output },
            background: call.background,
            color: if call.permission {
                theme.text.feedback.warning.base
            } else {
                theme.text.base
            },
        };
        if self.painted.borrow().as_ref() == Some(&paint) {
            return;
        }
        let app = &self.app;
        let body = &self.body;
        body.clear();
        let wrap = if expanded {
            WrapMode::Word
        } else {
            WrapMode::Char
        };
        let limit = |text: Text| if expanded { text } else { text.max_height(2) };
        if !paint.command {
            if paint.running || paint.streaming {
                body.add(
                    &Spinner::new(app)
                        .color(paint.color)
                        .label("Writing command…")
                        .animations(self.animations),
                );
            } else {
                body.add(&Text::new(app, "Writing command…").fg(theme.text.muted));
            }
        } else {
            if paint.running {
                let spinner = Spinner::new(app)
                    .color(paint.color)
                    .animations(self.animations);
                let text = limit(
                    Text::new(app, paint.input.clone())
                        .fg(paint.color)
                        .wrap(wrap)
                        .grow(1.0)
                        .min_width(0),
                );
                body.add(&View::new(app).row().gap(1).child(&spinner).child(&text));
            } else {
                body.add(&limit(
                    Text::new(app, paint.input.clone())
                        .fg(theme.text.base)
                        .wrap(wrap),
                ));
            }
            if !paint.output.is_empty() {
                body.add(&Text::new(app, paint.output.clone()).fg(theme.text.muted));
            }
        }
        if paint.background {
            body.add(&status_badge(app, theme, "Background", true));
        }
        *self.painted.borrow_mut() = Some(paint);
    }

    /// The output the block shows (`ShellDisplay`'s `output`).
    fn output_text(&self, call: &Call, expanded: bool) -> String {
        if call.status == Status::Streaming {
            return String::new();
        }
        if call.shell.is_none() {
            return strip_ansi(call.output.as_deref().unwrap_or_default().trim());
        }
        if call.background && !expanded {
            return String::new();
        }
        if call.status == Status::Completed
            && let Some(output) = &call.output
        {
            return strip_ansi(output.trim());
        }
        let loaded = self.output.borrow();
        let source = if loaded.is_empty() {
            call.output.as_deref().unwrap_or_default()
        } else {
            loaded.as_str()
        };
        let text = strip_ansi(source.trim());
        if self.truncated.get() {
            return format!("[earlier output omitted]\n{text}");
        }
        text
    }
}

/// A collapsed command and output.
#[derive(Debug, PartialEq)]
pub struct Collapsed {
    pub input: String,
    pub output: String,
    pub overflow: bool,
}

/// `collapseToolOutput`: the first `max_lines` lines and `max_chars` characters.
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
        let kept: String = preview.chars().take(max_chars.saturating_sub(1)).collect();
        return (format!("{kept}…"), true);
    }
    (preview, true)
}

/// `collapseShellOutput`: the command in at most two lines, then the output's tail in what is left.
pub fn collapse_shell_output(
    input: &str,
    output: &str,
    max_lines: usize,
    max_chars: usize,
) -> Collapsed {
    if input.is_empty() {
        let (_, overflow) = collapse_tool_output(output, max_lines, max_chars);
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
    let command_lines = max_lines.min(2);
    let line_chars = (max_chars / max_lines.max(1)).max(1);
    let (command, command_overflow, used) =
        collapse_shell_command(input, command_lines, line_chars);
    if output.is_empty() {
        return Collapsed {
            input: command,
            output: String::new(),
            overflow: command_overflow,
        };
    }
    let lines = max_lines.saturating_sub(used + 1).max(1);
    let chars = (max_chars as i64 - command.chars().count() as i64 - 2).max(1) as usize;
    let (_, overflow) = collapse_tool_output(output, lines, chars);
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

/// `collapseShellCommand`: the command wrapped at `line_width` cells, cut after `max_lines` lines.
/// Returns the text, whether it was cut, and the lines it takes.
fn collapse_shell_command(
    input: &str,
    max_lines: usize,
    line_width: usize,
) -> (String, bool, usize) {
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

/// `collapseTail`: the last lines, under a count of the earlier ones.
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
    let preview: Vec<char> = lines[lines.len().saturating_sub(max_lines - 1)..]
        .join("\n")
        .chars()
        .collect();
    let available = max_chars as i64 - label.chars().count() as i64 - 1;
    if available <= 0 {
        return label;
    }
    let tail: String = preview[preview.len().saturating_sub(available as usize)..]
        .iter()
        .collect();
    format!("{label}\n{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_commands_and_output_stay_whole() {
        assert_eq!(
            collapse_shell_output("$ ls", "a\nb", 10, 200),
            Collapsed {
                input: "$ ls".into(),
                output: "a\nb".into(),
                overflow: false
            }
        );
    }

    #[test]
    fn long_output_keeps_its_tail_under_a_count() {
        let output: Vec<String> = (1..=20).map(|line| format!("line {line}")).collect();
        let collapsed = collapse_shell_output("$ seq", &output.join("\n"), 10, 200);
        // The command takes one line and a gap, which leaves 8 lines: a count and the last 7.
        assert!(collapsed.overflow);
        assert_eq!(
            collapsed.output,
            "(13 earlier lines)\nline 14\nline 15\nline 16\nline 17\nline 18\nline 19\nline 20"
        );
    }

    #[test]
    fn a_long_command_is_cut_after_two_lines() {
        let command = format!("$ {}", "x".repeat(50));
        let (text, overflow, lines) = collapse_shell_command(&command, 2, 20);
        assert!(overflow);
        assert_eq!(lines, 2);
        assert_eq!(text, format!("$ {}…", "x".repeat(37)));
        assert_eq!(
            collapse_shell_command("a\nb\nc", 2, 20),
            ("a\nb…".into(), true, 2)
        );
    }

    #[test]
    fn output_alone_collapses_to_its_tail() {
        let collapsed = collapse_shell_output("", "1\n2\n3\n4", 2, 100);
        assert_eq!(collapsed.output, "(3 earlier lines)\n4");
        assert_eq!(collapse_tail("abcdefghij", 3, 5), "(1 earlier line)");
    }
}
