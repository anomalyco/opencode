//! Command registration, key layers, input modes and shortcut formatting.

mod config;
#[rustfmt::skip]
mod generated;
#[cfg(test)]
mod tests;

pub use config::{Keybinds, default_value, description};
pub use generated::{DEFINITIONS, Definition, LEADER_DEFAULT};

use opentui::input::KeyEvent;
use opentui::keymap::addons::{self, EDIT_COMMANDS, ManagedTextarea, TimedLeader};
use opentui::keymap::extras::{FormatOptions, format_command_bindings, format_key_sequence};
use opentui::keymap::{
    Binding, Command, CommandQuery, Condition, Disposer, Key, KeyResult, Keymap, Layer, Outcome, RunResult, Stroke,
    Visibility,
};
use opentui::widget::EditorAction;
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use crate::bind;

/// The runtime data name that holds the current input mode; layers require their mode in it.
pub const MODE_KEY: &str = "opencode.mode";
/// The mode a layer has when it names none, and the current mode when no pushed mode is active.
pub const BASE_MODE: &str = "base";
/// The layer mode that opts out of the mode stack.
pub const GLOBAL_MODE: &str = "global";
pub const COMMAND_PALETTE_COMMAND: &str = "command.palette.show";
/// The keymap data [`TuiKeymap::conditions_changed`] sets, which no layer requires.
const CONDITIONS_KEY: &str = "conditions";

/// Key aliases expanded during layer registration.
const ALIASES: &[(&str, &str)] = &[("enter", "return"), ("esc", "escape"), ("pgdown", "pagedown"), ("pgup", "pageup")];

/// What [`TuiKeymap::new`] needs from the app.
pub struct Options {
    /// `leader.timeout` from `cli.json`; 2,000 ms by default.
    pub leader_timeout: Duration,
    /// While a textarea that is not a single-line input has focus. The app must not let that textarea handle keys
    /// itself while this holds: the managed textarea layer edits it through `textarea_run`.
    pub textarea_enabled: Condition,
    /// Performs an edit on the focused textarea; returns whether one did.
    pub textarea_run: Rc<dyn Fn(EditorAction) -> bool>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            leader_timeout: Duration::from_millis(2000),
            textarea_enabled: Condition::Never,
            textarea_run: Rc::new(|_| false),
        }
    }
}

/// A command's automatic binding: its configured keys or nothing (`Default`), none at all (`Off`, TS
/// `bind: false`), or this key when the config has none.
#[derive(Clone, Debug, Default)]
pub enum Bind {
    #[default]
    Default,
    Off,
    Key(String),
}

/// A slash command entry for prompt completion.
#[derive(Clone, Debug)]
pub struct Slash {
    pub name: String,
    pub aliases: Vec<String>,
    /// Keeps the slash command in the prompt and passes its raw input to `run`.
    pub arguments: bool,
    /// The plugin that declared it; `None` for the host's own. A plugin's name or alias that another command holds is
    /// left out ([`TuiKeymap::commands`]).
    pub plugin: Option<String>,
}

impl Slash {
    /// `/name`, without aliases or arguments.
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into(), aliases: Vec::new(), arguments: false, plugin: None }
    }

    pub fn aliases(mut self, aliases: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.aliases = aliases.into_iter().map(Into::into).collect();
        self
    }

    /// Keeps the slash command in the prompt and passes its raw input to `run`.
    pub fn arguments(mut self) -> Self {
        self.arguments = true;
        self
    }
}

impl From<&str> for Slash {
    fn from(name: &str) -> Self {
        Self::new(name)
    }
}

/// Runs a command with the dispatch input, if any, and the key that ran it, if any.
pub type CommandRun = Rc<dyn Fn(Option<&str>, Option<&KeyEvent>) -> Outcome>;

/// A command as features declare it (TS `KeymapCommand`). With an `id` it is a named command that config can
/// rebind; without one it is an inline binding of `bind`.
#[derive(Clone)]
pub struct TuiCommand {
    pub id: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub group: Option<String>,
    pub enabled: Condition,
    pub bind: Bind,
    /// Whether the palette lists it. TS sets `palette` each time a layer's commands change, so a command can leave
    /// the palette and stay a command, as `variant.list` does while the model has no variants.
    pub palette: Condition,
    pub slash: Option<Slash>,
    pub suggested: Condition,
    pub run: CommandRun,
}

