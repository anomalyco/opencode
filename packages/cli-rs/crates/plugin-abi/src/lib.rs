//! The plugin contract and its Rust SDK: what the built-in plugins link against, and the messages the Luau and pipe
//! carriers exchange with the host. JSON readers ignore unknown fields. The wire schema is `schema/v2.json`.
//!
//! A Rust plugin registers renderers and handlers through [`Setup`]. Renderers receive a [`Read`] and return data for
//! the host to draw. Handlers receive a [`Host`]; their effects run after the outermost callback returns.

// A builder for a variant field leaves nodes of other kinds unchanged.
macro_rules! node_setters {
    ($($name:ident($($arg:ident: $ty:ty),*) on $($variant:ident)|+: $field:ident = $value:expr;)*) => {$(
        #[doc = concat!("Sets `", stringify!($field), "` on `", stringify!($($variant)|+), "` nodes.")]
        pub fn $name(mut self, $($arg: $ty),*) -> Self {
            if let $(Self::$variant { $field: slot, .. })|+ = &mut self {
                *slot = $value;
            }
            self
        }
    )*};
}

macro_rules! common_node_setters {
    () => {
        node_setters! {
            on_click(click: Click) on Box | Text: on_click = Some(click);
            gap(cells: u16) on Box: gap = cells;
            padding(x: u16, y: u16) on Box: padding = (x, y);
            justify(value: Justify) on Box: justify = value;
            align(value: Align) on Box: align = value;
            unselectable() on Text: selectable = false;
            fg(color: impl Into<Color>) on Text: fg = Some(color.into());
            hover_fg(color: impl Into<Color>) on Text: hover_fg = Some(color.into());
            truncate() on Text: truncate = true;
            border(value: Border) on Box: border = Some(Box::new(value));
            padding_sides(edges: Edges) on Box: padding_sides = Some(edges);
            flex_wrap() on Box: wrap = true;
        }
    };
}

mod build;
pub mod call;
pub mod canvas;
pub mod claim;
pub mod interact;
pub mod mail;
mod schema;
pub mod task;
pub mod v2;

pub use mail::{BOUND, SendError, Sender, Spawner, Stop};

use std::borrow::Cow;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::rc::Rc;
use std::sync::{Arc, PoisonError, RwLock};

pub use opencode_api_types as types;
/// The API's requests, one builder per endpoint, typed by what each answers: [`task::Cx::call`] sends them.
pub use opencode_api_types::call::Call;
pub use opencode_api_types::client;
/// The serde the typed helpers decode with ([`Setup::options_as`], [`Stored`]), for a plugin's own types.
pub use serde;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use types::{
    IntegrationInfo, McpServer, ModelInfo, ModelRef, ProviderInfo, SessionInfo, SessionMessageInfo, UsageLimitsInfo,
    V2Event, VcsInfo,
};

/// The major version: changes only with a deliberate breaking change, and a major the host does not serve refuses the
/// plugin.
pub const ABI_MAJOR: u32 = 2;
/// The minor version of [`ABI_MAJOR`]. 2.0 is everything this crate has; a later minor only appends.
pub const ABI_MINOR: u32 = 0;

/// The shortest a timer waits ([`Host::try_timer`]): one asked for less waits this long. A shorter tick is a canvas's
/// `animate`.
pub const MIN_TIMER: std::time::Duration = std::time::Duration::from_millis(20);
/// The most timers of a plugin that wait at once ([`Host::try_timer`]): the host refuses one more.
pub const MAX_TIMERS: usize = 32;

/// `delay` in the whole milliseconds of [`HostRequest::Timer`], a part of one counted as one: a timer never fires
/// before its time.
fn timer_ms(delay: std::time::Duration) -> u64 {
    u64::try_from(delay.as_nanos().div_ceil(1_000_000)).unwrap_or(u64::MAX)
}

/// The optional features this crate's host side knows ([`Read::abi`]).
pub const FEATURES: &[&str] = &[IMAGE_BOUNDS, FOCUS_INPUT, FENCE_NODE];

/// The host answers [`HostRequest::ImageBounds`] with the bounds of the images it decodes, so the SDK answers
/// [`Read::image_size`] of bytes past them without sending them. A host without it is asked every time.
pub const IMAGE_BOUNDS: &str = "image-bounds";

/// [`Host::focus`] gives the focus to a [`v2::Node::Input`] with an id, as a click does, so what the user types goes
/// into the field. A host without it refuses that focus, and the field takes the focus only from the user's click. A
/// plugin reads [`Read::abi`]'s [`Abi::has_feature`].
pub const FOCUS_INPUT: &str = "focus-input";

/// The host draws [`v2::Node::Fence`], its own code view of a claimed fence, in a fence claim's tree. A host without
/// it fails a plugin that sends one; [`v2::View::or`] lowers it for that host.
pub const FENCE_NODE: &str = "fence-node";

/// What [`HostRequest::ImageBounds`] answers: the most bytes one image may have, and the most pixels a side its header
/// may name, as the host decodes images; past either, [`Read::image_size`] is `None`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct ImageBounds {
    pub bytes: u64,
    pub side: u64,
}

impl ImageBounds {
    pub fn new(bytes: u64, side: u64) -> Self {
        Self { bytes, side }
    }

    /// Whether `bytes` are past the bounds, by their length or the size their header names.
    pub fn over(&self, bytes: &[u8]) -> bool {
        bytes.len() as u64 > self.bytes
            || image_size(bytes).is_some_and(|(width, height)| u64::from(width.max(height)) > self.side)
    }
}

/// The version a host serves a plugin ([`Read::abi`]): its major, its minor of that major, and its optional features.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Abi {
    pub major: u32,
    pub minor: u32,
    pub features: Vec<String>,
}

impl Abi {
    /// What a host of this crate serves: [`ABI_MAJOR`].[`ABI_MINOR`] with [`FEATURES`].
    pub fn current() -> Self {
        Self::new(ABI_MAJOR, ABI_MINOR, FEATURES.iter().map(|feature| (*feature).to_owned()).collect())
    }

    pub fn new(major: u32, minor: u32, features: Vec<String>) -> Self {
        Self { major, minor, features }
    }

    /// Whether the host has what minor `minor` of [`ABI_MAJOR`] added.
    pub fn has_minor(&self, minor: u32) -> bool {
        self.major == ABI_MAJOR && self.minor >= minor
    }

    /// Whether the host has the optional feature `name`.
    pub fn has_feature(&self, name: &str) -> bool {
        self.features.iter().any(|feature| feature == name)
    }
}

/// Dark or light, from [`Read::theme_mode`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ThemeMode {
    Dark,
    Light,
}

/// Everything a plugin registered in its setup.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Manifest {
    pub id: String,
    pub commands: Vec<Command>,
    /// The languages of the code fences it renders.
    pub fences: Vec<String>,
    /// Slot claims of [`Setup::slot`], in order; [`Request::Render`] and [`Request::Mount`] name one by index.
    pub slots: Vec<SlotClaim>,
    /// The routes of [`Setup::route`], which answer [`Request::RenderRoute`].
    pub routes: Vec<String>,
    /// Storage keys, stored by the host as `plugin.<id>.<key>`.
    pub storage: Vec<String>,
    /// The event types of each [`Setup::on_event`] handler, in order; [`Request::Event`] names one by index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<Vec<String>>,
    /// The plugin has [`Setup::on_wake`] handlers, which [`Request::Wake`] runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub wake: bool,
    /// The routes with [`Setup::on_route_mount`] handlers, which [`Request::RouteMount`] runs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub route_mounts: Vec<String>,
    /// The plugin has [`Setup::on_fence_gone`] handlers, which [`Request::FenceGone`] runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub fence_gone: bool,
    /// The plugin has [`Setup::on_cancelled`] handlers, which [`Request::Cancelled`] runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub cancelled: bool,
    /// The plugin has [`Setup::on_deltas`] handlers, which [`Request::Deltas`] runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub deltas: bool,
    /// The plugin has [`Setup::on_plugins`] handlers, which [`Request::Plugins`] runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub plugins: bool,
    /// The surfaces of [`Setup::surface`], in order; [`Request::View`] names one by index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub surfaces: Vec<SurfaceClaim>,
    /// The renderer claims of [`Setup::claim`], in order; [`Request::Claim`] names one by index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub claims: Vec<claim::Entry>,
    /// The plugin has a [`Setup::messages`] handler, which [`Request::Message`] runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub messages: bool,
    /// The key layers of [`Setup::layer`], in order; [`Request::Input`] names one by index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub layers: Vec<interact::Layer>,
    /// The names of the searches of [`Setup::search`], which [`Request::Search`] runs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub searches: Vec<String>,
}

/// A surface of contract 2.0 as the manifest lists it ([`v2::Surface`] without its view).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct SurfaceClaim {
    pub name: String,
    pub place: SurfacePlace,
    /// The view reads [`v2::SurfaceInput::palette`]: only such a view gets the palette, and a theme change calls it.
    #[serde(default, skip_serializing_if = "is_false")]
    pub palette: bool,
    /// The surface has a draw ([`v2::Surface::draw`]), which [`Request::Draw`] runs for its canvases.
    #[serde(default, skip_serializing_if = "is_false")]
    pub draw: bool,
    /// What the surface's `layout` is told about; [`Request::Layout`] runs it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notify: Vec<v2::Notify>,
    /// The surface has a `layout`.
    #[serde(default, skip_serializing_if = "is_false")]
    pub layout: bool,
    /// The surface has a handler ([`v2::Surface::on`]), which [`Request::Input`] calls.
    #[serde(default, skip_serializing_if = "is_false")]
    pub handler: bool,
    /// The key layers each mount of it registers ([`v2::Surface::layers`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub layers: Vec<interact::Layer>,
    /// Its handler hears [`interact::Event::Mount`] ([`v2::Surface::mounts`]).
    #[serde(default, skip_serializing_if = "is_false")]
    pub mounts: bool,
}

/// [`v2::Place`] on the wire.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum SurfacePlace {
    Route {
        name: String,
    },
    Slot {
        kind: SlotKind,
        path: String,
    },
    /// A docked panel, and an overlay, which [`HostRequest::OpenPanel`] and [`HostRequest::Overlay`] open.
    Panel {
        name: String,
    },
    Overlay {
        name: String,
    },
    /// The body of a dialog, which [`Dialog::Surface`] opens.
    Dialog {
        name: String,
    },
}

impl From<&v2::Place> for SurfacePlace {
    fn from(place: &v2::Place) -> Self {
        match place {
            v2::Place::Route(name) => SurfacePlace::Route { name: name.clone() },
            v2::Place::Slot(at) => SurfacePlace::Slot { kind: at.kind, path: at.path.clone() },
            v2::Place::Panel(name) => SurfacePlace::Panel { name: name.clone() },
            v2::Place::Overlay(name) => SurfacePlace::Overlay { name: name.clone() },
            v2::Place::Dialog(name) => SurfacePlace::Dialog { name: name.clone() },
        }
    }
}

impl From<&SurfacePlace> for v2::Place {
    fn from(place: &SurfacePlace) -> Self {
        match place {
            SurfacePlace::Route { name } => v2::Place::Route(name.clone()),
            SurfacePlace::Slot { kind, path } => v2::Place::Slot(Placement::new(*kind, path.clone())),
            SurfacePlace::Panel { name } => v2::Place::Panel(name.clone()),
            SurfacePlace::Overlay { name } => v2::Place::Overlay(name.clone()),
            SurfacePlace::Dialog { name } => v2::Place::Dialog(name.clone()),
        }
    }
}

/// A command: in the palette when `palette` is set, as `/slash`, and on `keybind` (such as `ctrl+shift+h`), while it
/// is enabled.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Command {
    pub name: String,
    pub title: String,
    pub group: Option<String>,
    pub slash: Option<String>,
    pub keybind: Option<String>,
    pub palette: bool,
    /// A line under the title in the palette.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// `/slash` keeps its text after the name and passes it as the input.
    #[serde(default, skip_serializing_if = "is_false")]
    pub arguments: bool,
    /// Where the command runs.
    #[serde(default, skip_serializing_if = "Scope::is_global")]
    pub scope: Scope,
    /// Other names of its `/slash`, such as `sm` beside `session-manager`, each also completed and run (TS's slash
    /// `aliases`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    /// While `false` the command binds no key, and is in neither the palette nor the slash list, as TS binds no
    /// disabled command. The plugin changes it with [`Host::set_enabled`].
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    pub enabled: bool,
}

impl Default for Command {
    fn default() -> Self {
        Self {
            name: String::new(),
            title: String::new(),
            group: None,
            slash: None,
            keybind: None,
            palette: false,
            description: None,
            arguments: false,
            scope: Scope::Global,
            aliases: Vec::new(),
            enabled: true,
        }
    }
}

/// Where a [`Command`] runs: everywhere, or while the plugin's route of that name shows.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Scope {
    #[default]
    Global,
    Route(String),
    /// Everywhere, while the keyboard is in its base mode (TS's keymap layer without `mode: "global"`): not while a
    /// dialog or a mode a plugin pushed has it.
    Base,
}

impl Scope {
    fn is_global(&self) -> bool {
        *self == Scope::Global
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum SlotKind {
    Prepend,
    Append,
    Before,
    After,
    Replace,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct SlotClaim {
    pub kind: SlotKind,
    /// A host slot path, such as `home.footer` or `sidebar.content`.
    pub path: String,
    /// The claim has a [`Setup::on_mount`] handler, which [`Request::Mount`] runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub mount: bool,
    /// The claim reads its size ([`Setup::sized`]).
    #[serde(default, skip_serializing_if = "is_false")]
    pub size: bool,
}

/// Where a slot claim of [`Setup::slot`] goes.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Placement {
    pub kind: SlotKind,
    /// A host slot path, such as `home.footer` or `sidebar.content`.
    pub path: String,
}

impl Placement {
    pub fn new(kind: SlotKind, path: impl Into<String>) -> Self {
        Self { kind, path: path.into() }
    }

    pub fn append(path: impl Into<String>) -> Self {
        Self::new(SlotKind::Append, path)
    }

    pub fn prepend(path: impl Into<String>) -> Self {
        Self::new(SlotKind::Prepend, path)
    }
}

/// A color: a theme token path (`text.muted`, `markdown.heading`), a scale step (`categorical.3.300`,
/// `interactive.500`), `#rrggbb`, or an [`Rgba`]. On the wire it is that text, an [`Rgba`] as `#rrggbbaa`. An
/// unknown token draws in `text.base`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Color {
    Rgba(Rgba),
    Token(Cow<'static, str>),
}

impl From<&'static str> for Color {
    fn from(token: &'static str) -> Self {
        Color::Token(Cow::Borrowed(token))
    }
}

impl From<String> for Color {
    fn from(token: String) -> Self {
        Color::Token(Cow::Owned(token))
    }
}

impl From<Rgba> for Color {
    fn from(rgba: Rgba) -> Self {
        Color::Rgba(rgba)
    }
}

/// A color with alpha; the host blends a translucent one over what is below it. On the wire it is `#rrggbbaa`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Rgba {
    pub const fn new(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self { r, g, b, a }
    }

    /// `#rrggbbaa`, or `#rrggbb` for an opaque color.
    pub fn parse(text: &str) -> Option<Self> {
        let hex = text
            .strip_prefix('#')
            .filter(|hex| matches!(hex.len(), 6 | 8) && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))?;
        let channel = |index: usize| u8::from_str_radix(&hex[index..index + 2], 16).ok();
        let a = if hex.len() == 8 { channel(6)? } else { 255 };
        Some(Self::new(channel(0)?, channel(2)?, channel(4)?, a))
    }
}

impl Serialize for Rgba {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let Self { r, g, b, a } = self;
        serializer.collect_str(&format_args!("#{r:02x}{g:02x}{b:02x}{a:02x}"))
    }
}

impl<'de> Deserialize<'de> for Rgba {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = Cow::<str>::deserialize(deserializer)?;
        // Only the 8-digit form: `#rrggbb` stays a token.
        Self::parse(&text).filter(|_| text.len() == 9).ok_or_else(|| serde::de::Error::custom("not #rrggbbaa"))
    }
}

/// Styled text.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Span {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fg: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg: Option<Color>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub bold: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub italic: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub underline: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub dim: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub strikethrough: bool,
    /// An OSC 8 hyperlink to this URL; a terminal without OSC 8 shows the text alone. The host draws the text without
    /// it for a URL with a C0 or C1 control character or DEL (OpenTUI writes no such link).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
}

fn is_false(value: &bool) -> bool {
    !value
}

/// One row; the host draws rows without wrapping and scrolls a wide fence sideways.
pub type Line = Vec<Span>;

/// A fenced Markdown code block, as [`Setup::code_block`] renders it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Fence {
    pub language: String,
    pub info: String,
    pub code: String,
    /// The message is still streaming, so the block may be incomplete.
    pub streaming: bool,
    /// The closing fence has arrived.
    pub closed: bool,
    /// The host's name for this block. It stays the same while the block changes, across renders that return
    /// [`Fenced::Lines`] or [`Fenced::Keep`], so a plugin can keep its own state for the block by key, and drop it in
    /// [`Setup::on_fence_gone`].
    pub key: u64,
    /// The terminal's width in columns, for a plugin that lays out to fit it.
    #[serde(default)]
    pub width: u16,
}

/// What a fence render returns.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Fenced {
    /// The host's plain code view.
    Code,
    /// What the block showed before; the code view when it showed nothing of the plugin's.
    Keep,
    /// Rows the host draws without wrapping, scrolling sideways when wide: on a horizontal wheel, or with `drag`
    /// on a left drag, which swallows a horizontal wheel. `fg` draws spans without their own.
    Lines {
        lines: Vec<Line>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fg: Option<Color>,
        #[serde(default, skip_serializing_if = "is_false")]
        drag: bool,
    },
}

/// What a slot render ([`Setup::slot`]) returns.
// One a render, returned by value and dropped after: boxing `Show` would change every plugin's renders for no gain.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "node", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Render {
    /// What the claim shows now stays. On a claim that has not drawn yet, it draws nothing.
    Keep,
    /// The claim hides, with the gap around it.
    Hide,
    /// The claim shows `node`. The host rebuilds its widgets only when `node` differs from the last one.
    Show(Node),
}

