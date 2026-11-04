//! `cli.json` read, merge, overlay, and edits (F.5).
//!
//! Ports `packages/cli/src/config/config.ts` and the schema it decodes
//! (`packages/cli/src/config/schema.ts`, `packages/tui/src/config/index.tsx:69-340`).
//!
//! Decoding is as strict as Effect Schema: a wrong type, a `null`, or a number out of range anywhere
//! fails the whole document, which then reads as `{}`. Unknown keys are dropped. Decoded values keep
//! the schema's field order, as Effect's output does, so the edit diff and the JSON the TypeScript
//! client would write line up.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use indexmap::IndexMap;
use serde::{Serialize, Serializer};
use serde_json::{Map, Value};

use crate::generated::config::KEYBIND_NAMES;
use crate::jsonc::{self, Segment};
use crate::lock;
use crate::migrate;
use crate::paths::Paths;

pub const SCHEMA_URL: &str = "https://opencode.ai/v2/cli.json";

/// Decoding of one schema node from JSON. `None` means the value does not match.
pub trait Decode: Sized {
    fn decode(value: &Value) -> Option<Self>;
}

impl Decode for String {
    fn decode(value: &Value) -> Option<Self> {
        value.as_str().map(str::to_string)
    }
}

impl Decode for bool {
    fn decode(value: &Value) -> Option<Self> {
        value.as_bool()
    }
}

impl<T: Decode> Decode for Vec<T> {
    fn decode(value: &Value) -> Option<Self> {
        value.as_array()?.iter().map(T::decode).collect()
    }
}

impl<T: Decode> Decode for IndexMap<String, T> {
    fn decode(value: &Value) -> Option<Self> {
        value
            .as_object()?
            .iter()
            .map(|(key, value)| Some((key.clone(), T::decode(value)?)))
            .collect()
    }
}

/// `Schema.Record(Schema.String, Schema.Any)`.
impl Decode for Map<String, Value> {
    fn decode(value: &Value) -> Option<Self> {
        value.as_object().cloned()
    }
}

/// An optional field: absent is `Some(None)`, present must decode.
pub(crate) fn field<T: Decode>(map: &Map<String, Value>, key: &str) -> Option<Option<T>> {
    match map.get(key) {
        None => Some(None),
        Some(value) => T::decode(value).map(Some),
    }
}

/// A `Schema.Literals` enum.
macro_rules! literals {
    ($(#[$meta:meta])* $name:ident { $($variant:ident = $text:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            pub fn as_str(self) -> &'static str {
                match self {
                    $(Self::$variant => $text),+
                }
            }
        }

        impl $crate::cli_config::Decode for $name {
            fn decode(value: &serde_json::Value) -> Option<Self> {
                match value.as_str()? {
                    $($text => Some(Self::$variant),)+
                    _ => None,
                }
            }
        }

        impl serde::Serialize for $name {
            fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(self.as_str())
            }
        }
    };
}
pub(crate) use literals;

