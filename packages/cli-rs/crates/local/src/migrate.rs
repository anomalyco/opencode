//! Migration of the V1 TUI config into `cli.json` (F.5, rows L04 and K03).
//!
//! Ports `packages/cli/src/config/migrate.ts`. When `cli.json` exists, its legacy
//! `terminal.copy_on_select` and legacy keybind names are rewritten in place, keeping comments. When it
//! does not, `tui.json` and the state's `kv.json` are folded into a new file.

use std::fs;
use std::io;
use std::path::Path;

use serde_json::{Map, Value};

use crate::cli_config::{self, Cursor, Decode, PositiveInt, SCHEMA_URL, section};
use crate::generated::config::{KEYBIND_NAMES, V1_COMMAND_MAP, V1_KEYBIND_NAMES};
use crate::jsonc::{self, Scanner, Segment, Tree};

/// A migration that changed something. `info` is what `Config` loads; `cause` is set when writing the
/// migrated file failed.
#[derive(Debug)]
pub struct Migration {
    pub info: Value,
    pub cause: Option<io::Error>,
}

/// `ConfigMigration.run`. `Ok(None)` when there is nothing to migrate.
pub fn run(file: &Path, config: &Path, state: &Path) -> io::Result<Option<Migration>> {
    if file.exists() {
        let text = fs::read_to_string(file)?;
        let Some(updated) = rewrite(&text) else {
            return Ok(None);
        };
        let Some(info) = cli_config::decode_text(&updated) else {
            return Ok(None);
        };
        return Ok(Some(persist(file, &updated, info.to_value())));
    }
    let legacy = read_json(&config.join("tui.json")).and_then(|value| V1::decode(&Value::Object(value)));
    let kv = read_json(&state.join("kv.json")).unwrap_or_default();
    let values = migrate_v1(legacy.as_ref(), &kv);
    if values.is_empty() {
        return Ok(None);
    }
    let mut migrated = Map::new();
    migrated.insert("$schema".into(), Value::String(SCHEMA_URL.into()));
    migrated.extend(values);
    let migrated = Value::Object(migrated);
    let text = jsonc::stringify_pretty(&migrated) + "\n";
    let result = persist(file, &text, migrated);
    if result.cause.is_none() {
        log::info!("migrated cli config to {}", file.display());
    }
    Ok(Some(result))
}

fn persist(file: &Path, text: &str, info: Value) -> Migration {
    let temp = Path::new(&format!(
        "{}.{}.{}.tmp",
        file.display(),
        std::process::id(),
        uuid::Uuid::new_v4()
    ))
    .to_path_buf();
    let cause = cli_config::write_private(file, &temp, text).err();
    let _ = fs::remove_file(&temp);
    Migration { info, cause }
}

// `readJson`: a JSONC object, or `None`.
fn read_json(file: &Path) -> Option<Map<String, Value>> {
    jsonc::parse(&fs::read_to_string(file).ok()?)?
        .as_object()
        .cloned()
}

/// The in-place rewrite of an existing `cli.json`, or `None` when nothing changes.
fn rewrite(text: &str) -> Option<String> {
    let config = jsonc::parse(text)?;
    let config = config.as_object()?;
    let terminal = config.get("terminal").and_then(Value::as_object);
    let legacy_copy = terminal.and_then(|t| t.get("copy_on_select")).and_then(Value::as_bool);
    let renamed = match legacy_copy {
        None => text.to_string(),
        Some(copy) => {
            let mut edits = Vec::new();
            if terminal.is_some_and(|t| !t.contains_key("copy")) {
                let value = Value::String(if copy { "select" } else { "manual" }.into());
                edits.push((["terminal", "copy"], Some(value)));
            }
            edits.push((["terminal", "copy_on_select"], None));
            edits.iter().try_fold(text.to_string(), |text, (path, value)| {
                let path: Vec<Segment> = path.iter().map(|&k| Segment::from(k)).collect();
                jsonc::modify(&text, &path, value.as_ref()).ok()
            })?
        }
    };
    let updated = match config.get("keybinds").and_then(Value::as_object) {
        None => renamed,
        Some(keybinds) => {
            // Drop every top-level `keybinds` property but the last, which is the one the parser keeps.
            let count = keybind_objects(&jsonc::parse_tree(&renamed)).len();
            let deduped = (1..count).fold(renamed, |text, _| {
                let tree = jsonc::parse_tree(&text);
                match keybind_objects(&tree).first() {
                    Some(&property) => remove_property(&text, &tree, property),
                    None => text,
                }
            });
            keybinds
                .keys()
                .fold(deduped, |text, name| rename_keybind(&text, name, keybinds))
        }
    };
    (updated != text).then_some(updated)
}

