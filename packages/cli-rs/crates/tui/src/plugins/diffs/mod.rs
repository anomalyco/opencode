//! The built-in diff viewer, shown as a route or a docked panel.

use opencode_api::generated::{SessionExecutionInterruptedDataReason, V2Event};
use opencode_plugin::abi::interact::{Button, Event, Handled, OpenPanel, PointerKind};
use opencode_plugin::abi::v2::{Place, ScrollEvent, Surface};
use opencode_plugin::abi::{self, Command, Dialog, Host, RequestId};

pub mod base_branch;
pub mod file_menu;
pub mod help;
pub mod keys;
mod load;
pub mod sources;
pub mod tree;
mod view;
pub mod viewer;

use load::Asked;
use viewer::{Memory, Mode, Preview, Showing, Turn, Viewer};

use crate::prelude::*;

pub const ID: &str = "opencode.diffs";
pub const ROUTE: &str = "diff";
pub const PANEL: &str = "panel";
pub const PAGE: &str = "diff";
pub const MENU: &str = "menu";
const IMAGES: &str = "images";
const FILES: &str = "files";
const TREE: &str = "tree";
const EDGE: &str = "edge";
const SOURCE: &str = "opencode.diffs.source";
const HELP: &str = "opencode.diffs.help";
const LEAVE: &str = "opencode.diffs.leave";
const PREVIEW: &str = "opencode.diffs.preview";
const PICK_SOURCE: &str = "opencode.diffs.pick_source";
const PICK_BASE: &str = "opencode.diffs.pick_base";
const QUERY_BASE: &str = "opencode.diffs.query_base";
/// The events that end a turn, after which the last turn's diff loads again.
/// The events of a turn, and the connection's, after which the last turn's diff may load again.
const TURNS: [&str; 5] = [
    "session.execution.started",
    "session.execution.succeeded",
    "session.execution.failed",
    "session.execution.interrupted",
    "server.connected",
];

type Clicked = fn(&Diffs, &dyn Host, &mut Viewer, Option<&str>);

pub fn plugin() -> abi::Plugin {
    abi::Plugin { id: ID, setup }
}

