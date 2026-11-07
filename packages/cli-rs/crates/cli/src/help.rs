//! The output of the built-in flags and of usage errors, in Effect CLI's layout and colors (`CliOutput.ts`,
//! `internal/help.ts`, `internal/command.ts`): help, version, completions, and the error section.

use std::io::IsTerminal;

use crate::args::{Flag, Shell, Spec};
use crate::{completions, output, parse};

// Like the TypeScript CLI, a build without OPENCODE_VERSION reports "local".
pub const VERSION: &str = match option_env!("OPENCODE_VERSION") {
    Some(version) => version,
    None => "local",
};

/// The program name in help, version, and completions (plan 6.1).
pub fn name() -> String {
    std::env::var("OPENCODE_CLI_NAME").ok().filter(|name| !name.is_empty()).unwrap_or_else(|| "opencode-rs".into())
}

/// `TerminalCapabilities.canColor`: never for `TERM=dumb` or with `NO_COLOR`, always with `FORCE_COLOR`, else when
/// stdout is a terminal. Errors on stderr follow stdout too, as in Effect.
pub fn colors() -> bool {
    let var = |name| std::env::var(name).ok().filter(|value: &String| !value.is_empty());
    if var("TERM").as_deref() == Some("dumb") || var("NO_COLOR").is_some() {
        return false;
    }
    var("FORCE_COLOR").is_some_and(|value| value != "0" && !value.eq_ignore_ascii_case("false"))
        || std::io::stdout().is_terminal()
}

/// Whether Bun colors `console.error` output, which wraps the TypeScript CLI's error section in red: with
/// `FORCE_COLOR`, never with `NO_COLOR`, else when stderr is a terminal.
pub fn stderr_colors() -> bool {
    let var = |name| std::env::var(name).ok().filter(|value: &String| !value.is_empty());
    var("FORCE_COLOR").is_some_and(|value| value != "0")
        || (var("NO_COLOR").is_none() && std::io::stderr().is_terminal())
}

/// Prints the help of the command at `names` (below the root) to stdout.
pub fn print(names: &[&str]) -> anyhow::Result<()> {
    show(&parse::find_path(names))
}

