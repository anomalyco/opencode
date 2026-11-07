//! `--completions`: Effect CLI's static completion scripts (`effect/src/cli/internal/completions/*.ts`) for the
//! command table. The scripts never run the binary again.

use crate::args::{Arg, Flag, Kind, ROOT, Shell, Spec};

/// `Completions.CommandDescriptor`: a command with its visible flags, its arguments, and its subcommands, each
/// alias as a copy under the alias's name.
struct Command {
    name: String,
    description: &'static str,
    flags: Vec<&'static Flag>,
    arguments: Vec<&'static Arg>,
    subcommands: Vec<Command>,
}

fn descriptor(spec: &'static Spec, name: &str) -> Command {
    let subcommands = spec
        .commands
        .iter()
        .flat_map(|sub| std::iter::once(sub.name).chain(sub.alias).map(move |name| descriptor(sub, name)))
        .collect();
    Command {
        name: name.to_string(),
        description: spec.description,
        flags: spec.flags().filter(|flag| !flag.hidden).collect(),
        arguments: spec.arguments().collect(),
        subcommands,
    }
}

pub fn generate(shell: Shell, program: &str) -> String {
    let root = descriptor(&ROOT, program);
    match shell {
        Shell::Bash | Shell::Sh => bash(program, &root),
        Shell::Zsh => zsh(program, &root),
        Shell::Fish => fish(program, &root),
        Shell::Powershell | Shell::Pwsh => powershell(program, &root),
    }
}

fn takes_separate_value(flag: &Flag) -> bool {
    !flag.is_boolean() && flag.optional_value.is_none()
}

fn sanitize(text: &str) -> String {
    text.chars().map(|char| if char.is_ascii_alphanumeric() || char == '_' { char } else { '_' }).collect()
}

fn dash(alias: &str) -> String {
    match alias.chars().count() {
        1 => format!("-{alias}"),
        _ => format!("--{alias}"),
    }
}

/// `--name`, the aliases, and the negation.
fn forms(flag: &Flag) -> Vec<String> {
    std::iter::once(format!("--{}", flag.name))
        .chain(flag.aliases.iter().map(|alias| dash(alias)))
        .chain(flag.negation().map(|negation| format!("--{negation}")))
        .collect()
}

/// Escapes every character outside `[A-Za-z0-9_.,/@%+-]` with a backslash.
fn escape_choice(text: &str) -> String {
    text.chars()
        .map(|char| match char.is_ascii_alphanumeric() || "_.,/@%+-".contains(char) {
            true => char.to_string(),
            false => format!("\\{char}"),
        })
        .collect()
}

fn bash(program: &str, root: &Command) -> String {
    let escape = |text: &str| text.replace('\'', "'\\''");
    let safe = sanitize(program);
    let choices = format!("_{safe}--choices");
    let mut lines: Vec<String> = [
        format!("###-begin-{}-completions-###", escape(program)),
        "#".into(),
        "# Static completion script for Bash".into(),
        "#".into(),
        "# Installation:".into(),
        format!("#   {} --completions bash >> ~/.bashrc", escape(program)),
        "#".into(),
        String::new(),
    ]
    .into();
    lines.extend(include_str!("completions/bash.sh").replace("@NAME@", &safe).split('\n').map(String::from));
    bash_function(root, &[], &mut lines, &choices, &escape);
    lines.push(format!("complete -F _{safe} {}", escape(program)));
    lines.push(format!("###-end-{}-completions-###", escape(program)));
    lines.join("\n")
}

fn bash_completion(kind: Kind, choices: &str, escape: &dyn Fn(&str) -> String) -> Option<String> {
    match kind {
        Kind::Choice(values) => {
            let values: Vec<String> = values.iter().map(|value| format!("'{}'", escape(value))).collect();
            Some(format!("{choices} \"$cur\" \"$_comp_word\" {}", values.join(" ")))
        }
        _ => None,
    }
}