/// The plugin's state while it is active.
#[derive(Default)]
pub struct Diffs {
    pub(crate) memory: RefCell<Memory>,
    /// Where the next route goes back to, which `diff.open` sets before it navigates.
    back: RefCell<Option<abi::Route>>,
    pub(crate) viewer: RefCell<Option<Viewer>>,
    /// The mounts of its panel or route that live: a mount that begins while another lives keeps the viewer.
    mounts: Cell<u32>,
    viewers: Cell<u64>,
    requests: RefCell<HashMap<RequestId, Asked>>,
    picker: RefCell<base_branch::Picker>,
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    let diffs = Rc::new(Diffs::default());
    let open = Command::new("diff.open").title("Open diff viewer").group("VCS").slash("diff").palette();
    let opened = diffs.clone();
    setup.command(open, move |host, _| opened.open(host));
    let hidden = |name: &str| Command::new(name);
    let commands: [(&str, Clicked); 7] = [
        (SOURCE, |diffs, host, viewer, _| sources::open(host, viewer, &diffs.memory.borrow())),
        (HELP, |_, host, viewer, _| help::open(host, viewer)),
        (LEAVE, |diffs, host, viewer, _| {
            if !viewer.docked() {
                viewer.run(host, diffs, keys::Action::Close);
            }
        }),
        (PREVIEW, |_, host, viewer, file| preview(host, viewer, file)),
        (PICK_SOURCE, |diffs, host, viewer, value| match value {
            Some(sources::BASE) => base_branch::open(host, viewer, diffs),
            Some(value) => {
                if let Some(mode) = Mode::from_key(value) {
                    viewer.switch_source(host, diffs, mode);
                }
            }
            None => {}
        }),
        (PICK_BASE, |diffs, host, viewer, value| {
            let Some(reference) = value else { return };
            let key = base_branch::key(diffs);
            let previous = diffs.memory.borrow_mut().bases.insert(key.clone(), reference.to_owned());
            if previous.as_deref() != Some(reference) && viewer.mode.needs_base() && viewer.base_key == key {
                viewer.load(host, diffs);
            }
        }),
        (QUERY_BASE, |diffs, host, _, text| base_branch::query(host, diffs, text.unwrap_or_default().to_owned())),
    ];
    for (name, run) in commands {
        let ran = diffs.clone();
        // A pick must close its dialog even if the viewer is gone.
        let closes = match name {
            PICK_SOURCE => Some(sources::KEY),
            PICK_BASE => Some(base_branch::KEY),
            _ => None,
        };
        setup.command(hidden(name), move |host, input| {
            if let Some(key) = closes.filter(|_| input.is_some()) {
                host.dialog(Dialog::Close { key: key.to_owned() });
            }
            ran.with_viewer(host, |viewer| {
                run(&ran, host, viewer, input);
                true
            })
        });
    }
    let observed = diffs.clone();
    setup.on_event(&TURNS, move |host, event| {
        let turn = match event {
            V2Event::SessionExecutionStarted(event) => Turn::Started(&event.data.session_id.0),
            V2Event::SessionExecutionSucceeded(event) => Turn::Ended(&event.data.session_id.0),
            V2Event::SessionExecutionFailed(event) => Turn::Ended(&event.data.session_id.0),
            V2Event::SessionExecutionInterrupted(event)
                if event.data.reason == SessionExecutionInterruptedDataReason::Shutdown =>
            {
                return;
            }
            V2Event::SessionExecutionInterrupted(event) => Turn::Ended(&event.data.session_id.0),
            V2Event::ServerConnected(_) => Turn::Reconnected,
            _ => return,
        };
        observed.with_viewer(host, |viewer| viewer.turn(host, &observed, turn));
    });
    let replied = diffs.clone();
    setup.on_reply(move |host, id, reply| replied.reply(host, id, reply));
    for (name, place) in [(PANEL, Place::Panel(PANEL.to_owned())), (PAGE, Place::Route(ROUTE.to_owned()))] {
        let (viewed, handled) = (diffs.clone(), diffs.clone());
        let surface = Surface::new(name, place, move |cx| view::view(&viewed, cx))
            .palette()
            .mounts()
            .layout(Vec::new(), view::layout)
            .on(move |host, event| handled.handle(host, name, event))
            .layers(vec![keys::layer()]);
        setup.surface(surface);
    }
    let (viewed, handled) = (diffs.clone(), diffs.clone());
    let menu = Surface::new(MENU, Place::Overlay(MENU.to_owned()), move |cx| file_menu::view(&viewed, cx))
        .on(move |host, event| file_menu::handle(&handled, host, event))
        .layers(vec![file_menu::layer()]);
    setup.surface(menu);
    Ok(())
}

impl Diffs {
    fn open(&self, host: &dyn Host) {
        let route = host.route();
        if let abi::Route::Session { id } = &route {
            let open = self
                .viewer
                .borrow()
                .as_ref()
                .is_some_and(|viewer| viewer.place == Showing::Panel { session: id.clone() });
            if open {
                host.close_panel(PANEL);
                return;
            }
            let fullscreen = host.setting("diffs.fullscreen") == Some(serde_json::Value::Bool(true));
            host.open_panel(OpenPanel { surface: PANEL.to_owned(), session: Some(id.clone()), fullscreen });
            return;
        }
        *self.back.borrow_mut() = Some(route);
        host.navigate(abi::Route::Plugin { id: ID.to_owned(), name: ROUTE.to_owned() });
    }

    fn with_viewer(&self, host: &dyn Host, f: impl FnOnce(&mut Viewer) -> bool) {
        let mut held = self.viewer.borrow_mut();
        let Some(viewer) = held.as_mut() else { return };
        if f(viewer) {
            viewer.drawn = false;
        }
        viewer.follow_tree(host);
    }

