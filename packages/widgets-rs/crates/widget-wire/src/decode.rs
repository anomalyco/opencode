//! The decoder: bytes back into Rune's types, every read bounds-checked. Bytes that don't follow the format are
//! [`DecodeError::Malformed`] (a client error: drop the message, keep the previous state); a well-formed view that
//! breaks a node's rules (a required prop missing) is [`DecodeError::Invalid`] (a program error), as its JSON would be.

use serde_json::Value;

use crate::VERSION;
use crate::draw::{
    Cap, Color, Command, Fill, Gradient, GradientShape, MAX_COMMANDS, Paint, Segment, TextAlign,
    TextOptions, Token,
};
use crate::gpu::{self, Batch};
use crate::node::{
    Align, ButtonVariant, Inset, Layer, Layers, Node, Place, SelectOption, SelectValue, TextStyle,
    Tone,
};
use crate::schema::*;
use crate::step::{SendMessage, StepOutput};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DecodeError {
    /// Not the format: a client error.
    Malformed(String),
    /// A well-formed but invalid view: a program error.
    Invalid(String),
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DecodeError::Malformed(m) => write!(f, "malformed message: {m}"),
            DecodeError::Invalid(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for DecodeError {}

#[derive(Debug)]
pub(crate) struct Malformed(pub(crate) String);

impl From<Malformed> for DecodeError {
    fn from(m: Malformed) -> Self {
        DecodeError::Malformed(m.0)
    }
}

fn malformed<T>(m: impl Into<String>) -> Result<T, Malformed> {
    Err(Malformed(m.into()))
}

/// A run's output: an init or event step's, or a draw step's commands.
#[derive(Clone, Debug, PartialEq)]
pub enum Output {
    Step(Box<StepOutput>),
    Draw(Vec<Command>),
}

/// A live post.
#[derive(Clone, Debug, PartialEq)]
pub enum Post {
    Render(Node),
    Draw {
        id: String,
        commands: Vec<Command>,
    },
    Frame,
    /// A frame request carrying a GPU batch.
    FrameGpu(Batch),
    /// A GPU batch on its own (an intermediate batch).
    Gpu(Batch),
    Submit(Value),
    Dismiss,
    Send {
        value: Value,
        wake: bool,
    },
    Capture(bool),
}

pub fn decode_output(b: &[u8]) -> Result<Output, DecodeError> {
    let mut c = Cursor::new(b);
    version(&mut c)?;
    let out = match c.peek()? {
        STEP => {
            c.u8()?;
            Output::Step(Box::new(step(&mut c)?))
        }
        DRAW_OUTPUT => Output::Draw(draw(&mut c)?),
        k => return Err(Malformed(format!("unknown output kind {k}")).into()),
    };
    c.end("the message")?;
    Ok(out)
}

pub fn decode_post(b: &[u8]) -> Result<Post, DecodeError> {
    let mut c = Cursor::new(b);
    version(&mut c)?;
    let post = match c.u8()? {
        RENDER => Post::Render(view(&mut c)?),
        DRAW => Post::Draw {
            id: c.str()?.to_owned(),
            commands: draw(&mut c)?,
        },
        FRAME => Post::Frame,
        FRAME_GPU => Post::FrameGpu(gpu::decode(&mut c)?),
        GPU => Post::Gpu(gpu::decode(&mut c)?),
        SUBMIT => Post::Submit(json(&mut c)?),
        DISMISS => Post::Dismiss,
        SEND => {
            let wake = flag(c.u8()?)?;
            Post::Send {
                value: json(&mut c)?,
                wake,
            }
        }
        CAPTURE => Post::Capture(flag(c.u8()?)?),
        k => return Err(Malformed(format!("unknown post kind {k}")).into()),
    };
    c.end("the message")?;
    Ok(post)
}

fn version(c: &mut Cursor) -> Result<(), Malformed> {
    match c.u8()? {
        VERSION => Ok(()),
        v => malformed(format!("version {v}, not {VERSION}")),
    }
}

fn flag(b: u8) -> Result<bool, Malformed> {
    match b {
        0 => Ok(false),
        1 => Ok(true),
        _ => malformed(format!("a flag byte is 0 or 1, got {b}")),
    }
}

fn json(c: &mut Cursor) -> Result<Value, Malformed> {
    serde_json::from_str(c.str()?).map_err(|e| Malformed(format!("bad JSON: {e}")))
}

fn step(c: &mut Cursor) -> Result<StepOutput, DecodeError> {
    let flags = c.u8()?;
    if flags & !0x0f != 0 {
        return Err(Malformed(format!("unknown step flags {flags:#x}")).into());
    }
    let state = json(c)?;
    let submit = if flags & 1 != 0 { Some(json(c)?) } else { None };
    let send = if flags & 4 != 0 {
        Some(SendMessage {
            value: json(c)?,
            wake: flags & 8 != 0,
        })
    } else {
        None
    };
    Ok(StepOutput {
        state,
        view: view(c)?,
        submit,
        dismiss: flags & 2 != 0,
        send,
    })
}

// ---- the cursor ----

/// A bounds-checked reader over a slice.
pub(crate) struct Cursor<'a> {
    b: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    pub(crate) fn new(b: &'a [u8]) -> Self {
        Cursor { b, at: 0 }
    }
    fn remaining(&self) -> usize {
        self.b.len() - self.at
    }
    pub(crate) fn take(&mut self, n: usize) -> Result<&'a [u8], Malformed> {
        if n > self.remaining() {
            return malformed("truncated");
        }
        let s = &self.b[self.at..self.at + n];
        self.at += n;
        Ok(s)
    }
    fn peek(&self) -> Result<u8, Malformed> {
        self.b
            .get(self.at)
            .copied()
            .ok_or(Malformed("truncated".into()))
    }
    pub(crate) fn u8(&mut self) -> Result<u8, Malformed> {
        Ok(self.take(1)?[0])
    }
    pub(crate) fn expect(&mut self, byte: u8) -> Result<(), Malformed> {
        match self.u8()? {
            b if b == byte => Ok(()),
            b => malformed(format!("expected section {}, got {b}", byte as char)),
        }
    }
    pub(crate) fn u32(&mut self) -> Result<u32, Malformed> {
        Ok(u32::from_le_bytes(
            self.take(4)?.try_into().unwrap_or_default(),
        ))
    }
    fn f32(&mut self) -> Result<f32, Malformed> {
        Ok(f32::from_le_bytes(
            self.take(4)?.try_into().unwrap_or_default(),
        ))
    }
    pub(crate) fn f64(&mut self) -> Result<f64, Malformed> {
        Ok(f64::from_le_bytes(
            self.take(8)?.try_into().unwrap_or_default(),
        ))
    }
    /// Unsigned LEB128, at most 10 bytes.
    pub(crate) fn varint(&mut self) -> Result<u64, Malformed> {
        let mut v = 0u64;
        for i in 0..10 {
            let byte = self.u8()?;
            let bits = (byte & 0x7f) as u64;
            if i == 9 && bits > 1 {
                return malformed("varint overflow");
            }
            v |= bits << (7 * i);
            if byte < 0x80 {
                return Ok(v);
            }
        }
        malformed("varint over 10 bytes")
    }
    fn int(&mut self) -> Result<u32, Malformed> {
        u32::try_from(self.varint()?).or(malformed("int over 32 bits"))
    }
    /// A count of items that each take at least `min` bytes of this cursor.
    pub(crate) fn count(&mut self, min: usize) -> Result<usize, Malformed> {
        let n = self.varint()?;
        match usize::try_from(n) {
            Ok(n) if n.saturating_mul(min) <= self.remaining() => Ok(n),
            _ => malformed(format!("a count of {n} past the end")),
        }
    }
    pub(crate) fn str(&mut self) -> Result<&'a str, Malformed> {
        let n = self.count(1)?;
        std::str::from_utf8(self.take(n)?).map_err(|e| Malformed(format!("bad UTF-8: {e}")))
    }
    pub(crate) fn end(&self, what: &str) -> Result<(), Malformed> {
        match self.remaining() {
            0 => Ok(()),
            n => malformed(format!("{n} bytes left after {what}")),
        }
    }
}

