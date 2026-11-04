//! The Rust plugin API (P.1, `docs/P.1.md`): the in-process form of `@opencode/plugin/tui`. Built-in
//! plugins and the LaTeX and Mermaid plugins register slots, keymap layers, routes, and code-block renderers
//! through [`Setup`]; the host mounts them through [`Registry`]. [`loader`] is where P.4 loads external
//! plugins.

pub mod loader;
pub mod slot;

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use opencode_ui::dialog::{DialogKeymap, FocusId};
use opencode_ui::keymap::KeymapLayer;
use opencode_ui::markdown::CodeBlockRenderers;
use opencode_ui::theme::Theme;
use opentui::keymap::Disposer;
use opentui::prelude::*;
use opentui::widget::CodeBlock;

pub use slot::{Kind, Placement, SlotInput};

/// What a plugin is given besides its registrations (TS `Plugin.Context`). The TUI implements it for its
/// shared context, so a built-in also reaches the store, dialogs, and toasts through [`Setup::host`].
pub trait Host: 'static {
    /// What changed since the last sync.
    type Changes;
    fn app(&self) -> &App;
    /// The page theme.
    fn theme(&self) -> Theme;
    /// The keymap plugin layers register on.
    fn keymap(&self) -> &DialogKeymap;
}

/// A mounted slot claim or plugin route: its root view, and a sync with each change batch. A plain
/// [`View`] never changes.
pub trait Slotted<H: Host> {
    fn root(&self) -> View;
    fn sync(&self, _host: &H, _changes: &H::Changes) {}
}

impl<H: Host> Slotted<H> for View {
    fn root(&self) -> View {
        self.clone()
    }
}

