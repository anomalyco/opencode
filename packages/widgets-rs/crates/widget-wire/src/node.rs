//! The view tree a step returns (`specs/v2/widgets.md`, Nodes), as the decoder yields it: Rune's `Node` (opencode
//! `crates/opencode-widget`), with its JSON reading ([`Node::from_value`]) for comparison. Unknown props are ignored; an
//! unknown node type reads as [`Node::Unknown`]. A known node with a missing or mistyped required prop fails the
//! view. Unknown values of an enumerated prop fall back to its default.

use serde::Deserialize;
use serde_json::Value;

/// A canvas's `wgsl` limit in bytes.
pub const MAX_WGSL: usize = 16 * 1024;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tone {
    Muted,
    Accent,
    Success,
    Warning,
    Error,
    #[default]
    #[serde(other)]
    Default,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextStyle {
    Title,
    Caption,
    Code,
    #[default]
    #[serde(other)]
    Body,
}

/// Cross-axis alignment.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Align {
    Start,
    Center,
    End,
    #[default]
    #[serde(other)]
    Stretch,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ButtonVariant {
    Primary,
    Danger,
    #[default]
    #[serde(other)]
    Secondary,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct SelectOption {
    pub value: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
}

/// A select's value: one option's, or several when `multiple`.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(untagged)]
pub enum SelectValue {
    One(String),
    Many(Vec<String>),
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Node {
    Column {
        #[serde(default)]
        children: Vec<Node>,
        #[serde(default)]
        gap: Option<u8>,
        #[serde(default)]
        align: Align,
        #[serde(default)]
        fullscreen: Option<bool>,
        #[serde(default)]
        capture: Option<String>,
    },
    Row {
        #[serde(default)]
        children: Vec<Node>,
        #[serde(default)]
        gap: Option<u8>,
        #[serde(default)]
        align: Option<Align>,
        #[serde(default)]
        wrap: bool,
        #[serde(default)]
        fullscreen: Option<bool>,
        #[serde(default)]
        capture: Option<String>,
    },
    Text {
        text: String,
        #[serde(default)]
        style: TextStyle,
        #[serde(default)]
        tone: Tone,
    },
    Markdown {
        text: String,
    },
    Image {
        src: String,
        #[serde(default)]
        alt: Option<String>,
        #[serde(default)]
        aspect: Option<f64>,
    },
    Carousel {
        #[serde(default)]
        id: Option<String>,
        #[serde(default)]
        index: Option<usize>,
        #[serde(default)]
        children: Vec<Node>,
        #[serde(default)]
        fullscreen: Option<bool>,
        #[serde(default)]
        capture: Option<String>,
    },
    Card {
        #[serde(default)]
        id: Option<String>,
        #[serde(default)]
        selected: bool,
        #[serde(default)]
        children: Vec<Node>,
        #[serde(default)]
        fullscreen: Option<bool>,
        #[serde(default)]
        capture: Option<String>,
    },
    Button {
        id: String,
        label: String,
        #[serde(default)]
        variant: ButtonVariant,
        #[serde(default)]
        disabled: bool,
    },
    Checkbox {
        id: String,
        label: String,
        checked: bool,
        #[serde(default)]
        disabled: bool,
    },
    Slider {
        id: String,
        #[serde(default)]
        label: Option<String>,
        value: f64,
        min: f64,
        max: f64,
        #[serde(default)]
        step: Option<f64>,
    },
    Select {
        id: String,
        #[serde(default)]
        label: Option<String>,
        options: Vec<SelectOption>,
        #[serde(default)]
        value: Option<SelectValue>,
        #[serde(default)]
        multiple: bool,
    },
    Input {
        id: String,
        #[serde(default)]
        label: Option<String>,
        value: String,
        #[serde(default)]
        placeholder: Option<String>,
        #[serde(default)]
        multiline: bool,
    },
    Divider,
    Canvas {
        #[serde(default)]
        id: Option<String>,
        height: f64,
        #[serde(default)]
        width: Option<f64>,
        #[serde(default)]
        fps: Option<f64>,
        #[serde(default)]
        duration: Option<f64>,
        #[serde(default)]
        alt: Option<String>,
        #[serde(default)]
        poster: Option<String>,
        #[serde(default)]
        wgsl: Option<String>,
        #[serde(default)]
        values: Vec<f64>,
        #[serde(default)]
        pointer: bool,
        /// Drawn by a live program's `widget.gpu` (`widgets-gpu.md`); not with `wgsl`.
        #[serde(default)]
        gpu: bool,
        #[serde(default)]
        fill: Option<bool>,
        #[serde(default)]
        fullscreen: Option<bool>,
        #[serde(default)]
        capture: Option<String>,
    },
    /// Children layered in order, the last on top, each where its [`Layer`] puts it.
    Stack {
        #[serde(default)]
        children: Layers,
    },
    /// A node type this client doesn't know: drawn as nothing.
    #[serde(other)]
    Unknown,
}

impl Node {
    /// The node's children, for the containers that have them.
    pub fn children(&self) -> &[Node] {
        match self {
            Node::Column { children, .. }
            | Node::Row { children, .. }
            | Node::Carousel { children, .. }
            | Node::Card { children, .. } => children,
            Node::Stack { children } => &children.nodes,
            _ => &[],
        }
    }

    /// Calls `f` on this node and every node under it, depth first.
    pub fn walk(&self, f: &mut dyn FnMut(&Node)) {
        f(self);
        for c in self.children() {
            c.walk(f);
        }
    }

    /// Reads a view from a step's JSON: invalid when it doesn't parse, or a canvas has `values` without `wgsl`, more
    /// than [`MAX_WGSL`] of it, or both `gpu` and `wgsl`.
    pub fn from_value(v: &Value) -> Result<Node, String> {
        let node = Node::deserialize(v).map_err(|e| format!("invalid view: {e}"))?;
        node.check()?;
        Ok(node)
    }

    /// The checks beyond the shape of each node.
    pub(crate) fn check(&self) -> Result<(), String> {
        let mut bad = None;
        self.walk(&mut |n| {
            if let Node::Canvas {
                wgsl, values, gpu, ..
            } = n
            {
                if wgsl.is_none() && !values.is_empty() {
                    bad.get_or_insert("a canvas's `values` need `wgsl`".to_owned());
                }
                if *gpu && wgsl.is_some() {
                    bad.get_or_insert("a canvas's `gpu` and `wgsl` exclude each other".to_owned());
                }
                if let Some(w) = wgsl.as_ref().filter(|w| w.len() > MAX_WGSL) {
                    bad.get_or_insert(format!(
                        "a canvas's wgsl is {} bytes, over the limit of {MAX_WGSL}",
                        w.len()
                    ));
                }
            }
        });
        match bad {
            Some(why) => Err(format!("invalid view: {why}")),
            None => Ok(()),
        }
    }
}

/// Where a child of a `stack` sits in its area.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Place {
    #[default]
    TopLeft,
    Top,
    TopRight,
    Left,
    Center,
    Right,
    BottomLeft,
    Bottom,
    BottomRight,
    Fill,
}

/// Space between a stack's edges and a child, in logical pixels: one number, or per side.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Inset {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

impl Inset {
    pub(crate) fn valid(&self) -> bool {
        [self.top, self.right, self.bottom, self.left]
            .iter()
            .all(|v| v.is_finite() && *v >= 0.0)
    }
}

impl<'de> Deserialize<'de> for Inset {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Wire {
            All(f64),
            Sides {
                #[serde(default)]
                top: f64,
                #[serde(default)]
                right: f64,
                #[serde(default)]
                bottom: f64,
                #[serde(default)]
                left: f64,
            },
        }
        let i = match Wire::deserialize(d)? {
            Wire::All(v) => Inset {
                top: v,
                right: v,
                bottom: v,
                left: v,
            },
            Wire::Sides {
                top,
                right,
                bottom,
                left,
            } => Inset {
                top,
                right,
                bottom,
                left,
            },
        };
        if i.valid() {
            Ok(i)
        } else {
            Err(serde::de::Error::custom(
                "an inset is a finite number of logical pixels, at least 0",
            ))
        }
    }
}

/// How a node sits as a child of a stack: any node may carry `place` and `inset`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Deserialize)]
pub struct Layer {
    #[serde(default)]
    pub place: Place,
    #[serde(default)]
    pub inset: Inset,
}

/// A stack's children, bottom first, and how each sits.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Layers {
    pub nodes: Vec<Node>,
    pub layers: Vec<Layer>,
}

impl<'de> Deserialize<'de> for Layers {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw = Vec::<Value>::deserialize(d)?;
        let mut out = Layers::default();
        for v in raw {
            out.layers
                .push(Layer::deserialize(&v).map_err(serde::de::Error::custom)?);
            out.nodes
                .push(Node::deserialize(&v).map_err(serde::de::Error::custom)?);
        }
        Ok(out)
    }
}
