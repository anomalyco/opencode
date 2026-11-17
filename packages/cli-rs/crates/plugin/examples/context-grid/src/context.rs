//! What the grid shows, as TS's `data.ts`, `breakdown.ts`, `grid.ts` and `format.ts` compute it: the context the last
//! assistant step used, against its model's window, split by an estimate of where it came from.

use opencode_plugin_abi::types::{
    ModelInfo, SessionInfo, SessionMessageAssistantContentItem as Part, SessionMessageAssistantToolState as State,
    SessionMessageCompaction, SessionMessageInfo, TokenUsageInfo, ToolContent,
};

/// A category of the estimate, in its order on the grid; `Free` is the window left.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    System,
    User,
    Assistant,
    Tool,
    Other,
    Free,
}

impl Key {
    /// TS `categoryColor`: a categorical hue's step 400 by the category's place, muted for the free space.
    pub fn color(self) -> &'static str {
        match self {
            Key::System => "categorical.0.400",
            Key::User => "categorical.1.400",
            Key::Assistant => "categorical.2.400",
            Key::Tool => "categorical.3.400",
            Key::Other => "categorical.4.400",
            Key::Free => "text.muted",
        }
    }

    /// TS `CATEGORY_LABEL`.
    pub fn label(self) -> &'static str {
        match self {
            Key::System => "System",
            Key::User => "User",
            Key::Assistant => "Assistant",
            Key::Tool => "Tools",
            Key::Other => "Other",
            Key::Free => "Free space",
        }
    }
}

pub const GLYPH_FULL: &str = "⛁";
pub const GLYPH_PARTIAL: &str = "⛀";
pub const GLYPH_FREE: &str = "⛶";

/// TS `getContextData`'s result.
pub struct Context {
    pub model: String,
    pub tokens: f64,
    pub limit: f64,
    pub percent: Option<f64>,
    pub cost: f64,
    pub segments: Vec<(Key, f64)>,
}

/// TS `getContextData`: the last assistant step with usage, after the last finished compaction and before the
/// session's revert point; `None` without one, or with no tokens.
pub fn context(
    messages: &[SessionMessageInfo],
    session: Option<&SessionInfo>,
    models: &[ModelInfo],
) -> Option<Context> {
    let (last, tokens) = last_with_usage(
        messages,
        session.and_then(|session| session.revert.as_ref()).map(|revert| revert.message_id.0.as_str()),
    )?;
    let total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
    if total == 0.0 {
        return None;
    }
    let provider = &last.model.provider_id.0;
    let model = models.iter().find(|model| {
        model.provider_id.0 == *provider && (model.id == last.model.id || model.model_id == last.model.id)
    });
    let limit = model.map_or(0.0, |model| model.limit.context as f64);
    Some(Context {
        model: model.map_or_else(|| last.model.id.clone(), |model| model.name.clone()),
        tokens: total,
        limit,
        percent: (limit != 0.0).then(|| js_round(total / limit * 100.0)),
        cost: session.map_or(0.0, |session| session.cost),
        segments: breakdown(messages, total, residual(messages)),
    })
}

/// TS `lastAssistantWithUsage`.
fn last_with_usage<'a>(
    messages: &'a [SessionMessageInfo],
    boundary: Option<&str>,
) -> Option<(&'a opencode_plugin_abi::types::SessionMessageAssistant, &'a TokenUsageInfo)> {
    let end = match boundary {
        Some(boundary) => messages.iter().position(|message| message.id() == boundary)?,
        None => messages.len(),
    };
    let compaction = messages[..end]
        .iter()
        .rposition(|message| matches!(message, SessionMessageInfo::Compaction(SessionMessageCompaction::Completed(_))));
    let start = compaction.map_or(0, |index| index + 1);
    messages[start..end].iter().rev().find_map(|message| match message {
        SessionMessageInfo::Assistant(assistant) => Some((assistant, assistant.tokens.as_ref()?)),
        _ => None,
    })
}

/// TS `estimateTokens`.
fn estimate(chars: usize) -> f64 {
    (chars as f64 / 4.0).ceil()
}

/// A string's length as JavaScript counts it, in UTF-16 units.
fn length(text: &str) -> usize {
    text.encode_utf16().count()
}

/// TS `charsFromAssistantPart`: the characters of a step's part, as `(assistant, tool)`.
fn part_chars(part: &Part) -> (usize, usize) {
    let object = |keys: usize| keys * 16;
    let output = |content: &[ToolContent]| {
        content
            .iter()
            .map(|content| if let ToolContent::Text(text) = content { length(&text.text) } else { 0 })
            .sum::<usize>()
    };
    match part {
        Part::Text(text) => (length(&text.text), 0),
        Part::Reasoning(reasoning) => (length(&reasoning.text), 0),
        Part::Tool(tool) => match &tool.state {
            State::Streaming(state) => (0, length(&state.input)),
            State::Running(state) => (0, object(state.input.len())),
            State::Completed(state) => (0, object(state.input.len()) + output(&state.content)),
            State::Error(state) => {
                let error = serde_json::to_string(&state.error).map_or(0, |error| length(&error));
                (0, object(state.input.len()) + error)
            }
            State::Unknown(_) => (0, 0),
        },
        Part::Unknown(_) => (0, 0),
    }
}

/// TS `estimateSystemResidual`: the first step's input, less the users' text before it.
fn residual(messages: &[SessionMessageInfo]) -> Option<f64> {
    let mut leading = 0;
    for message in messages {
        match message {
            SessionMessageInfo::User(user) => leading += length(&user.text),
            SessionMessageInfo::Assistant(assistant) => {
                let Some(tokens) = &assistant.tokens else { continue };
                let first = tokens.input + tokens.cache.read + tokens.cache.write;
                if first <= 0.0 {
                    return None;
                }
                return Some((first - estimate(leading)).max(0.0));
            }
            _ => {}
        }
    }
    None
}

