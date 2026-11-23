//! Fold transcript entries into expandable exploration, reasoning, instruction, and activity groups.

use std::collections::HashSet;

use opencode_api::generated::{
    SessionMessageAssistant, SessionMessageAssistantContentItem, SessionMessageAssistantReasoning,
    SessionMessageAssistantTool, SessionMessageAssistantToolState, SessionMessageCompaction,
};
use opencode_local::cli_config::{Grouping, Info, Verbosity};
use opencode_ui::motion::Spinner;
use opencode_ui::tool_info::{ToolKind, canonical_tool_name, tool_display_metadata};
use opentui::widget::Markdown;

use opencode_store::MessageKey;

use super::messages::list::{Context, Events, Messages, Part, Row, RowEvent, Spec};
use super::messages::reasoning;
use opencode_ui::locale::duration;

use crate::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Kind {
    Activity,
    Reasoning,
    Exploration,
    Instructions,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Self::Activity => "activity",
            Self::Reasoning => "reasoning",
            Self::Exploration => "exploration",
            Self::Instructions => "instructions",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Node {
    Entry(Spec),
    Group(Group),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Group {
    pub kind: Kind,
    pub children: Vec<Node>,
    pub size: usize,
    pub completed: bool,
    /// The tool rows below that wait on a permission request, which show outside the group ([`partition_pending`]).
    pub pending: Vec<Spec>,
}

impl Group {
    /// `groupID`: the first leaf's message and part, the kind, and the nesting level.
    pub fn id(&self, level: usize) -> Option<GroupId> {
        let (message, part) = first_ref(&self.children)?;
        Some(GroupId { message, part, kind: self.kind, level })
    }

    /// The rows below, depth first (`descendants`).
    pub fn entries(&self) -> Vec<&Spec> {
        let mut entries = Vec::new();
        self.each_entry(&mut |spec| entries.push(spec));
        entries
    }

    /// [`Self::entries`] one at a time.
    pub fn each_entry<'a>(&'a self, each: &mut dyn FnMut(&'a Spec)) {
        for node in &self.children {
            match node {
                Node::Entry(spec) => each(spec),
                Node::Group(group) => group.each_entry(each),
            }
        }
    }
}

/// A group's identity: its first leaf, its kind and its nesting level.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct GroupId {
    pub message: MessageKey,
    pub part: Option<Part>,
    pub kind: Kind,
    pub level: usize,
}

impl GroupId {
    /// The ID the expanded groups are kept under: `<message>␟<part>␟<kind>␟<level>`.
    pub fn name(self, messages: &Messages<'_>) -> String {
        let message = messages.get(self.message);
        let mut name = format!("{}\u{1f}", message.map_or("", SessionMessageInfo::id));
        match self.part {
            Some(Part::Text(ordinal)) => name.push_str(&format!("text:{ordinal}")),
            Some(Part::Reasoning(ordinal)) => name.push_str(&format!("reasoning:{ordinal}")),
            Some(part @ Part::Tool(_)) => {
                if let Some(SessionMessageInfo::Assistant(assistant)) = message
                    && let Some(SessionMessageAssistantContentItem::Tool(tool)) = part.resolve(assistant)
                {
                    name.push_str(&tool.id);
                }
            }
            None => name.push_str("message"),
        }
        name.push_str(&format!("\u{1f}{}\u{1f}{}", self.kind.name(), self.level));
        name
    }
}

fn entry_ref(spec: &Spec) -> Option<(MessageKey, Option<Part>)> {
    match spec {
        Spec::Part { message, part } => Some((*message, Some(*part))),
        Spec::Message(key) => Some((*key, None)),
        _ => None,
    }
}

fn first_ref(nodes: &[Node]) -> Option<(MessageKey, Option<Part>)> {
    nodes.iter().find_map(|node| match node {
        Node::Entry(spec) => entry_ref(spec),
        Node::Group(group) => first_ref(&group.children),
    })
}

pub const DEFAULT_VERBOSITY: Verbosity = Verbosity::Low;

pub struct Settings {
    pub grouping: Cell<bool>,
    pub verbosity: Cell<Verbosity>,
    pub expanded: RefCell<HashMap<String, bool>>,
}

impl Settings {
    pub fn new(info: &Info) -> Rc<Self> {
        let settings = Rc::new(Self {
            grouping: Cell::new(true),
            verbosity: Cell::new(DEFAULT_VERBOSITY),
            expanded: RefCell::default(),
        });
        settings.read(info);
        settings
    }

    pub fn read(&self, info: &Info) -> bool {
        let session = info.session.as_ref();
        let grouping = session.and_then(|session| session.grouping) != Some(Grouping::None);
        let verbosity = session.and_then(|session| session.verbosity).unwrap_or(DEFAULT_VERBOSITY);
        let grouping = self.grouping.replace(grouping) != grouping;
        let verbosity = self.verbosity.replace(verbosity) != verbosity;
        grouping || verbosity
    }

    pub fn expanded(&self, id: &str, kind: Kind) -> bool {
        self.expanded.borrow().get(id).copied().unwrap_or(
            self.verbosity.get() == Verbosity::High && matches!(kind, Kind::Exploration | Kind::Instructions),
        )
    }

    /// [`Self::expanded`] for a group ID, named only when the reader opened or closed some group.
    pub fn group_expanded(&self, id: GroupId, messages: &Messages<'_>) -> bool {
        if self.expanded.borrow().is_empty() {
            return self.expanded("", id.kind);
        }
        self.expanded(&id.name(messages), id.kind)
    }

    /// `groupedKind`: reasoning groups while thinking is hidden, exploration unless grouping is off.
    pub fn grouped(&self, kind: Kind, hide_thinking: bool) -> bool {
        match kind {
            Kind::Reasoning => hide_thinking,
            Kind::Exploration => self.grouping.get(),
            _ => true,
        }
    }

    /// `rowWeight`: the entries a row renders. A closed group renders its header only.
    pub fn weight(&self, spec: &Spec, hide_thinking: bool, messages: &Messages<'_>) -> usize {
        let Spec::Group(group) = spec else { return 1 };
        self.group_weight(group, 0, hide_thinking, messages)
    }

    fn group_weight(&self, group: &Group, level: usize, hide_thinking: bool, messages: &Messages<'_>) -> usize {
        if !self.grouped(group.kind, hide_thinking) {
            return group.size;
        }
        let Some(id) = group.id(level) else { return 1 };
        if !self.group_expanded(id, messages) {
            return 1;
        }
        1 + group
            .children
            .iter()
            .map(|child| match child {
                Node::Group(child) => self.group_weight(child, level + 1, hide_thinking, messages),
                Node::Entry(_) => 1,
            })
            .sum::<usize>()
    }
}

/// `rowsBefore`: the first row such that the rows from it to `end` weigh at least `budget`.
pub fn rows_before(weights: &[usize], end: usize, budget: usize) -> usize {
    let (mut index, mut spent) = (end, 0);
    while index > 0 && spent < budget {
        index -= 1;
        spent += weights[index];
    }
    index
}

/// `rowsAfter`: the row after the last one such that the rows from `start` weigh at least `budget`.
pub fn rows_after(weights: &[usize], start: usize, budget: usize) -> usize {
    let (mut index, mut spent) = (start, 0);
    while index < weights.len() && spent < budget {
        spent += weights[index];
        index += 1;
    }
    index
}

pub fn project(rows: Vec<Spec>, index: Messages<'_>, verbosity: Verbosity) -> Vec<Spec> {
    let mut nodes: Vec<(Node, bool)> = Vec::new();
    for spec in rows {
        let (path, closes) = path(&spec, index, verbosity);
        append(&mut nodes, spec, path, closes);
    }
    let count = nodes.len();
    let mut out = Vec::with_capacity(count);
    let mut nodes = nodes.into_iter().peekable();
    while let Some((node, _)) = nodes.next() {
        match node {
            Node::Entry(spec) => out.push(spec),
            Node::Group(mut group) => {
                let next = nodes.peek();
                group.completed = next.is_some_and(|(next, closes)| matches!(next, Node::Group(_)) || *closes)
                    || (group.kind == Kind::Reasoning
                        && group
                            .children
                            .iter()
                            .all(|child| matches!(child, Node::Entry(spec) if reasoning_done(spec, index))));
                out.push(Spec::Group(group));
            }
        }
    }
    out
}

/// `partitionPending`: moves the exploration tools waiting on a permission request (by tool call ID) to the end
/// of their group, keeping the order otherwise, and records the waiting rows of exploration and activity groups.
pub fn partition_pending(specs: &mut [Spec], pending: &HashSet<&str>, index: Messages<'_>) {
    let blocked = |spec: &Spec| {
        matches!(spec, Spec::Part { message, part: part @ Part::Tool(_) }
            if tool(index, *message, part).is_some_and(|tool| pending.contains(tool.id.as_str())))
    };
    for spec in specs {
        let Spec::Group(group) = spec else { continue };
        if !matches!(group.kind, Kind::Exploration | Kind::Activity) {
            continue;
        }
        if group.kind == Kind::Exploration {
            let (waiting, rest): (Vec<Node>, Vec<Node>) = std::mem::take(&mut group.children)
                .into_iter()
                .partition(|node| matches!(node, Node::Entry(spec) if blocked(spec)));
            group.children = rest.into_iter().chain(waiting).collect();
        }
        group.pending = group.entries().into_iter().filter(|spec| blocked(spec)).cloned().collect();
    }
}

fn append(nodes: &mut Vec<(Node, bool)>, spec: Spec, path: &[Kind], closes: bool) {
    let Some((&kind, rest)) = path.split_first() else {
        nodes.push((Node::Entry(spec), closes));
        return;
    };
    if let Some((Node::Group(previous), _)) = nodes.last_mut()
        && previous.kind == kind
    {
        previous.size += 1;
        append_child(&mut previous.children, spec, rest);
        return;
    }
    let mut children = Vec::new();
    append_child(&mut children, spec, rest);
    nodes.push((Node::Group(Group { kind, children, size: 1, completed: false, pending: Vec::new() }), closes));
}

fn append_child(nodes: &mut Vec<Node>, spec: Spec, path: &[Kind]) {
    let Some((&kind, rest)) = path.split_first() else {
        nodes.push(Node::Entry(spec));
        return;
    };
    if let Some(Node::Group(previous)) = nodes.last_mut()
        && previous.kind == kind
    {
        previous.size += 1;
        append_child(&mut previous.children, spec, rest);
        return;
    }
    let mut children = Vec::new();
    append_child(&mut children, spec, rest);
    nodes.push(Node::Group(Group { kind, children, size: 1, completed: false, pending: Vec::new() }));
}

/// A row's grouping path (`partPath`, `messagePath`) and whether it closes the group before it.
fn path(spec: &Spec, index: Messages<'_>, verbosity: Verbosity) -> (&'static [Kind], bool) {
    let low = verbosity == Verbosity::Low;
    match spec {
        Spec::Message(key) => {
            let message = index.get(*key);
            // A running compaction is pending and leaves the group before it open.
            let running = matches!(message, Some(SessionMessageInfo::Compaction(SessionMessageCompaction::Running(_))));
            let path: &[Kind] = if instruction_paths(message).is_empty() {
                &[]
            } else if low {
                &[Kind::Activity, Kind::Instructions]
            } else {
                &[Kind::Instructions]
            };
            (path, !running)
        }
        Spec::Part { message, part } => {
            let kind = match part {
                Part::Tool(_) => tool(index, *message, part).map(|tool| ToolKind::of_ignore_ascii_case(&tool.name)),
                _ => None,
            };
            let exploration = matches!(
                kind,
                Some(ToolKind::Read | ToolKind::Glob | ToolKind::Grep | ToolKind::WebFetch | ToolKind::WebSearch)
            );
            let path: &[Kind] = match part {
                Part::Text(_) => &[],
                Part::Tool(_) if kind == Some(ToolKind::Question) => &[],
                Part::Reasoning(_) if low => &[Kind::Activity, Kind::Reasoning],
                Part::Reasoning(_) => &[Kind::Reasoning],
                Part::Tool(_) if exploration && low => &[Kind::Activity, Kind::Exploration],
                Part::Tool(_) if exploration => &[Kind::Exploration],
                Part::Tool(_) if low => &[Kind::Activity],
                Part::Tool(_) => &[],
            };
            (path, true)
        }
        _ => (&[], true),
    }
}

fn tool<'a>(index: Messages<'a>, message: MessageKey, part: &Part) -> Option<&'a SessionMessageAssistantTool> {
    match part.resolve(index.assistant(message)?)? {
        SessionMessageAssistantContentItem::Tool(tool) => Some(tool),
        _ => None,
    }
}

