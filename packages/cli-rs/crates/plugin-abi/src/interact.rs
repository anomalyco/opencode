//! Input events, key layers, panels and overlays for plugin surfaces. The host applies handler effects before
//! routing the next event in the batch, so a mode change affects the next key.
//!
//! A mount owns its layers, mode, pointer capture, held keys and overlays. Setup layers live until deactivation.

use std::rc::Rc;

use serde::{Deserialize, Serialize};

use crate::{Color, Host};

/// What a handler did with an event: took it, or passed it on down the host's order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Handled {
    /// The event goes no further: no lower layer, widget or app binding sees it.
    Consume,
    /// The event goes on as if the handler were not there.
    Pass,
}

/// A handler of a surface's events, or of a layer registered in setup. Its effects wait for it to return.
pub type HandlerFn = Rc<dyn Fn(&dyn Host, &Event) -> Handled>;

/// An event the host routes to a plugin.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Event {
    /// A key one of the plugin's layers takes: a [`Bind`] (with its `bind` name), or any key of an [`Layer::any`]
    /// listener (without).
    Key(Key),
    /// A bracketed paste, for a layer that declares [`Layer::paste`]; otherwise the host's paste route takes it.
    #[cfg_attr(not(feature = "host"), non_exhaustive)]
    Paste { text: String },
    /// A pointer event on a node with [`Interact::pointer`].
    Pointer(Pointer),
    /// The pointer entered (`inside`) or left a node with [`Interact::hover_events`].
    #[cfg_attr(not(feature = "host"), non_exhaustive)]
    Hover { node: String, inside: bool },
    /// The host closed the plugin's overlay `surface`: escape, a click outside it, or another overlay of the plugin. Or
    /// the dialog of its dialog surface `surface` closed, however it closed: the plugin hears it, not the mount, which
    /// has ended ([`crate::Dialog::Surface`]).
    #[cfg_attr(not(feature = "host"), non_exhaustive)]
    Closed { surface: String },
    /// A scroll of the mount: the user moved one that asks with `user_scroll`, or a step of the plugin's own landed.
    /// The answer does not matter.
    #[cfg_attr(not(feature = "host"), non_exhaustive)]
    Scroll { event: crate::v2::ScrollEvent },
    /// The text of the mount's [`crate::v2::Node::Input`] `node` changed, after each edit. `seq` numbers the edit,
    /// higher for each later one, which a view's [`crate::v2::Node::Input`] `seen` names. The answer does not matter.
    #[cfg_attr(not(feature = "host"), non_exhaustive)]
    Change {
        node: String,
        text: String,
        #[serde(default)]
        seq: u64,
    },
    /// The mount's [`crate::v2::Node::Input`] `node` was submitted: enter on one line, the submit key on many. The
    /// answer does not matter.
    #[cfg_attr(not(feature = "host"), non_exhaustive)]
    Submit { node: String, text: String },
    /// Mount `mount` began (`mounted`), before its first view, or it is ending, for a surface that asks
    /// ([`crate::v2::Surface::mounts`]), as a 1.x claim's `on_mount`. A new mount may begin before the one it replaces
    /// ends, also with the same input: `mount` tells them apart. `slot` is a slot surface's input. The plugin hears
    /// it, not the mount, at the begin as at the end, which has no mount left: what its handler starts is the plugin's
    /// and outlives the mount, as a fetch of setup is the activation's ([`Host::try_fetch`]). So a read a next mount
    /// shows survives the mount that asked, which may end first. The answer does not matter.
    #[cfg_attr(not(feature = "host"), non_exhaustive)]
    Mount {
        mount: crate::v2::MountId,
        mounted: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        slot: Option<crate::SlotInput>,
    },
    /// An event a later 2.x adds, which only the SDK's `next` feature has: a plugin's wildcard arm follows it.
    #[cfg(feature = "next")]
    #[doc(hidden)]
    Later {},
}

