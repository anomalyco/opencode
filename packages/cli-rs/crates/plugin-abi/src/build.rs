//! Constructors and setters of the types a plugin builds. The contract's types are
//! `#[non_exhaustive]` to a plugin's crate, so it builds one from `Type::new(what it must have)` (or `Default`) and a
//! setter for each other field, named for the field; a field or a variant a later 2.x adds is then no break of its
//! source. Struct variants a plugin builds (a scroll verb, a target, an edit) do not grow: a later 2.x adds a variant
//! instead.
//!
//! ```
//! use opencode_plugin_abi::{Absolute, Command, Layout};
//! let command = Command::new("queue.manager.open").title("Queue Manager").group("Queue Manager").palette().slash("qm");
//! assert_eq!(command.slash.as_deref(), Some("qm"));
//! let layout = Layout::default().absolute(Absolute::new().top(0).right(1).z(10));
//! assert_eq!(layout.absolute.and_then(|at| at.right), Some(1));
//! ```
//!
//! A literal, even one that takes the rest from the default, does not compile outside the SDK:
//!
//! ```compile_fail,E0639
//! let fetch = opencode_plugin_abi::Fetch { path: "/api/x".to_owned(), ..Default::default() };
//! ```

use crate::interact::{self, Anchor, Bind, LayerScope, OpenPanel, Overlay};
use crate::v2::{self, DiffView, Fit, MountId, Node, Paint, Source, Split};
use crate::{
    Absolute, Action, Alert, Attention, Border, BorderStyle, Click, Color, Command, Confirm, ConfirmLabel,
    DialogSurface, Edges, ErrorDetails, Fetch, Foreground, Gutter, Image, Images, Layout, Panel, PanelAction,
    PanelBind, PanelSize, Press, Prompt, Scope, Select, SelectAction, SelectOption, Sides, Sound, SoundName, Span,
    TitleAlign, Toast, Variant, When, Width,
};

/// A setter of each field of `$ty` but those in `[…]`, which its constructor or a setter of its own sets. `field: T`
/// takes a `T`, `field: impl T` anything that converts into `T`, and `field: [T]` anything that iterates `T`;
/// `field?: T` and `field?: impl T` set `Some` of the same; `field!` sets a flag. With them come `maybe` and `when`,
/// for a value that is an `Option` or a flag that is a `bool`. The macro names every field of `$ty` once, so a field
/// added without its setter does not build.
macro_rules! builder {
    ($($ty:ident)::+ [$($own:ident),* $(,)?] { $($fields:tt)* }) => {
        builder!(@ [$($ty)::+] [$($own)*] [] $($fields)*);
    };
    (@ $ty:tt $names:tt $setters:tt $field:ident: [$item:ty] $(, $($rest:tt)*)?) => {
        builder!(@set $ty $names $setters $field (impl IntoIterator<Item = $item>) ($field.into_iter().collect()) $($($rest)*)?);
    };
    (@ $ty:tt $names:tt $setters:tt $field:ident?: impl $value:ty $(, $($rest:tt)*)?) => {
        builder!(@set $ty $names $setters $field (impl Into<$value>) (Some($field.into())) $($($rest)*)?);
    };
    (@ $ty:tt $names:tt $setters:tt $field:ident?: $value:ty $(, $($rest:tt)*)?) => {
        builder!(@set $ty $names $setters $field ($value) (Some($field)) $($($rest)*)?);
    };
    (@ $ty:tt [$($names:ident)*] [$($setters:tt)*] $field:ident! $(, $($rest:tt)*)?) => {
        builder!(@ $ty [$($names)* $field] [$($setters)*
            #[doc = concat!("Sets [`Self::", stringify!($field), "`].")]
            pub fn $field(mut self) -> Self {
                self.$field = true;
                self
            }
        ] $($($rest)*)?);
    };
    (@ $ty:tt $names:tt $setters:tt $field:ident: impl $value:ty $(, $($rest:tt)*)?) => {
        builder!(@set $ty $names $setters $field (impl Into<$value>) ($field.into()) $($($rest)*)?);
    };
    (@ $ty:tt $names:tt $setters:tt $field:ident: $value:ty $(, $($rest:tt)*)?) => {
        builder!(@set $ty $names $setters $field ($value) ($field) $($($rest)*)?);
    };
    (@set $ty:tt [$($names:ident)*] [$($setters:tt)*] $field:ident ($($param:tt)*) ($($value:tt)*) $($rest:tt)*) => {
        builder!(@ $ty [$($names)* $field] [$($setters)*
            #[doc = concat!("Sets [`Self::", stringify!($field), "`].")]
            pub fn $field(mut self, $field: $($param)*) -> Self {
                self.$field = $($value)*;
                self
            }
        ] $($rest)*);
    };
    (@ [$($ty:ident)::+] [$($names:ident)*] [$($setters:tt)*]) => {
        impl $($ty)::+ {
            $($setters)*

            /// Calls setter `set` with `value` when it is `Some`: `.maybe(focus, Select::focus)`.
            pub fn maybe<V>(self, value: Option<V>, set: impl FnOnce(Self, V) -> Self) -> Self {
                match value {
                    Some(value) => set(self, value),
                    None => self,
                }
            }

            /// Calls setter `set` when `on`: `.when(centered, Panel::centered)`.
            pub fn when(self, on: bool, set: impl FnOnce(Self) -> Self) -> Self {
                if on { set(self) } else { self }
            }

            #[allow(dead_code)]
            fn every_field_is_set(self) {
                let Self { $($names: _),* } = self;
            }
        }
    };
}

