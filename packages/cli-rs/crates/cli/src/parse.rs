//! Effect CLI's command-line parser (`effect/src/cli/internal/{lexer,parser}.ts`, `Command.runWith`, `Param.ts`)
//! over the table in `args.rs`, with its error messages. `parse` decides what the binary does with a command line:
//! print help, the version, or a completion script, start the wizard, report a usage error, or run a command.

use std::collections::HashMap;

use crate::args::{
    Arg, BUILTINS, Check, Cli, Count, Default, Flag, GlobalArgs, Kind, Param, ROOT, ServerFlags, Shell, Spec,
};

pub enum Outcome {
    /// `--help`: the help of the selected command.
    Help(Vec<&'static Spec>),
    Version,
    Completions(Shell),
    /// `--wizard`, for the selected command.
    Wizard(Vec<&'static Spec>),
    /// The help of the selected command to stdout and the errors to stderr, exit 1.
    Usage {
        path: Vec<&'static Spec>,
        errors: Vec<String>,
    },
    Run(Box<Invocation>),
}

pub struct Invocation {
    pub cli: Cli,
    /// `--standalone` and `--server` for the selected command: the root's own, or the global ones of the command
    /// that declares them, wherever they were given (`opencode --server URL session list`).
    pub server: ServerFlags,
}

/// Parses `args` (after the program name) as `Command.runWith` does. `program` is the root command's name in
/// error messages.
pub fn parse(args: &[String], program: &str) -> Outcome {
    let (tokens, trailing) = lex(args);
    let all = all_globals();
    let (globals, remainder, global_errors) = consume_globals(&tokens, &all);
    let tree = parse_levels(remainder, trailing, program);
    let path = tree.path;
    let names = command_path(&path, program);
    let active = active_globals(&path);

    // Globals given outside the scope of the commands that declare them.
    let out_of_scope = all
        .iter()
        .filter(|flag| !active.iter().any(|active| active.name == flag.name))
        .filter(|flag| globals.get(flag.name).is_some_and(|values| !values.is_empty()))
        .map(|flag| unrecognized(&format!("--{}", flag.name), &names, &[]));
    let errors: Vec<String> = global_errors.into_iter().chain(out_of_scope).collect();
    if !errors.is_empty() {
        return Outcome::Usage { path, errors: errors.into_iter().chain(tree.errors).collect() };
    }

    // The first action flag given runs instead of the command, even when the rest of the line has errors.
    let mut global_values = Values::default();
    for flag in BUILTINS.iter().take(4) {
        if globals.get(flag.name).is_none_or(|values| values.is_empty()) {
            continue;
        }
        if let Err(error) = flag_value(flag, &globals, &mut global_values) {
            return Outcome::Usage { path, errors: vec![error] };
        }
        return match flag.name {
            "help" => Outcome::Help(path),
            "version" => Outcome::Version,
            "wizard" => Outcome::Wizard(path),
            _ => match global_values.string("completions") {
                Some(shell) => Outcome::Completions(Shell::from_choice(&shell)),
                None => unreachable!("--completions was given"),
            },
        };
    }

    if !tree.errors.is_empty() {
        return Outcome::Usage { path, errors: tree.errors };
    }
    let leaf = path.last().copied().unwrap_or(&ROOT);
    let mut values = match params(leaf, &tree.flags, tree.arguments) {
        Ok(values) => values,
        Err(error) => return Outcome::Usage { path, errors: vec![error] },
    };
    // The settings parse after the command: `--log-level`, `--print-logs`, then those the commands declare.
    for flag in active.iter().skip(4) {
        if let Err(error) = flag_value(flag, &globals, &mut global_values) {
            return Outcome::Usage { path, errors: vec![error] };
        }
    }

    let names: Vec<&str> = path.iter().skip(1).map(|spec| spec.name).collect();
    let cli = Cli::new(&names, &mut values, GlobalArgs::from_values(&mut global_values));
    let server = match names.is_empty() {
        true => ServerFlags { standalone: cli.root.standalone, server: cli.root.server.clone() },
        false => ServerFlags {
            standalone: global_values.has("standalone") && global_values.flag("standalone"),
            server: global_values.has("server").then(|| global_values.string("server")).flatten(),
        },
    };
    Outcome::Run(Box::new(Invocation { cli, server }))
}

/// The names of the commands on `path`, with `program` for the root.
pub fn command_path(path: &[&Spec], program: &str) -> Vec<String> {
    std::iter::once(program.to_string()).chain(path.iter().skip(1).map(|spec| spec.name.to_string())).collect()
}

/// The commands on the path `names` (below the root), as far as they exist.
pub fn find_path(names: &[&str]) -> Vec<&'static Spec> {
    let mut path = vec![&ROOT];
    for name in names {
        match path.last().and_then(|spec| spec.commands.iter().find(|sub| sub.name == *name)) {
            Some(sub) => path.push(sub),
            None => break,
        }
    }
    path
}

/// The global flags of the commands on `path`: the built-ins, then those each command declares.
pub fn active_globals(path: &[&'static Spec]) -> Vec<&'static Flag> {
    dedupe(BUILTINS.iter().chain(path.iter().flat_map(|spec| spec.globals.iter())))
}

/// Every global flag any command declares, after the built-ins.
fn all_globals() -> Vec<&'static Flag> {
    fn visit(spec: &'static Spec, out: &mut Vec<&'static Flag>) {
        out.extend(spec.globals.iter());
        spec.commands.iter().for_each(|sub| visit(sub, out));
    }
    let mut declared = Vec::new();
    visit(&ROOT, &mut declared);
    dedupe(BUILTINS.iter().chain(declared))
}

fn dedupe(flags: impl Iterator<Item = &'static Flag>) -> Vec<&'static Flag> {
    let mut out: Vec<&'static Flag> = Vec::new();
    for flag in flags {
        if !out.iter().any(|seen| seen.name == flag.name) {
            out.push(flag);
        }
    }
    out
}

#[derive(Clone, Debug)]
enum Token {
    Long { name: String, raw: String, value: Option<String> },
    Short { flag: String, raw: String, value: Option<String> },
    Value(String),
}

impl Token {
    fn flag_name(&self) -> Option<&str> {
        match self {
            Token::Long { name, .. } => Some(name),
            Token::Short { flag, .. } => Some(flag),
            Token::Value(_) => None,
        }
    }

    fn raw(&self) -> &str {
        match self {
            Token::Long { raw, .. } | Token::Short { raw, .. } | Token::Value(raw) => raw,
        }
    }

    fn inline(&self) -> Option<&str> {
        match self {
            Token::Long { value, .. } | Token::Short { value, .. } => value.as_deref(),
            Token::Value(_) => None,
        }
    }
}

/// `lexer.ts`: everything after the first `--` is an operand; `-` alone and negative numbers are values.
fn lex(args: &[String]) -> (Vec<Token>, Vec<String>) {
    let end = args.iter().position(|arg| arg == "--").unwrap_or(args.len());
    let trailing = args.get(end + 1..).unwrap_or_default().to_vec();
    let mut tokens = Vec::new();
    for arg in &args[..end] {
        if !arg.starts_with('-') || is_negative_number(arg) {
            tokens.push(Token::Value(arg.clone()));
        } else if let Some(long) = arg.strip_prefix("--") {
            match long.split_once('=') {
                Some(("", _)) => tokens.push(Token::Value(arg.clone())),
                Some((name, value)) => {
                    tokens.push(Token::Long { name: name.into(), raw: arg.clone(), value: Some(value.into()) })
                }
                None => tokens.push(Token::Long { name: long.into(), raw: arg.clone(), value: None }),
            }
        } else if arg.len() > 1 {
            let (flags, value) = match arg[1..].split_once('=') {
                Some((flags, value)) => (flags, Some(value)),
                None => (&arg[1..], None),
            };
            let chars: Vec<char> = flags.chars().collect();
            for (index, char) in chars.iter().enumerate() {
                let last = index + 1 == chars.len();
                tokens.push(Token::Short {
                    flag: char.to_string(),
                    raw: format!("-{char}"),
                    value: value.filter(|_| last).map(String::from),
                });
            }
            // `-=v` names the empty flag, as Effect's lexer does.
            if chars.is_empty() {
                tokens.push(Token::Short { flag: String::new(), raw: "-".into(), value: value.map(String::from) });
            }
        } else {
            tokens.push(Token::Value(arg.clone()));
        }
    }
    (tokens, trailing)
}

// `^-(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$`.
fn is_negative_number(text: &str) -> bool {
    text.strip_prefix('-').is_some_and(|number| {
        let (mantissa, exponent) = match number.split_once(['e', 'E']) {
            Some((mantissa, exponent)) => (mantissa, Some(exponent)),
            None => (number, None),
        };
        let mantissa = match mantissa.split_once('.') {
            Some((int, frac)) => digits(frac, true) && (digits(int, false) || (int.is_empty() && !frac.is_empty())),
            None => digits(mantissa, false),
        };
        let exponent =
            exponent.is_none_or(|exponent| digits(exponent.strip_prefix(['+', '-']).unwrap_or(exponent), false));
        mantissa && exponent
    })
}

fn digits(text: &str, empty: bool) -> bool {
    (empty || !text.is_empty()) && text.bytes().all(|byte| byte.is_ascii_digit())
}

/// Resolves a flag token against `flags`: its name, then a negation (`--no-name`), then an alias.
fn resolve<'a>(token: &Token, flags: &[&'a Flag]) -> Option<(&'a Flag, bool)> {
    let name = token.flag_name()?;
    if let Some(flag) = flags.iter().find(|flag| flag.name == name) {
        return Some((flag, false));
    }
    let negated = match token {
        Token::Long { name, .. } => flags.iter().find(|flag| flag.negation().as_deref() == Some(name.as_str())),
        _ => None,
    };
    if let Some(flag) = negated {
        return Some((flag, true));
    }
    flags.iter().find(|flag| flag.aliases.contains(&name)).map(|flag| (*flag, false))
}

/// `consumeFlagValueWithTokens`: the value of `flag` given as `token`, and how many of the following tokens it
/// used.
fn consume_value(rest: &[Token], token: &Token, flag: &Flag, negated: bool) -> (Result<String, String>, usize) {
    let literal = |next: Option<&Token>| match next {
        Some(Token::Value(value)) if parse_bool(value).is_some() => Some(value.clone()),
        _ => None,
    };
    if negated {
        if let Some(value) = token.inline() {
            return (Err(invalid_negation(token, flag, value)), 0);
        }
        if flag.optional_value.is_none()
            && let Some(value) = literal(rest.first())
        {
            return (Err(invalid_negation(token, flag, &value)), 1);
        }
        return (Ok("false".into()), 0);
    }
    if let Some(value) = token.inline() {
        return (Ok(value.into()), 0);
    }
    if let Some(value) = flag.optional_value {
        return (Ok(value.into()), 0);
    }
    if flag.is_boolean() {
        return match literal(rest.first()) {
            Some(value) => (Ok(value), 1),
            None => (Ok("true".into()), 0),
        };
    }
    match rest.first() {
        Some(Token::Value(value)) => (Ok(value.clone()), 1),
        _ => {
            let expected = match flag.kind {
                Kind::Choice(choices) => choices.join(" | "),
                kind => flag.metavar.unwrap_or(kind.type_name()).to_string(),
            };
            (Err(invalid_value("flag", flag.name, "", &expected)), 0)
        }
    }
}

fn invalid_negation(token: &Token, flag: &Flag, value: &str) -> String {
    let expected = format!("omit the value and use {} by itself to set --{} to false", token.raw(), flag.name);
    invalid_value("flag", flag.name, value, &expected)
}

type FlagMap = HashMap<&'static str, Vec<String>>;

/// `consumeGlobalFlags`: takes the global flags out of the line at every command level. A command's own flag of
/// the same name wins, except at the root before its subcommand (`opencode --server URL session list`).
fn consume_globals(tokens: &[Token], globals: &[&'static Flag]) -> (FlagMap, Vec<Token>, Vec<String>) {
    let mut map = FlagMap::new();
    let mut errors = Vec::new();
    let mut remainder = Vec::new();
    let mut spec: &'static Spec = &ROOT;
    let mut index = 0;
    let mut awaiting = true;
    while let Some(token) = tokens.get(index) {
        index += 1;
        if let Token::Value(value) = token {
            if awaiting && let Some(sub) = spec.find(value) {
                spec = sub;
                remainder.push(token.clone());
                continue;
            }
            awaiting = false;
            remainder.push(token.clone());
            continue;
        }
        let local_flags: Vec<&Flag> = spec.flags().collect();
        let local = resolve(token, &local_flags);
        let global = resolve(token, globals);
        if let Some((flag, negated)) = local
            && (global.is_none()
                || !awaiting
                || !precedes_subcommand(&tokens[index..], token, flag, negated, spec, globals))
        {
            let (_, used) = consume_value(&tokens[index..], token, flag, negated);
            remainder.extend(tokens[index - 1..index + used].iter().cloned());
            index += used;
            continue;
        }
        let Some((flag, negated)) = global else {
            remainder.push(token.clone());
            continue;
        };
        let (value, used) = consume_value(&tokens[index..], token, flag, negated);
        index += used;
        match value {
            Ok(value) => map.entry(flag.name).or_default().push(value),
            Err(error) => errors.push(error),
        }
    }
    (map, remainder, errors)
}

/// `localFlagWouldPrecedeSubcommand`: whether the first value after this flag and its value names a subcommand.
fn precedes_subcommand(
    rest: &[Token],
    token: &Token,
    flag: &Flag,
    negated: bool,
    spec: &Spec,
    globals: &[&Flag],
) -> bool {
    let (_, mut index) = consume_value(rest, token, flag, negated);
    let known: Vec<&Flag> = spec.flags().chain(globals.iter().copied()).collect();
    while let Some(token) = rest.get(index) {
        index += 1;
        if let Token::Value(value) = token {
            return spec.find(value).is_some();
        }
        if let Some((flag, negated)) = resolve(token, &known) {
            index += consume_value(&rest[index..], token, flag, negated).1;
        }
    }
    false
}

struct Tree {
    path: Vec<&'static Spec>,
    flags: FlagMap,
    arguments: Vec<String>,
    errors: Vec<String>,
}

/// `parseArgs`: walks the commands, collecting each level's flags and the leaf's arguments.
fn parse_levels(tokens: Vec<Token>, trailing: Vec<String>, program: &str) -> Tree {
    let mut path: Vec<&'static Spec> = vec![&ROOT];
    let mut errors = Vec::new();
    let mut tokens = tokens;
    loop {
        let spec = path[path.len() - 1];
        let names = command_path(&path, program);
        let local: Vec<&Flag> = spec.flags().collect();
        let mut flags = FlagMap::new();
        let mut arguments = Vec::new();
        let mut awaiting = true;
        let mut index = 0;
        let mut sub = None;
        while let Some(token) = tokens.get(index) {
            index += 1;
            let Token::Value(value) = token else {
                let Some((flag, negated)) = resolve(token, &local) else {
                    errors.push(unrecognized_flag(token, &local, &names));
                    continue;
                };
                let (value, used) = consume_value(&tokens[index..], token, flag, negated);
                index += used;
                match value {
                    Ok(value) => flags.entry(flag.name).or_default().push(value),
                    Err(error) => errors.push(error),
                }
                continue;
            };
            if awaiting {
                if let Some(found) = spec.find(value) {
                    // A command's own flags do not pass to its subcommands.
                    let selected: Vec<String> = names.iter().cloned().chain([found.name.to_string()]).collect();
                    for flag in
                        local.iter().filter(|flag| flags.get(flag.name).is_some_and(|values| !values.is_empty()))
                    {
                        errors.push(unrecognized(&format!("--{}", flag.name), &selected, &[]));
                    }
                    sub = Some(found);
                    break;
                }
                if spec.arguments().next().is_none() && !spec.commands.is_empty() {
                    let keys: Vec<&str> =
                        spec.commands.iter().flat_map(|sub| std::iter::once(sub.name).chain(sub.alias)).collect();
                    errors.push(unknown_subcommand(value, &names, &suggest(value, &keys)));
                }
                awaiting = false;
            }
            arguments.push(value.clone());
        }
        match sub {
            Some(sub) => {
                path.push(sub);
                tokens = tokens.split_off(index);
            }
            None => {
                arguments.extend(trailing);
                return Tree { path, flags, arguments, errors };
            }
        }
    }
}

/// The checked values of a command's params, by name.
#[derive(Default, Debug)]
pub struct Values(HashMap<&'static str, Value>);

#[derive(Debug)]
enum Value {
    Bool(Option<bool>),
    Text(Option<String>),
    Int(Option<i64>),
    List(Vec<String>),
    Pairs(Vec<(String, String)>),
}

impl Values {
    pub fn has(&self, name: &str) -> bool {
        self.0.contains_key(name)
    }

    fn take(&mut self, name: &str) -> Value {
        self.0.remove(name).unwrap_or_else(|| panic!("the table has no param {name}"))
    }

    pub fn flag(&mut self, name: &str) -> bool {
        self.optional_flag(name).unwrap_or(false)
    }

    pub fn optional_flag(&mut self, name: &str) -> Option<bool> {
        match self.take(name) {
            Value::Bool(value) => value,
            other => panic!("{name} is {other:?}"),
        }
    }

    pub fn string(&mut self, name: &str) -> Option<String> {
        match self.take(name) {
            Value::Text(value) => value,
            other => panic!("{name} is {other:?}"),
        }
    }

    /// A required or defaulted value.
    pub fn text(&mut self, name: &str) -> String {
        self.string(name).unwrap_or_else(|| panic!("{name} has no value"))
    }

    pub fn int(&mut self, name: &str) -> Option<i64> {
        match self.take(name) {
            Value::Int(value) => value,
            other => panic!("{name} is {other:?}"),
        }
    }

    pub fn list(&mut self, name: &str) -> Vec<String> {
        match self.take(name) {
            Value::List(value) => value,
            other => panic!("{name} is {other:?}"),
        }
    }

    pub fn pairs(&mut self, name: &str) -> Vec<(String, String)> {
        match self.take(name) {
            Value::Pairs(value) => value,
            other => panic!("{name} is {other:?}"),
        }
    }
}

/// Parses each param of `spec` in declaration order, as Effect does, and stops at the first error.
fn params(spec: &Spec, flags: &FlagMap, arguments: Vec<String>) -> Result<Values, String> {
    let mut values = Values::default();
    let mut arguments = arguments.as_slice();
    for param in spec.params {
        match param {
            Param::Flag(flag) => flag_value(flag, flags, &mut values)?,
            Param::Arg(arg) => arguments = argument_value(arg, arguments, &mut values)?,
        }
    }
    match arguments {
        [] => Ok(values),
        [one] => Err(format!("Unexpected positional argument: {}", json(one))),
        many => Err(format!(
            "Unexpected positional arguments: {}",
            many.iter().map(|arg| json(arg)).collect::<Vec<_>>().join(", ")
        )),
    }
}

fn flag_value(flag: &'static Flag, flags: &FlagMap, values: &mut Values) -> Result<(), String> {
    let given = flags.get(flag.name).map(Vec::as_slice).unwrap_or_default();
    let value = match flag.count {
        Count::Repeated { min, max, optional } => {
            let count = given.len();
            let occurrences = || format!("{count} occurrences");
            if let Some(min) = min.filter(|min| count < *min) {
                if count > 0 {
                    return Err(invalid_value("flag", flag.name, &occurrences(), &at_least(min)));
                }
                if !optional {
                    return Err(format!("Missing required flag: --{}", flag.name));
                }
            }
            if let Some(max) = max.filter(|max| count > *max) {
                return Err(invalid_value(
                    "flag",
                    flag.name,
                    &occurrences(),
                    &format!("at most {max} value{}", plural(max)),
                ));
            }
            let parsed = given
                .iter()
                .map(|value| one(flag.name, flag.kind, flag.check, "flag", value))
                .collect::<Result<Vec<_>, _>>()?;
            match flag.kind {
                Kind::KeyValue => Value::Pairs(
                    parsed
                        .into_iter()
                        .filter_map(|value| match value {
                            Parsed::Pair(key, value) => Some((key, value)),
                            _ => None,
                        })
                        .collect(),
                ),
                _ => Value::List(parsed.into_iter().map(Parsed::into_text).collect()),
            }
        }
        count => {
            let parsed = match given {
                [] => match count {
                    Count::Required => return Err(format!("Missing required flag: --{}", flag.name)),
                    Count::Default(Default::Bool(value)) => Some(Parsed::Bool(value)),
                    Count::Default(Default::Text(value)) => Some(Parsed::Text(value.into())),
                    Count::Default(Default::Int(value)) => Some(Parsed::Int(value)),
                    _ => None,
                },
                [value] => Some(one(flag.name, flag.kind, flag.check, "flag", value)?),
                many => {
                    return Err(invalid_value(
                        "flag",
                        flag.name,
                        &format!("{} occurrences", many.len()),
                        "at most 1 value",
                    ));
                }
            };
            single(flag.kind, parsed)
        }
    };
    values.0.insert(flag.name, value);
    Ok(())
}

/// Takes `arg`'s values from the front of `arguments` and returns the rest.
fn argument_value<'a>(arg: &'static Arg, arguments: &'a [String], values: &mut Values) -> Result<&'a [String], String> {
    let missing = || format!("Missing required argument: {}", arg.name);
    let (value, rest) = match arg.count {
        Count::Repeated { min, max, .. } => {
            let count = arguments.len().min(max.unwrap_or(usize::MAX));
            let min = min.unwrap_or(0);
            if count < min {
                if count == 0 {
                    return Err(missing());
                }
                return Err(invalid_value("argument", arg.name, &format!("{count} values"), &at_least(min)));
            }
            let parsed = arguments[..count]
                .iter()
                .map(|value| one(arg.name, arg.kind, Check::None, "argument", value).map(Parsed::into_text))
                .collect::<Result<Vec<_>, _>>()?;
            (Value::List(parsed), &arguments[count..])
        }
        count => match arguments.split_first() {
            None if count == Count::Required => return Err(missing()),
            None => (single(arg.kind, None), arguments),
            Some((first, rest)) => {
                (single(arg.kind, Some(one(arg.name, arg.kind, Check::None, "argument", first)?)), rest)
            }
        },
    };
    values.0.insert(arg.name, value);
    Ok(rest)
}

enum Parsed {
    Bool(bool),
    Text(String),
    Int(i64),
    Pair(String, String),
}

impl Parsed {
    fn into_text(self) -> String {
        match self {
            Parsed::Text(text) => text,
            Parsed::Bool(value) => value.to_string(),
            Parsed::Int(value) => value.to_string(),
            Parsed::Pair(key, value) => format!("{key}={value}"),
        }
    }
}

fn single(kind: Kind, parsed: Option<Parsed>) -> Value {
    match kind {
        Kind::Boolean => Value::Bool(parsed.map(|parsed| matches!(parsed, Parsed::Bool(true)))),
        Kind::Int => Value::Int(parsed.and_then(|parsed| match parsed {
            Parsed::Int(value) => Some(value),
            _ => None,
        })),
        _ => Value::Text(parsed.map(Parsed::into_text)),
    }
}

/// Parses one value with the kind's primitive, then the param's check (`Flag.withSchema`, `Flag.mapTryCatch`).
fn one(name: &str, kind: Kind, check: Check, what: &str, raw: &str) -> Result<Parsed, String> {
    let invalid = |value: &str, expected: &str| invalid_value(what, name, value, expected);
    let parsed = match kind {
        Kind::Boolean => Parsed::Bool(parse_bool(raw).ok_or_else(|| {
            invalid(
                raw,
                "Expected \"true\" | \"yes\" | \"on\" | \"1\" | \"y\" | \"false\" | \"no\" | \"off\" | \"0\" | \"n\"",
            )
        })?),
        Kind::String => Parsed::Text(raw.into()),
        Kind::Int => Parsed::Int(parse_int(raw).map_err(|expected| invalid(raw, expected))?),
        Kind::Choice(choices) => match choices.contains(&raw) {
            true => Parsed::Text(raw.into()),
            false => {
                return Err(invalid(raw, &choices.iter().map(|choice| json(choice)).collect::<Vec<_>>().join(" | ")));
            }
        },
        Kind::KeyValue => {
            let pair = raw.split_once('=').ok_or_else(|| {
                invalid(raw, &format!("Invalid key=value format. Expected format: key=value, got: {raw}"))
            })?;
            if pair.0.is_empty() || pair.1.is_empty() {
                return Err(invalid(
                    raw,
                    &format!("Invalid key=value format. Both key and value must be non-empty. Got: {raw}"),
                ));
            }
            Parsed::Pair(pair.0.into(), pair.1.into())
        }
    };
    let schema =
        |expected: String| invalid(&parsed_text(&parsed), &format!("Schema validation failed: Expected {expected}"));
    match (check, &parsed) {
        (Check::AtLeast(min), Parsed::Int(value)) if *value < min => {
            Err(schema(format!("a value greater than or equal to {min}")))
        }
        (Check::Between(min, max), Parsed::Int(value)) if *value < min || *value > max => {
            Err(schema(format!("a value between {min} and {max}")))
        }
        (Check::NonEmpty, Parsed::Text(text)) if text.is_empty() => {
            Err(schema("a value with a length of at least 1".into()))
        }
        (Check::PairingUrl, Parsed::Text(text)) => {
            pairing_url(text).map(Parsed::Text).map_err(|expected| invalid(raw, expected))
        }
        _ => Ok(parsed),
    }
}

fn parsed_text(parsed: &Parsed) -> String {
    match parsed {
        Parsed::Text(text) => text.clone(),
        Parsed::Bool(value) => value.to_string(),
        Parsed::Int(value) => value.to_string(),
        Parsed::Pair(key, value) => format!("{key}={value}"),
    }
}

pub fn parse_bool(text: &str) -> Option<bool> {
    match text {
        "true" | "yes" | "on" | "1" | "y" => Some(true),
        "false" | "no" | "off" | "0" | "n" => Some(false),
        _ => None,
    }
}

/// `Schema.Int` from a string: a decimal number (`[+-]?(\d+(\.\d+)?|\.\d+)([Ee][+-]?\d+)?`) that is a safe integer.
fn parse_int(text: &str) -> Result<i64, &'static str> {
    let unsigned = text.strip_prefix(['+', '-']).unwrap_or(text);
    let (mantissa, exponent) = match unsigned.split_once(['e', 'E']) {
        Some((mantissa, exponent)) => (mantissa, Some(exponent)),
        None => (unsigned, None),
    };
    let mantissa = match mantissa.split_once('.') {
        Some((int, frac)) => digits(frac, false) && digits(int, true),
        None => digits(mantissa, false),
    };
    let exponent = exponent.is_none_or(|exponent| digits(exponent.strip_prefix(['+', '-']).unwrap_or(exponent), false));
    if !mantissa || !exponent {
        return Err("Expected a string representing a finite number");
    }
    let number: f64 = text.parse().map_err(|_| "Expected a string representing a finite number")?;
    const SAFE: f64 = 9_007_199_254_740_991.0;
    match number.is_finite() && number.fract() == 0.0 && number.abs() <= SAFE {
        true => Ok(number as i64),
        false => Err("Expected an integer"),
    }
}

// commands.ts: an HTTP(S) URL without credentials, query, or fragment, without trailing slashes.
fn pairing_url(value: &str) -> Result<String, &'static str> {
    let error = "Expected an HTTP(S) server URL without credentials, query parameters, or a fragment";
    let url = url::Url::parse(value).map_err(|_| error)?;
    let plain = matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none();
    if !plain {
        return Err(error);
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

/// `CliError.InvalidValue`'s message.
pub fn invalid_value(what: &str, option: &str, value: &str, expected: &str) -> String {
    let expectation = match expected.starts_with("Expected ") || expected.starts_with("Expected:") {
        true => expected.to_string(),
        false => format!("Expected: {expected}"),
    };
    match (what, value.is_empty()) {
        ("argument", _) => format!("Invalid value for argument <{option}>: \"{value}\". {expectation}"),
        (_, true) => format!("Missing value for flag --{option}. {expectation}"),
        _ => format!("Invalid value for flag --{option}: \"{value}\". {expectation}"),
    }
}

fn at_least(min: usize) -> String {
    format!("at least {min} value{}", plural(min))
}

fn plural(count: usize) -> &'static str {
    if count == 1 { "" } else { "s" }
}

fn unrecognized_flag(token: &Token, flags: &[&Flag], command: &[String]) -> String {
    let printable = match token {
        Token::Long { name, .. } => format!("--{name}"),
        _ => format!("-{}", token.flag_name().unwrap_or_default()),
    };
    let names: Vec<String> = flags
        .iter()
        .filter(|flag| !flag.hidden)
        .flat_map(|flag| {
            std::iter::once(flag.name.to_string())
                .chain(flag.negation())
                .chain(flag.aliases.iter().map(|alias| alias.to_string()))
        })
        .collect();
    let candidates: Vec<&str> = names.iter().map(String::as_str).collect();
    let suggestions: Vec<String> = suggest(token.flag_name().unwrap_or_default(), &candidates)
        .into_iter()
        .map(|name| match name.chars().count() {
            1 => format!("-{name}"),
            _ => format!("--{name}"),
        })
        .collect();
    unrecognized(&printable, command, &suggestions)
}

fn unrecognized(option: &str, command: &[String], suggestions: &[String]) -> String {
    format!("Unrecognized flag: {option} in command {}{}", command.join(" "), did_you_mean(suggestions))
}

fn unknown_subcommand(name: &str, parent: &[String], suggestions: &[&str]) -> String {
    let suggestions: Vec<String> = suggestions.iter().map(|name| name.to_string()).collect();
    format!("Unknown subcommand \"{name}\" for \"{}\"{}", parent.join(" "), did_you_mean(&suggestions))
}

fn did_you_mean(suggestions: &[String]) -> String {
    match suggestions.is_empty() {
        true => String::new(),
        false => format!("\n\n  Did you mean this?\n    {}", suggestions.join("\n    ")),
    }
}

/// `auto-suggest.ts`: the candidates at the smallest edit distance, at most 2.
fn suggest<'a>(input: &str, candidates: &[&'a str]) -> Vec<&'a str> {
    let mut scored: Vec<(usize, &str)> = candidates
        .iter()
        .map(|candidate| (levenshtein(input, candidate), *candidate))
        .filter(|(distance, _)| *distance <= 2)
        .collect();
    scored.sort_by_key(|(distance, _)| *distance);
    let best = scored.first().map(|(distance, _)| *distance);
    scored.into_iter().filter(|(distance, _)| Some(*distance) == best).map(|(_, candidate)| candidate).collect()
}

fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<u16> = a.encode_utf16().collect();
    let b: Vec<u16> = b.encode_utf16().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut previous = row[0];
        row[0] = i;
        for j in 1..=b.len() {
            let current = row[j];
            row[j] = (row[j] + 1).min(row[j - 1] + 1).min(previous + usize::from(a[i - 1] != b[j - 1]));
            previous = current;
        }
    }
    row[b.len()]
}

fn json(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_default()
}

/// Checks one value the wizard asked for against `param`, as Effect parses each param after its prompts. Returns
/// Effect's error message.
pub fn check(param: &'static Param, values: &[String]) -> Result<(), String> {
    match param {
        Param::Flag(flag) => {
            let flags = FlagMap::from([(flag.name, values.to_vec())]);
            flag_value(flag, &flags, &mut Values::default())
        }
        Param::Arg(arg) => argument_value(arg, values, &mut Values::default()).map(drop),
    }
}
