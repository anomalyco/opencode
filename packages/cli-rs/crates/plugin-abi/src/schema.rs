//! The JSON Schema of contract 2.0 (synthesis 4.6), generated from the Rust types without a dependency (O-132). Each
//! definition names every field and variant of its type, without `..`, so a field or a variant added to a type does
//! not compile until its schema has it; enum values are what serde writes. A test checks a corpus of trees against
//! both the schema and serde.

use serde::Serialize;
use serde_json::{Value, json};

use crate::interact::{Interact, PanelInput};
use crate::v2::{
    Anchor, AnchorAt, Cause, ContentRef, DiffView, Edge, Fit, Frame, Geometry, LayoutReply, ListItem, Mode, MountId,
    Node, Notify, Paint, Palette, PartRef, Rect, Scroll, ScrollAlign, ScrollEvent, ScrollState, Source, Split,
    SurfaceInput, Target, Top, TranscriptRow, TranscriptView,
};
use crate::{
    Action, Align, Border, BorderStyle, Changed, Click, Color, Edges, Justify, Layout, LocationRef, Overflow, Press,
    PromptInput, Sides, SlotInput, Span, TitleAlign, Width, Wrap,
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
/// gets against `#/$defs/SurfaceInput`, a mount against `#/$defs/MountId`, and what a draw gets against
/// `#/$defs/Frame`. The scroll verbs ([`Scroll`] on a [`Target`]), the reads ([`ScrollState`], [`AnchorAt`],
/// [`TranscriptView`]), the scroll events ([`ScrollEvent`]) and the `layout` call ([`Geometry`] in, [`LayoutReply`]
/// out) are under their names too.
pub fn schema() -> Value {
    let mut node = tagged!(Node, "A node of a surface's tree.", {
        Box { } { id: nullable(string()), row: boolean(), gap: uint16(), padding: pair(uint16(), uint16()),
            justify: reference("Justify"), align: reference("Align"), bg: nullable(reference("Color")),
            layout: reference("Layout"), on_click: nullable(reference("Click")),
            children: array(reference("Node")), border: nullable(reference("Border")),
            padding_sides: nullable(reference("Edges")), wrap: boolean(), overflow: reference("Overflow"),
            sticky: nullable(reference("Edge")), anchor: nullable(reference("Anchor")),
            split: nullable(reference("Split")), interact: Value::Null, visible: boolean() },
        Text { spans: array(reference("Span")) } { id: nullable(string()), fg: nullable(reference("Color")),
            wrap: reference("Wrap"), truncate: boolean(), selectable: boolean(),
            hover_fg: nullable(reference("Color")), layout: reference("Layout"),
            on_click: nullable(reference("Click")), hover_events: boolean() },
        Slot { path: string() } { },
        Markdown { source: reference("Source") } { id: nullable(string()) },
        Spinner { label: string() } { id: nullable(string()) },
        Scroll { } { id: nullable(string()), height: nullable(uint16()), follow: boolean(),
            layout: reference("Layout"), children: array(reference("Node")),
            notify_top: nullable(string()), user_scroll: boolean() },
        Diff { content: reference("Source") } { id: nullable(string()), view: reference("DiffView"),
            filetype: nullable(string()), hunks: nullable(string()) },
        Input { } { id: nullable(string()), value: string(), placeholder: string(),
            lines: nullable(uint16()), layout: reference("Layout") },
        List { } { id: nullable(string()), row: boolean(), items: array(reference("ListItem")),
            layout: reference("Layout"), notify_top: nullable(string()), user_scroll: boolean() },
        Code { content: reference("Source") } { id: nullable(string()), filetype: nullable(string()),
            numbers: boolean(), layout: reference("Layout") },
        Image { content: reference("Source") } { id: nullable(string()), fit: reference("Fit"),
            layout: reference("Layout") },
        Keep { key: string() } { },
        Canvas { } { id: nullable(string()), layout: reference("Layout"), version: uint64(), animate: boolean() },
    });
    // A box's `interact` is flattened: its fields sit beside the box's own.
    let interact = object!(Interact, "", { } {
        focusable: boolean(), pointer: boolean(), hover: nullable(reference("Color")), hover_events: boolean(),
    });
    if let Some(boxed) = node["oneOf"].as_array_mut().and_then(|variants| variants.first_mut()) {
        let properties = boxed["properties"].as_object_mut().expect("a box has properties");
        properties.remove("interact");
        properties.extend(interact["properties"].as_object().cloned().unwrap_or_default());
    }
    let defs: Vec<(&str, Value)> = vec![
        ("Node", node),
        (
            "ListItem",
            object!(ListItem, "An item of a list: a node with an id, and the rows assumed until it is laid out.", {
                node: reference("Node"),
            } { estimate: uint16() }),
        ),
        ("Edge", unit!(Edge { Top, Bottom })),
        ("Fit", unit!(Fit { Contain, Cover, Fill })),
        (
            "Anchor",
            object!(Anchor, "One of a named group of a scroll's anchors.", { group: string() } { variant: string() }),
        ),
        ("Split", object!(Split, "A row whose first child the user resizes.", { at: uint16() } { min: uint16() })),
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
            } {
                full: boolean(), panel: nullable(reference("PanelInput")), changed: reference("Changed"),
                slot: nullable(reference("SlotInput")),
            }),
        ),
        (
            "SlotInput",
            object!(SlotInput, "What a slot passes to what renders in it.", { } {
                session_id: nullable(string()), prompt: nullable(reference("PromptInput")), width: uint16(),
                height: uint16(),
            }),
        ),
        (
            "PromptInput",
            object!(PromptInput, "The prompt's mode, and whether its details show.", {
                shell: boolean(), show_details: boolean(),
            } { }),
        ),
        (
            "Changed",
            object!(Changed, "What changed since a surface's last view, as a 1.x render hears it.", { } {
                all: boolean(), sessions: array(string()), lists: array(string()),
                messages: array(pair(string(), string())), locations: array(reference("LocationRef")),
                local: boolean(), size: boolean(), woken: boolean(),
            }),
        ),
        (
            "LocationRef",
            object!(LocationRef, "A location: a directory, and a workspace in it.", { directory: string() } {
                workspace: nullable(string()),
            }),
        ),
        (
            "PanelInput",
            object!(PanelInput, "How a panel surface shows.", {
            width: uint16(), fullscreen: boolean(), focused: boolean(),
        } { }),
        ),
        (
            "Frame",
            object!(Frame, "The frame a canvas draws for: its size in cells, why, and the animation's time.", {
            width: uint16(), height: uint16(), cause: reference("Cause"), dt: reference("Duration"),
        } { }),
        ),
        ("Cause", unit!(Cause { First, Resized, Version, Animate })),
        (
            "Duration",
            object(
                &[("secs", uint64()), ("nanos", json!({ "type": "integer", "minimum": 0, "maximum": 999_999_999 }))],
                &[],
                None,
                "A span of time in whole seconds and nanoseconds, as serde writes `std::time::Duration`.",
            ),
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
                underline: boolean(), dim: boolean(), strikethrough: boolean(), link: nullable(string()),
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
        (
            "ScrollAlign",
            tagged!(ScrollAlign, "Where a node goes when a `to` verb brings it into view.", {
                Start { } { },
                Keep { } { },
                Nearest { } { inset: uint16() },
            }),
        ),
        (
            "Scroll",
            tagged!(Scroll, "A scroll verb, an effect of a handler; the host clamps it to the content.", {
                To { node: string() } { align: reference("ScrollAlign") },
                Offset { offset: int32() } { },
                By { rows: int32() } { },
                Page { percent: int16() } { },
                Edge { edge: reference("Edge") } { },
                Step { group: string(), by: int32() } { inset: uint16() },
                Forget { } { },
            }),
        ),
        (
            "Target",
            tagged!(Target, "What a verb or a read names: a scroll of the plugin's surface, or the transcript.", {
                Node { surface: string(), id: string() } { },
                Transcript { } { },
            }),
        ),
        (
            "ScrollState",
            object!(ScrollState, "Where a scroll is, in rows.", {
                offset: int32(), viewport: int32(), extent: int32(),
            } { }),
        ),
        (
            "AnchorAt",
            object!(AnchorAt, "An anchor and its row in its scroll's content.", {
                id: string(), owner: string(), row: int32(),
            } { index: uint32(), variant: string() }),
        ),
        (
            "ScrollEvent",
            tagged!(ScrollEvent, "What the host tells a surface about its scrolls.", {
                Landed { scroll: string(), anchor: reference("AnchorAt") } { },
                UserScroll { scroll: string() } { },
            }),
        ),
        (
            "Notify",
            tagged!(Notify, "What a surface asks its `layout` call to be told about.", {
                Node { id: string() } { },
                Scroll { id: string() } { },
                Group { scroll: string(), group: string() } { },
                Transcript { } { },
            }),
        ),
        (
            "Rect",
            object!(Rect, "A rect in the surface's own cells.", {
                x: int32(), y: int32(), width: int32(), height: int32(),
            } { }),
        ),
        (
            "Top",
            object!(Top, "The top anchor of a group in a scroll.", {
                scroll: string(), group: string(), anchor: nullable(reference("AnchorAt")),
            } { }),
        ),
        (
            "Geometry",
            object!(Geometry, "What a `layout` call gets: this frame's geometry of what the surface named.", {
                rects: array(pair(string(), reference("Rect"))),
                scrolls: array(pair(string(), reference("ScrollState"))),
                groups: array(triple(string(), string(), array(reference("AnchorAt")))),
                tops: array(reference("Top")),
                moved_only: boolean(),
                reached: array(pair(string(), int32())),
                transcript: nullable(reference("TranscriptView")),
            } { }),
        ),
        ("Paint", object!(Paint, "A box's background `layout` sets.", { node: string(), bg: reference("Color") } { })),
        (
            "LayoutReply",
            object!(LayoutReply, "What a `layout` call returns.", { } {
                paints: array(reference("Paint")), again: boolean(),
            }),
        ),
        (
            "TranscriptView",
            object!(TranscriptView, "The session transcript's scroll, as the host publishes it.", {
                offset: int32(), viewport: int32(), extent: int32(), revision: uint64(), above: uint32(),
                rows: array(reference("TranscriptRow")),
            } { }),
        ),
        (
            "TranscriptRow",
            object!(TranscriptRow, "A mounted row of the transcript.", {
                kind: string(), message: string(), row: int32(), height: int32(),
            } { part: nullable(string()) }),
        ),
    ];
    let defs: serde_json::Map<String, Value> =
        defs.into_iter().map(|(name, schema)| (name.to_owned(), schema)).collect();
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "opencode plugin contract 2.0",
        "description": "Generated from opencode_plugin_abi::v2 by `examples/schema.rs`; do not edit. The root is a Node, \
                        the tree a view returns; SurfaceInput and MountId are what a view gets, and Frame what a \
                        draw gets.",
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

