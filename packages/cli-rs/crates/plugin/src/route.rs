//! A route of the one API (O-67), on either path: what its render returns, centered in a scroll box on the page
//! background (TS `StatsPage`'s container), the plugin's commands of [`abi::Scope::Route`] while it shows, and its
//! mount handlers as it mounts and unmounts.

use std::cell::RefCell;
use std::rc::{Rc, Weak};

use opencode_ui::dialog::FocusId;
use opencode_ui::keymap::{Bind, KeymapLayer, TuiCommand};
use opentui::keymap::Disposer;
use opentui::prelude::*;

use crate::node::{Mount, MountFn, SlotRender};
use crate::{Claimed, Host, SlotInput, abi};

/// A plugin's commands: the layers of its unscoped ones (global, then base mode), and the ones of each route.
type Split = ([KeymapLayer<opencode_ui::dialog::FocusId>; 2], Vec<(String, TuiCommand)>);

/// Splits `commands` by their scope. A layer without commands is left for the caller to skip.
pub(crate) fn split(commands: Vec<(abi::Scope, TuiCommand)>) -> Split {
    let (mut global, mut base, mut scoped) = (Vec::new(), Vec::new(), Vec::new());
    for (scope, command) in commands {
        match scope {
            abi::Scope::Global => global.push(command),
            abi::Scope::Base => base.push(command),
            abi::Scope::Route(name) => scoped.push((name, command)),
        }
    }
    ([KeymapLayer::global(global), KeymapLayer::new(base)], scoped)
}

/// The commands of route `name`.
pub(crate) fn commands(scoped: &[(String, TuiCommand)], name: &str) -> Vec<TuiCommand> {
    scoped.iter().filter(|(route, _)| route == name).map(|(_, command)| command.clone()).collect()
}

pub(crate) struct View {
    root: opentui::prelude::View,
    content: Box<dyn Claimed>,
    layer: RefCell<Option<Disposer>>,
    app: App,
}

impl View {
    /// The route of a render; also returns its mount, which its activation draws again.
    pub fn new(
        host: &dyn Host,
        owner: Weak<dyn Host>,
        render: SlotRender,
        commands: Vec<TuiCommand>,
        on_mount: Option<MountFn>,
        charge: crate::node::Charge,
    ) -> (Self, Rc<Mount>) {
        let mount = Mount::new(host, owner, "", &SlotInput::default(), render, on_mount, false, charge);
        (Self::wrap(host, Box::new(mount.clone()), commands), mount)
    }

    /// The route that shows `content` centered in a scroll box, as TS's `StatsPage` does: the route of a render.
    pub fn wrap(host: &dyn Host, content: Box<dyn Claimed>, commands: Vec<TuiCommand>) -> Self {
        let scroll = ScrollBox::new(host.app()).scrollbars(false).grow(1.0);
        scroll.content_view().align_items(Align::Center).justify(Justify::Center).padding_y(1);
        scroll.add(&content.root());
        Self::page(host, &scroll, content, layer(host, commands))
    }

    /// The route that gives `content` the whole page: the route of a 2.0 surface, whose root fills it. Its keymap
    /// `layer` is made before `content` first draws ([`layer`]).
    pub fn fill(host: &dyn Host, content: Box<dyn Claimed>, layer: Option<Disposer>) -> Self {
        let root = content.root();
        Self::page(host, &root, content, layer)
    }

    fn page(host: &dyn Host, inner: &impl Widget, content: Box<dyn Claimed>, layer: Option<Disposer>) -> Self {
        let app = host.app();
        let root = opentui::prelude::View::new(app)
            .width(Length::percent(100.0))
            .height(Length::percent(100.0))
            .bg(host.theme().background.base)
            .child(inner);
        Self { root, content, layer: RefCell::new(layer), app: app.clone() }
    }
}

/// The keymap layers of a route's `commands`, as the host's own routes make theirs: the commands in a global layer, so
/// the palette, which opens in the dialog's mode, lists them as TS does, and runs them there (PL-3); their keys in a
/// base-mode layer, so a key runs one only while no dialog is over the route. A surface's route makes them before its
/// first view, which may read the keymap, so their arrival does not call the view again (review bigboi-7).
pub(crate) fn layer(host: &dyn Host, commands: Vec<TuiCommand>) -> Option<Disposer> {
    if commands.is_empty() {
        return None;
    }
    let (mut names, mut keys) = (Vec::new(), Vec::new());
    let (named, inline): (Vec<_>, Vec<_>) = commands.into_iter().partition(|command| command.id.is_some());
    let named = named
        .into_iter()
        .map(|command| {
            let id = command.id.clone().unwrap_or_default();
            match &command.bind {
                Bind::Off => {}
                Bind::Default => names.push(id),
                Bind::Key(key) => {
                    keys.push((key.clone(), id.clone()));
                    names.push(id);
                }
            }
            command.bind(Bind::Off)
        })
        .collect();
    let layers = [KeymapLayer::<FocusId>::global(named), KeymapLayer::new(inline).bindings(names).keys(keys)];
    let disposers: Vec<Disposer> = layers
        .into_iter()
        .filter_map(|layer| {
            host.keymap().layer(layer).map_err(|error| log::error!("plugin route keymap layer: {error}")).ok()
        })
        .collect();
    Some(Disposer::new(move || drop(disposers)))
}

impl Claimed for View {
    fn root(&self) -> opentui::prelude::View {
        self.root.clone()
    }

    fn sync(&self, host: &dyn Host, changed: &abi::Changed) {
        self.content.sync(host, changed);
    }

    fn restyle(&self, host: &dyn Host) -> bool {
        self.root.bg(host.theme().background.base);
        self.content.restyle(host)
    }
}

impl Drop for View {
    fn drop(&mut self) {
        // A route command that navigates drops the route while the keymap runs its layer.
        if let Some(layer) = self.layer.borrow_mut().take() {
            self.app.defer(move |_| drop(layer));
        }
    }
}