fn bash_function(
    command: &Command,
    parent: &[String],
    lines: &mut Vec<String>,
    choices: &str,
    escape: &dyn Fn(&str) -> String,
) {
    let path: Vec<String> = parent.iter().cloned().chain([command.name.clone()]).collect();
    let function =
        |path: &[String]| format!("_{}", path.iter().map(|name| sanitize(name)).collect::<Vec<_>>().join("_"));
    lines.push(format!("{}()", function(&path)));
    lines.push("{".into());
    lines.push("  local cur prev words cword i".into());
    lines.push(match parent.is_empty() {
        true => "  local _command_index=0".into(),
        false => "  local _command_index=\"$1\"".into(),
    });
    lines.push("  _init_completion -n \"$COMP_WORDBREAKS\" || return".into());
    if parent.is_empty() {
        lines.push("  local _comp_word=\"$2\"".into());
    }
    lines.push(String::new());

    let valued: Vec<&&Flag> = command.flags.iter().filter(|flag| takes_separate_value(flag)).collect();
    if !valued.is_empty() {
        lines.push("  # Flag value completions".into());
        lines.push("  case \"$prev\" in".into());
        for flag in &valued {
            if let Some(completion) = bash_completion(flag.kind, choices, escape) {
                let names: Vec<String> = std::iter::once(format!("--{}", flag.name))
                    .chain(flag.aliases.iter().map(|alias| dash(alias)))
                    .collect();
                lines.push(format!("    {})", names.join("|")));
                lines.push(format!("      {completion}"));
                lines.push("      return".into());
                lines.push("      ;;".into());
            }
        }
        lines.push("  esac".into());
        lines.push(String::new());
    }

    let value_cases = |lines: &mut Vec<String>, flag: &Flag| {
        let forms = forms(flag);
        lines.push(format!("      {}) _skip_next=1 ;;", forms.join("|")));
        lines.push(format!("      {}) ;;", forms.iter().map(|form| format!("{form}=*")).collect::<Vec<_>>().join("|")));
    };
    if !command.subcommands.is_empty() {
        lines.extend(
            [
                "  # Subcommand dispatch",
                "  local cmd _skip_next=0",
                "  for ((i = _command_index + 1; i < cword; i++)); do",
                "    if (( _skip_next )); then",
                "      _skip_next=0",
                "      continue",
                "    fi",
                "    case \"${words[i]}\" in",
            ]
            .map(String::from),
        );
        for flag in &valued {
            value_cases(lines, flag);
        }
        for sub in &command.subcommands {
            let sub_path: Vec<String> = path.iter().cloned().chain([sub.name.clone()]).collect();
            lines.push(format!("      {})", sub.name));
            lines.push(format!("        {} \"$i\"", function(&sub_path)));
            lines.push("        return".into());
            lines.push("        ;;".into());
        }
        lines.extend(["    esac", "  done", ""].map(String::from));
    }

    if !command.flags.is_empty() {
        let groups: Vec<Vec<String>> = command.flags.iter().map(|flag| forms(flag)).collect();
        let used: Vec<String> = (0..groups.len()).map(|index| format!("_used_{index}=\"\"")).collect();
        lines.push(format!("  local {}", used.join(" ")));
        lines.push("  for ((i = 1; i < cword; i++)); do".into());
        lines.push("    case \"${words[i]%%=*}\" in".into());
        for (index, forms) in groups.iter().enumerate() {
            lines.push(format!("      {}) _used_{index}=1 ;;", forms.join("|")));
        }
        lines.extend(["    esac", "  done", "  local _filtered_flags=\"\""].map(String::from));
        for (index, forms) in groups.iter().enumerate() {
            lines.push(format!("  [[ -n \"$_used_{index}\" ]] || _filtered_flags+=\" {}\"", forms.join(" ")));
        }
        lines.push(String::new());
    }

    if !command.flags.is_empty() || !command.subcommands.is_empty() {
        lines.push("  # Complete flags (filtered) and subcommands".into());
        lines.push("  if [[ \"$cur\" == -* ]]; then".into());
        if !command.flags.is_empty() {
            lines.push("    COMPREPLY=( $(compgen -W \"$_filtered_flags\" -- \"$cur\") )".into());
        }
        lines.extend(["    return", "  fi", ""].map(String::from));
    }

    let completed: Vec<(usize, &Arg, String)> = command
        .arguments
        .iter()
        .enumerate()
        .filter_map(|(index, arg)| {
            bash_completion(arg.kind, choices, escape).map(|completion| (index, *arg, completion))
        })
        .collect();
    if !completed.is_empty() {
        lines.extend(
            [
                "  # Positional argument completions",
                "  local _position=0 _skip_next=0 _end_of_options=0",
                "  for ((i = _command_index + 1; i < cword; i++)); do",
                "    if (( _skip_next )); then",
                "      _skip_next=0",
                "      continue",
                "    fi",
                "    if (( _end_of_options )); then",
                "      ((_position += 1))",
                "      continue",
                "    fi",
                "    case \"${words[i]}\" in",
                "      --) _end_of_options=1 ;;",
            ]
            .map(String::from),
        );
        for flag in &command.flags {
            match takes_separate_value(flag) {
                true => value_cases(lines, flag),
                false => lines.push(format!("      {}) ;;", forms(flag).join("|"))),
            }
        }
        lines.extend(
            ["      -*) ;;", "      *) ((_position += 1)) ;;", "    esac", "  done", "  case \"$_position\" in"]
                .map(String::from),
        );
        for (index, arg, completion) in &completed {
            if arg.is_variadic() {
                continue;
            }
            lines.extend([
                format!("    {index})"),
                format!("      {completion}"),
                "      return".into(),
                "      ;;".into(),
            ]);
        }
        lines.push("  esac".into());
        if let Some((index, _, completion)) = completed.iter().find(|(_, arg, _)| arg.is_variadic()) {
            lines.extend([
                format!("  if (( _position >= {index} )); then"),
                format!("    {completion}"),
                "    return".into(),
                "  fi".into(),
            ]);
        }
    } else if !command.subcommands.is_empty() {
        let names: Vec<&str> = command.subcommands.iter().map(|sub| sub.name.as_str()).collect();
        lines.push(format!("  COMPREPLY=( $(compgen -W '{}' -- \"$cur\") )", names.join(" ")));
    }
    lines.push("}".into());
    lines.push(String::new());
    for sub in &command.subcommands {
        bash_function(sub, &path, lines, choices, escape);
    }
}

