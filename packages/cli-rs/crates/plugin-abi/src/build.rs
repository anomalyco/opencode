//! Constructors and setters of the types a plugin builds (carbon-4, big-boi 14). The contract's types are
//! `#[non_exhaustive]` to a plugin's crate, so it builds one from a constructor or `Default` and sets what it needs;
//! a field or a variant a later 2.x adds is then no break of its source. Struct variants a plugin builds (a scroll
//! verb, a target, an edit) do not grow: a later 2.x adds a variant instead.

use crate::interact::{self, Anchor};
use crate::v2::{self, Fit, MountId, Node, Paint, Source, Split};
use crate::{
    Absolute, Action, Alert, Attention, Border, Click, Color, Confirm, ConfirmLabel, ErrorDetails, Foreground, Layout,
    PanelAction, PanelBind, Press, SelectAction, Sound, SoundName, Span, When,
};

/// `with_` setters of `$ty`'s fields, each documented as setting its field.
macro_rules! setters {
    ($ty:ty { $($setter:ident: $field:ident: $value:ty),* $(,)? }) => {
        impl $ty {
            $(
                #[doc = concat!("Sets [`Self::", stringify!($field), "`].")]
                pub fn $setter(mut self, $field: $value) -> Self {
                    self.$field = $field;
                    self
                }
            )*
        }
    };
}

impl Span {
    pub fn bg(mut self, color: impl Into<Color>) -> Self {
        self.bg = Some(color.into());
        self
    }

    pub fn italic(mut self) -> Self {
        self.italic = true;
        self
    }

    pub fn underline(mut self) -> Self {
        self.underline = true;
        self
    }

    pub fn dim(mut self) -> Self {
        self.dim = true;
        self
    }

    pub fn strikethrough(mut self) -> Self {
        self.strikethrough = true;
        self
    }
}

impl Click {
    /// A click that runs `action` on release.
    pub fn new(action: Action) -> Self {
        Self { action, on: Press::Up }
    }
}

setters!(Click { with_on: on: Press });

impl Layout {
    /// A layout placed at `absolute`, out of its parent's flow.
    pub fn absolute(mut self, absolute: Absolute) -> Self {
        self.absolute = Some(absolute);
        self
    }
}

setters!(Absolute {
    with_top: top: Option<i16>,
    with_right: right: Option<i16>,
    with_bottom: bottom: Option<i16>,
    with_left: left: Option<i16>,
    with_z: z: i32,
});

impl Foreground {
    /// Runs `command`, with no arguments, in the session's directory.
    pub fn new(command: impl Into<String>) -> Self {
        Self { command: command.into(), ..Self::default() }
    }
}

setters!(Foreground { with_args: args: Vec<String>, with_cwd: cwd: Option<String> });

impl Attention {
    /// `message`, with no title, notification or sound.
    pub fn new(message: impl Into<String>) -> Self {
        Self { title: None, message: message.into(), notify: None, sound: None }
    }
}

setters!(Attention {
    with_title: title: Option<String>,
    with_notify: notify: Option<When>,
    with_sound: sound: Option<Sound>,
});

impl Sound {
    /// `name`, `when` the window allows it, at the host's volume.
    pub fn new(name: SoundName, when: When) -> Self {
        Self { name, when, volume: None }
    }
}

setters!(Sound { with_volume: volume: Option<f64> });

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

setters!(ErrorDetails {
    with_source: source: Option<String>,
    with_context: context: Option<String>,
    with_back: back: Option<Action>,
    with_reference: reference: Option<String>,
    with_key: key: Option<String>,
    with_plugin: plugin: Option<String>,
});

impl Confirm {
    /// A question that runs `action` when confirmed, with the host's labels.
    pub fn new(title: impl Into<String>, message: impl Into<String>, action: Action) -> Self {
        Self { title: title.into(), message: message.into(), label: ConfirmLabel::default(), action }
    }
}

setters!(Confirm { with_label: label: ConfirmLabel });

setters!(ConfirmLabel { with_confirm: confirm: Option<String>, with_cancel: cancel: Option<String> });

impl Alert {
    /// A notice under `title`, closed with no action.
    pub fn new(title: impl Into<String>, message: impl Into<String>) -> Self {
        Self { title: title.into(), message: message.into(), action: None }
    }
}

