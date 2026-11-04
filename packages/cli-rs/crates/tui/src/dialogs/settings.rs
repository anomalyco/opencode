//! Settings dialog (E.18a): `packages/tui/src/component/dialog-config.tsx`.
//!
//! [`SETTINGS`] is the TS `settings` table. The dialog lists them by category with the current value as the
//! footer; Enter and Right step to the next value, Left to the previous one. Each change is one `cli.json`
//! update by path, run on a blocking thread because the file lock blocks. [`Live`] holds the config as the last
//! write left it, so the dialogs, the DevTools bar, and the theme follow a change without a restart.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use opencode_local::cli_config::{CliConfig, Info, merge};
use opencode_ui::dialog::DialogOptions;
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, Slash, TuiCommand};
use opencode_ui::select::{FooterHint, SelectOption, SelectProps, Side, select};
use opencode_ui::theme::ModeSetting;
use opentui::keymap::Disposer;
use serde_json::{Map, Value};

use crate::app::Tui;

/// A setting value in the table.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Lit {
    Bool(bool),
    Str(&'static str),
    Num(f64),
}

impl Lit {
    pub fn value(self) -> Value {
        match self {
            Self::Bool(flag) => Value::Bool(flag),
            Self::Str(text) => Value::String(text.to_owned()),
            Self::Num(number) => number_value(number),
        }
    }
}

/// How a numeric setting steps and shows.
#[derive(Clone, Copy, Debug)]
pub struct Range {
    pub step: f64,
    pub min: f64,
    pub max: f64,
    pub format: fn(f64) -> String,
}

/// One row of the TS `settings` table.
#[derive(Clone, Copy, Debug)]
pub struct Setting {
    pub title: &'static str,
    pub category: &'static str,
    pub path: &'static [&'static str],
    /// Shown under the row under `new-designs`.
    pub description: &'static str,
    pub default: Lit,
    /// The values Left and Right cycle through; empty for the theme (the theme names) and numeric settings.
    pub values: &'static [Lit],
    pub labels: &'static [&'static str],
    pub range: Option<Range>,
    pub keywords: &'static [&'static str],
}

impl Setting {
    /// `settingID`: the path joined with dots.
    pub fn id(&self) -> String {
        self.path.join(".")
    }

    fn is_theme(&self) -> bool {
        self.path == ["theme", "name"]
    }
}

const OFF_ON: &[Lit] = &[Lit::Bool(false), Lit::Bool(true)];
const OFF_ON_LABELS: &[&str] = &["off", "on"];

// One argument per TS field keeps the table below in the TS shape.
#[allow(clippy::too_many_arguments)]
const fn choice(
    title: &'static str,
    category: &'static str,
    path: &'static [&'static str],
    description: &'static str,
    default: Lit,
    values: &'static [Lit],
    labels: &'static [&'static str],
    keywords: &'static [&'static str],
) -> Setting {
    Setting {
        title,
        category,
        path,
        description,
        default,
        values,
        labels,
        range: None,
        keywords,
    }
}

const fn toggle(
    title: &'static str,
    category: &'static str,
    path: &'static [&'static str],
    description: &'static str,
    default: bool,
    keywords: &'static [&'static str],
) -> Setting {
    choice(
        title,
        category,
        path,
        description,
        Lit::Bool(default),
        OFF_ON,
        OFF_ON_LABELS,
        keywords,
    )
}

const fn number(
    title: &'static str,
    category: &'static str,
    path: &'static [&'static str],
    description: &'static str,
    default: f64,
    range: Range,
    keywords: &'static [&'static str],
) -> Setting {
    Setting {
        title,
        category,
        path,
        description,
        default: Lit::Num(default),
        values: &[],
        labels: &[],
        range: Some(range),
        keywords,
    }
}

use Lit::Str as S;

