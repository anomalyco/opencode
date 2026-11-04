//! Cell claims and collision checks (`core/spatial.ts`).

use std::collections::{BTreeMap, BTreeSet};

use indexmap::IndexMap;

use super::geometry::{Bounds, Point, orthogonal_path_points};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Role {
    Body,
    Boundary,
    Terminal,
    Route,
    Label,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct SpatialSpan {
    pub y: i32,
    pub from_x: i32,
    pub to_x: i32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Claim {
    pub id: String,
    pub owner: String,
    pub role: Role,
    pub spans: Vec<SpatialSpan>,
}

#[derive(Clone, Debug)]
pub struct Contact {
    pub owner: String,
    pub points: Vec<Point>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Clearance {
    pub x: i32,
    pub y: i32,
}

/// `SpatialCollisionPolicy.clearance`: one clearance, or one per existing claim's role.
#[derive(Clone, Debug, Default)]
pub enum ClearancePolicy {
    #[default]
    None,
    All(Clearance),
    ByRole(Vec<(Role, Clearance)>),
}

#[derive(Clone, Debug, Default)]
pub struct Policy {
    pub contacts: Vec<Contact>,
    pub clearance: ClearancePolicy,
}

fn span(y: i32, from: i32, to: i32) -> SpatialSpan {
    SpatialSpan {
        y,
        from_x: from.min(to),
        to_x: from.max(to),
    }
}

pub fn rect_spans(bounds: &Bounds) -> Vec<SpatialSpan> {
    (0..bounds.height.max(0))
        .map(|offset| {
            span(
                bounds.top + offset,
                bounds.left,
                bounds.left + bounds.width - 1,
            )
        })
        .collect()
}

pub fn path_spans(points: &[Point]) -> Vec<SpatialSpan> {
    let mut cells: BTreeMap<i32, BTreeSet<i32>> = BTreeMap::new();
    if points.len() == 1 {
        cells.entry(points[0].y).or_default().insert(points[0].x);
    }
    for point in orthogonal_path_points(points) {
        cells.entry(point.y).or_default().insert(point.x);
    }
    let mut spans = Vec::new();
    for (y, xs) in cells {
        let mut iter = xs.into_iter();
        let Some(first) = iter.next() else {
            continue;
        };
        let (mut start, mut end) = (first, first);
        for x in iter {
            if x == end + 1 {
                end = x;
                continue;
            }
            spans.push(span(y, start, end));
            start = x;
            end = x;
        }
        spans.push(span(y, start, end));
    }
    spans
}

pub fn rect_claim(
    id: impl Into<String>,
    owner: impl Into<String>,
    role: Role,
    bounds: &Bounds,
) -> Claim {
    Claim {
        id: id.into(),
        owner: owner.into(),
        role,
        spans: rect_spans(bounds),
    }
}

pub fn path_claim(
    id: impl Into<String>,
    owner: impl Into<String>,
    role: Role,
    points: &[Point],
) -> Claim {
    Claim {
        id: id.into(),
        owner: owner.into(),
        role,
        spans: path_spans(points),
    }
}

#[derive(Clone, Debug, Default)]
pub struct SpatialIndex {
    claims: Vec<Claim>,
}

impl SpatialIndex {
    pub fn claims(&self) -> &[Claim] {
        &self.claims
    }

    fn normalize(mut claim: Claim) -> Claim {
        claim.spans.sort();
        claim
    }

    pub fn add(&self, claims: impl IntoIterator<Item = Claim>) -> SpatialIndex {
        self.overlay(&SpatialIndex {
            claims: claims.into_iter().map(Self::normalize).collect(),
        })
    }

    /// Claims of both, sorted by ID; a later claim replaces one with the same ID.
    pub fn overlay(&self, other: &SpatialIndex) -> SpatialIndex {
        let mut claims: IndexMap<String, Claim> = self
            .claims
            .iter()
            .map(|claim| (claim.id.clone(), claim.clone()))
            .collect();
        for claim in &other.claims {
            claims.insert(claim.id.clone(), claim.clone());
        }
        let mut claims: Vec<Claim> = claims.into_values().collect();
        claims.sort_by(|a, b| a.id.cmp(&b.id));
        SpatialIndex { claims }
    }

    pub fn is_free(&self, moving: &Claim, policy: &Policy) -> bool {
        for existing in &self.claims {
            if moving.owner == existing.owner
                || (moving.role == Role::Route && existing.role == Role::Route)
            {
                continue;
            }
            let clearance = match &policy.clearance {
                ClearancePolicy::None => Clearance::default(),
                ClearancePolicy::All(clearance) => *clearance,
                ClearancePolicy::ByRole(roles) => roles
                    .iter()
                    .find(|(role, _)| *role == existing.role)
                    .map_or(Clearance::default(), |(_, clearance)| *clearance),
            };
            for moving_span in &moving.spans {
                for dy in -clearance.y..=clearance.y {
                    let y = moving_span.y + dy;
                    let from = moving_span.from_x - clearance.x;
                    let to = moving_span.to_x + clearance.x;
                    for existing_span in &existing.spans {
                        if existing_span.y != y {
                            continue;
                        }
                        for x in from.max(existing_span.from_x)..=to.min(existing_span.to_x) {
                            let occupies = moving
                                .spans
                                .iter()
                                .any(|s| s.y == y && x >= s.from_x && x <= s.to_x);
                            let contact = policy.contacts.iter().any(|contact| {
                                contact.owner == existing.owner
                                    && contact
                                        .points
                                        .iter()
                                        .any(|point| point.x == x && point.y == y)
                            });
                            if !(occupies && contact) {
                                return false;
                            }
                        }
                    }
                }
            }
        }
        true
    }
}