fn triple(first: Value, second: Value, third: Value) -> Value {
    json!({ "type": "array", "prefixItems": [first, second, third], "minItems": 3, "maxItems": 3 })
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

fn int32() -> Value {
    json!({ "type": "integer", "minimum": i32::MIN, "maximum": i32::MAX })
}

fn uint32() -> Value {
    json!({ "type": "integer", "minimum": 0, "maximum": u32::MAX })
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
        match schema.get("type").and_then(Value::as_str) {
            Some("string") => value.as_str().is_some_and(|text| match schema.get("pattern") {
                Some(_) => text.len() == 9 && text.starts_with('#') && text[1..].chars().all(|c| c.is_ascii_hexdigit()),
                None => true,
            }),
            Some("boolean") => value.is_boolean(),
            Some("null") => value.is_null(),
            Some("number") => value.as_f64().is_some_and(|n| {
                let bound = |key: &str| schema[key].as_f64();
                bound("minimum").is_none_or(|min| n >= min) && bound("maximum").is_none_or(|max| n <= max)
            }),
            // In integers, as `u64::MAX` is no `f64`.
            Some("integer") => {
                let exact = |value: &Value| value.as_i64().map(i128::from).or(value.as_u64().map(i128::from));
                let bound = |key: &str| schema.get(key).and_then(exact);
                exact(value).is_some_and(|n| {
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
        }
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
            link: Some("https://opencode.ai".into()),
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
                sticky: Some(Edge::Bottom),
                anchor: Some(Anchor::new("file", "reviewed")),
                split: Some(Split { at: 30, min: 4 }),
                interact: Interact {
                    focusable: true,
                    pointer: true,
                    hover: Some(Color::from("background.raised")),
                    hover_events: true,
                },
                visible: false,
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
                hover_events: true,
            },
            Node::Slot { path: "home.footer".into() },
            Node::Markdown {
                id: Some("m".into()),
                source: Source::PartOutput(PartRef { session: "s".into(), part: "p".into() }),
            },
            Node::Spinner { id: Some("s".into()), label: "l".into() },
            Node::Scroll {
                id: Some("c".into()),
                height: Some(3),
                follow: true,
                layout,
                children: vec![],
                notify_top: Some("file".into()),
                user_scroll: true,
            },
            Node::Diff {
                id: Some("d".into()),
                content: Source::Content(ContentRef(7)),
                view: DiffView::Split,
                filetype: Some("rust".into()),
                hunks: Some("hunk".into()),
            },
            Node::Input { id: Some("i".into()), value: "v".into(), placeholder: "p".into(), lines: Some(3), layout },
            Node::List {
                id: Some("l".into()),
                row: true,
                items: vec![ListItem::new(Node::Keep { key: "k".into() }, 9)],
                layout,
                notify_top: Some("file".into()),
                user_scroll: true,
            },
            Node::Code {
                id: Some("o".into()),
                content: Source::Text("fn x() {}".into()),
                filetype: Some("rust".into()),
                numbers: true,
                layout,
            },
            Node::Image { id: Some("g".into()), content: Source::Content(ContentRef(2)), fit: Fit::Cover, layout },
            Node::Markdown { id: None, source: Source::Text("x".into()) },
            Node::Canvas { id: Some("v".into()), layout, version: 7, animate: true },
        ];
        for node in nodes {
            assert!(agree::<Node>("Node", serde_json::to_value(&node).unwrap()), "{node:?}");
        }
        let input = SurfaceInput {
            width: 1,
            height: 2,
            palette: Palette { mode: Mode::Light, colors: [("text.base".into(), Rgba::new(1, 2, 3, 4))].into() },
            full: true,
            panel: Some(PanelInput { width: 40, fullscreen: true, focused: true }),
            changed: Changed {
                all: true,
                sessions: vec!["ses_a".into()],
                lists: vec!["ses_a".into()],
                messages: vec![("ses_a".into(), "msg_1".into())],
                locations: vec![LocationRef { directory: "/p".into(), workspace: Some("w".into()) }],
                local: true,
                size: true,
                woken: true,
            },
            slot: Some(SlotInput {
                session_id: Some("ses_a".into()),
                prompt: Some(PromptInput { shell: true, show_details: true }),
                width: 3,
                height: 4,
            }),
        };
        assert!(agree::<SurfaceInput>("SurfaceInput", serde_json::to_value(&input).unwrap()));
        let mount = MountId { surface: "s".into(), key: "k".into(), generation: u64::MAX };
        assert!(agree::<MountId>("MountId", serde_json::to_value(&mount).unwrap()));
        for cause in [Cause::First, Cause::Resized, Cause::Version, Cause::Animate] {
            let frame = Frame { width: 3, height: 2, cause, dt: std::time::Duration::new(1, 999_999_999) };
            assert!(agree::<Frame>("Frame", serde_json::to_value(frame).unwrap()), "{frame:?}");
        }
        let frame = |cause: Value, dt: Value| json!({ "width": 1, "height": 1, "cause": cause, "dt": dt });
        assert!(!agree::<Frame>("Frame", frame(json!("drawn"), json!({ "secs": 0, "nanos": 0 }))));
        assert!(!agree::<Frame>("Frame", frame(json!("first"), json!({ "secs": 0 }))));
        assert!(!agree::<Frame>("Frame", frame(json!("first"), json!({ "secs": -1, "nanos": 0 }))));
        // The calls of P3, every variant with every field set.
        let anchor = AnchorAt { id: "d#1".into(), owner: "d".into(), index: 1, variant: "v".into(), row: -3 };
        let verbs = [
            Scroll::To { node: "n".into(), align: ScrollAlign::Nearest { inset: 2 } },
            Scroll::To { node: "n".into(), align: ScrollAlign::Keep },
            Scroll::To { node: "n".into(), align: ScrollAlign::Start },
            Scroll::Offset { offset: -1 },
            Scroll::By { rows: i32::MIN },
            Scroll::Page { percent: i16::MIN },
            Scroll::Edge { edge: Edge::Bottom },
            Scroll::Step { group: "g".into(), by: -2, inset: 1 },
            Scroll::Forget,
        ];
        for verb in verbs {
            assert!(agree::<Scroll>("Scroll", serde_json::to_value(&verb).unwrap()), "{verb:?}");
        }
        for target in [Target::node("s", "i"), Target::Transcript] {
            assert!(agree::<Target>("Target", serde_json::to_value(&target).unwrap()));
        }
        let state = ScrollState { offset: 1, viewport: 2, extent: 3 };
        assert!(agree::<ScrollState>("ScrollState", serde_json::to_value(state).unwrap()));
        for event in [
            ScrollEvent::Landed { scroll: "s".into(), anchor: anchor.clone() },
            ScrollEvent::UserScroll { scroll: "s".into() },
        ] {
            assert!(agree::<ScrollEvent>("ScrollEvent", serde_json::to_value(&event).unwrap()));
        }
        let notify = [
            Notify::Node { id: "n".into() },
            Notify::Scroll { id: "s".into() },
            Notify::Group { scroll: "s".into(), group: "g".into() },
            Notify::Transcript,
        ];
        for notify in notify {
            assert!(agree::<Notify>("Notify", serde_json::to_value(&notify).unwrap()));
        }
        let transcript = TranscriptView {
            offset: 1,
            viewport: 2,
            extent: 3,
            revision: u64::MAX,
            above: 4,
            rows: vec![TranscriptRow {
                kind: "tool".into(),
                message: "m".into(),
                part: Some("p".into()),
                row: 0,
                height: 2,
            }],
        };
        let geometry = Geometry {
            rects: vec![("n".into(), Rect { x: -1, y: 2, width: 3, height: 4 })],
            scrolls: vec![("s".into(), state)],
            groups: vec![("s".into(), "g".into(), vec![anchor.clone()])],
            tops: vec![Top { scroll: "s".into(), group: "g".into(), anchor: Some(anchor) }],
            moved_only: true,
            reached: vec![("s".into(), 7)],
            transcript: Some(transcript),
        };
        assert!(agree::<Geometry>("Geometry", serde_json::to_value(&geometry).unwrap()));
        let reply = LayoutReply::default().paint("n", "text.base");
        assert!(agree::<LayoutReply>(
            "LayoutReply",
            serde_json::to_value(LayoutReply { again: true, ..reply }).unwrap()
        ));
        // What a plugin may leave out, and what neither takes.
        for (verb, taken) in [
            (json!({ "type": "to", "node": "n" }), true),
            (json!({ "type": "to", "node": "n", "align": { "type": "nearest" } }), true),
            (json!({ "type": "step", "group": "g", "by": 1 }), true),
            (json!({ "type": "step", "group": "g" }), false),
            (json!({ "type": "page", "percent": 40000 }), false),
            (json!({ "type": "forget", "node": "n" }), true),
            (json!({ "type": "edge", "edge": "left" }), false),
        ] {
            assert_eq!(agree::<Scroll>("Scroll", verb), taken);
        }
        assert!(agree::<LayoutReply>("LayoutReply", json!({})));
        // serde reads a percent past `f32` as infinite, as the schema takes it; the reconcile refuses a size that is not
        // finite (`Refused::Number`).
        assert!(agree::<Node>("Node", json!({ "type": "box", "layout": { "width": { "percent": 1e100 } } })));
        let past: Value =
            serde_json::from_str(r#"{ "surface": "s", "key": "k", "generation": 18446744073709551616 }"#).unwrap();
        assert!(!agree::<MountId>("MountId", past));
        let refused = [
            json!({ "type": "text" }),
            json!({ "type": "image", "id": "x" }),
            json!({ "type": "box", "gap": 70000 }),
            json!({ "type": "box", "layout": { "width": { "inches": 3 } } }),
            json!({ "type": "markdown", "source": { "text": "a", "content": 1 } }),
            json!({ "type": "diff", "content": { "content": -1 } }),
            json!({ "type": "canvas", "version": -1 }),
            json!({ "type": "canvas", "animate": 1 }),
            json!({ "type": "list", "items": [{ "estimate": 3 }] }),
            json!({ "type": "box", "sticky": "left" }),
        ];
        for value in refused {
            assert!(!agree::<Node>("Node", value));
        }
        let taken = [
            json!({ "type": "box" }),
            json!({ "type": "text", "spans": [{ "text": "a", "fg": "#AABBCCDD" }], "fg": null }),
            json!({ "type": "box", "padding_sides": { "left": -2 }, "border": { "title": "t" } }),
            json!({ "type": "box", "id": "b", "focusable": true, "hover": "text.muted" }),
        ];
        for value in taken {
            assert!(agree::<Node>("Node", value));
        }
        assert!(!agree::<SurfaceInput>("SurfaceInput", json!({ "width": 1, "height": 2 })));
        assert!(agree::<Rgba>("Rgba", json!("#AABBCCdd")));
        assert!(!agree::<Rgba>("Rgba", json!("#GG000000")));
    }
}