// ---- views: section N ----

struct Streams<'a> {
    ints: Cursor<'a>,
    floats: Cursor<'a>,
    strs: Cursor<'a>,
}

impl Streams<'_> {
    fn f64s(&mut self) -> Result<Vec<f64>, Malformed> {
        let n = self.ints.varint()?;
        if n.saturating_mul(8) > self.floats.remaining() as u64 {
            return malformed("an f64 list past the end");
        }
        (0..n).map(|_| self.floats.f64()).collect()
    }
    fn strs(&mut self) -> Result<Vec<String>, Malformed> {
        let n = self.ints.varint()?;
        if n > self.strs.remaining() as u64 {
            return malformed("a string list past the end");
        }
        (0..n).map(|_| self.strs.str().map(str::to_owned)).collect()
    }
    fn str(&mut self) -> Result<String, Malformed> {
        self.strs.str().map(str::to_owned)
    }
    fn options(&mut self) -> Result<Vec<SelectOption>, Malformed> {
        let n = self.ints.count(1)?;
        let mut list = Vec::with_capacity(n);
        for _ in 0..n {
            let described = flag_int(self.ints.int()?)?;
            list.push(SelectOption {
                value: self.str()?,
                label: self.str()?,
                description: if described { Some(self.str()?) } else { None },
            });
        }
        Ok(list)
    }
    /// Skips a value of `kind` (a prop this decoder doesn't know).
    fn skip(&mut self, kind: u32) -> Result<(), Malformed> {
        match kind {
            K_INT => drop(self.ints.varint()?),
            K_F64 => drop(self.floats.f64()?),
            K_STR => drop(self.strs.str()?),
            K_F64S => drop(self.f64s()?),
            K_STRS => drop(self.strs()?),
            K_OPTS => drop(self.options()?),
            k => return malformed(format!("unknown prop kind {k}")),
        }
        Ok(())
    }
}