impl Command {
    /// Command `name`, with no title, outside the palette and on no key.
    pub fn new(name: impl Into<String>) -> Self {
        Self { name: name.into(), ..Self::default() }
    }
}

builder!(Command [name, enabled] {
    title: impl String,
    group?: impl String,
    slash?: impl String,
    keybind?: impl String,
    palette!,
    description?: impl String,
    arguments!,
    scope: Scope,
    aliases: [String],
});

impl Command {
    /// The command starts disabled ([`Command::enabled`]), until [`crate::Host::set_enabled`] enables it.
    pub fn disabled(mut self) -> Self {
        self.enabled = false;
        self
    }
}

impl Span {
    pub fn new(text: impl Into<String>) -> Self {
        Self { text: text.into(), ..Self::default() }
    }
}

builder!(Span [text] {
    fg?: impl Color,
    bg?: impl Color,
    bold!,
    italic!,
    underline!,
    dim!,
    strikethrough!,
    link?: impl String,
});

impl Border {
    /// A single white line on all four sides.
    pub fn new() -> Self {
        Self::default()
    }
}

builder!(Border [] {
    sides: Sides,
    style: BorderStyle,
    color?: impl Color,
    title?: impl String,
    title_align: TitleAlign,
    bottom_title?: impl String,
    bottom_title_align: TitleAlign,
});

impl Action {
    /// Runs command `name` with no input.
    pub fn command(name: impl Into<String>) -> Self {
        Action::Command { name: name.into(), input: None }
    }

    /// The action with `value` as its input.
    pub fn input(self, value: impl Into<String>) -> Self {
        match self {
            Action::Command { name, .. } => Action::Command { name, input: Some(value.into()) },
        }
    }
}

impl Click {
    /// A click that runs `action` on release.
    pub fn new(action: Action) -> Self {
        Self { action, on: Press::Up }
    }
}

builder!(Click [action] { on: Press });

/// A count of cells: `.min_width(0)` for `.min_width(Width::Cells(0))`.
impl From<u16> for Width {
    fn from(cells: u16) -> Self {
        Width::Cells(cells)
    }
}

builder!(Layout [] {
    width?: impl Width,
    grow!,
    shrink?: bool,
    min_width?: impl Width,
    max_width?: impl Width,
    height?: impl Width,
    min_height?: impl Width,
    max_height?: impl Width,
    margin?: Edges,
    absolute?: Absolute,
});

