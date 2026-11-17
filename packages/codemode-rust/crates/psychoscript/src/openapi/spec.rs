//! Reading an OpenAPI document into tool plans, as the reference's `spec.ts` does: parameters and bodies become
//! input fields, successful responses the output schema, and `operationId`s the tool paths.

use std::collections::{HashMap, HashSet};

use super::project::{Direction, Projector};
use super::{ApiKeyLocation, SecurityScheme};
use crate::Json;

pub type Parsed<T> = Result<T, String>;

pub fn own<'a>(map: &'a serde_json::Map<String, Json>, key: &str) -> Option<&'a Json> {
    map.get(key)
}

pub fn non_empty(v: Option<&Json>) -> Option<&str> {
    match v {
        Some(Json::String(s)) if !s.is_empty() => Some(s),
        _ => None,
    }
}

fn as_array(v: Option<&Json>) -> &[Json] {
    match v {
        Some(Json::Array(items)) => items,
        _ => &[],
    }
}

pub fn resolve_pointer<'a>(root: &'a Json, reference: &str) -> Option<&'a Json> {
    let mut item = root;
    for segment in reference.get(2..)?.split('/') {
        let segment = segment.replace("~1", "/").replace("~0", "~");
        item = item.as_object()?.get(&segment)?;
    }
    Some(item)
}

/// Follows `#/` references to what they name; an unresolvable or cyclic one stays as it is.
pub fn resolve<'a>(doc: &'a Json, value: Option<&'a Json>) -> Option<&'a Json> {
    let mut current = value?;
    let mut seen: Vec<&str> = Vec::new();
    loop {
        let Some(map) = current.as_object() else {
            return Some(current);
        };
        let Some(reference) = non_empty(map.get("$ref")) else {
            return Some(current);
        };
        if !reference.starts_with("#/") || seen.contains(&reference) {
            return Some(current);
        }
        let Some(target) = resolve_pointer(doc, reference) else {
            return Some(current);
        };
        seen.push(reference);
        current = target;
    }
}

pub type Definitions = serde_json::Map<String, Json>;

pub fn component_definitions(p: &mut Projector<'_>, d: Direction) -> Definitions {
    let doc = p.doc;
    let Some(Json::Object(schemas)) = doc.get("components").and_then(|c| c.get("schemas")) else {
        return Definitions::new();
    };
    schemas
        .iter()
        .map(|(name, value)| (name.clone(), p.project_schema(Some(value), d)))
        .collect()
}

fn with_definitions(schema: Json, definitions: &Definitions) -> Json {
    if definitions.is_empty() {
        return schema;
    }
    let Json::Object(mut map) = schema else {
        return schema;
    };
    let mut merged = definitions.clone();
    if let Some(Json::Object(local)) = map.get("$defs") {
        for (k, v) in local {
            merged.insert(k.clone(), v.clone());
        }
    }
    map.insert("$defs".into(), Json::Object(merged));
    Json::Object(map)
}

fn media_type(m: &str) -> String {
    m.split(';').next().unwrap_or("").trim().to_lowercase()
}

pub fn is_json_media_type(m: &str) -> bool {
    let n = media_type(m);
    n == "application/json" || n.ends_with("+json")
}