fn reasoning_done(spec: &Spec, index: Messages<'_>) -> bool {
    let Spec::Part { message, part } = spec else { return false };
    let Some(assistant) = index.assistant(*message) else { return false };
    matches!(
        part.resolve(assistant),
        Some(SessionMessageAssistantContentItem::Reasoning(reasoning))
            if reasoning.time.as_ref().is_some_and(|time| time.completed.is_some())
    )
}

pub fn instruction_paths(message: Option<&SessionMessageInfo>) -> Vec<String> {
    let Some(SessionMessageInfo::Synthetic(message)) = message else { return Vec::new() };
    let Some(instruction) =
        message.metadata.as_ref().and_then(|metadata| metadata.get("instruction")).and_then(|value| value.as_object())
    else {
        return Vec::new();
    };
    instruction
        .get("paths")
        .and_then(|paths| paths.as_array())
        .map(|paths| paths.iter().filter_map(|path| path.as_str().map(str::to_owned)).collect())
        .unwrap_or_default()
}

pub fn exploration_label(tools: &[&SessionMessageAssistantTool], completed: bool) -> String {
    let mut counts: Vec<(&str, usize)> = Vec::new();
    for tool in tools {
        let name = match ToolKind::of(&tool.name) {
            ToolKind::Grep | ToolKind::Glob | ToolKind::WebSearch => "search",
            ToolKind::WebFetch => "fetch",
            ToolKind::Shell => "shell",
            ToolKind::Read => "read",
            _ => "generic",
        };
        match counts.iter_mut().find(|(other, _)| *other == name) {
            Some((_, count)) => *count += 1,
            None => counts.push((name, 1)),
        }
    }
    let names: Vec<String> = counts
        .iter()
        .map(|(name, count)| match (*count, *name) {
            (1, name) => format!("1 {name}"),
            (count, name @ ("search" | "fetch")) => format!("{count} {name}es"),
            (count, name) => format!("{count} {name}s"),
        })
        .collect();
    format!("{}: {}", if completed { "Explored" } else { "Exploring" }, names.join(", "))
}