/// What a plugin draws: boxes and text.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Node {
    /// A box that lays out its children in a column, or in a row. An empty box still takes its place.
    Box {
        #[serde(default, skip_serializing_if = "is_false")]
        row: bool,
        /// Cells between the children.
        #[serde(default, skip_serializing_if = "is_zero_u16")]
        gap: u16,
        /// Cells inside the edge, left and right, then top and bottom.
        #[serde(default, skip_serializing_if = "is_no_padding")]
        padding: (u16, u16),
        /// How the children share the room left along the row or column.
        #[serde(default, skip_serializing_if = "Justify::is_start")]
        justify: Justify,
        /// Where the children sit across the row or column.
        #[serde(default, skip_serializing_if = "Align::is_stretch")]
        align: Align,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bg: Option<Color>,
        #[serde(default, skip_serializing_if = "Layout::is_default")]
        layout: Layout,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_click: Option<Click>,
        #[serde(default)]
        children: Vec<Node>,
        /// A border on the box's edge, inside its size and outside its padding.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        border: Option<std::boxed::Box<Border>>,
        /// Cells inside each edge, instead of `padding`. A negative side counts as 0.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        padding_sides: Option<Edges>,
        /// Children that do not fit go on to another row or column.
        #[serde(default, skip_serializing_if = "is_false")]
        wrap: bool,
        /// Whether what does not fit in the box draws outside it.
        #[serde(default, skip_serializing_if = "Overflow::is_visible")]
        overflow: Overflow,
    },
    /// Styled text. `fg` draws spans without their own; by default `text.base`.
    Text {
        spans: Vec<Span>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fg: Option<Color>,
        #[serde(default, skip_serializing_if = "Wrap::is_word")]
        wrap: Wrap,
        /// Cuts lines that do not fit, instead of wrapping or overflowing.
        #[serde(default, skip_serializing_if = "is_false")]
        truncate: bool,
        /// Whether the mouse can select it. On by default.
        #[serde(default = "yes", skip_serializing_if = "is_true")]
        selectable: bool,
        /// What `fg` becomes while the pointer is over it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hover_fg: Option<Color>,
        #[serde(default, skip_serializing_if = "Layout::is_default")]
        layout: Layout,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_click: Option<Click>,
    },
    /// The claims of slot `path`, in place, as if they were children of this node's parent. `path` is a published
    /// slot inside the one the claim renders in, such as `home.footer.status` in `home.footer`; the host draws
    /// nothing for any other path. The host keeps the slot's claims mounted, and renders them with each change,
    /// also while this claim returns [`Render::Keep`].
    Slot { path: String },
    /// Markdown, drawn as the host draws a message, with the code-fence renderers of the active plugins.
    Markdown { text: String },
    /// A spinner with `label`, in the host's spinner color.
    Spinner { label: String },
}

impl Node {
    common_node_setters!();

    /// A box of `children` in a column.
    pub fn column(children: Vec<Node>) -> Self {
        Node::Box {
            row: false,
            gap: 0,
            padding: (0, 0),
            justify: Justify::Start,
            align: Align::Stretch,
            bg: None,
            layout: Layout::default(),
            on_click: None,
            children,
            border: None,
            padding_sides: None,
            wrap: false,
            overflow: Overflow::Visible,
        }
    }

    /// A box of `children` in a row.
    pub fn row(children: Vec<Node>) -> Self {
        let mut node = Self::column(children);
        if let Node::Box { row, .. } = &mut node {
            *row = true;
        }
        node
    }

    /// Selectable text of `spans` that wraps at words.
    pub fn text(spans: impl Into<Vec<Span>>) -> Self {
        Node::Text {
            spans: spans.into(),
            fg: None,
            wrap: Wrap::Word,
            truncate: false,
            selectable: true,
            hover_fg: None,
            layout: Layout::default(),
            on_click: None,
        }
    }

    /// The claims of slot `path` in place ([`Node::Slot`]).
    pub fn slot(path: impl Into<String>) -> Self {
        Node::Slot { path: path.into() }
    }

    node_setters! {
        layout(value: Layout) on Box | Text: layout = value;
        bg(color: impl Into<Color>) on Box: bg = Some(color.into());
        wrap(value: Wrap) on Text: wrap = value;
        overflow(value: Overflow) on Box: overflow = value;
    }
}

/// A border of a [`Node::Box`] (TS `border`, `borderStyle`, `borderColor`, `title`, `titleAlignment`, `bottomTitle` and
/// `bottomTitleAlignment`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Border {
    /// The sides that draw; all four by default.
    #[serde(default, skip_serializing_if = "Sides::is_all")]
    pub sides: Sides,
    #[serde(default, skip_serializing_if = "BorderStyle::is_single")]
    pub style: BorderStyle,
    /// White by default, as TS draws a border without a color; name a token such as `border.base` to follow the theme.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
    /// A title on the top side, in the border's color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "TitleAlign::is_left")]
    pub title_align: TitleAlign,
    /// A title on the bottom side, in the border's color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom_title: Option<String>,
    #[serde(default, skip_serializing_if = "TitleAlign::is_left")]
    pub bottom_title_align: TitleAlign,
}

/// Which sides of a [`Border`] draw.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sides {
    #[serde(default)]
    pub top: bool,
    #[serde(default)]
    pub right: bool,
    #[serde(default)]
    pub bottom: bool,
    #[serde(default)]
    pub left: bool,
}

impl Sides {
    pub const ALL: Self = Self { top: true, right: true, bottom: true, left: true };
    pub const NONE: Self = Self { top: false, right: false, bottom: false, left: false };

    fn is_all(&self) -> bool {
        *self == Self::ALL
    }
}

impl Default for Sides {
    fn default() -> Self {
        Self::ALL
    }
}

/// The lines a [`Border`] draws with.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum BorderStyle {
    #[default]
    Single,
    Double,
    Rounded,
    Heavy,
}

impl BorderStyle {
    fn is_single(&self) -> bool {
        *self == BorderStyle::Single
    }
}

/// Where a [`Border`]'s title sits on its top side.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum TitleAlign {
    #[default]
    Left,
    Center,
    Right,
}

impl TitleAlign {
    fn is_left(&self) -> bool {
        *self == TitleAlign::Left
    }
}

/// Cells at each edge of a node: its padding ([`Node::padding_sides`]) or its margin ([`Layout::margin`]).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Edges {
    #[serde(default, skip_serializing_if = "is_zero_i16")]
    pub top: i16,
    #[serde(default, skip_serializing_if = "is_zero_i16")]
    pub right: i16,
    #[serde(default, skip_serializing_if = "is_zero_i16")]
    pub bottom: i16,
    #[serde(default, skip_serializing_if = "is_zero_i16")]
    pub left: i16,
}

impl Edges {
    pub const fn new(top: i16, right: i16, bottom: i16, left: i16) -> Self {
        Self { top, right, bottom, left }
    }

    /// `cells` at every edge.
    pub const fn all(cells: i16) -> Self {
        Self::new(cells, cells, cells, cells)
    }
}

fn is_zero_i16(value: &i16) -> bool {
    *value == 0
}

/// What a [`Node::Box`] does with what does not fit in it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Overflow {
    /// It draws outside the box.
    #[default]
    Visible,
    /// The box cuts it off.
    Hidden,
}

impl Overflow {
    fn is_visible(&self) -> bool {
        *self == Overflow::Visible
    }
}

/// What a click on a node runs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Click {
    pub action: Action,
    /// On the press of the left button, or on its release.
    pub on: Press,
}

impl Click {
    /// Runs command `name`, with no input, on the release of the left button.
    pub fn command(name: impl Into<String>) -> Self {
        Self::new(Action::command(name))
    }

    /// The click whose command runs with `value` as its input.
    pub fn input(self, value: impl Into<String>) -> Self {
        Self { action: self.action.input(value), ..self }
    }

    /// The click on the press of the left button instead.
    pub fn on_down(self) -> Self {
        Self { on: Press::Down, ..self }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Press {
    Down,
    Up,
}

/// What a click asks the host to do, after the event that caused it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Action {
    /// Runs a registered command, the plugin's or the host's, palette or not, as [`Host::dispatch`] does.
    Command {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        input: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Justify {
    #[default]
    Start,
    End,
    Center,
    SpaceBetween,
    SpaceAround,
}

/// Where a box's children sit across its row or column.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Align {
    #[default]
    Stretch,
    Start,
    Center,
    End,
}

impl Align {
    fn is_stretch(&self) -> bool {
        *self == Align::Stretch
    }
}

impl Justify {
    fn is_start(&self) -> bool {
        *self == Justify::Start
    }
}

/// How a node takes space in its parent's row or column.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Layout {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<Width>,
    /// Takes the room left over, from its own size up.
    #[serde(default, skip_serializing_if = "is_false")]
    pub grow: bool,
    /// Whether it gives up room when its parent is too small; the host's default when `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shrink: Option<bool>,
    /// The least width it takes; `Cells(0)` lets it shrink below its content's width.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_width: Option<Width>,
    /// The most width it takes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_width: Option<Width>,
    /// Its height, in rows or percent of its parent's; its content's by default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<Width>,
    /// The least height it takes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_height: Option<Width>,
    /// The most height it takes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_height: Option<Width>,
    /// Cells outside each edge; a negative margin moves the node over its neighbors.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub margin: Option<Edges>,
    /// Out of its parent's flow, placed against its edges.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub absolute: Option<Absolute>,
}

/// Where an absolute node sits: cells from its parent's edges, a negative one outside them, and its paint order among
/// its siblings (TS `top`, `right`, `bottom`, `left` and `zIndex`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Absolute {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top: Option<i16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<i16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom: Option<i16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<i16>,
    #[serde(default, skip_serializing_if = "is_zero_i32")]
    pub z: i32,
}

fn is_zero_i32(value: &i32) -> bool {
    *value == 0
}

impl Layout {
    fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

/// A length in cells (rows, for a height) or in percent of the parent's.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Width {
    Cells(u16),
    Percent(f32),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Wrap {
    #[default]
    Word,
    Char,
    None,
}

impl Wrap {
    fn is_word(&self) -> bool {
        *self == Wrap::Word
    }
}

fn yes() -> bool {
    true
}

fn is_true(value: &bool) -> bool {
    *value
}

fn is_zero_u16(value: &u16) -> bool {
    *value == 0
}

fn is_no_padding(value: &(u16, u16)) -> bool {
    *value == (0, 0)
}

/// What a slot passes to the claims that render in it. A path fills what it has.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct SlotInput {
    /// `prompt.footer*`, `session.composer.top` and `sidebar.*`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// `prompt.footer*`: the prompt's mode and whether its details show.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<PromptInput>,
    /// The width in cells a frame laid out a claim of [`Setup::sized`] at, the last time it changed; 0 before its
    /// first layout, so also as it mounts, and for any other claim. When it changes, the claim renders again with
    /// [`Changed::size`] in the same frame, so that frame shows what it renders for the size; it does not mount again.
    /// A claim whose node changes its size with each render renders at most twice a frame, then again after it. A
    /// hidden claim ([`Render::Hide`]) has no size, as in TS a claim that renders nothing has no box: one that follows
    /// the width while showing nothing returns an empty [`Node::column`]. A [`Changed::size`] for a terminal resize
    /// may come before the layout, with the old width. A route has the terminal's size in [`Info::size`].
    #[serde(default, skip_serializing_if = "is_zero_u16")]
    pub width: u16,
    /// The claim's height in rows, as `width`.
    #[serde(default, skip_serializing_if = "is_zero_u16")]
    pub height: u16,
}

/// What the prompt passes to the claims of `prompt.footer*`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct PromptInput {
    /// The prompt is in shell mode.
    pub shell: bool,
    /// The footer has room for its details: the usage and the shortcuts.
    pub show_details: bool,
}

/// What changed since a claim last rendered. A claim that has not rendered yet gets `all`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Changed {
    /// Anything may have changed.
    #[serde(default, skip_serializing_if = "is_false")]
    pub all: bool,
    /// Sessions whose info, status or running background jobs changed.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sessions: Vec<String>,
    /// Sessions whose message list changed: a message came or went, or the list was read again or paged. Such a
    /// change names no message.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lists: Vec<String>,
    /// Messages that changed in place, as session and message IDs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub messages: Vec<(String, String)>,
    /// Locations whose info or catalogs changed.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub locations: Vec<LocationRef>,
    /// The host's own state changed: the selected model, the usage limits, the settings, the plugins' storage, and
    /// the session tabs, the pending keys and the themes.
    #[serde(default, skip_serializing_if = "is_false")]
    pub local: bool,
    /// The terminal changed size, or the claim did: [`SlotInput::width`] and [`SlotInput::height`].
    #[serde(default, skip_serializing_if = "is_false")]
    pub size: bool,
    /// The plugin woke the host.
    #[serde(default, skip_serializing_if = "is_false")]
    pub woken: bool,
}

impl Changed {
    pub fn everything() -> Self {
        Self { all: true, ..Self::default() }
    }

    /// Whether session `id`'s info or status may have changed.
    pub fn session(&self, id: &str) -> bool {
        self.all || self.sessions.iter().any(|session| session == id)
    }

    /// Whether session `id`'s message list may have changed.
    pub fn list(&self, id: &str) -> bool {
        self.all || self.lists.iter().any(|session| session == id)
    }

    /// Whether `location`'s info or catalogs may have changed.
    pub fn location(&self, location: &LocationRef) -> bool {
        self.all || self.locations.contains(location)
    }
}

/// A location: a directory, and a workspace in it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct LocationRef {
    pub directory: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum SessionStatus {
    #[default]
    Idle,
    Running,
}

/// A session, from [`Read::session`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Session {
    pub info: SessionInfo,
    pub status: SessionStatus,
}

/// A session's family, from [`Read::family`]: its root and every known descendant.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Family {
    pub members: Vec<Member>,
    /// A child's own cost, or a root's cost with every known descendant's.
    pub cost: f64,
    /// The shells the session runs, in any location. Claims render again with the locations in
    /// [`Changed::locations`] when they change.
    #[serde(default, skip_serializing_if = "is_zero_usize")]
    pub shells: usize,
    /// The Code Mode scripts the session itself runs in the background. Claims render again with the sessions in
    /// [`Changed::sessions`] when they change.
    #[serde(default, skip_serializing_if = "is_zero_usize")]
    pub scripts: usize,
}

/// The host, from [`Read::info`].
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Info {
    pub version: String,
    /// The terminal's columns and rows.
    pub size: (u16, u16),
    /// Where the TUI works: the location a catalog read of `None` reads.
    pub location: LocationRef,
    /// The TUI plugins and the server plugins that failed. Claims render again with [`Changed::local`] when it changes.
    #[serde(default, skip_serializing_if = "is_zero_usize")]
    pub failed_plugins: usize,
    /// The user's locale as a BCP 47 tag, such as `en-US`, from `LC_ALL`, `LC_MESSAGES` or `LANG`; when none names one
    /// (unset, `C` or `POSIX`), Windows' user default locale, and elsewhere `None`. The host formats nothing by it: a
    /// plugin picks its own strings.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
}

/// A text as the host's text layout counts it, from [`Read::measure`]: the cells it takes in a row, and its graphemes
/// (what a user sees as one character, such as an emoji joined of several).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Measure {
    pub cells: u32,
    pub graphemes: u32,
}

fn is_zero_usize(value: &usize) -> bool {
    *value == 0
}

/// A TUI plugin as the host lists it, from [`Read::plugins`]: a built-in, a plugin of the `plugins` config or
/// directories, or one of those that did not load. Only the host enables or disables one, on the user's pick of a
/// [`SelectOption::toggle`] row. What failed is not in it: an error may hold paths, data or a secret of another
/// plugin, so only the host shows it, to the user ([`ErrorDetails::plugin`]).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct PluginEntry {
    /// The host's name for this entry and no other, which a [`SelectOption::toggle`] names: a held build may share its
    /// ID with a loaded plugin.
    pub key: String,
    /// The plugin's ID; the configured target of one that never loaded.
    pub id: String,
    /// Where it comes from: its `plugins` target or path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    pub origin: PluginOrigin,
    pub status: PluginStatus,
    /// It has an activation, failed or not (TS `registered().active`): a toggle disables it.
    #[serde(default, skip_serializing_if = "is_false")]
    pub active: bool,
    /// What its calls cost, while it is slow.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slow: Option<String>,
}

/// Where a [`PluginEntry`] comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum PluginOrigin {
    Builtin,
    /// Added by the host after the built-ins, such as a test plugin.
    Added,
    /// A `plugins` entry or a found directory that did not load: there is no plugin to enable.
    Configured,
    /// Loaded from a build.
    External,
}

/// What a [`PluginEntry`] is doing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum PluginStatus {
    Active,
    Inactive,
    /// Configured and not loaded; the host's error view says why.
    Skipped,
    /// It failed to load or while it ran; the host's error view says how.
    Failed,
    /// Found in a project and waiting for the user's approval; a toggle asks.
    Pending,
    /// Found in a project, and the user declined this build; a toggle asks again.
    Declined,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Member {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub status: SessionStatus,
    /// When it last changed, in milliseconds since the epoch.
    pub updated: f64,
    /// The background jobs running in its tree, among the jobs of the session the family was read for. A subagent
    /// that is idle but owns running jobs still has work running.
    #[serde(default, skip_serializing_if = "is_zero_usize")]
    pub jobs: usize,
}

