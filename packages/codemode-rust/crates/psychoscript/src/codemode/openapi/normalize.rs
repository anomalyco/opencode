//! OpenAPI schemas as JSON Schema 2020-12, the way the reference normalizes them with Effect's
//! `JsonSchema.fromSchemaOpenApi3_0` and `fromSchemaOpenApi3_1`: component references become `#/$defs/...`,
//! `nullable` becomes a `null` type, boolean exclusive bounds become numeric ones, and `example` becomes `examples`.
//! The result's `$defs` move to the end of the document.

use crate::Json;

const META_OPEN_API_3_1: &str = "https://spec.openapis.org/oas/3.1/dialect/base";
const META_DRAFT_2020_12: &str = "https://json-schema.org/draft/2020-12/schema";

/// A schema of the document as a JSON Schema 2020-12 document. A conversion the reference refuses sets `error`, the
/// first time, to the reference's message; the returned schema is then not used.
pub fn normalize(doc: &Json, value: &Json, error: &mut Option<String>) -> Json {
    if !value.is_object() {
        return Json::Object(Default::default());
    }
    let v30 = doc
        .get("openapi")
        .and_then(Json::as_str)
        .is_some_and(|v| !v.is_empty() && v.starts_with("3.0"));
    let converted = if v30 {
        let mut c = Convert::default();
        let out = c.convert(value, &mut Vec::new(), &mut Vec::new());
        if error.is_none() {
            *error = c.error.take();
        }
        c.finish(out)
    } else {
        let root = creates_resource(value.get("$id"));
        walk_31(value, false, true, root)
    };
    let Json::Object(mut schema) = converted else {
        return converted;
    };
    let defs = schema.shift_remove("$defs");
    match defs {
        Some(Json::Object(defs)) if !defs.is_empty() => {
            schema.insert("$defs".into(), Json::Object(defs));
        }
        Some(Json::Array(items)) if !items.is_empty() => {
            let defs = items
                .into_iter()
                .enumerate()
                .map(|(i, v)| (i.to_string(), v))
                .collect();
            schema.insert("$defs".into(), Json::Object(defs));
        }
        _ => {}
    }
    Json::Object(schema)
}

fn creates_resource(id: Option<&Json>) -> bool {
    matches!(id, Some(Json::String(s)) if !s.is_empty() && !s.starts_with('#'))
}

/// `#/components/schemas/X` → `#/$defs/X`; anything else is kept.
fn rewrite_reference(reference: &str) -> String {
    let Some(path) = parse_fragment(reference) else {
        return reference.to_owned();
    };
    if path.len() >= 2 && path[0] == "components" && path[1] == "schemas" {
        let mut out = String::from("#/$defs");
        for token in &path[2..] {
            out.push('/');
            out.push_str(&format_token(token));
        }
        return out;
    }
    reference.to_owned()
}

