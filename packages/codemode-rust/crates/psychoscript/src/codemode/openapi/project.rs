//! The model-facing directional projection, as in the reference's `spec.ts`: request schemas omit `readOnly`
//! properties, response schemas omit `writeOnly` ones, and `required` stays consistent. Runtime values pass through
//! unchanged.
//!
//! Hidden-ness and hidden names are memoized per schema (by its place in the document) and direction, and
//! reference cycles are solved with Tarjan's strongly connected components, so the results do not depend on the
//! order schemas are visited in.

use std::collections::{HashMap, HashSet};

use super::spec::{own, resolve_pointer};
use crate::Json;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Request,
    Response,
}

impl Direction {
    fn keyword(self) -> &'static str {
        match self {
            Direction::Request => "readOnly",
            Direction::Response => "writeOnly",
        }
    }

    fn index(self) -> usize {
        self as usize
    }
}

/// A schema and the root its local `$defs` pointers resolve against.
#[derive(Clone, Copy)]
pub struct Resource<'a> {
    pub value: &'a Json,
    pub root: &'a Json,
}

type Key = *const Json;

struct Solver<T> {
    values: HashMap<Key, T>,
    pending: HashMap<Key, usize>,
    stack: Vec<Key>,
}

impl<T> Default for Solver<T> {
    fn default() -> Self {
        Self {
            values: HashMap::new(),
            pending: HashMap::new(),
            stack: Vec::new(),
        }
    }
}

pub struct Projector<'a> {
    pub doc: &'a Json,
    directional: bool,
    /// The first schema conversion the reference refuses, which fails the whole document.
    pub error: Option<String>,
    hidden: [Solver<bool>; 2],
    names: [Solver<HashSet<String>>; 2],
}

const NESTED: [&str; 6] = [
    "items",
    "additionalProperties",
    "unevaluatedProperties",
    "propertyNames",
    "then",
    "else",
];
const NESTED_LISTS: [&str; 3] = ["anyOf", "oneOf", "prefixItems"];
const NESTED_MAPS: [&str; 4] = [
    "patternProperties",
    "dependentSchemas",
    "$defs",
    "definitions",
];

fn contains_directional(v: &Json) -> bool {
    match v {
        Json::Array(items) => items.iter().any(contains_directional),
        Json::Object(m) => {
            m.get("readOnly") == Some(&Json::Bool(true))
                || m.get("writeOnly") == Some(&Json::Bool(true))
                || m.values().any(contains_directional)
        }
        _ => false,
    }
}

/// Solves one value through the strongly connected components of the reference graph; see the module docs.
macro_rules! solve {
    ($self:ident, $field:ident, $d:expr, $key:expr, $provisional:expr, $scope:expr, |$inner:ident| $compute:expr) => {{
        let key = $key;
        let d = $d.index();
        if let Some(v) = $self.$field[d].values.get(&key) {
            v.clone()
        } else if let Some(&pending) = $self.$field[d].pending.get(&key) {
            *$scope = (*$scope).min(pending);
            $provisional
        } else {
            let index = $self.$field[d].pending.len();
            let base = $self.$field[d].stack.len();
            $self.$field[d].pending.insert(key, index);
            $self.$field[d].stack.push(key);
            let mut lowlink = usize::MAX;
            let $inner: &mut usize = &mut lowlink;
            let value = $compute;
            if lowlink < index {
                *$scope = (*$scope).min(lowlink);
                value
            } else {
                let members: Vec<Key> = $self.$field[d].stack.drain(base..).collect();
                for member in members {
                    $self.$field[d].pending.remove(&member);
                    $self.$field[d].values.insert(member, value.clone());
                }
                value
            }
        }
    }};
}

impl<'a> Projector<'a> {
    pub fn new(doc: &'a Json) -> Self {
        Self {
            doc,
            directional: contains_directional(doc),
            error: None,
            hidden: Default::default(),
            names: Default::default(),
        }
    }

    /// Whether the document has any directional keyword; most have none, and skip projection entirely.
    pub fn directional(&self) -> bool {
        self.directional
    }

