//! Tool schemas: JSON Schema documents rendered into model-visible TypeScript signatures, and optionally validated.
//!
//! The reference takes either an Effect Schema, which validates, or a render-only JSON Schema. Here both are JSON
//! Schema documents: [`Schema::validated`] plays the Effect Schema's part and [`Schema::render_only`] the plain JSON
//! Schema's. Rendering follows `tool-schema.ts` line by line, so signatures match it byte for byte.

use crate::Json;
use crate::convert::quote;
use crate::value::write_num;

/// A tool's input or output contract.
#[derive(Clone, Debug)]
pub struct Schema {
    doc: Json,
    validator: Option<std::sync::Arc<Validator>>,
}

impl Schema {
    /// A schema that also checks values, the way the reference decodes an Effect Schema: input is checked before the
    /// tool runs and output before the program sees it. See [`Schema::validate`] for the keywords it checks.
    pub fn validated(doc: Json) -> Self {
        let doc = js_key_order(doc);
        let validator = Some(std::sync::Arc::new(Validator::new(&doc)));
        Self { doc, validator }
    }

    /// A schema that only shapes the model-visible signature; values pass through unchecked.
    pub fn render_only(doc: Json) -> Self {
        let doc = js_key_order(doc);
        Self {
            doc,
            validator: None,
        }
    }

    pub fn document(&self) -> &Json {
        &self.doc
    }

    pub fn is_validating(&self) -> bool {
        self.validator.is_some()
    }

    /// The value as the tool or program receives it, or the reference's `SchemaError(...)` text.
    ///
    /// Checked: `type` (one or several), `enum`, `const`, `properties`, `required`, `additionalProperties` (excess
    /// properties are dropped when it is `false`, as an Effect `Struct` drops them, and checked when it is a schema),
    /// `items`, `anyOf`, `oneOf`, `allOf`, `$ref` into `$defs`/`definitions`, `minimum`, `maximum`,
    /// `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `minLength`, `maxLength`, `minItems`, `maxItems` and
    /// `uniqueItems`: the constraints an Effect Schema's JSON Schema document is made of. `pattern` and `format` only
    /// render: the crate has no regular-expression engine, and Effect's `format` is an annotation.
    #[inline]
    pub fn validate(&self, value: Json) -> Result<Json, String> {
        match &self.validator {
            None => Ok(value),
            Some(v) => v.validate(value),
        }
    }
}

impl Validator {
    #[inline(never)]
    fn validate(&self, value: Json) -> Result<Json, String> {
        check(&self.root, value, self, 0)
            .map_err(|(message, path)| format!("SchemaError({message}{})", render_path(&path)))
    }
}

/// Object keys in the order JavaScript enumerates them: array indices (canonical integers below 2³² − 1) first and
/// ascending, then the other keys in insertion order. Documents read as JavaScript objects render in this order.
pub fn js_key_order(v: Json) -> Json {
    match v {
        Json::Array(items) => Json::Array(items.into_iter().map(js_key_order).collect()),
        Json::Object(map) => {
            let index = |k: &str| {
                (k == "0"
                    || (!k.starts_with('0')
                        && !k.is_empty()
                        && k.bytes().all(|b| b.is_ascii_digit())))
                .then(|| k.parse::<u64>().ok())
                .flatten()
                .filter(|n| *n < u64::from(u32::MAX))
            };
            let reorder = map.keys().any(|k| index(k).is_some());
            let mut entries: Vec<(String, Json)> =
                map.into_iter().map(|(k, v)| (k, js_key_order(v))).collect();
            if reorder {
                let (mut ints, strs): (Vec<_>, Vec<_>) =
                    entries.into_iter().partition(|(k, _)| index(k).is_some());
                ints.sort_by_key(|(k, _)| index(k));
                entries = ints;
                entries.extend(strs);
            }
            Json::Object(entries.into_iter().collect())
        }
        other => other,
    }
}

// ---------- rendering ----------

const MAX_RENDER_DEPTH: usize = 8;
const MIN_SAFE_INTEGER: f64 = -9_007_199_254_740_991.0;
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

type Defs = Vec<(String, Json)>;

#[derive(Clone)]
struct Ctx {
    definitions: Defs,
    pretty: bool,
}

/// A property of a schema object, with JSON `null` read as absent the way the reference's `??` and truthiness read
/// `undefined`.
fn field<'a>(s: &'a Json, key: &str) -> Option<&'a Json> {
    match s.get(key) {
        None | Some(Json::Null) => None,
        Some(v) => Some(v),
    }
}