/// From the host to the plugin. Results: `RenderFence` → [`Fenced`], `Render` and `RenderRoute` → [`Render`], `View`
/// → [`ViewReply`], `Claim` → [`claim::Reply`], `Draw` → the list's bytes, `Layout` → [`v2::LayoutReply`], `Input` →
/// [`interact::Handled`], `Search` → the values of the options, everything else `null`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Request {
    Command {
        name: String,
        input: Option<String>,
    },
    /// Renders a fence through [`Setup::code_block`].
    RenderFence(RenderFence),
    /// Renders a slot claim of [`Setup::slot`], which [`Manifest::slots`] names by index.
    Render {
        claim: usize,
        input: SlotInput,
        changed: Changed,
    },
    /// Runs a handler of [`Setup::on_event`], which [`Manifest::events`] names by index, with one of its
    /// events.
    Event {
        handler: usize,
        event: Box<V2Event>,
    },
    /// Renders a route of [`Setup::route`].
    RenderRoute {
        name: String,
        changed: Changed,
    },
    /// The reply to a [`Host::try_fetch`] or a [`Host::try_foreground`], for the [`Setup::on_reply`] handlers: the JSON body, or the error.
    Reply {
        id: RequestId,
        result: Result<serde_json::Value, String>,
    },
    /// Runs the [`Setup::on_mount`] handlers of the slot claim [`Manifest::slots`] names by index: `mounted` as the
    /// host mounts the claim with `input`, before it first renders, and not as it unmounts it.
    Mount {
        claim: usize,
        input: SlotInput,
        mounted: bool,
    },
    /// Runs the [`Setup::on_wake`] handlers after the plugin woke the host, before its claims render again.
    Wake,
    /// Runs the [`Setup::on_route_mount`] handlers of route `name`, which [`Manifest::route_mounts`] lists:
    /// `mounted` as the host mounts the route, before it first renders, and not as it unmounts it.
    RouteMount {
        name: String,
        mounted: bool,
    },
    /// Runs the [`Setup::on_fence_gone`] handlers with a [`Fence::key`] the host no longer shows. The host sends
    /// it only when [`Manifest::fence_gone`] is set.
    FenceGone {
        key: u64,
    },
    /// Runs the [`Setup::on_cancelled`] handlers: the host cancelled request `id`, as the mount that owned it closed
    /// ([`Host::try_fetch`]), and no reply comes for it. It comes at most once, and never after the request's reply.
    /// The host sends it only when [`Manifest::cancelled`] is set.
    Cancelled {
        id: RequestId,
    },
    /// Runs the [`Setup::on_deltas`] handlers with the streaming deltas that arrived since the last time, oldest
    /// first. The host sends it only when [`Manifest::deltas`] is set.
    Deltas {
        events: Vec<V2Event>,
    },
    /// Runs the view of the surface [`Manifest::surfaces`] names by index, for `mount`, with `input`. The content it
    /// gives the host is numbered after `next`. Result: [`ViewReply`].
    View {
        surface: usize,
        mount: v2::MountId,
        input: v2::SurfaceInput,
        next: u64,
    },
    /// Runs the draw of the surface [`Manifest::surfaces`] names by index, for canvas `canvas` of `mount` at `frame`
    /// ([`v2::Draw`]). Its result is not JSON: it is the list's bytes ([`canvas`]), or none to keep the list the host
    /// holds.
    Draw {
        surface: usize,
        mount: v2::MountId,
        canvas: String,
        frame: v2::Frame,
    },
    /// Runs the view of the claim [`Manifest::claims`] names by index on `part`, for the part's `mount`, with `input`.
    /// The content it gives the host is numbered after `next`. Result: [`claim::Reply`].
    Claim {
        claim: usize,
        mount: v2::MountId,
        input: v2::SurfaceInput,
        part: claim::Part,
        next: u64,
    },
    /// `mount` (a surface's or a claimed part's) ended; the plugin drops what it kept for it, such as its [`v2::Memo`]
    /// table.
    Unmount {
        mount: v2::MountId,
    },
    /// Runs the [`Setup::messages`] handler with a message a thread sent, in the order the mailbox holds them. The
    /// message's JSON text, as its sender wrote it.
    Message {
        message: String,
    },
    /// Runs the `layout` of the surface [`Manifest::surfaces`] names by index, after the solve, with what it named.
    /// Result: [`v2::LayoutReply`].
    Layout {
        surface: usize,
        geometry: v2::Geometry,
    },
    /// Calls the handler `to` names with `event`. Result: [`interact::Handled`].
    Input {
        to: InputTo,
        event: interact::Event,
    },
    /// Runs the search `name` of [`Setup::search`] with `query` and the select's enabled `options`. Result: the values
    /// of the options to list, in order.
    Search {
        name: String,
        query: String,
        options: Vec<SelectOption>,
    },
    /// Runs the [`Setup::on_plugins`] handlers after the plugins the host lists changed.
    Plugins,
}

/// Whose handler a [`Request::Input`] calls: a surface's, which [`Manifest::surfaces`] names by index, for the mount
/// the host routed the event to, or a layer's of [`Setup::layer`], which [`Manifest::layers`] names by index.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum InputTo {
    /// A surface's handler, for the mount the event is for, which [`Read::mount`] names to the handler; none for
    /// [`interact::Event::Mount`], which the plugin hears rather than the mount, and which names its mount.
    #[cfg_attr(not(feature = "host"), non_exhaustive)]
    Surface {
        surface: usize,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mount: Option<v2::MountId>,
    },
    #[cfg_attr(not(feature = "host"), non_exhaustive)]
    Layer { layer: usize },
}

/// What [`Request::View`] returns: the tree, the content the view gave the host with its handles, and how many values
/// the mount's [`v2::Memo`] table holds after the view.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct ViewReply {
    pub node: v2::Node,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<(v2::ContentRef, Blob)>,
    /// The handles the view released ([`v2::View::release`]), after the content it gave.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub released: Vec<v2::ContentRef>,
    #[serde(default, skip_serializing_if = "is_zero_usize")]
    pub memo: usize,
}

/// Content bytes on the wire, whole: a JSON string when they are UTF-8, else `{"base64": "..."}` (standard alphabet,
/// padded), so an image or any other bytes cross unchanged.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Blob(pub Vec<u8>);

impl Serialize for Blob {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match std::str::from_utf8(&self.0) {
            Ok(text) => serializer.serialize_str(text),
            Err(_) => {
                use serde::ser::SerializeMap;
                let mut map = serializer.serialize_map(Some(1))?;
                map.serialize_entry("base64", &base64::encode(&self.0))?;
                map.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for Blob {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Wire {
            Text(String),
            Bytes { base64: String },
        }
        match Wire::deserialize(deserializer)? {
            Wire::Text(text) => Ok(Blob(text.into_bytes())),
            Wire::Bytes { base64 } => {
                base64::decode(&base64).map(Blob).ok_or_else(|| serde::de::Error::custom("bad base64"))
            }
        }
    }
}

/// Base64 of RFC 4648, with padding: what [`Blob`] needs, and no dependency. A plugin reads [`Fetch::bytes`] replies and
/// writes [`Image::data`] with it.
pub mod base64 {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    /// The sextet of each byte, or [`NONE`] for a byte not in [`ALPHABET`]: a lookup a character, as an image of
    /// megabytes crosses this way.
    const SEXTETS: [u8; 256] = {
        let mut sextets = [NONE; 256];
        let mut index = 0;
        while index < 64 {
            sextets[ALPHABET[index] as usize] = index as u8;
            index += 1;
        }
        sextets
    };
    const NONE: u8 = 0xff;

    pub fn encode(bytes: &[u8]) -> String {
        let mut out = Vec::with_capacity(bytes.len().div_ceil(3) * 4);
        let sextets = |word: u32| [18, 12, 6, 0].map(|shift| ALPHABET[(word >> shift & 63) as usize]);
        let (chunks, rest) = bytes.as_chunks::<3>();
        for [a, b, c] in chunks {
            out.extend_from_slice(&sextets(u32::from(*a) << 16 | u32::from(*b) << 8 | u32::from(*c)));
        }
        if !rest.is_empty() {
            let word =
                rest.iter().enumerate().fold(0u32, |word, (index, byte)| word | u32::from(*byte) << (16 - 8 * index));
            let mut last = sextets(word);
            last[rest.len() + 1..].fill(b'=');
            out.extend_from_slice(&last);
        }
        String::from_utf8(out).expect("the alphabet is ASCII")
    }

    pub fn decode(text: &str) -> Option<Vec<u8>> {
        let text = text.as_bytes();
        if !text.len().is_multiple_of(4) {
            return None;
        }
        let mut out = Vec::with_capacity(text.len() / 4 * 3);
        // Padding may end only the last group; in another one `=` is a byte out of the alphabet.
        let (body, last) = text.split_at(text.len().saturating_sub(4));
        for chunk in body.as_chunks::<4>().0 {
            let [a, b, c, d] = chunk.map(|byte| SEXTETS[usize::from(byte)]);
            // A sextet is under 64; only [`NONE`] has the high bit.
            if (a | b | c | d) & 0x80 != 0 {
                return None;
            }
            let word = u32::from(a) << 18 | u32::from(b) << 12 | u32::from(c) << 6 | u32::from(d);
            out.extend_from_slice(&word.to_be_bytes()[1..]);
        }
        let padding = last.iter().rev().take_while(|byte| **byte == b'=').count();
        if padding > 2 {
            return None;
        }
        let mut word = 0u32;
        for (index, byte) in last[..last.len() - padding].iter().enumerate() {
            let sextet = SEXTETS[usize::from(*byte)];
            if sextet == NONE {
                return None;
            }
            word |= u32::from(sextet) << (18 - 6 * index);
        }
        if !last.is_empty() {
            out.extend_from_slice(&word.to_be_bytes()[1..4 - padding]);
        }
        Some(out)
    }
}

/// The width and height in pixels the header of a PNG, GIF, JPEG or WebP image names, as the host reads it before it
/// decodes a [`v2::Node::Image`]; `None` for other bytes, and for a header that names no pixels. It reads only the
/// header: [`Read::image_size`] is what the host decodes.
pub fn image_size(bytes: &[u8]) -> Option<(u32, u32)> {
    header_size(bytes).filter(|&(width, height)| width > 0 && height > 0)
}

fn header_size(bytes: &[u8]) -> Option<(u32, u32)> {
    let at = |from: usize, len: usize| bytes.get(from..from + len);
    let be = |from: usize, len: usize| Some(at(from, len)?.iter().fold(0u32, |n, byte| n << 8 | u32::from(*byte)));
    let le =
        |from: usize, len: usize| Some(at(from, len)?.iter().rev().fold(0u32, |n, byte| n << 8 | u32::from(*byte)));
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some((be(16, 4)?, be(20, 4)?));
    }
    if bytes.starts_with(b"GIF8") {
        return Some((le(6, 2)?, le(8, 2)?));
    }
    if bytes.starts_with(b"RIFF") && at(8, 4) == Some(b"WEBP") {
        return match at(12, 4)? {
            b"VP8 " => Some((le(26, 2)? & 0x3fff, le(28, 2)? & 0x3fff)),
            b"VP8L" => {
                let bits = le(21, 4)?;
                Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
            }
            b"VP8X" => Some((le(24, 3)? + 1, le(27, 3)? + 1)),
            _ => None,
        };
    }
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    // JPEG: the segments up to the first start of frame, which holds the size. A marker may follow fill bytes of 0xff
    // (ITU-T T.81 B.1.1.2), and the standalone markers (TEM, RST0 to RST7) have no length.
    let mut from = 2;
    loop {
        if *bytes.get(from)? != 0xff {
            return None;
        }
        while *bytes.get(from + 1)? == 0xff {
            from += 1;
        }
        let marker = *bytes.get(from + 1)?;
        if (0xc0..=0xcf).contains(&marker) && ![0xc4, 0xc8, 0xcc].contains(&marker) {
            return Some((be(from + 7, 2)?, be(from + 5, 2)?));
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            from += 2;
            continue;
        }
        // A length covers itself, so one under 2 names no segment; a start or an end of the image before a frame is
        // no image.
        let len = be(from + 2, 2)? as usize;
        if len < 2 || marker == 0xd8 || marker == 0xd9 {
            return None;
        }
        from += 2 + len;
    }
}

/// A fence for the render of [`Setup::code_block`] that [`Manifest::fences`] names by `index`. The host matches a fence
/// to its render by the language it registered, which [`Fence::language`] may not be: the host normalizes a language
/// (`ts` becomes `typescript`), so the plugin finds its render by `index`. A host that sends no `index` matches by
/// language.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct RenderFence {
    #[serde(flatten)]
    pub fence: Fence,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<usize>,
}

/// From the plugin to the host. Results: `StorageGet` → `Option<String>` (JSON text), `Color` → `Option<Rgba>`, the
/// reads what the [`Read`] method of the same name returns, everything else `null`.
/// A host that does not know a request answers it with an error.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum HostRequest {
    Log {
        level: Level,
        message: String,
    },
    /// A toast ([`Host::toast`]).
    Toast {
        variant: Variant,
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session: Option<String>,
    },
    StorageGet {
        key: String,
    },
    /// `value` is JSON text: an object or an array.
    StorageSet {
        key: String,
        value: String,
    },
    OpenRoute {
        name: String,
    },
    /// Declares a storage key during setup, so setup itself may read and write it. The [`Manifest`] still lists
    /// every key; a host that does not know this request learns them from it.
    StorageKey {
        key: String,
    },
    /// [`Read::color`].
    Color {
        token: String,
    },
    /// [`Read::session`].
    Session {
        id: String,
    },
    /// [`Read::family`].
    Family {
        id: String,
    },
    /// [`Read::messages`], as a list.
    Messages {
        id: String,
    },
    /// [`Read::message`], one message or null.
    Message {
        session: String,
        message: String,
    },
    /// [`Read::models`].
    Models {
        location: Option<LocationRef>,
    },
    /// [`Read::model`].
    Model,
    /// [`Read::limits`].
    Limits,
    /// [`Read::providers`].
    Providers {
        location: Option<LocationRef>,
    },
    /// [`Read::info`].
    Info,
    /// [`Read::mcp_servers`].
    McpServers {
        location: Option<LocationRef>,
    },
    /// [`Read::integrations`].
    Integrations {
        location: Option<LocationRef>,
    },
    /// [`Read::vcs`].
    Vcs {
        location: Option<LocationRef>,
    },
    /// [`Read::route`].
    Route,
    /// [`Host::dispatch`], once the current call returns.
    Dispatch {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        input: Option<String>,
    },
    /// [`Host::attention`], once the current call returns.
    Attention(Attention),
    /// [`Host::navigate`], once the current call returns.
    Navigate {
        route: Route,
    },
    /// [`Host::try_fetch`], sent once the current call returns; answers the [`RequestId`].
    Fetch(Fetch),
    /// [`Host::dialog`], once the current call returns.
    Dialog {
        /// Boxed: a select is the largest request.
        dialog: Box<Dialog>,
    },
    /// [`Host::copy`], once the current call returns.
    Copy {
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        then: Option<Action>,
    },
    /// [`Read::interactive`].
    Interactive,
    /// [`Read::shortcut`].
    Shortcut {
        name: String,
    },
    /// [`Read::dialog_open`].
    DialogOpen {
        key: String,
    },
    /// [`Host::storage_merge`], which the host sets in the latest stored object under the storage lock. A plugin
    /// whose host does not know it sends [`HostRequest::StorageSet`] instead.
    StorageMerge {
        key: String,
        fields: serde_json::Map<String, serde_json::Value>,
    },
    /// [`Read::composer`].
    Composer,
    /// [`Host::edit_composer`], once the current call returns.
    ComposerEdit {
        edit: ComposerEdit,
    },
    /// Marks what the current call asked for so far; answers the mark, a number. The SDK sends it before each
    /// dispose callback.
    Checkpoint,
    /// Drops what the current call asked for after `mark`, and puts back the storage it wrote since: the SDK sends
    /// it when a dispose callback panicked.
    Rollback {
        mark: u64,
    },
    /// [`Read::variants`].
    Variants,
    /// [`Host::set_variant`]; answers whether it will.
    SetVariant {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        variant: Option<String>,
    },
    /// [`Host::set_model`], once the current call returns.
    SetModel {
        provider: String,
        model: String,
    },
    /// [`Read::tabs_enabled`].
    TabsEnabled,
    /// [`Read::tabs`].
    Tabs,
    /// [`Host::edit_tab`]; answers whether it will.
    Tab {
        edit: TabEdit,
    },
    /// [`Read::keymap_pending`].
    KeymapPending,
    /// [`Read::keymap_active`].
    KeymapActive,
    /// [`Read::keymap_commands`].
    KeymapCommands,
    /// [`Read::shortcuts`].
    Shortcuts {
        name: String,
    },
    /// [`Read::selection`].
    Selection,
    /// [`Host::clear_selection`], once the current call returns.
    ClearSelection,
    /// [`Host::try_foreground`], once the current call returns; answers the [`RequestId`].
    Foreground(Foreground),
    /// [`Host::try_timer`]: answers the [`RequestId`] whose reply, `null`, comes once `ms` milliseconds passed.
    Timer {
        ms: u64,
    },
    /// [`Host::cancel_timer`], once the effects asked for before it apply.
    CancelTimer {
        id: RequestId,
    },
    /// [`Host::owner`]: answers the number.
    Owner,
    /// [`Host::set_owner`].
    SetOwner {
        owner: Option<u64>,
    },
    /// [`Host::set_title`], once the current call returns.
    Title {
        title: String,
    },
    /// [`Read::theme`].
    Theme,
    /// [`Read::themes`].
    Themes,
    /// [`Read::plugins`].
    Plugins,
    /// [`Read::setting`].
    Setting {
        name: String,
    },
    /// [`Read::image_size`] of the bytes, in base64 ([`base64::encode`]).
    ImageSize {
        bytes: String,
    },
    /// 2.0, of a host with [`IMAGE_BOUNDS`]: the bounds of the images it decodes, an [`ImageBounds`].
    ImageBounds,
    /// [`Read::utc_offset`] at `at`, in milliseconds since the epoch.
    UtcOffset {
        at: i64,
    },
    /// [`Read::measure`] of `text`.
    Measure {
        text: String,
    },
    /// [`Host::set_setting`], once the current call returns.
    SetSetting {
        name: String,
        value: serde_json::Value,
    },
    /// [`Host::set_theme`]; answers whether it will.
    SetTheme {
        name: String,
    },
    /// [`Host::install_theme`], once the current call returns.
    InstallTheme {
        name: String,
        theme: serde_json::Value,
    },
    /// [`Host::scroll`], once the current call returns.
    Scroll {
        target: v2::Target,
        verb: v2::Scroll,
    },
    /// [`Read::scroll_state`].
    ScrollState {
        target: v2::Target,
    },
    /// [`Read::anchors`].
    Anchors {
        target: v2::Target,
        group: String,
    },
    /// [`Read::top_anchor`].
    TopAnchor {
        target: v2::Target,
        group: String,
        #[serde(default)]
        inset: u16,
    },
    /// [`Read::transcript`].
    Transcript,
    /// [`Host::open_panel`], once the current call returns.
    OpenPanel(interact::OpenPanel),
    /// [`Host::close_panel`], once the current call returns.
    ClosePanel {
        surface: String,
    },
    /// [`Host::overlay`], once the current call returns, for the mount whose handler runs.
    Overlay(interact::Overlay),
    /// [`Host::close_overlay`], once the current call returns.
    CloseOverlay {
        surface: String,
    },
    /// [`Host::set_enabled`], once the current call returns.
    SetEnabled {
        name: String,
        enabled: bool,
    },
    /// [`Host::focus`], once the current call returns; of a field too, on a host with [`FOCUS_INPUT`].
    Focus {
        node: String,
    },
    /// [`Host::blur`], once the current call returns.
    Blur,
    /// [`Host::set_mode`], once the current call returns.
    SetMode {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mode: Option<String>,
    },
    /// [`Host::release_keys`], once the current call returns.
    ReleaseKeys,
    /// [`Read::rect`].
    Rect {
        node: String,
    },
    /// [`Read::focused`].
    Focused,
    /// [`Read::mode`].
    InputMode,
    /// [`Read::sessions`].
    Sessions,
    /// [`Read::pending`].
    Pending {
        id: String,
    },
}

/// The composer on screen, from [`Read::composer`].
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Composer {
    /// The text as the composer shows it: a compact paste is its label, such as `[Pasted ~3 lines]`.
    pub text: String,
    /// The cursor, as a byte offset into `text`.
    pub cursor: usize,
    /// The composer has the keyboard focus.
    pub focused: bool,
}

/// An edit of the composer, for [`Host::edit_composer`]. It goes through the composer's own edit path, as typed
/// input and the TS composer's `ref` do.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum ComposerEdit {
    /// Replaces the text and its attachments, and puts the cursor at the end. The mode stays.
    Set { text: String },
    /// Inserts `text` at the cursor, in place of a selection, as typing it does.
    Insert { text: String },
    /// Submits the composer as enter does, whether or not it has focus; nothing while it may not submit (a home form,
    /// another pane with the input), as TS's `submit` refuses a disabled prompt.
    Submit,
}

