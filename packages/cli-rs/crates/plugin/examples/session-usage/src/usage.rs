//! TS `src/usage.ts` and `src/estimate.ts`: catalog prices, meter severity, reset countdowns, bars, and what a session
//! tree cost.

use opencode_plugin_abi::types::{ModelCost, ModelInfo, SessionMessageInfo, TokenUsageInfo};

/// TS `TICK_MS`: the countdowns move, and the throttled read may run, this often.
pub const TICK_MS: u64 = 15_000;

/// `Math.round`: halves go up.
pub fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

/// TS `catalogCost`: what `tokens` cost at the most specific context tier the context exceeds, else the base price.
pub fn catalog_cost(costs: &[ModelCost], tokens: Option<&TokenUsageInfo>) -> f64 {
    let Some(tokens) = tokens else { return 0.0 };
    let context = tokens.input + tokens.cache.read + tokens.cache.write;
    // The largest such tier, the first of equals, as a stable sort by size, descending, takes it.
    let tier = costs
        .iter()
        .filter_map(|cost| Some((cost, cost.tier.as_ref()?)))
        .filter(|(_, tier)| tier.r#type == "context" && context > tier.size as f64)
        .fold(None, |best: Option<(&ModelCost, i64)>, (cost, tier)| match best {
            Some((_, size)) if size >= tier.size => best,
            _ => Some((cost, tier.size)),
        })
        .map(|(cost, _)| cost);
    let Some(price) = tier.or_else(|| costs.iter().find(|cost| cost.tier.is_none())) else { return 0.0 };
    (tokens.input * price.input
        + (tokens.output + tokens.reasoning) * price.output
        + tokens.cache.read * price.cache.read
        + tokens.cache.write * price.cache.write)
        / 1_000_000.0
}

/// TS `sessionCost`: the costs the provider reported, when any is positive, else the catalog estimate.
pub fn session_cost(messages: &[SessionMessageInfo], models: &[ModelInfo]) -> f64 {
    let (mut reported, mut catalog, mut has_reported) = (0.0, 0.0, false);
    for message in messages {
        let SessionMessageInfo::Assistant(message) = message else { continue };
        let cost = message.cost.unwrap_or(0.0);
        if cost > 0.0 {
            has_reported = true;
            reported += cost;
        }
        let model =
            models.iter().find(|model| model.provider_id == message.model.provider_id && model.id == message.model.id);
        if let Some(model) = model {
            catalog += catalog_cost(&model.cost, message.tokens.as_ref());
        }
    }
    if has_reported { reported } else { catalog }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    Success,
    Warning,
    Error,
}

impl Severity {
    /// TS `theme.text.feedback[severity].base`.
    pub fn color(self) -> &'static str {
        match self {
            Severity::Success => "text.feedback.success.base",
            Severity::Warning => "text.feedback.warning.base",
            Severity::Error => "text.feedback.error.base",
        }
    }
}

/// TS `usageSeverity`: `limited` wins, then the thresholds, inclusive.
pub fn severity(percent: f64, limited: bool, warn_at: f64, critical_at: f64) -> Severity {
    if limited || percent >= critical_at {
        return Severity::Error;
    }
    if percent >= warn_at { Severity::Warning } else { Severity::Success }
}

/// TS `resetIn`: `4d 9h`, or `2h 5m` within a day.
pub fn reset_in(at: f64, now: f64) -> String {
    let remaining = (at - now).max(0.0);
    let days = (remaining / 86_400_000.0).floor();
    let hours = ((remaining % 86_400_000.0) / 3_600_000.0).floor();
    let minutes = ((remaining % 3_600_000.0) / 60_000.0).floor();
    if days > 0.0 { format!("{days}d {hours}h") } else { format!("{hours}h {minutes}m") }
}

/// TS `bar`: the filled cells of a bar `width` wide for `percent`, clamped to 0–100.
pub fn filled(percent: f64, width: usize) -> usize {
    let size = width.max(1) as f64;
    js_round(percent.clamp(0.0, 100.0) / 100.0 * size) as usize
}

/// TS `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })` with two decimals: `$1,234.50`.
pub fn money(value: f64) -> String {
    let cents = (value.abs() * 100.0).round() as u64;
    let digits = (cents / 100).to_string();
    let mut grouped = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    let sign = if value < 0.0 && cents > 0 { "-" } else { "" };
    format!("{sign}${grouped}.{:02}", cents % 100)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cost(value: serde_json::Value) -> ModelCost {
        serde_json::from_value(value).unwrap()
    }

    // Expected: TS `catalogCost` takes the largest context tier the context exceeds, else the base price.
    #[test]
    fn catalog_prices_pick_the_context_tier() {
        let costs = [
            cost(json!({ "input": 1, "output": 2, "cache": { "read": 0.5, "write": 4 } })),
            cost(
                json!({ "tier": { "type": "context", "size": 100 }, "input": 10, "output": 20, "cache": { "read": 5, "write": 40 } }),
            ),
            cost(
                json!({ "tier": { "type": "context", "size": 1000 }, "input": 100, "output": 200, "cache": { "read": 50, "write": 400 } }),
            ),
        ];
        let tokens = |input: f64| -> TokenUsageInfo {
            serde_json::from_value(
                json!({ "input": input, "output": 10, "reasoning": 5, "cache": { "read": 2, "write": 1 } }),
            )
            .unwrap()
        };
        assert_eq!(catalog_cost(&costs, Some(&tokens(50.0))), (50.0 + 15.0 * 2.0 + 1.0 + 4.0) / 1e6);
        assert_eq!(catalog_cost(&costs, Some(&tokens(200.0))), (2000.0 + 300.0 + 10.0 + 40.0) / 1e6);
        assert_eq!(catalog_cost(&costs, Some(&tokens(2000.0))), (200_000.0 + 3000.0 + 100.0 + 400.0) / 1e6);
        assert_eq!(catalog_cost(&costs, None), 0.0);
    }

    // Expected: the formats of TS `resetIn`, `bar` and the currency formatter, and its severities.
    #[test]
    fn countdowns_bars_money_and_severity_format_as_in_ts() {
        let (hour, day) = (3_600_000.0, 86_400_000.0);
        assert_eq!(reset_in(4.0 * day + 9.5 * hour, 0.0), "4d 9h");
        assert_eq!(reset_in(5.0 * 60_000.0, 0.0), "0h 5m");
        assert_eq!(reset_in(0.0, 1.0), "0h 0m");
        assert_eq!((filled(50.0, 22), filled(2.0, 22), filled(150.0, 22), filled(2.5, 22)), (11, 0, 22, 1));
        assert_eq!(
            (money(0.2149), money(1234.5), money(0.0), money(-3.0)),
            ("$0.21".to_owned(), "$1,234.50".to_owned(), "$0.00".to_owned(), "-$3.00".to_owned())
        );
        assert_eq!(severity(69.0, false, 70.0, 90.0), Severity::Success);
        assert_eq!(severity(70.0, false, 70.0, 90.0), Severity::Warning);
        assert_eq!(severity(1.0, true, 70.0, 90.0), Severity::Error);
    }
}
