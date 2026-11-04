//! The prompt loop of `@clack/core` (`prompts/prompt.ts`): key handling, validation, and the frame
//! diffing that redraws only the lines that changed.

use std::sync::Mutex;

use super::line::Line;
use super::term::{self, Key, Keys, Press, Raw};
use super::wrap::wrap;
use super::{Cancelled, Output, State};

/// One prompt's behavior on top of the shared loop. Each method is one of Clack's events.
pub trait Prompt {
    /// Whether readline's line is the prompt's input (`trackValue` in Clack).
    fn track(&self) -> bool;

    fn action_key(&self, char: Option<&str>, _key: &Key) -> bool {
        char == Some("\t")
    }

    fn user_input(&mut self, _base: &mut Base) {}

    fn cursor(&mut self, _action: &str, _base: &mut Base) {}

    fn confirm(&mut self, _yes: bool, _base: &mut Base) {}

    fn key(&mut self, _char: Option<&str>, _key: &Key, _base: &mut Base) {}

    fn finalize(&mut self, _base: &mut Base) {}

    /// The validation problem with the current value, if the prompt validates.
    fn validate(&self, _base: &Base) -> Option<String> {
        None
    }

    fn render(&self, base: &Base) -> String;
}

/// The state every prompt shares.
pub struct Base {
    pub state: State,
    pub error: String,
    pub user_input: String,
    /// The cursor in `user_input`, in characters.
    pub cursor: usize,
    pub output: Output,
    line: Line,
    previous: String,
    /// Set by the first `close`, which also drops the event listeners, as Clack's `unsubscribe`.
    closed: bool,
}

impl Base {
    pub fn write(&self, text: &str) {
        self.output.write(text);
    }

    /// `close`: ends the line and, the first time, shows the cursor again for the caller.
    pub fn close(&mut self) {
        self.write("\n");
        if !self.closed {
            self.closed = true;
            self.write(SHOW);
        }
    }
}

pub const SHOW: &str = "\x1b[?25h";
pub const HIDE: &str = "\x1b[?25l";

/// sisteransi's `cursor.move`.
pub fn move_cursor(x: i64, y: i64) -> String {
    let horizontal = match x {
        x if x < 0 => format!("\x1b[{}D", -x),
        x if x > 0 => format!("\x1b[{x}C"),
        _ => String::new(),
    };
    let vertical = match y {
        y if y < 0 => format!("\x1b[{}A", -y),
        y if y > 0 => format!("\x1b[{y}B"),
        _ => String::new(),
    };
    horizontal + &vertical
}

pub const ERASE_DOWN: &str = "\x1b[J";
/// sisteransi's `erase.lines(1)`.
const ERASE_LINE: &str = "\x1b[2K\x1b[G";

/// Keypresses that arrived after the last prompt finished wait here for the next one.
static KEYS: Mutex<Option<Keys>> = Mutex::new(None);

/// Runs `read` with stdin in raw mode and the keypresses the prompts share, for prompts drawn elsewhere (the
/// wizard draws Effect CLI's prompts, not Clack's).
pub fn with_keys<R>(read: impl FnOnce(&mut Keys) -> R) -> R {
    let _raw = Raw::enable();
    let mut keys = KEYS.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    read(keys.get_or_insert_with(Keys::new))
}

/// Runs a prompt until it is submitted or cancelled.
pub fn run(
    prompt: &mut dyn Prompt,
    output: Output,
    initial_input: Option<&str>,
) -> Result<(), Cancelled> {
    let _raw = Raw::enable();
    let mut base = Base {
        state: State::Initial,
        error: String::new(),
        user_input: String::new(),
        cursor: 0,
        output,
        line: Line::default(),
        previous: String::new(),
        closed: false,
    };
    if let Some(input) = initial_input {
        base.user_input = input.to_string();
        prompt.user_input(&mut base);
        if prompt.track() {
            base.line.write(input);
            base.cursor = base.line.cursor();
        }
    }
    render(prompt, &mut base);
    let mut keys = KEYS.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let keys = keys.get_or_insert_with(Keys::new);
    while !base.closed {
        match keys.next() {
            Some(press) => keypress(prompt, &mut base, press),
            None => end_of_input(prompt, &mut base),
        }
    }
    match base.state {
        State::Submit => Ok(()),
        _ => Err(Cancelled),
    }
}

