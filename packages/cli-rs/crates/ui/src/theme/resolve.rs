//! Resolves hue scales and per-surface tokens from a theme document, read in place.
//!
//! A surface stacks the page definition, then the dialog's, then the footer's. Each definition is the document's
//! `base` merged under the selected mode (`mergeTheme`), and `expandTheme` fills its missing derived tokens from the
//! same definition. A token is the topmost definition's; on a raised surface each action state falls back as
//! `contextualize` does.

use std::collections::HashMap;
use std::sync::LazyLock;

use opentui::style::Color;
use serde_json::{Map, Value};

use super::color::{from_hex, is_hex};
use super::document::{STATES, STEP_KEYS, STEPS, VARIANTS, modes};
use super::tokens::Tokens;
use super::{Scale, ThemeMode, Views, mode_name};
use opencode_api_types::js::truthy;

const SECTIONS: [&str; 8] = ["text", "background", "border", "scrollbar", "diff", "find", "syntax", "markdown"];
/// The document keys of [`STATES`].
const STATE_KEYS: [&str; 5] = ["$disabled", "$pressed", "$focused", "$selected", "$hovered"];

/// A definition: the document's `base` layer, then the selected mode's, which wins.
type Group<'a> = [Option<&'a Map<String, Value>>; 2];

/// `resolveThemeDocument`: the views of `document` in `mode`, or in its first mode when it lacks `mode`.
pub(crate) fn resolve_document(document: &Value, mode: ThemeMode) -> Result<(Views, ThemeMode), String> {
    let modes = modes(document);
    let selected = if modes.contains(&mode) { Some(mode) } else { modes.first().copied() };
    let definition = selected.and_then(|mode| document.get(mode_name(mode))).filter(|value| truthy(value));
    let (Some(selected), Some(definition)) = (selected, definition) else {
        return Err("Theme must provide at least one mode".to_owned());
    };
    let page = [document.get("base"), Some(definition)].map(|layer| layer.and_then(Value::as_object));
    Ok((resolve_definition(page)?, selected))
}

fn resolve_definition(page: Group<'_>) -> Result<Views, String> {
    let hue = resolve_hue(get(page, &["hue"]))?;
    let categorical_hues = get(page, &["categorical"])
        .and_then(Value::as_array)
        .ok_or("Theme categorical hues are missing")?
        .iter()
        .map(|name| {
            let name = name.as_str().unwrap_or_default();
            hue.iter()
                .position(|(hue, _)| hue == name)
                .ok_or_else(|| format!("Categorical hue \"{name}\" was not found"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let categorical = categorical_hues.iter().map(|index| hue[*index].1).collect();
    let dialog = get(page, &["@dialog"]).filter(|value| truthy(value)).map(|_| child(page, "@dialog"));
    let footer = dialog.and_then(|dialog| {
        let footer = get(dialog, &["@footer"]).filter(|value| value.is_object() && truthy(value));
        footer.map(|_| child(dialog, "@footer"))
    });
    let groups = [page, dialog.unwrap_or_default(), footer.unwrap_or_default()];
    // TypeScript resolves the dialog surfaces first, so their errors win.
    let dialog_view = resolve_view(&groups[..if dialog.is_some() { 2 } else { 1 }], &hue)?;
    let footer = if footer.is_some() { resolve_view(&groups, &hue)? } else { dialog_view.clone() };
    let base = if dialog.is_some() { resolve_view(&groups[..1], &hue)? } else { dialog_view.clone() };
    Ok(Views {
        hue,
        categorical,
        categorical_hues,
        surfaces: [base.0, dialog_view.0, footer.0],
        tones: [base.1, dialog_view.1, footer.1],
    })
}

/// The layers of `key` in `group`. Like `mergeTheme`, a layer that is not an object hides the layer below.
fn child<'a>(group: Group<'a>, key: &str) -> Group<'a> {
    let [base, mode] = group.map(|layer| layer.and_then(|layer| layer.get(key)));
    match mode {
        Some(Value::Object(mode)) => [base.and_then(Value::as_object), Some(mode)],
        Some(_) => [None, None],
        None => [base.and_then(Value::as_object), None],
    }
}

/// The merged value at `path` in a definition.
fn get<'a>(group: Group<'a>, path: &[&str]) -> Option<&'a Value> {
    let (last, parents) = path.split_last()?;
    let [base, mode] = parents.iter().fold(group, |group, key| child(group, key)).map(|layer| layer?.get(*last));
    mode.or(base)
}