/// TS `estimateBreakdown`: the estimate by category, scaled down to `input` when it is over, the rest `Other`.
fn breakdown(messages: &[SessionMessageInfo], input: f64, system: Option<f64>) -> Vec<(Key, f64)> {
    if input == 0.0 {
        return Vec::new();
    }
    let (mut user, mut assistant, mut tool) = (0, 0, 0);
    for message in messages {
        match message {
            SessionMessageInfo::User(message) => user += length(&message.text),
            SessionMessageInfo::Assistant(message) => {
                for part in &message.content {
                    let (text, used) = part_chars(part);
                    assistant += text;
                    tool += used;
                }
            }
            _ => {}
        }
    }
    let tokens = [system.unwrap_or(0.0), estimate(user), estimate(assistant), estimate(tool)];
    let estimated: f64 = tokens.iter().sum();
    let (tokens, other) = match estimated <= input {
        true => (tokens, input - estimated),
        false => {
            let scale = input / estimated;
            let scaled = tokens.map(|count| (count * scale).floor());
            (scaled, (input - scaled.iter().sum::<f64>()).max(0.0))
        }
    };
    let keys = [Key::System, Key::User, Key::Assistant, Key::Tool, Key::Other];
    keys.into_iter().zip(tokens.into_iter().chain([other])).filter(|(_, count)| *count > 0.0).collect()
}

/// TS `computeGrid`: `total` squares of the window, each the category that covers most of it, filled or partly, then
/// the free ones.
pub fn grid(segments: &[(Key, f64)], limit: f64, total: usize) -> Vec<(Key, &'static str)> {
    if limit <= 0.0 || total == 0 {
        return Vec::new();
    }
    let square = limit / total as f64;
    let used = segments.iter().map(|(_, tokens)| tokens).sum::<f64>().min(limit);
    let mut pools: Vec<(Key, f64)> =
        segments.iter().filter(|(key, tokens)| *key != Key::Free && *tokens > 0.0).copied().collect();
    let free = (Key::Free, GLYPH_FREE);
    // TS moves each square's start on by the square's size, which a product would round otherwise.
    let mut start = 0.0;
    (0..total)
        .map(|_| {
            let begins = start;
            start += square;
            if begins >= used {
                return free;
            }
            let (mut dominant, mut most, mut covered) = (Key::Free, 0.0, 0.0);
            for (key, remaining) in &mut pools {
                if covered >= square {
                    break;
                }
                if *remaining <= 0.0 {
                    continue;
                }
                let overlap = remaining.min(square - covered);
                *remaining -= overlap;
                covered += overlap;
                if overlap > most {
                    (dominant, most) = (*key, overlap);
                }
            }
            match dominant {
                Key::Free => free,
                key => (key, if most / square >= 0.7 { GLYPH_FULL } else { GLYPH_PARTIAL }),
            }
        })
        .collect()
}

/// TS `formatTokens`: `1.2M`, `23.4k`, `987`.
pub fn tokens(count: f64) -> String {
    let trim = |value: f64| if value >= 100.0 { js_round(value) } else { js_round(value * 10.0) / 10.0 };
    match count {
        count if !count.is_finite() || count < 0.0 => "0".to_owned(),
        count if count >= 1e6 => format!("{}M", trim(count / 1e6)),
        count if count >= 1000.0 => format!("{}k", trim(count / 1000.0)),
        count => js_round(count).to_string(),
    }
}

/// TS `formatCost`, `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })`: `$1,234.50`.
pub fn cost(usd: f64) -> String {
    let cents = js_round(usd.abs() * 100.0) as u64;
    let dollars = (cents / 100).to_string();
    let mut grouped = String::new();
    for (index, digit) in dollars.chars().enumerate() {
        if index > 0 && (dollars.len() - index).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    format!("{}${grouped}.{:02}", if usd < 0.0 && cents > 0 { "-" } else { "" }, cents % 100)
}

/// TS `percentOf`'s `toFixed(1)`.
pub fn percent_of(tokens: f64, limit: f64) -> String {
    match limit != 0.0 {
        true => format!("{:.1}", js_round(tokens / limit * 1000.0) / 10.0),
        false => "0.0".to_owned(),
    }
}

/// JavaScript's `Math.round`: halves go up.
pub fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_and_cost_read_as_ts_formats_them() {
        let shown: Vec<String> =
            [0.0, 987.4, 1000.0, 22_870.0, 123_456.0, 1_250_000.0, 200_000.0].into_iter().map(tokens).collect();
        assert_eq!(shown, ["0", "987", "1k", "22.9k", "123k", "1.3M", "200k"]);
        assert_eq!([cost(0.0), cost(0.08), cost(1234.5), cost(0.125)], ["$0.00", "$0.08", "$1,234.50", "$0.13"]);
        assert_eq!([percent_of(25_000.0, 200_000.0), percent_of(1.0, 0.0)], ["12.5", "0.0"]);
    }

    #[test]
    fn the_grid_gives_each_square_its_main_category() {
        let segments = [(Key::System, 30.0), (Key::User, 15.0), (Key::Other, 5.0)];
        let squares: Vec<&str> = grid(&segments, 100.0, 10).into_iter().map(|(_, glyph)| glyph).collect();
        assert_eq!(squares, ["⛁", "⛁", "⛁", "⛁", "⛀", "⛶", "⛶", "⛶", "⛶", "⛶"]);
        let keys: Vec<Key> = grid(&segments, 100.0, 10).into_iter().take(5).map(|(key, _)| key).collect();
        assert_eq!(keys, [Key::System, Key::System, Key::System, Key::User, Key::User]);
    }
}