fn parse_fragment(reference: &str) -> Option<Vec<String>> {
    let encoded = reference.strip_prefix('#')?;
    let pointer = percent_decode(encoded)?;
    if pointer.is_empty() {
        return Some(Vec::new());
    }
    let rest = pointer.strip_prefix('/')?;
    Some(
        rest.split('/')
            .map(|t| t.replace("~1", "/").replace("~0", "~"))
            .collect(),
    )
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            out.push(u8::from_str_radix(s.get(i + 1..i + 3)?, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// A pointer token escaped and URI-encoded the way `encodeURI` leaves it, with `#` encoded.
fn format_token(token: &str) -> String {
    let escaped = token.replace('~', "~0").replace('/', "~1");
    let mut out = String::new();
    for b in escaped.bytes() {
        let keep = b.is_ascii_alphanumeric() || b";,/?:@&=+$-_.!~*'()".contains(&b);
        if keep {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

enum Kind {
    Map,
    Array,
    Schema,
}

fn subschema_kind(key: &str) -> Option<Kind> {
    match key {
        "$defs" | "properties" | "patternProperties" | "dependentSchemas" => Some(Kind::Map),
        "allOf" | "anyOf" | "oneOf" | "prefixItems" => Some(Kind::Array),
        "not"
        | "additionalProperties"
        | "propertyNames"
        | "unevaluatedProperties"
        | "items"
        | "contains"
        | "unevaluatedItems"
        | "if"
        | "then"
        | "else"
        | "contentSchema" => Some(Kind::Schema),
        _ => None,
    }
}

fn walk_31(node: &Json, inherited: bool, is_root: bool, root_resource: bool) -> Json {
    let Json::Object(map) = node else {
        return node.clone();
    };
    let embedded = inherited || (!is_root && creates_resource(map.get("$id")));
    let mut out = serde_json::Map::new();
    for (key, value) in map {
        let transformed = match subschema_kind(key) {
            Some(Kind::Map) => match value {
                Json::Object(m) => Json::Object(
                    m.iter()
                        .map(|(k, v)| (k.clone(), walk_31(v, embedded, false, root_resource)))
                        .collect(),
                ),
                _ => value.clone(),
            },
            Some(Kind::Array) => match value {
                Json::Array(items) => Json::Array(
                    items
                        .iter()
                        .map(|v| walk_31(v, embedded, false, root_resource))
                        .collect(),
                ),
                _ => value.clone(),
            },
            Some(Kind::Schema) => walk_31(value, embedded, false, root_resource),
            None => value.clone(),
        };
        out.insert(key.clone(), transformed);
    }
    if !root_resource && !embedded {
        for key in ["$ref", "$dynamicRef"] {
            if let Some(Json::String(r)) = out.get(key) {
                let rewritten = rewrite_reference(r);
                out.insert(key.into(), Json::String(rewritten));
            }
        }
    }
    if let Some(Json::String(s)) = out.get("$schema")
        && (s == META_OPEN_API_3_1 || *s == format!("{META_OPEN_API_3_1}#"))
    {
        out.insert("$schema".into(), Json::String(META_DRAFT_2020_12.into()));
    }
    if let Some(example) = out.get("example").cloned() {
        match out.get("examples") {
            None => {
                out.insert("examples".into(), Json::Array(vec![example]));
                out.shift_remove("example");
            }
            Some(Json::Array(examples)) => {
                let mut all = vec![example];
                all.extend(examples.iter().cloned());
                out.insert("examples".into(), Json::Array(all));
                out.shift_remove("example");
            }
            Some(_) => {}
        }
    }
    Json::Object(out)
}

/// Keywords the reference refuses in an OpenAPI 3.0 schema: inactive there, they would become active in 2020-12.
const OPEN_API_30_COLLISIONS: [&str; 26] = [
    "$anchor",
    "$defs",
    "$dynamicAnchor",
    "$dynamicRef",
    "$vocabulary",
    "contentSchema",
    "dependentRequired",
    "dependentSchemas",
    "maxContains",
    "minContains",
    "prefixItems",
    "unevaluatedItems",
    "unevaluatedProperties",
    "$comment",
    "$id",
    "$schema",
    "const",
    "contains",
    "contentEncoding",
    "contentMediaType",
    "else",
    "examples",
    "if",
    "patternProperties",
    "propertyNames",
    "then",
];

const ROOT_URI: &str = "https://effect.invalid/.json-schema/";

/// The OpenAPI 3.0 converter, as Effect's: it records where every source schema lands in the result, so a
/// reference into a schema that moved (a nullable `allOf` becomes `anyOf`) follows it.
#[derive(Default)]
struct Convert {
    locations: Vec<(Vec<String>, Vec<String>)>,
    references: Vec<(Vec<String>, String)>,
    error: Option<String>,
}

impl Convert {
    fn convert(&mut self, node: &Json, src: &mut Vec<String>, tgt: &mut Vec<String>) -> Json {
        if node.is_boolean() {
            self.locations.push((src.clone(), tgt.clone()));
            return node.clone();
        }
        let Json::Object(source) = node else {
            return node.clone();
        };
        self.locations.push((src.clone(), tgt.clone()));
        let mut out = serde_json::Map::new();
        if let Some(Json::String(r)) = source.get("$ref") {
            self.references.push((tgt.clone(), rewrite_reference(r)));
            out.insert("$ref".into(), Json::Null);
            return Json::Object(out);
        }
        if self.error.is_none()
            && let Some(k) = OPEN_API_30_COLLISIONS
                .iter()
                .find(|k| source.contains_key(**k))
        {
            self.error = Some(format!(
                "Cannot convert JSON Schema keyword \"{k}\" to Draft 2020-12: it is not active in OpenAPI 3.0 but would become active in the target"
            ));
        }
        let nullable = source.get("nullable") == Some(&Json::Bool(true));
        let nullable_all_of = nullable
            && !matches!(source.get("type"), Some(Json::String(_)))
            && !source.contains_key("anyOf")
            && matches!(source.get("allOf"), Some(Json::Array(a)) if a.len() == 1);
        let mut at = |c: &mut Self, value: &Json, from: &[&str], to: &[&str]| {
            let (ls, lt) = (src.len(), tgt.len());
            src.extend(from.iter().map(|s| s.to_string()));
            tgt.extend(to.iter().map(|s| s.to_string()));
            let v = c.convert(value, src, tgt);
            src.truncate(ls);
            tgt.truncate(lt);
            v
        };
        for (key, value) in source {
            if nullable_all_of && key == "allOf" {
                let first = value
                    .as_array()
                    .and_then(|a| a.first())
                    .cloned()
                    .unwrap_or(Json::Null);
                let first = at(self, &first, &["allOf", "0"], &["anyOf", "0"]);
                out.insert(
                    "anyOf".into(),
                    Json::Array(vec![first, serde_json::json!({ "type": "null" })]),
                );
                continue;
            }
            let converted = match (key.as_str(), value) {
                ("properties", Json::Object(m)) => Json::Object(
                    m.iter()
                        .map(|(k, v)| (k.clone(), at(self, v, &[key, k], &[key, k])))
                        .collect(),
                ),
                ("allOf" | "anyOf" | "oneOf", Json::Array(items)) => Json::Array(
                    items
                        .iter()
                        .enumerate()
                        .map(|(i, v)| {
                            let i = i.to_string();
                            at(self, v, &[key, &i], &[key, &i])
                        })
                        .collect(),
                ),
                ("properties" | "allOf" | "anyOf" | "oneOf", other) => other.clone(),
                ("not" | "items" | "additionalProperties", v) => at(self, v, &[key], &[key]),
                ("example", v) => {
                    out.insert("examples".into(), Json::Array(vec![v.clone()]));
                    continue;
                }
                ("nullable" | "exclusiveMinimum" | "exclusiveMaximum", _) => continue,
                (_, v) => v.clone(),
            };
            out.insert(key.clone(), converted);
        }
        for (bound, exclusive_key) in [
            ("minimum", "exclusiveMinimum"),
            ("maximum", "exclusiveMaximum"),
        ] {
            match source.get(exclusive_key) {
                Some(Json::Bool(true)) if source.get(bound).is_some_and(Json::is_number) => {
                    let b = source[bound].clone();
                    out.insert(exclusive_key.into(), b);
                    out.shift_remove(bound);
                }
                Some(Json::Bool(_)) | None => {}
                Some(other) => {
                    out.insert(exclusive_key.into(), other.clone());
                }
            }
        }
        if nullable && let Some(Json::String(t)) = source.get("type") {
            out.insert("type".into(), serde_json::json!([t, "null"]));
        }
        Json::Object(out)
    }

    /// Writes every reference into the result, relocated when it points into a schema that moved.
    fn finish(&mut self, mut out: Json) -> Json {
        for (path, reference) in std::mem::take(&mut self.references) {
            let relocated = same_resource_pointer(&reference)
                .and_then(|pointer| {
                    self.locations
                        .iter()
                        .find(|(s, _)| *s == pointer)
                        .map(|(_, t)| t.clone())
                })
                .map(|target| relocate(&reference, &target))
                .unwrap_or(reference);
            if let Some(Json::Object(node)) = navigate(&mut out, &path) {
                node.insert("$ref".into(), Json::String(relocated));
            }
        }
        out
    }
}

fn navigate<'a>(root: &'a mut Json, path: &[String]) -> Option<&'a mut Json> {
    let mut node = root;
    for token in path {
        node = match node {
            Json::Object(m) => m.get_mut(token)?,
            Json::Array(items) => items.get_mut(token.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(node)
}

/// The JSON Pointer a reference names in the schema being converted, when it names a place in it at all.
fn same_resource_pointer(reference: &str) -> Option<Vec<String>> {
    let fragment = if reference.is_empty() {
        ""
    } else if let Some(rest) = reference.strip_prefix(ROOT_URI) {
        rest.find('#').map_or("", |i| &rest[i..])
    } else if reference.starts_with('#') {
        reference
    } else {
        return None;
    };
    // The URL parser percent-encodes what a fragment cannot hold as is.
    let mut hash = String::new();
    for c in fragment.trim_start_matches('#').chars() {
        if c.is_ascii() && !matches!(c, ' ' | '"' | '<' | '>' | '`') && !c.is_ascii_control() {
            hash.push(c);
        } else {
            let mut buf = [0u8; 4];
            for b in c.encode_utf8(&mut buf).bytes() {
                hash.push_str(&format!("%{b:02X}"));
            }
        }
    }
    if hash.is_empty() {
        return Some(Vec::new());
    }
    // `decodeUriFragment`: only what `encodeURI` would leave alone, or percent escapes.
    let bytes = hash.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'%' {
            if !hash
                .get(i + 1..i + 3)
                .is_some_and(|h| u8::from_str_radix(h, 16).is_ok())
            {
                return None;
            }
            i += 3;
            continue;
        }
        if !(b.is_ascii_alphanumeric() || b";,/?:@&=+$-_.!~*'()".contains(&b)) {
            return None;
        }
        i += 1;
    }
    let pointer = percent_decode(&hash)?;
    let rest = pointer.strip_prefix('/')?;
    let tokens: Vec<&str> = rest.split('/').collect();
    let mut out = Vec::new();
    for t in tokens {
        let mut chars = t.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '~' && !matches!(chars.peek(), Some('0' | '1')) {
                return None;
            }
        }
        out.push(t.replace("~1", "/").replace("~0", "~"));
    }
    Some(out)
}

fn relocate(reference: &str, target: &[String]) -> String {
    let index = reference.find('#');
    if index.is_none() && target.is_empty() {
        return reference.to_owned();
    }
    let uri = index.map_or(reference, |i| &reference[..i]);
    let mut out = format!("{uri}#");
    for token in target {
        out.push('/');
        out.push_str(&format_token(token));
    }
    out
}