fn truthy(v: Option<&Json>) -> bool {
    match v {
        None | Some(Json::Null) | Some(Json::Bool(false)) => false,
        Some(Json::Number(n)) => n.as_f64().is_some_and(|n| n != 0.0),
        Some(Json::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

fn type_is(s: &Json, name: &str) -> bool {
    s.get("type").and_then(Json::as_str) == Some(name)
}

fn number(s: &Json, key: &str) -> Option<f64> {
    s.get(key).and_then(Json::as_f64)
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// `JSON.stringify` of host JSON: compact, with JavaScript number formatting.
pub fn js_stringify(v: &Json) -> String {
    let mut out = String::new();
    write_js_json(&mut out, v);
    out
}

fn write_js_json(out: &mut String, v: &Json) {
    match v {
        Json::Null => out.push_str("null"),
        Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Json::Number(n) => match n.as_f64() {
            Some(x) if x.is_finite() => write_num(out, x),
            _ => out.push_str("null"),
        },
        Json::String(s) => quote(out, s),
        Json::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_js_json(out, item);
            }
            out.push(']');
        }
        Json::Object(map) => {
            out.push('{');
            for (i, (k, item)) in map.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                quote(out, k);
                out.push(':');
                write_js_json(out, item);
            }
            out.push('}');
        }
    }
}

fn js_num(x: f64) -> String {
    let mut s = String::new();
    write_num(&mut s, x);
    s
}

/// `/^[A-Za-z_$][A-Za-z0-9_$]*$/`
pub fn is_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' || c == '$' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

fn render_key(name: &str) -> String {
    if is_identifier(name) {
        name.to_owned()
    } else {
        js_stringify(&Json::String(name.to_owned()))
    }
}

/// The definition a local `$ref` names: `#/$defs/<name>` or `#/definitions/<name>`.
fn definition_name(reference: &str) -> Option<String> {
    let fragment = reference.strip_prefix('#')?;
    let decoded = percent_decode(fragment)?;
    if decoded.is_empty() {
        return None;
    }
    let rest = decoded.strip_prefix('/')?;
    let tokens: Vec<String> = rest
        .split('/')
        .map(|t| t.replace("~1", "/").replace("~0", "~"))
        .collect();
    if tokens.len() == 2 && (tokens[0] == "$defs" || tokens[0] == "definitions") {
        return Some(tokens[1].clone());
    }
    None
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn lookup<'a>(defs: &'a Defs, name: &str) -> Option<&'a Json> {
    defs.iter().rev().find(|(k, _)| k == name).map(|(_, v)| v)
}

fn extend_defs(defs: &mut Defs, map: Option<&Json>) {
    if let Some(Json::Object(m)) = map {
        defs.extend(m.iter().map(|(k, v)| (k.clone(), v.clone())));
    }
}

/// `{ ...schema, key: undefined }`: kept as `null`, which reads as absent, so the key still counts in key checks.
fn without(s: &Json, key: &str) -> Json {
    let mut copy = s.clone();
    if let Json::Object(m) = &mut copy {
        m.insert(key.to_owned(), Json::Null);
    }
    copy
}

fn effect_number_sentinel(s: &Json) -> bool {
    type_is(s, "string")
        && match s.get("enum") {
            Some(Json::Array(values)) => {
                !values.is_empty()
                    && values.iter().all(|v| {
                        matches!(
                            v.as_str(),
                            Some("NaN") | Some("Infinity") | Some("-Infinity")
                        )
                    })
            }
            _ => false,
        }
}

const ANNOTATIONS: [&str; 6] = [
    "title",
    "description",
    "default",
    "examples",
    "readOnly",
    "writeOnly",
];

fn is_effect_empty_struct(s: &Json) -> bool {
    let Some(not) = field(s, "not") else {
        return false;
    };
    type_is(not, "null")
        && not.as_object().is_some_and(|m| m.len() == 1)
        && s.as_object().is_some_and(|m| {
            m.keys()
                .all(|k| k == "not" || ANNOTATIONS.contains(&k.as_str()))
        })
}

fn intersection(members: Vec<String>) -> String {
    let concrete: Vec<String> = members.into_iter().filter(|m| m != "unknown").collect();
    match concrete.len() {
        0 => "unknown".into(),
        1 => concrete.into_iter().next().unwrap_or_default(),
        _ => concrete
            .iter()
            .map(|m| {
                if m.contains(" | ") {
                    format!("({m})")
                } else {
                    m.clone()
                }
            })
            .collect::<Vec<_>>()
            .join(" & "),
    }
}

fn children(s: &Json) -> Vec<&Json> {
    let mut out = Vec::new();
    for key in ["anyOf", "oneOf", "allOf"] {
        if let Some(Json::Array(items)) = field(s, key) {
            out.extend(items.iter());
        }
    }
    if let Some(Json::Object(props)) = field(s, "properties") {
        out.extend(props.values());
    }
    if let Some(items) = field(s, "items") {
        out.push(items);
    }
    if let Some(a @ Json::Object(_)) = field(s, "additionalProperties") {
        out.push(a);
    }
    out
}

