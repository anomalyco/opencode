//! The `search` built-in: field-weighted BM25 over tool paths, descriptions, parameter names and namespace
//! descriptions, ported from the reference's `tool-runtime.ts` so the same queries rank the same tools.

use std::collections::HashMap;

use serde_json::json;

use crate::Json;
use crate::schema::{self, Schema};
use crate::tool::{Entry, compare_text, tool_expression};

const DEFAULT_LIMIT: usize = 10;
const K1: f64 = 1.2;
const LENGTH_NORMALIZATION: f64 = 0.75;
/// score × (1 + BREVITY_BOOST / words in the tool name): "users" prefers `list_users` over `list_user_groups`.
const BREVITY_BOOST: f64 = 0.5;
/// A query word of 4+ letters also matches longer words it starts with, at this weight: `term` → `terminal`.
const PREFIX_WEIGHT: f64 = 0.3;

/// Fields in the reference's order, with their weights: name, namespace, description, namespace description,
/// parameters.
const FIELDS: usize = 5;
const WEIGHTS: [f64; FIELDS] = [3.0, 2.0, 1.0, 0.4, 0.3];

/// Words split at case changes and non-alphanumerics: `listUserGroups` → list, user, groups.
fn split_words(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut spaced = String::with_capacity(text.len() + 8);
    for (i, &c) in chars.iter().enumerate() {
        spaced.push(c);
        if (c.is_ascii_lowercase() || c.is_ascii_digit())
            && chars.get(i + 1).is_some_and(char::is_ascii_uppercase)
        {
            spaced.push(' ');
        }
    }
    spaced
        .to_lowercase()
        .split(|c: char| !(c.is_ascii_lowercase() || c.is_ascii_digit()))
        .filter(|w| !w.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Plural endings only, applied the same everywhere: `settings` → `setting`, `statuses` → `status`, `vms` → `vm`.
fn stem(word: String) -> String {
    let len = word.len();
    if len > 4 && word.ends_with("ies") {
        return format!("{}y", &word[..len - 3]);
    }
    if len > 4
        && ["sses", "shes", "ches", "xes", "zes", "uses"]
            .iter()
            .any(|e| word.ends_with(e))
    {
        return word[..len - 2].to_owned();
    }
    if len > 2 && word.ends_with('s') && !["ss", "us", "is"].iter().any(|e| word.ends_with(e)) {
        return word[..len - 1].to_owned();
    }
    word
}

/// Searchable words of a text: its split words, plus each camelCase word whole (`CronJob` → cron, job, cronjob).
fn search_words(text: &str) -> Vec<String> {
    let mut words = split_words(text);
    // `/[A-Za-z0-9]*[a-z0-9][A-Z][A-Za-z0-9]*/g` matches whole alphanumeric runs holding a lower-to-upper change.
    for run in text.split(|c: char| !c.is_ascii_alphanumeric()) {
        let bytes = run.as_bytes();
        if bytes.windows(2).any(|w| {
            (w[0].is_ascii_lowercase() || w[0].is_ascii_digit()) && w[1].is_ascii_uppercase()
        }) {
            words.push(run.to_ascii_lowercase());
        }
    }
    words.into_iter().map(stem).collect()
}

/// For each word, the tools containing it and their field-weighted, length-normalized term frequency.
pub struct WordIndex {
    postings: HashMap<String, (Vec<u32>, Vec<f32>)>,
    documents: usize,
    /// Sorted indexed words, for partial-word matching.
    words: Vec<String>,
    /// Words in each tool's own name (the last path segment).
    name_lengths: Vec<usize>,
}

impl WordIndex {
    pub fn build(entries: &[Entry]) -> Self {
        let mut cache: HashMap<String, Vec<String>> = HashMap::new();
        let mut words_of = |texts: &[String]| -> Vec<String> {
            texts
                .iter()
                .flat_map(|t| {
                    cache
                        .entry(t.clone())
                        .or_insert_with(|| search_words(t))
                        .clone()
                })
                .collect()
        };
        let fields: Vec<[Vec<String>; FIELDS]> = entries
            .iter()
            .map(|e| {
                let segments: Vec<String> = e.path.split('.').map(str::to_owned).collect();
                let (name, namespace) = segments
                    .split_last()
                    .map_or((String::new(), &[][..]), |(n, ns)| (n.clone(), ns));
                [
                    words_of(&[name]),
                    words_of(namespace),
                    words_of(std::slice::from_ref(&e.tool.description)),
                    words_of(&e.namespaces),
                    words_of(&schema::input_property_names(e.tool.input.document())),
                ]
            })
            .collect();
        let count = entries.len();
        let mut average = [0.0; FIELDS];
        for (f, avg) in average.iter_mut().enumerate() {
            let total: usize = fields.iter().map(|e| e[f].len()).sum();
            let mean = total as f64 / count as f64;
            *avg = if mean == 0.0 || mean.is_nan() {
                1.0
            } else {
                mean
            };
        }
        let mut postings: HashMap<String, (Vec<u32>, Vec<f32>)> = HashMap::new();
        for (position, entry) in fields.iter().enumerate() {
            let mut weights: Vec<(String, f64)> = Vec::new();
            for f in 0..FIELDS {
                let weight = WEIGHTS[f]
                    / (1.0 - LENGTH_NORMALIZATION
                        + LENGTH_NORMALIZATION * entry[f].len() as f64 / average[f]);
                for word in &entry[f] {
                    match weights.iter_mut().find(|(w, _)| w == word) {
                        Some((_, total)) => *total += weight,
                        None => weights.push((word.clone(), weight)),
                    }
                }
            }
            for (word, weight) in weights {
                let posting = postings.entry(word).or_default();
                posting.0.push(position as u32);
                // The reference keeps weights in a Float32Array; rounding the same way keeps ties the same.
                posting.1.push(weight as f32);
            }
        }
        let mut words: Vec<String> = postings.keys().cloned().collect();
        words.sort();
        let name_lengths = entries
            .iter()
            .map(|e| split_words(e.path.rsplit('.').next().unwrap_or("")).len())
            .collect();
        Self {
            postings,
            documents: count,
            words,
            name_lengths,
        }
    }

    /// Indexed words longer than a 4+ letter query word that start with it.
    fn prefix_matches(&self, term: &str) -> Vec<&str> {
        if term.encode_utf16().count() < 4 {
            return Vec::new();
        }
        let start = self.words.partition_point(|w| w.as_str() < term);
        self.words[start..]
            .iter()
            .take_while(|w| w.starts_with(term))
            .filter(|w| w.as_str() != term)
            .map(String::as_str)
            .collect()
    }
}

/// Positions of `scope` (indexes into `entries`) ranked for `query`; an empty query sorts them by path.
pub fn rank(entries: &[Entry], index: &WordIndex, scope: &[usize], query: &str) -> Vec<usize> {
    let terms = search_words(query);
    if terms.is_empty() {
        let mut out = scope.to_vec();
        out.sort_by(|a, b| compare_text(&entries[*a].path, &entries[*b].path));
        return out;
    }
    let all = scope.len() == entries.len();
    let mut allowed = vec![all; entries.len()];
    if !all {
        for &p in scope {
            allowed[p] = true;
        }
    }
    let mut order: Vec<usize> = Vec::new();
    let mut scores: HashMap<usize, f64> = HashMap::new();
    for term in &terms {
        let mut best: Vec<(usize, f64)> = Vec::new();
        let candidates = std::iter::once((term.as_str(), 1.0)).chain(
            index
                .prefix_matches(term)
                .into_iter()
                .map(|w| (w, PREFIX_WEIGHT)),
        );
        for (word, factor) in candidates {
            let Some((positions, weights)) = index.postings.get(word) else {
                continue;
            };
            let df = positions.len() as f64;
            let idf = (1.0 + (index.documents as f64 - df + 0.5) / (df + 0.5)).ln();
            for (i, &position) in positions.iter().enumerate() {
                let position = position as usize;
                if !allowed[position] {
                    continue;
                }
                let weight = weights[i] as f64;
                let score = factor * idf * weight * (K1 + 1.0) / (weight + K1);
                match best.iter_mut().find(|(p, _)| *p == position) {
                    Some((_, b)) => {
                        if score > *b {
                            *b = score;
                        }
                    }
                    None if score > 0.0 => best.push((position, score)),
                    None => {}
                }
            }
        }
        for (position, score) in best {
            let total = scores.entry(position).or_insert_with(|| {
                order.push(position);
                0.0
            });
            *total += score;
        }
    }
    let mut ranked: Vec<(usize, f64)> = order
        .into_iter()
        .map(|p| {
            let boost = 1.0 + BREVITY_BOOST / index.name_lengths[p].max(1) as f64;
            (p, scores[&p] * boost)
        })
        .collect();
    ranked.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| compare_text(&entries[a.0].path, &entries[b.0].path))
    });
    ranked.into_iter().map(|(p, _)| p).collect()
}

