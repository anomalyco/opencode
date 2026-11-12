//! V2 theme documents as JSON: the schema check (`schema.ts`), merging and expansion (`expand.ts`), and mode
//! selection (`select.ts`) from `packages/theme/src/tui`.

use opencode_util::json_object;
use serde_json::{Map, Value};

use super::color::is_hex;
use super::{ThemeMode, mode_name};

pub(crate) const STATES: [&str; 5] = ["disabled", "pressed", "focused", "selected", "hovered"];
pub(crate) const VARIANTS: [&str; 3] = ["primary", "secondary", "destructive"];
pub(crate) const STEPS: [u16; 9] = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const FEEDBACK: [&str; 4] = ["error", "warning", "success", "info"];
const SYNTAX: [&str; 9] =
    ["comment", "keyword", "function", "variable", "string", "number", "type", "operator", "punctuation"];
const MARKDOWN: [&str; 14] = [
    "text",
    "heading",
    "link",
    "linkText",
    "code",
    "blockQuote",
    "emphasis",
    "strong",
    "horizontalRule",
    "listItem",
    "listEnumeration",
    "image",
    "imageText",
    "codeBlock",
];

/// The modes a document defines, light first.
pub(crate) fn modes(document: &Value) -> Vec<ThemeMode> {
    [ThemeMode::Light, ThemeMode::Dark].into_iter().filter(|mode| document.get(mode_name(*mode)).is_some()).collect()
}

/// `selectThemeMode`: the requested mode if the document has it, else its first mode, merged over `base`.
pub(crate) fn select(document: &Value, mode: ThemeMode) -> Result<(Map<String, Value>, ThemeMode), String> {
    let modes = modes(document);
    let selected = if modes.contains(&mode) { Some(mode) } else { modes.first().copied() };
    let definition = selected.and_then(|mode| document.get(mode_name(mode))).filter(|value| truthy(value));
    let (Some(selected), Some(definition)) = (selected, definition) else {
        return Err("Theme must provide at least one mode".to_owned());
    };
    Ok((merge(&[document.get("base").unwrap_or(&Value::Null), definition]), selected))
}

/// `mergeTheme`: objects merge key by key, anything else replaces.
pub(crate) fn merge(values: &[&Value]) -> Map<String, Value> {
    let mut result = Map::new();
    for value in values {
        if let Value::Object(object) = value {
            merge_into(&mut result, object);
        }
    }
    result
}

fn merge_into(result: &mut Map<String, Value>, object: &Map<String, Value>) {
    for (key, item) in object {
        let Value::Object(inner) = item else {
            result.insert(key.clone(), item.clone());
            continue;
        };
        let mut next = match result.get(key) {
            Some(Value::Object(existing)) => existing.clone(),
            _ => Map::new(),
        };
        merge_into(&mut next, inner);
        result.insert(key.clone(), Value::Object(next));
    }
}

/// `expandTheme`: fills derived text colors and every action and form-field state.
pub(crate) fn expand_theme(definition: &Map<String, Value>) -> Map<String, Value> {
    let mut result = expand_tokens(definition);
    if let Some(Value::Object(dialog)) = definition.get("@dialog") {
        let mut expanded = expand_tokens(dialog);
        if let Some(Value::Object(footer)) = dialog.get("@footer") {
            expanded.insert("@footer".to_owned(), Value::Object(expand_tokens(footer)));
        }
        result.insert("@dialog".to_owned(), Value::Object(expanded));
    }
    result
}

fn expand_tokens(definition: &Map<String, Value>) -> Map<String, Value> {
    let mut result = definition.clone();
    if let Some(Value::Object(text)) = definition.get("text") {
        result.insert("text".to_owned(), Value::Object(expand_text(text)));
    }
    if let Some(Value::Object(background)) = definition.get("background") {
        let mut expanded = background.clone();
        expand_section(&mut expanded, "background");
        result.insert("background".to_owned(), Value::Object(expanded));
    }
    result
}

