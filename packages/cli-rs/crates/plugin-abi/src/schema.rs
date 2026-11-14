//! The JSON Schema of contract 2.0 (synthesis 4.6), generated from the Rust types without a dependency (O-132). Each
//! definition names every field and variant of its type, without `..`, so a field or a variant added to a type does
//! not compile until its schema has it; enum values are what serde writes. A test checks a corpus of trees against
//! both the schema and serde.

use serde::Serialize;
use serde_json::{Value, json};

use crate::v2::{ContentRef, DiffView, Mode, MountId, Node, Palette, PartRef, Source, SurfaceInput};
use crate::{
    Action, Align, Border, BorderStyle, Click, Color, Edges, Justify, Layout, Overflow, Press, Sides, Span, TitleAlign,
    Width, Wrap,
};

/// What an [`Rgba`] is on the wire: `#rrggbbaa`. The host writes lowercase and reads either case.
pub(crate) const RGBA: &str = "^#[0-9a-fA-F]{8}$";

/// An object of type `$ty`: the fields of the first list are required, those of the second may be left out.
macro_rules! object {
    ($ty:ident, $description:expr, { $($required:ident: $rs:expr),* $(,)? } { $($optional:ident: $os:expr),* $(,)? }) => {{
        let _ = |value: &$ty| {
            let $ty { $($required: _,)* $($optional: _,)* } = value;
        };
        object(&[$((stringify!($required), $rs)),*], &[$((stringify!($optional), $os)),*], None, $description)
    }};
}

/// An enum of `$ty` tagged by `type`, of struct variants as [`object!`]'s.
macro_rules! tagged {
    ($ty:ident, $description:expr, {
        $($variant:ident { $($required:ident: $rs:expr),* $(,)? } { $($optional:ident: $os:expr),* $(,)? }),* $(,)?
    }) => {{
        let _ = |value: &$ty| match value {
            $($ty::$variant { $($required: _,)* $($optional: _,)* } => (),)*
        };
        described(
            json!({ "oneOf": [$(object(
                &[$((stringify!($required), $rs)),*],
                &[$((stringify!($optional), $os)),*],
                Some(&kebab(stringify!($variant))),
                "",
            )),*] }),
            $description,
        )
    }};
}

/// An enum of `$ty` whose variants each hold one value, written as `{ "variant": value }`.
macro_rules! external {
    ($ty:ident, $description:expr, { $($variant:ident: $schema:expr),* $(,)? }) => {{
        let _ = |value: &$ty| match value {
            $($ty::$variant(_) => (),)*
        };
        let variants: Vec<Value> = vec![$({
            let name = kebab(stringify!($variant));
            let properties: serde_json::Map<String, Value> = [(name.clone(), $schema)].into_iter().collect();
            json!({ "type": "object", "properties": properties, "required": [name], "additionalProperties": false })
        }),*];
        described(json!({ "oneOf": variants }), $description)
    }};
}

/// An enum of `$ty` of unit variants, written as strings; the strings are serde's.
macro_rules! unit {
    ($ty:ident { $($variant:ident),* $(,)? }) => {{
        let _ = |value: &$ty| match value {
            $($ty::$variant => (),)*
        };
        strings(&[$($ty::$variant),*])
    }};
}