/// The schema `search` decodes its input with, as the reference's Effect `SearchInput` renders to JSON Schema.
pub fn input_schema() -> Schema {
    Schema::validated(json!({
        "type": "object",
        "properties": {
            "query": { "type": "string" },
            "namespace": { "type": "string" },
            "limit": { "type": "integer", "maximum": 9007199254740991i64, "exclusiveMinimum": 0 },
            "offset": { "type": "integer", "minimum": 0, "maximum": 9007199254740991i64 }
        },
        "additionalProperties": false
    }))
}

fn output_schema() -> Json {
    let int = json!({ "type": "integer", "minimum": 0, "maximum": 9007199254740991i64 });
    json!({
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "description": { "type": "string" },
                        "signature": { "type": "string" }
                    },
                    "required": ["path", "description", "signature"],
                    "additionalProperties": false
                }
            },
            "remaining": int,
            "next": {
                "anyOf": [
                    {
                        "type": "object",
                        "properties": { "offset": int },
                        "required": ["offset"],
                        "additionalProperties": false
                    },
                    { "type": "null" }
                ]
            }
        },
        "required": ["items", "remaining", "next"],
        "additionalProperties": false
    })
}

/// The exact callable signature of the built-in `search`, for host-owned instructions.
pub fn search_signature() -> String {
    format!(
        "search(query: string | {}): {}",
        schema::to_typescript(input_schema().document(), true),
        schema::to_typescript(&output_schema(), true)
    )
}