impl Absolute {
    /// Against no edge, painted in its siblings' order.
    pub fn new() -> Self {
        Self::default()
    }
}

builder!(Absolute [] { top?: i16, right?: i16, bottom?: i16, left?: i16, z: i32 });

impl Toast {
    pub fn new(variant: Variant, message: impl Into<String>) -> Self {
        Self { variant, title: None, message: message.into(), session: None }
    }
}

builder!(Toast [variant, message] { title?: impl String, session?: impl String });

impl Foreground {
    /// Runs `command`, with no arguments, in the session's directory.
    pub fn new(command: impl Into<String>) -> Self {
        Self { command: command.into(), ..Self::default() }
    }
}

builder!(Foreground [command] { args: [String], cwd?: impl String });

impl Attention {
    /// `message`, with no title, notification or sound.
    pub fn new(message: impl Into<String>) -> Self {
        Self { title: None, message: message.into(), notify: None, sound: None }
    }
}

builder!(Attention [message] { title?: impl String, notify?: When, sound?: Sound });

impl Sound {
    /// `name`, `when` the window allows it, at the host's volume.
    pub fn new(name: SoundName, when: When) -> Self {
        Self { name, when, volume: None }
    }
}

builder!(Sound [name, when] { volume?: f64 });

impl Fetch {
    /// A `method` request of `path`, with no query or body.
    pub fn new(method: impl Into<String>, path: impl Into<String>) -> Self {
        Self { method: method.into(), path: path.into(), ..Self::default() }
    }

    /// Sets [`Self::query`] to `pairs`.
    pub fn query(mut self, pairs: impl IntoIterator<Item = (impl Into<String>, impl Into<String>)>) -> Self {
        self.query = pairs.into_iter().map(|(key, value)| (key.into(), value.into())).collect();
        self
    }
}

builder!(Fetch [method, path, query] { body?: serde_json::Value, bytes! });

impl Prompt {
    /// A text field under `title` whose enter runs `action` with the text.
    pub fn new(title: impl Into<String>, action: Action) -> Self {
        Self { title: title.into(), placeholder: None, value: None, description: None, action }
    }
}

builder!(Prompt [title, action] { placeholder?: impl String, value?: impl String, description?: impl String });

impl Images {
    /// A preview of `images`, from the first.
    pub fn new(images: Vec<Image>) -> Self {
        Self { images, index: 0 }
    }
}

builder!(Images [images] { index: usize });

impl Image {
    /// An image of `data`, its bytes in base64, with no name.
    pub fn new(data: impl Into<String>) -> Self {
        Self { data: data.into(), name: None }
    }
}

builder!(Image [data] { name?: impl String });

impl ErrorDetails {
    /// The host's view of `error` under `title`.
    pub fn new(title: impl Into<String>, error: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            error: error.into(),
            source: None,
            context: None,
            back: None,
            reference: None,
            key: None,
            plugin: None,
        }
    }
}

builder!(ErrorDetails [title, error] {
    source?: impl String,
    context?: impl String,
    back?: Action,
    reference?: impl String,
    key?: impl String,
    plugin?: impl String,
});

impl Confirm {
    /// A question that runs `action` when answered, with the host's labels.
    pub fn new(title: impl Into<String>, message: impl Into<String>, action: Action) -> Self {
        Self {
            title: title.into(),
            message: message.into(),
            label: ConfirmLabel::default(),
            action,
            size: None,
            centered: false,
        }
    }

    /// The buttons labelled `confirm` and `cancel`.
    pub fn labels(mut self, confirm: impl Into<String>, cancel: impl Into<String>) -> Self {
        self.label = ConfirmLabel { confirm: Some(confirm.into()), cancel: Some(cancel.into()) };
        self
    }
}

builder!(Confirm [title, message, action, label] { size?: PanelSize, centered! });

builder!(ConfirmLabel [] { confirm?: impl String, cancel?: impl String });

