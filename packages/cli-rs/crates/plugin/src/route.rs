//! A route of the one API (O-67), on either path: what its render returns, centered in a scroll box on the page
//! background (TS `StatsPage`'s container), the plugin's commands of [`abi::Scope::Route`] while it shows, and its
//! mount handlers as it mounts and unmounts.

use std::cell::RefCell;
use std::rc::{Rc, Weak};

use opencode_ui::dialog::FocusId;
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opentui::keymap::Disposer;
use opentui::prelude::*;

use crate::node::{Mount, MountFn, SlotRender};
use crate::{Claimed, Host, SlotInput, abi};

/// A plugin's commands: the global ones, and the ones of each route.
type Split = (Vec<TuiCommand>, Vec<(String, TuiCommand)>);

/// Splits `commands` by their scope.
pub(crate) fn split(commands: Vec<(abi::Scope, TuiCommand)>) -> Split {
    let mut split: Split = (Vec::new(), Vec::new());
    for (scope, command) in commands {
        match scope {
            abi::Scope::Global => split.0.push(command),
            abi::Scope::Route(name) => split.1.push((name, command)),
        }
    }
    split
}

/// The commands of route `name`.
pub(crate) fn commands(scoped: &[(String, TuiCommand)], name: &str) -> Vec<TuiCommand> {
    scoped.iter().filter(|(route, _)| route == name).map(|(_, command)| command.clone()).collect()
}

pub(crate) struct View {
    root: opentui::prelude::View,
    pub mount: Rc<Mount>,
    layer: RefCell<Option<Disposer>>,
    app: App,
}

impl View {
    pub fn new(
        host: &dyn Host,
        owner: Weak<dyn Host>,
        render: SlotRender,
        commands: Vec<TuiCommand>,
        on_mount: Option<MountFn>,
    ) -> Self {
        let app = host.app();
        let theme = host.theme();
        let scroll = ScrollBox::new(app).scrollbars(false).grow(1.0);
        scroll.content_view().align_items(Align::Center).justify(Justify::Center).padding_y(1);
        let mount = Mount::new(host, owner, "", &SlotInput::default(), render, on_mount);
        scroll.add(&mount.root());
        let root = opentui::prelude::View::new(app)
            .width(Length::percent(100.0))
            .height(Length::percent(100.0))
            .bg(theme.background.base)
            .child(&scroll);
        let layer = (!commands.is_empty())
            .then(|| host.keymap().layer(KeymapLayer::<FocusId>::new(commands)))
            .and_then(|layer| layer.map_err(|error| log::error!("plugin route keymap layer: {error}")).ok());
        Self { root, mount, layer: RefCell::new(layer), app: app.clone() }
    }
}

impl Claimed for View {
    fn root(&self) -> opentui::prelude::View {
        self.root.clone()
    }

    fn sync(&self, host: &dyn Host, changed: &abi::Changed) {
        self.mount.sync(host, changed);
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