fn has_unresolved_ref(s: &Json, defs: &Defs, seen: &[String], depth: usize) -> bool {
    // Schemas are trees here, so the reference's identity guard against cycles becomes a depth bound.
    if depth > 64 {
        return false;
    }
    if let Some(reference) = field(s, "$ref") {
        let Some(name) = reference.as_str().and_then(definition_name) else {
            return true;
        };
        let Some(def) = lookup(defs, &name) else {
            return true;
        };
        if seen.contains(&name) {
            return true;
        }
        let mut next = seen.to_vec();
        next.push(name);
        if has_unresolved_ref(def, defs, &next, depth + 1) {
            return true;
        }
    }
    children(s)
        .into_iter()
        .any(|c| has_unresolved_ref(c, defs, seen, depth + 1))
}

fn doc_tags(s: &Json) -> Vec<String> {
    let mut tags = Vec::new();
    if s.get("deprecated") == Some(&Json::Bool(true)) {
        tags.push("@deprecated".to_owned());
    }
    if let Some(d) = s.get("default") {
        tags.push(format!("@default {}", js_stringify(d)));
    }
    if let Some(f) = s.get("format").and_then(Json::as_str) {
        tags.push(format!("@format {f}"));
    }
    let integer = type_is(s, "integer");
    if integer {
        tags.push("@integer".to_owned());
    }
    if let Some(m) = number(s, "minimum")
        && !(integer && m == MIN_SAFE_INTEGER)
    {
        tags.push(format!("@minimum {}", js_num(m)));
    }
    if let Some(m) = number(s, "maximum")
        && !(integer && m == MAX_SAFE_INTEGER)
    {
        tags.push(format!("@maximum {}", js_num(m)));
    }
    for key in [
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
        "minLength",
        "maxLength",
    ] {
        if let Some(m) = number(s, key) {
            tags.push(format!("@{key} {}", js_num(m)));
        }
    }
    if let Some(p) = s.get("pattern").and_then(Json::as_str) {
        tags.push(format!("@pattern {p}"));
    }
    for key in ["minItems", "maxItems"] {
        if let Some(m) = number(s, key) {
            tags.push(format!("@{key} {}", js_num(m)));
        }
    }
    if s.get("uniqueItems") == Some(&Json::Bool(true)) {
        tags.push("@uniqueItems true".to_owned());
    }
    tags
}

fn is_js_space(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}'
}

fn doc_lines(s: &Json, width: usize) -> Vec<String> {
    let summary = doc_tags(s).join(" ");
    let description = s.get("description").and_then(Json::as_str).unwrap_or("");
    let mut lines: Vec<String> = description
        .split('\n')
        .map(|l| l.trim_end_matches(is_js_space).to_owned())
        .collect();
    while lines
        .first()
        .is_some_and(|l| l.trim_matches(is_js_space).is_empty())
    {
        lines.remove(0);
    }
    while lines
        .last()
        .is_some_and(|l| l.trim_matches(is_js_space).is_empty())
    {
        lines.pop();
    }
    let inline = if lines.len() == 1 {
        let dot = if lines[0].ends_with('.') { "" } else { "." };
        format!("{}{dot} {summary}", lines[0])
    } else {
        summary.clone()
    };
    if !summary.is_empty()
        && lines.len() == 1
        && !summary.contains('\n')
        && width + utf16_len(&inline) + 7 <= 120
    {
        return vec![inline];
    }
    if !summary.is_empty() {
        lines.extend(summary.split('\n').map(str::to_owned));
    }
    lines
}

fn types_of(s: &Json) -> Vec<String> {
    match s.get("type") {
        Some(Json::String(t)) => vec![t.clone()],
        Some(Json::Array(items)) => items
            .iter()
            .filter_map(|t| t.as_str().map(str::to_owned))
            .collect(),
        _ => Vec::new(),
    }
}