impl Event {
    /// Whether the user's own input caused it: a key, a paste, a press, an edit. A scroll says so itself
    /// ([`crate::v2::ScrollEvent::UserScroll`]); hovering and an overlay's close do not count.
    pub fn by_user(&self) -> Option<bool> {
        match self {
            Event::Key(_) | Event::Paste { .. } | Event::Pointer(_) | Event::Change { .. } | Event::Submit { .. } => {
                Some(true)
            }
            Event::Scroll { event } => Some(matches!(event, crate::v2::ScrollEvent::UserScroll { .. })),
            Event::Hover { .. } | Event::Closed { .. } | Event::Mount { .. } => None,
            #[cfg(feature = "next")]
            Event::Later {} => None,
        }
    }
}

/// A key as the host names it: a shortcut such as `ctrl+a` or `escape`, and the text it types, if any.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Key {
    /// The [`Bind::name`] that took it; `None` for a listener.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bind: Option<String>,
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// A pointer event on a node, at a cell in the node (`x`, `y`) and on the screen.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Pointer {
    pub node: String,
    pub kind: PointerKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub button: Option<Button>,
    pub x: i32,
    pub y: i32,
    pub screen_x: u16,
    pub screen_y: u16,
    /// For a [`PointerKind::Drop`]: the node of the plugin the drag started on, in this mount or another of the
    /// plugin's. A drag from another plugin's node or a host widget drops nothing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<Dragged>,
}

/// Where a dropped drag started: a node of one of the plugin's mounts.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Dragged {
    pub surface: String,
    pub node: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum PointerKind {
    Down,
    Up,
    /// The pointer moved with a button down, after a press on this node that the plugin consumed (its capture).
    Drag,
    WheelUp,
    WheelDown,
    /// A drag that started on a node of the plugin, in this mount or another, ended on this one ([`Pointer::from`]).
    Drop,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Button {
    Left,
    Middle,
    Right,
}

/// What a box does with input, as data on the node: the host wires it, and needs no plugin call for `hover`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Interact {
    /// The node can take the focus, by a click or [`Host::focus`]; it needs an id. A field ([`crate::v2::Node::Input`])
    /// with an id takes it by nature, on a host with [`crate::FOCUS_INPUT`].
    #[serde(skip_serializing_if = "is_false")]
    pub focusable: bool,
    /// Press, release, drag, wheel and drop on the node come as [`Event::Pointer`]. A consumed press captures the
    /// pointer for the drag that follows.
    #[serde(skip_serializing_if = "is_false")]
    pub pointer: bool,
    /// The background while the pointer is over the node.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hover: Option<Color>,
    /// The pointer entering and leaving the node come as [`Event::Hover`].
    #[serde(skip_serializing_if = "is_false")]
    pub hover_events: bool,
}

impl Interact {
    pub fn is_none(&self) -> bool {
        *self == Self::default()
    }
}

/// Keys a plugin takes while its scope holds, in a mode or in the base mode, above the layers of lower priority.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Layer {
    pub scope: LayerScope,
    /// Above or below the host's own layers of the same scope, which have priority 0.
    #[serde(default)]
    pub priority: i32,
    /// The plugin's mode the layer needs ([`Host::set_mode`]); without one, the host's base mode.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keys: Vec<Bind>,
    /// Every key comes to the handler before the host's layers, as a listener: a double escape, an activity timer,
    /// or a modal composer's normal mode. It never sees the reserved chord ([`RESERVED`]).
    #[serde(default, skip_serializing_if = "is_false")]
    pub any: bool,
    /// Pastes in the scope come to the handler, which may take them; else the host's paste route has them.
    #[serde(default, skip_serializing_if = "is_false")]
    pub paste: bool,
}