/// A session tab, from [`Read::tabs`] (TS `ui.tabs.list()`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Tab {
    /// The root session the tab shows.
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The tab is the one on screen.
    #[serde(default, skip_serializing_if = "is_false")]
    pub active: bool,
    /// The session runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub busy: bool,
    /// A permission or a question waits on the user.
    #[serde(default, skip_serializing_if = "is_false")]
    pub attention: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unread: Option<Unread>,
}

/// What a [`Tab`] has that the user has not seen.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Unread {
    Activity,
    Error,
}

/// A change of the session tabs, for [`Host::edit_tab`] (TS `ui.tabs.open`, `focus`, `move` and `close`). A
/// session is named by any session of its family, a tab being its root's, except in `Close`, which takes the tab's
/// own ID as TS does. Each answer counts the edits the same call made before it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum TabEdit {
    /// Opens a tab for the session without showing it. `false` while tabs are off.
    Open { session: String },
    /// Opens a tab when needed and shows it. `false` while tabs are off.
    Focus { session: String },
    /// Moves an open tab to `index`. `false` while tabs are off or it is not open.
    Move { session: String, index: usize },
    /// Closes the open tab with ID `session` (a child's ID matches none), or the one on screen without a session.
    /// `false` while tabs are off or no tab matched.
    Close {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session: Option<String>,
    },
}

/// One stroke of the pending key sequence, from [`Read::keymap_pending`] (TS `keymap.pending()`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct KeymapPending {
    /// As the host shows keys, such as `ctrl+x`.
    pub key: String,
    /// The token the stroke matched, such as `leader`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

/// A key that does something now, from [`Read::keymap_active`] (TS `keymap.active()`): at the root, or one that
/// continues the pending sequence.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct KeymapActive {
    pub key: String,
    /// The title of the command it runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    /// More keys follow before something runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub continues: bool,
}

/// A command that can be reached now, from [`Read::keymap_commands`] (TS `keymap.commands()`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct KeymapCommand {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    pub enabled: bool,
    /// It is in the command palette.
    #[serde(default, skip_serializing_if = "is_false")]
    pub palette: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slash: Option<KeymapSlash>,
    /// The palette promotes it.
    #[serde(default, skip_serializing_if = "is_false")]
    pub suggested: bool,
}

/// The slash command of a [`KeymapCommand`].
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct KeymapSlash {
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    /// `/name` keeps its text after the name and passes it as the input.
    #[serde(default, skip_serializing_if = "is_false")]
    pub arguments: bool,
}

/// A program to run in the foreground, for [`Host::try_foreground`] (TS `renderer.suspend()`, then the program, then
/// `renderer.resume()`): the host gives it the terminal and waits, as it does for `$EDITOR`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Foreground {
    /// The program, found on `PATH` when it has no directory.
    pub command: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    /// Where it runs; without one, where the TUI works when that is a directory here, else the host's own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

/// A toast's kind, which sets its color.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Variant {
    Info,
    Success,
    Warning,
    Error,
}

/// A toast, for [`Host::toast`]. With a `session`, the toast offers to open that session unless the session's
/// family is on screen.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Toast {
    pub variant: Variant,
    pub title: Option<String>,
    pub message: String,
    pub session: Option<String>,
}

/// A request for the user's attention, for [`Host::attention`]: a desktop notification through the terminal, a
/// sound, or both, each when the user's `attention` settings allow it and its focus rule holds.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Attention {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub message: String,
    /// When to send a notification; none without.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify: Option<When>,
    /// Which sound to play, and when; none without.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sound: Option<Sound>,
}

/// When a notification or sound goes out, by the terminal's focus.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum When {
    Always,
    Focused,
    Blurred,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Sound {
    pub name: SoundName,
    pub when: When,
    /// Overrides the user's `attention.volume`, from 0 to 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<f64>,
}

/// The sounds of the user's `attention.sounds`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum SoundName {
    Default,
    Question,
    Permission,
    Error,
    Done,
    SubagentDone,
}

/// What the host shows, from [`Read::route`].
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Route {
    #[default]
    Home,
    Session {
        id: String,
    },
    /// A plugin's route.
    Plugin {
        id: String,
        name: String,
    },
}

/// A request to the server, for [`Host::try_fetch`]: it goes through the host's own client, to the server the host talks
/// to now, with the host's credentials. A path that would leave that server's origin, such as
/// `/https://elsewhere/`, is refused before the credentials go on.
///
/// The reply is the JSON body of any 2xx status, or `null` without a body. An error is text: a declared server error's
/// message (else its tag), `UnexpectedStatus: <status>: <body>` for another error status (the body trimmed and cut at
/// 200 characters; without a body just `UnexpectedStatus: <status>`), `Transport: …` when the request could not be
/// sent or would leave the origin, `MalformedResponse: …` for a body that is not JSON, and `unsupported method …` or
/// `the path … does not start with /` for a request the host does not send.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Fetch {
    /// `GET`, `POST`, `PUT`, `PATCH` or `DELETE`.
    pub method: String,
    /// The path on the server, such as `/api/session/ses_1/generate`.
    pub path: String,
    /// Query pairs, already encoded the way the server reads them (`location[directory]`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub query: Vec<(String, String)>,
    /// A JSON body.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<serde_json::Value>,
    /// The reply is the body's bytes, whatever they are (a file the server reads), as a JSON string in base64
    /// ([`base64::decode`]).
    #[serde(default, skip_serializing_if = "is_false")]
    pub bytes: bool,
}

/// What [`Host::try_fetch`] returns, and [`Setup::on_reply`] gets back with the reply.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RequestId(pub u64);

/// A dialog, for [`Host::dialog`]. It replaces the dialogs that are open, unless it is a [`Panel`] whose key is open.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Dialog {
    Prompt(Prompt),
    Panel(Panel),
    /// Closes the plugin's [`Panel`] `key` if it is open. An empty `key` closes whichever dialog of the plugin
    /// shows.
    Close {
        key: String,
    },
    /// A list to pick from, with a filter. Enter or a click closes it and runs its `action` with the option's value as
    /// the input; escape closes it.
    Select(Select),
    /// A question with `Cancel` and `Confirm` buttons.
    Confirm(Confirm),
    /// A message with `ok`.
    Alert(Alert),
    /// An error's details, drawn by the host's own error view; `back` runs from its Back button and from escape.
    ErrorDetails(ErrorDetails),
    /// `dialog`, whose `dismissed` runs once as it closes, after its own action if that ran as it closed: so a plugin
    /// that waits for an answer hears of each close, also escape, the backdrop, another plugin's dialog that replaces
    /// it, or its unload (TS settles the dialog's promise in each case). One the host does not open, as while its own
    /// plugin list or approval shows, runs `dismissed` at once.
    Dismissable {
        dialog: Box<Dialog>,
        dismissed: Action,
    },
    /// Images in the host's image preview, starting at `index`.
    Images(Images),
    /// The plugin's dialog surface ([`v2::Place::Dialog`]) as the dialog's body.
    Surface(DialogSurface),
}

/// A [`Dialog::Surface`]: a new mount of the plugin's dialog surface `surface` in the host's dialog frame, under `key`
/// (the surface's name when unset), which [`Dialog::Close`] and [`Read::dialog_open`] name and the mount's
/// [`v2::MountId::key`] is. Shown again while that key is open, it changes the frame in place (its size, centering
/// and title) and keeps the mount; any other dialog replaces it. However it closes (escape, `ctrl+c`, the backdrop,
/// another dialog, the plugin's close, its unload) its mount ends, and the surface's handler hears
/// [`interact::Event::Closed`] as the plugin's call, not the mount's, unless the plugin is unloaded. `ctrl+c` first
/// empties a field of the mount that has the focus and text, as in the host's own dialogs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct DialogSurface {
    pub surface: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// The dialog's width; [`PanelSize::Medium`] when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<PanelSize>,
    /// In the middle of the screen, not a quarter of the way down.
    #[serde(default, skip_serializing_if = "is_false")]
    pub centered: bool,
    /// The header's title, with the host's close label: without it the view draws the whole dialog, as TS draws a
    /// plugin's own view.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

impl DialogSurface {
    /// The key the dialog shows under: [`DialogSurface::key`], else the surface's name.
    pub fn shown_key(&self) -> &str {
        self.key.as_deref().unwrap_or(&self.surface)
    }
}

/// A [`Dialog::Prompt`]: a one-line text field. Enter closes it and runs `action` with the text as its input; escape
/// closes it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Prompt {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    /// The text the field starts with, which the user edits, such as the title a rename changes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    /// A line above the field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub action: Action,
}

/// A [`Dialog::Images`].
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Images {
    pub images: Vec<Image>,
    #[serde(default, skip_serializing_if = "is_zero_usize")]
    pub index: usize,
}

/// An image of [`Images`]: its bytes in base64 ([`base64::encode`]), and the name the preview shows.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Image {
    pub data: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// A [`Dialog::ErrorDetails`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct ErrorDetails {
    pub title: String,
    pub error: String,
    /// Where the error came from, such as a file or a package.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Lines of context under the error, such as `Status: failed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub back: Option<Action>,
    /// The reference the user quotes to report it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// The plugin's name for the view, which [`Read::dialog_open`] answers for while it shows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// The [`PluginEntry::key`] of a TUI plugin whose error this is: the host shows that plugin's own error (or why it
    /// is skipped) in place of `error`, which no plugin reads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin: Option<String>,
}

/// A [`Dialog::Confirm`]. `Confirm` is active as it opens; the arrows and tab move between the buttons, and enter or a
/// click closes it and runs `action` with `true` for `Confirm` or `false` for `Cancel` as the input, as TS resolves
/// `true` or `false`. Escape cancels. When another dialog replaces it, nothing runs, as TS resolves `undefined`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Confirm {
    pub title: String,
    /// Muted text under the title.
    pub message: String,
    /// The buttons' labels, which the host shows in title case.
    #[serde(default, skip_serializing_if = "ConfirmLabel::is_default")]
    pub label: ConfirmLabel,
    pub action: Action,
    /// The dialog's width; [`PanelSize::Medium`] when unset (TS `dialog.set({ size })`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<PanelSize>,
    /// In the middle of the screen, not a quarter of the way down (TS `dialog.set({ centered })`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub centered: bool,
}

/// The labels of a [`Confirm`]'s buttons; `confirm` and `cancel` when unset.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct ConfirmLabel {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirm: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancel: Option<String>,
}

impl ConfirmLabel {
    fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

/// A [`Dialog::Alert`]. Enter, a click on `ok`, escape, and another dialog that replaces it all close it, and then
/// `action` runs, once, as TS resolves the alert's promise in each case.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Alert {
    pub title: String,
    /// Muted text under the title.
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<Action>,
    /// The dialog's width; [`PanelSize::Medium`] when unset (TS `dialog.set({ size })`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<PanelSize>,
    /// In the middle of the screen, not a quarter of the way down (TS `dialog.set({ centered })`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub centered: bool,
}

/// A [`Dialog::Select`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Select {
    pub title: String,
    /// The filter's placeholder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    pub options: Vec<SelectOption>,
    /// The value of the option that is marked and selected as the list opens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    /// What picking an option runs, with its value as the input.
    pub action: Action,
    /// The rich select. A select shown again while one of the plugin's with this key is open changes in place: its
    /// rows, footers and actions, with the filter and the selected row kept. Picking a row no longer closes it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// Actions on the selected row, in the footer with their keys; each runs with the row's value as its input.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<SelectAction>,
    /// Keys that run an action with the selected row's value as its input, or none without a row.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub binds: Vec<PanelBind>,
    /// The plugin's search of this name ([`Setup::search`]) lists the rows for the query instead of the host's filter,
    /// in its order and flat, as TS's `search` does; the host calls it as the query changes, and for the empty query
    /// as the select opens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    /// The dialog's width; [`PanelSize::Medium`] when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<PanelSize>,
    /// The value of the option selected as the list opens, without `current`'s mark.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focus: Option<String>,
    /// The host lists the rows as they are and filters none; it runs this with the filter's text as the input once the
    /// text has stayed `query_delay` milliseconds, so the plugin lists the rows for it, such as from the server (TS
    /// `skipFilter` with `onFilter`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<Action>,
    #[serde(default, skip_serializing_if = "is_zero_u16")]
    pub query_delay: u16,
    /// No filter field, and no filtering (TS `skipFilter` with `renderFilter={false}`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub filterless: bool,
    /// What shows while no row does, as the text of the plugin (TS `emptyView` and `noMatchView`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub empty: Option<Span>,
    /// A line under the rows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<Span>,
    /// In the middle of the screen, not a quarter of the way down (TS `dialog.set({ centered })`). A host that does
    /// not know it places the select as before.
    #[serde(default, skip_serializing_if = "is_false")]
    pub centered: bool,
}

impl Select {
    /// A select of `options` titled `title`, whose pick runs `action` with the option's value; the fields this crate
    /// adds later default, so a plugin built with this constructor needs no change for them.
    pub fn new(title: impl Into<String>, options: Vec<SelectOption>, action: Action) -> Self {
        Self {
            title: title.into(),
            placeholder: None,
            options,
            current: None,
            action,
            key: None,
            actions: Vec::new(),
            binds: Vec::new(),
            search: None,
            size: None,
            focus: None,
            query: None,
            query_delay: 0,
            filterless: false,
            empty: None,
            note: None,
            centered: false,
        }
    }
}

/// An option of a [`Select`].
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct SelectOption {
    pub title: String,
    pub value: String,
    /// Muted text after the title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Text at the right of the row.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer: Option<String>,
    /// The heading the option is listed under.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub disabled: bool,
    /// The footer's color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer_color: Option<Color>,
    /// A mark left of the title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gutter: Option<Gutter>,
    /// What picking this row runs, with its value as the input, instead of the select's action.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<Action>,
    /// Picking this row enables or disables a plugin, which the host does, and only the host. It names the entry by
    /// its [`PluginEntry::key`] (an ID still names a plugin of the registry): the host draws the `enable` or `disable`
    /// action from that entry's state, naming the plugin unless the row's title is its ID, refuses the caller's own
    /// plugin and the plugin manager, and runs it after the key, if the row still names that entry; for a held build,
    /// `enable` releases it. For a project plugin waiting for approval, the host asks the user to approve or decline
    /// the build it holds; once the question closes, it runs the row's `action`, if any, with the row's value, or
    /// shows the select again on that row.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub toggle: Option<String>,
    /// What the filter matches beside the title and the category.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_text: Option<String>,
}

/// A mark left of a [`SelectOption`]'s title.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Gutter {
    /// The host's spinner, in the row's color.
    Spinner,
    Span(Span),
}

/// An action of a [`Select`] on the selected row.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct SelectAction {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub action: Action,
    /// The values of the rows the action is hidden on; its key then goes on to the list.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hidden: Vec<String>,
    /// In the footer's first group, beside `enable`/`disable` (`Some(true)`), or its second; by default the first for
    /// an action on the selected row and the second for a rowless one, as TS's `group`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary: Option<bool>,
    /// Runs with no row and no value, so it shows and runs also while no row matches.
    #[serde(default, skip_serializing_if = "is_false")]
    pub rowless: bool,
    /// The name of the user's keybind for it, such as `dialog.plugins.check`: for a name the host's keybinds know, the
    /// config's keys alone run it (so the user's `none` turns it off), and `key` for any other name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// Shown dimmed, and its key does nothing.
    #[serde(default, skip_serializing_if = "is_false")]
    pub disabled: bool,
    /// Hidden on every row and with none, and its key goes on to the list; a select shown again with only this changed
    /// changes in place.
    #[serde(default, skip_serializing_if = "is_false")]
    pub hidden_all: bool,
}

/// A dialog that shows a node, live: a panel shown again while its `key` is open changes in place and keeps where its
/// body is scrolled. The host scrolls the body with the arrows, `j`/`k`, page up and down, home and end.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Panel {
    /// The plugin's own name for the panel; the host keeps keys of different plugins apart.
    pub key: String,
    #[serde(default)]
    pub size: PanelSize,
    /// The header's title, which keeps its width.
    pub title: Vec<Span>,
    /// Muted text after the title on the same row, cut to fit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    pub body: Node,
    /// The footer's actions, on the right; a click runs one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<PanelAction>,
    /// Keys that run an action while the panel is open.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub binds: Vec<PanelBind>,
    /// The body is on the raised background, edge to edge, at most 60% of the screen high.
    #[serde(default, skip_serializing_if = "is_false")]
    pub bleed: bool,
    /// The panel sits in the middle of the screen, rather than near its top as a dialog does.
    #[serde(default, skip_serializing_if = "is_false")]
    pub centered: bool,
    /// Only the dialog's frame around the body, as TS draws a plugin's own view (`ui.dialog.show`): no header, footer,
    /// inset or scroll, and the body lays itself out. The title, actions and keys go unused.
    #[serde(default, skip_serializing_if = "is_false")]
    pub bare: bool,
    /// The header's close label; `esc` when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub close: Option<String>,
    /// The body's rows, whatever it holds; it scrolls inside them. A panel of a set height without actions has no
    /// footer row (TS `DialogLayout` without a footer).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u16>,
    /// The body also stops where the screen ends under a dialog a quarter down it, and is at least 3 rows high
    /// (TS `GoalDialog`'s `maxHeight`); otherwise it is at most 60% of the screen and at least 8 rows.
    #[serde(default, skip_serializing_if = "is_false")]
    pub fit_screen: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum PanelSize {
    #[default]
    Medium,
    Large,
    /// The widest.
    #[serde(rename = "xlarge")]
    XLarge,
}

/// A footer action of a [`Panel`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct PanelAction {
    pub title: String,
    /// The key shown after the title; [`Panel::binds`] binds it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// The color of the title and the key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
    /// The panel closes before the action runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub close: bool,
    pub action: Action,
}

/// A key of a [`Panel`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct PanelBind {
    pub key: String,
    pub title: String,
    pub action: Action,
}