impl TuiCommand {
    /// A named command.
    pub fn new<R: opentui::keymap::IntoOutcome>(
        id: impl Into<String>,
        run: impl Fn(Option<&str>, Option<&KeyEvent>) -> R + 'static,
    ) -> Self {
        Self { id: Some(id.into()), bind: Bind::Default, ..Self::inline("", run) }
    }

    /// An inline command bound to `bind`.
    pub fn inline<R: opentui::keymap::IntoOutcome>(
        bind: impl Into<String>,
        run: impl Fn(Option<&str>, Option<&KeyEvent>) -> R + 'static,
    ) -> Self {
        Self {
            id: None,
            title: None,
            description: None,
            group: None,
            enabled: Condition::Always,
            bind: Bind::Key(bind.into()),
            palette: Condition::Never,
            slash: None,
            suggested: Condition::Never,
            run: Rc::new(move |input, event| run(input, event).into_outcome()),
        }
    }

    pub fn title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    pub fn description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn group(mut self, group: impl Into<String>) -> Self {
        self.group = Some(group.into());
        self
    }

    pub fn enabled(mut self, enabled: impl Into<Condition>) -> Self {
        self.enabled = enabled.into();
        self
    }

    pub fn bind(mut self, bind: Bind) -> Self {
        self.bind = bind;
        self
    }

    pub fn palette(self) -> Self {
        self.palette_when(Condition::Always)
    }

    pub fn palette_when(mut self, palette: impl Into<Condition>) -> Self {
        self.palette = palette.into();
        self
    }

    pub fn slash(mut self, slash: impl Into<Slash>) -> Self {
        self.slash = Some(slash.into());
        self
    }

    pub fn suggested(mut self, suggested: impl Into<Condition>) -> Self {
        self.suggested = suggested.into();
        self
    }
}

/// A layer as features declare it (TS `KeymapLayer`).
#[derive(Clone)]
pub struct KeymapLayer<T> {
    /// The input mode the layer needs; `None` is [`BASE_MODE`], and [`GLOBAL_MODE`] opts out.
    pub mode: Option<String>,
    pub enabled: Condition,
    pub target: Option<T>,
    pub priority: i32,
    pub commands: Vec<TuiCommand>,
    /// Names whose configured bindings join this layer.
    pub bindings: Vec<String>,
    /// Keys of named commands of another layer, each `(key, name)`, which join this layer while the config binds that
    /// name to nothing: a command a global layer lists, whose own key works only in this layer's mode.
    pub keys: Vec<(String, String)>,
}

impl<T> Default for KeymapLayer<T> {
    fn default() -> Self {
        Self {
            mode: None,
            enabled: Condition::Always,
            target: None,
            priority: 0,
            commands: Vec::new(),
            bindings: Vec::new(),
            keys: Vec::new(),
        }
    }
}

impl<T> KeymapLayer<T> {
    /// A base-mode layer of `commands`.
    pub fn new(commands: Vec<TuiCommand>) -> Self {
        Self { commands, ..Self::default() }
    }

    /// A layer of `commands` that opts out of modes ([`GLOBAL_MODE`]).
    pub fn global(commands: Vec<TuiCommand>) -> Self {
        Self::new(commands).mode(GLOBAL_MODE)
    }

    pub fn mode(mut self, mode: impl Into<String>) -> Self {
        self.mode = Some(mode.into());
        self
    }

    pub fn enabled(mut self, enabled: impl Into<Condition>) -> Self {
        self.enabled = enabled.into();
        self
    }

    pub fn target(mut self, target: T) -> Self {
        self.target = Some(target);
        self
    }

    pub fn priority(mut self, priority: i32) -> Self {
        self.priority = priority;
        self
    }

    pub fn bindings(mut self, names: impl IntoIterator<Item = impl Into<String>>) -> Self {
        self.bindings = names.into_iter().map(Into::into).collect();
        self
    }

    pub fn keys(mut self, keys: Vec<(String, String)>) -> Self {
        self.keys = keys;
        self
    }
}