    fn handle(&self, host: &dyn Host, surface: &str, event: &Event) -> Handled {
        if let Event::Mount { mounted, .. } = event {
            self.mounted(host, surface, *mounted);
            return Handled::Pass;
        }
        let mut handled = Handled::Pass;
        self.with_viewer(host, |viewer| {
            if viewer.surface() != surface {
                return false;
            }
            let before = viewer.shown();
            handled = match event {
                Event::Key(key) => match key.bind.as_deref().and_then(keys::action) {
                    Some(action) => viewer.run(host, self, action),
                    None => Handled::Pass,
                },
                Event::Pointer(pointer) => self.pressed(host, viewer, pointer),
                Event::Scroll { event: ScrollEvent::UserScroll { scroll } } if scroll == FILES => {
                    viewer.clear_patch_selection(host);
                    Handled::Consume
                }
                Event::Scroll { event: ScrollEvent::Landed { anchor, .. } } => {
                    viewer.landed(anchor);
                    Handled::Consume
                }
                Event::Closed { surface } if surface == MENU => {
                    viewer.menu = None;
                    Handled::Consume
                }
                _ => Handled::Pass,
            };
            viewer.shown() != before
        });
        handled
    }

    fn pressed(&self, host: &dyn Host, viewer: &mut Viewer, pointer: &abi::interact::Pointer) -> Handled {
        let row =
            pointer.node.strip_prefix("t:").and_then(|id| id.parse::<usize>().ok()).and_then(|id| {
                tree::flatten(&viewer.tree, Some(&viewer.expanded)).into_iter().find(|row| row.id == id)
            });
        let file = row.as_ref().map_or_else(|| viewer.file_of(&pointer.node), |row| row.file);
        match (pointer.kind, pointer.button) {
            (PointerKind::Down, Some(Button::Right)) => match file {
                Some(file) => viewer.open_menu(host, file, pointer.screen_x, pointer.screen_y),
                None => return Handled::Pass,
            },
            (PointerKind::Up, Some(Button::Left)) => match &row {
                Some(row) => viewer.pick_row(host, row),
                None => return Handled::Pass,
            },
            _ => return Handled::Pass,
        }
        Handled::Consume
    }

    /// A mount of `surface` begins or ends. The first one begins a viewer, which loads; the last one ends it, and with
    /// it its menu, its watch and what its replies would change.
    fn mounted(&self, host: &dyn Host, surface: &str, mounted: bool) {
        if !mounted {
            let left = self.mounts.get().saturating_sub(1);
            self.mounts.set(left);
            if left == 0 && self.viewer.borrow_mut().take().is_some() {
                for key in [sources::KEY, base_branch::KEY, help::KEY, IMAGES] {
                    host.dialog(Dialog::Close { key: key.to_owned() });
                }
            }
            return;
        }
        self.mounts.set(self.mounts.get() + 1);
        if self.viewer.borrow().as_ref().is_some_and(|viewer| viewer.surface() == surface) {
            return;
        }
        let place = match (surface, host.route()) {
            (PANEL, abi::Route::Session { id }) => Showing::Panel { session: id },
            (PANEL, _) => return,
            _ => Showing::Route { session: None, back: self.back.borrow_mut().take().unwrap_or_default() },
        };
        self.viewers.set(self.viewers.get() + 1);
        let mut viewer = Viewer::new(host, &self.memory.borrow(), self.viewers.get(), place);
        viewer.load(host, self);
        *self.viewer.borrow_mut() = Some(viewer);
    }

    fn reply(&self, host: &dyn Host, id: RequestId, reply: Result<serde_json::Value, String>) {
        let Some(asked) = self.answered(id) else { return };
        match asked.viewer() {
            None => {
                if let Asked::Branches { request } = asked {
                    base_branch::reply(host, self, request, reply);
                }
            }
            Some(viewer) => self.with_viewer(host, |shown| {
                if shown.id == viewer {
                    shown.reply(host, self, asked, reply);
                }
                true
            }),
        }
    }
}

/// The image preview of `file`'s working-tree bytes, under its name (`DialogImagePreview`).
fn preview(host: &dyn Host, viewer: &Viewer, file: Option<&str>) {
    let Some(file) = file else { return };
    let Some(Preview::Ready(bytes, _)) = viewer.previews.get(file) else { return };
    let image = abi::Image::new(abi::base64::encode(bytes)).name(file);
    host.dialog(Dialog::Images(abi::Images::new(vec![image])));
}
