//! The Effect CLI parsing behaviors scripts can see (docs/C.0.md), one test each.

use crate::args::{Command, LogLevel, McpCommand, ServerFlags, SessionCommand, Shell};
use crate::parse::{self, Invocation, Outcome};

fn outcome(line: &[&str]) -> Outcome {
    parse::parse(&line.iter().map(|arg| arg.to_string()).collect::<Vec<_>>(), "opencode-rs")
}

fn parse(line: &[&str]) -> Result<Invocation, String> {
    match outcome(line) {
        Outcome::Run(invocation) => Ok(*invocation),
        Outcome::Usage { errors, .. } => Err(errors.join("\n")),
        _ => panic!("{line:?} runs an action flag"),
    }
}

fn error(line: &[&str]) -> String {
    match parse(line) {
        Ok(_) => panic!("{line:?} parsed"),
        Err(error) => error,
    }
}

fn server(line: &[&str]) -> ServerFlags {
    parse(line).unwrap().server
}

macro_rules! command {
    ($line:expr, $pattern:pat => $value:expr) => {
        match parse($line).unwrap().cli.command {
            Some($pattern) => $value,
            other => panic!("{:?} parsed as {other:?}", $line),
        }
    };
}

#[test]
fn negation_sets_a_boolean_to_false() {
    assert_eq!(command!(&["mini", "--no-replay"], Command::Mini(args) => args.replay()), Some(false));
    assert_eq!(command!(&["mini", "--replay"], Command::Mini(args) => args.replay()), Some(true));
    assert_eq!(command!(&["mini"], Command::Mini(args) => args.replay()), None);
    assert!(!command!(&["run", "--no-thinking", "hi"], Command::Run(args) => args.thinking));
    assert!(!parse(&["--no-print-logs"]).unwrap().cli.global.print_logs);
    assert!(error(&["mini", "--no-replay=true"]).contains("omit the value and use --no-replay=true by itself"));
    assert!(error(&["mini", "--no-replay", "true"]).contains("omit the value"));
}

#[test]
fn boolean_takes_a_literal() {
    let run = |line: &[&str]| command!(line, Command::Run(args) => (args.permissions.auto, args.message));
    assert_eq!(run(&["run", "--auto", "false", "hi"]), (false, vec!["hi".to_string()]));
    assert_eq!(run(&["run", "--auto", "yes"]), (true, vec![]));
    assert_eq!(run(&["run", "--auto=0"]), (false, vec![]));
    assert_eq!(run(&["run", "--auto", "hello"]), (true, vec!["hello".to_string()]));
    assert_eq!(command!(&["mini", "--replay=off"], Command::Mini(args) => args.replay()), Some(false));
    assert!(!command!(&["uninstall", "-f", "n"], Command::Uninstall(_) => false));
    assert!(error(&["run", "--auto=maybe"]).contains("Expected \"true\" | \"yes\""));
}

#[test]
fn a_flag_given_twice_is_an_error() {
    assert!(error(&["uninstall", "--dry-run", "--dry-run"]).contains("2 occurrences"));
    assert!(error(&["mini", "--replay", "--no-replay"]).contains("2 occurrences"));
    assert!(error(&["run", "-c", "--continue"]).contains("2 occurrences"));
    assert!(error(&["run", "-s", "a", "-s", "b"]).contains("Invalid value for flag --session: \"2 occurrences\""));
}

#[test]
fn repeatable_flags_collect_in_order_up_to_their_bound() {
    let files = command!(&["run", "-f", "a", "--file", "b", "-f=c", "hi"], Command::Run(args) => args.file);
    assert_eq!(files, ["a", "b", "c"]);
    let headers = command!(&["api", "op", "-H", "a:1", "-H", "b:2"], Command::Api(args) => args.header);
    assert_eq!(headers, ["a:1", "b:2"]);
    let mut line = vec!["api", "op"];
    line.extend(std::iter::repeat_n(["-H", "x:1"], 101).flatten());
    assert!(error(&line).contains("\"101 occurrences\". Expected: at most 100 values"));
    assert!(parse(&["serve", "--cors", "a", "--cors", "b"]).is_ok());
}