fn jsdoc(s: &Json, pad: &str) -> String {
    let pad_len = utf16_len(pad);
    let mut content = doc_lines(s, pad_len);
    let types = types_of(s);
    let mut append = |label: &str, child: &Json| {
        for (i, line) in doc_lines(child, pad_len + label.len() + 2)
            .into_iter()
            .enumerate()
        {
            if i == 0 {
                content.push(format!("{label}: {line}"));
            } else if line.is_empty() {
                content.push(String::new());
            } else {
                content.push(format!("  {line}"));
            }
        }
    };
    if types.iter().any(|t| t == "array")
        && let Some(items) = s.get("items")
        && truthy(Some(items))
    {
        append("Each item", items);
    }
    if (types.iter().any(|t| t == "object") || truthy(s.get("properties")))
        && let Some(additional @ Json::Object(_)) = s.get("additionalProperties")
    {
        let has_props = s
            .get("properties")
            .and_then(Json::as_object)
            .is_some_and(|m| !m.is_empty());
        let label = if has_props {
            "Each additional value"
        } else {
            "Each value"
        };
        append(label, additional);
    }
    if content.is_empty() {
        return String::new();
    }
    let escaped: Vec<String> = content.iter().map(|l| l.replace("*/", "* /")).collect();
    if escaped.len() == 1 && pad_len + utf16_len(&escaped[0]) + 7 <= 120 {
        return format!("{pad}/** {} */\n", escaped[0]);
    }
    let body: Vec<String> = escaped
        .iter()
        .map(|l| {
            if l.is_empty() {
                format!("{pad} *")
            } else {
                format!("{pad} * {l}")
            }
        })
        .collect();
    format!("{pad}/**\n{}\n{pad} */\n", body.join("\n"))
}

fn render(s: &Json, ctx: &Ctx, depth: usize, seen: &[String]) -> String {
    if depth > MAX_RENDER_DEPTH {
        return "unknown".into();
    }
    let nested_owned;
    let nested = if field(s, "definitions").is_none() && field(s, "$defs").is_none() {
        ctx
    } else {
        let mut defs = ctx.definitions.clone();
        extend_defs(&mut defs, field(s, "definitions"));
        extend_defs(&mut defs, field(s, "$defs"));
        nested_owned = Ctx {
            definitions: defs,
            pretty: ctx.pretty,
        };
        &nested_owned
    };
    if truthy(s.get("$ref")) {
        let name = s
            .get("$ref")
            .and_then(Json::as_str)
            .and_then(definition_name);
        let Some(name) = name else {
            return "unknown".into();
        };
        let Some(def) = lookup(&nested.definitions, &name) else {
            return "unknown".into();
        };
        if seen.contains(&name) {
            return "unknown".into();
        }
        let mut next = seen.to_vec();
        next.push(name);
        let def = def.clone();
        return intersection(vec![
            render(&def, nested, depth, &next),
            render(&without(s, "$ref"), nested, depth + 1, seen),
        ]);
    }
    if let Some(c) = s.get("const") {
        return js_stringify(c);
    }
    if truthy(s.get("enum")) {
        return match s.get("enum") {
            Some(Json::Array(values)) => values
                .iter()
                .map(js_stringify)
                .collect::<Vec<_>>()
                .join(" | "),
            _ => "unknown".into(),
        };
    }
    let listed = field(s, "anyOf").or_else(|| field(s, "oneOf"));
    if let Some(listed) = listed {
        let Json::Array(listed) = listed else {
            return "unknown".into();
        };
        let alternatives: Vec<&Json> = if listed.iter().any(|i| type_is(i, "number")) {
            listed
                .iter()
                .filter(|i| !effect_number_sentinel(i))
                .collect()
        } else {
            listed.iter().collect()
        };
        if alternatives.iter().any(|i| type_is(i, "number"))
            && alternatives
                .iter()
                .all(|i| type_is(i, "number") || effect_number_sentinel(i))
        {
            return "number".into();
        }
        if alternatives.len() == 2
            && type_is(alternatives[0], "object")
            && alternatives[0].get("properties").is_none()
            && type_is(alternatives[1], "array")
            && alternatives[1].get("items").is_none()
        {
            return "{}".into();
        }
        let members: Vec<String> = alternatives
            .iter()
            .map(|i| render(i, nested, depth + 1, seen))
            .collect();
        if members.iter().any(|m| m == "unknown") {
            return "unknown".into();
        }
        let rest = without(&without(s, "anyOf"), "oneOf");
        return intersection(vec![
            members.join(" | "),
            render(&rest, nested, depth + 1, seen),
        ]);
    }
    if let Some(all) = field(s, "allOf") {
        let Json::Array(all) = all else {
            return "unknown".into();
        };
        if all
            .iter()
            .any(|i| has_unresolved_ref(i, &nested.definitions, &[], 0))
        {
            return "unknown".into();
        }
        let mut members = vec![render(&without(s, "allOf"), nested, depth + 1, seen)];
        members.extend(all.iter().map(|i| render(i, nested, depth + 1, seen)));
        return intersection(members);
    }
    if let Some(Json::Array(types)) = s.get("type") {
        return types
            .iter()
            .map(|t| {
                let mut copy = s.clone();
                if let Json::Object(m) = &mut copy {
                    m.insert("type".into(), t.clone());
                }
                render(&copy, nested, depth + 1, seen)
            })
            .collect::<Vec<_>>()
            .join(" | ");
    }
    match s.get("type").and_then(Json::as_str) {
        Some("string") => return "string".into(),
        Some("number") | Some("integer") => return "number".into(),
        Some("boolean") => return "boolean".into(),
        Some("null") => return "null".into(),
        Some("array") => {
            let empty = Json::Object(serde_json::Map::new());
            let items = field(s, "items").unwrap_or(&empty);
            return format!("Array<{}>", render(items, nested, depth + 1, seen));
        }
        _ => {}
    }
    if type_is(s, "object") || truthy(s.get("properties")) {
        let required: Vec<&str> = match field(s, "required") {
            Some(Json::Array(r)) => r.iter().filter_map(Json::as_str).collect(),
            _ => Vec::new(),
        };
        let empty = serde_json::Map::new();
        let properties = s
            .get("properties")
            .and_then(Json::as_object)
            .unwrap_or(&empty);
        let index_type = match s.get("additionalProperties") {
            Some(a @ Json::Object(_)) => Some(render(a, nested, depth + 1, seen)),
            _ => None,
        };
        let field_text = |name: &str, value: &Json| {
            let optional = if required.contains(&name) { "" } else { "?" };
            format!(
                "{}{optional}: {}",
                render_key(name),
                render(value, nested, depth + 1, seen)
            )
        };
        if !ctx.pretty {
            let mut fields: Vec<String> =
                properties.iter().map(|(k, v)| field_text(k, v)).collect();
            if let Some(t) = &index_type {
                fields.push(format!("[key: string]: {t}"));
            }
            return if fields.is_empty() {
                "{}".into()
            } else {
                format!("{{ {} }}", fields.join("; "))
            };
        }
        if properties.is_empty() && index_type.is_none() {
            return "{}".into();
        }
        let pad = "  ".repeat(depth + 1);
        let mut lines: Vec<String> = properties
            .iter()
            .map(|(k, v)| format!("{}{pad}{},", jsdoc(v, &pad), field_text(k, v)))
            .collect();
        if let Some(t) = &index_type {
            lines.push(format!("{pad}[key: string]: {t},"));
        }
        return format!("{{\n{}\n{}}}", lines.join("\n"), "  ".repeat(depth));
    }
    if is_effect_empty_struct(s) {
        return "{}".into();
    }
    "unknown".into()
}