/// What a render reads from the host. It has no effects, so a render may call it at any time, also inside
/// [`Read::messages`]'s visitor; the host answers from what it has. A read of a catalog the host has not loaded
/// returns `None` and asks for the load, which the host starts once the plugin's callback has returned; the claim
/// then renders again with the location in [`Changed::locations`].
///
/// A host without a value answers `None` or empty.
///
/// A read is the UI thread's, as a [`Host`] is: a render cannot hand it to another thread.
///
/// ```compile_fail,E0277
/// # use opencode_plugin_abi::*;
/// fn render(read: &dyn Read) {
///     std::thread::scope(|threads| {
///         threads.spawn(|| read.tabs());
///     });
/// }
/// ```
pub trait Read {
    /// Whether the page theme is dark or light.
    fn theme_mode(&self) -> ThemeMode;
    /// A color of the page theme: a token path such as `text.muted`, or a scale step such as `categorical.3.300`
    /// or `interactive.500`. `None` when the theme has no such color.
    fn color(&self, token: &str) -> Option<Rgba>;
    /// Session `id` and whether it runs, when the host knows it.
    fn session(&self, _id: &str) -> Option<Session> {
        None
    }
    /// The family of session `id`.
    fn family(&self, _id: &str) -> Family {
        Family::default()
    }
    /// Every session the host has loaded, most recently updated first, and whether each runs (TS
    /// `data.session.list()`).
    fn sessions(&self) -> Vec<Session> {
        Vec::new()
    }
    /// The inbox items of session `id` the server has not delivered yet, in the order they were admitted (TS
    /// `data.session.pending.list()`); empty when its inbox is not loaded.
    fn pending(&self, _id: &str) -> Vec<types::SessionInboxInfo> {
        Vec::new()
    }
    /// Calls `visit` with the loaded messages of session `id`, oldest first; empty when none are loaded. In process
    /// the host lends its own list.
    fn messages(&self, _id: &str, visit: &mut dyn FnMut(&[SessionMessageInfo])) {
        visit(&[]);
    }
    /// Calls `visit` with loaded message `message` of session `session`, or `None`: a view that hears a change in
    /// place of one message reads what changed, not the session.
    fn message(&self, session: &str, message: &str, visit: &mut dyn FnMut(Option<&SessionMessageInfo>)) {
        self.messages(session, &mut |messages| visit(messages.iter().find(|item| item.id() == message)));
    }
    /// The models of `location`, or of the location the TUI works in for `None`; `None` while they are not loaded.
    fn models(&self, _location: Option<&LocationRef>) -> Option<std::sync::Arc<[ModelInfo]>> {
        None
    }
    /// The model the next prompt uses.
    fn model(&self) -> Option<ModelRef> {
        None
    }
    /// What the OpenCode Console workspace's limits allow, where the TUI works; `None` while they are not loaded or
    /// it is not signed in.
    fn limits(&self) -> Option<UsageLimitsInfo> {
        None
    }
    /// The providers of `location`, or of the location the TUI works in for `None`; `None` while they are not loaded.
    fn providers(&self, _location: Option<&LocationRef>) -> Option<std::sync::Arc<[ProviderInfo]>> {
        None
    }
    /// The value stored under one of the plugin's declared storage keys ([`Setup::storage_key`]). It shows a
    /// [`Host::storage_set`] at once, before the host has written it to disk.
    fn storage_get(&self, _key: &str) -> Option<serde_json::Value> {
        None
    }
    /// The host's version, the terminal's size, and where the TUI works.
    fn info(&self) -> Info {
        Info::default()
    }
    /// The MCP servers of `location` (where the TUI works for `None`); `None` while they are not loaded.
    fn mcp_servers(&self, _location: Option<&LocationRef>) -> Option<std::sync::Arc<[McpServer]>> {
        None
    }
    /// The integrations of `location` (where the TUI works for `None`); `None` while they are not loaded.
    fn integrations(&self, _location: Option<&LocationRef>) -> Option<std::sync::Arc<[IntegrationInfo]>> {
        None
    }
    /// The version control state of `location` (where the TUI works for `None`); `None` while it is not loaded.
    fn vcs(&self, _location: Option<&LocationRef>) -> Option<VcsInfo> {
        None
    }
    /// What the host shows.
    fn route(&self) -> Route {
        Route::Home
    }
    /// Whether the session pane owns the input: no side pane has it and no panel is full screen. Claims render again
    /// with [`Changed::all`] when it changes; a claim stays mounted.
    fn interactive(&self) -> bool {
        true
    }
    /// The first key of command `name`, as the host shows keys, such as `ctrl+p`; `None` while it has none.
    fn shortcut(&self, _name: &str) -> Option<String> {
        None
    }
    /// Whether the plugin's [`Panel`] `key` is open; 2.0: also its [`Select`] or [`ErrorDetails`] of that key.
    fn dialog_open(&self, _key: &str) -> bool {
        false
    }
    /// The composer on screen, on home or in a session; `None` without one, and while the host hides it (for a
    /// permission or a form, as TS unmounts it).
    fn composer(&self) -> Option<Composer> {
        None
    }
    /// What the host serves the plugin, as it stated at load: its major, its minor of that major, and its optional
    /// features. A plugin of this SDK that uses what a later 2.x minor adds checks it here, or lowers it with
    /// [`v2::View::or`]. In process the host is this crate's own.
    fn abi(&self) -> Abi {
        Abi::current()
    }
    /// The variant IDs of the model the next prompt uses (TS `ui.model.variant.list()`); its variant is
    /// [`Read::model`]'s.
    fn variants(&self) -> Vec<String> {
        Vec::new()
    }
    /// Whether session tabs are on (TS `ui.tabs.enabled()`).
    fn tabs_enabled(&self) -> bool {
        false
    }
    /// The open session tabs, in order (TS `ui.tabs.list()`). Claims render again with [`Changed::local`] when
    /// tabs open, close or move, and with the change batch when a tab's session changes.
    fn tabs(&self) -> Vec<Tab> {
        Vec::new()
    }
    /// The pending key sequence, one entry a stroke (TS `keymap.pending()`). Claims render again with
    /// [`Changed::local`] when it changes, so they can show [`Read::keymap_active`] too.
    fn keymap_pending(&self) -> Vec<KeymapPending> {
        Vec::new()
    }
    /// The keys that do something now (TS `keymap.active()`).
    fn keymap_active(&self) -> Vec<KeymapActive> {
        Vec::new()
    }
    /// The commands that can be reached now, the plugins' and the host's (TS `keymap.commands()`).
    fn keymap_commands(&self) -> Vec<KeymapCommand> {
        Vec::new()
    }
    /// Every key of command `name`, as the host shows keys (TS `keymap.shortcuts(id)`); [`Read::shortcut`] is the
    /// first.
    fn shortcuts(&self, _name: &str) -> Vec<String> {
        Vec::new()
    }
    /// The text the mouse selected, if any (TS `renderer.getSelection()?.getSelectedText()`). A plugin can clear
    /// the selection ([`Host::clear_selection`]) but not set it.
    fn selection(&self) -> Option<String> {
        None
    }
    /// The name of the selected theme (TS 1.x `api.theme.selected`).
    fn theme(&self) -> Option<String> {
        None
    }
    /// The names of the themes the host has, built in and installed (TS 1.x `api.theme.has(name)`).
    fn themes(&self) -> Vec<String> {
        Vec::new()
    }
    /// Where scroll `target` is, as of the last settled frame and the current offset.
    fn scroll_state(&self, _target: &v2::Target) -> Option<v2::ScrollState> {
        None
    }
    /// The anchors of `group` in scroll `target`, in content order. A list's items that have no widgets give theirs,
    /// their own and those inside them, hunks included, at the row the host assumes for the item.
    fn anchors(&self, _target: &v2::Target, _group: &str) -> Vec<v2::AnchorAt> {
        Vec::new()
    }
    /// The last anchor of `group`, in content order, at or above `inset` rows below the top of `target`.
    fn top_anchor(&self, _target: &v2::Target, _group: &str, _inset: u16) -> Option<v2::AnchorAt> {
        None
    }
    /// The published `Viewport::Transcript`, while the session route shows.
    fn transcript(&self) -> Option<v2::TranscriptView> {
        None
    }
    /// Where the node with id `id` of the running call's mount is, as the last settled frame laid it out; `None`
    /// outside a mount's call, or for an id its tree does not hold.
    fn rect(&self, _id: &str) -> Option<interact::Rect> {
        None
    }
    /// Where the focus is, for the running call's mount.
    fn focused(&self) -> interact::Focused {
        interact::Focused::default()
    }
    /// The mode the running call's owner, its mount or else the plugin, is in ([`Host::set_mode`]); `None` in the base
    /// mode, also after the host ended the mode.
    fn mode(&self) -> Option<String> {
        None
    }
    /// The mount the running call is for: of a surface's handler ([`v2::Surface::on`]), its view, draw and `layout`;
    /// `None` for a call of the plugin's own (a command, a layer of setup, a message). Two mounts of one surface with
    /// the same tree hear the same events: a plugin with a model per mount finds the model by it, and drops it on
    /// [`interact::Event::Mount`] or [`Request::Unmount`].
    fn mount(&self) -> Option<v2::MountId> {
        None
    }
    /// The TUI plugins, in the host's order; [`Setup::on_plugins`] hears when they change.
    fn plugins(&self) -> Vec<PluginEntry> {
        Vec::new()
    }
    /// The user's setting `name`, one of the host's named settings ([`SETTINGS`]), as the TUI config (`tui.json`)
    /// holds it; `None` when it holds none, and for a name the host does not name. A change of it is a change of the
    /// host's own state ([`Changed::local`]).
    fn setting(&self, _name: &str) -> Option<serde_json::Value> {
        None
    }
    /// The width and height of the image `bytes` decode to in the host, or `None` where an image node of them would
    /// show nothing: not a PNG, GIF, JPEG or WebP image, past the host's bounds, or bytes that do not decode.
    /// [`image_size`] reads only the header. The host decodes an image within its bounds: ask once per content and
    /// keep the answer, not in each view. A host with [`IMAGE_BOUNDS`] states its bounds once, and bytes past them
    /// answer `None` without being decoded.
    fn image_size(&self, _bytes: &[u8]) -> Option<(u32, u32)> {
        None
    }
    /// The seconds the user's local time is east of UTC at `at`, in milliseconds since the epoch: it depends on the
    /// date, as a zone's daylight time does. The host's zone is the process's (`TZ`, else the system's); 0 is UTC.
    fn utc_offset(&self, _at: i64) -> i32 {
        0
    }
    /// The cells `text` takes in a row and its graphemes, as the host's text layout counts them, so a plugin that pads
    /// or cuts a column agrees with what the host draws for a wide or joined character. A line break counts as no
    /// cell. A host that cannot measure counts a cell and a grapheme a character.
    fn measure(&self, text: &str) -> Measure {
        let count = text.chars().filter(|char| *char != '\n').count() as u32;
        Measure { cells: count, graphemes: count }
    }
}

/// The user's settings a plugin reads ([`Read::setting`]) and writes ([`Host::set_setting`]), by name: the diff
/// viewer's.
pub const SETTINGS: [&str; 5] = ["diffs.source", "diffs.view", "diffs.fullscreen", "diffs.tree", "diffs.single"];

/// What a command or an event handler reads and asks of the host. An effect waits until the outermost plugin
/// callback has returned, and effects run in the order they were asked for.
///
/// A host is the UI thread's: a plugin's own thread cannot take one, and wakes the host with a [`Waker`] instead.
///
/// ```compile_fail,E0277
/// # use opencode_plugin_abi::*;
/// fn command(host: &dyn Host) {
///     std::thread::scope(|threads| {
///         threads.spawn(|| host.edit_composer(ComposerEdit::Submit));
///     });
/// }
/// ```
///
/// ```compile_fail,E0277
/// # use opencode_plugin_abi::*;
/// fn command(host: &dyn Host) {
///     std::thread::scope(|threads| {
///         threads.spawn(|| host.try_foreground(Foreground { command: "true".into(), ..Foreground::default() }));
///     });
/// }
/// ```
pub trait Host: Read {
    /// Stores `value`, an object or an array, under one of the plugin's declared storage keys. [`Read::storage_get`]
    /// reads it back at once; the host writes it to disk later, and claims render again with [`Changed::local`]. The
    /// host ignores any other value, and a key that was not declared.
    fn storage_set(&self, key: &str, value: serde_json::Value);
    /// Sets `fields` in the object stored under one of the plugin's declared storage keys and keeps its other fields
    /// (TS `update((draft) => { draft.open = … })`). A host with storage sets them in the latest stored object under
    /// the storage lock, so fields another client wrote stay.
    fn storage_merge(&self, key: &str, fields: serde_json::Map<String, serde_json::Value>) {
        storage_merge_whole(self, key, fields);
    }
    /// Runs the registered command `name` with `input`, the plugin's or the host's, palette or not.
    fn dispatch(&self, name: &str, input: Option<&str>);
    /// Enables or disables the plugin's own command `name` ([`Command::enabled`]), once the current call returns: a
    /// disabled command binds no key, so its key goes on to whatever else takes it, and is in neither the palette nor
    /// the slash list. A name the plugin did not register changes nothing, and the log says so.
    fn set_enabled(&self, name: &str, enabled: bool) {
        let _ = (name, enabled);
    }
    /// Shows `toast`.
    fn toast(&self, toast: Toast);
    /// Asks for the user's attention.
    fn attention(&self, attention: Attention);
    /// Opens the plugin's route `name`.
    fn open_route(&self, name: &str);
    /// Shows `route`: home, a session, or a plugin's route.
    fn navigate(&self, route: Route);
    /// Sends `fetch` to the server. [`Setup::on_reply`] gets the reply, with the ID this returns, while what
    /// owns the fetch lives, on every carrier:
    ///
    /// - A fetch a mount's call asks for (a command of the route it shows, or a handler of the mount's input) is that
    ///   mount's. Once the mount closes, it is not sent, and its reply is dropped, also when the surface opens again
    ///   under the same key: a reply never reaches another mount. [`Setup::on_cancelled`] hears of it in place of the
    ///   reply.
    /// - Any other (setup, a global command, an event, a wake, a message, a layer of setup, and the mount's begin and
    ///   end, [`interact::Event::Mount`], which the plugin hears, not the mount) is the activation's: its reply comes
    ///   unless the plugin is disposed first.
    ///
    /// An error is a fetch the host did not take, and no reply comes for it: its queue of effects is full, as when a
    /// plugin fans out without end, or it has no server.
    #[must_use = "a fetch the host did not take gets no reply"]
    fn try_fetch(&self, fetch: Fetch) -> Result<RequestId, String>;
    /// Shows `dialog`.
    fn dialog(&self, dialog: Dialog);
    /// Copies `text` to the clipboard, then runs `then` once it is copied; a toast says so when it fails.
    fn copy(&self, text: &str, then: Option<Action>);
    /// Edits the composer on screen ([`Read::composer`]); without one, it does nothing.
    fn edit_composer(&self, _edit: ComposerEdit) {}
    /// Selects `variant` of the model the next prompt uses, or its default for `None`. `false`, and nothing happens,
    /// when no model is selected or it has no such variant.
    fn set_variant(&self, _variant: Option<&str>) -> bool {
        false
    }
    /// Selects model `model` of provider `provider` for the next prompt and adds it to the recent models, as the
    /// model dialog does. A model the host does not list is ignored.
    fn set_model(&self, _provider: &str, _model: &str) {}
    /// Opens, shows, moves or closes a session tab; whether it will.
    fn edit_tab(&self, _edit: TabEdit) -> bool {
        false
    }
    /// Clears the mouse selection (TS `renderer.clearSelection()`).
    fn clear_selection(&self) {}
    /// Gives the terminal to `program` until it exits, then takes it back, as the host does for `$EDITOR`.
    /// [`Setup::on_reply`] gets `{ "code": <exit code or null> }` with the ID this returns, plus `"signal"` on Unix when
    /// a signal ended it, or the error when it did not start. It starts once the current call is done, and not when
    /// the plugin was disposed or failed by then, another program has the terminal, or the host has none (headless).
    /// The program has the terminal on all three standard streams and gets the signals of its keys, the host does
    /// not: on Unix it is the terminal's foreground process group, and one that stops (Ctrl+Z) is continued at once,
    /// as the host has no shell to hand it to; on Windows the host ignores Ctrl+C and Ctrl+Break while it runs. Input
    /// it leaves unread is dropped. It is owned as a fetch is ([`Host::try_fetch`]): a mount's request does not start
    /// once its mount closed, and its reply reaches no other mount. An error is a program the host did not take, as
    /// for [`Host::try_fetch`]: no reply comes for it. A host that runs no program, by default, takes none.
    #[must_use = "a program the host did not take gets no reply"]
    fn try_foreground(&self, _program: Foreground) -> Result<RequestId, String> {
        Err("the host did not take the program".to_owned())
    }
    /// Starts a timer: [`Setup::on_reply`] gets `null` with the ID this returns once `delay` passed on the host's
    /// clock, on the UI thread, with no thread of the plugin's. A delay under [`MIN_TIMER`] waits [`MIN_TIMER`]. It is
    /// owned as a fetch is ([`Host::try_fetch`], [`Host::set_owner`]): a mount's timer ends with its mount, which
    /// [`Setup::on_cancelled`] hears, and every timer ends with the activation. The delay crosses to the host in whole
    /// milliseconds, a part of one counted as one. A JS plugin on the pipe keeps its own timers: the pipe refuses this
    /// request. With [`MAX_TIMERS`] of the plugin's timers waiting, the reply is that refusal, at once. An error is a
    /// timer the host did not take, as for [`Host::try_fetch`]: no reply comes for it. A host without timers, by
    /// default, takes none.
    #[must_use = "a timer the host did not take gets no reply"]
    fn try_timer(&self, _delay: std::time::Duration) -> Result<RequestId, String> {
        Err("the host has no timers".to_owned())
    }
    /// Lets go of timer `id` ([`Host::try_timer`]), once what the running call asked for before applies: it fires no
    /// more, its reply never comes, and its place among [`MAX_TIMERS`] is free. Another request's ID, or a timer that
    /// fired, is ignored.
    fn cancel_timer(&self, _id: RequestId) {}
    /// The owner of what the running call asks for now ([`Host::try_fetch`]), as a number of the host's: `0` for the
    /// activation, another for a mount. A plugin that goes on with work in a later call (a task) keeps it, and gives it
    /// back with [`Host::set_owner`], so the work stays its starting mount's.
    fn owner(&self) -> u64 {
        0
    }
    /// Makes `owner`, a number [`Host::owner`] gave, the owner of what the running call asks for from now on: its
    /// requests are that mount's, and end with it, also when it has closed already; and its input verbs act on it.
    /// `None` gives the call its own owner back. It lasts until the call returns.
    fn set_owner(&self, _owner: Option<u64>) {}
    /// Sets the terminal title. The host sets its own again with its next change, such as a route change.
    fn set_title(&self, _title: &str) {}
    /// Selects theme `name` and saves it as the user's choice, as the theme dialog does (TS 1.x
    /// `api.theme.set`). `false`, and nothing happens, for a theme the host does not have.
    fn set_theme(&self, _name: &str) -> bool {
        false
    }
    /// Writes `theme`, a theme's JSON, as `<config>/themes/<name>.json`, and lists it among the themes (TS 1.x
    /// `api.theme.install`), at once for [`Host::set_theme`] in the same call. It does not select it. A name that is
    /// not a plain file name, or a value without `theme` or `base`, installs nothing.
    fn install_theme(&self, _name: &str, _theme: serde_json::Value) {}
    /// Saves `value` as the user's setting `name` ([`SETTINGS`]) in the TUI config, once the call returns, as the
    /// host's settings dialog does. A name the host does not name, or a value the setting does not take, is not saved.
    fn set_setting(&self, _name: &str, _value: serde_json::Value) {}
    /// Scrolls `target` by `verb` once the call returns. The transcript takes a verb from a handler of the user's
    /// input only (a key, a click, the palette, the user's scroll), never from a view, `layout`, a wake, a reply, a
    /// command the plugin dispatched or the report of its own step.
    fn scroll(&self, _target: v2::Target, _verb: v2::Scroll) {}
    /// Opens the plugin's panel surface beside a session ([`v2::Place::Panel`]); it replaces the panel on screen.
    fn open_panel(&self, _open: interact::OpenPanel) {}
    /// Closes the plugin's panel `surface`, if it shows.
    fn close_panel(&self, _surface: &str) {}
    /// Opens the plugin's overlay surface ([`v2::Place::Overlay`]); it belongs to the running call's mount, or to the
    /// plugin, and replaces the plugin's overlay on screen.
    fn overlay(&self, _overlay: interact::Overlay) {}
    /// Closes the plugin's overlay `surface`, if it shows.
    fn close_overlay(&self, _surface: &str) {}
    /// Gives the focus to the node with id `id` of the running call's mount: a box with
    /// [`interact::Interact::focusable`], or, on a host with [`FOCUS_INPUT`], a [`v2::Node::Input`] or a
    /// [`v2::Node::Scroll`], as a click does, so what the user types goes into the field, and the arrows and the page
    /// keys scroll the scroll. Any other node, one in a hidden box, another plugin's node and a host widget are
    /// refused, as is any focus while a host dialog is open, but for a node of the plugin's own dialog surface
    /// ([`v2::Place::Dialog`]) while its dialog is on top; a host without [`FOCUS_INPUT`] refuses a field. A call the
    /// user did not cause may ask for it too, as a click can: the host does not refuse it. A node the mount's tree
    /// does not hold yet takes the focus if the mount's next view shows it (the view after the call, or the JS host's
    /// next revision), so a call can show a field and focus it; if that view does not, the focus is dropped, and no
    /// later view (a resize, a theme) applies it. A call of the plugin's own (a command) that names a node no mount
    /// holds yet names the mount that holds it once the effects before it applied: a command can show its dialog
    /// surface ([`Dialog::Surface`]) and focus a field in it.
    fn focus(&self, _id: &str) {}
    /// Takes the focus from the running call's mount, if it has it, and gives it to the composer.
    fn blur(&self) {}
    /// Sets the mode of the running call's owner, its mount or else the plugin: its layers of that mode hold, and the
    /// host's base layers do not. `None` ends it. It ends too when the focus leaves the owner's scope, when the owner
    /// ends, and on [`interact::RESERVED`]. A dialog surface's mount sets none: it would take the dialog's escape and
    /// `ctrl+c`.
    fn set_mode(&self, _mode: Option<&str>) {}
    /// Routes the keys a [`interact::Bind::hold`] key held, in order.
    fn release_keys(&self) {}
    /// Declares storage key `key` of the plugin, for [`Setup::storage_key`].
    #[doc(hidden)]
    fn declare_storage_key(&self, _key: &str) {}
    /// Marks what the current call asked for so far, for [`Host::rollback`]; `None` from a host without marks.
    #[doc(hidden)]
    fn checkpoint(&self) -> Option<u64> {
        None
    }
    /// Drops what the current call asked for after `mark`, and puts back the storage it wrote since.
    #[doc(hidden)]
    fn rollback(&self, _mark: u64) {}
}