fn is_binary_media_type(doc: &Json, m: &str, value: &Json) -> bool {
    let n = media_type(m);
    if !is_json_media_type(&n) && !n.starts_with("text/") {
        return true;
    }
    if !value.is_object() {
        return false;
    }
    resolve(doc, value.get("schema"))
        .and_then(Json::as_object)
        .is_some_and(|s| s.get("format").and_then(Json::as_str) == Some("binary"))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Location {
    Path,
    Query,
    Header,
    Body,
}

impl Location {
    pub fn name(self) -> &'static str {
        match self {
            Location::Path => "path",
            Location::Query => "query",
            Location::Header => "header",
            Location::Body => "body",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Style {
    Simple,
    Form,
    DeepObject,
}

#[derive(Clone, Debug)]
pub struct InputField {
    pub input_name: String,
    pub name: String,
    pub location: Location,
    pub required: bool,
    pub schema: Json,
    pub style: Option<Style>,
    pub explode: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BodyMode {
    Object,
    Value,
}

#[derive(Clone, Debug)]
pub struct Body {
    pub required: bool,
    pub mode: BodyMode,
    pub media_type: String,
}

pub struct OperationInput {
    pub fields: Vec<InputField>,
    pub body: Option<Body>,
}

fn operation_parameters<'a>(
    p: &mut Projector<'a>,
    path_item: &'a Json,
    operation: &'a Json,
) -> Parsed<Vec<InputField>> {
    let doc = p.doc;
    // Operation parameters override path parameters of the same location and name, in the first one's place.
    let mut declared: Vec<(String, String, &'a serde_json::Map<String, Json>)> = Vec::new();
    for raw in as_array(path_item.get("parameters"))
        .iter()
        .chain(as_array(operation.get("parameters")))
    {
        let Some(resolved) = resolve(doc, Some(raw)).and_then(Json::as_object) else {
            return Err("parameter declaration is invalid or unresolved".into());
        };
        let (Some(name), Some(location)) = (
            non_empty(resolved.get("name")),
            non_empty(resolved.get("in")),
        ) else {
            return Err("parameter declaration is missing name or location".into());
        };
        match declared
            .iter_mut()
            .find(|(n, l, _)| n == name && l == location)
        {
            Some(entry) => entry.2 = resolved,
            None => declared.push((name.to_owned(), location.to_owned(), resolved)),
        }
    }
    let mut unordered = Vec::new();
    for (name, location, resolved) in declared {
        if location == "cookie" {
            return Err(format!("cookie parameter '{name}' is not supported"));
        }
        let loc = match location.as_str() {
            "path" => Location::Path,
            "query" => Location::Query,
            "header" => Location::Header,
            _ => {
                return Err(format!(
                    "parameter '{name}' uses unsupported location '{location}'"
                ));
            }
        };
        if loc == Location::Header
            && ["accept", "content-type", "authorization"].contains(&name.to_lowercase().as_str())
        {
            continue;
        }
        if !resolved.contains_key("schema") && !resolved.contains_key("content") {
            return Err(format!(
                "parameter '{name}' declares neither schema nor content"
            ));
        }
        if resolved.contains_key("content") {
            return Err(format!(
                "parameter '{name}' uses unsupported content encoding"
            ));
        }
        if resolved.contains_key("style") && non_empty(resolved.get("style")).is_none() {
            return Err(format!("parameter '{name}' has an invalid style"));
        }
        if resolved.get("explode").is_some_and(|e| !e.is_boolean()) {
            return Err(format!("parameter '{name}' has an invalid explode value"));
        }
        if resolved
            .get("allowReserved")
            .is_some_and(|e| !e.is_boolean())
        {
            return Err(format!(
                "parameter '{name}' has an invalid allowReserved value"
            ));
        }
        if resolved.get("allowReserved") == Some(&Json::Bool(true)) {
            return Err(format!(
                "parameter '{name}' uses unsupported allowReserved encoding"
            ));
        }
        let declared_style = non_empty(resolved.get("style"))
            .unwrap_or(if loc == Location::Query {
                "form"
            } else {
                "simple"
            })
            .to_owned();
        if loc == Location::Query && declared_style != "form" && declared_style != "deepObject" {
            return Err(format!(
                "query parameter '{name}' uses unsupported style '{declared_style}'"
            ));
        }
        if loc != Location::Query && declared_style != "simple" {
            return Err(format!(
                "{} parameter '{name}' uses unsupported style '{declared_style}'",
                loc.name()
            ));
        }
        let style = match declared_style.as_str() {
            "deepObject" => Style::DeepObject,
            "form" => Style::Form,
            _ => Style::Simple,
        };
        let explode = match resolved.get("explode") {
            Some(Json::Bool(b)) => *b,
            _ => style == Style::Form,
        };
        if style == Style::DeepObject && !explode {
            return Err(format!(
                "query parameter '{name}' uses deepObject with explode=false"
            ));
        }
        let mut schema = p.project_schema(resolved.get("schema"), Direction::Request);
        if let (Json::Object(m), Some(description)) =
            (&mut schema, non_empty(resolved.get("description")))
            && !m.contains_key("description")
        {
            m.insert("description".into(), Json::String(description.to_owned()));
        }
        unordered.push(InputField {
            input_name: String::new(),
            required: resolved.get("required") == Some(&Json::Bool(true)) || loc == Location::Path,
            name,
            location: loc,
            schema,
            style: Some(style),
            explode,
        });
    }
    Ok([Location::Path, Location::Query, Location::Header]
        .iter()
        .flat_map(|l| unordered.iter().filter(move |f| f.location == *l).cloned())
        .collect())
}

fn is_flattenable(schema: &Json, required: bool) -> bool {
    let Some(m) = schema.as_object() else {
        return false;
    };
    required
        && m.get("type").and_then(Json::as_str) == Some("object")
        && m.get("properties").is_some_and(Json::is_object)
        && m.get("additionalProperties") == Some(&Json::Bool(false))
        && m.get("nullable") != Some(&Json::Bool(true))
        && !m.contains_key("allOf")
        && !m.contains_key("anyOf")
        && !m.contains_key("oneOf")
}

fn operation_body<'a>(
    p: &mut Projector<'a>,
    operation: &'a Json,
) -> Parsed<(Vec<InputField>, Option<Body>)> {
    let doc = p.doc;
    let Some(resolved) = resolve(doc, operation.get("requestBody")).and_then(Json::as_object)
    else {
        return Ok((Vec::new(), None));
    };
    let Some(content) = resolved.get("content").and_then(Json::as_object) else {
        return Err("request body has no JSON content (declared: none)".into());
    };
    let selected = content
        .iter()
        .find(|(m, _)| is_json_media_type(m))
        .filter(|(_, v)| v.is_object());
    let Some((media, entry)) = selected else {
        let declared: Vec<&str> = content.keys().map(String::as_str).collect();
        let declared = if declared.is_empty() {
            "none".to_owned()
        } else {
            declared.join(", ")
        };
        return Err(format!(
            "request body has no JSON content (declared: {declared})"
        ));
    };
    let selected_schema = entry.get("schema");
    let resolved_schema = resolve(doc, selected_schema);
    let schema = match resolved_schema {
        Some(s) if p.directional() => p.directional_schema(
            super::project::Resource { value: s, root: s },
            Direction::Request,
            &HashSet::new(),
        ),
        Some(s) => s.clone(),
        None => Json::Null,
    };
    let required = resolved.get("required") == Some(&Json::Bool(true));
    if !is_flattenable(&schema, required) {
        let field = InputField {
            input_name: String::new(),
            name: "body".into(),
            location: Location::Body,
            required,
            schema: p.project_schema(selected_schema, Direction::Request),
            style: None,
            explode: false,
        };
        return Ok((
            vec![field],
            Some(Body {
                required,
                mode: BodyMode::Value,
                media_type: media.clone(),
            }),
        ));
    }
    let required_properties: Vec<&str> = as_array(schema.get("required"))
        .iter()
        .filter_map(Json::as_str)
        .collect();
    let fields = schema["properties"]
        .as_object()
        .map(|props| {
            props
                .iter()
                .map(|(name, value)| InputField {
                    input_name: String::new(),
                    name: name.clone(),
                    location: Location::Body,
                    required: required && required_properties.contains(&name.as_str()),
                    // Already projected with the body as resolution root; projecting again rooted at the field
                    // would misresolve shadowed local $defs.
                    schema: super::normalize::normalize(doc, value, &mut p.error),
                    style: None,
                    explode: false,
                })
                .collect()
        })
        .unwrap_or_default();
    Ok((
        fields,
        Some(Body {
            required,
            mode: BodyMode::Object,
            media_type: media.clone(),
        }),
    ))
}

pub fn operation_input<'a>(
    p: &mut Projector<'a>,
    path_item: &'a Json,
    operation: &'a Json,
) -> Parsed<OperationInput> {
    let mut fields = operation_parameters(p, path_item, operation)?;
    let (body_fields, body) = operation_body(p, operation)?;
    fields.extend(body_fields);
    let mut counts: HashMap<String, usize> = HashMap::new();
    for f in &fields {
        *counts.entry(f.name.clone()).or_default() += 1;
    }
    let mut used: HashSet<String> = HashSet::new();
    for f in &mut fields {
        let base = if counts[&f.name] > 1 {
            format!("{}_{}", f.location.name(), f.name)
        } else {
            f.name.clone()
        };
        let mut index = 1;
        let name = loop {
            let candidate = if index == 1 {
                base.clone()
            } else {
                format!("{base}_{index}")
            };
            if !used.contains(&candidate) {
                break candidate;
            }
            index += 1;
        };
        used.insert(name.clone());
        f.input_name = name;
    }
    Ok(OperationInput { fields, body })
}

pub fn input_schema(fields: &[InputField], definitions: &Definitions) -> Json {
    let mut map = serde_json::Map::new();
    map.insert("type".into(), Json::String("object".into()));
    map.insert(
        "properties".into(),
        Json::Object(
            fields
                .iter()
                .map(|f| (f.input_name.clone(), f.schema.clone()))
                .collect(),
        ),
    );
    let required: Vec<Json> = fields
        .iter()
        .filter(|f| f.required)
        .map(|f| Json::String(f.input_name.clone()))
        .collect();
    if !required.is_empty() {
        map.insert("required".into(), Json::Array(required));
    }
    with_definitions(Json::Object(map), definitions)
}

fn successful_responses<'a>(
    doc: &'a Json,
    operation: &'a Json,
) -> Parsed<Vec<&'a serde_json::Map<String, Json>>> {
    let Some(responses) = operation.get("responses").and_then(Json::as_object) else {
        return Ok(Vec::new());
    };
    let mut digits: Vec<(&String, &Json)> = responses
        .iter()
        .filter(|(s, _)| {
            s.len() == 3 && s.starts_with('2') && s[1..].bytes().all(|b| b.is_ascii_digit())
        })
        .collect();
    digits.sort_by(|a, b| a.0.cmp(b.0));
    let selected = digits
        .into_iter()
        .chain(responses.iter().filter(|(s, _)| s.to_uppercase() == "2XX"));
    let mut out = Vec::new();
    for (_, value) in selected {
        match resolve(doc, Some(value)).and_then(Json::as_object) {
            Some(r) if non_empty(r.get("$ref")).is_none() => out.push(r),
            _ => return Err("successful response declaration is invalid or unresolved".into()),
        }
    }
    Ok(out)
}