/// The TypeScript type a schema document renders to, as in the reference's `jsonSchemaToTypeScript`.
pub fn to_typescript(doc: &Json, pretty: bool) -> String {
    render(
        doc,
        &Ctx {
            definitions: Vec::new(),
            pretty,
        },
        0,
        &[],
    )
}

/// The input's root object schema and the definitions it may refer to.
fn input_document(doc: &Json) -> Option<(Json, Defs)> {
    let mut defs = Vec::new();
    extend_defs(&mut defs, field(doc, "definitions"));
    extend_defs(&mut defs, field(doc, "$defs"));
    if doc.get("$ref").is_none() {
        return Some((doc.clone(), defs));
    }
    let name = doc
        .get("$ref")
        .and_then(Json::as_str)
        .and_then(definition_name)?;
    let schema = lookup(&defs, &name)?.clone();
    Some((schema, defs))
}

/// Names of the input's top-level properties, which search indexes.
pub fn input_property_names(doc: &Json) -> Vec<String> {
    input_document(doc)
        .and_then(|(s, _)| s.get("properties").and_then(Json::as_object).cloned())
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default()
}

/// For a freeform tool whose input is one required string field: that field's name and the call's parameter list.
pub fn string_parameter(doc: &Json) -> Option<(String, String)> {
    let (schema, defs) = input_document(doc)?;
    let properties = schema.get("properties").and_then(Json::as_object)?;
    if properties.len() != 1 {
        return None;
    }
    let (name, f) = properties.iter().next()?;
    let required = match schema.get("required") {
        Some(Json::Array(r)) => r.iter().any(|v| v.as_str() == Some(name)),
        _ => false,
    };
    if !type_is(f, "string") || !required {
        return None;
    }
    let label = if is_identifier(name) { name } else { "input" };
    let ty = render(
        f,
        &Ctx {
            definitions: defs,
            pretty: false,
        },
        0,
        &[],
    );
    let doc = jsdoc(f, "");
    let doc = doc
        .strip_suffix('\n')
        .map(|d| format!("{d} "))
        .unwrap_or(doc);
    Some((name.clone(), format!("({doc}{label}: {ty})")))
}

/// Whether a tool takes no input, so its signature shows `()`.
pub fn is_empty_input(schema: &Schema) -> bool {
    (schema.is_validating() && is_effect_empty_struct(&schema.doc))
        || to_typescript(&schema.doc, false) == "{}"
}

// ---------- validation ----------

