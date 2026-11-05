//! The scrollback writer (`scrollback.writer.tsx`, `scrollback.surface.ts`, `entry.body.ts`,
//! `scrollback.shared.ts`): turns stream commits into rows above the split footer.
//!
//! Finished entries are painted once into a snapshot. Entries that stream (assistant text, reasoning, running
//! tools) live on a surface whose settled rows are committed as they arrive, so the terminal's scrollback grows
//! with the text and nothing written is ever rewritten.

use opencode_api::generated::{SessionMessageAssistantTool, SessionMessageAssistantToolState};
use opentui::prelude::*;
use opentui::split::{Scrollback, ScrollbackSurface, SnapshotOptions, SplitFooter, SplitSnapshot};
use opentui::syntax::SyntaxTheme;
use opentui::widget::{ColumnWidthMode, Markdown, MarkdownColors, MarkdownTableOptions, MarkdownTableStyle};

use crate::theme::{RunTheme, mono_snapshot, mono_text};
use crate::tools;

/// The semantic role of an entry; each has its own color.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EntryKind {
    System,
    User,
    Assistant,
    Reasoning,
    Tool,
    Error,
}

/// `start` opens an entry, `progress` appends to it, `final` closes it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Phase {
    Start,
    Progress,
    Final,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Source {
    Assistant,
    Reasoning,
    Tool,
    System,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ToolState {
    Running,
    Completed,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TurnSummary {
    pub agent: String,
    pub model: String,
    pub duration: String,
}

/// One append-only commit to the scrollback (`StreamCommit`).
#[derive(Clone, Debug, PartialEq)]
pub struct Commit {
    pub kind: EntryKind,
    pub text: String,
    pub image: Option<String>,
    pub phase: Phase,
    pub source: Source,
    pub compaction: bool,
    pub summary: Option<TurnSummary>,
    pub message_id: Option<String>,
    pub part_id: Option<String>,
    pub tool: Option<String>,
    pub directory: Option<String>,
    /// The tool part as the server sent it.
    pub part: Option<SessionMessageAssistantTool>,
    pub interrupted: bool,
    pub tool_state: Option<ToolState>,
    pub tool_error: Option<String>,
    /// The command of a direct shell call.
    pub shell: Option<String>,
}

impl Commit {
    pub fn new(kind: EntryKind, source: Source, phase: Phase, text: impl Into<String>) -> Self {
        Self {
            kind,
            text: text.into(),
            image: None,
            phase,
            source,
            compaction: false,
            summary: None,
            message_id: None,
            part_id: None,
            tool: None,
            directory: None,
            part: None,
            interrupted: false,
            tool_state: None,
            tool_error: None,
            shell: None,
        }
    }

    pub fn message(mut self, id: impl Into<String>) -> Self {
        self.message_id = Some(id.into());
        self
    }

    pub fn part_id(mut self, id: impl Into<String>) -> Self {
        self.part_id = Some(id.into());
        self
    }

    /// A system line (`kind: "system", phase: "final"`), such as `startup 120ms`.
    pub fn system(text: impl Into<String>) -> Self {
        Self::new(EntryKind::System, Source::System, Phase::Final, text)
    }

    /// An error line (`kind: "error", phase: "start"`).
    pub fn error(text: impl Into<String>) -> Self {
        Self::new(EntryKind::Error, Source::System, Phase::Start, text)
    }
}

/// What an entry draws (`RunEntryBody`).
#[derive(Clone, Debug, PartialEq)]
pub enum Body {
    None,
    Text(String),
    Code { content: String, filetype: Option<String> },
    Markdown(String),
    Structured(tools::Snapshot),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BodyOptions {
    pub shell_output: bool,
    pub mono: bool,
}

/// Where an entry starts and whether it ends its row (`EntryFlags`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Flags {
    pub start_on_new_line: bool,
    pub trailing_newline: bool,
}

/// `entryBody`.
pub fn entry_body(commit: &Commit, options: BodyOptions) -> Body {
    if commit.summary.is_some() {
        return Body::None;
    }
    let raw = commit.text.replace("\r\n", "\n").replace('\r', "\n");
    let mono = options.mono;
    if commit.image.is_some() {
        let caption = match raw.trim() {
            "" => "Image",
            caption => caption,
        };
        return match commit.kind {
            EntryKind::User => user_body(caption, mono),
            _ => text_body(crate::theme::mono_tool_text(caption, mono)),
        };
    }
    match commit.kind {
        EntryKind::User => user_body(&raw, mono),
        EntryKind::Tool => {
            let body = tools::entry_body(commit, &raw, options).unwrap_or(Body::None);
            match body {
                Body::Text(text) if mono && commit.phase != Phase::Progress => {
                    Body::Text(crate::theme::mono_tool_text(&text, true))
                }
                body if mono => tools::mono_body(body),
                body => body,
            }
        }
        EntryKind::Assistant => match commit.phase {
            Phase::Start => Body::None,
            Phase::Final if commit.interrupted => text_body("assistant interrupted".into()),
            Phase::Final => Body::None,
            Phase::Progress => markdown_body(raw),
        },
        EntryKind::Reasoning => match commit.phase {
            Phase::Start => Body::None,
            Phase::Final if commit.interrupted => text_body("reasoning interrupted".into()),
            Phase::Final => Body::None,
            Phase::Progress => reasoning_body(&raw, mono),
        },
        EntryKind::System | EntryKind::Error => {
            let text = if commit.phase == Phase::Progress { raw } else { raw.trim().to_owned() };
            match text_body(text) {
                Body::Text(text) => Body::Text(crate::theme::mono_prefix(&text, mono)),
                body => body,
            }
        }
    }
}

fn text_body(content: String) -> Body {
    if content.is_empty() {
        return Body::None;
    }
    Body::Text(content)
}

fn markdown_body(content: String) -> Body {
    if content.is_empty() {
        return Body::None;
    }
    Body::Markdown(content)
}

fn leading_newlines(text: &str) -> (&str, &str) {
    let body = text.trim_start_matches('\n');
    (&text[..text.len() - body.len()], body)
}

fn user_body(raw: &str, mono: bool) -> Body {
    if raw.trim().is_empty() {
        return Body::None;
    }
    let (lead, body) = leading_newlines(raw);
    text_body(format!("{lead}{} {body}", if mono { ">" } else { "›" }))
}

fn reasoning_body(raw: &str, mono: bool) -> Body {
    let clean = raw.replace("[REDACTED]", "");
    if clean.is_empty() {
        return Body::None;
    }
    let (lead, body) = leading_newlines(&clean);
    let code = |content: String| Body::Code { content, filetype: Some("markdown".into()) };
    if let Some(rest) = body.strip_prefix("Thinking:") {
        let rest = rest.trim_start();
        if mono {
            return text_body(format!("{lead}Thinking: {rest}"));
        }
        return code(format!("{lead}_Thinking:_ {rest}"));
    }
    if mono {
        return text_body(clean);
    }
    code(clean)
}

/// `entryFlags`.
pub fn entry_flags(commit: &Commit) -> Flags {
    let flags = |start_on_new_line, trailing_newline| Flags { start_on_new_line, trailing_newline };
    if commit.summary.is_some() {
        return flags(true, false);
    }
    match commit.kind {
        EntryKind::User | EntryKind::Error => flags(true, false),
        EntryKind::Tool | EntryKind::Assistant | EntryKind::Reasoning => {
            if commit.phase == Phase::Progress {
                flags(false, false)
            } else {
                flags(true, true)
            }
        }
        EntryKind::System => flags(true, true),
    }
}

/// `entryDone`.
pub fn entry_done(commit: &Commit) -> bool {
    match commit.kind {
        EntryKind::Assistant | EntryKind::Reasoning => commit.phase == Phase::Final,
        EntryKind::Tool => {
            commit.phase == Phase::Final
                || (commit.phase == Phase::Progress && commit.tool_state == Some(ToolState::Completed))
        }
        _ => true,
    }
}

/// `entryCanStream`.
pub fn entry_can_stream(commit: &Commit, body: &Body) -> bool {
    if commit.phase != Phase::Progress || *body == Body::None {
        return false;
    }
    match commit.kind {
        EntryKind::Tool => commit.tool_state != Some(ToolState::Completed),
        EntryKind::Assistant | EntryKind::Reasoning => true,
        _ => false,
    }
}

/// `entryGroupKey`: commits of one part share a key and stream into one entry.
pub fn group_key(commit: &Commit) -> Option<String> {
    let part = format!("{}\u{0}{}", commit.message_id.as_deref().unwrap_or(""), commit.part_id.as_deref()?);
    if tools::structured_final(commit) {
        return Some(format!("tool:{part}:final"));
    }
    Some(format!("{:?}:{part}", commit.kind))
}

pub fn same_group(left: Option<&Commit>, right: &Commit) -> bool {
    let Some(left) = left else { return false };
    matches!((group_key(left), group_key(right)), (Some(a), Some(b)) if a == b)
}

fn inline(commit: &Commit, body: &Body) -> bool {
    if commit.image.is_some() || commit.kind != EntryKind::Tool {
        return false;
    }
    match body {
        Body::Structured(_) | Body::Markdown(_) => false,
        Body::Text(content) => {
            !(commit.phase == Phase::Progress
                && commit.tool_state == Some(ToolState::Completed)
                && content.contains('\n'))
        }
        _ => true,
    }
}

/// `separatorRows`: one blank row between entries, none inside a group or between inline tools.
pub fn separator_rows(previous: Option<&Commit>, next: &Commit, body: &Body) -> u32 {
    let Some(previous) = previous else { return 0 };
    if same_group(Some(previous), next) {
        return 0;
    }
    let previous_body = entry_body(previous, BodyOptions::default());
    if inline(previous, &previous_body) && inline(next, body) {
        return 0;
    }
    1
}

/// `entryLook`: the color and attributes of a text entry.
pub fn entry_look(commit: &Commit, theme: &RunTheme) -> (Color, Attributes) {
    let entry = &theme.entry;
    if commit.kind == EntryKind::User {
        return (entry.user.body, Attributes::NONE);
    }
    if failed(commit) {
        return (entry.error.body, Attributes::BOLD);
    }
    if commit.phase == Phase::Final {
        return (entry.system.body, Attributes::NONE);
    }
    match commit.kind {
        EntryKind::Tool if commit.phase == Phase::Start => {
            (entry.tool.start.unwrap_or(entry.tool.body), Attributes::NONE)
        }
        EntryKind::Assistant => (entry.assistant.body, Attributes::NONE),
        EntryKind::Reasoning => (entry.reasoning.body, Attributes::NONE),
        EntryKind::Error => (entry.error.body, Attributes::BOLD),
        EntryKind::Tool => (entry.tool.body, Attributes::NONE),
        _ => (entry.system.body, Attributes::NONE),
    }
}

/// `entryColor`: the base color of a code or Markdown entry.
pub fn entry_color(commit: &Commit, theme: &RunTheme) -> Color {
    match commit.kind {
        EntryKind::Assistant => theme.entry.assistant.body,
        EntryKind::Reasoning => theme.entry.reasoning.body,
        _ if failed(commit) => theme.entry.error.body,
        EntryKind::Tool => theme.block.text,
        _ => entry_look(commit, theme).0,
    }
}

fn failed(commit: &Commit) -> bool {
    commit.kind == EntryKind::Tool
        && (commit.tool_state == Some(ToolState::Error)
            || commit
                .part
                .as_ref()
                .is_some_and(|part| matches!(part.state, SessionMessageAssistantToolState::Error(_))))
}

/// A body that streams on a surface.
enum Stream {
    Text(Text),
    Markdown(Markdown),
}

struct Active {
    commit: Commit,
    /// The body's kind, to tell when a commit of the same group switches kind.
    kind: std::mem::Discriminant<Body>,
    surface: ScrollbackSurface,
    widget: Stream,
    content: String,
    committed_rows: u32,
    pending_spacer_rows: u32,
    rendered: bool,
}

/// `RunScrollbackStream`: appends commits to the scrollback.
pub struct Writer {
    footer: SplitFooter,
    scrollback: Scrollback,
    theme: RunTheme,
    mono: bool,
    shell_output: bool,
    /// `session.image_preview`: image commits draw the picture under their caption.
    image_preview: bool,
    /// Something was written above the transcript, so its first entry starts one row lower.
    wrote: bool,
    tail: Option<Commit>,
    rendered: Option<Commit>,
    active: Option<Active>,
}

impl Writer {
    pub fn new(footer: SplitFooter, scrollback: Scrollback, theme: RunTheme, mono: bool, wrote: bool) -> Self {
        Self {
            footer,
            scrollback,
            theme,
            mono,
            shell_output: false,
            image_preview: false,
            wrote,
            tail: None,
            rendered: None,
            active: None,
        }
    }

    pub fn footer(&self) -> &SplitFooter {
        &self.footer
    }

    pub fn scrollback(&self) -> &Scrollback {
        &self.scrollback
    }

    pub fn theme(&self) -> &RunTheme {
        &self.theme
    }

    pub fn mono(&self) -> bool {
        self.mono
    }

    /// New entries use `theme`; rows already written keep theirs.
    pub fn set_theme(&mut self, theme: RunTheme) {
        self.theme = theme;
    }

    pub fn set_mono(&mut self, mono: bool) -> Result<()> {
        if self.mono == mono {
            return Ok(());
        }
        self.complete(false)?;
        self.mono = mono;
        Ok(())
    }

    pub fn set_shell_output(&mut self, show: bool) {
        self.shell_output = show;
    }

    pub fn set_image_preview(&mut self, show: bool) {
        self.image_preview = show;
    }

    /// Writes a snapshot, painted monochrome in mono mode (Core's `EXTERNAL_OUTPUT` hook).
    pub fn write(&self, snapshot: SplitSnapshot) -> Result<()> {
        if self.mono {
            mono_snapshot(&snapshot.buffer)?;
        }
        self.footer.write(snapshot)
    }

    /// Paints `widget` (built with [`Self::app`]) into the scrollback in one piece.
    pub fn write_widget(&self, widget: &impl Widget, flags: Flags) -> Result<()> {
        let snapshot = self.scrollback.snapshot(
            widget,
            SnapshotOptions {
                start_on_new_line: flags.start_on_new_line,
                trailing_newline: flags.trailing_newline,
                ..SnapshotOptions::default()
            },
        )?;
        self.write(snapshot)
    }

    /// The detached app scrollback widgets are built with.
    pub fn app(&self) -> &App {
        self.scrollback.app()
    }

    /// Forgets what was written, after the terminal was cleared for a replay (`resetForReplay`).
    pub fn reset(&mut self, wrote: bool) {
        self.active = None;
        self.tail = None;
        self.rendered = None;
        self.wrote = wrote;
    }

    /// `append`.
    pub fn append(&mut self, commit: Commit) -> Result<()> {
        let same = same_group(self.tail.as_ref(), &commit);
        if !same || commit.image.is_some() {
            self.finish_active(false)?;
        }
        if let Some(summary) = &commit.summary {
            self.write_spacer(1)?;
            let widget = self.summary_widget(summary);
            self.write_widget(&widget, entry_flags(&commit))?;
            self.rendered = Some(commit.clone());
            self.tail = Some(commit);
            return Ok(());
        }
        if commit.image.is_some() && self.image_preview && !self.mono {
            self.write_image(&commit)?;
            self.tail = Some(commit);
            return Ok(());
        }
        let body = entry_body(&commit, BodyOptions { shell_output: self.shell_output, mono: self.mono });
        if body == Body::None {
            if entry_done(&commit) {
                self.finish_active(false)?;
            }
            self.tail = Some(commit);
            return Ok(());
        }
        let streams = entry_can_stream(&commit, &body)
            || (commit.kind == EntryKind::Tool && commit.phase == Phase::Final && matches!(body, Body::Markdown(_)));
        if !matches!(body, Body::Structured(_)) && streams {
            self.write_streaming(&commit, body)?;
            if entry_done(&commit) {
                self.finish_active(entry_flags(&commit).trailing_newline)?;
            }
            self.tail = Some(commit);
            return Ok(());
        }
        if same {
            self.finish_active(false)?;
        }
        let rows = separator_rows(self.rendered.as_ref(), &commit, &body);
        let spaced = if rows > 0 { rows } else { u32::from(self.rendered.is_none() && self.wrote) };
        self.write_spacer(spaced)?;
        let body = static_body(&commit, body, spaced);
        let widget = self.entry_widget(&commit, &body);
        self.write_widget(&widget, entry_flags(&commit))?;
        self.rendered = Some(commit.clone());
        self.tail = Some(commit);
        Ok(())
    }

    /// Ends the streaming entry, committing its last rows (`complete`).
    pub fn complete(&mut self, trailing_newline: bool) -> Result<()> {
        self.finish_active(trailing_newline)
    }

    /// Whether an entry is still streaming.
    pub fn streaming(&self) -> bool {
        self.active.is_some()
    }

    /// `writeImage`: the caption, then the picture fitted to the terminal's width and the rows above the footer,
    /// or `No preview` when it does not decode.
    fn write_image(&mut self, commit: &Commit) -> Result<()> {
        let body = entry_body(commit, BodyOptions { shell_output: self.shell_output, mono: self.mono });
        let Body::Text(caption) = &body else { return Ok(()) };
        let app = self.scrollback.app().clone();
        let image = commit
            .image
            .as_deref()
            .and_then(crate::prompt::images::data_uri)
            .and_then(|bytes| opentui::native::Image::decode(app.session().context(), &bytes).ok());
        let text = if image.is_some() { caption.clone() } else { format!("{caption}\nNo preview") };
        let (fg, attributes) = entry_look(commit, &self.theme);
        let (width, rows) = self.footer.terminal_size();
        let caption_rows: u32 = text
            .split('\n')
            .map(|line| (unicode_width::UnicodeWidthStr::width(line) as u32).div_ceil(u32::from(width).max(1)).max(1))
            .sum();
        let column = View::new(&app)
            .column()
            .width(Length::Percent(100.0))
            .child(&Text::new(&app, text).wrap(WrapMode::Word).fg(fg).attributes(attributes).shrink(0.0));
        if let Some(image) = image
            && let Ok(info) = image.info()
        {
            let available = u32::from(rows).saturating_sub(u32::from(self.footer.renderer_size().1) + caption_rows);
            let (cells, lines) = fit_image(info.width, info.height, u32::from(width), available);
            if cells > 0 && lines > 0 {
                let view = opentui::widget::ImageView::new(&app)
                    .image(Some(image))
                    .protocol(opentui::native::ImageProtocol::Blocks)
                    .width(cells)
                    .height(lines)
                    .shrink(0.0);
                column.add(&view);
            }
        }
        let rows = separator_rows(self.rendered.as_ref(), commit, &body);
        self.write_spacer(if rows > 0 { rows } else { u32::from(self.rendered.is_none() && self.wrote) })?;
        self.write_widget(&column, entry_flags(commit))?;
        self.rendered = Some(commit.clone());
        Ok(())
    }

    fn write_spacer(&mut self, rows: u32) -> Result<()> {
        if rows == 0 {
            return Ok(());
        }
        let spacer = Text::new(self.scrollback.app(), "");
        self.write_widget(&spacer, Flags { start_on_new_line: true, trailing_newline: true })?;
        self.wrote = false;
        Ok(())
    }

    fn write_streaming(&mut self, commit: &Commit, body: Body) -> Result<()> {
        let kind = std::mem::discriminant(&body);
        let reuse =
            self.active.as_ref().is_some_and(|active| same_group(Some(&active.commit), commit) && active.kind == kind);
        if !reuse {
            self.finish_active(false)?;
            self.active = Some(self.create_entry(commit, &body)?);
        }
        let mono = self.mono;
        let active = self.active.as_mut().expect("an active entry");
        active.commit = commit.clone();
        let text = match body {
            Body::Text(text) | Body::Markdown(text) => text,
            Body::Code { content, .. } => content,
            Body::None | Body::Structured(_) => String::new(),
        };
        active.content.push_str(&if mono { mono_text(&text) } else { text });
        self.flush_active(false, false)?;
        if self.active.as_ref().is_some_and(|active| active.rendered) {
            self.rendered = self.active.as_ref().map(|active| active.commit.clone());
        }
        Ok(())
    }

    fn create_entry(&self, commit: &Commit, body: &Body) -> Result<Active> {
        let surface = self.scrollback.surface(entry_flags(commit).start_on_new_line)?;
        let widget = match body {
            Body::Text(_) => {
                let (fg, attributes) = entry_look(commit, &self.theme);
                let text = Text::new(self.scrollback.app(), "").wrap(WrapMode::Word).fg(fg).attributes(attributes);
                surface.root().add(&text);
                Stream::Text(text)
            }
            _ => {
                let markdown = self.markdown(commit, body, true);
                surface.root().add(&markdown);
                Stream::Markdown(markdown)
            }
        };
        let rows = separator_rows(self.rendered.as_ref(), commit, body);
        Ok(Active {
            commit: commit.clone(),
            kind: std::mem::discriminant(body),
            surface,
            widget,
            content: String::new(),
            committed_rows: 0,
            pending_spacer_rows: if rows > 0 { rows } else { u32::from(self.rendered.is_none() && self.wrote) },
            rendered: false,
        })
    }

    /// Commits the rows that can no longer change. Text and code keep their last row open while streaming. The
    /// Markdown widget does not expose its block positions, so a streaming Markdown entry renders only its complete
    /// blocks (up to the last blank line outside a fence) and commits those.
    fn flush_active(&mut self, done: bool, trailing_newline: bool) -> Result<bool> {
        let Some(active) = self.active.as_mut() else {
            return Ok(false);
        };
        let target = match &active.widget {
            Stream::Text(text) => {
                text.set_text(active.content.clone());
                active.surface.render()?;
                let height = active.surface.height();
                if done { height } else { active.committed_rows.max(height.saturating_sub(1)) }
            }
            Stream::Markdown(markdown) => {
                let content = if done { active.content.as_str() } else { stable_prefix(&active.content) };
                if content.is_empty() {
                    return Ok(false);
                }
                markdown.set_markdown(content);
                markdown.streaming(!done);
                active.surface.render()?;
                active.surface.height()
            }
        };
        if target <= active.committed_rows {
            return Ok(false);
        }
        let spacer = std::mem::take(&mut active.pending_spacer_rows);
        let trailing = done && target == active.surface.height() && trailing_newline;
        let snapshot = active.surface.commit_rows(active.committed_rows, target, None, trailing)?;
        active.committed_rows = target;
        active.rendered = true;
        self.write_spacer(spacer)?;
        if let Some(snapshot) = snapshot {
            self.write(snapshot)?;
        }
        Ok(true)
    }

    fn finish_active(&mut self, trailing_newline: bool) -> Result<()> {
        if self.active.is_none() {
            return Ok(());
        }
        let result = self.flush_active(true, trailing_newline);
        let active = self.active.take().expect("an active entry");
        if active.rendered {
            self.rendered = Some(active.commit);
        }
        result.map(drop)
    }

    /// The widget of a finished entry (`RunEntryContent`).
    pub fn entry_widget(&self, commit: &Commit, body: &Body) -> AnyWidget {
        let app = self.scrollback.app();
        let theme = &self.theme;
        if commit.compaction {
            let rule = |app: &App| View::new(app).border_sides(Sides::TOP).border_color(theme.block.muted).grow(1.0);
            let label = View::new(app).padding_x(1).child(&Text::new(app, commit.text.clone()).fg(theme.block.muted));
            return View::new(app)
                .direction(FlexDirection::Row)
                .align_items(Align::Center)
                .child(&rule(app))
                .child(&label)
                .child(&rule(app))
                .as_any();
        }
        match body {
            Body::Text(content) => {
                let (fg, attributes) = entry_look(commit, theme);
                Text::new(app, content.clone()).wrap(WrapMode::Word).fg(fg).attributes(attributes).as_any()
            }
            Body::Markdown(content) | Body::Code { content, .. } => {
                let markdown = self.markdown(commit, body, false);
                markdown.set_markdown(content.clone());
                markdown.as_any()
            }
            Body::Structured(snapshot) => tools::structured_widget(app, snapshot, theme, self.mono),
            Body::None => Text::new(app, "").as_any(),
        }
    }

    /// Markdown for assistant text, and for code bodies in Markdown such as reasoning. Code in other languages is
    /// M.4's (tool output); it renders as Markdown text here.
    fn markdown(&self, commit: &Commit, body: &Body, streaming: bool) -> Markdown {
        let app = self.scrollback.app();
        let theme = &self.theme;
        let color = entry_color(commit, theme);
        let code = matches!(body, Body::Code { .. });
        // A code body draws in one color (`<code fg>`); the conceal of the TS view hides its markers.
        let (colors, syntax) = if code || theme.syntax.is_none() {
            (
                MarkdownColors {
                    text: color,
                    heading: color,
                    emphasis: color,
                    code: color,
                    code_bg: Color::TRANSPARENT,
                    link: color,
                    quote: color,
                    marker: color,
                    rule: color,
                },
                SyntaxTheme::new().first_part_fallback().style("default", Style::new().fg(color)),
            )
        } else {
            (MarkdownColors { text: color, ..theme.markdown }, theme.syntax.clone().unwrap_or_default())
        };
        let table = if self.mono {
            MarkdownTableOptions {
                style: MarkdownTableStyle::Columns,
                width_mode: Some(ColumnWidthMode::Content),
                borders: Some(false),
                ..MarkdownTableOptions::default()
            }
        } else {
            MarkdownTableOptions { width_mode: Some(ColumnWidthMode::Content), ..MarkdownTableOptions::default() }
        };
        let syntax = if code { recolor(syntax, color) } else { syntax };
        opencode_ui::grammars::register();
        Markdown::new(app)
            .colors(colors)
            .syntax_theme(syntax)
            .scope_styles(true)
            .conceal(true)
            .table_options(table)
            .streaming(streaming)
    }

    fn summary_widget(&self, summary: &TurnSummary) -> Text {
        let theme = &self.theme;
        let dot = if self.mono { "-" } else { "·" };
        Text::new(
            self.scrollback.app(),
            vec![
                summary.agent.clone().fg(theme.block.text),
                format!(" {dot} {} {dot} {}", summary.model, summary.duration).fg(theme.block.muted),
            ],
        )
        .wrap(WrapMode::None)
        .truncate(true)
    }
}

/// Every style of `syntax` in `color`, keeping attributes.
fn recolor(mut syntax: SyntaxTheme, color: Color) -> SyntaxTheme {
    let names: Vec<String> = syntax.names().map(str::to_owned).collect();
    for name in names {
        if let Some(style) = syntax.get(&name) {
            syntax.set(name, style.fg(color));
        }
    }
    syntax
}

/// `getFittedSize`: the largest cell rectangle of the image's aspect within `width` by `height`, with cells twice
/// as tall as wide.
pub fn fit_image(pixels_wide: u32, pixels_high: u32, width: u32, height: u32) -> (u32, u32) {
    if pixels_wide == 0 || pixels_high == 0 || width == 0 || height == 0 {
        return (0, 0);
    }
    let aspect = f64::from(pixels_high) / f64::from(pixels_wide) / 2.0;
    let lines = (f64::from(width) * aspect).round().max(1.0);
    if lines <= f64::from(height) {
        return (width, lines as u32);
    }
    let cells = (f64::from(height) / aspect).round().clamp(1.0, f64::from(width));
    (cells as u32, height)
}

/// `staticBody`: a completed tool's output already spaced from its title drops its leading newline.
fn static_body(commit: &Commit, body: Body, spaced: u32) -> Body {
    match body {
        Body::Text(content)
            if spaced > 0
                && commit.kind == EntryKind::Tool
                && commit.phase == Phase::Progress
                && commit.tool_state == Some(ToolState::Completed)
                && content.starts_with('\n') =>
        {
            Body::Text(content[1..].to_owned())
        }
        body => body,
    }
}

/// The complete Markdown blocks of streaming `content`: everything before its last blank line outside a fence.
pub fn stable_prefix(content: &str) -> &str {
    let mut fence: Option<&str> = None;
    let mut end = 0;
    let mut offset = 0;
    let mut previous_blank = false;
    for line in content.split_inclusive('\n') {
        let trimmed = line.trim_start();
        let marker = ["```", "~~~"].into_iter().find(|marker| trimmed.starts_with(marker));
        match (fence, marker) {
            (None, Some(marker)) => fence = Some(marker),
            (Some(open), Some(marker)) if open == marker => fence = None,
            _ => {}
        }
        let blank = line.trim().is_empty() && line.ends_with('\n');
        if blank && fence.is_none() && !previous_blank && offset > 0 {
            end = content[..offset].trim_end_matches('\n').len();
        }
        previous_blank = blank;
        offset += line.len();
    }
    &content[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assistant(text: &str, phase: Phase) -> Commit {
        Commit::new(EntryKind::Assistant, Source::Assistant, phase, text).message("msg_a").part_id("text:0")
    }

    #[test]
    fn bodies_follow_entry_body() {
        let options = BodyOptions::default();
        let user = Commit::new(EntryKind::User, Source::System, Phase::Start, "\nhello");
        assert_eq!(entry_body(&user, options), Body::Text("\n› hello".into()));
        let mono = BodyOptions { mono: true, ..options };
        assert_eq!(entry_body(&user, mono), Body::Text("\n> hello".into()));
        let blank = Commit::new(EntryKind::User, Source::System, Phase::Start, "  ");
        assert_eq!(entry_body(&blank, options), Body::None);
        assert_eq!(entry_body(&assistant("**hi**", Phase::Progress), options), Body::Markdown("**hi**".into()));
        assert_eq!(entry_body(&assistant("", Phase::Final), options), Body::None);
        let mut interrupted = assistant("", Phase::Final);
        interrupted.interrupted = true;
        assert_eq!(entry_body(&interrupted, options), Body::Text("assistant interrupted".into()));
        let reasoning =
            Commit::new(EntryKind::Reasoning, Source::Reasoning, Phase::Progress, "Thinking:   a [REDACTED]plan");
        assert_eq!(
            entry_body(&reasoning, options),
            Body::Code { content: "_Thinking:_ a plan".into(), filetype: Some("markdown".into()) }
        );
        assert_eq!(entry_body(&reasoning, mono), Body::Text("Thinking: a plan".into()));
        let system = Commit::system("  → done \n");
        assert_eq!(entry_body(&system, mono), Body::Text("-> done".into()));
    }

    #[test]
    fn flags_and_separators() {
        let user = Commit::new(EntryKind::User, Source::System, Phase::Start, "q");
        assert_eq!(entry_flags(&user), Flags { start_on_new_line: true, trailing_newline: false });
        let progress = assistant("a", Phase::Progress);
        assert!(!entry_flags(&progress).start_on_new_line);
        assert_eq!(separator_rows(None, &user, &Body::None), 0);
        assert_eq!(separator_rows(Some(&user), &progress, &Body::None), 1);
        assert_eq!(separator_rows(Some(&progress), &assistant("b", Phase::Progress), &Body::None), 0);
        assert!(same_group(Some(&progress), &assistant("b", Phase::Final)));
        assert!(!same_group(Some(&user), &user));
    }

    #[test]
    fn images_fit_the_width_or_the_rows_left() {
        assert_eq!(fit_image(200, 100, 40, 30), (40, 10));
        assert_eq!(fit_image(100, 400, 40, 30), (15, 30));
        assert_eq!(fit_image(0, 10, 40, 30), (0, 0));
    }

    #[test]
    fn the_stable_prefix_ends_at_the_last_blank_line_outside_a_fence() {
        assert_eq!(stable_prefix("one line"), "");
        assert_eq!(stable_prefix("a\n\nb"), "a");
        assert_eq!(stable_prefix("a\n\nb\n\n\nc"), "a\n\nb");
        assert_eq!(stable_prefix("a\n\n```\nx\n\ny"), "a");
        assert_eq!(stable_prefix("a\n\n```\nx\n\n```\n\nz"), "a\n\n```\nx\n\n```");
        assert_eq!(stable_prefix("\n\nlead"), "");
    }
}
