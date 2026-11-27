//! The numbers both sides agree on (`widgets-binary.md`): message kinds, node types, prop ids and kinds, enum indexes.

/// Prop kinds, the low 3 bits of a prop tag.
pub(crate) const K_INT: u32 = 0;
pub(crate) const K_F64: u32 = 1;
pub(crate) const K_STR: u32 = 2;
pub(crate) const K_F64S: u32 = 3;
pub(crate) const K_STRS: u32 = 4;
pub(crate) const K_OPTS: u32 = 5;

/// A node type the host doesn't know; its name follows in the string stream.
pub(crate) const T_UNKNOWN: u32 = 63;
pub(crate) const T_STACK: u32 = 16;

/// Top-level message kinds, after the version byte.
pub(crate) const STEP: u8 = b'S';
pub(crate) const DRAW_OUTPUT: u8 = b'D';
pub(crate) const RENDER: u8 = 1;
pub(crate) const DRAW: u8 = 2;
pub(crate) const FRAME: u8 = 3;
pub(crate) const SUBMIT: u8 = 4;
pub(crate) const DISMISS: u8 = 5;
pub(crate) const SEND: u8 = 6;
pub(crate) const CAPTURE: u8 = 7;
pub(crate) const FRAME_GPU: u8 = 9;
pub(crate) const GPU: u8 = 10;
pub(crate) const STORAGE: u8 = 11;

pub(crate) fn type_id(name: &str) -> u32 {
    match name {
        "column" => 1,
        "row" => 2,
        "text" => 3,
        "markdown" => 4,
        "image" => 5,
        "carousel" => 6,
        "card" => 7,
        "button" => 8,
        "checkbox" => 9,
        "slider" => 10,
        "select" => 11,
        "input" => 12,
        "divider" => 13,
        "canvas" => 14,
        "stack" => T_STACK,
        _ => T_UNKNOWN,
    }
}

pub(crate) fn is_container(t: u32) -> bool {
    matches!(t, 1 | 2 | 6 | 7 | T_STACK)
}

pub(crate) fn prop_id(key: &str) -> u32 {
    match key {
        "gap" => 1,
        "align" => 2,
        "wrap" => 3,
        "text" => 4,
        "style" => 5,
        "tone" => 6,
        "src" => 7,
        "alt" => 8,
        "aspect" => 9,
        "id" => 10,
        "index" => 11,
        "selected" => 12,
        "label" => 13,
        "variant" => 14,
        "disabled" => 15,
        "checked" => 16,
        "value" => 17,
        "min" => 18,
        "max" => 19,
        "step" => 20,
        "options" => 21,
        "multiple" => 22,
        "placeholder" => 23,
        "multiline" => 24,
        "height" => 25,
        "width" => 26,
        "fps" => 27,
        "duration" => 28,
        "wgsl" => 29,
        "values" => 30,
        "poster" => 31,
        "fill" => 32,
        "fullscreen" => 33,
        "capture" => 34,
        "pointer" => 35,
        "place" => 36,
        "inset" => 37,
        "gpu" => 38,
        _ => 0,
    }
}

/// What a prop's value may be.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Shape {
    F64,
    Bool,
    Str,
    /// An enumerated string, written as its index in the table.
    Enum(&'static [&'static str]),
    /// `value`: a number (slider), a string (input, one-value select) or strings (multiple select).
    Value,
    Options,
    F64s,
    /// `inset`: a number, or `{ top, right, bottom, left }`.
    Inset,
}

pub(crate) const ALIGN: &[&str] = &["start", "center", "end", "stretch"];
pub(crate) const STYLE: &[&str] = &["title", "body", "caption", "code"];
pub(crate) const TONE: &[&str] = &["default", "muted", "accent", "success", "warning", "error"];
pub(crate) const VARIANT: &[&str] = &["primary", "secondary", "danger"];
pub(crate) const PLACE: &[&str] = &[
    "top-left",
    "top",
    "top-right",
    "left",
    "center",
    "right",
    "bottom-left",
    "bottom",
    "bottom-right",
    "fill",
];

pub(crate) fn shape(id: u32) -> Shape {
    match id {
        2 => Shape::Enum(ALIGN),
        5 => Shape::Enum(STYLE),
        6 => Shape::Enum(TONE),
        14 => Shape::Enum(VARIANT),
        36 => Shape::Enum(PLACE),
        3 | 12 | 15 | 16 | 22 | 24 | 32 | 33 | 35 | 38 => Shape::Bool,
        4 | 7 | 8 | 10 | 13 | 23 | 29 | 31 | 34 => Shape::Str,
        17 => Shape::Value,
        21 => Shape::Options,
        30 => Shape::F64s,
        37 => Shape::Inset,
        _ => Shape::F64,
    }
}

/// Bounds both sides hold a message to.
pub const MAX_DEPTH: usize = 100;
pub const MAX_ARG_DEPTH: usize = 64;
pub const MAX_GPU_OPS: usize = 20_000;
pub const MAX_GPU_BYTES: usize = 4 * 1024 * 1024;
