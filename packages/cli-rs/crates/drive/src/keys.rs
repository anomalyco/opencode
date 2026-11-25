//! Encodes simulated keyboard and mouse input as terminal bytes so actions exercise the real input parser.

use serde::Deserialize;

const KEY_CODES: &[(&str, &str)] = &[
    ("RETURN", "\r"),
    ("LINEFEED", "\n"),
    ("TAB", "\t"),
    ("BACKSPACE", "\u{8}"),
    ("DELETE", "\x1b[3~"),
    ("HOME", "\x1b[H"),
    ("END", "\x1b[F"),
    ("ESCAPE", "\x1b"),
    ("ARROW_UP", "\x1b[A"),
    ("ARROW_DOWN", "\x1b[B"),
    ("ARROW_RIGHT", "\x1b[C"),
    ("ARROW_LEFT", "\x1b[D"),
    ("F1", "\x1bOP"),
    ("F2", "\x1bOQ"),
    ("F3", "\x1bOR"),
    ("F4", "\x1bOS"),
    ("F5", "\x1b[15~"),
    ("F6", "\x1b[17~"),
    ("F7", "\x1b[18~"),
    ("F8", "\x1b[19~"),
    ("F9", "\x1b[20~"),
    ("F10", "\x1b[21~"),
    ("F11", "\x1b[23~"),
    ("F12", "\x1b[24~"),
];

const KITTY_CODES: &[(&str, u32)] = &[
    ("escape", 27),
    ("tab", 9),
    ("return", 13),
    ("backspace", 127),
    ("insert", 57348),
    ("delete", 57349),
    ("left", 57350),
    ("right", 57351),
    ("up", 57352),
    ("down", 57353),
    ("pageup", 57354),
    ("pagedown", 57355),
    ("home", 57356),
    ("end", 57357),
    ("f1", 57364),
    ("f2", 57365),
    ("f3", 57366),
    ("f4", 57367),
    ("f5", 57368),
    ("f6", 57369),
    ("f7", 57370),
    ("f8", 57371),
    ("f9", 57372),
    ("f10", 57373),
    ("f11", 57374),
    ("f12", 57375),
];

/// `Frontend.KeyModifiers`.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
pub struct KeyModifiers {
    #[serde(default)]
    pub ctrl: bool,
    #[serde(default)]
    pub shift: bool,
    #[serde(default)]
    pub meta: bool,
    #[serde(default, rename = "super")]
    pub super_: bool,
    #[serde(default)]
    pub hyper: bool,
}

/// `ui.press`: the simulation server's `keyInput` (an upper-cased `KeyCodes` name, else the key itself), then
/// `pressKey` in Kitty mode.
pub fn press(key: &str, modifiers: KeyModifiers) -> Vec<u8> {
    let upper = key.to_uppercase();
    let (value, mut name) = match KEY_CODES.iter().find(|(code, _)| *code == upper) {
        Some((code, value)) => (*value, Some(code.to_lowercase())),
        None => (key, None),
    };
    let mapped = match value {
        "\u{8}" => Some("backspace"),
        "\r" | "\n" => Some("return"),
        "\t" => Some("tab"),
        "\x1b" => Some("escape"),
        "\x1b[A" => Some("up"),
        "\x1b[B" => Some("down"),
        "\x1b[C" => Some("right"),
        "\x1b[D" => Some("left"),
        "\x1b[H" => Some("home"),
        "\x1b[F" => Some("end"),
        "\x1b[3~" => Some("delete"),
        _ => None,
    };
    if let Some(mapped) = mapped {
        name = Some(mapped.to_owned());
    }
    let name = name.map(|name| name.strip_prefix("arrow_").map(str::to_owned).unwrap_or(name));
    if let Some(code) =
        name.and_then(|name| KITTY_CODES.iter().find(|(kitty, _)| *kitty == name)).map(|(_, code)| *code)
    {
        return kitty(code, modifiers);
    }
    // A JavaScript string of length one: one UTF-16 unit, so not a character outside the Basic Multilingual Plane.
    let mut units = value.encode_utf16();
    if let (Some(unit), None) = (units.next(), units.next())
        && unit != 0
        && unit != 0x1b
    {
        return kitty(u32::from(unit), modifiers);
    }
    // Core falls through to legacy encoding, which only prefixes Escape for Meta on a multi-character key.
    let prefix = if modifiers.meta && !value.starts_with('\x1b') { "\x1b" } else { "" };
    format!("{prefix}{value}").into_bytes()
}