/// The TS `settings` table, in its order (`dialog-config.tsx:27-382`).
pub const SETTINGS: &[Setting] = &[
    choice(
        "Theme",
        "Appearance",
        &["theme", "name"],
        "Color theme used across the interface",
        S("opencode"),
        &[],
        &[],
        &["color scheme", "colors"],
    ),
    choice(
        "Color mode",
        "Appearance",
        &["theme", "mode"],
        "Dark or light variant, or follow the system",
        S("system"),
        &[S("system"), S("dark"), S("light")],
        &[],
        &["dark mode", "light mode", "system theme"],
    ),
    toggle(
        "Animations",
        "Appearance",
        &["animations"],
        "Whether spinners and transitions animate",
        false,
        &["motion", "effects"],
    ),
    choice(
        "Sidebar",
        "Session",
        &["session", "sidebar"],
        "Whether the sidebar shows when there is room",
        S("auto"),
        &[S("hide"), S("auto")],
        &[],
        &["side panel"],
    ),
    toggle(
        "Scrollbar",
        "Session",
        &["session", "scrollbar"],
        "Whether a scrollbar is shown next to the chat",
        false,
        &["scroll bar"],
    ),
    choice(
        "Scroll on send",
        "Session",
        &["session", "submit_scroll"],
        "Whether sending a prompt jumps to the latest message",
        S("bottom"),
        &[S("bottom"), S("keep")],
        &["jump to latest", "keep position"],
        &["submit", "scroll position", "jump to latest", "follow"],
    ),
    choice(
        "Thinking",
        "Session",
        &["session", "thinking"],
        "Whether model thinking is shown in the chat",
        S("hide"),
        &[S("hide"), S("show")],
        &[],
        &["reasoning", "chain of thought"],
    ),
    choice(
        "Markdown",
        "Session",
        &["session", "markdown"],
        "Whether chat markdown is rendered or shown as source",
        S("rendered"),
        &[S("source"), S("rendered")],
        &[],
        &["syntax", "concealment", "rendering"],
    ),
    choice(
        "Tool grouping",
        "Session",
        &["session", "grouping"],
        "Whether consecutive reads and searches are grouped",
        S("auto"),
        &[S("none"), S("auto")],
        &[],
        &["transcript", "messages", "reads", "searches"],
    ),
    choice(
        "Verbosity",
        "Session",
        &["session", "verbosity"],
        "How much tool activity is shown in the chat",
        S("medium"),
        &[S("low"), S("medium"), S("high")],
        &[],
        &["detail", "activity", "summary", "transcript"],
    ),
    toggle(
        "Transcript images",
        "Session",
        &["session", "image_preview"],
        "Whether images are shown in the chat",
        false,
        &["attachments", "images", "tool output"],
    ),
    toggle(
        "TPS",
        "Session",
        &["session", "tps"],
        "Whether tokens per second are shown for responses",
        true,
        &["tokens per second", "throughput"],
    ),
    choice(
        "New session location",
        "Session",
        &["session", "new_location"],
        "Directory new sessions start in",
        S("launch"),
        &[S("launch"), S("inherit")],
        &["launch directory", "active session"],
        &["directory", "cwd", "inherit"],
    ),
    choice(
        "Permissions",
        "Session",
        &["session", "permissions"],
        "Whether permission requests ask you or auto accept",
        S("prompt"),
        &[S("prompt"), S("autoaccept")],
        &["prompt", "auto accept"],
        &["approve", "accept", "permission requests"],
    ),
    choice(
        "Mode",
        "Tabs",
        &["tabs", "mode"],
        "Whether sessions open in tabs",
        S("auto"),
        &[S("off"), S("on"), S("auto")],
        &[],
        &[],
    ),
    choice(
        "Scope",
        "Tabs",
        &["tabs", "scope"],
        "Whether tabs are per directory or shared everywhere",
        S("cwd"),
        &[S("cwd"), S("global")],
        &["current directory", "global"],
        &[],
    ),
    choice(
        "Layout",
        "Tabs",
        &["tabs", "layout"],
        "Whether tabs run along the top or down the side",
        S("horizontal"),
        &[S("horizontal"), S("vertical")],
        &[],
        &["sidebar", "orientation", "left"],
    ),
    choice(
        "Indicators",
        "Tabs",
        &["tabs", "indicators"],
        "Whether tabs show status icons or always numbers",
        S("status"),
        &[S("status"), S("numbers")],
        &["status icons", "always show numbers"],
        &["tab numbers", "number mode", "status icons"],
    ),
    choice(
        "Layout",
        "Diffs",
        &["diffs", "view"],
        "Whether diffs are side by side or in one column",
        S("auto"),
        &[S("auto"), S("split"), S("unified")],
        &[],
        &["diff layout", "split diff", "unified diff"],
    ),
    choice(
        "Wrapping",
        "Diffs",
        &["diffs", "wrap"],
        "Whether long lines in diffs wrap",
        S("word"),
        &[S("none"), S("word")],
        &[],
        &["diff wrap", "word wrap", "line wrap"],
    ),
    toggle(
        "File tree",
        "Diffs",
        &["diffs", "tree"],
        "Whether a file tree is shown next to diffs",
        true,
        &["diff files"],
    ),
    toggle(
        "Single patch",
        "Diffs",
        &["diffs", "single"],
        "Whether diffs show one file at a time",
        false,
        &["one file", "selected file"],
    ),
    number(
        "Scroll speed",
        "Input",
        &["scroll", "speed"],
        "How far each scroll step moves",
        3.0,
        Range {
            step: 0.25,
            min: 0.25,
            max: 10.0,
            format: |value| format!("{value:.2}"),
        },
        &["scrolling"],
    ),
    toggle(
        "Acceleration",
        "Input",
        &["scroll", "acceleration"],
        "Whether scrolling speeds up the faster you scroll",
        false,
        &["scroll acceleration"],
    ),
    toggle(
        "Mouse",
        "Input",
        &["mouse"],
        "Whether the interface responds to the mouse",
        true,
        &["mouse capture"],
    ),
    toggle(
        "Editor context",
        "Input",
        &["prompt", "editor"],
        "Whether your editor's selection is added to prompts",
        true,
        &["file context", "prompt context", "editor selection"],
    ),
    choice(
        "Large pastes",
        "Input",
        &["prompt", "paste"],
        "Whether large pastes are summarized or shown in full",
        S("compact"),
        &[S("compact"), S("full")],
        &[],
        &["paste summary", "clipboard", "pasted content"],
    ),
    toggle(
        "Image previews",
        "Input",
        &["prompt", "image_preview"],
        "Whether attached images are previewed in the prompt",
        false,
        &["attachments", "clipboard", "images", "prompt"],
    ),
    number(
        "Leader timeout",
        "Input",
        &["leader", "timeout"],
        "How long the leader key waits for the next key",
        2000.0,
        Range {
            step: 250.0,
            min: 250.0,
            max: 10000.0,
            format: |value| format!("{} ms", js_number(value)),
        },
        &["leader key", "shortcut timeout"],
    ),
    toggle(
        "Notifications",
        "Alerts",
        &["attention", "notifications"],
        "Whether to notify when a session needs attention",
        false,
        &["system notifications", "desktop notifications", "alerts"],
    ),
    toggle(
        "Sounds",
        "Alerts",
        &["attention", "sound"],
        "Whether a sound plays when a session needs attention",
        false,
        &["audio", "sound effects", "alerts"],
    ),
    number(
        "Volume",
        "Alerts",
        &["attention", "volume"],
        "Volume of alert sounds",
        0.4,
        Range {
            step: 0.1,
            min: 0.0,
            max: 1.0,
            // `Math.round` rounds halves up.
            format: |value| format!("{}%", (value * 100.0 + 0.5).floor()),
        },
        &["sound volume", "audio volume"],
    ),
    toggle(
        "Release highlights",
        "Alerts",
        &["highlights"],
        "Whether release highlights are shown after an update",
        true,
        &["what's new", "changelog", "release notes"],
    ),
    toggle(
        "Window title",
        "Terminal",
        &["terminal", "title"],
        "Whether the window title shows the current session",
        true,
        &["terminal title", "tab title"],
    ),
    choice(
        "Copy behavior",
        "Terminal",
        &["terminal", "copy"],
        "Whether selecting text copies it",
        if cfg!(windows) {
            S("manual")
        } else {
            S("select")
        },
        &[S("manual"), S("select")],
        &[],
        &["selection", "clipboard"],
    ),
    toggle(
        "Developer tools",
        "Debug",
        &["debug", "devtools"],
        "Whether the developer tools bar is shown",
        false,
        &["debug bar", "developer tools"],
    ),
];