impl Alert {
    /// A notice under `title`, closed with no action.
    pub fn new(title: impl Into<String>, message: impl Into<String>) -> Self {
        Self { title: title.into(), message: message.into(), action: None, size: None, centered: false }
    }
}

builder!(Alert [title, message] { action?: Action, size?: PanelSize, centered! });

impl DialogSurface {
    /// A new mount of dialog surface `surface`, medium, under the surface's name.
    pub fn new(surface: impl Into<String>) -> Self {
        Self { surface: surface.into(), key: None, size: None, centered: false, title: None }
    }
}

builder!(DialogSurface [surface] { key?: impl String, size?: PanelSize, centered!, title?: impl String });

builder!(Select [title, options, action] {
    placeholder?: impl String,
    current?: impl String,
    key?: impl String,
    actions: [SelectAction],
    binds: [PanelBind],
    search?: impl String,
    size?: PanelSize,
    focus?: impl String,
    query?: Action,
    query_delay: u16,
    filterless!,
    empty?: Span,
    note?: Span,
    centered!,
});

impl SelectOption {
    pub fn new(title: impl Into<String>, value: impl Into<String>) -> Self {
        Self { title: title.into(), value: value.into(), ..Self::default() }
    }
}

builder!(SelectOption [title, value] {
    description?: impl String,
    footer?: impl String,
    category?: impl String,
    disabled!,
    footer_color?: impl Color,
    gutter?: Gutter,
    action?: Action,
    toggle?: impl String,
    search_text?: impl String,
});

impl SelectAction {
    /// A footer action `title` that runs `action`.
    pub fn new(title: impl Into<String>, action: Action) -> Self {
        Self {
            title: title.into(),
            key: None,
            action,
            hidden: Vec::new(),
            primary: None,
            rowless: false,
            command: None,
            disabled: false,
            hidden_all: false,
        }
    }
}

builder!(SelectAction [title, action] {
    key?: impl String,
    hidden: [String],
    primary?: bool,
    rowless!,
    command?: impl String,
    disabled!,
    hidden_all!,
});

impl Panel {
    /// A panel of `key` with `title` over `body`, of the medium size and nothing more.
    pub fn new(key: impl Into<String>, title: impl Into<Vec<Span>>, body: crate::Node) -> Self {
        Self {
            key: key.into(),
            size: PanelSize::default(),
            title: title.into(),
            subtitle: None,
            body,
            actions: Vec::new(),
            binds: Vec::new(),
            bleed: false,
            centered: false,
            bare: false,
            close: None,
            height: None,
            fit_screen: false,
        }
    }
}

builder!(Panel [key, title, body] {
    size: PanelSize,
    subtitle?: impl String,
    actions: [PanelAction],
    binds: [PanelBind],
    bleed!,
    centered!,
    bare!,
    close?: impl String,
    height?: u16,
    fit_screen!,
});

impl PanelAction {
    /// A footer action `title` that runs `action`.
    pub fn new(title: impl Into<String>, action: Action) -> Self {
        Self { title: title.into(), key: None, color: None, close: false, action }
    }
}

builder!(PanelAction [title, action] { key?: impl String, color?: impl Color, close! });

impl PanelBind {
    /// Key `key`, shown as `title`, runs `action`.
    pub fn new(key: impl Into<String>, title: impl Into<String>, action: Action) -> Self {
        Self { key: key.into(), title: title.into(), action }
    }
}

builder!(PanelBind [key, title, action] {});

builder!(interact::Layer [] { scope: LayerScope, priority: i32, mode?: impl String, keys: [Bind], any!, paste! });

// `command` is a constructor's: [`Bind::command`].
builder!(interact::Bind [name, command] { key: impl String, title?: impl String, hold! });

builder!(interact::PanelInput [] { width: u16, fullscreen!, focused!, forced! });

builder!(interact::Interact [] { focusable!, pointer!, hover?: impl Color, hover_events! });