#[test]
fn key_value_flags_need_a_key_and_a_value() {
    let params = command!(&["api", "op", "--param", "a=1", "--param", "b==2"], Command::Api(args) => args.param);
    assert_eq!(params, [("a".into(), "1".into()), ("b".into(), "=2".into())]);
    let env = command!(&["mcp", "add", "x", "--env", "K=V"], Command::Mcp(args) => match args.command {
        Some(McpCommand::Add(add)) => add.env,
        other => panic!("{other:?}"),
    });
    assert_eq!(env, [("K".into(), "V".into())]);
    assert!(error(&["api", "op", "--param", "novalue"]).contains("Expected format: key=value"));
    assert!(error(&["api", "op", "--param", "=1"]).contains("must be non-empty"));
    assert!(error(&["mcp", "add", "x", "--header", "k="]).contains("must be non-empty"));
}

#[test]
fn worktree_takes_a_value_only_with_equals() {
    let run = |line: &[&str]| command!(line, Command::Run(args) => (args.worktree().map(|name| name.map(String::from)), args.message));
    assert_eq!(run(&["run", "-w", "fix", "it"]), (Some(None), vec!["fix".into(), "it".into()]));
    assert_eq!(run(&["run", "--worktree", "fix"]), (Some(None), vec!["fix".into()]));
    assert_eq!(run(&["run", "-w=feature", "go"]), (Some(Some("feature".into())), vec!["go".into()]));
    assert_eq!(run(&["run", "--worktree=feature"]), (Some(Some("feature".into())), vec![]));
    assert_eq!(run(&["run", "--worktree="]), (Some(None), vec![]));
    assert_eq!(run(&["run", "go"]), (None, vec!["go".into()]));
}

#[test]
fn words_after_double_dash_are_arguments() {
    let run = command!(&["run", "a", "--", "--model", "x", "-c"], Command::Run(args) => args);
    assert_eq!(run.message, ["a", "--model", "x", "-c"]);
    assert!(run.model.is_none() && !run.continue_);
    let add = command!(&["mcp", "add", "fs", "--", "npx", "-y", "pkg"], Command::Mcp(args) => match args.command {
        Some(McpCommand::Add(add)) => add,
        other => panic!("{other:?}"),
    });
    assert_eq!((add.name.as_str(), add.command), ("fs", vec!["npx".into(), "-y".into(), "pkg".into()]));
    assert_eq!(parse(&["--", "run"]).unwrap().cli.root.directory.as_deref(), Some("run"));
}

#[test]
fn hidden_flags_parse_but_stay_out_of_help() {
    assert!(command!(&["run", "--yolo"], Command::Run(args) => args.permissions.auto()));
    assert!(command!(&["run", "--dangerously-skip-permissions"], Command::Run(args) => args.permissions.auto()));
    assert!(parse(&["mini", "--demo"]).is_ok());
    assert!(parse(&["--yolo"]).unwrap().cli.root.permissions.auto());
    let help = |names: &[&str]| crate::help::render(&parse::find_path(names), "opencode", false);
    assert!(
        help(&["run"]).contains("--auto")
            && !help(&["run"]).contains("yolo")
            && !help(&["run"]).contains("dangerously")
    );
    assert!(help(&["mini"]).contains("--replay") && !help(&["mini"]).contains("--demo"));
    assert!(error(&["run", "--yol"]).ends_with("in command opencode-rs run"), "no suggestion of a hidden flag");
}