/// A listener of config changes made through [`update`].
type Listener = Rc<dyn Fn(&Tui)>;

/// The config as the last settings write left it, and the write state. One per TUI.
pub struct Live {
    info: RefCell<Info>,
    config: Option<CliConfig>,
    saving: Cell<bool>,
    listeners: RefCell<Vec<Listener>>,
    layers: RefCell<Vec<Disposer>>,
}

impl Live {
    /// `config` is `None` without real roots: changes then stay in memory.
    pub fn new(info: Info, config: Option<CliConfig>) -> Self {
        Self {
            info: RefCell::new(info),
            config,
            saving: Cell::new(false),
            listeners: RefCell::default(),
            layers: RefCell::default(),
        }
    }

    pub fn info(&self) -> Info {
        self.info.borrow().clone()
    }

    /// Whether an `experimental` flag is on now.
    pub fn experiment(&self, name: &str) -> bool {
        self.info.borrow().experiment(name)
    }

    /// Whether a write is in flight; changes are ignored until it ends, as in TS.
    pub fn saving(&self) -> bool {
        self.saving.get()
    }

    /// Calls `listener` after each change [`update`] applies.
    pub fn on_change(&self, listener: impl Fn(&Tui) + 'static) {
        self.listeners.borrow_mut().push(Rc::new(listener));
    }
}