/// Where a [`Layer`] holds.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum LayerScope {
    /// While the focus is in the mount's surface (a route, a panel, an overlay). A layer of setup has no surface.
    #[default]
    Surface,
    /// While the focus is in the node with this id, in the mount's tree: a focusable box, or a field
    /// ([`crate::v2::Node::Input`]) while the user types in it.
    Node(String),
    /// While the composer has the focus.
    Composer,
    /// Always, in the layer's mode; below every dialog the host shows. A printable key (one character or `space`, with
    /// no modifier but Shift) is the text's while the composer or another text input has the focus: it reaches the
    /// layer only elsewhere.
    Global,
}

/// One key of a [`Layer`].
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Bind {
    /// The key, as the host's keybinds write one (`ctrl+a`, `escape`, `]`).
    pub key: String,
    /// What the handler gets as [`Key::bind`].
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Once the handler consumes this key, the host holds the keys that follow in the same scope until the plugin
    /// calls [`Host::release_keys`], or [`HOLD`] passes, and then routes them in order. For a plugin that answers a
    /// key from its own thread.
    #[serde(default, skip_serializing_if = "is_false")]
    pub hold: bool,
    /// The name of the user's keybind for it, such as `diff.next_hunk`: the config's keys for that name take it, else
    /// the keybind's default, and `key` when the host knows no keybind of that name. [`Read::shortcut`] of the name
    /// shows them.
    ///
    /// [`Read::shortcut`]: crate::Read::shortcut
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
}

impl Bind {
    pub fn new(key: impl Into<String>, name: impl Into<String>) -> Self {
        Self { key: key.into(), name: name.into(), ..Self::default() }
    }

    /// A bind the user's keybind `command` takes, heard as `name`.
    pub fn command(command: impl Into<String>, name: impl Into<String>) -> Self {
        Self { name: name.into(), command: Some(command.into()), ..Self::default() }
    }
}

/// The chord no plugin layer can take: it drops every mode of the plugins, and reaches the app as it would.
pub const RESERVED: &str = "ctrl+c";

/// How long the host holds keys after a [`Bind::hold`] key at most.
pub const HOLD: std::time::Duration = std::time::Duration::from_millis(50);

/// A node's place on the screen, in cells, as the last settled frame laid it out.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Where the focus is, for the running call's mount: in which of its nodes with an id, and whether it is in the
/// mount's surface at all.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Focused {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node: Option<String>,
    pub surface: bool,
}

/// What a docked panel surface ([`crate::v2::Place::Panel`]) is told about how it shows.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct PanelInput {
    pub width: u16,
    /// Over the whole screen, rather than beside the session.
    pub fullscreen: bool,
    /// The panel has the input.
    pub focused: bool,
    /// Full screen because the session's room is too narrow to show the panel beside it; an open of the panel beside
    /// the session shows it full screen still.
    #[serde(default, skip_serializing_if = "is_false")]
    pub forced: bool,
}

/// Opens the plugin's panel `surface` beside a session ([`Host::open_panel`]); one panel shows at a time.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct OpenPanel {
    pub surface: String,
    /// The session it shows beside, which must be on screen; without one, the session on screen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub fullscreen: bool,
}

/// Opens the plugin's overlay `surface` over everything but the host's dialogs ([`Host::overlay`]), where `anchor`
/// says, at most `width` by `height` cells. It takes the focus; escape and a click outside it close it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Overlay {
    pub surface: String,
    pub anchor: Anchor,
    pub width: u16,
    pub height: u16,
}

/// Where an overlay's top left corner goes. The host keeps it on the screen.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Anchor {
    /// A screen cell, such as where the pointer was pressed.
    Point { x: u16, y: u16 },
    /// Under the node with this id, in the mount whose call opens the overlay.
    Node { node: String },
    /// Against an edge of the screen, at its middle.
    Edge(Edge),
    /// Inside another surface of the plugin that shows (a panel, a slot), against its edge, at its middle. A surface
    /// of the host, such as the transcript, is not one: what a plugin may know of it is its published viewport.
    Surface { surface: String, edge: Edge },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Edge {
    Top,
    Bottom,
    Left,
    Right,
}

fn is_false(value: &bool) -> bool {
    !value
}
