//! What the footer prompt submits (`RunPrompt`, `RunPromptPart` in `mini/types.ts`), how a submitted prompt goes
//! on the wire (`promptFiles`, `promptAgents`, `promptSkills` in `stream-v2.transport.ts`), and how a listed user
//! message becomes a prompt again for history (`messagePrompt` in `session.shared.ts`).

use opencode_ui::prompt_input::editor::Mention;
use serde_json::{Map, Value, json};

/// `RunDelivery`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Delivery {
    #[default]
    Steer,
    Queue,
}

impl Delivery {
    pub fn as_str(self) -> &'static str {
        match self {
            Delivery::Steer => "steer",
            Delivery::Queue => "queue",
        }
    }
}

/// A file part: a mention, a reference, or a pasted attachment.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct File {
    pub url: String,
    pub mime: Option<String>,
    pub filename: Option<String>,
    pub description: Option<String>,
    /// The `@path` or `[Image N]` text the part stands for, while it is in the prompt.
    pub mention: Option<Mention>,
}

/// `RunPromptPart` of a mention kind.
#[derive(Clone, Debug, PartialEq)]
pub enum Part {
    File(File),
    Agent {
        name: String,
        mention: Option<Mention>,
    },
    Skill {
        id: String,
        mention: Option<Mention>,
    },
}

impl Part {
    pub fn mention(&self) -> Option<&Mention> {
        match self {
            Part::File(file) => file.mention.as_ref(),
            Part::Agent { mention, .. } | Part::Skill { mention, .. } => mention.as_ref(),
        }
    }

    pub fn mention_mut(&mut self) -> Option<&mut Mention> {
        match self {
            Part::File(file) => file.mention.as_mut(),
            Part::Agent { mention, .. } | Part::Skill { mention, .. } => mention.as_mut(),
        }
    }

    pub fn set_mention(&mut self, next: Mention) {
        match self {
            Part::File(file) => file.mention = Some(next),
            Part::Agent { mention, .. } | Part::Skill { mention, .. } => *mention = Some(next),
        }
    }
}

/// A server command the prompt names (`RunPrompt.command`).
#[derive(Clone, Debug, PartialEq)]
pub struct Command {
    pub name: String,
    pub arguments: String,
    pub source: Option<String>,
}

/// `RunPrompt`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RunPrompt {
    pub message_id: Option<String>,
    pub text: String,
    pub parts: Vec<Part>,
    pub delivery: Option<Delivery>,
    /// `mode: "shell"`.
    pub shell: bool,
    pub command: Option<Command>,
}

impl RunPrompt {
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            ..Self::default()
        }
    }

    pub fn has_file(&self) -> bool {
        self.parts.iter().any(|part| matches!(part, Part::File(_)))
    }

    /// Text, or a file to send (`text.trim() || parts.some(file)`).
    pub fn has_content(&self) -> bool {
        !self.text.trim().is_empty() || self.has_file()
    }

    /// `promptCopy`: the prompt without its message ID and delivery.
    pub fn copy(&self) -> Self {
        Self {
            message_id: None,
            delivery: None,
            ..self.clone()
        }
    }

    /// `promptSame`.
    pub fn same(&self, other: &RunPrompt) -> bool {
        self.shell == other.shell
            && self.text == other.text
            && self.parts == other.parts
            && self.command == other.command
    }

    /// `promptFiles`: `{ uri, name, description?, mention? }` per file part.
    pub fn files(&self) -> Vec<Value> {
        self.parts
            .iter()
            .filter_map(|part| match part {
                Part::File(file) => {
                    let mut out = Map::new();
                    out.insert("uri".into(), file.url.clone().into());
                    if let Some(name) = &file.filename {
                        out.insert("name".into(), name.clone().into());
                    }
                    if let Some(description) = &file.description {
                        out.insert("description".into(), description.clone().into());
                    }
                    if let Some(mention) = &file.mention {
                        out.insert("mention".into(), wire(mention));
                    }
                    Some(Value::Object(out))
                }
                _ => None,
            })
            .collect()
    }

    /// `promptAgents`.
    pub fn agents(&self) -> Vec<Value> {
        self.parts
            .iter()
            .filter_map(|part| match part {
                Part::Agent { name, mention } => Some(with_mention(json!({ "name": name }), mention)),
                _ => None,
            })
            .collect()
    }

    /// `promptSkills`.
    pub fn skills(&self) -> Vec<Value> {
        self.parts
            .iter()
            .filter_map(|part| match part {
                Part::Skill { id, mention } => Some(with_mention(json!({ "id": id }), mention)),
                _ => None,
            })
            .collect()
    }

    /// `messagePrompt`: a listed user message (or an inbox item's payload) as a prompt.
    pub fn from_message(message: &Value) -> Self {
        let list = |key: &str| message[key].as_array().cloned().unwrap_or_default();
        let files = list("files").into_iter().map(|file| {
            let uri = match file["source"]["type"].as_str() {
                Some("uri") => file["source"]["uri"].as_str().map(str::to_owned),
                _ => None,
            }
            .or_else(|| file["uri"].as_str().map(str::to_owned))
            .unwrap_or_else(|| {
                format!(
                    "data:{};base64,{}",
                    file["mime"].as_str().unwrap_or_default(),
                    file["data"].as_str().unwrap_or_default()
                )
            });
            Part::File(File {
                url: uri,
                mime: file["mime"].as_str().map(str::to_owned),
                filename: file["name"].as_str().map(str::to_owned),
                description: file["description"].as_str().map(str::to_owned),
                mention: mention(&file["mention"]),
            })
        });
        let agents = list("agents").into_iter().map(|agent| Part::Agent {
            name: agent["name"].as_str().unwrap_or_default().to_owned(),
            mention: mention(&agent["mention"]),
        });
        let skills = list("skills").into_iter().map(|skill| Part::Skill {
            id: skill["id"].as_str().unwrap_or_default().to_owned(),
            mention: mention(&skill["mention"]),
        });
        Self {
            text: message["text"].as_str().unwrap_or_default().to_owned(),
            parts: files.chain(agents).chain(skills).collect(),
            ..Self::default()
        }
    }
}