    /// Follows one `$ref` hop. Local `$defs`/`definitions` pointers resolve against the schema being projected;
    /// other pointers rebase onto the target.
    fn resolve_resource(&self, r: Resource<'a>) -> Resource<'a> {
        let Some(reference) = r
            .value
            .as_object()
            .and_then(|m| super::spec::non_empty(m.get("$ref")))
        else {
            return r;
        };
        if !reference.starts_with("#/") {
            return r;
        }
        let local = reference.starts_with("#/$defs/") || reference.starts_with("#/definitions/");
        let Some(target) = resolve_pointer(if local { r.root } else { self.doc }, reference) else {
            return r;
        };
        Resource {
            value: target,
            root: if local { r.root } else { target },
        }
    }

    fn is_hidden(&mut self, r: Resource<'a>, d: Direction, scope: &mut usize) -> bool {
        let Some(map) = r.value.as_object() else {
            return false;
        };
        if map.get(d.keyword()) == Some(&Json::Bool(true)) {
            return true;
        }
        let key: Key = r.value;
        solve!(self, hidden, d, key, false, scope, |inner| {
            let mut hidden = false;
            if let Some(Json::Array(all)) = own(map, "allOf") {
                for item in all {
                    if self.is_hidden(Resource { value: item, ..r }, d, inner) {
                        hidden = true;
                        break;
                    }
                }
            }
            if !hidden {
                let target = self.resolve_resource(r);
                hidden = !std::ptr::eq(target.value, r.value) && self.is_hidden(target, d, inner);
            }
            hidden
        })
    }

    fn hidden_names(
        &mut self,
        r: Resource<'a>,
        d: Direction,
        scope: &mut usize,
    ) -> HashSet<String> {
        let Some(map) = r.value.as_object() else {
            return HashSet::new();
        };
        let key: Key = r.value;
        solve!(self, names, d, key, HashSet::new(), scope, |inner| {
            let mut names = HashSet::new();
            if let Some(Json::Object(props)) = own(map, "properties") {
                for (name, property) in props {
                    let mut fresh = usize::MAX;
                    if self.is_hidden(
                        Resource {
                            value: property,
                            ..r
                        },
                        d,
                        &mut fresh,
                    ) {
                        names.insert(name.clone());
                    }
                }
            }
            if let Some(Json::Array(all)) = own(map, "allOf") {
                for item in all {
                    names.extend(self.hidden_names(Resource { value: item, ..r }, d, inner));
                }
            }
            let target = self.resolve_resource(r);
            if !std::ptr::eq(target.value, r.value) {
                names.extend(self.hidden_names(target, d, inner));
            }
            names
        })
    }

    /// The schema with hidden properties removed, recursively; `excluded` are names hidden by `allOf` siblings.
    pub fn directional_schema(
        &mut self,
        r: Resource<'a>,
        d: Direction,
        excluded: &HashSet<String>,
    ) -> Json {
        let Some(map) = r.value.as_object() else {
            return r.value.clone();
        };
        let mut hidden = excluded.clone();
        let mut fresh = usize::MAX;
        hidden.extend(self.hidden_names(r, d, &mut fresh));
        let none = HashSet::new();
        let mut out = serde_json::Map::new();
        for (key, item) in map {
            let projected = match (key.as_str(), item) {
                ("properties", Json::Object(props)) => Json::Object(
                    props
                        .iter()
                        .filter(|(name, _)| !hidden.contains(*name))
                        .map(|(name, p)| {
                            (
                                name.clone(),
                                self.directional_schema(Resource { value: p, ..r }, d, &none),
                            )
                        })
                        .collect(),
                ),
                ("required", Json::Array(names)) => Json::Array(
                    names
                        .iter()
                        .filter(|n| n.as_str().is_none_or(|n| !hidden.contains(n)))
                        .cloned()
                        .collect(),
                ),
                // allOf branches share one object; hidden names apply across every branch.
                ("allOf", Json::Array(all)) => Json::Array(
                    all.iter()
                        .map(|e| self.directional_schema(Resource { value: e, ..r }, d, &hidden))
                        .collect(),
                ),
                (k, _) if NESTED.contains(&k) => {
                    self.directional_schema(Resource { value: item, ..r }, d, &none)
                }
                (k, Json::Array(list)) if NESTED_LISTS.contains(&k) => Json::Array(
                    list.iter()
                        .map(|e| self.directional_schema(Resource { value: e, ..r }, d, &none))
                        .collect(),
                ),
                (k, Json::Object(m)) if NESTED_MAPS.contains(&k) => Json::Object(
                    m.iter()
                        .map(|(n, e)| {
                            (
                                n.clone(),
                                self.directional_schema(Resource { value: e, ..r }, d, &none),
                            )
                        })
                        .collect(),
                ),
                _ => item.clone(),
            };
            out.insert(key.clone(), projected);
        }
        Json::Object(out)
    }

    /// A schema as a model-facing JSON Schema document: projected for its direction, then normalized.
    pub fn project_schema(&mut self, value: Option<&'a Json>, d: Direction) -> Json {
        let Some(value) = value else {
            return Json::Object(Default::default());
        };
        if !self.directional {
            return super::normalize::normalize(self.doc, value, &mut self.error);
        }
        let projected =
            self.directional_schema(Resource { value, root: value }, d, &HashSet::new());
        super::normalize::normalize(self.doc, &projected, &mut self.error)
    }
}
