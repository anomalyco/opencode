//! The command table against `tests/fixtures/commands.json`, the TypeScript tree dumped by `script/gen/commands.ts`:
//! names, aliases, descriptions, global flags, arguments, and flags with their types, counts, and defaults.

use serde_json::{Value, json};

use crate::args::{Arg, BUILTINS, Count, Default, Flag, Kind, ROOT, Spec};

fn fixture() -> Value {
    serde_json::from_str(include_str!("../../tests/fixtures/commands.json")).unwrap()
}

#[test]
fn table_matches_the_typescript_cli() {
    let fixture = fixture();
    assert_eq!(count(&fixture["root"]), 48, "commands.ts has 48 commands");
    let builtins: Vec<Value> = BUILTINS.iter().chain(ROOT.globals).map(flag).collect();
    let mut diffs = Vec::new();
    compare("builtins", &fixture["builtins"], &Value::from(builtins), &mut diffs);
    compare_command("opencode", &fixture["root"], &ROOT, &mut diffs);
    assert!(diffs.is_empty(), "the table differs from the TypeScript tree:\n{}", diffs.join("\n"));
}

fn count(node: &Value) -> usize {
    1 + node["commands"].as_array().unwrap().iter().map(count).sum::<usize>()
}

fn compare(path: &str, expected: &Value, actual: &Value, diffs: &mut Vec<String>) {
    if expected != actual {
        diffs.push(format!("{path}:\n  TypeScript {expected}\n  Rust       {actual}"));
    }
}

fn compare_command(path: &str, ts: &Value, spec: &Spec, diffs: &mut Vec<String>) {
    let node = json!({
        "name": spec.name,
        "aliases": spec.alias.into_iter().collect::<Vec<_>>(),
        "description": spec.description,
        // The TypeScript runtime adds the root's `--print-logs` outside commands.ts; the dump lists it as a built-in.
        "globalFlags": spec.globals.iter().map(|flag| flag.name).filter(|_| path != "opencode").collect::<Vec<_>>(),
        "arguments": spec.arguments().map(argument).collect::<Vec<_>>(),
        "flags": spec.flags().map(flag).collect::<Vec<_>>(),
    });
    for key in ["name", "aliases", "description", "globalFlags", "arguments", "flags"] {
        compare(&format!("{path} {key}"), &ts[key], &node[key], diffs);
    }
    let expected: Vec<&str> =
        ts["commands"].as_array().unwrap().iter().filter_map(|sub| sub["name"].as_str()).collect();
    let actual: Vec<&str> = spec.commands.iter().map(|sub| sub.name).collect();
    if expected != actual {
        diffs.push(format!("{path}: subcommands: TypeScript {expected:?}, Rust {actual:?}"));
        return;
    }
    for (ts, sub) in ts["commands"].as_array().unwrap().iter().zip(spec.commands) {
        compare_command(&format!("{path} {}", sub.name), ts, sub, diffs);
    }
}

fn tag(kind: Kind) -> &'static str {
    match kind {
        Kind::Boolean => "Boolean",
        Kind::String => "String",
        Kind::Int => "Int",
        Kind::Choice(_) => "Choice",
        Kind::KeyValue => "KeyValuePair",
    }
}

fn choices(kind: Kind) -> Vec<&'static str> {
    match kind {
        Kind::Choice(choices) => choices.to_vec(),
        _ => Vec::new(),
    }
}

// The dump's shape (`script/gen/commands.ts`): a repeatable flag is optional when it parses to `[]` without input,
// and absent bounds and defaults are left out.
fn flag(flag: &Flag) -> Value {
    let mut value = json!({
        "name": flag.name,
        "aliases": flag.aliases,
        "type": flag.metavar.unwrap_or(tag(flag.kind)),
        "choices": choices(flag.kind),
        "description": flag.description,
        "hidden": flag.hidden,
        "optional": match flag.count {
            Count::Required => false,
            Count::Optional | Count::Default(_) => true,
            Count::Repeated { min, optional, .. } => optional || min.unwrap_or(0) == 0,
        },
        "repeated": matches!(flag.count, Count::Repeated { .. }),
        "optionalValue": flag.optional_value.is_some(),
    });
    bounds(flag.count, &mut value);
    if let Count::Default(default) = flag.count {
        value["default"] = match default {
            Default::Bool(value) => value.into(),
            Default::Text(value) => value.into(),
            Default::Int(value) => value.into(),
        };
    }
    value
}

fn argument(arg: &Arg) -> Value {
    let mut value = json!({
        "name": arg.name,
        "type": tag(arg.kind),
        "choices": choices(arg.kind),
        "description": arg.description,
        "optional": arg.count == Count::Optional,
        "variadic": arg.is_variadic(),
    });
    bounds(arg.count, &mut value);
    value
}

fn bounds(count: Count, value: &mut Value) {
    if let Count::Repeated { min, max, .. } = count {
        if let Some(min) = min {
            value["min"] = min.into();
        }
        if let Some(max) = max {
            value["max"] = max.into();
        }
    }
}