fn zsh(program: &str, root: &Command) -> String {
    let safe = sanitize(program);
    let mut lines: Vec<String> = [
        format!("#compdef {program}"),
        format!("###-begin-{program}-completions-###"),
        "#".into(),
        "# Static completion script for Zsh".into(),
        "#".into(),
        "# Installation:".into(),
        format!("#   {program} --completions zsh > ~/.zsh/completions/_{program}"),
        "#   then add ~/.zsh/completions to your fpath".into(),
        "#".into(),
        String::new(),
    ]
    .into();
    zsh_function(root, &[], &mut lines);
    lines.extend([
        "# Handle both direct invocation and autoload".into(),
        "if [[ \"${zsh_eval_context[-1]}\" == \"loadautofunc\" ]]; then".into(),
        format!("  _{safe} \"$@\""),
        "else".into(),
        format!("  compdef _{safe} {program}"),
        "fi".into(),
        format!("###-end-{program}-completions-###"),
    ]);
    lines.join("\n")
}

fn escape_zsh(text: &str) -> String {
    text.replace('\\', "\\\\").replace('\'', "'\\''").replace(':', "\\:")
}

fn zsh_choices(values: &[&str]) -> String {
    values.iter().map(|value| escape_choice(value).replace('\'', "'\\''")).collect::<Vec<_>>().join(" ")
}