/// A schema compiled for checking values: every keyword read once, so checking does no lookups by name.
#[derive(Debug, Default)]
struct Node {
    never: bool,
    reference: Option<usize>,
    constant: Option<Json>,
    enumeration: Option<Vec<Json>>,
    any_of: Vec<Node>,
    all_of: Vec<Node>,
    /// Type bits, or 0 for any type.
    types: u8,
    expected: String,
    minimum: Option<f64>,
    maximum: Option<f64>,
    exclusive_minimum: Option<f64>,
    exclusive_maximum: Option<f64>,
    multiple_of: Option<f64>,
    min_length: Option<f64>,
    max_length: Option<f64>,
    min_items: Option<f64>,
    max_items: Option<f64>,
    unique_items: bool,
    items: Option<Box<Node>>,
    /// Each property with whether it is required, in schema order.
    properties: Vec<(String, Node, bool)>,
    /// Required keys that are not among the properties.
    required_only: Vec<String>,
    additional: Additional,
}

#[derive(Debug, Default)]
enum Additional {
    #[default]
    Keep,
    Drop,
    Check(Box<Node>),
}

/// A compiled schema: its root and the definitions `$ref`s name, by position.
#[derive(Debug)]
pub(crate) struct Validator {
    root: Node,
    defs: Vec<Node>,
}

impl Validator {
    fn new(doc: &Json) -> Self {
        let mut names: Vec<(String, Json)> = Vec::new();
        gather_defs(doc, &mut names, 0);
        let mut v = Validator {
            root: Node::default(),
            defs: Vec::new(),
        };
        let index = |name: &str| names.iter().rposition(|(n, _)| n == name);
        v.defs = names.iter().map(|(_, d)| compile(d, &index, 0)).collect();
        v.root = compile(doc, &index, 0);
        v
    }
}

/// Every definition reachable in the document; later ones of the same name win, like the renderer's spread.
fn gather_defs(s: &Json, out: &mut Vec<(String, Json)>, depth: usize) {
    if depth > 64 {
        return;
    }
    for key in ["definitions", "$defs"] {
        if let Some(Json::Object(m)) = field(s, key) {
            for (k, v) in m {
                out.push((k.clone(), v.clone()));
                gather_defs(v, out, depth + 1);
            }
        }
    }
    for c in children(s) {
        gather_defs(c, out, depth + 1);
    }
}

fn compile(s: &Json, index: &dyn Fn(&str) -> Option<usize>, depth: usize) -> Node {
    let mut n = Node::default();
    let Json::Object(_) = s else {
        n.never = *s == Json::Bool(false);
        return n;
    };
    if depth > 64 {
        return n;
    }
    let sub = |s: &Json| compile(s, index, depth + 1);
    n.reference = field(s, "$ref")
        .and_then(Json::as_str)
        .and_then(definition_name)
        .and_then(|name| index(&name));
    n.constant = s.get("const").cloned();
    if let Some(Json::Array(values)) = s.get("enum") {
        n.enumeration = Some(values.clone());
    }
    if let Some(Json::Array(alts)) = field(s, "anyOf").or_else(|| field(s, "oneOf")) {
        // Effect's JSON Schema for a number also lists the strings its JSON codec uses for non-finite numbers;
        // decoding a value, Effect accepts numbers only.
        let numeric = alts.iter().any(|a| type_is(a, "number"));
        n.any_of = alts
            .iter()
            .filter(|a| !(numeric && effect_number_sentinel(a)))
            .map(sub)
            .collect();
    }
    if let Some(Json::Array(all)) = field(s, "allOf") {
        n.all_of = all.iter().map(sub).collect();
    }
    n.types = type_bits(&types_of(s));
    n.expected = expected(s);
    n.minimum = number(s, "minimum");
    n.maximum = number(s, "maximum");
    n.exclusive_minimum = number(s, "exclusiveMinimum");
    n.exclusive_maximum = number(s, "exclusiveMaximum");
    n.multiple_of = number(s, "multipleOf").filter(|m| *m != 0.0);
    n.min_length = number(s, "minLength");
    n.max_length = number(s, "maxLength");
    n.min_items = number(s, "minItems");
    n.max_items = number(s, "maxItems");
    n.unique_items = s.get("uniqueItems") == Some(&Json::Bool(true));
    n.items = field(s, "items").map(|i| Box::new(sub(i)));
    let required: Vec<String> = match s.get("required") {
        Some(Json::Array(r)) => r
            .iter()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect(),
        _ => Vec::new(),
    };
    if let Some(Json::Object(props)) = s.get("properties") {
        n.properties = props
            .iter()
            .map(|(k, v)| (k.clone(), sub(v), required.contains(k)))
            .collect();
    }
    n.required_only = required
        .into_iter()
        .filter(|r| !n.properties.iter().any(|(k, _, _)| k == r))
        .collect();
    n.additional = match s.get("additionalProperties") {
        Some(Json::Bool(false)) => Additional::Drop,
        Some(extra @ Json::Object(_)) => Additional::Check(Box::new(sub(extra))),
        _ => Additional::Keep,
    };
    n
}