fn expand_text(text: &Map<String, Value>) -> Map<String, Value> {
    let mut result = text.clone();
    let present = |key: &str| text.get(key).is_some_and(truthy);
    if text.get("muted").is_none_or(Value::is_null) && present("base") {
        result.insert("muted".to_owned(), reference("text.base"));
    }
    if text.get("faint").is_none_or(Value::is_null) && (present("muted") || present("base")) {
        result.insert("faint".to_owned(), reference("text.muted"));
    }
    expand_section(&mut result, "text");
    if let Some(Value::Object(feedback)) = text.get("feedback") {
        let expanded = feedback
            .iter()
            .map(|(kind, item)| {
                let Value::Object(item) = item else { return (kind.clone(), item.clone()) };
                let mut item = item.clone();
                if item.get("muted").is_none_or(Value::is_null) && item.get("base").is_some_and(truthy) {
                    item.insert("muted".to_owned(), reference(&format!("text.feedback.{kind}.base")));
                }
                (kind.clone(), Value::Object(item))
            })
            .collect();
        result.insert("feedback".to_owned(), Value::Object(expanded));
    }
    result
}

/// Expands `action` and `formfield` of a text or background section.
fn expand_section(section: &mut Map<String, Value>, path: &str) {
    if let Some(Value::Object(actions)) = section.get("action") {
        let expanded = actions
            .iter()
            .map(|(variant, value)| (variant.clone(), expand_states(value, &format!("{path}.action.{variant}"))))
            .collect();
        section.insert("action".to_owned(), Value::Object(expanded));
    }
    if let Some(formfield) = section.get("formfield") {
        let expanded = expand_states(formfield, &format!("{path}.formfield"));
        section.insert("formfield".to_owned(), expanded);
    }
}

/// Points every missing state of a stateful color with a `base` at that base.
fn expand_states(value: &Value, path: &str) -> Value {
    let Value::Object(states) = value else { return value.clone() };
    if !states.get("base").is_some_and(truthy) {
        return value.clone();
    }
    let mut result = states.clone();
    for state in STATES {
        let key = format!("${state}");
        if result.get(&key).is_none_or(Value::is_null) {
            result.insert(key, reference(&format!("{path}.base")));
        }
    }
    Value::Object(result)
}

fn reference(path: &str) -> Value {
    Value::String(format!("${path}"))
}