/// `config.update(draft => ...)` by JSON path, off the UI thread, then [`apply`]. A failed write shows an error
/// toast. Ignored while another write is in flight.
pub fn update(tui: &Tui, change: impl FnOnce(&mut Value) + Send + 'static) {
    let live = &tui.settings;
    if live.saving.replace(true) {
        return;
    }
    let Some(config) = live.config.clone() else {
        let mut value = live.info().to_value();
        change(&mut value);
        live.saving.set(false);
        apply(tui, merge(&[Some(value)]));
        return;
    };
    let weak = tui.weak();
    tui.app.spawn(
        async move {
            tokio::task::spawn_blocking(move || config.update_value(change))
                .await
                .map_err(|error| error.to_string())
                .and_then(|result| result.map_err(|error| error.to_string()))
        },
        move |_, result| {
            let Some(tui) = weak.upgrade() else { return };
            tui.settings.saving.set(false);
            match result {
                Ok(info) => apply(&tui, info),
                Err(error) => tui.toasts.error(error),
            }
        },
    );
}

/// Sets `path` to `value`, creating the objects on the way (`dialog-config.tsx:463-468`).
pub fn set_path(root: &mut Value, path: &[&str], value: Value) {
    let Some((last, parents)) = path.split_last() else {
        return;
    };
    let parent = parents.iter().fold(root, |node, key| {
        if !node.is_object() {
            *node = Value::Object(Map::new());
        }
        let map = node.as_object_mut().expect("an object");
        let child = map
            .entry((*key).to_owned())
            .or_insert_with(|| Value::Object(Map::new()));
        if !child.is_object() {
            *child = Value::Object(Map::new());
        }
        child
    });
    if let Some(map) = parent.as_object_mut() {
        map.insert((*last).to_owned(), value);
    }
}