pub fn operation_output<'a>(
    p: &mut Projector<'a>,
    operation: &'a Json,
    definitions: &Definitions,
) -> Parsed<Option<Json>> {
    let doc = p.doc;
    if operation.get("x-websocket") == Some(&Json::Bool(true)) {
        return Err("WebSocket operations are not supported".into());
    }
    let responses = successful_responses(doc, operation)?;
    let contents = || {
        responses
            .iter()
            .filter_map(|r| r.get("content").and_then(Json::as_object))
    };
    if contents().any(|c| c.keys().any(|m| media_type(m) == "text/event-stream")) {
        return Err("SSE operations are not supported".into());
    }
    if contents().any(|c| c.iter().any(|(m, v)| is_binary_media_type(doc, m, v))) {
        return Err("binary responses are not supported".into());
    }
    let mut outcomes = Vec::new();
    for response in &responses {
        let content = match response.get("content") {
            None => None,
            Some(Json::Object(c)) => Some(c),
            Some(_) => return Ok(None),
        };
        let Some(content) = content.filter(|c| !c.is_empty()) else {
            outcomes.push(serde_json::json!({ "type": "null" }));
            continue;
        };
        for (m, value) in content {
            if !is_json_media_type(m) {
                outcomes.push(serde_json::json!({ "type": "string" }));
                continue;
            }
            let Some(schema) = value.as_object().and_then(|v| v.get("schema")) else {
                return Ok(None);
            };
            outcomes.push(p.project_schema(Some(schema), Direction::Response));
        }
    }
    if outcomes.is_empty() {
        return Ok(None);
    }
    let schema = if outcomes.len() == 1 {
        outcomes.pop().unwrap_or_default()
    } else {
        serde_json::json!({ "anyOf": outcomes })
    };
    Ok(Some(with_definitions(schema, definitions)))
}