fn flag_int(v: u32) -> Result<bool, Malformed> {
    match v {
        0 => Ok(false),
        1 => Ok(true),
        _ => malformed(format!("a flag is 0 or 1, got {v}")),
    }
}

fn view(c: &mut Cursor) -> Result<Node, DecodeError> {
    c.expect(b'N')?;
    let li = c.count(0)?;
    let lf = c.count(0)?;
    let ls = c.count(0)?;
    let mut s = Streams {
        ints: Cursor::new(c.take(li)?),
        floats: Cursor::new(c.take(lf)?),
        strs: Cursor::new(c.take(ls)?),
    };
    let (node, _) = node(&mut s)?;
    s.ints.end("the view's ints")?;
    s.floats.end("the view's floats")?;
    s.strs.end("the view's strings")?;
    node.check().map_err(DecodeError::Invalid)?;
    Ok(node)
}

/// Every prop a node may have, as read.
#[derive(Default)]
struct Props {
    gap: Option<f64>,
    align: Option<u32>,
    wrap: bool,
    text: Option<String>,
    style: Option<u32>,
    tone: Option<u32>,
    src: Option<String>,
    alt: Option<String>,
    aspect: Option<f64>,
    id: Option<String>,
    index: Option<f64>,
    selected: bool,
    label: Option<String>,
    variant: Option<u32>,
    disabled: bool,
    checked: Option<bool>,
    value_num: Option<f64>,
    value: Option<SelectValue>,
    min: Option<f64>,
    max: Option<f64>,
    step: Option<f64>,
    options: Option<Vec<SelectOption>>,
    multiple: bool,
    placeholder: Option<String>,
    multiline: bool,
    height: Option<f64>,
    width: Option<f64>,
    fps: Option<f64>,
    duration: Option<f64>,
    wgsl: Option<String>,
    values: Vec<f64>,
    poster: Option<String>,
    fill: Option<bool>,
    fullscreen: Option<bool>,
    capture: Option<String>,
    pointer: bool,
    gpu: bool,
    place: Option<u32>,
    inset: Option<Inset>,
}

