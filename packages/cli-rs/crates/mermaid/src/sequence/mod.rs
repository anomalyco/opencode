//! Sequence diagrams (`packages/merman/src/sequence`).

pub mod drawing;
pub mod parser;
pub mod placement;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Participant {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Group {
    pub label: String,
    pub participant_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Head {
    Open,
    Cross,
    Async,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Message {
    pub from: String,
    pub to: String,
    pub label: String,
    pub dashed: bool,
    pub head: Option<Head>,
    pub number: Option<i64>,
    pub activate: Option<String>,
    pub deactivate: Option<String>,
}

/// Where a note sits beside its participant; `None` is over it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoteSide {
    Left,
    Right,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Note {
    pub over: Vec<String>,
    pub label: String,
    pub side: Option<NoteSide>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FragmentKind {
    Alt,
    Else,
    Loop,
    End,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Fragment {
    pub kind: FragmentKind,
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Step {
    Message(Message),
    Note(Note),
    Activation { participant: String, active: bool },
    Fragment(Fragment),
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Diagram {
    pub participants: Vec<Participant>,
    pub steps: Vec<Step>,
    pub groups: Vec<Group>,
}

impl Diagram {
    pub fn messages(&self) -> impl Iterator<Item = &Message> {
        self.steps.iter().filter_map(|step| match step {
            Step::Message(message) => Some(message),
            _ => None,
        })
    }
}