/// Takes `info` as the current config and carries out what TS does reactively: the theme follows `theme.*`,
/// and listeners run.
fn apply(tui: &Tui, info: Info) {
    let before = tui.settings.info.replace(info.clone());
    let theme = |info: &Info| info.theme.clone().unwrap_or_default();
    let (old, new) = (theme(&before), theme(&info));
    let mut changed = false;
    {
        let mut state = tui.theme.borrow_mut();
        if new.name != old.name
            && let Some(name) = &new.name
        {
            state.config_name(name);
            changed = true;
        }
        if new.mode != old.mode
            && let Some(setting) =
                ModeSetting::parse(new.mode.map_or("system", |mode| mode.as_str()))
        {
            state.config_mode(setting);
            changed = true;
        }
    }
    if changed {
        tui.theme_changed();
    }
    let listeners = tui.settings.listeners.borrow().clone();
    for listener in listeners {
        listener(tui);
    }
}

/// The value of `setting` now: the config's, else the default (the active theme for `theme.name`).
pub fn value(tui: &Tui, setting: &Setting) -> Value {
    let config = tui.settings.info().to_value();
    let current = setting
        .path
        .iter()
        .try_fold(&config, |node, key| node.get(*key))
        .filter(|value| !value.is_null())
        .cloned();
    match current {
        Some(value) => value,
        None if setting.is_theme() => Value::from(tui.theme.borrow().selected()),
        None => setting.default.value(),
    }
}

/// The values Left and Right cycle through: the theme names in `localeCompare` base order for the theme.
fn values(tui: &Tui, setting: &Setting) -> Option<Vec<Value>> {
    if setting.is_theme() {
        let mut names = tui.theme.borrow().names();
        names.sort_by_key(|name| name.to_lowercase());
        return Some(names.into_iter().map(Value::from).collect());
    }
    (!setting.values.is_empty()).then(|| setting.values.iter().map(|lit| lit.value()).collect())
}

/// The footer text of `setting`.
pub fn display(tui: &Tui, setting: &Setting) -> String {
    let current = value(tui, setting);
    if let Some(range) = setting.range {
        return (range.format)(current.as_f64().unwrap_or(f64::NAN));
    }
    setting
        .values
        .iter()
        .position(|lit| lit.value() == current)
        .and_then(|index| setting.labels.get(index))
        .map_or_else(|| js_string(&current), |label| (*label).to_owned())
}

/// Steps `SETTINGS[index]` by `direction` and writes it (`change` in `dialog-config.tsx`).
pub fn change(tui: &Tui, index: usize, direction: i32) {
    if tui.settings.saving() {
        return;
    }
    let Some(setting) = SETTINGS.get(index) else {
        return;
    };
    let current = value(tui, setting);
    let next = match (values(tui, setting), setting.range) {
        (Some(choices), _) if !choices.is_empty() => {
            let len = choices.len() as i64;
            let at = choices
                .iter()
                .position(|choice| *choice == current)
                .map_or(-1, |at| at as i64);
            choices[(at + i64::from(direction) + len).rem_euclid(len) as usize].clone()
        }
        (_, Some(range)) => {
            let number = current.as_f64().unwrap_or(f64::NAN) + f64::from(direction) * range.step;
            number_value(range.min.max(number).min(range.max))
        }
        _ => return,
    };
    if next == current || matches!((next.as_f64(), current.as_f64()), (Some(a), Some(b)) if a == b)
    {
        return;
    }
    let path = setting.path;
    update(tui, move |draft| set_path(draft, path, next));
}