fn read_prop(s: &mut Streams, p: &mut Props, tag: u32) -> Result<(), Malformed> {
    let (id, kind) = (tag >> 3, tag & 7);
    let b = |s: &mut Streams| flag_int(s.ints.int()?);
    match (id, kind) {
        (1, K_F64) => p.gap = Some(s.floats.f64()?),
        (2, K_INT) => p.align = Some(s.ints.int()?),
        (3, K_INT) => p.wrap = b(s)?,
        (4, K_STR) => p.text = Some(s.str()?),
        (5, K_INT) => p.style = Some(s.ints.int()?),
        (6, K_INT) => p.tone = Some(s.ints.int()?),
        (7, K_STR) => p.src = Some(s.str()?),
        (8, K_STR) => p.alt = Some(s.str()?),
        (9, K_F64) => p.aspect = Some(s.floats.f64()?),
        (10, K_STR) => p.id = Some(s.str()?),
        (11, K_F64) => p.index = Some(s.floats.f64()?),
        (12, K_INT) => p.selected = b(s)?,
        (13, K_STR) => p.label = Some(s.str()?),
        (14, K_INT) => p.variant = Some(s.ints.int()?),
        (15, K_INT) => p.disabled = b(s)?,
        (16, K_INT) => p.checked = Some(b(s)?),
        (17, K_F64) => p.value_num = Some(s.floats.f64()?),
        (17, K_STR) => p.value = Some(SelectValue::One(s.str()?)),
        (17, K_STRS) => p.value = Some(SelectValue::Many(s.strs()?)),
        (18, K_F64) => p.min = Some(s.floats.f64()?),
        (19, K_F64) => p.max = Some(s.floats.f64()?),
        (20, K_F64) => p.step = Some(s.floats.f64()?),
        (21, K_OPTS) => p.options = Some(s.options()?),
        (22, K_INT) => p.multiple = b(s)?,
        (23, K_STR) => p.placeholder = Some(s.str()?),
        (24, K_INT) => p.multiline = b(s)?,
        (25, K_F64) => p.height = Some(s.floats.f64()?),
        (26, K_F64) => p.width = Some(s.floats.f64()?),
        (27, K_F64) => p.fps = Some(s.floats.f64()?),
        (28, K_F64) => p.duration = Some(s.floats.f64()?),
        (29, K_STR) => p.wgsl = Some(s.str()?),
        (30, K_F64S) => p.values = s.f64s()?,
        (31, K_STR) => p.poster = Some(s.str()?),
        (32, K_INT) => p.fill = Some(b(s)?),
        (33, K_INT) => p.fullscreen = Some(b(s)?),
        (34, K_STR) => p.capture = Some(s.str()?),
        (35, K_INT) => p.pointer = b(s)?,
        (38, K_INT) => p.gpu = b(s)?,
        (36, K_INT) => p.place = Some(s.ints.int()?),
        (37, K_F64) => {
            let v = s.floats.f64()?;
            p.inset = Some(Inset {
                top: v,
                right: v,
                bottom: v,
                left: v,
            });
        }
        (37, K_F64S) => match s.f64s()?.as_slice() {
            [top, right, bottom, left] => {
                p.inset = Some(Inset {
                    top: *top,
                    right: *right,
                    bottom: *bottom,
                    left: *left,
                })
            }
            _ => return malformed("an inset list has 4 numbers"),
        },
        _ => s.skip(kind)?,
    }
    Ok(())
}

fn invalid<T>(m: impl std::fmt::Display) -> Result<T, DecodeError> {
    Err(DecodeError::Invalid(format!("invalid view: {m}")))
}

fn need<T>(v: Option<T>, field: &str) -> Result<T, DecodeError> {
    match v {
        Some(v) => Ok(v),
        None => invalid(format_args!("missing field `{field}`")),
    }
}

fn pick<T: Copy + Default>(i: Option<u32>, table: &[T]) -> T {
    i.and_then(|i| table.get(i as usize).copied())
        .unwrap_or_default()
}

/// A node and how it sits when it's a stack's child.
/// A container being read: its node without children, and the children read so far.
struct Open {
    shell: Result<(Node, Layer), DecodeError>,
    left: usize,
    children: Vec<Node>,
    layers: Vec<Layer>,
}