/// The plugin's storage as its own types, over serde: on every [`Read`], so on every [`Host`] too.
pub trait Stored: Read {
    /// The value stored under `key` decoded as `T`, or `None` when there is none or it is not a `T`.
    fn stored<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        self.storage_get(key).and_then(|value| serde_json::from_value(value).ok())
    }
}

impl<R: Read + ?Sized> Stored for R {}

/// Stores the plugin's own types, over serde.
pub trait Store: Host {
    /// Stores `value` under `key` ([`Host::storage_set`]). A value that does not serialize to JSON stores nothing.
    fn store<T: Serialize + ?Sized>(&self, key: &str, value: &T) {
        if let Ok(value) = serde_json::to_value(value) {
            self.storage_set(key, value);
        }
    }
}

impl<H: Host + ?Sized> Store for H {}

/// [`Host::storage_merge`] by reading the stored object and setting it whole.
fn storage_merge_whole<H: Host + ?Sized>(host: &H, key: &str, fields: serde_json::Map<String, serde_json::Value>) {
    let mut object = match host.storage_get(key) {
        Some(serde_json::Value::Object(object)) => object,
        _ => serde_json::Map::new(),
    };
    object.extend(fields);
    host.storage_set(key, serde_json::Value::Object(object));
}

/// The host table, as the plugin calls it. It is valid until the host destroys the instance, so it is the plugin's
/// own: a plugin gets it only as the [`Read`] or [`Host`] of one callback.
#[derive(Clone, Default)]
struct HostHandle {
    /// The bounds of the images the host decodes, asked once, on the first [`Read::image_size`]; `None` inside for a
    /// host that has no [`IMAGE_BOUNDS`] or did not answer. The instance's own: a table at the same address after it
    /// is another host's.
    image_bounds: Rc<std::cell::OnceCell<Option<ImageBounds>>>,
}

impl HostHandle {
    /// There is no host table: every request is refused.
    fn request(&self, _: &HostRequest) -> Result<serde_json::Value, String> {
        Err("no host".to_owned())
    }

    /// The JSON text stored under one of the plugin's storage keys.
    fn storage_text(&self, key: &str) -> Option<String> {
        let value = self.request(&HostRequest::StorageGet { key: key.to_owned() }).ok()?;
        serde_json::from_value(value).ok().flatten()
    }

    fn log(&self, level: Level, message: &str) {
        let _ = self.request(&HostRequest::Log { level, message: message.to_owned() });
    }

    fn mode(&self) -> Option<ThemeMode> {
        None
    }

    fn features(&self) -> Vec<String> {
        Vec::new()
    }
}

impl Read for HostHandle {
    fn theme_mode(&self) -> ThemeMode {
        self.mode().unwrap_or(ThemeMode::Dark)
    }

    fn color(&self, token: &str) -> Option<Rgba> {
        self.read(&HostRequest::Color { token: token.to_owned() })
    }

    fn session(&self, id: &str) -> Option<Session> {
        self.read(&HostRequest::Session { id: id.to_owned() })
    }

    fn family(&self, id: &str) -> Family {
        self.read(&HostRequest::Family { id: id.to_owned() }).unwrap_or_default()
    }

    fn sessions(&self) -> Vec<Session> {
        self.read(&HostRequest::Sessions).unwrap_or_default()
    }

    fn pending(&self, id: &str) -> Vec<types::SessionInboxInfo> {
        self.read(&HostRequest::Pending { id: id.to_owned() }).unwrap_or_default()
    }

    fn messages(&self, id: &str, visit: &mut dyn FnMut(&[SessionMessageInfo])) {
        // The copy is the plugin's own, so `visit` may call the host again.
        let messages: Vec<SessionMessageInfo> =
            self.read(&HostRequest::Messages { id: id.to_owned() }).unwrap_or_default();
        visit(&messages);
    }

    fn message(&self, session: &str, message: &str, visit: &mut dyn FnMut(Option<&SessionMessageInfo>)) {
        let request = HostRequest::Message { session: session.to_owned(), message: message.to_owned() };
        let found: Option<SessionMessageInfo> = self.read(&request);
        visit(found.as_ref());
    }

    fn models(&self, location: Option<&LocationRef>) -> Option<std::sync::Arc<[ModelInfo]>> {
        self.read::<Vec<_>>(&HostRequest::Models { location: location.cloned() }).map(Into::into)
    }

    fn model(&self) -> Option<ModelRef> {
        self.read(&HostRequest::Model)
    }

    fn limits(&self) -> Option<UsageLimitsInfo> {
        self.read(&HostRequest::Limits)
    }

    fn providers(&self, location: Option<&LocationRef>) -> Option<std::sync::Arc<[ProviderInfo]>> {
        self.read::<Vec<_>>(&HostRequest::Providers { location: location.cloned() }).map(Into::into)
    }

    fn storage_get(&self, key: &str) -> Option<serde_json::Value> {
        self.storage_text(key).and_then(|json| serde_json::from_str(&json).ok())
    }

    fn info(&self) -> Info {
        self.read(&HostRequest::Info).unwrap_or_default()
    }

    fn mcp_servers(&self, location: Option<&LocationRef>) -> Option<std::sync::Arc<[McpServer]>> {
        self.read::<Vec<_>>(&HostRequest::McpServers { location: location.cloned() }).map(Into::into)
    }

    fn integrations(&self, location: Option<&LocationRef>) -> Option<std::sync::Arc<[IntegrationInfo]>> {
        self.read::<Vec<_>>(&HostRequest::Integrations { location: location.cloned() }).map(Into::into)
    }

    fn vcs(&self, location: Option<&LocationRef>) -> Option<VcsInfo> {
        self.read(&HostRequest::Vcs { location: location.cloned() })
    }

    fn route(&self) -> Route {
        self.read(&HostRequest::Route).unwrap_or_default()
    }

    fn scroll_state(&self, target: &v2::Target) -> Option<v2::ScrollState> {
        self.read(&HostRequest::ScrollState { target: target.clone() })
    }

    fn anchors(&self, target: &v2::Target, group: &str) -> Vec<v2::AnchorAt> {
        self.read(&HostRequest::Anchors { target: target.clone(), group: group.to_owned() }).unwrap_or_default()
    }

    fn top_anchor(&self, target: &v2::Target, group: &str, inset: u16) -> Option<v2::AnchorAt> {
        self.read(&HostRequest::TopAnchor { target: target.clone(), group: group.to_owned(), inset })
    }

    fn transcript(&self) -> Option<v2::TranscriptView> {
        self.read(&HostRequest::Transcript)
    }

    fn interactive(&self) -> bool {
        self.read(&HostRequest::Interactive).unwrap_or(true)
    }

    fn shortcut(&self, name: &str) -> Option<String> {
        self.read(&HostRequest::Shortcut { name: name.to_owned() })
    }

    fn dialog_open(&self, key: &str) -> bool {
        self.read(&HostRequest::DialogOpen { key: key.to_owned() }).unwrap_or(false)
    }

    fn composer(&self) -> Option<Composer> {
        self.read(&HostRequest::Composer)
    }

    fn abi(&self) -> Abi {
        Abi::new(0, 0, Vec::new())
    }

    fn variants(&self) -> Vec<String> {
        self.read(&HostRequest::Variants).unwrap_or_default()
    }

    fn tabs_enabled(&self) -> bool {
        self.read(&HostRequest::TabsEnabled).unwrap_or(false)
    }

    fn tabs(&self) -> Vec<Tab> {
        self.read(&HostRequest::Tabs).unwrap_or_default()
    }

    fn keymap_pending(&self) -> Vec<KeymapPending> {
        self.read(&HostRequest::KeymapPending).unwrap_or_default()
    }

    fn keymap_active(&self) -> Vec<KeymapActive> {
        self.read(&HostRequest::KeymapActive).unwrap_or_default()
    }

    fn keymap_commands(&self) -> Vec<KeymapCommand> {
        self.read(&HostRequest::KeymapCommands).unwrap_or_default()
    }

    fn shortcuts(&self, name: &str) -> Vec<String> {
        self.read(&HostRequest::Shortcuts { name: name.to_owned() }).unwrap_or_default()
    }

    fn selection(&self) -> Option<String> {
        self.read(&HostRequest::Selection)
    }

    fn theme(&self) -> Option<String> {
        self.read(&HostRequest::Theme)
    }

    fn themes(&self) -> Vec<String> {
        self.read(&HostRequest::Themes).unwrap_or_default()
    }

    fn rect(&self, id: &str) -> Option<interact::Rect> {
        self.read(&HostRequest::Rect { node: id.to_owned() }).flatten()
    }

    fn focused(&self) -> interact::Focused {
        self.read(&HostRequest::Focused).unwrap_or_default()
    }

    fn mode(&self) -> Option<String> {
        self.read(&HostRequest::InputMode).flatten()
    }

    fn plugins(&self) -> Vec<PluginEntry> {
        self.read(&HostRequest::Plugins).unwrap_or_default()
    }

    fn setting(&self, name: &str) -> Option<serde_json::Value> {
        self.read(&HostRequest::Setting { name: name.to_owned() }).flatten()
    }

    fn image_size(&self, bytes: &[u8]) -> Option<(u32, u32)> {
        // Bytes past the bounds the host states are no image it decodes: no need to encode and send them.
        if self.image_bounds().is_some_and(|bounds| bounds.over(bytes)) {
            return None;
        }
        self.read(&HostRequest::ImageSize { bytes: base64::encode(bytes) }).flatten()
    }

    fn utc_offset(&self, at: i64) -> i32 {
        self.read(&HostRequest::UtcOffset { at }).unwrap_or_default()
    }

    fn measure(&self, text: &str) -> Measure {
        self.read(&HostRequest::Measure { text: text.to_owned() }).unwrap_or_default()
    }
}

impl HostHandle {
    /// The bounds of the images the host decodes, when it states them ([`IMAGE_BOUNDS`]).
    fn image_bounds(&self) -> Option<ImageBounds> {
        *self.image_bounds.get_or_init(|| {
            let stated = self.features().iter().any(|feature| feature == IMAGE_BOUNDS);
            stated.then(|| self.read::<ImageBounds>(&HostRequest::ImageBounds)).flatten()
        })
    }
}

impl Host for HostHandle {
    fn set_setting(&self, name: &str, value: serde_json::Value) {
        if let Err(error) = self.request(&HostRequest::SetSetting { name: name.to_owned(), value }) {
            self.log(Level::Warn, &format!("setting {name}: {error}"));
        }
    }

    fn scroll(&self, target: v2::Target, verb: v2::Scroll) {
        if let Err(error) = self.request(&HostRequest::Scroll { target, verb }) {
            self.log(Level::Warn, &format!("scroll: {error}"));
        }
    }

    fn storage_set(&self, key: &str, value: serde_json::Value) {
        let request = HostRequest::StorageSet { key: key.to_owned(), value: value.to_string() };
        if let Err(error) = self.request(&request) {
            self.log(Level::Warn, &format!("storage {key}: {error}"));
        }
    }

    fn storage_merge(&self, key: &str, fields: serde_json::Map<String, serde_json::Value>) {
        if let Err(error) = self.request(&HostRequest::StorageMerge { key: key.to_owned(), fields }) {
            self.log(Level::Warn, &format!("storage {key}: {error}"));
        }
    }

    fn dispatch(&self, name: &str, input: Option<&str>) {
        let _ = self.request(&HostRequest::Dispatch { name: name.to_owned(), input: input.map(str::to_owned) });
    }

    fn set_enabled(&self, name: &str, enabled: bool) {
        let _ = self.request(&HostRequest::SetEnabled { name: name.to_owned(), enabled });
    }

    fn toast(&self, toast: Toast) {
        let Toast { variant, title, message, session } = toast;
        let _ = self.request(&HostRequest::Toast { variant, message, title, session });
    }

    fn attention(&self, attention: Attention) {
        let _ = self.request(&HostRequest::Attention(attention));
    }

    fn open_route(&self, name: &str) {
        let _ = self.request(&HostRequest::OpenRoute { name: name.to_owned() });
    }

    fn navigate(&self, route: Route) {
        let _ = self.request(&HostRequest::Navigate { route });
    }

    fn try_fetch(&self, fetch: Fetch) -> Result<RequestId, String> {
        self.requested(&HostRequest::Fetch(fetch))
    }

    fn try_timer(&self, delay: std::time::Duration) -> Result<RequestId, String> {
        self.requested(&HostRequest::Timer { ms: timer_ms(delay) })
    }

    fn cancel_timer(&self, id: RequestId) {
        let _ = self.request(&HostRequest::CancelTimer { id });
    }

    fn owner(&self) -> u64 {
        self.read(&HostRequest::Owner).unwrap_or(0)
    }

    fn set_owner(&self, owner: Option<u64>) {
        let _ = self.request(&HostRequest::SetOwner { owner });
    }

    fn dialog(&self, dialog: Dialog) {
        let _ = self.request(&HostRequest::Dialog { dialog: Box::new(dialog) });
    }

    fn copy(&self, text: &str, then: Option<Action>) {
        let _ = self.request(&HostRequest::Copy { text: text.to_owned(), then });
    }

    fn edit_composer(&self, edit: ComposerEdit) {
        let _ = self.request(&HostRequest::ComposerEdit { edit });
    }

    fn checkpoint(&self) -> Option<u64> {
        self.read(&HostRequest::Checkpoint)
    }

    fn rollback(&self, mark: u64) {
        let _ = self.request(&HostRequest::Rollback { mark });
    }

    fn set_variant(&self, variant: Option<&str>) -> bool {
        self.read(&HostRequest::SetVariant { variant: variant.map(str::to_owned) }).unwrap_or(false)
    }

    fn set_model(&self, provider: &str, model: &str) {
        let _ = self.request(&HostRequest::SetModel { provider: provider.to_owned(), model: model.to_owned() });
    }

    fn open_panel(&self, open: interact::OpenPanel) {
        let _ = self.request(&HostRequest::OpenPanel(open));
    }

    fn close_panel(&self, surface: &str) {
        let _ = self.request(&HostRequest::ClosePanel { surface: surface.to_owned() });
    }

    fn overlay(&self, overlay: interact::Overlay) {
        let _ = self.request(&HostRequest::Overlay(overlay));
    }

    fn close_overlay(&self, surface: &str) {
        let _ = self.request(&HostRequest::CloseOverlay { surface: surface.to_owned() });
    }

    fn focus(&self, id: &str) {
        let _ = self.request(&HostRequest::Focus { node: id.to_owned() });
    }

    fn blur(&self) {
        let _ = self.request(&HostRequest::Blur);
    }

    fn set_mode(&self, mode: Option<&str>) {
        let _ = self.request(&HostRequest::SetMode { mode: mode.map(str::to_owned) });
    }

    fn release_keys(&self) {
        let _ = self.request(&HostRequest::ReleaseKeys);
    }

    fn edit_tab(&self, edit: TabEdit) -> bool {
        self.read(&HostRequest::Tab { edit }).unwrap_or(false)
    }

    fn clear_selection(&self) {
        let _ = self.request(&HostRequest::ClearSelection);
    }

    fn try_foreground(&self, program: Foreground) -> Result<RequestId, String> {
        self.requested(&HostRequest::Foreground(program))
    }

    fn set_title(&self, title: &str) {
        let _ = self.request(&HostRequest::Title { title: title.to_owned() });
    }

    fn set_theme(&self, name: &str) -> bool {
        self.read(&HostRequest::SetTheme { name: name.to_owned() }).unwrap_or(false)
    }

    fn install_theme(&self, name: &str, theme: serde_json::Value) {
        let _ = self.request(&HostRequest::InstallTheme { name: name.to_owned(), theme });
    }