/// Prints the help of the command at `path` to stdout.
pub fn show(path: &[&'static Spec]) -> anyhow::Result<()> {
    output::print(&format!("{}\n", render(path, &name(), colors())))
}

pub fn version() -> anyhow::Result<()> {
    let style = Style(colors());
    output::print(&format!("{} {}{}\n", style.bold(&name()), style.dim("v"), style.bold(VERSION)))
}

/// `sh` means bash and `pwsh` PowerShell, as in Effect CLI (`GlobalFlag.Completions`).
pub fn completions(shell: Shell) -> anyhow::Result<()> {
    output::print(&format!("{}\n", completions::generate(shell, &name())))
}

/// The error section as the TypeScript CLI writes it to stderr, with its final newline.
pub fn error_output(errors: &[String], colors: bool, stderr_colors: bool) -> String {
    let section = render_errors(errors, colors);
    match stderr_colors {
        true => format!("\x1b[0m\x1b[31m{section}\x1b[0m\n"),
        false => format!("{section}\n"),
    }
}

/// `formatErrors`: an `ERROR` section, or `ERRORS` with one line each.
pub fn render_errors(errors: &[String], colors: bool) -> String {
    let (bold, red, reset) = match colors {
        true => ("\x1b[1m", "\x1b[31m", "\x1b[0m"),
        false => ("", "", ""),
    };
    let title = if errors.len() == 1 { "ERROR" } else { "ERRORS" };
    std::iter::once(format!("\n{bold}{red}{title}{reset}"))
        .chain(errors.iter().map(|error| format!("  {}{reset}", escape_controls(error))))
        .collect::<Vec<_>>()
        .join("\n")
}

// Control characters other than tab, newline, and carriage return print as `\xNN`.
fn escape_controls(text: &str) -> String {
    text.chars()
        .map(|char| match char {
            '\t' | '\n' | '\r' => char.to_string(),
            '\0'..='\x1f' | '\x7f' => format!("\\x{:02x}", char as u32),
            _ => char.to_string(),
        })
        .collect()
}

#[derive(Clone, Copy)]
struct Style(bool);

impl Style {
    fn wrap(self, code: &str, text: &str) -> String {
        match self.0 {
            true => format!("\x1b[{code}m{text}\x1b[0m"),
            false => text.to_string(),
        }
    }

    fn bold(self, text: &str) -> String {
        self.wrap("1", text)
    }

    fn dim(self, text: &str) -> String {
        self.wrap("2", text)
    }

    fn cyan(self, text: &str) -> String {
        self.wrap("36", text)
    }

    fn green(self, text: &str) -> String {
        self.wrap("32", text)
    }
}

/// `formatHelpDoc` of the command at `path`, without the final newline.
pub fn render(path: &[&'static Spec], program: &str, colors: bool) -> String {
    let style = Style(colors);
    let spec = path.last().copied().unwrap_or(path[0]);
    let mut sections: Vec<String> = Vec::new();
    if !spec.description.is_empty() {
        sections.extend([style.bold("DESCRIPTION"), format!("  {}", spec.description), String::new()]);
    }

    let mut usage = parse::command_path(path, program).join(" ");
    if !spec.commands.is_empty() {
        usage += " <subcommand>";
    }
    usage += " [flags]";
    for arg in spec.arguments() {
        let name = if arg.is_variadic() { format!("<{}...>", arg.name) } else { format!("<{}>", arg.name) };
        usage += &if arg.is_required() { format!(" {name}") } else { format!(" [{name}]") };
    }
    sections.extend([style.bold("USAGE"), format!("  {}", style.cyan(&usage)), String::new()]);

    let arguments: Vec<(String, String)> = spec
        .arguments()
        .map(|arg| {
            let name = if arg.is_variadic() { format!("{}...", arg.name) } else { arg.name.to_string() };
            let optional = if arg.is_required() { String::new() } else { style.dim(" (optional)") };
            (
                format!("{} {}", style.green(&name), style.dim(arg.kind.type_name())),
                format!("{}{optional}", arg.description),
            )
        })
        .collect();
    if !arguments.is_empty() {
        sections.extend([style.bold("ARGUMENTS"), table(&arguments, Some(25)), String::new()]);
    }

    let mut flag_section = |title: &str, flags: Vec<&Flag>| {
        let rows: Vec<(String, String)> =
            flags.iter().filter(|flag| !flag.hidden).map(|flag| flag_row(flag, style)).collect();
        if !rows.is_empty() {
            sections.extend([style.bold(title), table(&rows, None), String::new()]);
        }
    };
    flag_section("FLAGS", spec.flags().collect());
    flag_section("GLOBAL FLAGS", parse::active_globals(path));

    if !spec.commands.is_empty() {
        let rows: Vec<(String, String)> = spec
            .commands
            .iter()
            .map(|sub| {
                let name = match sub.alias {
                    Some(alias) => format!("{}, {alias}", sub.name),
                    None => sub.name.to_string(),
                };
                (style.cyan(&name), sub.description.to_string())
            })
            .collect();
        sections.extend([style.bold("SUBCOMMANDS"), table(&rows, Some(20))]);
    }
    if sections.last().is_some_and(String::is_empty) {
        sections.pop();
    }
    sections.join("\n")
}

/// `toFlagDoc`: the names and type on the left, the description with its choices on the right.
fn flag_row(flag: &Flag, style: Style) -> (String, String) {
    let names = std::iter::once(format!("--{}", flag.name))
        .chain(flag.aliases.iter().map(|alias| match alias.len() {
            1 => format!("-{alias}"),
            _ => format!("--{alias}"),
        }))
        .map(|name| style.green(&name))
        .collect::<Vec<_>>()
        .join(", ");
    let kind = flag.metavar.unwrap_or(flag.kind.type_name());
    let kind = match flag.optional_value {
        Some(_) => format!("[={kind}]"),
        None => kind.to_string(),
    };
    let left = match flag.is_boolean() {
        true => names,
        false => format!("{names} {}", style.dim(&kind)),
    };
    let choices = match flag.kind {
        crate::args::Kind::Choice(choices) => Some(format!("(choices: {})", choices.join(", "))),
        _ => None,
    };
    let right = match (flag.description, choices) {
        ("", Some(choices)) => choices,
        (description, Some(choices)) => format!("{description} {choices}"),
        (description, None) => description.to_string(),
    };
    (left, right)
}

/// `renderTable`: the left column as wide as its widest cell plus four, up to `cap`.
fn table(rows: &[(String, String)], cap: Option<usize>) -> String {
    let width = |text: &str| strip_ansi(text).chars().count();
    let widest = rows.iter().map(|(left, _)| width(left)).max().unwrap_or(0) + 4;
    let column = cap.map_or(widest, |cap| widest.min(cap));
    rows.iter()
        .map(|(left, right)| {
            let padding = column.max(width(left) + 1) - width(left);
            format!("  {left}{}{right}", " ".repeat(padding))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn strip_ansi(text: &str) -> String {
    let mut out = String::new();
    let mut chars = text.chars().peekable();
    while let Some(char) = chars.next() {
        if char == '\x1b' && chars.peek() == Some(&'[') {
            chars.next();
            while chars.next_if(|char| char.is_ascii_digit() || *char == ';').is_some() {}
            chars.next_if_eq(&'m');
            continue;
        }
        out.push(char);
    }
    out
}

#[cfg(test)]
pub(crate) fn strip(text: &str) -> String {
    strip_ansi(text)
}
