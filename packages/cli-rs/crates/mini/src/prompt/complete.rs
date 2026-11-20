//! Slash completion combines built-ins and server commands. Mentions list agents, files and references; files keep
//! the server's ranking.

use opencode_api::js::locale_compare;
use opencode_ui::fuzzy;
use opencode_ui::path::Flavor;
use opencode_ui::prompt_input::parse::{self, LineRange};
use unicode_width::UnicodeWidthStr;

use super::menu::Item;
use super::parts::{EXIT_COMMANDS, File, Part};

#[derive(Clone, Debug, PartialEq)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub mode: String,
    pub hidden: bool,
    pub description: Option<String>,
    /// The configured color, a hex string.
    pub color: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Reference {
    pub name: String,
    pub path: String,
    /// The description, else the git repository or the path it came from.
    pub description: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Command {
    pub name: String,
    pub description: Option<String>,
    pub source: Option<String>,
}

/// What the footer completes from (`catalog` event).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Catalog {
    pub agents: Vec<Agent>,
    pub references: Vec<Reference>,
    /// `None` until the command list arrives: a slash command then waits ("loading commands").
    pub commands: Option<Vec<Command>>,
}

/// A slash built-in that is not sent as typed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Editor,
    Settings,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Choice {
    Mention { display: String, value: String, description: Option<String>, part: Part, directory: bool },
    Slash { name: String, display: String, description: Option<String>, action: Option<Action> },
}

impl Choice {
    pub fn item(&self) -> Item {
        let (display, description) = match self {
            Choice::Mention { display, description, .. } | Choice::Slash { display, description, .. } => {
                (display, description)
            }
        };
        Item { display: display.clone(), description: description.clone() }
    }

    fn keys(&self) -> [Option<&str>; 3] {
        match self {
            Choice::Mention { display, value, description, .. } => {
                [Some(value.trim_end()), Some(display), description.as_deref()]
            }
            Choice::Slash { name, display, description, .. } => {
                [Some(name.trim_end()), Some(display), description.as_deref()]
            }
        }
    }
}

/// The slash options: the server's commands, then the built-ins, sorted by what they show.
pub fn slash(catalog: &Catalog) -> Vec<Choice> {
    let builtin = |name: &str, description: &str, action: Option<Action>| Choice::Slash {
        name: name.to_owned(),
        display: format!("/{name}"),
        description: Some(description.to_owned()),
        action,
    };
    let mut builtins = vec![
        builtin("editor", "compose in your external editor", Some(Action::Editor)),
        builtin("settings", "configure Mini transcript output", Some(Action::Settings)),
        builtin("new", "start a new session", None),
        builtin("compact", "compact older session context to free space", None),
    ];
    builtins.extend(EXIT_COMMANDS.iter().map(|name| builtin(name, "close OpenCode", None)));
    let hidden =
        |name: &str| builtins.iter().any(|item| matches!(item, Choice::Slash { name: other, .. } if other == name));
    let mut all: Vec<Choice> = catalog
        .commands
        .iter()
        .flatten()
        .filter(|command| !hidden(&command.name))
        .map(|command| Choice::Slash {
            name: command.name.clone(),
            display: format!("/{}{}", command.name, if command.source.as_deref() == Some("mcp") { ":mcp" } else { "" }),
            description: command.description.clone(),
            action: None,
        })
        .collect();
    all.extend(builtins);
    all.sort_by(|a, b| locale_compare(&a.item().display, &b.item().display));
    all
}

/// The subagents a mention offers: visible agents that are not primary.
pub fn agents(catalog: &Catalog) -> Vec<Choice> {
    catalog
        .agents
        .iter()
        .filter(|agent| !agent.hidden && agent.mode != "primary")
        .map(|agent| Choice::Mention {
            display: format!("@{}", agent.name),
            value: agent.id.clone(),
            description: None,
            part: Part::Agent { name: agent.id.clone(), mention: None },
            directory: false,
        })
        .collect()
}

pub fn references(catalog: &Catalog) -> Vec<Choice> {
    catalog
        .references
        .iter()
        .map(|reference| Choice::Mention {
            display: format!("@{}", reference.name),
            value: reference.name.clone(),
            description: Some(reference.description.clone()),
            part: Part::File(File {
                url: parse::file_url(Flavor::NATIVE, &reference.path),
                mime: Some("application/x-directory".into()),
                filename: Some(reference.name.clone()),
                ..File::default()
            }),
            directory: false,
        })
        .collect()
}

/// The file search's results for a query with an optional `#12-20` range, shown by their shortest path suffix
/// that fits `width`.
pub fn files(results: &[String], range: Option<LineRange>, directory: &str, width: usize) -> Vec<Choice> {
    results
        .iter()
        .map(|item| {
            let is_directory = item.ends_with('/');
            let mut url = parse::file_url(Flavor::NATIVE, &parse::resolve(Flavor::NATIVE, directory, item));
            let mut filename = item.clone();
            if let Some(range) = range.filter(|_| !is_directory) {
                filename = match range.end {
                    Some(end) => format!("{item}#{}-{end}", range.start),
                    None => format!("{item}#{}", range.start),
                };
                url.push_str(&format!("?start={}", range.start));
                if let Some(end) = range.end {
                    url.push_str(&format!("&end={end}"));
                }
            }
            let segments: Vec<&str> = filename.split('/').collect();
            let shown = if is_directory { segments.len() - 1 } else { segments.len() };
            let paths: Vec<String> = (0..shown).map(|index| format!("@{}", segments[index..].join("/"))).collect();
            let display = paths
                .iter()
                .find(|path| path.width() <= width)
                .or(paths.last())
                .cloned()
                .unwrap_or_else(|| format!("@{filename}"));
            Choice::Mention {
                display,
                value: filename.clone(),
                description: None,
                part: Part::File(File {
                    url,
                    mime: Some(if is_directory { "application/x-directory" } else { "text/plain" }.into()),
                    filename: Some(filename),
                    ..File::default()
                }),
                directory: is_directory,
            }
        })
        .collect()
}

/// The options for `query` (`options` memo): everything without a query; with one, fuzzysort over agents and
/// references around the unfiltered files, or over every slash option.
pub fn filter(slash_mode: bool, query: &str, catalog: &Catalog, files: Vec<Choice>) -> Vec<Choice> {
    if slash_mode {
        let all = slash(catalog);
        if query.is_empty() {
            return all;
        }
        return go(parse::file_line_range(query).0, all);
    }
    let (agents, references) = (agents(catalog), references(catalog));
    if query.is_empty() {
        return agents.into_iter().chain(files).chain(references).collect();
    }
    let search = parse::file_line_range(query).0;
    go(search, agents).into_iter().chain(files).chain(go(search, references)).collect()
}

/// `fuzzysort.go(search, items, { keys })`: best first, every match.
fn go(search: &str, items: Vec<Choice>) -> Vec<Choice> {
    fuzzy::go_scored(search, &items, Choice::keys, |_, score, _| score, 0.0, usize::MAX)
        .into_iter()
        .map(|index| items[index].clone())
        .collect()
}
