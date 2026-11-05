//! Resolves an expanded V2 definition into hue scales and the tokens of each surface (`resolve.ts` in
//! `packages/theme/src/tui`). Error messages match the TypeScript resolver's.

use std::collections::HashMap;

use opentui::style::Color;
use serde_json::{Map, Value};

use super::color::{from_hex, is_hex};
use super::document::{STATES, STEPS, VARIANTS, expand_theme, merge, select, truthy};
use super::tokens::Tokens;
use super::{Scale, ThemeMode, Views};

const SECTIONS: [&str; 7] = ["text", "background", "border", "scrollbar", "diff", "syntax", "markdown"];

/// `resolveThemeDocument`: the views of `document` in `mode`, or in its first mode when it lacks `mode`.
pub(crate) fn resolve_document(document: &Value, mode: ThemeMode) -> Result<(Views, ThemeMode), String> {
    let (definition, mode) = select(document, mode)?;
    Ok((resolve_expanded(&expand_theme(&definition))?, mode))
}

fn resolve_expanded(definition: &Map<String, Value>) -> Result<Views, String> {
    let hue = resolve_hue(definition.get("hue"))?;
    let categorical_hues = definition
        .get("categorical")
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
    let base = sections(definition);
    let dialog = definition.get("@dialog").filter(|value| truthy(value));
    let dialog_tokens = match dialog {
        Some(dialog) => contextualize(&base, &sections(dialog.as_object().unwrap_or(&Map::new()))),
        None => base.clone(),
    };
    // TypeScript resolves the dialog surfaces first, so their errors win.
    let dialog_view = resolve_view(&dialog_tokens, &hue)?;
    let footer = match dialog.and_then(|dialog| dialog.get("@footer")).filter(|value| truthy(value)) {
        Some(Value::Object(footer)) => resolve_view(&contextualize(&dialog_tokens, footer), &hue)?,
        Some(_) => resolve_view(&dialog_tokens, &hue)?,
        None => dialog_view.clone(),
    };
    let base = resolve_view(&base, &hue)?;
    Ok(Views {
        hue,
        categorical,
        categorical_hues,
        surfaces: [base.0, dialog_view.0, footer.0],
        tones: [base.1, dialog_view.1, footer.1],
    })
}

/// The token sections of a definition, as `tokens()` picks them.
fn sections(definition: &Map<String, Value>) -> Map<String, Value> {
    SECTIONS
        .iter()
        .map(|section| (section.to_string(), definition.get(*section).cloned().unwrap_or(Value::Null)))
        .collect()
}

/// Layers a surface override on `base`. Each action state takes the override's state, then its base, then the
/// underlying state, then the underlying base, so an override's `base` replaces every state of that variant.
fn contextualize(base: &Map<String, Value>, surface: &Map<String, Value>) -> Map<String, Value> {
    // `undefined` sections are skipped when TypeScript merges; null stands in for them here.
    let present = |map: &Map<String, Value>| {
        Value::Object(map.iter().filter(|(_, value)| !value.is_null()).map(|(k, v)| (k.clone(), v.clone())).collect())
    };
    let mut result = merge(&[&present(base), &present(surface)]);
    for section in ["text", "background"] {
        let actions = contextual_actions(
            base.get(section).and_then(|value| value.get("action")),
            surface.get(section).and_then(|value| value.get("action")),
        );
        let mut merged = result.get(section).and_then(Value::as_object).cloned().unwrap_or_default();
        merged.insert("action".to_owned(), actions);
        result.insert(section.to_owned(), Value::Object(merged));
    }
    result
}

fn contextual_actions(base: Option<&Value>, surface: Option<&Value>) -> Value {
    let variants = VARIANTS.iter().map(|variant| {
        let base = base.and_then(|value| value.get(*variant));
        let surface = surface.and_then(|value| value.get(*variant));
        let pick = |key: &str| {
            fn read<'a>(value: Option<&'a Value>, key: &str) -> Option<&'a Value> {
                value.and_then(|value| value.get(key)).filter(|value| !value.is_null())
            }
            read(surface, key)
                .or_else(|| read(surface, "base"))
                .or_else(|| read(base, key))
                .or_else(|| read(base, "base"))
                .cloned()
                .unwrap_or(Value::Null)
        };
        let states = std::iter::once("base".to_owned())
            .chain(STATES.iter().map(|state| format!("${state}")))
            .map(|key| {
                let value = pick(&key);
                (key, value)
            })
            .collect();
        (variant.to_string(), Value::Object(states))
    });
    Value::Object(variants.collect())
}

fn resolve_hue(definition: Option<&Value>) -> Result<Vec<(String, Scale)>, String> {
    let source = definition.and_then(Value::as_object).ok_or("Theme hues are missing")?;
    let mut cache = HashMap::new();
    source.keys().map(|name| Ok((name.clone(), hue_scale(source, name, &mut Vec::new(), &mut cache)?))).collect()
}