fn zsh_flag_specs(flag: &Flag) -> Vec<String> {
    let description = match flag.description {
        "" => String::new(),
        description => format!("[{}]", escape_zsh(description).replace(']', "\\]")),
    };
    let value = match flag.kind {
        Kind::Boolean => String::new(),
        Kind::Choice(values) => format!(":value:({})", zsh_choices(values)),
        Kind::Int => ":integer:".into(),
        _ => ":value:".into(),
    };
    let optional = flag.optional_value.is_some() && !flag.is_boolean();
    let suffix = if optional { "=-" } else { "" };
    let action = if optional { format!(":{value}") } else { value };
    let exclusive = format!("({})", forms(flag).join(" "));
    let mut specs = vec![format!("'{exclusive}--{}{suffix}{description}{action}'", flag.name)];
    for alias in flag.aliases {
        specs.push(format!("'{exclusive}{}{suffix}{description}{action}'", dash(alias)));
    }
    if let Some(negation) = flag.negation() {
        let description = match flag.description {
            "" => String::new(),
            _ => format!("[{}]", escape_zsh(&format!("Disable {}", flag.name)).replace(']', "\\]")),
        };
        specs.push(format!("'{exclusive}--{negation}{description}'"));
    }
    specs
}

fn zsh_arg_spec(arg: &Arg) -> String {
    let description = match arg.description {
        "" => arg.name.to_string(),
        description => escape_zsh(description),
    };
    let action = match arg.kind {
        Kind::Choice(values) => format!("({})", zsh_choices(values)),
        _ => String::new(),
    };
    let prefix = if arg.is_variadic() { "*" } else { "" };
    format!("'{prefix}:{description}:{action}'")
}

fn zsh_function(command: &Command, parent: &[String], lines: &mut Vec<String>) {
    let path: Vec<String> = parent.iter().cloned().chain([command.name.clone()]).collect();
    let function =
        |path: &[String]| format!("_{}", path.iter().map(|name| sanitize(name)).collect::<Vec<_>>().join("_"));
    lines.push(format!("{}() {{", function(&path)));
    if !command.subcommands.is_empty() {
        lines.extend(
            [
                "  local context state state_descr line",
                "  typeset -A opt_args",
                "",
                "  local -a commands",
                "  commands=(",
            ]
            .map(String::from),
        );
        for sub in &command.subcommands {
            lines.push(format!("    '{}:{}'", sub.name, escape_zsh(sub.description)));
        }
        lines.extend(["  )", "", "  local -a specs", "  specs=("].map(String::from));
        for flag in &command.flags {
            lines.extend(zsh_flag_specs(flag).into_iter().map(|spec| format!("    {spec}")));
        }
        if !command.arguments.is_empty() {
            lines.extend(["    -", "    parent-arguments"].map(String::from));
            lines.extend(command.arguments.iter().map(|arg| format!("    {}", zsh_arg_spec(arg))));
            lines.extend(["    -", "    subcommands"].map(String::from));
        }
        lines.extend(
            [
                "    '1:command:->command'",
                "    '*::arg:->args'",
                "  )",
                "",
                "  _arguments -C \"${specs[@]}\"",
                "",
                "  case \"$state\" in",
                "    command)",
                "      _describe -t commands 'commands' commands",
                "      ;;",
                "    args)",
                "      case \"$words[1]\" in",
            ]
            .map(String::from),
        );
        for sub in &command.subcommands {
            let sub_path: Vec<String> = path.iter().cloned().chain([sub.name.clone()]).collect();
            lines.extend([
                format!("        {})", sub.name),
                format!("          {}", function(&sub_path)),
                "          ;;".into(),
            ]);
        }
        lines.extend(["      esac", "      ;;", "  esac"].map(String::from));
    } else {
        let specs: Vec<String> = command
            .flags
            .iter()
            .flat_map(|flag| zsh_flag_specs(flag))
            .chain(command.arguments.iter().map(|arg| zsh_arg_spec(arg)))
            .collect();
        if !specs.is_empty() {
            lines.extend(["  local -a specs", "  specs=("].map(String::from));
            lines.extend(specs.iter().map(|spec| format!("    {spec}")));
            lines.extend(["  )", "  _arguments \"${specs[@]}\""].map(String::from));
        }
    }
    lines.push("}".into());
    lines.push(String::new());
    for sub in &command.subcommands {
        zsh_function(sub, &path, lines);
    }
}