/// The JSON Schema of contract 2.0. The root is a [`Node`], the tree a view returns; a host validates what a view
/// gets against `#/$defs/SurfaceInput` and a mount against `#/$defs/MountId`.
pub fn schema() -> Value {
    let defs: Vec<(&str, Value)> = vec![
        (
            "Node",
            tagged!(Node, "A node of a surface's tree.", {
                Box { } { id: nullable(string()), row: boolean(), gap: uint16(), padding: pair(uint16(), uint16()),
                    justify: reference("Justify"), align: reference("Align"), bg: nullable(reference("Color")),
                    layout: reference("Layout"), on_click: nullable(reference("Click")),
                    children: array(reference("Node")), border: nullable(reference("Border")),
                    padding_sides: nullable(reference("Edges")), wrap: boolean(), overflow: reference("Overflow") },
                Text { spans: array(reference("Span")) } { id: nullable(string()), fg: nullable(reference("Color")),
                    wrap: reference("Wrap"), truncate: boolean(), selectable: boolean(),
                    hover_fg: nullable(reference("Color")), layout: reference("Layout"),
                    on_click: nullable(reference("Click")) },
                Slot { path: string() } { },
                Markdown { source: reference("Source") } { id: nullable(string()) },
                Spinner { label: string() } { id: nullable(string()) },
                Scroll { } { id: nullable(string()), height: nullable(uint16()), follow: boolean(),
                    layout: reference("Layout"), children: array(reference("Node")) },
                Diff { content: reference("Source") } { id: nullable(string()), view: reference("DiffView"),
                    filetype: nullable(string()) },
                Keep { key: string() } { },
            }),
        ),
        (
            "Source",
            external!(Source, "What a text-bearing node shows.", {
                Text: string(), Content: reference("ContentRef"), PartOutput: reference("PartRef"),
            }),
        ),
        ("ContentRef", {
            let _ = |value: &ContentRef| {
                let ContentRef(_) = value;
            };
            described(uint64(), "Content a view gave the host (`View::content`).")
        }),
        (
            "PartRef",
            object!(PartRef, "A tool call of a session, whose output a node shows.", {
            session: string(), part: string(),
        } { }),
        ),
        ("DiffView", unit!(DiffView { Unified, Split })),
        (
            "SurfaceInput",
            object!(SurfaceInput, "What a surface's view gets besides the plugin's own state.", {
            width: uint16(), height: uint16(), palette: reference("Palette"),
        } { full: boolean() }),
        ),
        (
            "Palette",
            object!(Palette, "Every token of the page theme, by its path.", {
            mode: reference("Mode"), colors: json!({ "type": "object", "additionalProperties": reference("Rgba") }),
        } { }),
        ),
        ("Mode", unit!(Mode { Dark, Light })),
        (
            "MountId",
            object!(MountId, "One mount of a surface; a new generation each time.", {
            surface: string(), key: string(), generation: uint64(),
        } { }),
        ),
        (
            "Span",
            object!(Span, "Styled text.", { text: string() } {
                fg: nullable(reference("Color")), bg: nullable(reference("Color")), bold: boolean(), italic: boolean(),
                underline: boolean(), dim: boolean(), strikethrough: boolean(),
            }),
        ),
        ("Color", {
            let _ = |value: &Color| match value {
                Color::Rgba(_) | Color::Token(_) => (),
            };
            described(
                json!({ "anyOf": [reference("Rgba"), string()] }),
                "A theme token path (`text.muted`), a scale step (`interactive.500`), `#rrggbb`, or an Rgba.",
            )
        }),
        ("Rgba", described(json!({ "type": "string", "pattern": RGBA }), "`#rrggbbaa`; the host writes lowercase.")),
        (
            "Layout",
            object!(Layout, "How a node takes space in its parent's row or column.", { } {
                width: nullable(reference("Width")), grow: boolean(), shrink: nullable(boolean()),
                min_width_zero: boolean(), height: nullable(reference("Width")),
                min_height: nullable(reference("Width")), max_height: nullable(reference("Width")),
                margin: nullable(reference("Edges")),
            }),
        ),
        (
            "Width",
            external!(Width, "A size in cells or in percent of the parent.", {
                Cells: uint16(), Percent: number(),
            }),
        ),
        (
            "Edges",
            object!(Edges, "Cells at each edge.", { } {
                top: int16(), right: int16(), bottom: int16(), left: int16(),
            }),
        ),
        (
            "Border",
            object!(Border, "A border on a box's edge.", { } {
                sides: reference("Sides"), style: reference("BorderStyle"), color: nullable(reference("Color")),
                title: nullable(string()), title_align: reference("TitleAlign"),
            }),
        ),
        (
            "Sides",
            object!(Sides, "The sides a border draws; all of them when left out.", { } {
                top: boolean(), right: boolean(), bottom: boolean(), left: boolean(),
            }),
        ),
        ("BorderStyle", unit!(BorderStyle { Single, Double, Rounded, Heavy })),
        ("TitleAlign", unit!(TitleAlign { Left, Center, Right })),
        ("Overflow", unit!(Overflow { Visible, Hidden })),
        ("Justify", unit!(Justify { Start, End, Center, SpaceBetween, SpaceAround })),
        ("Align", unit!(Align { Stretch, Start, Center, End })),
        ("Wrap", unit!(Wrap { Word, Char, None })),
        (
            "Click",
            object!(Click, "What a click on a node runs.", {
            action: reference("Action"), on: reference("Press"),
        } { }),
        ),
        ("Press", unit!(Press { Down, Up })),
        (
            "Action",
            tagged!(Action, "What a click asks the host to do.", {
                Command { name: string() } { input: nullable(string()) },
            }),
        ),
    ];
    let defs: serde_json::Map<String, Value> =
        defs.into_iter().map(|(name, schema)| (name.to_owned(), schema)).collect();
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "opencode plugin contract 2.0",
        "description": "Generated from opencode_plugin_abi::v2 by `examples/schema.rs`; do not edit. The root is a Node, \
                        the tree a view returns; SurfaceInput and MountId are what a view gets.",
        "$ref": "#/$defs/Node",
        "$defs": defs,
    })
}

