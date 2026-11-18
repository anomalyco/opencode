//! The JSON Schema of the plugin ABI 2.0 (synthesis 4.6), generated from the Rust types without a dependency (O-132):
//! the tree a view returns and the calls of P3 here, the envelopes and replies of the C ABI in [`wire`]. Each
//! definition names every field and variant of its type, without `..`, so a field or a variant added to a type does
//! not compile until its schema has it; enum values are what serde writes. A test checks a corpus of trees against
//! both the schema and serde, and every message of the conformance transcripts against the schema.

use serde::Serialize;
use serde_json::{Value, json};

use crate::interact::{Interact, PanelInput};
use crate::v2::{
    Anchor, AnchorAt, Cause, ContentRef, DiffView, Edge, Fit, Frame, Geometry, LayoutReply, ListItem, Mode, MountId,
    Node, Notify, Paint, Palette, PartRef, Rect, Scroll, ScrollAlign, ScrollEvent, ScrollState, Source, Split,
    SurfaceInput, Target, Top, TranscriptRow, TranscriptView,
};
use crate::{
    Absolute, Action, Align, Border, BorderStyle, Changed, Click, Color, Edges, Justify, Layout, LocationRef, Overflow,
    Press, PromptInput, Sides, SlotInput, Span, TitleAlign, Width, Wrap,
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

/// An enum of `$ty` tagged by `type`, of struct variants as [`object!`]'s. A variant of `flat` holds a struct, written
/// as a struct variant: its fields beside the tag.
macro_rules! tagged {
    ($ty:ident, $description:expr, $(flat {
        $($flat:ident($struct:ident) { $($frequired:ident: $frs:expr),* $(,)? } { $($foptional:ident: $fos:expr),* $(,)? }),* $(,)?
    },)? {
        $($(#[$meta:meta])* $variant:ident { $($required:ident: $rs:expr),* $(,)? } { $($optional:ident: $os:expr),* $(,)? }),* $(,)?
    } $(, newtype { $($new:ident: $inner:expr),* $(,)? })?) => {{
        let _ = |value: &$ty| match value {
            $($($ty::$flat($struct { $($frequired: _,)* $($foptional: _,)* }) => (),)*)?
            $($(#[$meta])* $ty::$variant { $($required: _,)* $($optional: _,)* } => (),)*
            $($($ty::$new(_) => (),)*)?
        };
        let mut variants: Vec<Value> = Vec::new();
        $($(
            variants.push(object(
                &[$((stringify!($frequired), $frs)),*],
                &[$((stringify!($foptional), $fos)),*],
                Some(&kebab(stringify!($flat))),
                "",
            ));
        )*)?
        $(
            $(#[$meta])*
            variants.push(object(
                &[$((stringify!($required), $rs)),*],
                &[$((stringify!($optional), $os)),*],
                Some(&kebab(stringify!($variant))),
                "",
            ));
        )*
        // A variant of one value, whose fields sit beside the tag.
        $($(
            variants.push(json!({ "allOf": [$inner, object(&[], &[], Some(&kebab(stringify!($new))), "")] }));
        )*)?
        described(json!({ "oneOf": variants }), $description)
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

mod wire;

/// The JSON Schema of the plugin ABI 2.0, versioned by its `$id` and `x-abi`. Its definitions are normative: what
/// `describe` and `create` answer (`Metadata`, `Manifest`), the requests of each side (`Request`, `HostRequest`, with
/// `InputTo`), what each is answered with (`x-messages` names the definition of each request type's reply:
/// `ViewReply`, `ClaimReply`, `LayoutReply`, `Handled`, ...), the tree a view returns (`Node`), and the binary list a
/// draw returns (`DrawList`).
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
            filetype: nullable(string()), hunks: nullable(string()), wrap: reference("Wrap"), padding: uint16() },
        Input { } { id: nullable(string()), value: string(), placeholder: string(),
            lines: nullable(uint16()), layout: reference("Layout"), seen: nullable(uint64()) },
        List { } { id: nullable(string()), row: boolean(), items: array(reference("ListItem")),
            layout: reference("Layout"), notify_top: nullable(string()), user_scroll: boolean() },
        Code { content: reference("Source") } { id: nullable(string()), filetype: nullable(string()),
            numbers: boolean(), layout: reference("Layout") },
        Image { content: reference("Source") } { id: nullable(string()), fit: reference("Fit"),
            layout: reference("Layout") },
        Keep { key: string() } { },
        Canvas { } { id: nullable(string()), layout: reference("Layout"), version: uint64(), animate: boolean() },
        Fence { } { id: nullable(string()), bg: nullable(reference("Color")), layout: reference("Layout") },
        #[cfg(any(test, feature = "next"))]
        Later { text: string() } { id: nullable(string()) },
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
            object!(Changed, "What changed since a render's or a surface's last view.", { } {
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
        } { forced: boolean() }),
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
                min_width: nullable(reference("Width")), max_width: nullable(reference("Width")),
                height: nullable(reference("Width")),
                min_height: nullable(reference("Width")), max_height: nullable(reference("Width")),
                margin: nullable(reference("Edges")), absolute: nullable(reference("Absolute")),
            }),
        ),
        (
            "Absolute",
            object!(Absolute, "Where an absolute node sits: cells from its parent's edges, and its paint order.", { } {
                top: nullable(int16()), right: nullable(int16()), bottom: nullable(int16()), left: nullable(int16()),
                z: json!({ "type": "integer" }),
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
            } { mount: reference("MountId") }),
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
        defs.into_iter().chain(wire::definitions()).map(|(name, schema)| (name.to_owned(), schema)).collect();
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": format!("opencode plugin ABI {}.{}", crate::ABI_MAJOR, crate::ABI_MINOR),
        "description": "Generated from opencode_plugin_abi by `examples/schema.rs`; do not edit. Normative for every \
                        binding: `describe` answers Metadata and `create` a Manifest; the host's `call` sends a \
                        Request and the plugin's sends a HostRequest, each answered as `x-messages` says by the \
                        request's type; a view answers a ViewReply whose tree is a Node, and a draw a DrawList. A \
                        field the schema leaves out of `required` may be left out; a reader ignores a field it does \
                        not know. A later 2.x minor only adds optional fields, request types and node kinds. \
                        The HTTP API's types are references into its OpenAPI document, \
                        `packages/protocol/openapi.json`, relative to this file.",
        "x-abi": { "major": crate::ABI_MAJOR, "minor": crate::ABI_MINOR, "features": crate::FEATURES },
        "x-messages": wire::messages(),
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

fn int64() -> Value {
    json!({ "type": "integer", "minimum": i64::MIN, "maximum": i64::MAX })
}

fn uint64() -> Value {
    json!({ "type": "integer", "minimum": 0, "maximum": u64::MAX })
}

#[cfg(test)]
mod tests {
    use serde::de::DeserializeOwned;

    use super::*;
    use crate::Rgba;

    /// The HTTP API's OpenAPI document, which the schema's references name.
    fn openapi() -> &'static Value {
        static DOCUMENT: std::sync::LazyLock<Value> = std::sync::LazyLock::new(|| {
            let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("schema").join(wire::OPENAPI);
            serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap()
        });
        &DOCUMENT
    }

    /// The schema a reference names: a definition of ours, or a component of the OpenAPI document, whose own
    /// references are `#/components/...`. A reference that names nothing panics.
    fn resolve<'a>(path: &str, defs: &'a Value) -> &'a Value {
        if let Some(name) = path.strip_prefix("#/$defs/") {
            return defs.get(name).unwrap_or_else(|| panic!("{path} names no definition"));
        }
        let pointer = path.strip_prefix(wire::OPENAPI).unwrap_or(path).strip_prefix('#').unwrap_or_default();
        assert!(pointer.starts_with("/components/schemas/"), "{path} is no reference the schema may make");
        openapi().pointer(pointer).unwrap_or_else(|| panic!("{path} names no component of the OpenAPI document"))
    }

    /// Whether `value` conforms to `schema`, for the keywords [`schema`] and the OpenAPI document write, but the
    /// patterns of the OpenAPI document's strings. A schema with nothing to check, such as an annotation alone, panics:
    /// a binding could not check it either (bigboi's re-review). `{}` takes anything.
    fn conforms(value: &Value, schema: &Value, defs: &Value) -> bool {
        if *schema == json!({}) {
            return true;
        }
        const CHECKED: [&str; 8] = ["$ref", "anyOf", "allOf", "oneOf", "not", "const", "enum", "type"];
        let checks = schema.as_object().is_some_and(|object| object.keys().any(|key| CHECKED.contains(&key.as_str())));
        assert!(checks, "a schema with nothing to check: {schema}");
        if let Some(path) = schema.get("$ref").and_then(Value::as_str) {
            return conforms(value, resolve(path, defs), defs);
        }
        if schema.get("not").is_some_and(|not| conforms(value, not, defs)) {
            return false;
        }
        if let Some(any) = schema.get("anyOf").and_then(Value::as_array) {
            return any.iter().any(|schema| conforms(value, schema, defs));
        }
        if let Some(all) = schema.get("allOf").and_then(Value::as_array) {
            return all.iter().all(|schema| conforms(value, schema, defs));
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
        let types: Vec<&str> = match schema.get("type") {
            Some(Value::String(one)) => vec![one],
            Some(Value::Array(many)) => many.iter().filter_map(Value::as_str).collect(),
            _ => return true,
        };
        types.iter().any(|kind| typed(value, schema, kind, defs))
    }

    /// Whether `value` is of `kind` with `schema`'s bounds.
    fn typed(value: &Value, schema: &Value, kind: &str, defs: &Value) -> bool {
        let count = |key: &str| schema.get(key).and_then(Value::as_u64).map(|count| count as usize);
        let fits = |len: usize| {
            count("minItems").is_none_or(|min| len >= min) && count("maxItems").is_none_or(|max| len <= max)
        };
        match kind {
            "string" => value.as_str().is_some_and(|text| {
                let rgba = schema.get("pattern").and_then(Value::as_str) == Some(RGBA);
                count("minLength").is_none_or(|min| text.chars().count() >= min)
                    && (!rgba
                        || text.len() == 9 && text.starts_with('#') && text[1..].chars().all(|c| c.is_ascii_hexdigit()))
            }),
            "boolean" => value.is_boolean(),
            "null" => value.is_null(),
            "number" => value.as_f64().is_some_and(|n| {
                let bound = |key: &str| schema[key].as_f64();
                bound("minimum").is_none_or(|min| n >= min)
                    && bound("maximum").is_none_or(|max| n <= max)
                    && bound("exclusiveMinimum").is_none_or(|min| n > min)
            }),
            // In integers, as `u64::MAX` is no `f64`.
            "integer" => {
                let exact = |value: &Value| value.as_i64().map(i128::from).or(value.as_u64().map(i128::from));
                let bound = |key: &str| schema.get(key).and_then(exact);
                exact(value).is_some_and(|n| {
                    bound("minimum").is_none_or(|min| n >= min)
                        && bound("maximum").is_none_or(|max| n <= max)
                        && bound("exclusiveMinimum").is_none_or(|min| n > min)
                })
            }
            "array" => value.as_array().is_some_and(|items| {
                fits(items.len())
                    && match schema.get("prefixItems").and_then(Value::as_array) {
                        Some(prefix) => {
                            items.len() >= prefix.len()
                                && items.iter().zip(prefix).all(|(item, schema)| conforms(item, schema, defs))
                                && (items.len() == prefix.len() || schema.get("items") != Some(&json!(false)))
                        }
                        None => {
                            schema.get("items").is_none_or(|each| items.iter().all(|item| conforms(item, each, defs)))
                        }
                    }
            }),
            "object" => value.as_object().is_some_and(|object| {
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
            _ => false,
        }
    }

    /// The schema as it is shipped, `schema/v2.json`, which must be what [`schema`] generates.
    fn shipped() -> Value {
        let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("schema/v2.json");
        let shipped: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
        // The node kind of a later minor is the tests' own (`Node::Later`), which no shipped schema has.
        let mut generated = schema();
        if let Some(kinds) = generated["$defs"]["Node"]["oneOf"].as_array_mut() {
            kinds.retain(|kind| kind["properties"]["type"]["const"] != "later");
        }
        assert!(
            shipped == generated,
            "schema/v2.json is not what the generator writes: run script/gen/plugin-schema.ts"
        );
        shipped
    }

    /// Whether serde reads `value` as a `T`, and the schema's definition `name` takes it; both must agree.
    fn agree<T: DeserializeOwned>(name: &str, value: Value) -> bool {
        let schema = schema();
        let defs = &schema["$defs"];
        let read = serde_json::from_value::<T>(value.clone()).is_ok();
        assert_eq!(conforms(&value, &defs[name], defs), read, "{name}: {value} (serde reads it: {read})");
        read
    }

    // Expected (big-boi 14, carbon-13): every message of the golden transcripts, as the reference and the C library
    // wrote them, conforms to the schema: each request to its side's envelope, each answer of status OK to the
    // definition `x-messages` names for its request's type, and each draw's bytes to the list's format. A request type
    // `x-messages` does not name is answered with null.
    #[test]
    fn the_schema_takes_every_message_of_the_transcripts() {
        let schema = shipped();
        let defs = &schema["$defs"];
        let messages = &schema["x-messages"];
        let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugin/conformance/transcripts.jsonl");
        let text = std::fs::read_to_string(file).unwrap();
        let answer = |side: &str, kind: &str| messages[side].get(kind).unwrap_or(&messages[side]["*"]).clone();
        // What the next `return` answers: the schema of its reply, or `None` for a draw's bytes.
        let mut waiting: Vec<Option<Value>> = Vec::new();
        let (mut requests, mut replies, mut completed) = (0, 0, 0);
        for (number, line) in text.lines().enumerate() {
            let entry: Value = serde_json::from_str(line).unwrap();
            let at = format!("transcripts.jsonl:{}", number + 1);
            if entry == json!("describe") {
                waiting.push(Some(messages["describe"].clone()));
            } else if entry.get("create").is_some() {
                waiting.push(Some(messages["create"].clone()));
            } else if let Some(call) = entry.get("call") {
                let request = &call["request"];
                assert!(conforms(request, &defs["Request"], defs), "{at}: {request}");
                requests += 1;
                completed += usize::from(request["part"]["tool"]["state"]["status"] == "completed");
                let kind = request["type"].as_str().unwrap();
                waiting.push((kind != "draw").then(|| answer("call", kind)));
            } else if let Some(host) = entry.get("host") {
                let request = &host["request"];
                assert!(conforms(request, &defs["HostRequest"], defs), "{at}: {request}");
                requests += 1;
                if host["status"] == json!(crate::OK) {
                    let reply = answer("host", request["type"].as_str().unwrap());
                    assert!(conforms(&host["reply"], &reply, defs), "{at}: {} as {reply}", host["reply"]);
                    replies += 1;
                }
            } else if let Some(returned) = entry.get("return") {
                let expected = waiting.pop().unwrap_or_else(|| panic!("{at}: a return of no call"));
                if returned["status"] != json!(crate::OK) {
                    continue;
                }
                match expected {
                    Some(expected) => {
                        let reply = &returned["reply"];
                        assert!(conforms(reply, &expected, defs), "{at}: {reply} as {expected}");
                    }
                    None => {
                        let hex = returned["reply"]["list"].as_str().unwrap_or_default();
                        let bytes: Vec<u8> = (0..hex.len())
                            .step_by(2)
                            .map(|at| u8::from_str_radix(&hex[at..at + 2], 16).unwrap())
                            .collect();
                        assert_eq!(bytes.first().copied().map(u64::from), defs["DrawList"]["x-version"].as_u64());
                        assert!(crate::canvas::check(&bytes).is_ok(), "{at}: {hex}");
                    }
                }
                replies += 1;
            }
        }
        assert!(requests > 100 && replies > 100, "{requests} requests and {replies} replies checked");
        // A completed call, whose output the host keeps from the claim's view (bigboi's final pass).
        assert!(completed > 0, "no completed tool claim in the transcripts");
    }

    // Expected (bigboi's re-review, finding 14): the shipped schema resolves without Rust. Every reference it makes
    // names a definition of its own or a component of the HTTP API's OpenAPI document, whose key in Pascal case is the
    // generated Rust type; none is an annotation alone, which the validator refuses. Against the shipped file, a
    // `describe` without a nonempty ID is refused as `define` refuses it, and an API value of the wrong shape is refused
    // through its reference.
    #[test]
    fn the_shipped_schema_resolves_its_references_and_refuses_what_the_host_refuses() {
        let schema = shipped();
        let defs = &schema["$defs"];
        fn refs<'a>(value: &'a Value, found: &mut Vec<&'a str>) {
            match value {
                Value::Object(object) => {
                    found.extend(object.get("$ref").and_then(Value::as_str));
                    assert!(!object.contains_key("x-api"), "an annotation instead of a reference: {value}");
                    object.values().for_each(|value| refs(value, found));
                }
                Value::Array(values) => values.iter().for_each(|value| refs(value, found)),
                _ => {}
            }
        }
        let mut found = Vec::new();
        refs(&schema, &mut found);
        let types =
            std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../api-types/src/types.rs"))
                .unwrap();
        let mut api = 0;
        for path in found {
            let named = resolve(path, defs);
            assert!(named.is_object(), "{path}");
            if let Some(key) = path.strip_prefix(&format!("{}#/components/schemas/", wire::OPENAPI)) {
                // A pointer into a component names the component's own key first.
                let key = key.split('/').next().unwrap_or_default();
                api += 1;
                let rust: String = key.split('.').map(|part| part[..1].to_uppercase() + &part[1..]).collect();
                let declared = [format!("pub struct {rust} "), format!("pub enum {rust} ")];
                assert!(declared.iter().any(|line| types.contains(line.as_str())), "{key} is no Rust type {rust}");
            }
        }
        assert!(api >= 12, "{api} references into the OpenAPI document");
        let annotation = std::panic::catch_unwind(|| conforms(&json!({}), &json!({ "x-api": "Session.Info" }), defs));
        assert!(annotation.is_err(), "the validator took an annotation alone");
        let unknown = std::panic::catch_unwind(|| {
            conforms(&json!({}), &json!({ "$ref": format!("{}#/components/schemas/Nope", wire::OPENAPI) }), defs)
        });
        assert!(unknown.is_err(), "the validator took a reference that names nothing");
        let describe = |name: &str, value: Value| conforms(&value, &schema["x-messages"][name], defs);
        assert!(!describe("describe", json!({})));
        assert!(!describe("describe", json!({ "id": "" })));
        assert!(!describe("describe", json!({ "version": "1.0.0" })));
        assert!(describe("describe", json!({ "id": "x", "version": "1.0.0" })));
        let session = &schema["x-messages"]["host"]["session"];
        assert!(conforms(&Value::Null, session, defs));
        assert!(!conforms(&json!({ "info": 1, "status": "idle" }), session, defs));
        assert!(!conforms(&json!({ "info": {}, "status": "idle" }), session, defs), "an empty Session.Info");
        // A request ID is never 0, in what `fetch` answers and in a reply (bigboi's last pass).
        let fetched = &schema["x-messages"]["host"]["fetch"];
        assert!(conforms(&json!(1), fetched, defs) && !conforms(&json!(0), fetched, defs));
        let reply = |id| {
            serde_json::to_value(crate::Request::Reply { id: crate::RequestId(id), result: Ok(Value::Null) }).unwrap()
        };
        assert!(conforms(&reply(1), &defs["Request"], defs) && !conforms(&reply(0), &defs["Request"], defs));
    }

    // Expected (big-boi 14): the envelopes take and refuse what serde takes and refuses: an unknown request type, a
    // field left out that is required, a newtype variant's fields beside its tag, and a mount left out of a surface's
    // input, which a mount's begin and end do.
    #[test]
    fn the_envelopes_take_what_serde_takes() {
        for (value, taken) in [
            (json!({ "type": "plugins" }), true),
            (json!({ "type": "later" }), false),
            (json!({ "type": "unmount" }), false),
            (
                json!({ "type": "input", "to": { "type": "surface", "surface": 0 }, "event": { "type": "paste", "text": "x" } }),
                true,
            ),
            (json!({ "type": "input", "to": { "type": "surface" }, "event": { "type": "paste", "text": "x" } }), false),
            (
                json!({ "type": "render-fence", "language": "a", "info": "", "code": "", "streaming": false, "closed": false, "key": 1 }),
                true,
            ),
            (json!({ "type": "render-fence", "language": "a" }), false),
        ] {
            assert_eq!(agree::<crate::Request>("Request", value), taken);
        }
        for (value, taken) in [
            (json!({ "type": "toast", "variant": "info", "message": "m" }), true),
            (json!({ "type": "toast", "variant": "info" }), false),
            (json!({ "type": "fetch", "method": "GET", "path": "/x" }), true),
            (json!({ "type": "open-panel", "surface": "s", "fullscreen": true }), true),
            (json!({ "type": "overlay", "surface": "s", "anchor": { "edge": "top" }, "width": 1, "height": 1 }), true),
            (json!({ "type": "overlay", "surface": "s", "anchor": "top", "width": 1, "height": 1 }), false),
            (json!({ "type": "dialog", "dialog": { "type": "alert", "title": "t", "message": "m" } }), true),
            (json!({ "type": "model" }), true),
            (json!({ "type": "terminal" }), false),
        ] {
            assert_eq!(agree::<crate::HostRequest>("HostRequest", value), taken);
        }
        assert!(agree::<crate::Manifest>("Manifest", serde_json::to_value(crate::Manifest::default()).unwrap()));
        assert!(!agree::<crate::Manifest>("Manifest", json!({ "commands": [] })));
        assert!(agree::<crate::ViewReply>("ViewReply", json!({ "node": { "type": "box" }, "content": [[1, "x"]] })));
        assert!(agree::<crate::ViewReply>(
            "ViewReply",
            json!({ "node": { "type": "box" }, "content": [[1, { "base64": "AA==" }]] })
        ));
        assert!(!agree::<crate::ViewReply>("ViewReply", json!({ "content": [] })));
        assert!(agree::<crate::Render>("Render", json!({ "type": "show", "node": { "type": "slot", "path": "p" } })));
        assert!(!agree::<crate::Render>("Render", json!({ "type": "show" })));
        assert!(agree::<crate::claim::Part>(
            "ClaimPart",
            json!({ "type": "fence", "language": "l", "info": "", "code": "", "streaming": false, "closed": true })
        ));
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
            min_width: Some(Width::Cells(0)),
            max_width: Some(Width::Percent(40.0)),
            height: Some(Width::Cells(2)),
            min_height: Some(Width::Cells(1)),
            max_height: Some(Width::Cells(9)),
            margin: Some(Edges { top: -1, right: 1, bottom: 2, left: 3 }),
            absolute: Some(crate::Absolute { top: Some(-2), right: Some(2), bottom: None, left: None, z: 1 }),
        };
        let click = Click { action: Action::command("x").input("y"), on: Press::Down };
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
                wrap: Default::default(),
                padding: 0,
            },
            Node::Input {
                id: Some("i".into()),
                value: "v".into(),
                placeholder: "p".into(),
                lines: Some(3),
                layout,
                seen: Some(7),
            },
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
            panel: Some(PanelInput { width: 40, fullscreen: true, focused: true, forced: true }),
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
            mount: Some(mount.clone()),
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