/// A reachable command as discovery UI sees it, with its conditions evaluated.
#[derive(Clone, Debug)]
pub struct CommandView {
    pub id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub group: Option<String>,
    pub enabled: bool,
    pub palette: bool,
    pub slash: Option<Slash>,
    pub suggested: bool,
}

/// One stroke of the pending sequence, formatted.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pending {
    pub key: String,
    pub token: Option<String>,
}

/// A key that does something now, formatted (`KeymapActive`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Active {
    pub key: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub group: Option<String>,
    pub continues: bool,
}

/// The command `dispatch` runs and its input.
type Invocation = (String, Option<String>);

struct Registered<T> {
    id: u64,
    /// When the layer counts as registered for [`TuiKeymap::commands`]: its `id`, or later after a [`Hold`].
    rank: u64,
    layer: KeymapLayer<T>,
    engine: Disposer,
}

/// Holds back the rank of some layers until it drops ([`TuiKeymap::hold`]).
pub struct Hold<'a, T: Clone + PartialEq + 'static>(&'a TuiKeymap<T>, Vec<u64>);

impl<T: Clone + PartialEq + 'static> Drop for Hold<'_, T> {
    fn drop(&mut self) {
        let held = &self.1;
        for registered in self.0.layers.borrow_mut().iter_mut().filter(|registered| held.contains(&registered.id)) {
            registered.rank = self.0.next_layer.get();
            self.0.next_layer.set(registered.rank + 1);
        }
    }
}

struct ModeEntry {
    id: u64,
    mode: String,
    active: Condition,
}

/// The TUI's keymap: the engine with OpenCode's addons, config, layers, and modes.
pub struct TuiKeymap<T> {
    keymap: Keymap<T>,
    keybinds: RefCell<Rc<Keybinds<T>>>,
    /// Every live layer from [`Self::layer`], as declared, and its registration: new keybinds register each again,
    /// as `createLayer` reads the configured bindings reactively.
    layers: Rc<RefCell<Vec<Registered<T>>>>,
    next_layer: Cell<u64>,
    /// The commands of TS's first command layer, in its order ([`Self::set_first_layer`]).
    first_layer: RefCell<Vec<String>>,
    /// The layers registered during [`Self::hold`]'s `register`.
    held: RefCell<Option<Vec<u64>>>,
    leader: Option<TimedLeader<T>>,
    leader_stroke: Option<Stroke>,
    modes: Rc<RefCell<Vec<ModeEntry>>>,
    next_mode: Cell<u64>,
    invocation: Rc<RefCell<Option<Invocation>>>,
    format: FormatOptions,
    /// The plugins' slash names [`Self::commands`] left out and logged, each `(command, name)`, so each logs once.
    shadowed: RefCell<std::collections::HashSet<(String, String)>>,
    /// Shortcut labels by command, formatted once per engine revision ([`Self::labels`]).
    labels: RefCell<Labels>,
    _addons: Vec<Disposer>,
}

/// Formatted shortcuts of the commands asked for since the engine's `revision` last moved. Registered queries read only
/// the registered layers, and registering or removing one moves the revision.
#[derive(Default)]
struct Labels {
    revision: u64,
    /// `None` for a command no layer registers.
    commands: std::collections::HashMap<String, Option<Shortcuts>>,
}

struct Shortcuts {
    /// One per binding.
    each: Vec<String>,
    /// Every binding, joined.
    all: Option<String>,
}

impl<T: Clone + PartialEq + 'static> TuiKeymap<T> {
    pub fn new(keybinds: Keybinds<T>, options: Options) -> Self {
        let keymap = Keymap::new();
        let textarea_bindings: Vec<Binding<T>> =
            EDIT_COMMANDS.iter().flat_map(|(_, name, _)| keybinds.get(name).iter().cloned()).collect();
        // Preserve the editing commands' registration order.
        let addons = vec![
            addons::comma_bindings(&keymap),
            addons::key_aliases(&keymap, ALIASES),
            addons::base_layout_fallback(&keymap),
            addons::escape_clears_pending_sequence(&keymap, 0),
            addons::backspace_pops_pending_sequence(&keymap, 0),
            addons::managed_textarea_layer(
                &keymap,
                ManagedTextarea {
                    enabled: options.textarea_enabled,
                    bindings: textarea_bindings,
                    run: options.textarea_run,
                },
            ),
        ];
        let leader_key = keybinds.get("leader").first().map(|binding| binding.key.clone());
        let leader = leader_key
            .clone()
            .and_then(|key| addons::timed_leader(&keymap, "leader", key, options.leader_timeout).ok());
        let leader_stroke =
            leader_key.as_ref().and_then(|key| keymap.parse_key(key.clone()).ok()).map(|part| part.stroke);
        let format = format_options(leader_key.as_ref());
        let tui = Self {
            keymap,
            keybinds: RefCell::new(Rc::new(keybinds)),
            layers: Rc::default(),
            next_layer: Cell::new(0),
            first_layer: RefCell::default(),
            held: RefCell::default(),
            leader,
            leader_stroke,
            modes: Rc::new(RefCell::new(Vec::new())),
            next_mode: Cell::new(0),
            invocation: Rc::new(RefCell::new(None)),
            shadowed: RefCell::default(),
            labels: RefCell::default(),
            format,
            _addons: addons,
        };
        tui.sync_mode();
        tui
    }

    /// The engine, for focus (`set_focus`), intercepts, and queries this type does not wrap.
    pub fn keymap(&self) -> &Keymap<T> {
        &self.keymap
    }

    pub fn keybinds(&self) -> Rc<Keybinds<T>> {
        self.keybinds.borrow().clone()
    }

    /// Takes new keybinds and binds every live layer again with them. The leader and the textarea's edit bindings
    /// keep the keys they started with, as TS reads those once.
    pub fn set_keybinds(&self, keybinds: Keybinds<T>) {
        *self.keybinds.borrow_mut() = Rc::new(keybinds);
        let layers: Vec<(u64, KeymapLayer<T>)> =
            self.layers.borrow().iter().map(|registered| (registered.id, registered.layer.clone())).collect();
        // The replaced registrations drop last: a layer's handlers may own disposers of other layers.
        let mut replaced = Vec::new();
        for (id, layer) in layers {
            let Ok(engine) = self.compile(layer) else { continue };
            let engine = self.keymap.register_layer(engine);
            let mut registered = self.layers.borrow_mut();
            match registered.iter_mut().find(|registered| registered.id == id) {
                Some(registered) => replaced.push(std::mem::replace(&mut registered.engine, engine)),
                None => replaced.push(engine),
            }
        }
        drop(replaced);
    }

    /// Passes a key to the keymap. Skip the focused widget's own handling when the result stops propagation.
    pub fn handle_key(&self, event: &KeyEvent) -> KeyResult {
        self.sync_mode();
        self.keymap.handle_key(event)
    }

    /// Runs a reachable command by ID; its handler receives `input`.
    pub fn dispatch(&self, id: &str, input: Option<&str>) -> RunResult {
        self.sync_mode();
        let previous = self.invocation.replace(Some((id.to_owned(), input.map(str::to_owned))));
        let result = self.keymap.dispatch_command(id);
        self.invocation.replace(previous);
        result
    }

    /// While a sequence that starts with the leader is pending, its generation: each stroke arms a new one. When the
    /// pending sequence changes, schedule a timer for [`Self::leader_timeout`] that passes the generation to
    /// [`Self::expire_leader`] ([`crate::dialog::expire_leader`] does).
    pub fn leader_armed(&self) -> Option<u64> {
        self.leader.as_ref()?.armed()
    }

    /// The configured `leader.timeout`; zero without a leader key, which never arms.
    pub fn leader_timeout(&self) -> Duration {
        self.leader.as_ref().map_or(Duration::ZERO, TimedLeader::timeout)
    }

    /// Clears the leader sequence if `generation` is still armed. Returns whether it did.
    pub fn expire_leader(&self, generation: u64) -> bool {
        self.leader.as_ref().is_some_and(|leader| leader.expire(generation))
    }

    /// `leader.timeout` after a config change; the next leader key takes it.
    pub fn set_leader_timeout(&self, timeout: Duration) {
        if let Some(leader) = &self.leader {
            leader.set_timeout(timeout);
        }
    }

    /// Whether `event` is the configured leader key.
    pub fn is_leader(&self, event: &KeyEvent) -> bool {
        self.leader_stroke.as_ref().is_some_and(|stroke| *stroke == Stroke::from_event(event))
    }

    /// Registers a layer, as `Keymap.createLayer` does. Fails on the command shapes TS rejects.
    /// Registers `layers` for the keymap's lifetime ([`Disposer::forget`]). A layer that fails logs
    /// `"{name} keymap layer: {error}"`.
    pub fn install(&self, name: &str, layers: impl IntoIterator<Item = KeymapLayer<T>>) {
        for layer in layers {
            match self.layer(layer) {
                Ok(disposer) => disposer.forget(),
                Err(error) => log::error!("{name} keymap layer: {error}"),
            }
        }
    }

    pub fn layer(&self, layer: KeymapLayer<T>) -> Result<Disposer, String> {
        let engine = self.keymap.register_layer(self.compile(layer.clone())?);
        let id = self.next_layer.get();
        self.next_layer.set(id + 1);
        if let Some(held) = self.held.borrow_mut().as_mut() {
            held.push(id);
        }
        self.layers.borrow_mut().push(Registered { id, rank: id, layer, engine });
        Ok(Disposer::new(bind!(self.layers, |layers| {
            // Dropped after the borrow ends, as `set_keybinds` drops what it replaced.
            let removed = {
                let mut layers = layers.borrow_mut();
                layers.iter().position(|registered| registered.id == id).map(|index| layers.remove(index))
            };
            drop(removed);
        })))
    }

    /// The engine layer of a declared one, with its commands' configured bindings.
    fn compile(&self, layer: KeymapLayer<T>) -> Result<Layer<T>, String> {
        let keybinds = self.keybinds();
        let mut commands = Vec::new();
        let mut bindings = Vec::new();
        let mut named = Vec::new();
        for command in layer.commands {
            match command.id.clone() {
                Some(id) => {
                    if id.is_empty() {
                        return Err("Keymap command IDs cannot be empty".to_owned());
                    }
                    if matches!(&command.bind, Bind::Key(key) if key.is_empty()) {
                        return Err("Keymap command bindings cannot be empty".to_owned());
                    }
                    named.push((id, command));
                }
                None => {
                    if !matches!(command.palette, Condition::Never) {
                        return Err("Palette commands require an ID".to_owned());
                    }
                    if command.slash.is_some() {
                        return Err("Slash commands require an ID".to_owned());
                    }
                    let Bind::Key(key) = command.bind.clone() else {
                        return Err("Inline keymap commands require bind".to_owned());
                    };
                    if key.is_empty() {
                        return Err("Keymap command bindings cannot be empty".to_owned());
                    }
                    bindings.push(self.inline_binding(key, command));
                }
            }
        }
        for (id, command) in &named {
            commands.push(self.named_command(id, command.clone()));
        }
        for (id, command) in &named {
            if matches!(command.bind, Bind::Off) {
                continue;
            }
            let configured = keybinds.get(id);
            if !configured.is_empty() {
                bindings.extend(configured.iter().cloned());
                continue;
            }
            // A known command bound to `none` takes no key.
            if let Bind::Key(key) = &command.bind
                && !generated::DEFINITIONS.iter().any(|definition| definition.name == id)
            {
                bindings.push(Binding::new(key.as_str()).cmd(id.as_str()));
            }
        }
        bindings.extend(layer.bindings.iter().flat_map(|id| keybinds.get(id).iter().cloned()));
        for (key, id) in &layer.keys {
            if key.is_empty() {
                return Err("Keymap command bindings cannot be empty".to_owned());
            }
            if keybinds.get(id).is_empty() && !generated::DEFINITIONS.iter().any(|definition| definition.name == id) {
                bindings.push(Binding::new(key.as_str()).cmd(id.as_str()));
            }
        }
        let mut engine =
            Layer::new().priority(layer.priority).enabled(layer.enabled).commands(commands).bindings(bindings);
        engine.target = layer.target;
        match layer.mode.as_deref() {
            Some(GLOBAL_MODE) => {}
            mode => engine = engine.require(MODE_KEY, mode.unwrap_or(BASE_MODE)),
        }
        Ok(engine)
    }

    fn named_command(&self, id: &str, command: TuiCommand) -> Command<T> {
        let run = command.run.clone();
        let invocation = self.invocation.clone();
        let name = id.to_owned();
        let mut engine = Command::new(id, move |context: &opentui::keymap::CommandContext<T>| {
            let input = invocation
                .borrow()
                .as_ref()
                .filter(|(current, _)| *current == name)
                .and_then(|(_, input)| input.clone());
            run(input.as_deref(), context.event.as_ref())
        })
        .enabled(command.enabled.clone());
        engine.title = command.title.clone();
        engine.desc = command.description.clone();
        engine.category = command.group.clone();
        engine.namespace = (!matches!(command.palette, Condition::Never)).then(|| "palette".to_owned());
        engine.data(command)
    }

    fn inline_binding(&self, key: String, command: TuiCommand) -> Binding<T> {
        let mut binding = Binding::new(key);
        binding.desc = command.title.clone().or_else(|| command.description.clone());
        binding.group = command.group.clone();
        // The key that ran it, which a binding of several keys (`up,k`) tells apart.
        binding.run(move |context| {
            check(&command.enabled) && (command.run)(None, context.event.as_ref()) == Outcome::Handled
        })
    }

    /// A command's `enabled` condition changed outside the keymap (a plugin's `set-enabled`): a pending sequence it no
    /// longer completes goes, and what follows the keymap's state hears it. The keymap has no call for it, but setting
    /// data does both; no layer requires this key.
    pub fn conditions_changed(&self) {
        self.keymap.set_data(CONDITIONS_KEY, self.keymap.revision().to_string());
    }

    /// How many layers are registered, for a ledger of who holds what.
    pub fn layer_count(&self) -> usize {
        self.layers.borrow().len()
    }

    /// How many modes are pushed, active or not.
    pub fn mode_count(&self) -> usize {
        self.modes.borrow().len()
    }

    /// The current input mode: the newest pushed mode that is active, else [`BASE_MODE`].
    pub fn mode(&self) -> String {
        current_mode(&self.modes.borrow())
    }

    /// Pushes a mode until the returned disposer runs. The mode claims input only while `active` holds; an
    /// inactive entry keeps its place beneath newer ones.
    pub fn push_mode(&self, mode: &str, active: impl Into<Condition>) -> Disposer {
        let id = self.next_mode.get();
        self.next_mode.set(id + 1);
        self.modes.borrow_mut().push(ModeEntry { id, mode: mode.to_owned(), active: active.into() });
        self.sync_mode();
        let modes = self.modes.clone();
        let keymap = self.keymap.downgrade();
        Disposer::new(move || {
            modes.borrow_mut().retain(|entry| entry.id != id);
            if let Some(keymap) = keymap.upgrade() {
                publish_mode(&keymap, &current_mode(&modes.borrow()));
            }
        })
    }

    /// Publishes the current mode to the keymap. `handle_key` and `dispatch` call it; call it after a mode's
    /// `active` condition changes so that queries see the change.
    pub fn sync_mode(&self) {
        publish_mode(&self.keymap, &self.mode());
    }

    /// Runs `register`. The layers it registers work at once, but [`Self::commands`] lists them as if registered when
    /// the hold drops: TS loads the built-in plugins only once the first route has mounted, where this TUI activates
    /// them before.
    pub fn hold(&self, register: impl FnOnce()) -> Hold<'_, T> {
        *self.held.borrow_mut() = Some(Vec::new());
        register();
        Hold(self, self.held.take().unwrap_or_default())
    }

    /// Built-in commands retain their order even when different components register them.
    pub fn set_first_layer(&self, ids: impl IntoIterator<Item = String>) {
        *self.first_layer.borrow_mut() = ids.into_iter().collect();
    }

    /// The reachable commands, for the palette and slash completion: the newest layer's first.
    pub fn commands(&self) -> Vec<CommandView> {
        self.sync_mode();
        let mut commands: Vec<CommandView> = self
            .keymap
            .commands(&CommandQuery::visibility(Visibility::Reachable))
            .iter()
            .map(|command| match command.data_as::<TuiCommand>() {
                Some(declared) => CommandView {
                    id: command.name.clone(),
                    title: declared.title.clone(),
                    description: declared.description.clone(),
                    group: declared.group.clone(),
                    enabled: check(&declared.enabled),
                    palette: check(&declared.palette),
                    slash: declared.slash.clone(),
                    suggested: check(&declared.suggested),
                },
                None => CommandView {
                    id: command.name.clone(),
                    title: command.title.clone(),
                    description: command.desc.clone(),
                    group: command.category.clone(),
                    enabled: check(&command.enabled),
                    palette: command.namespace.as_deref() == Some("palette"),
                    slash: None,
                    suggested: false,
                },
            })
            .collect();
        // The keymap lists by priority, then the newest layer first; the newest by rank here. The first layer's commands
        // go after them, in its order, and last the addons' (no layer here declares them), which TS registers with
        // the keymap, before any layer. The sort is stable, so a layer's commands keep their order.
        let mut ranks = std::collections::HashMap::new();
        for registered in self.layers.borrow().iter() {
            for id in registered.layer.commands.iter().filter_map(|command| command.id.clone()) {
                let rank = (registered.layer.priority, registered.rank);
                ranks.entry(id).and_modify(|newest: &mut (i32, u64)| *newest = rank.max(*newest)).or_insert(rank);
            }
        }
        let first = self.first_layer.borrow();
        commands.sort_by_key(|command| {
            let rank = ranks.get(&command.id).copied();
            let place = match first.iter().position(|id| *id == command.id) {
                Some(index) => index + 1,
                None if rank.is_some() => 0,
                None => usize::MAX,
            };
            (place, std::cmp::Reverse(rank))
        });
        self.unshadow(&mut commands, |id| ranks.get(id).map_or(u64::MAX, |rank| rank.1));
        commands
    }

    /// Leaves out each plugin slash name or alias another command holds: the host's always, another plugin's when its
    /// layer registered first. TS keeps both, and the newest layer's wins (deviation `CF1-slash-shadow`).
    fn unshadow(&self, commands: &mut [CommandView], registered: impl Fn(&str) -> u64) {
        let mut order: Vec<usize> = (0..commands.len()).filter(|&at| commands[at].slash.is_some()).collect();
        order.sort_by_key(|&at| {
            let plugin = commands[at].slash.as_ref().is_some_and(|slash| slash.plugin.is_some());
            (plugin, plugin.then(|| registered(&commands[at].id)))
        });
        let mut taken = std::collections::HashSet::new();
        for at in order {
            let command = &mut commands[at];
            let Some(slash) = command.slash.take() else { continue };
            let names = std::iter::once(slash.name.clone()).chain(slash.aliases.iter().cloned());
            let Some(plugin) = &slash.plugin else {
                taken.extend(names);
                command.slash = Some(slash);
                continue;
            };
            let (kept, dropped): (Vec<String>, Vec<String>) = names.partition(|name| taken.insert(name.clone()));
            for name in dropped {
                if self.shadowed.borrow_mut().insert((command.id.clone(), name.clone())) {
                    log::warn!("plugin {plugin}: /{name} of {} is another command's; left out", command.id);
                }
            }
            let mut kept = kept.into_iter();
            command.slash = kept.next().map(|name| Slash { name, aliases: kept.collect(), ..slash });
        }
    }

    /// The first shortcut of a registered command, such as `ctrl+x n`.
    pub fn shortcut(&self, id: &str) -> Option<String> {
        self.labels(id, |shortcuts| shortcuts?.each.first().cloned())
    }

    /// Every shortcut of a registered command, joined, such as `ctrl+c, ctrl+d, ctrl+x q`.
    pub fn shortcut_all(&self, id: &str) -> Option<String> {
        self.labels(id, |shortcuts| shortcuts?.all.clone())
    }

    /// Every shortcut of a registered command, one per binding.
    pub fn shortcuts(&self, id: &str) -> Vec<String> {
        self.labels(id, |shortcuts| shortcuts.map(|shortcuts| shortcuts.each.clone()).unwrap_or_default())
    }

    /// Reads `id`'s formatted shortcuts, formatting them only on the first read since the engine's revision moved.
    fn labels<R>(&self, id: &str, read: impl FnOnce(Option<&Shortcuts>) -> R) -> R {
        let revision = self.keymap.revision();
        {
            let labels = self.labels.borrow();
            if labels.revision == revision
                && let Some(shortcuts) = labels.commands.get(id)
            {
                return read(shortcuts.as_ref());
            }
        }
        let shortcuts = self.sequences(id).map(|sequences| Shortcuts {
            each: sequences.iter().map(|sequence| format_key_sequence(sequence, &self.format)).collect(),
            all: format_command_bindings(sequences.iter().map(Vec::as_slice), &self.format),
        });
        let mut labels = self.labels.borrow_mut();
        if labels.revision != revision {
            labels.revision = revision;
            labels.commands.clear();
        }
        read(labels.commands.entry(id.to_owned()).or_insert(shortcuts).as_ref())
    }

    fn sequences(&self, id: &str) -> Option<Vec<Vec<opentui::keymap::KeySequencePart>>> {
        let query =
            CommandQuery { names: Some(vec![id.to_owned()]), ..CommandQuery::visibility(Visibility::Registered) };
        if self.keymap.commands(&query).is_empty() {
            return None;
        }
        let bindings = self.keymap.command_bindings(Visibility::Registered, &[id]);
        Some(bindings.get(id).into_iter().flatten().map(|binding| binding.sequence.clone()).collect())
    }

    /// The pending key sequence, formatted per stroke.
    pub fn pending(&self) -> Vec<Pending> {
        self.keymap
            .pending_sequence()
            .into_iter()
            .map(|part| Pending {
                key: format_key_sequence(std::slice::from_ref(&part), &self.format),
                token: part.token,
            })
            .collect()
    }

    /// The keys that do something now, at the root or after the pending sequence, formatted, with the title,
    /// description and group of what each runs (`Keymap.useState().active` in `keymap.tsx`).
    pub fn active(&self) -> Vec<Active> {
        self.sync_mode();
        let options = opentui::keymap::ActiveKeyOptions { include_metadata: true, ..Default::default() };
        self.keymap
            .active_keys(options)
            .into_iter()
            .map(|key| {
                let command = key.command_info.as_deref();
                let part =
                    opentui::keymap::KeySequencePart { stroke: key.stroke, display: key.display, token: key.token };
                Active {
                    key: format_key_sequence(std::slice::from_ref(&part), &self.format),
                    title: command.and_then(|command| command.title.clone()),
                    description: key.desc.or_else(|| command.and_then(|command| command.desc.clone())),
                    group: command.and_then(|command| command.category.clone()).or(key.group),
                    continues: key.continues,
                }
            })
            .collect()
    }

    /// Whether the pending sequence starts with the leader.
    pub fn leader_active(&self) -> bool {
        self.keymap.pending_sequence().first().is_some_and(|part| part.token.as_deref() == Some("leader"))
    }
}

