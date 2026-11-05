//! Form field rules shared by the TUI's form prompt and mini's form footer (`util/form.ts`).

use std::collections::HashMap;

use indexmap::IndexMap;
use opencode_api_types::js::number_to_string;
use opencode_api_types::{
    FormField, FormOption, FormValue, FormWhen, FormWhenOp, FormWhenValue, SessionMessageShellExit,
};
/// A choice row: an option, or Yes and No for a boolean (`FormRow`).
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub value: FormValue,
    pub label: String,
    pub description: Option<String>,
}

/// The field's key; an unknown field has none.
pub fn key(field: &FormField) -> &str {
    match field {
        FormField::String(field) => &field.key,
        FormField::Number(field) => &field.key,
        FormField::Integer(field) => &field.key,
        FormField::Boolean(field) => &field.key,
        FormField::Multiselect(field) => &field.key,
        FormField::External(field) => &field.key,
        FormField::Unknown(_) => "",
    }
}

pub fn title(field: &FormField) -> Option<&str> {
    match field {
        FormField::String(field) => field.title.as_deref(),
        FormField::Number(field) => field.title.as_deref(),
        FormField::Integer(field) => field.title.as_deref(),
        FormField::Boolean(field) => field.title.as_deref(),
        FormField::Multiselect(field) => field.title.as_deref(),
        FormField::External(field) => field.title.as_deref(),
        FormField::Unknown(_) => None,
    }
}

pub fn description(field: &FormField) -> Option<&str> {
    match field {
        FormField::String(field) => field.description.as_deref(),
        FormField::Number(field) => field.description.as_deref(),
        FormField::Integer(field) => field.description.as_deref(),
        FormField::Boolean(field) => field.description.as_deref(),
        FormField::Multiselect(field) => field.description.as_deref(),
        FormField::External(field) => field.description.as_deref(),
        FormField::Unknown(_) => None,
    }
}

pub fn required(field: &FormField) -> bool {
    let required = match field {
        FormField::String(field) => field.required,
        FormField::Number(field) => field.required,
        FormField::Integer(field) => field.required,
        FormField::Boolean(field) => field.required,
        FormField::Multiselect(field) => field.required,
        FormField::External(_) | FormField::Unknown(_) => None,
    };
    required == Some(true)
}

pub fn conditions(field: &FormField) -> &[FormWhen] {
    let when = match field {
        FormField::String(field) => field.when.as_deref(),
        FormField::Number(field) => field.when.as_deref(),
        FormField::Integer(field) => field.when.as_deref(),
        FormField::Boolean(field) => field.when.as_deref(),
        FormField::Multiselect(field) => field.when.as_deref(),
        FormField::External(_) | FormField::Unknown(_) => None,
    };
    when.unwrap_or_default()
}

/// `isFormAnswerField`.
pub fn is_answer(field: &FormField) -> bool {
    !matches!(field, FormField::External(_))
}

/// `formLabel`.
pub fn label(field: &FormField) -> String {
    match (title(field), field) {
        (Some(title), _) => title.to_owned(),
        (None, FormField::External(field)) => field.url.clone(),
        (None, field) => key(field).to_owned(),
    }
}

pub fn number(value: &Option<SessionMessageShellExit>) -> Option<f64> {
    match value {
        Some(SessionMessageShellExit::Number(value)) => Some(*value),
        _ => None,
    }
}

/// `formInitialValues`: the defaults, and the custom text of a string default that is not an option.
pub fn initial_values(fields: &[FormField]) -> (IndexMap<String, FormValue>, HashMap<String, String>) {
    let answers = fields
        .iter()
        .filter_map(|field| {
            let value = match field {
                FormField::String(field) => field.default.clone().map(FormValue::String),
                FormField::Number(field) => number(&field.default).map(FormValue::Number),
                FormField::Integer(field) => number(&field.default).map(FormValue::Number),
                FormField::Boolean(field) => field.default.map(FormValue::Bool),
                FormField::Multiselect(field) => field.default.clone().map(FormValue::Array),
                FormField::External(_) | FormField::Unknown(_) => None,
            };
            Some((key(field).to_owned(), value?))
        })
        .collect();
    let custom = fields
        .iter()
        .filter_map(|field| {
            let FormField::String(field) = field else {
                return None;
            };
            let (Some(options), Some(true), Some(default)) = (&field.options, field.custom, &field.default) else {
                return None;
            };
            if options.iter().any(|option| option.value == *default) {
                return None;
            }
            Some((field.key.clone(), default.clone()))
        })
        .collect();
    (answers, custom)
}

/// `formTextual`: a number, an integer, or a string without options takes typed text.
pub fn textual(field: Option<&FormField>) -> bool {
    match field {
        Some(FormField::Number(_) | FormField::Integer(_)) => true,
        Some(FormField::String(field)) => field.options.is_none(),
        _ => false,
    }
}

/// `formCustom`: whether a choice field offers "Type your own answer".
pub fn custom(field: Option<&FormField>) -> bool {
    match field {
        Some(FormField::String(field)) => field.options.is_some() && field.custom == Some(true),
        Some(FormField::Multiselect(field)) => field.custom == Some(true),
        _ => false,
    }
}

