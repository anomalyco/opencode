//! The diff viewer (E.15a and E.15b, row F15, `feature-plugins/system/diff-viewer.tsx`): the built-in
//! `opencode.diffs`, a plugin of contract 2.0 on both carriers (P6c, synthesis 4.9). `/diff` docks the viewer beside
//! the session as its panel, or opens it as a full-screen route outside a session. The viewer loads the VCS or
//! last-turn diff, and shows each file as a card under a sticky header, with the file tree beside the cards when the
//! screen is wide enough, split or unified hunks by width, and reviewed marks.
//!
//! What the host did for the old viewer it does for any plugin: the cards are a windowed list, the hunk cursor is a
//! step, the reading position a keep, the top edge's color a paint of `layout`, and the panel, the keys, the menu and
//! the dialogs are surfaces, a layer, an overlay and host dialogs. One viewer shows at a time: its state lives from
//! its mount's begin to its end.

use opencode_api::generated::V2Event;
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
use viewer::{Memory, Mode, Preview, Showing, Viewer};

use crate::prelude::*;

pub const ID: &str = "opencode.diffs";
/// The full-screen route's name.
pub const ROUTE: &str = "diff";
/// The surfaces: the docked panel and the route, which show a viewer, and the file menu over them.
pub const PANEL: &str = "panel";
pub const PAGE: &str = "diff";
pub const MENU: &str = "menu";
/// The nodes the verbs name: the cards, the file tree's scroll, and the fixed edge above the cards.
const FILES: &str = "files";
const TREE: &str = "tree";
const EDGE: &str = "edge";
/// The commands the viewer's clicks and dialogs run.
const SOURCE: &str = "opencode.diffs.source";
const HELP: &str = "opencode.diffs.help";
const LEAVE: &str = "opencode.diffs.leave";
const PREVIEW: &str = "opencode.diffs.preview";
const PICK_SOURCE: &str = "opencode.diffs.pick_source";
const PICK_BASE: &str = "opencode.diffs.pick_base";
const QUERY_BASE: &str = "opencode.diffs.query_base";
/// The events that end a turn, after which the last turn's diff loads again.
const ENDED: [&str; 3] = ["session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"];

/// What a command of a click or a dialog does to the viewer on screen, with its input.
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
    /// The viewer on screen, if one is.
    pub(crate) viewer: RefCell<Option<Viewer>>,
    /// The mounts of its panel or route that live: a mount that begins while another lives keeps the viewer.
    mounts: Cell<u32>,
    viewers: Cell<u64>,
    requests: RefCell<HashMap<RequestId, Asked>>,
    picker: RefCell<base_branch::Picker>,
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    let diffs = Rc::new(Diffs::default());
    let open = Command {
        name: "diff.open".to_owned(),
        title: "Open diff viewer".to_owned(),
        group: Some("VCS".to_owned()),
        slash: Some("diff".to_owned()),
        palette: true,
        ..Command::default()
    };
    let opened = diffs.clone();
    setup.command(open, move |host, _| opened.open(host));
    let hidden = |name: &str| Command { name: name.to_owned(), ..Command::default() };
    let commands: [(&str, Clicked); 7] = [
        (SOURCE, |diffs, host, viewer, _| sources::open(host, viewer, &diffs.memory.borrow())),
        (HELP, |_, host, viewer, _| help::open(host, viewer)),
        (LEAVE, |diffs, host, viewer, _| {
            // Docked, the press that ran it already gave the panel the focus.
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
            host.dialog(Dialog::Close { key: base_branch::KEY.to_owned() });
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
        setup.command(hidden(name), move |host, input| {
            ran.with_viewer(host, |viewer| {
                run(&ran, host, viewer, input);
                true
            })
        });
    }
    let observed = diffs.clone();
    setup.on_event(&ENDED, move |host, event| {
        let session = match event {
            V2Event::SessionExecutionSucceeded(event) => &event.data.session_id.0,
            V2Event::SessionExecutionFailed(event) => &event.data.session_id.0,
            V2Event::SessionExecutionInterrupted(event) => &event.data.session_id.0,
            _ => return,
        };
        observed.with_viewer(host, |viewer| viewer.turn_ended(host, &observed, session));
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
    /// `diff.open`: closes the session's open viewer, else docks one beside the session, else opens the route.
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

    /// Runs `f` on the viewer on screen, which says whether the view may show something new, then brings its tree's
    /// selection into view.
    fn with_viewer(&self, host: &dyn Host, f: impl FnOnce(&mut Viewer) -> bool) {
        let mut held = self.viewer.borrow_mut();
        let Some(viewer) = held.as_mut() else { return };
        if f(viewer) {
            viewer.drawn = false;
        }
        viewer.follow_tree(host);
    }

    /// The events of a mount of the panel or the route `surface`.
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
            // A key, press or step that changes nothing the view shows (a wheel step, a hunk step within the selected
            // file, the view toggle where split is not available) costs no view.
            viewer.shown() != before
        });
        handled
    }

    /// A press on a file's heading or tree row: the left button picks a row, the right opens the file menu.
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
            if left == 0 {
                self.viewer.borrow_mut().take();
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
    let Some(Preview::Ready(bytes)) = viewer.previews.get(file) else { return };
    let image = abi::Image { data: abi::base64::encode(bytes), name: Some(file.to_owned()) };
    host.dialog(Dialog::Images(abi::Images { images: vec![image], index: 0 }));
}