#[test]
fn server_flags_apply_where_declared() {
    assert_eq!(server(&["--server", "http://a", "session", "list"]).server.as_deref(), Some("http://a"));
    assert_eq!(server(&["session", "--server", "http://a", "list"]).server.as_deref(), Some("http://a"));
    assert_eq!(server(&["session", "list", "--server", "http://a"]).server.as_deref(), Some("http://a"));
    assert!(server(&["--standalone", "run", "hi"]).standalone);
    assert!(server(&["run", "hi", "--standalone"]).standalone);
    assert_eq!(server(&["--server", "http://a"]).server.as_deref(), Some("http://a"));
    assert_eq!(server(&["--server", "http://a", "project"]).server.as_deref(), Some("http://a"));
    assert_eq!(server(&["debug", "heap-dump", "--server", "http://a"]).server.as_deref(), Some("http://a"));
    assert!(!server(&["debug", "heap-dump"]).standalone);
    assert!(error(&["--server", "http://a", "upgrade"]).contains("Unrecognized flag: --server in command"));
    assert!(error(&["--standalone", "debug", "heap-dump"]).contains("Unrecognized flag: --standalone"));
    assert!(error(&["upgrade", "--server", "http://a"]).contains("--server"));
    assert!(error(&["--server", "a", "session", "list", "--server", "b"]).contains("2 occurrences"));
    assert!(error(&["--standalone", "auth", "list", "--standalone"]).contains("2 occurrences"));
}

#[test]
fn root_flags_do_not_pass_to_subcommands() {
    assert!(error(&["-c", "upgrade"]).contains("Unrecognized flag: --continue in command opencode-rs upgrade"));
    assert!(error(&["--prompt", "hi", "run"]).contains("Unrecognized flag: --prompt"));
    assert!(error(&["--auto", "session", "list"]).contains("Unrecognized flag: --auto"));
}

#[test]
fn global_flags_go_anywhere() {
    assert!(parse(&["--print-logs", "session", "list"]).unwrap().cli.global.print_logs);
    assert!(parse(&["session", "list", "--print-logs"]).unwrap().cli.global.print_logs);
    assert!(matches!(outcome(&["debug", "paths", "--version"]), Outcome::Version));
    assert!(matches!(outcome(&["run", "-v"]), Outcome::Version));
    assert_eq!(parse(&["auth", "--log-level", "debug"]).unwrap().cli.global.log_level, Some(LogLevel::Debug));
    assert!(matches!(outcome(&["service", "status", "--wizard"]), Outcome::Wizard(path) if path.len() == 3));
    assert!(matches!(outcome(&["--completions", "sh"]), Outcome::Completions(Shell::Sh)));
}

#[test]
fn action_flags_run_before_parse_errors() {
    assert!(matches!(outcome(&["api", "--version"]), Outcome::Version));
    assert!(matches!(outcome(&["--version", "false"]), Outcome::Version));
    assert!(matches!(outcome(&["session", "delete", "--wizard"]), Outcome::Wizard(_)));
    assert!(matches!(outcome(&["run", "--bogus", "--help"]), Outcome::Help(_)));
    assert!(matches!(outcome(&["--version", "--version"]), Outcome::Usage { .. }));
    assert!(matches!(outcome(&["--log-level", "x", "--version"]), Outcome::Version));
    assert!(matches!(outcome(&["--server", "a", "upgrade", "--version"]), Outcome::Usage { .. }));
}

#[test]
fn short_flags_cluster() {
    let run = command!(&["run", "-cf", "a.txt", "hi"], Command::Run(args) => args);
    assert!(run.continue_);
    assert_eq!((run.file, run.message), (vec!["a.txt".to_string()], vec!["hi".to_string()]));
    assert!(command!(&["pair", "-y"], Command::Pair(args) => args.yes));
    let run = command!(&["run", "-cm=x"], Command::Run(args) => args);
    assert!(run.continue_ && run.model.as_deref() == Some("x"));
}

#[test]
fn negative_numbers_are_values() {
    assert_eq!(command!(&["mini", "--replay-limit", "-5"], Command::Mini(args) => args.replay_limit), Some(-5));
    assert!(error(&["stats", "--days", "-1"]).contains("greater than or equal to 0"));
    assert_eq!(command!(&["run", "-1.5e3"], Command::Run(args) => args.message), ["-1.5e3"]);
    assert_eq!(command!(&["run", "-.5", "-"], Command::Run(args) => args.message), ["-.5", "-"]);
    assert!(error(&["run", "-1x"]).contains("Unrecognized flag: -1"));
    assert!(error(&["stats", "--year", "1969"]).contains("between 1970 and 9999"));
    assert_eq!(command!(&["stats"], Command::Stats(args) => args.limit), 5);
}