/// A `Schema.Struct` whose fields are all optional. A field can name its JSON key with `= "key"`.
macro_rules! section {
    ($(#[$meta:meta])* $name:ident { $($(#[$field_meta:meta])* $field:ident $(= $key:literal)? : $ty:ty),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
        pub struct $name {
            $(
                $(#[$field_meta])*
                #[serde(skip_serializing_if = "Option::is_none")]
                pub $field: Option<$ty>,
            )+
        }

        impl $crate::cli_config::Decode for $name {
            fn decode(value: &serde_json::Value) -> Option<Self> {
                let map = value.as_object()?;
                Some(Self {
                    $($field: $crate::cli_config::field(map, $crate::cli_config::section!(@key $field $($key)?))?,)+
                })
            }
        }
    };
    (@key $field:ident) => { stringify!($field) };
    (@key $field:ident $key:literal) => { $key };
}
pub(crate) use section;

/// `Schema.Int.check(Schema.isGreaterThan(0))`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct PositiveInt(pub u64);

impl Decode for PositiveInt {
    fn decode(value: &Value) -> Option<Self> {
        let number = value.as_f64()?;
        (number.fract() == 0.0 && number > 0.0 && number <= 9_007_199_254_740_991.0)
            .then_some(Self(number as u64))
    }
}

/// A finite number within `min..=max`.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(transparent)]
pub struct Bounded<const MIN_MILLI: i64, const MAX_MILLI: i64>(pub f64);

impl<const MIN_MILLI: i64, const MAX_MILLI: i64> Decode for Bounded<MIN_MILLI, MAX_MILLI> {
    fn decode(value: &Value) -> Option<Self> {
        let number = value.as_f64()?;
        (number >= MIN_MILLI as f64 / 1000.0 && number <= MAX_MILLI as f64 / 1000.0)
            .then_some(Self(number))
    }
}

/// `scroll.speed`: at least 0.001.
pub type ScrollSpeed = Bounded<1, { i64::MAX }>;
/// `attention.volume`: 0 to 1.
pub type Volume = Bounded<0, 1000>;

literals!(ThemeMode { System = "system", Dark = "dark", Light = "light" });
literals!(AttentionSoundName {
    Default = "default",
    Question = "question",
    Permission = "permission",
    Error = "error",
    Done = "done",
    SubagentDone = "subagent_done",
});
literals!(DiffSource { Working = "working", Branch = "branch", Committed = "committed", Turn = "turn" });
literals!(DiffWrap { Word = "word", None = "none" });
literals!(DiffView { Auto = "auto", Split = "split", Unified = "unified" });
literals!(TerminalCopy { Manual = "manual", Select = "select" });
literals!(PromptPaste { Compact = "compact", Full = "full" });
literals!(Sidebar { Auto = "auto", Hide = "hide" });
literals!(SubmitScroll { Bottom = "bottom", Keep = "keep" });
literals!(Visibility { Show = "show", Hide = "hide" });
literals!(Grouping { Auto = "auto", None = "none" });
literals!(Verbosity { Low = "low", Medium = "medium", High = "high" });
literals!(Markdown { Source = "source", Rendered = "rendered" });
literals!(NewLocation { Launch = "launch", Inherit = "inherit" });
literals!(Permissions { Prompt = "prompt", Autoaccept = "autoaccept" });
literals!(TabsMode { Auto = "auto", On = "on", Off = "off" });
literals!(TabsScope { Global = "global", Cwd = "cwd" });
literals!(TabsLayout { Horizontal = "horizontal", Vertical = "vertical" });
literals!(TabsIndicators { Status = "status", Numbers = "numbers" });
literals!(MiniWorkSpinner {
    BlockSoftSlide = "block-soft-slide",
    BlockSoftSweep = "block-soft-sweep",
    BlockLowComet = "block-low-comet",
    BlockLowDuet = "block-low-duet",
    BlockShuttle = "block-shuttle",
    BlockBridge = "block-bridge",
    BlockSqueeze = "block-squeeze",
    SmallToggle = "small-toggle",
    SquareToggle = "square-toggle",
    GrowShrink = "grow-shrink",
    QuadrantOrbit = "quadrant-orbit",
    Crosshatch = "crosshatch",
    DensityWave = "density-wave",
    Seed = "seed",
});
literals!(CursorStyle { Block = "block", Underline = "underline", Line = "line", Default = "default" });

section!(Theme {
    name: String,
    mode: ThemeMode
});
section!(Leader {
    timeout: PositiveInt
});
section!(Scroll {
    speed: ScrollSpeed,
    acceleration: bool
});
section!(AttentionSounds {
    default: String,
    question: String,
    permission: String,
    error: String,
    done: String,
    subagent_done: String,
});
section!(Attention {
    notifications: bool,
    sound: bool,
    volume: Volume,
    sound_pack: String,
    sounds: AttentionSounds,
});
section!(Diffs {
    source: DiffSource,
    wrap: DiffWrap,
    tree: bool,
    single: bool,
    fullscreen: bool,
    view: DiffView,
});
section!(Terminal {
    title: bool,
    copy: TerminalCopy
});
section!(Prompt {
    editor: bool,
    paste: PromptPaste,
    image_preview: bool
});
section!(Session {
    sidebar: Sidebar,
    scrollbar: bool,
    submit_scroll: SubmitScroll,
    thinking: Visibility,
    grouping: Grouping,
    verbosity: Verbosity,
    image_preview: bool,
    tps: bool,
    markdown: Markdown,
    new_location: NewLocation,
    permissions: Permissions,
});
section!(Tabs {
    mode: TabsMode,
    enabled: bool,
    scope: TabsScope,
    layout: TabsLayout,
    indicators: TabsIndicators,
});
section!(Mini {
    thinking: Visibility,
    tools: Visibility,
    shell_output: Visibility,
    turn_summary: Visibility,
    footer: Visibility,
    splash: Visibility,
    work_spinner: MiniWorkSpinner,
    mono: bool,
    replay: bool,
    replay_limit: PositiveInt,
});
section!(Debug {
    devtools: bool,
    timing: bool,
    turn_tokens: TurnTokens
});
section!(Cursor {
    style: CursorStyle,
    blinking: bool
});

section!(
    /// The decoded `cli.json` (`Config.Info`).
    Info {
        #[serde(rename = "$schema")]
        schema = "$schema": String,
        theme: Theme,
        keybinds: Keybinds,
        plugins: Vec<Plugin>,
        leader: Leader,
        scroll: Scroll,
        attention: Attention,
        diffs: Diffs,
        terminal: Terminal,
        prompt: Prompt,
        session: Session,
        tabs: Tabs,
        mini: Mini,
        debug: Debug,
        experimental: IndexMap<String, bool>,
        animations: bool,
        highlights: bool,
        mouse: bool,
        cursor: Cursor,
    }
);

impl Info {
    /// Whether an `experimental` flag is on (`useNewDesigns`, `useClientMcpExperiment`).
    pub fn experiment(&self, name: &str) -> bool {
        self.experimental
            .as_ref()
            .and_then(|flags| flags.get(name))
            .copied()
            .unwrap_or(false)
    }

    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).unwrap_or_default()
    }
}