impl OpenPanel {
    /// Opens panel `surface` beside the session on screen.
    pub fn new(surface: impl Into<String>) -> Self {
        Self { surface: surface.into(), session: None, fullscreen: false }
    }
}

builder!(interact::OpenPanel [surface] { session?: impl String, fullscreen! });

impl Overlay {
    pub fn new(surface: impl Into<String>, anchor: Anchor, width: u16, height: u16) -> Self {
        Self { surface: surface.into(), anchor, width, height }
    }
}

builder!(interact::Overlay [surface, anchor, width, height] {});

impl crate::LocationRef {
    pub fn new(directory: impl Into<String>, workspace: Option<String>) -> Self {
        Self { directory: directory.into(), workspace }
    }
}

impl MountId {
    pub fn new(surface: impl Into<String>, key: impl Into<String>, generation: u64) -> Self {
        Self { surface: surface.into(), key: key.into(), generation }
    }
}

impl v2::PartRef {
    /// The tool call `part` of session `session`.
    pub fn new(session: impl Into<String>, part: impl Into<String>) -> Self {
        Self { session: session.into(), part: part.into() }
    }
}

impl Split {
    /// A split whose first child starts `at` cells wide.
    pub fn new(at: u16) -> Self {
        Self { at, min: 0 }
    }
}

builder!(v2::Split [at] { min: u16 });

impl Paint {
    pub fn new(node: impl Into<String>, bg: impl Into<Color>) -> Self {
        Self { node: node.into(), bg: bg.into() }
    }
}

impl v2::LayoutReply {
    /// The reply that asks for another view in this frame.
    pub fn again(mut self) -> Self {
        self.again = true;
        self
    }
}

impl Node {
    /// Calls setter `set` with `value` when it is `Some`, as a builder's `maybe` does.
    pub fn maybe<V>(self, value: Option<V>, set: impl FnOnce(Self, V) -> Self) -> Self {
        match value {
            Some(value) => set(self, value),
            None => self,
        }
    }

    /// Calls setter `set` when `on`, as a builder's `when` does.
    pub fn when(self, on: bool, set: impl FnOnce(Self) -> Self) -> Self {
        if on { set(self) } else { self }
    }

    /// The claims of slot `path`, in place.
    pub fn slot(path: impl Into<String>) -> Self {
        Node::Slot { path: path.into() }
    }

    /// Markdown of `source`.
    pub fn markdown(source: Source) -> Self {
        Node::Markdown { id: None, source }
    }

    /// A spinner with `label`.
    pub fn spinner(label: impl Into<String>) -> Self {
        Node::Spinner { id: None, label: label.into() }
    }

    /// Source code of `content`, without line numbers.
    pub fn code(content: Source) -> Self {
        Node::Code { id: None, content, filetype: None, numbers: false, layout: Layout::default() }
    }

    /// An image of `content`, fit inside its room.
    pub fn image(content: Source) -> Self {
        Node::Image { id: None, content, fit: Fit::Contain, layout: Layout::default() }
    }

    /// The subtree the last accepted tree had under id `key` ([`v2::View::memo`]).
    pub fn keep(key: impl Into<String>) -> Self {
        Node::Keep { key: key.into() }
    }