/// The view's root and how it sits. Iterative, so a deep view takes no stack: each container waiting for its children
/// is on a heap stack.
fn node(s: &mut Streams) -> Result<(Node, Layer), DecodeError> {
    let mut open: Vec<Open> = Vec::new();
    loop {
        if open.len() > MAX_DEPTH {
            return Err(Malformed(format!("a view deeper than {MAX_DEPTH} levels")).into());
        }
        let t = s.ints.int()?;
        let mut done = if t == T_UNKNOWN {
            if s.ints.int()? != 0 {
                return Err(Malformed("an unknown node has no props".into()).into());
            }
            s.strs.str()?;
            (Node::Unknown, Layer::default())
        } else {
            if !matches!(t, 1..=14 | T_STACK) {
                return Err(Malformed(format!("unknown node type {t}")).into());
            }
            // The node without its children; its failure waits for the children's reading, which may find the bytes
            // malformed.
            let shell = head(s, t)?;
            let n = if is_container(t) { s.ints.count(2)? } else { 0 };
            if n > 0 {
                open.push(Open {
                    shell,
                    left: n,
                    children: Vec::with_capacity(n),
                    layers: Vec::with_capacity(n),
                });
                continue;
            }
            shell?
        };
        loop {
            let Some(parent) = open.last_mut() else {
                return Ok(done);
            };
            parent.children.push(done.0);
            parent.layers.push(done.1);
            parent.left -= 1;
            if parent.left > 0 {
                break;
            }
            let Open {
                shell,
                children,
                layers,
                ..
            } = open.pop().unwrap_or_else(|| unreachable!());
            let (mut node, layer) = shell?;
            match &mut node {
                Node::Column { children: c, .. }
                | Node::Row { children: c, .. }
                | Node::Carousel { children: c, .. }
                | Node::Card { children: c, .. } => *c = children,
                Node::Stack { children: c } => {
                    *c = Layers {
                        nodes: children,
                        layers,
                    }
                }
                _ => {}
            }
            done = (node, layer);
        }
    }
}

/// A node's props (after its type `t`) and the node they make, with no children: `Err` for malformed bytes, `Ok(Err)`
/// for a node they make invalid.
#[inline(never)]
#[allow(clippy::type_complexity)]
fn head(s: &mut Streams, t: u32) -> Result<Result<(Node, Layer), DecodeError>, DecodeError> {
    let mut p = Props::default();
    loop {
        match s.ints.int()? {
            0 => break,
            tag => read_prop(s, &mut p, tag)?,
        }
    }
    Ok(shell(t, p))
}

fn shell(t: u32, mut p: Props) -> Result<(Node, Layer), DecodeError> {
    let (children, layers) = (Vec::new(), Vec::new());
    let place = pick(
        p.place,
        &[
            Place::TopLeft,
            Place::Top,
            Place::TopRight,
            Place::Left,
            Place::Center,
            Place::Right,
            Place::BottomLeft,
            Place::Bottom,
            Place::BottomRight,
            Place::Fill,
        ],
    );
    let inset = p.inset.unwrap_or_default();
    if !inset.valid() {
        return invalid("an inset is a finite number of logical pixels, at least 0");
    }
    let gap = match p.gap {
        None => None,
        Some(g) if g.fract() == 0.0 && (0.0..=255.0).contains(&g) => Some(g as u8),
        Some(g) => return invalid(format_args!("gap {g} isn't a whole number up to 255")),
    };
    let align = |a| {
        pick(
            a,
            &[Align::Start, Align::Center, Align::End, Align::Stretch],
        )
    };
    let (fullscreen, capture) = (p.fullscreen, p.capture.take());
    let node = match t {
        1 => Node::Column {
            children,
            gap,
            align: align(p.align),
            fullscreen,
            capture,
        },
        2 => Node::Row {
            children,
            gap,
            align: p.align.map(|a| align(Some(a))),
            wrap: p.wrap,
            fullscreen,
            capture,
        },
        3 => Node::Text {
            text: need(p.text, "text")?,
            style: pick(
                p.style,
                &[
                    TextStyle::Title,
                    TextStyle::Body,
                    TextStyle::Caption,
                    TextStyle::Code,
                ],
            ),
            tone: pick(
                p.tone,
                &[
                    Tone::Default,
                    Tone::Muted,
                    Tone::Accent,
                    Tone::Success,
                    Tone::Warning,
                    Tone::Error,
                ],
            ),
        },
        4 => Node::Markdown {
            text: need(p.text, "text")?,
        },
        5 => Node::Image {
            src: need(p.src, "src")?,
            alt: p.alt,
            aspect: p.aspect,
        },
        6 => Node::Carousel {
            id: p.id,
            index: match p.index {
                None => None,
                Some(i) if i.fract() == 0.0 && (0.0..9.0e15).contains(&i) => Some(i as usize),
                Some(i) => {
                    return invalid(format_args!("index {i} isn't a whole number at least 0"));
                }
            },
            children,
            fullscreen,
            capture,
        },
        7 => Node::Card {
            id: p.id,
            selected: p.selected,
            children,
            fullscreen,
            capture,
        },
        8 => Node::Button {
            id: need(p.id, "id")?,
            label: need(p.label, "label")?,
            variant: pick(
                p.variant,
                &[
                    ButtonVariant::Primary,
                    ButtonVariant::Secondary,
                    ButtonVariant::Danger,
                ],
            ),
            disabled: p.disabled,
        },
        9 => Node::Checkbox {
            id: need(p.id, "id")?,
            label: need(p.label, "label")?,
            checked: need(p.checked, "checked")?,
            disabled: p.disabled,
        },
        10 => Node::Slider {
            id: need(p.id, "id")?,
            label: p.label,
            value: need(p.value_num, "value")?,
            min: need(p.min, "min")?,
            max: need(p.max, "max")?,
            step: p.step,
        },
        11 => Node::Select {
            id: need(p.id, "id")?,
            label: p.label,
            options: need(p.options, "options")?,
            value: p.value,
            multiple: p.multiple,
        },
        12 => Node::Input {
            id: need(p.id, "id")?,
            label: p.label,
            value: match p.value {
                Some(SelectValue::One(v)) => v,
                _ => return invalid("missing field `value`"),
            },
            placeholder: p.placeholder,
            multiline: p.multiline,
        },
        13 => Node::Divider,
        14 => Node::Canvas {
            id: p.id,
            height: need(p.height, "height")?,
            width: p.width,
            fps: p.fps,
            duration: p.duration,
            alt: p.alt,
            poster: p.poster,
            wgsl: p.wgsl,
            values: p.values,
            pointer: p.pointer,
            gpu: p.gpu,
            fill: p.fill,
            fullscreen,
            capture,
        },
        _ => Node::Stack {
            children: Layers {
                nodes: children,
                layers,
            },
        },
    };
    Ok((node, Layer { place, inset }))
}

