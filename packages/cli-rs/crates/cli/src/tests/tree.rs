//! The clap tree against `tests/fixtures/commands.json`, the TypeScript `Spec` tree dumped by
//! `script/gen/commands.ts`: names, aliases, descriptions, arguments, and flags with their types.

use clap::ArgAction;
use serde_json::Value;

use crate::help;

fn fixture() -> Value {
    serde_json::from_str(include_str!("../../tests/fixtures/commands.json")).unwrap()
}

fn diff(fixture: &Value) -> Vec<String> {
    let tree = help::tree();
    let mut diffs = Vec::new();
    let builtins = tree.get_arguments().filter(|arg| arg.is_global_set()).collect::<Vec<_>>();
    compare_flags("builtins", &fixture["builtins"], &builtins, &mut diffs);
    compare_command("opencode", &fixture["root"], &tree, &mut diffs);
    diffs
}

#[test]
fn tree_matches_the_typescript_cli() {
    let fixture = fixture();
    let nodes = count(&fixture["root"]);
    assert_eq!(nodes, 48, "commands.ts has 48 Spec nodes");
    let diffs = diff(&fixture);
    assert!(diffs.is_empty(), "the clap tree differs from the TypeScript tree:\n{}", diffs.join("\n"));
}

// The comparison sees each kind of change in the TypeScript tree.
#[test]
fn tree_comparison_reports_changes() {
    type Edit = fn(&mut Value);
    let edits: [(&str, Edit); 7] = [
        ("description", |tree| tree["root"]["commands"][0]["description"] = "changed".into()),
        ("alias", |tree| tree["root"]["commands"][0]["aliases"] = serde_json::json!([])),
        ("flag", |tree| tree["root"]["flags"].as_array_mut().unwrap().pop().map(drop).unwrap()),
        ("hidden", |tree| tree["root"]["flags"][3]["hidden"] = false.into()),
        ("type", |tree| tree["root"]["commands"][3]["flags"][0]["type"] = "Int".into()),
        ("argument", |tree| tree["root"]["arguments"][0]["optional"] = false.into()),
        ("command", |tree| tree["root"]["commands"].as_array_mut().unwrap().pop().map(drop).unwrap()),
    ];
    for (what, edit) in edits {
        let mut fixture = fixture();
        edit(&mut fixture);
        assert_eq!(diff(&fixture).len(), 1, "a changed {what} gives one difference");
    }
}

fn count(node: &Value) -> usize {
    1 + node["commands"].as_array().unwrap().iter().map(count).sum::<usize>()
}

#[test]
fn tree_passes_clap_checks() {
    help::command().debug_assert();
}

fn compare_command(path: &str, ts: &Value, command: &clap::Command, diffs: &mut Vec<String>) {
    let mut check = |what: &str, expected: Value, actual: Value| {
        if expected != actual {
            diffs.push(format!("{path}: {what}: TypeScript {expected}, Rust {actual}"));
        }
    };
    let root = path == "opencode";
    if !root {
        check("name", ts["name"].clone(), command.get_name().into());
    }
    let aliases: Vec<&str> = command.get_visible_aliases().collect();
    check("aliases", ts["aliases"].clone(), aliases.into());
    let about = command.get_about().map(|about| about.to_string()).unwrap_or_default();
    check("description", ts["description"].clone(), about.into());

    let globals: Vec<&str> = match root {
        // The root's built-ins are compared with the fixture's `builtins`.
        true => Vec::new(),
        false => command.get_arguments().filter(|arg| arg.is_global_set()).filter_map(|arg| arg.get_long()).collect(),
    };
    check("global flags", ts["globalFlags"].clone(), globals.into());

    let positionals: Vec<Value> = command.get_positionals().map(positional).collect();
    let expected: Vec<Value> = ts["arguments"].as_array().unwrap().iter().map(expected_positional).collect();
    check("arguments", expected.into(), positionals.into());

    let flags: Vec<&clap::Arg> = command
        .get_arguments()
        .filter(|arg| !arg.is_positional() && !arg.is_global_set() && !is_negation(command, arg))
        .collect();
    compare_flags(path, &ts["flags"], &flags, diffs);

    let children: Vec<&str> = command.get_subcommands().map(|sub| sub.get_name()).collect();
    let expected: Vec<&str> =
        ts["commands"].as_array().unwrap().iter().filter_map(|sub| sub["name"].as_str()).collect();
    if children != expected {
        diffs.push(format!("{path}: subcommands: TypeScript {expected:?}, Rust {children:?}"));
        return;
    }
    for (ts, sub) in ts["commands"].as_array().unwrap().iter().zip(command.get_subcommands()) {
        compare_command(&format!("{path} {}", sub.get_name()), ts, sub, diffs);
    }
}