/// A failure's message and where it happened, innermost segment first: each level adds its own on the way out,
/// so checking a valid value builds no path at all.
type Failure = (String, Vec<PathPart>);

enum PathPart {
    Key(String),
    Index(usize),
}

fn render_path(path: &[PathPart]) -> String {
    if path.is_empty() {
        return String::new();
    }
    let mut out = String::from("\n  at ");
    for p in path.iter().rev() {
        match p {
            PathPart::Key(k) => {
                out.push('[');
                quote(&mut out, k);
                out.push(']');
            }
            PathPart::Index(i) => out.push_str(&format!("[{i}]")),
        }
    }
    out
}

fn at<T>(r: Result<T, Failure>, part: impl FnOnce() -> PathPart) -> Result<T, Failure> {
    r.map_err(|(message, mut path)| {
        path.push(part());
        (message, path)
    })
}

const T_NULL: u8 = 1;
const T_BOOLEAN: u8 = 2;
const T_NUMBER: u8 = 4;
const T_INTEGER: u8 = 8;
const T_STRING: u8 = 16;
const T_ARRAY: u8 = 32;
const T_OBJECT: u8 = 64;

fn type_bits(types: &[String]) -> u8 {
    types
        .iter()
        .map(|t| match t.as_str() {
            "null" => T_NULL,
            "boolean" => T_BOOLEAN,
            "number" => T_NUMBER,
            "integer" => T_INTEGER,
            "string" => T_STRING,
            "array" => T_ARRAY,
            "object" => T_OBJECT,
            _ => 0,
        })
        .fold(0, |a, b| a | b)
}

/// Whether a value is of one of the types; an `integer` type accepts any number here and is checked after.
fn type_matches(bits: u8, v: &Json) -> bool {
    let bit = match v {
        Json::Null => T_NULL,
        Json::Bool(_) => T_BOOLEAN,
        Json::Number(_) => T_NUMBER | T_INTEGER,
        Json::String(_) => T_STRING,
        Json::Array(_) => T_ARRAY,
        Json::Object(_) => T_OBJECT,
    };
    bits & bit != 0
}

/// What a schema accepts, for an `Expected ...` message.
fn expected(s: &Json) -> String {
    if let Some(c) = s.get("const") {
        return js_stringify(c);
    }
    if let Some(Json::Array(values)) = s.get("enum") {
        return values
            .iter()
            .map(js_stringify)
            .collect::<Vec<_>>()
            .join(" | ");
    }
    if let Some(Json::Array(alts)) = field(s, "anyOf").or_else(|| field(s, "oneOf")) {
        let numeric = alts.iter().any(|a| type_is(a, "number"));
        return alts
            .iter()
            .filter(|a| !(numeric && effect_number_sentinel(a)))
            .map(expected)
            .collect::<Vec<_>>()
            .join(" | ");
    }
    let types = types_of(s);
    if types.is_empty() {
        return "unknown".into();
    }
    types
        .iter()
        .map(|t| if t == "integer" { "number" } else { t.as_str() })
        .collect::<Vec<_>>()
        .join(" | ")
}

#[cold]
fn fail<T>(message: impl Into<String>) -> Result<T, Failure> {
    Err((message.into(), Vec::new()))
}

fn check(n: &Node, mut value: Json, v: &Validator, depth: usize) -> Result<Json, Failure> {
    if depth > 64 {
        return fail("Schema nesting is too deep");
    }
    if n.never {
        return fail("Expected never");
    }
    if let Some(r) = n.reference {
        value = check(&v.defs[r], value, v, depth + 1)?;
    }
    if let Some(c) = &n.constant
        && !json_eq(c, &value)
    {
        return fail(format!("Expected {}", js_stringify(c)));
    }
    if let Some(values) = &n.enumeration
        && !values.iter().any(|c| json_eq(c, &value))
    {
        return fail(format!("Expected {}", n.expected));
    }
    if !n.any_of.is_empty() {
        value = check_union(n, value, v, depth)?;
    }
    for part in &n.all_of {
        value = check(part, value, v, depth + 1)?;
    }
    if n.types != 0 {
        if !type_matches(n.types, &value) {
            return fail(format!("Expected {}", n.expected));
        }
        if n.types == T_INTEGER && value.as_f64().is_some_and(|x| x.fract() != 0.0) {
            return fail("Expected an integer");
        }
    }
    match &mut value {
        Json::Number(x) => check_number(n, x.as_f64().unwrap_or(f64::NAN))?,
        Json::String(text) if n.min_length.is_some() || n.max_length.is_some() => {
            check_length(utf16_len(text), n.min_length, n.max_length)?
        }
        Json::Array(items) => {
            check_length(items.len(), n.min_items, n.max_items)?;
            if n.unique_items {
                for i in 0..items.len() {
                    if items[..i].iter().any(|prev| json_eq(prev, &items[i])) {
                        return fail("Expected an array of unique items");
                    }
                }
            }
            if let Some(item_node) = &n.items {
                for (i, item) in items.iter_mut().enumerate() {
                    *item = at(check(item_node, std::mem::take(item), v, depth + 1), || {
                        PathPart::Index(i)
                    })?;
                }
            }
        }
        Json::Object(map) => check_object(n, map, v, depth)?,
        _ => {}
    }
    Ok(value)
}