/// The value at `path` in a definition after `expandTheme`, which points missing derived text colors and every
/// missing state of a stateful color at the definition's own token.
fn expanded<'a>(group: Group<'a>, path: &[&str]) -> Option<&'a Value> {
    let value = get(group, path);
    if value.is_some_and(|value| !value.is_null()) {
        return value;
    }
    // Selected text reads like the focused row of a list unless the theme picks its own colors.
    static TEXT_SELECTION: LazyLock<Value> =
        LazyLock::new(|| Value::String("$text.action.primary.$focused".to_owned()));
    static BACKGROUND_SELECTION: LazyLock<Value> =
        LazyLock::new(|| Value::String("$background.action.primary.$focused".to_owned()));
    let present = |path: &[&str]| get(group, path).filter(|value| truthy(value));
    let derived = match *path {
        ["text", "muted"] => present(&["text", "base"]),
        ["text", "faint"] => present(&["text", "muted"]).or_else(|| present(&["text", "base"])),
        ["text", "selection"] => present(&["text", "base"]).map(|_| &*TEXT_SELECTION),
        ["background", "selection"] => present(&["background", "base"]).map(|_| &*BACKGROUND_SELECTION),
        ["text", "feedback", kind, "muted"] => present(&["text", "feedback", kind, "base"]),
        [section @ ("text" | "background"), "formfield", state] if STATE_KEYS.contains(&state) => {
            present(&[section, "formfield", "base"])
        }
        [section @ ("text" | "background"), "action", variant, state] if STATE_KEYS.contains(&state) => {
            present(&[section, "action", variant, "base"])
        }
        _ => None,
    };
    derived.or(value)
}

/// The token at `path` on the surface stacking `groups`, page first.
fn lookup<'a>(groups: &[Group<'a>], path: &[&str]) -> Option<&'a Value> {
    if !SECTIONS.contains(path.first()?) {
        return None;
    }
    match *path {
        [section @ ("text" | "background"), "action", variant, key] if groups.len() > 1 => {
            let known = VARIANTS.contains(&variant) && (key == "base" || STATE_KEYS.contains(&key));
            known.then(|| action(groups, section, variant, key)).flatten()
        }
        _ => groups.iter().rev().find_map(|group| expanded(*group, path)),
    }
}

/// `contextualize`: an action state on a raised surface takes its definition's state, then its base, then the
/// state below, then the base below, so an override's `base` replaces every state of that variant.
fn action<'a>(groups: &[Group<'a>], section: &str, variant: &str, key: &str) -> Option<&'a Value> {
    let (top, below) = groups.split_last()?;
    if below.is_empty() {
        return expanded(*top, &[section, "action", variant, key]).filter(|value| !value.is_null());
    }
    let read = |key| get(*top, &[section, "action", variant, key]).filter(|value| !value.is_null());
    read(key)
        .or_else(|| read("base"))
        .or_else(|| action(below, section, variant, key))
        .or_else(|| action(below, section, variant, "base"))
}

/// Unset find colors fall back to the surface's raised and focused tokens.
fn find_fallback(path: &str) -> Option<&'static str> {
    match path {
        "find.text.current" => Some("text.action.primary.focused"),
        "find.background.match" => Some("background.raised.max"),
        "find.background.current" => Some("background.action.primary.focused"),
        _ => None,
    }
}

/// Splits a token path; a path deeper than any token is never found.
fn split(path: &str) -> Option<([&str; 4], usize)> {
    let mut parts = [""; 4];
    let mut count = 0;
    for part in path.split('.') {
        *parts.get_mut(count)? = part;
        count += 1;
    }
    Some((parts, count))
}

fn resolve_hue(definition: Option<&Value>) -> Result<Vec<(String, Scale)>, String> {
    let source = definition.and_then(Value::as_object).ok_or("Theme hues are missing")?;
    let mut cache = HashMap::new();
    source.keys().map(|name| Ok((name.clone(), hue_scale(source, name, &mut Vec::new(), &mut cache)?))).collect()
}

fn hue_scale<'a>(
    source: &'a Map<String, Value>,
    name: &'a str,
    stack: &mut Vec<&'a str>,
    cache: &mut HashMap<&'a str, Scale>,
) -> Result<Scale, String> {
    if let Some(hit) = cache.get(name) {
        return Ok(*hit);
    }
    if stack.contains(&name) {
        return Err(format!("Circular hue reference: {} -> {name}", stack.join(" -> ")));
    }
    let scale = match source.get(name) {
        Some(Value::String(alias)) => {
            let target = alias.strip_prefix("$hue.").filter(|target| !target.is_empty());
            let Some(target) = target else { return Err(format!("Hue alias \"{alias}\" must reference a hue scale")) };
            if source.get(target).is_none() {
                return Err(format!("Hue alias \"{alias}\" references a missing hue"));
            }
            stack.push(name);
            let scale = hue_scale(source, target, stack, cache);
            stack.pop();
            scale?
        }
        Some(Value::Object(steps)) => {
            let mut colors = [Color::TRANSPARENT; 9];
            for (index, step) in STEP_KEYS.iter().enumerate() {
                match steps.get(*step) {
                    Some(Value::String(color)) if is_hex(color) => colors[index] = from_hex(color),
                    _ => return Err(format!("Invalid hue color at \"hue.{name}.{step}\"")),
                }
            }
            if let Some(step) =
                steps.keys().find(|key| !key.parse::<f64>().is_ok_and(|n| STEPS.iter().any(|s| f64::from(*s) == n)))
            {
                return Err(format!("Unknown hue step at \"hue.{name}.{step}\""));
            }
            Scale(colors)
        }
        _ => return Err(format!("Hue \"{name}\" was not found")),
    };
    cache.insert(name, scale);
    Ok(scale)
}