/// `formRows`.
pub fn rows(field: Option<&FormField>) -> Vec<Row> {
    let options: &[FormOption] = match field {
        Some(FormField::Boolean(_)) => {
            return [(true, "Yes"), (false, "No")]
                .into_iter()
                .map(|(value, label)| Row { value: FormValue::Bool(value), label: label.to_owned(), description: None })
                .collect();
        }
        Some(FormField::Multiselect(field)) => &field.options,
        Some(FormField::String(field)) => field.options.as_deref().unwrap_or_default(),
        _ => &[],
    };
    options
        .iter()
        .map(|option| Row {
            value: FormValue::String(option.value.clone()),
            label: option.label.clone(),
            description: option.description.clone(),
        })
        .collect()
}

/// `formSelected`: the row of the current answer, the custom row for a custom string, else the first.
pub fn selected_row(field: Option<&FormField>, value: Option<&FormValue>) -> usize {
    let (Some(field), Some(value)) = (field, value) else {
        return 0;
    };
    if matches!(value, FormValue::Array(_)) {
        return 0;
    }
    let rows = rows(Some(field));
    if let Some(index) = rows.iter().position(|row| row.value == *value) {
        return index;
    }
    if matches!(value, FormValue::String(_)) && custom(Some(field)) {
        return rows.len();
    }
    0
}

/// `formValidateValue`: why `value` is not a valid answer, if it is not.
pub fn validate(field: &FormField, value: Option<&FormValue>) -> Option<String> {
    let required = required(field);
    let Some(value) = value else {
        return required.then(|| "Answer required".to_owned());
    };
    let empty = match value {
        FormValue::String(text) => text.is_empty(),
        FormValue::Array(items) => items.is_empty(),
        _ => false,
    };
    if required && empty {
        if matches!(field, FormField::Multiselect(_)) {
            return Some("Select at least one option".to_owned());
        }
        return Some("Answer required".to_owned());
    }
    match field {
        FormField::String(field) => {
            let FormValue::String(text) = value else {
                return Some("Expected text".to_owned());
            };
            // JavaScript lengths count UTF-16 code units.
            let length = text.encode_utf16().count() as i64;
            if let Some(min) = field.min_length.filter(|min| length < *min) {
                return Some(format!("Must be at least {min} characters"));
            }
            if let Some(max) = field.max_length.filter(|max| length > *max) {
                return Some(format!("Must be at most {max} characters"));
            }
            if let Some(pattern) = &field.pattern {
                match regex::Regex::new(pattern) {
                    Ok(regex) if !regex.is_match(text) => {
                        return Some(format!("Must match pattern: {pattern}"));
                    }
                    Ok(_) => {}
                    Err(_) => return Some(format!("Invalid pattern: {pattern}")),
                }
            }
            use opencode_api_types::FormStringFieldFormat as Format;
            let format = match &field.format {
                Some(Format::Email) if !email(text) => Some("Expected an email address"),
                Some(Format::Uri) if url::Url::parse(text).is_err() => Some("Expected a URL"),
                Some(Format::Date) if !date(text) => Some("Expected a date (YYYY-MM-DD)"),
                Some(Format::DateTime) if !date_time(text) => Some("Expected a date and time"),
                _ => None,
            };
            if let Some(message) = format {
                return Some(message.to_owned());
            }
            let known = |options: &[FormOption]| options.iter().any(|option| option.value == *text);
            if let Some(options) = &field.options
                && field.custom != Some(true)
                && !known(options)
            {
                return Some("Select an available option".to_owned());
            }
            None
        }
        FormField::Number(_) | FormField::Integer(_) => {
            let FormValue::Number(value) = value.clone() else {
                return Some("Expected a number".to_owned());
            };
            if !value.is_finite() {
                return Some("Expected a number".to_owned());
            }
            let (minimum, maximum) = match field {
                FormField::Number(field) => (number(&field.minimum), number(&field.maximum)),
                FormField::Integer(field) => (number(&field.minimum), number(&field.maximum)),
                _ => (None, None),
            };
            if matches!(field, FormField::Integer(_)) && value.fract() != 0.0 {
                return Some("Expected an integer".to_owned());
            }
            if let Some(minimum) = minimum.filter(|minimum| value < *minimum) {
                return Some(format!("Must be at least {}", number_to_string(minimum)));
            }
            if let Some(maximum) = maximum.filter(|maximum| value > *maximum) {
                return Some(format!("Must be at most {}", number_to_string(maximum)));
            }
            None
        }
        FormField::Boolean(_) => (!matches!(value, FormValue::Bool(_))).then(|| "Expected yes or no".to_owned()),
        FormField::Multiselect(field) => {
            let FormValue::Array(items) = value else {
                return Some("Expected selections".to_owned());
            };
            let count = items.len() as i64;
            if let Some(min) = field.min_items.filter(|min| count < *min) {
                return Some(format!("Select at least {min}"));
            }
            if let Some(max) = field.max_items.filter(|max| count > *max) {
                return Some(format!("Select at most {max}"));
            }
            let known = |item: &String| field.options.iter().any(|option| option.value == *item);
            if field.custom != Some(true) && !items.iter().all(known) {
                return Some("Select only available options".to_owned());
            }
            None
        }
        FormField::External(_) | FormField::Unknown(_) => None,
    }
}

