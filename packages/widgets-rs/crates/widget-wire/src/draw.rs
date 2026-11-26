//! A canvas's 2D draw commands (`specs/v2/widgets.md`, Canvas), as the decoder yields them: Rune's `Command`, with its
//! JSON reading under the Draw command checks ([`Command::from_value`], [`DrawOutput::from_value`]) for comparison.

use serde_json::{Map, Value};

/// Draw commands per frame at most.
pub const MAX_COMMANDS: usize = 2_000;

/// A theme color a command names instead of a value; the client resolves it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Token {
    Text,
    Muted,
    Accent,
    Bg,
    Surface,
    Border,
    Success,
    Warning,
    Error,
}

/// `"#rgb"`, `"#rrggbb"`, `"#rrggbbaa"` (straight alpha), or a theme token.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Color {
    Rgba([u8; 4]),
    Token(Token),
}

impl Color {
    pub fn parse(s: &str) -> Option<Color> {
        let Some(hex) = s.strip_prefix('#') else {
            return Some(Color::Token(match s {
                "text" => Token::Text,
                "muted" => Token::Muted,
                "accent" => Token::Accent,
                "bg" => Token::Bg,
                "surface" => Token::Surface,
                "border" => Token::Border,
                "success" => Token::Success,
                "warning" => Token::Warning,
                "error" => Token::Error,
                _ => return None,
            }));
        };
        let digit = |i: usize| {
            hex.as_bytes()
                .get(i)
                .and_then(|c| (*c as char).to_digit(16))
                .map(|d| d as u8)
        };
        let pair = |i: usize| Some(digit(i)? * 16 + digit(i + 1)?);
        match hex.len() {
            3 => Some(Color::Rgba([
                digit(0)? * 17,
                digit(1)? * 17,
                digit(2)? * 17,
                255,
            ])),
            6 => Some(Color::Rgba([pair(0)?, pair(2)?, pair(4)?, 255])),
            8 => Some(Color::Rgba([pair(0)?, pair(2)?, pair(4)?, pair(6)?])),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum GradientShape {
    /// From (x1, y1) to (x2, y2).
    Linear([f32; 4]),
    /// Center (cx, cy) and radius.
    Radial([f32; 3]),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Gradient {
    pub shape: GradientShape,
    /// Offsets in 0..=1 with their colors, in order.
    pub stops: Vec<(f32, Color)>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Fill {
    Color(Color),
    Gradient(Gradient),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Cap {
    #[default]
    Butt,
    Round,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Paint {
    pub fill: Option<Fill>,
    pub stroke: Option<Color>,
    /// The stroke's width (1 when unset).
    pub width: f32,
    pub cap: Cap,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Segment {
    M(f32, f32),
    L(f32, f32),
    Q(f32, f32, f32, f32),
    C(f32, f32, f32, f32, f32, f32),
    Z,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TextAlign {
    #[default]
    Left,
    Center,
    Right,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TextOptions {
    /// Logical pixels (13 when unset).
    pub size: f32,
    /// 400, 500, 600 or 700 (400 when unset).
    pub weight: u16,
    pub align: TextAlign,
    /// The "text" token when unset.
    pub color: Option<Color>,
    pub mono: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Command {
    Save,
    Restore,
    Translate(f32, f32),
    Rotate(f32),
    Scale(f32, f32),
    Alpha(f32),
    Rect {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        paint: Paint,
    },
    RRect {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        r: f32,
        paint: Paint,
    },
    Circle {
        cx: f32,
        cy: f32,
        r: f32,
        paint: Paint,
    },
    Line {
        x1: f32,
        y1: f32,
        x2: f32,
        y2: f32,
        paint: Paint,
    },
    Path {
        segments: Vec<Segment>,
        paint: Paint,
    },
    /// `x` is where `align` puts the text; `y` its baseline.
    Text {
        x: f32,
        y: f32,
        text: String,
        style: TextOptions,
    },
    Image {
        src: String,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
    },
}

fn num(v: &Value, what: &str) -> Result<f32, String> {
    match v.as_f64() {
        Some(n) if n.is_finite() => Ok(n as f32),
        _ => Err(format!("{what} must be a finite number")),
    }
}

fn color(v: &Value) -> Result<Color, String> {
    v.as_str()
        .and_then(Color::parse)
        .ok_or_else(|| "not a color".to_owned())
}

/// One of `table`'s strings, else `message`.
fn one_of<T: Copy>(v: &Value, table: &[(&str, T)], message: &str) -> Result<T, String> {
    table
        .iter()
        .find(|(name, _)| Some(*name) == v.as_str())
        .map(|(_, t)| *t)
        .ok_or_else(|| message.to_owned())
}

fn gradient(v: &Map<String, Value>) -> Result<Gradient, String> {
    let coords = |key: &str, n: usize| -> Result<Option<Vec<f32>>, String> {
        let Some(a) = v.get(key) else { return Ok(None) };
        let a = a
            .as_array()
            .filter(|a| a.len() == n)
            .ok_or_else(|| format!("a {key} gradient takes {n} numbers"))?;
        a.iter()
            .map(|x| num(x, key))
            .collect::<Result<Vec<_>, _>>()
            .map(Some)
    };
    let shape = match (coords("linear", 4)?, coords("radial", 3)?) {
        (Some(c), _) => GradientShape::Linear([c[0], c[1], c[2], c[3]]),
        (None, Some(c)) => GradientShape::Radial([c[0], c[1], c[2]]),
        (None, None) => return Err("a gradient needs linear or radial".into()),
    };
    let stops = v
        .get("stops")
        .and_then(Value::as_array)
        .ok_or("a gradient needs stops")?
        .iter()
        .map(|s| match s.as_array().map(Vec::as_slice) {
            Some([o, c]) => Ok((num(o, "a stop's offset")?.clamp(0.0, 1.0), color(c)?)),
            _ => Err("a stop is [offset, color]".to_owned()),
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Gradient { shape, stops })
}

fn paint(v: &Value) -> Result<Paint, String> {
    let m = v.as_object().ok_or("a paint is an object")?;
    let fill = match m.get("fill") {
        None => None,
        Some(Value::Object(g)) => Some(Fill::Gradient(gradient(g)?)),
        Some(c) => Some(Fill::Color(color(c)?)),
    };
    let stroke = m.get("stroke").map(color).transpose()?;
    let width = match m.get("width") {
        None => 1.0,
        Some(w) => num(w, "a stroke's width")?.max(0.0),
    };
    let cap = match m.get("cap") {
        None => Cap::Butt,
        Some(c) => one_of(
            c,
            &[("butt", Cap::Butt), ("round", Cap::Round)],
            "a stroke's cap must be \"butt\" or \"round\"",
        )?,
    };
    Ok(Paint {
        fill,
        stroke,
        width,
        cap,
    })
}

fn segment(v: &Value) -> Result<Segment, String> {
    let a = v.as_array().ok_or("a path segment is an array")?;
    let verb = a.first().and_then(Value::as_str);
    let count = match verb {
        Some("M" | "L") => 2,
        Some("Q") => 4,
        Some("C") => 6,
        Some("Z") => 0,
        _ => return Err("unknown path segment".into()),
    };
    let verb = verb.unwrap_or_default();
    if a.len() != count + 1 {
        return Err(format!(
            "a \"{verb}\" path segment takes {count} coordinates"
        ));
    }
    let c = a[1..]
        .iter()
        .map(|x| num(x, "a path coordinate"))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(match verb {
        "M" => Segment::M(c[0], c[1]),
        "L" => Segment::L(c[0], c[1]),
        "Q" => Segment::Q(c[0], c[1], c[2], c[3]),
        "C" => Segment::C(c[0], c[1], c[2], c[3], c[4], c[5]),
        _ => Segment::Z,
    })
}

fn text_options(v: Option<&Value>) -> Result<TextOptions, String> {
    let m = match v {
        None | Some(Value::Null) => &Map::new(),
        Some(Value::Object(m)) => m,
        Some(_) => return Err("a text style is an object".into()),
    };
    Ok(TextOptions {
        size: match m.get("size") {
            None => 13.0,
            Some(s) => num(s, "a text size")?.clamp(1.0, 512.0),
        },
        weight: match m.get("weight").map(Value::as_f64) {
            None => 400,
            Some(Some(w)) if [400.0, 500.0, 600.0, 700.0].contains(&w) => w as u16,
            Some(_) => return Err("a text weight must be 400, 500, 600 or 700".into()),
        },
        align: match m.get("align") {
            None => TextAlign::Left,
            Some(a) => one_of(
                a,
                &[
                    ("left", TextAlign::Left),
                    ("center", TextAlign::Center),
                    ("right", TextAlign::Right),
                ],
                "a text align must be \"left\", \"center\" or \"right\"",
            )?,
        },
        color: m.get("color").map(color).transpose()?,
        mono: match m.get("mono") {
            None => false,
            Some(Value::Bool(b)) => *b,
            Some(_) => return Err("a text mono must be true or false".into()),
        },
    })
}

impl Command {
    /// Reads one compact command from JSON, with the checks of `widgets.md` (Draw command checks).
    pub fn from_value(v: &Value) -> Result<Command, String> {
        let a = v.as_array().ok_or("a command is an array")?;
        let op = a
            .first()
            .and_then(Value::as_str)
            .ok_or("a command starts with its name")?;
        // Its number of arguments, and how many of them may be left off.
        let (count, optional) = match op {
            "save" | "restore" => (0, 0),
            "rotate" | "alpha" => (1, 0),
            "translate" | "scale" | "path" => (2, 0),
            "circle" => (4, 0),
            "rect" | "line" | "image" => (5, 0),
            "rrect" => (6, 0),
            "text" => (4, 1),
            _ => return Err(format!("unknown draw command \"{op}\"")),
        };
        if a.len() > count + 1 {
            return Err(format!("\"{op}\" has more than {count} arguments"));
        }
        if a.len() < count + 1 - optional {
            return Err(format!("\"{op}\" is missing argument {}", a.len()));
        }
        let n = |i: usize| num(&a[i], &format!("\"{op}\" argument {i}"));
        let p = |i: usize| paint(&a[i]);
        Ok(match op {
            "save" => Command::Save,
            "restore" => Command::Restore,
            "translate" => Command::Translate(n(1)?, n(2)?),
            "rotate" => Command::Rotate(n(1)?),
            "scale" => Command::Scale(n(1)?, n(2)?),
            "alpha" => Command::Alpha(n(1)?.clamp(0.0, 1.0)),
            "rect" => Command::Rect {
                x: n(1)?,
                y: n(2)?,
                w: n(3)?,
                h: n(4)?,
                paint: p(5)?,
            },
            "rrect" => Command::RRect {
                x: n(1)?,
                y: n(2)?,
                w: n(3)?,
                h: n(4)?,
                r: n(5)?,
                paint: p(6)?,
            },
            "circle" => Command::Circle {
                cx: n(1)?,
                cy: n(2)?,
                r: n(3)?,
                paint: p(4)?,
            },
            "line" => Command::Line {
                x1: n(1)?,
                y1: n(2)?,
                x2: n(3)?,
                y2: n(4)?,
                paint: p(5)?,
            },
            "path" => Command::Path {
                segments: a[1]
                    .as_array()
                    .ok_or("\"path\" takes a list of segments")?
                    .iter()
                    .map(segment)
                    .collect::<Result<_, _>>()?,
                paint: p(2)?,
            },
            "text" => Command::Text {
                x: n(1)?,
                y: n(2)?,
                text: a[3]
                    .as_str()
                    .ok_or("\"text\" argument 3 must be a string")?
                    .to_owned(),
                style: text_options(a.get(4))?,
            },
            _ => Command::Image {
                src: a[1].as_str().ok_or("\"image\" takes a src")?.to_owned(),
                x: n(2)?,
                y: n(3)?,
                w: n(4)?,
                h: n(5)?,
            },
        })
    }
}

/// A draw step's return value: `{ commands }`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DrawOutput {
    pub commands: Vec<Command>,
}

impl DrawOutput {
    /// Reads a draw step's return value from JSON, held to the command budget.
    pub fn from_value(v: &Value) -> Result<DrawOutput, String> {
        let list = v
            .get("commands")
            .and_then(Value::as_array)
            .ok_or("draw commands must be a list")?;
        if list.len() > MAX_COMMANDS {
            return Err(format!(
                "{} draw commands is over the budget of {MAX_COMMANDS} per frame",
                list.len()
            ));
        }
        let commands = list
            .iter()
            .enumerate()
            .map(|(i, c)| Command::from_value(c).map_err(|e| format!("draw command {i}: {e}")))
            .collect::<Result<_, _>>()?;
        Ok(DrawOutput { commands })
    }
}