fn hue_scale(
    source: &Map<String, Value>,
    name: &str,
    stack: &mut Vec<String>,
    cache: &mut HashMap<String, Scale>,
) -> Result<Scale, String> {
    if let Some(hit) = cache.get(name) {
        return Ok(*hit);
    }
    if stack.iter().any(|item| item == name) {
        return Err(format!("Circular hue reference: {} -> {name}", stack.join(" -> ")));
    }
    let scale = match source.get(name) {
        Some(Value::String(alias)) => {
            let target = alias.strip_prefix("$hue.").filter(|target| !target.is_empty());
            let Some(target) = target else {
                return Err(format!("Hue alias \"{alias}\" must reference a hue scale"));
            };
            if source.get(target).is_none() {
                return Err(format!("Hue alias \"{alias}\" references a missing hue"));
            }
            stack.push(name.to_owned());
            let scale = hue_scale(source, target, stack, cache);
            stack.pop();
            scale?
        }
        Some(Value::Object(steps)) => {
            let mut colors = [Color::TRANSPARENT; 9];
            for (index, step) in STEPS.iter().enumerate() {
                match steps.get(&step.to_string()) {
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
    cache.insert(name.to_owned(), scale);
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

struct Resolver<'a> {
    tokens: &'a Map<String, Value>,
    hue: &'a [(String, Scale)],
    cache: HashMap<String, Tone>,
}

/// The tokens of one surface, and every token's [`Tone`] in [`Tokens::visit`] order.
fn resolve_view(tokens: &Map<String, Value>, hue: &[(String, Scale)]) -> Result<(Tokens, Vec<Tone>), String> {
    let mut resolver = Resolver { tokens, hue, cache: HashMap::new() };
    let mut flat = HashMap::new();
    for (key, value) in tokens {
        resolver.walk(value, &format!("theme.{key}"), key, &mut flat)?;
    }
    let mut result = Tokens::blank();
    let mut missing = None;
    let mut tones = Vec::new();
    result.visit(&mut |path, color| match flat.get(path) {
        Some(found) => {
            *color = found.0;
            tones.push(*found);
        }
        None => {
            missing.get_or_insert_with(|| path.to_owned());
        }
    });
    match missing {
        Some(path) => Err(format!("Theme token \"{path}\" is missing")),
        None => Ok((result, tones)),
    }
}

impl<'a> Resolver<'a> {
    /// Resolves every leaf under `value`; `path` names it in errors, `key` is its token path.
    fn walk(&mut self, value: &Value, path: &str, key: &str, flat: &mut HashMap<String, Tone>) -> Result<(), String> {
        match value {
            Value::String(text) => {
                let color = self.color(text, path, &mut Vec::new())?;
                flat.insert(key.to_owned(), color);
                Ok(())
            }
            // Numbers pass through the TypeScript resolver and are never colors.
            Value::Number(_) => Ok(()),
            Value::Object(object) => {
                for (name, item) in object {
                    self.walk(item, &format!("{path}.{name}"), &format!("{key}.{}", resolved_key(name)), flat)?;
                }
                Ok(())
            }
            _ => Err(format!("Invalid theme value at \"{path}\"")),
        }
    }

    fn color(&mut self, value: &str, path: &str, stack: &mut Vec<String>) -> Result<Tone, String> {
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
        if stack.iter().any(|item| item == target) {
            return Err(format!("Circular theme reference: {} -> {target}", stack.join(" -> ")));
        }
        stack.push(target.to_owned());
        let result = match self.read(target)? {
            Read::Color(color) => Some(color),
            Read::Value(Value::String(text)) => Some(self.color(text, target, stack)?),
            Read::Value(Value::Object(object)) => {
                let mut ignored = HashMap::new();
                for (name, item) in object {
                    self.walk(item, &format!("{target}.{name}"), name, &mut ignored)?;
                }
                None
            }
            Read::Value(Value::Number(_)) | Read::NotColor => None,
            Read::Value(_) => return Err(format!("Invalid theme value at \"{target}\"")),
        };
        stack.pop();
        let Some(color) = result else {
            return Err(format!("Theme reference \"{value}\" at \"{path}\" is not a color"));
        };
        self.cache.insert(target.to_owned(), color);
        Ok(color)
    }

    fn read(&self, path: &str) -> Result<Read<'a>, String> {
        let missing = || format!("Theme reference \"${path}\" was not found");
        if let Some(rest) = path.strip_prefix("hue.") {
            let step = rest.rsplit_once('.').and_then(|(name, step)| {
                let index = STEPS.iter().position(|known| known.to_string() == step)?;
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
        let mut current: Option<&'a Value> = None;
        for (index, key) in path.split('.').enumerate() {
            current = if index == 0 { self.tokens.get(key) } else { current.and_then(|value| value.get(key)) };
        }
        match current {
            Some(Value::Null) | None => Err(missing()),
            Some(value) => Ok(Read::Value(value)),
        }
    }
}

/// `$hovered` and the other state keys resolve to `hovered`; other keys keep their name.
fn resolved_key(key: &str) -> &str {
    match key.strip_prefix('$') {
        Some(state) if STATES.contains(&state) => state,
        _ => key,
    }
}