pub enum Activity<'a> {
    Thought(&'a SessionMessageAssistant, &'a SessionMessageAssistantReasoning),
    Tool(&'a SessionMessageAssistantTool),
}

impl Activity<'_> {
    fn active(&self, closed: bool) -> bool {
        match self {
            Self::Thought(message, part) => {
                !closed
                    && part.time.as_ref().and_then(|time| time.completed).is_none()
                    && message.time.completed.is_none()
            }
            Self::Tool(tool) => matches!(
                tool.state,
                SessionMessageAssistantToolState::Streaming(_) | SessionMessageAssistantToolState::Running(_)
            ),
        }
    }
}

/// `summarizeActivity`: Low's summary, e.g. `3 commands, 1 edit, 2 thoughts, 4 reads`. Until something
/// finishes, the label is the first running item's status. Returns the label and whether any item runs.
pub fn activity_summary(items: &[Activity<'_>], instructions: usize, closed: bool) -> (String, bool) {
    let mut counts =
        [("command", 0), ("edit", 0), ("thought", 0), ("read", 0), ("tool", 0), ("instruction", instructions)];
    let mut add = |name: &str| {
        if let Some((_, count)) = counts.iter_mut().find(|(other, _)| *other == name) {
            *count += 1;
        }
    };
    for item in items {
        let active = item.active(closed);
        match item {
            Activity::Thought(_, part) => {
                if !active && !reasoning::content(part).is_empty() {
                    add("thought");
                }
            }
            Activity::Tool(tool) => {
                let kind = ToolKind::of(&tool.name);
                if kind == ToolKind::Execute {
                    let calls = execute_calls(tool);
                    for call in &calls {
                        add(if ToolKind::of(call) == ToolKind::Read { "read" } else { "tool" });
                    }
                    if calls.is_empty() && !active {
                        add("tool");
                    }
                    continue;
                }
                if active {
                    continue;
                }
                add(match kind {
                    ToolKind::Shell => "command",
                    ToolKind::Read => "read",
                    ToolKind::Edit | ToolKind::Write | ToolKind::Patch => "edit",
                    _ => "tool",
                });
            }
        }
    }
    let label = counts
        .iter()
        .filter(|(_, count)| *count > 0)
        .map(|(name, count)| format!("{count} {name}{}", if *count == 1 { "" } else { "s" }))
        .collect::<Vec<_>>()
        .join(", ");
    let active = items.iter().any(|item| item.active(closed));
    if !label.is_empty() {
        return (label, active);
    }
    let busy = items.iter().find(|item| item.active(closed)).map(busy_label).unwrap_or_default();
    (busy, active)
}

fn busy_label(item: &Activity<'_>) -> String {
    let Activity::Tool(tool) = item else { return "Thinking…".to_owned() };
    let noun = match ToolKind::of(&tool.name) {
        ToolKind::Shell => "command",
        ToolKind::Execute => "code",
        _ => canonical_tool_name(&tool.name),
    };
    let verb = match tool.state {
        SessionMessageAssistantToolState::Streaming(_) => "Preparing",
        _ => "Running",
    };
    format!("{verb} {noun}…")
}

/// The finished nested calls of a code-mode `execute` (`executeCalls`, without the running ones).
fn execute_calls(tool: &SessionMessageAssistantTool) -> Vec<String> {
    let metadata = tool_display_metadata(&tool.state);
    let Some(calls) = metadata.get("toolCalls").and_then(|calls| calls.as_array()) else { return Vec::new() };
    calls
        .iter()
        .filter_map(|call| {
            let tool = call.get("tool")?.as_str()?;
            matches!(call.get("status")?.as_str()?, "completed" | "error").then(|| tool.to_owned())
        })
        .collect()
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Normal,
    Thought,
    Tool,
}

/// A group row's view: its header, and its children while open or not grouped.
pub struct GroupView(Rc<Inner>);

struct Inner {
    app: App,
    theme: Live,
    settings: Rc<Settings>,
    events: Events,
    root: View,
    header: View,
    body: View,
    /// The root group's permission-blocked rows, below it even when it is closed (`PendingEntries`).
    outside: View,
    level: usize,
    /// The group shown, and its name for the expanded groups.
    id: RefCell<Option<(GroupId, String)>>,
    kind: Cell<Option<Kind>>,
    hover: Cell<bool>,
    /// The header that is mounted, so a hover only recolors it.
    painted: RefCell<Option<(Header, Painted)>>,
    children: RefCell<Vec<(ChildKey, Child)>>,
    outside_children: RefCell<Vec<(ChildKey, Child)>>,
    /// The latest thought's title (`latest`), kept while the next thought has none yet.
    latest: RefCell<Option<String>>,
}

#[derive(Clone, PartialEq)]
struct Header {
    icon: &'static str,
    label: String,
    spinner: bool,
    color: HeaderColor,
}

#[derive(Clone, Copy, PartialEq)]
enum HeaderColor {
    Muted,
    Base,
    /// Finished reasoning: warning, dimmed unless hovered or open.
    Warning {
        open: bool,
    },
}

enum Painted {
    Done(Vec<Text>),
    Spinner(Spinner),
}

#[derive(Clone, Copy, PartialEq)]
enum ChildKey {
    Entry(Mode, MessageKey, Option<Part>),
    Group(GroupId),
}

impl ChildKey {
    fn new(node: &Node, mode: Mode, level: usize) -> Option<Self> {
        match node {
            Node::Entry(spec) => entry_ref(spec).map(|(message, part)| Self::Entry(mode, message, part)),
            Node::Group(group) => group.id(level).map(Self::Group),
        }
    }
}

enum Child {
    Row(Box<Row>),
    Thought(Thought),
    Group(GroupView),
}

impl GroupView {
    pub fn new(cx: &Context<'_>, level: usize) -> Self {
        let header = View::new(cx.app).padding_edge(Edge::Left, 3);
        let body = View::new(cx.app).column().shrink(0.0);
        let outside = View::new(cx.app).column().shrink(0.0);
        let root = View::new(cx.app).column().shrink(0.0).child(&header).child(&body).child(&outside);
        let inner = Rc::new(Inner {
            app: cx.app.clone(),
            theme: cx.tui.live_theme(),
            settings: cx.groups.clone(),
            events: cx.events.clone(),
            root,
            header,
            body,
            outside,
            level,
            id: RefCell::default(),
            kind: Cell::default(),
            hover: Cell::new(false),
            painted: RefCell::default(),
            children: RefCell::default(),
            outside_children: RefCell::default(),
            latest: RefCell::default(),
        });
        inner.header.mouse_pointer(MousePointer::POINTER).on_click(bind!(inner, |inner, cx, _| {
            if cx.app().selected_text().is_some_and(|text| !text.is_empty()) {
                return;
            }
            let (Some((_, id)), Some(kind)) = (inner.id.borrow().clone(), inner.kind.get()) else { return };
            let open = inner.settings.expanded(&id, kind);
            inner.settings.expanded.borrow_mut().insert(id, !open);
            inner.events.send(RowEvent::Toggled);
        }));
        inner.header.on_hover(bind!(inner, |inner, _, hovered| {
            inner.hover.set(hovered);
            inner.paint_color();
        }));
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    pub fn restyle(&self, cx: &Context<'_>) {
        let inner = &self.0;
        inner.paint_color();
        let (children, outside) = (inner.children.borrow(), inner.outside_children.borrow());
        for (_, child) in children.iter().chain(outside.iter()) {
            match child {
                Child::Row(row) => row.restyle_body(cx),
                Child::Thought(thought) => thought.restyle(cx),
                Child::Group(group) => group.restyle(cx),
            }
        }
    }

    pub fn update(&self, cx: &Context<'_>, group: &Group, completed: bool) {
        self.render(cx, group, completed, &group.pending, true);
    }

    /// Renders `group` without the rows in `pending`; `completed` is what its parent passes down. The root group
    /// shows the pending rows after it (`outside`).
    fn render(&self, cx: &Context<'_>, group: &Group, completed: bool, pending: &[Spec], outside: bool) {
        let inner = &self.0;
        let id = group.id(inner.level);
        inner.kind.set(Some(group.kind));
        let expanded = id.is_some_and(|id| inner.settings.group_expanded(id, &cx.lookup));
        if inner.id.borrow().as_ref().map(|(shown, _)| *shown) != id {
            *inner.id.borrow_mut() = id.map(|id| (id, id.name(&cx.lookup)));
        }
        let grouped = inner.settings.grouped(group.kind, cx.hide_thinking);
        let (header, mode) = match group.kind {
            Kind::Reasoning => self.reasoning(cx, group, completed, expanded, grouped),
            Kind::Exploration => self.exploration(cx, group, completed, expanded, grouped, pending),
            Kind::Activity => self.activity(cx, group, completed, expanded, pending),
            Kind::Instructions => self.instructions(cx, group, expanded),
        };
        inner.paint(header);
        let children = mode.map_or(&[][..], |_| &group.children[..]);
        inner.body.margin_edge(Edge::Top, if group.kind == Kind::Activity && mode.is_some() { 1 } else { 0 });
        inner.body.gap(if group.kind == Kind::Activity { 1 } else { 0 });
        inner.body.padding_edge(Edge::Left, if mode == Some(Mode::Thought) { 3 } else { 0 });
        inner.children(&inner.body, &inner.children, cx, children, mode.unwrap_or(Mode::Normal), completed, pending);
        let waiting: Vec<Node> =
            if outside { pending.iter().map(|spec| Node::Entry(spec.clone())).collect() } else { Vec::new() };
        inner.children(&inner.outside, &inner.outside_children, cx, &waiting, Mode::Normal, completed, &[]);
    }

    fn reasoning(
        &self,
        cx: &Context<'_>,
        group: &Group,
        completed: bool,
        expanded: bool,
        grouped: bool,
    ) -> (Option<Header>, Option<Mode>) {
        let thoughts: Vec<_> = group
            .entries()
            .into_iter()
            .filter_map(|spec| thought(cx, spec))
            .filter(|(_, part)| !reasoning::content(part).is_empty())
            .collect();
        if thoughts.is_empty() {
            return (None, None);
        }
        if !grouped {
            return (None, Some(Mode::Normal));
        }
        let mut latest = self.0.latest.borrow_mut();
        if let Some((message, part)) = thoughts.last() {
            match reasoning::summary(&reasoning::content(part)) {
                Some(title) => *latest = Some(title),
                None if part.time.as_ref().and_then(|time| time.completed).is_some()
                    || message.time.completed.is_some() =>
                {
                    *latest = None
                }
                None => {}
            }
        }
        let total: f64 = thoughts
            .iter()
            .filter_map(|(_, part)| {
                let time = part.time.as_ref()?;
                Some((time.completed? - time.created).max(0.0))
            })
            .sum();
        let label = if completed {
            let mut label = "Thought".to_owned();
            if let (false, Some(title)) = (expanded, latest.as_ref()) {
                label.push_str(&format!(": {title}"));
            }
            if thoughts.len() > 1 {
                label.push_str(&format!(" · {} steps", thoughts.len()));
            }
            if total > 0.0 {
                label.push_str(&format!(" · {}", duration(total)));
            }
            label
        } else {
            match latest.as_ref() {
                Some(title) => format!("Thinking: {title}"),
                None => "Thinking".to_owned(),
            }
        };
        let header = Header {
            icon: if expanded { "-" } else { "+" },
            label,
            spinner: !completed,
            color: if completed { HeaderColor::Warning { open: expanded } } else { HeaderColor::Base },
        };
        (Some(header), expanded.then_some(Mode::Thought))
    }

    fn exploration(
        &self,
        cx: &Context<'_>,
        group: &Group,
        completed: bool,
        expanded: bool,
        grouped: bool,
        pending: &[Spec],
    ) -> (Option<Header>, Option<Mode>) {
        if !grouped {
            return (None, Some(Mode::Normal));
        }
        let tools: Vec<_> = group
            .entries()
            .into_iter()
            .filter(|spec| !pending.contains(spec))
            .filter_map(|spec| match spec {
                Spec::Part { message, part } => match part.resolve(cx.assistant(*message)?)? {
                    SessionMessageAssistantContentItem::Tool(tool) => Some(tool),
                    _ => None,
                },
                _ => None,
            })
            .collect();
        if tools.is_empty() {
            return (None, None);
        }
        let completed = completed || tools.iter().all(|tool| tool.time.completed.is_some());
        let header = Header {
            icon: if completed { "→" } else { "✱" },
            label: exploration_label(&tools, completed),
            spinner: !completed,
            color: HeaderColor::Muted,
        };
        (Some(header), expanded.then_some(Mode::Tool))
    }

    fn activity(
        &self,
        cx: &Context<'_>,
        group: &Group,
        completed: bool,
        expanded: bool,
        pending: &[Spec],
    ) -> (Option<Header>, Option<Mode>) {
        let entries = group.entries();
        let items: Vec<_> = entries
            .iter()
            .filter(|spec| !pending.contains(spec))
            .filter_map(|spec| {
                let Spec::Part { message, part } = spec else { return None };
                let assistant = cx.assistant(*message)?;
                match part.resolve(assistant)? {
                    SessionMessageAssistantContentItem::Reasoning(part) => Some(Activity::Thought(assistant, part)),
                    SessionMessageAssistantContentItem::Tool(tool) => Some(Activity::Tool(tool)),
                    _ => None,
                }
            })
            .collect();
        let (label, active) = activity_summary(&items, instruction_files(cx, &entries), completed);
        if label.is_empty() {
            return (None, None);
        }
        let header = Header {
            icon: if expanded { "−" } else { "+" },
            label,
            spinner: !expanded && active,
            color: HeaderColor::Muted,
        };
        (Some(header), expanded.then_some(Mode::Normal))
    }

    fn instructions(&self, cx: &Context<'_>, group: &Group, expanded: bool) -> (Option<Header>, Option<Mode>) {
        let files = instruction_files(cx, &group.entries());
        let header = Header {
            icon: "◈",
            label: format!("Instructions: {files} {}", if files == 1 { "file" } else { "files" }),
            spinner: false,
            color: HeaderColor::Muted,
        };
        (Some(header), expanded.then_some(Mode::Normal))
    }

    pub fn anchors(&self, out: &mut Vec<(MessageKey, f64)>) {
        let (children, outside) = (self.0.children.borrow(), self.0.outside_children.borrow());
        for (key, child) in children.iter().chain(outside.iter()) {
            match (key, child) {
                (ChildKey::Entry(_, message, _), Child::Row(row)) => out.push((*message, row.wrapper.rect().screen_y)),
                (ChildKey::Entry(_, message, _), Child::Thought(thought)) => {
                    out.push((*message, thought.root.rect().screen_y))
                }
                (_, Child::Group(group)) => group.anchors(out),
                _ => {}
            }
        }
    }
}

fn thought<'a>(
    cx: &'a Context<'_>,
    spec: &Spec,
) -> Option<(&'a SessionMessageAssistant, &'a SessionMessageAssistantReasoning)> {
    let Spec::Part { message, part } = spec else { return None };
    let assistant = cx.assistant(*message)?;
    match part.resolve(assistant)? {
        SessionMessageAssistantContentItem::Reasoning(part) => Some((assistant, part)),
        _ => None,
    }
}

fn instruction_files(cx: &Context<'_>, entries: &[&Spec]) -> usize {
    let mut files: Vec<String> = entries
        .iter()
        .filter_map(|spec| match spec {
            Spec::Message(key) => Some(instruction_paths(cx.message(*key))),
            _ => None,
        })
        .flatten()
        .collect();
    files.sort();
    files.dedup();
    files.len()
}

impl Inner {
    fn paint(&self, header: Option<Header>) {
        self.header.visible(header.is_some());
        let Some(header) = header else {
            self.header.clear();
            *self.painted.borrow_mut() = None;
            return;
        };
        if self.painted.borrow().as_ref().is_some_and(|(painted, _)| *painted == header) {
            self.paint_color();
            return;
        }
        self.header.clear();
        let fg = self.color(header.color);
        let painted = if header.spinner {
            let spinner = Spinner::new(&self.app).color(fg).label(header.label.clone());
            self.header.add(&View::new(&self.app).row().child(&spinner));
            Painted::Spinner(spinner)
        } else {
            let icon = Text::new(&self.app, header.icon).width(2).shrink(0.0).fg(fg);
            let label = Text::new(&self.app, header.label.clone()).grow(1.0).fg(fg);
            self.header.add(&View::new(&self.app).row().child(&icon).child(&label));
            Painted::Done(vec![icon, label])
        };
        *self.painted.borrow_mut() = Some((header, painted));
    }

    fn color(&self, color: HeaderColor) -> Color {
        let hover = self.hover.get();
        match color {
            HeaderColor::Muted if hover => self.theme.get().text.base,
            HeaderColor::Muted => self.theme.get().text.muted,
            HeaderColor::Base => self.theme.get().text.base,
            HeaderColor::Warning { open } if hover || open => self.theme.get().text.feedback.warning.base,
            HeaderColor::Warning { .. } => self.theme.get().text.feedback.warning.base.with_alpha(153),
        }
    }

    fn paint_color(&self) {
        let painted = self.painted.borrow();
        let Some((header, painted)) = painted.as_ref() else { return };
        let fg = self.color(header.color);
        match painted {
            Painted::Done(texts) => texts.iter().for_each(|text| {
                text.fg(fg);
            }),
            Painted::Spinner(spinner) => spinner.set_color(fg),
        }
    }

    /// Mounts `nodes` in `target` in order, reusing the children in `store` that are still there, and leaves out
    /// the rows in `pending` (`Children`).
    #[allow(clippy::too_many_arguments)]
    fn children(
        &self,
        target: &View,
        store: &RefCell<Vec<(ChildKey, Child)>>,
        cx: &Context<'_>,
        nodes: &[Node],
        mode: Mode,
        completed: bool,
        pending: &[Spec],
    ) {
        let waiting = |node: &Node| matches!(node, Node::Entry(spec) if pending.contains(spec));
        let mut children = store.borrow_mut();
        let mut old = std::mem::take(&mut *children);
        for (index, node) in nodes.iter().enumerate() {
            if waiting(node) {
                continue;
            }
            let level = self.level + 1;
            let Some(key) = ChildKey::new(node, mode, level) else { continue };
            let (key, child) = match old.iter().position(|(other, _)| *other == key) {
                Some(position) => old.remove(position),
                None => {
                    let child = match node {
                        Node::Entry(_) if mode == Mode::Thought => Child::Thought(Thought::new(cx)),
                        Node::Entry(spec) => {
                            let row = Row::new(cx, spec);
                            row.wrapper.margin_edge(Edge::Top, 0);
                            Child::Row(Box::new(row))
                        }
                        Node::Group(_) => Child::Group(GroupView::new(cx, level)),
                    };
                    (key, child)
                }
            };
            match (&child, node) {
                (Child::Row(row), Node::Entry(spec)) => row.update(cx, spec),
                (Child::Thought(view), Node::Entry(spec)) => {
                    if let Some((message, part)) = thought(cx, spec) {
                        view.update(message, part, cx.conceal);
                    }
                }
                (Child::Group(view), Node::Group(group)) => {
                    // A nested group closes when its parent did, when anything but a pending row follows it, or
                    // when every thought in it finished.
                    let completed = completed
                        || nodes[index + 1..].iter().any(|next| !waiting(next))
                        || (group.kind == Kind::Reasoning
                            && group.entries().iter().all(|spec| {
                                thought(cx, spec).is_some_and(|(_, part)| {
                                    part.time.as_ref().and_then(|time| time.completed).is_some()
                                })
                            }));
                    view.render(cx, group, completed, pending, false);
                }
                _ => {}
            }
            children.push((key, child));
        }
        for (_, child) in &old {
            child_root(child).detach();
        }
        target.clear();
        for (_, child) in children.iter() {
            target.add(child_root(child));
        }
    }
}

fn child_root(child: &Child) -> &View {
    match child {
        Child::Row(row) => &row.wrapper,
        Child::Thought(thought) => &thought.root,
        Child::Group(group) => group.root(),
    }
}

struct Thought {
    root: View,
    bar: View,
    markdown: Markdown,
    content: RefCell<String>,
    streaming: Cell<bool>,
}

impl Thought {
    fn new(cx: &Context<'_>) -> Self {
        let markdown =
            opencode_ui::markdown::view(cx.app, cx.theme, cx.thinking_syntax, cx.renderers, cx.conceal, true)
                .colors(thought_colors(cx.theme));
        let bar = View::new(cx.app)
            .border(BorderStyle::Heavy)
            .border_sides(Sides::LEFT)
            .border_color(cx.theme.decrease(&cx.theme.background.raised.base, 1))
            .padding_edge(Edge::Left, 1)
            .child(&markdown);
        let root = View::new(cx.app).margin_edge(Edge::Top, 1).shrink(0.0).child(&bar);
        Self { root, bar, markdown, content: RefCell::default(), streaming: Cell::new(true) }
    }

    fn restyle(&self, cx: &Context<'_>) {
        self.bar.border_color(cx.theme.decrease(&cx.theme.background.raised.base, 1));
        opencode_ui::markdown::restyle(&self.markdown, thought_colors(cx.theme), cx.thinking_syntax);
    }

    fn update(&self, message: &SessionMessageAssistant, part: &SessionMessageAssistantReasoning, conceal: bool) {
        let content = reasoning::content(part);
        self.root.visible(!content.is_empty());
        self.markdown.conceal(conceal);
        if *self.content.borrow() != content {
            self.markdown.set_markdown(content.as_str());
            *self.content.borrow_mut() = content;
        }
        let streaming =
            part.time.as_ref().and_then(|time| time.completed).is_none() && message.time.completed.is_none();
        if self.streaming.replace(streaming) != streaming {
            self.markdown.streaming(streaming);
        }
    }
}

fn thought_colors(theme: &Theme) -> opentui::widget::MarkdownColors {
    opentui::widget::MarkdownColors { text: theme.text.muted, ..opencode_ui::markdown::colors(theme) }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn messages(value: serde_json::Value) -> Vec<SessionMessageInfo> {
        serde_json::from_value(value).unwrap()
    }

    fn tool(id: &str, name: &str) -> serde_json::Value {
        json!({
            "type": "tool", "id": id, "name": name,
            "state": { "status": "completed", "input": {}, "content": [] },
            "time": { "created": 1, "completed": 2 },
        })
    }

    /// Messages outside the store are keyed by their positions.
    fn part(message: u32, part: Part) -> Spec {
        Spec::Part { message: MessageKey(message), part }
    }

    /// One assistant message with a tool call for each ID.
    fn calls(ids: &[&str]) -> Vec<SessionMessageInfo> {
        let content: Vec<_> = ids.iter().map(|id| tool(id, "read")).collect();
        messages(json!([{
            "id": "msg_1", "type": "assistant", "agent": "build",
            "model": { "providerID": "p", "id": "m" }, "time": { "created": 1 }, "content": content,
        }]))
    }

    #[test]
    fn adjacent_reads_and_thoughts_group_and_text_breaks_them() {
        let list = messages(json!([
            { "id": "msg_1", "type": "user", "text": "hi", "time": { "created": 1 } },
            {
                "id": "msg_2", "type": "assistant", "agent": "build",
                "model": { "providerID": "p", "id": "m" }, "time": { "created": 1 },
                "content": [
                    { "type": "reasoning", "text": "a", "time": { "created": 1, "completed": 2 } },
                    { "type": "reasoning", "text": "b", "time": { "created": 2, "completed": 3 } },
                    tool("call_1", "read"), tool("call_2", "grep"), tool("call_3", "shell"),
                    { "type": "text", "text": "done" },
                ],
            },
        ]));
        let rows = vec![
            Spec::Message(MessageKey(0)),
            part(1, Part::Reasoning(0)),
            part(1, Part::Reasoning(1)),
            part(1, Part::Tool(2)),
            part(1, Part::Tool(3)),
            part(1, Part::Tool(4)),
            part(1, Part::Text(0)),
        ];
        let medium = project(rows.clone(), Messages::of(&list), Verbosity::Medium);
        let kinds: Vec<_> = medium
            .iter()
            .map(|spec| match spec {
                Spec::Group(group) => format!("{:?}:{}", group.kind, group.size),
                _ => "row".to_owned(),
            })
            .collect();
        assert_eq!(kinds, ["row", "Reasoning:2", "Exploration:2", "row", "row"]);
        let Spec::Group(reasoning) = &medium[1] else { unreachable!() };
        assert!(reasoning.completed);
        let id = reasoning.id(0).unwrap();
        assert_eq!(id.name(&Messages::of(&list)), "msg_2\u{1f}reasoning:0\u{1f}reasoning\u{1f}0");

        let low = project(rows, Messages::of(&list), Verbosity::Low);
        assert_eq!(low.len(), 3);
        let Spec::Group(activity) = &low[1] else { unreachable!() };
        assert_eq!((activity.kind, activity.size), (Kind::Activity, 5));
        assert!(matches!(&activity.children[0], Node::Group(group) if group.kind == Kind::Reasoning));
        assert!(matches!(&activity.children[2], Node::Entry(_)));
    }

    #[test]
    fn closed_groups_weigh_one_and_open_ones_their_children() {
        let settings = Settings::new(&Info::default());
        let list = calls(&["a", "b"]);
        let lookup = Messages::of(&list);
        let group = Spec::Group(Group {
            kind: Kind::Exploration,
            children: vec![Node::Entry(part(0, Part::Tool(0))), Node::Entry(part(0, Part::Tool(1)))],
            size: 2,
            completed: true,
            pending: Vec::new(),
        });
        assert_eq!(settings.weight(&group, true, &lookup), 1);
        let Spec::Group(inner) = &group else { unreachable!() };
        settings.expanded.borrow_mut().insert(inner.id(0).unwrap().name(&lookup), true);
        assert_eq!(settings.weight(&group, true, &lookup), 3);
        settings.grouping.set(false);
        assert_eq!(settings.weight(&group, true, &lookup), 2);
        assert_eq!(rows_before(&[1, 3, 1, 1], 4, 4), 1);
        assert_eq!(rows_before(&[1, 3, 1, 1], 4, 40), 0);
    }

    #[test]
    fn labels_count_like_typescript() {
        let tools: Vec<SessionMessageAssistantTool> = ["read", "read", "grep", "glob", "webfetch"]
            .iter()
            .enumerate()
            .map(|(index, name)| serde_json::from_value(tool(&format!("c{index}"), name)).unwrap())
            .collect();
        let refs: Vec<_> = tools.iter().collect();
        assert_eq!(exploration_label(&refs, true), "Explored: 2 reads, 2 searches, 1 fetch");
        assert_eq!(exploration_label(&refs[..1], false), "Exploring: 1 read");
        let items: Vec<_> = tools.iter().map(Activity::Tool).collect();
        assert_eq!(activity_summary(&items, 1, true), ("2 reads, 3 tools, 1 instruction".to_owned(), false));
    }

    #[test]
    fn pending_tools_go_last_in_exploration_and_are_recorded_in_activity() {
        let list = calls(&["a", "b", "c"]);
        let entry = |index: usize| Node::Entry(part(0, Part::Tool(index)));
        let group = |kind| {
            Spec::Group(Group {
                kind,
                children: (0..3).map(entry).collect(),
                size: 3,
                completed: false,
                pending: Vec::new(),
            })
        };
        let mut specs = vec![group(Kind::Exploration), group(Kind::Activity)];
        partition_pending(&mut specs, &HashSet::from(["a", "b"]), Messages::of(&list));
        let Spec::Group(exploration) = &specs[0] else { unreachable!() };
        assert_eq!(exploration.children, [entry(2), entry(0), entry(1)]);
        let pending = vec![part(0, Part::Tool(0)), part(0, Part::Tool(1))];
        assert_eq!(exploration.pending, pending);
        // Activity groups keep their order.
        let Spec::Group(activity) = &specs[1] else { unreachable!() };
        assert_eq!(activity.children, [entry(0), entry(1), entry(2)]);
        assert_eq!(activity.pending, pending);
    }
}