#[test]
fn integers_parse_as_effect_schema_int() {
    let limit = |value: &str| match parse(&["mini", "--replay-limit", value]) {
        Ok(invocation) => match invocation.cli.command {
            Some(Command::Mini(args)) => Ok(args.replay_limit.unwrap()),
            _ => unreachable!(),
        },
        Err(error) => Err(error.rsplit_once(". ").unwrap().1.to_string()),
    };
    let finite = Err("Expected a string representing a finite number".to_string());
    let integer = Err("Expected an integer".to_string());
    let cases = [
        ("5", Ok(5)),
        ("+5", Ok(5)),
        ("007", Ok(7)),
        ("1e3", Ok(1000)),
        ("1.0", Ok(1)),
        ("1.5e1", Ok(15)),
        ("-0", Ok(0)),
        ("1.5", integer.clone()),
        (".5", integer.clone()),
        ("1e400", integer.clone()),
        ("9007199254740993", integer),
        ("5.", finite.clone()),
        ("0x10", finite.clone()),
        (" 5", finite.clone()),
        ("Infinity", finite.clone()),
        ("1_000", finite),
    ];
    for (value, expected) in cases {
        assert_eq!(limit(value), expected, "{value}");
    }
}

#[test]
fn only_the_first_word_names_a_subcommand() {
    assert_eq!(command!(&["run", "session", "list"], Command::Run(args) => args.message), ["session", "list"]);
    assert_eq!(parse(&["project"]).unwrap().cli.root.directory.as_deref(), Some("project"));
    assert_eq!(command!(&["run", "-m", "session", "hi"], Command::Run(args) => args.message), ["hi"]);
    assert!(command!(&["session", "list", "-n", "3"], Command::Session(args) => matches!(
        args.command,
        Some(SessionCommand::List(list)) if list.max_count == Some(3)
    )));
    assert!(error(&["debug", "nope"]).contains("Unknown subcommand \"nope\" for \"opencode-rs debug\""));
    assert!(error(&["api", "a", "b", "c"]).contains("Unexpected positional argument: \"c\""));
    assert!(error(&["api"]).contains("Missing required argument"));
}

#[test]
fn aliases_and_values_match() {
    assert!(matches!(parse(&["update", "1.2.3", "-m", "brew"]).unwrap().cli.command, Some(Command::Upgrade(_))));
    assert!(error(&["upgrade", "--method", "apt"]).contains("\"apt\""));
    let url = command!(&["pair", "--url", "https://example.com/base//"], Command::Pair(args) => args.url);
    assert_eq!(url.as_deref(), Some("https://example.com/base"));
    assert!(error(&["pair", "--url", "https://user:secret@example.com"]).contains("without credentials"));
    assert!(error(&["pair", "--url", "ftp://example.com"]).contains("HTTP(S)"));
    assert!(command!(&["run", "--c"], Command::Run(args) => args.continue_), "an alias also resolves as a long flag");
}

#[test]
fn wizard_values_check_like_their_param() {
    let param = |path: &[&str], name: &str| {
        let spec = parse::find_path(path).pop().unwrap();
        spec.params
            .iter()
            .find(|param| match param {
                crate::args::Param::Flag(flag) => flag.name == name,
                crate::args::Param::Arg(arg) => arg.name == name,
            })
            .unwrap()
    };
    let check = |path: &[&str], name: &str, values: &[&str]| {
        parse::check(param(path, name), &values.iter().map(|value| value.to_string()).collect::<Vec<_>>())
    };
    assert_eq!(
        check(&["session", "list"], "max-count", &["0"]),
        Err("Invalid value for flag --max-count: \"0\". Expected: Schema validation failed: Expected a value greater than or equal to 1".into())
    );
    assert!(check(&["session", "list"], "max-count", &["3"]).is_ok());
    assert!(
        check(&["debug", "paths"], "name", &["nope"]).unwrap_err().starts_with("Invalid value for argument <name>")
    );
    assert!(check(&["api"], "operation | method path", &["a", "b"]).is_ok());
}