/// `ui.enter`: `pressEnter`, so Return in Kitty mode.
pub fn enter() -> Vec<u8> {
    press("RETURN", KeyModifiers::default())
}

/// `ui.arrow`: `pressArrow`.
pub fn arrow(direction: Direction) -> Vec<u8> {
    let key = match direction {
        Direction::Up => "ARROW_UP",
        Direction::Down => "ARROW_DOWN",
        Direction::Left => "ARROW_LEFT",
        Direction::Right => "ARROW_RIGHT",
    };
    press(key, KeyModifiers::default())
}

fn kitty(code: u32, modifiers: KeyModifiers) -> Vec<u8> {
    let mask = u8::from(modifiers.shift)
        | u8::from(modifiers.meta) << 1
        | u8::from(modifiers.ctrl) << 2
        | u8::from(modifiers.super_) << 3
        | u8::from(modifiers.hyper) << 4;
    match mask {
        0 => format!("\x1b[{code}u"),
        mask => format!("\x1b[{code};{}u", mask + 1),
    }
    .into_bytes()
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Up,
    Down,
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
pub struct MouseModifiers {
    #[serde(default)]
    pub shift: bool,
    #[serde(default)]
    pub alt: bool,
    #[serde(default)]
    pub ctrl: bool,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Button {
    #[default]
    Left,
    Middle,
    Right,
}

/// `Frontend.MouseParams`.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "action", rename_all = "lowercase")]
pub enum Mouse {
    Move {
        x: u32,
        y: u32,
        #[serde(default)]
        modifiers: MouseModifiers,
    },
    Down {
        x: u32,
        y: u32,
        #[serde(default)]
        modifiers: MouseModifiers,
        #[serde(default)]
        button: Button,
    },
    Up {
        x: u32,
        y: u32,
        #[serde(default)]
        modifiers: MouseModifiers,
        #[serde(default)]
        button: Button,
    },
    Scroll {
        x: u32,
        y: u32,
        #[serde(default)]
        modifiers: MouseModifiers,
        direction: Direction,
    },
}

impl Mouse {
    pub fn position(&self) -> (u32, u32) {
        match *self {
            Self::Move { x, y, .. } | Self::Down { x, y, .. } | Self::Up { x, y, .. } | Self::Scroll { x, y, .. } => {
                (x, y)
            }
        }
    }
}

/// `createMockMouse`'s state: the buttons held, in press order, so a move while one is held is a drag.
#[derive(Debug, Default)]
pub struct MouseState {
    pressed: Vec<u8>,
}

impl MouseState {
    /// The SGR report `createMockMouse` emits for an action.
    pub fn encode(&mut self, mouse: Mouse) -> Vec<u8> {
        let (x, y) = mouse.position();
        let (kind, button, modifiers) = match mouse {
            Mouse::Move { modifiers, .. } => match self.pressed.first() {
                Some(&held) => (Kind::Drag, held, modifiers),
                None => (Kind::Move, 0, modifiers),
            },
            Mouse::Down { modifiers, button, .. } => (Kind::Down, button_code(button), modifiers),
            Mouse::Up { modifiers, button, .. } => (Kind::Up, button_code(button), modifiers),
            Mouse::Scroll { modifiers, direction, .. } => {
                let wheel = match direction {
                    Direction::Up => 64,
                    Direction::Down => 65,
                    Direction::Left => 66,
                    Direction::Right => 67,
                };
                (Kind::Scroll, wheel, modifiers)
            }
        };
        let modifier_bits =
            u16::from(modifiers.shift) << 2 | u16::from(modifiers.alt) << 3 | u16::from(modifiers.ctrl) << 4;
        let code = modifier_bits
            | match kind {
                Kind::Move => 32 | 3,
                Kind::Drag => u16::from(button) | 32,
                Kind::Down | Kind::Up | Kind::Scroll => u16::from(button),
            };
        let suffix = if matches!(kind, Kind::Up | Kind::Move | Kind::Drag) { 'm' } else { 'M' };
        match kind {
            Kind::Down if button < 64 && !self.pressed.contains(&button) => self.pressed.push(button),
            Kind::Up => self.pressed.retain(|held| *held != button),
            _ => {}
        }
        format!("\x1b[<{code};{};{}{suffix}", x + 1, y + 1).into_bytes()
    }
}

#[derive(Clone, Copy)]
enum Kind {
    Move,
    Drag,
    Down,
    Up,
    Scroll,
}

fn button_code(button: Button) -> u8 {
    match button {
        Button::Left => 0,
        Button::Middle => 1,
        Button::Right => 2,
    }
}