    fn declare_storage_key(&self, key: &str) {
        let _ = self.request(&HostRequest::StorageKey { key: key.to_owned() });
    }
}

impl HostHandle {
    /// A read's answer; `None` from a host that does not know the request or has no value.
    fn read<T: serde::de::DeserializeOwned>(&self, request: &HostRequest) -> Option<T> {
        serde_json::from_value::<Option<T>>(self.request(request).ok()?).ok().flatten()
    }

    /// The ID of the reply to `request`; an error, the host's, when it did not take it.
    fn requested(&self, request: &HostRequest) -> Result<RequestId, String> {
        match serde_json::from_value(self.request(request)?) {
            // 0 names no request, so no reply carries it: an answer of 0 is malformed.
            Ok(RequestId(0)) => Err("the host returned a bad result: request ID 0".to_owned()),
            Ok(id) => Ok(id),
            Err(error) => Err(format!("the host answered no request ID: {error}")),
        }
    }
}

/// Wakes the host from any thread, from [`Setup::waker`]: the host
/// then runs the plugin's [`Setup::on_wake`] handlers and renders its mounted slot claims and routes again, with
/// [`Changed::woken`], so a plugin that works on its own thread can show the result.
///
/// A wake is a redraw hint, not a message: it delivers nothing and drains nothing. Many wakes may become one redraw,
/// so a render must show every result that is ready, not one per wake. The host never loses the last wake, even when
/// its queue is full.
///
/// Disposing the plugin revokes every clone of the waker before its [`Setup::on_dispose`] callbacks run: it waits for
/// the wakes in progress, and a later wake does nothing. A thread that holds one may outlive the plugin; stop it in
/// [`Setup::on_dispose`] or when the plugin's state drops all the same, as the sample plugin's `Ticker` does.
#[derive(Clone)]
pub struct Waker(Arc<RwLock<Option<WakeCall>>>);

/// What a [`Waker`] calls, until it is revoked.
type WakeCall = Box<dyn Fn() + Send + Sync>;

impl Waker {
    /// A waker that calls `wake` until it is revoked.
    #[doc(hidden)]
    pub fn new(wake: impl Fn() + Send + Sync + 'static) -> Self {
        Self(Arc::new(RwLock::new(Some(Box::new(wake)))))
    }

    pub fn wake(&self) {
        if let Some(wake) = &*self.0.read().unwrap_or_else(PoisonError::into_inner) {
            wake();
        }
    }

    /// Makes every later wake of every clone do nothing, once the wakes in progress have returned.
    #[doc(hidden)]
    pub fn revoke(&self) {
        self.0.write().unwrap_or_else(PoisonError::into_inner).take();
    }
}

/// A registered fence render.
pub type FenceFn = Rc<dyn Fn(&dyn Read, &Fence) -> Fenced>;
/// A registered inline math render of [`Setup::inline_math`].
pub type InlineMathFn = Rc<dyn Fn(&dyn Read, &str) -> Option<Line>>;
/// A registered slot render.
pub type RenderFn = Rc<dyn Fn(&dyn Read, &SlotInput, &Changed) -> Render>;
/// A registered route render of [`Setup::route`].
pub type RouteFn = Rc<dyn Fn(&dyn Read, &Changed) -> Render>;
/// A registered reply handler.
pub type ReplyFn = Rc<dyn Fn(&dyn Host, RequestId, Result<serde_json::Value, String>)>;
/// A registered command: [`Handled::Pass`] declines the key that ran it, which goes on as if the command were not
/// there.
pub type CommandFn = Rc<dyn Fn(&dyn Host, Option<&str>) -> interact::Handled>;

/// What a command's closure may return: nothing, which takes the key that ran it, or [`interact::Handled`]. A
/// closure that only panics returns `!`, which is neither: give it `-> ()`.
#[diagnostic::on_unimplemented(
    message = "a command's closure returns nothing or `Handled`, not `{Self}`",
    note = "a closure that only panics returns `!`: write `|host, input| -> () {{ panic!(...) }}`"
)]
pub trait CommandOutcome {
    fn handled(self) -> interact::Handled;
}

impl CommandOutcome for () {
    fn handled(self) -> interact::Handled {
        interact::Handled::Consume
    }
}

impl CommandOutcome for interact::Handled {
    fn handled(self) -> interact::Handled {
        self
    }
}
/// A registered event handler.
pub type EventFn = Rc<dyn Fn(&dyn Host, &V2Event)>;
/// A registered mount handler of [`Setup::on_mount`].
pub type MountFn = Rc<dyn Fn(&dyn Host, &SlotInput, bool)>;
/// A registered route mount handler of [`Setup::on_route_mount`].
pub type RouteMountFn = Rc<dyn Fn(&dyn Host, bool)>;
/// A registered wake handler of [`Setup::on_wake`].
pub type WakeFn = Rc<dyn Fn(&dyn Host)>;
/// A handler of [`Setup::on_fence_gone`].
pub type FenceGoneFn = Rc<dyn Fn(u64)>;
/// A handler of [`Setup::on_cancelled`].
pub type CancelledFn = Rc<dyn Fn(&dyn Host, RequestId)>;
/// A handler of [`Setup::on_deltas`].
pub type DeltasFn = Rc<dyn Fn(&dyn Host, &[V2Event])>;
/// A registered dispose callback.
pub type DisposeFn = Box<dyn FnOnce(&dyn Host)>;

/// What a plugin's setup registers through, for the length of setup.
///
/// A callback reaches the host only through the [`Read`] or [`Host`] it is called with, so a render cannot have
/// effects. Setup itself reaches it through [`Setup::host`], which no callback can keep:
///
/// ```compile_fail,E0521
/// # use opencode_plugin_abi::*;
/// fn setup(setup: &mut Setup) -> Result<(), String> {
///     let host = setup.host();
///     setup.slot(Placement::append("home.footer"), move |_, _, _| {
///         host.dispatch("x.hello", None);
///         Render::Hide
///     });
///     Ok(())
/// }
/// ```
///
/// Nor can a callback keep the setup itself, which lends that host:
///
/// ```compile_fail,E0521
/// # use opencode_plugin_abi::*;
/// fn setup(setup: &mut Setup) -> Result<(), String> {
///     let other = Box::leak(Box::new(Registered::new("x", None))).setup();
///     let original = std::mem::replace(setup, other);
///     setup.slot(Placement::append("home.footer"), move |_, _, _| {
///         original.host().toast(Toast::new(Variant::Info, "from render"));
///         Render::Hide
///     });
///     Ok(())
/// }
/// ```
///
/// ```
/// # use opencode_plugin_abi::*;
/// fn setup(setup: &mut Setup) -> Result<(), String> {
///     setup.host().toast(Toast::new(Variant::Info, "setup may show a toast"));
///     setup.command(Command::new("x.hello"), |host, _| {
///         host.toast(Toast::new(Variant::Info, "a command may too"));
///     });
///     Ok(())
/// }
/// ```
pub struct Setup<'a> {
    registered: &'a mut Registered,
    /// The host of setup; the registration's own without one.
    host: Option<&'a dyn Host>,
}

impl Setup<'_> {
    pub fn id(&self) -> &str {
        &self.registered.manifest.id
    }

    /// The `options` of the plugin's `plugins` entry, as JSON text.
    pub fn options(&self) -> Option<&str> {
        self.registered.options.as_deref()
    }

    /// The `options` decoded as `T`: `None` without options, the error when they are not a `T`.
    pub fn options_as<T: DeserializeOwned>(&self) -> Result<Option<T>, String> {
        self.options().map(|text| serde_json::from_str(text).map_err(|error| format!("options: {error}"))).transpose()
    }

    /// The host while setup runs: its reads, and effects that wait until setup has returned, on the host's one effect
    /// queue.
    pub fn host(&self) -> &dyn Host {
        self.host.unwrap_or(&self.registered.host)
    }

    /// What wakes the host from the plugin's own threads; `None` without a host.
    pub fn waker(&self) -> Option<Waker> {
        self.registered.waker.clone()
    }

    /// Runs `run` when the host disposes the plugin: on deactivation, unload, reload, when setup fails after it was
    /// registered, and when the host exits. Callbacks run in reverse order, before the plugin's state drops, each
    /// whatever the others do. Stop the plugin's threads here or when its state drops. After a call of the plugin
    /// panicked they never run, as the host calls a failed plugin no more and keeps its instance.
    pub fn on_dispose(&mut self, run: impl FnOnce(&dyn Host) + 'static) {
        self.registered.disposers.push(Box::new(run));
    }

    /// Declares storage key `key`; [`Read::storage_get`] and [`Host::storage_set`] accept declared keys only.
    pub fn storage_key(&mut self, key: &str) {
        self.host().declare_storage_key(key);
        self.registered.manifest.storage.push(key.to_owned());
    }

    /// Registers a command; `run` receives the input it was dispatched with, such as the slash command's text after
    /// its name. A command without `palette` and `slash` is hidden: a click or [`Host::dispatch`] runs it.
    pub fn command<R: CommandOutcome>(
        &mut self,
        command: Command,
        run: impl Fn(&dyn Host, Option<&str>) -> R + 'static,
    ) {
        self.registered.commands.push(Rc::new(move |host, input| run(host, input).handled()));
        self.registered.manifest.commands.push(command);
    }

    /// Calls `run` with each server event whose type is one of `types` (such as `session.execution.failed`), after
    /// the host has applied it, as the HTTP API's [`V2Event`]. The streaming deltas (`session.text.delta`,
    /// `session.reasoning.delta`, `session.tool.input.delta`, `session.compaction.delta`) never arrive. A UI thread
    /// that falls more than 1024 events behind (of the types anyone in the TUI listens to) skips the oldest.
    pub fn on_event(&mut self, types: &[&str], run: impl Fn(&dyn Host, &V2Event) + 'static) {
        self.registered.manifest.events.push(types.iter().map(|kind| (*kind).to_owned()).collect());
        self.registered.events.push(Rc::new(run));
    }

    /// Renders Markdown fences of `language`.
    pub fn code_block(&mut self, language: &str, render: impl Fn(&dyn Read, &Fence) -> Fenced + 'static) {
        self.registered.manifest.fences.push(language.to_owned());
        self.registered.fences.push((language.to_owned(), Rc::new(render)));
    }

    /// Renders inline Markdown math, `$…$` and `\(…\)`: `render` gets the TeX without its delimiters and returns
    /// one row, or `None` to show the TeX as typed. Markdown parses math only where a plugin renders it, and display
    /// math (`$$…$$`, `\[…\]`) reaches the [`Setup::code_block`] renderer of `math`. In-process plugins only: the
    /// other loaders do not carry it.
    pub fn inline_math(&mut self, render: impl Fn(&dyn Read, &str) -> Option<Line> + 'static) {
        self.registered.inline_math.push(Rc::new(render));
    }

    /// Claims a place in the slot tree. `render` reads what it shows and returns it; it gets the slot's input and
    /// what changed since it last rendered, and runs again with each change batch, each change of the host's own
    /// state, each wake, and after each of the plugin's commands and event, reply, mount and wake handlers (with
    /// [`Changed::woken`]).
    pub fn slot(&mut self, at: Placement, render: impl Fn(&dyn Read, &SlotInput, &Changed) -> Render + 'static) {
        let claim = SlotClaim { kind: at.kind, path: at.path, mount: false, size: false };
        self.registered.manifest.slots.push(claim);
        self.registered.slots.push(Rc::new(render));
    }

    /// Gives the claim registered last at `at` (by [`Setup::slot`]) its laid-out size in [`SlotInput::width`] and
    /// [`SlotInput::height`], and renders it again with [`Changed::size`] when that changes. Other claims get 0, so a
    /// size they do not read costs them no render. Without a claim at `at`, it does nothing.
    pub fn sized(&mut self, at: Placement) {
        let claims = self.registered.manifest.slots.iter_mut();
        if let Some(claim) = claims.rev().find(|claim| claim.kind == at.kind && claim.path == at.path) {
            claim.size = true;
        }
    }

    /// Calls `run` for each mount of the claim registered last at `at` (by [`Setup::slot`]): with `true` and the slot's
    /// input as the host mounts it, before it first renders, and with `false` as it unmounts it. A plugin keeps state
    /// per mount here, such as a request a mount starts. A slot mounts its claims again when its input changes, and
    /// the next mount may come before the last one goes. Without a claim at `at`, it registers one that draws nothing.
    pub fn on_mount(&mut self, at: Placement, run: impl Fn(&dyn Host, &SlotInput, bool) + 'static) {
        let found =
            self.registered.manifest.slots.iter().rposition(|claim| claim.kind == at.kind && claim.path == at.path);
        let claim = match found {
            Some(claim) => claim,
            None => {
                self.slot(at, |_, _, _| Render::Hide);
                self.registered.manifest.slots.len() - 1
            }
        };
        self.registered.manifest.slots[claim].mount = true;
        self.registered.mounts.push((claim, Rc::new(run)));
    }

    /// Registers route `name`, which [`Host::navigate`] opens as [`Route::Plugin`]. The host draws what `render`
    /// returns centered in a scroll box on the page background; `render` runs again with each change, as a slot
    /// claim's does. Commands of [`Scope::Route`] run while it shows.
    pub fn route(&mut self, name: &str, render: impl Fn(&dyn Read, &Changed) -> Render + 'static) {
        self.registered.manifest.routes.push(name.to_owned());
        self.registered.views.push((name.to_owned(), Rc::new(render)));
    }

    /// Calls `run` for each mount of route `name` (TS `onMount` of the route's page): with `true` as the host mounts
    /// it, before it first renders, however it was opened, and with `false` as it unmounts it. A route starts its
    /// requests here. The host may mount it again before the last mount goes.
    pub fn on_route_mount(&mut self, name: &str, run: impl Fn(&dyn Host, bool) + 'static) {
        if !self.registered.manifest.route_mounts.iter().any(|known| known == name) {
            self.registered.manifest.route_mounts.push(name.to_owned());
        }
        self.registered.route_mounts.push((name.to_owned(), Rc::new(run)));
    }

    /// Calls `run` on the UI thread after the plugin's [`Waker`] woke the host, before its claims and routes render
    /// again with [`Changed::woken`]: a plugin whose thread keeps time asks the host for what a render cannot, such as
    /// a [`Host::try_fetch`]. Wakes that arrive together run it once.
    pub fn on_wake(&mut self, run: impl Fn(&dyn Host) + 'static) {
        self.registered.manifest.wake = true;
        self.registered.wakes.push(Rc::new(run));
    }

    /// Calls `run` on the UI thread after the TUI plugins [`Read::plugins`] lists changed: one was enabled, disabled,
    /// loaded, approved or declined, failed, or became slow. Changes that come together run it once.
    pub fn on_plugins(&mut self, run: impl Fn(&dyn Host) + 'static) {
        self.registered.manifest.plugins = true;
        self.registered.plugins.push(Rc::new(run));
    }

    /// Calls `run` once with the [`Fence::key`] of each block whose output ([`Fenced::Lines`] or [`Fenced::Keep`]) the
    /// host no longer shows, as the block goes or falls back to the code view: the plugin drops the state it kept for
    /// that block. A key whose render returned [`Fenced::Code`] without output shown before does not come back here. It runs on the UI thread, after the event that freed the block.
    pub fn on_fence_gone(&mut self, run: impl Fn(u64) + 'static) {
        self.registered.manifest.fence_gone = true;
        self.registered.fence_gone.push(Rc::new(run));
    }

    /// Calls `run` with each reply to the plugin's [`Host::try_fetch`]es, on the UI thread, with the request's ID. A reply
    /// that arrives after the plugin was disposed is dropped.
    pub fn on_reply(&mut self, run: impl Fn(&dyn Host, RequestId, Result<serde_json::Value, String>) + 'static) {
        self.registered.replies.push(Rc::new(run));
    }

    /// Calls `run` once with the ID of each of the plugin's requests ([`Host::try_fetch`], [`Host::try_foreground`])
    /// that the host cancelled as the mount that owned it closed, on the UI thread: no reply comes for it, and the
    /// [`Setup::on_reply`] handlers never hear of it. A request cancelled after the plugin was disposed is not told.
    pub fn on_cancelled(&mut self, run: impl Fn(&dyn Host, RequestId) + 'static) {
        self.registered.manifest.cancelled = true;
        self.registered.cancelled.push(Rc::new(run));
    }

    /// Calls `run` with the streaming deltas (`session.text.delta`, `session.reasoning.delta`,
    /// `session.tool.input.delta`, `session.compaction.delta`), which [`Setup::on_event`] never gets: the deltas the
    /// host applied since the last call, or since setup, oldest first, at most once a frame and before it, never
    /// empty, with a store batch's deltas in one call (TS `data.on(type)` once an event). The host keeps at most 4096
    /// between calls and drops the oldest past that.
    pub fn on_deltas(&mut self, run: impl Fn(&dyn Host, &[V2Event]) + 'static) {
        self.registered.manifest.deltas = true;
        self.registered.deltas.push(Rc::new(run));
    }

    /// Registers a surface of contract 2.0 ([`v2`]): a route or a slot claim whose view returns a keyed tree, which
    /// the host reconciles ([`Request::View`]).
    pub fn surface(&mut self, surface: v2::Surface) {
        let claim = SurfaceClaim {
            name: surface.name.clone(),
            place: (&surface.place).into(),
            palette: surface.palette,
            draw: surface.draw.is_some(),
            notify: surface.notify.clone(),
            layout: surface.layout.is_some(),
            handler: surface.handler.is_some(),
            layers: surface.layers.clone(),
            mounts: surface.mounts,
        };
        self.registered.manifest.surfaces.push(claim);
        self.registered.surfaces.push(surface);
    }

    /// Registers what the plugin's threads send: `run` gets each message on the UI thread, in the order the mailbox
    /// holds them, as the plugin's `update`, with the host of a command; the plugin's claims and surfaces render again
    /// after it. The [`Sender`] it returns sends from any thread (see [`mail`]). A plugin has one message type: a
    /// second call is an error. A sender without a host is closed.
    pub fn messages<M>(&mut self, run: impl Fn(&dyn Host, M) + 'static) -> Result<Sender<M>, String>
    where
        M: Serialize + serde::de::DeserializeOwned + Send + 'static,
    {
        if self.registered.message.is_some() {
            return Err("a plugin has one message type: messages is registered once".to_owned());
        }
        self.registered.manifest.messages = true;
        self.registered.message = Some(Rc::new(mail::handler(run)));
        Ok(Sender::new(self.registered.link.clone()))
    }

    /// What starts the plugin's threads, each with the plugin's [`Stop`] flag and a panic caught and reported.
    pub fn spawner(&self) -> Spawner {
        Spawner::new(&self.registered.manifest.id, self.registered.link.clone())
    }

    /// What starts the plugin's tasks ([`task`]): handlers that wait for a dialog's answer or a reply in a straight
    /// line. The first call registers what drives them: hidden commands, `<id>.task.answer.0` to `.7` and
    /// `<id>.task.closed`, a reply handler, a wake handler and a dispose callback; a later call returns the same tasks.
    pub fn tasks(&mut self) -> task::Tasks {
        if let Some(shared) = &self.registered.tasks {
            return task::tasks(shared);
        }
        let shared = task::register(self);
        self.registered.tasks = Some(shared.clone());
        task::tasks(&shared)
    }

    /// The host's optional features, for a plugin that uses one when it is there.
    pub fn features(&self) -> &[String] {
        &self.registered.features
    }

    /// What the host serves the plugin: its major, minor and features ([`Read::abi`]). Its features are
    /// [`Setup::features`], on every carrier.
    pub fn abi(&self) -> Abi {
        let served = match self.host {
            Some(host) => host.abi(),
            None => Abi::current(),
        };
        Abi::new(served.major, served.minor, self.registered.features.clone())
    }

    /// A search a [`Select`] names (`search`): with the host's reads, the query and the select's enabled options, it
    /// returns the values of the options to list, in order (TS `dialog.select`'s `search`). It runs as one call of the
    /// plugin, with no effects, while the user types ([`Request::Search`]).
    pub fn search(&mut self, name: &str, search: impl Fn(&dyn Read, &str, &[SelectOption]) -> Vec<String> + 'static) {
        self.registered.manifest.searches.push(name.to_owned());
        self.registered.searches.push((name.to_owned(), Rc::new(search)));
    }

    /// Keys the plugin takes while `layer`'s scope holds ([`interact::Layer`]): of the composer, or global. They are
    /// the plugin's until it leaves `active`. A layer of a surface's own scope belongs on [`v2::Surface::layers`].
    /// Its handler runs as [`Request::Input`].
    pub fn layer(
        &mut self,
        layer: interact::Layer,
        handler: impl Fn(&dyn Host, &interact::Event) -> interact::Handled + 'static,
    ) {
        self.registered.manifest.layers.push(layer.clone());
        self.registered.layers.push((layer, Rc::new(handler)));
    }

    /// Registers a renderer claim of contract 2.0 ([`claim`]): the tool calls of one tool, or the fences of one
    /// language, drawn in the transcript with a keyed tree, and the host's own row where the claim declines. At one
    /// tool or language the plugin last in activation order wins.
    pub fn claim(&mut self, claim: claim::Claim) {
        self.registered.manifest.claims.push((&claim).into());
        self.registered.claims.push(claim);
    }
}

