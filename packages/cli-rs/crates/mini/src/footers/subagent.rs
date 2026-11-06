//! The subagent inspector (`footer.subagent.tsx`): the selected child's status, title, and transcript, which
//! sticks to its end as entries arrive, with the hints to go back, interrupt it, scroll, and step to the next.

use std::cell::Cell;
use std::rc::Rc;

use opencode_ui::motion::{SPINNER_FRAMES, Spinner};
use opentui::prelude::*;
use opentui::widget::ScrollEdge;
use unicode_width::UnicodeWidthStr;

use crate::prompt::menu::fit;
use crate::scrollback::{Body as Entry, BodyOptions, Commit, entry_body, entry_content, separator_rows};
use crate::subagents::{Status, Tab};
use crate::theme::{FooterTheme, RunTheme};

/// `SUBAGENT_INSPECTOR_ROWS`: the inspector's rows above the footer's base.
pub const INSPECTOR_ROWS: u16 = 14;

/// Everything the inspector draws from.
pub struct Body<'a> {
    pub tab: Option<&'a Tab>,
    /// The tab's place, from 1, and the number of tabs.
    pub index: usize,
    pub total: usize,
    /// `None` until the child's transcript is listed.
    pub commits: Option<&'a [Commit]>,
    /// The interrupt key, shown while the child runs.
    pub interrupt: Option<String>,
    pub shell_output: bool,
    pub theme: &'a RunTheme,
    pub mono: bool,
    /// The inspector's size inside its border.
    pub width: u16,
    pub height: u16,
}

/// The inspector's widgets, kept while it is open so the scroll position and the spinner live on.
pub struct Inspector {
    root: View,
    body: View,
    header: View,
    icon: View,
    spinner: Option<(Spinner, Color)>,
    title: Text,
    hint: Text,
    count: Text,
    scroll: ScrollBox,
    /// A full-height thumb while the transcript fits (the scrollbar shows always); the scroll box's own scrollbar
    /// takes over once it overflows.
    thumb: View,
    mono: Rc<Cell<bool>>,
    content: View,
    bottom: View,
}

impl Inspector {
    pub fn new(app: &App) -> Self {
        let muted = || Text::new(app, "").wrap(WrapMode::None).shrink(0.0);
        let icon = View::new(app).shrink(0.0);
        let title = Text::new(app, "").wrap(WrapMode::None).grow(1.0).shrink(1.0).basis(Length::Auto);
        let (hint, count) = (muted(), muted());
        let header = View::new(app)
            .row()
            .width(Length::percent(100.0))
            .gap(1)
            .shrink(0.0)
            .child(&icon)
            .child(&title)
            .child(&hint)
            .child(&count);
        let content = View::new(app).column().width(Length::percent(100.0)).shrink(0.0);
        let scroll = ScrollBox::new(app)
            .width(Length::percent(100.0))
            .grow(1.0)
            .basis(Length::Auto)
            .min_height(0)
            .sticky(true)
            .sticky_start(ScrollEdge::Bottom);
        scroll.add(&content);
        let thumb = View::new(app).width(1).shrink(0.0).border_sides(Sides::LEFT).border_chars(Some(['█'; 11]));
        let frame = View::new(app)
            .row()
            .width(Length::percent(100.0))
            .grow(1.0)
            .basis(Length::Auto)
            .min_height(0)
            .child(&scroll)
            .child(&thumb);
        let mono = Rc::new(Cell::new(false));
        let fits = {
            let (thumb, content, viewport) = (thumb.clone(), content.clone(), scroll.wrapper_view().clone());
            let mono = mono.clone();
            move |_: &mut Cx<'_>, _: &Rect| {
                thumb.visible(!mono.get() && content.rect().height <= viewport.rect().height);
            }
        };
        content.on_resize(fits.clone());
        scroll.wrapper_view().on_resize(fits);
        let bottom = View::new(app).row().flex_wrap(Wrap::Wrap).column_gap(1).width(Length::percent(100.0)).shrink(0.0);
        let body = View::new(app)
            .column()
            .grow(1.0)
            .shrink(1.0)
            .basis(Length::Auto)
            .min_height(0)
            .min_width(0)
            .child(&header)
            .child(&frame)
            .child(&bottom);
        let root =
            View::new(app).row().width(Length::percent(100.0)).grow(1.0).basis(Length::Auto).min_height(0).child(&body);
        Self { root, body, header, icon, spinner: None, title, hint, count, scroll, thumb, mono, content, bottom }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    /// `scroll?.scrollBy(±1)`, or a page with `page`.
    pub fn scroll(&self, down: bool, page: bool) {
        let step = if page { f64::from(self.scroll.wrapper_view().rect().height.max(1.0)) } else { 1.0 };
        self.scroll.scroll_by(0.0, if down { step } else { -step });
    }