fn rename_keybind(text: &str, name: &str, keybinds: &Map<String, Value>) -> String {
    let target = v1_target(name).or_else(|| {
        (KEYBIND_NAMES.contains(&name) || V1_COMMAND_MAP.iter().any(|(_, to)| *to == name))
            .then_some(name)
    });
    let Some(target) = target else {
        return text.to_string();
    };
    let tree = jsonc::parse_tree(text);
    let properties = keybind_properties(&tree, name);
    if properties.is_empty() {
        return text.to_string();
    }
    let remove = !KEYBIND_NAMES.contains(&target) || (target != name && keybinds.contains_key(target));
    // The parser gives the final duplicate precedence, so remove earlier properties before renaming it.
    let drop = if remove {
        properties.len()
    } else {
        properties.len() - 1
    };
    let cleaned = (0..drop).fold(text.to_string(), |text, _| {
        let tree = jsonc::parse_tree(&text);
        match keybind_properties(&tree, name).first() {
            Some(&property) => remove_property(&text, &tree, property),
            None => text,
        }
    });
    if remove || target == name {
        return cleaned;
    }
    let tree = jsonc::parse_tree(&cleaned);
    let Some(key) = keybind_properties(&tree, name)
        .first()
        .and_then(|&p| tree.node(p).children.first().copied())
    else {
        return text.to_string();
    };
    let key = tree.node(key);
    format!(
        "{}{}{}",
        &cleaned[..key.offset],
        jsonc::stringify(&Value::String(target.into())),
        &cleaned[key.offset + key.length..]
    )
}

fn v1_target(name: &str) -> Option<&'static str> {
    V1_COMMAND_MAP
        .iter()
        .find(|(from, _)| *from == name)
        .map(|(_, to)| *to)
}

fn property_key<'t>(tree: &'t Tree, property: usize) -> Option<&'t str> {
    let key = *tree.node(property).children.first()?;
    tree.node(key).value.as_str()
}

fn keybind_objects(tree: &Tree) -> Vec<usize> {
    let Some(root) = tree.root() else {
        return Vec::new();
    };
    tree.node(root)
        .children
        .iter()
        .copied()
        .filter(|&property| property_key(tree, property) == Some("keybinds"))
        .collect()
}

fn keybind_properties(tree: &Tree, name: &str) -> Vec<usize> {
    let Some(object) = keybind_objects(tree)
        .last()
        .and_then(|&property| tree.node(property).children.get(1).copied())
    else {
        return Vec::new();
    };
    tree.node(object)
        .children
        .iter()
        .copied()
        .filter(|&property| property_key(tree, property) == Some(name))
        .collect()
}

// `removeProperty`: cuts the property and one neighboring comma, keeping everything else.
fn remove_property(text: &str, tree: &Tree, property: usize) -> String {
    let node = tree.node(property);
    let Some(parent) = node.parent.map(|p| tree.node(p)) else {
        return text.to_string();
    };
    let siblings = &parent.children;
    let index = siblings.iter().position(|&s| s == property).unwrap_or(0);
    let end = node.offset + node.length;
    if let Some(&next) = siblings.get(index + 1)
        && let Some(comma) = find_comma(text, end, tree.node(next).offset)
    {
        return format!("{}{}{}", &text[..node.offset], &text[end..comma], &text[comma + 1..]);
    }
    if index > 0 {
        let previous = tree.node(siblings[index - 1]);
        if let Some(comma) = find_comma(text, previous.offset + previous.length, node.offset) {
            return format!("{}{}{}", &text[..comma], &text[comma + 1..node.offset], &text[end..]);
        }
    }
    if let Some(comma) = find_comma(text, end, parent.offset + parent.length) {
        return format!("{}{}{}", &text[..node.offset], &text[end..comma], &text[comma + 1..]);
    }
    format!("{}{}", &text[..node.offset], &text[end..])
}

fn find_comma(text: &str, start: usize, end: usize) -> Option<usize> {
    let mut scanner = Scanner::new(text);
    scanner.set_position(start);
    loop {
        scanner.scan();
        let offset = scanner.offset();
        if scanner.length() == 0 || offset >= end {
            return None;
        }
        if text.as_bytes()[offset] == b',' {
            return Some(offset);
        }
    }
}

cli_config::literals!(DiffStyle { Auto = "auto", Stacked = "stacked" });

section!(V1Attention {
    enabled: bool,
    notifications: bool,
    sound: bool,
    volume: cli_config::Volume,
    sound_pack: String,
    sounds: cli_config::AttentionSounds,
});
section!(V1Prompt { max_height: PositiveInt, max_width: PromptWidth });

