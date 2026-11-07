//! `--wizard`, Effect CLI's command wizard (`effect/src/cli/internal/wizard.ts` and `Command.ts`): asks for the
//! selected command's flags and arguments, or for a subcommand, prints the command line, and runs it after a
//! confirmation. Step C.15.

mod prompt;

use opencode_util::{err, error};
use std::ffi::OsString;

use crate::args::{Count, Kind, Param, Spec};
use crate::{help, parse};
use prompt::{
    BLACK_BRIGHT, BOLD, CYAN_BRIGHT, Confirm, GREEN, Int, MAGENTA, Quit, RED, Select, Text, Toggle, WHITE, annotate,
    log,
};

/// Runs the wizard for the command at `path` (from the root), started with `argv`, then the command line it built,
/// unless the user cancelled or declined.
pub fn run(path: &[&'static Spec], argv: &[OsString]) -> error::Result<()> {
    let Some(line) = build(path, argv)? else {
        return Ok(());
    };
    // Effect CLI runs the command line as if it had been typed. Running this binary again with it lets
    // everything that reads the process arguments (delegation to TypeScript, `run`'s words after `--`) see it.
    let mut process = std::process::Command::new(std::env::current_exe()?);
    process.args(line);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        if let Some(arg0) = argv.first() {
            process.arg0(arg0);
        }
        Err(process.exec().into())
    }
    #[cfg(not(unix))]
    std::process::exit(process.status()?.code().unwrap_or(1))
}

