//! Agent, model, variant, and usage labels below the prompt.

use std::sync::Arc;

use opencode_api::generated::{
    AgentInfo, CommandInfo, ConfigEntry, ConfigEntryDocumentInfoModel, ModelInfo, ModelRef, ProviderID, ProviderInfo,
};
use opencode_store::location::{Catalog as Read, Location};
use opencode_store::{Data, Parts, State, Task};
use opencode_ui::theme::Theme;
use opentui::prelude::*;
use unicode_width::UnicodeWidthStr;

use super::editor::Mode;

const READS: [Read; 6] = [Read::Agent, Read::Model, Read::Provider, Read::Config, Read::Command, Read::Vcs];

#[derive(Debug, Default)]
pub struct Catalog {
    pub agents: Arc<[AgentInfo]>,
    pub models: Arc<[ModelInfo]>,
    pub providers: Arc<[ProviderInfo]>,
    /// Server commands, for `/name args` submits.
    pub commands: Arc<[CommandInfo]>,
    pub branch: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Choice {
    pub provider_id: String,
    pub model_id: String,
    pub variant: Option<String>,
}

impl Choice {
    pub fn model_ref(&self) -> ModelRef {
        ModelRef {
            id: self.model_id.clone(),
            provider_id: ProviderID(self.provider_id.clone()),
            variant: self.variant.clone(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Selection {
    pub agent: AgentInfo,
    pub model: Option<Choice>,
}

pub fn sync(data: &Data, location: &Location) -> Vec<Task<()>> {
    READS.iter().map(|read| data.catalog_sync(*read, Some(location))).collect()
}

impl Catalog {
    /// What [`Catalog::read`] reads of a location.
    pub const READS: Parts = Parts::catalogs(&[Read::Agent, Read::Model, Read::Provider, Read::Command, Read::Vcs]);

    /// The same lists and branch as `other`. A list not read yet is a new empty one each time.
    pub fn same(&self, other: &Self) -> bool {
        fn same<T>(one: &Arc<[T]>, other: &Arc<[T]>) -> bool {
            Arc::ptr_eq(one, other) || one.is_empty() && other.is_empty()
        }
        same(&self.agents, &other.agents)
            && same(&self.models, &other.models)
            && same(&self.providers, &other.providers)
            && same(&self.commands, &other.commands)
            && self.branch == other.branch
    }

    /// The catalog of `location` once its agents and models are read (`promptDisplay` waits for
    /// both); the rest only label the selection.
    pub fn read(state: &State, location: &Location) -> Option<Self> {
        let data = state.location(Some(location))?;
        Some(Self {
            agents: data.agent.clone()?,
            models: data.model.clone()?,
            providers: data.provider.clone().unwrap_or_default(),
            commands: data.command.clone().unwrap_or_default(),
            branch: data.vcs.as_ref().and_then(|vcs| vcs.branch.current.clone()),
        })
    }

    pub fn available(&self, choice: &Choice) -> bool {
        self.info(&choice.provider_id, &choice.model_id).is_some()
    }

    fn info(&self, provider: &str, model: &str) -> Option<&ModelInfo> {
        self.models.iter().find(|info| info.provider_id.as_str() == provider && info.id == model)
    }

    pub fn labels(&self, choice: Option<&Choice>) -> (String, String) {
        let Some(choice) = choice else { return ("No provider selected".into(), "Connect a provider".into()) };
        let provider = self
            .providers
            .iter()
            .find(|provider| provider.id.as_str() == choice.provider_id)
            .map_or_else(|| choice.provider_id.clone(), |provider| provider.name.clone());
        let model = self
            .info(&choice.provider_id, &choice.model_id)
            .map_or_else(|| format!("{} (unavailable)", choice.model_id), |info| info.name.clone());
        (model, provider)
    }

    pub fn color(&self, theme: &Theme, id: &str) -> Option<Color> {
        let visible: Vec<_> = self.agents.iter().filter(|agent| !agent.hidden).collect();
        let index = visible.iter().position(|agent| agent.id.as_str() == id);
        if let Some(color) =
            index.and_then(|index| visible[index].color.as_ref()).and_then(|color| Color::parse(color.as_str()))
        {
            return Some(color);
        }
        let step = 400;
        let mut colors: Vec<Color> = Vec::new();
        for scale in theme.categorical() {
            let color = scale.step(step);
            if !colors.contains(&color) {
                colors.push(color);
            }
        }
        (!colors.is_empty()).then(|| colors[index.unwrap_or(0) % colors.len()])
    }
}

/// The last config document that sets `model`.
pub(crate) fn configured(entries: &[ConfigEntry]) -> Option<Choice> {
    entries.iter().rev().find_map(|entry| match entry {
        ConfigEntry::Document(document) => match document.info.model.as_ref()? {
            ConfigEntryDocumentInfoModel::String(value) => {
                let (provider, model) = value.split_once('/')?;
                Some(Choice { provider_id: provider.to_owned(), model_id: model.to_owned(), variant: None })
            }
            ConfigEntryDocumentInfoModel::Object(value) => Some(Choice {
                provider_id: value.provider_id.clone(),
                model_id: value.model.clone(),
                variant: value.variant.clone(),
            }),
            ConfigEntryDocumentInfoModel::Unknown(_) => None,
        },
        _ => None,
    })
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Display {
    pub agent: Option<String>,
    pub auto: bool,
    pub model: String,
    pub provider: String,
    pub variant: Option<String>,
    /// Remaining workspace allowance and its warning severity for the selected model.
    pub limit: Option<(String, bool)>,
}

pub struct Row {
    text: Text,
}

impl Row {
    pub fn new(app: &App) -> Self {
        Self { text: Text::new(app, "").truncate(true).wrap(WrapMode::None).min_height(1) }
    }

    pub fn root(&self) -> &Text {
        &self.text
    }

    pub fn set(&self, theme: &Theme, mode: Mode, display: &Display, highlight: Color, terminal_width: u16) {
        let spans: Vec<Span> = match mode {
            Mode::Shell => vec![display.agent.clone().unwrap_or_else(|| "Shell".into()).fg(highlight)],
            Mode::Normal if display.agent.is_none() => Vec::new(),
            Mode::Normal => {
                let width = usize::from(terminal_width).saturating_sub(if terminal_width < 44 { 9 } else { 13 });
                let layout = layout(width, terminal_width, display);
                let mut spans = Vec::new();
                if let Some(agent) = &layout.agent {
                    spans.push(agent.clone().fg(highlight));
                }
                // Leave gaps transparent so the color underneath remains visible.
                let gap = || " ".fg(Color::TRANSPARENT);
                if layout.auto {
                    spans.extend([gap(), "auto".fg(theme.text.muted)]);
                }
                if !layout.model.is_empty() {
                    if layout.agent.is_some() {
                        spans.extend([gap(), "·".fg(theme.text.muted), gap()]);
                    }
                    spans.push(layout.model.clone().fg(theme.text.base));
                    if !layout.provider.is_empty() {
                        spans.extend([gap(), layout.provider.clone().fg(theme.text.muted)]);
                    }
                    if let Some(variant) = layout.variant {
                        spans.extend([gap(), "·".fg(theme.text.muted), gap()]);
                        spans.push(variant.fg(theme.text.feedback.warning.base).bold());
                    }
                    if let Some((limit, danger)) = layout.limit {
                        let color = if danger { theme.text.feedback.error.base } else { theme.text.muted };
                        spans.extend([gap(), gap(), limit.fg(color)]);
                    }
                }
                spans
            }
        };
        self.text.set_text(spans);
    }
}

fn layout(width: usize, terminal_width: u16, display: &Display) -> Display {
    let narrow = terminal_width < 44;
    let agent = if narrow { None } else { display.agent.clone() };
    let provider = if narrow { String::new() } else { display.provider.clone() };
    let short = provider.rsplit(" / ").next().unwrap_or(&provider).to_owned();
    let full = Display { agent: agent.clone(), provider, ..display.clone() };
    let candidates = [
        full.clone(),
        Display { auto: false, ..full.clone() },
        Display { auto: false, provider: short, ..full.clone() },
        Display { auto: false, provider: String::new(), ..full },
    ];
    if let Some(fit) = candidates.into_iter().find(|candidate| flat(candidate).width() <= width) {
        return fit;
    }
    let prefix = agent.as_ref().map_or(0, |agent| format!("{agent} · ").width());
    let suffix = display.variant.as_ref().map_or(0, |variant| format!(" · {variant}").width())
        + display.limit.as_ref().map_or(0, |(limit, _)| format!("  {limit}").width());
    Display {
        agent,
        auto: false,
        model: truncate(&display.model, width.saturating_sub(prefix + suffix).max(9)),
        provider: String::new(),
        variant: display.variant.clone(),
        limit: display.limit.clone(),
    }
}

fn flat(layout: &Display) -> String {
    let mut parts: Vec<&str> = Vec::new();
    if let Some(agent) = &layout.agent {
        parts.push(agent);
    }
    if layout.auto {
        parts.push("auto");
    }
    if !layout.model.is_empty() {
        if layout.agent.is_some() {
            parts.push("·");
        }
        parts.push(&layout.model);
    }
    if !layout.provider.is_empty() {
        parts.push(&layout.provider);
    }
    if let Some(variant) = &layout.variant {
        parts.push("·");
        parts.push(variant);
    }
    let mut text = parts.join(" ");
    if let Some((limit, _)) = &layout.limit {
        text.push_str(&format!("  {limit}"));
    }
    text
}

/// `Locale.truncateWidth(text, width)` with the trailing space before `…` dropped.
fn truncate(text: &str, width: usize) -> String {
    if text.width() <= width {
        return text.to_owned();
    }
    let mut out = String::new();
    for character in text.chars() {
        if format!("{out}{character}").width() + 1 > width {
            break;
        }
        out.push(character);
    }
    format!("{}…", out.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(model: &str, provider: &str, variant: Option<&str>) -> Display {
        Display {
            agent: Some("Build".into()),
            auto: false,
            model: model.into(),
            provider: provider.into(),
            variant: variant.map(str::to_owned),
            limit: None,
        }
    }

    #[test]
    fn layout_drops_the_provider_before_it_truncates_the_model() {
        let full = display("Claude Sonnet", "OpenCode / Anthropic", Some("high"));
        assert_eq!(layout(80, 100, &full).provider, "OpenCode / Anthropic");
        assert_eq!(layout(40, 100, &full).provider, "Anthropic");
        assert_eq!(layout(30, 100, &full).provider, "");
        let narrow = layout(18, 100, &full);
        assert_eq!(narrow.model, "Claude S…");
        assert_eq!(layout(30, 40, &full).agent, None);
        // `auto` goes first.
        let auto = Display { auto: true, ..full };
        assert!(layout(80, 100, &auto).auto);
        let tight = layout(flat(&auto).width() - 1, 100, &auto);
        assert!(!tight.auto);
        assert_eq!(tight.provider, "OpenCode / Anthropic");
    }

    #[test]
    fn layout_keeps_the_limit_and_counts_it() {
        let full = Display {
            limit: Some(("$5 left".into(), false)),
            ..display("Claude Sonnet", "OpenCode / Anthropic", Some("high"))
        };
        assert_eq!(flat(&full), "Build · Claude Sonnet OpenCode / Anthropic · high  $5 left");
        // The provider goes before the limit does, and the model truncates around it.
        assert_eq!(layout(50, 100, &full).provider, "Anthropic");
        assert_eq!(layout(40, 100, &full).provider, "");
        let narrow = layout(30, 100, &full);
        assert_eq!(narrow.model, "Claude S…");
        assert_eq!(narrow.limit, full.limit);
    }
}