fn object(required: &[(&str, Value)], optional: &[(&str, Value)], tag: Option<&str>, description: &str) -> Value {
    let mut properties: serde_json::Map<String, Value> =
        required.iter().chain(optional).map(|(name, schema)| ((*name).to_owned(), schema.clone())).collect();
    let mut names: Vec<&str> = required.iter().map(|(name, _)| *name).collect();
    if let Some(tag) = tag {
        properties.insert("type".to_owned(), json!({ "const": tag }));
        names.insert(0, "type");
    }
    let mut object = json!({ "type": "object", "properties": properties, "required": names });
    if !description.is_empty() {
        object["description"] = json!(description);
    }
    object
}

fn strings<T: Serialize>(variants: &[T]) -> Value {
    let values: Vec<Value> = variants.iter().map(|variant| serde_json::to_value(variant).unwrap_or_default()).collect();
    json!({ "type": "string", "enum": values })
}

fn described(mut schema: Value, description: &str) -> Value {
    schema["description"] = json!(description);
    schema
}

/// `PartOutput` as serde's kebab case writes it: `part-output`.
fn kebab(name: &str) -> String {
    name.chars()
        .enumerate()
        .flat_map(|(index, char)| {
            let dash = (index > 0 && char.is_uppercase()).then_some('-');
            dash.into_iter().chain(char.to_lowercase())
        })
        .collect()
}

fn reference(name: &str) -> Value {
    json!({ "$ref": format!("#/$defs/{name}") })
}

fn nullable(schema: Value) -> Value {
    json!({ "anyOf": [schema, { "type": "null" }] })
}

fn array(items: Value) -> Value {
    json!({ "type": "array", "items": items })
}

fn pair(first: Value, second: Value) -> Value {
    json!({ "type": "array", "prefixItems": [first, second], "minItems": 2, "maxItems": 2 })
}

fn string() -> Value {
    json!({ "type": "string" })
}

fn boolean() -> Value {
    json!({ "type": "boolean" })
}

fn number() -> Value {
    json!({ "type": "number" })
}

fn uint16() -> Value {
    json!({ "type": "integer", "minimum": 0, "maximum": u16::MAX })
}

fn int16() -> Value {
    json!({ "type": "integer", "minimum": i16::MIN, "maximum": i16::MAX })
}

fn uint64() -> Value {
    json!({ "type": "integer", "minimum": 0, "maximum": u64::MAX })
}