/// Asks for the command line. Returns its arguments after the program name, or `None` when the user cancelled or
/// declined.
fn build(path: &[&'static Spec], argv: &[OsString]) -> error::Result<Option<Vec<String>>> {
    let name = help::name();
    log(&introduction(&name, Some(path[0].description.to_string())));
    let node = path[path.len() - 1];
    let mut line: Vec<String> = std::iter::once(name)
        .chain(
            argv.iter()
                .skip(1)
                .map(|arg| arg.to_string_lossy().into_owned())
                .filter(|arg| arg != "--wizard" && !arg.starts_with("--wizard=")),
        )
        .collect();
    let section = match path.len() {
        1 => "ROOT".to_string(),
        _ => node.name.to_string(),
    };
    let outcome = (|| -> Result<Option<Vec<String>>, Stop> {
        log_command("Current command", &line, MAGENTA, WHITE);
        prompt_command(node, &mut line, &section)?;
        log_command("Command ready", &line, CYAN_BRIGHT, GREEN);
        let run = Toggle { message: "Run this command?".into(), active: "yes", inactive: "no" }.prompt()?;
        if !run {
            return Ok(None);
        }
        log("");
        Ok(Some(line))
    })();
    match outcome {
        Ok(line) => Ok(line.map(|line| line.into_iter().skip(1).collect())),
        Err(Stop::Quit) => {
            log(&format!("\n{}", annotate("Wizard cancelled.", &[RED])));
            Ok(None)
        }
        Err(Stop::Invalid(message)) => Err(err!(message)),
    }
}

enum Stop {
    Quit,
    Invalid(String),
}

impl From<Quit> for Stop {
    fn from(_: Quit) -> Stop {
        Stop::Quit
    }
}

fn prompt_command(node: &'static Spec, line: &mut Vec<String>, section: &str) -> Result<(), Stop> {
    // Effect asks for a group's shared flags only, and no command here has any.
    let (flags, arguments): (Vec<Prompted>, Vec<Prompted>) = match node.commands.is_empty() {
        true => node.params.iter().map(param).partition(|param| param.flag),
        false => (Vec::new(), Vec::new()),
    };
    if !flags.is_empty() {
        log(&render_section(section, "FLAGS"));
        for flag in &flags {
            line.extend(prompt_param(flag)?);
        }
        if !arguments.is_empty() || !node.commands.is_empty() {
            log_command("Current command", line, MAGENTA, WHITE);
        }
    }
    if !arguments.is_empty() {
        log(&render_section(section, "ARGUMENTS"));
        for argument in &arguments {
            line.extend(prompt_param(argument)?);
        }
        if !node.commands.is_empty() {
            log_command("Current command", line, MAGENTA, WHITE);
        }
    }
    if node.commands.is_empty() {
        return Ok(());
    }
    let index = Select {
        message: "Command".into(),
        choices: node.commands.iter().map(|sub| (sub.name.to_string(), Some(sub.description.to_string()))).collect(),
    }
    .prompt()?;
    log("");
    let child = &node.commands[index];
    line.push(child.name.to_string());
    if !child.commands.is_empty() || !child.params.is_empty() {
        log_command("Current command", line, MAGENTA, WHITE);
    }
    prompt_command(child, line, child.name)
}

/// A flag or argument as the wizard sees it: Effect's `getParamMetadata` and primitive type.
struct Prompted {
    param: &'static Param,
    name: String,
    description: &'static str,
    flag: bool,
    kind: Kind,
    optional: bool,
    /// Asks for a count first, with these bounds.
    variadic: Option<(i64, Option<i64>)>,
    /// `Flag.withOptionalValue`: the value goes inline.
    inline: bool,
}

fn param(param: &'static Param) -> Prompted {
    let (name, description, flag, kind, count, inline) = match param {
        Param::Flag(flag) => (flag.name, flag.description, true, flag.kind, flag.count, flag.optional_value.is_some()),
        Param::Arg(arg) => (arg.name, arg.description, false, arg.kind, arg.count, false),
    };
    let (optional, variadic) = match count {
        Count::Repeated { min, max, optional } => {
            (optional, Some((min.unwrap_or(0) as i64, max.map(|max| max as i64))))
        }
        Count::Required => (false, None),
        Count::Optional | Count::Default(_) => (true, None),
    };
    Prompted { param, name: name.to_string(), description, flag, kind, optional, variadic, inline }
}

fn prompt_param(param: &Prompted) -> Result<Vec<String>, Stop> {
    let label = label(param);
    if param.optional && !Confirm::new(format!("Set {label}?")).prompt()? {
        log("");
        return Ok(Vec::new());
    }
    let count = match param.variadic {
        None => 1,
        Some((min, max)) => {
            Int { message: format!("{label} count"), default: Some(min), min: Some(min), max }.prompt()?
        }
    };
    let mut values = Vec::new();
    for _ in 0..count {
        values.push(prompt_single(param, &label)?);
    }
    parse::check(param.param, &values).map_err(Stop::Invalid)?;
    log("");
    if !param.flag {
        return Ok(values);
    }
    // Option-looking values go inline so the parser cannot read them as flags; a flag with an optional value
    // only takes an inline one.
    Ok(values
        .into_iter()
        .flat_map(|value| match param.inline || (value.starts_with('-') && value.len() > 1) {
            true => vec![format!("--{}={value}", param.name)],
            false => vec![format!("--{}", param.name), value],
        })
        .collect())
}

fn prompt_single(param: &Prompted, label: &str) -> Result<String, Stop> {
    let message = label.to_string();
    Ok(match &param.kind {
        Kind::Boolean => {
            Confirm { message, labels: ("true", "false"), placeholders: ("(T/f)", "(t/F)") }.prompt()?.to_string()
        }
        Kind::Choice(choices) => {
            let index = Select { message, choices: choices.iter().map(|choice| (choice.to_string(), None)).collect() }
                .prompt()?;
            choices[index].to_string()
        }
        Kind::Int => Int { message, default: None, min: None, max: None }.prompt()?.to_string(),
        Kind::String | Kind::KeyValue => Text { message }.prompt()?,
    })
}

/// `renderParamLabel`: a flag's description when it is short, else its humanized name.
fn label(param: &Prompted) -> String {
    let description = param.description.trim();
    let label = match description {
        description if param.flag && !description.is_empty() && description.encode_utf16().count() <= 32 => {
            description.to_string()
        }
        _ => humanize(&param.name),
    };
    match param.flag {
        true => format!("{label} (--{})", param.name),
        false => label,
    }
}

fn humanize(name: &str) -> String {
    let words: Vec<&str> = name.split(['-', '_']).filter(|word| !word.is_empty()).collect();
    let Some((first, rest)) = words.split_first() else {
        return name.to_string();
    };
    let mut chars = first.chars();
    let head: String = chars.next().map(|char| char.to_uppercase().collect()).unwrap_or_default();
    std::iter::once(head + chars.as_str()).chain(rest.iter().map(|word| word.to_string())).collect::<Vec<_>>().join(" ")
}

fn introduction(name: &str, summary: Option<String>) -> String {
    let title = format!(
        "{} {} {}",
        annotate(name, &[BOLD, CYAN_BRIGHT]),
        annotate(&format!("v{}", help::VERSION), &[WHITE]),
        annotate("· Command wizard", &[BOLD, WHITE])
    );
    std::iter::once(title)
        .chain(summary.filter(|summary| !summary.is_empty()))
        .chain([annotate("Build a command interactively. Press Ctrl+C to cancel.", &[BLACK_BRIGHT]), String::new()])
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_section(name: &str, section: &str) -> String {
    format!(
        "{} {} {}",
        annotate(&name.to_uppercase(), &[BOLD, CYAN_BRIGHT]),
        annotate("·", &[BLACK_BRIGHT]),
        annotate(section, &[BOLD, WHITE])
    )
}

fn log_command(label: &str, line: &[String], color: &str, label_color: &str) {
    let lines = std::iter::once(annotate(label, &[BOLD, label_color]))
        .chain(wrap_command(line).iter().map(|line| annotate(line, &[color])))
        .chain(std::iter::once(String::new()))
        .collect::<Vec<_>>();
    log(&lines.join("\n"));
}

/// `wrapCommand`: shell words on lines of at most 88 columns, continued with a backslash.
fn wrap_command(line: &[String]) -> Vec<String> {
    const WIDTH: usize = 88;
    const FIRST: &str = "  $ ";
    const CONTINUATION: &str = "    ";
    let mut lines = Vec::new();
    let mut current = FIRST.to_string();
    for arg in line.iter().map(|arg| shell_word(arg)) {
        let separator = if current == FIRST || current == CONTINUATION { "" } else { " " };
        let length = |text: &str| text.encode_utf16().count();
        if length(&current) + separator.len() + length(&arg) > WIDTH && current != FIRST {
            lines.push(format!("{current} \\"));
            current = format!("{CONTINUATION}{arg}");
        } else {
            current += separator;
            current += &arg;
        }
    }
    if current != FIRST {
        lines.push(current);
    }
    lines
}

fn shell_word(arg: &str) -> String {
    let plain = !arg.is_empty() && arg.chars().all(|char| char.is_ascii_alphanumeric() || "_./:@%+=,-".contains(char));
    match plain {
        true => arg.to_string(),
        false => format!("'{}'", arg.replace('\'', "'\"'\"'")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[test]
    fn shell_words_quote_like_effect() {
        assert_eq!(shell_word("--format"), "--format");
        assert_eq!(shell_word("a b"), "'a b'");
        assert_eq!(shell_word(""), "''");
        assert_eq!(shell_word("it's"), "'it'\"'\"'s'");
    }

    #[test]
    fn long_commands_wrap_at_88_columns() {
        let line: Vec<String> =
            std::iter::once("opencode".to_string()).chain((0..12).map(|index| format!("--flag-{index:02}"))).collect();
        let lines = wrap_command(&line);
        assert_eq!(lines[0], "  $ opencode --flag-00 --flag-01 --flag-02 --flag-03 --flag-04 --flag-05 --flag-06 \\");
        assert_eq!(lines[1], "    --flag-07 --flag-08 --flag-09 --flag-10 --flag-11");
    }

    #[test]
    fn humanize_capitalizes_the_first_word() {
        assert_eq!(humanize("dangerously-skip-permissions"), "Dangerously skip permissions");
        assert_eq!(humanize("sessionID"), "SessionID");
        assert_eq!(humanize("operation | method path"), "Operation | method path");
        assert_eq!(humanize("--"), "--");
    }

    // The wizard reads Effect's param metadata from the table; the TypeScript dump has the real values.
    #[test]
    fn params_match_the_typescript_metadata() {
        let fixture: Value = serde_json::from_str(include_str!("../tests/fixtures/commands.json")).unwrap();
        let mut checked = 0;
        walk(&fixture["root"], &crate::args::ROOT, &mut checked);
        assert!(checked > 60, "checked {checked} params");
    }

    fn walk(ts: &Value, node: &'static Spec, checked: &mut usize) {
        let (flags, arguments): (Vec<Prompted>, Vec<Prompted>) =
            node.params.iter().map(param).partition(|param| param.flag);
        for (params, ts) in [(flags, &ts["flags"]), (arguments, &ts["arguments"])] {
            let ts = ts.as_array().unwrap();
            assert_eq!(params.len(), ts.len(), "{}: params", node.name);
            for (param, ts) in params.iter().zip(ts) {
                check(node.name, param, ts);
                *checked += 1;
            }
        }
        for (ts, sub) in ts["commands"].as_array().unwrap().iter().zip(node.commands) {
            walk(ts, sub, checked);
        }
    }

    fn check(path: &str, param: &Prompted, ts: &Value) {
        let what = format!("{path} {}", param.name);
        assert_eq!(param.name, ts["name"].as_str().unwrap(), "{what}: name");
        let repeated = ts["repeated"].as_bool().or(ts["variadic"].as_bool()).unwrap();
        let variadic = repeated.then(|| (ts["min"].as_i64().unwrap_or(0), ts["max"].as_i64()));
        assert_eq!(param.variadic, variadic, "{what}: count bounds");
        // The dump calls a repeatable flag optional when it parses to `[]` without input; Effect's metadata does not.
        let optional = ts["optional"].as_bool().unwrap() && !(repeated && ts["type"] != "KeyValuePair");
        assert_eq!(param.optional, optional, "{what}: optional");
        assert_eq!(param.inline, ts["optionalValue"].as_bool().unwrap_or(false), "{what}: inline value");
    }
}