fn keypress(prompt: &mut dyn Prompt, base: &mut Base, press: Press) {
    let char = press.char.as_deref();
    let key = &press.key;
    // readline sees each key before Clack does.
    base.line.feed(char, key);
    if prompt.track() && !key.is("return") {
        if key.name.is_some() && prompt.action_key(char, key) {
            base.line.delete_left();
        }
        base.cursor = base.line.cursor();
        base.user_input = base.line.text();
        if !base.closed {
            prompt.user_input(base);
        }
    }
    if base.state == State::Error {
        base.state = State::Active;
    }
    if let Some(name) = key.name.as_deref() {
        if !prompt.track()
            && let Some(alias) = alias(name)
            && !base.closed
        {
            prompt.cursor(alias, base);
        }
        if ACTIONS.contains(&name) && !base.closed {
            prompt.cursor(name, base);
        }
    }
    let lower = char.map(str::to_lowercase);
    if let Some(answer) = lower.as_deref().filter(|char| *char == "y" || *char == "n")
        && !base.closed
    {
        prompt.confirm(answer == "y", base);
    }
    if !base.closed {
        prompt.key(lower.as_deref(), key, base);
    }
    if key.is("return") {
        if let Some(problem) = prompt.validate(base) {
            base.error = problem;
            base.state = State::Error;
            let input = base.user_input.clone();
            base.line.write(&input);
        }
        if base.state != State::Error {
            base.state = State::Submit;
        }
    }
    if [char, key.name.as_deref(), Some(key.sequence.as_str())]
        .into_iter()
        .flatten()
        .any(is_cancel)
    {
        base.state = State::Cancel;
    }
    finish(prompt, base);
}

/// Clack waits forever when its input ends; here the prompt is cancelled instead.
fn end_of_input(prompt: &mut dyn Prompt, base: &mut Base) {
    base.state = State::Cancel;
    finish(prompt, base);
}

fn finish(prompt: &mut dyn Prompt, base: &mut Base) {
    let done = matches!(base.state, State::Submit | State::Cancel);
    if done && !base.closed {
        prompt.finalize(base);
    }
    render(prompt, base);
    if done {
        base.close();
    }
}

const ACTIONS: [&str; 7] = ["up", "down", "left", "right", "space", "enter", "cancel"];

/// Clack's default `settings.aliases`.
fn alias(name: &str) -> Option<&'static str> {
    match name {
        "k" => Some("up"),
        "j" => Some("down"),
        "h" => Some("left"),
        "l" => Some("right"),
        "\x03" | "escape" => Some("cancel"),
        _ => None,
    }
}

fn is_cancel(value: &str) -> bool {
    alias(value) == Some("cancel")
}

fn render(prompt: &dyn Prompt, base: &mut Base) {
    let columns = term::columns();
    let frame = wrap(&prompt.render(base), columns);
    if frame == base.previous {
        return;
    }
    if base.state == State::Initial {
        base.write(HIDE);
    } else {
        let previous: Vec<&str> = base.previous.split('\n').collect();
        let lines: Vec<&str> = frame.split('\n').collect();
        let diff: Vec<usize> = (0..previous.len().max(lines.len()))
            .filter(|index| previous.get(*index) != lines.get(*index))
            .collect();
        let height = wrap(&base.previous, columns).split('\n').count() as i64 - 1;
        base.write(&move_cursor(-999, -height));
        if let [line] = diff[..] {
            base.write(&move_cursor(0, line as i64));
            base.write(ERASE_LINE);
            base.write(lines.get(line).copied().unwrap_or(""));
            base.write(&move_cursor(0, lines.len() as i64 - line as i64 - 1));
            base.previous = frame;
            return;
        }
        if let Some(&first) = diff.first() {
            base.write(&move_cursor(0, first as i64));
            base.write(ERASE_DOWN);
            base.write(&lines[first.min(lines.len())..].join("\n"));
            base.previous = frame;
            return;
        }
        base.write(ERASE_DOWN);
    }
    base.write(&frame);
    if base.state == State::Initial {
        base.state = State::Active;
    }
    base.previous = frame;
}
