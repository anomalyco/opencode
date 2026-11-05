//! The Effect CLI parsing behaviors scripts can see (docs/C.0.md), one test each.

use clap::FromArgMatches;

use crate::args::{self, Cli, Command, McpCommand, ServerFlags, SessionCommand};
use crate::help;

fn parse(line: &[&str]) -> Result<(Cli, ServerFlags), String> {
    let command = help::command();
    let argv = std::iter::once("opencode-rs").chain(line.iter().copied()).map(Into::into).collect();
    let argv = args::normalize(&command, argv)?;
    let matches = command.clone().try_get_matches_from(argv).map_err(|error| error.to_string())?;
    let cli = Cli::from_arg_matches(&matches).map_err(|error| error.to_string())?;
    let server = args::validate(&command, &matches)?;
    Ok((cli, server))
}

fn error(line: &[&str]) -> String {
    match parse(line) {
        Ok(_) => panic!("{line:?} parsed"),
        Err(error) => error,
    }
}

macro_rules! command {
    ($line:expr, $pattern:pat => $value:expr) => {
        match parse($line).unwrap().0.command {
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
    assert!(!parse(&["--no-print-logs"]).unwrap().0.global.print_logs);
    assert!(error(&["mini", "--no-replay=true"]).contains("omit the value and use --no-replay by itself"));
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
    assert!(!command!(&["uninstall", "-f", "n"], Command::Uninstall(args) => args.force));
    assert!(error(&["run", "--auto=maybe"]).contains("Expected: boolean"));
}

#[test]
fn a_flag_given_twice_is_an_error() {
    assert!(error(&["uninstall", "--dry-run", "--dry-run"]).contains("2 occurrences"));
    assert!(error(&["mini", "--replay", "--no-replay"]).contains("2 occurrences"));
    assert!(error(&["run", "-c", "--continue"]).contains("2 occurrences"));
    assert!(error(&["run", "-s", "a", "-s", "b"]).contains("cannot be used multiple times"));
}

#[test]
fn repeatable_flags_collect_in_order_up_to_their_bound() {
    let files = command!(&["run", "-f", "a", "--file", "b", "-f=c", "hi"], Command::Run(args) => args.file);
    assert_eq!(files, ["a", "b", "c"]);
    let headers = command!(&["api", "op", "-H", "a:1", "-H", "b:2"], Command::Api(args) => args.header);
    assert_eq!(headers, ["a:1", "b:2"]);
    let mut line = vec!["api", "op"];
    line.extend(std::iter::repeat_n(["-H", "x:1"], 101).flatten());
    assert!(error(&line).contains("at most 100 values"));
    let cors = command!(&["serve", "--cors", "a", "--cors", "b"], Command::Serve(args) => args.cors);
    assert_eq!(cors, ["a", "b"]);
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
    assert_eq!(parse(&["--", "run"]).unwrap().0.root.directory.as_deref(), Some("run"));
}

#[test]
fn hidden_flags_parse_but_stay_out_of_help() {
    assert!(command!(&["run", "--yolo"], Command::Run(args) => args.permissions.auto()));
    assert!(command!(&["run", "--dangerously-skip-permissions"], Command::Run(args) => args.permissions.auto()));
    assert!(command!(&["mini", "--demo"], Command::Mini(args) => args.demo));
    assert!(parse(&["--yolo"]).unwrap().0.root.permissions.auto());
    let mut command = help::command();
    let run = command.find_subcommand_mut("run").unwrap().render_help().to_string();
    let mini = command.find_subcommand_mut("mini").unwrap().render_help().to_string();
    assert!(run.contains("--auto") && !run.contains("yolo") && !run.contains("dangerously"));
    assert!(mini.contains("--replay") && !mini.contains("--demo") && !mini.contains("--no-replay "));
}

#[test]
fn server_flags_apply_where_declared() {
    let server = |line: &[&str]| parse(line).unwrap().1;
    assert_eq!(server(&["--server", "http://a", "session", "list"]).server.as_deref(), Some("http://a"));
    assert_eq!(server(&["session", "--server", "http://a", "list"]).server.as_deref(), Some("http://a"));
    assert_eq!(server(&["session", "list", "--server", "http://a"]).server.as_deref(), Some("http://a"));
    assert!(server(&["--standalone", "run", "hi"]).standalone);
    assert!(server(&["run", "hi", "--standalone"]).standalone);
    assert_eq!(server(&["--server", "http://a"]).server.as_deref(), Some("http://a"));
    assert_eq!(server(&["debug", "heap-dump", "--server", "http://a"]).server.as_deref(), Some("http://a"));
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
    assert!(parse(&["--print-logs", "session", "list"]).unwrap().0.global.print_logs);
    assert!(parse(&["session", "list", "--print-logs"]).unwrap().0.global.print_logs);
    assert!(parse(&["debug", "paths", "--version"]).unwrap().0.global.version);
    assert!(parse(&["run", "-v"]).unwrap().0.global.version);
    assert_eq!(parse(&["auth", "--log-level", "debug"]).unwrap().0.global.log_level, Some(args::LogLevel::Debug));
    assert!(parse(&["service", "status", "--wizard"]).unwrap().0.global.wizard);
}

#[test]
fn short_flags_cluster() {
    let run = command!(&["run", "-cf", "a.txt", "hi"], Command::Run(args) => args);
    assert!(run.continue_);
    assert_eq!((run.file, run.message), (vec!["a.txt".to_string()], vec!["hi".to_string()]));
    assert!(command!(&["pair", "-y"], Command::Pair(args) => args.yes));
}

#[test]
fn negative_numbers_are_values() {
    assert_eq!(command!(&["mini", "--replay-limit", "-5"], Command::Mini(args) => args.replay_limit), Some(-5));
    assert!(error(&["stats", "--days", "-1"]).contains("-1"));
    assert_eq!(command!(&["run", "-1.5e3"], Command::Run(args) => args.message), ["-1.5e3"]);
    assert!(error(&["stats", "--year", "1969"]).contains("1969"));
    assert_eq!(command!(&["stats"], Command::Stats(args) => args.limit), 5);
}

#[test]
fn only_the_first_word_names_a_subcommand() {
    assert_eq!(command!(&["run", "session", "list"], Command::Run(args) => args.message), ["session", "list"]);
    assert_eq!(parse(&["project"]).unwrap().0.root.directory.as_deref(), Some("project"));
    assert_eq!(command!(&["run", "-m", "session", "hi"], Command::Run(args) => args.message), ["hi"]);
    assert!(command!(&["session", "list", "-n", "3"], Command::Session(args) => matches!(
        args.command,
        Some(SessionCommand::List(list)) if list.max_count == Some(3)
    )));
    assert!(parse(&["debug", "nope"]).is_err());
    assert!(parse(&["api", "a", "b", "c"]).is_err());
    assert!(parse(&["api"]).is_err());
}

#[test]
fn aliases_and_values_match() {
    assert!(command!(&["update", "1.2.3", "-m", "brew"], Command::Upgrade(args) => args.target.is_some()));
    assert!(error(&["upgrade", "--method", "apt"]).contains("apt"));
    let url = command!(&["pair", "--url", "https://example.com/base//"], Command::Pair(args) => args.url);
    assert_eq!(url.as_deref(), Some("https://example.com/base"));
    assert!(error(&["pair", "--url", "https://user:secret@example.com"]).contains("without credentials"));
    assert!(error(&["pair", "--url", "ftp://example.com"]).contains("HTTP(S)"));
}