#[cfg(test)]
mod tests {
    use serde::de::DeserializeOwned;

    use super::*;
    use crate::Rgba;

    /// Whether `value` conforms to `schema`, for the keywords [`schema`] writes.
    fn conforms(value: &Value, schema: &Value, defs: &Value) -> bool {
        if let Some(path) = schema.get("$ref").and_then(Value::as_str) {
            let name = path.trim_start_matches("#/$defs/");
            return conforms(value, &defs[name], defs);
        }
        if let Some(any) = schema.get("anyOf").and_then(Value::as_array) {
            return any.iter().any(|schema| conforms(value, schema, defs));
        }
        if let Some(one) = schema.get("oneOf").and_then(Value::as_array) {
            return one.iter().filter(|schema| conforms(value, schema, defs)).count() == 1;
        }
        if let Some(constant) = schema.get("const") {
            return value == constant;
        }
        if let Some(values) = schema.get("enum").and_then(Value::as_array) {
            return values.contains(value);
        }
        let typed = match schema.get("type").and_then(Value::as_str) {
            Some("string") => value.as_str().is_some_and(|text| match schema.get("pattern") {
                Some(_) => text.len() == 9 && text.starts_with('#') && text[1..].chars().all(|c| c.is_ascii_hexdigit()),
                None => true,
            }),
            Some("boolean") => value.is_boolean(),
            Some("null") => value.is_null(),
            Some("number") => value.is_number(),
            Some("integer") => {
                let bound = |key: &str| schema[key].as_f64();
                (value.is_i64() || value.is_u64())
                    && value.as_f64().is_some_and(|n| {
                        bound("minimum").is_none_or(|min| n >= min) && bound("maximum").is_none_or(|max| n <= max)
                    })
            }
            Some("array") => {
                value.as_array().is_some_and(|items| match schema.get("prefixItems").and_then(Value::as_array) {
                    Some(prefix) => {
                        items.len() == prefix.len()
                            && items.iter().zip(prefix).all(|(item, schema)| conforms(item, schema, defs))
                    }
                    None => items.iter().all(|item| conforms(item, &schema["items"], defs)),
                })
            }
            Some("object") => value.as_object().is_some_and(|object| {
                let properties = schema.get("properties").and_then(Value::as_object);
                let required = schema["required"].as_array().into_iter().flatten().filter_map(Value::as_str);
                let closed = schema.get("additionalProperties") == Some(&json!(false));
                required.into_iter().all(|name| object.contains_key(name))
                    && object.iter().all(|(name, field)| match properties.and_then(|properties| properties.get(name)) {
                        Some(schema) => conforms(field, schema, defs),
                        None => match schema.get("additionalProperties") {
                            Some(Value::Object(_)) => conforms(field, &schema["additionalProperties"], defs),
                            _ => !closed,
                        },
                    })
            }),
            _ => true,
        };
        typed
    }

    /// Whether serde reads `value` as a `T`, and the schema's definition `name` takes it; both must agree.
    fn agree<T: DeserializeOwned>(name: &str, value: Value) -> bool {
        let schema = schema();
        let defs = &schema["$defs"];
        let read = serde_json::from_value::<T>(value.clone()).is_ok();
        assert_eq!(conforms(&value, &defs[name], defs), read, "{name}: {value} (serde reads it: {read})");
        read
    }