/// `formDisplayValue`: the answer as the review shows it, with option labels.
pub fn display_value(field: &FormField, value: Option<&FormValue>, empty_multiselect: &str) -> String {
    let Some(value) = value else {
        return String::new();
    };
    let rows = rows(Some(field));
    let label = |item: &FormValue| {
        rows.iter().find(|row| row.value == *item).map_or_else(|| value_text(item), |row| row.label.clone())
    };
    match value {
        FormValue::Array(items) if items.is_empty() => empty_multiselect.to_owned(),
        FormValue::Array(items) => {
            items.iter().map(|item| label(&FormValue::String(item.clone()))).collect::<Vec<_>>().join(", ")
        }
        value => label(value),
    }
}

/// `formToggleMultiselect`.
pub fn toggle_multiselect(value: Option<&FormValue>, item: &str) -> Vec<String> {
    let mut values = array(value);
    match values.iter().position(|value| value == item) {
        Some(index) => {
            values.remove(index);
        }
        None => values.push(item.to_owned()),
    }
    values
}

/// `formSetMultiselectCustom`: replaces the previous custom text among the selections with `next`.
pub fn set_multiselect_custom(value: Option<&FormValue>, previous: Option<&str>, next: &str) -> Vec<String> {
    let mut values = array(value);
    if let Some(index) = previous
        .filter(|previous| !previous.is_empty())
        .and_then(|previous| values.iter().position(|value| value == previous))
    {
        values.remove(index);
    }
    if !next.is_empty() && !values.iter().any(|value| value == next) {
        values.push(next.to_owned());
    }
    values
}

pub fn array(value: Option<&FormValue>) -> Vec<String> {
    match value {
        Some(FormValue::Array(items)) => items.clone(),
        _ => Vec::new(),
    }
}

/// `String(value)` for a scalar answer.
pub fn value_text(value: &FormValue) -> String {
    match value {
        FormValue::String(text) => text.clone(),
        FormValue::Number(number) => number_to_string(*number),
        FormValue::Bool(value) => value.to_string(),
        FormValue::Array(items) => items.join(","),
        FormValue::Unknown(value) => value.to_string(),
    }
}

pub fn email(text: &str) -> bool {
    let mut parts = text.splitn(2, '@');
    let (Some(local), Some(domain)) = (parts.next(), parts.next()) else {
        return false;
    };
    let plain = |part: &str| !part.is_empty() && !part.contains(char::is_whitespace) && !part.contains('@');
    // `[^\s@]+\.[^\s@]+`: some dot with text on both sides.
    plain(local)
        && plain(domain)
        && domain.char_indices().any(|(index, c)| c == '.' && index > 0 && index + 1 < domain.len())
}

pub fn date(text: &str) -> bool {
    let shaped = text.len() == 10
        && text.bytes().enumerate().all(|(index, byte)| match index {
            4 | 7 => byte == b'-',
            _ => byte.is_ascii_digit(),
        });
    shaped && chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").is_ok()
}

/// What `new Date(text)` accepts, for the ISO shapes forms use.
pub fn date_time(text: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(text).is_ok()
        || ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S"]
            .iter()
            .any(|format| chrono::NaiveDateTime::parse_from_str(text, format).is_ok())
        || chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").is_ok()
}

/// `field.when`: every condition holds on the answers of the fields before it that show.
pub fn active(field: &FormField, answers: &HashMap<String, FormValue>) -> bool {
    conditions(field).iter().all(|when| {
        let Some(value) = answers.get(&when.key) else {
            return false;
        };
        let hit = match value {
            FormValue::Array(items) => {
                items.iter().any(|item| equal_when(&FormValue::String(item.clone()), &when.value))
            }
            value => equal_when(value, &when.value),
        };
        if when.op == FormWhenOp::Eq { hit } else { !hit }
    })
}

pub fn equal_when(value: &FormValue, want: &FormWhenValue) -> bool {
    match (value, want) {
        (FormValue::String(a), FormWhenValue::String(b)) => a == b,
        (FormValue::Number(a), FormWhenValue::Number(b)) => a == b,
        (FormValue::Bool(a), FormWhenValue::Bool(b)) => a == b,
        _ => false,
    }
}

/// The fields that show for `answers`, in order. External fields always show; unknown kinds never do.
pub fn visible_fields(fields: &[FormField], answers: &IndexMap<String, FormValue>) -> Vec<FormField> {
    let mut seen = HashMap::new();
    fields
        .iter()
        .filter(|field| {
            if matches!(field, FormField::Unknown(_)) {
                return false;
            }
            if matches!(field, FormField::External(_)) {
                return true;
            }
            let shows = active(field, &seen);
            if shows && let Some(value) = answers.get(key(field)) {
                seen.insert(key(field).to_owned(), value.clone());
            }
            shows
        })
        .cloned()
        .collect()
}