fn check_union(n: &Node, value: Json, v: &Validator, depth: usize) -> Result<Json, Failure> {
    let mut candidate = None;
    let mut same_type = 0;
    for alt in &n.any_of {
        match check(alt, value.clone(), v, depth + 1) {
            Ok(decoded) => return Ok(decoded),
            Err(e) => {
                if type_matches(alt.types, &value) {
                    same_type += 1;
                    candidate = Some(e);
                }
            }
        }
    }
    // Like Effect, a single member of the value's own type explains the failure; otherwise the union does.
    match candidate {
        Some(e) if same_type == 1 => Err(e),
        _ => fail(format!("Expected {}", n.expected)),
    }
}

fn check_number(n: &Node, x: f64) -> Result<(), Failure> {
    if let Some(m) = n.minimum
        && x < m
    {
        return fail(format!(
            "Expected a value greater than or equal to {}",
            js_num(m)
        ));
    }
    if let Some(m) = n.maximum
        && x > m
    {
        return fail(format!(
            "Expected a value less than or equal to {}",
            js_num(m)
        ));
    }
    if let Some(m) = n.exclusive_minimum
        && x <= m
    {
        return fail(format!("Expected a value greater than {}", js_num(m)));
    }
    if let Some(m) = n.exclusive_maximum
        && x >= m
    {
        return fail(format!("Expected a value less than {}", js_num(m)));
    }
    if let Some(m) = n.multiple_of
        && (x / m).fract() != 0.0
    {
        return fail(format!(
            "Expected a value that is a multiple of {}",
            js_num(m)
        ));
    }
    Ok(())
}

fn check_length(len: usize, min: Option<f64>, max: Option<f64>) -> Result<(), Failure> {
    if let Some(m) = min
        && (len as f64) < m
    {
        return fail(format!(
            "Expected a value with a length of at least {}",
            js_num(m)
        ));
    }
    if let Some(m) = max
        && (len as f64) > m
    {
        return fail(format!(
            "Expected a value with a length of at most {}",
            js_num(m)
        ));
    }
    Ok(())
}

fn check_object(
    n: &Node,
    map: &mut serde_json::Map<String, Json>,
    v: &Validator,
    depth: usize,
) -> Result<(), Failure> {
    for name in &n.required_only {
        if !map.contains_key(name) {
            return at(fail("Missing key"), || PathPart::Key(name.clone()));
        }
    }
    let mut present = 0;
    // Tool inputs are small objects, where a scan beats hashing every key.
    let small = map.len() <= 8;
    for (name, prop, required) in &n.properties {
        let item = if small {
            map.iter_mut().find(|(k, _)| *k == name).map(|(_, v)| v)
        } else {
            map.get_mut(name)
        };
        match item {
            Some(item) => {
                present += 1;
                *item = at(check(prop, std::mem::take(item), v, depth + 1), || {
                    PathPart::Key(name.clone())
                })?;
            }
            None if *required => return at(fail("Missing key"), || PathPart::Key(name.clone())),
            None => {}
        }
    }
    if map.len() == present {
        return Ok(());
    }
    let known = |k: &str| n.properties.iter().any(|(p, _, _)| p == k);
    match &n.additional {
        Additional::Keep => {}
        Additional::Drop => map.retain(|k, _| known(k)),
        Additional::Check(extra) => {
            for (name, item) in map.iter_mut() {
                if known(name) {
                    continue;
                }
                *item = at(check(extra, std::mem::take(item), v, depth + 1), || {
                    PathPart::Key(name.clone())
                })?;
            }
        }
    }
    Ok(())
}

/// JSON equality where numbers compare by value.
fn json_eq(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Number(x), Json::Number(y)) => x.as_f64() == y.as_f64(),
        (Json::Array(x), Json::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(x, y)| json_eq(x, y))
        }
        (Json::Object(x), Json::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| json_eq(v, w)))
        }
        _ => a == b,
    }
}