fn sanitize_segment(raw: &str) -> String {
    let mut out = String::new();
    let mut in_run = false;
    for c in raw.chars() {
        if c.is_ascii_alphanumeric() || c == '_' || c == '$' {
            out.push(c);
            in_run = false;
        } else if !in_run {
            out.push('_');
            in_run = true;
        }
    }
    let trimmed = out.trim_matches('_');
    let mut s = trimmed.to_owned();
    if s.starts_with(|c: char| c.is_ascii_digit()) {
        s.insert(0, '_');
    }
    if s.is_empty() { "operation".into() } else { s }
}

fn fallback_operation_id(method: &str, path: &str) -> String {
    let mut words: Vec<String> = vec![method.to_owned()];
    for part in path.split('/').filter(|p| !p.is_empty()) {
        let parts: Vec<&str> = if part.starts_with('{') && part.ends_with('}') && part.len() >= 2 {
            vec!["by", &part[1..part.len() - 1]]
        } else {
            vec![part]
        };
        for p in parts {
            words.extend(
                p.split(|c: char| !c.is_ascii_alphanumeric())
                    .filter(|w| !w.is_empty())
                    .map(str::to_owned),
            );
        }
    }
    words
        .iter()
        .enumerate()
        .map(|(i, w)| {
            let lower = w.to_lowercase();
            if i == 0 {
                return lower;
            }
            let mut chars = lower.chars();
            match chars.next() {
                Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect()
}

fn is_path_available(
    segments: &[String],
    used: &HashSet<String>,
    namespaces: &HashSet<String>,
) -> bool {
    let key = segments.join(".");
    if used.contains(&key) || namespaces.contains(&key) {
        return false;
    }
    (0..segments.len().saturating_sub(1)).all(|i| !used.contains(&segments[..=i].join(".")))
}

pub fn operation_path(
    method: &str,
    path: &str,
    operation: &Json,
    used: &HashSet<String>,
    namespaces: &HashSet<String>,
) -> Vec<String> {
    let segments: Vec<String> = match non_empty(operation.get("operationId")) {
        Some(raw) => raw.split('.').map(sanitize_segment).collect(),
        None => vec![sanitize_segment(&fallback_operation_id(method, path))],
    };
    if is_path_available(&segments, used, namespaces) {
        return segments;
    }
    let conflict =
        (0..segments.len().saturating_sub(1)).find(|&i| used.contains(&segments[..=i].join(".")));
    if let Some(conflict) = conflict
        && conflict + 1 < segments.len()
    {
        let mut collapsed = Vec::new();
        for (i, segment) in segments.iter().enumerate() {
            if i == conflict {
                let next = &segments[i + 1];
                let mut chars = next.chars();
                let capital = chars
                    .next()
                    .map(|c| c.to_uppercase().collect::<String>() + chars.as_str())
                    .unwrap_or_default();
                collapsed.push(format!("{segment}{capital}"));
            } else if i != conflict + 1 {
                collapsed.push(segment.clone());
            }
        }
        if is_path_available(&collapsed, used, namespaces) {
            return collapsed;
        }
    }
    let fallback = segments.join("_");
    let mut index = 2;
    loop {
        let candidate = format!("{fallback}_{index}");
        if is_path_available(std::slice::from_ref(&candidate), used, namespaces) {
            return vec![candidate];
        }
        index += 1;
    }
}

pub fn spec_server_url(source: &Json) -> Parsed<String> {
    let server = as_array(source.get("servers"))
        .iter()
        .find(|s| s.is_object());
    let Some(url) = server.and_then(|s| non_empty(s.get("url"))) else {
        return Err("spec declares no servers; pass baseUrl".into());
    };
    if has_template(url) {
        return Err(format!(
            "server URL '{url}' is not an absolute URL; pass baseUrl"
        ));
    }
    validate_base_url(url)
}

/// `/\{[^{}]+\}/`
pub fn has_template(s: &str) -> bool {
    s.match_indices('{').any(|(i, _)| {
        let rest = &s[i + 1..];
        let end = rest.find(['{', '}']);
        matches!(end, Some(j) if j > 0 && rest.as_bytes()[j] == b'}')
    })
}

pub fn validate_base_url(value: &str) -> Parsed<String> {
    let lower = value.to_ascii_lowercase();
    let invalid = || {
        Err(format!(
            "server URL '{value}' is not an absolute HTTP(S) URL"
        ))
    };
    let Some(rest) = lower
        .strip_prefix("http://")
        .or_else(|| lower.strip_prefix("https://"))
    else {
        return invalid();
    };
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let host = &rest[..host_end];
    if host.is_empty() || host.contains(char::is_whitespace) || value.contains(char::is_whitespace)
    {
        return invalid();
    }
    let before_hash = value.split('#').next().unwrap_or(value);
    let query = before_hash.split_once('?').map(|(_, q)| q).unwrap_or("");
    let hash = value.split_once('#').map(|(_, h)| h).unwrap_or("");
    if !query.is_empty() || !hash.is_empty() {
        return Err(format!(
            "server URL '{value}' contains an unsupported query string or fragment"
        ));
    }
    Ok(value.to_owned())
}

pub type SecurityRequirement = Vec<(String, Vec<String>)>;

pub fn security_requirements(value: Option<&Json>) -> Parsed<Vec<SecurityRequirement>> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let Json::Array(items) = value else {
        return Err("security declaration is not an array".into());
    };
    let mut out = Vec::new();
    for item in items {
        let Some(map) = item.as_object() else {
            return Err("security requirement is not an object".into());
        };
        let mut requirement = Vec::new();
        for (name, scopes) in map {
            let Json::Array(scopes) = scopes else {
                return Err("security requirement scopes are not string arrays".into());
            };
            let parsed: Vec<String> = scopes
                .iter()
                .filter_map(|s| s.as_str().map(str::to_owned))
                .collect();
            if parsed.len() != scopes.len() {
                return Err("security requirement scopes are not string arrays".into());
            }
            requirement.push((name.clone(), parsed));
        }
        out.push(requirement);
    }
    Ok(out)
}

pub fn operation_security_requirements(
    value: Option<&Json>,
    defaults: &Parsed<Vec<SecurityRequirement>>,
    schemes: &[(String, SecurityScheme)],
) -> Parsed<Vec<SecurityRequirement>> {
    let parsed = match value {
        None => defaults.clone()?,
        Some(v) => security_requirements(Some(v))?,
    };
    let scheme = |name: &str| schemes.iter().find(|(n, _)| n == name).map(|(_, s)| s);
    let is_cookie = |s: &SecurityScheme| {
        matches!(
            s,
            SecurityScheme::ApiKey {
                location: ApiKeyLocation::Cookie,
                ..
            }
        )
    };
    let supported: Vec<SecurityRequirement> = parsed
        .iter()
        .filter(|r| {
            r.iter()
                .all(|(name, _)| scheme(name).is_some_and(|s| !is_cookie(s)))
        })
        .cloned()
        .collect();
    if parsed.is_empty() || !supported.is_empty() {
        return Ok(supported);
    }
    let mut names: Vec<&str> = Vec::new();
    for r in &parsed {
        for (n, _) in r {
            if !names.contains(&n.as_str()) {
                names.push(n);
            }
        }
    }
    match names.iter().find(|n| scheme(n).is_some_and(is_cookie)) {
        Some(cookie) => Err(format!("cookie authentication '{cookie}' is not supported")),
        None => Err(format!(
            "security requirement references missing or malformed scheme: {}",
            names.join(", ")
        )),
    }
}

pub fn security_schemes(doc: &Json) -> Vec<(String, SecurityScheme)> {
    let Some(Json::Object(declared)) = doc.get("components").and_then(|c| c.get("securitySchemes"))
    else {
        return Vec::new();
    };
    declared
        .iter()
        .filter_map(|(name, value)| {
            let r = resolve(doc, Some(value))?.as_object()?;
            let scheme = match non_empty(r.get("type"))? {
                "apiKey" => {
                    let parameter = non_empty(r.get("name"))?;
                    let location = match non_empty(r.get("in"))? {
                        "header" => ApiKeyLocation::Header,
                        "query" => ApiKeyLocation::Query,
                        "cookie" => ApiKeyLocation::Cookie,
                        _ => return None,
                    };
                    SecurityScheme::ApiKey {
                        name: parameter.to_owned(),
                        location,
                    }
                }
                "http" => SecurityScheme::Http {
                    scheme: non_empty(r.get("scheme"))?.to_lowercase(),
                },
                "oauth2" => SecurityScheme::OAuth2,
                "openIdConnect" => SecurityScheme::OpenIdConnect,
                _ => return None,
            };
            Some((name.clone(), scheme))
        })
        .collect()
}