/// The dialog rows.
fn options(tui: &Tui) -> Vec<SelectOption<usize>> {
    SETTINGS
        .iter()
        .enumerate()
        .map(|(index, setting)| {
            let mut option = SelectOption::new(setting.title, index)
                .category(setting.category)
                .footer(display(tui, setting));
            if !setting.keywords.is_empty() {
                option.search_text = Some(setting.keywords.join(" "));
            }
            option
        })
        .collect()
}

/// The palette's settings rows (`settingOptions` in `command-palette.tsx`), shown while filtering.
pub fn palette_options(tui: &Tui) -> Vec<SelectOption<String>> {
    SETTINGS
        .iter()
        .map(|setting| {
            let id = setting.id();
            let weak = tui.weak();
            let open = id.clone();
            let mut option = SelectOption::new(setting.title, format!("setting:{id}"))
                .category(setting.category)
                .on_select(move |_| {
                    if let Some(tui) = weak.upgrade() {
                        show(&tui, Some(&open));
                    }
                });
            if !setting.keywords.is_empty() {
                option.search_text = Some(setting.keywords.join(" "));
            }
            option.search_footer = Some(format!("Settings · {}", setting.category));
            option
        })
        .collect()
}

/// `DialogConfig`, opened on the setting with id `current` (the first one otherwise), in place of any open
/// dialog.
pub fn show(tui: &Tui, current: Option<&str>) {
    let current = current
        .and_then(|id| SETTINGS.iter().position(|setting| setting.id() == id))
        .unwrap_or(0);
    let weak = tui.weak();
    tui.dialogs.replace(
        move |cx| {
            let Some(tui) = weak.upgrade() else {
                return opentui::prelude::View::new(&cx.app);
            };
            let selected = Rc::new(Cell::new(current));
            let step = |direction: i32| {
                let (weak, selected) = (weak.clone(), selected.clone());
                move |_: Option<&str>, _: Option<&opentui::prelude::KeyEvent>| {
                    if let Some(tui) = weak.upgrade() {
                        change(&tui, selected.get(), direction);
                    }
                }
            };
            let mut props = SelectProps::new("Settings", options(&tui));
            props.current = Some(current);
            props.filter_threshold = 0.7;
            props.on_move = Some(Rc::new({
                let selected = selected.clone();
                move |option| selected.set(option.value)
            }));
            props.on_select = Some(Rc::new({
                let weak = weak.clone();
                move |option| {
                    if let Some(tui) = weak.upgrade() {
                        change(&tui, option.value, 1);
                    }
                }
            }));
            if !cx.new_designs {
                props.footer_hints = vec![FooterHint {
                    title: "change".into(),
                    label: "←/→".into(),
                    side: Side::Left,
                    group: None,
                }];
            }
            props.bindings = vec![
                TuiCommand::inline("left", step(-1))
                    .title("Previous value")
                    .group("Settings"),
                TuiCommand::inline("right", step(1))
                    .title("Next value")
                    .group("Settings"),
            ];
            let (view, handle) = select(cx, props);
            refresh_on_change(&tui, Rc::downgrade(cx), move |tui| {
                handle.set_options(options(tui))
            });
            view
        },
        None,
        DialogOptions::default(),
    );
}

/// Calls `refresh` after each config change while the dialog of `cx` is open.
pub(crate) fn refresh_on_change(
    tui: &Tui,
    cx: Weak<opencode_ui::dialog::DialogCx>,
    refresh: impl Fn(&Tui) + 'static,
) {
    let open = Rc::new(Cell::new(true));
    if let Some(cx) = cx.upgrade() {
        let open = open.clone();
        cx.on_close(Disposer::new(move || open.set(false)));
    }
    // The listener holds the refresh until the TUI drops; it does nothing once the dialog closed.
    let refresh = RefCell::new(Some(refresh));
    tui.settings.on_change(move |tui| {
        if !open.get() {
            refresh.borrow_mut().take();
            return;
        }
        if let Some(refresh) = refresh.borrow().as_ref() {
            refresh(tui);
        }
    });
}