fn wire(mention: &Mention) -> Value {
    json!({ "start": mention.start, "end": mention.end, "text": mention.text })
}

fn with_mention(mut value: Value, mention: &Option<Mention>) -> Value {
    if let Some(mention) = mention {
        value["mention"] = wire(mention);
    }
    value
}

fn mention(value: &Value) -> Option<Mention> {
    Some(Mention {
        start: value["start"].as_u64()? as u32,
        end: value["end"].as_u64()? as u32,
        text: value["text"].as_str()?.to_owned(),
    })
}

/// `EXIT_COMMANDS`.
pub const EXIT_COMMANDS: [&str; 3] = ["exit", "quit", "q"];

/// `isExitCommand`: `:q`, `/exit`, `/quit`, `/q`.
pub fn is_exit(text: &str) -> bool {
    let text = text.trim().to_lowercase();
    text == ":q"
        || EXIT_COMMANDS
            .iter()
            .any(|name| text == format!("/{name}"))
}

/// `isNewCommand`.
pub fn is_new(text: &str) -> bool {
    text.trim().to_lowercase() == "/new"
}

/// `isCompactCommand`.
pub fn is_compact(text: &str) -> bool {
    text.trim().to_lowercase() == "/compact"
}

/// `/settings`, which opens M.4's settings view.
pub fn is_settings(text: &str) -> bool {
    text.trim().to_lowercase() == "/settings"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_words() {
        for word in [":q", "/exit", " /QUIT ", "/q"] {
            assert!(is_exit(word), "{word}");
        }
        for word in ["exit", "quit", "/quitter", "q"] {
            assert!(!is_exit(word), "{word}");
        }
        assert!(is_new(" /NEW"));
        assert!(is_compact("/compact"));
        assert!(is_settings("/settings "));
    }

    #[test]
    fn wire_shapes_follow_the_transport() {
        let at = |start, end, text: &str| {
            Some(Mention {
                start,
                end,
                text: text.into(),
            })
        };
        let prompt = RunPrompt {
            text: "ask @general about @src/a.ts".into(),
            parts: vec![
                Part::Agent {
                    name: "general".into(),
                    mention: at(4, 12, "@general"),
                },
                Part::File(File {
                    url: "file:///w/src/a.ts".into(),
                    mime: Some("text/plain".into()),
                    filename: Some("src/a.ts".into()),
                    description: None,
                    mention: at(19, 28, "@src/a.ts"),
                }),
                Part::Skill {
                    id: "tidy".into(),
                    mention: None,
                },
            ],
            ..RunPrompt::default()
        };
        assert_eq!(
            prompt.files(),
            [json!({ "uri": "file:///w/src/a.ts", "name": "src/a.ts", "mention": { "start": 19, "end": 28, "text": "@src/a.ts" } })]
        );
        assert_eq!(
            prompt.agents(),
            [json!({ "name": "general", "mention": { "start": 4, "end": 12, "text": "@general" } })]
        );
        assert_eq!(prompt.skills(), [json!({ "id": "tidy" })]);
        let back = RunPrompt::from_message(&json!({
            "text": prompt.text,
            "files": [{ "uri": "file:///w/src/a.ts", "mime": "text/plain", "name": "src/a.ts", "source": { "type": "uri", "uri": "file:///w/src/a.ts" }, "mention": { "start": 19, "end": 28, "text": "@src/a.ts" } }],
            "agents": prompt.agents(),
            "skills": prompt.skills(),
        }));
        assert_eq!(back.files(), prompt.files());
        assert_eq!(back.agents(), prompt.agents());
        assert!(back.has_file());
    }
}