pub type SlotRender<H> = Rc<dyn Fn(&H, &SlotInput) -> Box<dyn Slotted<H>>>;
pub type RouteRender<H> = Rc<dyn Fn(&H) -> Box<dyn Slotted<H>>>;
type SetupFn<H> = Rc<dyn Fn(&mut Setup<'_, H>)>;
/// Renders a fenced code block in the theme, or returns `None` to keep the default code view.
pub type CodeBlockRender = Rc<dyn Fn(&CodeBlock<'_>, &Theme) -> Option<AnyWidget>>;

/// A plugin (TS `Plugin.define`): an ID and the setup that registers everything it contributes. Setup runs
/// on each activation; deactivation undoes every registration.
pub struct Definition<H: Host> {
    pub id: String,
    setup: SetupFn<H>,
}

impl<H: Host> Clone for Definition<H> {
    fn clone(&self) -> Self {
        Self {
            id: self.id.clone(),
            setup: self.setup.clone(),
        }
    }
}

impl<H: Host> Definition<H> {
    pub fn new(id: impl Into<String>, setup: impl Fn(&mut Setup<'_, H>) + 'static) -> Self {
        Self {
            id: id.into(),
            setup: Rc::new(setup),
        }
    }
}

/// What a plugin registers while it is active.
pub struct Setup<'a, H: Host> {
    host: &'a Rc<H>,
    id: &'a str,
    registration: Registration<H>,
}

impl<H: Host> Setup<'_, H> {
    /// The host; closures keep a [`std::rc::Weak`] of it.
    pub fn host(&self) -> &Rc<H> {
        self.host
    }

    pub fn id(&self) -> &str {
        self.id
    }

    /// The host storage key of this plugin's `key` (TS `storage.store(key)`).
    pub fn storage_key(&self, key: &str) -> String {
        format!("plugin.{}.{key}", self.id)
    }

    /// Claims a place in the slot tree (TS `ui.slot`).
    pub fn slot(
        &mut self,
        placement: Placement,
        render: impl Fn(&H, &SlotInput) -> Box<dyn Slotted<H>> + 'static,
    ) {
        self.registration.claims.push((placement, Rc::new(render)));
    }

    /// Registers a keymap layer: commands, their palette and slash entries, and keybinds (TS `keymap.layer`).
    pub fn layer(&mut self, layer: KeymapLayer<FocusId>) {
        match self.host.keymap().layer(layer) {
            Ok(disposer) => self.registration.disposers.push(disposer),
            Err(error) => log::error!("plugin {} keymap layer: {error}", self.id),
        }
    }

    /// Registers the route `Route::Plugin { id, name }` shows (TS `ui.router.register`).
    pub fn route(
        &mut self,
        name: impl Into<String>,
        render: impl Fn(&H) -> Box<dyn Slotted<H>> + 'static,
    ) {
        self.registration
            .routes
            .push((name.into(), Rc::new(render)));
    }

    /// Renders Markdown fences of `language` (TS `markdown.registerCodeBlockRenderer`).
    pub fn code_block(
        &mut self,
        language: impl Into<String>,
        render: impl Fn(&CodeBlock<'_>, &Theme) -> Option<AnyWidget> + 'static,
    ) {
        self.registration
            .code_blocks
            .push((language.into(), Rc::new(render)));
    }

    /// Runs `cleanup` when the plugin deactivates (the cleanup TS `setup` returns).
    pub fn on_dispose(&mut self, cleanup: impl FnOnce() + 'static) {
        self.registration.cleanups.push(Box::new(cleanup));
    }
}

struct Registration<H: Host> {
    claims: Vec<(Placement, SlotRender<H>)>,
    routes: Vec<(String, RouteRender<H>)>,
    code_blocks: Vec<(String, CodeBlockRender)>,
    disposers: Vec<Disposer>,
    cleanups: Vec<Box<dyn FnOnce()>>,
}

impl<H: Host> Default for Registration<H> {
    fn default() -> Self {
        Self {
            claims: Vec::new(),
            routes: Vec::new(),
            code_blocks: Vec::new(),
            disposers: Vec::new(),
            cleanups: Vec::new(),
        }
    }
}

impl<H: Host> Registration<H> {
    fn dispose(self) {
        self.disposers.into_iter().rev().for_each(Disposer::dispose);
        self.cleanups
            .into_iter()
            .rev()
            .for_each(|cleanup| cleanup());
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Builtin,
    /// Added by the host after the built-ins, such as a test plugin.
    Added,
    /// A `plugins` entry of `cli.json`.
    Configured,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Status {
    Active,
    Inactive,
    /// Configured but not loaded, with the reason.
    Skipped(String),
}

/// One plugin as the plugin manager lists it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    /// The plugin ID, or the configured target of a skipped entry.
    pub id: String,
    pub source: Source,
    pub status: Status,
}

/// Why a configured TypeScript TUI plugin is listed but not loaded (deviation of F16 until P.4).
pub const SKIPPED: &str = "TypeScript TUI plugins do not run in opencode-rs yet";

struct Plugin<H: Host> {
    definition: Definition<H>,
    source: Source,
    enabled: bool,
    /// The activation order and registrations while active.
    active: Option<(u64, Registration<H>)>,
}

/// The host's plugins in enable order, and the configured entries it skipped.
pub struct Registry<H: Host> {
    plugins: RefCell<Vec<Plugin<H>>>,
    skipped: Vec<String>,
    activations: Cell<u64>,
}

impl<H: Host> Registry<H> {
    /// The built-ins, enabled unless a `cli.json` `plugins` entry disables them (`plugin/context.tsx:313-330`).
    /// Every entry that names no built-in is a TypeScript plugin; it is listed as skipped.
    pub fn new<'a>(
        builtins: Vec<Definition<H>>,
        targets: impl IntoIterator<Item = &'a str>,
    ) -> Self {
        let mut plugins: Vec<Plugin<H>> = builtins
            .into_iter()
            .map(|definition| Plugin {
                definition,
                source: Source::Builtin,
                enabled: true,
                active: None,
            })
            .collect();
        let mut skipped = Vec::new();
        for target in targets {
            if let Some(selector) = target.strip_prefix('-') {
                plugins
                    .iter_mut()
                    .filter(|plugin| matches(selector, &plugin.definition.id))
                    .for_each(|plugin| plugin.enabled = false);
                continue;
            }
            let mut selected = plugins
                .iter_mut()
                .filter(|plugin| matches(target, &plugin.definition.id))
                .peekable();
            let named = selected.peek().is_some();
            selected.for_each(|plugin| plugin.enabled = true);
            if named || target == "*" || target.ends_with(".*") || target.starts_with("opencode.") {
                continue;
            }
            if !skipped.iter().any(|known| known == target) {
                skipped.push(target.to_owned());
            }
        }
        Self {
            plugins: RefCell::new(plugins),
            skipped,
            activations: Cell::new(0),
        }
    }

    /// Adds an enabled plugin after the others; [`Registry::activate`] starts it.
    pub fn add(&self, definition: Definition<H>) {
        self.plugins.borrow_mut().push(Plugin {
            definition,
            source: Source::Added,
            enabled: true,
            active: None,
        });
    }

    /// The configured entries that were not loaded.
    pub fn skipped(&self) -> &[String] {
        &self.skipped
    }

    /// Activates every enabled plugin that is not active, in enable order.
    pub fn activate(&self, host: &Rc<H>) {
        let ids: Vec<String> = self
            .plugins
            .borrow()
            .iter()
            .filter(|plugin| plugin.enabled && plugin.active.is_none())
            .map(|plugin| plugin.definition.id.clone())
            .collect();
        for id in ids {
            self.start(host, &id);
        }
    }

    /// Activates or deactivates plugin `id` (the plugin manager's toggle); returns whether it exists.
    pub fn set_active(&self, host: &Rc<H>, id: &str, active: bool) -> bool {
        let Some(enabled) = self.with_plugin(id, |plugin| plugin.enabled) else {
            return false;
        };
        if !active {
            let registration = self.with_plugin(id, |plugin| {
                plugin.enabled = false;
                plugin.active.take()
            });
            if let Some((_, registration)) = registration.flatten() {
                registration.dispose();
            }
            return true;
        }
        if !enabled {
            self.with_plugin(id, |plugin| plugin.enabled = true);
        }
        self.start(host, id);
        true
    }

    /// Every plugin and skipped entry, for the plugin manager.
    pub fn entries(&self) -> Vec<Entry> {
        let plugins = self.plugins.borrow();
        let active = plugins.iter().map(|plugin| Entry {
            id: plugin.definition.id.clone(),
            source: plugin.source,
            status: match plugin.active {
                Some(_) => Status::Active,
                None => Status::Inactive,
            },
        });
        let skipped = self.skipped.iter().map(|target| Entry {
            id: target.clone(),
            source: Source::Configured,
            status: Status::Skipped(SKIPPED.to_owned()),
        });
        active.chain(skipped).collect()
    }

    /// Mounts slot `path` into `parent`: the claims before it, prepended to it, `content` (the host's own,
    /// unless a claim replaces it), the claims appended to it, and after it. TS's `<Slot>` is a fragment, so
    /// every part goes straight into `parent`.
    pub fn mount(
        &self,
        host: &H,
        parent: &View,
        path: &str,
        input: &SlotInput,
        content: impl FnOnce(&View),
    ) -> SlotMount<H> {
        let (claims, renders) = self.claims();
        let resolution = slot::resolve(&slot::PATHS, &claims);
        let placed = resolution.placed.get(path).cloned().unwrap_or_default();
        let mut mounted = SlotMount { claims: Vec::new() };
        let mut render = |indices: &[usize]| {
            for &index in indices {
                let claim = renders[index](host, input);
                parent.add(&claim.root());
                mounted.claims.push(claim);
            }
        };
        render(&placed.before);
        match placed.replace {
            Some(index) => render(&[index]),
            None => {
                render(&placed.prepend);
                content(parent);
                render(&placed.append);
            }
        }
        render(&placed.after);
        mounted
    }

    /// The route plugin `id` registers as `name`, rendered.
    pub fn route(&self, host: &H, id: &str, name: &str) -> Option<Box<dyn Slotted<H>>> {
        let render = self.with_plugin(id, |plugin| {
            let (_, registration) = plugin.active.as_ref()?;
            registration
                .routes
                .iter()
                .find(|(route, _)| route == name)
                .map(|(_, render)| render.clone())
        })??;
        Some(render(host))
    }

    /// The code-block renderers of the active plugins, drawing in `theme`. At one language the last-enabled
    /// plugin wins.
    pub fn code_blocks(&self, theme: &Theme) -> CodeBlockRenderers {
        let mut renderers = CodeBlockRenderers::default();
        for (_, registration) in self.by_activation() {
            for (language, render) in &registration.code_blocks {
                let render = render.clone();
                let theme = theme.clone();
                renderers.register(
                    language.clone(),
                    Rc::new(move |block| render(block, &theme)),
                );
            }
        }
        renderers
    }

    /// Runs `setup` for plugin `id` unless it is active.
    fn start(&self, host: &Rc<H>, id: &str) {
        let Some(Some(definition)) = self.with_plugin(id, |plugin| {
            plugin.active.is_none().then(|| plugin.definition.clone())
        }) else {
            return;
        };
        // Setup runs without the registry borrowed, so it may read the registry through the host.
        let mut setup = Setup {
            host,
            id,
            registration: Registration::default(),
        };
        (definition.setup)(&mut setup);
        let order = self.activations.get();
        self.activations.set(order + 1);
        let registration = setup.registration;
        self.with_plugin(id, move |plugin| {
            plugin.active = Some((order, registration))
        });
    }

    fn with_plugin<T>(&self, id: &str, f: impl FnOnce(&mut Plugin<H>) -> T) -> Option<T> {
        let mut plugins = self.plugins.borrow_mut();
        plugins
            .iter_mut()
            .find(|plugin| plugin.definition.id == id)
            .map(f)
    }

    /// Every active claim in activation order, and its renders.
    fn claims(&self) -> (Vec<Placement>, Vec<SlotRender<H>>) {
        self.by_activation()
            .into_iter()
            .flat_map(|(_, registration)| registration.claims.clone())
            .unzip()
    }

    fn by_activation(&self) -> Vec<(u64, RegistrationView<H>)> {
        let plugins = self.plugins.borrow();
        let mut active: Vec<_> = plugins
            .iter()
            .filter_map(|plugin| {
                let (order, registration) = plugin.active.as_ref()?;
                Some((
                    *order,
                    RegistrationView {
                        claims: registration.claims.clone(),
                        code_blocks: registration.code_blocks.clone(),
                    },
                ))
            })
            .collect();
        active.sort_by_key(|(order, _)| *order);
        active
    }
}

/// The parts of a registration the registry hands out, cloned so no borrow outlives the call.
struct RegistrationView<H: Host> {
    claims: Vec<(Placement, SlotRender<H>)>,
    code_blocks: Vec<(String, CodeBlockRender)>,
}

/// A mounted slot's claims. The owner of the slot syncs it with each change batch.
pub struct SlotMount<H: Host> {
    claims: Vec<Box<dyn Slotted<H>>>,
}

impl<H: Host> Default for SlotMount<H> {
    fn default() -> Self {
        Self { claims: Vec::new() }
    }
}

impl<H: Host> SlotMount<H> {
    pub fn sync(&self, host: &H, changes: &H::Changes) {
        self.claims
            .iter()
            .for_each(|claim| claim.sync(host, changes));
    }

    pub fn is_empty(&self) -> bool {
        self.claims.is_empty()
    }
}

/// Whether a `plugins` selector names plugin `id`: itself, `*`, or a `prefix.*` it starts with.
pub fn matches(selector: &str, id: &str) -> bool {
    selector == "*"
        || selector == id
        || selector
            .strip_suffix('*')
            .is_some_and(|prefix| prefix.ends_with('.') && id.starts_with(prefix))
}

#[cfg(test)]
mod tests;