/// `debug.turn_tokens`: a boolean or `"verbose"`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TurnTokens {
    Enabled(bool),
    Verbose,
}

impl Decode for TurnTokens {
    fn decode(value: &Value) -> Option<Self> {
        match value {
            Value::Bool(enabled) => Some(Self::Enabled(*enabled)),
            Value::String(text) if text == "verbose" => Some(Self::Verbose),
            _ => None,
        }
    }
}

impl Serialize for TurnTokens {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Enabled(enabled) => serializer.serialize_bool(*enabled),
            Self::Verbose => serializer.serialize_str("verbose"),
        }
    }
}

/// A `plugins` entry: a package name or path, or a package with options.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Plugin {
    Name(String),
    Package {
        package: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        options: Option<Map<String, Value>>,
    },
}

impl Decode for Plugin {
    fn decode(value: &Value) -> Option<Self> {
        if let Some(name) = value.as_str() {
            return Some(Self::Name(name.to_string()));
        }
        let map = value.as_object()?;
        Some(Self::Package {
            package: String::decode(map.get("package")?)?,
            options: field(map, "options")?,
        })
    }
}

/// The `keybinds` overrides: known names only, in definition order, each a valid binding value in the
/// shape Effect decodes it to. U.2's `Keybinds::resolve` takes [`Keybinds::map`].
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(transparent)]
pub struct Keybinds(pub Map<String, Value>);

impl Keybinds {
    pub fn map(&self) -> &Map<String, Value> {
        &self.0
    }
}

impl Decode for Keybinds {
    fn decode(value: &Value) -> Option<Self> {
        decode_bindings(value, KEYBIND_NAMES).map(Self)
    }
}

/// A `KeybindOverrides` struct over `names`, in their order.
pub(crate) fn decode_bindings(value: &Value, names: &[&str]) -> Option<Map<String, Value>> {
    let map = value.as_object()?;
    names
        .iter()
        .filter_map(|&name| map.get(name).map(|value| (name, value)))
        .map(|(name, value)| Some((name.to_string(), binding_value(value)?)))
        .collect()
}

// `BindingValueSchema`: `false`, `"none"`, an item, or an array of items.
fn binding_value(value: &Value) -> Option<Value> {
    match value {
        Value::Bool(false) => Some(value.clone()),
        Value::Array(items) => items
            .iter()
            .map(binding_item)
            .collect::<Option<_>>()
            .map(Value::Array),
        _ => binding_item(value),
    }
}

