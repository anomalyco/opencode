//! A port of `opencode-sidebar-tokens` 0.1.3 (`dist/tui.js`): a "Session tokens" block in the sidebar with the
//! session's input, output and cache totals, and its reasoning tokens when there are any. It follows the session's
//! info, so a `session.usage.updated` shows at once.
//!
//! Options: `showReasoning: false` hides the reasoning row. TS formats with `Intl.NumberFormat(locale)`; the port
//! groups digits as `en-US` does, whatever `locale` says.

use opencode_plugin_abi::types::TokenUsageInfo;
use opencode_plugin_abi::{Edges, Justify, Layout, Node, Placement, Render, Setup, Span, export_plugin};

fn setup(setup: &mut Setup) -> Result<(), String> {
    let options: serde_json::Value =
        setup.options().and_then(|text| serde_json::from_str(text).ok()).unwrap_or_default();
    let reasoning = options.get("showReasoning") != Some(&serde_json::Value::Bool(false));
    setup.slot(Placement::append("sidebar.content"), move |read, input, changed| {
        let Some(id) = input.session_id.as_deref() else { return Render::Hide };
        if !changed.session(id) {
            return Render::Keep;
        }
        let session = read.session(id);
        let mut rows = vec![Node::text([Span::new("Session tokens").bold()]).fg("text.base")];
        rows.extend(usage(session.as_ref().map(|session| &session.info.tokens), reasoning).into_iter().map(row));
        // TS shows it while the session's first sync runs; the host loads it.
        if session.is_none() {
            rows.push(Node::text([Span::new("Loading…")]).fg("text.muted"));
        }
        let layout = Layout::default().margin(Edges::new(1, 0, 0, 0)).shrink(false);
        Render::Show(Node::column(rows).layout(layout))
    });
    Ok(())
}

/// TS `usageRows`: a label and its formatted count, `—` for a count the session lacks.
fn usage(tokens: Option<&TokenUsageInfo>, reasoning: bool) -> Vec<(&'static str, String)> {
    let value =
        |count: Option<f64>| count.filter(|count| count.is_finite() && *count >= 0.0).map_or("—".to_owned(), group);
    let mut rows = vec![
        ("Input", value(tokens.map(|tokens| tokens.input))),
        ("Output", value(tokens.map(|tokens| tokens.output))),
        ("Cache read", value(tokens.map(|tokens| tokens.cache.read))),
        ("Cache write", value(tokens.map(|tokens| tokens.cache.write))),
    ];
    if let Some(tokens) = tokens.filter(|tokens| reasoning && tokens.reasoning > 0.0) {
        rows.push(("Reasoning", value(Some(tokens.reasoning))));
    }
    rows
}

fn row((label, value): (&str, String)) -> Node {
    Node::row(vec![
        Node::text([Span::new(label)]).fg("text.muted"),
        Node::text([Span::new(value)]).fg("text.base").layout(Layout::default().shrink(false)),
    ])
    .justify(Justify::SpaceBetween)
    .gap(1)
}

/// `count` rounded to a whole number, its digits grouped in threes (`22,870`).
fn group(count: f64) -> String {
    let digits = format!("{:.0}", count.round());
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    grouped
}

export_plugin!("sidebar.tokens", setup);

#[cfg(test)]
mod tests {
    #[test]
    fn groups_digits_in_threes() {
        let shown: Vec<String> =
            [0.0, 100.0, 999.0, 1000.0, 22_870.0, 1_234_567.4].into_iter().map(super::group).collect();
        assert_eq!(shown, ["0", "100", "999", "1,000", "22,870", "1,234,567"]);
    }
}