    node_setters! {
        split(value: Split) on Box: split = Some(value);
        height(rows: u16) on Scroll: height = Some(rows);
        follow() on Scroll: follow = true;
        scrollbar() on Scroll: scrollbar = true;
        horizontal() on List: row = true;
        placeholder(value: impl Into<String>) on Input: placeholder = value.into();
        lines(rows: u16) on Input: lines = Some(rows);
        filetype(value: impl Into<String>) on Code | Diff: filetype = Some(value.into());
        numbers() on Code: numbers = true;
        fit(value: Fit) on Image: fit = value;
        view(value: DiffView) on Diff: view = value;
        hunks(group: impl Into<String>) on Diff: hunks = Some(group.into());
        diff_padding(cells: u16) on Diff: padding = cells;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setters_convert_wrap_and_flag() {
        let command = Command::new("a.b").title("Title").group("Group").palette().arguments().scope(Scope::Base);
        assert_eq!(
            (command.name.as_str(), command.title.as_str(), command.group.as_deref(), command.slash.as_deref()),
            ("a.b", "Title", Some("Group"), None)
        );
        assert!(command.palette && command.arguments && !command.description.is_some());
        assert_eq!(command.scope, Scope::Base);
        // Enabled unless it says otherwise, which the JSON carries only then.
        assert!(command.enabled && !Command::new("a.b").disabled().enabled);
        assert_eq!(serde_json::to_value(Command::new("a.b").disabled()).unwrap()["enabled"], false);
        assert!(serde_json::to_value(Command::new("a.b")).unwrap().get("enabled").is_none());
        let bare = serde_json::json!({ "name": "a", "title": "a", "group": null, "slash": null, "keybind": null, "palette": false });
        assert!(serde_json::from_value::<Command>(bare).unwrap().enabled);
        let aliased = Command::new("a.b").slash("ab").aliases(["a".to_owned(), "b".to_owned()]);
        assert_eq!(
            (aliased.slash.as_deref(), aliased.aliases.as_slice()),
            (Some("ab"), ["a".to_owned(), "b".to_owned()].as_slice())
        );
        assert!(serde_json::to_value(Command::new("a.b")).unwrap().get("aliases").is_none());

        let layout = Layout::default().min_width(0).max_width(Width::Percent(50.0));
        assert_eq!((layout.min_width, layout.max_width), (Some(Width::Cells(0)), Some(Width::Percent(50.0))));

        let fetch = Fetch::new("GET", "/api/x").query([("a", "1".to_owned())]).body(serde_json::json!({})).bytes();
        assert_eq!(fetch.query, vec![("a".to_owned(), "1".to_owned())]);
        assert!(fetch.body.is_some() && fetch.bytes);

        let confirm = Confirm::new("Q", "M", Action::command("go").input("1")).labels("Yes", "No").centered();
        assert_eq!(confirm.label.confirm.as_deref(), Some("Yes"));
        assert_eq!(confirm.action, Action::command("go").input("1"));
        assert!(confirm.centered && confirm.size.is_none());

        let toast = Toast::new(Variant::Info, "m").title("t");
        assert_eq!((toast.title.as_deref(), toast.session), (Some("t"), None));
    }

    #[test]
    fn a_prompt_writes_the_json_of_the_variant() {
        let dialog = crate::Dialog::Prompt(Prompt::new("Name", Action::command("n")).placeholder("type"));
        let json = serde_json::to_value(&dialog).unwrap();
        let expected = serde_json::json!({
            "type": "prompt", "title": "Name", "placeholder": "type", "action": { "type": "command", "name": "n" },
        });
        assert_eq!(json, expected);
        assert_eq!(serde_json::from_value::<crate::Dialog>(expected).unwrap(), dialog);
        let bare = serde_json::to_value(crate::Dialog::Prompt(Prompt::new("Name", Action::command("n")))).unwrap();
        assert!(bare.get("placeholder").is_none() && bare.get("value").is_none() && bare.get("description").is_none());
        let filled = Prompt::new("Rename", Action::command("n")).value("Old title").description("/tmp/project");
        let json = serde_json::to_value(crate::Dialog::Prompt(filled)).unwrap();
        assert_eq!((json["value"].as_str(), json["description"].as_str()), (Some("Old title"), Some("/tmp/project")));
    }

    #[test]
    fn node_setters_reach_their_variant_only() {
        let diff = Node::diff(Source::Text("x".to_owned())).filetype("rust").hunks("h").diff_padding(2);
        let Node::Diff { filetype, hunks, padding, .. } = &diff else { panic!("a diff") };
        assert_eq!((filetype.as_deref(), hunks.as_deref(), *padding), (Some("rust"), Some("h"), 2));
        let text = Node::text(vec![Span::new("a")]);
        assert_eq!(text.clone().filetype("rust").hunks("h").view(DiffView::Split), text);
    }
}