    // Expected (O-132): what serde writes for every variant, with every field set, conforms to its definition, and a
    // corpus of trees is taken or refused alike by the schema and by serde: a required field left out, an unknown
    // variant, a number out of range, a color in either case.
    #[test]
    fn the_schema_takes_what_serde_takes() {
        let span = Span {
            text: "x".into(),
            fg: Some(Color::from("text.muted")),
            bg: Some(Color::Rgba(Rgba::new(1, 2, 3, 4))),
            bold: true,
            italic: true,
            underline: true,
            dim: true,
            strikethrough: true,
        };
        let layout = Layout {
            width: Some(Width::Percent(50.0)),
            grow: true,
            shrink: Some(false),
            min_width_zero: true,
            height: Some(Width::Cells(2)),
            min_height: Some(Width::Cells(1)),
            max_height: Some(Width::Cells(9)),
            margin: Some(Edges { top: -1, right: 1, bottom: 2, left: 3 }),
        };
        let click = Click { action: Action::Command { name: "x".into(), input: Some("y".into()) }, on: Press::Down };
        let border = Border {
            sides: Sides { top: true, right: false, bottom: true, left: false },
            style: BorderStyle::Heavy,
            color: Some(Color::from("#ff0000")),
            title: Some("t".into()),
            title_align: TitleAlign::Right,
        };
        let nodes = [
            Node::Box {
                id: Some("b".into()),
                row: true,
                gap: 1,
                padding: (1, 2),
                justify: Justify::SpaceAround,
                align: Align::End,
                bg: Some(Color::from("text.base")),
                layout,
                on_click: Some(click.clone()),
                children: vec![Node::Keep { key: "k".into() }],
                border: Some(std::boxed::Box::new(border)),
                padding_sides: Some(Edges { top: 1, ..Edges::default() }),
                wrap: true,
                overflow: Overflow::Hidden,
            },
            Node::Text {
                id: Some("t".into()),
                spans: vec![span],
                fg: Some(Color::from("text.base")),
                wrap: Wrap::None,
                truncate: true,
                selectable: false,
                hover_fg: Some(Color::from("text.muted")),
                layout,
                on_click: Some(click),
            },
            Node::Slot { path: "home.footer".into() },
            Node::Markdown {
                id: Some("m".into()),
                source: Source::PartOutput(PartRef { session: "s".into(), part: "p".into() }),
            },
            Node::Spinner { id: Some("s".into()), label: "l".into() },
            Node::Scroll { id: Some("c".into()), height: Some(3), follow: true, layout, children: vec![] },
            Node::Diff {
                id: Some("d".into()),
                content: Source::Content(ContentRef(7)),
                view: DiffView::Split,
                filetype: Some("rust".into()),
            },
            Node::Markdown { id: None, source: Source::Text("x".into()) },
        ];
        for node in nodes {
            assert!(agree::<Node>("Node", serde_json::to_value(&node).unwrap()), "{node:?}");
        }
        let input = SurfaceInput {
            width: 1,
            height: 2,
            palette: Palette { mode: Mode::Light, colors: [("text.base".into(), Rgba::new(1, 2, 3, 4))].into() },
            full: true,
        };
        assert!(agree::<SurfaceInput>("SurfaceInput", serde_json::to_value(&input).unwrap()));
        let mount = MountId { surface: "s".into(), key: "k".into(), generation: 3 };
        assert!(agree::<MountId>("MountId", serde_json::to_value(&mount).unwrap()));
        let refused = [
            json!({ "type": "text" }),
            json!({ "type": "image", "id": "x" }),
            json!({ "type": "box", "gap": 70000 }),
            json!({ "type": "box", "layout": { "width": { "inches": 3 } } }),
            json!({ "type": "markdown", "source": { "text": "a", "content": 1 } }),
            json!({ "type": "diff", "content": { "content": -1 } }),
        ];
        for value in refused {
            assert!(!agree::<Node>("Node", value));
        }
        let taken = [
            json!({ "type": "box" }),
            json!({ "type": "text", "spans": [{ "text": "a", "fg": "#AABBCCDD" }], "fg": null }),
            json!({ "type": "box", "padding_sides": { "left": -2 }, "border": { "title": "t" } }),
        ];
        for value in taken {
            assert!(agree::<Node>("Node", value));
        }
        assert!(!agree::<SurfaceInput>("SurfaceInput", json!({ "width": 1, "height": 2 })));
        assert!(agree::<Rgba>("Rgba", json!("#AABBCCdd")));
        assert!(!agree::<Rgba>("Rgba", json!("#GG000000")));
    }
}