/// Registers `opencode.settings` (`/settings`) and `opencode.debug` (`/debug`) as `app.tsx:1044-1128` does.
pub fn install(tui: &Rc<Tui>) {
    let command = |id: &str, title: &str, slash: &str, run: fn(&Tui)| {
        let weak = tui.weak();
        TuiCommand::new(id, move |_, _| {
            if let Some(tui) = weak.upgrade() {
                run(&tui);
            }
        })
        .bind(Bind::Off)
        .title(title)
        .group("System")
        .palette()
        .slash(Slash {
            name: slash.to_owned(),
            aliases: Vec::new(),
            arguments: false,
        })
    };
    let layer = KeymapLayer {
        mode: Some(GLOBAL_MODE.to_owned()),
        commands: vec![
            command("opencode.settings", "Open settings", "settings", |tui| {
                show(tui, None)
            })
            .suggested(opentui::keymap::Condition::Always),
            command("opencode.debug", "View debug info", "debug", |tui| {
                super::debug::show(tui)
            }),
        ],
        ..KeymapLayer::default()
    };
    match tui.keymap.layer(layer) {
        Ok(disposer) => tui.settings.layers.borrow_mut().push(disposer),
        Err(error) => log::error!("settings keymap layer: {error}"),
    }
}

/// A JSON number as JS writes it: whole numbers without a fraction.
fn number_value(number: f64) -> Value {
    if number.fract() == 0.0 && number.abs() < 9.0e15 {
        return Value::from(number as i64);
    }
    serde_json::Number::from_f64(number).map_or(Value::Null, Value::Number)
}

/// `String(value)` for the values settings hold.
fn js_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => "undefined".to_owned(),
        Value::Number(number) => number
            .as_f64()
            .map_or_else(|| number.to_string(), js_number),
        other => other.to_string(),
    }
}

/// `String(number)` for the finite numbers settings hold.
fn js_number(number: f64) -> String {
    if number.fract() == 0.0 && number.abs() < 1e21 {
        return format!("{}", number as i64);
    }
    format!("{number}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_matches_typescript() {
        assert_eq!(SETTINGS.len(), 36);
        assert_eq!(SETTINGS[0].id(), "theme.name");
        assert_eq!(SETTINGS[35].id(), "debug.devtools");
        for setting in SETTINGS {
            assert!(
                setting.labels.is_empty() || setting.labels.len() == setting.values.len(),
                "{}",
                setting.id()
            );
            assert!(setting.range.is_some() != !setting.values.is_empty() || setting.is_theme());
        }
    }

    #[test]
    fn set_path_creates_objects_on_the_way() {
        let mut value = serde_json::json!({ "session": 1 });
        set_path(&mut value, &["session", "thinking"], "show".into());
        set_path(&mut value, &["mouse"], false.into());
        assert_eq!(
            value,
            serde_json::json!({ "session": { "thinking": "show" }, "mouse": false })
        );
    }

    #[test]
    fn numbers_format_as_in_javascript() {
        assert_eq!(number_value(2250.0), serde_json::json!(2250));
        assert_eq!(
            number_value(0.7999999999999999).to_string(),
            "0.7999999999999999"
        );
        let volume = SETTINGS
            .iter()
            .find(|s| s.id() == "attention.volume")
            .unwrap();
        assert_eq!((volume.range.unwrap().format)(0.4), "40%");
        assert_eq!((volume.range.unwrap().format)(0.7999999999999999), "80%");
        let speed = SETTINGS.iter().find(|s| s.id() == "scroll.speed").unwrap();
        assert_eq!((speed.range.unwrap().format)(3.0), "3.00");
        let leader = SETTINGS
            .iter()
            .find(|s| s.id() == "leader.timeout")
            .unwrap();
        assert_eq!((leader.range.unwrap().format)(2250.0), "2250 ms");
    }
}