/// What a plugin registered, which the host keeps while the plugin is active; the plugin registers through a
/// [`Setup`] it lends.
#[doc(hidden)]
#[derive(Default)]
pub struct Registered {
    manifest: Manifest,
    options: Option<String>,
    host: HostHandle,
    waker: Option<Waker>,
    fences: Vec<(String, FenceFn)>,
    inline_math: Vec<InlineMathFn>,
    slots: Vec<RenderFn>,
    views: Vec<(String, RouteFn)>,
    commands: Vec<CommandFn>,
    events: Vec<EventFn>,
    replies: Vec<ReplyFn>,
    cancelled: Vec<CancelledFn>,
    /// The mount handlers, with the index of their claim in [`Manifest::slots`].
    mounts: Vec<(usize, MountFn)>,
    route_mounts: Vec<(String, RouteMountFn)>,
    wakes: Vec<WakeFn>,
    /// The handlers of [`Setup::on_plugins`].
    plugins: Vec<WakeFn>,
    fence_gone: Vec<FenceGoneFn>,
    deltas: Vec<DeltasFn>,
    disposers: Vec<DisposeFn>,
    surfaces: Vec<v2::Surface>,
    /// The handler of [`Setup::messages`].
    message: Option<MessageFn>,
    /// What the plugin's threads reach the host through; disposal revokes it.
    link: mail::Revocable,
    features: Vec<String>,
    layers: Vec<(interact::Layer, interact::HandlerFn)>,
    searches: Vec<(String, SearchFn)>,
    claims: Vec<claim::Claim>,
    /// The plugin's tasks, once [`Setup::tasks`] registered them.
    tasks: Option<Rc<task::Shared>>,
}

/// A registered handler of [`Setup::messages`].
pub type MessageFn = Rc<dyn Fn(&dyn Host, mail::Message)>;
/// A search of [`Setup::search`].
pub type SearchFn = Rc<dyn Fn(&dyn Read, &str, &[SelectOption]) -> Vec<String>>;

impl Registered {
    /// The registrations of a plugin the host runs in process: without an ABI host, so a [`Setup`] of its own
    /// ([`Registered::setup`]) answers every request with an error.
    pub fn new(id: &str, options: Option<String>) -> Self {
        let registered =
            Self { manifest: Manifest { id: id.to_owned(), ..Manifest::default() }, options, ..Self::default() };
        Self { features: Abi::current().features, ..registered }
    }

    /// The setup that registers here, with the registration's own host.
    pub fn setup(&mut self) -> Setup<'_> {
        Setup { registered: self, host: None }
    }

    /// The setup that registers here, with `host`.
    pub fn setup_with<'a>(&'a mut self, host: &'a dyn Host) -> Setup<'a> {
        Setup { registered: self, host: Some(host) }
    }

    /// Sets what [`Setup::waker`] returns, for a plugin the host runs in process.
    pub fn set_waker(&mut self, waker: Waker) {
        self.waker = Some(waker);
    }

    /// Sets what the plugin's threads reach the host through ([`Setup::messages`], [`Setup::spawner`]), for a plugin
    /// the host runs in process.
    pub fn set_link(&mut self, link: Arc<dyn mail::Link>) {
        self.link = mail::Revocable::new(link);
    }

    /// The handler of [`Setup::messages`].
    pub fn message(&self) -> Option<&MessageFn> {
        self.message.as_ref()
    }

    /// Disposes the plugin: revokes its waker and its threads' link, waiting for the uses in progress, then runs the
    /// dispose callbacks, last registered first, with `host` (the registration's own without one). A callback that
    /// panics does not keep the others from running.
    pub fn dispose(&mut self, host: Option<&dyn Host>) {
        if let Some(waker) = &self.waker {
            waker.revoke();
        }
        self.link.revoke();
        let (disposers, own) = (std::mem::take(&mut self.disposers), self.host.clone());
        let host = host.unwrap_or(&own);
        for run in disposers.into_iter().rev() {
            // What a callback that panics asked for is dropped, and what the others asked for stays.
            let mark = host.checkpoint();
            if let Err(panic) = catch_unwind(AssertUnwindSafe(|| run(host))) {
                if let Some(mark) = mark {
                    host.rollback(mark);
                }
                own.log(Level::Error, &format!("a dispose callback panicked: {}", panic_message(&*panic)));
            }
        }
    }

    /// Ends a plugin the host failed, which it calls no more: revokes its waker, waiting for the wakes in progress,
    /// and drops its dispose callbacks without running them.
    pub fn abandon(&mut self) {
        if let Some(waker) = &self.waker {
            waker.revoke();
        }
        self.link.revoke();
        self.disposers.clear();
        // Its tasks drop here, each inside a catch, not later wherever the host drops the registrations.
        if let Some(tasks) = &self.tasks {
            tasks.abandon();
        }
    }

    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    pub fn fences(&self) -> &[(String, FenceFn)] {
        &self.fences
    }

    /// The renders of [`Setup::inline_math`].
    pub fn inline_math(&self) -> &[InlineMathFn] {
        &self.inline_math
    }

    /// The slot claims of [`Setup::slot`], with their index in [`Manifest::slots`] and their renders.
    pub fn renders(&self) -> impl Iterator<Item = (usize, &SlotClaim, &RenderFn)> {
        self.manifest.slots.iter().zip(&self.slots).enumerate().map(|(index, (claim, render))| (index, claim, render))
    }

    /// The mount handlers, with the index of their claim in [`Manifest::slots`].
    pub fn mounts(&self) -> &[(usize, MountFn)] {
        &self.mounts
    }

    /// The route mount handlers, with their route.
    pub fn route_mounts(&self) -> &[(String, RouteMountFn)] {
        &self.route_mounts
    }

    /// The commands, with their runs.
    pub fn commands(&self) -> impl Iterator<Item = (&Command, &CommandFn)> {
        self.manifest.commands.iter().zip(&self.commands)
    }

    /// The routes of [`Setup::route`], with their renders.
    pub fn routes(&self) -> &[(String, RouteFn)] {
        &self.views
    }

    /// The wake handlers.
    pub fn wakes(&self) -> &[WakeFn] {
        &self.wakes
    }

    /// The handlers of [`Setup::on_plugins`].
    pub fn plugins(&self) -> &[WakeFn] {
        &self.plugins
    }

    /// The handlers of [`Setup::on_fence_gone`].
    pub fn fence_gone(&self) -> &[FenceGoneFn] {
        &self.fence_gone
    }

    /// The reply handlers.
    pub fn replies(&self) -> &[ReplyFn] {
        &self.replies
    }

    /// The handlers of [`Setup::on_cancelled`].
    pub fn cancelled(&self) -> &[CancelledFn] {
        &self.cancelled
    }

    /// The handlers of [`Setup::on_deltas`].
    pub fn deltas(&self) -> &[DeltasFn] {
        &self.deltas
    }

    /// The surfaces of [`Setup::surface`].
    pub fn surfaces(&self) -> &[v2::Surface] {
        &self.surfaces
    }

    /// The searches of [`Setup::search`], by name.
    pub fn searches(&self) -> &[(String, SearchFn)] {
        &self.searches
    }

    /// The layers of [`Setup::layer`], with their handlers.
    pub fn layers(&self) -> &[(interact::Layer, interact::HandlerFn)] {
        &self.layers
    }

    /// The renderer claims of [`Setup::claim`].
    pub fn claims(&self) -> &[claim::Claim] {
        &self.claims
    }

    /// The event handlers, with the types each takes.
    pub fn events(&self) -> impl Iterator<Item = (&[String], &EventFn)> {
        self.manifest.events.iter().map(Vec::as_slice).zip(&self.events)
    }
}

/// A plugin the host runs in process: its ID and setup.
#[derive(Clone, Copy)]
pub struct Plugin {
    pub id: &'static str,
    pub setup: fn(&mut Setup) -> Result<(), String>,
}

/// The text of a caught panic.
pub fn panic_message(panic: &(dyn std::any::Any + Send)) -> String {
    panic
        .downcast_ref::<&str>()
        .map(|message| (*message).to_owned())
        .or_else(|| panic.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "a panic without a message".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_timers_delay_rounds_up_to_whole_milliseconds() {
        let ms = |micros: u64| timer_ms(std::time::Duration::from_micros(micros));
        assert_eq!([ms(0), ms(1), ms(20_000), ms(20_900), ms(20_001)], [0, 1, 20, 21, 21]);
        assert_eq!(timer_ms(std::time::Duration::MAX), u64::MAX);
    }

    #[test]
    fn image_size_reads_each_format_header() {
        let png = |width: u32, height: u32| {
            let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
            bytes.extend(width.to_be_bytes().into_iter().chain(height.to_be_bytes()));
            bytes
        };
        assert_eq!(image_size(&png(8, 4)), Some((8, 4)));
        assert_eq!(image_size(&png(0, 4)), None, "a header of no pixels");
        assert_eq!(image_size(b"GIF89a\x03\0\x05\0"), Some((3, 5)));
        let webp = |chunk: &[u8], body: &[u8]| [b"RIFF\0\0\0\0WEBP".as_slice(), chunk, b"\0\0\0\0", body].concat();
        assert_eq!(image_size(&webp(b"VP8 ", b"\0\0\0\x9d\x01\x2a\x07\0\x09\0")), Some((7, 9)));
        let bits: u32 = (7 - 1) | ((9 - 1) << 14);
        assert_eq!(image_size(&webp(b"VP8L", &[[0x2f].as_slice(), &bits.to_le_bytes()].concat())), Some((7, 9)));
        assert_eq!(image_size(&webp(b"VP8X", b"\0\0\0\0\x06\0\0\x08\0\0")), Some((7, 9)));
        let frame = b"\xff\xc0\x00\x11\x08\x00\x09\x00\x07";
        let jpeg = |middle: &[u8]| [b"\xff\xd8".as_slice(), middle, frame].concat();
        assert_eq!(image_size(&jpeg(b"\xff\xe0\x00\x04\0\0")), Some((7, 9)));
        assert_eq!(image_size(&jpeg(b"\xff\xe0\x00\x04\0\0\xff")), Some((7, 9)), "a fill byte");
        assert_eq!(image_size(&jpeg(b"\xff\xd0")), Some((7, 9)), "a standalone marker");
        assert_eq!(image_size(&jpeg(b"\xff\xe0\x00\x00")), None, "a length under 2");
        assert_eq!(image_size(b"not an image"), None);
    }

    /// The registrations a test's setup made.
    impl std::ops::Deref for Setup<'_> {
        type Target = Registered;

        fn deref(&self) -> &Registered {
            self.registered
        }
    }

    #[test]
    fn colors_and_rows_round_trip() {
        let line = vec![Span { bg: Some(Rgba::new(255, 255, 255, 20).into()), ..Span::new("a").fg("#102030") }];
        let fenced = Fenced::Lines { lines: vec![line], fg: Some(Rgba::new(1, 2, 3, 255).into()), drag: true };
        let json = r##"{"type":"lines","lines":[[{"text":"a","fg":"#102030","bg":"#ffffff14"}]],"fg":"#010203ff","drag":true}"##;
        assert_eq!(serde_json::to_string(&fenced).unwrap(), json);
        assert_eq!(serde_json::from_str::<Fenced>(json).unwrap(), fenced);
        let plain = Fenced::Lines { lines: Vec::new(), fg: None, drag: false };
        assert_eq!(serde_json::to_string(&plain).unwrap(), r#"{"type":"lines","lines":[]}"#);
        let fence: Fence =
            serde_json::from_str(r#"{"language":"x","info":"x","code":"a","streaming":false,"closed":true,"key":1}"#)
                .unwrap();
        assert_eq!(fence.width, 0);
        assert_eq!(Rgba::parse("#0a0b0c"), Some(Rgba::new(10, 11, 12, 255)));
        assert_eq!(Rgba::parse("#0a0b0"), None);
        assert_eq!(Rgba::parse("#+a+b+c"), None);
    }

    #[test]
    fn a_revoked_waker_waits_for_the_wake_in_progress_and_does_nothing_after() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::mpsc;
        let (entered, enter) = mpsc::channel();
        let (leave, left) = mpsc::channel::<()>();
        let left = std::sync::Mutex::new(left);
        let wakes = Arc::new(AtomicUsize::new(0));
        let counted = wakes.clone();
        let waker = Waker::new(move || {
            entered.send(()).unwrap();
            left.lock().unwrap().recv().unwrap();
            counted.fetch_add(1, Ordering::SeqCst);
        });
        let thread = std::thread::spawn({
            let waker = waker.clone();
            move || waker.wake()
        });
        enter.recv().unwrap();
        let revoked = std::thread::spawn({
            let (waker, wakes) = (waker.clone(), wakes.clone());
            move || {
                waker.revoke();
                wakes.load(Ordering::SeqCst)
            }
        });
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(!revoked.is_finished(), "revoke returned while a wake was in progress");
        leave.send(()).unwrap();
        assert_eq!(revoked.join().unwrap(), 1);
        thread.join().unwrap();
        waker.wake();
        assert_eq!(wakes.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_plugin_registers_one_message_type() {
        let mut registered = Registered::new("x", None);
        let mut setup = registered.setup();
        assert!(setup.messages(|_, _: u64| {}).is_ok());
        assert!(setup.messages(|_, _: i64| {}).is_err());
        assert!(setup.manifest().messages);
    }

    #[test]
    fn a_message_json_cannot_carry_is_handed_back() {
        struct Failing;
        impl Serialize for Failing {
            fn serialize<S: serde::Serializer>(&self, _: S) -> Result<S::Ok, S::Error> {
                Err(serde::ser::Error::custom("no"))
            }
        }
        impl<'de> Deserialize<'de> for Failing {
            fn deserialize<D: serde::Deserializer<'de>>(_: D) -> Result<Self, D::Error> {
                Ok(Failing)
            }
        }
        let closed = mail::Revocable::default();
        assert!(matches!(Sender::<f64>::new(closed.clone()).send(f64::NAN), Err(SendError::Unencodable(_))));
        assert_eq!(Sender::<f64>::new(closed.clone()).send(1.5), Err(SendError::Closed(1.5)));
        let wide = u128::from(u64::MAX) + 1;
        assert_eq!(Sender::<u128>::new(closed.clone()).send(wide), Err(SendError::Closed(wide)));
        assert_eq!(Sender::<u128>::new(closed.clone()).send(7), Err(SendError::Closed(7)));
        let keys = std::collections::BTreeMap::from([(vec![1u8], 1u8)]);
        let sender = Sender::<std::collections::BTreeMap<Vec<u8>, u8>>::new(closed.clone());
        assert!(matches!(sender.send(keys), Err(SendError::Unencodable(_))));
        assert!(matches!(Sender::<Failing>::new(closed).send(Failing), Err(SendError::Unencodable(_))));
    }

    #[test]
    fn content_crosses_whole() {
        for (bytes, base64) in
            [(&b""[..], ""), (b"f", "Zg=="), (b"fo", "Zm8="), (b"foo", "Zm9v"), (b"foob", "Zm9vYg==")]
        {
            assert_eq!(base64::encode(bytes), base64);
            assert_eq!(base64::decode(base64).as_deref(), Some(bytes));
        }
        assert_eq!(base64::decode("Zm9v=Zg="), None);
        assert_eq!(base64::decode("Zm9"), None);
        assert_eq!(base64::decode("Zm9!"), None, "a byte out of the alphabet");
        let every: Vec<u8> = (0..=255).chain((0..=255).rev()).collect();
        assert_eq!(base64::encode(&every[..255]).len(), 340);
        for len in 0..every.len() {
            assert_eq!(base64::decode(&base64::encode(&every[..len])).as_deref(), Some(&every[..len]), "{len}");
        }
        let binary = Blob(vec![0xff, 0x00, 0x89, b'P', b'N', b'G']);
        let json = serde_json::to_string(&binary).unwrap();
        assert_eq!(json, r#"{"base64":"/wCJUE5H"}"#);
        assert_eq!(serde_json::from_str::<Blob>(&json).unwrap(), binary);
        assert_eq!(serde_json::to_string(&Blob(b"text".to_vec())).unwrap(), r#""text""#);
    }

    #[test]
    fn a_plugin_thread_carries_the_plugin_name() {
        let (named, name) = std::sync::mpsc::channel();
        let spawner = Spawner::new("x.y", mail::Revocable::default());
        spawner.spawn("work", move |_| named.send(std::thread::current().name().map(str::to_owned)).unwrap()).unwrap();
        assert_eq!(name.recv().unwrap().as_deref(), Some("x.y:work"));
    }
}
