//! `--wizard`, Effect CLI's command wizard (`effect/src/cli/internal/wizard.ts` and `Command.ts`): asks for the
//! selected command's flags and arguments, or for a subcommand, prints the command line, and runs it after a
//! confirmation. Step C.15.

mod prompt;

use std::ffi::OsString;

use clap::{ArgAction, ArgMatches};

use crate::args::AT_MOST_100;
use crate::help;
use prompt::{
    BLACK_BRIGHT, BOLD, CYAN_BRIGHT, Confirm, GREEN, Int, MAGENTA, Quit, RED, Select, Text, Toggle,
    WHITE, annotate, log,
};

/// Whether the normalized `argv` asks for the wizard: `--wizard` before any `--`.
pub fn requested(argv: &[OsString]) -> bool {
    argv.iter()
        .skip(1)
        .take_while(|arg| *arg != "--")
        .any(|arg| arg == "--wizard")
}

/// `command` without required arguments, to parse the command line the wizard starts from.
pub fn lenient(command: clap::Command) -> clap::Command {
    command
        .mut_args(|arg| arg.required(false))
        .mut_subcommands(lenient)
}

/// Runs the wizard for the command `matches` selected in `command` (built), started with `argv`, then the command
/// line it built, unless the user cancelled or declined.
pub fn run(command: &clap::Command, matches: &ArgMatches, argv: &[OsString]) -> anyhow::Result<()> {
    let Some(line) = build(command, matches, argv)? else {
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
fn build(
    command: &clap::Command,
    matches: &ArgMatches,
    argv: &[OsString],
) -> anyhow::Result<Option<Vec<String>>> {
    let name = help::name();
    log(&introduction(
        &name,
        command.get_about().map(|about| about.to_string()),
    ));
    let mut node = command;
    let mut leaf = matches;
    while let Some((sub, sub_matches)) = leaf.subcommand() {
        node = node.find_subcommand(sub).expect("clap matched it");
        leaf = sub_matches;
    }
    let mut line: Vec<String> = std::iter::once(name)
        .chain(
            argv.iter()
                .skip(1)
                .map(|arg| arg.to_string_lossy().into_owned())
                .filter(|arg| arg != "--wizard" && !arg.starts_with("--wizard=")),
        )
        .collect();
    let section = match std::ptr::eq(node, command) {
        true => "ROOT".to_string(),
        false => node.get_name().to_string(),
    };
    let outcome = (|| -> Result<Option<Vec<String>>, Stop> {
        log_command("Current command", &line, MAGENTA, WHITE);
        prompt_command(node, &mut line, &section)?;
        log_command("Command ready", &line, CYAN_BRIGHT, GREEN);
        let run = Toggle {
            message: "Run this command?".into(),
            active: "yes",
            inactive: "no",
        }
        .prompt()?;
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
        Err(Stop::Invalid(message)) => Err(anyhow::anyhow!(message)),
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

fn prompt_command(node: &clap::Command, line: &mut Vec<String>, section: &str) -> Result<(), Stop> {
    let subcommands: Vec<&clap::Command> = node
        .get_subcommands()
        .filter(|sub| !sub.is_hide_set())
        .collect();
    // Effect asks for a group's shared flags only, and no command here has any.
    let (flags, arguments) = match subcommands.is_empty() {
        true => (
            flags(node),
            node.get_positionals().map(|arg| param(node, arg)).collect(),
        ),
        false => (Vec::new(), Vec::new()),
    };
    if !flags.is_empty() {
        log(&render_section(section, "FLAGS"));
        for flag in &flags {
            line.extend(prompt_param(flag)?);
        }
        if !arguments.is_empty() || !subcommands.is_empty() {
            log_command("Current command", line, MAGENTA, WHITE);
        }
    }
    if !arguments.is_empty() {
        log(&render_section(section, "ARGUMENTS"));
        for argument in &arguments {
            line.extend(prompt_param(argument)?);
        }
        if !subcommands.is_empty() {
            log_command("Current command", line, MAGENTA, WHITE);
        }
    }
    if subcommands.is_empty() {
        return Ok(());
    }
    let index = Select {
        message: "Command".into(),
        choices: subcommands
            .iter()
            .map(|sub| {
                (
                    sub.get_name().to_string(),
                    sub.get_about().map(|about| about.to_string()),
                )
            })
            .collect(),
    }
    .prompt()?;
    log("");
    let child = subcommands[index];
    line.push(child.get_name().to_string());
    let steps = child.get_subcommands().any(|sub| !sub.is_hide_set())
        || child
            .get_arguments()
            .any(|arg| !arg.is_global_set() && !is_negation(child, arg));
    if steps {
        log_command("Current command", line, MAGENTA, WHITE);
    }
    prompt_command(child, line, child.get_name())
}

/// A flag or argument as the wizard sees it: Effect's `getParamMetadata` and primitive type.
struct Param<'a> {
    arg: &'a clap::Arg,
    name: String,
    flag: bool,
    kind: Kind,
    optional: bool,
    /// Asks for a count first, with these bounds.
    variadic: Option<(i64, Option<i64>)>,
}

enum Kind {
    Boolean,
    Choice(Vec<String>),
    Int,
    Text,
}

/// The command's own flags in declaration order: not the globals, and not the hidden `--no-<flag>` helpers.
fn flags(node: &clap::Command) -> Vec<Param<'_>> {
    node.get_arguments()
        .filter(|arg| !arg.is_positional() && !arg.is_global_set() && !is_negation(node, arg))
        .map(|arg| param(node, arg))
        .collect()
}

fn param<'a>(node: &clap::Command, arg: &'a clap::Arg) -> Param<'a> {
    let action = arg.get_action();
    let value_name = arg
        .get_value_names()
        .and_then(|names| names.first())
        .map(|name| name.to_string())
        .unwrap_or_default();
    let choices: Vec<String> = arg
        .get_possible_values()
        .iter()
        .map(|value| value.get_name().to_string())
        .collect();
    let kind = match () {
        _ if matches!(action, ArgAction::SetTrue) => Kind::Boolean,
        _ if !choices.is_empty() => Kind::Choice(choices),
        _ if value_name == "integer" => Kind::Int,
        _ => Kind::Text,
    };
    let range = arg.get_num_args();
    if arg.is_positional() {
        let variadic = matches!(action, ArgAction::Append)
            || range.is_some_and(|range| range.max_values() > 1);
        let min = match arg.is_required_set() {
            true => range.map_or(1, |range| range.min_values()) as i64,
            false => 0,
        };
        let max = range
            .map(|range| range.max_values())
            .filter(|max| *max != usize::MAX);
        return Param {
            arg,
            name: value_name,
            flag: false,
            kind,
            optional: !variadic && !arg.is_required_set(),
            variadic: variadic.then_some((min, max.map(|max| max as i64))),
        };
    }
    let long = arg.get_long().unwrap_or_default().to_string();
    // Flag.KeyValuePair is optional and repeatable at least once; other repeatable flags are Flag.atMost(100) or
    // Flag.atLeast(0).
    let (optional, variadic) = match action {
        ArgAction::Append if value_name == "key=value" => (true, Some((1, None))),
        ArgAction::Append => {
            let limited = AT_MOST_100.contains(&(node.get_name(), long.as_str()));
            (false, Some((0, limited.then_some(100))))
        }
        _ => (!arg.is_required_set(), None),
    };
    Param {
        arg,
        name: long,
        flag: true,
        kind,
        optional,
        variadic,
    }
}

// `--no-replay` is the hidden negation that `args::normalize` emits; Effect CLI has it built into `--replay`.
fn is_negation(command: &clap::Command, arg: &clap::Arg) -> bool {
    arg.is_hide_set()
        && arg
            .get_long()
            .and_then(|long| long.strip_prefix("no-"))
            .is_some_and(|long| {
                command
                    .get_arguments()
                    .any(|other| other.get_long() == Some(long))
            })
}

fn prompt_param(param: &Param) -> Result<Vec<String>, Stop> {
    let label = label(param);
    if param.optional && !Confirm::new(format!("Set {label}?")).prompt()? {
        log("");
        return Ok(Vec::new());
    }
    let count = match param.variadic {
        None => 1,
        Some((min, max)) => Int {
            message: format!("{label} count"),
            default: Some(min),
            min: Some(min),
            max,
        }
        .prompt()?,
    };
    let mut values = Vec::new();
    for _ in 0..count {
        values.push(prompt_single(param, &label)?);
    }
    if !matches!(param.kind, Kind::Boolean) {
        for value in &values {
            parse(param, value).map_err(|error| Stop::Invalid(invalid(param, value, &error)))?;
        }
    }
    log("");
    if !param.flag {
        return Ok(values);
    }
    // Option-looking values go inline so the parser cannot read them as flags; a flag with an optional value
    // only takes an inline one.
    let optional_value = param.arg.is_require_equals_set();
    Ok(values
        .into_iter()
        .flat_map(
            |value| match optional_value || (value.starts_with('-') && value.len() > 1) {
                true => vec![format!("--{}={value}", param.name)],
                false => vec![format!("--{}", param.name), value],
            },
        )
        .collect())
}

fn prompt_single(param: &Param, label: &str) -> Result<String, Stop> {
    let message = label.to_string();
    Ok(match &param.kind {
        Kind::Boolean => Confirm {
            message,
            labels: ("true", "false"),
            placeholders: ("(T/f)", "(t/F)"),
        }
        .prompt()?
        .to_string(),
        Kind::Choice(choices) => {
            let index = Select {
                message,
                choices: choices
                    .iter()
                    .map(|choice| (choice.clone(), None))
                    .collect(),
            }
            .prompt()?;
            choices[index].clone()
        }
        Kind::Int => Int {
            message,
            default: None,
            min: None,
            max: None,
        }
        .prompt()?
        .to_string(),
        Kind::Text => Text { message }.prompt()?,
    })
}

/// Parses one value with the argument's own value parser, as Effect parses each param after its prompts.
fn parse(param: &Param, value: &str) -> Result<(), clap::Error> {
    let arg = param
        .arg
        .clone()
        .required(false)
        .global(false)
        .action(ArgAction::Set);
    let (arg, word) = match param.flag {
        true => (arg, format!("--{}={value}", param.name)),
        false => (
            arg.index(1).num_args(1).allow_hyphen_values(true),
            value.to_string(),
        ),
    };
    clap::Command::new("wizard")
        .no_binary_name(true)
        .arg(arg)
        .try_get_matches_from([word])
        .map(drop)
}

/// The first line of Effect's `InvalidValue`, with clap's reason in place of Effect's schema message.
fn invalid(param: &Param, value: &str, error: &clap::Error) -> String {
    let message = error.to_string();
    let line = message.lines().next().unwrap_or_default();
    // "error: invalid value '0' for '--max-count <integer>': 0 is not in 1..=4294967295"
    let reason = line.rsplit_once("': ").map_or(line, |(_, reason)| reason);
    let kind = if param.flag { "flag --" } else { "argument " };
    format!(
        "Invalid value for {kind}{}: \"{value}\". Expected: {reason}",
        param.name
    )
}

/// `renderParamLabel`: a flag's description when it is short, else its humanized name.
fn label(param: &Param) -> String {
    let description = param
        .arg
        .get_help()
        .map(|help| help.to_string().trim().to_string());
    let label = match description {
        Some(description) if param.flag && description.encode_utf16().count() <= 32 => description,
        _ => humanize(&param.name),
    };
    match param.flag {
        true => format!("{label} (--{})", param.name),
        false => label,
    }
}

fn humanize(name: &str) -> String {
    let words: Vec<&str> = name
        .split(['-', '_'])
        .filter(|word| !word.is_empty())
        .collect();
    let Some((first, rest)) = words.split_first() else {
        return name.to_string();
    };
    let mut chars = first.chars();
    let head: String = chars
        .next()
        .map(|char| char.to_uppercase().collect())
        .unwrap_or_default();
    std::iter::once(head + chars.as_str())
        .chain(rest.iter().map(|word| word.to_string()))
        .collect::<Vec<_>>()
        .join(" ")
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
        .chain([
            annotate(
                "Build a command interactively. Press Ctrl+C to cancel.",
                &[BLACK_BRIGHT],
            ),
            String::new(),
        ])
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
        .chain(
            wrap_command(line)
                .iter()
                .map(|line| annotate(line, &[color])),
        )
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
        let separator = if current == FIRST || current == CONTINUATION {
            ""
        } else {
            " "
        };
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
    let plain = !arg.is_empty()
        && arg
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || "_./:@%+=,-".contains(char));
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
        let line: Vec<String> = std::iter::once("opencode".to_string())
            .chain((0..12).map(|index| format!("--flag-{index:02}")))
            .collect();
        let lines = wrap_command(&line);
        assert_eq!(
            lines[0],
            "  $ opencode --flag-00 --flag-01 --flag-02 --flag-03 --flag-04 --flag-05 --flag-06 \\"
        );
        assert_eq!(
            lines[1],
            "    --flag-07 --flag-08 --flag-09 --flag-10 --flag-11"
        );
    }

    #[test]
    fn humanize_capitalizes_the_first_word() {
        assert_eq!(
            humanize("dangerously-skip-permissions"),
            "Dangerously skip permissions"
        );
        assert_eq!(humanize("sessionID"), "SessionID");
        assert_eq!(
            humanize("operation | method path"),
            "Operation | method path"
        );
        assert_eq!(humanize("--"), "--");
    }

    // The wizard reads Effect's param metadata from the clap tree; the TypeScript dump has the real values.
    #[test]
    fn params_match_the_typescript_metadata() {
        let fixture: Value =
            serde_json::from_str(include_str!("../tests/fixtures/commands.json")).unwrap();
        let command = help::command();
        let mut checked = 0;
        walk(&fixture["root"], &command, &mut checked);
        assert!(checked > 60, "checked {checked} params");
    }

    fn walk(ts: &Value, node: &clap::Command, checked: &mut usize) {
        let path = node.get_name();
        let names: Vec<String> = flags(node).iter().map(|flag| flag.name.clone()).collect();
        let expected: Vec<String> = ts["flags"]
            .as_array()
            .unwrap()
            .iter()
            .map(|flag| flag["name"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(names, expected, "{path}: flag order");
        for (flag, ts) in flags(node).iter().zip(ts["flags"].as_array().unwrap()) {
            check(path, flag, ts);
            *checked += 1;
        }
        let arguments: Vec<Param> = node.get_positionals().map(|arg| param(node, arg)).collect();
        for (argument, ts) in arguments.iter().zip(ts["arguments"].as_array().unwrap()) {
            check(path, argument, ts);
            *checked += 1;
        }
        for (ts, sub) in ts["commands"]
            .as_array()
            .unwrap()
            .iter()
            .zip(node.get_subcommands())
        {
            walk(ts, sub, checked);
        }
    }

    fn check(path: &str, param: &Param, ts: &Value) {
        let what = format!("{path} {}", param.name);
        assert_eq!(param.name, ts["name"].as_str().unwrap(), "{what}: name");
        let kind = match &param.kind {
            Kind::Boolean => "Boolean",
            Kind::Choice(_) => "Choice",
            Kind::Int => "Int",
            Kind::Text => "String",
        };
        let expected = match ts["type"].as_str().unwrap() {
            "KeyValuePair" | "name" => "String",
            kind => kind,
        };
        assert_eq!(kind, expected, "{what}: type");
        let repeated = ts["repeated"]
            .as_bool()
            .or(ts["variadic"].as_bool())
            .unwrap();
        let variadic = repeated.then(|| (ts["min"].as_i64().unwrap_or(0), ts["max"].as_i64()));
        assert_eq!(param.variadic, variadic, "{what}: count bounds");
        // The dump calls a repeatable flag optional when it parses to `[]` without input; Effect's metadata does not.
        let optional =
            ts["optional"].as_bool().unwrap() && !(repeated && ts["type"] != "KeyValuePair");
        assert_eq!(param.optional, optional, "{what}: optional");
    }
}