// `Union([String, KeyStroke, BindingObject])`: the first member that matches, as Effect picks it.
fn binding_item(value: &Value) -> Option<Value> {
    if value.is_string() {
        return Some(value.clone());
    }
    keystroke(value).or_else(|| binding_object(value))
}

fn keystroke(value: &Value) -> Option<Value> {
    let map = value.as_object()?;
    let mut out = Map::new();
    out.insert(
        "name".into(),
        Value::String(String::decode(map.get("name")?)?),
    );
    for key in ["ctrl", "shift", "meta", "super", "hyper"] {
        if let Some(flag) = field::<bool>(map, key)? {
            out.insert(key.into(), Value::Bool(flag));
        }
    }
    Some(Value::Object(out))
}

// `StructWithRest`: the struct's fields in schema order, then every other key in input order.
fn binding_object(value: &Value) -> Option<Value> {
    const FIELDS: [&str; 4] = ["key", "event", "preventDefault", "fallthrough"];
    let map = value.as_object()?;
    let key = map.get("key")?;
    let mut out = Map::new();
    out.insert(
        "key".into(),
        if key.is_string() {
            key.clone()
        } else {
            keystroke(key)?
        },
    );
    if let Some(event) = map.get("event") {
        if !matches!(event.as_str(), Some("press" | "release")) {
            return None;
        }
        out.insert("event".into(), event.clone());
    }
    for key in ["preventDefault", "fallthrough"] {
        if let Some(flag) = field::<bool>(map, key)? {
            out.insert(key.into(), Value::Bool(flag));
        }
    }
    for (key, item) in map {
        if !FIELDS.contains(&key.as_str()) {
            out.insert(key.clone(), item.clone());
        }
    }
    Some(Value::Object(out))
}

/// `Option.getOrUndefined(decode(parseRecord(text)))`: JSONC text to `Info`, `None` when the text or
/// the schema fails.
pub fn decode_text(text: &str) -> Option<Info> {
    let value = jsonc::parse(text)?;
    value.as_object()?;
    Info::decode(&value)
}

/// `merge(...values)`: normalizes legacy `tabs.enabled`, deep-merges plain objects left to right, and
/// decodes the result, which is `{}` when it does not decode.
pub fn merge(values: &[Option<Value>]) -> Info {
    let merged = values.iter().flatten().fold(Map::new(), |result, value| {
        match normalize_legacy_tabs(value) {
            Value::Object(overlay) => merge_records(result, &overlay),
            _ => result,
        }
    });
    Info::decode(&Value::Object(merged)).unwrap_or_default()
}

// `normalizeLegacyTabs`: `tabs.mode ??= enabled ? "on" : "off"`, then drop `enabled`.
fn normalize_legacy_tabs(value: &Value) -> Value {
    let mut value = value.clone();
    if let Some(tabs) = value.get_mut("tabs").and_then(Value::as_object_mut)
        && let Some(enabled) = tabs.get("enabled").cloned()
    {
        if tabs.get("mode").is_none_or(Value::is_null) {
            let mode = if truthy(&enabled) { "on" } else { "off" };
            tabs.insert("mode".into(), Value::String(mode.into()));
        }
        tabs.shift_remove("enabled");
    }
    value
}

pub(crate) fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(text) => !text.is_empty(),
        _ => true,
    }
}

fn merge_records(mut base: Map<String, Value>, overlay: &Map<String, Value>) -> Map<String, Value> {
    for (key, value) in overlay {
        let merged = match (base.get_mut(key), value) {
            (Some(Value::Object(current)), Value::Object(next)) => {
                Value::Object(merge_records(std::mem::take(current), next))
            }
            _ => value.clone(),
        };
        base.insert(key.clone(), merged);
    }
    base
}

/// One path edit: `None` removes.
type Edit = (Vec<Segment>, Option<Value>);