fn fish(program: &str, root: &Command) -> String {
    let mut lines: Vec<String> = [
        format!("###-begin-{program}-completions-###"),
        "#".into(),
        "# Static completion script for Fish".into(),
        "#".into(),
        "# Installation:".into(),
        format!("#   {program} --completions fish > ~/.config/fish/completions/{program}.fish"),
        "#".into(),
        String::new(),
    ]
    .into();
    fish_completions(program, root, &[], &mut lines);
    lines.push(String::new());
    lines.push(format!("###-end-{program}-completions-###"));
    lines.join("\n")
}

fn escape_fish(text: &str) -> String {
    text.replace('\\', "\\\\").replace('\'', "\\'")
}

/// `not __fish_contains_opt` with every form of the flag.
fn fish_unused(flag: &Flag) -> String {
    let short = flag.aliases.iter().filter(|alias| alias.chars().count() == 1).map(|alias| format!("-s {alias}"));
    let long = std::iter::once(flag.name.to_string())
        .chain(flag.aliases.iter().filter(|alias| alias.chars().count() > 1).map(|alias| alias.to_string()))
        .chain(flag.negation());
    format!("not __fish_contains_opt {}", short.chain(long).collect::<Vec<_>>().join(" "))
}

fn fish_completions(program: &str, command: &Command, parent: &[String], lines: &mut Vec<String>) {
    let children: Vec<&str> = command.subcommands.iter().map(|sub| sub.name.as_str()).collect();
    let condition = match (parent.is_empty(), children.is_empty()) {
        (true, true) => String::new(),
        (true, false) => "__fish_use_subcommand".into(),
        (false, empty) => {
            let seen = parent
                .iter()
                .map(|name| format!("__fish_seen_subcommand_from {name}"))
                .collect::<Vec<_>>()
                .join("; and ");
            match empty {
                true => seen,
                false => format!("{seen}; and not __fish_seen_subcommand_from {}", children.join(" ")),
            }
        }
    };
    let start = || {
        let mut parts = vec![format!("complete -c {program}")];
        if !condition.is_empty() {
            parts.push(format!("-n '{condition}'"));
        }
        parts
    };
    lines.push([start(), vec!["-f".into()]].concat().join(" "));
    for sub in &command.subcommands {
        let mut parts = start();
        parts.push(format!("-f -a '{}'", escape_fish(&sub.name)));
        if !sub.description.is_empty() {
            parts.push(format!("-d '{}'", escape_fish(sub.description)));
        }
        lines.push(parts.join(" "));
    }
    let disable = |flag: &Flag| format!("-d '{}'", escape_fish(&format!("Disable {}", flag.name)));
    for flag in &command.flags {
        let unused = match takes_separate_value(flag) {
            true => {
                let forms: Vec<String> = std::iter::once(format!("--{}", flag.name))
                    .chain(flag.aliases.iter().map(|alias| dash(alias)))
                    .collect();
                format!("begin; {}; or contains -- (commandline -poc)[-1] {}; end", fish_unused(flag), forms.join(" "))
            }
            false => fish_unused(flag),
        };
        let flag_condition = match condition.is_empty() {
            true => unused,
            false => format!("{condition}; and {unused}"),
        };
        let mut parts =
            vec![format!("complete -c {program}"), format!("-n '{flag_condition}'"), format!("-l {}", flag.name)];
        for alias in flag.aliases {
            parts.push(match alias.chars().count() {
                1 => format!("-s {alias}"),
                _ => format!("-l {alias}"),
            });
        }
        if !flag.description.is_empty() {
            parts.push(format!("-d '{}'", escape_fish(flag.description)));
        }
        if takes_separate_value(flag) {
            parts.push(match flag.kind {
                Kind::Choice(values) => format!("-r -f -a '{}'", fish_choices(values)),
                _ => "-r -f".into(),
            });
        }
        lines.push(parts.join(" "));
        if let Some(negation) = flag.negation() {
            let mut parts =
                vec![format!("complete -c {program}"), format!("-n '{flag_condition}'"), format!("-l {negation}")];
            if !flag.description.is_empty() {
                parts.push(disable(flag));
            }
            lines.push(parts.join(" "));
        }
    }
    if !command.flags.is_empty() {
        let not_dash = "not string match -q -- \"-*\" (commandline -ct)";
        let base = match condition.is_empty() {
            true => not_dash.to_string(),
            false => format!("{condition}; and {not_dash}"),
        };
        for flag in &command.flags {
            let bare = format!("{base}; and {}", fish_unused(flag));
            let mut parts =
                vec![format!("complete -c {program}"), format!("-n '{bare}'"), format!("-f -a '--{}'", flag.name)];
            if !flag.description.is_empty() {
                parts.push(format!("-d '{}'", escape_fish(flag.description)));
            }
            lines.push(parts.join(" "));
            if let Some(negation) = flag.negation() {
                let mut parts =
                    vec![format!("complete -c {program}"), format!("-n '{bare}'"), format!("-f -a '--{negation}'")];
                if !flag.description.is_empty() {
                    parts.push(disable(flag));
                }
                lines.push(parts.join(" "));
            }
        }
    }
    for arg in &command.arguments {
        if let Kind::Choice(values) = arg.kind {
            let mut parts = start();
            parts.push(format!("-r -f -a '{}'", fish_choices(values)));
            if !arg.description.is_empty() {
                parts.push(format!("-d '{}'", escape_fish(arg.description)));
            }
            lines.push(parts.join(" "));
        }
    }
    for sub in &command.subcommands {
        let path: Vec<String> = parent.iter().cloned().chain([sub.name.clone()]).collect();
        fish_completions(program, sub, &path, lines);
    }
}

