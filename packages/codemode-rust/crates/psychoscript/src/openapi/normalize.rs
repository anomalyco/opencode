//! OpenAPI schemas as JSON Schema 2020-12, the way the reference normalizes them with Effect's
//! `JsonSchema.fromSchemaOpenApi3_0` and `fromSchemaOpenApi3_1`: component references become `#/$defs/...`,
//! `nullable` becomes a `null` type, boolean exclusive bounds become numeric ones, and `example` becomes `examples`.
//! The result's `$defs` move to the end of the document.

use crate::Json;

const META_OPEN_API_3_1: &str = "https://spec.openapis.org/oas/3.1/dialect/base";
const META_DRAFT_2020_12: &str = "https://json-schema.org/draft/2020-12/schema";

/// A schema of the document as a JSON Schema 2020-12 document.
pub fn normalize(doc: &Json, value: &Json) -> Json {
    if !value.is_object() {
        return Json::Object(Default::default());
    }
    let v30 = doc
        .get("openapi")
        .and_then(Json::as_str)
        .is_some_and(|v| !v.is_empty() && v.starts_with("3.0"));
    let converted = if v30 {
        convert_30(value)
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

fn convert_30(node: &Json) -> Json {
    let Json::Object(source) = node else {
        return node.clone();
    };
    let mut out = serde_json::Map::new();
    if let Some(Json::String(r)) = source.get("$ref") {
        out.insert("$ref".into(), Json::String(rewrite_reference(r)));
        return Json::Object(out);
    }
    let nullable = source.get("nullable") == Some(&Json::Bool(true));
    let nullable_all_of = nullable
        && !matches!(source.get("type"), Some(Json::String(_)))
        && !source.contains_key("anyOf")
        && matches!(source.get("allOf"), Some(Json::Array(a)) if a.len() == 1);
    for (key, value) in source {
        if nullable_all_of && key == "allOf" {
            let first = value
                .as_array()
                .and_then(|a| a.first())
                .map(convert_30)
                .unwrap_or(Json::Null);
            out.insert(
                "anyOf".into(),
                Json::Array(vec![first, serde_json::json!({ "type": "null" })]),
            );
            continue;
        }
        let converted = match (key.as_str(), value) {
            ("properties", Json::Object(m)) => {
                Json::Object(m.iter().map(|(k, v)| (k.clone(), convert_30(v))).collect())
            }
            ("properties", other) => other.clone(),
            ("allOf" | "anyOf" | "oneOf", Json::Array(items)) => {
                Json::Array(items.iter().map(convert_30).collect())
            }
            ("allOf" | "anyOf" | "oneOf", other) => other.clone(),
            ("not" | "items" | "additionalProperties", v) => convert_30(v),
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