setters!(Alert { with_action: action: Option<Action> });

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

setters!(SelectAction {
    with_key: key: Option<String>,
    with_hidden: hidden: Vec<String>,
    with_primary: primary: Option<bool>,
    with_rowless: rowless: bool,
    with_command: command: Option<String>,
    with_disabled: disabled: bool,
    with_hidden_all: hidden_all: bool,
});

impl PanelAction {
    /// A footer action `title` that runs `action`.
    pub fn new(title: impl Into<String>, action: Action) -> Self {
        Self { title: title.into(), key: None, color: None, close: false, action }
    }
}

setters!(PanelAction { with_key: key: Option<String>, with_color: color: Option<Color>, with_close: close: bool });

impl PanelBind {
    /// Key `key`, shown as `title`, runs `action`.
    pub fn new(key: impl Into<String>, title: impl Into<String>, action: Action) -> Self {
        Self { key: key.into(), title: title.into(), action }
    }
}

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

setters!(Split { with_min: min: u16 });

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

setters!(interact::Interact {
    with_focusable: focusable: bool,
    with_pointer: pointer: bool,
    with_hover: hover: Option<Color>,
    with_hover_events: hover_events: bool,
});

impl interact::OpenPanel {
    /// Opens panel `surface` beside the session on screen.
    pub fn new(surface: impl Into<String>) -> Self {
        Self { surface: surface.into(), session: None, fullscreen: false }
    }
}

setters!(interact::OpenPanel { with_session: session: Option<String>, with_fullscreen: fullscreen: bool });

impl interact::Overlay {
    pub fn new(surface: impl Into<String>, anchor: Anchor, width: u16, height: u16) -> Self {
        Self { surface: surface.into(), anchor, width, height }
    }
}

impl Node {
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

    /// A box with `border`; anything else is unchanged.
    pub fn border(mut self, value: Border) -> Self {
        if let Node::Box { border, .. } = &mut self {
            *border = Some(Box::new(value));
        }
        self
    }

    /// A box whose children go on to another row or column when they do not fit; anything else is unchanged.
    pub fn flex_wrap(mut self) -> Self {
        if let Node::Box { wrap, .. } = &mut self {
            *wrap = true;
        }
        self
    }

    /// A row whose first child the user resizes; it needs an id. Anything else is unchanged.
    pub fn split(mut self, value: Split) -> Self {
        if let Node::Box { split, .. } = &mut self {
            *split = Some(value);
        }
        self
    }

    /// A scroll `rows` high; anything else is unchanged.
    pub fn height(mut self, rows: u16) -> Self {
        if let Node::Scroll { height, .. } = &mut self {
            *height = Some(rows);
        }
        self
    }

    /// A scroll that stays at the bottom while it is there; anything else is unchanged.
    pub fn follow(mut self) -> Self {
        if let Node::Scroll { follow, .. } = &mut self {
            *follow = true;
        }
        self
    }

    /// A list of items left to right; anything else is unchanged.
    pub fn horizontal(mut self) -> Self {
        if let Node::List { row, .. } = &mut self {
            *row = true;
        }
        self
    }

    /// A text field showing `value` while it is empty; anything else is unchanged.
    pub fn placeholder(mut self, value: impl Into<String>) -> Self {
        if let Node::Input { placeholder, .. } = &mut self {
            *placeholder = value.into();
        }
        self
    }

    /// A text field of `rows` lines; anything else is unchanged.
    pub fn lines(mut self, rows: u16) -> Self {
        if let Node::Input { lines, .. } = &mut self {
            *lines = Some(rows);
        }
        self
    }

    /// Code highlighted as `value`, such as `rust`; anything else is unchanged ([`Node::with_filetype`] for a diff).
    pub fn filetype(mut self, value: impl Into<String>) -> Self {
        if let Node::Code { filetype, .. } = &mut self {
            *filetype = Some(value.into());
        }
        self
    }

    /// Code with line numbers in a gutter; anything else is unchanged.
    pub fn numbers(mut self) -> Self {
        if let Node::Code { numbers, .. } = &mut self {
            *numbers = true;
        }
        self
    }

    /// An image that fits its room as `value` says; anything else is unchanged.
    pub fn fit(mut self, value: Fit) -> Self {
        if let Node::Image { fit, .. } = &mut self {
            *fit = value;
        }
        self
    }
}