/// JavaScript truthiness of a JSON value.
pub(crate) fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(number) => number.as_f64().is_some_and(|number| number != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// Why a document failed the schema, as far as the theme-error message shows it.
#[derive(Debug)]
pub(crate) enum Issue {
    /// The value the schema rejected.
    Got(Value),
    /// A required key is missing.
    Missing,
    /// A failure whose message names no value.
    Other,
}

impl Issue {
    /// The value word of `themeDecodeError`, which reads it from the schema message's `got …`.
    pub(crate) fn value(&self) -> String {
        match self {
            Issue::Got(value) => {
                let text = serde_json::to_string(value).unwrap_or_default();
                if let Some(rest) = text.strip_prefix('"') {
                    return rest.find('"').map_or(text.clone(), |end| format!("\"{}\"", &rest[..end]));
                }
                text.split_whitespace().next().unwrap_or("value").to_owned()
            }
            Issue::Missing => "undefined".to_owned(),
            Issue::Other => "value".to_owned(),
        }
    }
}

type Check = Result<Value, Issue>;

/// Decodes a V2 document like `Schema.decodeUnknownSync(ThemeDocument)`: the first failure in field order wins, and
/// keys the schema does not name are dropped.
pub(crate) fn decode(document: &Value) -> Check {
    let input = object(document)?;
    let schema = field(input, "$schema", false, |value| match value {
        Value::String(_) => Ok(value.clone()),
        _ => Err(Issue::Got(value.clone())),
    })?;
    let base = field(input, "base", true, base_definition)?;
    if input.get("light").is_none() && input.get("dark").is_none() {
        return Err(Issue::Other);
    }
    Ok(json_object! {
        "$schema"?: schema,
        "base"?: base,
        "light"?: field(input, "light", false, mode_definition)?,
        "dark"?: field(input, "dark", false, mode_definition)?,
    })
}

fn base_definition(value: &Value) -> Check {
    let input = object(value)?;
    Ok(json_object! {
        "categorical"?: field(input, "categorical", true, categorical)?,
        ..tokens(input, true)?,
        "@dialog"?: field(input, "@dialog", false, dialog)?,
    })
}

fn mode_definition(value: &Value) -> Check {
    let input = object(value)?;
    Ok(json_object! {
        "hue"?: field(input, "hue", true, hue)?,
        "categorical"?: field(input, "categorical", false, categorical)?,
        ..tokens(input, false)?,
        "@dialog"?: field(input, "@dialog", false, dialog)?,
    })
}

fn dialog(value: &Value) -> Check {
    let input = object(value)?;
    let footer = |value: &Value| tokens(object(value)?, false);
    Ok(json_object! { ..tokens(input, false)?, "@footer"?: field(input, "@footer", false, footer)? })
}

/// The token sections; `complete` requires every token a base definition needs.
fn tokens(input: &Map<String, Value>, complete: bool) -> Check {
    let single = |value: &Value| strict(value, &[("base", complete)], color);
    Ok(json_object! {
        "text"?: field(input, "text", complete, |value| text(value, complete))?,
        "background"?: field(input, "background", complete, |value| background(value, complete))?,
        "border"?: field(input, "border", complete, single)?,
        "scrollbar"?: field(input, "scrollbar", complete, single)?,
        "diff"?: field(input, "diff", complete, |value| diff(value, complete))?,
        "syntax"?: field(input, "syntax", complete, |value| record(value, &SYNTAX, complete))?,
        "markdown"?: field(input, "markdown", complete, |value| record(value, &MARKDOWN, complete))?,
    })
}

fn text(value: &Value, complete: bool) -> Check {
    let input = object(value)?;
    let feedback_color = |value: &Value| strict(value, &[("base", complete), ("muted", false)], color);
    Ok(json_object! {
        "base"?: field(input, "base", complete, color)?,
        "muted"?: field(input, "muted", complete, color)?,
        "faint"?: field(input, "faint", false, color)?,
        "action"?: field(input, "action", complete, |value| actions(value, complete))?,
        "formfield"?: field(input, "formfield", complete, |value| stateful(value, complete))?,
        "feedback"?: field(input, "feedback", complete, |value| feedback(value, complete, feedback_color))?,
    })
}

fn background(value: &Value, complete: bool) -> Check {
    let input = object(value)?;
    let raised = |value: &Value| strict(value, &[("base", complete), ("high", complete), ("max", complete)], color);
    let feedback_color = |value: &Value| strict(value, &[("base", complete)], color);
    Ok(json_object! {
        "base"?: field(input, "base", complete, color)?,
        "raised"?: field(input, "raised", complete, raised)?,
        "action"?: field(input, "action", complete, |value| actions(value, complete))?,
        "formfield"?: field(input, "formfield", complete, |value| stateful(value, complete))?,
        "feedback"?: field(input, "feedback", complete, |value| feedback(value, complete, feedback_color))?,
    })
}

fn diff(value: &Value, complete: bool) -> Check {
    let input = object(value)?;
    let pair = |value: &Value| strict(value, &[("added", complete), ("removed", complete)], color);
    let text = [("added", complete), ("removed", complete), ("context", complete), ("hunkHeader", complete)];
    let line_number = |value: &Value| {
        let input = object(value)?;
        Ok(json_object! {
            "text"?: field(input, "text", complete, color)?,
            "background"?: field(input, "background", complete, pair)?,
        })
    };
    Ok(json_object! {
        "text"?: field(input, "text", complete, |value| strict(value, &text, color))?,
        "background"?: field(input, "background", complete, |value| strict(value, &text[..3], color))?,
        "highlight"?: field(input, "highlight", complete, pair)?,
        "lineNumber"?: field(input, "lineNumber", complete, line_number)?,
    })
}

fn actions(value: &Value, complete: bool) -> Check {
    strict(value, &VARIANTS.map(|variant| (variant, complete)), |value| stateful(value, complete))
}

fn stateful(value: &Value, complete: bool) -> Check {
    let keys = [
        ("base", complete),
        ("$hovered", false),
        ("$focused", false),
        ("$pressed", false),
        ("$selected", false),
        ("$disabled", false),
    ];
    strict(value, &keys, color)
}

fn feedback(value: &Value, complete: bool, check: impl Fn(&Value) -> Check) -> Check {
    strict(value, &FEEDBACK.map(|kind| (kind, complete)), check)
}

/// A `Schema.Record` over literal keys: every key in literal order, required when `complete`.
fn record(value: &Value, keys: &[&str], complete: bool) -> Check {
    strict(value, &keys.iter().map(|key| (*key, complete)).collect::<Vec<_>>(), hue_color)
}

/// A struct whose fields all share one check.
fn strict(value: &Value, keys: &[(&str, bool)], check: impl Fn(&Value) -> Check) -> Check {
    let input = object(value)?;
    let mut output = Map::new();
    for (key, required) in keys {
        if let Some(value) = field(input, key, *required, &check)? {
            output.insert((*key).to_owned(), value);
        }
    }
    Ok(Value::Object(output))
}

fn hue(value: &Value) -> Check {
    let input = object(value)?;
    let mut output = Map::new();
    for (name, scale) in input {
        if name.is_empty() {
            return Err(Issue::Got(Value::String(String::new())));
        }
        let decoded = match scale {
            Value::String(alias) if alias.strip_prefix("$hue.").is_some_and(|rest| !rest.is_empty()) => scale.clone(),
            Value::String(_) => return Err(Issue::Got(scale.clone())),
            Value::Object(steps) => {
                let mut decoded = Map::new();
                for step in STEPS {
                    match steps.get(&step.to_string()) {
                        Some(Value::String(color)) if is_hex(color) => {
                            decoded.insert(step.to_string(), Value::String(color.clone()));
                        }
                        _ => return Err(Issue::Other),
                    }
                }
                Value::Object(decoded)
            }
            _ => return Err(Issue::Other),
        };
        output.insert(name.clone(), decoded);
    }
    if ["accent", "interactive", "neutral"].iter().any(|name| !output.contains_key(*name)) {
        return Err(Issue::Other);
    }
    Ok(Value::Object(output))
}

fn categorical(value: &Value) -> Check {
    let Value::Array(names) = value else { return Err(Issue::Got(value.clone())) };
    if let Some(bad) = names.iter().find(|name| name.as_str().is_none_or(str::is_empty)) {
        return Err(Issue::Got(bad.clone()));
    }
    if names.is_empty() {
        return Err(Issue::Got(value.clone()));
    }
    Ok(value.clone())
}

/// `ColorValue`: a hex color, `transparent`, or a `$` reference.
fn color(value: &Value) -> Check {
    match value {
        Value::String(text) if is_hex(text) || text == "transparent" || text.len() > 1 && text.starts_with('$') => {
            Ok(value.clone())
        }
        _ => Err(Issue::Got(value.clone())),
    }
}

/// `HueColorValue`: a hex color or a `$hue.<name>.<step>` reference, as syntax and Markdown tokens require.
fn hue_color(value: &Value) -> Check {
    let Value::String(text) = value else { return Err(Issue::Got(value.clone())) };
    let reference = text
        .strip_prefix("$hue.")
        .and_then(|rest| rest.rsplit_once('.'))
        .is_some_and(|(name, step)| !name.is_empty() && STEPS.iter().any(|known| known.to_string() == step));
    if is_hex(text) || reference { Ok(value.clone()) } else { Err(Issue::Got(value.clone())) }
}

fn object(value: &Value) -> Result<&Map<String, Value>, Issue> {
    value.as_object().ok_or_else(|| Issue::Got(value.clone()))
}

/// The checked value of `key`, or `None` when it is absent and not `required`.
fn field(
    input: &Map<String, Value>,
    key: &str,
    required: bool,
    check: impl Fn(&Value) -> Check,
) -> Result<Option<Value>, Issue> {
    match input.get(key) {
        Some(value) => check(value).map(Some),
        None if required => Err(Issue::Missing),
        None => Ok(None),
    }
}