fn compare_flags(path: &str, ts: &Value, flags: &[&clap::Arg], diffs: &mut Vec<String>) {
    let expected: Vec<Value> = ts.as_array().unwrap().iter().map(expected_flag).collect();
    let actual: Vec<Value> = flags.iter().map(|arg| flag(arg)).collect();
    let name = |flag: &Value| flag["name"].as_str().unwrap_or_default().to_string();
    let missing: Vec<String> =
        expected.iter().filter(|flag| !actual.iter().any(|a| name(a) == name(flag))).map(name).collect();
    let extra: Vec<String> =
        actual.iter().filter(|flag| !expected.iter().any(|e| name(e) == name(flag))).map(name).collect();
    if !missing.is_empty() || !extra.is_empty() {
        diffs.push(format!("{path}: flags missing in Rust {missing:?}, only in Rust {extra:?}"));
    }
    for expected in &expected {
        if let Some(actual) = actual.iter().find(|actual| name(actual) == name(expected))
            && actual != expected
        {
            diffs.push(format!("{path}: flag --{}:\n  TypeScript {expected}\n  Rust       {actual}", name(expected)));
        }
    }
}

// The facts the TypeScript dump has, in the same shape, from a clap argument.
fn flag(arg: &clap::Arg) -> Value {
    let action = arg.get_action();
    let boolean = matches!(action, ArgAction::SetTrue | ArgAction::Help);
    let value_name = arg.get_value_names().and_then(|names| names.first()).map(|name| name.to_string());
    let choices = choices(arg);
    let kind = match value_name.as_deref() {
        _ if boolean => "Boolean",
        Some("string") => "String",
        Some("integer") => "Int",
        Some("key=value") => "KeyValuePair",
        Some("choice") => "Choice",
        Some("name") => "name",
        // `--completions` and `--log-level`: Effect CLI shows the choices as the metavariable.
        _ if !choices.is_empty() => "metavar",
        _ => "unknown",
    };
    let mut aliases: Vec<String> = arg.get_short().map(String::from).into_iter().collect();
    aliases.extend(arg.get_visible_aliases().unwrap_or_default().into_iter().map(String::from));
    let default = match boolean {
        true => Value::Null,
        false => arg.get_default_values().first().map_or(Value::Null, |value| value.to_string_lossy().into()),
    };
    serde_json::json!({
        "name": arg.get_long().unwrap_or_default(),
        "aliases": aliases,
        "type": kind,
        "choices": choices,
        "description": arg.get_help().map(|help| help.to_string()).unwrap_or_default(),
        "hidden": arg.is_hide_set(),
        "optional": !arg.is_required_set(),
        "repeated": matches!(action, ArgAction::Append),
        "optionalValue": arg.is_require_equals_set() && arg.get_num_args().is_some_and(|range| range.min_values() == 0),
        "default": default,
    })
}

fn expected_flag(ts: &Value) -> Value {
    let kind = match ts["type"].as_str().unwrap_or_default() {
        metavar if metavar.starts_with('<') => "metavar",
        kind => kind,
    };
    let default = match &ts["default"] {
        Value::Bool(_) | Value::Null => Value::Null,
        value => value.to_string().trim_matches('"').into(),
    };
    serde_json::json!({
        "name": ts["name"],
        "aliases": ts["aliases"],
        "type": kind,
        "choices": ts["choices"],
        "description": ts["description"],
        "hidden": ts["hidden"],
        "optional": ts["optional"],
        "repeated": ts["repeated"],
        "optionalValue": ts["optionalValue"],
        "default": default,
    })
}

fn positional(arg: &clap::Arg) -> Value {
    let range = arg.get_num_args();
    let variadic = matches!(arg.get_action(), ArgAction::Append) || range.is_some_and(|range| range.max_values() > 1);
    let choices = choices(arg);
    serde_json::json!({
        "name": arg.get_value_names().and_then(|names| names.first()).map(|name| name.to_string()),
        "type": if choices.is_empty() { "String" } else { "Choice" },
        "choices": choices,
        "description": arg.get_help().map(|help| help.to_string()).unwrap_or_default(),
        "required": arg.is_required_set(),
        "variadic": variadic,
        "max": range.map(|range| range.max_values()).filter(|max| *max != usize::MAX),
    })
}

fn expected_positional(ts: &Value) -> Value {
    let variadic = ts["variadic"].as_bool().unwrap_or(false);
    let min = ts["min"].as_u64().unwrap_or(0);
    serde_json::json!({
        "name": ts["name"],
        "type": ts["type"],
        "choices": ts["choices"],
        "description": ts["description"],
        "required": !ts["optional"].as_bool().unwrap_or(false) && (!variadic || min > 0),
        "variadic": variadic,
        "max": ts["max"],
    })
}

fn choices(arg: &clap::Arg) -> Vec<String> {
    if matches!(arg.get_action(), ArgAction::SetTrue | ArgAction::Help) {
        return Vec::new();
    }
    arg.get_possible_values().iter().map(|value| value.get_name().to_string()).collect()
}

// `--no-replay` is the hidden negation that `args::normalize` emits; Effect CLI has it built into `--replay`.
fn is_negation(command: &clap::Command, arg: &clap::Arg) -> bool {
    arg.is_hide_set()
        && arg
            .get_long()
            .and_then(|long| long.strip_prefix("no-"))
            .is_some_and(|long| command.get_arguments().any(|other| other.get_long() == Some(long)))
}