fn fish_choices(values: &[&str]) -> String {
    values.iter().map(|value| escape_fish(&escape_choice(value))).collect::<Vec<_>>().join(" ")
}

fn powershell(program: &str, root: &Command) -> String {
    let data = format!("$global:_{}_Completions", sanitize(program));
    let mut lines: Vec<String> = [
        format!("###-begin-{program}-completions-###"),
        "#".into(),
        "# Static completion script for PowerShell".into(),
        "#".into(),
        "# Installation:".into(),
        format!("#   {program} --completions powershell > {program}-completion.ps1"),
        "#   then add this line to your $PROFILE (use the full path to the file):".into(),
        format!("#   . <PATH>\\{program}-completion.ps1"),
        "#".into(),
        String::new(),
        format!("{data} = [hashtable]::new([System.StringComparer]::Ordinal)"),
    ]
    .into();
    powershell_contexts(&data, root, &[], &mut lines, &mut Vec::new());
    lines.push(String::new());
    lines.push(format!("Register-ArgumentCompleter -Native -CommandName {} -ScriptBlock {{", quote_ps(program)));
    lines.push(include_str!("completions/powershell.ps1").replace("@DATA@", &data));
    lines.extend(["}".into(), String::new(), format!("###-end-{program}-completions-###")]);
    lines.join("\n")
}