    /// `RunFooterSubagentBody`.
    pub fn paint(&mut self, app: &App, body: &Body<'_>) {
        let theme = &body.theme.footer;
        let mono = body.mono;
        let width = usize::from(body.width);
        let compact = body.width < 56 || body.height < 12;
        self.root
            .border_sides(Sides::LEFT)
            .border_chars(Some([if mono { '|' } else { '┃' }; 11]))
            .border_color(theme.border);
        let (top, left, right) = if compact { (0, 0, 0) } else { (1, 1, 3) };
        self.body
            .bg(theme.surface)
            .padding_edge(Edge::Top, top)
            .padding_edge(Edge::Bottom, top)
            .padding_edge(Edge::Left, left)
            .padding_edge(Edge::Right, right);
        self.scroll
            .scrollbars(!mono)
            .scrollbar_colors(theme.line, theme.surface)
            .content_view()
            .padding_edge(Edge::Right, if mono { 0 } else { 1 });
        self.mono.set(mono);
        let overflow = self.content.rect().height > self.scroll.wrapper_view().rect().height;
        self.thumb.bg(theme.surface).border_color(theme.line).visible(!mono && !overflow);

        let interrupt = body.interrupt.clone().filter(|_| body.tab.is_some_and(|tab| tab.status == Status::Running));
        let count =
            if body.total > 1 && body.index > 0 { format!("{} of {}", body.index, body.total) } else { String::new() };
        let controls = interrupt.as_ref().map_or(0, |hint| format!("{hint} interrupt").width() + 1)
            + if count.is_empty() { 0 } else { count.width() + 1 };
        let title = body.tab.map(|tab| {
            [tab.description.as_str(), tab.title.as_deref().unwrap_or_default(), tab.label.as_str()]
                .into_iter()
                .find(|text| !text.is_empty())
                .unwrap_or_default()
                .to_owned()
        });
        let title_text = title.clone().unwrap_or_default();
        let header_controls = !compact && title_text.width() + 2 + controls <= width.saturating_sub(4);
        let title_width =
            width.saturating_sub(if compact { 2 } else { 6 } + if header_controls { controls } else { 0 }).max(1);

        self.paint_header(app, body, theme, title.as_deref(), title_width, compact);
        self.hint.set_text(interrupt.as_ref().map(|hint| format!("{hint} interrupt")).unwrap_or_default());
        self.hint.fg(theme.muted).visible(header_controls && interrupt.is_some());
        self.count.set_text(count.clone()).fg(theme.muted).visible(header_controls && !count.is_empty());

        self.content.clear();
        match body.commits.filter(|commits| !commits.is_empty()) {
            None => {
                self.content.add(
                    &Text::new(app, "No subagent activity yet")
                        .fg(theme.muted)
                        .wrap(WrapMode::Word)
                        .width(Length::percent(100.0))
                        .shrink(0.0),
                );
            }
            Some(commits) => {
                let options = BodyOptions { shell_output: body.shell_output, mono };
                let mut previous: Option<&Commit> = None;
                for commit in commits {
                    let entry = entry_body(commit, options);
                    let row = View::new(app).column().width(Length::percent(100.0)).shrink(0.0);
                    if separator_rows(previous, commit, &entry_body(commit, BodyOptions::default())) > 0 {
                        row.add(&View::new(app).height(1).shrink(0.0));
                    }
                    if entry != Entry::None || commit.compaction {
                        row.add(&entry_content(app, body.theme, mono, commit, &entry));
                    }
                    self.content.add(&row);
                    previous = Some(commit);
                }
            }
        }

        self.bottom.clear();
        self.bottom.visible(!header_controls);
        if !header_controls {
            let hint =
                |text: String, color: Color| Text::new(app, text).fg(color).wrap(WrapMode::None).height(1).shrink(0.0);
            self.bottom.add(&hint("esc back".into(), theme.action_secondary_text));
            if let Some(key) = &interrupt {
                let verb = if width >= key.width() + 10 { "interrupt" } else { "stop" };
                self.bottom.add(&Text::new(app, format!("{key} {verb}")).fg(theme.action_secondary_text).shrink(0.0));
            }
            if width >= 56 {
                self.bottom.add(&hint("pgup/pgdn scroll".into(), theme.muted));
                if body.total > 1 && body.index > 0 {
                    self.bottom
                        .add(&hint(format!("tab next {}/{}", body.index, body.total), theme.action_secondary_text));
                }
            }
        }
    }

    fn paint_header(
        &mut self,
        app: &App,
        body: &Body<'_>,
        theme: &FooterTheme,
        title: Option<&str>,
        title_width: usize,
        compact: bool,
    ) {
        let Some(tab) = body.tab else {
            self.header.visible(false);
            return;
        };
        self.header
            .visible(true)
            .height(if compact { 1 } else { 2 })
            .padding_edge(Edge::Bottom, if compact { 0 } else { 1 });
        let color = match tab.status {
            Status::Completed => theme.success,
            Status::Cancelled => theme.muted,
            Status::Error => theme.error,
            Status::Running => theme.running,
        };
        if tab.status == Status::Running {
            match &mut self.spinner {
                Some((spinner, current)) => {
                    if *current != color {
                        spinner.set_color(color);
                        *current = color;
                    }
                }
                None => {
                    let spinner = if body.mono {
                        Spinner::new(app).frames(&["-", "\\", "|", "/"]).interval(std::time::Duration::from_millis(160))
                    } else {
                        Spinner::new(app).frames(&SPINNER_FRAMES)
                    }
                    .color(color);
                    self.icon.clear();
                    self.icon.add(&spinner);
                    self.spinner = Some((spinner, color));
                }
            }
        } else {
            self.spinner = None;
            let icon = match (tab.status, body.mono) {
                (Status::Completed, false) => "●",
                (Status::Completed, true) => "*",
                (Status::Cancelled, false) => "○",
                (Status::Cancelled, true) => "-",
                (Status::Error, false) => "◍",
                (Status::Error, true) => "!",
                (Status::Running, _) => unreachable!(),
            };
            self.icon.clear();
            self.icon.add(&Text::new(app, icon).fg(color).wrap(WrapMode::None).truncate(true).shrink(0.0));
        }
        let title = title.unwrap_or_default();
        let subtitle = if title == tab.label { "" } else { tab.label.as_str() };
        let mut spans = vec![fit(title, title_width, body.mono).fg(theme.text)];
        if !subtitle.is_empty() && title_width >= title.width() + subtitle.width() + 2 {
            spans.push(format!("  {subtitle}").fg(theme.muted));
        }
        self.title.set_text(spans);
    }
}