/// `prompt.max_width`: a positive integer or `"auto"`.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
#[serde(untagged)]
pub enum PromptWidth {
    Fixed(PositiveInt),
    Auto(&'static str),
}

impl Decode for PromptWidth {
    fn decode(value: &Value) -> Option<Self> {
        if value.as_str() == Some("auto") {
            return Some(Self::Auto("auto"));
        }
        PositiveInt::decode(value).map(Self::Fixed)
    }
}

/// A V1 `plugin` entry: a name, or `[name, options]`.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(untagged)]
pub enum V1Plugin {
    Name(String),
    Tuple(String, Map<String, Value>),
}

impl Decode for V1Plugin {
    fn decode(value: &Value) -> Option<Self> {
        if let Some(name) = value.as_str() {
            return Some(Self::Name(name.into()));
        }
        match value.as_array()?.as_slice() {
            [name, options] => Some(Self::Tuple(String::decode(name)?, Map::decode(options)?)),
            _ => None,
        }
    }
}

/// `scroll_acceleration`: `enabled` is required.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
pub struct ScrollAcceleration {
    pub enabled: bool,
}

impl Decode for ScrollAcceleration {
    fn decode(value: &Value) -> Option<Self> {
        Some(Self {
            enabled: bool::decode(value.as_object()?.get("enabled")?)?,
        })
    }
}

/// V1 `keybinds`: known V1 names in V1 definition order.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(transparent)]
pub struct V1Keybinds(pub Map<String, Value>);

impl Decode for V1Keybinds {
    fn decode(value: &Value) -> Option<Self> {
        cli_config::decode_bindings(value, V1_KEYBIND_NAMES).map(Self)
    }
}

/// `scroll_speed`: a number of at least 0.001.
pub type V1ScrollSpeed = cli_config::ScrollSpeed;

section!(
    /// The V1 `tui.json` (`TuiConfigV1.Info`).
    V1 {
        #[serde(rename = "$schema")]
        schema = "$schema": String,
        theme: String,
        keybinds: V1Keybinds,
        plugin: Vec<V1Plugin>,
        plugin_enabled: indexmap::IndexMap<String, bool>,
        leader_timeout: PositiveInt,
        attention: V1Attention,
        prompt: V1Prompt,
        scroll_speed: V1ScrollSpeed,
        scroll_acceleration: ScrollAcceleration,
        diff_style: DiffStyle,
        mouse: bool,
        cursor: Cursor,
    }
);

/// `migrateV1(legacy, kv)`: the new config values, in the TypeScript key order. `kv` values are used as
/// they are, so a bad one makes the merged config fail to decode, as in TypeScript.
pub fn migrate_v1(legacy: Option<&V1>, kv: &Map<String, Value>) -> Map<String, Value> {
    let empty = V1::default();
    let legacy = legacy.unwrap_or(&empty);
    let kv = |key: &str| kv.get(key).cloned();
    // `a ?? b`: `b` when `a` is absent or null.
    let nullish = |a: Option<Value>, b: Option<Value>| a.filter(|v| !v.is_null()).or(b);
    let mut out = Map::new();
    let mut put = |key: &str, value: Option<Value>| {
        if let Some(value) = value {
            out.insert(key.into(), value);
        }
    };
    let object = |entries: Vec<(&str, Option<Value>)>| {
        let map: Map<String, Value> = entries
            .into_iter()
            .filter_map(|(key, value)| Some((key.to_string(), value?)))
            .collect();
        Value::Object(map)
    };

    let plugins: Vec<Value> = legacy
        .plugin
        .iter()
        .flatten()
        .map(|plugin| match plugin {
            V1Plugin::Name(name) => Value::String(name.clone()),
            V1Plugin::Tuple(name, options) => serde_json::json!({ "package": name, "options": options }),
        })
        .chain(legacy.plugin_enabled.iter().flatten().map(|(id, enabled)| {
            Value::String(if *enabled { id.clone() } else { format!("-{id}") })
        }))
        .collect();
    let theme_name = nullish(legacy.theme.clone().map(Value::String), kv("theme"));
    let theme_mode = kv("theme_mode_lock");
    let sound_pack = kv("attention_sound_pack");
    let stacked = legacy.diff_style == Some(DiffStyle::Stacked);
    let diff_view = nullish(kv("diff_viewer_view"), stacked.then(|| Value::String("unified".into())));
    let thinking = nullish(
        kv("thinking_mode"),
        kv("thinking_visibility").map(|v| Value::String(if cli_config::truthy(&v) { "show" } else { "hide" }.into())),
    );
    let keybinds = legacy.keybinds.as_ref().map(|keybinds| {
        let map: Map<String, Value> = keybinds
            .0
            .iter()
            .filter_map(|(name, value)| {
                let target = v1_target(name).unwrap_or(name);
                KEYBIND_NAMES.contains(&target).then(|| (target.to_string(), value.clone()))
            })
            .collect();
        Value::Object(map)
    });

    if theme_name.is_some() || theme_mode.is_some() {
        put("theme", Some(object(vec![("name", theme_name), ("mode", theme_mode)])));
    }
    put("keybinds", keybinds);
    put("plugins", (!plugins.is_empty()).then_some(Value::Array(plugins)));
    put(
        "leader",
        legacy.leader_timeout.map(|t| serde_json::json!({ "timeout": t.0 })),
    );
    let acceleration = legacy.scroll_acceleration.map(|a| Value::Bool(a.enabled));
    if legacy.scroll_speed.is_some() || acceleration.is_some() {
        put(
            "scroll",
            Some(object(vec![
                ("speed", legacy.scroll_speed.map(|s| json(&s.0))),
                ("acceleration", acceleration),
            ])),
        );
    }
    if legacy.attention.is_some() || sound_pack.is_some() {
        let mut attention = match legacy.attention.as_ref().map(json) {
            Some(Value::Object(map)) => map,
            _ => Map::new(),
        };
        if let Some(pack) = sound_pack {
            attention.insert("sound_pack".into(), pack);
        }
        put("attention", Some(Value::Object(attention)));
    }
    let diffs = [
        ("wrap", kv("diff_wrap_mode")),
        ("tree", kv("diff_viewer_show_file_tree")),
        ("single", kv("diff_viewer_single_patch")),
        ("view", diff_view),
    ];
    if legacy.diff_style.is_some() || diffs.iter().any(|(_, v)| v.is_some()) {
        put("diffs", Some(object(diffs.into())));
    }
    put(
        "terminal",
        kv("terminal_title_enabled").map(|title| object(vec![("title", Some(title))])),
    );
    let prompt = [
        ("editor", kv("file_context_enabled")),
        (
            "paste",
            kv("paste_summary_enabled")
                .map(|v| Value::String(if cli_config::truthy(&v) { "compact" } else { "full" }.into())),
        ),
    ];
    if prompt.iter().any(|(_, v)| v.is_some()) {
        put("prompt", Some(object(prompt.into())));
    }
    let session = [
        ("sidebar", kv("sidebar")),
        ("scrollbar", kv("scrollbar_visible")),
        ("thinking", thinking),
        (
            "grouping",
            kv("exploration_grouping")
                .map(|v| Value::String(if cli_config::truthy(&v) { "auto" } else { "none" }.into())),
        ),
    ];
    if session.iter().any(|(_, v)| v.is_some()) {
        put("session", Some(object(session.into())));
    }
    put("animations", kv("animations_enabled"));
    put("mouse", legacy.mouse.map(Value::Bool));
    put("cursor", legacy.cursor.as_ref().map(json));
    out
}

fn json<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rewrites_legacy_copy_and_keybind_names_in_place() {
        let text = "{\n  // keep\n  \"terminal\": { \"copy_on_select\": true },\n  \"keybinds\": {\n    \"session_new\": \"ctrl+n\", // new\n    \"app.exit\": \"ctrl+q\"\n  }\n}\n";
        let updated = rewrite(text).unwrap();
        assert_eq!(
            updated,
            "{\n  // keep\n  \"terminal\": {\n    \"copy\": \"select\"\n  },\n  \"keybinds\": {\n    \"session.new\": \"ctrl+n\", // new\n    \"app.exit\": \"ctrl+q\"\n  }\n}\n"
        );
        assert_eq!(rewrite("{\"mouse\": true}"), None);
    }

    #[test]
    fn migrates_v1_and_kv_in_typescript_order() {
        let legacy = V1::decode(&json!({
            "theme": "tokyonight",
            "keybinds": {"session_new": "ctrl+n", "bogus": "x"},
            "plugin": ["a", ["b", {"x": 1}]],
            "plugin_enabled": {"c": false},
            "leader_timeout": 500,
            "diff_style": "stacked",
            "mouse": false,
        }))
        .unwrap();
        let kv = json!({"theme_mode_lock": "dark", "thinking_visibility": false, "animations_enabled": true});
        let values = migrate_v1(Some(&legacy), kv.as_object().unwrap());
        assert_eq!(
            jsonc::stringify(&Value::Object(values)),
            r#"{"theme":{"name":"tokyonight","mode":"dark"},"keybinds":{"session.new":"ctrl+n"},"plugins":["a",{"package":"b","options":{"x":1}},"-c"],"leader":{"timeout":500},"diffs":{"view":"unified"},"session":{"thinking":"hide"},"animations":true,"mouse":false}"#
        );
    }
}