fn current_mode(modes: &[ModeEntry]) -> String {
    modes.iter().rev().find(|entry| check(&entry.active)).map_or(BASE_MODE, |entry| entry.mode.as_str()).to_owned()
}

fn publish_mode<T: Clone + PartialEq + 'static>(keymap: &Keymap<T>, mode: &str) {
    if keymap.data(MODE_KEY).as_deref() != Some(mode) {
        keymap.set_data(MODE_KEY, mode);
    }
}

fn format_options(leader: Option<&Key>) -> FormatOptions {
    let owned =
        |pairs: &[(&str, &str)]| pairs.iter().map(|(name, value)| ((*name).to_owned(), (*value).to_owned())).collect();
    FormatOptions {
        token_display: [("leader".to_owned(), leader.map_or_else(|| LEADER_DEFAULT.to_owned(), Key::to_string))].into(),
        key_name_aliases: owned(&[
            ("up", "↑"),
            ("down", "↓"),
            ("left", "←"),
            ("right", "→"),
            ("pageup", "pgup"),
            ("pagedown", "pgdn"),
            ("delete", "del"),
        ]),
        modifier_aliases: owned(&[("meta", "alt")]),
        ..FormatOptions::default()
    }
}

fn check(condition: &Condition) -> bool {
    match condition {
        Condition::Always => true,
        Condition::Never => false,
        Condition::When(check) => check(),
    }
}