/// Runs a decoded search request over a runtime's tools.
pub fn search(entries: &[Entry], index: &WordIndex, request: &Json) -> Json {
    let query = request.get("query").and_then(Json::as_str).unwrap_or("");
    let offset = request.get("offset").and_then(Json::as_f64).unwrap_or(0.0) as usize;
    let limit = request
        .get("limit")
        .and_then(Json::as_f64)
        .map_or(DEFAULT_LIMIT, |l| l as usize);
    let mut namespace = request.get("namespace").and_then(Json::as_str);
    if let Some(ns) = namespace
        && !entries.iter().any(|e| e.path.starts_with("tools."))
    {
        namespace = if ns == "tools" {
            None
        } else {
            Some(ns.strip_prefix("tools.").unwrap_or(ns))
        };
    }
    let scoped: Vec<usize> = match namespace {
        None => (0..entries.len()).collect(),
        Some(ns) => {
            let under = format!("{ns}.");
            (0..entries.len())
                .filter(|&i| entries[i].path == ns || entries[i].path.starts_with(&under))
                .collect()
        }
    };
    let trimmed = query.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    let path_query = trimmed.strip_prefix("tools.").unwrap_or(trimmed);
    let exact = (!path_query.is_empty())
        .then(|| {
            scoped.iter().copied().find(|&i| {
                entries[i].path == path_query || tool_expression(&entries[i].path) == trimmed
            })
        })
        .flatten();
    let ranked = match exact {
        Some(i) => vec![i],
        None => rank(entries, index, &scoped, path_query),
    };
    let items: Vec<Json> = ranked
        .iter()
        .skip(offset)
        .take(limit)
        .map(|&i| {
            let e = &entries[i];
            json!({
                "path": tool_expression(&e.path),
                "description": e.tool.description,
                "signature": e.signature(),
            })
        })
        .collect();
    let remaining = ranked.len().saturating_sub(offset + items.len());
    let next = if remaining > 0 {
        json!({ "offset": offset + items.len() })
    } else {
        Json::Null
    };
    json!({ "items": items, "remaining": remaining, "next": next })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_split_and_stem_like_the_reference() {
        assert_eq!(split_words("listUserGroups"), ["list", "user", "groups"]);
        assert_eq!(search_words("CronJob"), ["cron", "job", "cronjob"]);
        assert_eq!(
            search_words("settings statuses vms issues class"),
            ["setting", "status", "vm", "issue", "class"]
        );
    }
}
