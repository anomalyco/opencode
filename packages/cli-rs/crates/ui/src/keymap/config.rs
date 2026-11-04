//! The `keybinds` config: overrides on the generated defaults, resolved into bindings per name, as
//! `TuiKeybind.parse` and `TuiConfig.resolve` do (`packages/tui/src/config/keybind.ts:341-361`,
//! `packages/tui/src/config/index.tsx:295-319`).

use super::generated::DEFINITIONS;
use opentui::keymap::extras::{BindingItem, BindingLookup, BindingValue};
use opentui::keymap::{Binding, Key, KeyEventType, Stroke};
use serde_json::{Map, Value};

/// Every keybind name with its bindings: the user's value, else the default.
pub struct Keybinds<T> {
    pub(super) lookup: BindingLookup<T>,
}

impl<T: Clone> Keybinds<T> {
    /// The defaults with no overrides, on a platform that can suspend the terminal.
    pub fn defaults() -> Self {
        Self::resolve(&Map::new(), true).expect("the generated defaults are valid")
    }

    /// Resolves the `keybinds` object of `cli.json`. Without terminal suspend (Windows), `terminal.suspend` is off
    /// and `ctrl+z` joins an unset `input.undo`.
    pub fn resolve(overrides: &Map<String, Value>, terminal_suspend: bool) -> Result<Self, String> {
        let unknown: Vec<&str> = overrides
            .keys()
            .map(String::as_str)
            .filter(|name| {
                !DEFINITIONS
                    .iter()
                    .any(|definition| definition.name == *name)
            })
            .collect();
        if !unknown.is_empty() {
            let plural = if unknown.len() == 1 { "" } else { "s" };
            return Err(format!(
                "Unrecognized keybind{plural}: {}",
                unknown.join(", ")
            ));
        }
        let mut overrides = overrides.clone();
        if !terminal_suspend {
            overrides.insert("terminal.suspend".to_owned(), Value::from("none"));
            if !overrides.contains_key("input.undo") {
                let undo = default_value("input.undo");
                let mut keys = vec!["ctrl+z"];
                for key in undo.as_str().into_iter().flat_map(|undo| undo.split(',')) {
                    if !keys.contains(&key) {
                        keys.push(key);
                    }
                }
                overrides.insert("input.undo".to_owned(), Value::from(keys.join(",")));
            }
        }
        let config = DEFINITIONS
            .iter()
            .map(|definition| {
                let value = overrides
                    .get(definition.name)
                    .cloned()
                    .unwrap_or_else(|| default_value(definition.name));
                binding_value(&value)
                    .map(|value| (definition.name.to_owned(), value))
                    .map_err(|reason| format!("Invalid keybind \"{}\": {reason}", definition.name))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let defaults = |command: &str, binding: &mut Binding<T>| {
            if binding.desc.is_none() {
                binding.desc = description(command).map(str::to_owned);
            }
        };
        Ok(Self {
            lookup: BindingLookup::with_options(config, None, Some(&defaults))?,
        })
    }

    /// The bindings of `name`, empty when it has none.
    pub fn get(&self, name: &str) -> &[Binding<T>] {
        self.lookup.get(name)
    }

    /// The lookup, for `gather`, `pick`, and `omit`.
    pub fn lookup(&self) -> &BindingLookup<T> {
        &self.lookup
    }
}

/// The default value of a keybind name, as JSON.
pub fn default_value(name: &str) -> Value {
    let definition = DEFINITIONS
        .iter()
        .find(|definition| definition.name == name)
        .expect("a defined keybind name");
    serde_json::from_str(definition.default).expect("generated defaults are JSON")
}

/// The description of a keybind name.
pub fn description(name: &str) -> Option<&'static str> {
    DEFINITIONS
        .iter()
        .find(|definition| definition.name == name)
        .map(|definition| definition.description)
}

/// Decodes a value as `TuiKeybind.BindingValueSchema` does, then maps it as `createBindingLookup` does.
fn binding_value<T>(value: &Value) -> Result<BindingValue<T>, String> {
    match value {
        Value::Bool(false) => Ok(BindingValue::Disabled),
        Value::String(text) if text == "none" => Ok(BindingValue::Disabled),
        Value::Array(items) if items.is_empty() => Ok(BindingValue::Disabled),
        Value::Array(items) => items
            .iter()
            .map(binding_item)
            .collect::<Result<_, _>>()
            .map(BindingValue::Items),
        item => Ok(BindingValue::Items(vec![binding_item(item)?])),
    }
}

fn binding_item<T>(item: &Value) -> Result<BindingItem<T>, String> {
    match item {
        Value::String(text) => Ok(BindingItem::Key(Key::Text(text.clone()))),
        // Effect's union tries the key stroke first, so an object with a `name` is a stroke.
        Value::Object(object) if object.get("name").is_some_and(Value::is_string) => {
            Ok(BindingItem::Key(stroke(object)?))
        }
        Value::Object(object) => binding_object(object).map(BindingItem::Binding),
        _ => Err("expected a key string, a key stroke, or a binding object".to_owned()),
    }
}

fn stroke(object: &Map<String, Value>) -> Result<Key, String> {
    let flag = |name: &str| match object.get(name) {
        None => Ok(false),
        Some(Value::Bool(on)) => Ok(*on),
        Some(_) => Err(format!("\"{name}\" must be a boolean")),
    };
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .expect("checked by the caller");
    Ok(Key::Stroke(Stroke {
        name: name.to_owned(),
        ctrl: flag("ctrl")?,
        shift: flag("shift")?,
        meta: flag("meta")?,
        super_: flag("super")?,
        hyper: flag("hyper")?,
    }))
}

fn binding_object<T>(object: &Map<String, Value>) -> Result<Binding<T>, String> {
    let key = match object.get("key") {
        Some(Value::String(text)) => Key::Text(text.clone()),
        Some(Value::Object(stroke_object))
            if stroke_object.get("name").is_some_and(Value::is_string) =>
        {
            stroke(stroke_object)?
        }
        _ => return Err("a binding object needs a \"key\" string or key stroke".to_owned()),
    };
    let flag = |name: &str| match object.get(name) {
        None => Ok(None),
        Some(Value::Bool(on)) => Ok(Some(*on)),
        Some(_) => Err(format!("\"{name}\" must be a boolean")),
    };
    let mut binding = Binding::new(key);
    binding.event = match object.get("event").map(|event| event.as_str()) {
        None | Some(Some("press")) => KeyEventType::Press,
        Some(Some("release")) => KeyEventType::Release,
        Some(_) => return Err("\"event\" must be \"press\" or \"release\"".to_owned()),
    };
    if let Some(prevent_default) = flag("preventDefault")? {
        binding.prevent_default = prevent_default;
    }
    if let Some(fallthrough) = flag("fallthrough")? {
        binding.fallthrough = fallthrough;
    }
    binding.desc = object
        .get("desc")
        .and_then(Value::as_str)
        .map(str::to_owned);
    binding.group = object
        .get("group")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Ok(binding)
}