/// A PowerShell string literal; characters outside printable ASCII become `[char]` code units, since Windows
/// PowerShell 5.1 may read the script as ANSI.
fn quote_ps(text: &str) -> String {
    let mut parts = Vec::new();
    let mut literal = String::new();
    for unit in text.encode_utf16() {
        if (0x20..0x80).contains(&unit) {
            match unit == u16::from(b'\'') {
                true => literal.push_str("''"),
                false => literal.push(char::from(unit as u8)),
            }
            continue;
        }
        if !literal.is_empty() || parts.is_empty() {
            parts.push(format!("'{literal}'"));
        }
        literal.clear();
        parts.push(format!("[char]0x{unit:04X}"));
    }
    if !literal.is_empty() || parts.is_empty() {
        parts.push(format!("'{literal}'"));
    }
    match parts.len() {
        1 => parts.remove(0),
        _ => format!("({})", parts.join(" + ")),
    }
}

fn ps_array(items: &[String]) -> String {
    format!("@({})", items.iter().map(|item| quote_ps(item)).collect::<Vec<_>>().join(", "))
}

fn ps_optional(text: &str) -> String {
    match text {
        "" => "$null".into(),
        text => quote_ps(text),
    }
}

fn ps_values(kind: Kind) -> String {
    let values: Vec<String> = match kind {
        Kind::Choice(values) => values.iter().map(|value| value.to_string()).collect(),
        _ => Vec::new(),
    };
    format!("values = {}; pathType = $null", ps_array(&values))
}

fn ps_list(lines: &mut Vec<String>, field: &str, entries: Vec<String>) {
    if entries.is_empty() {
        lines.push(format!("  {field} = @()"));
        return;
    }
    lines.push(format!("  {field} = @("));
    lines.extend(entries.into_iter().map(|entry| format!("    {entry}")));
    lines.push("  )".into());
}

fn powershell_contexts(
    data: &str,
    command: &Command,
    path: &[String],
    lines: &mut Vec<String>,
    seen: &mut Vec<String>,
) {
    let key = path.join(" ");
    if seen.contains(&key) {
        return;
    }
    seen.push(key.clone());
    lines.push(format!("{data}[{}] = @{{", quote_ps(&key)));
    let subcommands = command
        .subcommands
        .iter()
        .map(|sub| format!("@{{ name = {}; description = {} }}", quote_ps(&sub.name), ps_optional(sub.description)))
        .collect();
    ps_list(lines, "subcommands", subcommands);
    let flags = command
        .flags
        .iter()
        .map(|flag| {
            let forms: Vec<String> = std::iter::once(format!("--{}", flag.name))
                .chain(flag.aliases.iter().map(|alias| dash(alias)))
                .collect();
            let negation =
                flag.negation().map(|negation| format!("negation = {}; ", quote_ps(&format!("--{negation}"))));
            format!(
                "@{{ name = {}; forms = {}; takesValue = ${}; {}{}{}; description = {} }}",
                quote_ps(flag.name),
                ps_array(&forms),
                !flag.is_boolean(),
                negation.unwrap_or_default(),
                if flag.optional_value.is_some() { "optionalValue = $true; " } else { "" },
                ps_values(flag.kind),
                ps_optional(flag.description),
            )
        })
        .collect();
    ps_list(lines, "flags", flags);
    let arguments = command
        .arguments
        .iter()
        .map(|arg| {
            format!(
                "@{{ name = {}; variadic = ${}; {}; description = {} }}",
                quote_ps(arg.name),
                arg.is_variadic(),
                ps_values(arg.kind),
                ps_optional(arg.description),
            )
        })
        .collect();
    ps_list(lines, "arguments", arguments);
    lines.push("}".into());
    for sub in &command.subcommands {
        let path: Vec<String> = path.iter().cloned().chain([sub.name.clone()]).collect();
        powershell_contexts(data, sub, &path, lines, seen);
    }
}