/// What a reference reads before it resolves.
enum Read<'a> {
    Value(&'a Value),
    Color(Tone),
    NotColor,
}

/// A resolved color and the hue step (hue index, step index) it was read from. TypeScript finds a color's step by
/// object identity; the source recorded here stands in for it.
pub(crate) type Tone = (Color, Option<(usize, usize)>);

struct Resolver<'a, 'v> {
    groups: &'v [Group<'a>],
    hue: &'v [(String, Scale)],
    cache: HashMap<&'a str, Tone>,
}

/// The tokens of one surface, and every token's [`Tone`] in [`Tokens::visit`] order.
fn resolve_view(groups: &[Group<'_>], hue: &[(String, Scale)]) -> Result<(Tokens, Vec<Tone>), String> {
    let mut resolver = Resolver { groups, hue, cache: HashMap::new() };
    let mut result = Tokens::blank();
    let mut tones = Vec::new();
    let mut error = None;
    result.visit(&mut |path, color| {
        if error.is_none() {
            match resolver.token(path) {
                Ok(tone) => {
                    *color = tone.0;
                    tones.push(tone);
                }
                Err(message) => error = Some(message),
            }
        }
    });
    error.map_or(Ok((result, tones)), Err)
}

impl<'a> Resolver<'a, '_> {
    /// The token at a [`Tokens::visit`] path, whose state keys such as `hovered` read the document's `$hovered`.
    fn token(&mut self, path: &str) -> Result<Tone, String> {
        let missing = || format!("Theme token \"{path}\" is missing");
        let (mut parts, count) = split(path).ok_or_else(missing)?;
        if let Some(state) = STATES.iter().position(|state| *state == parts[count - 1]) {
            parts[count - 1] = STATE_KEYS[state];
        }
        match lookup(self.groups, &parts[..count]) {
            Some(Value::String(text)) => self.color(text, path, &mut Vec::new()),
            None if find_fallback(path).is_some() => self.token(find_fallback(path).expect("checked")),
            Some(Value::Number(_) | Value::Object(_)) | None => Err(missing()),
            Some(_) => Err(format!("Invalid theme value at \"theme.{path}\"")),
        }
    }

    fn color(&mut self, value: &'a str, path: &str, stack: &mut Vec<&'a str>) -> Result<Tone, String> {
        if value == "transparent" {
            return Ok((Color::TRANSPARENT, None));
        }
        if is_hex(value) {
            return Ok((from_hex(value), None));
        }
        let Some(target) = value.strip_prefix('$') else {
            return Err(format!("Invalid color \"{value}\" at \"{path}\""));
        };
        if let Some(hit) = self.cache.get(target) {
            return Ok(*hit);
        }
        if stack.contains(&target) {
            return Err(format!("Circular theme reference: {} -> {target}", stack.join(" -> ")));
        }
        stack.push(target);
        let result = match self.read(target)? {
            Read::Color(color) => Some(color),
            Read::Value(Value::String(text)) => Some(self.color(text, target, stack)?),
            Read::Value(Value::Number(_) | Value::Object(_)) | Read::NotColor => None,
            Read::Value(_) => return Err(format!("Invalid theme value at \"{target}\"")),
        };
        stack.pop();
        let Some(color) = result else {
            return Err(format!("Theme reference \"{value}\" at \"{path}\" is not a color"));
        };
        self.cache.insert(target, color);
        Ok(color)
    }

    fn read(&self, path: &str) -> Result<Read<'a>, String> {
        let missing = || format!("Theme reference \"${path}\" was not found");
        if let Some(rest) = path.strip_prefix("hue.") {
            let step = rest.rsplit_once('.').and_then(|(name, step)| {
                let index = STEP_KEYS.iter().position(|known| *known == step)?;
                Some((name, index))
            });
            if let Some((name, index)) = step.filter(|(name, _)| !name.is_empty()) {
                let hue = self.hue.iter().position(|(hue, _)| hue == name).ok_or_else(missing)?;
                return Ok(Read::Color((self.hue[hue].1.0[index], Some((hue, index)))));
            }
            // A whole scale, or a path into one, is never a single color.
            let name = rest.split('.').next().unwrap_or_default();
            if self.hue.iter().any(|(hue, _)| hue == name) {
                return Ok(Read::NotColor);
            }
            return Err(missing());
        }
        if path == "hue" {
            return Ok(Read::NotColor);
        }
        let (parts, count) = split(path).ok_or_else(missing)?;
        match lookup(self.groups, &parts[..count]) {
            Some(Value::Null) | None => Err(missing()),
            Some(value) => Ok(Read::Value(value)),
        }
    }
}
