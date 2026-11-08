//! Help, completion scripts, and usage errors against what the TypeScript CLI prints, recorded with colors by
//! `script/gen/cli-output.ts` in `tests/fixtures/cli`. Without a terminal both print the same text without colors.

use std::path::Path;

use serde_json::Value;

use crate::args::{Shell, Spec};
use crate::help::{self, strip};
use crate::parse::{self, Outcome};
use crate::{completions, tests::lines_diff};

const PROGRAM: &str = "opencode";

fn fixtures() -> &'static Path {
    Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/cli"))
}

fn every_command() -> Vec<Vec<&'static Spec>> {
    fn visit(path: Vec<&'static Spec>, out: &mut Vec<Vec<&'static Spec>>) {
        out.push(path.clone());
        for sub in path[path.len() - 1].commands {
            visit(path.iter().copied().chain([sub]).collect(), out);
        }
    }
    let mut out = Vec::new();
    visit(vec![&crate::args::ROOT], &mut out);
    out
}

#[test]
fn help_matches_the_typescript_cli() {
    let paths = every_command();
    assert_eq!(paths.len(), 48);
    for path in paths {
        let name = parse::command_path(&path, PROGRAM).join(" ");
        let expected = std::fs::read_to_string(fixtures().join(format!("help/{name}.txt"))).unwrap();
        let actual = format!("{}\n", help::render(&path, PROGRAM, true));
        assert!(actual == expected, "{name} --help:\n{}", lines_diff(&expected, &actual));
        let plain = format!("{}\n", help::render(&path, PROGRAM, false));
        assert!(plain == strip(&expected), "{name} --help without colors:\n{}", lines_diff(&strip(&expected), &plain));
    }
}

#[test]
fn help_flag_selects_the_command() {
    let help = |line: &[&str]| match parse::parse(&line.iter().map(|arg| arg.to_string()).collect::<Vec<_>>(), PROGRAM)
    {
        Outcome::Help(path) => parse::command_path(&path, PROGRAM).join(" "),
        _ => panic!("{line:?} is not help"),
    };
    assert_eq!(help(&["session", "list", "--help"]), "opencode session list");
    assert_eq!(help(&["-h", "update"]), "opencode upgrade");
    assert_eq!(help(&["run", "--bogus", "-h", "false"]), "opencode run");
    assert_eq!(help(&["--wizard", "--help"]), "opencode");
}

#[test]
fn completions_match_the_typescript_cli() {
    for (shell, file) in
        [(Shell::Bash, "bash"), (Shell::Zsh, "zsh"), (Shell::Fish, "fish"), (Shell::Powershell, "powershell")]
    {
        let expected = std::fs::read_to_string(fixtures().join(format!("completions/{file}.txt"))).unwrap();
        let actual = format!("{}\n", completions::generate(shell, PROGRAM));
        assert!(actual == expected, "--completions {file}:\n{}", lines_diff(&expected, &actual));
    }
    assert_eq!(completions::generate(Shell::Sh, PROGRAM), completions::generate(Shell::Bash, PROGRAM));
    assert_eq!(completions::generate(Shell::Pwsh, PROGRAM), completions::generate(Shell::Powershell, PROGRAM));
}

#[test]
fn usage_errors_match_the_typescript_cli() {
    let records: Vec<Value> =
        serde_json::from_str(&std::fs::read_to_string(fixtures().join("errors.json")).unwrap()).unwrap();
    assert!(records.len() > 50);
    for record in records {
        let args: Vec<String> =
            record["args"].as_array().unwrap().iter().map(|arg| arg.as_str().unwrap().to_string()).collect();
        assert_eq!(record["exit"], 1, "{args:?}");
        let Outcome::Usage { path, errors } = parse::parse(&args, PROGRAM) else {
            panic!("{args:?} is not a usage error");
        };
        // The recorded run had no terminal, so its environment alone decides the colors.
        let env = |name: &str| record["env"][name].as_str().map(String::from);
        let stdout = format!("{}\n", help::render(&path, PROGRAM, help::can_color(env, false)));
        let stderr = help::error_output(&errors, help::can_color(env, false), help::bun_colors(env, false));
        assert!(
            stdout == record["stdout"],
            "{args:?} stdout:\n{}",
            lines_diff(record["stdout"].as_str().unwrap(), &stdout)
        );
        assert!(
            stderr == record["stderr"],
            "{args:?} stderr:\n{}",
            lines_diff(record["stderr"].as_str().unwrap(), &stderr)
        );
        let plain = help::error_output(&errors, false, false);
        assert_eq!(plain, strip(record["stderr"].as_str().unwrap()), "{args:?} stderr without colors");
    }
}