// ---- draw commands: section D ----

struct DrawReader<'a> {
    ints: Cursor<'a>,
    floats: Cursor<'a>,
    strs: Cursor<'a>,
}

impl DrawReader<'_> {
    fn i(&mut self) -> Result<u32, Malformed> {
        self.ints.u32()
    }
    fn f(&mut self) -> Result<f32, Malformed> {
        self.floats.f32()
    }
    fn s(&mut self) -> Result<String, Malformed> {
        self.strs.str().map(str::to_owned)
    }
    fn color(&mut self) -> Result<Color, Malformed> {
        let kind = self.i()?;
        let value = self.i()?;
        Ok(match kind {
            0 => Color::Rgba(value.to_be_bytes()),
            1 => Color::Token(Token::Text),
            2 => Color::Token(Token::Muted),
            3 => Color::Token(Token::Accent),
            4 => Color::Token(Token::Bg),
            5 => Color::Token(Token::Surface),
            6 => Color::Token(Token::Border),
            7 => Color::Token(Token::Success),
            8 => Color::Token(Token::Warning),
            9 => Color::Token(Token::Error),
            k => return malformed(format!("unknown color kind {k}")),
        })
    }
    fn paint(&mut self) -> Result<Paint, Malformed> {
        let fill = match self.i()? {
            0 => None,
            1 => Some(Fill::Color(self.color()?)),
            k @ (2 | 3) => {
                let n = self.i()? as usize;
                if n.saturating_mul(4) > self.floats.remaining() {
                    return malformed("gradient stops past the end");
                }
                let shape = if k == 2 {
                    GradientShape::Linear([self.f()?, self.f()?, self.f()?, self.f()?])
                } else {
                    GradientShape::Radial([self.f()?, self.f()?, self.f()?])
                };
                let mut stops = Vec::with_capacity(n);
                for _ in 0..n {
                    stops.push((self.f()?, self.color()?));
                }
                Some(Fill::Gradient(Gradient { shape, stops }))
            }
            k => return malformed(format!("unknown fill kind {k}")),
        };
        let stroke = if flag_int(self.i()?)? {
            Some(self.color()?)
        } else {
            None
        };
        let cap = if flag_int(self.i()?)? {
            Cap::Round
        } else {
            Cap::Butt
        };
        Ok(Paint {
            fill,
            stroke,
            width: self.f()?,
            cap,
        })
    }
    fn command(&mut self) -> Result<Command, Malformed> {
        Ok(match self.i()? {
            1 => Command::Save,
            2 => Command::Restore,
            3 => Command::Translate(self.f()?, self.f()?),
            4 => Command::Rotate(self.f()?),
            5 => Command::Scale(self.f()?, self.f()?),
            6 => Command::Alpha(self.f()?),
            7 => Command::Rect {
                x: self.f()?,
                y: self.f()?,
                w: self.f()?,
                h: self.f()?,
                paint: self.paint()?,
            },
            8 => Command::RRect {
                x: self.f()?,
                y: self.f()?,
                w: self.f()?,
                h: self.f()?,
                r: self.f()?,
                paint: self.paint()?,
            },
            9 => Command::Circle {
                cx: self.f()?,
                cy: self.f()?,
                r: self.f()?,
                paint: self.paint()?,
            },
            10 => Command::Line {
                x1: self.f()?,
                y1: self.f()?,
                x2: self.f()?,
                y2: self.f()?,
                paint: self.paint()?,
            },
            11 => {
                let n = self.i()? as usize;
                if n.saturating_mul(4) > self.ints.remaining() {
                    return malformed("path segments past the end");
                }
                let verbs = (0..n).map(|_| self.i()).collect::<Result<Vec<_>, _>>()?;
                let mut segments = Vec::with_capacity(n);
                for v in verbs {
                    segments.push(match v {
                        1 => Segment::M(self.f()?, self.f()?),
                        2 => Segment::L(self.f()?, self.f()?),
                        3 => Segment::Q(self.f()?, self.f()?, self.f()?, self.f()?),
                        4 => Segment::C(
                            self.f()?,
                            self.f()?,
                            self.f()?,
                            self.f()?,
                            self.f()?,
                            self.f()?,
                        ),
                        5 => Segment::Z,
                        v => return malformed(format!("unknown path verb {v}")),
                    });
                }
                Command::Path {
                    segments,
                    paint: self.paint()?,
                }
            }
            12 => {
                let (x, y, text) = (self.f()?, self.f()?, self.s()?);
                let weight = u16::try_from(self.i()?).or(malformed("a text weight over 65535"))?;
                let align = match self.i()? {
                    0 => TextAlign::Left,
                    1 => TextAlign::Center,
                    2 => TextAlign::Right,
                    a => return malformed(format!("unknown text align {a}")),
                };
                let color = if flag_int(self.i()?)? {
                    Some(self.color()?)
                } else {
                    None
                };
                let mono = flag_int(self.i()?)?;
                Command::Text {
                    x,
                    y,
                    text,
                    style: TextOptions {
                        size: self.f()?,
                        weight,
                        align,
                        color,
                        mono,
                    },
                }
            }
            13 => Command::Image {
                src: self.s()?,
                x: self.f()?,
                y: self.f()?,
                w: self.f()?,
                h: self.f()?,
            },
            op => return malformed(format!("unknown draw op {op}")),
        })
    }
}

fn draw(c: &mut Cursor) -> Result<Vec<Command>, Malformed> {
    c.expect(b'D')?;
    let n = c.u32()? as usize;
    let ni = c.u32()? as usize;
    let nf = c.u32()? as usize;
    let ls = c.u32()? as usize;
    if n > MAX_COMMANDS {
        return malformed(format!(
            "{n} draw commands is over the limit of {MAX_COMMANDS}"
        ));
    }
    let mut r = DrawReader {
        ints: Cursor::new(c.take(ni.checked_mul(4).ok_or(Malformed("too many ints".into()))?)?),
        floats: Cursor::new(
            c.take(
                nf.checked_mul(4)
                    .ok_or(Malformed("too many floats".into()))?,
            )?,
        ),
        strs: Cursor::new(c.take(ls)?),
    };
    let mut out = Vec::with_capacity(n);
    for _ in 0..n {
        out.push(r.command()?);
    }
    r.ints.end("the drawing's ints")?;
    r.floats.end("the drawing's floats")?;
    r.strs.end("the drawing's strings")?;
    Ok(out)
}