// `changes(before, after)`: per-key edits for plain objects, a replacement for anything else.
fn changes(
    before: Option<&Value>,
    after: Option<&Value>,
    path: &mut Vec<Segment>,
    out: &mut Vec<Edit>,
) {
    match (before, after) {
        (Some(a), Some(b)) if jsonc::same(a, b) => {}
        (Some(Value::Object(a)), Some(Value::Object(b))) => {
            let keys = a.keys().chain(b.keys().filter(|key| !a.contains_key(*key)));
            for key in keys {
                path.push(Segment::Key(key.clone()));
                match (a.get(key), b.get(key)) {
                    (_, None) => out.push((path.clone(), None)),
                    (None, Some(value)) => out.push((path.clone(), Some(value.clone()))),
                    (before, after) => changes(before, after, path, out),
                }
                path.pop();
            }
        }
        (_, after) => out.push((path.clone(), after.cloned())),
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Lock(#[from] lock::Error),
    #[error("Failed to update CLI config: {0}")]
    Update(String),
}

/// `Config.Service`: the `cli.json` of one config directory, with the overlay of
/// `OPENCODE_CLI_CONFIG_CONTENT`.
#[derive(Clone, Debug)]
pub struct CliConfig {
    file: PathBuf,
    config: PathBuf,
    state: PathBuf,
    content: Option<Value>,
    lock: lock::Options,
}

impl CliConfig {
    /// The config of `paths`, with the overlay from the process environment.
    pub fn new(paths: &Paths) -> Self {
        Self::with_content(
            paths,
            std::env::var("OPENCODE_CLI_CONFIG_CONTENT").ok().as_deref(),
        )
    }

    /// The config of `paths`, with `content` as the overlay. An empty or invalid overlay is ignored.
    pub fn with_content(paths: &Paths, content: Option<&str>) -> Self {
        Self {
            file: paths.config.join("cli.json"),
            config: paths.config.clone(),
            state: paths.state.clone(),
            content: content
                .filter(|text| !text.is_empty())
                .and_then(decode_text)
                .map(|info| info.to_value()),
            lock: lock::Options::default(),
        }
    }

    pub fn path(&self) -> &Path {
        &self.file
    }

    /// `get()`: migrates under the lock, then reads. Migration failures are logged and skipped.
    pub fn get(&self) -> Result<Info, Error> {
        self.locked(|| {
            let migration = migrate::run(&self.file, &self.config, &self.state)
                .inspect_err(|error| log::warn!("failed to migrate cli config: {error}"))
                .ok()
                .flatten();
            if let Some(cause) = migration.as_ref().and_then(|m| m.cause.as_ref()) {
                log::warn!("failed to persist migrated cli config: {cause}");
            }
            self.load(migration.map(|m| m.info))
        })
    }

    /// `update(draft => ...)` on the typed config. The file keeps its comments and formatting.
    pub fn update(&self, change: impl FnOnce(&mut Info)) -> Result<Info, Error> {
        self.update_value(|value| {
            let mut info = Info::decode(value).unwrap_or_default();
            change(&mut info);
            *value = info.to_value();
        })
    }

    /// `update` on the JSON value of the config, for callers that edit by path. The result must still
    /// decode, or the update fails as in TypeScript.
    pub fn update_value(&self, change: impl FnOnce(&mut Value)) -> Result<Info, Error> {
        self.locked(|| {
            let migration = migrate::run(&self.file, &self.config, &self.state)
                .map_err(|error| Error::Update(error.to_string()))?;
            if let Some(cause) = migration.as_ref().and_then(|m| m.cause.as_ref()) {
                return Err(Error::Update(cause.to_string()));
            }
            let current = self.load(migration.map(|m| m.info)).to_value();
            let mut next = current.clone();
            change(&mut next);
            let mut edits = Vec::new();
            changes(Some(&current), Some(&next), &mut Vec::new(), &mut edits);
            if edits.is_empty() {
                return Ok(Info::decode(&current).unwrap_or_default());
            }
            let text = fs::read_to_string(&self.file).unwrap_or_else(|_| {
                jsonc::stringify_pretty(&serde_json::json!({ "$schema": SCHEMA_URL }))
            });
            let updated = edits.iter().try_fold(text, |text, (path, value)| {
                jsonc::modify(&text, path, value.as_ref())
                    .map_err(|error| Error::Update(error.to_string()))
            })?;
            let Some(config) = decode_text(&updated) else {
                return Err(Error::Update("Invalid CLI config update".into()));
            };
            let body = if updated.ends_with('\n') {
                updated
            } else {
                updated + "\n"
            };
            write_private(&self.file, &self.file.with_extension("json.tmp"), &body)
                .map_err(|error| Error::Update(error.to_string()))?;
            Ok(merge(&[Some(config.to_value()), self.content.clone()]))
        })?
    }

    /// Calls `on_change` after the config directory changes, debounced. `None` when watching is off or
    /// fails (live reload is lost, nothing else).
    pub fn watch(&self, on_change: impl FnMut() + Send + 'static) -> Option<crate::watch::Watch> {
        crate::watch::watch(&self.config, |_| true, crate::watch::DEBOUNCE, on_change)
    }

    fn load(&self, migration: Option<Value>) -> Info {
        let base = migration.or_else(|| {
            let text = fs::read_to_string(&self.file).ok()?;
            decode_text(&text).map(|info| info.to_value())
        });
        merge(&[base, self.content.clone()])
    }

    fn locked<T>(&self, f: impl FnOnce() -> T) -> Result<T, Error> {
        let key = self.file.to_string_lossy();
        Ok(lock::with_lock(
            &self.state.join("locks"),
            &key,
            &self.lock,
            f,
        )?)
    }
}

/// Writes `text` to `temp` with mode 0600, then renames it over `file`.
pub(crate) fn write_private(file: &Path, temp: &Path, text: &str) -> io::Result<()> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    io::Write::write_all(&mut options.open(temp)?, text.as_bytes())?;
    fs::rename(temp, file)
}

/// `Config.Resolved`: the config with the TUI's defaults.
#[derive(Clone, Debug, PartialEq)]
pub struct Resolved {
    pub info: Info,
    pub attention: ResolvedAttention,
    pub leader_timeout: Duration,
    pub mouse: bool,
    pub cursor_style: CursorStyle,
    pub cursor_blinking: bool,
    pub new_location: NewLocation,
    pub permissions: Permissions,
    pub tps: bool,
    pub tabs: ResolvedTabs,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedAttention {
    pub notifications: bool,
    pub sound: bool,
    pub volume: f64,
    pub sound_pack: String,
    pub sounds: AttentionSounds,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ResolvedTabs {
    pub mode: TabsMode,
    pub enabled: bool,
    pub scope: TabsScope,
    pub layout: TabsLayout,
    pub indicators: TabsIndicators,
}

impl Resolved {
    /// `resolve(info, { environment })`. Keybinds stay overrides; U.2's `Keybinds::resolve` applies the
    /// Windows rules with `terminal_suspend`.
    pub fn new(info: Info, environment: impl Fn(&str) -> Option<String>) -> Self {
        let attention = info.attention.clone().unwrap_or_default();
        let cursor = info.cursor.clone().unwrap_or_default();
        let session = info.session.clone().unwrap_or_default();
        let tabs = info.tabs.clone().unwrap_or_default();
        let mode = tabs.mode.unwrap_or(match tabs.enabled {
            None => TabsMode::Auto,
            Some(true) => TabsMode::On,
            Some(false) => TabsMode::Off,
        });
        Self {
            attention: ResolvedAttention {
                notifications: attention.notifications.unwrap_or(false),
                sound: attention.sound.unwrap_or(false),
                volume: attention.volume.map_or(0.4, |v| v.0),
                sound_pack: attention
                    .sound_pack
                    .unwrap_or_else(|| "opencode.default".into()),
                sounds: attention.sounds.unwrap_or_default(),
            },
            leader_timeout: Duration::from_millis(
                info.leader
                    .as_ref()
                    .and_then(|l| l.timeout)
                    .map_or(2000, |t| t.0),
            ),
            mouse: info.mouse.unwrap_or(true),
            cursor_style: cursor.style.unwrap_or(CursorStyle::Block),
            cursor_blinking: cursor.blinking.unwrap_or(true),
            new_location: session.new_location.unwrap_or(NewLocation::Launch),
            permissions: session.permissions.unwrap_or(Permissions::Prompt),
            tps: session.tps.unwrap_or(true),
            tabs: ResolvedTabs {
                mode,
                enabled: mode == TabsMode::On
                    || (mode == TabsMode::Auto && environment("HERDR_ENV").as_deref() != Some("1")),
                scope: tabs.scope.unwrap_or(TabsScope::Cwd),
                layout: tabs.layout.unwrap_or(TabsLayout::Horizontal),
                indicators: tabs.indicators.unwrap_or(TabsIndicators::Status),
            },
            info,
        }
    }

    /// The `keybinds` overrides for `Keybinds::resolve`.
    pub fn keybinds(&self) -> Map<String, Value> {
        self.info.keybinds.clone().unwrap_or_default().0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn decode(value: Value) -> Option<Value> {
        Info::decode(&value).map(|info| info.to_value())
    }

    #[test]
    fn decode_follows_effect_schema() {
        assert_eq!(
            decode(
                json!({"mouse": true, "theme": {"mode": "dark", "name": "x", "extra": 1}, "zzz": 1, "$schema": "s"})
            ),
            Some(json!({"$schema": "s", "theme": {"name": "x", "mode": "dark"}, "mouse": true}))
        );
        assert_eq!(
            stringify_decoded(
                json!({"keybinds": {"session.new": {"name": "a", "key": "b", "foo": 1}, "app.exit": "ctrl+q", "nope": "x"}})
            ),
            r#"{"keybinds":{"app.exit":"ctrl+q","session.new":{"name":"a"}}}"#
        );
        assert_eq!(
            stringify_decoded(
                json!({"keybinds": {"app.exit": {"foo": 1, "key": {"name": "a", "x": 1}, "desc": "d", "event": "press"}}})
            ),
            r#"{"keybinds":{"app.exit":{"key":{"name":"a"},"event":"press","foo":1,"desc":"d"}}}"#
        );
        for invalid in [
            json!({"keybinds": {"app.exit": [{"name": "a"}, "b", false]}}),
            json!({"keybinds": {"app.exit": null}}),
            json!({"theme": []}),
            json!({"theme": null}),
            json!({"leader": {"timeout": 1.5}}),
            json!({"scroll": {"speed": 0}}),
            json!({"attention": {"volume": 2}}),
            json!([]),
        ] {
            assert_eq!(decode(invalid.clone()), None, "{invalid}");
        }
        assert_eq!(
            decode(
                json!({"leader": {"timeout": 2000.0}, "attention": {"sounds": {"done": "x", "other": "y", "default": "z"}}})
            ),
            Some(
                json!({"leader": {"timeout": 2000}, "attention": {"sounds": {"default": "z", "done": "x"}}})
            )
        );
    }

    fn stringify_decoded(value: Value) -> String {
        jsonc::stringify(&decode(value).unwrap())
    }

    #[test]
    fn merge_overlays_and_normalizes_tabs() {
        let merged = merge(&[
            Some(
                json!({"tabs": {"enabled": true, "scope": "global"}, "theme": {"name": "a", "mode": "dark"}}),
            ),
            Some(json!({"theme": {"name": "b"}})),
        ]);
        assert_eq!(
            merged.to_value(),
            json!({"theme": {"name": "b", "mode": "dark"}, "tabs": {"mode": "on", "scope": "global"}})
        );
        assert_eq!(merge(&[Some(json!({"mouse": 1}))]), Info::default());
    }

    #[test]
    fn changes_diff_like_typescript() {
        let mut edits = Vec::new();
        changes(
            Some(&json!({"a": {"b": 1, "c": [1]}, "d": true})),
            Some(&json!({"a": {"b": 2, "c": [1]}, "e": "x"})),
            &mut Vec::new(),
            &mut edits,
        );
        let key = |k: &str| Segment::Key(k.into());
        assert_eq!(
            edits,
            vec![
                (vec![key("a"), key("b")], Some(json!(2))),
                (vec![key("d")], None),
                (vec![key("e")], Some(json!("x"))),
            ]
        );
    }

    #[test]
    fn resolve_applies_defaults() {
        let resolved = Resolved::new(Info::default(), |_| None);
        assert_eq!(resolved.leader_timeout, Duration::from_millis(2000));
        assert_eq!(resolved.attention.volume, 0.4);
        assert!(resolved.tabs.enabled && resolved.mouse && resolved.tps);
        let herdr = Resolved::new(Info::default(), |name| {
            (name == "HERDR_ENV").then(|| "1".to_string())
        });
        assert!(!herdr.tabs.enabled);
    }
}
